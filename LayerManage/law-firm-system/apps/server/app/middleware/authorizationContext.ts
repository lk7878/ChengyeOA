import { Context } from 'egg';
import { AuthorizationContextLoader } from '../application/authorization/authorization-context-loader';
import { createAuthorizationContextLoader } from '../application/authorization/authorization-factory';
import { AuthorizationError, AUTHORIZATION_CODES } from '../domain/authorization/authorization-errors';
import { isAuthenticationPublicPath } from '../domain/security/auth-paths';

type LoaderFactory = (ctx: Context) => Pick<AuthorizationContextLoader, 'load'>;

export function isAuthorizationPublicPath(path: string): boolean {
  return isAuthenticationPublicPath(path);
}

export function authorizationContextMiddleware(loaderFactory: LoaderFactory) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    if (isAuthorizationPublicPath(ctx.path)) {
      await next();
      return;
    }
    const userId = ctx.state.user?.userId;
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthorizationError(AUTHORIZATION_CODES.authentication, 401);
    }
    if (!ctx.state.authorization) {
      ctx.state.authorization = await loaderFactory(ctx).load(userId);
    }
    await next();
  };
}

export default () => authorizationContextMiddleware(createAuthorizationContextLoader);
