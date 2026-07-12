import { Context } from 'egg';

export default () => {
  return async (ctx: Context, next: () => Promise<any>) => {
    try {
      await next();
    } catch (err: any) {
      // 记录错误日志
      ctx.logger.error(err);

      // 统一错误响应
      const status = err.status || 500;
      const message = err.message || '服务器内部错误';

      ctx.status = status;
      ctx.body = {
        code: status,
        message,
        errors: err.errors || null,
        timestamp: Date.now(),
      };
    }
  };
};
