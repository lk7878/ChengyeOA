import {
  ReviewEngine,
  reviewReference,
  reviewApproval,
  reviewVisible,
} from '../approval/review-approval-store';
import { lockSopSource, sopSourceActive, bumpSopCase } from './source-context';
import { requireSourceMaterials, sourceMaterialBytes } from './source-file-service';
import { SopExecutionService } from './execution-service';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { SopDatabase } from './sop-scope';
import { requireSopTask, sopTaskScope } from './execution-scope';
import { SopNode, sopFail } from '../../domain/sop/template-content';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { requireCaseAccess } from '../case/case-scope';

export function materialBytes(file: { filePath: string; fileSize: number }) {
  const root = path.resolve(process.cwd(), 'var/storage/case-files');
  const target = path.resolve(root, file.filePath);
  if (path.dirname(target) !== root) sopFail('SOP_MATERIAL_CHANGED', 409);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(target);
  } catch {
    return sopFail('SOP_MATERIAL_CHANGED', 409);
  }
  if (bytes.length !== file.fileSize) sopFail('SOP_MATERIAL_CHANGED', 409);
  return createHash('sha256').update(bytes).digest('hex');
}
export async function checkReviewer(
  db: SopDatabase,
  userId: string,
  taskId: string,
  submitter: string,
  executor: string | null,
) {
  if (userId === submitter || userId === executor) sopFail('SOP_SELF_REVIEW', 409);
  const context = await new AuthorizationContextLoader(db).load(userId);
  const auth = new AuthorizationService(new DataScopeService(db));
  for (const permission of [
    'approval.process',
    'approval.read',
    'sop.report.read',
    'quality.review.read',
    'quality.review.decide',
  ] as const)
    auth.requireAction(context, permission);
  await requireSopTask(db, context, taskId, 'sop.task.read');
  await requireSopTask(db, context, taskId, 'sop.report.read');
  const task = await requireSopTask(db, context, taskId, 'quality.review.decide');
  const node = task.nodeSnapshot as unknown as SopNode;
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { employee: true },
  });
  if (user.employee && (user.employee.deletedAt || user.employee.status === 'LEAVED'))
    sopFail('SOP_REVIEWER_INVALID', 409);
  if (node.reviewerRoleId) {
    const now = new Date();
    if (
      !(await db.userRole.findFirst({
        where: {
          userId,
          roleId: node.reviewerRoleId,
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          role: { status: 'ENABLED' },
        },
      }))
    )
      sopFail('SOP_REVIEWER_INVALID', 409);
  }
  return context;
}
export async function sopApprovalScope(
  db: SopDatabase,
  ctx: AuthorizationContext,
): Promise<Prisma.ApprovalInstanceWhereInput> {
  if (!ctx.permissionCodes.includes('sop.task.read') || !ctx.permissionCodes.includes('sop.report.read'))
    return { businessType: { not: 'SOP_REVIEW' } };
  const taskWhere = {
    AND: [await sopTaskScope(db, ctx, 'sop.task.read'), await sopTaskScope(db, ctx, 'sop.report.read')],
  };
  const reviewWhere = ctx.permissionCodes.includes('quality.review.read')
    ? await sopTaskScope(db, ctx, 'quality.review.read')
    : { id: { in: [] as string[] } };
  return {
    OR: [
      { businessType: { not: 'SOP_REVIEW' } },
      {
        OR: [
          {
            applicantId: ctx.userId,
            qualityReview: { submission: { task: taskWhere } },
          },
          {
            qualityReview: {
              submission: { task: { AND: [taskWhere, reviewWhere] } },
            },
          },
        ],
      },
    ],
  };
}
export async function lockSopApproval(
  db: Prisma.TransactionClient,
  approvalId: string,
  engine: ReviewEngine = 'legacy',
) {
  const review = await db.qualityReview.findUnique({
    where: reviewReference(approvalId, engine),
    include: { submission: { include: { task: true } } },
  });
  if (!review) return;
  const task = review.submission.task;
  await lockSopSource(db, await db.sopInstance.findUniqueOrThrow({ where: { id: task.sopInstanceId! } }));
  await db.$queryRaw`SELECT id FROM sop_instance WHERE id=${task.sopInstanceId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM case_task WHERE id=${task.id} FOR UPDATE`;
}
export async function guardSopApproval(
  db: SopDatabase,
  ctx: AuthorizationContext,
  approvalId: string,
  action: 'READ' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'FORWARD',
  remark?: string | null,
  engine: ReviewEngine = 'legacy',
) {
  const approval = await reviewApproval(db, approvalId, engine);
  if (approval?.businessType !== 'SOP_REVIEW') return;
  const current = await new AuthorizationContextLoader(db).load(ctx.userId);
  if (!(await reviewVisible(db, approvalId, await sopApprovalScope(db, current), engine)))
    sopFail('SOP_REVIEW_NOT_FOUND', 404);
  if (action === 'READ') return;
  if (action === 'FORWARD') sopFail('SOP_REVIEW_ROUTING_FIXED', 409);
  const review = await db.qualityReview.findUniqueOrThrow({
    where: reviewReference(approvalId, engine),
    include: { submission: true },
  });
  if (action === 'WITHDRAW') {
    await requireSopTask(db, current, review.submission.taskId, 'sop.report.submit');
    return;
  }
  if (review.reviewerUserId !== current.userId) sopFail('SOP_REVIEWER_INVALID', 409);
  await checkReviewer(
    db,
    current.userId,
    review.submission.taskId,
    review.submission.submittedBy,
    review.submission.executorUserId,
  );
  if (approval.status !== 'PENDING' && approval.status !== (action === 'APPROVE' ? 'APPROVED' : 'REJECTED'))
    sopFail('SOP_REVIEW_STALE', 409);
  if (action === 'REJECT' && !remark?.trim()) sopFail('SOP_REVIEW_REASON_REQUIRED');
  if (action === 'APPROVE') {
    const checks = review.checklist as unknown as Array<{
      code: string;
      result: string;
      reason: string;
    }>;
    if (
      !Array.isArray(checks) ||
      !checks.length ||
      checks.some((c) => c.result !== 'PASS' && !(c.result === 'NA' && c.reason?.trim()))
    )
      sopFail('SOP_CHECKLIST_INCOMPLETE', 409);
  }
}
export async function freezeSopReviewChecklist(
  tx: Prisma.TransactionClient,
  approvalId: string,
  engine: ReviewEngine = 'legacy',
) {
  const review = await tx.qualityReview.findUniqueOrThrow({
    where: reviewReference(approvalId, engine),
  });
  const approval = await reviewApproval(tx, approvalId, engine);
  const data = {
    content: {
      ...(approval.content as Prisma.InputJsonObject),
      reviewChecklist: review.checklist,
      reviewChecklistHash: hashPayload(review.checklist),
    } as Prisma.InputJsonValue,
  };
  if (engine === 'workflow') {
    const workflow = await tx.workflowInstance.findUniqueOrThrow({ where: { id: approvalId } });
    await tx.workflowInstance.update({
      where: { id: approvalId },
      data: {
        selections: {
          ...(workflow.selections as Prisma.InputJsonObject),
          reviewChecklist: review.checklist,
          reviewChecklistHash: hashPayload(review.checklist),
        } as Prisma.InputJsonValue,
      },
    });
  } else await tx.approvalInstance.update({ where: { id: approvalId }, data });
}
export async function syncSopReview(
  tx: Prisma.TransactionClient,
  approvalId: string,
  actor: AuditActor,
  engine: ReviewEngine = 'legacy',
) {
  const approval = await reviewApproval(tx, approvalId, engine);
  if (approval.businessType !== 'SOP_REVIEW') return null;
  const review = await tx.qualityReview.findUniqueOrThrow({
    where: reviewReference(approvalId, engine),
    include: {
      submission: {
        include: {
          attachments: { include: { file: true, sourceFile: true } },
          task: {
            include: {
              sopInstance: {
                include: { templateVersion: { include: { template: true } } },
              },
            },
          },
        },
      },
    },
  });
  const sub = review.submission,
    task = sub.task;
  if (review.status !== 'PENDING') {
    if (
      review.status ===
      (approval.status === 'APPROVED'
        ? 'APPROVED'
        : approval.status === 'REJECTED'
          ? 'RETURNED'
          : 'CANCELLED')
    )
      return review.id;
    sopFail('SOP_REVIEW_STALE', 409);
  }
  const sourceActive = await sopSourceActive(tx, task.sopInstance!);
  if (
    task.activeSubmissionId !== sub.id ||
    (approval.status === 'APPROVED' && task.version !== sub.taskVersion) ||
    task.status !== 'IN_REVIEW' ||
    task.sopInstance?.status !== 'ACTIVE' ||
    !sourceActive
  )
    sopFail('SOP_REVIEW_STALE', 409);
  const snapshot = {
    taskId: sub.taskId,
    number: sub.number,
    report: sub.report,
    node: sub.nodeSnapshot,
    materials: sub.materialChecklist,
    submittedBy: sub.submittedBy,
    executorUserId: sub.executorUserId,
  };
  if (
    hashPayload(snapshot) !== sub.contentHash ||
    (approval.content as Record<string, unknown>).contentHash !== sub.contentHash
  )
    sopFail('SOP_REVIEW_STALE', 409);
  if (approval.status === 'APPROVED') {
    const frozenChecklist =
      engine === 'workflow'
        ? (await tx.workflowInstance.findUniqueOrThrow({ where: { id: approvalId } })).selections
        : approval.content;
    if ((frozenChecklist as Record<string, unknown>).reviewChecklistHash !== hashPayload(review.checklist))
      sopFail('SOP_REVIEW_STALE', 409);
    const frozen = sub.materialChecklist as Array<{
      code: string;
      fileId: string;
      sha256: string;
      fileSize: number;
    }>;
    const actual = sub.attachments.map((a) => ({
      code: a.materialCode,
      fileId: a.fileId ?? a.sourceFileId!,
      sha256: a.sha256,
      fileSize: a.fileSize,
    }));
    const sorted = (rows: typeof actual) =>
      [...rows].sort((a, b) => (a.code + ':' + a.fileId).localeCompare(b.code + ':' + b.fileId));
    if (hashPayload(sorted(frozen)) !== hashPayload(sorted(actual))) sopFail('SOP_MATERIAL_CHANGED', 409);

    if (!approval.decidedBy) sopFail('SOP_REVIEWER_INVALID', 409);
    const ctx = await checkReviewer(tx, approval.decidedBy!, task.id, sub.submittedBy, sub.executorUserId);
    await guardSopApproval(tx, ctx, approval.id, 'APPROVE', undefined, engine);
    if (sub.attachments.length) {
      if (task.caseId) await requireCaseAccess(tx as PrismaClient, ctx, task.caseId, 'case.file.read', tx);
      else await requireSourceMaterials(tx, ctx, task.id);
    }
    for (const attachment of sub.attachments) {
      const file = attachment.file ?? attachment.sourceFile;
      if (!file) sopFail('SOP_MATERIAL_CHANGED', 409);
      const hash = attachment.file
        ? materialBytes(attachment.file)
        : createHash('sha256').update(sourceMaterialBytes(attachment.sourceFile!)).digest('hex');
      if (hash !== attachment.sha256 || file!.fileSize !== attachment.fileSize)
        sopFail('SOP_MATERIAL_CHANGED', 409);
    }
  }
  const approved = approval.status === 'APPROVED';
  await tx.qualityReview.update({
    where: { id: review.id },
    data: {
      status: approved ? 'APPROVED' : approval.status === 'REJECTED' ? 'RETURNED' : 'CANCELLED',
      version: { increment: 1 },
    },
  });
  const updated = await tx.caseTask.update({
    where: { id: task.id },
    data: {
      status: approved ? 'COMPLETED' : 'CHANGES_REQUESTED',
      completedAt: approved ? new Date() : null,
      updatedBy: actor.actorUserId,
      version: { increment: 1 },
    },
  });
  await tx.sopInstance.update({
    where: { id: task.sopInstanceId! },
    data: { version: { increment: 1 } },
  });
  await bumpSopCase(tx, task.sopInstance!, actor.actorUserId);
  await tx.operationLog.create({
    data: {
      userId: actor.actorUserId,
      action: 'SOP_REVIEW_SYNC',
      targetType: 'QUALITY_REVIEW',
      targetId: review.id,
      newValues: JSON.stringify({
        submissionId: sub.id,
        approvalId,
        status: approval.status,
      }),
      ip: actor.ip,
    },
  });
  const context = await new AuthorizationContextLoader(tx).load(actor.actorUserId);
  await new SopExecutionService(tx as PrismaClient, actor, context).recordChange(
    tx,
    'SOP_TASK',
    updated,
    'REVIEW',
    task.sopInstance!.templateVersion.template.organizationId,
    { reviewId: review.id, submissionId: sub.id, status: approval.status },
  );
  return review.id;
}
