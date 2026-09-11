import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { GOVERNANCE_CODES, GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { assertGovernanceTransition, decisionTarget, mayResumeExecution } from '../../app/domain/admin-governance/governance-state-machine';
import { GOVERNED_OPERATION_TYPES } from '../../app/domain/admin-governance/governance-types';
import {
  parseCancelGovernanceInput,
  parseCreateGovernanceInput,
  parseRetryGovernanceInput,
  parseReviewGovernanceInput,
} from '../../app/domain/admin-governance/governance-validation';
import { GOVERNED_OPERATION_CATALOG } from '../../app/domain/admin-governance/operation-catalog';

test('canonical JSON ignores object key order but not array order', () => {

  assert.equal(canonicalJson({ z: null, a: true }), '{"a":true,"z":null}');
  assert.equal(hashPayload({ b: 2, a: [1, 2] }), hashPayload({ a: [1, 2], b: 2 }));
  assert.notEqual(hashPayload({ a: [1, 2] }), hashPayload({ a: [2, 1] }));
  assert.match(hashPayload({ stable: true }), /^[0-9a-f]{64}$/);
});

test('canonical JSON rejects values that cannot be represented safely', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  for (const value of [
    undefined,
    () => 'unsafe',
    Symbol('unsafe'),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { nested: undefined },
    [1, undefined],
    cyclic,
  ]) {
    assert.throws(() => canonicalJson(value), TypeError);
  }
});

test('operation catalog contains every stable type exactly once and is immutable', () => {
  assert.equal(GOVERNED_OPERATION_TYPES.length, 9);
  assert.equal(new Set(GOVERNED_OPERATION_TYPES).size, 9);
  assert.deepEqual(Object.keys(GOVERNED_OPERATION_CATALOG).sort(), [...GOVERNED_OPERATION_TYPES].sort());
  assert.equal(Object.isFrozen(GOVERNED_OPERATION_CATALOG), true);

  for (const type of GOVERNED_OPERATION_TYPES) {
    const entry = GOVERNED_OPERATION_CATALOG[type];
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.requesterRoles), true);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(entry.riskLevel));
    assert.ok(['PRE', 'POST'].includes(entry.reviewMode));
    assert.equal(typeof entry.adapterKey, 'string');
    assert.ok(entry.adapterKey.length > 0);
    assert.equal(typeof entry.retryable, 'boolean');
    if (entry.riskLevel === 'CRITICAL') {
      assert.equal(typeof entry.confirmationTemplate, 'string');
      assert.match(entry.confirmationTemplate, /\{databaseName\}/);
      assert.match(entry.confirmationTemplate, /\{operationType\}/);
      assert.match(entry.confirmationTemplate, /\{targetUsername\}/);
    }
  }
});

test('operation catalog preserves the approved requester, risk, and review policy', () => {
  const catalog = GOVERNED_OPERATION_CATALOG;
  for (const type of ['SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE'] as const) {
    assert.deepEqual(catalog[type].requesterRoles, ['SYSTEM_SUPER_ADMIN']);
    assert.equal(catalog[type].riskLevel, 'HIGH');
    assert.equal(catalog[type].reviewMode, 'PRE');
  }
  for (const type of ['SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE'] as const) {
    assert.deepEqual(catalog[type].requesterRoles, ['SYSTEM_SUPER_ADMIN']);
    assert.equal(catalog[type].riskLevel, 'CRITICAL');
    assert.equal(catalog[type].reviewMode, 'PRE');
  }
  const reset = catalog.ADMIN_MFA_RESET;
  assert.deepEqual(reset.requesterRoles, ['SYSTEM_SUPER_ADMIN']);
  assert.equal(reset.riskLevel, 'CRITICAL');
  assert.equal(reset.reviewMode, 'PRE');
  assert.equal(reset.retryable, true);
  assert.deepEqual(
    catalog.MASTER_DATA_STATUS_CORRECTION.requesterRoles,
    ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'],
  );
  assert.equal(catalog.MASTER_DATA_STATUS_CORRECTION.riskLevel, 'HIGH');
  assert.equal(catalog.MASTER_DATA_STATUS_CORRECTION.reviewMode, 'PRE');
  assert.equal(catalog.MASTER_DATA_METADATA_CORRECTION.riskLevel, 'LOW');
  assert.equal(catalog.MASTER_DATA_METADATA_CORRECTION.reviewMode, 'POST');
});

test('stable governance errors expose an HTTP status and exact code', () => {
  const error = new GovernanceError(GOVERNANCE_CODES.processed, 409, 'Operation is already processed');

  assert.equal(error.name, 'GovernanceError');
  assert.equal(error.code, 'OPERATION_ALREADY_PROCESSED');
  assert.equal(error.status, 409);
  assert.equal(Object.keys(GOVERNANCE_CODES).length, 12);
  assert.equal(new Set(Object.values(GOVERNANCE_CODES)).size, 12);
});

test('strict create parser accepts only server-approved request fields', () => {
  const input = {
    operationType: 'SYSTEM_ADMIN_GRANT',
    targetType: 'USER',
    targetId: ' user-1 ',
    reason: ' 需要授予系统管理员权限 ',
    expectedTargetVersion: 2,
    payload: { validUntil: null as string | null },
    idempotencyKey: ' request-1 ',
    confirmation: 'CONFIRM database operation target',
  };

  assert.deepEqual(parseCreateGovernanceInput(input), {
    ...input,
    targetId: 'user-1',
    reason: '需要授予系统管理员权限',
    idempotencyKey: 'request-1',
  });

  for (const forbidden of ['riskLevel', 'reviewMode', 'requesterUserId', 'reviewerUserId', 'status']) {
    assert.throws(() => parseCreateGovernanceInput({ ...input, [forbidden]: 'CLIENT_VALUE' }));
  }
  assert.throws(() => parseCreateGovernanceInput({ ...input, unknown: true }));
  assert.throws(() => parseCreateGovernanceInput({ ...input, operationType: 'UNKNOWN' }));
  assert.throws(() => parseCreateGovernanceInput({ ...input, targetId: ' ' }));
  assert.throws(() => parseCreateGovernanceInput({ ...input, reason: 'too short' }));
  assert.throws(() => parseCreateGovernanceInput({ ...input, expectedTargetVersion: 0 }));
  assert.throws(() => parseCreateGovernanceInput({ ...input, expectedTargetVersion: 1.5 }));
});

test('cancel, review, and retry parsers reject unknown keys and stale versions', () => {
  assert.deepEqual(parseCancelGovernanceInput({ expectedOperationVersion: 1 }), { expectedOperationVersion: 1 });
  assert.deepEqual(
    parseReviewGovernanceInput({ decision: 'REJECT', comment: '拒绝原因至少需要十个字符', expectedOperationVersion: 2 }),
    { decision: 'REJECT', comment: '拒绝原因至少需要十个字符', expectedOperationVersion: 2 },
  );
  assert.deepEqual(parseRetryGovernanceInput({ expectedOperationVersion: 3 }), { expectedOperationVersion: 3 });

  assert.throws(() => parseCancelGovernanceInput({ expectedOperationVersion: 1, reason: 'unexpected' }));
  assert.throws(() => parseRetryGovernanceInput({ expectedOperationVersion: 0 }));
  assert.throws(() => parseReviewGovernanceInput({ decision: 'UNKNOWN', expectedOperationVersion: 1 }));
  assert.throws(() => parseReviewGovernanceInput({ decision: 'REJECT', expectedOperationVersion: 1 }));
  assert.throws(() => parseReviewGovernanceInput({ decision: 'FLAG', comment: 'too short', expectedOperationVersion: 1 }));
  assert.throws(() => parseReviewGovernanceInput({
    decision: 'APPROVE', expectedOperationVersion: 1, reviewerUserId: 'client-controlled',
  }));
});

test('pre-review cannot execute before approval', () => {
  assert.throws(() => assertGovernanceTransition('PENDING_REVIEW', 'EXECUTING'));
  assert.doesNotThrow(() => assertGovernanceTransition('PENDING_REVIEW', 'APPROVED'));
  assert.doesNotThrow(() => assertGovernanceTransition('APPROVED', 'EXECUTING'));
  assert.doesNotThrow(() => assertGovernanceTransition('EXECUTING', 'SUCCEEDED'));
  assert.doesNotThrow(() => assertGovernanceTransition('EXECUTING', 'FAILED'));
  assert.doesNotThrow(() => assertGovernanceTransition('EXECUTING', 'PENDING_POST_REVIEW'));
  assert.throws(() => assertGovernanceTransition('SUCCEEDED', 'EXECUTING'));
});

test('review decisions map only to the current review stage', () => {
  assert.equal(decisionTarget('PENDING_REVIEW', 'APPROVE'), 'APPROVED');
  assert.equal(decisionTarget('PENDING_REVIEW', 'REJECT'), 'REJECTED');
  assert.equal(decisionTarget('PENDING_POST_REVIEW', 'CONFIRM'), 'CONFIRMED');
  assert.equal(decisionTarget('PENDING_POST_REVIEW', 'FLAG'), 'FLAGGED');
  assert.throws(() => decisionTarget('PENDING_REVIEW', 'CONFIRM'));
  assert.throws(() => decisionTarget('SUCCEEDED', 'APPROVE'));
});

test('execution resumes only before a success and when failed work is retryable', () => {
  assert.equal(mayResumeExecution('APPROVED', 0), true);
  assert.equal(mayResumeExecution('APPROVED', 1), false);
  assert.equal(mayResumeExecution('FAILED', 0), false);
  assert.equal(mayResumeExecution('FAILED', 0, true), true);
  assert.equal(mayResumeExecution('FAILED', 1, true), false);
  assert.equal(mayResumeExecution('SUCCEEDED', 0, true), false);
});
