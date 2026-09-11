import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import {
  ClaimedEventDelivery,
  EventDeliveryStore,
  EventHandlerInvocationError,
} from '../../app/application/events/event-delivery-store';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import {
  EventHandler,
  EventWorker,
  EventWorkerScheduler,
  retryDecisionForFailure,
} from '../../app/application/events/event-worker';
import { PermanentEventError, RetryableEventError } from '../../app/domain/events/event-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const PILOT_HANDLER = 'ADMIN_OPERATION_REVIEWED_NOTIFICATION';
const NOOP_DISPATCHER = {
  async dispatchBatch() {
    return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 };
  },
};
let prisma: PrismaClient;
let now: Date;

async function createDelivery(overrides: {
  attemptCount?: number;
  manualRetryCount?: number;
  orderingKey?: string;
} = {}): Promise<string> {
  const operationId = randomUUID();
  const orderingKey = overrides.orderingKey ?? 'd'.repeat(64);
  const event = await prisma.eventLog.create({
    data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: operationId,
      orderingKey,
      payload: {
        operationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId: randomUUID(),
        routeUrl: `/security/admin-governance?operationId=${operationId}`,
      },
      traceId: `worker-outcome-${randomUUID()}`,
      occurredAt: now,
      dispatchedAt: now,
    },
  });
  const subscription = await prisma.eventSubscription.findUniqueOrThrow({
    where: { code: 'admin-operation-reviewed-notification-v1' },
  });
  return (await prisma.eventDelivery.create({
    data: {
      eventId: event.id,
      subscriptionId: subscription.id,
      handlerCode: PILOT_HANDLER,
      orderingKey,
      attemptCount: overrides.attemptCount ?? 0,
      manualRetryCount: overrides.manualRetryCount ?? 0,
    },
  })).id;
}

function registryWith(handler: EventHandler): EventHandlerRegistry {
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: PILOT_HANDLER,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    handler,
  });
  return registry;
}

function workerWith(handler: EventHandler, health = new EventHealthService(false)): EventWorker {
  return new EventWorker({
    prisma,
    dispatcher: NOOP_DISPATCHER,
    registry: registryWith(handler),
    health,
    workerId: 'outcome-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
  });
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  now = new Date('2026-07-22T10:00:00.000Z');
  await clearTestApplicationData(prisma);
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('uses the fixed retry schedule and then requires manual handling', () => {
  assert.deepEqual(retryDecisionForFailure(1, 0), { kind: 'RETRY_WAIT', delayMs: 15_000 });
  assert.deepEqual(retryDecisionForFailure(2, 0), { kind: 'RETRY_WAIT', delayMs: 300_000 });
  assert.deepEqual(retryDecisionForFailure(3, 0), { kind: 'RETRY_WAIT', delayMs: 3_600_000 });
  assert.deepEqual(retryDecisionForFailure(4, 0), { kind: 'RETRY_WAIT', delayMs: 21_600_000 });
  assert.deepEqual(retryDecisionForFailure(5, 0), { kind: 'MANUAL' });
  assert.deepEqual(retryDecisionForFailure(1, 1), { kind: 'MANUAL' });
});

test('includes MANUAL evidence created by its internal dispatcher in the tick result', async () => {
  const worker = new EventWorker({
    prisma,
    dispatcher: {
      async dispatchBatch() {
        return { dispatchedCount: 1, deliveryCount: 1, manualCount: 1 };
      },
    },
    deliveryStore: { async claimBatch() { return []; } },
    registry: new EventHandlerRegistry(),
    health: new EventHealthService(false),
    workerId: 'dispatch-manual-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
  });

  assert.deepEqual(await worker.tick(), {
    dispatched: 1, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 1, leaseLost: 0,
  });
});

test('commits handler business writes, SUCCEEDED log, and delivery success atomically', async () => {
  const deliveryId = await createDelivery();
  const handler: EventHandler = {
    async handle(tx, context) {
      await tx.notification.create({
        data: {
          userId: randomUUID(),
          type: 'SYSTEM',
          title: 'test',
          content: 'test',
          deduplicationKey: `worker-success:${context.deliveryId}`,
        },
      });
    },
  };

  const result = await workerWith(handler).tick();

  assert.deepEqual(result, {
    dispatched: 0, claimed: 1, succeeded: 1, retryScheduled: 0, manual: 0, leaseLost: 0,
  });
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'SUCCEEDED');
  assert.equal(delivery.lockedBy, null);
  assert.equal(delivery.lockedUntil, null);
  assert.equal(delivery.nextAttemptAt, null);
  assert.equal(delivery.lastErrorCode, null);
  assert.equal(delivery.lastErrorReference, null);
  assert.equal(delivery.version, 2);
  assert.equal(delivery.completedAt?.toISOString(), now.toISOString());
  assert.equal(await prisma.notification.count({ where: { deduplicationKey: `worker-success:${deliveryId}` } }), 1);
  const log = await prisma.eventHandlerLog.findFirstOrThrow({ where: { deliveryId } });
  assert.equal(log.attemptNumber, 1);
  assert.equal(log.outcome, 'SUCCEEDED');
  assert.equal(log.errorCode, null);
  assert.equal(log.durationMs, 0);
});

test('rolls back every handler business write when its lease expires before commit', async () => {
  const deliveryId = await createDelivery();
  const handler: EventHandler = {
    async handle(tx, context) {
      await tx.notification.create({
        data: {
          userId: randomUUID(),
          type: 'SYSTEM',
          title: 'must rollback',
          content: 'must rollback',
          deduplicationKey: `worker-lease-lost:${context.deliveryId}`,
        },
      });
      now = new Date(now.getTime() + 60_001);
    },
  };

  const result = await workerWith(handler).tick();

  assert.equal(result.leaseLost, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(await prisma.notification.count({ where: { deduplicationKey: `worker-lease-lost:${deliveryId}` } }), 0);
  assert.equal(await prisma.eventHandlerLog.count({ where: { deliveryId } }), 0);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'PROCESSING');
  assert.equal(delivery.lockedBy, 'outcome-worker');
});

test('failure settlement changes nothing after ownership lease expiration', async () => {
  const deliveryId = await createDelivery();
  const secretKey = `worker-failed-after-lease:${deliveryId}`;
  const handler: EventHandler = {
    async handle(tx) {
      await tx.notification.create({
        data: {
          userId: randomUUID(),
          type: 'SYSTEM',
          title: 'must rollback',
          content: 'must rollback',
          deduplicationKey: secretKey,
        },
      });
      now = new Date(now.getTime() + 60_001);
      throw new RetryableEventError('TOO_LATE');
    },
  };

  const result = await workerWith(handler).tick();

  assert.equal(result.leaseLost, 1);
  assert.equal(result.retryScheduled, 0);
  assert.equal(await prisma.notification.count({ where: { deduplicationKey: secretKey } }), 0);
  assert.equal(await prisma.eventHandlerLog.count({ where: { deliveryId } }), 0);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'PROCESSING');
  assert.equal(delivery.lastErrorCode, null);
  assert.equal(delivery.version, 1);
});

test('applies all retry delays and creates one immutable log for each attempt', async () => {
  const deliveryId = await createDelivery();
  const handler: EventHandler = {
    async handle() { throw new RetryableEventError('TRANSIENT_SOURCE'); },
  };
  const worker = workerWith(handler);
  const expectedDelays = [ 15_000, 300_000, 3_600_000, 21_600_000 ];

  for (let index = 0; index < expectedDelays.length; index += 1) {
    const result = await worker.tick();
    assert.equal(result.retryScheduled, 1);
    const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    assert.equal(delivery.status, 'RETRY_WAIT');
    assert.equal(delivery.attemptCount, index + 1);
    assert.equal(delivery.nextAttemptAt?.getTime(), now.getTime() + expectedDelays[index]);
    assert.equal(delivery.lockedBy, null);
    assert.equal(delivery.lockedUntil, null);
    assert.equal(delivery.completedAt, null);
    now = new Date(delivery.nextAttemptAt!.getTime());
  }

  const fifth = await worker.tick();
  assert.equal(fifth.manual, 1);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.attemptCount, 5);
  assert.equal(delivery.nextAttemptAt, null);
  assert.equal(delivery.lastErrorCode, 'TRANSIENT_SOURCE');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  const logs = await prisma.eventHandlerLog.findMany({
    where: { deliveryId }, orderBy: { attemptNumber: 'asc' },
  });
  assert.deepEqual(logs.map(log => log.attemptNumber), [ 1, 2, 3, 4, 5 ]);
  assert.deepEqual(logs.map(log => log.outcome), [
    'RETRY_SCHEDULED', 'RETRY_SCHEDULED', 'RETRY_SCHEDULED', 'RETRY_SCHEDULED', 'MANUAL_REQUIRED',
  ]);
  assert.ok(logs.every(log => log.durationMs >= 0));
});

test('PermanentEventError enters MANUAL immediately', async () => {
  const deliveryId = await createDelivery();
  const worker = workerWith({
    async handle() { throw new PermanentEventError('SOURCE_INVALID'); },
  });

  const result = await worker.tick();

  assert.equal(result.manual, 1);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.lastErrorCode, 'SOURCE_INVALID');
});

test('unknown exceptions persist only EVENT_HANDLER_UNKNOWN and a random reference', async () => {
  const secret = `postgresql://private:${randomUUID()}@host/database?token=private`;
  const deliveryId = await createDelivery();
  const worker = workerWith({ async handle() { throw new Error(secret); } });

  const result = await worker.tick();

  assert.equal(result.retryScheduled, 1);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const logs = await prisma.eventHandlerLog.findMany({ where: { deliveryId } });
  assert.equal(delivery.lastErrorCode, 'EVENT_HANDLER_UNKNOWN');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(logs[0].errorCode, 'EVENT_HANDLER_UNKNOWN');
  assert.equal(logs[0].errorReference, delivery.lastErrorReference);
  assert.doesNotMatch(JSON.stringify({ delivery, logs }), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('missing executable handler enters safe MANUAL without raw registry data', async () => {
  const deliveryId = await createDelivery();
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: PILOT_HANDLER,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  });
  const worker = new EventWorker({
    prisma,
    dispatcher: NOOP_DISPATCHER,
    registry,
    health: new EventHealthService(false),
    workerId: 'missing-handler-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
  });

  const result = await worker.tick();

  assert.equal(result.manual, 1);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const log = await prisma.eventHandlerLog.findFirstOrThrow({ where: { deliveryId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.lastErrorCode, 'EVENT_HANDLER_UNKNOWN');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(log.outcome, 'MANUAL_REQUIRED');
  assert.equal(log.errorCode, 'EVENT_HANDLER_UNKNOWN');
  assert.equal(log.errorReference, delivery.lastErrorReference);
});

test('a failed manual retry returns immediately to MANUAL without clearing history', async () => {
  const deliveryId = await createDelivery({ attemptCount: 5, manualRetryCount: 2 });
  const worker = workerWith({
    async handle() { throw new RetryableEventError('STILL_UNAVAILABLE'); },
  });

  const result = await worker.tick();

  assert.equal(result.manual, 1);
  const delivery = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.attemptCount, 6);
  assert.equal(delivery.manualRetryCount, 2);
  assert.equal(delivery.nextAttemptAt, null);
});

class FakeScheduler implements EventWorkerScheduler {
  readonly queued: Array<{ callback: () => void | Promise<void>; delayMs: number; unrefCalled: boolean; cleared: boolean }> = [];

  setTimeout(callback: () => void | Promise<void>, delayMs: number) {
    const item = { callback, delayMs, unrefCalled: false, cleared: false };
    this.queued.push(item);
    return {
      unref: () => { item.unrefCalled = true; },
      token: item,
    };
  }

  clearTimeout(handle: { token?: unknown }): void {
    const item = handle.token as FakeScheduler['queued'][number];
    if (item) item.cleared = true;
  }

  async runNext(): Promise<void> {
    const item = this.queued.find(entry => !entry.cleared);
    assert.ok(item, 'expected a scheduled callback');
    item.cleared = true;
    await item.callback();
  }

  activeDelays(): number[] {
    return this.queued.filter(item => !item.cleared).map(item => item.delayMs);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function lifecycleWorker(options: {
  scheduler: FakeScheduler;
  dispatcher?: { dispatchBatch(limit: number): Promise<{ dispatchedCount: number; deliveryCount: number; manualCount: number }> };
  deliveryStore?: {
    claimBatch(input: { workerId: string; limit: number }): Promise<never[]>;
  };
  health?: EventHealthService;
  waitForTimeout?: (timeoutMs: number) => Promise<void>;
  isDatabaseError?: (error: unknown) => boolean;
  runtimeStatus?: { recordHeartbeat(at?: Date): Promise<void> };
}): EventWorker {
  return new EventWorker({
    prisma,
    dispatcher: options.dispatcher ?? NOOP_DISPATCHER,
    deliveryStore: options.deliveryStore,
    registry: new EventHandlerRegistry(),
    health: options.health ?? new EventHealthService(true),
    workerId: 'lifecycle-worker',
    config: { pollMs: 250, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
    scheduler: options.scheduler,
    waitForTimeout: options.waitForTimeout,
    isDatabaseError: options.isDatabaseError,
    runtimeStatus: options.runtimeStatus,
  });
}

test('manual ticks never claim background liveness and a complete scheduled tick records one heartbeat', async () => {
  const scheduler = new FakeScheduler();
  const heartbeatCalls: Date[] = [];
  const worker = lifecycleWorker({
    scheduler,
    runtimeStatus: {
      async recordHeartbeat(at) { heartbeatCalls.push(new Date(at!)); },
    },
  });

  await worker.tick();
  assert.deepEqual(heartbeatCalls, [], 'manual drain tick must not claim background liveness');

  worker.start();
  await scheduler.runNext();
  assert.deepEqual(heartbeatCalls.map(value => value.toISOString()), [ now.toISOString() ]);
  await worker.stop(0);
});

test('failed background ticks do not write a successful heartbeat', async () => {
  class DatabaseFailure extends Error {}
  const failures: Array<'database' | 'handler'> = [ 'database', 'handler' ];

  for (const failure of failures) {
    const scheduler = new FakeScheduler();
    const heartbeatCalls: Date[] = [];
    const worker = lifecycleWorker({
      scheduler,
      dispatcher: failure === 'database'
        ? { async dispatchBatch() { throw new DatabaseFailure('private database failure'); } }
        : NOOP_DISPATCHER,
      deliveryStore: failure === 'handler'
        ? {
          async claimBatch() { throw new TypeError('uncaught handler execution failure'); },
        }
        : undefined,
      isDatabaseError: error => error instanceof DatabaseFailure,
      runtimeStatus: {
        async recordHeartbeat(at) { heartbeatCalls.push(new Date(at!)); },
      },
    });

    worker.start();
    await scheduler.runNext();

    assert.deepEqual(heartbeatCalls, [], `${failure} failure must not claim background liveness`);
    assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
    await worker.stop(0);
  }
});

test('repeated in-flight ticks share one completion and write one heartbeat', async () => {
  const scheduler = new FakeScheduler();
  const gate = deferred<never[]>();
  const heartbeatCalls: Date[] = [];
  const worker = lifecycleWorker({
    scheduler,
    deliveryStore: { async claimBatch() { return gate.promise; } },
    runtimeStatus: {
      async recordHeartbeat(at) { heartbeatCalls.push(new Date(at!)); },
    },
  });

  worker.start();
  const scheduled = scheduler.runNext();
  await new Promise(resolve => setImmediate(resolve));
  const repeated = worker.tick();
  gate.resolve([]);
  await Promise.all([ scheduled, repeated ]);

  assert.deepEqual(heartbeatCalls.map(value => value.toISOString()), [ now.toISOString() ]);
  await worker.stop(0);
});

test('heartbeat database failures use the existing safe database backoff path', async () => {
  class HeartbeatDatabaseFailure extends Error {}
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  let heartbeatCalls = 0;
  const worker = lifecycleWorker({
    scheduler,
    health,
    isDatabaseError: error => error instanceof HeartbeatDatabaseFailure,
    runtimeStatus: {
      async recordHeartbeat() {
        heartbeatCalls += 1;
        throw new HeartbeatDatabaseFailure('postgresql://private:secret@db/internal');
      },
    },
  });

  worker.start();
  await scheduler.runNext();

  assert.equal(heartbeatCalls, 1);
  assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
  const snapshot = health.workerSnapshot();
  assert.equal(snapshot.status, 'degraded');
  assert.equal(snapshot.consecutiveDatabaseFailures, 1);
  assert.equal(snapshot.lastErrorCode, 'EVENT_WORKER_DATABASE_FAILURE');
  assert.doesNotMatch(JSON.stringify(snapshot), /postgresql:|private|secret|internal/i);
  await worker.stop(0);
});

test('consecutive heartbeat database failures accumulate until a persisted heartbeat succeeds', async () => {
  class HeartbeatDatabaseFailure extends Error {}
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  let attempts = 0;
  const worker = lifecycleWorker({
    scheduler,
    health,
    isDatabaseError: error => error instanceof HeartbeatDatabaseFailure,
    runtimeStatus: {
      async recordHeartbeat() {
        attempts += 1;
        if (attempts <= 3) throw new HeartbeatDatabaseFailure('heartbeat database unavailable');
      },
    },
  });

  worker.start();
  const failureSnapshots: Array<ReturnType<EventHealthService['workerSnapshot']>> = [];
  for (const delay of [ 1_000, 2_000, 5_000 ]) {
    await scheduler.runNext();
    failureSnapshots.push(health.workerSnapshot());
    assert.deepEqual(scheduler.activeDelays(), [ delay ]);
    now = new Date(now.getTime() + 1_000);
  }

  assert.deepEqual(
    failureSnapshots.map(snapshot => snapshot.consecutiveDatabaseFailures),
    [ 1, 2, 3 ],
  );
  assert.ok(failureSnapshots.every(snapshot => snapshot.lastSuccessfulTickAt === null));

  await scheduler.runNext();

  assert.equal(attempts, 4);
  assert.deepEqual(scheduler.activeDelays(), [ 250 ]);
  const recovered = health.workerSnapshot();
  assert.equal(recovered.consecutiveDatabaseFailures, 0);
  assert.equal(recovered.lastSuccessfulTickAt?.toISOString(), now.toISOString());
  await worker.stop(0);
});

test('an unhandled error after a real claim does not write a heartbeat', async () => {
  const scheduler = new FakeScheduler();
  const heartbeatCalls: Date[] = [];
  const claim = fakeClaim(60);
  const worker = new EventWorker({
    prisma,
    dispatcher: NOOP_DISPATCHER,
    deliveryStore: {
      async claimBatch() { return [ claim ]; },
      async executeHandler() { throw new TypeError('unhandled handler execution failure'); },
      async recordFailure() { return { kind: 'MANUAL' } as const; },
    },
    registry: registryWith({ async handle() {} }),
    health: new EventHealthService(true),
    workerId: 'unhandled-claim-worker',
    config: { pollMs: 250, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
    scheduler,
    isDatabaseError: () => false,
    runtimeStatus: {
      async recordHeartbeat(at) { heartbeatCalls.push(new Date(at!)); },
    },
  });

  worker.start();
  await scheduler.runNext();

  assert.deepEqual(heartbeatCalls, []);
  assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
  await worker.stop(0);
});

test('calling start twice before stop creates only one scheduling chain', async () => {
  const scheduler = new FakeScheduler();
  const worker = lifecycleWorker({ scheduler });

  worker.start();
  worker.start();

  assert.deepEqual(scheduler.activeDelays(), [ 0 ]);
  assert.equal(scheduler.queued.length, 1);
  await worker.stop(0);
});

test('start uses unref timers and never overlaps ticks', async () => {
  const scheduler = new FakeScheduler();
  const gate = deferred<never[]>();
  let claims = 0;
  const worker = lifecycleWorker({
    scheduler,
    deliveryStore: {
      claimBatch: async () => { claims += 1; return gate.promise; },
    },
  });

  worker.start();
  assert.deepEqual(scheduler.activeDelays(), [ 0 ]);
  assert.equal(scheduler.queued[0].unrefCalled, true);
  const firstTick = scheduler.runNext();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(claims, 1);
  assert.deepEqual(scheduler.activeDelays(), []);
  gate.resolve([]);
  await firstTick;
  assert.equal(claims, 1);
  assert.deepEqual(scheduler.activeDelays(), [ 250 ]);
  await worker.stop(0);
});

test('database failures back off 1/2/5/10/30 seconds, recover, and reset', async () => {
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  let failuresRemaining = 5;
  const secret = 'database-password-must-not-enter-health';
  const dispatcher = {
    async dispatchBatch() {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error(secret);
      }
      return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 };
    },
  };
  const worker = lifecycleWorker({ scheduler, health, dispatcher, isDatabaseError: () => true });

  worker.start();
  for (const delay of [ 1_000, 2_000, 5_000, 10_000, 30_000 ]) {
    await scheduler.runNext();
    assert.deepEqual(scheduler.activeDelays(), [ delay ]);
  }
  let snapshot = health.workerSnapshot();
  assert.equal(snapshot.status, 'degraded');
  assert.equal(snapshot.consecutiveDatabaseFailures, 5);
  assert.equal(snapshot.lastErrorCode, 'EVENT_WORKER_DATABASE_FAILURE');
  assert.match(snapshot.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(snapshot), /database-password/);

  await scheduler.runNext();
  assert.deepEqual(scheduler.activeDelays(), [ 250 ]);
  snapshot = health.workerSnapshot();
  assert.equal(snapshot.status, 'healthy');
  assert.equal(snapshot.consecutiveDatabaseFailures, 0);
  assert.equal(snapshot.lastSuccessfulTickAt?.toISOString(), now.toISOString());

  failuresRemaining = 1;
  await scheduler.runNext();
  assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
  await worker.stop(0);
});

test('non-database loop failures still back off without falsifying database health', async () => {
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  const worker = lifecycleWorker({
    scheduler,
    health,
    dispatcher: {
      async dispatchBatch() { throw new TypeError('bad stored payload or programming error'); },
    },
    isDatabaseError: () => false,
  });

  worker.start();
  await scheduler.runNext();

  assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
  assert.deepEqual(health.workerSnapshot(), {
    status: 'healthy',
    workerEnabled: true,
    lastSuccessfulTickAt: null,
    lastDatabaseFailureAt: null,
    consecutiveDatabaseFailures: 0,
    databaseFailureTotal: 0,
    lastErrorCode: null,
    lastErrorReference: null,
  });
  await worker.stop(0);
});

test('non-database failures do not advance the classified database backoff sequence', async () => {
  class DatabaseFailure extends Error {}
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  const outcomes: Array<'non-db' | 'db' | 'success'> = [
    'non-db', 'db', 'db', 'success', 'db',
  ];
  const worker = lifecycleWorker({
    scheduler,
    health,
    dispatcher: {
      async dispatchBatch() {
        const outcome = outcomes.shift();
        if (outcome === 'non-db') throw new TypeError('bad payload');
        if (outcome === 'db') throw new DatabaseFailure('database unavailable');
        return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 };
      },
    },
    isDatabaseError: error => error instanceof DatabaseFailure,
  });

  worker.start();
  for (const expectedDelay of [ 1_000, 1_000, 2_000, 250, 1_000 ]) {
    await scheduler.runNext();
    assert.deepEqual(scheduler.activeDelays(), [ expectedDelay ]);
  }
  assert.equal(health.workerSnapshot().consecutiveDatabaseFailures, 1);
  assert.equal(health.workerSnapshot().databaseFailureTotal, 3);
  await worker.stop(0);
});

test('handler-originated classified database failure enters backoff without unknown persistence', async () => {
  class HandlerDatabaseFailure extends Error {}
  const databaseFailure = new HandlerDatabaseFailure('private database connection failure');
  const scheduler = new FakeScheduler();
  const health = new EventHealthService(true);
  const claim = fakeClaim(60);
  let failureSettlements = 0;
  const registry = registryWith({ async handle() {} });
  const worker = new EventWorker({
    prisma,
    dispatcher: NOOP_DISPATCHER,
    deliveryStore: {
      async claimBatch() { return [ claim ]; },
      async executeHandler() { throw new EventHandlerInvocationError(databaseFailure); },
      async recordFailure() {
        failureSettlements += 1;
        return { kind: 'MANUAL' } as const;
      },
    },
    registry,
    health,
    workerId: 'handler-db-worker',
    config: { pollMs: 250, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
    scheduler,
    isDatabaseError: error => error instanceof HandlerDatabaseFailure,
  });

  worker.start();
  await scheduler.runNext();

  assert.deepEqual(scheduler.activeDelays(), [ 1_000 ]);
  assert.equal(failureSettlements, 0);
  assert.equal(health.workerSnapshot().consecutiveDatabaseFailures, 1);
  assert.equal(health.workerSnapshot().lastErrorCode, 'EVENT_WORKER_DATABASE_FAILURE');
  assert.doesNotMatch(JSON.stringify(health.workerSnapshot()), /private database connection failure/);
  await worker.stop(0);
});

test('stop cancels future claims and rejects when the supplied timeout expires', async () => {
  const scheduler = new FakeScheduler();
  const gate = deferred<never[]>();
  const waited: number[] = [];
  let claims = 0;
  const worker = lifecycleWorker({
    scheduler,
    deliveryStore: {
      claimBatch: async () => { claims += 1; return gate.promise; },
    },
    waitForTimeout: async timeoutMs => { waited.push(timeoutMs); },
  });
  worker.start();
  const running = scheduler.runNext();
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(worker.stop(17), /Event worker shutdown timed out/);

  assert.deepEqual(waited, [ 17 ]);
  assert.equal(claims, 1);
  assert.deepEqual(scheduler.activeDelays(), []);
  assert.equal((await worker.tick()).claimed, 0);
  gate.resolve([]);
  await running;
  assert.deepEqual(scheduler.activeDelays(), []);
});

test('a worker remains terminated after stop timeout and cannot revive its old in-flight tick', async () => {
  const scheduler = new FakeScheduler();
  const gate = deferred<never[]>();
  const heartbeatCalls: Date[] = [];
  const worker = lifecycleWorker({
    scheduler,
    deliveryStore: { async claimBatch() { return gate.promise; } },
    waitForTimeout: async () => undefined,
    runtimeStatus: {
      async recordHeartbeat(at) { heartbeatCalls.push(new Date(at!)); },
    },
  });
  worker.start();
  const oldScheduledTick = scheduler.runNext();
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(worker.stop(17), /Event worker shutdown timed out/);
  worker.start();

  assert.deepEqual(scheduler.activeDelays(), [], 'a timed-out worker instance must remain terminated');
  gate.resolve([]);
  await oldScheduledTick;
  assert.deepEqual(heartbeatCalls, []);
  assert.deepEqual(scheduler.activeDelays(), []);
});

test('worker validates poll, batch, and lease configuration boundaries', () => {
  const scheduler = new FakeScheduler();
  const base = {
    prisma,
    dispatcher: NOOP_DISPATCHER,
    registry: new EventHandlerRegistry(),
    health: new EventHealthService(false),
    workerId: 'config-worker',
    scheduler,
  };
  assert.throws(() => new EventWorker({ ...base, config: { pollMs: 249, batchSize: 25, leaseSeconds: 60 } }), /poll.*250.*60000/i);
  assert.throws(() => new EventWorker({ ...base, config: { pollMs: 250, batchSize: 201, leaseSeconds: 60 } }), /batch.*1.*200/i);
  assert.throws(() => new EventWorker({ ...base, config: { pollMs: 250, batchSize: 25, leaseSeconds: 29 } }), /lease.*30.*600/i);
});

type CapturedTransactionOptions = { maxWait?: number; timeout?: number } | undefined;

function transactionSpyPrisma(
  calls: CapturedTransactionOptions[],
  ownershipRows: Array<{ id: string }> = [],
): PrismaClient {
  const tx = {
    $queryRaw: async () => ownershipRows,
    eventHandlerLog: { create: async () => ({}) },
    eventDelivery: { updateMany: async () => ({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
  return {
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ): Promise<T> => {
      calls.push(options);
      return callback(tx);
    },
  } as unknown as PrismaClient;
}

function fakeClaim(leaseSeconds: number): ClaimedEventDelivery {
  return {
    deliveryId: randomUUID(),
    eventId: randomUUID(),
    subscriptionId: randomUUID(),
    handlerCode: PILOT_HANDLER,
    orderingKey: 'e'.repeat(64),
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    payload: {},
    traceId: 'transaction-options-test',
    attemptNumber: 1,
    manualRetryCount: 0,
    version: 1,
    workerId: 'timeout-worker',
    startedAt: now,
    lockedUntil: new Date(now.getTime() + leaseSeconds * 1_000),
  };
}

test('passes explicit short transaction options when claiming', async () => {
  const calls: CapturedTransactionOptions[] = [];
  const store = new EventDeliveryStore(transactionSpyPrisma(calls), { leaseSeconds: 60, now: () => now });

  assert.deepEqual(await store.claimBatch({ workerId: 'timeout-worker', limit: 1 }), []);
  assert.ok(calls[0]?.maxWait);
  assert.ok(calls[0]?.timeout);
  assert.ok((calls[0]?.timeout ?? Infinity) <= 10_000);
});

test('passes explicit short transaction options when recording failure', async () => {
  const calls: CapturedTransactionOptions[] = [];
  const claim = fakeClaim(60);
  const store = new EventDeliveryStore(transactionSpyPrisma(calls, [{ id: claim.deliveryId }]), {
    leaseSeconds: 60,
    now: () => now,
  });

  assert.equal((await store.recordFailure(claim, {
    errorCode: 'SAFE_FAILURE',
    errorReference: randomUUID(),
    decision: { kind: 'MANUAL' },
  })).kind, 'MANUAL');
  assert.ok(calls[0]?.maxWait);
  assert.ok((calls[0]?.timeout ?? Infinity) <= 10_000);
});

for (const leaseSeconds of [ 60, 30 ]) {
  test(`derives handler transaction timeout below a ${leaseSeconds}-second remaining lease`, async () => {
    const calls: CapturedTransactionOptions[] = [];
    const claim = fakeClaim(leaseSeconds);
    const store = new EventDeliveryStore(transactionSpyPrisma(calls, [{ id: claim.deliveryId }]), {
      leaseSeconds,
      now: () => now,
    });

    assert.equal((await store.executeHandler(claim, { async handle() {} })).kind, 'SUCCEEDED');
    assert.ok(calls[0]?.maxWait);
    assert.ok((calls[0]?.timeout ?? 0) > 5_000);
    assert.ok((calls[0]?.timeout ?? Infinity) < leaseSeconds * 1_000);
  });
}

test('does not start a handler transaction when remaining lease budget is unsafe', async () => {
  const claim = fakeClaim(30);
  now = new Date(claim.lockedUntil.getTime() - 1_500);
  const calls: CapturedTransactionOptions[] = [];
  const store = new EventDeliveryStore(transactionSpyPrisma(calls, [{ id: claim.deliveryId }]), {
    leaseSeconds: 30,
    now: () => now,
  });
  let handlerCalled = false;

  const result = await store.executeHandler(claim, {
    async handle() { handlerCalled = true; },
  });

  assert.equal(result.kind, 'LEASE_LOST');
  assert.equal(handlerCalled, false);
  assert.equal(calls.length, 0);
});
