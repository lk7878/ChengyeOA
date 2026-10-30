import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient, WorkflowInstance } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { CollaborationService } from '../collaboration/collaboration-service';
import { validateApprovalFile } from '../../domain/approval/approval-file-validation';
import {
  check,
  fieldMode,
  matches,
  matchesEdge,
  conditionalEdge,
  canSubmit,
  validateSchema,
  validateWorkflowName,
  recipientRules,
  validateValues,
  WorkflowError,
  WorkflowLocation,
  WorkflowSchema,
  FlowNode,
  Values,
  FormField,
} from '../../domain/workflow/schema';

type Tx = Prisma.TransactionClient;
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
const str = (x: unknown, max = 100) => {
  check(typeof x === 'string' && x.trim().length > 0 && x.length <= max, '输入内容为空或过长');
  return x.trim();
};
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot = (i: WorkflowInstance) => i.snapshot as unknown as WorkflowSchema;
const computed = (f: FormField) => ['formula', 'moneyUpper'].includes(f.type);

export class WorkflowService {
  constructor(
    readonly db: PrismaClient,
    readonly actor: AuthorizationContext,
  ) {}
  private require(code: 'approval.read' | 'approval.apply' | 'approval.process' | 'approval.manage') {
    new AuthorizationService().requireAction(this.actor, code);
  }
  private async roles(tx: Tx = this.db) {
    const now = new Date();
    return (
      await tx.userRole.findMany({
        where: {
          userId: this.actor.userId,
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          role: { status: 'ENABLED' },
        },
        select: { roleId: true },
      })
    ).map((r) => r.roleId);
  }
  async definitions(manage = false) {
    this.require(manage ? 'approval.manage' : 'approval.apply');
    const rows = await this.db.workflowDefinition.findMany({
      where: manage ? {} : { enabled: true, version: { gt: 0 } },
      orderBy: { updatedAt: 'desc' },
    });
    const roles = await this.roles();
    return rows
      .filter((d) => manage || canSubmit(d.published as unknown as WorkflowSchema, this.actor.userId, roles))
      .map(({ draft, published, ...d }) => ({ ...d, schema: manage ? draft : published }));
  }
  async saveDefinition(
    id: string | undefined,
    input: { name: string; schema: WorkflowSchema; revision?: number; publish?: boolean; enabled?: boolean },
  ) {
    this.require('approval.manage');
    const name = validateWorkflowName(input.name);
    check(input.schema && JSON.stringify(input.schema).length <= 200000, '流程配置过大');
    if (input.publish) {
      validateSchema(input.schema);
      await this.validateLinks(input.schema);
    }
    return this.db.$transaction(async (tx) => {
      let old = id ? await tx.workflowDefinition.findUnique({ where: { id } }) : null;
      if (id) check(old && old.revision === input.revision, '流程已被修改，请刷新后重试', 409);
      const data = {
        name,
        draft: json(input.schema),
        ...(input.publish
          ? { published: json(input.schema), version: (old?.version ?? 0) + 1, enabled: true }
          : input.enabled !== undefined
            ? { enabled: input.enabled }
            : {}),
      };
      check(
        !('enabled' in data && data.enabled) || input.publish || (old?.version ?? 0) > 0,
        '请先发布有效流程',
      );
      if (old) {
        const changed = await tx.workflowDefinition.updateMany({
          where: { id, revision: input.revision },
          data: { ...data, revision: { increment: 1 } },
        });
        check(changed.count === 1, '流程已被修改，请刷新后重试', 409);
      } else {
        old = await tx.workflowDefinition.create({ data: { ...data, createdBy: this.actor.userId } });
        id = old.id;
      }
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: input.publish ? 'WORKFLOW_PUBLISH' : 'WORKFLOW_DRAFT',
          targetType: 'WORKFLOW_DEFINITION',
          targetId: id!,
          newValues: JSON.stringify({
            version: 'version' in data ? data.version : old?.version,
          }),
        },
      });
      return tx.workflowDefinition.findUniqueOrThrow({ where: { id } });
    });
  }
  private async validateLinks(s: WorkflowSchema) {
    let location: WorkflowLocation = { section: 'settings', label: '多维表格与自动化' };
    try {
      const collab = new CollaborationService(this.db, this.actor);
      for (const f of s.fields.filter((f) => f.type === 'relation')) {
        location = { section: 'form', label: `表单字段：${f.label}`, field: f.key };
        await collab.describe(f.tableId!);
      }
      location = { section: 'settings', label: '多维表格与自动化' };
      if (s.binding) {
        const d = await collab.describe(s.binding.tableId);
        await collab.tableAccess(s.binding.tableId, this.db, 2);
        check(
          s.binding.mode !== 'CREATE' || (d.table.source === 'CUSTOM' && !d.table.lifecycleKind),
          '正式业务表需关联现有记录；新增业务请使用对应业务模块',
        );
        for (const m of s.binding.mappings)
          check(
            d.fields.some((f) => f.id === m.target && f.writable),
            '回写字段不存在、只读或未获写权限',
          );
      }
      if (s.webhook) check(Object.keys(hookConfiguration()).includes(s.webhook), '自动化接口尚未配置');
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (error instanceof Error && typeof status === 'number' && status >= 400 && status < 500) {
        const contextual = new WorkflowError(error.message, status);
        contextual.location = location;
        throw contextual;
      }
      throw error;
    }
  }
  async options() {
    this.require('approval.read');
    const [users, roles] = await Promise.all([
      this.db.user.findMany({
        where: { status: 'ENABLED' },
        select: { id: true, username: true, employee: { select: { name: true } } },
        orderBy: { username: 'asc' },
        take: 2000,
      }),
      this.db.role.findMany({
        where: { status: 'ENABLED' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      users: users.map((u) => ({
        id: u.id,
        name: u.employee?.name ? `${u.employee.name} (${u.username})` : u.username,
      })),
      roles,
      ownRoles: await this.roles(),
      hooks: this.actor.permissionCodes.includes('approval.manage') ? Object.keys(hookConfiguration()) : [],
    };
  }
  async start(
    input: {
      definitionId: string;
      title: string;
      content: Values;
      selections?: Record<string, string[]>;
      targetRecordId?: string;
      correctionOf?: string;
    },
    key: string,
  ) {
    this.require('approval.apply');
    this.require('approval.read');
    key = str(key, 150);
    const requestKey = this.actor.userId + ':' + key,
      requestHash = digest(input);
    return this.db
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey},0))`;
          const old = await tx.workflowInstance.findUnique({ where: { requestKey } });
          if (old) {
            check(old.requestHash === requestHash, '同一请求编号不能提交不同内容', 409);
            return old.id;
          }
          const d = await tx.workflowDefinition.findFirst({
            where: { id: input.definitionId, enabled: true, version: { gt: 0 } },
          });
          check(d, '流程不存在或已停用', 404);
          let original: WorkflowInstance | null = null;
          if (input.correctionOf) {
            await tx.$queryRaw`SELECT id FROM workflow_instance WHERE id=${input.correctionOf} FOR UPDATE`;
            original = await tx.workflowInstance.findUnique({ where: { id: input.correctionOf } });
            check(
              original &&
                original.applicantId === this.actor.userId &&
                original.definitionId === d.id &&
                original.status === 'APPROVED',
              '只能更正本人已通过的申请',
              403,
            );
            check(snapshot(original).settings?.allowCorrection !== false, '该流程未开放更正申请', 403);
            check(
              !snapshot(original).binding || original.syncStatus === 'SYNCED',
              '请先处理原申请的回写异常',
            );
            const child = await tx.workflowInstance.findFirst({
              where: {
                selections: { path: ['_corrects'], equals: original.id },
                status: { in: ['PENDING', 'APPROVED'] },
              },
            });
            check(!child, '该申请已有处理中或已通过的更正，请打开最新更正单', 409);
          }
          const s = validateSchema(original ? original.snapshot : d.published),
            start = s.nodes.find((n) => n.type === 'START')!;
          check(
            canSubmit(validateSchema(d.published), this.actor.userId, await this.roles(tx)),
            '你不在此流程的提交范围内',
            403,
          );
          check(canSubmit(s, this.actor.userId, await this.roles(tx)), '你不在原流程的提交范围内', 403);
          if (original && s.binding) {
            check(original.targetRecordId, '原申请缺少关联业务记录');
            s.binding.mode = 'UPDATE';
          }
          const targetRecordId = original?.targetRecordId ?? input.targetRecordId;
          const content = await this.merge(
            tx,
            s,
            start,
            original ? (original.content as Values) : {},
            input.content,
          );
          const selections: Values = {};
          if (original) selections._corrects = original.id;
          for (const [node, ids] of Object.entries(input.selections ?? {})) {
            check(
              s.nodes.some((n) => n.id === node && recipientRules(n).some((r) => r.type === 'SELECT')) &&
                Array.isArray(ids) &&
                ids.length > 0 &&
                ids.length <= 50,
              '自选审批人配置无效',
            );
            selections[node] = ids.map((id) => str(id));
          }
          if (s.binding) {
            const c = new CollaborationService(this.db, this.actor);
            await c.tableAccess(s.binding.tableId, tx, 2);
            if (s.binding.mode === 'UPDATE') {
              check(targetRecordId, '请选择回写业务记录');
              const r = await c.record(s.binding.tableId, targetRecordId);
              selections._targetVersion = r.record.version;
            }
            // Capture the schema version too; a later schema change needs explicit reconciliation.
            selections._schemaVersion = (await c.describe(s.binding.tableId)).table.schemaVersion;
          }
          const i = await tx.workflowInstance.create({
            data: {
              definitionId: d.id,
              definitionVersion: original?.definitionVersion ?? d.version,
              title: str(input.title, 200),
              snapshot: json(s),
              content: json(content),
              selections: json(selections),
              applicantId: this.actor.userId,
              currentNode: start.id,
              targetRecordId: targetRecordId ?? null,
              requestKey,
              requestHash,
            },
          });
          await this.log(tx, i, 'APPLY');
          if (original) {
            await this.log(tx, i, 'CORRECTION', `更正原申请：${original.id}`);
            await this.log(tx, original, 'CORRECTION_STARTED', `更正申请：${i.id}`);
          }
          await this.advance(tx, i, this.next(s, start.id, content));
          return i.id;
        },
        { timeout: 30000 },
      )
      .then((id) => this.detail(id));
  }
  private next(s: WorkflowSchema, id: string, values: Values) {
    const edges = s.edges
      .filter((e) => e.from === id)
      .sort((a, b) => (a.priority ?? 160) - (b.priority ?? 160));
    const e =
      edges.find((e) => conditionalEdge(e) && matchesEdge(e, values)) ??
      edges.find((e) => !conditionalEdge(e));
    check(e, '没有可用的后续节点');
    return e.to;
  }
  private async recipients(tx: Tx, n: FlowNode, i: WorkflowInstance) {
    if (n.type === 'CC' && n.ccRules !== undefined) {
      const all: string[] = [];
      for (const [index, rule] of n.ccRules.entries()) {
        all.push(
          ...(await this.recipients(
            tx,
            { ...n, name: `${n.name} / 抄送对象 ${index + 1}`, ccRules: undefined, rule },
            i,
          )),
        );
      }
      const ids = [...new Set(all)];
      check(ids.length > 0 && ids.length <= 100, `${n.name}合并后的抄送人数须为1至100人`);
      return ids;
    }
    const rule = n.rule!;
    const now = new Date();
    let ids: string[] = [];
    if (rule.type === 'SELF') ids = [i.applicantId];
    if (rule.type === 'USER') ids = rule.ids!;
    if (rule.type === 'ROLE')
      ids = (
        await tx.userRole.findMany({
          where: {
            roleId: { in: rule.ids },
            role: { status: 'ENABLED' },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
        })
      ).map((r) => r.userId);
    if (rule.type === 'SELECT') ids = (i.selections as Record<string, string[]>)[n.id] ?? [];
    if (rule.type === 'FIELD') ids = [String((i.content as Values)[rule.field!] ?? '')];
    if (['MANAGER', 'SUPERVISOR'].includes(rule.type)) {
      const u = await tx.user.findUnique({ where: { id: i.applicantId } });
      check(u?.employeeId, '发起人未绑定员工，无法解析负责人');
      let employee = u.employeeId;
      if (rule.type === 'MANAGER') {
        const a = await tx.employeeAssignment.findMany({
          where: {
            employeeId: employee,
            endedAt: null,
            startedAt: { lte: now },
            organization: { status: 'ENABLED' },
          },
          include: { organization: true },
        });
        const managers = [...new Set(a.map((x) => x.organization.managerEmployeeId).filter(Boolean))];
        check(managers.length === 1, '部门负责人缺失或存在多个，请完善任职信息');
        employee = managers[0]!;
        ids = (await tx.user.findMany({ where: { employeeId: employee, status: 'ENABLED' } })).map(
          (u) => u.id,
        );
      } else
        for (let level = 0; level < (rule.levels ?? 1); level++) {
          const line = await tx.employeeReportingLine.findFirst({
            where: { employeeId: employee, endedAt: null, startedAt: { lte: now } },
          });
          check(line, '所需层级主管未配置');
          employee = line.managerEmployeeId;
          const manager = await tx.user.findFirst({
            where: {
              employeeId: employee,
              status: 'ENABLED',
              employee: { deletedAt: null, status: { not: 'LEAVED' } },
            },
          });
          check(manager, '主管没有可用账号');
          ids.push(manager.id);
        }
    }
    ids = [...new Set(ids)];
    check(ids.length > 0 && ids.length <= 100, `${n.name}没有可用处理人`);
    const users = await tx.user.findMany({
      where: {
        id: { in: ids },
        status: 'ENABLED',
        OR: [{ employeeId: null }, { employee: { deletedAt: null, status: { not: 'LEAVED' } } }],
      },
    });
    check(users.length === ids.length, `${n.name}包含已停用或离职账号`);
    for (const id of ids) {
      const context = await new AuthorizationContextLoader(tx).load(id);
      new AuthorizationService().requireAction(context, 'approval.read');
      new AuthorizationService().requireAction(
        context,
        n.type === 'CC' ? 'approval.read' : 'approval.process',
      );
    }
    return ids;
  }
  private async log(
    tx: Tx,
    i: WorkflowInstance,
    action: string,
    remark?: string,
    requestKey?: string,
    changes?: unknown,
    actorId = this.actor.userId,
  ) {
    return tx.workflowLog.create({
      data: {
        instanceId: i.id,
        nodeId: i.currentNode,
        actorId,
        action,
        remark: remark?.slice(0, 2000),
        requestKey,
        changes: changes ? json(changes) : undefined,
      },
    });
  }
  private async notify(tx: Tx, i: WorkflowInstance, userId: string, tag: string, title: string) {
    await tx.notification.upsert({
      where: { deduplicationKey: `workflow:${i.id}:${tag}:${userId}` },
      create: {
        userId,
        type: 'APPROVAL',
        title,
        content: i.title,
        relatedId: i.id,
        relatedType: 'WORKFLOW',
        routeUrl: `/approvals/visual?instance=${i.id}`,
        deduplicationKey: `workflow:${i.id}:${tag}:${userId}`,
      },
      update: {},
    });
  }
  private async advance(tx: Tx, i: WorkflowInstance, id: string) {
    const s = snapshot(i);
    let steps = 0;
    while (++steps <= s.nodes.length + 1) {
      const n = s.nodes.find((n) => n.id === id);
      check(n, '流程节点不存在');
      i.currentNode = id;
      i.visit++;
      await tx.workflowInstance.update({ where: { id: i.id }, data: { currentNode: id, visit: i.visit } });
      if (n.type === 'END') {
        validateValues(s.fields, i.content as Values);
        i.status = 'APPROVED';
        await tx.workflowInstance.update({
          where: { id: i.id },
          data: { status: 'APPROVED', finishedAt: new Date() },
        });
        await this.log(tx, i, 'COMPLETED');
        await this.sync(tx, i);
        if (s.webhook) await tx.workflowDelivery.create({ data: { instanceId: i.id, hook: s.webhook } });
        await this.notify(tx, i, i.applicantId, 'completed', '审批已通过');
        return;
      }
      if (n.type === 'START') {
        await tx.workflowTask.create({
          data: { instanceId: i.id, nodeId: n.id, visit: i.visit, assigneeId: i.applicantId },
        });
        await this.notify(tx, i, i.applicantId, `return:${i.visit}`, '审批已退回，请修改后重新提交');
        return;
      }
      if (n.type === 'BRANCH') {
        await this.log(tx, i, 'BRANCH');
        id = this.next(s, id, i.content as Values);
        continue;
      }
      if (n.type === 'APPROVAL' && n.approvalType && n.approvalType !== 'MANUAL') {
        await this.log(
          tx,
          i,
          n.approvalType === 'APPROVE' ? 'RULE_APPROVE' : 'RULE_REJECT',
          '按发布时配置的自动审批规则执行',
        );
        if (n.approvalType === 'REJECT') {
          await tx.workflowInstance.update({
            where: { id: i.id },
            data: { status: 'REJECTED', finishedAt: new Date() },
          });
          if (s.webhook) await tx.workflowDelivery.create({ data: { instanceId: i.id, hook: s.webhook } });
          await this.notify(tx, i, i.applicantId, 'rule-rejected', '审批按配置自动驳回');
          return;
        }
        id = this.next(s, id, i.content as Values);
        continue;
      }
      const ids = await this.recipients(tx, n, i);
      if (n.type === 'CC') {
        await tx.workflowTask.createMany({
          data: ids.map((assigneeId) => ({
            instanceId: i.id,
            nodeId: id,
            visit: i.visit,
            assigneeId,
            status: 'CC',
          })),
        });
        for (const user of ids) await this.notify(tx, i, user, `cc:${i.visit}`, '审批抄送');
        await this.log(tx, i, 'CC');
        id = this.next(s, id, i.content as Values);
        continue;
      }
      const done =
        n.skipRepeated && !(i.selections as Values)._repeatInvalidated
          ? (
              await tx.workflowTask.findMany({
                where: { instanceId: i.id, status: { in: ['APPROVED', 'AUTO_APPROVED'] } },
              })
            ).map((t) => t.assigneeId)
          : [];
      let active = 0;
      for (const [position, assigneeId] of ids.entries()) {
        const skipped = done.includes(assigneeId);
        const sequential = n.mode === 'SEQUENTIAL' || n.rule?.type === 'SUPERVISOR';
        const status = skipped ? 'SKIPPED' : sequential && active > 0 ? 'WAITING' : 'PENDING';
        if (!skipped) active++;
        const task = await tx.workflowTask.create({
          data: {
            instanceId: i.id,
            nodeId: id,
            visit: i.visit,
            assigneeId,
            position,
            status,
            dueAt:
              status === 'PENDING' && n.timeoutHours ? new Date(Date.now() + n.timeoutHours * 3600000) : null,
            processedAt: skipped ? new Date() : null,
          },
        });
        if (status === 'PENDING') await this.notify(tx, i, assigneeId, task.id, '有新的审批待办');
      }
      await this.log(tx, i, 'ENTER');
      if (!active || (n.mode === 'ANY' && ids.some((x) => done.includes(x)))) {
        await tx.workflowTask.updateMany({
          where: { instanceId: i.id, visit: i.visit, status: { in: ['PENDING', 'WAITING'] } },
          data: { status: 'CANCELLED' },
        });
        await this.log(tx, i, 'SKIP_REPEATED');
        id = this.next(s, id, i.content as Values);
        continue;
      }
      return;
    }
    throw new WorkflowError('流程自动流转超出安全步数');
  }
  private async merge(tx: Tx, s: WorkflowSchema, n: FlowNode, old: Values, patch: Values) {
    check(patch && typeof patch === 'object' && !Array.isArray(patch), '表单数据格式错误');
    const roles = await this.roles(tx);
    const next = { ...old };
    for (const [key, value] of Object.entries(patch)) {
      const f = s.fields.find((f) => f.key === key);
      check(f && !computed(f) && fieldMode(n, key, roles) === 'EDIT', '包含只读、隐藏或未知字段', 403);
      next[key] = value;
    }
    for (const key of Object.keys(patch))
      check(
        matches(s.fields.find((f) => f.key === key)!.visibleWhen, next),
        '不能修改当前条件下隐藏的字段',
        403,
      );
    const out = validateValues(
      s.fields,
      next,
      new Set(s.fields.filter((f) => fieldMode(n, f.key, roles) === 'EDIT').map((f) => f.key)),
    );
    for (const f of s.fields) {
      const value = out[f.key];
      if (!value) continue;
      if (f.type === 'file' && f.key in patch) {
        const existing = Array.isArray(old[f.key]) ? (old[f.key] as string[]) : [];
        const added = (value as string[]).filter((id) => !existing.includes(id));
        check(
          (await tx.workflowFile.count({ where: { id: { in: added }, ownerId: this.actor.userId } })) ===
            added.length,
          '附件不存在或无访问权限',
          403,
        );
      }
      if (f.type === 'relation' && f.key in patch)
        await new CollaborationService(this.db, this.actor).record(f.tableId!, String(value));
      if (f.type === 'user' && f.key in patch)
        check(await tx.user.count({ where: { id: String(value), status: 'ENABLED' } }), '人员账号不可用');
    }
    return out;
  }
  async act(
    id: string,
    input: {
      action: string;
      version: number;
      values?: Values;
      remark?: string;
      userIds?: string[];
      returnNode?: string;
      targetVersion?: number;
    },
    key: string,
    automatic = false,
  ) {
    this.require('approval.read');
    this.require(
      input.action === 'RESUBMIT' || input.action === 'WITHDRAW'
        ? 'approval.apply'
        : input.action === 'RETRY_SYNC'
          ? 'approval.read'
          : 'approval.process',
    );
    check(
      ['APPROVE', 'REJECT', 'RETURN', 'FORWARD', 'ADD', 'RESUBMIT', 'WITHDRAW', 'RETRY_SYNC'].includes(
        input.action,
      ),
      '审批操作无效',
    );
    check(!input.remark || (typeof input.remark === 'string' && input.remark.length <= 2000), '审批意见过长');
    const requestKey = this.actor.userId + ':' + str(key, 150),
      hash = digest({ id, ...input });
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM workflow_instance WHERE id=${id} FOR UPDATE`;
        const i = await tx.workflowInstance.findUnique({ where: { id } });
        check(i, '审批不存在', 404);
        const replay = await tx.workflowLog.findUnique({ where: { requestKey } });
        if (replay) {
          check(
            replay.instanceId === id && (replay.changes as Values)?.requestHash === hash,
            '请求编号已使用',
            409,
          );
          return;
        }
        check(i.version === input.version, '审批已发生变化，请刷新后重试', 409);
        const s = snapshot(i),
          n = s.nodes.find((n) => n.id === i.currentNode)!;
        if (input.action === 'RETRY_SYNC') {
          check(
            i.status === 'APPROVED' &&
              i.syncStatus === 'FAILED' &&
              (i.applicantId === this.actor.userId || this.actor.permissionCodes.includes('approval.manage')),
            '当前不能重试同步',
            403,
          );
          if (input.targetVersion !== undefined) {
            check(Number.isSafeInteger(input.targetVersion) && input.targetVersion > 0, '记录版本无效');
            i.selections = json({
              ...(i.selections as Values),
              _targetVersion: input.targetVersion,
            }) as Prisma.JsonValue;
            await tx.workflowInstance.update({
              where: { id },
              data: { selections: i.selections as Prisma.InputJsonValue },
            });
          }
          await this.sync(tx, i);
        } else {
          check(i.status === 'PENDING', '审批已经结束', 409);
          const task = await tx.workflowTask.findFirst({
            where: { instanceId: id, visit: i.visit, status: 'PENDING', assigneeId: this.actor.userId },
          });
          if (input.action === 'WITHDRAW')
            check(i.applicantId === this.actor.userId, '只能撤回本人申请', 403);
          else check(task, '没有属于你的当前待办', 403);
          if (input.action === 'RESUBMIT')
            check(n.type === 'START' && i.applicantId === this.actor.userId, '当前不是重新提交节点', 403);
          else if (input.action !== 'WITHDRAW') check(n.type === 'APPROVAL', '当前节点不可审批');
          const actionKey = { FORWARD: 'forward', ADD: 'add', RETURN: 'return' }[input.action] as
            | 'forward'
            | 'add'
            | 'return'
            | undefined;
          if (actionKey) check(n.actions?.[actionKey] !== false, '当前节点未开放此操作', 403);
          if (input.action === 'WITHDRAW')
            check(s.settings?.allowWithdraw !== false, '该流程不允许撤回', 403);
          if (input.action === 'APPROVE' && n.actions?.remarkRequired)
            check(input.remark?.trim(), '请填写审批意见');
          if (
            input.action === 'RETURN' ||
            Object.entries(input.values ?? {}).some(
              ([k, v]) => digest(v) !== digest((i.content as Values)[k] ?? null),
            )
          ) {
            i.selections = json({
              ...(i.selections as Values),
              _repeatInvalidated: true,
            }) as Prisma.JsonValue;
            await tx.workflowInstance.update({
              where: { id },
              data: { selections: i.selections as Prisma.InputJsonValue },
            });
          }
          if (['APPROVE', 'RESUBMIT'].includes(input.action)) {
            const values = await this.merge(tx, s, n, i.content as Values, input.values ?? {});
            i.content = json(values) as Prisma.JsonValue;
            await tx.workflowInstance.update({
              where: { id },
              data: { content: i.content as Prisma.InputJsonValue },
            });
            await tx.workflowTask.update({
              where: { id: task!.id },
              data: {
                status: automatic ? 'AUTO_APPROVED' : 'APPROVED',
                remark: input.remark,
                processedAt: new Date(),
              },
            });
            let waiting = await tx.workflowTask.findMany({
              where: { instanceId: id, visit: i.visit, status: { in: ['WAITING', 'PENDING'] } },
              orderBy: { position: 'asc' },
            });
            if (n.mode === 'ANY') {
              await tx.workflowTask.updateMany({
                where: { instanceId: id, visit: i.visit, status: { in: ['WAITING', 'PENDING'] } },
                data: { status: 'CANCELLED' },
              });
              waiting = [];
            }
            if (!waiting.length) await this.advance(tx, i, this.next(s, n.id, values));
            else if (!waiting.some((t) => t.status === 'PENDING')) {
              const t = waiting[0];
              await tx.workflowTask.update({
                where: { id: t.id },
                data: {
                  status: 'PENDING',
                  dueAt: n.timeoutHours ? new Date(Date.now() + n.timeoutHours * 3600000) : null,
                },
              });
              await this.notify(tx, i, t.assigneeId, t.id, '有新的审批待办');
            }
          } else if (['REJECT', 'WITHDRAW', 'RETURN'].includes(input.action)) {
            check(input.action === 'WITHDRAW' || input.remark?.trim(), '请填写驳回或退回原因');
            if (task)
              await tx.workflowTask.update({
                where: { id: task.id },
                data: {
                  status: input.action === 'REJECT' ? 'REJECTED' : 'RETURNED',
                  remark: input.remark,
                  processedAt: new Date(),
                },
              });
            await tx.workflowTask.updateMany({
              where: { instanceId: id, status: { in: ['PENDING', 'WAITING'] } },
              data: { status: 'CANCELLED' },
            });
            if (input.action === 'RETURN') {
              const target = s.nodes.find((x) => x.id === input.returnNode);
              check(
                target && ['START', 'APPROVAL'].includes(target.type) && target.id !== n.id,
                '请选择已到达的上游节点',
              );
              const reached =
                target.type === 'START' ||
                (await tx.workflowLog.count({
                  where: { instanceId: id, nodeId: target.id, action: 'ENTER' },
                }));
              check(reached, '只能退回已到达的节点');
              await this.advance(tx, i, target.id);
            } else {
              await tx.workflowInstance.update({
                where: { id },
                data: {
                  status: input.action === 'REJECT' ? 'REJECTED' : 'WITHDRAWN',
                  finishedAt: new Date(),
                },
              });
              if (s.webhook)
                await tx.workflowDelivery.create({ data: { instanceId: i.id, hook: s.webhook } });
              await this.notify(tx, i, i.applicantId, `end:${i.version}`, '审批已结束');
            }
          } else {
            check(
              Array.isArray(input.userIds) && input.userIds.length > 0 && input.userIds.length <= 20,
              '请选择转办或加签人员',
            );
            const ids = await this.recipients(tx, { ...n, rule: { type: 'USER', ids: input.userIds } }, i);
            const existing = await tx.workflowTask.findMany({ where: { instanceId: id, visit: i.visit } });
            check(
              ids.every((uid) => !existing.some((t) => t.assigneeId === uid)),
              '不能重复添加当前节点处理人',
            );
            if (input.action === 'FORWARD') check(ids.length === 1, '转办只能选择一人');
            if (input.action === 'FORWARD')
              await tx.workflowTask.update({
                where: { id: task!.id },
                data: { status: 'FORWARDED', remark: input.remark, processedAt: new Date() },
              });
            for (const [j, user] of ids.entries()) {
              const state =
                input.action === 'ADD' && (n.mode === 'SEQUENTIAL' || n.rule?.type === 'SUPERVISOR')
                  ? 'WAITING'
                  : 'PENDING';
              const t = await tx.workflowTask.create({
                data: {
                  instanceId: id,
                  nodeId: n.id,
                  visit: i.visit,
                  assigneeId: user,
                  status: state,
                  position:
                    input.action === 'FORWARD'
                      ? task!.position
                      : Math.max(...existing.map((t) => t.position)) + 1 + j,
                  dueAt:
                    state === 'PENDING' && n.timeoutHours
                      ? new Date(Date.now() + n.timeoutHours * 3600000)
                      : null,
                },
              });
              if (state === 'PENDING') await this.notify(tx, i, user, t.id, '有新的审批待办');
            }
          }
        }
        // Log the node that was acted upon, even when advance changed currentNode.
        await this.log(
          tx,
          { ...i, currentNode: n.id },
          automatic ? 'TIMEOUT_APPROVE' : input.action,
          input.remark,
          requestKey,
          { requestHash: hash, fields: Object.keys(input.values ?? {}) },
        );
        await tx.workflowInstance.update({ where: { id }, data: { version: { increment: 1 } } });
      },
      { timeout: 30000 },
    );
    return this.detail(id);
  }
  private async sync(tx: Tx, i: WorkflowInstance) {
    const s = snapshot(i);
    if (!s.binding) return;
    const createdFiles: string[] = [];
    await tx.$executeRawUnsafe('SAVEPOINT workflow_writeback');
    try {
      const context = await new AuthorizationContextLoader(tx).load(i.applicantId);
      const c = new CollaborationService(this.db, context),
        b = s.binding;
      const { fields } = await c.tableAccess(b.tableId, tx, 2);
      const data: Values = {};
      for (const m of b.mappings) {
        const field = fields.find((f) => f.id === m.target);
        check(field, '回写字段已不存在或无权访问');
        let value = (i.content as Values)[m.field] ?? null;
        const source = s.fields.find((f) => f.key === m.field)!;
        if (value !== null) {
          if (field.type === 'CURRENCY') value = new Prisma.Decimal(String(value)).toFixed(2);
          if (field.type === 'DATETIME' && source.type === 'date') value = String(value) + 'T00:00:00+08:00';
          if (field.type === 'USER' && source.type === 'user') {
            const u = await tx.user.findUnique({ where: { id: String(value) } });
            check(u?.employeeId, '回写人员必须绑定员工档案');
            value = u.employeeId;
          }
          if (field.type === 'RELATION' && !Array.isArray(value)) value = [value];
          if (['SINGLE_SELECT', 'MULTI_SELECT'].includes(field.type)) {
            const choices =
              (field.options as { choices?: Array<{ id: string; label?: string; name?: string }> }).choices ??
              [];
            const convert = (v: unknown) =>
              choices.find((c) => c.id === v || c.label === v || c.name === v)?.id ?? v;
            value = Array.isArray(value) ? value.map(convert) : convert(value);
          }
          if (field.type === 'FILE' && source.type === 'file') {
            const copied: string[] = [];
            for (const fileId of value as string[]) {
              const f = await tx.workflowFile.findUnique({ where: { id: fileId } });
              check(f, '审批附件不存在');
              const id = randomUUID(),
                root = path.join(process.cwd(), 'var', 'storage', 'collaboration');
              await fs.mkdir(root, { recursive: true });
              const storagePath = path.join(root, id);
              await fs.writeFile(storagePath, f.bytes, { flag: 'wx' });
              createdFiles.push(storagePath);
              await tx.collabAttachment.create({
                data: {
                  id,
                  tableId: b.tableId,
                  ownerId: i.applicantId,
                  name: f.name,
                  mimeType: f.mime,
                  size: f.bytes.length,
                  storageKey: id,
                },
              });
              copied.push(id);
            }
            value = copied;
          }
        }
        data[m.target] = value;
      }
      const saved = await c.saveRecord(
        b.tableId,
        b.mode === 'UPDATE' ? i.targetRecordId! : undefined,
        {
          schemaVersion: (i.selections as Values)._schemaVersion,
          ...(b.mode === 'UPDATE' ? { version: (i.selections as Values)._targetVersion } : {}),
          values: data,
        },
        'workflow:' + i.id,
        tx,
      );
      await tx.workflowInstance.update({
        where: { id: i.id },
        data: { syncStatus: 'SYNCED', syncError: null, targetRecordId: saved.id },
      });
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT workflow_writeback');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT workflow_writeback');
      await Promise.all(createdFiles.map((file) => fs.unlink(file).catch((): void => {})));
      await tx.workflowInstance.update({
        where: { id: i.id },
        data: {
          syncStatus: 'FAILED',
          syncError: error instanceof Error ? error.message.slice(0, 400) : '回写失败',
        },
      });
    }
  }
  async detail(id: string) {
    this.require('approval.read');
    const i = await this.db.workflowInstance.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { createdAt: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
        deliveries: { select: { id: true, status: true, attempts: true, error: true } },
      },
    });
    check(
      i &&
        (this.actor.permissionCodes.includes('approval.manage') ||
          i.applicantId === this.actor.userId ||
          i.tasks.some((t) => t.assigneeId === this.actor.userId)),
      '审批不存在或不可访问',
      404,
    );
    const s = snapshot(i),
      roles = await this.roles();
    const own = i.tasks.filter((t) => t.assigneeId === this.actor.userId).at(-1);
    const n = s.nodes.find((n) => n.id === (own?.nodeId ?? s.nodes.find((n) => n.type === 'START')!.id))!;
    const manage = this.actor.permissionCodes.includes('approval.manage');
    const visible = s.fields.filter((f) => manage || fieldMode(n, f.key, roles) !== 'HIDDEN');
    // Computed fields cannot disclose a hidden input through their output.
    const keys = new Set(visible.map((f) => f.key));
    const fields = visible
      .filter((f) => !f.sourceField || keys.has(f.sourceField))
      .filter((f) => !f.formula || f.formula.fields.every((ref) => keys.has(ref.split('.')[0])));
    const content = Object.fromEntries(
      fields
        .filter((f) => matches(f.visibleWhen, i.content as Values))
        .map((f) => [f.key, (i.content as Values)[f.key] ?? null]),
    );
    const editable =
      own?.status === 'PENDING' && own.visit === i.visit
        ? fields.filter((f) => !computed(f) && fieldMode(n, f.key, roles) === 'EDIT').map((f) => f.key)
        : [];
    const { requestKey: _key, requestHash: _hash, selections: _selections, ...view } = i;
    void _key;
    void _hash;
    void _selections;
    return {
      ...view,
      snapshot: { ...s, fields },
      content,
      editable,
      correctionOf: (i.selections as Values)._corrects ?? null,
      canCorrect:
        i.applicantId === this.actor.userId &&
        i.status === 'APPROVED' &&
        s.settings?.allowCorrection !== false &&
        (!s.binding || i.syncStatus === 'SYNCED') &&
        !(await this.db.workflowInstance.count({
          where: {
            selections: { path: ['_corrects'], equals: i.id },
            status: { in: ['PENDING', 'APPROVED'] },
          },
        })),
      logs: i.logs.map(({ changes: _changes, requestKey: _request, ...log }) => {
        void _changes;
        void _request;
        return log;
      }),
    };
  }
  async list(role: string, page = 1, keyword = '') {
    this.require(role === 'ALL' ? 'approval.manage' : 'approval.read');
    check(['APPLIED', 'TODO', 'DONE', 'CC', 'ALL'].includes(role), '任务分类无效');
    const where: Prisma.WorkflowInstanceWhereInput = {
      ...(keyword ? { title: { contains: keyword.slice(0, 100) } } : {}),
      ...(role === 'APPLIED'
        ? { applicantId: this.actor.userId }
        : role === 'ALL'
          ? {}
          : {
              tasks: {
                some: {
                  assigneeId: this.actor.userId,
                  status:
                    role === 'TODO'
                      ? 'PENDING'
                      : role === 'CC'
                        ? 'CC'
                        : { in: ['APPROVED', 'AUTO_APPROVED', 'REJECTED', 'RETURNED', 'FORWARDED'] },
                },
              },
            }),
    };
    const [rows, total] = await Promise.all([
      this.db.workflowInstance.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          currentNode: true,
          definitionVersion: true,
          applicantId: true,
          syncStatus: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        skip: (Math.max(1, page) - 1) * 30,
      }),
      this.db.workflowInstance.count({ where }),
    ]);
    return { rows, total };
  }
  async stats() {
    this.require('approval.manage');
    const counts = await this.db.workflowInstance.groupBy({ by: ['status'], _count: true });
    const nodes = await this.db.$queryRaw<
      Array<{ nodeName: string; count: bigint; hours: number }>
    >`SELECT i.snapshot->'nodes'->(SELECT ordinality::int-1 FROM jsonb_array_elements(i.snapshot->'nodes') WITH ORDINALITY n WHERE n.value->>'id'=t."nodeId" LIMIT 1)->>'name' AS "nodeName", count(*) AS count, AVG(EXTRACT(EPOCH FROM (t."processedAt"-t."createdAt"))/3600)::float8 AS hours FROM workflow_task t JOIN workflow_instance i ON i.id=t."instanceId" WHERE t."processedAt" IS NOT NULL GROUP BY 1`;
    return {
      counts,
      nodes: nodes.map((n) => ({ ...n, count: Number(n.count) })),
      overdue: await this.db.workflowTask.count({ where: { status: 'PENDING', dueAt: { lt: new Date() } } }),
      syncFailures: await this.db.workflowInstance.count({ where: { syncStatus: 'FAILED' } }),
    };
  }
  async upload(name: string, bytes: Buffer) {
    check(
      this.actor.permissionCodes.includes('approval.apply') ||
        this.actor.permissionCodes.includes('approval.process'),
      '没有上传审批材料的权限',
      403,
    );
    const mime = validateApprovalFile(name, bytes);
    return this.db.workflowFile.create({
      data: { ownerId: this.actor.userId, name: str(name, 200), mime, bytes },
      select: { id: true, name: true },
    });
  }
  async download(fileId: string, instanceId?: string) {
    this.require('approval.read');
    const f = await this.db.workflowFile.findUnique({ where: { id: fileId } });
    check(f, '附件不存在', 404);
    if (f.ownerId !== this.actor.userId) {
      check(instanceId, '附件不可访问', 403);
      const i = await this.detail(instanceId);
      check(
        (i.snapshot as WorkflowSchema).fields.some(
          (field) =>
            field.type === 'file' &&
            Array.isArray(i.content[field.key]) &&
            (i.content[field.key] as string[]).includes(fileId),
        ),
        '附件不可访问',
        403,
      );
    }
    return f;
  }
}
export function hookConfiguration(): Record<string, { url: string; secret: string }> {
  try {
    const raw = JSON.parse(process.env.WORKFLOW_WEBHOOKS ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(([name, value]) => {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !value || typeof value !== 'object') return false;
        const hook = value as { url?: unknown; secret?: unknown };
        if (typeof hook.url !== 'string' || typeof hook.secret !== 'string' || hook.secret.length < 32)
          return false;
        try {
          const url = new URL(hook.url);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }),
    ) as Record<string, { url: string; secret: string }>;
  } catch {
    return {};
  }
}
