import { employmentStamp } from './employment-stamp';
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
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { parseSopContent, sopFail, SopNode } from '../../domain/sop/template-content';
import { requireSopVersion } from './template-service';
import { requireSopTask, requireSopInstance, sopInstanceScope, sopTaskScope } from './execution-scope';
import { buildCaseScopeWhere, requireCaseAccess } from '../case/case-scope';
import { createOnce } from '../finance/domain-mutation';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { appendCollaborationChange } from '../collaboration/collaboration-change';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const terminal = ['COMPLETED', 'SKIPPED'];
function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    sopFail('VALIDATION_FAILED');
  return new Date(value as string);
}
function paging(raw: Record<string, unknown>) {
  const page = Number(raw.page ?? 1),
    pageSize = Number(raw.pageSize ?? 50);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    sopFail('VALIDATION_FAILED');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export class SopExecutionService {
  private auth: AuthorizationService;
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {
    this.auth = new AuthorizationService(new DataScopeService(db));
  }
  async start(raw: unknown) {
    assertExactKeys(raw, ['caseId', 'templateVersionId', 'batchKey', 'requestKey']);
    const caseId = normalizeRequiredText(raw.caseId, 1, 100),
      versionId = normalizeRequiredText(raw.templateVersionId, 1, 100),
      batchKey = normalizeRequiredText(raw.batchKey, 1, 100),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    this.auth.requireAction(this.ctx, 'sop.instance.start');
    await requireCaseAccess(this.db, this.ctx, caseId, 'case.task.manage');
    await requireCaseAccess(this.db, this.ctx, caseId, 'case.read');
    await requireSopVersion(this.db, this.ctx, versionId, 'sop.template.read');
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_INSTANCE_START',
        normalized: { caseId, versionId, batchKey },
      },
      async (tx) => {
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM "case" WHERE id=${caseId} FOR UPDATE`;
        const caseRow = await requireCaseAccess(this.db, ctx, caseId, 'case.task.manage', tx);
        await requireCaseAccess(this.db, ctx, caseId, 'case.read', tx);
        await tx.$queryRaw`SELECT id FROM sop_template_version WHERE id=${versionId} FOR UPDATE`;
        const revision = await requireSopVersion(tx, ctx, versionId, 'sop.template.read');
        const existing = await tx.sopInstance.findUnique({
          where: { caseId_templateVersionId_batchKey: { caseId, templateVersionId: versionId, batchKey } },
        });
        if (existing) return requireSopInstance(tx, ctx, existing.id, 'sop.instance.start');
        if (['CLOSED', 'ARCHIVED'].includes(caseRow.status)) sopFail('CASE_STATE_INVALID', 409);
        if (
          revision.status !== 'PUBLISHED' ||
          revision.template.activeVersionId !== revision.id ||
          hashPayload(revision.content) !== revision.contentHash
        )
          sopFail('SOP_TEMPLATE_NOT_ACTIVE', 409);
        let teams: unknown;
        try {
          teams = JSON.parse(caseRow.teamIds || 'null');
        } catch {
          teams = null;
        }
        if (
          caseRow.branchId !== revision.template.organizationId ||
          caseRow.caseType !== revision.template.caseType ||
          !Array.isArray(teams) ||
          !teams.includes(revision.template.professionalTeamId)
        )
          sopFail('SOP_CASE_SCOPE_MISMATCH', 409);
        const content = parseSopContent(revision.content);
        const row = await tx.sopInstance.create({
          data: { caseId, templateVersionId: versionId, batchKey, createdBy: ctx.userId },
        });
        await requireSopInstance(tx, ctx, row.id, 'sop.instance.start');
        await tx.caseTask.createMany({
          data: content.nodes.map((node) => ({
            caseId,
            sopInstanceId: row.id,
            nodeCode: node.code,
            nodeSnapshot: json(node),
            name: node.name,
            nodeType: 'SOP',
            createdBy: ctx.userId,
          })),
        });
        await tx.case.update({
          where: { id: caseId },
          data: { version: { increment: 1 }, updatedBy: ctx.userId },
        });
        await this.recordChange(tx, 'SOP_INSTANCE', row, 'START', revision.template.organizationId, {
          templateVersionId: versionId,
          batchKey,
        });
        return row;
      },
      (tx, id) => requireSopInstance(tx, this.ctx, id, 'sop.instance.start'),
    );
  }
  async instances(raw: unknown) {
    assertExactKeys(raw, ['page', 'pageSize', 'caseId']);
    const p = paging(raw);
    const where: Prisma.SopInstanceWhereInput = {
      AND: [
        await sopInstanceScope(this.db, this.ctx, 'sop.instance.read'),
        ...(raw.caseId ? [{ caseId: normalizeRequiredText(raw.caseId, 1, 100) }] : []),
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.sopInstance.count({ where }),
      this.db.sopInstance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
        select: { id: true, status: true, version: true, batchKey: true, createdAt: true },
      }),
    ]);
    return { list: rows, pagination: { page: p.page, pageSize: p.pageSize, total } };
  }
  async instance(id: string) {
    const row = await requireSopInstance(this.db, this.ctx, id, 'sop.instance.read');
    const tasks = this.ctx.permissionCodes.includes('sop.task.read')
      ? await this.db.caseTask.findMany({
          where: { AND: [{ sopInstanceId: id }, await sopTaskScope(this.db, this.ctx, 'sop.task.read')] },
          orderBy: [{ createdAt: 'asc' }, { nodeCode: 'asc' }],
        })
      : [];
    const caseRow = await this.visibleCase(row.caseId);
    return {
      id: row.id,
      status: row.status,
      version: row.version,
      batchKey: row.batchKey,
      templateName: row.templateVersion.template.name,
      templateNumber: row.templateVersion.number,
      case: caseRow,
      tasks: tasks.map((t) => this.projectTask(t)),
      progress: { visible: tasks.length, completed: tasks.filter((t) => terminal.includes(t.status)).length },
    };
  }
  async tasks(raw: unknown) {
    assertExactKeys(raw, ['page', 'pageSize', 'instanceId', 'mine', 'status', 'overdue']);
    const p = paging(raw);
    if (raw.mine !== undefined && !['true', 'false'].includes(String(raw.mine))) sopFail('VALIDATION_FAILED');
    if (raw.overdue !== undefined && !['true', 'false'].includes(String(raw.overdue)))
      sopFail('VALIDATION_FAILED');
    if (
      raw.status !== undefined &&
      !['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED', 'SKIPPED'].includes(
        String(raw.status),
      )
    )
      sopFail('VALIDATION_FAILED');
    const where: Prisma.CaseTaskWhereInput = {
      AND: [
        await sopTaskScope(this.db, this.ctx, 'sop.task.read'),
        {
          ...(raw.instanceId ? { sopInstanceId: normalizeRequiredText(raw.instanceId, 1, 100) } : {}),
          ...(String(raw.mine) === 'true' ? { assigneeUserId: this.ctx.userId } : {}),
          ...(raw.status ? { status: String(raw.status) } : {}),
        },
        ...(String(raw.overdue) === 'true'
          ? [{ dueDate: { lt: new Date() }, status: { notIn: terminal } }]
          : []),
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.caseTask.count({ where }),
      this.db.caseTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
      }),
    ]);
    return {
      list: rows.map((t) => this.projectTask(t)),
      pagination: { page: p.page, pageSize: p.pageSize, total },
    };
  }
  async task(id: string) {
    const row = await requireSopTask(this.db, this.ctx, id, 'sop.task.read');
    const permissions: PermissionCode[] = [];
    for (const permission of ['sop.task.execute', 'sop.task.manage', 'sop.report.read', 'sop.report.submit', 'sop.guidance.read', 'sop.guidance.create', 'quality.review.assign', 'quality.review.decide'] as const) {
      if (
        this.ctx.permissionCodes.includes(permission) &&
        (await this.db.caseTask.findFirst({
          where: { AND: [{ id }, await sopTaskScope(this.db, this.ctx, permission)] },
          select: { id: true },
        }))
      )
        permissions.push(permission);
    }
    return {
      ...this.projectTask(row),
      node: row.nodeSnapshot,
      instanceStatus: row.sopInstance!.status,
      case: await this.visibleCase(row.caseId),
      permissions,
    };
  }
  private projectTask(row: {
    id: string;
    name: string;
    status: string;
    version: number;
    dueDate: Date | null;
    assigneeUserId: string | null;
    createdBy: string | null;
    sopInstanceId: string | null;
    remark: string | null;
    completedAt: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      version: row.version,
      dueDate: row.dueDate,
      overdue: !!row.dueDate && row.dueDate < new Date() && !terminal.includes(row.status),
      assigneeUserId: row.assigneeUserId,
      createdBy: row.createdBy,
      instanceId: row.sopInstanceId,
      remark: row.remark,
      completedAt: row.completedAt,
    };
  }
  private async visibleCase(id: string) {
    if (!this.ctx.permissionCodes.includes('case.read')) return null;
    return this.db.case.findFirst({
      where: { AND: [{ id }, await buildCaseScopeWhere(this.db, this.ctx, 'case.read')] },
      select: { id: true, caseNo: true, title: true },
    });
  }
  async options() {
    this.auth.requireAction(this.ctx, 'sop.task.manage');
    this.auth.requireAction(this.ctx, 'employee.read');
    const where = await this.auth.buildScopeWhere(this.ctx, 'employee', 'employee.read');
    return this.db.user.findMany({
      where: {
        status: 'ENABLED',
        employee: { AND: [where, { status: { not: 'LEAVED' }, deletedAt: null }] },
      },
      select: { id: true, employee: { select: { name: true } } },
      take: 500,
      orderBy: { id: 'asc' },
    });
  }
  async taskAction(id: string, raw: unknown) {
    assertExactKeys(raw, [
      'action',
      'expectedVersion',
      'requestKey',
      'remark',
      'assigneeUserId',
      'validUntil',
      'dueDate',
      'reason',
    ]);
    const action = normalizeRequiredText(raw.action, 1, 30),
      version = normalizeVersion(raw.expectedVersion),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    if (!['START', 'COMPLETE', 'SKIP', 'ASSIGN', 'RESCHEDULE'].includes(action)) sopFail('VALIDATION_FAILED');
    const permission: PermissionCode = ['START', 'COMPLETE'].includes(action)
      ? 'sop.task.execute'
      : 'sop.task.manage';
    const initial = await requireSopTask(this.db, this.ctx, id, permission);
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'SOP_TASK_' + action, normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM "case" WHERE id=${initial.caseId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${initial.sopInstanceId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM case_task WHERE id=${id} FOR UPDATE`;
        const row = await requireSopTask(tx, ctx, id, permission),
          instance = row.sopInstance!;
        const caseRow = await tx.case.findUniqueOrThrow({ where: { id: row.caseId } });
        if (row.version !== version) sopFail('SOP_VERSION_CONFLICT', 409);
        if (
          instance.status !== 'ACTIVE' ||
          ['CLOSED', 'ARCHIVED'].includes(caseRow.status) ||
          terminal.includes(row.status)
        )
          sopFail('SOP_STATE_INVALID', 409);
        const node = row.nodeSnapshot as unknown as SopNode;
        const update: Prisma.CaseTaskUpdateInput = { version: { increment: 1 }, updatedBy: ctx.userId };
        if (raw.remark !== undefined) update.remark = normalizeRequiredText(raw.remark, 1, 2000);
        if (action === 'START' || action === 'COMPLETE') {
          if (
            (action === 'START' && !['PENDING', 'CHANGES_REQUESTED'].includes(row.status)) ||
            (action === 'COMPLETE' && row.status !== 'IN_PROGRESS')
          )
            sopFail('SOP_STATE_INVALID', 409);
          if (
            node.dependsOn.length &&
            (await tx.caseTask.count({
              where: {
                sopInstanceId: instance.id,
                nodeCode: { in: node.dependsOn },
                status: { in: terminal },
              },
            })) !== node.dependsOn.length
          )
            sopFail('SOP_DEPENDENCY_BLOCKED', 409);
          if (action === 'COMPLETE' && node.reviewRequired) sopFail('SOP_REVIEW_REQUIRED', 409);
          if (action === 'COMPLETE' && node.materials.some((m) => m.required))
            sopFail('SOP_MATERIALS_REQUIRED', 409);
          update.status = action === 'START' ? 'IN_PROGRESS' : 'COMPLETED';
          if (action === 'COMPLETE') update.completedAt = new Date();
        } else if (action === 'SKIP') {
          const reason = normalizeRequiredText(raw.reason, 1, 500);
          update.status = 'SKIPPED';
          update.remark = reason;
        } else if (action === 'RESCHEDULE') update.dueDate = date(raw.dueDate);
        else {
          const assignee =
            raw.assigneeUserId === null ? null : normalizeRequiredText(raw.assigneeUserId, 1, 100);
          const until = date(raw.validUntil);
          if (until && until <= new Date()) sopFail('VALIDATION_FAILED');
          if (assignee) {
            const auth = new AuthorizationService(new DataScopeService(tx));
            auth.requireAction(ctx, 'employee.read');
            const employeeWhere = await auth.buildScopeWhere(ctx, 'employee', 'employee.read');
            if (
              !(await tx.user.findFirst({
                where: {
                  id: assignee,
                  status: 'ENABLED',
                  employee: { AND: [employeeWhere, { status: { not: 'LEAVED' }, deletedAt: null }] },
                },
              }))
            )
              sopFail('SOP_ASSIGNEE_NOT_AVAILABLE', 404);
          }
          await tx.sopTaskAccess.updateMany({
            where: { taskId: id, revokedAt: null },
            data: { revokedAt: new Date(), revokeReason: '任务改派或撤回分派' },
          });
          if (assignee) {
            const assigneeContext = await new AuthorizationContextLoader(tx).load(assignee);
            if (
              !assigneeContext.permissionCodes.includes('sop.task.read') ||
              !assigneeContext.permissionCodes.includes('sop.task.execute')
            )
              sopFail('SOP_ASSIGNEE_PERMISSION_REQUIRED', 409);
          }
          if (assignee)
            await tx.sopTaskAccess.create({
              data: { taskId: id, principalUserId: assignee, grantedBy: ctx.userId, validUntil: until, employmentStamp:await employmentStamp(tx,assignee) },
            });
          update.assignee = assignee ? { connect: { id: assignee } } : { disconnect: true };
        }
        const next = await tx.caseTask.update({ where: { id }, data: update });
        await tx.sopInstance.update({ where: { id: instance.id }, data: { version: { increment: 1 } } });
        await tx.case.update({
          where: { id: row.caseId },
          data: { version: { increment: 1 }, updatedBy: ctx.userId },
        });
        await this.recordChange(tx, 'SOP_TASK', next, action, instance.templateVersion.template.organizationId, {
          fromStatus: row.status,
          toStatus: next.status,
          assigneeUserId: next.assigneeUserId,
          dueDate: next.dueDate,
        });
        return this.projectTask(next);
      },
      async (tx, taskId) => this.projectTask(await requireSopTask(tx, this.ctx, taskId, permission)),
    );
  }
  async instanceAction(id: string, raw: unknown) {
    assertExactKeys(raw, ['action', 'expectedVersion', 'requestKey', 'reason']);
    const action = normalizeRequiredText(raw.action, 1, 30),
      version = normalizeVersion(raw.expectedVersion),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    if (!['PAUSE', 'RESUME', 'CANCEL', 'COMPLETE'].includes(action)) sopFail('VALIDATION_FAILED');
    const initial = await requireSopInstance(this.db, this.ctx, id, 'sop.instance.manage');
    await requireCaseAccess(this.db, this.ctx, initial.caseId, 'case.task.manage');
    const reason = action === 'CANCEL' ? normalizeRequiredText(raw.reason, 1, 500) : null;
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'SOP_INSTANCE_' + action, normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await new AuthorizationContextLoader(tx).load(this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM "case" WHERE id=${initial.caseId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${id} FOR UPDATE`;
        const row = await requireSopInstance(tx, ctx, id, 'sop.instance.manage');
        const caseRow = await requireCaseAccess(this.db, ctx, row.caseId, 'case.task.manage', tx);
        if (row.version !== version) sopFail('SOP_VERSION_CONFLICT', 409);
        if (['CLOSED', 'ARCHIVED'].includes(caseRow.status)) sopFail('CASE_STATE_INVALID', 409);
        const valid =
          action === 'RESUME'
            ? row.status === 'PAUSED'
            : action === 'CANCEL'
              ? ['ACTIVE', 'PAUSED'].includes(row.status)
              : row.status === 'ACTIVE';
        if (!valid) sopFail('SOP_STATE_INVALID', 409);
        if (
          action === 'COMPLETE' &&
          (await tx.caseTask.count({ where: { sopInstanceId: id, status: { notIn: terminal } } }))
        )
          sopFail('SOP_TASKS_INCOMPLETE', 409);
        const status =
          action === 'PAUSE'
            ? 'PAUSED'
            : action === 'RESUME'
              ? 'ACTIVE'
              : action === 'CANCEL'
                ? 'CANCELLED'
                : 'COMPLETED';
        const next = await tx.sopInstance.update({
          where: { id },
          data: { status, version: { increment: 1 } },
        });
        await tx.case.update({
          where: { id: row.caseId },
          data: { version: { increment: 1 }, updatedBy: ctx.userId },
        });
        await this.recordChange(tx, 'SOP_INSTANCE', next, action, row.templateVersion.template.organizationId, {
          fromStatus: row.status,
          status,
          reason,
        });
        return next;
      },
      (tx, targetId) => requireSopInstance(tx, this.ctx, targetId, 'sop.instance.manage'),
    );
  }
  async recordChange(
    tx: Prisma.TransactionClient,
    type: 'SOP_TASK' | 'SOP_INSTANCE',
    row: { id: string; version: number },
    action: string,
    organizationId: string,
    values: unknown,
  ) {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action: type + '_' + action,
        targetType: type,
        targetId: row.id,
        newValues: JSON.stringify(values),
        ip: this.actor.ip,
      },
    });
    await new PrismaEventOutboxWriter().append(tx, {
      eventType: type === 'SOP_TASK' ? 'sop.task.changed' : 'sop.instance.changed',
      eventVersion: 1,
      objectType: type,
      objectId: row.id,
      operatorUserId: this.ctx.userId,
      organizationId,
      branchId: organizationId,
      teamId: null,
      payload: { id: row.id, version: row.version, action },
      traceId: this.actor.requestId ?? row.id,
      occurredAt: new Date(),
    });
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { path: true },
    });
    const bases = await tx.collabTable.findMany({
      where: {
        source: 'SOP_TASKS',
        base: { workspace: { organizationId: { in: organization.path.split('/').filter(Boolean) } } },
      },
      select: { baseId: true },
      distinct: ['baseId'],
    });
    for (const base of bases)
      await appendCollaborationChange(tx, this.ctx.userId, base.baseId, 'business.changed', base.baseId);
  }
}
