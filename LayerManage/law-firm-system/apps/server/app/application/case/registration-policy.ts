import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { notifyDeliveryChange } from '../collaboration/delivery-change';
import { requireCaseAccess } from './case-scope';
import { worksheetContext } from '../collaboration/worksheet-business-grants';
import { CollaborationService } from '../collaboration/collaboration-service';
import { WorkspaceDomainSource } from '../crm/workspace-domain-source';
import { AuditActor } from '../master-data/master-data-types';
import { check } from '../../domain/workflow/schema';

type DB = PrismaClient | Prisma.TransactionClient;
/** An editor is not an approver. Use the existing case-management role, never an account name. */
export async function isCaseRegistrar(db: DB, actor: AuthorizationContext) {
  if (!actor.permissionCodes.includes('approval.process')) return false;
  if (actor.isSystemSuperAdmin) return true;
  const now = new Date();
  return !!await db.userRole.findFirst({ where: {
    userId: actor.userId, revokedAt: null, validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    role: { code: 'MANAGER', status: 'ENABLED' },
  } });
}
export async function assertRegistrationEditable(tx: DB, caseId: string) {
  check(!await tx.caseRegistration.count({ where: { caseId, status: 'PENDING' } }),
    '案件登记正在审批，请先撤回或由案件管理员退回后再修改。', 409);
}
export async function registrationScope(db: DB, actor: AuthorizationContext): Promise<Prisma.WorkflowInstanceWhereInput> {
  if (actor.isSystemSuperAdmin) return {};
  const reviewer = await isCaseRegistrar(db, actor);
  return { OR: [
    { businessType: { not: 'CASE_REGISTRATION' } },
    { caseRegistration: { submittedBy: actor.userId } },
    ...(reviewer ? [{ caseRegistration: { reviewerId: actor.userId } }] : []),
  ] };
}
export async function lockRegistration(tx: Prisma.TransactionClient, id: string) {
  const request = await tx.caseRegistration.findUnique({ where: { workflowInstanceId: id } });
  if (request) await tx.$queryRaw`SELECT id FROM "case" WHERE id=${request.caseId} FOR UPDATE`;
}
export async function guardRegistration(db: DB, actor: AuthorizationContext, id: string, action: string) {
  const request = await db.caseRegistration.findUnique({ where: { workflowInstanceId: id }, include: { case: true } });
  check(request, '案件登记申请不存在', 404);
  const fresh = await new AuthorizationContextLoader(db).load(actor.userId);
  check(fresh.permissionCodes.includes('approval.read'), '没有查看审批的权限', 403);
  let reviewer = request.reviewerId === actor.userId && await isCaseRegistrar(db, fresh);
  if (reviewer) {
    const scoped = await worksheetContext(db, fresh, request.tableId);
    // The submitter cannot use assignment to bypass the reviewer's existing case/table scope.
    try {
      await requireCaseAccess(db as PrismaClient, scoped, request.caseId, 'case.read', db, { includeWorksheetLead: true });
      const table = await new CollaborationService(db as PrismaClient, scoped).tableAccess(request.tableId, db);
      check(table.table.source === 'CASES', '案件表不可用', 403);
      await new WorkspaceDomainSource(db as PrismaClient, scoped).target('CASES', table.access, request.caseId, db, 'read');
    } catch (error) {
      if (![403, 404].includes((error as { status?: number }).status ?? 0)) throw error;
      reviewer = false;
    }
  }
  check(fresh.isSystemSuperAdmin || request.submittedBy === actor.userId || reviewer,
    '无权查看此案件登记申请', 403);
  if (action === 'READ') return;
  check(['APPROVE', 'REJECT', 'WITHDRAW'].includes(action), '请在案件管理表中修改并重新提交登记信息', 409);
  check(request.status === 'PENDING' && !request.case.deletedAt, '案件登记状态已变化，请刷新', 409);
  if (action === 'WITHDRAW') check(request.submittedBy === actor.userId && fresh.permissionCodes.includes('approval.apply'), '只能撤回本人提交的登记', 403);
  else {
    check(reviewer && request.submittedBy !== actor.userId, '仅指定案件管理员可审批，且不能审批本人申请', 403);
    if (action === 'APPROVE') {
      const extension = await db.collabExtension.findUnique({ where: { tableId_recordId: { tableId: request.tableId, recordId: request.caseId } } });
      check(request.case.status === 'PENDING' && request.case.version === request.caseVersion &&
        request.recordVersion === request.case.version + (extension?.version ?? 0), '案件内容或状态已变化，请退回后重新提交', 409);
    }
  }
}
export async function syncRegistration(tx: Prisma.TransactionClient, id: string, actor: AuditActor) {
  const request = await tx.caseRegistration.findUniqueOrThrow({ where: { workflowInstanceId: id }, include: { workflow: true } });
  const status = request.workflow!.status;
  if (status === 'PENDING' || request.status !== 'PENDING') return;
  if (status === 'APPROVED') {
    // Workflow approval and acceptance commit atomically; a retry must never accept twice.
    const changed = await tx.case.updateMany({ where: { id: request.caseId, deletedAt: null, status: 'PENDING', version: request.caseVersion },
      data: { status: 'ACCEPTED', version: { increment: 1 }, updatedBy: actor.actorUserId } });
    check(changed.count === 1, '案件内容或状态已变化，请刷新', 409);
    await tx.operationLog.create({ data: { userId: actor.actorUserId, action: 'CASE_STATUS', targetType: 'CASE', targetId: request.caseId,
      oldValues: JSON.stringify({ status: 'PENDING', version: request.caseVersion }),
      newValues: JSON.stringify({ status: 'ACCEPTED', version: request.caseVersion + 1, workflowInstanceId: id }), ip: actor.ip } });
  }
  await tx.caseRegistration.update({ where: { id: request.id }, data: { status } });
  await notifyDeliveryChange(tx, request.submittedBy, request.caseId);
}

export async function assertRegistrationApproved(tx: DB, caseId: string, version: number) {
  const approved = await tx.caseRegistration.findFirst({ where: { caseId, status: 'APPROVED', caseVersion: version }, orderBy: { createdAt: 'desc' } });
  check(approved, '请先提交案件登记并由案件管理员审批', 409);
  const extension = await tx.collabExtension.findUnique({ where: { tableId_recordId: { tableId: approved.tableId, recordId: caseId } } });
  check(approved.recordVersion === version + (extension?.version ?? 0), '审批后登记信息已修改，请重新提交登记审批', 409);
}
