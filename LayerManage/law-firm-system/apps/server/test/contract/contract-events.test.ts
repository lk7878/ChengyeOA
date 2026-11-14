import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { allowedSubscriptionFields, parseEventPayload, validateEventEnvelope } from '../../app/domain/events/event-registry';
import {
  CONTRACT_CREATED,
  CONTRACT_EFFECTIVE,
  CONTRACT_STATUS_CHANGED,
  NEGOTIATION_CLOSED,
  NEGOTIATION_CREATED,
  PAYMENT_CONFIRMED,
  PAYMENT_CREATED,
  PAYMENT_PLAN_CANCELLED,
} from '../../app/domain/events/event-types';

const negotiationId = '10101010-1010-4010-8010-101010101010';
const customerId = '20202020-2020-4020-8020-202020202020';
const negotiatorEmployeeId = '30303030-3030-4030-8030-303030303030';
const contractId = '40404040-4040-4040-8040-404040404040';
const caseId = '50505050-5050-4050-8050-505050505050';
const engagementId = '60606060-6060-4060-8060-606060606060';
const paymentId = '70707070-7070-4070-8070-707070707070';
const planId = '80808080-8080-4080-8080-808080808080';

function negotiationCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { negotiationId, customerId, negotiatorEmployeeId, status: 'NEGOTIATING', ...overrides };
}

function negotiationClosedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { negotiationId, status: 'SIGNED', ...overrides };
}

function contractCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractId,
    contractNo: 'FS-ZS01-YL-2026-0007',
    contractType: 'FIRST_SIGN',
    customerId,
    sourceType: 'NEGOTIATION',
    ...overrides,
  };
}

function contractStatusChangedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { contractId, fromStatus: 'DRAFT', toStatus: 'PENDING_APPROVAL', ...overrides };
}

function contractEffectivePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractId,
    contractType: 'FORMAL',
    customerId,
    planCount: 3,
    caseId,
    engagementId,
    ...overrides,
  };
}

function paymentCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paymentId,
    paymentNo: 'PAY-2026-0001',
    contractId,
    customerId,
    status: 'PENDING',
    ...overrides,
  };
}

function paymentConfirmedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { paymentId, contractId, status: 'CONFIRMED', ...overrides };
}

function paymentPlanCancelledPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { planId, contractId, status: 'CANCELLED', ...overrides };
}

function expectedOrderingKey(objectType: string, objectId: string): string {
  return createHash('sha256').update(`${objectType}:${objectId}`, 'utf8').digest('hex');
}

test('pins the seven SPEC-010 event type constants', () => {
  assert.equal(NEGOTIATION_CREATED, 'negotiation.created');
  assert.equal(NEGOTIATION_CLOSED, 'negotiation.closed');
  assert.equal(CONTRACT_CREATED, 'contract.created');
  assert.equal(CONTRACT_STATUS_CHANGED, 'contract.status_changed');
  assert.equal(CONTRACT_EFFECTIVE, 'contract.effective');
  assert.equal(PAYMENT_CREATED, 'payment.created');
  assert.equal(PAYMENT_CONFIRMED, 'payment.confirmed');
});

test('pins the SPEC-012 payment_plan.cancelled event type constant', () => {
  assert.equal(PAYMENT_PLAN_CANCELLED, 'payment_plan.cancelled');
});

const SUCCESS_CASES: ReadonlyArray<{
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}> = [
  { eventType: 'negotiation.created', objectType: 'NEGOTIATION', objectId: negotiationId, payload: negotiationCreatedPayload() },
  { eventType: 'negotiation.closed', objectType: 'NEGOTIATION', objectId: negotiationId, payload: negotiationClosedPayload() },
  { eventType: 'contract.created', objectType: 'CONTRACT', objectId: contractId, payload: contractCreatedPayload() },
  { eventType: 'contract.status_changed', objectType: 'CONTRACT', objectId: contractId, payload: contractStatusChangedPayload() },
  { eventType: 'contract.effective', objectType: 'CONTRACT', objectId: contractId, payload: contractEffectivePayload() },
  { eventType: 'payment.created', objectType: 'PAYMENT', objectId: paymentId, payload: paymentCreatedPayload() },
  { eventType: 'payment.confirmed', objectType: 'PAYMENT', objectId: paymentId, payload: paymentConfirmedPayload() },
  { eventType: 'payment_plan.cancelled', objectType: 'PAYMENT_PLAN', objectId: planId, payload: paymentPlanCancelledPayload() },
];

for (const item of SUCCESS_CASES) {
  test(`parses ${item.eventType}@1 and derives registry-owned fields`, () => {
    const parsed = parseEventPayload(item.eventType, 1, item.payload);

    assert.equal(parsed.eventType, item.eventType);
    assert.equal(parsed.eventVersion, 1);
    assert.equal(parsed.sourceModule, 'CONTRACT');
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

test('rejects non-UUID identifiers across the contract-domain payload definitions', () => {
  assert.throws(() => parseEventPayload('negotiation.created', 1, negotiationCreatedPayload({ negotiationId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('negotiation.created', 1, negotiationCreatedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('negotiation.created', 1, negotiationCreatedPayload({ negotiatorEmployeeId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('negotiation.closed', 1, negotiationClosedPayload({ negotiationId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ caseId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ engagementId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ paymentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.confirmed', 1, paymentConfirmedPayload({ paymentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.confirmed', 1, paymentConfirmedPayload({ contractId: 'not-a-uuid' })), TypeError);
});

test('accepts null for the contract.effective optional reference identifiers', () => {
  assert.doesNotThrow(() => parseEventPayload(
    'contract.effective',
    1,
    contractEffectivePayload({ caseId: null, engagementId: null }),
  ));
  const parsed = parseEventPayload('contract.effective', 1, contractEffectivePayload({ caseId: null, engagementId: null }));
  assert.deepEqual(parsed.payload, {
    contractId,
    contractType: 'FORMAL',
    customerId,
    planCount: 3,
    caseId: null,
    engagementId: null,
  });
});

test('rejects out-of-vocabulary status, type, and source codes', () => {
  assert.throws(() => parseEventPayload('negotiation.created', 1, negotiationCreatedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('negotiation.closed', 1, negotiationClosedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractType: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ sourceType: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ fromStatus: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ toStatus: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ contractType: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('payment.confirmed', 1, paymentConfirmedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('payment_plan.cancelled', 1, paymentPlanCancelledPayload({ status: 'BOGUS' })), TypeError);
});

test('restricts closed-event statuses to the design-pinned outcome vocabularies', () => {
  // 设计 §6.5：negotiation.closed 仅 SIGNED/UNSIGNED；payment.confirmed 仅 CONFIRMED。
  assert.doesNotThrow(() => parseEventPayload('negotiation.closed', 1, negotiationClosedPayload({ status: 'UNSIGNED' })));
  assert.throws(() => parseEventPayload('negotiation.closed', 1, negotiationClosedPayload({ status: 'NEGOTIATING' })), TypeError);
  assert.throws(() => parseEventPayload('payment.confirmed', 1, paymentConfirmedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('payment.confirmed', 1, paymentConfirmedPayload({ status: 'REFUNDED' })), TypeError);
  // SPEC-012：payment_plan.cancelled 仅 CANCELLED（单值钉死——PENDING/RECEIVED 拒绝）。
  assert.doesNotThrow(() => parseEventPayload('payment_plan.cancelled', 1, paymentPlanCancelledPayload({ status: 'CANCELLED' })));
  assert.throws(() => parseEventPayload('payment_plan.cancelled', 1, paymentPlanCancelledPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('payment_plan.cancelled', 1, paymentPlanCancelledPayload({ status: 'RECEIVED' })), TypeError);
});

test('accepts every registered negotiation, contract, and payment status code', () => {
  for (const status of [ 'NEGOTIATING', 'SIGNED', 'UNSIGNED' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('negotiation.created', 1, negotiationCreatedPayload({ status })));
  }
  for (const status of [ 'DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGN', 'SIGNED', 'EFFECTIVE', 'TERMINATED', 'VOID' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ fromStatus: status })));
    assert.doesNotThrow(() => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ toStatus: status })));
  }
  for (const contractType of [ 'FIRST_SIGN', 'FORMAL', 'SUPPLEMENT', 'RISK_NOTICE' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractType })));
    assert.doesNotThrow(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ contractType })));
  }
  for (const sourceType of [ 'CUSTOMER', 'NEGOTIATION', 'ANALYSIS', 'CASE' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ sourceType })));
  }
  for (const status of [ 'PENDING', 'CONFIRMED', 'REFUNDED' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ status })));
  }
});

test('validates planCount as a non-negative integer', () => {
  assert.doesNotThrow(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ planCount: 0 })));
  assert.doesNotThrow(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ planCount: 12 })));
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ planCount: -1 })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ planCount: 1.5 })), TypeError);
  assert.throws(() => parseEventPayload('contract.effective', 1, contractEffectivePayload({ planCount: '3' })), TypeError);
});

test('rejects blank or overlong business numbers', () => {
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractNo: '' })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractNo: 'x'.repeat(101) })), TypeError);
  assert.throws(() => parseEventPayload('contract.created', 1, contractCreatedPayload({ contractNo: 42 })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ paymentNo: '' })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ paymentNo: 'x'.repeat(101) })), TypeError);
  assert.throws(() => parseEventPayload('payment.created', 1, paymentCreatedPayload({ paymentNo: 42 })), TypeError);
});

test('keeps unsignedReason out of negotiation.closed payloads', () => {
  // 裁决：未签原因不入载荷，审计查库；多一个键即违反 assertExactKeys。
  assert.throws(
    () => parseEventPayload('negotiation.closed', 1, negotiationClosedPayload({ status: 'UNSIGNED', unsignedReason: 'price' })),
    TypeError,
  );
});

test('rejects contract-domain payloads carrying a forbidden field name', () => {
  assert.throws(
    () => parseEventPayload('contract.status_changed', 1, contractStatusChangedPayload({ reason: 'void requested' })),
    (error: unknown) => error instanceof TypeError && error.message.includes('forbidden field reason'),
  );
  assert.throws(
    () => parseEventPayload('contract.created', 1, contractCreatedPayload({ oldValues: { status: 'DRAFT' } })),
    (error: unknown) => error instanceof TypeError && error.message.includes('forbidden field oldValues'),
  );
});

test('rejects contract-domain payloads larger than 16 KiB', () => {
  assert.throws(
    () => parseEventPayload('contract.created', 1, contractCreatedPayload({ extra: 'x'.repeat(17 * 1024) })),
    (error: unknown) => error instanceof TypeError && error.message.includes('16 KiB'),
  );
});

const FILTER_FIELDS: ReadonlyArray<{ eventType: string; fields: readonly string[] }> = [
  { eventType: 'negotiation.created', fields: [ 'status', 'customerId', 'negotiatorEmployeeId' ] },
  { eventType: 'negotiation.closed', fields: [ 'status' ] },
  { eventType: 'contract.created', fields: [ 'contractType', 'customerId', 'sourceType' ] },
  { eventType: 'contract.status_changed', fields: [ 'fromStatus', 'toStatus' ] },
  { eventType: 'contract.effective', fields: [ 'contractType', 'customerId' ] },
  { eventType: 'payment.created', fields: [ 'status', 'contractId', 'customerId' ] },
  { eventType: 'payment.confirmed', fields: [ 'status', 'contractId' ] },
  { eventType: 'payment_plan.cancelled', fields: [ 'status', 'contractId' ] },
];

for (const item of FILTER_FIELDS) {
  test(`exposes the registered subscription filter fields for ${item.eventType}@1`, () => {
    assert.deepEqual([ ...allowedSubscriptionFields(item.eventType, 1) ].sort(), [ ...item.fields ].sort());
  });
}

test('validates a contract-domain envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: 'contract.status_changed',
    eventVersion: 1,
    objectType: 'CONTRACT',
    objectId: contractId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: contractStatusChangedPayload(),
    traceId: 'task-4-envelope',
    occurredAt: new Date('2026-07-30T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.objectType, 'CONTRACT');
  assert.equal(event.objectId, contractId);
  assert.equal(event.orderingKey, expectedOrderingKey('CONTRACT', contractId));
});

test('validates a payment_plan.cancelled envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: 'payment_plan.cancelled',
    eventVersion: 1,
    objectType: 'PAYMENT_PLAN',
    objectId: planId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: paymentPlanCancelledPayload(),
    traceId: 'task-1-envelope',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.objectType, 'PAYMENT_PLAN');
  assert.equal(event.objectId, planId);
  assert.equal(event.orderingKey, expectedOrderingKey('PAYMENT_PLAN', planId));
});

test('rejects a contract-domain envelope whose object does not match the registered payload', () => {
  const mismatch = (error: unknown): boolean => error instanceof TypeError
    && error.message.includes('Event envelope object does not match its registered payload');

  assert.throws(() => validateEventEnvelope({
    eventType: 'payment.confirmed',
    eventVersion: 1,
    objectType: 'PAYMENT',
    objectId: contractId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: paymentConfirmedPayload(),
    traceId: 'task-4-envelope-mismatch-id',
    occurredAt: new Date('2026-07-30T00:00:00.000Z'),
  }), mismatch);
  assert.throws(() => validateEventEnvelope({
    eventType: 'contract.effective',
    eventVersion: 1,
    objectType: 'NEGOTIATION',
    objectId: contractId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: contractEffectivePayload(),
    traceId: 'task-4-envelope-mismatch-type',
    occurredAt: new Date('2026-07-30T00:00:00.000Z'),
  }), mismatch);
});

test('rejects unregistered contract-domain event types and versions', () => {
  for (const [ eventType, eventVersion ] of [
    [ 'negotiation.deleted', 1 ],
    [ 'contract.created', 2 ],
    [ 'payment.refunded', 1 ],
  ] as const) {
    assert.throws(
      () => parseEventPayload(eventType, eventVersion, {}),
      (error: unknown) => error instanceof TypeError
        && error.message.includes('Event type or version is not registered'),
    );
  }
});

test('keeps the CRM and governance registrations intact', () => {
  const leadId = '11111111-1111-4111-8111-111111111111';
  const leadParsed = parseEventPayload('lead.created', 1, {
    leadId,
    status: 'NEW',
    poolStatus: 'PUBLIC',
    channelId: null,
  });
  assert.equal(leadParsed.sourceModule, 'CRM');
  assert.equal(leadParsed.objectType, 'LEAD');
  assert.equal(leadParsed.objectId, leadId);

  const operationId = '77777777-7777-4777-8777-777777777777';
  const governanceParsed = parseEventPayload('admin.operation.reviewed', 1, {
    operationId,
    operationType: 'SYSTEM_ADMIN_GRANT',
    riskLevel: 'HIGH',
    decision: 'APPROVE',
    status: 'APPROVED',
    requesterUserId: '88888888-8888-4888-8888-888888888888',
    routeUrl: `/security/admin-governance?operationId=${operationId}`,
  });
  assert.equal(governanceParsed.sourceModule, 'ADMIN_GOVERNANCE');
  assert.equal(governanceParsed.objectType, 'ADMIN_OPERATION');
});
