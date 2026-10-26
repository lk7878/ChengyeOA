import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { inventoryNames, InventoryKind, officeItems, officeInventoryKinds } from '../../app/application/collaboration/inventory-worksheets';
import { standardizeOfficeInventory } from '../../scripts/maintenance/standardize-office-inventory';

let db: PrismaClient, admin: DriveService, workspace: string, base: string;
const peerPrincipals = new Map<string, string>();
const context = (userId: string, superAdmin = true, codes = PERMISSION_CATALOG.map(p => p.code)): AuthorizationContext => ({
  userId, employeeId: null, isSystemSuperAdmin: superAdmin, isSystemAdmin: false, permissionCodes: codes,
  evaluatedAt: new Date(), fieldRules: [], grants: PERMISSION_CATALOG.filter(p => codes.includes(p.code)).map(p => ({
    sourceType: 'ROLE', sourceId: 'fixture', permissionCode: p.code, resource: p.resource, scopeIds: ['ALL'], validUntil: null,
  })),
});
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({ data: { id: org, code: key(), name: '物品回归律所', type: 'FIRM', path: '/' + org } });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  const root = await admin.createWorkspace({ name: '律所', organizationId: org }, key());
  workspace = (await admin.provisionModuleWorkspace(root.id, { source: 'INVENTORY_ITEMS' }, key())).id;
  base = (await admin.createDriveBase(workspace, { name: '物品库存工作表', moduleSource: 'INVENTORY_ITEMS' }, key())).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
async function sheet(kind: InventoryKind) {
  const { id } = await admin.createTable(base, { name: inventoryNames[kind], template: kind }, key());
  const detail = await admin.describe(id);
  const f = Object.fromEntries(detail.fields.map(f => [f.name, f.id]));
  return { id, f, detail };
}
async function save(t: Awaited<ReturnType<typeof sheet>>, values: Record<string, unknown>, svc = admin) {
  return svc.saveRecord(t.id, undefined, { schemaVersion: t.detail.table.schemaVersion,
    values: Object.fromEntries(Object.entries(values).map(([name, v]) => [t.f[name], v])) }, key());
}
async function peer(role: string, self = false) {
  const user = await db.user.create({ data: { username: key(), password: 'unused' } });
  const businessRole = await db.role.create({ data: { code: key(), name: '物品测试角色' + key(), type: 'BUSINESS' } });
  await db.userRole.create({ data: { userId: user.id, roleId: businessRole.id } });
  peerPrincipals.set(user.id, businessRole.id);
  await admin.saveMember(workspace, { principalType: 'ROLE', principalId: businessRole.id, role, rowScope: self ? 'SELF' : 'ALL', canCreate: role === 'EDITOR', baseId: base }, key());
  return new DriveService(db, context(user.id, false, ['inventory.read']));
}
test('office register requires intake fields, supports 35 quantities and recomputes read-only statistics through edit/delete/undo', async () => {
  const register = await sheet('OFFICE_REGISTER'), summary = await sheet('OFFICE_SUMMARY');
  assert.equal(register.detail.fields.length, 39);
  assert.deepEqual(register.detail.fields.slice(0, 4).map(f => [f.name, f.type, f.required]), [
    ['序号', 'AUTONUMBER', false], ['领取日期', 'DATETIME', true], ['领取部门', 'SINGLE_SELECT', false], ['领用人', 'TEXT', true],
  ]);
  assert.equal(register.detail.fields[0].writable, false);
  const editor = await peer('EDITOR');
  await assert.rejects(save(register, { '15mm夹子': 10 }, editor), /COLLAB_REQUIRED_FIELD/);
  const data = { '领取日期': '2026-10-26T08:00:00+08:00', '领用人': '测试经办人', '领取部门': '律师部',
    ...Object.fromEntries(officeItems.map((n, i) => [n, i + 0.5])) };
  const a = await save(register, data, editor);
  const b = await save(register, data, editor);
  const rows = async (svc = admin) => (await svc.query(summary.id, { pageSize: 200 })).records;
  for (const [i, r] of (await rows()).entries()) {
    assert.equal(r.values[summary.f['物品名称']], officeItems[i]);
    assert.equal(r.values[summary.f['领用数量']], 2 * (i + 0.5));
  }
  const update = await editor.saveRecord(register.id, a.id, { schemaVersion: 1, version: 1, values: { [register.f['15mm夹子']]: 20 } }, key());
  assert.equal((await rows())[0].values[summary.f['领用数量']], 20.5);
  assert.deepEqual(await rows(), await rows(editor));
  await editor.reverseRecordOperation(register.id, update.operationId, { direction: 'undo' }, key());
  assert.equal((await rows())[0].values[summary.f['领用数量']], 1);
  await editor.reverseRecordOperation(register.id, update.operationId, { direction: 'redo' }, key());
  const active = (await editor.query(register.id, {})).records;
  await editor.deleteRecords(register.id, { schemaVersion: 1, records: active.map(r => ({ id: r.id, version: r.version })) }, key());
  assert.equal((await rows())[0].values[summary.f['领用数量']], 0);
  const trash = await editor.recordOperations(register.id, { trash: 'true' });
  for (const op of trash.rows) await editor.reverseRecordOperation(register.id, op.id, { direction: 'undo' }, key());
  assert.equal((await rows())[0].values[summary.f['领用数量']], 20.5);
  const c = await save(register, data, editor);
  assert.equal((await editor.record(register.id, c.id)).record.values[register.f['序号']], 3);
  assert.ok((await admin.record(register.id, b.id)).revisions.length > 1);
  const stats = await admin.describe(summary.id);
  assert.equal(stats.access.canCreate, false);
  assert.equal(stats.canDeleteRecords, false);
  assert.ok(stats.fields.every(f => !f.writable));
  await assert.rejects(save(summary, { '物品名称': '15mm夹子' }), /COLLAB_READONLY_FIELD/);
  await assert.rejects(admin.saveRecord(summary.id, (await rows())[0].id, { schemaVersion: 1, version: 1, values: { [summary.f['领用数量']]: 99 } }, key()), /COLLAB_READONLY_FIELD/);
  await assert.rejects(admin.deleteRecords(summary.id, { schemaVersion: 1, records: [{ id: (await rows())[0].id, version: 1 }] }, key()), /COLLAB_READONLY_FIELD/);
  const other = await peer('EDITOR', true);
  assert.equal((await rows(other))[0].values[summary.f['领用数量']], 0);
  const reader = await peer('READER');
  await assert.rejects(save(register, data, reader), /COLLAB_FORBIDDEN/);
  const noPermission = new DriveService(db, context(editor.actor.userId, false, []));
  await assert.rejects(noPermission.query(register.id, {}), /COLLAB_FORBIDDEN/);
});

test('stock joins exact product names across visible movement rows; formulas, permissions and uniqueness survive restore', async () => {
  const inbound = await sheet('OFFICE_INBOUND'), outbound = await sheet('OFFICE_OUTBOUND'), stock = await sheet('OFFICE_STOCK');
  assert.deepEqual(inbound.detail.fields.map(f => f.name), ['序号', '日期', '产品规格', '产品名称', '单位', '货架', '入库数量', '入库人', '备注']);
  assert.deepEqual(outbound.detail.fields.map(f => f.name), ['序号', '日期', '产品规格', '产品名称', '单位', '货架', '出库数量', '出库人', '备注']);
  const editor = await peer('EDITOR');
  const product = await save(stock, { '产品名称': '打印纸', '备注': '原备注' }, editor);
  const lookup = async (svc = admin) => (await svc.record(stock.id, product.id)).record.values;
  const move = { '日期': '2026-10-26T00:00:00Z', '产品规格': '包', '产品名称': '打印纸', '单位': '包', '货架': '002/004', '备注': '多行\n记录' };
  await assert.rejects(save(inbound, { ...move, '入库数量': 5 }, editor), /COLLAB_REQUIRED_FIELD/);
  const a = await save(inbound, { ...move, '入库数量': 12.5, '入库人': '甲' }, editor);
  await save(outbound, { ...move, '出库数量': 2.5, '出库人': '乙' }, editor);
  await save(inbound, { ...move, '产品名称': '打印纸A', '入库数量': 900, '入库人': '甲' });
  let values = await lookup();
  assert.equal(values[stock.f['入库数量']], 12.5);
  assert.equal(values[stock.f['出库数量']], 2.5);
  assert.equal(values[stock.f['库存数量']], 10);
  assert.deepEqual(values, await lookup(editor));
  const edited = await editor.saveRecord(inbound.id, a.id, { schemaVersion: 1, version: 1, values: { [inbound.f['入库数量']]: 20 } }, key());
  assert.equal((await lookup())[stock.f['库存数量']], 17.5);
  const filtered = await admin.query(stock.id, { config: { filter: { fieldId: stock.f['库存数量'], operator: 'gt', value: 15 } } });
  assert.equal(filtered.total, 1);
  await editor.reverseRecordOperation(inbound.id, edited.operationId, { direction: 'undo' }, key());
  assert.equal((await lookup())[stock.f['库存数量']], 10);
  const current = (await editor.record(inbound.id, a.id)).record;
  await editor.deleteRecords(inbound.id, { schemaVersion: 1, records: [{ id: a.id, version: current.version }] }, key());
  assert.equal((await lookup())[stock.f['库存数量']], -2.5);
  for (const op of (await editor.recordOperations(inbound.id, { trash: 'true' })).rows)
    await editor.reverseRecordOperation(inbound.id, op.id, { direction: 'undo' }, key());
  assert.equal((await lookup())[stock.f['库存数量']], 10);
  for (const name of ['入库数量', '出库数量', '库存数量']) {
    assert.equal(stock.detail.fields.find(f => f.name === name)?.writable, false);
    await assert.rejects(editor.saveRecord(stock.id, product.id, { schemaVersion: 1, version: 1, values: { [stock.f[name]]: 100 } }, key()), /COLLAB_READONLY_FIELD/);
  }
  const note = await editor.saveRecord(stock.id, product.id, { schemaVersion: 1, version: 1, values: { [stock.f['备注']]: '保存新备注' } }, key());
  assert.equal((await lookup())[stock.f['备注']], '保存新备注');
  await assert.rejects(save(stock, { '产品名称': ' 打印纸 ' }, editor), /COLLAB_INVENTORY_PRODUCT_DUPLICATE/);
  const self = await peer('EDITOR', true);
  const own = await save(stock, { '产品名称': '独立物品' }, self);
  await save(inbound, { ...move, '产品名称': '独立物品', '入库数量': 90, '入库人': '管理员' });
  await save(inbound, { ...move, '产品名称': '独立物品', '入库数量': 8, '入库人': '本人' }, self);
  assert.equal((await self.record(stock.id, own.id)).record.values[stock.f['库存数量']], 8);
  assert.equal((await admin.record(stock.id, own.id)).record.values[stock.f['库存数量']], 98);
  await db.collabMember.updateMany({ where: { principalId: peerPrincipals.get(self.actor.userId)!, workspaceId: workspace }, data: { hiddenFields: [inbound.f['入库数量']] } });
  await assert.rejects(self.record(stock.id, own.id), /COLLAB_FORBIDDEN/);
  await editor.deleteRecords(stock.id, { schemaVersion: 1, records: [{ id: product.id, version: note.version }] }, key());
  const deleted = (await editor.recordOperations(stock.id, { trash: 'true' })).rows[0];
  const replacement = await save(stock, { '产品名称': '打印纸' }, editor);
  await assert.rejects(editor.reverseRecordOperation(stock.id, deleted.id, { direction: 'undo' }, key()), /COLLAB_INVENTORY_PRODUCT_DUPLICATE/);
  await editor.deleteRecords(stock.id, { schemaVersion: 1, records: [{ id: replacement.id, version: 1 }] }, key());
  await editor.reverseRecordOperation(stock.id, deleted.id, { direction: 'undo' }, key());
  values = await lookup();
  assert.equal(values[stock.f['库存数量']], 10);
  assert.equal(values[stock.f['备注']], '保存新备注');
});

test('office migration retains identities and grants, imports complete catalogs once, and stocktake edits are reversible', async () => {
  const original = new Map<string, string>();
  for (const kind of officeInventoryKinds) {
    const t = await admin.createTable(base, { name: inventoryNames[kind] }, key());
    original.set(kind, t.id);
  }
  const reader = await peer('READER');
  const memberships = await db.collabMember.findMany({ where: { workspaceId: workspace } });
  await standardizeOfficeInventory(db, admin.actor.userId, true);
  assert.deepEqual(await db.collabMember.findMany({ where: { workspaceId: workspace } }), memberships);
  const counts = [39, 2, 9, 9, 9, 8];
  for (const [i, kind] of officeInventoryKinds.entries()) {
    const t = await admin.describe(original.get(kind)!);
    assert.equal(t.fields.length, counts[i]);
    assert.equal(t.table.inventoryKind, kind);
    assert.ok(!t.fields.some(f => f.name === '标题'));
  }
  const stockId = original.get('OFFICE_STOCK')!, takeId = original.get('OFFICE_STOCKTAKE')!;
  const stockFields = Object.fromEntries((await admin.describe(stockId)).fields.map(f => [f.name, f.id]));
  const stocks = await admin.query(stockId, { pageSize: 200 });
  assert.equal(stocks.total, 65);
  assert.deepEqual(stocks.records.slice(-3).map(r => r.values[stockFields['序号']]), [63, 69, 70]);
  assert.ok(stocks.records.every(r => r.values[stockFields['库存数量']] === 0));
  assert.equal((await reader.query(stockId, { pageSize: 200 })).total, 65);
  const take = await admin.describe(takeId);
  const f = Object.fromEntries(take.fields.map(f => [f.name, f.id]));
  assert.deepEqual(take.fields.map(f => f.name), ['列1', '类别', '产品名称', '产品规格', '货架', '期初库存量', '盘存时数量', '备注']);
  const rows = (await admin.query(takeId, { pageSize: 200 })).records;
  assert.equal(rows.length, 63);
  assert.equal(rows[22].values[f['备注']], '2000以上');
  assert.equal(rows[54].values[f['备注']], '红10本蓝5本');
  assert.equal(rows[24].values[f['产品规格']], '10个/包');
  assert.equal(rows[28].values[f['货架']], '网2-012、008');
  assert.ok(rows.every(r => r.values[f['盘存时数量']] === null && r.values[f['期初库存量']] === null));
  const updated = await admin.saveRecord(takeId, rows[0].id, { schemaVersion: take.table.schemaVersion, version: 1, values: { [f['盘存时数量']]: 25, [f['备注']]: '盘点完成' } }, key());
  await admin.reverseRecordOperation(takeId, updated.operationId, { direction: 'undo' }, key());
  assert.equal((await admin.record(takeId, rows[0].id)).record.values[f['盘存时数量']], null);
  await admin.reverseRecordOperation(takeId, updated.operationId, { direction: 'redo' }, key());
  assert.equal((await admin.record(takeId, rows[0].id)).record.values[f['盘存时数量']], 25);
  const r = (await admin.record(takeId, rows[0].id)).record;
  await admin.deleteRecords(takeId, { schemaVersion: take.table.schemaVersion, records: [{ id: r.id, version: r.version }] }, key());
  const auditCount = await db.operationLog.count();
  await standardizeOfficeInventory(db, admin.actor.userId, true);
  assert.equal(await db.operationLog.count(), auditCount);
  assert.equal((await admin.query(takeId, { pageSize: 200 })).total, 62);
  assert.equal((await admin.query(stockId, { pageSize: 200 })).total, 65);
  assert.equal((await admin.query(original.get('OFFICE_SUMMARY')!, { pageSize: 200 })).total, 35);
  await assert.rejects(admin.configureLifecycle(original.get('OFFICE_INBOUND')!, { kind: 'AFTER_SALES', schemaVersion: 2 }, key()), /COLLAB_SCHEMA_CONFLICT/);
});
