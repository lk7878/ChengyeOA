import { otherFunctionGroups, functionCodes } from './other-functions';
import { SMART_CASE_ROLE_CODE, SMART_CASE_PERMISSION } from '../../domain/smart-case/access-role';
import { saveApplicationPolicy } from '../collaboration/application-role-policy';
import type { AuthorizationContext } from './authorization-service';
import { WorksheetPermissions } from '../collaboration/worksheet-permissions';
import { exact, fail } from '../collaboration/collaboration-policy';
import { createHash, randomUUID } from 'node:crypto';
import { basicOfficeCodes, officeTemplate } from './office-role-template';
import { retiredPermission } from '../../domain/module-availability';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES, authorizationInputError } from '../../domain/authorization/authorization-errors';
import { assertAuthorizationExactKeys } from '../../domain/authorization/authorization-validation';
import { FIELD_CATALOG } from '../../domain/authorization/field-security-policy';
import { businessRolePermissionAssignable, businessRoleResourceAssignable, PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { SYSTEM_ADMIN_PERMISSION_CODES } from '../../domain/admin-governance/system-admin-permissions';
import { FieldReadLevel, PermissionCode, ResourceCode, RESOURCE_CODES } from '../../domain/authorization/authorization-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  normalizeName,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { AuditActor } from '../master-data/master-data-types';
import { writeAuthorizationAudit } from './authorization-audit';

const RESERVED_ROLE_CODES = new Set(['SYSTEM_SUPER_ADMIN', 'SYSTEM_ADMIN']);
const TEAM_RESOURCES = new Set<ResourceCode>([
  'employee', 'professional_team', 'professional_team_member', 'user',
]);

const ROLE_INCLUDE = Prisma.validator<Prisma.RoleInclude>()({
  permissions: { select: { permission: { select: { code: true, resource: true } } } },
  dataScopes: { select: { resource: true, dataScope: { select: { id: true, scopeType: true } } } },
  fieldPermissions: {
    select: { resource: true, fieldCode: true, readLevel: true, canWrite: true, canExport: true },
  },
});

type RoleRecord = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

export interface RoleAuthorizationView {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  status: string;
  version: number;
  permissionCodes: PermissionCode[];
  dataScopeBindings: Array<{ resource: string; dataScopeId: string; scopeType: string }>;
  fieldPermissions: Array<{
    resource: string;
    fieldCode: string;
    readLevel: FieldReadLevel;
    canWrite: boolean;
    canExport: boolean;
  }>;
}

export interface RoleAuthorizationPage {
  list: RoleAuthorizationView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CreateBusinessRoleInput {
  name: string;
  code?: string;
  copyRoleId?: string;
  basicOffice?: boolean;
  applications?: unknown[];
  worksheets?: Array<{tableId:string;version:number;rule:unknown}>;
  description?: string | null;
}

export interface UpdateBusinessRoleInput {
  name?: string;
  description?: string | null;
}

export interface ResourceScopeBindingInput {
  resource: ResourceCode;
  dataScopeId: string;
}

export interface FieldPermissionInput {
  resource: string;
  fieldCode: string;
  readLevel: FieldReadLevel;
  canWrite: boolean;
  canExport: boolean;
}

export class RoleAuthorizationService {
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor, private readonly authorization?: AuthorizationContext) {}

  async list(page: number, pageSize: number, keyword?: string): Promise<RoleAuthorizationPage> {
    const where: Prisma.RoleWhereInput = keyword
      ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] }
      : {};
    where.status = { not: 'DELETED' };
    const [total, roles] = await Promise.all([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        include: ROLE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: roles.map(roleView),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async create(input: CreateBusinessRoleInput): Promise<RoleAuthorizationView> {
    assertAuthorizationExactKeys(input, ['name', 'code', 'description','basicOffice','copyRoleId','worksheets','applications']);
    if((input.copyRoleId || input.worksheets?.length || input.applications?.length) &&
      (!this.authorization || (!this.authorization.isSystemSuperAdmin && !this.authorization.permissionCodes.includes('role.permission.manage'))))
      fail('COLLAB_FORBIDDEN',403);
    if(input.worksheets!==undefined && !Array.isArray(input.worksheets)) authorizationInputError();
    if(input.applications!==undefined && !Array.isArray(input.applications)) authorizationInputError();
    const name = authorizationValue(() => normalizeName(input.name));
    const code = authorizationValue(() => normalizeStableCode(input.code ?? 'ROLE_' + randomUUID().replace(/-/g,'').slice(0,24).toUpperCase()));
    const description = authorizationValue(() => normalizeOptionalText(input.description, 500));
    if (code === SMART_CASE_ROLE_CODE) throw new AuthorizationError(AUTHORIZATION_CODES.managedRole, 409);
    if (code === 'SYSTEM_SUPER_ADMIN') trustRootProtected();
    if (RESERVED_ROLE_CODES.has(code)) escalationBlocked();
    try {
      return await this.prisma.$transaction(async tx => {
        const template = await officeTemplate(tx);
        if(input.basicOffice !== undefined && typeof input.basicOffice !== 'boolean') authorizationInputError();
        const source = input.copyRoleId ? await lockRole(tx,input.copyRoleId) : null;
        if(source?.code === SMART_CASE_ROLE_CODE) throw new AuthorizationError(AUTHORIZATION_CODES.smartCaseRole, 400);
        if(source && (source.type!=='BUSINESS' || source.status!=='ENABLED')) authorizationInputError();
        const permissions = [...new Set([
          ...(input.basicOffice === false ? [] : template.permissionCodes),
          ...(source?.permissions.map(p=>p.permission.code).filter(c=>!retiredPermission(c) && !basicOfficeCodes.includes(c)) ?? []),
        ])];
        normalizePermissionCodes(permissions);
        const role = await tx.role.create({ data: { name, code, description, type: 'BUSINESS',
          officeTemplateSnapshot: input.basicOffice === false ? Prisma.DbNull : template,
          permissions:{create:permissions.map(code=>({permissionId:'permission:'+code}))},
          dataScopes:{create:source?.dataScopes.map(s=>({resource:s.resource,dataScopeId:s.dataScope.id})) ?? []},
          fieldPermissions:{create:source?.fieldPermissions ?? []},
        } });
        if(source) {
          const policies=await tx.worksheetRolePolicy.findMany({include:{table:{select:{source:true}}}});
          for(const policy of policies) {
            if(['SOP_TASKS','QUALITY_ANALYSES','QUALITY_REVIEWS','QUALITY_ISSUES'].includes(policy.table.source)) continue;
            const rules=policy.rules as Prisma.JsonObject;
            if(!rules[source.id]) continue;
            await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${policy.tableId} FOR UPDATE`;
            const latest=await tx.worksheetRolePolicy.findUniqueOrThrow({where:{tableId:policy.tableId}});
            const currentRules=latest.rules as Prisma.JsonObject;
            if(currentRules[source.id]) await tx.worksheetRolePolicy.update({where:{tableId:policy.tableId},data:{rules:{...currentRules,[role.id]:currentRules[source.id]},version:{increment:1}}});
          }
        }
        if(source) {
          const applications=await tx.roleApplicationPolicy.findMany({where:{roleId:source.id}});
          if(applications.length) await tx.roleApplicationPolicy.createMany({data:applications.map(p=>({...p,roleId:role.id,version:1}))});
        }
        if(input.applications?.length) {
          if(!this.authorization) fail('COLLAB_FORBIDDEN',403);
          for(const application of input.applications) await saveApplicationPolicy(tx,this.authorization,role.id,application);
        }
        if(input.worksheets?.length) await this.saveWorksheets(tx,role.id,input.worksheets);
        await writeAuthorizationAudit(tx, {
          ...this.actor,
          action: 'CREATE_ROLE',
          targetType: 'ROLE_AUTHORIZATION',
          targetId: role.id,
          changes: { roleCode: code, status: role.status, version: role.version, copyRoleId:source?.id, basicOffice:input.basicOffice!==false, templateVersion:template.version },
        });
        return loadView(tx, role.id);
      });
    } catch (error) {
      mapUniqueConflict(error);
      throw error;
    }
  }

  async applications(id?:string) {
    const workspaces=await this.prisma.collabWorkspace.findMany({where:{moduleGroup:{not:null,notIn:['QUALITY','DELIVERY']}},select:{id:true,name:true,moduleGroup:true}});
    const policies=id?await this.prisma.roleApplicationPolicy.findMany({where:{roleId:id}}):[];
    return workspaces.map(w=>({...w,canCreate:policies.find(p=>p.workspaceId===w.id)?.canCreate??false,
      defaultLevel:policies.find(p=>p.workspaceId===w.id)?.defaultLevel??'DENY',version:policies.find(p=>p.workspaceId===w.id)?.version??0}));
  }
  async replaceApplications(id:string,raw:unknown) {
    const input=exact(raw,['version','applications']);
    if(!this.authorization || !Array.isArray(input.applications)||input.applications.length>100) fail('COLLAB_FORBIDDEN',403);
    return this.mutate(id,normalizeVersion(input.version),'ROLE_APPLICATIONS',async tx=>{
      for(const application of input.applications as unknown[]) await saveApplicationPolicy(tx,this.authorization!,id,application);
      await incrementRoleVersion(tx,id,input.version as number);
    });
  }
  async replaceWorksheets(id:string,raw:unknown) {
    const input=exact(raw,['version','worksheets']);
    return this.mutate(id,normalizeVersion(input.version),'ROLE_WORKSHEETS',async(tx)=>{
      await this.saveWorksheets(tx,id,input.worksheets);
      await incrementRoleVersion(tx,id,input.version as number);
    });
  }
  private async saveWorksheets(tx:Prisma.TransactionClient,roleId:string,raw:unknown) {
    if(!this.authorization || (!this.authorization.isSystemSuperAdmin && !this.authorization.permissionCodes.includes('role.permission.manage')))
      fail('COLLAB_FORBIDDEN',403);
    if(!Array.isArray(raw)||raw.length>100) authorizationInputError();
    const entries=raw.map(item=>exact(item,['tableId','version','rule']));
    if(entries.some(e=>typeof e.tableId!=='string') || new Set(entries.map(e=>e.tableId)).size!==entries.length) authorizationInputError();
    const permissions=new WorksheetPermissions(this.prisma,this.authorization);
    for(const item of entries.sort((a,b)=>String(a.tableId).localeCompare(String(b.tableId))))
      await permissions.change(item.tableId as string,{roleId,version:item.version,rule:item.rule},false,tx);
  }

  async update(
    id: string,
    input: UpdateBusinessRoleInput & { version: number },
  ): Promise<RoleAuthorizationView> {
    assertAuthorizationExactKeys(input, ['name', 'description', 'version']);
    const version = authorizationValue(() => normalizeVersion(input.version));
    const data: Prisma.RoleUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = authorizationValue(() => normalizeName(input.name));
    if (input.description !== undefined) {
      data.description = authorizationValue(() => normalizeOptionalText(input.description, 500));
    }
    return this.mutate(id, version, 'UPDATE_ROLE', async tx => {
      const changed = await tx.role.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) versionConflict();
    });
  }

  async replacePermissions(
    id: string,
    input: { permissionCodes: PermissionCode[]; version: number },
  ): Promise<RoleAuthorizationView> {
    assertAuthorizationExactKeys(input, ['permissionCodes', 'version']);
    const version = authorizationValue(() => normalizeVersion(input.version));
    const permissionCodes = normalizePermissionCodes(input.permissionCodes);
    return this.mutate(id, version, 'REPLACE_ROLE_PERMISSIONS', async tx => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionCodes.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionCodes.map(code => ({ roleId: id, permissionId: `permission:${code}` })),
        });
      }
      await incrementRoleVersion(tx, id, version);
    }, { permissionCodes });
  }

  async replaceDataScopes(
    id: string,
    input: { bindings: ResourceScopeBindingInput[]; version: number },
  ): Promise<RoleAuthorizationView> {
    assertAuthorizationExactKeys(input, ['bindings', 'version']);
    const version = authorizationValue(() => normalizeVersion(input.version));
    const bindings = normalizeBindings(input.bindings);
    return this.mutate(id, version, 'REPLACE_ROLE_DATA_SCOPES', async (tx, role) => {
      const allowedResources = new Set(role.permissions.map(item => item.permission.resource));
      if (bindings.some(binding => !allowedResources.has(binding.resource))) authorizationInputError();
      const scopes = await tx.dataScope.findMany({
        where: { id: { in: bindings.map(item => item.dataScopeId) }, status: 'ENABLED' },
        select: { id: true, scopeType: true },
      });
      if (scopes.length !== new Set(bindings.map(item => item.dataScopeId)).size) authorizationInputError();
      const byId = new Map(scopes.map(scope => [scope.id, scope]));
      for (const binding of bindings) {
        const scope = byId.get(binding.dataScopeId);
        if (!scope || !scopeCompatible(binding.resource, scope.scopeType)) authorizationInputError();
      }
      await tx.roleDataScope.deleteMany({ where: { roleId: id } });
      if (bindings.length > 0) await tx.roleDataScope.createMany({ data: bindings.map(binding => ({ roleId: id, ...binding })) });
      await incrementRoleVersion(tx, id, version);
    }, { resourceCodes: bindings.map(item => item.resource), targetCount: bindings.length });
  }

  async replaceFieldPermissions(
    id: string,
    input: { fields: FieldPermissionInput[]; version: number },
  ): Promise<RoleAuthorizationView> {
    assertAuthorizationExactKeys(input, ['fields', 'version']);
    const version = authorizationValue(() => normalizeVersion(input.version));
    const fields = normalizeFields(input.fields);
    return this.mutate(id, version, 'REPLACE_ROLE_FIELD_PERMISSIONS', async (tx, role) => {
      const allowedResources = new Set(role.permissions.map(item => item.permission.resource));
      if (fields.some(field => !allowedResources.has(field.resource))) authorizationInputError();
      await tx.fieldPermission.deleteMany({ where: { roleId: id } });
      if (fields.length > 0) await tx.fieldPermission.createMany({ data: fields.map(field => ({ roleId: id, ...field })) });
      await incrementRoleVersion(tx, id, version);
    }, { fieldCodes: fields.map(item => item.fieldCode), targetCount: fields.length });
  }

  async disable(id: string, versionValue: number): Promise<RoleAuthorizationView> {
    const version = authorizationValue(() => normalizeVersion(versionValue));
    return this.mutate(id, version, 'DISABLE_ROLE', async tx => {
      const activeGrant = await tx.userRole.findFirst({ where: { roleId: id, revokedAt: null }, select: { id: true } });
      if (activeGrant) inUse();
      const changed = await tx.role.updateMany({ where: { id, version }, data: { status: 'DISABLED', version: { increment: 1 } } });
      if (changed.count !== 1) versionConflict();
    });
  }

  async otherFunctions(id: string) {
    const role = await this.detail(id);
    return { groups: otherFunctionGroups.map(g => ({ ...g, codes: g.codes.filter(c => PERMISSION_CATALOG.some(p => p.code === c)),
      selected: role.permissionCodes.filter(c => g.codes.includes(c)),
      scopeBindings: role.dataScopeBindings.filter(b => g.resources.includes(b.resource)),
      scopeIds: [...new Set(role.dataScopeBindings.filter(b => g.resources.includes(b.resource)).map(b => b.dataScopeId))] })), role };
  }

  async saveOtherFunctions(id: string, raw: { version: number; groupId: string; permissionCodes: string[]; scopeIds?: string[] }) {
    assertAuthorizationExactKeys(raw, ['version', 'groupId', 'permissionCodes', 'scopeIds']);
    const group = otherFunctionGroups.find(g => g.id === raw.groupId);
    if (!group || !Array.isArray(raw.permissionCodes) || raw.permissionCodes.some(c => !group.codes.includes(c)) ||
      (raw.scopeIds !== undefined && (!Array.isArray(raw.scopeIds) || raw.scopeIds.some(s => typeof s !== 'string')))) authorizationInputError();
    const codes = normalizePermissionCodes(functionCodes(group, raw.permissionCodes).filter(c=>PERMISSION_CATALOG.some(p=>p.code===c)));
    const version = authorizationValue(() => normalizeVersion(raw.version));
    return this.mutate(id, version, 'SAVE_OTHER_FUNCTIONS', async (tx, role) => {
      const scopes = await tx.dataScope.findMany({ where: { id: { in: raw.scopeIds ?? [] }, status: 'ENABLED' } });
      if (scopes.length !== new Set(raw.scopeIds ?? []).size || scopes.some(s => group.resources.some(r => !scopeCompatible(r as ResourceCode, s.scopeType)))) authorizationInputError();
      // Modify only this explicitly selected function group. Preserve all unmapped historical grants and fields.
      const removed = [...group.codes, ...group.menus.filter(m => m !== 'menu.organization_personnel')];
      await tx.rolePermission.deleteMany({ where: { roleId: id, permission: { code: { in: removed } } } });
      const existing = new Set(role.permissions.filter(p => !removed.includes(p.permission.code)).map(p => p.permission.code));
      const added = codes.filter(c => !existing.has(c));
      if (added.length) await tx.rolePermission.createMany({ data: added.map(c => ({ roleId: id, permissionId: 'permission:'+c })) });
      // Omitted scopeIds preserves each resource's original bindings, including different legacy ranges.
      if (raw.scopeIds !== undefined) {
        await tx.roleDataScope.deleteMany({ where: { roleId: id, resource: { in: group.resources } } });
        if (codes.length && scopes.length) await tx.roleDataScope.createMany({ data: group.resources.flatMap(resource => scopes.map(scope => ({ roleId: id, resource, dataScopeId: scope.id }))) });
      }
      await incrementRoleVersion(tx, id, version);
    }, { permissionCodes: codes, resourceCodes: group.resources, ...(raw.scopeIds===undefined?{purpose:'保留各资源原有范围'}:{scopeIds:raw.scopeIds}) });
  }

  async deletionImpact(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!role || role.status === 'DELETED') objectNotFound();
    assertBusinessRole(role);
    return roleDeletionImpact(this.prisma, role);
  }

  async remove(id: string, input: { version: number; revokeMembers?: boolean; impactToken?: string; reason?: string }): Promise<void> {
    assertAuthorizationExactKeys(input, ['version', 'revokeMembers', 'impactToken', 'reason']);
    const version = authorizationValue(() => normalizeVersion(input.version));
    if (input.revokeMembers !== undefined && typeof input.revokeMembers !== 'boolean') authorizationInputError();
    if (input.revokeMembers && (!this.authorization || (!this.authorization.isSystemSuperAdmin &&
      !this.authorization.permissionCodes.includes('user_role.membership.manage')))) escalationBlocked();
    if (input.revokeMembers && (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 500)) authorizationInputError();
    await this.prisma.$transaction(async tx => {
      const role = await lockRole(tx, id);
      assertBusinessRole(role);
      if (role.version !== version) versionConflict();
      const impact = await roleDeletionImpact(tx, role);
      if (impact.blockers.length) inUse();
      if (input.revokeMembers && input.impactToken !== impact.token) versionConflict();
      if (impact.members.length && !input.revokeMembers) inUse();
      if (input.revokeMembers) {
        if (!this.authorization?.isSystemSuperAdmin && impact.members.some(m => m.userId === this.actor.actorUserId)) escalationBlocked();
        for (const member of impact.members) {
          await tx.userRole.update({ where: { id: member.id }, data: { revokedAt: new Date(), revokedByUserId: this.actor.actorUserId,
            revokeReason: input.reason!.trim(), version: { increment: 1 } } });
          await writeAuthorizationAudit(tx, { ...this.actor, action: 'REVOKE_USER_ROLE', targetType: 'USER_ROLE_GRANT', targetId: member.id,
            changes: { userId: member.userId, roleId: id, reason: input.reason!, state: 'REVOKED' } });
        }
      }
      await tx.role.update({ where: { id }, data: { status: 'DELETED', version: { increment: 1 } } });
      await writeAuthorizationAudit(tx, { ...this.actor, action: 'DELETE_ROLE', targetType: 'ROLE_AUTHORIZATION', targetId: id,
        changes: { status: 'DELETED', version: version + 1, targetCount: impact.members.length, reason: input.reason ?? '' } });
    });
  }

  async enable(id: string, versionValue: number): Promise<RoleAuthorizationView> {
    const version = authorizationValue(() => normalizeVersion(versionValue));
    return this.mutate(id, version, 'ENABLE_ROLE', async tx => {
      const changed = await tx.role.updateMany({ where: { id, version }, data: { status: 'ENABLED', version: { increment: 1 } } });
      if (changed.count !== 1) versionConflict();
    });
  }

  async detail(id: string): Promise<RoleAuthorizationView> {
    return loadView(this.prisma, id);
  }

  private async mutate(
    id: string,
    version: number,
    action: string,
    apply: (tx: Prisma.TransactionClient, role: RoleRecord) => Promise<void>,
    changes: Record<string, unknown> = {},
  ): Promise<RoleAuthorizationView> {
    try {
      return await this.prisma.$transaction(async tx => {
        const role = await lockRole(tx, id);
        assertBusinessRole(role);
        if (role.version !== version) versionConflict();
        await apply(tx, role);
        const updated = await loadView(tx, id);
        await writeAuthorizationAudit(tx, {
          ...this.actor,
          action,
          targetType: 'ROLE_AUTHORIZATION',
          targetId: id,
          changes: { ...changes, status: updated.status, version: updated.version },
        });
        return updated;
      });
    } catch (error) {
      mapUniqueConflict(error);
      throw error;
    }
  }
}

async function lockRole(tx: Prisma.TransactionClient, id: string): Promise<RoleRecord> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "role" WHERE "id" = ${id} FOR UPDATE`);
  const role = await tx.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
  if (!role || role.status === 'DELETED') objectNotFound();
  return role;
}

async function incrementRoleVersion(tx: Prisma.TransactionClient, id: string, version: number) {
  const changed = await tx.role.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
  if (changed.count !== 1) versionConflict();
}

async function loadView(client: PrismaClient | Prisma.TransactionClient, id: string): Promise<RoleAuthorizationView> {
  const role = await client.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
  if (!role || role.status === 'DELETED') objectNotFound();
  return roleView(role);
}

function roleView(role: RoleRecord): RoleAuthorizationView {
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    type: role.type,
    description: role.description,
    status: role.status,
    version: role.version,
    permissionCodes: role.type === 'SYSTEM' && role.code === 'SYSTEM_SUPER_ADMIN'
      ? PERMISSION_CATALOG.map(item => item.code).sort()
      : role.type === 'SYSTEM' && role.code === 'SYSTEM_ADMIN'
        ? [...SYSTEM_ADMIN_PERMISSION_CODES].sort()
        : role.permissions.map(item => item.permission.code as PermissionCode).sort(),
    dataScopeBindings: role.dataScopes.map(item => ({
      resource: item.resource,
      dataScopeId: item.dataScope.id,
      scopeType: item.dataScope.scopeType,
    })).sort((left, right) => `${left.resource}:${left.dataScopeId}`.localeCompare(`${right.resource}:${right.dataScopeId}`)),
    fieldPermissions: role.fieldPermissions.map(item => ({
      resource: item.resource,
      fieldCode: item.fieldCode,
      readLevel: item.readLevel as FieldReadLevel,
      canWrite: item.canWrite,
      canExport: item.canExport,
    })).sort((left, right) => left.fieldCode.localeCompare(right.fieldCode)),
  };
}

function normalizePermissionCodes(value: unknown): PermissionCode[] {
  if (!Array.isArray(value) || value.length > PERMISSION_CATALOG.length) authorizationInputError();
  const codes = value.map(item => typeof item === 'string' ? item : authorizationInputError());
  if (new Set(codes).size !== codes.length) authorizationInputError();
  if (codes.includes(SMART_CASE_PERMISSION)) throw new AuthorizationError(AUTHORIZATION_CODES.smartCaseRole, 400);
  return codes.map(code => {
    const permission = PERMISSION_CATALOG.find(item => item.code === code && item.status === 'ENABLED');
    if (!permission) authorizationInputError();
    if (!businessRolePermissionAssignable(permission)) escalationBlocked();
    return permission.code;
  });
}

function normalizeBindings(value: unknown): ResourceScopeBindingInput[] {
  if (!Array.isArray(value) || value.length > 1000) authorizationInputError();
  const allowedResources = new Set<string>(RESOURCE_CODES.filter(resource => resource !== 'menu' && businessRoleResourceAssignable(resource)));
  const bindings = value.map(item => {
    assertAuthorizationExactKeys(item, ['resource', 'dataScopeId']);
    if (typeof item.resource !== 'string' || !allowedResources.has(item.resource)) authorizationInputError();
    return {
      resource: item.resource as ResourceCode,
      dataScopeId: authorizationValue(() => normalizeRequiredText(item.dataScopeId, 1, 200)),
    };
  });
  if (new Set(bindings.map(item => `${item.resource}:${item.dataScopeId}`)).size !== bindings.length) {
    authorizationInputError();
  }
  return bindings;
}

function normalizeFields(value: unknown): FieldPermissionInput[] {
  if (!Array.isArray(value) || value.length > FIELD_CATALOG.length) authorizationInputError();
  const fields = value.map(item => {
    assertAuthorizationExactKeys(item, ['resource', 'fieldCode', 'readLevel', 'canWrite', 'canExport']);
    if (typeof item.resource !== 'string' || typeof item.fieldCode !== 'string') authorizationInputError();
    const catalog = FIELD_CATALOG.find(field => field.code === item.fieldCode && field.resource === item.resource);
    if (!catalog) authorizationInputError();
    if (item.readLevel !== 'NONE' && item.readLevel !== 'MASKED' && item.readLevel !== 'READ') authorizationInputError();
    if (typeof item.canWrite !== 'boolean' || typeof item.canExport !== 'boolean') authorizationInputError();
    if (item.readLevel === 'NONE' && (item.canWrite || item.canExport)) authorizationInputError();
    const readLevel = item.readLevel as FieldReadLevel;
    return {
      resource: item.resource,
      fieldCode: item.fieldCode,
      readLevel,
      canWrite: item.canWrite,
      canExport: item.canExport,
    };
  });
  if (new Set(fields.map(item => `${item.resource}:${item.fieldCode}`)).size !== fields.length) authorizationInputError();
  return fields;
}

function scopeCompatible(resource: ResourceCode, scopeType: string): boolean {
  if (scopeType === 'TEAM') return TEAM_RESOURCES.has(resource);
  if (scopeType === 'SELF' || scopeType === 'SELF_AND_SUBORDINATES') return resource !== 'organization';
  return ['ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'CUSTOM'].includes(scopeType);
}

function authorizationValue<T>(normalize: () => T): T {
  try {
    return normalize();
  } catch (error) {
    if (error instanceof MasterDataError && error.code === 'VALIDATION_FAILED') authorizationInputError();
    throw error;
  }
}

function assertBusinessRole(role: RoleRecord) {
  if (role.code === SMART_CASE_ROLE_CODE) throw new AuthorizationError(AUTHORIZATION_CODES.managedRole, 409);
  if (role.code === 'SYSTEM_SUPER_ADMIN') trustRootProtected();
  if (role.type !== 'BUSINESS' || RESERVED_ROLE_CODES.has(role.code)) escalationBlocked();
}

function mapUniqueConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') inUse();
}

function objectNotFound(): never { throw new AuthorizationError(AUTHORIZATION_CODES.objectNotFound, 404); }
function versionConflict(): never { throw new AuthorizationError(AUTHORIZATION_CODES.version, 409); }
function inUse(): never { throw new AuthorizationError(AUTHORIZATION_CODES.inUse, 409); }
function escalationBlocked(): never { throw new AuthorizationError(AUTHORIZATION_CODES.escalation, 403); }
function trustRootProtected(): never { throw new AuthorizationError(AUTHORIZATION_CODES.trustRoot, 409); }

async function roleDeletionImpact(db: PrismaClient | Prisma.TransactionClient, role: RoleRecord) {
  const members = await db.userRole.findMany({ where: { roleId: role.id, revokedAt: null,
    user: { status: { not: 'DELETED' } }, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
    select: { id: true, userId: true, version: true, validFrom: true, validUntil: true, user: { select: { username: true } } }, orderBy: { id: 'asc' } });
  const definitions = await db.approvalDefinition.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, approverRule: true, nodeSchema: true } });
  const references = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (v.type === 'ROLE' && Array.isArray(v.roleCodes) && v.roleCodes.includes(role.code)) return true;
    return Object.values(v).some(references);
  };
  const blockers = definitions.filter(d => references(d.approverRule) || references(d.nodeSchema)).map(d => ({ id: d.id, name: d.name, reason: '审批流程仍使用此角色，请先调整审批人' }));
  const policies = await db.worksheetRolePolicy.findMany({ where: { table: { archived: false } }, select: { tableId: true, invitations: true } });
  const sharedTables = policies.filter(p => Object.values((p.invitations ?? {}) as Record<string, unknown>).includes(role.id)).map(p => p.tableId).sort();
  const token = createHash('sha256').update(JSON.stringify({ version: role.version, members, blockers, sharedTables })).digest('hex');
  return { members, blockers, sharedTables, token };
}
