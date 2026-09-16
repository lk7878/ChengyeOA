import { Prisma, PrismaClient } from '@prisma/client';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
export async function employmentStamp(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  now = new Date(),
): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { employee: true } });
  if (
    !user ||
    user.status !== 'ENABLED' ||
    !user.employee ||
    user.employee.deletedAt ||
    user.employee.status === 'LEAVED'
  )
    return null;
  const active = {
    employeeId: user.employee.id,
    startedAt: { lte: now },
    OR: [{ endedAt: null }, { endedAt: { gt: now } }],
  };
  const [assignments, teams] = await Promise.all([
    db.employeeAssignment.findMany({
      where: active,
      select: {
        id: true,
        version: true,
        organization: { select: { status: true } },
        position: { select: { status: true } },
      },
      orderBy: { id: 'asc' },
    }),
    db.professionalTeamMember.findMany({
      where: active,
      select: { id: true, version: true, professionalTeam: { select: { status: true } } },
      orderBy: { id: 'asc' },
    }),
  ]);
  return hashPayload({ employeeId: user.employee.id, assignments, teams });
}
