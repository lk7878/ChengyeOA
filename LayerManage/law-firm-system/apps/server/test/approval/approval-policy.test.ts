import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_ASSIGNEE_INVALID,
  APPROVAL_DEFINITION_CODE_CONFLICT,
  APPROVAL_DEFINITION_NOT_FOUND,
  APPROVAL_ERROR_CODES,
  APPROVAL_ERROR_HTTP_STATUS,
  APPROVAL_INSTANCE_NOT_FOUND,
  APPROVAL_SELF_REVIEW_FORBIDDEN,
  APPROVAL_STATE_INVALID,
  APPROVAL_TASK_NOT_FOUND,
  ApprovalError,
  CALLBACK_KEY_CONFLICT,
} from '../../app/domain/approval/approval-errors';
import {
  assertNotSelfReview,
  canTransitionInstance,
  resolveApproverRule,
} from '../../app/domain/approval/approval-policy';
import {
  APPROVAL_BUSINESS_TYPES,
  APPROVER_RULE_TYPES,
  INSTANCE_STATUSES,
  TASK_STATUSES,
  type ApprovalBusinessType,
  type ApprovalInstanceStatus,
  type ApproverRule,
  type ApprovalTaskStatus,
} from '../../app/domain/approval/approval-types';

// SPEC-013 Task 4: approval-policy 领域纯函数与 approval-errors 稳定错误码契约测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/approval-policy.test.ts
// 纯单测，不连数据库。覆盖协调者裁决测试矩阵：
//   ①resolveApproverRule USER 原序复制 / ROLE 多 roleCode 合并、空成员→空集、去重；
//   ②canTransitionInstance PENDING→三目标允、终态（APPROVED/REJECTED/WITHDRAWN）→任何拒（非恒真）；
//   ③assertNotSelfReview 命中抛 409 / 未命中通过。
// 另钉 approval-types 四组词汇表与 approval-errors 7 码值/聚合/HTTP 状态。

// ===== 词汇表（approval-types） =====

test('APPROVAL_BUSINESS_TYPES includes public and managed business types in order', () => {
  assert.deepEqual([...APPROVAL_BUSINESS_TYPES], ['EXPENSE', 'CONTRACT_CHANGE', 'SEAL', 'LEAVE', 'TRANSFER', 'CUSTOM', 'PAYROLL', 'SOP_REVIEW', 'QUALITY_ANALYSIS']);
});

// SPEC-041：+SUPERVISOR（按申请人报告线路由直属上级/多级上溯）。
test('APPROVER_RULE_TYPES exports the three approver rule types in order', () => {
  assert.deepEqual([...APPROVER_RULE_TYPES], ['USER', 'ROLE', 'SUPERVISOR']);
});

test('INSTANCE_STATUSES exports the four instance statuses in order', () => {
  assert.deepEqual([...INSTANCE_STATUSES], ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
});

test('TASK_STATUSES exports the four task statuses in order', () => {
  assert.deepEqual([...TASK_STATUSES], ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
});

// ===== resolveApproverRule：USER 规则（原序复制） =====

test('resolveApproverRule USER returns a new array preserving the original user order', () => {
  const rule: ApproverRule = { type: 'USER', userIds: ['u1', 'u2', 'u3'] };
  const result = resolveApproverRule(rule, {});
  assert.deepEqual(result, ['u1', 'u2', 'u3']);
  // 原序复制：返回新数组引用，不共享调用方数组。
  assert.notEqual(result, rule.userIds);
});

test('resolveApproverRule USER with empty userIds returns an empty array', () => {
  const rule: ApproverRule = { type: 'USER', userIds: [] };
  assert.deepEqual(resolveApproverRule(rule, {}), []);
});

// ===== resolveApproverRule：ROLE 规则 =====

test('resolveApproverRule ROLE merges members across multiple roleCodes in map order', () => {
  const rule: ApproverRule = { type: 'ROLE', roleCodes: ['R1', 'R2', 'R3'] };
  const members: Record<string, string[]> = {
    R1: ['u1', 'u2'],
    R2: ['u2', 'u3'],
    R3: [],
  };
  // R1+R2 合并得 u1/u2/u3；R3 空成员不贡献；u2 重复去重后仅出现一次。
  assert.deepEqual(resolveApproverRule(rule, members), ['u1', 'u2', 'u3']);
});

test('resolveApproverRule ROLE with all-empty member sets yields an empty set', () => {
  const rule: ApproverRule = { type: 'ROLE', roleCodes: ['R1', 'R2'] };
  const members: Record<string, string[]> = { R1: [], R2: [] };
  assert.deepEqual(resolveApproverRule(rule, members), []);
});

test('resolveApproverRule ROLE missing roleCode in map yields an empty set (?? [])', () => {
  const rule: ApproverRule = { type: 'ROLE', roleCodes: ['NOBODY'] };
  assert.deepEqual(resolveApproverRule(rule, {}), []);
});

test('resolveApproverRule ROLE dedupes a member shared across roles to a single entry', () => {
  const rule: ApproverRule = { type: 'ROLE', roleCodes: ['R1', 'R2', 'R3'] };
  const members: Record<string, string[]> = {
    R1: ['u1', 'u2'],
    R2: ['u2', 'u2', 'u3'],
    R3: ['u3'],
  };
  assert.deepEqual(resolveApproverRule(rule, members), ['u1', 'u2', 'u3']);
});

// ===== canTransitionInstance：合法边（终态先行，非恒真） =====

test('canTransitionInstance PENDING permits every target state', () => {
  for (const to of ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
    assert.equal(canTransitionInstance('PENDING', to), true, `PENDING --${to}--> must be true`);
  }
});

test('canTransitionInstance terminal states reject every target state', () => {
  const targets = ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
  for (const from of ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
    for (const to of targets) {
      assert.equal(canTransitionInstance(from, to), false, `${from} --${to}--> must be false`);
    }
  }
});

// ===== assertNotSelfReview：自审防线 =====

test('assertNotSelfReview throws ApprovalError 409 when applicant is among approvers', () => {
  assert.throws(
    () => assertNotSelfReview('u1', ['u2', 'u1', 'u3']),
    (err: unknown) => {
      assert.ok(err instanceof ApprovalError);
      assert.equal(err.code, APPROVAL_SELF_REVIEW_FORBIDDEN);
      assert.equal(err.httpStatus, 409);
      assert.match(err.message, /applicant cannot be approver/);
      return true;
    },
  );
});

test('assertNotSelfReview passes when applicant is not among approvers', () => {
  assert.doesNotThrow(() => assertNotSelfReview('u1', ['u2', 'u3']));
});

test('assertNotSelfReview passes when approver list is empty', () => {
  assert.doesNotThrow(() => assertNotSelfReview('u1', []));
});

// ===== approval-errors：码值钉死 =====

test('approval error code constants pin their stable string values', () => {
  assert.equal(APPROVAL_DEFINITION_NOT_FOUND, 'APPROVAL_DEFINITION_NOT_FOUND');
  assert.equal(APPROVAL_INSTANCE_NOT_FOUND, 'APPROVAL_INSTANCE_NOT_FOUND');
  assert.equal(APPROVAL_TASK_NOT_FOUND, 'APPROVAL_TASK_NOT_FOUND');
  assert.equal(APPROVAL_STATE_INVALID, 'APPROVAL_STATE_INVALID');
  assert.equal(APPROVAL_SELF_REVIEW_FORBIDDEN, 'APPROVAL_SELF_REVIEW_FORBIDDEN');
  assert.equal(APPROVAL_ASSIGNEE_INVALID, 'APPROVAL_ASSIGNEE_INVALID');
  assert.equal(CALLBACK_KEY_CONFLICT, 'CALLBACK_KEY_CONFLICT');
  assert.equal(APPROVAL_DEFINITION_CODE_CONFLICT, 'APPROVAL_DEFINITION_CODE_CONFLICT');
});

test('APPROVAL_ERROR_CODES aggregates every pinned code for service-layer reference', () => {
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, APPROVAL_DEFINITION_NOT_FOUND);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND, APPROVAL_INSTANCE_NOT_FOUND);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, APPROVAL_TASK_NOT_FOUND);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, APPROVAL_STATE_INVALID);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, APPROVAL_SELF_REVIEW_FORBIDDEN);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, APPROVAL_ASSIGNEE_INVALID);
  assert.equal(APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT, CALLBACK_KEY_CONFLICT);
  assert.equal(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_CODE_CONFLICT, APPROVAL_DEFINITION_CODE_CONFLICT);
});

test('APPROVAL_ERROR_HTTP_STATUS pins the default HTTP status per code (404×3 / 409×3 / 400×2)', () => {
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_DEFINITION_NOT_FOUND], 404);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_INSTANCE_NOT_FOUND], 404);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_TASK_NOT_FOUND], 404);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_STATE_INVALID], 409);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_SELF_REVIEW_FORBIDDEN], 409);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_ASSIGNEE_INVALID], 400);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[CALLBACK_KEY_CONFLICT], 409);
  assert.equal(APPROVAL_ERROR_HTTP_STATUS[APPROVAL_DEFINITION_CODE_CONFLICT], 400);
});

test('APPROVAL_ERROR_HTTP_STATUS covers exactly the 8 pinned codes', () => {
  assert.deepEqual(
    Object.keys(APPROVAL_ERROR_HTTP_STATUS).sort(),
    Object.keys(APPROVAL_ERROR_CODES).sort(),
  );
  assert.equal(Object.keys(APPROVAL_ERROR_CODES).length, 8);
});

// ===== ApprovalError 载体形态 =====

test('ApprovalError carries code/httpStatus/message on the instance', () => {
  const err = new ApprovalError(APPROVAL_STATE_INVALID, 409, 'cannot transition terminal instance');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ApprovalError);
  assert.equal(err.name, 'ApprovalError');
  assert.equal(err.code, 'APPROVAL_STATE_INVALID');
  assert.equal(err.httpStatus, 409);
  assert.equal(err.message, 'cannot transition terminal instance');
});

// ===== 类型导出烟测（编译期契约，运行期引用以钉住导出形态） =====

test('approval type exports are usable as type annotations', () => {
  const businessType: ApprovalBusinessType = 'EXPENSE';
  const instanceStatus: ApprovalInstanceStatus = 'PENDING';
  const taskStatus: ApprovalTaskStatus = 'CANCELLED';
  const rule: ApproverRule = { type: 'USER', userIds: ['u1'] };
  assert.equal(businessType, 'EXPENSE');
  assert.equal(instanceStatus, 'PENDING');
  assert.equal(taskStatus, 'CANCELLED');
  assert.deepEqual(rule, { type: 'USER', userIds: ['u1'] });
});
