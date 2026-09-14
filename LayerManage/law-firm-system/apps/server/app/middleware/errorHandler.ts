import { Context } from 'egg';
import { CollaborationError } from '../application/collaboration/collaboration-policy';
import { ApprovalError } from '../domain/approval/approval-errors';
import { CaseError } from '../domain/case/case-errors';
import { PerformanceError } from '../domain/performance/performance-errors';
import { ContractError } from '../domain/contract/contract-errors';
import { CrmError } from '../domain/crm/lead-errors';
import { EventObservabilityUnavailableError } from '../domain/events/event-observability-errors';
import { FinanceError } from '../domain/finance/finance-errors';
import { SecurityError } from '../domain/security/security-errors';

type RequestError = Error & { status?: number; errors?: unknown };

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  try {
    await next();
  } catch (err: unknown) {
    const error: RequestError = err instanceof Error ? err : new Error(String(err));
    if (error instanceof CollaborationError) {
      ctx.status = error.status;
      ctx.body = { code: error.status, message: error.code, errors: error.errors ?? null, timestamp: Date.now() };
      return;
    }
    if (error instanceof EventObservabilityUnavailableError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    if (error instanceof SecurityError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-009 Task 10（R-10c）：CrmError 携带 .httpStatus（非 .status）——无本分支会落 500。
    // 映射只跟实例 httpStatus（绝不切换 code 字符串：VALIDATION_FAILED 实例可能携带 409）。
    if (error instanceof CrmError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-010 Task 10：ContractError 与 CrmError 同构（code/httpStatus/message）——
    // 仿 CrmError 分支按实例 httpStatus 透传，不切换 code 字符串。
    if (error instanceof ContractError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-011 Task 10：FinanceError 与 CrmError/ContractError 同构（code/httpStatus/message）——
    // 仿 ContractError 分支按实例 httpStatus 透传，不切换 code 字符串（EXCEEDED 双态：
    // create 400 / execute 409 由抛出方显式覆盖，此分支原样透传）。
    if (error instanceof FinanceError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-013 Task 6：ApprovalError 与 CrmError/ContractError/FinanceError 同构
    // （code/httpStatus/message）——仿 FinanceError 分支按实例 httpStatus 透传，不切换 code 字符串。
    if (error instanceof ApprovalError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-033 Task 3：CaseError 与 ApprovalError 同构（code/httpStatus/message）——
    // 仿 ApprovalError 分支按实例 httpStatus 透传，不切换 code 字符串（404/409 原样落地）。
    if (error instanceof CaseError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }
    // SPEC-037 Task 3：PerformanceError 与 CaseError 同构（code/httpStatus/message）——
    // 仿 CaseError 分支按实例 httpStatus 透传，不切换 code 字符串（404/409 原样落地）。
    if (error instanceof PerformanceError) {
      ctx.status = error.httpStatus;
      ctx.body = {
        code: error.httpStatus,
        message: error.code,
        errors: null,
        timestamp: Date.now(),
      };
      return;
    }

    const expectedHttpError = typeof error.status === 'number' && error.status < 500;
    const status = expectedHttpError ? error.status as number : 500;
    const message = expectedHttpError
      ? error.message
      : process.env.NODE_ENV === 'development'
        ? error.message
        : 'INTERNAL_SERVER_ERROR';
    ctx.logger.error('Unhandled request error: %s', error.name);
    ctx.status = status;
    ctx.body = {
      code: status,
      message,
      errors: expectedHttpError ? error.errors || null : null,
      timestamp: Date.now(),
    };
  }
};
