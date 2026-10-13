// SPEC-033 Task 2: case 域错误（镜像 finance-errors 形态——code/httpStatus/message 三参构造）。

export const CASE_ERROR_CODES = {
  CASE_NOT_FOUND: 'CASE_NOT_FOUND',
  CASE_CUSTOMER_UNAVAILABLE: 'CASE_CUSTOMER_UNAVAILABLE',
  CASE_IN_USE: 'CASE_IN_USE',
  CASE_TASK_NOT_FOUND: 'CASE_TASK_NOT_FOUND',
  CASE_STATE_INVALID: 'CASE_STATE_INVALID',
  CASE_TASK_STATE_INVALID: 'CASE_TASK_STATE_INVALID',
  // SPEC-035：乐观锁冲突——消息与成本域 VERSION_CONFLICT 对齐（前端拦截器统一语义）。
  CASE_VERSION_CONFLICT: 'VERSION_CONFLICT',
  // SPEC-042：案件文件/证据——文件不存在 / 入参非法（base64 解码失败等）。
  CASE_FILE_NOT_FOUND: 'CASE_FILE_NOT_FOUND',
  CASE_FILE_INVALID: 'CASE_FILE_INVALID',
} as const;

export type CaseErrorCode = typeof CASE_ERROR_CODES[keyof typeof CASE_ERROR_CODES];

export class CaseError extends Error {
  constructor(
    public readonly code: CaseErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'CaseError';
  }
}
