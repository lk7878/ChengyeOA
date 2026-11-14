import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { buildCaseScopeWhere } from '../case/case-scope';
import { MasterDataError } from '../../domain/master-data/master-data-errors';

type LinkedCase = { id: string; caseNo: string; title: string };
type WithCase = { contract: { case: LinkedCase | null } };

/** Linked labels obey their own case authorization; a finance grant is not a case grant. */
export async function projectFinancialCases<T extends WithCase>(
  db: PrismaClient,
  actor: AuthorizationContext,
  rows: T[],
): Promise<T[]> {
  const ids = rows.flatMap((row) => (row.contract.case ? [row.contract.case.id] : []));
  if (!ids.length) return rows;
  const visible = actor.permissionCodes.includes('case.read')
    ? await db.case.findMany({
        where: { AND: [{ id: { in: ids } }, await buildCaseScopeWhere(db, actor, 'case.read')] },
        select: { id: true },
      })
    : [];
  const allowed = new Set(visible.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    contract: {
      ...row.contract,
      case: row.contract.case && allowed.has(row.contract.case.id) ? row.contract.case : null,
    },
  }));
}

export async function financialCaseFilter(
  db: PrismaClient,
  actor: AuthorizationContext,
  caseNo: string,
): Promise<Prisma.CaseWhereInput> {
  return { AND: [{ caseNo }, await buildCaseScopeWhere(db, actor, 'case.read')] };
}

export async function assertFinancialCaseLink(
  db: PrismaClient,
  actor: AuthorizationContext,
  contractId: string,
  caseNo: string | null,
) {
  if (!caseNo) return;
  const allowed =
    actor.permissionCodes.includes('case.read') &&
    (await db.case.findFirst({
      where: { AND: [{ contractId }, await financialCaseFilter(db, actor, caseNo)] },
      select: { id: true },
    }));
  if (!allowed) throw new MasterDataError('FINANCE_CASE_MISMATCH', 400);
}
