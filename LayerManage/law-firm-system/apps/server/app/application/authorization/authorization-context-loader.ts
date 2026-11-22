import { worksheetNavigationGrants } from '../collaboration/worksheet-business-grants';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { FieldReadLevel } from '../../domain/authorization/authorization-types';
import { SYSTEM_ADMIN_PERMISSION_CODES } from '../../domain/admin-governance/system-admin-permissions';
import {
  AuthorizationContext,
  EffectiveFieldRule,
  EffectiveGrant,
} from './authorization-service';

const roleSelection = {
                id: true,
                code: true,
                type: true,
                permissions: {
                  where: { permission: { status: 'ENABLED' } },
                  select: {
                    permission: {
                      select: { code: true, resource: true, type: true, status: true },
                    },
                  },
                },
                dataScopes: {
                  where: { dataScope: { status: 'ENABLED' } },
                  select: { resource: true, dataScopeId: true },
                },
                fieldPermissions: {
                  select: {
                    resource: true,
                    fieldCode: true,
                    readLevel: true,
                    canWrite: true,
                    canExport: true,
                  },
                },
              } as const;

export class AuthorizationContextLoader {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async load(userId: string, evaluatedAt = new Date()): Promise<AuthorizationContext> {
    const user = await this.user(userId,evaluatedAt);
    return worksheetNavigationGrants(this.prisma,this.project(userId,user,evaluatedAt),user?.userRoles.map(r=>r.role.id) ?? []);
  }
  async previewRole(id: string) {
    const role = await this.prisma.role.findFirst({where:{id,status:'ENABLED'}, select:roleSelection});
    if (!role) throw new AuthorizationError(AUTHORIZATION_CODES.permission,403);
    return worksheetNavigationGrants(this.prisma,{...this.project('preview:'+id,{status:'ENABLED',lockedUntil:null,employeeId:null,permissionGrants:[],contractReadGrants:[],userRoles:[{id,validUntil:null,role}]},new Date()),previewRoleId:id},[id]);
  }
  private user(userId: string,evaluatedAt: Date) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        lockedUntil: true,
        employeeId: true,
        userRoles: {
          where: {
            revokedAt: null,
            validFrom: { lte: evaluatedAt },
            OR: [{ validUntil: null }, { validUntil: { gt: evaluatedAt } }],
            role: { status: 'ENABLED' },
          },
          select: {
            id: true,
            validUntil: true,
            role: {
              select: roleSelection,
            },
          },
        },
        contractReadGrants: { where: { contract: { deletedAt: null } }, select: { contractId: true } },
        permissionGrants: {
          where: {
            revokedAt: null,
            validFrom: { lte: evaluatedAt },
            validUntil: { gt: evaluatedAt },
            permission: { type: 'SPECIAL', status: 'ENABLED' },
            dataScope: { status: 'ENABLED' },
          },
          select: {
            id: true,
            validUntil: true,
            dataScopeId: true,
            permission: {
              select: { code: true, resource: true, type: true, status: true },
            },
          },
        },
      },
    });

  }
  private project(userId:string,user:Awaited<ReturnType<AuthorizationContextLoader['user']>>,evaluatedAt:Date): AuthorizationContext {
    if (!user || user.status !== 'ENABLED' || (user.lockedUntil && user.lockedUntil > evaluatedAt)) {
      throw new AuthorizationError(AUTHORIZATION_CODES.authentication, 401);
    }

    const superAdminGrant = user.userRoles.find(userRole => (
      userRole.role.code === 'SYSTEM_SUPER_ADMIN'
      && userRole.role.type === 'SYSTEM'
    ));
    if (superAdminGrant) {
      const grants = PERMISSION_CATALOG.map<EffectiveGrant>(permission => ({
        sourceType: 'SYSTEM_SUPER_ADMIN',
        sourceId: superAdminGrant.id,
        permissionCode: permission.code,
        resource: permission.resource,
        scopeIds: ['ALL'],
        validUntil: superAdminGrant.validUntil,
      }));
      return {
        userId,
        employeeId: user.employeeId,
        isSystemSuperAdmin: true,
        isSystemAdmin: false,
        grants,
        fieldRules: [],
        permissionCodes: [...PERMISSION_CATALOG.map(item => item.code)].sort(),
        evaluatedAt,
      };
    }

    const grants: EffectiveGrant[] = [];
    const fieldRules: EffectiveFieldRule[] = [];
    const systemAdminGrant = user.userRoles.find(userRole => (
      userRole.role.code === 'SYSTEM_ADMIN'
      && userRole.role.type === 'SYSTEM'
    ));
    if (systemAdminGrant) {
      for (const permissionCode of SYSTEM_ADMIN_PERMISSION_CODES) {
        const permission = catalogPermission(permissionCode);
        if (!permission) continue;
        grants.push({
          sourceType: 'SYSTEM_ADMIN',
          sourceId: systemAdminGrant.id,
          sourceRoleId: systemAdminGrant.role.id,
          permissionCode: permission.code,
          resource: permission.resource,
          scopeIds: ['ALL'],
          validUntil: systemAdminGrant.validUntil,
        });
      }
    }

    for (const userRole of user.userRoles) {
      if (userRole.role.type !== 'BUSINESS') continue;
      for (const rolePermission of userRole.role.permissions) {
        const catalog = catalogPermission(rolePermission.permission.code);
        if (!catalog || catalog.type !== rolePermission.permission.type) continue;
        grants.push({
          sourceType: 'ROLE',
          sourceId: userRole.id,
          sourceRoleId: userRole.role.id,
          permissionCode: catalog.code,
          resource: catalog.resource,
          scopeIds: userRole.role.dataScopes
            .filter(scope => scope.resource === catalog.resource)
            .map(scope => scope.dataScopeId),
          validUntil: userRole.validUntil,
        });
      }
      for (const fieldPermission of userRole.role.fieldPermissions) {
        if (!isFieldReadLevel(fieldPermission.readLevel)) continue;
        fieldRules.push({
          sourceRoleId: userRole.role.id,
          resource: fieldPermission.resource,
          fieldCode: fieldPermission.fieldCode,
          readLevel: fieldPermission.readLevel,
          canWrite: fieldPermission.canWrite,
          canExport: fieldPermission.canExport,
        });
      }
    }

    for (const specialGrant of user.permissionGrants) {
      const catalog = catalogPermission(specialGrant.permission.code);
      if (!catalog || catalog.type !== 'SPECIAL') continue;
      grants.push({
        sourceType: 'SPECIAL_GRANT',
        sourceId: specialGrant.id,
        permissionCode: catalog.code,
        resource: catalog.resource,
        scopeIds: [specialGrant.dataScopeId],
        validUntil: specialGrant.validUntil,
      });
    }

    for (const grant of user.contractReadGrants) {
      grants.push({
        sourceType: 'CONTRACT_READ_GRANT', sourceId: grant.contractId, permissionCode: 'contract.read',
        resource: 'contract', scopeIds: [], validUntil: null,
      });
    }

    const permissionCodes = [...new Set(grants.map(grant => grant.permissionCode))].sort();
    return {
      userId,
      employeeId: user.employeeId,
      isSystemSuperAdmin: false,
      isSystemAdmin: systemAdminGrant !== undefined,
      grants,
      fieldRules,
      permissionCodes,
      evaluatedAt,
    };
  }
}

function catalogPermission(code: string) {
  return PERMISSION_CATALOG.find(item => item.code === code);
}

function isFieldReadLevel(value: string): value is FieldReadLevel {
  return value === 'NONE' || value === 'MASKED' || value === 'READ';
}
