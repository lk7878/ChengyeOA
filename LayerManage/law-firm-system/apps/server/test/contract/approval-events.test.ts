import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { allowedSubscriptionFields, parseEventPayload, validateEventEnvelope } from '../../app/domain/events/event-registry';
import {
  APPROVAL_INSTANCE_COMPLETED,
  APPROVAL_INSTANCE_CREATED,
} from '../../app/domain/events/event-types';

const instanceId = '90909090-9090-4090-8090-909090909090';
const applicantId = '81818181-8181-4181-8181-818181818181';

function approvalInstanceCreatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instanceId,
    businessType: 'EXPENSE',
    title: '费用报销审批',
    applicantId,
    status: 'PENDING',
    ...overrides,
  };
}

function approvalInstanceCompletedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { instanceId, businessType: 'EXPENSE', status: 'APPROVED', ...overrides };
}

function expectedOrderingKey(objectType: string, objectId: string): string {
  return createHash('sha256').update(`${objectType}:${objectId}`, 'utf8').digest('hex');
}

test('pins the SPEC-013 approval.instance event type constants', () => {
  assert.equal(APPROVAL_INSTANCE_CREATED, 'approval.instance.created');
  assert.equal(APPROVAL_INSTANCE_COMPLETED, 'approval.instance.completed');
});

test('parses approval.instance.created@1 and derives registry-owned fields', () => {
  const parsed = parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload());

  assert.equal(parsed.eventType, APPROVAL_INSTANCE_CREATED);
  assert.equal(parsed.eventVersion, 1);
  assert.equal(parsed.sourceModule, 'APPROVAL');
  assert.equal(parsed.objectType, 'APPROVAL_INSTANCE');
  assert.equal(parsed.objectId, instanceId);
  assert.equal(parsed.orderingKey, expectedOrderingKey('APPROVAL_INSTANCE', instanceId));
  assert.match(parsed.orderingKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(parsed.payload, approvalInstanceCreatedPayload());
});

test('parses approval.instance.completed@1 and derives registry-owned fields', () => {
  const parsed = parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload());

  assert.equal(parsed.eventType, APPROVAL_INSTANCE_COMPLETED);
  assert.equal(parsed.eventVersion, 1);
  assert.equal(parsed.sourceModule, 'APPROVAL');
  assert.equal(parsed.objectType, 'APPROVAL_INSTANCE');
  assert.equal(parsed.objectId, instanceId);
  assert.equal(parsed.orderingKey, expectedOrderingKey('APPROVAL_INSTANCE', instanceId));
  assert.match(parsed.orderingKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(parsed.payload, approvalInstanceCompletedPayload());
});

test('rejects approval.instance.created@1 with an extra field', () => {
  assert.throws(
    () => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ decidedBy: applicantId })),
    (error: unknown) => error instanceof TypeError && error.message.includes('unexpected or missing fields'),
  );
});

test('rejects approval.instance.created@1 with a missing field', () => {
  const missing = approvalInstanceCreatedPayload();
  delete missing.applicantId;
  assert.throws(
    () => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, missing),
    (error: unknown) => error instanceof TypeError && error.message.includes('unexpected or missing fields'),
  );
});

test('rejects approval.instance.completed@1 with an extra field', () => {
  assert.throws(
    () => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ decidedBy: applicantId })),
    (error: unknown) => error instanceof TypeError && error.message.includes('unexpected or missing fields'),
  );
});

test('rejects approval.instance.completed@1 with a missing field', () => {
  const missing = approvalInstanceCompletedPayload();
  delete missing.status;
  assert.throws(
    () => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, missing),
    (error: unknown) => error instanceof TypeError && error.message.includes('unexpected or missing fields'),
  );
});

test('rejects non-UUID identifiers across the approval payload definitions', () => {
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ instanceId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ applicantId: 'not-a-uuid' })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ instanceId: 'not-a-uuid' })), TypeError);
});

test('rejects non-string businessType and title in approval payloads', () => {
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ businessType: 42 })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ title: false })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ businessType: null })), TypeError);
});

test('restricts approval statuses to the design-pinned vocabularies', () => {
  // SPEC-013 §4.1：created 单值钉死，仅 PENDING。
  assert.doesNotThrow(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ status: 'PENDING' })));
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ status: 'APPROVED' })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_CREATED, 1, approvalInstanceCreatedPayload({ status: 'BOGUS' })), TypeError);
  // SPEC-013 §4.1：completed 三值钉死 APPROVED|REJECTED|WITHDRAWN。
  assert.doesNotThrow(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ status: 'APPROVED' })));
  assert.doesNotThrow(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ status: 'REJECTED' })));
  assert.doesNotThrow(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ status: 'WITHDRAWN' })));
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ status: 'PENDING' })), TypeError);
  assert.throws(() => parseEventPayload(APPROVAL_INSTANCE_COMPLETED, 1, approvalInstanceCompletedPayload({ status: 'BOGUS' })), TypeError);
});

test('exposes the registered subscription filter fields for approval events', () => {
  assert.deepEqual(
    [ ...allowedSubscriptionFields(APPROVAL_INSTANCE_CREATED, 1) ].sort(),
    [ 'applicantId', 'businessType', 'status', 'title' ].sort(),
  );
  assert.deepEqual(
    [ ...allowedSubscriptionFields(APPROVAL_INSTANCE_COMPLETED, 1) ].sort(),
    [ 'businessType', 'status' ].sort(),
  );
});

test('validates an approval.instance.created envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: APPROVAL_INSTANCE_CREATED,
    eventVersion: 1,
    objectType: 'APPROVAL_INSTANCE',
    objectId: instanceId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: approvalInstanceCreatedPayload(),
    traceId: 'task-3-envelope-created',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'APPROVAL');
  assert.equal(event.objectType, 'APPROVAL_INSTANCE');
  assert.equal(event.objectId, instanceId);
  assert.equal(event.orderingKey, expectedOrderingKey('APPROVAL_INSTANCE', instanceId));
});

test('validates an approval.instance.completed envelope whose object matches the registered payload', () => {
  const event = validateEventEnvelope({
    eventType: APPROVAL_INSTANCE_COMPLETED,
    eventVersion: 1,
    objectType: 'APPROVAL_INSTANCE',
    objectId: instanceId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: approvalInstanceCompletedPayload(),
    traceId: 'task-3-envelope-completed',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });

  assert.equal(event.sourceModule, 'APPROVAL');
  assert.equal(event.objectType, 'APPROVAL_INSTANCE');
  assert.equal(event.objectId, instanceId);
  assert.equal(event.orderingKey, expectedOrderingKey('APPROVAL_INSTANCE', instanceId));
});

test('rejects an approval envelope whose object does not match the registered payload', () => {
  const mismatch = (error: unknown): boolean => error instanceof TypeError
    && error.message.includes('Event envelope object does not match its registered payload');

  assert.throws(() => validateEventEnvelope({
    eventType: APPROVAL_INSTANCE_CREATED,
    eventVersion: 1,
    objectType: 'APPROVAL_INSTANCE',
    objectId: applicantId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: approvalInstanceCreatedPayload(),
    traceId: 'task-3-envelope-mismatch',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  }), mismatch);
});

test('rejects unregistered approval event versions', () => {
  assert.throws(
    () => parseEventPayload(APPROVAL_INSTANCE_CREATED, 2, approvalInstanceCreatedPayload()),
    (error: unknown) => error instanceof TypeError
      && error.message.includes('Event type or version is not registered'),
  );
});
