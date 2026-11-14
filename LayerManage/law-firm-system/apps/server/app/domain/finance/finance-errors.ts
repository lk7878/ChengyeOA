// SPEC-011 Task 3: invoice/refund/cost 域稳定错误码与错误载体。
// 形态逐字仿 domain/contract/contract-errors.ts：个体常量 + 联合类型 + 聚合对象 + Error 子类。
// VALIDATION_FAILED/VERSION_CONFLICT 复用 MasterDataError，不在本文件重复定义。

export const INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND';
export const REFUND_NOT_FOUND = 'REFUND_NOT_FOUND';
export const COST_NOT_FOUND = 'COST_NOT_FOUND';
export const INVOICE_STATE_INVALID = 'INVOICE_STATE_INVALID';
export const REFUND_STATE_INVALID = 'REFUND_STATE_INVALID';
export const WAIVER_PLAN_STATE_INVALID = 'WAIVER_PLAN_STATE_INVALID';
export const INVOICE_AMOUNT_EXCEEDED = 'INVOICE_AMOUNT_EXCEEDED';
export const WAIVER_AMOUNT_EXCEEDED = 'WAIVER_AMOUNT_EXCEEDED';
export const REFUND_AMOUNT_MISMATCH = 'REFUND_AMOUNT_MISMATCH';
export const COST_ANCHOR_REQUIRED = 'COST_ANCHOR_REQUIRED';
export const COST_ANCHOR_FORBIDDEN = 'COST_ANCHOR_FORBIDDEN';

export type FinanceErrorCode =
  | typeof INVOICE_NOT_FOUND
  | typeof REFUND_NOT_FOUND
  | typeof COST_NOT_FOUND
  | typeof INVOICE_STATE_INVALID
  | typeof REFUND_STATE_INVALID
  | typeof WAIVER_PLAN_STATE_INVALID
  | typeof INVOICE_AMOUNT_EXCEEDED
  | typeof WAIVER_AMOUNT_EXCEEDED
  | typeof REFUND_AMOUNT_MISMATCH
  | typeof COST_ANCHOR_REQUIRED
  | typeof COST_ANCHOR_FORBIDDEN;

export const FINANCE_ERROR_CODES = {
  INVOICE_NOT_FOUND,
  REFUND_NOT_FOUND,
  COST_NOT_FOUND,
  INVOICE_STATE_INVALID,
  REFUND_STATE_INVALID,
  WAIVER_PLAN_STATE_INVALID,
  INVOICE_AMOUNT_EXCEEDED,
  WAIVER_AMOUNT_EXCEEDED,
  REFUND_AMOUNT_MISMATCH,
  COST_ANCHOR_REQUIRED,
  COST_ANCHOR_FORBIDDEN,
} as const;

/** 每个稳定码钉死的默认 HTTP 状态码；双态码（EXCEEDED 创建 400/执行 409）由抛出方显式覆盖。 */
export const FINANCE_ERROR_HTTP_STATUS: Readonly<Record<FinanceErrorCode, number>> = {
  [INVOICE_NOT_FOUND]: 404,
  [REFUND_NOT_FOUND]: 404,
  [COST_NOT_FOUND]: 404,
  [INVOICE_STATE_INVALID]: 409,
  [REFUND_STATE_INVALID]: 409,
  [WAIVER_PLAN_STATE_INVALID]: 409,
  [INVOICE_AMOUNT_EXCEEDED]: 400,
  [WAIVER_AMOUNT_EXCEEDED]: 400,
  [REFUND_AMOUNT_MISMATCH]: 400,
  [COST_ANCHOR_REQUIRED]: 400,
  [COST_ANCHOR_FORBIDDEN]: 400,
};

export class FinanceError extends Error {
  constructor(
    public readonly code: FinanceErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}
