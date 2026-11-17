import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { SMART_CASE_PERMISSION, SMART_CASE_ROLE_CODE, SMART_CASE_ROLE_NAME } from '../../domain/smart-case/access-role';

const ACTION = 'MIGRATE_SMART_CASE_ACCESS';
type DB = PrismaClient | Prisma.TransactionClient;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot(db: DB) {
  const roles = await db.role.findMany({ where: { status: { not: 'DELETED' } }, orderBy: { id: 'asc' }, include: {
    permissions: { orderBy: { permissionId: 'asc' }, include: { permission: true } },
    userRoles: { orderBy: { id: 'asc' }, include: { user: { select: { id: true, username: true, status: true } } } },
  } });
  const previous = await db.operationLog.findFirst({ where: { action: ACTION }, select: { id: true } });
  const existing = roles.find(r => r.code === SMART_CASE_ROLE_CODE);
  const legacy = roles.filter(r => r.type === 'BUSINESS' && r.code !== SMART_CASE_ROLE_CODE && r.permissions.some(p => p.permission.code === SMART_CASE_PERMISSION));
  if (previous) {
    if (!existing || existing.status !== 'ENABLED' || existing.permissions.length !== 1 || existing.permissions[0].permission.code !== SMART_CASE_PERMISSION || legacy.length) throw Error('智慧办案授权与已迁移状态不一致，请人工核对；不会重复授予已撤销资格');
  } else if (existing || roles.some(r => r.name === SMART_CASE_ROLE_NAME) || await db.role.findUnique({ where: { code: SMART_CASE_ROLE_CODE } })) throw Error('独立角色名称或编码已存在，请先核对，不能覆盖已有角色');
  return { roles, legacy, previous, existing, fingerprint: digest({ roles, previous }) };
}

export async function previewSmartCaseAccess(db: DB) {
  const state = await snapshot(db);
  const at = new Date();
  const grants = state.legacy.filter(r => r.status === 'ENABLED').flatMap(r => r.userRoles.filter(g => !g.revokedAt && (!g.validUntil || g.validUntil > at) && g.user.status !== 'DELETED'));
  return { fingerprint: state.fingerprint, completed: !!state.previous,
    roles: state.legacy.map(r => ({ id: r.id, code: r.code, name: r.name, version: r.version })),
    users: [...new Map(grants.map(g => [g.userId, { id: g.userId, username: g.user.username, status: g.user.status }])).values()],
  };
}

/** One-time, reviewed migration. Existing memberships are left intact; only the
 * entry permission moves. Overlapping validity windows are merged per user. */
export async function migrateSmartCaseAccess(db: PrismaClient, actorId: string, expected: string) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE role, role_permission, user_role, "user" IN SHARE ROW EXCLUSIVE MODE');
    const loader = new AuthorizationContextLoader(tx);
    if (!(await loader.load(actorId)).isSystemSuperAdmin) throw Error('仅超级管理员可迁移智慧办案使用资格');
    const state = await snapshot(tx);
    if (state.fingerprint !== expected) throw Error('授权状态已变化，请重新预览迁移差异');
    if (state.previous) return { alreadyApplied: true, roleId: state.existing!.id };
    const at = new Date();
    const permission = await tx.permission.findUniqueOrThrow({ where: { code: SMART_CASE_PERMISSION } });
    if (permission.status !== 'ENABLED') throw Error('智慧办案入口权限未启用');
    const users = await tx.user.findMany({ where: { status: 'ENABLED', OR: [{ lockedUntil: null }, { lockedUntil: { lte: at } }] }, select: { id: true } });
    const effective = async () => Promise.all(users.map(async u => ({ id: u.id, codes: (await loader.load(u.id, at)).permissionCodes })));
    const before = await effective();
    const role = await tx.role.create({ data: { code: SMART_CASE_ROLE_CODE, name: SMART_CASE_ROLE_NAME, type: 'BUSINESS',
      description: '独立智慧办案使用资格，可追加到任何岗位。知识库按账号逐库授权，案件、文件及任务仍按原有权限访问。',
      permissions: { create: { permissionId: permission.id } } } });
    const sourceGrants = state.legacy.filter(r => r.status === 'ENABLED').flatMap(r => r.userRoles.filter(g => !g.revokedAt && (!g.validUntil || g.validUntil > at) && g.user.status !== 'DELETED'));
    const migrated = [];
    for (const userId of [...new Set(sourceGrants.map(g => g.userId))].sort()) {
      const grants = sourceGrants.filter(g => g.userId === userId).sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
      const windows: Array<{ start: Date; end: Date | null; ids: string[] }> = [];
      for (const grant of grants) {
        const last = windows.at(-1);
        if (last && (!last.end || last.end >= grant.validFrom)) {
          last.end = !last.end || !grant.validUntil ? null : new Date(Math.max(last.end.getTime(), grant.validUntil.getTime()));
          last.ids.push(grant.id);
        } else windows.push({ start: grant.validFrom, end: grant.validUntil, ids: [grant.id] });
      }
      for (const window of windows) {
        const grant = await tx.userRole.create({ data: { userId, roleId: role.id, source: window.end ? 'TEMPORARY' : 'PERMANENT', validFrom: window.start, validUntil: window.end,
          reason: window.end ? '迁移原岗位的智慧办案使用资格，保留原授权有效期限' : null, grantedByUserId: actorId } });
        migrated.push({ userId, grantId: grant.id, sourceGrantIds: window.ids, validFrom: window.start, validUntil: window.end });
      }
    }
    for (const old of state.legacy) {
      await tx.rolePermission.deleteMany({ where: { roleId: old.id, permissionId: permission.id } });
      await tx.role.update({ where: { id: old.id }, data: { version: { increment: 1 } } });
    }
    const after = await effective();
    for (const user of users) {
      const context = await loader.load(user.id, at);
      if (!context.isSystemSuperAdmin && context.grants.some(g => g.permissionCode === SMART_CASE_PERMISSION && g.sourceRoleId !== role.id)) throw Error('仍有独立角色之外的智慧办案权限来源，已回滚，请核对授权');
    }
    if (digest(before) !== digest(after)) throw Error('迁移改变了现有用户有效权限，已回滚');
    await tx.operationLog.create({ data: { userId: actorId, action: ACTION, targetType: 'ROLE_AUTHORIZATION', targetId: role.id,
      oldValues: JSON.stringify({ fingerprint: expected, roles: state.legacy.map(r => ({ id: r.id, code: r.code, version: r.version })), effectivePermissions: before }),
      newValues: JSON.stringify({ roleCode: role.code, permissionCodes: [SMART_CASE_PERMISSION], migrated, effectivePermissions: after }) } });
    return { alreadyApplied: false, roleId: role.id, removedFromRoleIds: state.legacy.map(r => r.id), migrated };
  }, { timeout: 30000 });
}
