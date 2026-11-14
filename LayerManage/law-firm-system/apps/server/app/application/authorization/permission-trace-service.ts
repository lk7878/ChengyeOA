import { PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { AuthorizationContextLoader } from './authorization-context-loader';
import { AuthorizationContext } from './authorization-service';

export interface PermissionTraceView {
  userId: string;
  employeeId: string | null;
  permissionCode: PermissionCode | null;
  allowed: boolean;
  refusalCode: string | null;
  evaluatedAt: Date;
  sources: Array<{
    sourceType: string;
    sourceId: string;
    permissionCode: PermissionCode;
    scopeTypes: string[];
    validUntil: Date | null;
    state: 'ACTIVE';
  }>;
  fieldCapabilities: Array<{
    sourceRoleId: string;
    resource: string;
    fieldCode: string;
    readLevel: string;
    canWrite: boolean;
    canExport: boolean;
  }>;
}

export class PermissionTraceService {
  constructor(private readonly prisma: PrismaClient) {}

  async trace(
    requester: AuthorizationContext,
    targetUserId: string,
    permissionCode?: PermissionCode,
  ): Promise<PermissionTraceView> {
    if (!requester.isSystemSuperAdmin) {
      const requiredPermission = requester.userId === targetUserId
        ? 'permission.trace.self'
        : 'permission.trace.any';
      if (!requester.permissionCodes.includes(requiredPermission)) {
        throw new AuthorizationError(AUTHORIZATION_CODES.permission, 403);
      }
    }
    const target = await new AuthorizationContextLoader(this.prisma).load(targetUserId, requester.evaluatedAt);
    const scopeIds = [...new Set(target.grants.flatMap(grant => grant.scopeIds).filter(id => id !== 'ALL'))];
    const scopes = await this.prisma.dataScope.findMany({
      where: { id: { in: scopeIds } }, select: { id: true, scopeType: true },
    });
    const scopeTypeById = new Map(scopes.map(scope => [scope.id, scope.scopeType]));
    scopeTypeById.set('worksheet:self','SELF');scopeTypeById.set('worksheet:department','OWN_ORG');
    const sources = target.grants
      .filter(grant => !permissionCode || grant.permissionCode === permissionCode)
      .map(grant => ({
        sourceType: grant.sourceType,
        sourceId: grant.sourceId,
        permissionCode: grant.permissionCode,
        scopeTypes: grant.scopeIds.map(id => id === 'ALL' ? 'ALL' : scopeTypeById.get(id)).filter((value): value is string => Boolean(value)),
        validUntil: grant.validUntil,
        state: 'ACTIVE' as const,
      }));
    const allowed = permissionCode ? target.permissionCodes.includes(permissionCode) : true;
    return {
      userId: target.userId,
      employeeId: target.employeeId,
      permissionCode: permissionCode ?? null,
      allowed,
      refusalCode: allowed ? null : AUTHORIZATION_CODES.permission,
      evaluatedAt: target.evaluatedAt,
      sources,
      fieldCapabilities: target.fieldRules.map(rule => ({ ...rule })),
    };
  }
}
