import { deliveryModulesEnabled } from '../../domain/module-availability';
import {
  ReviewEngine,
  reviewReference,
  reviewApproval,
  reviewVisible,
} from '../approval/review-approval-store';
import { Prisma, PrismaClient } from '@prisma/client';
import { analysisChanged } from './analysis-change';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { qualityActor, qualityCaseScope } from './quality-scope';
import { sopFail } from '../../domain/sop/template-content';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
type DB = PrismaClient | Prisma.TransactionClient;
export async function analysisApprovalScope(
  db: DB,
  ctx: AuthorizationContext,
): Promise<Prisma.ApprovalInstanceWhereInput> {
  if (!ctx.permissionCodes.includes('quality.analysis.read') || !ctx.permissionCodes.includes('case.read'))
    return { businessType: { not: 'QUALITY_ANALYSIS' } };
  return {
    OR: [
      { businessType: { not: 'QUALITY_ANALYSIS' } },
      {
        analysisClose: {
          analysis: { case: await qualityCaseScope(db as PrismaClient, ctx, 'quality.analysis.read') },
        },
      },
    ],
  };
}
export async function analysisReviewer(
  db: DB,
  userId: string,
  caseId: string,
  submitter: string,
  analysisId: string,
) {
  if (userId === submitter || (await db.analysisRevision.count({ where: { analysisId, createdBy: userId } })))
    sopFail('QUALITY_SELF_REVIEW', 403);
  const ctx = await qualityActor(db, userId),
    auth = new AuthorizationService(new DataScopeService(db));
  for (const p of [
    'approval.read',
    'approval.process',
    'quality.analysis.read',
    'quality.analysis.decide',
  ] as const)
    auth.requireAction(ctx, p);
  for (const p of ['quality.analysis.read', 'quality.analysis.decide'] as const)
    if (
      !(await db.case.count({
        where: { AND: [{ id: caseId }, await qualityCaseScope(db as PrismaClient, ctx, p)] },
      }))
    )
      sopFail('QUALITY_NOT_FOUND', 404);
  return ctx;
}
export async function lockAnalysisApproval(
  db: Prisma.TransactionClient,
  id: string,
  engine: ReviewEngine = 'legacy',
) {
  const request = await db.analysisCloseRequest.findUnique({ where: reviewReference(id, engine) });
  if (!request) return;
  await db.$queryRaw`SELECT id FROM special_analysis WHERE id=${request.analysisId} FOR UPDATE`;
}
export async function guardAnalysisApproval(
  db: DB,
  ctx: AuthorizationContext,
  id: string,
  action: 'READ' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'FORWARD',
  remark?: string | null,
  engine: ReviewEngine = 'legacy',
) {
  const instance = await reviewApproval(db, id, engine);
  if (instance?.businessType !== 'QUALITY_ANALYSIS') return;
  const fresh = await qualityActor(db, ctx.userId);
  if (!(await reviewVisible(db, id, await analysisApprovalScope(db, fresh), engine)))
    sopFail('QUALITY_NOT_FOUND', 404);
  if (action === 'READ') return;
  if(!deliveryModulesEnabled) sopFail('MODULE_RETIRED',409);
  if (action === 'FORWARD') sopFail('QUALITY_APPROVAL_FIXED', 409);
  const request = await db.analysisCloseRequest.findUniqueOrThrow({
    where: reviewReference(id, engine),
    include: { analysis: true },
  });
  if (action === 'WITHDRAW') {
    if (request.createdBy !== fresh.userId) sopFail('QUALITY_NOT_FOUND', 404);
    const auth = new AuthorizationService(new DataScopeService(db));
    auth.requireAction(fresh, 'quality.analysis.close');
    if (
      !(await db.case.count({
        where: {
          AND: [
            { id: request.analysis.caseId },
            await qualityCaseScope(db as PrismaClient, fresh, 'quality.analysis.close'),
          ],
        },
      }))
    )
      sopFail('QUALITY_NOT_FOUND', 404);
    return;
  }
  if (request.reviewerUserId !== fresh.userId) sopFail('QUALITY_NOT_FOUND', 404);
  await analysisReviewer(db, fresh.userId, request.analysis.caseId, request.createdBy, request.analysisId);
  if (instance.status !== 'PENDING' && instance.status !== (action === 'APPROVE' ? 'APPROVED' : 'REJECTED'))
    sopFail('QUALITY_APPROVAL_STALE', 409);
  if (action === 'REJECT' && !remark?.trim()) sopFail('QUALITY_REASON_REQUIRED');
}
export async function syncAnalysisApproval(
  tx: Prisma.TransactionClient,
  id: string,
  actor: AuditActor,
  engine: ReviewEngine = 'legacy',
) {
  const approval = await reviewApproval(tx, id, engine);
  if (approval.businessType !== 'QUALITY_ANALYSIS') return null;
  const request = await tx.analysisCloseRequest.findUniqueOrThrow({
      where: reviewReference(id, engine),
      include: { analysis: true },
    }),
    row = request.analysis;
  const terminal =
    approval.status === 'APPROVED'
      ? 'APPROVED'
      : approval.status === 'REJECTED'
        ? 'RETURNED'
        : approval.status === 'WITHDRAWN'
          ? 'CANCELLED'
          : null;
  if (!terminal) return null;
  if (request.status === terminal) return row.id;
  if (
    request.status !== 'PENDING' ||
    row.status !== 'PENDING_CLOSE' ||
    row.currentCloseId !== request.id ||
    row.version !== request.analysisVersion
  )
    sopFail('QUALITY_APPROVAL_STALE', 409);
  const snapshot = {
    analysisId: row.id,
    content: row.content,
    conclusion: row.conclusion,
    analysisVersion: row.version,
  };
  const content = approval.content as Record<string, unknown>;
  if (
    hashPayload(snapshot) !== request.contentHash ||
    hashPayload(request.contentSnapshot) !== request.contentHash ||
    content.closeRequestId !== request.id ||
    content.contentHash !== request.contentHash
  )
    sopFail('QUALITY_APPROVAL_STALE', 409);
  if (terminal === 'APPROVED') {
    if (!approval.decidedBy) sopFail('QUALITY_APPROVAL_STALE', 409);
    await analysisReviewer(tx, approval.decidedBy!, row.caseId, request.createdBy, row.id);
  }
  await tx.analysisCloseRequest.update({ where: { id: request.id }, data: { status: terminal } });
  await tx.specialAnalysis.update({
    where: { id: row.id },
    data: {
      status: terminal === 'APPROVED' ? 'CLOSED' : 'ANALYZING',
      version: { increment: 1 },
      updatedBy: actor.actorUserId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: actor.actorUserId,
      action: 'QUALITY_ANALYSIS_' + terminal,
      targetType: 'SPECIAL_ANALYSIS',
      targetId: row.id,
      newValues: JSON.stringify({ closeRequestId: request.id, approvalInstanceId: id }),
      ip: actor.ip,
    },
  });
  await analysisChanged(tx, row.id, actor.actorUserId, terminal);
  return row.id;
}
