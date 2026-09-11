import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { PrismaEventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { allowedSubscriptionFields, parseEventPayload, validateEventEnvelope } from '../../app/domain/events/event-registry';
import { AdminOperationReviewedV1 } from '../../app/domain/events/event-types';
import { matchesSubscriptionFilter, parseSubscriptionFilter } from '../../app/domain/events/subscription-filter';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const leadId = '11111111-1111-4111-8111-111111111111';
const appointmentId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const channelId = '44444444-4444-4444-8444-444444444444';
const fromEmployeeId = '55555555-5555-4555-8555-555555555555';
const toEmployeeId = '66666666-6666-4666-8666-666666666666';

let prisma: PrismaClient;

function leadCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { leadId, status: 'NEW', poolStatus: 'PUBLIC', channelId, ...overrides };
}

function leadAssignedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { leadId, action: 'ASSIGN', fromEmployeeId, toEmployeeId, ...overrides };
}

function leadStatusChangedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { leadId, fromStatus: 'NEW', toStatus: 'ASSIGNED', ...overrides };
}

function appointmentCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { appointmentId, leadId, channel: 'ONSITE', status: 'PENDING', ...overrides };
}

function appointmentVisitedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { appointmentId, leadId, status: 'VISITED', ...overrides };
}

function customerCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { customerId, sourceLeadId: leadId, status: 'INTENT', ...overrides };
}

function expectedOrderingKey(objectType: string, objectId: string): string {
  return createHash('sha256').update(`${objectType}:${objectId}`, 'utf8').digest('hex');
}

const SUCCESS_CASES: ReadonlyArray<{
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}> = [
  { eventType: 'lead.created', objectType: 'LEAD', objectId: leadId, payload: leadCreatedPayload() },
  { eventType: 'lead.assigned', objectType: 'LEAD', objectId: leadId, payload: leadAssignedPayload() },
  { eventType: 'lead.status_changed', objectType: 'LEAD', objectId: leadId, payload: leadStatusChangedPayload() },
  { eventType: 'appointment.created', objectType: 'APPOINTMENT', objectId: appointmentId, payload: appointmentCreatedPayload() },
  { eventType: 'appointment.visited', objectType: 'APPOINTMENT', objectId: appointmentId, payload: appointmentVisitedPayload() },
  { eventType: 'customer.created', objectType: 'CUSTOMER', objectId: customerId, payload: customerCreatedPayload() },
];

for (const item of SUCCESS_CASES) {
  test(`parses ${item.eventType}@1 and derives registry-owned fields`, () => {
    const parsed = parseEventPayload(item.eventType, 1, item.payload);

    assert.equal(parsed.eventType, item.eventType);
    assert.equal(parsed.eventVersion, 1);
    assert.equal(parsed.sourceModule, 'CRM');
    assert.equal(parsed.objectType, item.objectType);
    assert.equal(parsed.objectId, item.objectId);
    assert.equal(parsed.orderingKey, expectedOrderingKey(item.objectType, item.objectId));
    assert.match(parsed.orderingKey, /^[a-f0-9]{64}$/);
    assert.deepEqual(parsed.payload, item.payload);
  });

  test(`rejects ${item.eventType}@1 with an extra field`, () => {
    assert.throws(
      () => parseEventPayload(item.eventType, 1, { ...item.payload, phoneHash: 'f'.repeat(64) }),
      TypeError,
    );
  });

  test(`rejects ${item.eventType}@1 with a missing field`, () => {
    const missing = { ...item.payload };
    delete missing[Object.keys(item.payload)[0]];
    assert.throws(() => parseEventPayload(item.eventType, 1, missing), TypeError);
  });
}

test('rejects non-UUID identifiers across the CRM payload definitions', () => {
  assert.throws(() => parseEventPayload('lead.created', 1, leadCreatedPayload({ leadId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('lead.created', 1, leadCreatedPayload({ channelId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('lead.assigned', 1, leadAssignedPayload({ leadId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('lead.assigned', 1, leadAssignedPayload({ fromEmployeeId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('lead.assigned', 1, leadAssignedPayload({ toEmployeeId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('lead.status_changed', 1, leadStatusChangedPayload({ leadId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.created', 1, appointmentCreatedPayload({ appointmentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.created', 1, appointmentCreatedPayload({ leadId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.visited', 1, appointmentVisitedPayload({ appointmentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.visited', 1, appointmentVisitedPayload({ leadId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('customer.created', 1, customerCreatedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('customer.created', 1, customerCreatedPayload({ sourceLeadId: 'not-a-uuid' })), TypeError);
});

test('accepts null for the nullable reference identifiers', () => {
  assert.doesNotThrow(() => parseEventPayload('lead.created', 1, leadCreatedPayload({ channelId: null })));
  assert.doesNotThrow(() => parseEventPayload(
    'lead.assigned',
    1,
    leadAssignedPayload({ fromEmployeeId: null, toEmployeeId: null }),
  ));
  assert.doesNotThrow(() => parseEventPayload('customer.created', 1, customerCreatedPayload({ sourceLeadId: null })));
});

test('rejects out-of-range status codes and actions', () => {
  assert.throws(() => parseEventPayload('lead.created', 1, leadCreatedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('lead.created', 1, leadCreatedPayload({ poolStatus: 'ASSIGNED' })), TypeError);
  assert.throws(() => parseEventPayload('lead.assigned', 1, leadAssignedPayload({ action: 'DELETE' })), TypeError);
  assert.throws(() => parseEventPayload('lead.status_changed', 1, leadStatusChangedPayload({ fromStatus: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('lead.status_changed', 1, leadStatusChangedPayload({ toStatus: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.created', 1, appointmentCreatedPayload({ channel: 'VIDEO' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.created', 1, appointmentCreatedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('appointment.visited', 1, appointmentVisitedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('customer.created', 1, customerCreatedPayload({ status: 'BOGUS' })), TypeError);
});

test('rejects CRM payloads carrying a forbidden field name', () => {
  assert.throws(
    () => parseEventPayload('lead.status_changed', 1, leadStatusChangedPayload({ reason: 'lost contact' })),
    (error: unknown) => error instanceof TypeError && error.message.includes('forbidden field reason'),
  );
  assert.throws(
    () => parseEventPayload('lead.created', 1, leadCreatedPayload({ oldValues: { status: 'NEW' } })),
    (error: unknown) => error instanceof TypeError && error.message.includes('forbidden field oldValues'),
  );
});

test('rejects CRM payloads larger than 16 KiB', () => {
  assert.throws(
    () => parseEventPayload('lead.created', 1, leadCreatedPayload({ extra: 'x'.repeat(17 * 1024) })),
    (error: unknown) => error instanceof TypeError && error.message.includes('16 KiB'),
  );
});

const FILTER_FIELDS: ReadonlyArray<{ eventType: string; fields: readonly string[] }> = [
  { eventType: 'lead.created', fields: [ 'status', 'poolStatus', 'channelId' ] },
  { eventType: 'lead.assigned', fields: [ 'action', 'fromEmployeeId', 'toEmployeeId' ] },
  { eventType: 'lead.status_changed', fields: [ 'fromStatus', 'toStatus' ] },
  { eventType: 'appointment.created', fields: [ 'channel', 'status', 'leadId' ] },
  { eventType: 'appointment.visited', fields: [ 'status', 'leadId' ] },
  { eventType: 'customer.created', fields: [ 'status', 'sourceLeadId' ] },
];

for (const item of FILTER_FIELDS) {
  test(`exposes the registered subscription filter fields for ${item.eventType}@1`, () => {
    assert.deepEqual([ ...allowedSubscriptionFields(item.eventType, 1) ].sort(), [ ...item.fields ].sort());
  });
}

test('accepts filters on registered CRM fields and matches payload values', () => {
  const filter = parseSubscriptionFilter('lead.created', 1, {
    all: [
      { field: 'status', operator: 'EQ', values: [ 'NEW' ] },
      { field: 'poolStatus', operator: 'IN', values: [ 'PUBLIC', 'PRIVATE' ] },
    ],
  });

  assert.equal(matchesSubscriptionFilter(filter, leadCreatedPayload()), true);
  assert.equal(matchesSubscriptionFilter(filter, leadCreatedPayload({ poolStatus: 'RECYCLED' })), false);
});

test('rejects filters on fields that are not registered for the event type', () => {
  assert.throws(() => parseSubscriptionFilter('lead.created', 1, {
    all: [ { field: 'leadId', operator: 'EQ', values: [ leadId ] } ],
  }));
  assert.throws(() => parseSubscriptionFilter('lead.assigned', 1, {
    all: [ { field: 'status', operator: 'EQ', values: [ 'ASSIGN' ] } ],
  }));
});

test('does not permit callers to mutate the registered CRM filter whitelist', () => {
  const fields = allowedSubscriptionFields('lead.created', 1);
  (fields as Set<string>).add('leadId');

  assert.throws(() => parseSubscriptionFilter('lead.created', 1, {
    all: [ { field: 'leadId', operator: 'EQ', values: [ leadId ] } ],
  }));
});

test('validates a CRM envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: 'lead.assigned',
    eventVersion: 1,
    objectType: 'LEAD',
    objectId: leadId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: leadAssignedPayload(),
    traceId: 'task-4.5-envelope',
    occurredAt: new Date('2026-07-28T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.objectType, 'LEAD');
  assert.equal(event.objectId, leadId);
  assert.equal(event.orderingKey, expectedOrderingKey('LEAD', leadId));
});

test('rejects a CRM envelope whose object does not match the registered payload', () => {
  const mismatch = (error: unknown): boolean => error instanceof TypeError
    && error.message.includes('Event envelope object does not match its registered payload');

  assert.throws(() => validateEventEnvelope({
    eventType: 'lead.assigned',
    eventVersion: 1,
    objectType: 'LEAD',
    objectId: toEmployeeId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: leadAssignedPayload(),
    traceId: 'task-4.5-envelope-mismatch-id',
    occurredAt: new Date('2026-07-28T00:00:00.000Z'),
  }), mismatch);
  assert.throws(() => validateEventEnvelope({
    eventType: 'lead.assigned',
    eventVersion: 1,
    objectType: 'CUSTOMER',
    objectId: leadId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: leadAssignedPayload(),
    traceId: 'task-4.5-envelope-mismatch-type',
    occurredAt: new Date('2026-07-28T00:00:00.000Z'),
  }), mismatch);
});

test('rejects unregistered CRM event types and versions', () => {
  for (const [ eventType, eventVersion ] of [ [ 'lead.deleted', 1 ], [ 'lead.created', 2 ] ] as const) {
    assert.throws(
      () => parseEventPayload(eventType, eventVersion, leadCreatedPayload()),
      (error: unknown) => error instanceof TypeError
        && error.message.includes('Event type or version is not registered'),
    );
  }
});

test('keeps the governance reviewed-v1 registration intact', () => {
  const operationId = '77777777-7777-4777-8777-777777777777';
  const parsed = parseEventPayload<AdminOperationReviewedV1>('admin.operation.reviewed', 1, {
    operationId,
    operationType: 'SYSTEM_ADMIN_GRANT',
    riskLevel: 'HIGH',
    decision: 'APPROVE',
    status: 'APPROVED',
    requesterUserId: '88888888-8888-4888-8888-888888888888',
    routeUrl: `/security/admin-governance?operationId=${operationId}`,
  });

  assert.equal(parsed.sourceModule, 'ADMIN_GOVERNANCE');
  assert.equal(parsed.objectType, 'ADMIN_OPERATION');
  assert.equal(parsed.objectId, operationId);
  assert.equal(parsed.orderingKey, expectedOrderingKey('ADMIN_OPERATION', operationId));
  assert.equal(parsed.payload.operationId, operationId);
});

test.after(async () => {
  if (prisma) {
    await clearTestApplicationData(prisma);
    await prisma.$disconnect();
  }
});

test('persists lead.assigned@1 through the outbox writer in a real transaction', async () => {
  prisma = createTestPrisma();
  await clearTestApplicationData(prisma);

  const eventLeadId = randomUUID();
  const eventFromEmployeeId = randomUUID();
  const eventToEmployeeId = randomUUID();
  const appended = await prisma.$transaction(tx => new PrismaEventOutboxWriter().append(tx, {
    eventType: 'lead.assigned',
    eventVersion: 1,
    objectType: 'LEAD',
    objectId: eventLeadId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: {
      leadId: eventLeadId,
      action: 'ASSIGN',
      fromEmployeeId: eventFromEmployeeId,
      toEmployeeId: eventToEmployeeId,
    },
    traceId: randomUUID(),
    occurredAt: new Date('2026-07-28T01:02:03.000Z'),
  }));

  const stored = await prisma.eventLog.findUniqueOrThrow({ where: { id: appended.eventId } });
  assert.equal(stored.eventType, 'lead.assigned');
  assert.equal(stored.eventVersion, 1);
  assert.equal(stored.sourceModule, 'CRM');
  assert.equal(stored.objectType, 'LEAD');
  assert.equal(stored.objectId, eventLeadId);
  assert.equal(stored.orderingKey, expectedOrderingKey('LEAD', eventLeadId));
  assert.deepEqual(stored.payload, {
    leadId: eventLeadId,
    action: 'ASSIGN',
    fromEmployeeId: eventFromEmployeeId,
    toEmployeeId: eventToEmployeeId,
  });
});
