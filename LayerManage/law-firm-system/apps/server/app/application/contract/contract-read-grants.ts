import { Prisma, PrismaClient } from '@prisma/client';
import { AUTHORIZATION_CODES, AuthorizationError } from '../../domain/authorization/authorization-errors';
import { writeAuditLog } from '../system/audit-writer';

type GrantKey = { userId: string; contractId: string };
type Operator = { source: 'local-operations'; operator: string; caseNo?: string }
  | { source: 'oa-admin'; actorUserId: string; ip?: string };

export async function applyContractReadGrant(tx: Prisma.TransactionClient, action: 'grant' | 'revoke',
  key: GrantKey, operator: Operator) {
  const result = action === 'grant'
    ? await tx.contractReadGrant.createMany({ data: [key], skipDuplicates: true })
    : await tx.contractReadGrant.deleteMany({ where: key });
  if (result.count) {
    await writeAuditLog(tx, {
      action: action === 'grant' ? 'GRANT_CONTRACT_READ' : 'REVOKE_CONTRACT_READ',
      targetType: 'CONTRACT', targetId: key.contractId,
      userId: operator.source === 'oa-admin' ? operator.actorUserId : undefined,
      ip: operator.source === 'oa-admin' ? operator.ip : undefined,
      newValues: JSON.stringify({ ...key, permissionCode: 'contract.read', ...operator }),
    });
  }
  return result.count === 1;
}

type Admin = { userId: string; isSystemSuperAdmin: boolean };
function requireAdmin(actor: Admin) {
  if (!actor.isSystemSuperAdmin) throw new AuthorizationError(AUTHORIZATION_CODES.permission, 403);
}

export async function listContractReadGrants(db: PrismaClient, actor: Admin, userId: string) {
  requireAdmin(actor);
  return db.contractReadGrant.findMany({
    where: { userId },
    select: { createdAt: true, contract: { select: { id: true, contractNo: true, title: true, deletedAt: true } } },
    orderBy: [{ createdAt: 'desc' }, { contractId: 'asc' }],
  });
}

export async function manageContractReadGrant(db: PrismaClient, actor: Admin, action: 'grant' | 'revoke',
  key: GrantKey, ip?: string) {
  requireAdmin(actor);
  if (key.userId === actor.userId) throw new AuthorizationError(AUTHORIZATION_CODES.escalation, 403);
  return db.$transaction(async tx => {
    if (action === 'grant') {
      const user = await tx.user.findFirst({ where: { id: key.userId, status: 'ENABLED' }, select: { id: true } });
      const contract = await tx.contract.findFirst({ where: { id: key.contractId, deletedAt: null }, select: { id: true } });
      if (!user || !contract) throw new AuthorizationError(AUTHORIZATION_CODES.hidden, 404);
    }
    const changed = await applyContractReadGrant(tx, action, key, { source: 'oa-admin', actorUserId: actor.userId, ip });
    return { changed };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
