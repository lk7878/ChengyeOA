import { Context } from 'egg';
import { SecurityError } from '../domain/security/security-errors';

type RequestError = Error & { status?: number; errors?: unknown };

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  try {
    await next();
  } catch (err: unknown) {
    const error: RequestError = err instanceof Error ? err : new Error(String(err));
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
