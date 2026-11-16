import { SmartCaseIdentity } from '../application/smart-case/identity';
import { Context } from 'egg';
import { createAuthenticationService } from '../application/auth/authentication-factory';
import { isAuthenticationPublicPath } from '../domain/security/auth-paths';
import { SecurityError } from '../domain/security/security-errors';

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  const path = ctx.path;
  if (isAuthenticationPublicPath(path)) {
    await next();
    return;
  }

  const authorization = ctx.get('authorization');
  const [scheme, token, extra] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token || extra) {
    throw new SecurityError('TOKEN_INVALID', 401);
  }

  if(token.startsWith('sc_')) {
    if(!/^\/api\/v1\/(smart-case\/(me|logout|cases|archive|directory|roles)(\/|$)|personal-files(\/|$))/.test(path))throw new SecurityError('TOKEN_INVALID',401);
    ctx.state.user=await new SmartCaseIdentity(ctx.prisma).authenticate(token);
  } else ctx.state.user = await createAuthenticationService(ctx).authenticate(token);
  await next();
};
