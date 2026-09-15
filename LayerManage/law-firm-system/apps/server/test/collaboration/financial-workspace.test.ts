import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ReceivableService } from '../../app/application/contract/receivable-service';
import { InvoiceService } from '../../app/application/finance/invoice-service';
import { RefundService } from '../../app/application/finance/refund-service';
import { CostService } from '../../app/application/finance/cost-service';
import { domainSources, DomainSource } from '../../app/application/crm/workspace-domain-source';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, owner: CollaborationService, staff: CollaborationService;
let org: string, outside: string, base: string;
const rejects = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
const context = (userId: string, employeeId: string): AuthorizationContext => {
  const permissionCodes: AuthorizationContext['permissionCodes'] = [
    'case.read',
    'payment.read',
    'payment.create',
    'payment.confirm',
    'payment.void',
    'invoice.read',
    'invoice.create',
    'invoice.approve',
    'invoice.complete',
    'refund.read',
    'refund.create',
    'refund.approve',
    'refund.execute',
    'cost.read',
    'cost.create',
    'cost.update',
    'cost.delete',
    'customer.read',
    'customer.update',
    'negotiation.read',
    'negotiation.update',
    'contract.read',
    'contract.submit',
  ];
  return {
    userId,
    employeeId,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes,
    fieldRules: [],
    grants: permissionCodes.map((permissionCode) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      sourceRoleId: 'fixture',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
  };
};
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  outside = key();
  for (const id of [org, outside])
    await db.organization.create({
      data: { id, code: id, name: '同源测试组织', type: 'FIRM', path: '/' + id },
    });
  const position = await db.position.create({
    data: { organizationId: org, code: key(), name: '业务岗位', categoryCode: 'SALES' },
  });
  const actor = async () => {
    const employee = await db.employee.create({
      data: {
        name: '测试人员',
        employeeNo: key(),
        phone: '13800001234',
        type: 'SALES',
        status: 'FORMAL',
        entryDate: new Date('2025-01-01'),
      },
    });
    const user = await db.user.create({
      data: { username: key(), password: 'fixture-only', employeeId: employee.id },
    });
    await db.employeeAssignment.create({
      data: {
        organizationId: org,
        positionId: position.id,
        employeeId: employee.id,
        assignmentType: 'PRIMARY',
        startedAt: new Date('2025-01-01'),
      },
    });
    return new CollaborationService(db, context(user.id, employee.id));
  };
  owner = await actor();
  staff = await actor();
  const workspace = await db.collabWorkspace.create({
    data: {
      name: 'U6 财务工作区',
      organizationId: org,
      ownerId: owner.actor.userId,
      members: {
        create: [
          { principalId: owner.actor.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true },
          { principalId: staff.actor.userId, role: 'EDITOR', rowScope: 'SELF', canCreate: false },
        ],
      },
    },
  });
  base = (await owner.createBase(workspace.id, { name: '财务运营' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
async function contractFixture(creator = owner.actor.userId, branchId = org, amount = '10000.00') {
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '财务客户', phone: '13800000001', phoneHash: key(), createdBy: creator },
  });
  return db.contract.create({
    data: {
      contractNo: key(),
      contractType: 'FORMAL',
      title: '财务合同',
      status: 'SIGNED',
      customerId: customer.id,
      createdBy: creator,
      branchId,
      amount,
    },
  });
}
async function seed(source: DomainSource, creator = staff.actor.userId, branchId = org, amount = '12.34') {
  const contract = await contractFixture(owner.actor.userId, branchId);
  const data = { contractId: contract.id, customerId: contract.customerId, createdBy: creator, amount };
  if (source === 'PAYMENTS') return db.payment.create({ data: { ...data, paymentNo: key() } });
  if (source === 'INVOICES') return db.invoiceRequest.create({ data: { ...data, requestNo: key() } });
  if (source === 'REFUNDS')
    return db.refundRequest.create({ data: { ...data, requestNo: key(), type: 'WAIVER', reason: '夹具' } });
  const record = await db.case.create({
    data: {
      caseNo: key(),
      title: '成本案件',
      customerId: contract.customerId,
      branchId,
      createdBy: owner.actor.userId,
      caseType: '民事',
    },
  });
  return db.costEntry.create({
    data: {
      caseId: record.id,
      category: 'CASE_HANDLING',
      amount,
      occurredAt: new Date(),
      createdBy: creator,
    },
  });
}
const actor = () => ({ actorUserId: staff.actor.userId });
const invoice = (ctx = staff.actor) => new InvoiceService(db, actor(), ctx);
const payment = (ctx = staff.actor) => new ReceivableService(db, actor(), ctx);
const refund = (ctx = staff.actor) => new RefundService(db, actor(), ctx);
const cost = (ctx = staff.actor) => new CostService(db, actor(), ctx);
const httpStatus = (status: number) => (e: unknown) =>
  ((e as { httpStatus?: number }).httpStatus ?? (e as { status?: number }).status) === status;
for (const source of ['PAYMENTS', 'INVOICES', 'REFUNDS', 'COSTS'] as DomainSource[])
  test(`${source}: canonical IDs, domain/resource scopes, extension versions and controlled core fields`, async () => {
    const table = (await owner.createTable(base, { name: source, source }, key())).id;
    const own = await seed(source);
    const other = await seed(source, owner.actor.userId);
    const foreign = await seed(source, staff.actor.userId, outside);
    assert.deepEqual(
      (await staff.query(table, {})).records.map((r) => r.id),
      [own.id],
    );
    assert.equal((await owner.query(table, {})).total, 2);
    await assert.rejects(staff.record(table, other.id), rejects('COLLAB_NOT_FOUND'));
    await assert.rejects(owner.record(table, foreign.id), rejects('COLLAB_NOT_FOUND'));
    const directory = await staff.businessTables({ source, recordId: own.id });
    assert.equal(directory.tables[0].id, table);
    assert.equal((await staff.businessTables({ source, recordId: other.id })).tables.length, 0);
    let detail = await owner.describe(table);
    const field = await owner.saveField(
      table,
      undefined,
      { name: '协作备注', type: 'TEXT', version: detail.table.schemaVersion },
      key(),
    );
    detail = await staff.describe(table);
    assert.equal(detail.fields.find((f) => f.id === field.id)?.writable, true);
    const input = {
      schemaVersion: detail.table.schemaVersion,
      version: own.version,
      values: { [field.id]: '第一版' },
    };
    const mutation = key();
    const saved = await staff.saveRecord(table, own.id, input, mutation);
    assert.deepEqual(await staff.saveRecord(table, own.id, input, mutation), saved);
    assert.equal((await owner.record(table, own.id)).record.values[field.id], '第一版');
    await assert.rejects(staff.saveRecord(table, own.id, input, key()), rejects('COLLAB_RECORD_CONFLICT'));
    const core = detail.fields.find((f) => Boolean((f.options as { businessKey?: string }).businessKey))!;
    await assert.rejects(
      staff.saveRecord(
        table,
        own.id,
        { ...input, version: own.version + 1, values: { [core.id]: '伪造' } },
        key(),
      ),
      rejects('COLLAB_USE_BUSINESS_ACTION'),
    );
    assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 0);
    const noAction = new CollaborationService(db, {
      ...staff.actor,
      permissionCodes: staff.actor.permissionCodes.filter((p) => p !== domainSources[source].edit),
    });
    await assert.rejects(
      noAction.saveRecord(table, own.id, { ...input, version: own.version + 1 }, key()),
      rejects('COLLAB_FORBIDDEN'),
    );
  });

test('currency grouping preserves neighboring Decimal(18,2) values in both custom and business tables', async () => {
  for (const source of ['CUSTOM', 'PAYMENTS']) {
    const table = (await owner.createTable(base, { name: source, source }, key())).id;
    let detail = await owner.describe(table);
    let field = detail.fields.find((f) => (f.options as { businessKey?: string }).businessKey === 'amount');
    if (!field) {
      field = await owner.saveField(
        table,
        undefined,
        { name: '金额', type: 'CURRENCY', version: detail.table.schemaVersion },
        key(),
      );
      detail = await owner.describe(table);
    }
    for (const amount of ['9999999999999999.98', '9999999999999999.99', '1.00', '1.0']) {
      if (source === 'CUSTOM')
        await owner.saveRecord(
          table,
          undefined,
          {
            values: {
              ...Object.fromEntries(detail.fields.filter((f) => f.required).map((f) => [f.id, '金额测试'])),
              [field.id]: amount,
            },
            schemaVersion: detail.table.schemaVersion,
          },
          key(),
        );
      else await seed('PAYMENTS', staff.actor.userId, org, amount);
    }
    const result = await owner.query(table, {
      config: { groupBy: [field.id], sorts: [{ fieldId: field.id, direction: 'asc' }] },
    });
    assert.equal(result.groups.length, 3);
    assert.deepEqual(
      new Map(result.groups.map((g) => [g.keys[0], Number(g.count)])),
      new Map([
        ['1', 2],
        ['9999999999999999.98', 1],
        ['9999999999999999.99', 1],
      ]),
    );
    assert.equal(result.records[3].values[field.id], '9999999999999999.99');
  }
});

test('all financial creates persist one result for concurrent normalized retries and reject changed requests', async () => {
  const contract = await contractFixture();
  const plan = await db.paymentPlan.create({
    data: {
      planNo: key(),
      contractId: contract.id,
      period: 1,
      dueDate: new Date(),
      amount: '10000',
      createdBy: owner.actor.userId,
    },
  });
  const jobs = [
    {
      make: (amount: string, idempotencyKey: string) =>
        payment().createPayment({ contractId: contract.id, amount, idempotencyKey }),
    },
    {
      make: (amount: string, idempotencyKey: string) =>
        invoice().createInvoice({ contractId: contract.id, amount, idempotencyKey }),
    },
    {
      make: (amount: string, idempotencyKey: string) =>
        refund().createRefundRequest({
          contractId: contract.id,
          type: 'WAIVER',
          planId: plan.id,
          reason: '精确减免',
          amount,
          idempotencyKey,
        }),
    },
    {
      make: (amount: string, idempotencyKey: string) =>
        cost().createCostEntry({ category: 'OFFICE', occurredAt: '2026-09-15', amount, idempotencyKey }),
    },
  ];
  for (const job of jobs) {
    const mutation = key();
    const results = await Promise.all([job.make('0.10', mutation), job.make('0.1', mutation)]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(results[0].amount, '0.10');
    assert.equal((await job.make('0.10', mutation)).id, results[0].id);
    await assert.rejects(job.make('0.20', mutation), rejects('IDEMPOTENCY_CONFLICT'));
    assert.equal(await db.domainMutation.count({ where: { actorId: staff.actor.userId, key: mutation } }), 1);
    assert.equal(await db.operationLog.count({ where: { targetId: results[0].id } }), 1);
    assert.equal(await db.eventLog.count({ where: { objectId: results[0].id } }), 1);
  }
  assert.equal(await db.domainMutation.count(), 4);
});

test('creation replay cannot cross operation types or revoked scopes and survives later business state changes', async () => {
  const contract = await contractFixture();
  const mutation = key();
  const input = { contractId: contract.id, amount: '10.00', idempotencyKey: mutation };
  const created = await payment().createPayment(input);
  await db.contract.update({ where: { id: contract.id }, data: { status: 'TERMINATED' } });
  assert.equal((await payment().createPayment(input)).id, created.id);
  await assert.rejects(invoice().createInvoice(input), rejects('IDEMPOTENCY_CONFLICT'));
  const noScope = { ...staff.actor, grants: staff.actor.grants.map((g) => ({ ...g, scopeIds: [] })) };
  await assert.rejects(payment(noScope).createPayment(input), httpStatus(404));
  const noAction = {
    ...staff.actor,
    permissionCodes: staff.actor.permissionCodes.filter((p) => p !== 'payment.create'),
  };
  await assert.rejects(payment(noAction).createPayment(input), httpStatus(403));
  assert.equal(await db.payment.count(), 1);
});

test('failed outbox rolls back the financial row, audit and completed request marker before an identical retry', async () => {
  const contract = await contractFixture();
  const input = { contractId: contract.id, amount: '0.20', idempotencyKey: key() };
  const broken = new InvoiceService(db, actor(), staff.actor, {
    append: async () => {
      throw new Error('OUTBOX_TEST_FAILURE');
    },
  });
  await assert.rejects(broken.createInvoice(input), /OUTBOX_TEST_FAILURE/);
  assert.equal(await db.invoiceRequest.count(), 0);
  assert.equal(await db.domainMutation.count(), 0);
  assert.equal(await db.operationLog.count({ where: { action: 'INVOICE_CREATE' } }), 0);
  assert.equal(await db.eventLog.count({ where: { eventType: 'invoice.requested' } }), 0);
  const created = await invoice().createInvoice(input);
  assert.equal((await invoice().createInvoice(input)).id, created.id);
});

test('cost original APIs enforce true SELF for read, edit, delete and prevent hidden case linkage', async () => {
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const ctx = { ...staff.actor, grants: staff.actor.grants.map((g) => ({ ...g, scopeIds: [self.id] })) };
  const own = await cost(ctx).createCostEntry({
    category: 'OFFICE',
    amount: '10.01',
    occurredAt: '2026-09-15',
  });
  const other = await seed('COSTS', owner.actor.userId);
  assert.equal((await cost(ctx).listCostEntries({})).total, 1);
  await assert.rejects(cost(ctx).getCostEntry(other.id), httpStatus(404));
  await assert.rejects(cost(ctx).updateCostEntry(other.id, { amount: '1.00', version: 1 }), httpStatus(404));
  await assert.rejects(cost(ctx).deleteCostEntry(other.id), httpStatus(404));
  const hiddenCase = await db.case.findFirstOrThrow();
  await assert.rejects(
    cost(ctx).createCostEntry({
      category: 'CASE_HANDLING',
      caseId: hiddenCase.id,
      amount: '1.00',
      occurredAt: '2026-09-15',
    }),
    httpStatus(400),
  );
  assert.equal((await cost(ctx).updateCostEntry(own.id, { amount: '10.02', version: 1 })).amount, '10.02');
  await cost(ctx).deleteCostEntry(own.id);
  assert.equal((await cost(ctx).listCostEntries({})).total, 0);
});

test('financial linked case labels and case-number filters obey independent case scope', async () => {
  const item = await seed('PAYMENTS');
  const paymentRow = await db.payment.findUniqueOrThrow({ where: { id: item.id } });
  const hiddenCase = await db.case.create({
    data: {
      caseNo: key(),
      title: '负责人案件',
      contractId: paymentRow.contractId,
      customerId: paymentRow.customerId,
      createdBy: owner.actor.userId,
      branchId: org,
      caseType: '民事',
    },
  });
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const ctx = {
    ...staff.actor,
    grants: staff.actor.grants.map((g) =>
      g.permissionCode === 'case.read' ? { ...g, scopeIds: [self.id] } : g,
    ),
  };
  assert.equal((await payment(ctx).listPayments({})).list[0].linkedCase, null);
  assert.equal((await payment(ctx).listPayments({ caseNo: hiddenCase.caseNo })).total, 0);
  assert.equal((await payment().listPayments({})).list[0].linkedCase?.id, hiddenCase.id);
  await assert.rejects(
    payment(ctx).createPayment({
      contractId: paymentRow.contractId,
      amount: '1.00',
      caseNo: hiddenCase.caseNo,
    }),
    httpStatus(400),
  );
});

test('SELF business actions reject another creator before changing financial state or audit', async () => {
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const ctx = { ...staff.actor, grants: staff.actor.grants.map((g) => ({ ...g, scopeIds: [self.id] })) };
  const p = await seed('PAYMENTS', owner.actor.userId);
  const i = await seed('INVOICES', owner.actor.userId);
  const r = await seed('REFUNDS', owner.actor.userId);
  const actions = [
    () => payment(ctx).confirmPayment(p.id, {}),
    () => payment(ctx).voidPayment(p.id, { reason: '范围测试' }),
    () => invoice(ctx).approveInvoice(i.id, {}),
    () => invoice(ctx).rejectInvoice(i.id, { comment: '范围测试' }),
    () => invoice(ctx).completeInvoice(i.id, {}),
    () => refund(ctx).approveRefundRequest(r.id, { expectedVersion: 1 }),
    () => refund(ctx).rejectRefundRequest(r.id, { comment: '范围测试' }),
    () => refund(ctx).executeRefundRequest(r.id, {}),
  ];
  for (const action of actions) await assert.rejects(action(), httpStatus(404));
  assert.equal(await db.operationLog.count({ where: { targetId: { in: [p.id, i.id, r.id] } } }), 0);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).version, 1);
});

test('cost organization fallback follows valid employment without replacing an explicit case anchor', async () => {
  const scope = await db.dataScope.create({ data: { name: key(), scopeType: 'ORG', organizationId: org } });
  const ctx = { ...staff.actor, grants: staff.actor.grants.map((g) => ({ ...g, scopeIds: [scope.id] })) };
  const unanchored = await cost().createCostEntry({
    category: 'OFFICE',
    amount: '1.00',
    occurredAt: '2026-09-15',
  });
  const anchored = await seed('COSTS', staff.actor.userId, org);
  const foreign = await seed('COSTS', staff.actor.userId, outside);
  assert.deepEqual(
    new Set((await cost(ctx).listCostEntries({})).list.map((r) => r.id)),
    new Set([unanchored.id, anchored.id]),
  );
  await assert.rejects(cost(ctx).getCostEntry(foreign.id), httpStatus(404));
  await db.employeeAssignment.updateMany({
    where: { employeeId: staff.actor.employeeId! },
    data: { endedAt: new Date('2026-01-01') },
  });
  assert.deepEqual(
    (await cost(ctx).listCostEntries({})).list.map((r) => r.id),
    [anchored.id],
  );
  await assert.rejects(cost(ctx).getCostEntry(unanchored.id), httpStatus(404));
  const team = await db.professionalTeam.create({
    data: { code: key(), name: '无成本归属的团队', categoryCode: 'OTHER', homeOrganizationId: org },
  });
  const teamScope = await db.dataScope.create({
    data: { name: key(), scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const teamCtx = { ...ctx, grants: ctx.grants.map((g) => ({ ...g, scopeIds: [teamScope.id] })) };
  assert.equal((await cost(teamCtx).listCostEntries({})).total, 0);
});

test('financial reference labels require each target read scope and keep canonical IDs', async () => {
  const table = (await owner.createTable(base, { name: '收款关联', source: 'PAYMENTS' }, key())).id;
  const row = await seed('PAYMENTS');
  const paymentRow = await db.payment.findUniqueOrThrow({ where: { id: row.id } });
  const contract = await db.contract.findUniqueOrThrow({ where: { id: paymentRow.contractId } });
  const detail = await staff.describe(table);
  const field = detail.fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'contractId',
  )!;
  const visible = (await staff.query(table, {})).records[0] as unknown as {
    values: Record<string, string>;
    displayValues: Record<string, string>;
  };
  assert.equal(visible.values[field.id], contract.id);
  assert.equal(visible.displayValues[field.id], contract.contractNo + ' · ' + contract.title);
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const restricted = new CollaborationService(db, {
    ...staff.actor,
    grants: staff.actor.grants.map((g) =>
      g.permissionCode === 'contract.read' ? { ...g, scopeIds: [self.id] } : g,
    ),
  });
  const hidden = (await restricted.query(table, {})).records[0] as unknown as {
    displayValues: Record<string, string>;
  };
  assert.equal(hidden.displayValues?.[field.id], undefined);
});
