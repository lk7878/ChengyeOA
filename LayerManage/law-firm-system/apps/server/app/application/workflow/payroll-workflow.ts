import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { check, WorkflowSchema } from '../../domain/workflow/schema';

export async function preparePayroll(
  tx: Prisma.TransactionClient,
  actor: AuthorizationContext,
  id: string,
  version: number | undefined,
  schema: WorkflowSchema,
) {
  new AuthorizationService().requireAction(actor, 'performance.update');
  new AuthorizationService().requireAction(actor, 'performance.read');
  await tx.$queryRaw`SELECT id FROM payroll_batch WHERE id=${id} FOR UPDATE`;
  const row = await tx.payrollBatch.findFirst({
    where: { id, ownerUserId: actor.userId },
    include: { attachment: true },
  });
  check(row, '工资表不存在或不可访问', 404);
  check(
    !row.instanceId && !row.workflowInstanceId && row.version === version,
    '工资表已提交或已修改，请刷新后重试',
    409,
  );
  check(
    createHash('sha256').update(row.attachment.bytes).digest('hex') === row.attachment.sha256,
    '工资表材料发生变化，请重新上传',
    409,
  );
  check(
    !schema.settings?.allowCorrection,
    '工资审批流程请关闭更正申请；如需更正，请复制工资表草稿后重新提交',
  );
  check(
    schema.nodes
      .filter((n) => n.type === 'APPROVAL')
      .every(
        (n) =>
          (!n.approvalType || n.approvalType === 'MANUAL') &&
          n.timeoutAction !== 'APPROVE' &&
          !n.skipRepeated,
      ),
    '工资审批必须人工处理，不能自动通过或跳过审核',
  );
  return row;
}

export async function attachPayroll(
  tx: Prisma.TransactionClient,
  row: Awaited<ReturnType<typeof preparePayroll>>,
  schema: WorkflowSchema,
) {
  const keys = ['oaPayrollPeriod', 'oaPayrollFile'];
  check(!schema.fields.some((f) => keys.includes(f.key)), '流程字段与工资表系统字段冲突');
  const file = await tx.workflowFile.create({
    data: {
      ownerId: row.ownerUserId,
      name: row.attachment.fileName,
      mime: row.attachment.mimeType,
      bytes: row.attachment.bytes,
    },
  });
  schema.fields.push(
    { key: keys[0], label: '工资月份（提交快照）', type: 'text' },
    { key: keys[1], label: '工资表（提交快照）', type: 'file' },
  );
  for (const node of schema.nodes) {
    node.fields = { ...node.fields, oaPayrollPeriod: 'READ', oaPayrollFile: 'READ' };
    for (const permissions of Object.values(node.roleFields ?? {})) {
      permissions.oaPayrollPeriod = 'READ';
      permissions.oaPayrollFile = 'READ';
    }
  }
  schema.settings = { ...schema.settings, allowCorrection: false };
  return { oaPayrollPeriod: row.period, oaPayrollFile: [file.id] };
}
