import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AnalyticsService, widgetConfig } from '../../app/application/collaboration/analytics-service';
import { worksheetStatistics } from '../../app/application/inventory/worksheet-statistics';
import { InventoryService } from '../../app/application/inventory/inventory-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const context = (userId: string, admin = true): AuthorizationContext => ({
  userId,
  employeeId: null,
  isSystemSuperAdmin: admin,
  isSystemAdmin: false,
  permissionCodes: admin ? PERMISSION_CATALOG.map((p) => p.code) : ['inventory.read', 'inventory.export'],
  evaluatedAt: new Date(),
  fieldRules: [],
  grants: PERMISSION_CATALOG.map((p) => ({
    sourceType: 'ROLE',
    sourceId: 'fixture',
    permissionCode: p.code,
    resource: p.resource,
    scopeIds: ['ALL'],
    validUntil: null,
  })),
});
let db: PrismaClient,
  owner: AuthorizationContext,
  reader: AuthorizationContext,
  drive: DriveService,
  baseId: string,
  workspaceId: string,
  readerRole: string;
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const id = key();
  await db.organization.create({
    data: { id, code: key(), name: '分析测试律所', type: 'FIRM', path: '/' + id },
  });
  owner = context((await db.user.create({ data: { username: 'analyst', password: 'unused' } })).id);
  reader = context((await db.user.create({ data: { username: 'reader', password: 'unused' } })).id, false);
  readerRole = (await db.role.create({ data: { code: 'ANALYST', name: '统计查看', type: 'BUSINESS' } })).id;
  await db.userRole.create({ data: { userId: reader.userId, roleId: readerRole } });
  drive = new DriveService(db, owner);
  const root = await drive.createWorkspace({ name: '工作区', organizationId: id }, key());
  const workspace = await drive.provisionModuleWorkspace(root.id, { source: 'INVENTORY_ITEMS' }, key());
  workspaceId = workspace.id;
  baseId = (
    await drive.createDriveBase(workspace.id, { name: '物品工作表', moduleSource: 'INVENTORY_ITEMS' }, key())
  ).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
async function register(kind = 'INVENTORY_REGISTER') {
  const table = await drive.createTable(baseId, { name: kind, template: kind }, key());
  const d = await drive.describe(table.id);
  return { id: table.id, f: Object.fromEntries(d.fields.map((f) => [f.name, f.id])) };
}
async function add(
  t: Awaited<ReturnType<typeof register>>,
  values: Record<string, unknown>,
  by = owner.userId,
) {
  return db.collabRecord.create({
    data: {
      tableId: t.id,
      createdBy: by,
      updatedBy: by,
      ownerId: by,
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => [t.f[k], v])),
    },
  });
}
async function grant(rowScope = 'ALL', hiddenFields: string[] = []) {
  await drive.saveMember(
    workspaceId,
    { principalType: 'ROLE', principalId: readerRole, role: 'READER', canCreate: false, rowScope, baseId },
    key(),
  );
  if (hiddenFields.length)
    await db.collabMember.updateMany({ where: { principalId: readerRole }, data: { hiddenFields } });
}
const stats = (actor = owner, params: Record<string, unknown> = {}) =>
  worksheetStatistics(db, actor, { groupBy: 'item', skip: 0, take: 100, ...params });
test('worksheet statistics unpivot both registers, filter dates and text, update/delete immediately, export the same totals', async () => {
  const custom = await register(),
    office = await register('OFFICE_REGISTER');
  const a = await add(custom, {
    领取日期: '2026-11-04T16:00:00.000Z',
    领用人: '张三',
    领取部门: '律师部',
    档案袋: 10,
    案卷盒: 2,
  });
  await add(custom, {
    领取日期: '2026-11-05T15:59:59.000Z',
    领用人: '李四',
    领取部门: '行政后勤',
    档案袋: 3,
  });
  await add(custom, { 领取日期: '2026-11-05T16:00:00.000Z', 领用人: '李四', 档案袋: 99 });
  await add(office, { 领取日期: '2026-11-05T01:00:00Z', 领用人: '张三', '15mm夹子': 5, '25mm夹子': 0 });
  const result = await stats(owner, { kind: 'CUSTOMIZED', from: '2026-11-05', to: '2026-11-05' });
  assert.equal(result.total, 2);
  assert.equal(result.list.find((r) => r.itemName === '档案袋')?.quantity, '13');
  assert.equal(result.list.find((r) => r.itemName === '档案袋')?.count, 2);
  assert.equal((await stats(owner, { kind: 'OFFICE' })).list[0].quantity, '5');
  assert.equal((await stats(owner, { keyword: '张三', groupBy: 'employee' })).list.length, 3);
  assert.equal(
    (await stats(owner, { keyword: '律师部', groupBy: 'organization' })).list[0].organizationPath,
    '律师部',
  );
  await db.collabRecord.update({
    where: { id: a.id },
    data: { values: { ...(a.values as object), [custom.f['档案袋']]: 15 } },
  });
  assert.equal(
    (await stats(owner, { kind: 'CUSTOMIZED', keyword: '张三' })).list.find((r) => r.itemName === '档案袋')
      ?.quantity,
    '15',
  );
  await db.collabRecord.update({ where: { id: a.id }, data: { archived: true } });
  assert.equal((await stats(owner, { keyword: '张三', kind: 'CUSTOMIZED' })).total, 0);
  const inventory = new InventoryService(db, { actorUserId: owner.userId, requestId: key() }, owner);
  const csv = await inventory.export({ view: 'worksheet-statistics', kind: 'OFFICE', keyword: '张三' });
  assert.ok(csv.csv.includes('15mm夹子'));
  assert.ok(csv.csv.includes('"5"'));
  assert.ok(!csv.csv.includes('档案袋'));
  const page = await stats(owner, { take: 1, skip: 1 });
  assert.equal(page.list.length, 1);
  assert.ok(page.total > 1);
});
test('statistics and dashboards respect own-row scope, hidden columns, revocation and archived sources', async () => {
  const t = await register();
  await add(t, { 档案袋: 100, 领用人: '管理员' });
  await add(t, { 档案袋: 7, 案卷盒: 2, 领用人: '本人' }, reader.userId);
  assert.equal((await stats(reader)).total, 0);
  await grant('SELF');
  assert.equal((await stats(reader)).list.find((r) => r.itemName === '档案袋')?.quantity, '7');
  const analytics = new AnalyticsService(db, reader),
    w = widgetConfig({
      id: key(),
      title: '领用',
      type: 'bar',
      tableId: t.id,
      measure: t.f['档案袋'],
      aggregation: 'sum',
    });
  assert.equal((await analytics.query(w)).metric, '7');
  const exportRestricted = { ...reader, grants: reader.grants.filter(g => g.permissionCode !== 'inventory.export') };
  const exporter = new InventoryService(db, { actorUserId: reader.userId }, exportRestricted);
  const exported = await exporter.export({view:'worksheet-statistics'});
  assert.ok(!exported.csv.includes('档案袋'));

  const d = await new AnalyticsService(db, owner).save({ name: '共享看板', shared: true, widgets: [w] });
  assert.equal((await analytics.list())[0].id, d.id);
  await assert.rejects(
    analytics.save({ name: '篡改', shared: true, widgets: [], version: 1 }, d.id),
    /ANALYTICS_CONFLICT/,
  );
  await assert.rejects(analytics.remove(d.id, 1), /ANALYTICS_CONFLICT/);
  await db.collabMember.updateMany({
    where: { principalId: readerRole },
    data: { rowScope: 'ALL', hiddenFields: [t.f['档案袋']] },
  });
  assert.ok(!(await stats(reader)).list.some((r) => r.itemName === '档案袋'));
  await assert.rejects(analytics.query(w), /COLLAB_FIELD_UNAVAILABLE/);
  await db.collabMember.deleteMany({ where: { principalId: readerRole } });
  await assert.rejects(analytics.query(w), /COLLAB_FORBIDDEN/);
  assert.equal((await analytics.sources()).length, 0);
  await db.collabTable.update({ where: { id: t.id }, data: { archived: true } });
  assert.equal((await stats()).total, 0);
});
test('dashboard joins, filtering and decimal aggregates use live authorized source records; versions protect edits', async () => {
  const a = await register(),
    b = await register('OFFICE_REGISTER');
  await add(a, { 领用人: '甲', 档案袋: 1 });
  await add(a, { 领用人: '乙', 档案袋: 2 });
  await add(b, { 领用人: '甲', '15mm夹子': '0.1' });
  await add(b, { 领用人: '甲', '15mm夹子': '0.2' });
  const service = new AnalyticsService(db, owner),
    w = widgetConfig({
      id: key(),
      title: '联合统计',
      type: 'bar',
      tableId: a.id,
      aggregation: 'sum',
      measure: 'related:' + b.f['15mm夹子'],
      dimension: a.f['领用人'],
      join: { tableId: b.id, localField: a.f['领用人'], foreignField: b.f['领用人'], mode: 'inner' },
    });
  const data = await service.query(w);
  assert.equal(data.total, 2);
  assert.equal(data.metric, '0.3');
  assert.equal(data.series[0].key, '甲');
  assert.equal((await service.query({ ...w, aggregation: 'avg' })).metric, '0.15');
  assert.equal(
    (await service.query({ ...w, aggregation: 'count', join: { ...w.join!, mode: 'left' } })).total,
    3,
  );
  assert.equal(
    (await service.query({ ...w, filter: { fieldId: a.f['领用人'], operator: 'eq', value: '乙' } })).total,
    0,
  );
  const saved = await service.save({ name: '关联看板', widgets: [w], shared: false });
  assert.equal((await new AnalyticsService(db, reader).list()).length, 0);
  const changed = await service.save(
    { name: '新名称', widgets: [w], shared: false, version: saved.version },
    saved.id,
  );
  assert.equal(changed.version, 2);
  await assert.rejects(service.remove(saved.id, 1), /ANALYTICS_CONFLICT/);
  await service.remove(saved.id, 2);
  assert.equal((await service.list()).length, 0);
  await grant();
  await db.collabTable.update({
    where: { id: b.id },
    data: {
      accessPolicy: {
        inherit: false,
        grants: [
          {
            principalType: 'USER',
            principalId: owner.userId,
            role: 'MANAGER',
            rowScope: 'ALL',
            canCreate: true,
            hiddenFields: [],
            readonlyFields: [],
          },
        ],
      },
    },
  });
  await assert.rejects(new AnalyticsService(db, reader).query(w));
  await assert.rejects(service.query({ ...w, measure: 'missing' }), /COLLAB_FIELD_UNAVAILABLE/);
});
test('unsupported configs and data limits fail explicitly instead of returning partial totals', async () => {
  const t = await register(),
    service = new AnalyticsService(db, owner),
    w = widgetConfig({ id: key(), title: '总数', type: 'metric', tableId: t.id, aggregation: 'count' });
  await assert.rejects(service.query({ ...w, type: 'calendar' }), /ANALYTICS_CONFIG_REQUIRED/);
  await assert.rejects(
    service.query({ ...w, aggregation: 'sum', measure: t.f['领用人'] }),
    /ANALYTICS_NUMERIC_REQUIRED/,
  );
  assert.throws(() => widgetConfig({ ...w, color: 'url(test)' }));
  await db.collabRecord.createMany({
    data: Array.from({ length: 10001 }, () => ({
      tableId: t.id,
      createdBy: owner.userId,
      updatedBy: owner.userId,
      ownerId: owner.userId,
      values: {},
    })),
  });
  await assert.rejects(service.query(w), /ANALYTICS_DATA_LIMIT/);
});

test('canonical business tables can be queried in the same analytics snapshot', async () => {
  const org = await db.organization.findFirstOrThrow();
  const root = await drive.createWorkspace({ name: '客户工作区', organizationId: org.id }, key());
  const base = await drive.createBase(root.id, { name: '客户工作表' }, key());
  const table = await drive.createTable(base.id, { name: '客户', source: 'CUSTOMERS' }, key());
  const service = new AnalyticsService(db, owner);
  const data = await service.query(
    widgetConfig({ id: key(), title: '客户数', type: 'metric', tableId: table.id, aggregation: 'count' }),
  );
  assert.equal(data.total, 0);
});
