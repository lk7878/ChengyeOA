import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { InventoryService } from '../../app/application/inventory/inventory-service';
import { PerformanceService } from '../../app/application/performance/performance-service';
import { DomainSource } from '../../app/application/crm/workspace-domain-source';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, owner: CollaborationService, staff: CollaborationService;
let org: string, outside: string, base: string, selfId: string;
const rejects = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
const context = (userId: string, employeeId: string): AuthorizationContext => {
  const permissionCodes: AuthorizationContext['permissionCodes'] = [
    'inventory.read',
    'inventory.manage',
    'inventory.inbound',
    'inventory.outbound',
    'inventory.stocktake',
    'inventory.export',
    'performance.read',
    'performance.create',
    'performance.update',
    'performance.confirm',
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
      name: 'U6 库存绩效工作区',
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
  base = (await owner.createBase(workspace.id, { name: '库存绩效' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

const inventory = (ctx = staff.actor) => new InventoryService(db, { actorUserId: ctx.userId }, ctx);
const performance = (ctx = staff.actor) => new PerformanceService(db, { actorUserId: ctx.userId }, ctx);
const selfContext = (ctx = staff.actor): AuthorizationContext => ({
  ...ctx,
  grants: ctx.grants.map((g) => ({ ...g, scopeIds: [selfId] })),
});
async function seed(source: DomainSource, ctx = staff.actor) {
  if (source === 'PERFORMANCES')
    return performance(ctx).createPerformance({
      employeeId: ctx.employeeId!,
      period: '2026-09',
      type: 'MONTHLY',
      idempotencyKey: key(),
    });
  const item = await inventory(ctx).saveItem({
    name: '精确物品',
    kind: 'OFFICE',
    category: '文具',
    unit: '支',
    idempotencyKey: key(),
  });
  if (source === 'INVENTORY_ITEMS') return item;
  if (source === 'INVENTORY_MOVEMENTS')
    return inventory(ctx).move({
      itemId: item.id,
      version: 1,
      action: 'INBOUND',
      quantity: '10.125',
      occurredAt: '2026-09-15',
      idempotencyKey: key(),
    });
  return inventory(ctx).stocktake({
    itemId: item.id,
    version: 1,
    actualStock: '10.125',
    reason: '首次核对',
    occurredAt: '2026-09-15',
    idempotencyKey: key(),
  });
}
for (const source of [
  'INVENTORY_ITEMS',
  'INVENTORY_MOVEMENTS',
  'INVENTORY_STOCKTAKES',
  'PERFORMANCES',
] as DomainSource[]) {
  test(`${source}: canonical rows, creator SELF, no duplicate records and immutable core`, async () => {
    const table = (await owner.createTable(base, { name: source, source }, key())).id;
    const own = await seed(source),
      other = await seed(source, owner.actor);
    const visible = await staff.query(table, {});
    assert.deepEqual(
      visible.records.map((r) => r.id),
      [own.id],
    );
    assert.equal((await owner.query(table, {})).total, 2);
    await assert.rejects(staff.record(table, other.id), rejects('COLLAB_NOT_FOUND'));
    let detail = await owner.describe(table);
    const extra = await owner.saveField(
      table,
      undefined,
      { name: '协作说明', type: 'TEXT', version: detail.table.schemaVersion },
      key(),
    );
    detail = await staff.describe(table);
    const version = (await staff.record(table, own.id)).record.version;
    const input = {
      version,
      schemaVersion: detail.table.schemaVersion,
      values: { [extra.id]: '同一条记录' },
    };
    const mutation = key();
    await staff.saveRecord(table, own.id, input, mutation);
    await staff.saveRecord(table, own.id, input, mutation);
    assert.equal((await owner.record(table, own.id)).record.version, version + 1);
    await assert.rejects(staff.saveRecord(table, own.id, input, key()), rejects('COLLAB_RECORD_CONFLICT'));
    const core = detail.fields.find((f) => (f.options as { businessKey?: string }).businessKey)!;
    await assert.rejects(
      staff.saveRecord(
        table,
        own.id,
        { ...input, version: version + 1, values: { [core.id]: '覆盖' } },
        key(),
      ),
      rejects('COLLAB_USE_BUSINESS_ACTION'),
    );
    assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 0);
    const directory = await staff.businessTables({ source, recordId: own.id });
    assert.equal(directory.tables[0].id, table);
  });
}
test('inventory neighboring Decimal(18,3) quantities remain distinct in sorting and grouping', async () => {
  const table = (await owner.createTable(base, { name: '库存', source: 'INVENTORY_ITEMS' }, key())).id;
  for (const stock of ['999999999999999.998', '999999999999999.999', '1.000']) {
    const item = await seed('INVENTORY_ITEMS');
    await db.inventoryItem.update({ where: { id: item.id }, data: { stock } });
  }
  const field = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'stock',
  )!;
  const result = await owner.query(table, {
    config: { groupBy: [field.id], sorts: [{ fieldId: field.id, direction: 'asc' }] },
  });
  assert.deepEqual(
    result.groups.map((g) => g.keys[0]),
    ['1', '999999999999999.998', '999999999999999.999'],
  );
  assert.equal(result.records[2].values[field.id], '999999999999999.999');
});
test('inventory actual creator scope applies to read, stats, export, mutations and retry authorization', async () => {
  const own = await seed('INVENTORY_ITEMS'),
    other = await seed('INVENTORY_ITEMS', owner.actor);
  const ctx = selfContext();
  const svc = inventory(ctx);
  const body = {
    itemId: own.id,
    version: 1,
    action: 'INBOUND',
    quantity: '5',
    occurredAt: '2026-09-15',
    idempotencyKey: key(),
  };
  const movement = await svc.move(body);
  assert.equal((await svc.move(body)).id, movement.id);
  const listing = await svc.list({ view: 'items' });
  assert.ok('list' in listing);
  assert.equal(listing.total, 1);
  await assert.rejects(svc.get(other.id), rejects('INVENTORY_NOT_FOUND'));
  await assert.rejects(
    svc.move({ ...body, itemId: other.id, idempotencyKey: key() }),
    rejects('INVENTORY_NOT_FOUND'),
  );
  assert.equal(((await svc.list({ view: 'dashboard' })) as { itemCount: number }).itemCount, 1);
  const csv = await svc.export({ view: 'items' });
  assert.equal(csv.csv.includes(other.code!), false);
  const revoked = inventory({ ...ctx, grants: [] });
  await assert.rejects(revoked.move(body), rejects('INVENTORY_NOT_FOUND'));
  const raw = await svc.get(movement.id, 'movements');
  assert.equal('requestHash' in raw, false);
});
test('performance retry is atomic; creator is independent from subject; self review is subject-only and versioned', async () => {
  const body = {
    employeeId: owner.actor.employeeId!,
    period: '2026-09',
    type: 'MONTHLY' as const,
    idempotencyKey: key(),
  };
  const svc = performance();
  const [a, b] = await Promise.all([svc.createPerformance(body), svc.createPerformance(body)]);
  assert.equal(a.id, b.id);
  assert.equal(a.createdBy, staff.actor.userId);
  assert.equal(a.version, 1);
  assert.equal((await performance(selfContext()).listPerformances({})).total, 1);
  assert.equal((await performance(selfContext(owner.actor)).listPerformances({})).total, 0);
  await assert.rejects(
    svc.selfReview(a.id, { selfScore: 80, version: 1 }),
    rejects('PERFORMANCE_SELF_REVIEW_FORBIDDEN'),
  );
  await performance(owner.actor).selfReview(a.id, { selfScore: 80, version: 1 });
  await assert.rejects(
    svc.managerReview(a.id, { managerScore: 90, version: 1 }),
    rejects('VERSION_CONFLICT'),
  );
  await svc.managerReview(a.id, { managerScore: 90, version: 2 });
  await svc.confirmPerformance(a.id, { version: 3 });
  assert.equal((await svc.getPerformance(a.id)).version, 4);
  assert.deepEqual(await svc.getBusinessMetrics(a.id), {
    closedCases: null,
    confirmedRevenue: null,
    autoScore: null,
  });
  await assert.rejects(
    performance({ ...staff.actor, grants: [] }).createPerformance(body),
    rejects('VALIDATION_FAILED'),
  );
});
test('workspace organization excludes items by invalid employment and performance by unrelated subject organization', async () => {
  const item = await seed('INVENTORY_ITEMS'),
    perf = await seed('PERFORMANCES');
  const itemTable = (await owner.createTable(base, { name: '库存', source: 'INVENTORY_ITEMS' }, key())).id;
  const perfTable = (await owner.createTable(base, { name: '绩效', source: 'PERFORMANCES' }, key())).id;
  assert.equal((await owner.query(itemTable, {})).total, 1);
  assert.equal((await owner.query(perfTable, {})).total, 1);
  await db.employeeAssignment.updateMany({
    where: { employeeId: staff.actor.employeeId! },
    data: { endedAt: new Date('2026-01-01') },
  });
  await assert.rejects(owner.record(itemTable, item.id), rejects('COLLAB_NOT_FOUND'));
  await assert.rejects(owner.record(perfTable, perf.id), rejects('COLLAB_NOT_FOUND'));
});

test('organization scopes follow item creators and performance subjects; pure team cannot acquire warehouse access', async () => {
  const orgScope = await db.dataScope.create({
    data: { name: key(), scopeType: 'ORG', organizationId: org },
  });
  const ctx = { ...owner.actor, grants: owner.actor.grants.map((g) => ({ ...g, scopeIds: [orgScope.id] })) };
  const movement = await seed('INVENTORY_MOVEMENTS');
  const perf = await seed('PERFORMANCES');
  assert.equal((await inventory(ctx).get(movement.id, 'movements')).id, movement.id);
  assert.equal((await performance(ctx).getPerformance(perf.id)).id, perf.id);
  const assignment = await db.employeeAssignment.findFirstOrThrow({
    where: { employeeId: staff.actor.employeeId! },
  });
  await db.position.update({ where: { id: assignment.positionId }, data: { status: 'DISABLED' } });
  await assert.rejects(inventory(ctx).get(movement.id, 'movements'), rejects('INVENTORY_NOT_FOUND'));
  await assert.rejects(performance(ctx).getPerformance(perf.id), rejects('PERFORMANCE_NOT_FOUND'));
  const team = await db.professionalTeam.create({
    data: { code: key(), name: '考核团队', categoryCode: 'OTHER', homeOrganizationId: org },
  });
  await db.professionalTeamMember.create({
    data: {
      employeeId: staff.actor.employeeId!,
      professionalTeamId: team.id,
      memberRole: 'OTHER',
      startedAt: new Date('2025-01-01'),
    },
  });
  const teamScope = await db.dataScope.create({
    data: { name: key(), scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const teamCtx = {
    ...owner.actor,
    grants: owner.actor.grants.map((g) => ({ ...g, scopeIds: [teamScope.id] })),
  };
  assert.equal(((await inventory(teamCtx).list({ view: 'items' })) as { total: number }).total, 0);
  assert.equal((await performance(teamCtx).getPerformance(perf.id)).id, perf.id);
});
test('recipient pages enforce scoped valid employment and movement labels do not bypass item read scope', async () => {
  const item = await seed('INVENTORY_ITEMS', owner.actor);
  const move = await inventory(owner.actor).move({
    itemId: item.id,
    action: 'INBOUND',
    version: 1,
    quantity: '4',
    occurredAt: '2026-09-15',
    idempotencyKey: key(),
  });
  await db.inventoryMovement.update({ where: { id: move.id }, data: { createdBy: staff.actor.userId } });
  const table = (await owner.createTable(base, { name: '出入库', source: 'INVENTORY_MOVEMENTS' }, key())).id;
  const ctx = selfContext();
  const scoped = new CollaborationService(db, ctx);
  const field = (await scoped.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'itemId',
  )!;
  const result = await scoped.record(table, move.id);
  assert.equal(result.record.values[field.id], item.id);
  assert.equal(
    (result.record as { displayValues?: Record<string, string> }).displayValues?.[field.id],
    undefined,
  );
  const recipients = await inventory(ctx).recipients(undefined, 1);
  assert.ok(!Array.isArray(recipients));
  assert.equal(recipients.total, 1);
  assert.equal(recipients.list[0].id, staff.actor.employeeId);
  await db.employeeAssignment.updateMany({
    where: { employeeId: staff.actor.employeeId! },
    data: { startedAt: new Date('2099-01-01') },
  });
  const after = await inventory(ctx).recipients(undefined, 1);
  assert.ok(!Array.isArray(after));
  assert.equal(after.total, 0);
});
