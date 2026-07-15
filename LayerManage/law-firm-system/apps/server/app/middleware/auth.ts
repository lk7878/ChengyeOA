import { Context } from 'egg';
import { createAuthenticationService } from '../application/auth/authentication-factory';
import { SecurityError } from '../domain/security/security-errors';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
]);

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  const path = ctx.path;
  if (PUBLIC_PATHS.has(path)) {
    await next();
    return;
  }

  const authorization = ctx.get('authorization');
  const [scheme, token, extra] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token || extra) {
    throw new SecurityError('TOKEN_INVALID', 401);
  }

  const allowedTokenTypes = path === '/api/v1/auth/password/forced-change'
    ? ['password_change'] as const
    : path === '/api/v1/auth/logout'
      ? ['access', 'password_change'] as const
      : ['access'] as const;
  ctx.state.user = await createAuthenticationService(ctx).authenticate(token, allowedTokenTypes);
  await next();
};
