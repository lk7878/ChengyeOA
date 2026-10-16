// SPEC-009 Task 3: CRM 线索/邀约/客户稳定错误码与错误载体。
// 设计 §7 错误码体系：code 为 HTTP 语义稳定字符串码，httpStatus 为对应状态码。

export const LEAD_NOT_FOUND = 'LEAD_NOT_FOUND';
export const LEAD_IN_USE = 'LEAD_IN_USE';
export const LEAD_STATE_TRANSITION_INVALID = 'LEAD_STATE_TRANSITION_INVALID';
export const LEAD_NOT_IN_POOL = 'LEAD_NOT_IN_POOL';
export const APPOINTMENT_CONFLICT = 'APPOINTMENT_CONFLICT';
export const CUSTOMER_ALREADY_CONVERTED = 'CUSTOMER_ALREADY_CONVERTED';

// SPEC-039：客户域转介绍端点（/customers/:id/referrals）客户存在性探针——404。
export const CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';
export const CUSTOMER_IN_USE = 'CUSTOMER_IN_USE';

// SPEC-009 Task 6（决策 3）：公海领取要求 actor 账号绑定员工（User.employeeId → context.employeeId），
// 未绑定时无法确立归属，抛 403。归属授权上下文缺陷而非入参校验失败，故独立于 VALIDATION_FAILED。
export const ACTOR_EMPLOYEE_UNBOUND = 'ACTOR_EMPLOYEE_UNBOUND';

// 本域校验失败专用稳定码：电话/wechat 等字段规范化失败统一归到 400。
export const LEAD_PHONE_INVALID = 'LEAD_PHONE_INVALID';

export type CrmErrorCode =
  | typeof LEAD_IN_USE
  | typeof LEAD_NOT_FOUND
  | typeof LEAD_STATE_TRANSITION_INVALID
  | typeof LEAD_NOT_IN_POOL
  | typeof APPOINTMENT_CONFLICT
  | typeof CUSTOMER_ALREADY_CONVERTED
  | typeof ACTOR_EMPLOYEE_UNBOUND
  | typeof LEAD_PHONE_INVALID
  | typeof CUSTOMER_NOT_FOUND
  | typeof CUSTOMER_IN_USE;

export class CrmError extends Error {
  constructor(
    public readonly code: CrmErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}
