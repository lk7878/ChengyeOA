import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { writeAuditLog } from './audit-writer';

// ':' is not allowed in registered usernames. Keep the original name and user ID
// for historical attribution without retaining the reusable login identifier.
export function deletedUsername(id: string, username: string): string {
  return `deleted:${id}:${username}`;
}

/** Compatibility for accounts deleted before username release was implemented. */
export async function releaseDeletedUsername(
  tx: Prisma.TransactionClient,
  username: string,
  actor: { userId?: string; ip?: string; reason?: string },
): Promise<void> {
  const [existing] = await tx.$queryRaw<Array<{ id: string; username: string; status: string }>>`
    SELECT "id", "username", "status" FROM "user" WHERE "username" = ${username} FOR UPDATE
  `;
  if (!existing) return;
  if (existing.status !== 'DELETED') throw new MasterDataError('用户名已存在', 409);
  const archivedUsername = deletedUsername(existing.id, existing.username);
  await tx.user.update({ where: { id: existing.id }, data: { username: archivedUsername } });
  await writeAuditLog(tx, {
    userId: actor.userId,
    action: 'RELEASE_DELETED_USERNAME',
    targetType: 'USER',
    targetId: existing.id,
    oldValues: JSON.stringify({ username: existing.username, status: existing.status }),
    newValues: JSON.stringify({ username: archivedUsername, status: 'DELETED', reason: actor.reason ?? 'CREATE_REPLACEMENT_ACCOUNT' }),
    ip: actor.ip,
  });
}
