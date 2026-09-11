import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { EventDeliveryStore } from '../../app/application/events/event-delivery-store';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const NOW = new Date('2026-07-22T08:00:00.000Z');
let setupPrisma: PrismaClient;
let prismaA: PrismaClient;
let prismaB: PrismaClient;

async function createDelivery(data: {
  status?: 'PENDING' | 'RETRY_WAIT' | 'PROCESSING';
  orderingKey?: string;
  nextAttemptAt?: Date | null;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  attemptCount?: number;
  version?: number;
  startedAt?: Date | null;
} = {}): Promise<string> {
  const operationId = randomUUID();
  const event = await setupPrisma.eventLog.create({
    data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: operationId,
      orderingKey: data.orderingKey ?? 'a'.repeat(64),
      payload: {
        operationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId: randomUUID(),
        routeUrl: `/security/admin-governance?operationId=${operationId}`,
      },
      traceId: `worker-concurrency-${randomUUID()}`,
      occurredAt: NOW,
      dispatchedAt: NOW,
    },
  });
  const subscription = await setupPrisma.eventSubscription.findUniqueOrThrow({
    where: { code: 'admin-operation-reviewed-notification-v1' },
  });
  return (await setupPrisma.eventDelivery.create({
    data: {
      eventId: event.id,
      subscriptionId: subscription.id,
      handlerCode: subscription.handlerCode,
      orderingKey: event.orderingKey,
      status: data.status ?? 'PENDING',
      nextAttemptAt: data.nextAttemptAt,
      lockedBy: data.lockedBy,
      lockedUntil: data.lockedUntil,
      attemptCount: data.attemptCount ?? 0,
      version: data.version ?? 0,
      startedAt: data.startedAt,
    },
  })).id;
}

test.before(async () => {
  setupPrisma = createTestPrisma();
  prismaA = createTestPrisma();
  prismaB = createTestPrisma();
});
test.beforeEach(async () => { await clearTestApplicationData(setupPrisma); });
test.after(async () => {
  await clearTestApplicationData(setupPrisma);
  await Promise.all([ setupPrisma.$disconnect(), prismaA.$disconnect(), prismaB.$disconnect() ]);
});

test('allows exactly one worker to atomically own a delivery lease', async () => {
  const deliveryId = await createDelivery();
  const storeA = new EventDeliveryStore(prismaA, { leaseSeconds: 60, now: () => NOW });
  const storeB = new EventDeliveryStore(prismaB, { leaseSeconds: 60, now: () => NOW });

  const results = await Promise.all([
    storeA.claimBatch({ workerId: 'worker-a', limit: 1 }),
    storeB.claimBatch({ workerId: 'worker-b', limit: 1 }),
  ]);

  assert.equal(results.reduce((sum, claims) => sum + claims.length, 0), 1);
  const claim = results.flat()[0];
  assert.equal(claim.deliveryId, deliveryId);
  assert.equal(claim.attemptNumber, 1);
  assert.equal(claim.version, 1);
  const persisted = await setupPrisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(persisted.status, 'PROCESSING');
  assert.equal(persisted.lockedBy, claim.workerId);
  assert.equal(persisted.lockedUntil?.toISOString(), '2026-07-22T08:01:00.000Z');
  assert.equal(persisted.startedAt?.toISOString(), NOW.toISOString());
  assert.equal(persisted.attemptCount, 1);
  assert.equal(persisted.version, 1);
});

test('claims PENDING, due RETRY_WAIT, and expired PROCESSING but not future or active work', async () => {
  const pending = await createDelivery({ orderingKey: '1'.repeat(64) });
  const dueRetry = await createDelivery({
    status: 'RETRY_WAIT', orderingKey: '2'.repeat(64), nextAttemptAt: NOW,
  });
  const expired = await createDelivery({
    status: 'PROCESSING', orderingKey: '3'.repeat(64), lockedBy: 'crashed-worker',
    lockedUntil: new Date(NOW.getTime() - 1), attemptCount: 1, version: 4,
    startedAt: new Date(NOW.getTime() - 5_000),
  });
  await createDelivery({
    status: 'RETRY_WAIT', orderingKey: '4'.repeat(64), nextAttemptAt: new Date(NOW.getTime() + 1),
  });
  await createDelivery({
    status: 'PROCESSING', orderingKey: '5'.repeat(64), lockedBy: 'active-worker',
    lockedUntil: new Date(NOW.getTime() + 1), attemptCount: 1, startedAt: NOW,
  });
  const store = new EventDeliveryStore(prismaA, { leaseSeconds: 60, now: () => NOW });

  const claims = await store.claimBatch({ workerId: 'recovery-worker', limit: 10 });

  assert.deepEqual(new Set(claims.map(claim => claim.deliveryId)), new Set([ pending, dueRetry, expired ]));
});

test('records a crashed lease as one immutable LEASE_LOST attempt before reclaiming', async () => {
  const startedAt = new Date(NOW.getTime() - 5_000);
  const deliveryId = await createDelivery({
    status: 'PROCESSING',
    lockedBy: 'crashed-worker',
    lockedUntil: new Date(NOW.getTime() - 1),
    attemptCount: 1,
    version: 7,
    startedAt,
  });
  const store = new EventDeliveryStore(prismaB, { leaseSeconds: 60, now: () => NOW });

  const claims = await store.claimBatch({ workerId: 'worker-b', limit: 1 });

  assert.equal(claims.length, 1);
  assert.equal(claims[0].attemptNumber, 2);
  assert.equal(claims[0].version, 8);
  const logs = await setupPrisma.eventHandlerLog.findMany({ where: { deliveryId } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].attemptNumber, 1);
  assert.equal(logs[0].workerId, 'crashed-worker');
  assert.equal(logs[0].outcome, 'LEASE_LOST');
  assert.equal(logs[0].errorCode, 'EVENT_HANDLER_LEASE_LOST');
  assert.match(logs[0].errorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(logs[0].durationMs, 5_000);
  assert.ok(logs[0].durationMs >= 0);

  await store.claimBatch({ workerId: 'worker-c', limit: 1 });
  assert.equal(await setupPrisma.eventHandlerLog.count({ where: { deliveryId, attemptNumber: 1 } }), 1);
});

test('refuses a new lease when immutable evidence already contradicts LEASE_LOST', async () => {
  const startedAt = new Date(NOW.getTime() - 5_000);
  const deliveryId = await createDelivery({
    status: 'PROCESSING',
    lockedBy: 'crashed-worker',
    lockedUntil: new Date(NOW.getTime() - 1),
    attemptCount: 1,
    version: 7,
    startedAt,
  });
  await setupPrisma.eventHandlerLog.create({
    data: {
      deliveryId,
      attemptNumber: 1,
      workerId: 'crashed-worker',
      outcome: 'SUCCEEDED',
      durationMs: 1,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 1),
    },
  });
  const store = new EventDeliveryStore(prismaA, { leaseSeconds: 60, now: () => NOW });

  await assert.rejects(store.claimBatch({ workerId: 'worker-b', limit: 1 }));

  const delivery = await setupPrisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'PROCESSING');
  assert.equal(delivery.lockedBy, 'crashed-worker');
  assert.equal(delivery.lockedUntil?.getTime(), NOW.getTime() - 1);
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.version, 7);
  const logs = await setupPrisma.eventHandlerLog.findMany({ where: { deliveryId } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, 'SUCCEEDED');
});

test('validates claim batch and lease bounds from constructor configuration', async () => {
  assert.throws(() => new EventDeliveryStore(prismaA, { leaseSeconds: 29 }), /between 30 and 600/);
  assert.throws(() => new EventDeliveryStore(prismaA, { leaseSeconds: 601 }), /between 30 and 600/);
  const store = new EventDeliveryStore(prismaA, { leaseSeconds: 60, now: () => NOW });
  await assert.rejects(store.claimBatch({ workerId: 'worker', limit: 0 }), /between 1 and 200/);
  await assert.rejects(store.claimBatch({ workerId: 'worker', limit: 201 }), /between 1 and 200/);
});
