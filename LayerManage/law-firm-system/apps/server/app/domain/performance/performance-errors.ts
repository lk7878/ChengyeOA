// SPEC-037 Task 2: performance 域错误（镜像 case-errors 形态——code/httpStatus/message 三参构造）。

export const PERFORMANCE_ERROR_CODES = {
  PERFORMANCE_NOT_FOUND: 'PERFORMANCE_NOT_FOUND',
  PERFORMANCE_STATE_INVALID: 'PERFORMANCE_STATE_INVALID',
  PERFORMANCE_DUPLICATE: 'PERFORMANCE_DUPLICATE',
} as const;

export type PerformanceErrorCode = typeof PERFORMANCE_ERROR_CODES[keyof typeof PERFORMANCE_ERROR_CODES];

export class PerformanceError extends Error {
  constructor(
    public readonly code: PerformanceErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'PerformanceError';
  }
}
