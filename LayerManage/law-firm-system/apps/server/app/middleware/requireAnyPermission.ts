import { Context } from 'egg';
import { createAuthorizationService } from '../application/authorization/authorization-factory';
import { AuthorizationError, AUTHORIZATION_CODES } from '../domain/authorization/authorization-errors';
import { PermissionCode } from '../domain/authorization/authorization-types';

/**
 * 任一权限门控：context 持有 permissionCodes 中任一码即放行，否则 403。
 * 用于可委派操作面（如角色成员管理：治理码 user.role.manage 或委派码
 * user_role.membership.manage 任一可过 router 门控；治理语义仍由 service 层收紧）。
 */
export function requireAnyPermission(permissionCodes: readonly PermissionCode[]) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const authorization = ctx.state.authorization;
    if (!authorization) {
      throw new AuthorizationError(AUTHORIZATION_CODES.authentication, 401);
    }
    const service = createAuthorizationService();
    for (const permissionCode of permissionCodes) {
      try {
        service.requireAction(authorization, permissionCode);
      } catch (error) {
        if (!(error instanceof AuthorizationError) || error.code !== AUTHORIZATION_CODES.permission)
          throw error;
        continue;
      }
      await next();
      return;
    }
    throw new AuthorizationError(AUTHORIZATION_CODES.permission, 403);
  };
}

export default (permissionCodes: readonly PermissionCode[]) => requireAnyPermission(permissionCodes);
