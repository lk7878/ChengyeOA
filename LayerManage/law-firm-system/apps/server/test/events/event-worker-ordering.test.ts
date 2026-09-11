import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { EventDeliveryStore } from '../../app/application/events/event-delivery-store';
import { EventDispatcher } from '../../app/application/events/event-dispatcher';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { EventWorker } from '../../app/application/events/event-worker';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const NOW = new Date('2026-07-22T09:00:00.000Z');
const ORDERING_KEY = 'c'.repeat(64);
let prisma: PrismaClient;
let lockPrisma: PrismaClient;
let dispatchPrisma: PrismaClient;
let workerPrisma: PrismaClient;

async function createDelivery(input: {
  createdAt: Date;
  status: 'PENDING' | 'RETRY_WAIT' | 'PROCESSING' | 'MANUAL' | 'SUCCEEDED';
  eventId?: string;
  deliveryId?: string;
  dispatchedAt?: Date | null;
  nextAttemptAt?: Date | null;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  completedAt?: Date | null;
  manualRetryCount?: number;
}): Promise<string> {
  const operationId = randomUUID();
  const event = await prisma.eventLog.create({
    data: {
      id: input.eventId,
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: operationId,
      orderingKey: ORDERING_KEY,
      payload: {
        operationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId: randomUUID(),
        routeUrl: `/security/admin-governance?operationId=${operationId}`,
      },
      traceId: `worker-ordering-${randomUUID()}`,
      occurredAt: input.createdAt,
      dispatchedAt: input.dispatchedAt === undefined ? input.createdAt : input.dispatchedAt,
      createdAt: input.createdAt,
    },
  });
  const subscription = await prisma.eventSubscription.findUniqueOrThrow({
    where: { code: 'admin-operation-reviewed-notification-v1' },
  });
  return (await prisma.eventDelivery.create({
    data: {
      id: input.deliveryId,
      eventId: event.id,
      subscriptionId: subscription.id,
      handlerCode: subscription.handlerCode,
      orderingKey: ORDERING_KEY,
      status: input.status,
      nextAttemptAt: input.nextAttemptAt,
      lockedBy: input.lockedBy,
      lockedUntil: input.lockedUntil,
      completedAt: input.completedAt,
      manualRetryCount: input.manualRetryCount ?? 0,
      createdAt: input.createdAt,
    },
  })).id;
}

test.before(async () => {
  prisma = createTestPrisma();
  lockPrisma = createTestPrisma();
  dispatchPrisma = createTestPrisma();
  workerPrisma = createTestPrisma();
});
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => {
  await clearTestApplicationData(prisma);
  await Promise.all([
    prisma.$disconnect(), lockPrisma.$disconnect(), dispatchPrisma.$disconnect(), workerPrisma.$disconnect(),
  ]);
});

for (const earlier of [
  { status: 'PENDING' as const },
  { status: 'RETRY_WAIT' as const, nextAttemptAt: new Date(NOW.getTime() + 60_000) },
  {
    status: 'PROCESSING' as const,
    lockedBy: 'active-worker',
    lockedUntil: new Date(NOW.getTime() + 60_000),
  },
  { status: 'MANUAL' as const },
]) {
  test(`${earlier.status} earlier delivery blocks a later ordered delivery`, async () => {
    const earlierId = await createDelivery({
      createdAt: new Date(NOW.getTime() - 1_000),
      ...earlier,
    });
    const laterId = await createDelivery({ createdAt: NOW, status: 'PENDING' });
    const store = new EventDeliveryStore(prisma, { leaseSeconds: 60, now: () => NOW });

    const claims = await store.claimBatch({ workerId: 'ordering-worker', limit: 10 });

    if (earlier.status === 'PENDING') {
      assert.deepEqual(claims.map(claim => claim.deliveryId), [ earlierId ]);
    } else {
      assert.equal(claims.length, 0);
    }
    assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: laterId } })).status, 'PENDING');
  });
}

test('only SUCCEEDED unlocks the next handlerCode and orderingKey delivery', async () => {
  await createDelivery({
    createdAt: new Date(NOW.getTime() - 1_000),
    status: 'SUCCEEDED',
    completedAt: new Date(NOW.getTime() - 500),
  });
  const laterId = await createDelivery({ createdAt: NOW, status: 'PENDING' });
  const store = new EventDeliveryStore(prisma, { leaseSeconds: 60, now: () => NOW });

  const claims = await store.claimBatch({ workerId: 'ordering-worker', limit: 10 });

  assert.deepEqual(claims.map(claim => claim.deliveryId), [ laterId ]);
});

test('createdAt ties use source EventLog id instead of reverse delivery ids', async () => {
  const firstId = await createDelivery({
    createdAt: NOW,
    status: 'PENDING',
    eventId: '00000000-0000-4000-8000-000000000001',
    deliveryId: '10000000-0000-4000-8000-000000000002',
  });
  await createDelivery({
    createdAt: NOW,
    status: 'PENDING',
    eventId: '00000000-0000-4000-8000-000000000002',
    deliveryId: '10000000-0000-4000-8000-000000000001',
  });
  const store = new EventDeliveryStore(prisma, { leaseSeconds: 60, now: () => NOW });

  const claims = await store.claimBatch({ workerId: 'ordering-worker', limit: 10 });

  assert.deepEqual(claims.map(claim => claim.deliveryId), [ firstId ]);
  assert.equal(claims[0].eventId, '00000000-0000-4000-8000-000000000001');
});

test('worker closes the visibility gap while a real dispatcher skips a locked earlier event', async () => {
  const earlierOperationId = randomUUID();
  const canonicalOrderingKey = createHash('sha256').update(`ADMIN_OPERATION:${earlierOperationId}`).digest('hex');
  const earlierEventId = '00000000-0000-4000-8000-000000000001';
  await prisma.eventLog.create({
    data: {
      id: earlierEventId,
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: earlierOperationId,
      orderingKey: canonicalOrderingKey,
      payload: {
        operationId: earlierOperationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId: randomUUID(),
        routeUrl: `/security/admin-governance?operationId=${earlierOperationId}`,
      },
      traceId: `worker-gap-${randomUUID()}`,
      occurredAt: NOW,
      createdAt: NOW,
      dispatchedAt: null,
    },
  });
  const laterOperationId = earlierOperationId;
  const laterEventId = '00000000-0000-4000-8000-000000000002';
  await prisma.eventLog.create({
    data: {
      id: laterEventId,
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: laterOperationId,
      orderingKey: canonicalOrderingKey,
      payload: {
        operationId: laterOperationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId: randomUUID(),
        routeUrl: `/security/admin-governance?operationId=${laterOperationId}`,
      },
      traceId: `worker-gap-${randomUUID()}`,
      occurredAt: NOW,
      createdAt: NOW,
      dispatchedAt: null,
    },
  });
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  });
  const dispatcher = new EventDispatcher(
    dispatchPrisma,
    registry,
    new EventHealthService(false),
  );
  const store = new EventDeliveryStore(workerPrisma, { leaseSeconds: 60, now: () => NOW });
  let releaseLock!: () => void;
  let signalLocked!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; });
  const release = new Promise<void>(resolve => { releaseLock = resolve; });
  const lockTransaction = lockPrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "event_log" WHERE "id" = ${earlierEventId} FOR UPDATE`;
    signalLocked();
    await release;
  });
  await locked;
  try {
    assert.deepEqual(await dispatcher.dispatchBatch(10), {
      dispatchedCount: 1,
      deliveryCount: 1,
      manualCount: 0,
    });
    assert.equal(await prisma.eventDelivery.count({ where: { eventId: earlierEventId } }), 0);
    assert.equal(await prisma.eventDelivery.count({ where: { eventId: laterEventId } }), 1);
    assert.equal((await store.claimBatch({ workerId: 'gap-worker', limit: 10 })).length, 0);
  } finally {
    releaseLock();
    await lockTransaction;
  }

  assert.equal((await dispatcher.dispatchBatch(10)).dispatchedCount, 1);
  const earlierDelivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId: earlierEventId } });
  const claims = await store.claimBatch({ workerId: 'gap-worker', limit: 10 });
  assert.deepEqual(claims.map(claim => claim.deliveryId), [ earlierDelivery.id ]);
});

test('successful manual requeue clears the MANUAL ordering block for the next delivery', async () => {
  const earlierId = await createDelivery({
    createdAt: new Date(NOW.getTime() - 1_000),
    status: 'MANUAL',
  });
  const laterId = await createDelivery({ createdAt: NOW, status: 'PENDING' });
  await prisma.eventDelivery.update({
    where: { id: earlierId },
    data: { status: 'PENDING', manualRetryCount: { increment: 1 }, version: { increment: 1 } },
  });
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    handler: { async handle() {} },
  });
  const worker = new EventWorker({
    prisma,
    dispatcher: {
      async dispatchBatch() { return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 }; },
    },
    registry,
    health: new EventHealthService(false),
    workerId: 'manual-requeue-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => NOW,
  });

  assert.equal((await worker.tick()).succeeded, 1);
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: earlierId } })).status, 'SUCCEEDED');
  assert.equal((await worker.tick()).succeeded, 1);
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: laterId } })).status, 'SUCCEEDED');
});
