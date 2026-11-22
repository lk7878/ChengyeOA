import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { Prisma } from '@prisma/client';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { FieldReadLevel, PermissionCode, ResourceCode } from '../../domain/authorization/authorization-types';
import { DataScopeService } from './data-scope-service';
import { ResourceWhereMap, ScopeableResourceCode, ScopeResolutionInput } from './resource-scope-resolvers';

export interface EffectiveGrant {
  sourceType: 'SYSTEM_SUPER_ADMIN' | 'SYSTEM_ADMIN' | 'ROLE' | 'SPECIAL_GRANT' | 'CONTRACT_READ_GRANT';
  sourceId: string;
  sourceRoleId?: string;
  permissionCode: PermissionCode;
  resource: string;
  scopeIds: string[];
  validUntil: Date | null;
}

export interface EffectiveFieldRule {
  sourceRoleId: string;
  resource: string;
  fieldCode: string;
  readLevel: FieldReadLevel;
  canWrite: boolean;
  canExport: boolean;
}

export interface AuthorizationContext {
  activeRoleIds?: string[];
  previewRoleId?:string;
  userId: string;
  employeeId: string | null;
  isSystemSuperAdmin: boolean;
  isSystemAdmin: boolean;
  grants: EffectiveGrant[];
  fieldRules: EffectiveFieldRule[];
  permissionCodes: PermissionCode[];
  evaluatedAt: Date;
}

export class AuthorizationService {
  constructor(private readonly dataScopes?: DataScopeService) {}

  requireAction(context: AuthorizationContext, permissionCode: PermissionCode): void {
    if (context.permissionCodes.includes(permissionCode)) return;
    const permission = PERMISSION_CATALOG.find(item => item.code === permissionCode);
    if (permission?.type === 'SPECIAL') {
      throw new AuthorizationError(AUTHORIZATION_CODES.special, 403);
    }
    throw new AuthorizationError(AUTHORIZATION_CODES.permission, 403);
  }

  allowedActions(context: AuthorizationContext, resource: string): PermissionCode[] {
    const allowed = new Set(context.permissionCodes);
    return PERMISSION_CATALOG
      .filter(item => item.resource === resource && allowed.has(item.code))
      .map(item => item.code);
  }

  async buildScopeWhere<R extends ScopeableResourceCode>(
    context: AuthorizationContext,
    resource: R,
    permissionCode: PermissionCode,
  ): Promise<ResourceWhereMap[R]> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.buildScopeWhere(context, resource, permissionCode);
  }

  async requireRecord<R extends ScopeableResourceCode>(
    context: AuthorizationContext,
    resource: R,
    permissionCode: PermissionCode,
    id: string,
  ): Promise<string> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.requireRecord(context, resource, permissionCode, id);
  }

  async buildOrganizationTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.OrganizationWhereInput> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.buildOrganizationTargetWhere(context, resource, permissionCode);
  }

  async buildEmployeeTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.EmployeeWhereInput> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.buildEmployeeTargetWhere(context, resource, permissionCode);
  }

  async buildProfessionalTeamTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.ProfessionalTeamWhereInput> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.buildProfessionalTeamTargetWhere(context, resource, permissionCode);
  }

  async resolveScopeTargets(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<ScopeResolutionInput> {
    if (!this.dataScopes) throw new AuthorizationError(AUTHORIZATION_CODES.scope, 403);
    return this.dataScopes.resolveScopeTargets(context, resource, permissionCode);
  }
}
