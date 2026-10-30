import { Prisma, PrismaClient } from '@prisma/client';

// Business review policies are shared with historical records. New submissions
// always use workflow; the legacy branch only preserves historical compatibility.
export type ReviewEngine = 'legacy' | 'workflow';
type DB = PrismaClient | Prisma.TransactionClient;
export const reviewReference = (id: string, engine: ReviewEngine) =>
  engine === 'workflow' ? { workflowInstanceId: id } : { approvalInstanceId: id };
export const reviewApproval = (db: DB, id: string, engine: ReviewEngine) =>
  engine === 'workflow'
    ? db.workflowInstance.findUniqueOrThrow({ where: { id } })
    : db.approvalInstance.findUniqueOrThrow({ where: { id } });
export const reviewVisible = (
  db: DB,
  id: string,
  scope: Prisma.ApprovalInstanceWhereInput,
  engine: ReviewEngine,
) =>
  engine === 'workflow'
    ? db.workflowInstance.count({ where: { AND: [{ id }, scope as Prisma.WorkflowInstanceWhereInput] } })
    : db.approvalInstance.count({ where: { AND: [{ id }, scope] } });
