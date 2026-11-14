import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { EventDispatcher } from '../../app/application/events/event-dispatcher';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const PILOT_HANDLER = 'ADMIN_OPERATION_REVIEWED_NOTIFICATION';
const QUARANTINE_HANDLER = 'EVENT_DISPATCH_QUARANTINE';
let prisma: PrismaClient;

function registryWithPilot(): EventHandlerRegistry {
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: PILOT_HANDLER,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  });
  registry.validate();
  return registry;
}

async function createEvent(
  payloadOverrides: Record<string, unknown> = {},
  envelopeOverrides: Record<string, unknown> = {},
): Promise<string> {
  const operationId = randomUUID();
  const requesterUserId = randomUUID();
  const event = await prisma.eventLog.create({
    data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 1,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: operationId,
      orderingKey: createHash('sha256').update(`ADMIN_OPERATION:${operationId}`, 'utf8').digest('hex'),
      payload: {
        operationId,
        operationType: 'SYSTEM_ADMIN_GRANT',
        riskLevel: 'HIGH',
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId,
        routeUrl: `/security/admin-governance?operationId=${operationId}`,
        ...payloadOverrides,
      },
      traceId: `dispatcher-test-${randomUUID()}`,
      occurredAt: new Date(),
      ...envelopeOverrides,
    },
  });
  return event.id;
}

async function installDispatchRollbackTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_event_dispatch_for_test()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'forced dispatcher rollback';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_event_dispatch_for_test
    BEFORE UPDATE OF "dispatchedAt" ON "event_log"
    FOR EACH ROW EXECUTE FUNCTION fail_event_dispatch_for_test()
  `);
}

async function removeDispatchRollbackTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_event_dispatch_for_test ON "event_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_event_dispatch_for_test()');
}

test.before(async () => {
  prisma = createTestPrisma();
  await removeDispatchRollbackTrigger();
});
test.beforeEach(async () => {
  await removeDispatchRollbackTrigger();
  await clearTestApplicationData(prisma);
});
test.after(async () => {
  await removeDispatchRollbackTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('registers deterministic handler metadata and rejects duplicate codes', () => {
  const registry = registryWithPilot();

  assert.equal(registry.has(PILOT_HANDLER), true);
  assert.deepEqual(registry.get(PILOT_HANDLER), {
    handlerCode: PILOT_HANDLER,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  });
  assert.throws(() => registry.register({
    handlerCode: PILOT_HANDLER,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  }), /already registered/);
});

test('snapshots enabled matching subscriptions once', async () => {
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { filterJson: { all: [ { field: 'riskLevel', operator: 'EQ', values: [ 'HIGH' ] } ] } },
  });
  const eventId = await createEvent();
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  const first = await dispatcher.dispatchBatch(25);
  const second = await dispatcher.dispatchBatch(25);

  assert.deepEqual(first, { dispatchedCount: 1, deliveryCount: 1, manualCount: 0 });
  assert.deepEqual(second, { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 });
  assert.equal(await prisma.eventDelivery.count({ where: { eventId } }), 1);
  assert.equal((await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } })).status, 'PENDING');
  assert.ok((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
});

test('marks an event dispatched when no enabled subscription matches', async () => {
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { filterJson: { all: [ { field: 'riskLevel', operator: 'EQ', values: [ 'LOW' ] } ] } },
  });
  const eventId = await createEvent();
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), new EventHealthService(false));

  const result = await dispatcher.dispatchBatch(25);

  assert.deepEqual(result, { dispatchedCount: 1, deliveryCount: 0, manualCount: 0 });
  assert.equal(await prisma.eventDelivery.count({ where: { eventId } }), 0);
  assert.ok((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
});

for (const scenario of [
  { name: 'unknown event type', envelope: () => ({ eventType: 'admin.operation.unknown' }) },
  { name: 'unknown event version without a subscription', envelope: () => ({ eventVersion: 2 }) },
  { name: 'wrong source module', envelope: () => ({ sourceModule: 'UNTRUSTED_SOURCE' }) },
  { name: 'wrong object type', envelope: () => ({ objectType: 'UNTRUSTED_OBJECT' }) },
  { name: 'wrong object id', envelope: () => ({ objectId: randomUUID() }) },
  { name: 'non-canonical ordering key', envelope: () => ({ orderingKey: 'a'.repeat(64) }) },
]) {
  test(`quarantines a stored event with ${scenario.name} without dispatch or duplicate evidence`, async () => {
    const eventId = await createEvent({}, scenario.envelope());
    const health = new EventHealthService(false);
    const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

    const first = await dispatcher.dispatchBatch(25);
    const firstDelivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
    const second = await dispatcher.dispatchBatch(25);
    const persisted = await prisma.eventDelivery.findMany({ where: { eventId } });

    assert.deepEqual(first, { dispatchedCount: 0, deliveryCount: 1, manualCount: 1 });
    assert.deepEqual(second, { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 });
    assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt, null);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].id, firstDelivery.id);
    assert.equal(firstDelivery.handlerCode, QUARANTINE_HANDLER);
    assert.equal(firstDelivery.status, 'MANUAL');
    assert.equal(firstDelivery.lastErrorCode, 'EVENT_ENVELOPE_INVALID');
    assert.match(firstDelivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(health.snapshot().lastErrorReference, firstDelivery.lastErrorReference);
    assert.equal(health.snapshot().invalidEnvelopeCount, 1);
    assert.equal(await prisma.eventHandlerLog.count({ where: { deliveryId: firstDelivery.id } }), 0);
    assert.equal(await prisma.notification.count(), 0);
    assert.doesNotMatch(JSON.stringify(health.snapshot()), /operationType|routeUrl|requesterUserId/i);
  });
}

test('quarantines a stored event with an invalid payload before subscription matching', async () => {
  const privateValue = `payload-${randomUUID()}`;
  const eventId = await createEvent({ unexpectedField: privateValue });
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  const result = await dispatcher.dispatchBatch(25);
  const delivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });

  assert.deepEqual(result, { dispatchedCount: 0, deliveryCount: 1, manualCount: 1 });
  assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt, null);
  assert.equal(delivery.handlerCode, QUARANTINE_HANDLER);
  assert.equal(delivery.lastErrorCode, 'EVENT_ENVELOPE_INVALID');
  assert.doesNotMatch(JSON.stringify({ delivery, health: health.snapshot() }), new RegExp(privateValue));
});

test('creates MANUAL evidence for an enabled unknown handler', async () => {
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { handlerCode: 'UNKNOWN' },
  });
  const eventId = await createEvent();
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  await dispatcher.dispatchBatch(25);

  const delivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.lastErrorCode, 'HANDLER_NOT_REGISTERED');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.deepEqual(health.snapshot(), {
    status: 'degraded',
    workerEnabled: false,
    unknownHandlerCount: 1,
    invalidFilterCount: 0,
    invalidEnvelopeCount: 0,
    lastDegradedAt: health.snapshot().lastDegradedAt,
    lastErrorCode: 'HANDLER_NOT_REGISTERED',
    lastErrorReference: delivery.lastErrorReference,
  });
});

test('creates safe MANUAL evidence and degraded health for an invalid filter', async () => {
  const rawSecret = 'must-not-appear-in-health';
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { filterJson: { all: [ { field: 'routeUrl', operator: 'EQ', values: [ rawSecret ] } ] } },
  });
  const eventId = await createEvent();
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  await dispatcher.dispatchBatch(25);

  const delivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
  const snapshot = health.snapshot();
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.lastErrorCode, 'SUBSCRIPTION_FILTER_INVALID');
  assert.equal(snapshot.status, 'degraded');
  assert.equal(snapshot.invalidFilterCount, 1);
  assert.equal(snapshot.lastErrorCode, 'SUBSCRIPTION_FILTER_INVALID');
  assert.equal(snapshot.lastErrorReference, delivery.lastErrorReference);
  assert.doesNotMatch(JSON.stringify(snapshot), /routeUrl|must-not-appear-in-health|not allowed/i);
});

test('does not report or apply an unknown-handler fault skipped by the delivery unique key', async () => {
  const subscription = await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { handlerCode: 'UNKNOWN' },
  });
  const eventId = await createEvent();
  await prisma.eventDelivery.create({
    data: {
      eventId,
      subscriptionId: subscription.id,
      handlerCode: 'UNKNOWN',
      orderingKey: 'a'.repeat(64),
      status: 'PENDING',
    },
  });
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  const result = await dispatcher.dispatchBatch(25);

  assert.deepEqual(result, { dispatchedCount: 1, deliveryCount: 0, manualCount: 0 });
  const existing = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
  assert.equal(existing.status, 'PENDING');
  assert.equal(existing.lastErrorCode, null);
  assert.equal(existing.lastErrorReference, null);
  assert.ok((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
  assert.equal(health.snapshot().status, 'healthy');
  assert.equal(health.snapshot().unknownHandlerCount, 0);
});

test('does not report or apply an invalid-filter fault skipped by the delivery unique key', async () => {
  const subscription = await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { filterJson: { all: [ { field: 'routeUrl', operator: 'EQ', values: [ 'private' ] } ] } },
  });
  const eventId = await createEvent();
  const existingReference = randomUUID();
  await prisma.eventDelivery.create({
    data: {
      eventId,
      subscriptionId: subscription.id,
      handlerCode: PILOT_HANDLER,
      orderingKey: 'a'.repeat(64),
      status: 'MANUAL',
      lastErrorCode: 'PREEXISTING_MANUAL',
      lastErrorReference: existingReference,
    },
  });
  const health = new EventHealthService(false);
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);

  const result = await dispatcher.dispatchBatch(25);

  assert.deepEqual(result, { dispatchedCount: 1, deliveryCount: 0, manualCount: 0 });
  const existing = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
  assert.equal(existing.status, 'MANUAL');
  assert.equal(existing.lastErrorCode, 'PREEXISTING_MANUAL');
  assert.equal(existing.lastErrorReference, existingReference);
  assert.ok((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
  assert.equal(health.snapshot().status, 'healthy');
  assert.equal(health.snapshot().invalidFilterCount, 0);
});

for (const mismatch of [
  { name: 'event type', eventType: 'admin.operation.other', eventVersion: 1 },
  { name: 'event version', eventType: 'admin.operation.reviewed', eventVersion: 2 },
]) {
  test(`creates MANUAL evidence when a registered code has a mismatched ${mismatch.name}`, async () => {
    const registry = new EventHandlerRegistry();
    registry.register({
      handlerCode: PILOT_HANDLER,
      eventType: mismatch.eventType,
      eventVersion: mismatch.eventVersion,
    });
    registry.validate();
    const eventId = await createEvent();
    const health = new EventHealthService(false);
    const dispatcher = new EventDispatcher(prisma, registry, health);

    await dispatcher.dispatchBatch(25);

    const delivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId } });
    assert.equal(delivery.status, 'MANUAL');
    assert.equal(delivery.lastErrorCode, 'HANDLER_NOT_REGISTERED');
    assert.equal(health.snapshot().lastErrorReference, delivery.lastErrorReference);
  });
}

for (const scenario of [
  {
    name: 'unknown handler',
    configure: () => prisma.eventSubscription.update({
      where: { code: 'admin-operation-reviewed-notification-v1' },
      data: { handlerCode: 'UNKNOWN' },
    }),
  },
  {
    name: 'invalid filter',
    configure: () => prisma.eventSubscription.update({
      where: { code: 'admin-operation-reviewed-notification-v1' },
      data: { filterJson: { all: [ { field: 'routeUrl', operator: 'EQ', values: [ 'private' ] } ] } },
    }),
  },
]) {
  test(`does not mutate health when ${scenario.name} evidence rolls back`, async () => {
    await scenario.configure();
    const eventId = await createEvent();
    const health = new EventHealthService(false);
    const dispatcher = new EventDispatcher(prisma, registryWithPilot(), health);
    await installDispatchRollbackTrigger();
    try {
      await assert.rejects(() => dispatcher.dispatchBatch(25));
    } finally {
      await removeDispatchRollbackTrigger();
    }

    assert.equal(await prisma.eventDelivery.count({ where: { eventId } }), 0);
    assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt, null);
    assert.deepEqual(health.snapshot(), {
      status: 'healthy',
      workerEnabled: false,
      unknownHandlerCount: 0,
      invalidFilterCount: 0,
      invalidEnvelopeCount: 0,
      lastDegradedAt: null,
      lastErrorCode: null,
      lastErrorReference: null,
    });
  });
}

test('accepts the configured maximum and rejects an unbounded dispatch limit', async () => {
  const dispatcher = new EventDispatcher(prisma, registryWithPilot(), new EventHealthService(false));

  assert.deepEqual(await dispatcher.dispatchBatch(200), {
    dispatchedCount: 0,
    deliveryCount: 0,
    manualCount: 0,
  });
  await assert.rejects(dispatcher.dispatchBatch(0), /between 1 and 200/);
  await assert.rejects(dispatcher.dispatchBatch(201), /between 1 and 200/);
  await assert.rejects(dispatcher.dispatchBatch(1.5), /between 1 and 200/);
});
