import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { EventRuntimeSnapshotReader } from '../../app/application/events/event-runtime-snapshot-reader';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { EventWorkerRuntimeStatusStore } from '../../app/application/events/event-worker-runtime-status-store';
import type { EventWorkerHealthSnapshot } from '../../app/application/events/event-health-service';
import type { EventObservabilityEnvironment, EventWorkerEnvironment } from '../../config/env';
import {
  assertTestDatabaseUrl,
  clearTestApplicationData,
  createTestPrisma,
} from '../helpers/test-database';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const LEASE_SECONDS = 60;
const WORKER_CONFIG: EventWorkerEnvironment = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: LEASE_SECONDS,
  shutdownSeconds: 30,
});
const OBSERVABILITY_CONFIG: EventObservabilityEnvironment = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});

let prisma: PrismaClient;

function reader(
  client: PrismaClient = prisma,
  runtimeStatus = new EventWorkerRuntimeStatusStore(client, { heartbeatSeconds: 10, now: () => NOW }),
): EventRuntimeSnapshotReader {
  return new EventRuntimeSnapshotReader(client, {
    leaseSeconds: LEASE_SECONDS,
    now: () => new Date(NOW),
    runtimeStatus,
  });
}

async function createEvent(input: { readonly createdAt: Date; readonly dispatchedAt?: Date | null }) {
  const orderingKey = createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
  return prisma.eventLog.create({
    data: {
      eventType: `snapshot.${randomUUID()}`,
      eventVersion: 1,
      sourceModule: 'snapshot-test',
      objectType: 'SNAPSHOT_TEST',
      objectId: randomUUID(),
      orderingKey,
      payload: { privateValue: 'must-never-be-selected' },
      traceId: randomUUID(),
      occurredAt: input.createdAt,
      dispatchedAt: input.dispatchedAt ?? null,
      createdAt: input.createdAt,
    },
  });
}

async function createDelivery(input: {
  readonly status: string;
  readonly createdAt: Date;
  readonly nextAttemptAt?: Date | null;
  readonly lockedUntil?: Date | null;
  readonly completedAt?: Date | null;
  readonly lastErrorCode?: string | null;
}) {
  const event = await createEvent({ createdAt: input.createdAt, dispatchedAt: input.createdAt });
  const handlerCode = `snapshot-handler-${randomUUID()}`;
  const subscription = await prisma.eventSubscription.create({
    data: {
      code: `snapshot-subscription-${randomUUID()}`,
      eventType: event.eventType,
      eventVersion: 1,
      handlerCode,
    },
  });
  return prisma.eventDelivery.create({
    data: {
      eventId: event.id,
      subscriptionId: subscription.id,
      handlerCode,
      orderingKey: event.orderingKey,
      status: input.status,
      nextAttemptAt: input.nextAttemptAt ?? null,
      lockedBy: input.status === 'PROCESSING' ? 'must-never-be-selected' : null,
      lockedUntil: input.lockedUntil ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorReference: input.lastErrorCode ? 'must-never-be-selected' : null,
      startedAt: input.status === 'PROCESSING' ? input.createdAt : null,
      completedAt: input.completedAt ?? null,
      createdAt: input.createdAt,
      updatedAt: input.completedAt ?? input.createdAt,
    },
  });
}

function healthyWorker(overrides: Partial<EventWorkerHealthSnapshot> = {}): EventWorkerHealthSnapshot {
  return {
    status: 'healthy',
    workerEnabled: true,
    lastSuccessfulTickAt: NOW,
    lastDatabaseFailureAt: null,
    consecutiveDatabaseFailures: 0,
    databaseFailureTotal: 0,
    lastErrorCode: null,
    lastErrorReference: null,
    ...overrides,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('returns zero aggregate counts and null runtime status when PostgreSQL has no event rows', async () => {
  const snapshot = await reader().read();

  assert.deepEqual(snapshot, {
    evaluatedAt: NOW,
    undispatchedCount: 0,
    oldestUndispatchedSeconds: 0,
    dueBacklogCount: 0,
    oldestDueBacklogSeconds: 0,
    manualCount: 0,
    unresolvedDispatcherFaultCount: 0,
    processingCount: 0,
    expiredProcessingCount: 0,
    staleExpiredProcessingCount: 0,
    leaseLost15mCount: 0,
    workerConfiguredEnabled: null,
    workerState: null,
    workerProcessStartedAt: null,
    lastHeartbeatAt: null,
    lastSuccessfulTickAt: null,
    consecutiveDatabaseFailures: null,
  });
});

test('uses createdAt for PENDING and only due nextAttemptAt for RETRY_WAIT backlog age', async () => {
  await createDelivery({ status: 'PENDING', createdAt: new Date(NOW.getTime() - 40_000) });
  await createDelivery({
    status: 'RETRY_WAIT',
    createdAt: new Date(NOW.getTime() - 600_000),
    nextAttemptAt: new Date(NOW.getTime() - 80_000),
  });
  await createDelivery({
    status: 'RETRY_WAIT',
    createdAt: new Date(NOW.getTime() - 900_000),
    nextAttemptAt: new Date(NOW.getTime() + 1),
  });

  const snapshot = await reader().read();

  assert.equal(snapshot.dueBacklogCount, 2);
  assert.equal(snapshot.oldestDueBacklogSeconds, 80);
});

test('counts PROCESSING leases at exact expiry and stale boundaries', async () => {
  await createDelivery({ status: 'PROCESSING', createdAt: NOW, lockedUntil: new Date(NOW.getTime() + 1) });
  await createDelivery({ status: 'PROCESSING', createdAt: NOW, lockedUntil: NOW });
  await createDelivery({ status: 'PROCESSING', createdAt: NOW, lockedUntil: new Date(NOW.getTime() - 59_999) });
  await createDelivery({ status: 'PROCESSING', createdAt: NOW, lockedUntil: new Date(NOW.getTime() - 60_000) });
  await createDelivery({ status: 'PROCESSING', createdAt: NOW, lockedUntil: new Date(NOW.getTime() + 60_000) });

  const snapshot = await reader().read();

  assert.equal(snapshot.processingCount, 5);
  assert.equal(snapshot.expiredProcessingCount, 3);
  assert.equal(snapshot.staleExpiredProcessingCount, 1);
});

test('counts all MANUAL deliveries separately from the three stable dispatcher fault codes', async () => {
  for (const code of [
    'HANDLER_NOT_REGISTERED',
    'SUBSCRIPTION_FILTER_INVALID',
    'EVENT_ENVELOPE_INVALID',
    'EVENT_HANDLER_FAILED',
  ]) {
    await createDelivery({ status: 'MANUAL', createdAt: NOW, lastErrorCode: code });
  }
  await createDelivery({ status: 'RETRY_WAIT', createdAt: NOW, nextAttemptAt: NOW, lastErrorCode: 'HANDLER_NOT_REGISTERED' });

  const snapshot = await reader().read();

  assert.equal(snapshot.manualCount, 4);
  assert.equal(snapshot.unresolvedDispatcherFaultCount, 3);
});

test('counts LEASE_LOST completed exactly within the closed recent 15-minute window', async () => {
  const boundary = new Date(NOW.getTime() - 15 * 60_000);
  const inside = await createDelivery({ status: 'SUCCEEDED', createdAt: boundary, completedAt: boundary });
  const outside = await createDelivery({
    status: 'SUCCEEDED',
    createdAt: new Date(boundary.getTime() - 1),
    completedAt: new Date(boundary.getTime() - 1),
  });
  const future = await createDelivery({
    status: 'SUCCEEDED',
    createdAt: new Date(NOW.getTime() + 1),
    completedAt: new Date(NOW.getTime() + 1),
  });
  for (const [delivery, attemptNumber, completedAt, outcome] of [
    [inside, 1, boundary, 'LEASE_LOST'],
    [inside, 2, NOW, 'LEASE_LOST'],
    [outside, 1, new Date(boundary.getTime() - 1), 'LEASE_LOST'],
    [future, 1, new Date(NOW.getTime() + 1), 'LEASE_LOST'],
    [outside, 2, NOW, 'SUCCEEDED'],
  ] as const) {
    await prisma.eventHandlerLog.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber,
        workerId: 'must-never-be-selected',
        outcome,
        durationMs: 1,
        startedAt: completedAt,
        completedAt,
      },
    });
  }

  const snapshot = await reader().read();

  assert.equal(snapshot.leaseLost15mCount, 2);
});

test('uses one clock, floors future timestamp ages at zero, and combines durable runtime with same-process health', async () => {
  let clockCalls = 0;
  const status = new EventWorkerRuntimeStatusStore(prisma, { heartbeatSeconds: 10, now: () => NOW });
  await status.markStarting(new Date(NOW.getTime() - 30_000));
  await status.recordHeartbeat(new Date(NOW.getTime() - 10_000));
  await createEvent({ createdAt: new Date(NOW.getTime() + 10_000) });
  await createDelivery({ status: 'PENDING', createdAt: new Date(NOW.getTime() + 20_000) });
  const subject = new EventRuntimeSnapshotReader(prisma, {
    leaseSeconds: LEASE_SECONDS,
    now: () => {
      clockCalls += 1;
      return new Date(NOW);
    },
    runtimeStatus: status,
  });

  const snapshot = await subject.read(healthyWorker({ consecutiveDatabaseFailures: 2 }));

  assert.equal(clockCalls, 1);
  assert.equal(snapshot.undispatchedCount, 1);
  assert.equal(snapshot.oldestUndispatchedSeconds, 0);
  assert.equal(snapshot.dueBacklogCount, 1);
  assert.equal(snapshot.oldestDueBacklogSeconds, 0);
  assert.equal(snapshot.workerConfiguredEnabled, true);
  assert.equal(snapshot.workerState, 'RUNNING');
  assert.deepEqual(snapshot.workerProcessStartedAt, new Date(NOW.getTime() - 30_000));
  assert.deepEqual(snapshot.lastHeartbeatAt, new Date(NOW.getTime() - 10_000));
  assert.deepEqual(snapshot.lastSuccessfulTickAt, new Date(NOW.getTime() - 10_000));
  assert.equal(snapshot.consecutiveDatabaseFailures, 2);
});

test('rejects an invalid injected clock before accessing PostgreSQL', async () => {
  let runtimeReads = 0;
  const subject = new EventRuntimeSnapshotReader(prisma, {
    leaseSeconds: LEASE_SECONDS,
    now: () => new Date(Number.NaN),
    runtimeStatus: { read: async () => { runtimeReads += 1; return null; } },
  });

  await assert.rejects(subject.read(), /valid Date/);
  assert.equal(runtimeReads, 0);
});

test('uses bounded aggregate queries and never selects sensitive event, delivery, handler, or notification fields', async () => {
  await createDelivery({
    status: 'MANUAL',
    createdAt: new Date(NOW.getTime() - 1_000),
    lastErrorCode: 'HANDLER_NOT_REGISTERED',
  });
  const queries: string[] = [];
  const audited = new PrismaClient({
    datasources: { db: { url: assertTestDatabaseUrl().toString() } },
    log: [{ emit: 'event', level: 'query' }],
  });
  audited.$on('query', event => { queries.push(event.query); });
  try {
    const status = new EventWorkerRuntimeStatusStore(audited, { heartbeatSeconds: 10 });
    await reader(audited, status).read();
  } finally {
    await audited.$disconnect();
  }

  const sql = queries.join('\n');
  assert.ok(queries.length > 0);
  assert.doesNotMatch(sql, /"payload"|"workerId"|"lockedBy"|"lastErrorReference"|"errorReference"|"content"/i);
  assert.doesNotMatch(sql, /\bnotification\b/i);
});

test('factory shares reader and store only for an identical worker and complete observability signature', async () => {
  const client = createTestPrisma();
  try {
    const first = createEventServices(client, WORKER_CONFIG, {
      workerId: 'snapshot-factory-test',
      observability: OBSERVABILITY_CONFIG,
    });
    const repeated = createEventServices(client, { ...WORKER_CONFIG }, {
      workerId: 'snapshot-factory-test',
      observability: { ...OBSERVABILITY_CONFIG },
    });
    assert.strictEqual(repeated, first);
    assert.strictEqual(repeated.runtimeStatus, first.runtimeStatus);
    assert.strictEqual(repeated.snapshotReader, first.snapshotReader);

    const changedValues: ReadonlyArray<Partial<EventObservabilityEnvironment>> = [
      { heartbeatSeconds: 11 },
      { heartbeatStaleSeconds: 61 },
      { undispatchedBlockSeconds: 121 },
      { dueBacklogBlockSeconds: 301 },
      { leaseLostDegradedCount: 2 },
      { leaseLostBlockedCount: 4 },
      { canaryWindowMinutes: 16 },
    ];
    for (const changed of changedValues) {
      assert.throws(
        () => createEventServices(client, WORKER_CONFIG, {
          workerId: 'snapshot-factory-test',
          observability: { ...OBSERVABILITY_CONFIG, ...changed },
        }),
        /already initialized with different configuration/,
      );
    }
  } finally {
    await client.$disconnect();
  }
});
