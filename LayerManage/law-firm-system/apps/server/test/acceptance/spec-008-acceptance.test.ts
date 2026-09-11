import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { EventOperationsService } from '../../app/application/events/event-operations-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { EventObservabilityUnavailableError } from '../../app/domain/events/event-observability-errors';
import { evaluateEventRollout } from '../../app/domain/events/event-observability';
import type { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  checkEventsMain,
  productionCheckEventsCliDependencies,
  type CheckEventsCliDependencies,
} from '../../scripts/events/check-events';
import {
  assertEventObservabilityRehearsalEnvironment,
  observeCanaryWindow,
  rehearseEventObservabilityMain,
} from '../../scripts/rehearsal/rehearse-event-observability';
import { allowTestGovernanceStepUp } from '../helpers/governance-step-up';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const WORKER_DISABLED = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
const WORKER_ENABLED = Object.freeze({ ...WORKER_DISABLED, enabled: true });
const OBSERVABILITY = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});
const FIXTURES = [
  'spec008-private-governance-reason',
  'spec008-private-review-comment',
  'spec008-private-business-payload',
  'spec008-private-availability-detail',
] as const;

test('server package exposes the guarded observability rehearsal command', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    manifest.scripts?.['rehearse:event-observability'],
    'tsx scripts/rehearsal/rehearse-event-observability.ts',
  );
});

test('rehearsal guard rejects every unsafe target variation before returning a target', () => {
  const exact = 'postgresql://localhost:55432/chengye_oa_test?schema=public';
  const valid = {
    ALLOW_TEST_DB_RESET: 'true',
    ALLOW_EVENT_OBSERVABILITY_REHEARSAL: 'true',
    EVENT_WORKER_ENABLED: 'false',
    DATABASE_URL_TEST: exact,
    DATABASE_URL: exact,
  };

  for (const [name, value] of [
    ['ALLOW_TEST_DB_RESET', 'false'],
    ['ALLOW_EVENT_OBSERVABILITY_REHEARSAL', 'false'],
    ['EVENT_WORKER_ENABLED', 'true'],
  ] as const) {
    assert.throws(() => assertEventObservabilityRehearsalEnvironment({ ...valid, [name]: value }));
  }
  for (const unsafe of [
    'postgresql://localhost/chengye_oa_test?schema=public',
    'postgresql://localhost:5432/chengye_oa_test?schema=public',
    'postgresql://127.0.0.1:55432/chengye_oa_test?schema=public',
    'postgresql://db.invalid:55432/chengye_oa_test?schema=public',
    'postgresql://localhost:55432/another_test?schema=public',
    'postgresql://localhost:55432/chengye_oa_test?schema=other',
  ]) {
    assert.throws(() => assertEventObservabilityRehearsalEnvironment({
      ...valid,
      DATABASE_URL_TEST: unsafe,
      DATABASE_URL: unsafe,
    }));
  }
  assert.throws(() => assertEventObservabilityRehearsalEnvironment({
    ...valid,
    DATABASE_URL: `${exact}&connection_limit=1`,
  }));
  assert.throws(() => assertEventObservabilityRehearsalEnvironment({
    ...valid,
    DATABASE_URL: exact.replace('localhost', 'operator@localhost'),
  }));
  assert.equal(assertEventObservabilityRehearsalEnvironment(valid).databaseName, 'chengye_oa_test');
});

test('canary observation accepts an injected short window without real sleeping', async () => {
  const clock = { value: new Date('2026-07-24T01:00:00.000Z') };
  const checks: Date[] = [];
  const result = await observeCanaryWindow({
    windowMilliseconds: 3_000,
    intervalMilliseconds: 1_000,
    now: () => clock.value,
    wait: async milliseconds => { clock.value = new Date(clock.value.getTime() + milliseconds); },
    check: async () => {
      checks.push(new Date(clock.value));
      return { status: 'READY' as const, alertCodes: [] };
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.elapsedSeconds, 3);
  assert.equal(checks.length, 4);
});

test('guarded PostgreSQL rehearsal covers preflight, drain, canary, failure, quarantine, and rollback', async () => {
  const target = assertEventObservabilityRehearsalEnvironment(process.env);
  const prisma = createTestPrisma();
  const openedClients: PrismaClient[] = [];
  try {
    await clearTestApplicationData(prisma);
    const requester = await prisma.user.create({ data: {
      username: `spec008.requester.${randomUUID()}`,
      password: 'unused',
    } });
    const reviewer = await prisma.user.create({ data: {
      username: `spec008.reviewer.${randomUUID()}`,
      password: 'unused',
    } });
    const disabled = createEventServices(prisma, WORKER_DISABLED, { observability: OBSERVABILITY });
    await disabled.runtimeStatus.markDisabled();
    assert.equal(evaluateEventRollout({
      mode: 'preflight',
      snapshot: await disabled.snapshotReader.read(),
      config: OBSERVABILITY,
    }).status, 'READY');

    const source = await prisma.adminOperation.create({ data: {
      operationNo: `SPEC008-${randomUUID()}`,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      reviewMode: 'PRE',
      status: 'PENDING_REVIEW',
      requesterUserId: requester.id,
      targetType: 'USER',
      targetId: randomUUID(),
      reason: FIXTURES[0],
      payloadSnapshot: { privateValue: FIXTURES[2] },
      payloadHash: 'b'.repeat(64),
      expectedTargetVersion: 1,
      idempotencyKey: randomUUID(),
    } });
    const governance = createGovernanceServices(prisma, {
      databaseName: target.databaseName,
      stepUp: allowTestGovernanceStepUp,
      outboxWriter: disabled.outboxWriter,
    });
    await governance.review.review(operator(reviewer.id), source.id, {
      decision: 'REJECT',
      comment: FIXTURES[1],
      expectedOperationVersion: source.version,
    }, 'spec008-acceptance');

    const firstDrain = await disabled.worker.tick();
    const secondDrain = await disabled.worker.tick();
    assert.deepEqual(
      { dispatched: firstDrain.dispatched, succeeded: firstDrain.succeeded, secondClaimed: secondDrain.claimed },
      { dispatched: 1, succeeded: 1, secondClaimed: 0 },
    );
    assert.equal(await prisma.notification.count({ where: { relatedId: source.id } }), 1);

    const enabledPrisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
    openedClients.push(enabledPrisma);
    const enabled = createEventServices(enabledPrisma, WORKER_ENABLED, {
      observability: OBSERVABILITY,
      workerId: 'spec008-acceptance-worker',
    });
    await enabled.runtimeStatus.markStarting();
    enabled.worker.start();
    await enabled.worker.tick();
    const canary = evaluateEventRollout({
      mode: 'canary',
      snapshot: await enabled.snapshotReader.read(),
      config: OBSERVABILITY,
    });
    assert.equal(canary.status, 'READY');

    let failOnce = true;
    const captured = streams();
    const checkDependencies: CheckEventsCliDependencies = {
      ...productionCheckEventsCliDependencies,
      stdout: captured.stdout,
      stderr: captured.stderr,
      async assertMigrationsReady(received) { assert.equal(received, target.databaseUrl); },
      createPrisma(received) {
        assert.equal(received, target.databaseUrl);
        const client = new PrismaClient({ datasources: { db: { url: received } } });
        openedClients.push(client);
        return client;
      },
      createSnapshotReader(client, env) {
        if (failOnce) {
          failOnce = false;
          return { async read() {
            throw new Prisma.PrismaClientInitializationError(FIXTURES[3], 'test-client');
          } } as ReturnType<CheckEventsCliDependencies['createSnapshotReader']>;
        }
        return productionCheckEventsCliDependencies.createSnapshotReader(client, env);
      },
    };
    const canaryEnv = {
      NODE_ENV: 'unittest',
      DATABASE_URL: target.databaseUrl,
      JWT_SECRET: randomUUID().repeat(2),
      APP_KEYS: `${randomUUID()},${randomUUID()}`,
      MFA_ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
      EVENT_WORKER_ENABLED: 'true',
    };
    assert.equal(await checkEventsMain([ '--mode=canary' ], canaryEnv, checkDependencies), 5);
    assert.equal(captured.stderrValues.join(''), 'Database state is unavailable.\n');
    assert.equal(await checkEventsMain([ '--mode=canary' ], canaryEnv, checkDependencies), 0);

    const operations = new EventOperationsService({
      prisma,
      registry: disabled.registry,
      health: disabled.health,
      snapshotReader: { async read() {
        throw new Prisma.PrismaClientInitializationError(FIXTURES[3], 'test-client');
      } } as typeof disabled.snapshotReader,
      observability: OBSERVABILITY,
      workerEnabled: true,
      stepUp: allowTestGovernanceStepUp,
    });
    await assert.rejects(operations.summary(operator(reviewer.id)), error => (
      error instanceof EventObservabilityUnavailableError && error.httpStatus === 503
    ));

    const unknown = await prisma.eventLog.create({ data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 2,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: randomUUID(),
      orderingKey: createHash('sha256').update(randomUUID()).digest('hex'),
      payload: { safe: 'unsupported-version' },
      traceId: randomUUID(),
      occurredAt: new Date(),
    } });
    await disabled.dispatcher.dispatchBatch(25);
    await disabled.dispatcher.dispatchBatch(25);
    assert.equal(await prisma.eventDelivery.count({ where: { eventId: unknown.id, status: 'MANUAL' } }), 1);
    assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: unknown.id } })).dispatchedAt, null);
    assert.equal(await prisma.notification.count({ where: { relatedId: unknown.objectId } }), 0);
    assert.equal(evaluateEventRollout({
      mode: 'canary',
      snapshot: await enabled.snapshotReader.read(),
      config: OBSERVABILITY,
    }).status, 'BLOCKED');

    await enabled.worker.stop(5_000);
    await enabled.runtimeStatus.markStopped();
    await enabled.runtimeStatus.markDisabled();
    const preservedRows = await prisma.eventLog.count();
    const pending = await prisma.eventLog.create({ data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 2,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: randomUUID(),
      orderingKey: createHash('sha256').update(randomUUID()).digest('hex'),
      payload: { safe: 'rollback-preserved' },
      traceId: randomUUID(),
      occurredAt: new Date(),
    } });
    assert.equal(await prisma.eventLog.count(), preservedRows + 1);
    assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: pending.id } })).dispatchedAt, null);

    const evidence = JSON.stringify({
      events: await prisma.eventLog.findMany(),
      deliveries: await prisma.eventDelivery.findMany(),
      logs: await prisma.eventHandlerLog.findMany(),
      notifications: await prisma.notification.findMany(),
      output: [...captured.stdoutValues, ...captured.stderrValues],
    });
    for (const fixture of FIXTURES) assert.equal(evidence.includes(fixture), false);
  } finally {
    await Promise.allSettled(openedClients.map(client => client.$disconnect()));
    await clearTestApplicationData(prisma);
    await prisma.$disconnect();
  }
});

test('guarded rehearsal main completes an injected short window with only redacted evidence', async () => {
  const output: string[] = [];
  const result = await rehearseEventObservabilityMain({
    ...process.env,
    NODE_ENV: 'unittest',
    JWT_SECRET: randomUUID().repeat(2),
    APP_KEYS: `${randomUUID()},${randomUUID()}`,
    MFA_ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  }, {
    windowMilliseconds: 1_500,
    intervalMilliseconds: 100,
    stdout: { write(value) { output.push(String(value)); return true; } },
  });

  assert.equal(result.status, 'READY');
  const canary = result.phases.find(phase => phase.phase === 'canary');
  assert.ok(canary);
  assert.equal(canary.status, 'READY');
  assert.deepEqual(canary.counts, {
    checks: canary.counts.checks,
    events: 1,
    deliveries: 1,
    handlerLogs: 1,
    notifications: 1,
    idempotencyKeys: 1,
  });
  const rollback = result.phases.find(phase => phase.phase === 'rollback');
  assert.ok(rollback);
  assert.equal(rollback.status, 'DISABLED');
  assert.deepEqual(rollback.counts, {
    newClaims: 0,
    eventLogsAdded: 1,
    deliveriesChanged: 0,
    handlerLogsChanged: 0,
    notificationsChanged: 0,
    idempotencyKeysChanged: 0,
    auditsChanged: 0,
  });
  const serialized = JSON.stringify({ result, output });
  for (const fixture of FIXTURES) assert.equal(serialized.includes(fixture), false);
  assert.doesNotMatch(serialized, /postgresql:|workerId|lockedBy|hostname|pid/i);
});

function operator(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    grants: [],
    fieldRules: [],
    permissionCodes: [ 'governance.review', 'event.delivery.read' ] as PermissionCode[],
    evaluatedAt: new Date(),
  };
}

function streams() {
  const stdoutValues: string[] = [];
  const stderrValues: string[] = [];
  return {
    stdout: { write(value: string | Uint8Array) { stdoutValues.push(String(value)); return true; } } as NodeJS.WritableStream,
    stderr: { write(value: string | Uint8Array) { stderrValues.push(String(value)); return true; } } as NodeJS.WritableStream,
    stdoutValues,
    stderrValues,
  };
}
