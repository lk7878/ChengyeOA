import type { Prisma } from '@prisma/client';
import { check } from '../../domain/workflow/schema';

// Read the director recorded when the settlements were submitted, even if policy has since changed.
export async function checkSettlementApprovals(tx: Prisma.TransactionClient, id: string, workflow: boolean) {
  const batch = await tx.payrollBatch.findFirst({
    where: workflow ? { workflowInstanceId: id } : { instanceId: id },
    select: { id: true },
  });
  if (!batch) return;
  const rows = await tx.caseSettlement.findMany({
    where: { payrollId: batch.id },
    select: { snapshot: true },
  });
  const directors = new Set(rows.map((r) => (r.snapshot as { directorId: string }).directorId));
  if (!directors.size) return;
  const signed = workflow
    ? (
        await tx.workflowTask.findMany({
          where: { instanceId: id, status: 'APPROVED' },
          select: { assigneeId: true },
        })
      ).map((t) => t.assigneeId)
    : (
        await tx.approvalTask.findMany({
          where: { instanceId: id, status: 'APPROVED' },
          select: { processedBy: true },
        })
      ).map((t) => t.processedBy);
  check(
    [...directors].every((d) => d && signed.includes(d)),
    '此工资表含案件绩效，须由结算规则指定的主任完成审核',
    409,
  );
}
