import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { allowedSubscriptionFields, parseEventPayload, validateEventEnvelope } from '../../app/domain/events/event-registry';
import {
  COST_CREATED,
  COST_DELETED,
  COST_UPDATED,
  INVOICE_APPROVED,
  INVOICE_COMPLETED,
  INVOICE_REJECTED,
  INVOICE_REQUESTED,
  PAYMENT_STATUS,
  PAYMENT_VOIDED,
  REFUND_APPROVED,
  REFUND_EXECUTED,
  REFUND_REJECTED,
  REFUND_REQUESTED,
} from '../../app/domain/events/event-types';

// SPEC-011 Task 4: finance 域 12 事件注册测试（registry 解析层，纯内存不连库）。
// 载荷键集逐字钉死（task-4-brief §载荷键集表）：
//   invoice.requested 5 键 / invoice.approved|rejected|completed 3 键 /
//   refund.requested 6 键 / refund.approved|rejected 3 键 / refund.executed 5 键（paymentId/planId 可空锚点）/
//   payment.voided 3 键（sourceModule=CONTRACT，与 payment.created/confirmed 同族）/
//   cost.created 4 键（channelId/caseId 可空锚点）/ cost.updated|deleted 2 键。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/finance-events.test.ts

const invoiceRequestId = '12121212-1212-4212-8212-121212121212';
const refundRequestId = '34343434-3434-4434-8434-343434343434';
const contractId = '40404040-4040-4040-8040-404040404040';
const customerId = '20202020-2020-4020-8020-202020202020';
const paymentId = '70707070-7070-4070-8070-707070707070';
const planId = '90909090-9090-4090-8090-909090909090';
const costEntryId = 'abababab-abab-4bab-8bab-abababababab';
const channelId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const caseId = 'efefefef-efef-4fef-8fef-efefefefefef';

function invoiceRequestedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoiceRequestId,
    requestNo: 'INV260730-AB12CD',
    contractId,
    customerId,
    status: 'PENDING',
    ...overrides,
  };
}

function invoiceApprovedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { invoiceRequestId, contractId, status: 'APPROVED', ...overrides };
}

function invoiceRejectedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { invoiceRequestId, contractId, status: 'REJECTED', ...overrides };
}

function invoiceCompletedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { invoiceRequestId, contractId, status: 'COMPLETED', ...overrides };
}

function refundRequestedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    refundRequestId,
    requestNo: 'RF260730-AB12CD',
    type: 'REFUND',
    contractId,
    customerId,
    status: 'PENDING',
    ...overrides,
  };
}

function refundApprovedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { refundRequestId, contractId, status: 'APPROVED', ...overrides };
}

function refundRejectedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { refundRequestId, contractId, status: 'REJECTED', ...overrides };
}

function refundExecutedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { refundRequestId, contractId, paymentId, planId: null, status: 'EXECUTED', ...overrides };
}

function paymentVoidedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { paymentId, contractId, status: 'VOIDED', ...overrides };
}

function costCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { costEntryId, category: 'CHANNEL', channelId, caseId: null, ...overrides };
}

function costUpdatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { costEntryId, category: 'OFFICE', ...overrides };
}

function costDeletedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { costEntryId, category: 'LABOR', ...overrides };
}

function expectedOrderingKey(objectType: string, objectId: string): string {
  return createHash('sha256').update(`${objectType}:${objectId}`, 'utf8').digest('hex');
}

test('pins the twelve SPEC-011 finance event type constants', () => {
  assert.equal(INVOICE_REQUESTED, 'invoice.requested');
  assert.equal(INVOICE_APPROVED, 'invoice.approved');
  assert.equal(INVOICE_REJECTED, 'invoice.rejected');
  assert.equal(INVOICE_COMPLETED, 'invoice.completed');
  assert.equal(REFUND_REQUESTED, 'refund.requested');
  assert.equal(REFUND_APPROVED, 'refund.approved');
  assert.equal(REFUND_REJECTED, 'refund.rejected');
  assert.equal(REFUND_EXECUTED, 'refund.executed');
  assert.equal(PAYMENT_VOIDED, 'payment.voided');
  assert.equal(COST_CREATED, 'cost.created');
  assert.equal(COST_UPDATED, 'cost.updated');
  assert.equal(COST_DELETED, 'cost.deleted');
});

const SUCCESS_CASES: ReadonlyArray<{
  eventType: string;
  sourceModule: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}> = [
  { eventType: 'invoice.requested', sourceModule: 'FINANCE', objectType: 'INVOICE_REQUEST', objectId: invoiceRequestId, payload: invoiceRequestedPayload() },
  { eventType: 'invoice.approved', sourceModule: 'FINANCE', objectType: 'INVOICE_REQUEST', objectId: invoiceRequestId, payload: invoiceApprovedPayload() },
  { eventType: 'invoice.rejected', sourceModule: 'FINANCE', objectType: 'INVOICE_REQUEST', objectId: invoiceRequestId, payload: invoiceRejectedPayload() },
  { eventType: 'invoice.completed', sourceModule: 'FINANCE', objectType: 'INVOICE_REQUEST', objectId: invoiceRequestId, payload: invoiceCompletedPayload() },
  { eventType: 'refund.requested', sourceModule: 'FINANCE', objectType: 'REFUND_REQUEST', objectId: refundRequestId, payload: refundRequestedPayload() },
  { eventType: 'refund.approved', sourceModule: 'FINANCE', objectType: 'REFUND_REQUEST', objectId: refundRequestId, payload: refundApprovedPayload() },
  { eventType: 'refund.rejected', sourceModule: 'FINANCE', objectType: 'REFUND_REQUEST', objectId: refundRequestId, payload: refundRejectedPayload() },
  { eventType: 'refund.executed', sourceModule: 'FINANCE', objectType: 'REFUND_REQUEST', objectId: refundRequestId, payload: refundExecutedPayload() },
  { eventType: 'payment.voided', sourceModule: 'CONTRACT', objectType: 'PAYMENT', objectId: paymentId, payload: paymentVoidedPayload() },
  { eventType: 'cost.created', sourceModule: 'FINANCE', objectType: 'COST_ENTRY', objectId: costEntryId, payload: costCreatedPayload() },
  { eventType: 'cost.updated', sourceModule: 'FINANCE', objectType: 'COST_ENTRY', objectId: costEntryId, payload: costUpdatedPayload() },
  { eventType: 'cost.deleted', sourceModule: 'FINANCE', objectType: 'COST_ENTRY', objectId: costEntryId, payload: costDeletedPayload() },
];

for (const item of SUCCESS_CASES) {
  test(`parses ${item.eventType}@1 and derives registry-owned fields`, () => {
    const parsed = parseEventPayload(item.eventType, 1, item.payload);

    assert.equal(parsed.eventType, item.eventType);
    assert.equal(parsed.eventVersion, 1);
    assert.equal(parsed.sourceModule, item.sourceModule);
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

test('rejects non-UUID identifiers across the finance-domain payload definitions', () => {
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ invoiceRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.approved', 1, invoiceApprovedPayload({ invoiceRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.approved', 1, invoiceApprovedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.rejected', 1, invoiceRejectedPayload({ invoiceRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.rejected', 1, invoiceRejectedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.completed', 1, invoiceCompletedPayload({ invoiceRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.completed', 1, invoiceCompletedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ refundRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ customerId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.approved', 1, refundApprovedPayload({ refundRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.approved', 1, refundApprovedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.rejected', 1, refundRejectedPayload({ refundRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.rejected', 1, refundRejectedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ refundRequestId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ paymentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ planId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ paymentId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ contractId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('cost.created', 1, costCreatedPayload({ costEntryId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('cost.created', 1, costCreatedPayload({ channelId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('cost.created', 1, costCreatedPayload({ caseId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('cost.updated', 1, costUpdatedPayload({ costEntryId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload('cost.deleted', 1, costDeletedPayload({ costEntryId: 'not-a-uuid' })), TypeError);
});

test('accepts null for the refund.executed paymentId/planId anchors in either real-or-null shape', () => {
  // REFUND 执行锚 paymentId（planId 空）；WAIVER 执行锚 planId（paymentId 空）；注册表只钉可空形态。
  const refundShape = parseEventPayload('refund.executed', 1, refundExecutedPayload());
  assert.deepEqual(refundShape.payload, refundExecutedPayload());

  const waiverShape = parseEventPayload('refund.executed', 1, refundExecutedPayload({ paymentId: null, planId }));
  assert.deepEqual(waiverShape.payload, refundExecutedPayload({ paymentId: null, planId }));

  assert.doesNotThrow(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ paymentId: null, planId: null })));
});

test('accepts null for the cost.created channelId/caseId anchors', () => {
  // 锚点矩阵由 finance-policy 裁决；注册表允许一空一实或均空。
  assert.doesNotThrow(() => parseEventPayload('cost.created', 1, costCreatedPayload({ channelId: null, caseId })));
  const parsed = parseEventPayload('cost.created', 1, costCreatedPayload({ channelId: null, caseId: null }));
  assert.deepEqual(parsed.payload, {
    costEntryId,
    category: 'CHANNEL',
    channelId: null,
    caseId: null,
  });
});

test('rejects out-of-vocabulary status, type, and category codes', () => {
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.approved', 1, invoiceApprovedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.rejected', 1, invoiceRejectedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.completed', 1, invoiceCompletedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ type: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('refund.approved', 1, refundApprovedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('refund.rejected', 1, refundRejectedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ status: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('cost.created', 1, costCreatedPayload({ category: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('cost.updated', 1, costUpdatedPayload({ category: 'BOGUS' })), TypeError);
  assert.throws(() => parseEventPayload('cost.deleted', 1, costDeletedPayload({ category: 'BOGUS' })), TypeError);
});

test('restricts each finance event to its pinned status vocabulary', () => {
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ status: 'APPROVED' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.approved', 1, invoiceApprovedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.rejected', 1, invoiceRejectedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.completed', 1, invoiceCompletedPayload({ status: 'APPROVED' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ status: 'APPROVED' })), TypeError);
  assert.throws(() => parseEventPayload('refund.approved', 1, refundApprovedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('refund.rejected', 1, refundRejectedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('refund.executed', 1, refundExecutedPayload({ status: 'APPROVED' })), TypeError);
  // payment.voided 仅 VOIDED；其余收款状态（含已扩词位的 PENDING/CONFIRMED/REFUNDED）一律拒绝。
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ status: 'CONFIRMED' })), TypeError);
  assert.throws(() => parseEventPayload('payment.voided', 1, paymentVoidedPayload({ status: 'REFUNDED' })), TypeError);
});

test('accepts every registered refund request type and cost category code', () => {
  for (const type of [ 'REFUND', 'WAIVER' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ type })));
  }
  for (const category of [ 'CHANNEL', 'EVIDENCE', 'CASE_HANDLING', 'LABOR', 'OFFICE' ] as const) {
    assert.doesNotThrow(() => parseEventPayload('cost.created', 1, costCreatedPayload({ category })));
    assert.doesNotThrow(() => parseEventPayload('cost.updated', 1, costUpdatedPayload({ category })));
    assert.doesNotThrow(() => parseEventPayload('cost.deleted', 1, costDeletedPayload({ category })));
  }
});

test('extends PAYMENT_STATUS with the VOIDED word for payment.voided', () => {
  assert.deepEqual([ ...PAYMENT_STATUS ], [ 'PENDING', 'CONFIRMED', 'REFUNDED', 'VOIDED' ]);
  assert.ok((PAYMENT_STATUS as readonly string[]).includes('VOIDED'));
});

test('rejects blank or overlong request numbers', () => {
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ requestNo: '' })), TypeError);
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ requestNo: 'x'.repeat(101) })), TypeError);
  assert.throws(() => parseEventPayload('invoice.requested', 1, invoiceRequestedPayload({ requestNo: 42 })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ requestNo: '' })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ requestNo: 'x'.repeat(101) })), TypeError);
  assert.throws(() => parseEventPayload('refund.requested', 1, refundRequestedPayload({ requestNo: 42 })), TypeError);
});

const FILTER_FIELDS: ReadonlyArray<{ eventType: string; fields: readonly string[] }> = [
  { eventType: 'invoice.requested', fields: [ 'status', 'contractId', 'customerId' ] },
  { eventType: 'invoice.approved', fields: [ 'status', 'contractId' ] },
  { eventType: 'invoice.rejected', fields: [ 'status', 'contractId' ] },
  { eventType: 'invoice.completed', fields: [ 'status', 'contractId' ] },
  { eventType: 'refund.requested', fields: [ 'status', 'type', 'contractId', 'customerId' ] },
  { eventType: 'refund.approved', fields: [ 'status', 'contractId' ] },
  { eventType: 'refund.rejected', fields: [ 'status', 'contractId' ] },
  { eventType: 'refund.executed', fields: [ 'status', 'contractId', 'paymentId', 'planId' ] },
  { eventType: 'payment.voided', fields: [ 'status', 'contractId' ] },
  { eventType: 'cost.created', fields: [ 'category', 'channelId', 'caseId' ] },
  { eventType: 'cost.updated', fields: [ 'category' ] },
  { eventType: 'cost.deleted', fields: [ 'category' ] },
];

for (const item of FILTER_FIELDS) {
  test(`exposes the registered subscription filter fields for ${item.eventType}@1`, () => {
    assert.deepEqual([ ...allowedSubscriptionFields(item.eventType, 1) ].sort(), [ ...item.fields ].sort());
  });
}

test('validates a finance-domain envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: 'invoice.requested',
    eventVersion: 1,
    objectType: 'INVOICE_REQUEST',
    objectId: invoiceRequestId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: invoiceRequestedPayload(),
    traceId: 'task-4-finance-envelope',
    occurredAt: new Date('2026-07-31T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.objectType, 'INVOICE_REQUEST');
  assert.equal(event.objectId, invoiceRequestId);
  assert.equal(event.orderingKey, expectedOrderingKey('INVOICE_REQUEST', invoiceRequestId));
});

test('rejects a finance-domain envelope whose object does not match the registered payload', () => {
  const mismatch = (error: unknown): boolean => error instanceof TypeError
    && error.message.includes('Event envelope object does not match its registered payload');

  assert.throws(() => validateEventEnvelope({
    eventType: 'refund.executed',
    eventVersion: 1,
    objectType: 'REFUND_REQUEST',
    objectId: paymentId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: refundExecutedPayload(),
    traceId: 'task-4-finance-envelope-mismatch-id',
    occurredAt: new Date('2026-07-31T00:00:00.000Z'),
  }), mismatch);
  assert.throws(() => validateEventEnvelope({
    eventType: 'cost.created',
    eventVersion: 1,
    objectType: 'PAYMENT',
    objectId: costEntryId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: costCreatedPayload(),
    traceId: 'task-4-finance-envelope-mismatch-type',
    occurredAt: new Date('2026-07-31T00:00:00.000Z'),
  }), mismatch);
});

test('rejects unregistered finance-domain event types and versions', () => {
  for (const [ eventType, eventVersion ] of [
    [ 'invoice.deleted', 1 ],
    [ 'refund.requested', 2 ],
    [ 'cost.voided', 1 ],
  ] as const) {
    assert.throws(
      () => parseEventPayload(eventType, eventVersion, {}),
      (error: unknown) => error instanceof TypeError
        && error.message.includes('Event type or version is not registered'),
    );
  }
});
