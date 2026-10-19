import { Prisma } from '@prisma/client';
import { appendCollaborationChange } from './collaboration-change';

/** Invalidation contains no business values. Every subscriber re-queries its current row/field scope. */
export async function notifyDeliveryChange(tx: Prisma.TransactionClient, actorId: string, targetId: string) {
  const tables = await tx.collabTable.findMany({
    where: {
      archived: false,
      OR: [{ source: { in: ['CASES', 'CONTRACTS', 'NEGOTIATIONS'] } }, { lifecycleKind: { not: null } }],
    },
    select: { baseId: true },
    distinct: ['baseId'],
    orderBy: { baseId: 'asc' },
  });
  for (const table of tables)
    await appendCollaborationChange(tx, actorId, table.baseId, 'upstream.updated', targetId);
}
