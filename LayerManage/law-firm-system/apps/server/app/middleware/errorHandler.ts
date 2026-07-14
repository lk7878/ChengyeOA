import { Context } from 'egg';

type RequestError = Error & { status?: number; errors?: unknown };

export default () => {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    try {
      await next();
    } catch (err: unknown) {
      const error: RequestError = err instanceof Error ? err : new Error(String(err));
      // 记录错误日志
      ctx.logger.error(error);

      // 统一错误响应
      const status = error.status || 500;
      const message = error.message || '服务器内部错误';

      ctx.status = status;
      ctx.body = {
        code: status,
        message,
        errors: error.errors || null,
        timestamp: Date.now(),
      };
    }
  };
};
