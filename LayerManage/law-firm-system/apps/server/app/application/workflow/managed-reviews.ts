import { registrationScope, lockRegistration, guardRegistration, syncRegistration } from '../case/registration-policy';
import { deliveryModulesEnabled } from '../../domain/module-availability';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuditActor } from '../master-data/master-data-types';
import * as sop from '../sop/review-policy';
import * as analysis from '../quality/analysis-review-policy';
import { check } from '../../domain/workflow/schema';

type DB = PrismaClient | Prisma.TransactionClient;
export const isManagedReview = (type: string) => ['SOP_REVIEW', 'QUALITY_ANALYSIS', 'CASE_REGISTRATION'].includes(type);
export async function managedScope(
  db: DB,
  actor: AuthorizationContext,
): Promise<Prisma.WorkflowInstanceWhereInput> {
  return {
    AND: [await sop.sopApprovalScope(db, actor), await analysis.analysisApprovalScope(db, actor), await registrationScope(db, actor)],
  } as Prisma.WorkflowInstanceWhereInput;
}
export async function lockManagedReview(tx: Prisma.TransactionClient, id: string) {
  await lockRegistration(tx, id);
  await sop.lockSopApproval(tx, id, 'workflow');
  await analysis.lockAnalysisApproval(tx, id, 'workflow');
}
export async function guardManagedReview(
  db: DB,
  actor: AuthorizationContext,
  id: string,
  action: string,
  remark?: string,
) {
  const i = await db.workflowInstance.findUniqueOrThrow({ where: { id } });
  if (!isManagedReview(i.businessType)) return;
  if (i.businessType === 'CASE_REGISTRATION') return guardRegistration(db, actor, id, action);
  check(deliveryModulesEnabled || action === 'READ', '该业务模块已停用，审批仅供归档查阅', 409);
  if (['FORWARD', 'ADD', 'RETURN'].includes(action)) {
    await sop.guardSopApproval(db, actor, id, 'FORWARD', remark, 'workflow');
    await analysis.guardAnalysisApproval(db, actor, id, 'FORWARD', remark, 'workflow');
  }
  check(
    ['READ', 'APPROVE', 'REJECT', 'WITHDRAW'].includes(action),
    '业务审核不允许修改原申请，请通过原业务记录重新提交',
    409,
  );
  const operation = action as 'READ' | 'APPROVE' | 'REJECT' | 'WITHDRAW';
  await sop.guardSopApproval(db, actor, id, operation, remark, 'workflow');
  await analysis.guardAnalysisApproval(db, actor, id, operation, remark, 'workflow');
}
export async function syncManagedReview(tx: Prisma.TransactionClient, id: string, actor: AuditActor) {
  const i = await tx.workflowInstance.findUniqueOrThrow({ where: { id } });
  if (!isManagedReview(i.businessType) || i.status === 'PENDING') return;
  if (i.businessType === 'CASE_REGISTRATION') await syncRegistration(tx, id);
  else if (i.businessType === 'SOP_REVIEW') await sop.syncSopReview(tx, id, actor, 'workflow');
  else await analysis.syncAnalysisApproval(tx, id, actor, 'workflow');
  await tx.workflowInstance.update({ where: { id }, data: { syncStatus: 'SYNCED', syncError: null } });
}
