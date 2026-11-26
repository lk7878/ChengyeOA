import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildContractScopeWhere } from './contract-scope';
import { buildCaseScopeWhere } from '../case/case-scope';

// A contract must be readable AND within the actor's payment-create scope.
// Workspace location is not a contract's business ownership or an authorization grant.
export async function paymentContractScope(db: PrismaClient, actor: AuthorizationContext) {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(actor, 'contract.read');
  auth.requireAction(actor, 'payment.create');
  return { AND: [
    { deletedAt: null },
    await buildContractScopeWhere(db, auth, actor, 'contract.read'),
    await buildContractScopeWhere(db, auth, actor, 'payment.create', 'payment'),
  ] } satisfies Prisma.ContractWhereInput;
}

export async function paymentContractChoices(db: PrismaClient, actor: AuthorizationContext,
  input: { page: number; keyword: string; id?: string }) {
  const caseScope = actor.isSystemSuperAdmin || actor.permissionCodes.includes('case.read')
    ? { AND: [{ deletedAt: null }, await buildCaseScopeWhere(db, actor, 'case.read', db, { includeWorksheetLead: true })] }
    : { id: { in: [] as string[] } };
  const contains = { contains: input.keyword, mode: 'insensitive' as const };
  const where: Prisma.ContractWhereInput = { AND: [
    await paymentContractScope(db, actor),
    { status: { in: ['SIGNED', 'EFFECTIVE'] } },
    ...(input.id ? [{ id: input.id }] : []),
    ...(input.keyword ? [{ OR: [
      { contractNo: contains }, { title: contains }, { customer: { name: contains } },
      { case: { AND: [caseScope, { OR: [{ caseNo: contains }, { title: contains }] }] } },
    ] }] : []),
  ] };
  const [rows, total] = await Promise.all([
    db.contract.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 20, skip: (input.page - 1) * 20,
      select: { id: true, contractNo: true, customer: { select: { name: true } }, amount: true, status: true, branchId: true },
    }),
    db.contract.count({ where }),
  ]);
  const cases = await db.case.findMany({ where: { AND: [caseScope, { contractId: { in: rows.map(r => r.id) } }] },
    select: { contractId: true, caseNo: true, title: true } });
  const orgs = await db.organization.findMany({ where: { id: { in: rows.flatMap(r => r.branchId ? [r.branchId] : []) } }, select: { id: true, name: true } });
  return { total, list: rows.map(row => {
    const related = cases.find(c => c.contractId === row.id);
    return { id: row.id, contractNo: row.contractNo, customerName: row.customer.name,
      label: [row.contractNo, row.customer.name, related ? related.caseNo + ' · ' + related.title : null].filter(Boolean).join('｜'),
      caseNo: related?.caseNo, caseTitle: related?.title, amount: row.amount.toFixed(2), status: row.status,
      organizationName: orgs.find(o => o.id === row.branchId)?.name ?? '未设置',
    };
  }) };
}
