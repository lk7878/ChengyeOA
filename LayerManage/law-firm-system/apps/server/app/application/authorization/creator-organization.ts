import { Prisma } from '@prisma/client';
/** Resolve actual creators through their current valid employment organization; never infer historical ownership. */
export async function creatorIdsInOrganizations(db: Prisma.TransactionClient, organizationIds: string[]) {
  const now = new Date();
  return (
    await db.user.findMany({
      where: {
        status: 'ENABLED',
        employee: {
          deletedAt: null,
          status: { not: 'LEAVED' },
          assignments: {
            some: {
              organizationId: { in: organizationIds },
              position: { status: 'ENABLED' },
              startedAt: { lte: now },
              OR: [{ endedAt: null }, { endedAt: { gt: now } }],
            },
          },
        },
      },
      select: { id: true },
    })
  ).map((user) => user.id);
}
