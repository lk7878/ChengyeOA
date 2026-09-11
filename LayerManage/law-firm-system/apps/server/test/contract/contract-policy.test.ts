import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canTransitionContract,
  CONTRACT_ACTIONS,
  CONTRACT_STATUSES,
  CONTRACT_TYPE_CODES,
  CONTRACT_TYPE_POLICY,
  CONTRACT_TYPES,
  type ContractStatus,
  type ContractType,
} from '../../app/domain/contract/contract-policy';
import {
  CONTRACT_APPROVAL_PENDING,
  CONTRACT_ERROR_CODES,
  CONTRACT_ERROR_HTTP_STATUS,
  CONTRACT_NOT_FOUND,
  CONTRACT_STATE_TRANSITION_INVALID,
  ContractError,
  NEGOTIATION_NOT_FOUND,
  PAYMENT_ALREADY_CONFIRMED,
  PAYMENT_AMOUNT_EXCEEDED,
  PAYMENT_NOT_FOUND,
  RECEIVABLE_PLAN_MISMATCH,
  RISK_NOTICE_MISSING,
} from '../../app/domain/contract/contract-errors';

// SPEC-010 Task 3: contract-policy 领域纯函数与 contract-errors 稳定错误码契约测试（TDD 地基）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/contract-policy.test.ts
// 纯单测，不连数据库。

// ===== 词汇表 =====

test('CONTRACT_TYPES exports the design §6.1 type vocabulary in order', () => {
  assert.deepEqual([...CONTRACT_TYPES], ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT', 'RISK_NOTICE']);
});

test('CONTRACT_STATUSES exports the design §6.1 status vocabulary in order', () => {
  assert.deepEqual(
    [...CONTRACT_STATUSES],
    ['DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGN', 'SIGNED', 'EFFECTIVE', 'TERMINATED', 'VOID'],
  );
});

test('CONTRACT_ACTIONS exports the 7 pinned actions', () => {
  assert.deepEqual(
    [...CONTRACT_ACTIONS],
    ['submit', 'approve', 'reject', 'sign', 'effect', 'terminate', 'void'],
  );
});

// ===== 编号类型码 =====

test('CONTRACT_TYPE_CODES pins the number-prefix code per type', () => {
  assert.equal(CONTRACT_TYPE_CODES.FIRST_SIGN, 'FS');
  assert.equal(CONTRACT_TYPE_CODES.FORMAL, 'WT');
  assert.equal(CONTRACT_TYPE_CODES.SUPPLEMENT, 'SA');
  assert.equal(CONTRACT_TYPE_CODES.RISK_NOTICE, 'RN');
});

test('CONTRACT_TYPE_CODES covers exactly the 4 contract types', () => {
  assert.deepEqual(Object.keys(CONTRACT_TYPE_CODES).sort(), [...CONTRACT_TYPES].sort());
});

// ===== 类型政策表（逐字段断言） =====

test('CONTRACT_TYPE_POLICY: FIRST_SIGN/FORMAL/SUPPLEMENT require approval, generate receivable, not terminal at signed', () => {
  for (const type of ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT'] as const) {
    assert.equal(CONTRACT_TYPE_POLICY[type].requiresApproval, true, `${type}.requiresApproval`);
    assert.equal(CONTRACT_TYPE_POLICY[type].generatesReceivable, true, `${type}.generatesReceivable`);
    assert.equal(CONTRACT_TYPE_POLICY[type].terminalAtSigned, false, `${type}.terminalAtSigned`);
  }
});

test('CONTRACT_TYPE_POLICY: RISK_NOTICE skips approval, generates no receivable, terminal at signed', () => {
  assert.equal(CONTRACT_TYPE_POLICY.RISK_NOTICE.requiresApproval, false);
  assert.equal(CONTRACT_TYPE_POLICY.RISK_NOTICE.generatesReceivable, false);
  assert.equal(CONTRACT_TYPE_POLICY.RISK_NOTICE.terminalAtSigned, true);
});

test('CONTRACT_TYPE_POLICY covers exactly the 4 contract types', () => {
  assert.deepEqual(Object.keys(CONTRACT_TYPE_POLICY).sort(), [...CONTRACT_TYPES].sort());
});

// ===== 合法流转（全类型 × 全 action） =====

test('submit: DRAFT → PENDING_APPROVAL for approval-required types', () => {
  for (const type of ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT'] as const) {
    assert.equal(canTransitionContract(type, 'DRAFT', 'submit'), 'PENDING_APPROVAL', `${type} submit`);
  }
});

test('submit: DRAFT → PENDING_SIGN for RISK_NOTICE (no approval)', () => {
  assert.equal(canTransitionContract('RISK_NOTICE', 'DRAFT', 'submit'), 'PENDING_SIGN');
});

test('approve: PENDING_APPROVAL → PENDING_SIGN for approval-required types only', () => {
  for (const type of ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT'] as const) {
    assert.equal(canTransitionContract(type, 'PENDING_APPROVAL', 'approve'), 'PENDING_SIGN', `${type} approve`);
  }
});

test('approve: returns null for RISK_NOTICE (policy gate precedes transition table)', () => {
  assert.equal(canTransitionContract('RISK_NOTICE', 'PENDING_APPROVAL', 'approve'), null);
});

test('reject: PENDING_APPROVAL → DRAFT for all types reachable in that state', () => {
  for (const type of CONTRACT_TYPES) {
    assert.equal(canTransitionContract(type, 'PENDING_APPROVAL', 'reject'), 'DRAFT', `${type} reject`);
  }
});

test('sign: PENDING_SIGN → SIGNED for all types', () => {
  for (const type of CONTRACT_TYPES) {
    assert.equal(canTransitionContract(type, 'PENDING_SIGN', 'sign'), 'SIGNED', `${type} sign`);
  }
});

test('effect: SIGNED → EFFECTIVE for receivable-generating types only', () => {
  for (const type of ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT'] as const) {
    assert.equal(canTransitionContract(type, 'SIGNED', 'effect'), 'EFFECTIVE', `${type} effect`);
  }
});

test('effect: returns null for RISK_NOTICE (no effect action; SIGNED is its terminal state)', () => {
  assert.equal(canTransitionContract('RISK_NOTICE', 'SIGNED', 'effect'), null);
});

test('terminate: EFFECTIVE → TERMINATED for receivable-generating types', () => {
  for (const type of ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT'] as const) {
    assert.equal(canTransitionContract(type, 'EFFECTIVE', 'terminate'), 'TERMINATED', `${type} terminate`);
  }
});

test('void: DRAFT|PENDING_APPROVAL|PENDING_SIGN → VOID for all types', () => {
  const voidable: ReadonlyArray<ContractStatus> = ['DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGN'];
  for (const type of CONTRACT_TYPES) {
    for (const from of voidable) {
      assert.equal(canTransitionContract(type, from, 'void'), 'VOID', `${type} void from ${from}`);
    }
  }
});

// ===== 非法流转返 null =====

test('terminal states TERMINATED/VOID reject every action', () => {
  for (const type of CONTRACT_TYPES) {
    for (const from of ['TERMINATED', 'VOID'] as const) {
      for (const action of CONTRACT_ACTIONS) {
        assert.equal(
          canTransitionContract(type, from, action),
          null,
          `${type} ${action} from ${from} must be null`,
        );
      }
    }
  }
});

test('EFFECTIVE → VOID is rejected', () => {
  for (const type of CONTRACT_TYPES) {
    assert.equal(canTransitionContract(type, 'EFFECTIVE', 'void'), null, `${type} EFFECTIVE→void`);
  }
});

test('SIGNED → submit is rejected', () => {
  for (const type of CONTRACT_TYPES) {
    assert.equal(canTransitionContract(type, 'SIGNED', 'submit'), null, `${type} SIGNED→submit`);
  }
});

test('non-terminal states reject actions outside their outgoing edges', () => {
  const cases: ReadonlyArray<readonly [ContractType, ContractStatus, (typeof CONTRACT_ACTIONS)[number]]> = [
    ['FIRST_SIGN', 'DRAFT', 'approve'],
    ['FIRST_SIGN', 'DRAFT', 'sign'],
    ['FIRST_SIGN', 'DRAFT', 'effect'],
    ['FIRST_SIGN', 'DRAFT', 'terminate'],
    ['FORMAL', 'PENDING_APPROVAL', 'sign'],
    ['FORMAL', 'PENDING_APPROVAL', 'effect'],
    ['SUPPLEMENT', 'PENDING_SIGN', 'approve'],
    ['SUPPLEMENT', 'PENDING_SIGN', 'submit'],
    ['FIRST_SIGN', 'SIGNED', 'sign'],
    ['FIRST_SIGN', 'SIGNED', 'terminate'],
    ['FIRST_SIGN', 'SIGNED', 'void'],
    ['FORMAL', 'EFFECTIVE', 'submit'],
    ['FORMAL', 'EFFECTIVE', 'sign'],
    ['FORMAL', 'EFFECTIVE', 'effect'],
    ['RISK_NOTICE', 'DRAFT', 'approve'],
    ['RISK_NOTICE', 'PENDING_SIGN', 'effect'],
  ];
  for (const [type, from, action] of cases) {
    assert.equal(canTransitionContract(type, from, action), null, `${type} ${from} --${action}--> must be null`);
  }
});

// ===== 错误码与错误载体 =====

test('error code constants pin their stable string values', () => {
  assert.equal(CONTRACT_NOT_FOUND, 'CONTRACT_NOT_FOUND');
  assert.equal(NEGOTIATION_NOT_FOUND, 'NEGOTIATION_NOT_FOUND');
  assert.equal(PAYMENT_NOT_FOUND, 'PAYMENT_NOT_FOUND');
  assert.equal(CONTRACT_STATE_TRANSITION_INVALID, 'CONTRACT_STATE_TRANSITION_INVALID');
  assert.equal(CONTRACT_APPROVAL_PENDING, 'CONTRACT_APPROVAL_PENDING');
  assert.equal(RISK_NOTICE_MISSING, 'RISK_NOTICE_MISSING');
  assert.equal(PAYMENT_ALREADY_CONFIRMED, 'PAYMENT_ALREADY_CONFIRMED');
  assert.equal(PAYMENT_AMOUNT_EXCEEDED, 'PAYMENT_AMOUNT_EXCEEDED');
  assert.equal(RECEIVABLE_PLAN_MISMATCH, 'RECEIVABLE_PLAN_MISMATCH');
});

test('CONTRACT_ERROR_CODES aggregates every pinned code for service-layer reference', () => {
  assert.equal(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, CONTRACT_NOT_FOUND);
  assert.equal(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND, NEGOTIATION_NOT_FOUND);
  assert.equal(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND, PAYMENT_NOT_FOUND);
  assert.equal(CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID, CONTRACT_STATE_TRANSITION_INVALID);
  assert.equal(CONTRACT_ERROR_CODES.CONTRACT_APPROVAL_PENDING, CONTRACT_APPROVAL_PENDING);
  assert.equal(CONTRACT_ERROR_CODES.RISK_NOTICE_MISSING, RISK_NOTICE_MISSING);
  assert.equal(CONTRACT_ERROR_CODES.PAYMENT_ALREADY_CONFIRMED, PAYMENT_ALREADY_CONFIRMED);
  assert.equal(CONTRACT_ERROR_CODES.PAYMENT_AMOUNT_EXCEEDED, PAYMENT_AMOUNT_EXCEEDED);
  assert.equal(CONTRACT_ERROR_CODES.RECEIVABLE_PLAN_MISMATCH, RECEIVABLE_PLAN_MISMATCH);
});

test('CONTRACT_ERROR_HTTP_STATUS pins the HTTP status per code', () => {
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[CONTRACT_NOT_FOUND], 404);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[NEGOTIATION_NOT_FOUND], 404);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[PAYMENT_NOT_FOUND], 404);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[CONTRACT_STATE_TRANSITION_INVALID], 409);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[CONTRACT_APPROVAL_PENDING], 409);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[RISK_NOTICE_MISSING], 409);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[PAYMENT_ALREADY_CONFIRMED], 409);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[PAYMENT_AMOUNT_EXCEEDED], 409);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[RECEIVABLE_PLAN_MISMATCH], 400);
});

test('ContractError carries code/httpStatus/message on the instance (CrmError shape)', () => {
  const err = new ContractError(CONTRACT_STATE_TRANSITION_INVALID, 409, 'cannot effect RISK_NOTICE');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ContractError);
  assert.equal(err.name, 'ContractError');
  assert.equal(err.code, 'CONTRACT_STATE_TRANSITION_INVALID');
  assert.equal(err.httpStatus, 409);
  assert.equal(err.message, 'cannot effect RISK_NOTICE');
});
