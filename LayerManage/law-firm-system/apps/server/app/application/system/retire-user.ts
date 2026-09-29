import { PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { transferUserResources } from '../master-data/employee-resource-transfer';
import { assertMutableUser, assertNonAdministratorUserMutable } from './trust-root-guard';
import { writeAuditLog } from './audit-writer';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeRequiredText } from '../../domain/master-data/master-data-validation';

export async function retireUser(prisma: PrismaClient, actor: AuthorizationContext, id: string, input: { recipientUserId?: string }, ip?: string) {
  assertExactKeys(input, ['recipientUserId']);
  const recipientUserId = input.recipientUserId === undefined ? undefined : normalizeRequiredText(input.recipientUserId, 1, 100);
  const authorization = new AuthorizationService(new DataScopeService(prisma));
  await authorization.requireRecord(actor, 'user', 'user.status.manage', id);
  if (id === actor.userId) throw new MasterDataError('不能删除当前登录账号', 409);
  if (recipientUserId && !actor.isSystemSuperAdmin) throw new MasterDataError('资源转交需要超级管理员操作', 403);
  await prisma.$transaction(async tx => {
    const before = await tx.user.findUnique({ where: { id }, select: { employeeId: true } });
    // Follow the employee-binding lock order to serialize unbind/rebind and removal.
    if (before?.employeeId) await tx.$queryRaw`SELECT "id" FROM "employee" WHERE "id" = ${before.employeeId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.status === 'DELETED') throw new MasterDataError('USER_NOT_FOUND', 404);
    if (before?.employeeId !== user.employeeId) throw new MasterDataError('VERSION_CONFLICT', 409);
    await assertMutableUser(tx, id);
    await assertNonAdministratorUserMutable(tx, id);
    if (user.status !== 'DISABLED') throw new MasterDataError('请先禁用账号，再执行删除', 409);
    const transferred = await transferUserResources(tx, id, recipientUserId);
    const now = new Date();
    await tx.user.update({ where: { id }, data: { status: 'DELETED', employeeId: null, credentialVersion: { increment: 1 } } });
    if (user.employeeId) await tx.employee.update({ where: { id: user.employeeId }, data: { version: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' } });
    const revocation = { revokedAt: now, revokedByUserId: actor.userId, revokeReason: 'Account deleted by administrator', version: { increment: 1 } };
    await tx.userRole.updateMany({ where: { userId: id, revokedAt: null }, data: revocation });
    await tx.userPermissionGrant.updateMany({ where: { userId: id, revokedAt: null }, data: revocation });
    await writeAuditLog(tx, { userId: actor.userId, action: 'DELETE_USER', targetType: 'USER', targetId: id, newValues: JSON.stringify({ status: 'DELETED', transferred }), ip });
  });
}
