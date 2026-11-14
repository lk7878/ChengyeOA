import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { sopFail } from '../../domain/sop/template-content';
import { qualityActor, qualityCaseScope } from './quality-scope';
import { createOnce } from '../finance/domain-mutation';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { materialBytes } from '../sop/review-policy';
import { requireCaseAccess } from '../case/case-scope';
import { analysisReviewer } from './analysis-review-policy';
import { WorkflowService } from '../workflow/workflow-service';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { sopTaskScope } from '../sop/execution-scope';
import { analysisChanged } from './analysis-change';
const text = (v: unknown, max = 200) => normalizeRequiredText(v, 1, max);
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export class AnalysisService {
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {}
  private async access(
    caseId: string,
    p: PermissionCode,
    ctx = this.ctx,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.case.findFirst({
      where: { AND: [{ id: caseId }, await qualityCaseScope(this.db, ctx, p, tx)] },
    });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    return row!;
  }
  private async read(
    id: string,
    p: PermissionCode = 'quality.analysis.read',
    ctx = this.ctx,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.specialAnalysis.findUnique({ where: { id } });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    await this.access(row!.caseId, p, ctx, tx);
    return row!;
  }
  async assessments(caseId: string) {
    await this.access(caseId, 'quality.assessment.read');
    const list = await this.db.satisfactionAssessment.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      include: { analysis: { select: { id: true, status: true } } },
    });
    let files = false;
    if (this.ctx.permissionCodes.includes('case.file.read')) {
      try {
        await requireCaseAccess(this.db, this.ctx, caseId, 'case.file.read');
        files = true;
      } catch {
        /* independent range */
      }
    }
    const canAnalysis =
      this.ctx.permissionCodes.includes('quality.analysis.read') &&
      !!(await this.db.case.count({
        where: { AND: [{ id: caseId }, await qualityCaseScope(this.db, this.ctx, 'quality.analysis.read')] },
      }));
    return list.map((r) => ({
      ...r,
      evidenceFileId: files ? r.evidenceFileId : null,
      evidenceHash: files ? r.evidenceHash : null,
      analysis: canAnalysis ? r.analysis : null,
    }));
  }
  async createAssessment(caseId: string, raw: unknown) {
    assertExactKeys(raw, [
      'score',
      'source',
      'evidence',
      'evidenceFileId',
      'assessedAt',
      'correctionOfId',
      'correctionReason',
      'requestKey',
    ]);
    const score = raw.score == null ? null : Number(raw.score),
      source = text(raw.source, 500),
      evidence = text(raw.evidence, 4000),
      evidenceFileId = raw.evidenceFileId ? text(raw.evidenceFileId, 100) : null,
      correctionOfId = raw.correctionOfId ? text(raw.correctionOfId, 100) : null,
      correctionReason = raw.correctionReason ? text(raw.correctionReason, 2000) : null,
      key = text(raw.requestKey, 128);
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100))
      sopFail('VALIDATION_FAILED');
    if (
      typeof raw.assessedAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.assessedAt)) ||
      (correctionOfId && !correctionReason)
    )
      sopFail('VALIDATION_FAILED');
    const assessedAt = new Date(raw.assessedAt as string);
    await this.access(caseId, 'quality.assessment.record');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_ASSESSMENT', normalized: { caseId, ...raw } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM "case" WHERE id=${caseId} FOR UPDATE`;
        const target = await this.access(caseId, 'quality.assessment.record', ctx, tx);
        let number = 1;
        if (correctionOfId) {
          const previous = await tx.satisfactionAssessment.findUnique({
            where: { id: correctionOfId },
            include: { correction: { select: { id: true } } },
          });
          if (!previous || previous.caseId !== caseId) sopFail('QUALITY_NOT_FOUND', 404);
          if (previous!.correction) sopFail('QUALITY_VERSION_CONFLICT', 409);
          number = previous!.number + 1;
        }
        let evidenceHash: string | null = null;
        if (evidenceFileId) {
          await requireCaseAccess(this.db, ctx, caseId, 'case.file.read', tx);
          const file = await tx.caseFile.findFirst({ where: { id: evidenceFileId, caseId } });
          if (!file) sopFail('QUALITY_NOT_FOUND', 404);
          evidenceHash = materialBytes(file!);
        }
        const assessment = await tx.satisfactionAssessment.create({
          data: {
            caseId,
            score,
            source,
            evidence,
            evidenceFileId,
            evidenceHash,
            assessedAt,
            correctionOfId,
            correctionReason,
            number,
            createdBy: ctx.userId,
          },
        });
        await new PrismaEventOutboxWriter().append(tx, {
          eventType: 'quality.assessment.recorded',
          eventVersion: 1,
          objectType: 'SATISFACTION_ASSESSMENT',
          objectId: assessment.id,
          operatorUserId: ctx.userId,
          organizationId: target.branchId,
          branchId: target.branchId,
          teamId: null,
          payload: { id: assessment.id },
          traceId: this.actor.requestId ?? assessment.id,
          occurredAt: new Date(),
        });
        await this.audit(tx, 'ASSESSMENT_RECORDED', assessment.id, { caseId, number, correctionOfId });
        return { id: assessment.id };
      },
      async (tx, id) => {
        const row = await tx.satisfactionAssessment.findUniqueOrThrow({ where: { id } });
        await this.access(
          row.caseId,
          'quality.assessment.record',
          await qualityActor(tx, this.ctx.userId),
          tx,
        );
        return { id };
      },
    );
  }
  async list(raw: unknown) {
    assertExactKeys(raw, ['page', 'pageSize']);
    const page = Number(raw.page ?? 1),
      pageSize = Number(raw.pageSize ?? 50);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      sopFail('VALIDATION_FAILED');
    const where = { case: await qualityCaseScope(this.db, this.ctx, 'quality.analysis.read') };
    return {
      list: await this.db.specialAnalysis.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          version: true,
          assessment: { select: { score: true, assessedAt: true } },
        },
      }),
      total: await this.db.specialAnalysis.count({ where }),
      page,
      pageSize,
    };
  }
  async get(id: string) {
    const row = await this.read(id);
    const [assessment, revisions, closes] = await Promise.all([
      this.db.satisfactionAssessment.findUniqueOrThrow({ where: { id: row.assessmentId } }),
      this.db.analysisRevision.findMany({ where: { analysisId: id }, orderBy: { number: 'desc' } }),
      this.db.analysisCloseRequest.findMany({
        where: { analysisId: id },
        orderBy: { createdAt: 'desc' },
        include: { workflow: true, approval: { include: { syncRecord: true } } },
      }),
    ]);
    return {
      ...row,
      assessment: {
        id: assessment.id,
        score: assessment.score,
        source: assessment.source,
        evidence: assessment.evidence,
        assessedAt: assessment.assessedAt,
        number: assessment.number,
        correctionOfId: assessment.correctionOfId,
      },
      revisions,
      closes: closes.map((c) => ({
        id: c.id,
        status: c.status,
        createdAt: c.createdAt,
        approvalId: c.workflowInstanceId ?? c.approvalInstanceId,
        sync: c.workflow
          ? { status: c.workflow.syncStatus, reason: c.workflow.syncError }
          : (c.approval?.syncRecord ?? null),
      })),
    };
  }
  async save(id: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'requestKey', 'content', 'conclusion']);
    const version = normalizeVersion(raw.expectedVersion),
      key = text(raw.requestKey, 128),
      content = text(raw.content, 20000),
      conclusion = raw.conclusion ? text(raw.conclusion, 10000) : '';
    await this.read(id, 'quality.analysis.manage');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_ANALYSIS_SAVE', normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM special_analysis WHERE id=${id} FOR UPDATE`;
        const row = await this.read(id, 'quality.analysis.manage', ctx, tx);
        if (row.version !== version) sopFail('QUALITY_VERSION_CONFLICT', 409);
        if (!['OPEN', 'ANALYZING'].includes(row.status)) sopFail('QUALITY_STATE_INVALID', 409);
        const last = await tx.analysisRevision.findFirst({
          where: { analysisId: id },
          orderBy: { number: 'desc' },
        });
        await tx.analysisRevision.create({
          data: {
            analysisId: id,
            number: (last?.number ?? 0) + 1,
            content,
            conclusion,
            createdBy: ctx.userId,
          },
        });
        await tx.specialAnalysis.update({
          where: { id },
          data: {
            content,
            conclusion,
            status: 'ANALYZING',
            version: { increment: 1 },
            updatedBy: ctx.userId,
          },
        });
        await this.audit(tx, 'ANALYSIS_SAVED', id, { version: version + 1 });
        await analysisChanged(tx, id, ctx.userId, 'SAVE');
        return { id };
      },
      async (tx, id) => {
        await this.read(id, 'quality.analysis.manage', await qualityActor(tx, this.ctx.userId), tx);
        return { id };
      },
    );
  }
  async reviewers(id: string) {
    const row = await this.read(id, 'quality.analysis.close'),
      auth = new AuthorizationService(new DataScopeService(this.db)),
      scope = await auth.buildScopeWhere(this.ctx, 'employee', 'employee.read');
    const users = await this.db.user.findMany({
        where: {
          status: 'ENABLED',
          employee: { AND: [scope, { deletedAt: null, status: { not: 'LEAVED' } }] },
        },
        include: { employee: { select: { name: true } } },
        take: 500,
        orderBy: { id: 'asc' },
      }),
      list: { id: string; name: string }[] = [];
    for (const u of users) {
      try {
        await analysisReviewer(this.db, u.id, row.caseId, this.ctx.userId, id);
        list.push({ id: u.id, name: u.employee!.name });
      } catch {
        /* current valid reviewers only */
      }
    }
    return list;
  }
  async requestClose(id: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'requestKey', 'reviewerUserId']);
    const version = normalizeVersion(raw.expectedVersion),
      key = text(raw.requestKey, 128),
      reviewer = text(raw.reviewerUserId, 100);
    await this.read(id, 'quality.analysis.close');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_ANALYSIS_CLOSE', normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM special_analysis WHERE id=${id} FOR UPDATE`;
        const row = await this.read(id, 'quality.analysis.close', ctx, tx);
        await this.access(row.caseId, 'quality.analysis.read', ctx, tx);
        if (row.version !== version) sopFail('QUALITY_VERSION_CONFLICT', 409);
        if (row.status !== 'ANALYZING' || !row.content.trim() || !row.conclusion.trim())
          sopFail('QUALITY_STATE_INVALID', 409);
        const auth = new AuthorizationService(new DataScopeService(tx)),
          employeeWhere = await auth.buildScopeWhere(ctx, 'employee', 'employee.read');
        if (
          !(await tx.user.count({
            where: {
              id: reviewer,
              employee: { AND: [employeeWhere, { status: { not: 'LEAVED' }, deletedAt: null }] },
            },
          }))
        )
          sopFail('QUALITY_NOT_FOUND', 404);
        await analysisReviewer(tx, reviewer, row.caseId, ctx.userId, id);
        const contentSnapshot = {
            analysisId: id,
            content: row.content,
            conclusion: row.conclusion,
            analysisVersion: version + 1,
          },
          contentHash = hashPayload(contentSnapshot),
          close = await tx.analysisCloseRequest.create({
            data: {
              analysisId: id,
              analysisVersion: version + 1,
              contentSnapshot: json(contentSnapshot),
              contentHash,
              createdBy: ctx.userId,
              reviewerUserId: reviewer,
            },
          });
        await tx.specialAnalysis.update({
          where: { id },
          data: {
            currentCloseId: close.id,
            status: 'PENDING_CLOSE',
            version: { increment: 1 },
            updatedBy: ctx.userId,
          },
        });
        await new WorkflowService(this.db, ctx).startManaged(tx, {
          businessType: 'QUALITY_ANALYSIS',
          sourceId: close.id,
          title: '专项分析关闭审核',
          reviewerId: reviewer,
          content: {
            analysisId: id,
            closeRequestId: close.id,
            contentHash,
            content: row.content,
            conclusion: row.conclusion,
          },
          fields: [
            { key: 'analysisId', label: '分析记录', type: 'text', required: true },
            { key: 'closeRequestId', label: '关闭申请', type: 'text', required: true },
            { key: 'contentHash', label: '版本摘要', type: 'text', required: true },
            { key: 'content', label: '分析内容', type: 'textarea', required: true, maxLength: 20000 },
            { key: 'conclusion', label: '分析结论', type: 'textarea', required: true, maxLength: 20000 },
          ],
        });
        await this.audit(tx, 'ANALYSIS_CLOSE_REQUESTED', id, {
          closeRequestId: close.id,
          version: version + 1,
        });
        await analysisChanged(tx, id, ctx.userId, 'CLOSE_REQUEST');
        return { id };
      },
      async (tx, id) => {
        await this.read(id, 'quality.analysis.close', await qualityActor(tx, this.ctx.userId), tx);
        return { id };
      },
    );
  }
  async metrics() {
    const scope = await qualityCaseScope(this.db, this.ctx, 'quality.metric.read');
    const result: Record<string, unknown> = {};
    if (this.ctx.permissionCodes.includes('quality.issue.read'))
      result.issues = await this.db.qualityIssue.groupBy({
        by: ['status'],
        where: { case: { AND: [scope, await qualityCaseScope(this.db, this.ctx, 'quality.issue.read')] } },
        _count: { _all: true },
      });
    if (this.ctx.permissionCodes.includes('quality.inspection.read'))
      result.inspections = await this.db.qualitySamplingItem.groupBy({
        by: ['status'],
        where: {
          case: { AND: [scope, await qualityCaseScope(this.db, this.ctx, 'quality.inspection.read')] },
        },
        _count: { _all: true },
      });
    if (this.ctx.permissionCodes.includes('quality.analysis.read'))
      result.analyses = await this.db.specialAnalysis.groupBy({
        by: ['status'],
        where: { case: { AND: [scope, await qualityCaseScope(this.db, this.ctx, 'quality.analysis.read')] } },
        _count: { _all: true },
      });
    if (this.ctx.permissionCodes.includes('sop.task.read')) {
      const where = { AND: [await sopTaskScope(this.db, this.ctx, 'sop.task.read'), { case: scope }] };
      result.tasks = await this.db.caseTask.groupBy({ by: ['status'], where, _count: { _all: true } });
      result.overdue = await this.db.caseTask.count({
        where: {
          AND: [
            where,
            {
              sopInstance: { status: 'ACTIVE' },
              dueDate: { lt: new Date() },
              status: { notIn: ['COMPLETED', 'SKIPPED'] },
            },
          ],
        },
      });
    }
    return result;
  }
  private async audit(tx: Prisma.TransactionClient, action: string, id: string, values: unknown) {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action: 'QUALITY_' + action,
        targetType: 'SPECIAL_ANALYSIS',
        targetId: id,
        newValues: JSON.stringify(values),
        ip: this.actor.ip,
      },
    });
  }
}
