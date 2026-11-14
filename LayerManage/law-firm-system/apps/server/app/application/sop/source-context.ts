import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { requireCaseAccess } from '../case/case-scope';
import { buildLeadScopeWhere } from '../crm/lead-scope';
import { buildContractScopeWhere } from '../contract/contract-scope';
import { sopFail } from '../../domain/sop/template-content';
import { SopDatabase } from './sop-scope';

export type SopSource = {
  caseId: string | null;
  leadId?: string | null;
  analysisEngagementId?: string | null;
};
export function sourceKind(source: SopSource) {
  if ([source.caseId, source.leadId, source.analysisEngagementId].filter(Boolean).length !== 1)
    sopFail('SOP_SOURCE_INVALID', 400);
  return source.caseId ? 'CASE' : source.leadId ? 'LEAD' : 'ANALYSIS_ENGAGEMENT';
}
export async function lockSopSource(tx: Prisma.TransactionClient, source: SopSource) {
  const kind = sourceKind(source);
  if (kind === 'CASE') await tx.$queryRaw`SELECT id FROM "case" WHERE id=${source.caseId} FOR UPDATE`;
  else if (kind === 'LEAD') await tx.$queryRaw`SELECT id FROM lead WHERE id=${source.leadId} FOR UPDATE`;
  else {
    const engagement = await tx.analysisEngagement.findUnique({
      where: { id: source.analysisEngagementId! },
    });
    if (!engagement) sopFail('SOP_SOURCE_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM contract WHERE id=${engagement!.contractId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM analysis_engagement WHERE id=${engagement!.id} FOR UPDATE`;
  }
}
export async function requireSopSource(
  db: SopDatabase,
  ctx: AuthorizationContext,
  source: SopSource,
  manage = false,
) {
  const kind = sourceKind(source),
    auth = new AuthorizationService(new DataScopeService(db));
  if (kind === 'CASE') {
    const row = await requireCaseAccess(db as PrismaClient, ctx, source.caseId!, 'case.read', db);
    if (manage) await requireCaseAccess(db as PrismaClient, ctx, row.id, 'case.task.manage', db);
    let teams: string[] = [];
    try {
      const value = JSON.parse(row.teamIds || '[]');
      if (Array.isArray(value)) teams = value;
    } catch {
      /* unknown remains unknown */
    }
    return {
      kind,
      id: row.id,
      title: row.title,
      route: '/cases/' + row.id,
      organizationId: row.branchId,
      teamIds: teams,
      caseType: row.caseType,
      customerId: row.customerId,
    };
  }
  if (kind === 'LEAD') {
    auth.requireAction(ctx, 'lead.read');
    const conditions: Prisma.LeadWhereInput[] = [
      { id: source.leadId!, deletedAt: null },
      await buildLeadScopeWhere(db as PrismaClient, auth, ctx, 'lead.read'),
    ];
    if (manage) {
      auth.requireAction(ctx, 'lead.update');
      conditions.push(await buildLeadScopeWhere(db as PrismaClient, auth, ctx, 'lead.update'));
    }
    const row = await db.lead.findFirst({
      where: { AND: conditions },
      include: { customer: { select: { id: true } } },
    });
    if (!row) sopFail('SOP_SOURCE_NOT_FOUND', 404);
    return {
      kind,
      id: row!.id,
      title: row!.leadNo,
      route: '/leads/' + row!.id,
      organizationId: row!.branchId,
      teamIds: row!.professionalTeamId ? [row!.professionalTeamId] : [],
      caseType: null,
      customerId: row!.customer?.id ?? null,
    };
  }
  auth.requireAction(ctx, 'contract.read');
  const conditions: Prisma.ContractWhereInput[] = [
    { deletedAt: null },
    await buildContractScopeWhere(db as PrismaClient, auth, ctx, 'contract.read'),
  ];
  // Contracts have no generic update permission; SOP start/manage is independently scoped.
  const row = await db.analysisEngagement.findFirst({
    where: { id: source.analysisEngagementId!, contract: { AND: conditions } },
    include: { contract: true },
  });
  if (!row) sopFail('SOP_SOURCE_NOT_FOUND', 404);
  if (row!.customerId !== row!.contract.customerId || row!.contract.contractType !== 'FIRST_SIGN')
    sopFail('SOP_SOURCE_INVALID', 409);
  return {
    kind,
    id: row!.id,
    title: row!.engagementNo,
    route: '/contracts/' + row!.contractId,
    organizationId: row!.contract.branchId,
    teamIds: row!.contract.professionalTeamId ? [row!.contract.professionalTeamId] : [],
    caseType: null,
    customerId: row!.customerId,
  };
}
export async function sopSourceActive(db: SopDatabase, source: SopSource) {
  const kind = sourceKind(source);
  if (kind === 'CASE')
    return !!(await db.case.count({
      where: { id: source.caseId!, status: { notIn: ['CLOSED', 'ARCHIVED'] } },
    }));
  if (kind === 'LEAD')
    return !!(await db.lead.count({
      where: { id: source.leadId!, deletedAt: null, isValid: true, status: { not: 'LOST' } },
    }));
  return !!(await db.analysisEngagement.count({
    where: {
      id: source.analysisEngagementId!,
      contract: { deletedAt: null, contractType: 'FIRST_SIGN', status: 'EFFECTIVE' },
    },
  }));
}
export async function bumpSopCase(tx: Prisma.TransactionClient, source: SopSource, userId: string) {
  if (source.caseId)
    await tx.case.update({
      where: { id: source.caseId },
      data: { version: { increment: 1 }, updatedBy: userId },
    });
}
