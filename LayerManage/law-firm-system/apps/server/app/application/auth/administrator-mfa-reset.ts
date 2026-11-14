import { Prisma } from '@prisma/client';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';

export type AdministratorMfaResetSource = 'GOVERNANCE' | 'RECOVERY';

export async function resetAdministratorMfa(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  actorUserId: string,
  source: AdministratorMfaResetSource,
  now: Date = new Date(),
  auditWriter: AuditWriter = writeAuditLog,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "mfa_factor" WHERE "userId" = ${targetUserId} ORDER BY "id" FOR UPDATE
  `);
  const factors = await tx.mfaFactor.findMany({ where: { userId: targetUserId }, select: { id: true } });
  const factorIds = factors.map(factor => factor.id);
  if (factorIds.length > 0) {
    await tx.mfaRecoveryCode.updateMany({
      where: { factorId: { in: factorIds }, usedAt: null },
      data: { usedAt: now },
    });
    await tx.mfaFactor.updateMany({
      where: { id: { in: factorIds }, disabledAt: null },
      data: { disabledAt: now },
    });
  }
  await tx.authSession.updateMany({
    where: { userId: targetUserId, revokedAt: null },
    data: { revokedAt: now, revokedReason: `ADMIN_MFA_RESET_${source}` },
  });
  await tx.user.update({
    where: { id: targetUserId },
    data: { credentialVersion: { increment: 1 } },
  });
  await auditWriter(tx, {
    userId: actorUserId,
    action: `ADMIN_MFA_RESET_${source}`,
    targetType: 'USER',
    targetId: targetUserId,
    newValues: JSON.stringify({ source, result: 'SUCCESS' }),
  });
}
