import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTRACT_ERROR_CODES,
  CONTRACT_ERROR_HTTP_STATUS,
  PAYMENT_STATE_INVALID,
} from '../../app/domain/contract/contract-errors';
import {
  COST_ANCHOR_FORBIDDEN,
  COST_ANCHOR_REQUIRED,
  COST_NOT_FOUND,
  FINANCE_ERROR_CODES,
  FINANCE_ERROR_HTTP_STATUS,
  FinanceError,
  INVOICE_AMOUNT_EXCEEDED,
  INVOICE_NOT_FOUND,
  INVOICE_STATE_INVALID,
  REFUND_AMOUNT_MISMATCH,
  REFUND_NOT_FOUND,
  REFUND_STATE_INVALID,
  WAIVER_AMOUNT_EXCEEDED,
  WAIVER_PLAN_STATE_INVALID,
} from '../../app/domain/finance/finance-errors';
import {
  assertCostAnchorShape,
  canTransitionInvoice,
  canTransitionRefundRequest,
  type InvoiceAction,
  type RefundRequestAction,
} from '../../app/domain/finance/finance-policy';
import {
  COST_CATEGORIES,
  INVOICE_STATUSES,
  REFUND_REQUEST_STATUSES,
  REFUND_REQUEST_TYPES,
  type CostCategory,
  type InvoiceStatus,
  type RefundRequestStatus,
} from '../../app/domain/finance/finance-types';

// SPEC-011 Task 3: finance-policy 领域纯函数与 finance-errors 稳定错误码契约测试（TDD 地基）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/finance-policy.test.ts
// 纯单测，不连数据库。覆盖简报 Step 5 全矩阵：①两状态机全部合法边；②全部非法边
// （终态×3 动作、跨级跳转、重放）；③锚点矩阵 5 类别×{双null/双填/正确填/交叉填}；
// ④错误实例 httpStatus=400。另钉 finance-types 词汇表、finance-errors 码值/聚合/HTTP 状态，
// 以及 contract-errors 新增 PAYMENT_STATE_INVALID 的三点落位（Task 6/7 消费）。

// ===== 词汇表（finance-types） =====

test('INVOICE_STATUSES exports the design §6.1 invoice status vocabulary in order', () => {
  assert.deepEqual([...INVOICE_STATUSES], ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']);
});

test('REFUND_REQUEST_TYPES exports the refund/waiver type vocabulary in order', () => {
  assert.deepEqual([...REFUND_REQUEST_TYPES], ['REFUND', 'WAIVER']);
});

test('REFUND_REQUEST_STATUSES exports the refund request status vocabulary in order', () => {
  assert.deepEqual([...REFUND_REQUEST_STATUSES], ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED']);
});

test('COST_CATEGORIES exports the design §5.3 cost category vocabulary in order', () => {
  assert.deepEqual([...COST_CATEGORIES], ['CHANNEL', 'EVIDENCE', 'CASE_HANDLING', 'LABOR', 'OFFICE']);
});

// ===== InvoiceRequest 状态机：合法边 =====

test('invoice approve: PENDING → APPROVED', () => {
  assert.equal(canTransitionInvoice('PENDING', 'approve'), 'APPROVED');
});

test('invoice reject: PENDING → REJECTED', () => {
  assert.equal(canTransitionInvoice('PENDING', 'reject'), 'REJECTED');
});

test('invoice complete: APPROVED → COMPLETED', () => {
  assert.equal(canTransitionInvoice('APPROVED', 'complete'), 'COMPLETED');
});

// ===== InvoiceRequest 状态机：非法边 =====

test('invoice terminal states REJECTED/COMPLETED reject every action', () => {
  const actions: ReadonlyArray<InvoiceAction> = ['approve', 'reject', 'complete'];
  for (const from of ['REJECTED', 'COMPLETED'] as const) {
    for (const action of actions) {
      assert.equal(canTransitionInvoice(from, action), null, `invoice ${action} from ${from} must be null`);
    }
  }
});

test('invoice cross-level jump PENDING --complete--> is rejected', () => {
  assert.equal(canTransitionInvoice('PENDING', 'complete'), null);
});

test('invoice APPROVED --approve--> replay is rejected', () => {
  assert.equal(canTransitionInvoice('APPROVED', 'approve'), null);
});

test('invoice APPROVED --reject--> is rejected (decision closed after approve)', () => {
  assert.equal(canTransitionInvoice('APPROVED', 'reject'), null);
});

test('invoice state machine rejects every (status, action) pair outside the 3 legal edges', () => {
  const legal = new Set(['PENDING:approve', 'PENDING:reject', 'APPROVED:complete']);
  const actions: ReadonlyArray<InvoiceAction> = ['approve', 'reject', 'complete'];
  for (const from of INVOICE_STATUSES) {
    for (const action of actions) {
      if (legal.has(`${from}:${action}`)) continue;
      assert.equal(canTransitionInvoice(from, action), null, `invoice ${from} --${action}--> must be null`);
    }
  }
});

// ===== RefundRequest 状态机：合法边 =====

test('refund approve: PENDING → APPROVED', () => {
  assert.equal(canTransitionRefundRequest('PENDING', 'approve'), 'APPROVED');
});

test('refund reject: PENDING → REJECTED', () => {
  assert.equal(canTransitionRefundRequest('PENDING', 'reject'), 'REJECTED');
});

test('refund execute: APPROVED → EXECUTED', () => {
  assert.equal(canTransitionRefundRequest('APPROVED', 'execute'), 'EXECUTED');
});

// ===== RefundRequest 状态机：非法边 =====

test('refund terminal states REJECTED/EXECUTED reject every action', () => {
  const actions: ReadonlyArray<RefundRequestAction> = ['approve', 'reject', 'execute'];
  for (const from of ['REJECTED', 'EXECUTED'] as const) {
    for (const action of actions) {
      assert.equal(canTransitionRefundRequest(from, action), null, `refund ${action} from ${from} must be null`);
    }
  }
});

test('refund cross-level jump PENDING --execute--> is rejected', () => {
  assert.equal(canTransitionRefundRequest('PENDING', 'execute'), null);
});

test('refund APPROVED --approve--> replay is rejected', () => {
  assert.equal(canTransitionRefundRequest('APPROVED', 'approve'), null);
});

test('refund APPROVED --reject--> is rejected (decision closed after approve)', () => {
  assert.equal(canTransitionRefundRequest('APPROVED', 'reject'), null);
});

test('refund state machine rejects every (status, action) pair outside the 3 legal edges', () => {
  const legal = new Set(['PENDING:approve', 'PENDING:reject', 'APPROVED:execute']);
  const actions: ReadonlyArray<RefundRequestAction> = ['approve', 'reject', 'execute'];
  for (const from of REFUND_REQUEST_STATUSES) {
    for (const action of actions) {
      if (legal.has(`${from}:${action}`)) continue;
      assert.equal(canTransitionRefundRequest(from, action), null, `refund ${from} --${action}--> must be null`);
    }
  }
});

// ===== 成本锚点矩阵（设计 §5.3）：合法形态不抛 =====

test('anchor matrix happy path: CHANNEL with channelId only passes', () => {
  assert.doesNotThrow(() => assertCostAnchorShape('CHANNEL', 'channel-1', null));
});

test('anchor matrix happy path: EVIDENCE/CASE_HANDLING with caseId only passes', () => {
  for (const category of ['EVIDENCE', 'CASE_HANDLING'] as const) {
    assert.doesNotThrow(() => assertCostAnchorShape(category, null, 'case-1'), `${category} happy path`);
  }
});

test('anchor matrix happy path: LABOR/OFFICE with both anchors null passes', () => {
  for (const category of ['LABOR', 'OFFICE'] as const) {
    assert.doesNotThrow(() => assertCostAnchorShape(category, null, null), `${category} happy path`);
  }
});

// ===== 成本锚点矩阵：CHANNEL 违规 =====

test('CHANNEL with both anchors null throws COST_ANCHOR_REQUIRED (400)', () => {
  assert.throws(
    () => assertCostAnchorShape('CHANNEL', null, null),
    (err: unknown) => {
      assert.ok(err instanceof FinanceError);
      assert.equal(err.code, COST_ANCHOR_REQUIRED);
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
});

test('CHANNEL with caseId but no channelId throws COST_ANCHOR_REQUIRED (channelId checked first)', () => {
  assert.throws(
    () => assertCostAnchorShape('CHANNEL', null, 'case-1'),
    (err: unknown) => {
      assert.ok(err instanceof FinanceError);
      assert.equal(err.code, COST_ANCHOR_REQUIRED);
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
});

test('CHANNEL with both anchors filled throws COST_ANCHOR_FORBIDDEN (caseId forbidden)', () => {
  assert.throws(
    () => assertCostAnchorShape('CHANNEL', 'channel-1', 'case-1'),
    (err: unknown) => {
      assert.ok(err instanceof FinanceError);
      assert.equal(err.code, COST_ANCHOR_FORBIDDEN);
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
});

// ===== 成本锚点矩阵：EVIDENCE / CASE_HANDLING 违规 =====

test('EVIDENCE/CASE_HANDLING with both anchors null throws COST_ANCHOR_REQUIRED', () => {
  for (const category of ['EVIDENCE', 'CASE_HANDLING'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, null, null),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_REQUIRED);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} both null`,
    );
  }
});

test('EVIDENCE/CASE_HANDLING with channelId but no caseId throws COST_ANCHOR_REQUIRED (caseId checked first)', () => {
  for (const category of ['EVIDENCE', 'CASE_HANDLING'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, 'channel-1', null),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_REQUIRED);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} channelId only`,
    );
  }
});

test('EVIDENCE/CASE_HANDLING with both anchors filled throws COST_ANCHOR_FORBIDDEN (channelId forbidden)', () => {
  for (const category of ['EVIDENCE', 'CASE_HANDLING'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, 'channel-1', 'case-1'),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_FORBIDDEN);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} both filled`,
    );
  }
});

// ===== 成本锚点矩阵：LABOR / OFFICE 违规（两锚均禁填） =====

test('LABOR/OFFICE with channelId throws COST_ANCHOR_FORBIDDEN', () => {
  for (const category of ['LABOR', 'OFFICE'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, 'channel-1', null),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_FORBIDDEN);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} channelId forbidden`,
    );
  }
});

test('LABOR/OFFICE with caseId throws COST_ANCHOR_FORBIDDEN', () => {
  for (const category of ['LABOR', 'OFFICE'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, null, 'case-1'),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_FORBIDDEN);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} caseId forbidden`,
    );
  }
});

test('LABOR/OFFICE with both anchors filled throws COST_ANCHOR_FORBIDDEN (channelId checked first)', () => {
  for (const category of ['LABOR', 'OFFICE'] as const) {
    assert.throws(
      () => assertCostAnchorShape(category, 'channel-1', 'case-1'),
      (err: unknown) => {
        assert.ok(err instanceof FinanceError);
        assert.equal(err.code, COST_ANCHOR_FORBIDDEN);
        assert.equal(err.httpStatus, 400);
        return true;
      },
      `${category} both filled`,
    );
  }
});

// ===== 成本锚点矩阵：未知类别 =====

test('unknown cost category throws COST_ANCHOR_REQUIRED (400)', () => {
  const unknown = 'TRAVEL' as CostCategory;
  assert.throws(
    () => assertCostAnchorShape(unknown, null, null),
    (err: unknown) => {
      assert.ok(err instanceof FinanceError);
      assert.equal(err.code, COST_ANCHOR_REQUIRED);
      assert.equal(err.httpStatus, 400);
      assert.match(err.message, /unknown cost category/);
      return true;
    },
  );
});

// ===== finance-errors：码值钉死 =====

test('finance error code constants pin their stable string values', () => {
  assert.equal(INVOICE_NOT_FOUND, 'INVOICE_NOT_FOUND');
  assert.equal(REFUND_NOT_FOUND, 'REFUND_NOT_FOUND');
  assert.equal(COST_NOT_FOUND, 'COST_NOT_FOUND');
  assert.equal(INVOICE_STATE_INVALID, 'INVOICE_STATE_INVALID');
  assert.equal(REFUND_STATE_INVALID, 'REFUND_STATE_INVALID');
  assert.equal(WAIVER_PLAN_STATE_INVALID, 'WAIVER_PLAN_STATE_INVALID');
  assert.equal(INVOICE_AMOUNT_EXCEEDED, 'INVOICE_AMOUNT_EXCEEDED');
  assert.equal(WAIVER_AMOUNT_EXCEEDED, 'WAIVER_AMOUNT_EXCEEDED');
  assert.equal(REFUND_AMOUNT_MISMATCH, 'REFUND_AMOUNT_MISMATCH');
  assert.equal(COST_ANCHOR_REQUIRED, 'COST_ANCHOR_REQUIRED');
  assert.equal(COST_ANCHOR_FORBIDDEN, 'COST_ANCHOR_FORBIDDEN');
});

test('FINANCE_ERROR_CODES aggregates every pinned code for service-layer reference', () => {
  assert.equal(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, INVOICE_NOT_FOUND);
  assert.equal(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, REFUND_NOT_FOUND);
  assert.equal(FINANCE_ERROR_CODES.COST_NOT_FOUND, COST_NOT_FOUND);
  assert.equal(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, INVOICE_STATE_INVALID);
  assert.equal(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, REFUND_STATE_INVALID);
  assert.equal(FINANCE_ERROR_CODES.WAIVER_PLAN_STATE_INVALID, WAIVER_PLAN_STATE_INVALID);
  assert.equal(FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED, INVOICE_AMOUNT_EXCEEDED);
  assert.equal(FINANCE_ERROR_CODES.WAIVER_AMOUNT_EXCEEDED, WAIVER_AMOUNT_EXCEEDED);
  assert.equal(FINANCE_ERROR_CODES.REFUND_AMOUNT_MISMATCH, REFUND_AMOUNT_MISMATCH);
  assert.equal(FINANCE_ERROR_CODES.COST_ANCHOR_REQUIRED, COST_ANCHOR_REQUIRED);
  assert.equal(FINANCE_ERROR_CODES.COST_ANCHOR_FORBIDDEN, COST_ANCHOR_FORBIDDEN);
});

test('FINANCE_ERROR_HTTP_STATUS pins the default HTTP status per code', () => {
  assert.equal(FINANCE_ERROR_HTTP_STATUS[INVOICE_NOT_FOUND], 404);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[REFUND_NOT_FOUND], 404);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[COST_NOT_FOUND], 404);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[INVOICE_STATE_INVALID], 409);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[REFUND_STATE_INVALID], 409);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[WAIVER_PLAN_STATE_INVALID], 409);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[INVOICE_AMOUNT_EXCEEDED], 400);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[WAIVER_AMOUNT_EXCEEDED], 400);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[REFUND_AMOUNT_MISMATCH], 400);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[COST_ANCHOR_REQUIRED], 400);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[COST_ANCHOR_FORBIDDEN], 400);
});

test('FINANCE_ERROR_HTTP_STATUS covers exactly the 11 pinned codes', () => {
  assert.deepEqual(
    Object.keys(FINANCE_ERROR_HTTP_STATUS).sort(),
    Object.keys(FINANCE_ERROR_CODES).sort(),
  );
  assert.equal(Object.keys(FINANCE_ERROR_CODES).length, 11);
});

// ===== FinanceError 载体形态 =====

test('FinanceError carries code/httpStatus/message on the instance', () => {
  const err = new FinanceError(INVOICE_STATE_INVALID, 409, 'cannot complete PENDING invoice');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof FinanceError);
  assert.equal(err.name, 'FinanceError');
  assert.equal(err.code, 'INVOICE_STATE_INVALID');
  assert.equal(err.httpStatus, 409);
  assert.equal(err.message, 'cannot complete PENDING invoice');
});

test('FinanceError dual-state EXCEEDED codes: thrower overrides default 400 with explicit 409', () => {
  // 双态码语义钉（简报裁决）：EXCEEDED 创建时 400（默认值），执行/审批重验时由抛出方
  // 显式传 httpStatus=409 覆盖——服务层 Task 5/6 消费此形态。
  const err = new FinanceError(WAIVER_AMOUNT_EXCEEDED, 409, 'waiver exceeds plan remainder at execution');
  assert.equal(err.code, 'WAIVER_AMOUNT_EXCEEDED');
  assert.equal(err.httpStatus, 409);
  assert.equal(FINANCE_ERROR_HTTP_STATUS[WAIVER_AMOUNT_EXCEEDED], 400);
});

// ===== contract-errors 追加：PAYMENT_STATE_INVALID 三点落位 =====

test('contract-errors PAYMENT_STATE_INVALID pins constant, aggregate member and HTTP 409', () => {
  assert.equal(PAYMENT_STATE_INVALID, 'PAYMENT_STATE_INVALID');
  assert.equal(CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID, PAYMENT_STATE_INVALID);
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[PAYMENT_STATE_INVALID], 409);
});

// ===== 类型导出烟测（编译期契约，运行期引用以钉住导出形态） =====

test('finance type exports are usable as type annotations', () => {
  const invoiceStatus: InvoiceStatus = 'PENDING';
  const refundStatus: RefundRequestStatus = 'EXECUTED';
  const category: CostCategory = 'OFFICE';
  assert.equal(invoiceStatus, 'PENDING');
  assert.equal(refundStatus, 'EXECUTED');
  assert.equal(category, 'OFFICE');
});
