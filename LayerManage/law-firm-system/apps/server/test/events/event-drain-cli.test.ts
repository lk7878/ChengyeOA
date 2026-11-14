import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { PrismaClient } from '@prisma/client';

import { createEventServices } from '../../app/application/events/event-services-factory';
import { PrismaEventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { DatabaseStateError } from '../../app/application/system/system-command-errors';
import {
  drainMain,
  type DrainCliDependencies,
} from '../../scripts/events/drain-events';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const SECRET_DATABASE_URL = 'postgresql://operator:never-display@db.example.test:55432/chengye_oa_test?schema=private';
const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: SECRET_DATABASE_URL,
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
  MFA_ENCRYPTION_KEY_V1: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  EVENT_WORKER_ENABLED: 'false',
  EVENT_WORKER_POLL_MS: '250',
  EVENT_WORKER_BATCH_SIZE: '25',
  EVENT_WORKER_LEASE_SECONDS: '60',
  EVENT_WORKER_SHUTDOWN_SECONDS: '30',
};

interface Recorder {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly dependencies: DrainCliDependencies;
  readonly migrationCalls: () => number;
  readonly factoryCalls: () => number;
  readonly disconnectCalls: () => number;
  readonly dispatchCalls: () => number;
  readonly tickCalls: () => number;
}

function emptyWorkerTick() {
  return {
    dispatched: 0,
    claimed: 0,
    succeeded: 0,
    retryScheduled: 0,
    manual: 0,
    leaseLost: 0,
  };
}

async function seedReviewedEvent(prisma: PrismaClient) {
  const requester = await prisma.user.create({
    data: { username: `drain.requester.${randomUUID()}`, password: 'unused' },
  });
  const operation = await prisma.adminOperation.create({
    data: {
      operationNo: `DRAIN-${randomUUID()}`,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      reviewMode: 'PRE',
      status: 'REJECTED',
      requesterUserId: requester.id,
      targetType: 'USER',
      targetId: randomUUID(),
      reason: 'private drain fixture reason',
      payloadSnapshot: { privateValue: 'must-not-print' },
      payloadHash: 'b'.repeat(64),
      expectedTargetVersion: 1,
      idempotencyKey: randomUUID(),
    },
  });
  await prisma.$transaction(tx => new PrismaEventOutboxWriter().append(tx, {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    objectType: 'ADMIN_OPERATION',
    objectId: operation.id,
    operatorUserId: requester.id,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: {
      operationId: operation.id,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      decision: 'REJECT',
      status: 'REJECTED',
      requesterUserId: requester.id,
      routeUrl: `/security/admin-governance?operationId=${operation.id}`,
    },
    traceId: randomUUID(),
    occurredAt: new Date(),
  }));
  return { operation, requester };
}

function recorder(options: {
  dispatch?: Array<{ dispatchedCount: number; deliveryCount: number; manualCount: number }>;
  ticks?: Array<ReturnType<typeof emptyWorkerTick>>;
  migrationError?: Error;
  tickError?: Error;
} = {}): Recorder {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prisma = {
    async $disconnect() { disconnects += 1; },
  };
  let migrations = 0;
  let factories = 0;
  let disconnects = 0;
  let dispatchIndex = 0;
  let tickIndex = 0;
  const dispatch = options.dispatch ?? [
    { dispatchedCount: 1, deliveryCount: 1, manualCount: 0 },
    { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
    { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
  ];
  const ticks = options.ticks ?? [
    { ...emptyWorkerTick(), claimed: 1, succeeded: 1 },
    emptyWorkerTick(),
    emptyWorkerTick(),
  ];
  const dependencies: DrainCliDependencies = {
    stdout: { write(value) { stdout.push(String(value)); return true; } },
    stderr: { write(value) { stderr.push(String(value)); return true; } },
    async assertMigrationsReady(databaseUrl) {
      migrations += 1;
      assert.equal(databaseUrl, SECRET_DATABASE_URL);
      if (options.migrationError) throw options.migrationError;
    },
    createPrisma(databaseUrl) {
      assert.equal(databaseUrl, SECRET_DATABASE_URL);
      return prisma as never;
    },
    createEventServices(receivedPrisma, config) {
      factories += 1;
      assert.equal(receivedPrisma, prisma);
      assert.equal(config.enabled, false);
      assert.deepEqual(config, {
        enabled: false,
        pollMs: 250,
        batchSize: 25,
        leaseSeconds: 60,
        shutdownSeconds: 30,
      });
      return {
        dispatcher: {
          async dispatchBatch() {
            return dispatch[Math.min(dispatchIndex++, dispatch.length - 1)];
          },
        },
        worker: {
          async tick() {
            if (options.tickError) throw options.tickError;
            return ticks[Math.min(tickIndex++, ticks.length - 1)];
          },
        },
      } as never;
    },
  };
  return {
    stdout,
    stderr,
    dependencies,
    migrationCalls: () => migrations,
    factoryCalls: () => factories,
    disconnectCalls: () => disconnects,
    dispatchCalls: () => dispatchIndex,
    tickCalls: () => tickIndex,
  };
}

test('rejects every argument before configuration, migrations, or database connection', async () => {
  const harness = recorder();
  const code = await drainMain([ '--payload=private-notification-content' ], {}, harness.dependencies);

  assert.equal(code, 2);
  assert.equal(harness.migrationCalls(), 0);
  assert.equal(harness.factoryCalls(), 0);
  assert.equal(harness.disconnectCalls(), 0);
  assert.deepEqual(harness.stdout, []);
  assert.doesNotMatch(harness.stderr.join(''), /payload|private|notification|content/i);
});

test('drains with the background switch false and exits after two empty rounds', async () => {
  const harness = recorder();
  const code = await drainMain([], BASE_ENV, harness.dependencies);

  assert.equal(code, 0);
  assert.equal(harness.migrationCalls(), 1);
  assert.equal(harness.factoryCalls(), 1);
  assert.equal(harness.disconnectCalls(), 1);
  assert.equal(harness.dispatchCalls(), 3);
  assert.equal(harness.tickCalls(), 3);
  const output = harness.stdout.join('');
  assert.match(output, /dispatched=1 claimed=1 succeeded=1 retryScheduled=0 manual=0 leaseLost=0 status=complete/);
  assert.equal(harness.stderr.join(''), '');
  assert.doesNotMatch(output, /payload|postgresql:|operator|never-display|private|notification content/i);
});

test('ignores only the background switch while numeric worker configuration remains strict', async () => {
  const ignoredSwitch = recorder();
  assert.equal(await drainMain([], { ...BASE_ENV, EVENT_WORKER_ENABLED: 'not-a-boolean' }, ignoredSwitch.dependencies), 0);

  const invalidNumeric = recorder();
  const code = await drainMain([], { ...BASE_ENV, EVENT_WORKER_BATCH_SIZE: '0' }, invalidNumeric.dependencies);
  assert.equal(code, 2);
  assert.equal(invalidNumeric.migrationCalls(), 0);
  assert.equal(invalidNumeric.factoryCalls(), 0);
  assert.doesNotMatch(invalidNumeric.stderr.join(''), /EVENT_WORKER|batch|0|postgresql:|never-display/i);
});

test('returns nonzero for MANUAL evidence while printing counts and safe status only', async () => {
  const harness = recorder({
    dispatch: [
      { dispatchedCount: 1, deliveryCount: 1, manualCount: 1 },
      { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
      { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
    ],
    ticks: [ emptyWorkerTick(), emptyWorkerTick(), emptyWorkerTick() ],
  });
  const code = await drainMain([], BASE_ENV, harness.dependencies);

  assert.equal(code, 4);
  const transcript = `${harness.stdout.join('')}\n${harness.stderr.join('')}`;
  assert.match(transcript, /manual=1/);
  assert.match(transcript, /status=manual_attention_required/);
  assert.doesNotMatch(transcript, /payload|postgresql:|operator|never-display|private|notification content/i);
});

test('returns one stable MANUAL count for a persistent undispatched quarantine without polling forever', async () => {
  const harness = recorder({
    dispatch: [
      { dispatchedCount: 0, deliveryCount: 0, manualCount: 1 },
      { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
    ],
    ticks: [ emptyWorkerTick() ],
  });

  const code = await drainMain([], BASE_ENV, harness.dependencies);

  assert.equal(code, 4);
  assert.equal(harness.dispatchCalls(), 2);
  assert.equal(harness.tickCalls(), 2);
  assert.match(harness.stdout.join(''), /manual=1/);
  assert.match(harness.stdout.join(''), /status=manual_attention_required/);
});

test('migration and database failures return a stable nonzero code without raw errors', async () => {
  for (const [name, harness] of [
    [ 'migration', recorder({ migrationError: new DatabaseStateError('postgresql://migration-secret payload') }) ],
    [ 'tick', recorder({ tickError: new DatabaseStateError('postgresql://tick-secret notification content') }) ],
  ] as const) {
    const code = await drainMain([], BASE_ENV, harness.dependencies);
    assert.equal(code, 5, name);
    const transcript = `${harness.stdout.join('')}\n${harness.stderr.join('')}`;
    assert.match(transcript, /Database state is unavailable/);
    assert.doesNotMatch(transcript, /postgresql:|secret|payload|notification content/i);
  }
});

test('real production services drain one stored outbox event into one notification', async () => {
  const databaseUrl = process.env.DATABASE_URL_TEST as string;
  const prisma = createTestPrisma();
  const verificationPrisma = createTestPrisma();
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    await clearTestApplicationData(prisma);
    const { requester } = await seedReviewedEvent(prisma);

    const dependencies: DrainCliDependencies = {
      stdout: { write(value) { stdout.push(String(value)); return true; } },
      stderr: { write(value) { stderr.push(String(value)); return true; } },
      async assertMigrationsReady(receivedUrl) { assert.equal(receivedUrl, databaseUrl); },
      createPrisma(receivedUrl) {
        assert.equal(receivedUrl, databaseUrl);
        return prisma;
      },
      createEventServices,
    };
    const code = await drainMain([], { ...BASE_ENV, DATABASE_URL: databaseUrl }, dependencies);

    assert.equal(code, 0);
    assert.equal(stderr.join(''), '');
    assert.match(stdout.join(''), /dispatched=1 claimed=1 succeeded=1 .*manual=0 .*status=complete/);
    assert.equal(await verificationPrisma.notification.count({ where: { userId: requester.id } }), 1);
    assert.equal((await verificationPrisma.eventDelivery.findFirstOrThrow()).status, 'SUCCEEDED');
    const transcript = `${stdout.join('')}\n${stderr.join('')}`;
    assert.doesNotMatch(transcript, /private drain|must-not-print|postgresql:|chengye_test_local_only/i);
  } finally {
    await clearTestApplicationData(verificationPrisma);
    await prisma.$disconnect();
    await verificationPrisma.$disconnect();
  }
});

test('real drain reports an unknown stored handler as MANUAL and exits nonzero', async () => {
  const databaseUrl = process.env.DATABASE_URL_TEST as string;
  const prisma = createTestPrisma();
  const verificationPrisma = createTestPrisma();
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    await clearTestApplicationData(prisma);
    await prisma.eventSubscription.update({
      where: { code: 'admin-operation-reviewed-notification-v1' },
      data: { handlerCode: 'UNKNOWN_AFTER_DEPLOY' },
    });
    await seedReviewedEvent(prisma);
    const dependencies: DrainCliDependencies = {
      stdout: { write(value) { stdout.push(String(value)); return true; } },
      stderr: { write(value) { stderr.push(String(value)); return true; } },
      async assertMigrationsReady() {},
      createPrisma() { return prisma; },
      createEventServices,
    };

    const code = await drainMain([], { ...BASE_ENV, DATABASE_URL: databaseUrl }, dependencies);

    assert.equal(code, 4);
    assert.equal(stderr.join(''), '');
    assert.match(stdout.join(''), /dispatched=1 claimed=0 succeeded=0 .*manual=1 .*status=manual_attention_required/);
    const delivery = await verificationPrisma.eventDelivery.findFirstOrThrow();
    assert.equal(delivery.status, 'MANUAL');
    assert.equal(delivery.lastErrorCode, 'HANDLER_NOT_REGISTERED');
    assert.doesNotMatch(`${stdout.join('')}\n${stderr.join('')}`, /UNKNOWN_AFTER_DEPLOY|postgresql:|private drain/i);
  } finally {
    await clearTestApplicationData(verificationPrisma);
    await prisma.$disconnect();
    await verificationPrisma.$disconnect();
  }
});

test('real drain repeatedly exits nonzero for one quarantined unknown event version without duplicate evidence', async () => {
  const databaseUrl = process.env.DATABASE_URL_TEST as string;
  const prisma = createTestPrisma();
  const verificationPrisma = createTestPrisma();
  const transcripts: string[] = [];
  const stderr: string[] = [];
  try {
    await clearTestApplicationData(prisma);
    await seedReviewedEvent(prisma);
    const event = await prisma.eventLog.findFirstOrThrow();
    await prisma.eventLog.update({ where: { id: event.id }, data: { eventVersion: 2 } });

    for (let run = 0; run < 2; run += 1) {
      const stdout: string[] = [];
      const dependencies: DrainCliDependencies = {
        stdout: { write(value) { stdout.push(String(value)); return true; } },
        stderr: { write(value) { stderr.push(String(value)); return true; } },
        async assertMigrationsReady() {},
        createPrisma() { return createTestPrisma(); },
        createEventServices,
      };
      const code = await drainMain([], { ...BASE_ENV, DATABASE_URL: databaseUrl }, dependencies);
      assert.equal(code, 4);
      assert.match(stdout.join(''), /dispatched=0 claimed=0 succeeded=0 .*manual=1 .*status=manual_attention_required/);
      transcripts.push(stdout.join(''));
    }

    assert.equal(stderr.join(''), '');
    const delivery = await verificationPrisma.eventDelivery.findFirstOrThrow();
    assert.equal(delivery.status, 'MANUAL');
    assert.equal(delivery.handlerCode, 'EVENT_DISPATCH_QUARANTINE');
    assert.equal(delivery.lastErrorCode, 'EVENT_ENVELOPE_INVALID');
    assert.equal(await verificationPrisma.eventDelivery.count({ where: { eventId: event.id } }), 1);
    assert.equal((await verificationPrisma.eventLog.findUniqueOrThrow({ where: { id: event.id } })).dispatchedAt, null);
    assert.equal(await verificationPrisma.eventHandlerLog.count(), 0);
    assert.equal(await verificationPrisma.notification.count(), 0);
    assert.doesNotMatch(`${transcripts.join('\n')}\n${stderr.join('')}`, /postgresql:|operationType|routeUrl/i);
  } finally {
    await clearTestApplicationData(verificationPrisma);
    await prisma.$disconnect();
    await verificationPrisma.$disconnect();
  }
});

test('package exposes the one-shot drain command', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(manifest.scripts?.['events:drain'], 'tsx scripts/events/drain-events.ts');
});
