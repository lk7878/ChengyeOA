import { Prisma } from '@prisma/client';
import { check } from '../../domain/workflow/schema';

export const activeTeam: Prisma.ProfessionalTeamWhereInput = { deletedAt: null, status: 'ENABLED' };
export const activeEmployee: Prisma.EmployeeWhereInput = { deletedAt: null, status: { not: 'LEAVED' } };
export const personFields = { id: true, name: true, employeeNo: true } as const;
export const personalScope = (employeeId: string) => 'personal:' + employeeId;

export function caseAssignment(employeeId: string, teamId: string | null): Prisma.CaseWhereInput {
  // The contract's owning team takes precedence over any cooperating case teams.
  const unassignedContract: Prisma.CaseWhereInput = {
    OR: [{ contractId: null }, { contract: { professionalTeamId: null } }],
  };
  const unassignedCase: Prisma.CaseWhereInput = {
    OR: [{ teamIds: null }, { teamIds: '[]' }, { teamIds: '' }],
  };
  return {
    AND: [
      { OR: [{ lawyerId: employeeId }, { intakeData: { path: ['handlingLawyer'], equals: employeeId } }] },
      teamId
        ? {
            OR: [
              { contract: { professionalTeamId: teamId } },
              {
                AND: [
                  unassignedContract,
                  { OR: [unassignedCase, { teamIds: { contains: JSON.stringify(teamId) } }] },
                ],
              },
            ],
          }
        : { AND: [unassignedContract, unassignedCase] },
    ],
  };
}

export async function lockCost(tx: Prisma.TransactionClient, scope: string, period: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope + '/' + period},1))`;
}

export async function allocated(
  tx: Prisma.TransactionClient,
  teamId: string | null,
  employeeId: string,
  period: string,
  exclude?: string,
) {
  const total = await tx.caseSettlement.aggregate({
    where: {
      ...(teamId ? { teamId } : { ownerEmployeeId: employeeId }),
      period,
      ...(exclude ? { id: { not: exclude } } : {}),
    },
    _sum: { allocatedCost: true },
  });
  return total._sum.allocatedCost ?? new Prisma.Decimal(0);
}

export function checkInitiator(employeeId: string | null, teamId: string | null, leads: string[]) {
  check(
    employeeId && (!teamId || leads.includes(teamId)),
    '团队结算须由本团队负责人发起，个人结算须绑定在职员工',
    403,
  );
}
