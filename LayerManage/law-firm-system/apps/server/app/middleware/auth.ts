import { Context } from 'egg';
import * as jwt from 'jsonwebtoken';

export default () => {
  // 不需要认证的路径（白名单）
  const publicPaths = [
    '/api/health',
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
  ];

  // 需要认证的路径前缀
  const authPrefixes = [
    '/api/v1/auth/me',
    '/api/v1/auth/logout',
    '/api/v1/users',
    '/api/v1/roles',
    '/api/v1/permissions',
    '/api/v1/organizations',
    '/api/v1/positions',
    '/api/v1/employees',
    '/api/v1/channels',
    '/api/v1/leads',
    '/api/v1/customers',
    '/api/v1/contracts',
    '/api/v1/payments',
    '/api/v1/cases',
    '/api/v1/approvals',
    '/api/v1/notifications',
    '/api/v1/performances',
    '/api/v1/dashboard',
  ];

  return async (ctx: Context, next: () => Promise<unknown>) => {
    const { app } = ctx;
    const path = ctx.path;

    // 检查是否是公开路径（白名单）
    const isPublic = publicPaths.some(p => path === p || path.startsWith(p + '/'));
    if (isPublic) {
      await next();
      return;
    }

    // 检查是否需要认证
    const needAuth = authPrefixes.some(p => path.startsWith(p));
    if (!needAuth) {
      await next();
      return;
    }

    // 获取 Token
    const authorization = ctx.get('authorization');
    if (!authorization) {
      ctx.throw(401, '未提供认证令牌');
    }

    const parts = authorization.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      ctx.throw(401, '认证格式错误');
    }

    const token = parts[1];

    try {
      // 验证 Token
      const decoded = jwt.verify(token, app.config.jwt.secret) as jwt.JwtPayload;
      ctx.state.user = decoded;
      await next();
    } catch {
      ctx.throw(401, '认证令牌无效或已过期');
    }
  };
};
