import { Context } from 'egg';
import { createAuthorizationService } from '../application/authorization/authorization-factory';
import { AuthorizationError, AUTHORIZATION_CODES } from '../domain/authorization/authorization-errors';
import { PermissionCode } from '../domain/authorization/authorization-types';

export function requirePermission(permissionCode: PermissionCode) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const authorization = ctx.state.authorization;
    if (!authorization) {
      throw new AuthorizationError(AUTHORIZATION_CODES.authentication, 401);
    }
    createAuthorizationService().requireAction(authorization, permissionCode);
    await next();
  };
}

export default (permissionCode: PermissionCode) => requirePermission(permissionCode);
