import { randomUUID } from 'node:crypto';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { normalizeAllowedValue, normalizeRequiredText } from '../../domain/master-data/master-data-validation';
import { assertCostAnchorShape } from '../../domain/finance/finance-policy';
import { COST_CATEGORIES, CostCategory } from '../../domain/finance/finance-types';

export const SYNC_TARGETS = ['COST', 'LEAVE', 'SEAL', 'CONTRACT_CHANGE', 'TRANSFER', 'CUSTOM', 'PAYROLL'] as const;
const DEFAULT_TARGETS: Record<string, string> = { EXPENSE: 'COST', LEAVE: 'LEAVE', SEAL: 'SEAL', CONTRACT_CHANGE: 'CONTRACT_CHANGE', TRANSFER: 'TRANSFER', PAYROLL: 'PAYROLL' };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
class SyncIncomplete extends Error {}

// Call inside the decision transaction, after acquiring the instance row lock.
// A savepoint preserves the approval decision if a business write needs intervention.
export async function syncApproved(tx: Prisma.TransactionClient, instanceId: string, actor: AuditActor, context?: AuthorizationContext) {
  const instance = await tx.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  if (instance.status !== 'APPROVED') return null;
  const old = await tx.approvalSyncRecord.findUnique({ where: { instanceId } });
  if (old?.status === 'SYNCED') return old;
  const rule = await tx.approvalSyncRule.findUnique({ where: { definitionId: instance.definitionId } });
  const target = DEFAULT_TARGETS[instance.businessType] ?? rule?.target ?? 'UNCONFIGURED';
  const data = instance.content as Record<string, unknown>;
  let targetId: string | null = null;
  let status = 'SYNCED';
  let reason: string | null = null;
  await tx.$executeRawUnsafe('SAVEPOINT approval_business_sync');
  try {
    if (target === 'UNCONFIGURED') throw new SyncIncomplete('请管理员配置此自定义审批的目标台账后重试');
    if (target === 'COST') {
      const rawAmount = String(data.amount ?? '');
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(rawAmount) || new Prisma.Decimal(rawAmount).lte(0)) throw new SyncIncomplete('缺少有效报销金额（amount），须大于零且最多两位小数');
      const labels: Record<string, CostCategory> = { 渠道成本: 'CHANNEL', 取证成本: 'EVIDENCE', 办案成本: 'CASE_HANDLING', 人工成本: 'LABOR', 办公成本: 'OFFICE' };
      const categoryText = text(data.category);
      const category = (COST_CATEGORIES as readonly string[]).includes(categoryText) ? categoryText as CostCategory : labels[categoryText] ?? 'REIMBURSEMENT';
      let caseId = text(data.caseId) || null;
      if (text(data.caseNo)) {
        const linked = await tx.case.findUnique({ where: { caseNo: text(data.caseNo) } });
        if (!linked || (caseId && caseId !== linked.id)) throw new SyncIncomplete('案件编号不存在或与案件关联不一致');
        caseId = linked.id;
      }
      if (caseId && !await tx.case.findUnique({ where: { id: caseId } })) throw new SyncIncomplete('关联案件不存在');
      const channelId = text(data.channelId) || null;
      assertCostAnchorShape(category, channelId, caseId);
      const occurredAt = data.occurredAt ? new Date(String(data.occurredAt)) : instance.decidedAt ?? new Date();
      if (!Number.isFinite(occurredAt.getTime())) throw new SyncIncomplete('费用发生日期无效');
      const entry = await tx.costEntry.create({ data: { sourceApprovalId: instanceId, category, amount: rawAmount, occurredAt, caseId, channelId, createdBy: instance.applicantId, note: [instance.title, categoryText, text(data.reason)].filter(Boolean).join('；').slice(0, 500) } });
      targetId = entry.id;
      await new PrismaEventOutboxWriter().append(tx, { eventType: 'cost.created', eventVersion: 1, objectType: 'COST_ENTRY', objectId: entry.id, operatorUserId: actor.actorUserId, organizationId: null, branchId: null, teamId: null, payload: { costEntryId: entry.id, category, channelId, caseId }, traceId: actor.requestId ?? randomUUID(), occurredAt: new Date() });
    } else if (target === 'TRANSFER') {
      const user = await tx.user.findUnique({ where: { id: instance.applicantId } });
      const employeeId = user?.employeeId;
      const organizationId = text(data.organizationId), positionId = text(data.positionId);
      if (!employeeId || !organizationId || !positionId || !Number.isInteger(data.employeeVersion)) throw new SyncIncomplete('已进入调动台账；申请缺少关联员工、目标组织/岗位或员工版本，请补充完整资料重新申请');
      if (!context) throw new SyncIncomplete('请由有员工任职管理权限的管理员执行同步');
      const auth = new AuthorizationService(new DataScopeService(tx as PrismaClient));
      auth.requireAction(context, 'employee.assignment.manage');
      const employeeScope = await auth.buildEmployeeTargetWhere(context, 'employee_assignment', 'employee.assignment.manage');
      const orgScope = await auth.buildOrganizationTargetWhere(context, 'employee_assignment', 'employee.assignment.manage');
      await tx.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM position WHERE id = ${positionId} FOR SHARE`;
      const employee = await tx.employee.findFirst({ where: { AND: [employeeScope, { id: employeeId, deletedAt: null, status: { not: 'LEAVED' }, version: Number(data.employeeVersion) }] } });
      const position = await tx.position.findFirst({ where: { id: positionId, organizationId, status: 'ENABLED', organization: { AND: [orgScope, { status: 'ENABLED' }] } } });
      if (!employee || !position) throw new SyncIncomplete('员工资料已变化或目标岗位不可用/不在授权范围，请核实后重新申请');
      const primary = await tx.employeeAssignment.findMany({ where: { employeeId, assignmentType: 'PRIMARY', endedAt: null } });
      if (primary.length !== 1) throw new SyncIncomplete('员工主职记录异常，请先处理');
      const now = new Date();
      await tx.employeeAssignment.update({ where: { id: primary[0].id }, data: { endedAt: now, version: { increment: 1 } } });
      const assignment = await tx.employeeAssignment.create({ data: { employeeId, organizationId, positionId, assignmentType: 'PRIMARY', startedAt: now } });
      await tx.employee.update({ where: { id: employeeId }, data: { version: { increment: 1 } } });
      targetId = assignment.id;
    } else if (target === 'PAYROLL') {
      const batch = await tx.payrollBatch.findUnique({ where: { instanceId } });
      if (!batch) throw new SyncIncomplete('此审批未关联工资表，请从绩效管理的工资表发起审批');
      targetId = batch.id;
    } else {
      // The typed ledger itself is the management record. It retains the immutable
      // form/attachment references without changing a contract or marking a payment paid.
      targetId = instanceId;
    }
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT approval_business_sync');
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT approval_business_sync');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT approval_business_sync');
    status = target === 'UNCONFIGURED' ? 'PENDING_CONFIG' : 'FAILED';
    reason = error instanceof SyncIncomplete ? error.message : '业务关联或权限校验未通过，请核实原申请中的金额、分类、案件及岗位信息后重试';
  }
  const record = await tx.approvalSyncRecord.upsert({ where: { instanceId }, create: { instanceId, target, targetId, status, reason, attempts: 1 }, update: { target, targetId, status, reason, attempts: { increment: 1 } } });
  await tx.operationLog.create({ data: { userId: actor.actorUserId, action: 'APPROVAL_BUSINESS_SYNC', targetType: 'APPROVAL_INSTANCE', targetId: instanceId, newValues: JSON.stringify({ target, status, targetId }), ip: actor.ip } });
  return record;
}

export class ApprovalSyncService {
  private auth = new AuthorizationService();
  constructor(private prisma: PrismaClient, private actor: AuditActor, private context: AuthorizationContext) {}
  async list(target?: string, page = 1) {
    this.auth.requireAction(this.context, 'approval.read');
    if (!Number.isSafeInteger(page) || page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
    const manage = this.context.permissionCodes.includes('approval.manage');
    const where: Prisma.ApprovalInstanceWhereInput = { status: 'APPROVED', ...(manage ? {} : { OR: [{ applicantId: this.actor.actorUserId }, { tasks: { some: { assigneeId: this.actor.actorUserId } } }] }), ...(target ? { syncRecord: { target: normalizeAllowedValue(target, [...SYNC_TARGETS, 'UNCONFIGURED']) } } : {}) };
    const [total, rows] = await this.prisma.$transaction([this.prisma.approvalInstance.count({ where }), this.prisma.approvalInstance.findMany({ where, include: { syncRecord: true, definition: { select: { name: true } } }, orderBy: [{ decidedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 20, take: 20 })]);
    return { total, page, list: rows.map(row => ({ id: row.id, title: row.title, businessType: row.businessType, definitionName: row.definition.name, decidedAt: row.decidedAt, content: row.content, formSnapshot: row.formSnapshot, sync: row.syncRecord })) };
  }
  async retry(id: string) {
    this.auth.requireAction(this.context, 'approval.manage');
    const instanceId = normalizeRequiredText(id, 1, 100);
    return this.prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM approval_instance WHERE id = ${instanceId} FOR UPDATE`; return syncApproved(tx, instanceId, this.actor, this.context); });
  }
  async rules() {
    this.auth.requireAction(this.context, 'approval.manage');
    return this.prisma.approvalDefinition.findMany({ where: { businessType: 'CUSTOM' }, select: { id: true, name: true, code: true, syncRule: true }, orderBy: { createdAt: 'desc' } });
  }
  async setRule(id: string, target: string) {
    this.auth.requireAction(this.context, 'approval.manage');
    const normalized = normalizeAllowedValue(target, ['COST', 'LEAVE', 'SEAL', 'CONTRACT_CHANGE', 'CUSTOM']);
    const definition = await this.prisma.approvalDefinition.findFirst({ where: { id, businessType: 'CUSTOM' } });
    if (!definition) throw new MasterDataError('VALIDATION_FAILED', 400);
    return this.prisma.$transaction(async tx => {
      const rule = await tx.approvalSyncRule.upsert({ where: { definitionId: id }, create: { definitionId: id, target: normalized }, update: { target: normalized } });
      await tx.operationLog.create({ data: { userId: this.actor.actorUserId, action: 'APPROVAL_SYNC_CONFIGURE', targetType: 'APPROVAL_DEFINITION', targetId: id, newValues: JSON.stringify({ target: normalized }), ip: this.actor.ip } });
      return rule;
    });
  }
}
