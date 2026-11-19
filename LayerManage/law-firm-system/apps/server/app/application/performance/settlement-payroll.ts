import { createHash } from 'node:crypto';
import { validateApprovalFile } from '../../domain/approval/approval-file-validation';
import ExcelJS from 'exceljs';
import { check } from '../../domain/workflow/schema';
import { object, text } from '../collaboration/collaboration-policy';
import { AuthorizationService } from '../authorization/authorization-service';
import { D } from './settlement-calculation';
import { SettlementService, payLog } from './settlement-service';

export async function bindEarnings(service: SettlementService, batchId: string, raw: unknown) {
  const b = object(raw),
    auth = new AuthorizationService();
  auth.requireAction(service.actor, 'performance.update');
  auth.requireAction(service.actor, 'performance.read');
  auth.requireAction(service.actor, 'approval.apply');
  check(Array.isArray(b.ids) && b.ids.length > 0 && b.ids.length <= 1000, '请选择要入薪的结算单');
  const ids = [...new Set(b.ids.map((id) => text(id)))].sort();
  return service.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM payroll_batch WHERE id=${batchId} FOR UPDATE`;
      const batch = await tx.payrollBatch.findFirst({
        where: { id: batchId, ownerUserId: service.actor.userId },
        include: { attachment: true },
      });
      check(batch && !batch.instanceId && !batch.workflowInstanceId, '工资草稿不可用', 409);
      const access = await service.rights(tx);
      for (const id of ids) await tx.$queryRaw`SELECT id FROM case_settlement WHERE id=${id} FOR UPDATE`;
      const rows = await tx.caseSettlement.findMany({
        where: { id: { in: ids }, policyId: { in: access.finance }, period: batch.period },
        include: { lines: true },
      });
      check(rows.length === ids.length, '无权限或所属月份不同', 403);
      if (rows.every((row) => row.payrollId === batchId)) return batch.id;
      check(batch.version === b.version, '工资表已更新，请刷新', 409);
      check(
        !(await tx.caseSettlement.count({ where: { payrollId: batchId } })),
        '此工资表已导入，请在导入前一次选齐全部结算单',
        409,
      );
      const totals = new Map<string, InstanceType<typeof D>>();
      for (const row of rows) {
        check(row.status === 'CONFIRMED' || row.status === 'IN_PAYROLL', '仅已确认记录可入薪');
        if (row.payrollId) {
          const old = await tx.payrollBatch.findUnique({
            where: { id: row.payrollId },
            include: { workflow: true, instance: true },
          });
          check(
            ['REJECTED', 'WITHDRAWN'].includes((old?.workflow ?? old?.instance)?.status ?? ''),
            '记录已经计入其他工资批次',
            409,
          );
        }
        for (const line of row.lines)
          totals.set(line.employeeNo, (totals.get(line.employeeNo) ?? new D(0)).add(line.amount));
      }
      const people = await tx.employee.findMany({
        where: { employeeNo: { in: [...totals.keys()] } },
        select: { id: true, employeeNo: true },
      });
      for (const row of rows)
        for (const line of row.lines) {
          const matches = people.filter((p) => p.employeeNo === line.employeeNo);
          check(
            matches.length === 1 && matches[0].id === line.employeeId,
            '员工编号已变更或被复用，请财务核对：' + line.employeeNo,
          );
        }
      validateApprovalFile(batch.attachment.fileName, batch.attachment.bytes);
      const book = new ExcelJS.Workbook();
      try {
        await book.xlsx.load(Uint8Array.from(batch.attachment.bytes).buffer);
      } catch {
        check(false, '工资附件无法读取，请先上传有效的 XLSX 工资草稿');
      }
      const sheets = book.worksheets
        .map((sheet) => {
          const heads = new Map<string, number[]>();
          sheet.getRow(1).eachCell((cell, i) => {
            const label = cell.text.trim();
            heads.set(label, [...(heads.get(label) ?? []), i]);
          });
          return { sheet, no: heads.get('员工编号'), pay: heads.get('案件绩效') };
        })
        .filter((s) => s.no && s.pay);
      check(
        sheets.length === 1 && sheets[0].no?.length === 1 && sheets[0].pay?.length === 1,
        '工资表须有且仅有一张工作表首行包含“员工编号”和“案件绩效”两列',
      );
      const { sheet, no, pay } = sheets[0],
        seen = new Set<string>();
      sheet.eachRow((row, i) => {
        if (i === 1) return;
        const employeeNo = row.getCell(no[0]).text.trim(),
          total = totals.get(employeeNo);
        if (!total) return;
        const cell = row.getCell(pay[0]);
        check(!seen.has(employeeNo), '工资表有重复员工编号：' + employeeNo);
        check(
          cell.value == null || cell.value === 0 || cell.value === '',
          '工资表已有案件绩效，请核对后使用空白绩效列',
        );
        check(total.abs().lt('10000000000000'), '金额超过电子表格精度');
        cell.value = total.toNumber();
        cell.numFmt = '0.00';
        seen.add(employeeNo);
      });
      check(seen.size === totals.size, '工资表缺少分配明细中的员工编号');
      book.calcProperties.fullCalcOnLoad = true;
      const bytes = Buffer.from(await book.xlsx.writeBuffer());
      validateApprovalFile(batch.attachment.fileName, bytes);
      const attachment = await tx.approvalAttachment.create({
        data: {
          ownerUserId: service.actor.userId,
          sourceId: batch.attachmentId,
          fileName: batch.attachment.fileName,
          mimeType: batch.attachment.mimeType,
          fileSize: bytes.length,
          bytes,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      });
      await tx.payrollBatch.update({
        where: { id: batchId },
        data: { attachmentId: attachment.id, version: { increment: 1 } },
      });
      await tx.caseSettlement.updateMany({
        where: { id: { in: ids } },
        data: { status: 'IN_PAYROLL', payrollId: batchId, version: { increment: 1 } },
      });
      await payLog(tx, service.actor, batchId, 'CASE_PAY_PAYROLL', {
        ids,
        attachmentId: attachment.id,
        sourceAttachmentId: batch.attachmentId,
      });
      return batch.id;
    },
    { timeout: 30000 },
  );
}
export async function markPaid(service: SettlementService, id: string) {
  return service.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM case_settlement WHERE id=${id} FOR UPDATE`;
    const r = await service.rights(tx);
    const row = await tx.caseSettlement.findFirst({ where: { id, policyId: { in: r.finance } } });
    check(row && row.payrollId, '未找到可登记的记录', 404);
    if (row.status === 'PAID') return;
    const batch = await tx.payrollBatch.findUnique({
      where: { id: row.payrollId },
      include: { workflow: true, instance: true },
    });
    check((batch?.workflow ?? batch?.instance)?.status === 'APPROVED', '请先完成工资审批', 409);
    const directorId = text(object(row.snapshot).directorId);
    const approved = batch.workflowInstanceId
      ? await tx.workflowTask.count({
          where: { instanceId: batch.workflowInstanceId, assigneeId: directorId, status: 'APPROVED' },
        })
      : await tx.approvalTask.count({
          where: { instanceId: batch.instanceId, processedBy: directorId, status: 'APPROVED' },
        });
    check(approved, '该批次缺少结算规则指定主任的审批记录', 409);
    await tx.caseSettlement.update({ where: { id }, data: { status: 'PAID', version: { increment: 1 } } });
    await payLog(tx, service.actor, id, 'CASE_PAY_PAID', { batchId: batch.id, directorId });
  });
}

// Undo a whole import to preserve other wage components and the exact original workbook.
export async function releaseEarnings(service: SettlementService, batchId: string, raw: unknown) {
  const version = object(raw).version;
  const auth = new AuthorizationService();
  for (const key of ['performance.read', 'performance.update', 'approval.apply'] as const)
    auth.requireAction(service.actor, key);
  return service.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payroll_batch WHERE id=${batchId} FOR UPDATE`;
    const batch = await tx.payrollBatch.findFirst({
      where: { id: batchId, ownerUserId: service.actor.userId },
      include: { attachment: true, instance: true, workflow: true },
    });
    check(batch && batch.version === version, '工资批次不可用或已更新', 409);
    const state = (batch.workflow ?? batch.instance)?.status ?? 'DRAFT';
    check(['DRAFT', 'WITHDRAWN', 'REJECTED'].includes(state), '审批中或已通过的工资表不可撤销入薪', 409);
    const rights = await service.rights(tx);
    const rows = await tx.caseSettlement.findMany({
      where: { payrollId: batchId },
      select: { id: true, policyId: true, status: true },
    });
    check(
      rows.length && rows.every((r) => r.status === 'IN_PAYROLL' && rights.finance.includes(r.policyId)),
      '须具有该批次全部结算单的财务授权',
      403,
    );
    if (state === 'DRAFT') {
      check(batch.attachment.sourceId, '缺少导入前的工资草稿', 409);
      await tx.payrollBatch.update({
        where: { id: batchId },
        data: { attachmentId: batch.attachment.sourceId, version: { increment: 1 } },
      });
    }
    const released = await tx.caseSettlement.updateMany({
      where: { payrollId: batchId, status: 'IN_PAYROLL' },
      data: { payrollId: null, status: 'CONFIRMED', version: { increment: 1 } },
    });
    check(rows.length === released.count, '其他财务操作已更新结算单，请刷新重试', 409);
    await payLog(tx, service.actor, batchId, 'CASE_PAY_RELEASE', {
      ids: rows.map((r) => r.id),
      attachmentId: batch.attachmentId,
    });
  });
}
