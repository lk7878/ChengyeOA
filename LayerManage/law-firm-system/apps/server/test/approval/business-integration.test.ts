import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import { ApprovalSyncService } from '../../app/application/approval/approval-sync-service';
import { ApprovalAttachmentService } from '../../app/application/approval/approval-attachment-service';
import { PayrollService } from '../../app/application/performance/payroll-service';
import { InvoiceService } from '../../app/application/finance/invoice-service';
import { RefundService } from '../../app/application/finance/refund-service';
import { ReceivableService } from '../../app/application/contract/receivable-service';
import { CaseService } from '../../app/application/case/case-service';

let db: PrismaClient, a: string, b: string, c: string;
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  [a, b, c] = await Promise.all(
    ['a', 'b', 'c'].map(
      async (label) =>
        (await db.user.create({ data: { username: label + randomUUID(), password: 'test-only' } })).id,
    ),
  );
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
function context(id: string, manage = true): AuthorizationContext {
  const codes = PERMISSION_CATALOG.filter((p) => manage || p.code !== 'approval.manage');
  return {
    userId: id,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: manage,
    fieldRules: [],
    evaluatedAt: new Date(),
    permissionCodes: codes.map((p) => p.code),
    grants: codes.map((p) => ({
      sourceType: 'SYSTEM_SUPER_ADMIN',
      sourceId: 'test',
      resource: p.resource,
      permissionCode: p.code,
      scopeIds: ['ALL'],
      validUntil: null,
    })),
  };
}
function services(id: string, manage = true) {
  const actor = { actorUserId: id },
    auth = context(id, manage);
  return {
    approval: new ApprovalInstanceService(db, actor, auth),
    sync: new ApprovalSyncService(db, actor, auth),
    payroll: new PayrollService(db, actor, auth),
    files: new ApprovalAttachmentService(db, actor, auth),
  };
}
async function definition(type = 'EXPENSE', multi = false) {
  return db.approvalDefinition.create({
    data: {
      code: randomUUID(),
      name: '测试审批',
      businessType: type,
      formSchema: { fields: [] },
      approverRule: { type: 'USER', userIds: [b] },
      ...(multi
        ? {
            nodeSchema: [
              { name: '一级', approverRule: { type: 'USER', userIds: [b] } },
              { name: '二级', approverRule: { type: 'USER', userIds: [c] } },
            ],
          }
        : {}),
      createdBy: a,
    },
  });
}
async function approve(type: string, content: Record<string, unknown>) {
  const d = await definition(type);
  const row = await services(a).approval.applyForApproval({
    definitionCode: d.code,
    title: '测试申请',
    content,
  });
  await services(b).approval.processTask(row.tasks[0].id, { action: 'APPROVE' });
  return { row, d };
}
test('final expense approval creates one exact cost and concurrent retries never duplicate it', async () => {
  const { row } = await approve('EXPENSE', { amount: '123.45', category: '差旅报销', reason: '高铁票' });
  const cost = await db.costEntry.findUniqueOrThrow({ where: { sourceApprovalId: row.id } });
  assert.equal(cost.amount.toFixed(2), '123.45');
  assert.equal(cost.category, 'REIMBURSEMENT');
  assert.match(cost.note!, /差旅报销/);
  await Promise.all([services(b).sync.retry(row.id), services(b).sync.retry(row.id)]);
  assert.equal(await db.costEntry.count(), 1);
  assert.equal(await db.eventLog.count({ where: { eventType: 'cost.created' } }), 1);
});
test('intermediate approval, rejection and withdrawal produce no approved business records', async () => {
  const d = await definition('EXPENSE', true);
  const row = await services(a).approval.applyForApproval({
    definitionCode: d.code,
    title: '多级审批',
    content: { amount: 100 },
  });
  const first = await services(b).approval.processTask(row.tasks[0].id, { action: 'APPROVE' });
  assert.equal(first.status, 'PENDING');
  assert.equal(await db.costEntry.count(), 0);
  await services(c).approval.processTask(first.tasks.find((t) => t.status === 'PENDING')!.id, {
    action: 'REJECT',
  });
  assert.equal(await db.approvalSyncRecord.count(), 0);
  const other = await services(a).approval.applyForApproval({
    definitionCode: d.code,
    title: '撤回',
    content: { amount: 10 },
  });
  await services(a).approval.withdrawInstance(other.id, {});
  assert.equal(await db.costEntry.count(), 0);
});
test('failed business validation preserves the approval decision and records a visible reason', async () => {
  const { row } = await approve('EXPENSE', { amount: '1.001', category: '差旅' });
  assert.equal((await db.approvalInstance.findUniqueOrThrow({ where: { id: row.id } })).status, 'APPROVED');
  const sync = await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } });
  assert.equal(sync.status, 'FAILED');
  assert.match(sync.reason!, /金额/);
  assert.equal(await db.costEntry.count(), 0);
  assert.equal((await services(a, false).sync.list()).total, 1);
  assert.equal((await services(c, false).sync.list()).total, 0);
  await assert.rejects(services(a, false).sync.retry(row.id));
});
test('custom mapping retries idempotently; leave/seal/contract ledgers preserve original records', async () => {
  const { row, d } = await approve('CUSTOM', { amount: 20, category: '加班餐费' });
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } })).status,
    'PENDING_CONFIG',
  );
  await services(b).sync.setRule(d.id, 'COST');
  await services(b).sync.retry(row.id);
  assert.equal(await db.costEntry.count(), 1);
  await services(b).sync.setRule(d.id, 'CUSTOM');
  await services(b).sync.retry(row.id);
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } })).target,
    'COST',
  );
  for (const type of ['LEAVE', 'SEAL', 'CONTRACT_CHANGE']) {
    const { row } = await approve(type, { reason: '原申请' });
    assert.equal(
      (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } })).status,
      'SYNCED',
    );
  }
  const transfer = await approve('TRANSFER', { targetTeam: '律师部', reason: '调动' });
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: transfer.row.id } })).status,
    'FAILED',
  );
});
test('payroll draft ownership, version checks, submission freezing and final status share one approval', async () => {
  const file = await db.approvalAttachment.create({
    data: {
      ownerUserId: a,
      fileName: '工资.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: Buffer.from('persisted-test-fixture'),
      fileSize: 22,
      sha256: 'test-only',
    },
  });
  const batch = await services(a).payroll.save({
    title: '九月工资',
    period: '2026-09',
    attachmentId: file.id,
  });
  assert.equal((await services(c).payroll.list()).total, 0);
  await assert.rejects(services(c).payroll.save({ title: '越权', period: '2026-09', attachmentId: file.id }));
  await assert.rejects(
    services(a).payroll.save(
      { title: '旧版本', period: '2026-09', attachmentId: file.id, version: 99 },
      batch.id,
    ),
    { code: 'VERSION_CONFLICT' },
  );
  await assert.rejects(services(c, false).files.download(file.id), { code: 'APPROVAL_FILE_NOT_FOUND' });
  const expense = await definition();
  await assert.rejects(
    services(a).approval.applyForApproval({
      definitionCode: expense.code,
      title: '不得从普通申请占用工资草稿',
      content: {},
      attachmentIds: [file.id],
    }),
    { code: 'APPROVAL_FILE_BIND_INVALID' },
  );
  const def = await definition('PAYROLL');
  const input = {
    definitionCode: def.code,
    title: batch.title,
    content: { period: batch.period },
    attachmentIds: [file.id],
    payrollBatchId: batch.id,
    payrollVersion: batch.version,
    idempotencyKey: randomUUID(),
  };
  await assert.rejects(services(a).approval.applyForApproval({ ...input, content: { period: '2030-01' } }), {
    code: 'APPROVAL_FILE_FROZEN',
  });
  const submitted = await services(a).approval.applyForApproval(input);
  assert.equal((await services(a).approval.applyForApproval(input)).id, submitted.id);
  await assert.rejects(
    services(a).payroll.save(
      { title: '篡改', period: '2026-09', attachmentId: file.id, version: batch.version + 1 },
      batch.id,
    ),
    { code: 'APPROVAL_FILE_FROZEN' },
  );
  assert.equal((await services(b, false).files.download(file.id)).fileName, '工资.xlsx');
  await assert.rejects(services(c, false).files.download(file.id), { code: 'APPROVAL_FILE_NOT_FOUND' });
  await services(b).approval.processTask(submitted.tasks[0].id, { action: 'APPROVE' });
  assert.equal((await services(a).payroll.list()).list[0].instance?.status, 'APPROVED');
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: submitted.id } })).targetId,
    batch.id,
  );
  assert.equal(await db.payment.count(), 0);
});

test('complete transfer approvals update primary assignment once and keep its history', async () => {
  const orgId = randomUUID();
  const org = await db.organization.create({
    data: { id: orgId, code: 'ROOT', name: '测试总所', type: 'FIRM', path: '/' + orgId },
  });
  const oldPosition = await db.position.create({
    data: { code: 'OLD', name: '原岗位', categoryCode: 'LEGAL', organizationId: org.id },
  });
  const newPosition = await db.position.create({
    data: { code: 'NEW', name: '新岗位', categoryCode: 'LEGAL', organizationId: org.id },
  });
  const employee = await db.employee.create({
    data: {
      employeeNo: 'TRANSFER001',
      name: '测试员工',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01'),
    },
  });
  await db.user.update({ where: { id: a }, data: { employeeId: employee.id } });
  const old = await db.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: org.id,
      positionId: oldPosition.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2026-01-01'),
    },
  });
  const { row } = await approve('TRANSFER', {
    organizationId: org.id,
    positionId: newPosition.id,
    employeeVersion: employee.version,
  });
  const sync = await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } });
  assert.equal(sync.status, 'SYNCED', sync.reason ?? '');
  assert.ok((await db.employeeAssignment.findUniqueOrThrow({ where: { id: old.id } })).endedAt);
  assert.equal(
    (await db.employeeAssignment.findFirstOrThrow({ where: { employeeId: employee.id, endedAt: null } }))
      .positionId,
    newPosition.id,
  );
  await services(b).sync.retry(row.id);
  assert.equal(await db.employeeAssignment.count({ where: { employeeId: employee.id } }), 2);
});
test('finance queries join by unique case number and existing contract records link after case binding', async () => {
  const actor = { actorUserId: a },
    ctx = context(a);
  const customer = await db.customer.create({
    data: {
      customerNo: randomUUID(),
      name: '客户',
      phone: '13800000001',
      phoneHash: randomUUID(),
      createdBy: a,
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNo: randomUUID(),
      contractType: 'FIRST_SIGN',
      title: '合同',
      customerId: customer.id,
      createdBy: a,
      status: 'SIGNED',
      amount: 1000,
    },
  });
  await db.payment.create({
    data: {
      paymentNo: randomUUID(),
      contractId: contract.id,
      customerId: customer.id,
      amount: 100,
      status: 'CONFIRMED',
      method: 'BANK_TRANSFER',
      paidAt: new Date(),
      createdBy: a,
    },
  });
  await db.invoiceRequest.create({
    data: {
      requestNo: randomUUID(),
      contractId: contract.id,
      customerId: customer.id,
      amount: 100,
      createdBy: a,
    },
  });
  await db.refundRequest.create({
    data: {
      requestNo: randomUUID(),
      contractId: contract.id,
      customerId: customer.id,
      amount: 100,
      type: 'REFUND',
      reason: '退费',
      createdBy: a,
    },
  });
  const payments = new ReceivableService(db, actor, ctx),
    invoices = new InvoiceService(db, actor, ctx),
    refunds = new RefundService(db, actor, ctx);
  assert.equal((await payments.listPayments({})).list[0].linkedCase, null);
  const cases = new CaseService(db, actor, ctx);
  const lawyer = await db.employee.create({
    data: {
      employeeNo: randomUUID(),
      name: '律师',
      phone: '13800000002',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date(),
    },
  });
  const row = await cases.createCase({
    title: '案件',
    customerId: customer.id,
    lawyerId: lawyer.id,
    caseType: '民事',
  });
  await cases.bindFinanceContract(row.id, { contractId: contract.id, version: row.version });
  for (const list of [
    await payments.listPayments({ caseNo: row.caseNo }),
    await invoices.listInvoices({ caseNo: row.caseNo }),
    await refunds.listRefundRequests({ caseNo: row.caseNo }),
  ]) {
    assert.equal(list.total, 1);
    assert.equal(list.list[0].linkedCase?.id, row.id);
  }
  assert.equal((await invoices.listInvoices({ caseNo: row.caseNo.slice(1) })).total, 0);
  await assert.rejects(
    invoices.createInvoice({ contractId: contract.id, caseNo: 'INVALID-CASE', amount: '10' }),
    { code: 'FINANCE_CASE_MISMATCH' },
  );
  const added = await invoices.createInvoice({ contractId: contract.id, caseNo: row.caseNo, amount: '10' });
  assert.equal(added.contractId, contract.id);
  const other = await cases.createCase({
    title: '其他案件',
    customerId: customer.id,
    lawyerId: lawyer.id,
    caseType: '民事',
  });
  await assert.rejects(
    cases.bindFinanceContract(other.id, { contractId: contract.id, version: other.version }),
    { code: 'MASTER_DATA_IN_USE' },
  );
});

test('channel cost approval retains its decision when sync lacks read scope and authorized retry writes once', async () => {
  const channel = await db.channel.create({ data: { code: randomUUID(), name: '审批渠道', type: 'OTHER' } });
  const d = await definition('EXPENSE');
  const row = await services(a).approval.applyForApproval({
    definitionCode: d.code,
    title: '渠道费用',
    content: { category: 'CHANNEL', amount: '12.34', channelId: channel.id },
  });
  const auth = context(b);
  auth.permissionCodes = auth.permissionCodes.filter((p) => p !== 'channel.read');
  await new ApprovalInstanceService(db, { actorUserId: b }, auth).processTask(row.tasks[0].id, {
    action: 'APPROVE',
  });
  assert.equal((await db.approvalInstance.findUniqueOrThrow({ where: { id: row.id } })).status, 'APPROVED');
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: row.id } })).status,
    'FAILED',
  );
  assert.equal(await db.costEntry.count(), 0);
  await services(b).sync.retry(row.id);
  await services(b).sync.retry(row.id);
  assert.equal(await db.costEntry.count(), 1);
  assert.equal((await db.costEntry.findFirstOrThrow()).createdBy, a);
});
