import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { expenseFields } from '../../app/application/collaboration/administrative-expenses';
import { standardizeAdministrativeExpenses } from '../../scripts/maintenance/standardize-administrative-expenses';

let db: PrismaClient, admin: DriveService, root: string, workspace: string, base: string, table: string;
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
  await db.organization.create({ data: { id: org, code: key(), name: '费用回归律所', type: 'FIRM', path: '/' + org } });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  root = (await admin.createWorkspace({ name: '律所', organizationId: org }, key())).id;
  workspace = (await admin.provisionModuleWorkspace(root, { source: 'INVENTORY_MOVEMENTS' }, key())).id;
  base = (await admin.createDriveBase(workspace, { name: '行政事务', moduleSource: 'INVENTORY_MOVEMENTS', connectBusiness: true }, key())).id;
  table = (await db.collabTable.findFirstOrThrow({ where: { baseId: base } })).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
async function peer(role: string, self = false, hiddenFields: string[] = []) {
  const user = await db.user.create({ data: { username: key(), password: 'unused' } });
  const businessRole = await db.role.create({ data: { code: key(), name: '行政测试角色' + key(), type: 'BUSINESS' } });
  await db.userRole.create({ data: { userId: user.id, roleId: businessRole.id } });
  await admin.saveMember(workspace, { principalType: 'ROLE', principalId: businessRole.id, role, rowScope: self ? 'SELF' : 'ALL', canCreate: role === 'EDITOR', baseId: base, hiddenFields }, key());
  return new DriveService(db, context(user.id, false, ['inventory.read']));
}

test('expense fields, precise totals, shared CRUD, history and permissions stay consistent', async () => {
  const detail = await admin.describe(table);
  const f = Object.fromEntries(detail.fields.map(f => [f.name, f.id]));
  assert.equal(detail.table.source, 'CUSTOM');
  assert.deepEqual(detail.fields.map(f => [f.name, f.type, f.required]), expenseFields().map(f => [f.name, f.type, f.required]));
  assert.equal(detail.fields[0].writable, false);
  assert.equal(detail.fields[9].writable, false);
  assert.equal(detail.canDeleteRecords, true);
  const editor = await peer('EDITOR');
  const save = (values: Record<string, unknown>, svc = editor) => svc.saveRecord(table, undefined, { schemaVersion: 1,
    values: Object.fromEntries(Object.entries(values).map(([name, value]) => [f[name], value])) }, key());
  const required = { '采购日期': '2026-10-25T16:00:00.000Z', '申请人': '测试申请人', '产品名称': '打印机' };
  await assert.rejects(save({ '数量': 3 }), /COLLAB_REQUIRED_FIELD/);
  await assert.rejects(save({ ...required, '费用金额': '1.00' }), /COLLAB_READONLY_FIELD/);
  const a = await save({ ...required, '数量': 3, '单价': '1234.56', '发票是否收到': '否', '备注': '第一行\n第二行' });
  const b = await save({ ...required, '数量': 0.1, '单价': '0.20' });
  const blank = await save(required);
  const lookup = async (id: string, svc = editor) => (await svc.record(table, id)).record;
  assert.equal((await lookup(a.id)).values[f['费用金额']], '3703.68');
  assert.equal((await lookup(b.id)).values[f['费用金额']], '0.02');
  assert.equal((await lookup(blank.id)).values[f['费用金额']], null);
  assert.deepEqual(await admin.query(table, {}), await editor.query(table, {}));
  assert.deepEqual((await editor.query(table, { config: { filter: { fieldId: f['费用金额'], operator: 'gt', value: 1000 } } })).records.map(r => r.id), [a.id]);
  const changed = await editor.saveRecord(table, a.id, { schemaVersion: 1, version: 1, values: { [f['数量']]: 0 } }, key());
  assert.equal((await lookup(a.id, admin)).values[f['费用金额']], '0.00');
  await editor.reverseRecordOperation(table, changed.operationId, { direction: 'undo' }, key());
  assert.equal((await lookup(a.id)).values[f['费用金额']], '3703.68');
  await editor.reverseRecordOperation(table, changed.operationId, { direction: 'redo' }, key());
  assert.equal((await lookup(a.id)).values[f['费用金额']], '0.00');
  const reader = await peer('READER');
  assert.equal((await reader.query(table, {})).total, 3);
  await assert.rejects(save(required, reader), /COLLAB_FORBIDDEN/);
  await assert.rejects(reader.saveRecord(table, b.id, { schemaVersion: 1, version: 1, values: { [f['数量']]: 10 } }, key()), /COLLAB_FORBIDDEN/);
  await assert.rejects(reader.deleteRecords(table, { schemaVersion: 1, records: [{ id: b.id, version: 1 }] }, key()), /COLLAB_FORBIDDEN/);
  const self = await peer('EDITOR', true);
  assert.equal((await self.query(table, {})).total, 0);
  const own = await save(required, self);
  assert.equal((await self.query(table, {})).total, 1);
  await assert.rejects(self.record(table, a.id), /COLLAB_NOT_FOUND/);
  const hidden = await peer('READER', false, [f['单价']]);
  const hiddenRow = await lookup(a.id, hidden);
  assert.equal(hiddenRow.values[f['单价']], undefined);
  assert.equal(hiddenRow.values[f['费用金额']], null);
  const denied = new DriveService(db, context(editor.actor.userId, false, []));
  await assert.rejects(denied.query(table, {}), /COLLAB_FORBIDDEN/);
  const active = (await editor.query(table, {})).records;
  await editor.deleteRecords(table, { schemaVersion: 1, records: active.filter(r => r.id !== own.id).map(r => ({ id: r.id, version: r.version })) }, key());
  assert.equal((await admin.query(table, {})).total, 1);
  assert.equal(await db.collabRecord.count({ where: { tableId: table, archived: true } }), 3);
  for (const op of (await editor.recordOperations(table, { trash: 'true' })).rows)
    await editor.reverseRecordOperation(table, op.id, { direction: 'undo' }, key());
  assert.equal((await editor.query(table, {})).total, 4);
  assert.equal((await lookup(b.id)).values[f['费用金额']], '0.02');
  const next = await save(required);
  assert.equal((await lookup(next.id)).values[f['序号']], 5);
  assert.ok((await admin.record(table, a.id)).revisions.length >= 4);
  assert.ok(await db.operationLog.count({ where: { userId: editor.actor.userId } }) > 0);
});

test('legacy expense migration preserves identity and access while isolating unchanged inventory data', async () => {
  const inventoryWorkspace = (await admin.provisionModuleWorkspace(root, { source: 'INVENTORY_ITEMS' }, key())).id;
  assert.notEqual(workspace, inventoryWorkspace);
  const low = (await admin.createDriveBase(inventoryWorkspace, { name: '低值易耗品', moduleSource: 'INVENTORY_ITEMS' }, key())).id;
  const stock = await admin.createTable(low, { name: '办公用品库存表', template: 'OFFICE_STOCK' }, key());
  const stockFields = (await admin.describe(stock.id)).fields;
  await admin.saveRecord(stock.id, undefined, { schemaVersion: 1, values: { [stockFields.find(f => f.name === '产品名称')!.id]: '保持不变' } }, key());
  const snapshot = () => db.collabBase.findUnique({ where: { id: low }, include: { tables: { include: { fields: true, records: true, views: true } } } });
  const before = await snapshot();
  await assert.rejects(admin.createTable(low, { name: '错误位置', template: 'ADMIN_EXPENSES' }, key()), /COLLAB_MODULE_WORKSPACE_MISMATCH/);
  await assert.rejects(admin.createTable(base, { name: '错误连接', source: 'INVENTORY_MOVEMENTS' }, key()), /COLLAB_INVALID_SOURCE/);
  const reader = await peer('READER');
  // Model a pre-upgrade expense base in the inventory workspace, with old connection fields.
  await db.collabField.deleteMany({ where: { tableId: table } });
  await db.collabField.create({ data: { tableId: table, name: '出入库编号', type: 'TEXT' } });
  await db.collabTable.update({ where: { id: table }, data: { source: 'INVENTORY_MOVEMENTS', inventoryKind: null } });
  const sourceWorkspace = await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspace }, include: { members: true } });
  for (const member of sourceWorkspace.members) {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, workspaceId: _workspaceId, ...data } = member;
    void _id; void _createdAt; void _updatedAt; void _workspaceId;
    await db.collabMember.upsert({ where: { workspaceId_principalType_principalId: { workspaceId: inventoryWorkspace, principalType: data.principalType, principalId: data.principalId } }, create: { ...data, workspaceId: inventoryWorkspace }, update: data });
  }
  const policy = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).accessPolicy;
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE drive_node DISABLE TRIGGER drive_parent_guard');
    await tx.collabBase.update({ where: { id: base }, data: { workspaceId: inventoryWorkspace } });
    await tx.$executeRawUnsafe('ALTER TABLE drive_node ENABLE TRIGGER drive_parent_guard');
  });
  assert.equal((await standardizeAdministrativeExpenses(db, admin.actor.userId))[0].changed, true);
  await standardizeAdministrativeExpenses(db, admin.actor.userId, true);
  const migrated = await db.collabBase.findUniqueOrThrow({ where: { id: base } });
  assert.equal(migrated.workspaceId, workspace);
  assert.deepEqual(migrated.accessPolicy, policy);
  const detail = await reader.describe(table);
  assert.equal(detail.table.source, 'CUSTOM');
  assert.deepEqual(detail.fields.map(f => f.name), expenseFields().map(f => f.name));
  assert.equal(detail.access.level, 1);
  assert.deepEqual((await reader.businessTables({ source: 'INVENTORY_MOVEMENTS', inventoryKind: 'ADMIN_EXPENSES' })).tables.map(t => t.id), [table]);
  assert.ok(!(await admin.businessTables({ source: 'INVENTORY_ITEMS' })).tables.some(t => t.id === table));
  assert.ok(!(await admin.businessTables({ source: 'INVENTORY_MOVEMENTS' })).tables.some(t => t.baseId === low));
  assert.deepEqual(await snapshot(), before);
  assert.equal((await standardizeAdministrativeExpenses(db, admin.actor.userId, true))[0].changed, false);
});
