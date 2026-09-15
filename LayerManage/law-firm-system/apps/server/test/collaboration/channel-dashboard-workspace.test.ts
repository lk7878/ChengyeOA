import { CostService } from '../../app/application/finance/cost-service';
import { LeadService } from '../../app/application/crm/lead-service';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ChannelService } from '../../app/application/channel/channel-service';
import { DashboardService } from '../../app/application/dashboard/dashboard-service';
import { AuthorizationService } from '../../app/application/authorization/authorization-service';
import { DataScopeService } from '../../app/application/authorization/data-scope-service';
import {
  buildContractScopeWhere,
  buildCustomerVisibilityWhere,
  buildNegotiationScopeWhere,
} from '../../app/application/contract/contract-scope';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, owner: CollaborationService, staff: CollaborationService;
let org: string, outside: string, base: string, selfId: string;
const rejects = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
const context = (userId: string, employeeId: string): AuthorizationContext => {
  const permissionCodes: AuthorizationContext['permissionCodes'] = [
    'user.read',
    'organization.read',
    'cost.create',
    'channel.read',
    'channel.create',
    'channel.update',
    'channel.delete',
    'lead.read',
    'lead.create',
    'customer.read',
    'contract.read',
    'case.read',
    'payment.read',
    'employee.read',
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
  selfId = (await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } })).id;
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
      name: 'U6 渠道分析工作区',
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
  base = (await owner.createBase(workspace.id, { name: '渠道分析' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

const channel = (ctx = staff.actor) => new ChannelService(db, { actorUserId: ctx.userId }, ctx);
const scoped = (scopeId: string, ctx = staff.actor): AuthorizationContext => ({
  ...ctx,
  grants: ctx.grants.map((g) => ({ ...g, scopeIds: [scopeId] })),
});
async function business(creator: string) {
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '范围客户', phone: '13800000001', phoneHash: key(), createdBy: creator },
  });
  const contract = await db.contract.create({
    data: {
      contractNo: key(),
      contractType: 'FORMAL',
      title: '范围合同',
      customerId: customer.id,
      branchId: org,
      createdBy: creator,
      amount: '90071992547409.91',
    },
  });
  const negotiation = await db.negotiation.create({
    data: {
      negotiationNo: key(),
      customerId: customer.id,
      negotiatorEmployeeId: staff.actor.employeeId!,
      createdBy: creator,
      branchId: org,
    },
  });
  return { customer, contract, negotiation };
}
test('CUSTOM employee grants select the target creator for customers, contracts and negotiations', async () => {
  const own = await business(staff.actor.userId),
    other = await business(owner.actor.userId);
  const custom = await db.dataScope.create({
    data: { name: key(), scopeType: 'CUSTOM', targets: { create: { employeeId: owner.actor.employeeId! } } },
  });
  const ctx = scoped(custom.id),
    auth = new AuthorizationService(new DataScopeService(db));
  assert.deepEqual(
    (
      await db.customer.findMany({
        where: await buildCustomerVisibilityWhere(db, auth, ctx, 'customer.read'),
      })
    ).map((r) => r.id),
    [other.customer.id],
  );
  assert.deepEqual(
    (
      await db.contract.findMany({ where: await buildContractScopeWhere(db, auth, ctx, 'contract.read') })
    ).map((r) => r.id),
    [other.contract.id],
  );
  const withNegotiation = {
    ...ctx,
    permissionCodes: [...ctx.permissionCodes, 'negotiation.read'] as AuthorizationContext['permissionCodes'],
    grants: [
      ...ctx.grants,
      { ...ctx.grants[0], resource: 'negotiation', permissionCode: 'negotiation.read' as const },
    ],
  };
  assert.deepEqual(
    (
      await db.negotiation.findMany({
        where: await buildNegotiationScopeWhere(db, auth, withNegotiation, 'negotiation.read'),
      })
    ).map((r) => r.id),
    [other.negotiation.id],
  );
  assert.notEqual(own.customer.id, other.customer.id);
});
test('channel CRUD preserves exact money, retries and version conflict without duplicate writes', async () => {
  const input = {
    name: '渠道A',
    type: 'OTHER',
    branchId: org,
    cost: '90071992547409.91',
    idempotencyKey: key(),
  };
  const row = await channel().create(input),
    replay = await channel().create(input);
  assert.equal(row.id, replay.id);
  assert.equal(row.cost, '90071992547409.91');
  assert.equal(await db.channel.count(), 1);
  await assert.rejects(channel().create({ ...input, name: 'different' }), rejects('IDEMPOTENCY_CONFLICT'));
  const updated = await channel().update(row.id, { name: '渠道B', version: 1 });
  assert.equal(updated.version, 2);
  await assert.rejects(channel().update(row.id, { name: 'stale', version: 1 }), rejects('VERSION_CONFLICT'));
  await assert.rejects(channel().remove(row.id, { version: 1 }), rejects('VERSION_CONFLICT'));
  await channel().remove(row.id, { version: 2 });
  assert.equal(await db.channel.count(), 0);
});
test('channel SELF and ORG scopes exclude outsiders and unidentified historical rows', async () => {
  const own = await channel().create({ name: '本人', type: 'OTHER', branchId: org });
  await channel(owner.actor).create({ name: '他人', type: 'OTHER', branchId: outside });
  await db.channel.create({ data: { code: key(), name: '未知', type: 'OTHER' } });
  assert.deepEqual(
    (await channel(scoped(selfId)).list({})).list.map((r) => r.id),
    [own.id],
  );
  const scope = await db.dataScope.create({ data: { name: key(), scopeType: 'ORG', organizationId: org } });
  assert.deepEqual(
    (await channel(scoped(scope.id)).list({})).list.map((r) => r.id),
    [own.id],
  );
  const denied = { ...staff.actor, permissionCodes: [] };
  await assert.rejects(channel(denied).list({}), rejects('PERMISSION_DENIED'));
});
test('CHANNELS use original IDs, precise values and the workspace creator restriction', async () => {
  const table = (await owner.createTable(base, { name: '渠道', source: 'CHANNELS' }, key())).id;
  const own = await channel().create({
    name: '自己渠道',
    type: 'OTHER',
    branchId: org,
    cost: '90071992547409.91',
  });
  const other = await channel(owner.actor).create({ name: '负责人渠道', type: 'OTHER', branchId: org });
  await channel().create({ name: '其他组织', type: 'OTHER', branchId: outside });
  const result = await staff.query(table, {});
  assert.deepEqual(
    result.records.map((r) => r.id),
    [own.id],
  );
  assert.equal((await owner.query(table, {})).total, 2);
  await assert.rejects(staff.record(table, other.id), rejects('COLLAB_NOT_FOUND'));
  assert.equal(await db.collabRecord.count(), 0);
  const description = await owner.describe(table),
    field = description.fields.find((f) => (f.options as { businessKey?: string }).businessKey === 'cost')!;
  assert.equal(result.records[0].values[field.id], '90071992547409.91');
});
test('dashboard returns unavailable per missing domain instead of whole-database counts', async () => {
  await business(owner.actor.userId);
  const ctx = { ...staff.actor, permissionCodes: [], grants: [] };
  const dashboard = new DashboardService(db, ctx);
  const metrics = await dashboard.metrics();
  assert.ok(Object.values(metrics.overview).every((v) => v === null));
  assert.ok(Object.values(await dashboard.funnel()).every((v) => v === null));
  assert.equal(await dashboard.teamMetrics(), null);
  assert.ok(Object.values(await dashboard.financeMetrics()).every((v) => v === null));
  assert.ok(Object.values(await dashboard.caseMetrics()).every((v) => v === null));
  assert.ok(Object.values(await dashboard.alerts()).every((v) => v === null));
});
test('dashboard SELF totals and plan alerts respect creator scopes and preserve money', async () => {
  const own = await business(staff.actor.userId),
    other = await business(owner.actor.userId);
  for (const [record, creator] of [
    [own, staff.actor.userId],
    [other, owner.actor.userId],
  ] as const) {
    await db.payment.create({
      data: {
        paymentNo: key(),
        contractId: record.contract.id,
        customerId: record.customer.id,
        createdBy: creator,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        amount: '90071992547409.91',
      },
    });
    await db.paymentPlan.create({
      data: {
        planNo: key(),
        period: 1,
        contractId: record.contract.id,
        createdBy: creator,
        status: 'OVERDUE',
        dueDate: new Date('2025-01-01'),
        amount: '90071992547409.91',
      },
    });
  }
  const dashboard = new DashboardService(db, scoped(selfId));
  const metrics = await dashboard.metrics();
  assert.equal(metrics.overview.customerCount, 1);
  assert.equal(metrics.overview.contractCount, 1);
  assert.equal(metrics.overview.totalRevenue, '90071992547409.91');
  const alerts = await dashboard.alerts();
  assert.equal(alerts.overduePayments?.length, 1);
  assert.equal(alerts.overduePayments?.[0].contractId, own.contract.id);
  assert.equal('customer' in alerts.overduePayments![0], false);
  const finance = await dashboard.financeMetrics();
  assert.equal(finance.overdueCount, 1);
  assert.equal(finance.yearRevenue, '90071992547409.91');
});

test('channel retries reauthorize and input rejects duplicate codes and imprecise amounts', async () => {
  const input = { name: '重试渠道', code: 'U6C-CODE', type: 'OTHER', branchId: org, idempotencyKey: key() };
  const row = await channel().create(input);
  const denied = {
    ...staff.actor,
    permissionCodes: staff.actor.permissionCodes.filter((p) => p !== 'channel.create'),
  };
  await assert.rejects(channel(denied).create(input), rejects('PERMISSION_DENIED'));
  await assert.rejects(
    channel().create({ ...input, idempotencyKey: key() }),
    rejects('CHANNEL_CODE_CONFLICT'),
  );
  for (const cost of ['1.001', '-1', '1e3', 1])
    await assert.rejects(
      channel().create({ name: '非法', type: 'OTHER', cost }),
      rejects('VALIDATION_FAILED'),
    );
  for (const page of ['1e2', '1.0', 0, ' '])
    await assert.rejects(channel().list({ page }), rejects('VALIDATION_FAILED'));
  assert.equal(await db.channel.count(), 1);
  assert.equal((await channel().get(row.id)).version, 1);
});
test('lead and cost channel references require independent read scope including retries', async () => {
  const own = await channel().create({ name: '自己', type: 'OTHER', branchId: org });
  const other = await channel(owner.actor).create({ name: '不可见', type: 'OTHER', branchId: org });
  const ctx = scoped(selfId),
    actor = { actorUserId: ctx.userId },
    leads = new LeadService(db, actor, ctx),
    costs = new CostService(db, actor, ctx);
  await assert.rejects(
    leads.createLead({ name: '越权线索', phone: '13800000002', channelId: other.id }),
    rejects('VALIDATION_FAILED'),
  );
  await assert.rejects(
    costs.createCostEntry({
      category: 'CHANNEL',
      amount: '1.00',
      occurredAt: '2026-09-16',
      channelId: other.id,
    }),
    rejects('VALIDATION_FAILED'),
  );
  const input = { name: '渠道线索', phone: '13800000003', channelId: own.id };
  await leads.createLead(input, 'replay');
  const denied = { ...ctx, permissionCodes: ctx.permissionCodes.filter((p) => p !== 'channel.read') };
  await assert.rejects(
    new LeadService(db, actor, denied).createLead(input, 'replay'),
    rejects('VALIDATION_FAILED'),
  );
  await assert.rejects(channel().remove(own.id, { version: 1 }), rejects('CHANNEL_IN_USE'));
  assert.equal(await db.lead.count(), 1);
  assert.equal(await db.costEntry.count(), 0);
});
test('channel statistics use visible converted leads and never include raw lead/customer details', async () => {
  const row = await channel().create({ name: '统计渠道', type: 'OTHER', branchId: org });
  for (const [creator, employee, status] of [
    [staff.actor.userId, staff.actor.employeeId!, 'CONVERTED'],
    [owner.actor.userId, owner.actor.employeeId!, 'NEW'],
  ] as const)
    await db.lead.create({
      data: {
        leadNo: key(),
        name: '不应投影姓名',
        phone: '13800000001',
        phoneHash: key(),
        channelId: row.id,
        createdBy: creator,
        assignedTo: employee,
        status,
      },
    });
  const result = await channel(scoped(selfId)).statistics(row.id);
  assert.equal(result.totalLeads, 1);
  assert.equal(result.convertedLeads, 1);
  assert.equal(result.conversionRate, '100.00%');
  assert.equal('leads' in result.channel, false);
  const ctx = {
    ...staff.actor,
    permissionCodes: staff.actor.permissionCodes.filter((p) => p !== 'lead.read'),
  };
  assert.equal((await channel(ctx).statistics(row.id)).totalLeads, null);
});
test('channel historical repair requires ALL and directory scopes, preserves established facts and audits', async () => {
  const row = await db.channel.create({ data: { code: key(), name: '历史渠道', type: 'OTHER' } });
  await assert.rejects(
    channel(scoped(selfId)).repairIdentity(row.id, {
      createdBy: staff.actor.userId,
      branchId: org,
      reason: '依据',
      version: 1,
    }),
    rejects('PERMISSION_DENIED'),
  );
  const denied = {
    ...owner.actor,
    permissionCodes: owner.actor.permissionCodes.filter((p) => p !== 'user.read'),
  };
  assert.equal((await channel(denied).identityGaps({})).canRepair, false);
  assert.equal((await channel(denied).identityGaps({})).users.length, 0);
  const fixed = await channel(owner.actor).repairIdentity(row.id, {
    createdBy: staff.actor.userId,
    branchId: org,
    reason: '核对原始登记',
    version: 1,
  });
  assert.equal(fixed.version, 2);
  await assert.rejects(
    channel(owner.actor).repairIdentity(row.id, {
      createdBy: owner.actor.userId,
      reason: '覆盖',
      version: 2,
    }),
    rejects('VALIDATION_FAILED'),
  );
  assert.equal(
    await db.operationLog.count({ where: { action: 'CHANNEL_IDENTITY_REPAIR', targetId: row.id } }),
    1,
  );
  assert.equal((await channel(scoped(selfId)).get(row.id)).id, row.id);
});
