import { lockSopSource, sopSourceActive, bumpSopCase } from './source-context';
import { requireSourceMaterials, sourceMaterialBytes, SopSourceFileService } from './source-file-service';
import { createHash } from 'node:crypto';
import { CaseFileService } from '../case/case-file-service';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { SopNode, sopFail } from '../../domain/sop/template-content';
import { requireSopTask, sopTaskScope } from './execution-scope';
import { requireCaseAccess } from '../case/case-scope';
import { createOnce } from '../finance/domain-mutation';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { checkReviewer, materialBytes } from './review-policy';
import { WorkflowService } from '../workflow/workflow-service';
import { SopExecutionService } from './execution-service';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const includeSubmission = {
  attachments: { include: { file: true, sourceFile: true } },
  review: { include: { workflow: true, approval: { include: { syncRecord: true } } } },
} as const;
export class SopSubmissionService {
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {}
  private async taskRead(taskId: string) {
    await requireSopTask(this.db, this.ctx, taskId, 'sop.task.read');
    return requireSopTask(this.db, this.ctx, taskId, 'sop.report.read');
  }
  async list(taskId: string) {
    await this.taskRead(taskId);
    const rows = await this.db.sopSubmission.findMany({
      where: { taskId },
      include: includeSubmission,
      orderBy: { number: 'desc' },
    });
    return Promise.all(rows.map((row) => this.project(row)));
  }
  async get(id: string) {
    const row = await this.db.sopSubmission.findUnique({
      where: { id },
      include: includeSubmission,
    });
    if (!row) sopFail('SOP_SUBMISSION_NOT_FOUND', 404);
    await this.taskRead(row!.taskId);
    return this.project(row!);
  }
  async downloadMaterial(id: string, fileId: string) {
    const sub = await this.db.sopSubmission.findUnique({ where: { id } });
    if (!sub) sopFail('SOP_SUBMISSION_NOT_FOUND', 404);
    await this.taskRead(sub!.taskId);
    const attachment = await this.db.submissionAttachment.findFirst({
      where: { submissionId: id, OR: [{ fileId }, { sourceFileId: fileId }] },
    });
    if (!attachment) sopFail('SOP_MATERIAL_NOT_FOUND', 404);
    const file = attachment!.sourceFileId
      ? await new SopSourceFileService(this.db, this.actor, this.ctx).download(sub!.taskId, fileId)
      : await new CaseFileService(this.db, this.actor, this.ctx).download(fileId);
    if (createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex') !== attachment!.sha256)
      sopFail('SOP_MATERIAL_CHANGED', 409);
    return file;
  }
  private async project(row: Prisma.SopSubmissionGetPayload<{ include: typeof includeSubmission }>) {
    const task = await this.db.caseTask.findUniqueOrThrow({
      where: { id: row.taskId },
    });
    let filesVisible = false;
    try {
      if (task.caseId) {
        await requireCaseAccess(this.db, this.ctx, task.caseId, 'case.file.read');
      } else await requireSourceMaterials(this.db, this.ctx, task.id);
      filesVisible = true;
    } catch (error) {
      if (![401, 403, 404].includes((error as { status?: number }).status ?? 0)) throw error;
    }
    const canAssign =
      this.ctx.permissionCodes.includes('quality.review.assign') &&
      !!(await this.db.caseTask.findFirst({
        where: {
          AND: [{ id: row.taskId }, await sopTaskScope(this.db, this.ctx, 'quality.review.assign')],
        },
        select: { id: true },
      }));
    const canReadReview =
      row.submittedBy === this.ctx.userId ||
      (this.ctx.permissionCodes.includes('quality.review.read') &&
        !!(await this.db.caseTask.findFirst({
          where: {
            AND: [{ id: row.taskId }, await sopTaskScope(this.db, this.ctx, 'quality.review.read')],
          },
          select: { id: true },
        })));
    let canDecide = false;
    if (row.review?.reviewerUserId === this.ctx.userId) {
      try {
        await checkReviewer(this.db, this.ctx.userId, row.taskId, row.submittedBy, row.executorUserId);
        canDecide = true;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error)) throw error;
      }
    }
    return {
      id: row.id,
      taskId: row.taskId,
      number: row.number,
      report: row.report,
      contentHash: row.contentHash,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt,
      materials: filesVisible
        ? row.attachments.map((a) => ({
            code: a.materialCode,
            name:
              (row.nodeSnapshot as unknown as SopNode).materials.find((m) => m.code === a.materialCode)
                ?.name ?? a.materialCode,
            fileId: a.fileId ?? a.sourceFileId!,
            fileName: (a.file ?? a.sourceFile)!.fileName,
            sha256: a.sha256,
          }))
        : [],
      materialsVisible: filesVisible,
      review: row.review
        ? {
            id: row.review.id,
            status: row.review.status,
            version: row.review.version,
            checklist: canReadReview ? row.review.checklist : [],
            approvalId: canReadReview
              ? (row.review.workflowInstanceId ?? row.review.approvalInstanceId)
              : null,
            businessSync: canReadReview
              ? row.review.workflow
                ? { status: row.review.workflow.syncStatus, reason: row.review.workflow.syncError }
                : (row.review.approval?.syncRecord ?? null)
              : null,
            reviewerIsMe: canDecide,
            canAssign,
          }
        : null,
    };
  }
  async submit(taskId: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'requestKey', 'report', 'materials', 'reviewerUserId']);
    const expectedVersion = normalizeVersion(raw.expectedVersion),
      key = normalizeRequiredText(raw.requestKey, 8, 128),
      report = normalizeRequiredText(raw.report, 1, 20000);
    const reviewer = raw.reviewerUserId == null ? null : normalizeRequiredText(raw.reviewerUserId, 1, 100);
    if (!Array.isArray(raw.materials) || raw.materials.length > 100) sopFail('VALIDATION_FAILED');
    const materials = (raw.materials as unknown[]).map((value) => {
      assertExactKeys(value, ['code', 'fileId']);
      return {
        code: normalizeRequiredText(value.code, 1, 100),
        fileId: normalizeRequiredText(value.fileId, 1, 100),
      };
    });
    if (new Set(materials.map((m) => m.code + ':' + m.fileId)).size !== materials.length)
      sopFail('VALIDATION_FAILED');
    await this.taskRead(taskId);
    const initial = await requireSopTask(this.db, this.ctx, taskId, 'sop.report.submit');
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_SUBMIT',
        normalized: { taskId, expectedVersion, report, materials, reviewer },
      },
      async (tx) => {
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        await lockSopSource(tx, initial.sopInstance!);
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${initial.sopInstanceId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM case_task WHERE id=${taskId} FOR UPDATE`;
        await requireSopTask(tx, ctx, taskId, 'sop.task.read');
        await requireSopTask(tx, ctx, taskId, 'sop.task.execute');
        const task = await requireSopTask(tx, ctx, taskId, 'sop.report.submit');
        const sourceActive = await sopSourceActive(tx, task.sopInstance!);
        if (task.version !== expectedVersion) sopFail('SOP_VERSION_CONFLICT', 409);
        if (task.status !== 'IN_PROGRESS' || task.sopInstance!.status !== 'ACTIVE' || !sourceActive)
          sopFail('SOP_STATE_INVALID', 409);
        const node = task.nodeSnapshot as unknown as SopNode;
        if (materials.some((m) => !node.materials.some((requirement) => requirement.code === m.code)))
          sopFail('SOP_MATERIALS_INVALID');
        if (node.materials.some((m) => m.required && !materials.some((entry) => entry.code === m.code)))
          sopFail('SOP_MATERIALS_REQUIRED', 409);
        if (
          node.dependsOn.length &&
          (await tx.caseTask.count({
            where: {
              sopInstanceId: task.sopInstanceId,
              nodeCode: { in: node.dependsOn },
              status: { in: ['COMPLETED', 'SKIPPED'] },
            },
          })) !== node.dependsOn.length
        )
          sopFail('SOP_DEPENDENCY_BLOCKED', 409);
        if (materials.length) {
          if (task.caseId) await requireCaseAccess(this.db, ctx, task.caseId, 'case.file.read', tx);
          else await requireSourceMaterials(tx, ctx, taskId);
        }
        const frozen = [];
        for (const material of materials) {
          const file = task.caseId
            ? await tx.caseFile.findFirst({ where: { id: material.fileId, caseId: task.caseId } })
            : await tx.sopSourceFile.findFirst({
                where: { id: material.fileId, instanceId: task.sopInstanceId! },
              });
          if (!file) sopFail('SOP_MATERIAL_NOT_FOUND', 404);
          const sha256 = task.caseId
            ? materialBytes(file!)
            : createHash('sha256')
                .update(sourceMaterialBytes(file as { filePath: string; fileSize: number; sha256: string }))
                .digest('hex');
          frozen.push({ ...material, sha256, fileSize: file!.fileSize });
        }
        if (node.reviewRequired)
          new AuthorizationService(new DataScopeService(tx)).requireAction(ctx, 'approval.apply');
        else if (reviewer) sopFail('VALIDATION_FAILED');
        const previous = await tx.sopSubmission.aggregate({
          where: { taskId },
          _max: { number: true },
        });
        const number = (previous._max.number ?? 0) + 1;
        const snapshot = {
          taskId,
          number,
          report,
          node: task.nodeSnapshot,
          materials: frozen,
          submittedBy: ctx.userId,
          executorUserId: task.assigneeUserId,
        };
        const sub = await tx.sopSubmission.create({
          data: {
            taskId,
            number,
            taskVersion: task.version + 1,
            report,
            nodeSnapshot: json(task.nodeSnapshot),
            materialChecklist: json(frozen),
            contentHash: hashPayload(snapshot),
            submittedBy: ctx.userId,
            executorUserId: task.assigneeUserId,
            attachments: {
              create: frozen.map((m) => ({
                fileId: task.caseId ? m.fileId : null,
                sourceFileId: task.caseId ? null : m.fileId,
                materialCode: m.code,
                sha256: m.sha256,
                fileSize: m.fileSize,
              })),
            },
          },
        });
        const next = await tx.caseTask.update({
          where: { id: taskId },
          data: {
            status: node.reviewRequired ? 'IN_REVIEW' : 'COMPLETED',
            activeSubmissionId: sub.id,
            completedAt: node.reviewRequired ? null : new Date(),
            version: { increment: 1 },
            updatedBy: ctx.userId,
          },
        });
        if (node.reviewRequired) {
          const review = await tx.qualityReview.create({
            data: {
              submissionId: sub.id,
              createdBy: ctx.userId,
              checklist: json([
                {
                  code: 'MATERIALS',
                  label: '材料及版本符合节点要求',
                  result: 'PENDING',
                  reason: '',
                },
                {
                  code: 'REPORT',
                  label: '成果、风险及目标说明已核验',
                  result: 'PENDING',
                  reason: '',
                },
              ]),
            },
          });
          if (reviewer) await this.bindReview(tx, review.id, reviewer, ctx);
        }
        await tx.sopInstance.update({
          where: { id: task.sopInstanceId! },
          data: { version: { increment: 1 } },
        });
        await bumpSopCase(tx, task.sopInstance!, ctx.userId);
        await new SopExecutionService(this.db, this.actor, ctx).recordChange(
          tx,
          'SOP_TASK',
          next,
          'SUBMIT',
          task.sopInstance!.templateVersion.template.organizationId,
          { submissionId: sub.id, number, reviewRequired: node.reviewRequired },
        );
        return { id: sub.id, taskId, number };
      },
      async (tx, id) => {
        const row = await tx.sopSubmission.findUniqueOrThrow({ where: { id } });
        await requireSopTask(tx, this.ctx, row.taskId, 'sop.report.submit');
        return { id: row.id, taskId: row.taskId, number: row.number };
      },
    );
  }
  private async bindReview(
    tx: Prisma.TransactionClient,
    reviewId: string,
    reviewer: string,
    assigner: AuthorizationContext,
  ) {
    const review = await tx.qualityReview.findUniqueOrThrow({
      where: { id: reviewId },
      include: { submission: { include: { task: true } } },
    });
    const sub = review.submission;
    const auth = new AuthorizationService(new DataScopeService(tx));
    auth.requireAction(assigner, 'employee.read');
    const employeeWhere = await auth.buildScopeWhere(assigner, 'employee', 'employee.read');
    if (
      !(await tx.user.findFirst({
        where: {
          id: reviewer,
          status: 'ENABLED',
          employee: {
            AND: [employeeWhere, { deletedAt: null, status: { not: 'LEAVED' } }],
          },
        },
      }))
    )
      sopFail('SOP_REVIEWER_INVALID', 404);
    await checkReviewer(tx, reviewer, sub.taskId, sub.submittedBy, sub.executorUserId);
    const applicant = await new AuthorizationContextLoader(tx).load(sub.submittedBy);
    await requireSopTask(tx, applicant, sub.taskId, 'sop.report.submit');
    await new WorkflowService(this.db, applicant).startManaged(tx, {
      businessType: 'SOP_REVIEW',
      sourceId: sub.id,
      title: 'SOP成果审核 · 修订 ' + sub.number,
      reviewerId: reviewer,
      content: { submissionId: sub.id, contentHash: sub.contentHash, report: sub.report },
      fields: [
        { key: 'submissionId', label: '提交版本', type: 'text', required: true },
        { key: 'contentHash', label: '内容摘要', type: 'text', required: true },
        { key: 'report', label: '成果报告', type: 'textarea', required: true, maxLength: 20000 },
      ],
    });
  }
  async assign(reviewId: string, raw: unknown) {
    assertExactKeys(raw, ['reviewerUserId', 'expectedVersion', 'requestKey']);
    const reviewer = normalizeRequiredText(raw.reviewerUserId, 1, 100),
      version = normalizeVersion(raw.expectedVersion),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    const initial = await this.db.qualityReview.findUnique({
      where: { id: reviewId },
      include: { submission: { include: { task: true } } },
    });
    if (!initial) sopFail('SOP_REVIEW_NOT_FOUND', 404);
    await requireSopTask(this.db, this.ctx, initial!.submission.taskId, 'quality.review.assign');
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_REVIEW_ASSIGN',
        normalized: { reviewId, reviewer, version },
      },
      async (tx) => {
        const task = initial!.submission.task;
        await lockSopSource(
          tx,
          await tx.sopInstance.findUniqueOrThrow({ where: { id: task.sopInstanceId! } }),
        );
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${task.sopInstanceId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM case_task WHERE id=${task.id} FOR UPDATE`;
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        const current = await requireSopTask(tx, ctx, task.id, 'quality.review.assign');
        const review = await tx.qualityReview.findUniqueOrThrow({
          where: { id: reviewId },
        });
        if (review.version !== version) sopFail('SOP_VERSION_CONFLICT', 409);
        if (
          review.status !== 'WAITING_ASSIGNMENT' ||
          current.status !== 'IN_REVIEW' ||
          current.activeSubmissionId !== review.submissionId ||
          current.sopInstance!.status !== 'ACTIVE'
        )
          sopFail('SOP_STATE_INVALID', 409);
        await this.bindReview(tx, reviewId, reviewer, ctx);
        await tx.operationLog.create({
          data: {
            userId: ctx.userId,
            action: 'SOP_REVIEW_ASSIGN',
            targetType: 'QUALITY_REVIEW',
            targetId: reviewId,
            newValues: JSON.stringify({ reviewerUserId: reviewer }),
            ip: this.actor.ip,
          },
        });
        return { id: reviewId };
      },
      async (tx, id) => {
        const review = await tx.qualityReview.findUniqueOrThrow({
          where: { id },
          include: { submission: true },
        });
        await requireSopTask(tx, this.ctx, review.submission.taskId, 'quality.review.assign');
        return { id };
      },
    );
  }
  async checklist(reviewId: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'checks']);
    const version = normalizeVersion(raw.expectedVersion);
    if (!Array.isArray(raw.checks) || raw.checks.length !== 2) sopFail('VALIDATION_FAILED');
    const checks = (raw.checks as unknown[]).map((value) => {
      assertExactKeys(value, ['code', 'result', 'reason']);
      const code = normalizeRequiredText(value.code, 1, 100),
        result = normalizeRequiredText(value.result, 1, 20),
        reason = value.reason === '' ? '' : normalizeRequiredText(value.reason, 1, 1000);
      if (
        !['MATERIALS', 'REPORT'].includes(code) ||
        !['PASS', 'FAIL', 'NA'].includes(result) ||
        (result !== 'PASS' && !reason)
      )
        sopFail('VALIDATION_FAILED');
      return { code, result, reason };
    });
    if (new Set(checks.map((c) => c.code)).size !== 2) sopFail('VALIDATION_FAILED');
    return this.db.$transaction(async (tx) => {
      const review = await tx.qualityReview.findUniqueOrThrow({
        where: { id: reviewId },
        include: {
          submission: true,
          workflow: { select: { status: true } },
          approval: { select: { status: true } },
        },
      });
      if (review.workflowInstanceId)
        await tx.$queryRaw`SELECT id FROM workflow_instance WHERE id=${review.workflowInstanceId} FOR UPDATE`;
      if (review.reviewerUserId !== this.ctx.userId) sopFail('SOP_REVIEW_NOT_FOUND', 404);
      await checkReviewer(
        tx,
        this.ctx.userId,
        review.submission.taskId,
        review.submission.submittedBy,
        review.submission.executorUserId,
      );
      if (review.status !== 'PENDING' || (review.workflow ?? review.approval)?.status !== 'PENDING')
        sopFail('SOP_STATE_INVALID', 409);
      const changed = await tx.qualityReview.updateMany({
        where: { id: reviewId, version, status: 'PENDING' },
        data: { checklist: json(checks), version: { increment: 1 } },
      });
      if (!changed.count) sopFail('SOP_VERSION_CONFLICT', 409);
      await tx.operationLog.create({
        data: {
          userId: this.ctx.userId,
          action: 'SOP_REVIEW_CHECKLIST',
          targetType: 'QUALITY_REVIEW',
          targetId: reviewId,
          newValues: JSON.stringify({ version: version + 1 }),
          ip: this.actor.ip,
        },
      });
      return { id: reviewId, version: version + 1 };
    });
  }
  async options(taskId: string) {
    await requireSopTask(this.db, this.ctx, taskId, 'sop.task.read');
    const auth = new AuthorizationService(new DataScopeService(this.db));
    auth.requireAction(this.ctx, 'employee.read');
    const task = await this.db.caseTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const currentSubmission = task.activeSubmissionId
      ? await this.db.sopSubmission.findUnique({
          where: { id: task.activeSubmissionId },
        })
      : null;
    const users = await this.db.user.findMany({
      where: {
        status: 'ENABLED',
        employee: {
          AND: [
            await auth.buildScopeWhere(this.ctx, 'employee', 'employee.read'),
            { deletedAt: null, status: { not: 'LEAVED' } },
          ],
        },
      },
      select: { id: true, employee: { select: { name: true } } },
      take: 500,
      orderBy: { id: 'asc' },
    });
    const result = [];
    for (const user of users) {
      try {
        await checkReviewer(
          this.db,
          user.id,
          taskId,
          currentSubmission?.submittedBy ?? this.ctx.userId,
          currentSubmission?.executorUserId ?? task.assigneeUserId,
        );
        result.push({ id: user.id, name: user.employee!.name });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error)) throw error;
      }
    }
    return result;
  }
  async materialOptions(taskId: string, raw: unknown) {
    assertExactKeys(raw, ['page']);
    const page = Number(raw.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 100))
      sopFail('VALIDATION_FAILED');
    await requireSopTask(this.db, this.ctx, taskId, 'sop.task.read');
    const task = await requireSopTask(this.db, this.ctx, taskId, 'sop.report.read');
    if (!task.caseId) return new SopSourceFileService(this.db, this.actor, this.ctx).list(taskId, { page });
    await requireCaseAccess(this.db, this.ctx, task.caseId, 'case.file.read');
    const where = { caseId: task.caseId };
    const [total, list] = await this.db.$transaction([
      this.db.caseFile.count({ where }),
      this.db.caseFile.findMany({
        where,
        select: { id: true, fileName: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * 100,
        take: 100,
      }),
    ]);
    return { list, total, page };
  }
  async guidance(taskId: string) {
    await requireSopTask(this.db, this.ctx, taskId, 'sop.task.read');
    await requireSopTask(this.db, this.ctx, taskId, 'sop.guidance.read');
    return this.db.expertGuidance.findMany({
      where: { taskId },
      select: {
        id: true,
        content: true,
        submissionId: true,
        createdBy: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
  }
  async guide(taskId: string, raw: unknown) {
    assertExactKeys(raw, ['content', 'submissionId', 'requestKey']);
    const content = normalizeRequiredText(raw.content, 1, 10000),
      key = normalizeRequiredText(raw.requestKey, 8, 128),
      submissionId = raw.submissionId == null ? null : normalizeRequiredText(raw.submissionId, 1, 100);
    await requireSopTask(this.db, this.ctx, taskId, 'sop.task.read');
    await requireSopTask(this.db, this.ctx, taskId, 'sop.guidance.create');
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_GUIDANCE',
        normalized: { taskId, content, submissionId },
      },
      async (tx) => {
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        await requireSopTask(tx, ctx, taskId, 'sop.task.read');
        const task = await requireSopTask(tx, ctx, taskId, 'sop.guidance.create');
        if (
          submissionId &&
          !(await tx.sopSubmission.findFirst({
            where: { id: submissionId, taskId },
          }))
        )
          sopFail('SOP_SUBMISSION_NOT_FOUND', 404);
        const row = await tx.expertGuidance.create({
          data: { taskId, content, submissionId, createdBy: ctx.userId },
        });
        await tx.operationLog.create({
          data: {
            userId: ctx.userId,
            action: 'SOP_GUIDANCE_CREATE',
            targetType: 'EXPERT_GUIDANCE',
            targetId: row.id,
            newValues: JSON.stringify({ taskId, submissionId }),
            ip: this.actor.ip,
          },
        });
        await new PrismaEventOutboxWriter().append(tx, {
          eventType: 'sop.guidance.created',
          eventVersion: 1,
          objectType: 'EXPERT_GUIDANCE',
          objectId: row.id,
          operatorUserId: ctx.userId,
          organizationId: task.sopInstance!.templateVersion.template.organizationId,
          branchId: task.sopInstance!.templateVersion.template.organizationId,
          teamId: null,
          payload: { id: row.id, taskId },
          traceId: this.actor.requestId ?? row.id,
          occurredAt: row.createdAt,
        });
        return { id: row.id };
      },
      async (tx, id) => {
        const row = await tx.expertGuidance.findUniqueOrThrow({
          where: { id },
        });
        await requireSopTask(tx, this.ctx, row.taskId, 'sop.guidance.create');
        return { id };
      },
    );
  }
}
