import { Prisma } from '@prisma/client';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { appendCollaborationChange } from '../collaboration/collaboration-change';

/** The business mutation, durable event and native-view invalidation share one transaction. */
export async function analysisChanged(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  action: string,
) {
  const row = await tx.specialAnalysis.findUniqueOrThrow({ where: { id }, include: { case: true } });
  const organizationId = row.case.branchId;
  await new PrismaEventOutboxWriter().append(tx, {
    eventType: 'quality.changed',
    eventVersion: 1,
    objectType: 'QUALITY',
    objectId: id,
    operatorUserId: userId,
    organizationId,
    branchId: organizationId,
    teamId: null,
    payload: { id, version: row.version, action, type: 'QUALITY_ANALYSIS' },
    traceId: id,
    occurredAt: new Date(),
  });
  if (!organizationId) return;
  const org = await tx.organization.findUnique({ where: { id: organizationId } });
  const bases = await tx.collabTable.findMany({
    where: {
      source: 'QUALITY_ANALYSES',
      base: {
        workspace: {
          organizationId: {
            in: org?.path.split('/').filter(Boolean) ?? [],
          },
        },
      },
    },
    select: { baseId: true },
    distinct: ['baseId'],
  });
  for (const base of bases)
    await appendCollaborationChange(tx, userId, base.baseId, 'business.changed', base.baseId);
}
