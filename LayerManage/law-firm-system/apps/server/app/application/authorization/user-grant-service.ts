import { Prisma, PrismaClient, UserPermissionGrant, UserRole } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import {
  assertAuthorizationExactKeys,
  parseGrantReason,
  parseRoleGrantInput,
  parseSpecialGrantInput,
} from '../../domain/authorization/authorization-validation';
import { AuthorizationContext } from './authorization-service';
import { writeAuthorizationAudit } from './authorization-audit';

export interface RoleGrantView {
  id: string;
  userId: string;
  roleId: string;
  source: string;
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  version: number;
}

export interface SpecialGrantView {
  id: string;
  userId: string;
  permissionCode: string;
  dataScopeId: string;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
  version: number;
}

export interface UserAuthorizationSummary {
  userId: string;
  status: string;
  roleGrants: Array<RoleGrantView & { roleCode: string; roleName: string; state: GrantState }>;
  specialGrants: Array<SpecialGrantView & { scopeType: string; state: GrantState }>;
}

/** per-role 成员视图（SPEC-015 follow-up）：角色成员列表项（含用户身份 + 授予状态）。 */
export interface RoleMemberView {
  id: string;
  userId: string;
  username: string;
  userStatus: string;
  source: string;
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  version: number;
  state: GrantState;
}

type GrantState = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export class UserGrantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuthorizationContext,
    private readonly ip?: string,
  ) {}

  async summary(userId: string): Promise<UserAuthorizationSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        userRoles: { include: { role: { select: { code: true, name: true } } }, orderBy: { validFrom: 'desc' } },
        permissionGrants: {
          include: {
            permission: { select: { code: true } },
            dataScope: { select: { scopeType: true } },
          },
          orderBy: { validFrom: 'desc' },
        },
      },
    });
    if (!user) objectNotFound();
    const at = this.actor.evaluatedAt;
    return {
      userId: user.id,
      status: user.status,
      roleGrants: user.userRoles.map(grant => ({
        ...roleGrantView(grant),
        roleCode: grant.role.code,
        roleName: grant.role.name,
        state: grantState(grant, at),
      })),
      specialGrants: user.permissionGrants.map(grant => ({
        ...specialGrantView(grant, grant.permission.code),
        scopeType: grant.dataScope.scopeType,
        state: grantState(grant, at),
      })),
    };
  }

  /**
   * per-role 成员列表（SPEC-015 follow-up）：按 roleId 查 user_role（含用户身份），
   * 按 validFrom desc 排序，派生授予状态（PENDING/ACTIVE/EXPIRED/REVOKED）。
   * 查询视角门控（role.read 或委派码）由 router 层 requireAnyPermission 承担。
   */
  async listRoleMembers(roleId: string): Promise<RoleMemberView[]> {
    const members = await this.prisma.userRole.findMany({
      where: { roleId },
      include: { user: { select: { username: true, status: true } } },
      orderBy: { validFrom: 'desc' },
    });
    const at = this.actor.evaluatedAt;
    return members.map(member => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      userStatus: member.user.status,
      source: member.source,
      validFrom: member.validFrom,
      validUntil: member.validUntil,
      revokedAt: member.revokedAt,
      version: member.version,
      state: grantState(member, at),
    }));
  }

  async grantRole(userId: string, roleId: string, input: unknown): Promise<RoleGrantView> {
    this.assertMayManage(userId);
    const parsed = parseRoleGrantInput(input);
    return this.mapOverlap(async () => this.prisma.$transaction(async tx => {
      const [user, role] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.role.findUnique({ where: { id: roleId } }),
      ]);
      if (!user || !role) objectNotFound();
      if (user.status !== 'ENABLED' || role.status !== 'ENABLED') inUse();
      if (role.type !== 'BUSINESS' || role.code === 'SYSTEM_SUPER_ADMIN' || role.code === 'SYSTEM_ADMIN') {
        escalationBlocked();
      }
      const grant = await tx.userRole.create({ data: {
        userId,
        roleId,
        source: parsed.source,
        validFrom: parsed.validFrom,
        validUntil: parsed.validUntil,
        reason: parsed.reason,
        grantedByUserId: this.actor.userId,
      } });
      await writeAuthorizationAudit(tx, {
        actorUserId: this.actor.userId,
        action: 'GRANT_USER_ROLE',
        targetType: 'USER_ROLE_GRANT',
        targetId: grant.id,
        changes: { userId, roleId, validFrom: grant.validFrom, validUntil: grant.validUntil, state: 'ACTIVE' },
        ip: this.ip,
      });
      return roleGrantView(grant);
    }));
  }

  async replaceBusinessRoles(userId: string, input: { roleIds: string[] }): Promise<void> {
    this.assertMayManage(userId);
    assertAuthorizationExactKeys(input, ['roleIds']);
    if (!Array.isArray(input.roleIds) || input.roleIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.roleIds).size !== input.roleIds.length) inputInvalid();
    await this.mapOverlap(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) objectNotFound();
      if (user.status !== 'ENABLED') inUse();
      const roles = await tx.role.findMany({ where: { id: { in: input.roleIds } } });
      if (roles.length !== input.roleIds.length) objectNotFound();
      if (roles.some(role => role.type !== 'BUSINESS' || ['SYSTEM_SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(role.code))) escalationBlocked();
      if (roles.some(role => role.status !== 'ENABLED')) inUse();
      const now = new Date();
      const current = await tx.userRole.findMany({ where: { userId, revokedAt: null, role: { type: 'BUSINESS' }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] } });
      for (const grant of current.filter(grant => !input.roleIds.includes(grant.roleId))) {
        await tx.userRole.update({ where: { id: grant.id }, data: { revokedAt: now, revokedByUserId: this.actor.userId, revokeReason: '账号管理调整业务角色授权', version: { increment: 1 } } });
      }
      for (const roleId of input.roleIds.filter(id => !current.some(grant => grant.roleId === id))) {
        await tx.userRole.create({ data: { userId, roleId, source: 'PERMANENT', validFrom: now, grantedByUserId: this.actor.userId } });
      }
      await writeAuthorizationAudit(tx, { actorUserId: this.actor.userId, action: 'REPLACE_BUSINESS_ROLES', targetType: 'USER_ROLE_GRANT', targetId: userId, changes: { userId, roleIds: input.roleIds }, ip: this.ip });
    }));
  }

  async revokeRole(
    userId: string,
    grantId: string,
    input: { reason: string; version: number },
  ): Promise<RoleGrantView> {
    this.assertMayManage(userId);
    assertAuthorizationExactKeys(input, ['reason', 'version']);
    const reason = parseGrantReason(input.reason);
    if (!Number.isInteger(input.version) || input.version < 1) inputInvalid();
    return this.prisma.$transaction(async tx => {
      const grant = await tx.userRole.findFirst({ where: { id: grantId, userId } });
      if (!grant) objectNotFound();
      if (grant.revokedAt || grant.version !== input.version) versionConflict();
      const revokedAt = new Date();
      const changed = await tx.userRole.updateMany({
        where: { id: grantId, userId, version: input.version, revokedAt: null },
        data: { revokedAt, revokedByUserId: this.actor.userId, revokeReason: reason, version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.userRole.findUniqueOrThrow({ where: { id: grantId } });
      await writeAuthorizationAudit(tx, {
        actorUserId: this.actor.userId,
        action: 'REVOKE_USER_ROLE',
        targetType: 'USER_ROLE_GRANT',
        targetId: grantId,
        changes: { userId, roleId: grant.roleId, revokedAt, state: 'REVOKED' },
        ip: this.ip,
      });
      return roleGrantView(after);
    });
  }

  async grantSpecial(userId: string, input: unknown): Promise<SpecialGrantView> {
    this.assertMayManage(userId);
    const parsed = parseSpecialGrantInput(input);
    return this.mapOverlap(async () => this.prisma.$transaction(async tx => {
      const [user, scope] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.dataScope.findUnique({ where: { id: parsed.dataScopeId } }),
      ]);
      if (!user || !scope) objectNotFound();
      if (user.status !== 'ENABLED' || scope.status !== 'ENABLED') inUse();
      const grant = await tx.userPermissionGrant.create({ data: {
        userId,
        permissionId: `permission:${parsed.permissionCode}`,
        dataScopeId: parsed.dataScopeId,
        validFrom: parsed.validFrom,
        validUntil: parsed.validUntil,
        reason: parsed.reason,
        grantedByUserId: this.actor.userId,
      } });
      await writeAuthorizationAudit(tx, {
        actorUserId: this.actor.userId,
        action: 'GRANT_SPECIAL_PERMISSION',
        targetType: 'USER_SPECIAL_GRANT',
        targetId: grant.id,
        changes: {
          userId, permissionCode: parsed.permissionCode, dataScopeId: parsed.dataScopeId,
          validFrom: grant.validFrom, validUntil: grant.validUntil, state: 'ACTIVE',
        },
        ip: this.ip,
      });
      return specialGrantView(grant, parsed.permissionCode);
    }));
  }

  async revokeSpecial(
    userId: string,
    grantId: string,
    input: { reason: string; version: number },
  ): Promise<SpecialGrantView> {
    this.assertMayManage(userId);
    assertAuthorizationExactKeys(input, ['reason', 'version']);
    const reason = parseGrantReason(input.reason);
    if (!Number.isInteger(input.version) || input.version < 1) inputInvalid();
    return this.prisma.$transaction(async tx => {
      const grant = await tx.userPermissionGrant.findFirst({
        where: { id: grantId, userId }, include: { permission: { select: { code: true } } },
      });
      if (!grant) objectNotFound();
      if (grant.revokedAt || grant.version !== input.version) versionConflict();
      const revokedAt = new Date();
      const changed = await tx.userPermissionGrant.updateMany({
        where: { id: grantId, userId, version: input.version, revokedAt: null },
        data: { revokedAt, revokedByUserId: this.actor.userId, revokeReason: reason, version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.userPermissionGrant.findUniqueOrThrow({ where: { id: grantId } });
      await writeAuthorizationAudit(tx, {
        actorUserId: this.actor.userId,
        action: 'REVOKE_SPECIAL_PERMISSION',
        targetType: 'USER_SPECIAL_GRANT',
        targetId: grantId,
        changes: { userId, permissionCode: grant.permission.code, revokedAt, state: 'REVOKED' },
        ip: this.ip,
      });
      return specialGrantView(after, grant.permission.code);
    });
  }

  private assertMayManage(targetUserId: string) {
    // SPEC-015 follow-up（业务角色成员指派）：委派化——super-admin 或持有可委派权限码
    // `user_role.membership.manage`（非治理 resource 'user_role_membership'，可授予 HR 等
    // BUSINESS 角色）即可管理角色成员。治理面 `user.role.manage` 仍不可委派（spec-004 边界不变）。
    const mayManageMembership = this.actor.permissionCodes.includes('user_role.membership.manage');
    if (!this.actor.isSystemSuperAdmin && !mayManageMembership) escalationBlocked();
    if (this.actor.userId === targetUserId) escalationBlocked();
  }

  private async mapOverlap<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) {
      if (isOverlapError(error)) inUse();
      throw error;
    }
  }
}

function roleGrantView(grant: UserRole): RoleGrantView {
  return { id: grant.id, userId: grant.userId, roleId: grant.roleId, source: grant.source, validFrom: grant.validFrom, validUntil: grant.validUntil, revokedAt: grant.revokedAt, version: grant.version };
}
function specialGrantView(grant: UserPermissionGrant, permissionCode: string): SpecialGrantView {
  return { id: grant.id, userId: grant.userId, permissionCode, dataScopeId: grant.dataScopeId, validFrom: grant.validFrom, validUntil: grant.validUntil, revokedAt: grant.revokedAt, version: grant.version };
}
function grantState(
  grant: { validFrom: Date; validUntil: Date | null; revokedAt: Date | null },
  at: Date,
): GrantState {
  if (grant.revokedAt) return 'REVOKED';
  if (grant.validFrom > at) return 'PENDING';
  if (grant.validUntil && grant.validUntil <= at) return 'EXPIRED';
  return 'ACTIVE';
}
function isOverlapError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2004')
    || error instanceof Error && /overlap|exclusion|no_overlapping|no_overlap/i.test(error.message);
}
function objectNotFound(): never { throw new AuthorizationError(AUTHORIZATION_CODES.objectNotFound, 404); }
function inUse(): never { throw new AuthorizationError(AUTHORIZATION_CODES.inUse, 409); }
function versionConflict(): never { throw new AuthorizationError(AUTHORIZATION_CODES.version, 409); }
function escalationBlocked(): never { throw new AuthorizationError(AUTHORIZATION_CODES.escalation, 403); }
function inputInvalid(): never { throw new AuthorizationError(AUTHORIZATION_CODES.input, 400); }
