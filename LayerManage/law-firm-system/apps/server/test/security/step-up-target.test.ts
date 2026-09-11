import assert from 'node:assert/strict';
import test from 'node:test';
import { digestStepUpTarget } from '../../app/domain/security/step-up-target';

test('creates the same governance-create digest regardless of field order', () => {
  const first = digestStepUpTarget('ADMIN_GOVERNANCE_CREATE', {
    operationType: 'SYSTEM_ADMIN_GRANT',
    targetType: 'USER',
    targetId: 'user-2',
    expectedTargetVersion: 3,
    payloadHash: 'a'.repeat(64),
  });
  const second = digestStepUpTarget('ADMIN_GOVERNANCE_CREATE', {
    payloadHash: 'a'.repeat(64),
    expectedTargetVersion: 3,
    targetId: 'user-2',
    targetType: 'USER',
    operationType: 'SYSTEM_ADMIN_GRANT',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test('binds the digest to purpose and target values', () => {
  const approve = digestStepUpTarget('ADMIN_GOVERNANCE_APPROVE', {
    operationId: 'op-1', expectedOperationVersion: 2, decision: 'APPROVE',
  });
  const retry = digestStepUpTarget('ADMIN_GOVERNANCE_RETRY', {
    operationId: 'op-1', expectedOperationVersion: 2,
  });
  const otherApproval = digestStepUpTarget('ADMIN_GOVERNANCE_APPROVE', {
    operationId: 'op-2', expectedOperationVersion: 2, decision: 'APPROVE',
  });

  assert.notEqual(approve, retry);
  assert.notEqual(approve, otherApproval);
});

test('binds event delivery retry to the exact delivery id and positive version', () => {
  const first = digestStepUpTarget('EVENT_DELIVERY_RETRY', {
    deliveryId: 'delivery-1', expectedVersion: 7,
  });
  const reordered = digestStepUpTarget('EVENT_DELIVERY_RETRY', {
    expectedVersion: 7, deliveryId: 'delivery-1',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, digestStepUpTarget('EVENT_DELIVERY_RETRY', {
    deliveryId: 'delivery-2', expectedVersion: 7,
  }));
  assert.notEqual(first, digestStepUpTarget('EVENT_DELIVERY_RETRY', {
    deliveryId: 'delivery-1', expectedVersion: 8,
  }));
  assert.throws(
    () => digestStepUpTarget('EVENT_DELIVERY_RETRY', {
      deliveryId: 'delivery-1', expectedVersion: 7, extra: true,
    }),
    /STEP_UP_TARGET_INVALID/,
  );
  assert.throws(
    () => digestStepUpTarget('EVENT_DELIVERY_RETRY', {
      deliveryId: 'delivery-1', expectedVersion: 0,
    }),
    /STEP_UP_TARGET_INVALID/,
  );
});

test('rejects missing, extra, and malformed target fields', () => {
  assert.throws(
    () => digestStepUpTarget('SESSION_REVOKE', { sessionId: 'session-1', userId: 'extra' }),
    /STEP_UP_TARGET_INVALID/,
  );
  assert.throws(() => digestStepUpTarget('SESSION_REVOKE', {}), /STEP_UP_TARGET_INVALID/);
  assert.throws(
    () => digestStepUpTarget('ADMIN_GOVERNANCE_RETRY', { operationId: 'op-1', expectedOperationVersion: 0 }),
    /STEP_UP_TARGET_INVALID/,
  );
});

test('binds refund approve to the exact refund request id and positive version', () => {
  const first = digestStepUpTarget('REFUND_APPROVE', {
    refundRequestId: 'refund-1', expectedVersion: 7,
  });
  const reordered = digestStepUpTarget('REFUND_APPROVE', {
    expectedVersion: 7, refundRequestId: 'refund-1',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, digestStepUpTarget('REFUND_APPROVE', {
    refundRequestId: 'refund-2', expectedVersion: 7,
  }));
  assert.notEqual(first, digestStepUpTarget('REFUND_APPROVE', {
    refundRequestId: 'refund-1', expectedVersion: 8,
  }));
  assert.throws(
    () => digestStepUpTarget('REFUND_APPROVE', { refundRequestId: 'refund-1', expectedVersion: 0 }),
    /STEP_UP_TARGET_INVALID/,
  );
  assert.throws(
    () => digestStepUpTarget('REFUND_APPROVE', { refundRequestId: 'refund-1', expectedVersion: 7, extra: true }),
    /STEP_UP_TARGET_INVALID/,
  );
  assert.throws(
    () => digestStepUpTarget('REFUND_APPROVE', { expectedVersion: 7 }),
    /STEP_UP_TARGET_INVALID/,
  );
});
