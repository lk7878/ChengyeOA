import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createEventServices } from '../../app/application/events/event-services-factory';
import { EventWorkerRuntimeStatusStore } from '../../app/application/events/event-worker-runtime-status-store';
import {
  advanceInjectedClockWaves,
  assertEventObservabilityRehearsalEnvironment,
} from '../../scripts/rehearsal/rehearse-event-observability';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const EVENT_COUNT = 200;
const WORKER_COUNT = 4;
const WAVE_COUNT = 60;
const CONFIG = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 50,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});

test('four independent clients converge 200 events over 60 injected one-second waves', async () => {
  const target = assertEventObservabilityRehearsalEnvironment(process.env);
  const seed = createTestPrisma();
  const clients = Array.from({ length: WORKER_COUNT }, () => (
    new PrismaClient({ datasources: { db: { url: target.databaseUrl } } })
  ));
  const clock = { value: new Date('2026-07-24T02:00:00.000Z') };
  const eventIds: string[] = [];
  const operationIds: string[] = [];
  try {
    await clearTestApplicationData(seed);
    const requester = await seed.user.create({ data: {
      username: `spec008.load.${randomUUID()}`,
      password: 'unused',
    } });
    const operations = Array.from({ length: EVENT_COUNT }, (_, index) => {
      const id = randomUUID();
      operationIds.push(id);
      return {
        id,
        operationNo: `SPEC008-LOAD-${index}-${randomUUID()}`,
        operationType: 'SYSTEM_ADMIN_GRANT' as const,
        riskLevel: 'HIGH' as const,
        reviewMode: 'PRE' as const,
        status: 'REJECTED' as const,
        requesterUserId: requester.id,
        targetType: 'USER',
        targetId: randomUUID(),
        reason: 'controlled-load-reason',
        payloadSnapshot: {},
        payloadHash: 'b'.repeat(64),
        expectedTargetVersion: 1,
        idempotencyKey: randomUUID(),
      };
    });
    await seed.adminOperation.createMany({ data: operations });
    await seed.eventLog.createMany({ data: operationIds.map(operationId => {
      const id = randomUUID();
      eventIds.push(id);
      return {
        id,
        eventType: 'admin.operation.reviewed',
        eventVersion: 1,
        sourceModule: 'ADMIN_GOVERNANCE',
        objectType: 'ADMIN_OPERATION',
        objectId: operationId,
        orderingKey: createHash('sha256').update(`ADMIN_OPERATION:${operationId}`).digest('hex'),
        payload: {
          operationId,
          operationType: 'SYSTEM_ADMIN_GRANT',
          riskLevel: 'HIGH',
          decision: 'REJECT',
          status: 'REJECTED',
          requesterUserId: requester.id,
          routeUrl: `/security/admin-governance?operationId=${operationId}`,
        },
        traceId: randomUUID(),
        occurredAt: clock.value,
        createdAt: clock.value,
      };
    }) });

    const runtimeStatus = new EventWorkerRuntimeStatusStore(seed, {
      heartbeatSeconds: 10,
      now: () => clock.value,
    });
    await runtimeStatus.markStarting(clock.value);
    const startingVersion = (await runtimeStatus.read())?.version;
    assert.equal(typeof startingVersion, 'number');
    const workers = clients.map((client, index) => createEventServices(client, CONFIG, {
      workerId: `spec008-load-worker-${index + 1}`,
    }).worker);
    const totals = { claimed: 0, succeeded: 0 };

    await advanceInjectedClockWaves({
      waveCount: WAVE_COUNT,
      stepMilliseconds: 1_000,
      now: () => clock.value,
      advance: milliseconds => { clock.value = new Date(clock.value.getTime() + milliseconds); },
      runWave: async () => {
        await runtimeStatus.recordHeartbeat(clock.value);
        const results = await Promise.all(workers.map(worker => worker.tick()));
        totals.claimed += results.reduce((sum, result) => sum + result.claimed, 0);
        totals.succeeded += results.reduce((sum, result) => sum + result.succeeded, 0);
      },
    });

    assert.deepEqual(totals, { claimed: EVENT_COUNT, succeeded: EVENT_COUNT });
    assert.equal(await seed.eventLog.count({ where: { id: { in: eventIds }, dispatchedAt: null } }), 0);
    const deliveries = await seed.eventDelivery.findMany({
      where: { eventId: { in: eventIds } },
      select: { id: true, eventId: true, status: true },
    });
    assert.equal(deliveries.length, EVENT_COUNT);
    assert.equal(new Set(deliveries.map(item => item.eventId)).size, EVENT_COUNT);
    assert.equal(deliveries.every(item => item.status === 'SUCCEEDED'), true);
    const logs = await seed.eventHandlerLog.findMany({
      where: { deliveryId: { in: deliveries.map(item => item.id) }, outcome: 'SUCCEEDED' },
      select: { deliveryId: true },
    });
    assert.equal(logs.length, EVENT_COUNT);
    assert.equal(new Set(logs.map(item => item.deliveryId)).size, EVENT_COUNT);
    const notifications = await seed.notification.findMany({
      where: { relatedId: { in: operationIds } },
      select: { relatedId: true, deduplicationKey: true },
    });
    assert.equal(notifications.length, EVENT_COUNT);
    assert.equal(new Set(notifications.map(item => item.relatedId)).size, EVENT_COUNT);
    assert.equal(new Set(notifications.map(item => item.deduplicationKey)).size, EVENT_COUNT);
    assert.equal((await runtimeStatus.read())?.version, startingVersion! + 6);
  } finally {
    await Promise.allSettled(clients.map(client => client.$disconnect()));
    await clearTestApplicationData(seed);
    await seed.$disconnect();
  }
});
