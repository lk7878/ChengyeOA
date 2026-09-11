import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';

export function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export function authorizationContext(input: {
  userId: string;
  permissionCodes: PermissionCode[];
  resource: string;
  scopeIds?: string[];
  employeeId?: string | null;
  superAdmin?: boolean;
  fieldRules?: AuthorizationContext['fieldRules'];
}): AuthorizationContext {
  const scopeIds = input.scopeIds ?? ['ALL'];
  return {
    userId: input.userId,
    employeeId: input.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: input.superAdmin ?? scopeIds.includes('ALL'),
    grants: input.permissionCodes.map(permissionCode => ({
      sourceType: input.superAdmin ? 'SYSTEM_SUPER_ADMIN' : 'ROLE',
      sourceId: `${input.userId}-grant`,
      sourceRoleId: input.superAdmin ? undefined : `${input.userId}-role`,
      permissionCode,
      resource: input.resource,
      scopeIds,
      validUntil: null as Date | null,
    })),
    fieldRules: input.fieldRules ?? [],
    permissionCodes: input.permissionCodes,
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}
