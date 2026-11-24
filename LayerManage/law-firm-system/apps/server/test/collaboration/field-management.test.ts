import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { FieldManagement } from '../../app/application/collaboration/field-management';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { withFailingCollaborationOutbox } from '../helpers/collaboration-outbox-failure';

let db: PrismaClient, admin: FieldManagement, manager: FieldManagement, reader: FieldManagement;
let tableId: string, baseId: string, titleId: string;
const actor = (userId: string, superAdmin = false): AuthorizationContext => ({ userId, employeeId: null, isSystemSuperAdmin: superAdmin, isSystemAdmin: false,
  grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date() });
const version = async () => (await db.collabTable.findUniqueOrThrow({ where: { id: tableId } })).schemaVersion;
const add = async (name = '自定义说明') => admin.saveField(tableId, undefined, { name, type: 'TEXT', version: await version() }, randomUUID());
const change = async (id: string, action: string, extra = {}) => admin.changeField(tableId, id, { action, version: await version(), ...extra }, randomUUID());
const record = async (id: string, value: string) => admin.saveRecord(tableId, undefined, { schemaVersion: await version(), values: { [titleId]: value, [id]: value } }, randomUUID());

test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const oid = randomUUID();
  const org = await db.organization.create({ data: { id: oid, code: randomUUID(), name: '字段测试', type: 'FIRM', path: '/' + oid } });
  const users = await Promise.all(['admin', 'manager', 'reader'].map(username => db.user.create({ data: { username, password: 'unused' } })));
  admin = new FieldManagement(db, actor(users[0].id, true)); manager = new FieldManagement(db, actor(users[1].id)); reader = new FieldManagement(db, actor(users[2].id));
  const workspace = await admin.createWorkspace({ name: '测试', organizationId: org.id }, randomUUID());
  await db.collabMember.createMany({ data: [ { workspaceId: workspace.id, principalId: users[1].id, role: 'MANAGER', rowScope: 'ALL' }, { workspaceId: workspace.id, principalId: users[2].id, role: 'READER', rowScope: 'ALL' } ] });
  baseId = (await admin.createBase(workspace.id, { name: '字段测试' }, randomUUID())).id;
  tableId = (await admin.createTable(baseId, { name: '通用表格' }, randomUUID())).id;
  titleId = (await admin.describe(tableId)).fields[0].id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });

test('table managers stop/restore fields, retaining values and keeping readers out of management', async () => {
  const f = await add(); const row = await record(f.id, '保留原值');
  await assert.rejects(reader.listFields(tableId), /COLLAB_FORBIDDEN/);
  await manager.changeField(tableId, f.id, { action: 'stop', version: await version() }, randomUUID());
  assert.equal((await admin.describe(tableId)).fields.some(field => field.id === f.id), false);
  assert.equal((await admin.listFields(tableId)).fields.find(field => field.id === f.id)?.stopped, true);
  assert.equal((await db.collabRecord.findUniqueOrThrow({ where: { id: row.id } })).values[f.id], '保留原值');
  await manager.changeField(tableId, f.id, { action: 'restore', version: await version() }, randomUUID());
  assert.ok((await admin.describe(tableId)).fields.some(field => field.id === f.id));
  assert.equal((await admin.record(tableId, row.id)).record.values[f.id], '保留原值');
});
test('restoration rejects active name collisions and stale schema versions', async () => {
  const f = await add(); await change(f.id, 'stop'); await add();
  await assert.rejects(change(f.id, 'restore'), /COLLAB_NAME_OR_ID_CONFLICT/);
  await assert.rejects(admin.changeField(tableId, f.id, { action: 'restore', version: 1 }, randomUUID()), /COLLAB_SCHEMA_CONFLICT/);
});
test('superadmin-only deletion removes current/recycled/history values but preserves other fields and records', async () => {
  const f = await add(); const a = await record(f.id, '当前'), b = await record(f.id, '回收站');
  await db.collabRecord.update({ where: { id: b.id }, data: { archived: true } });
  await change(f.id, 'stop');
  await assert.rejects(manager.previewRemoval(tableId, f.id), /COLLAB_FORBIDDEN/);
  const report = await admin.previewRemoval(tableId, f.id);
  assert.deepEqual(report.blockers, []); assert.equal(report.impact.activeRecords, 1); assert.equal(report.impact.recycledRecords, 1); assert.equal(report.impact.revisions, 2);
  await assert.rejects(manager.changeField(tableId, f.id, { action: 'delete', version: report.version, token: report.token, confirmName: f.id }, randomUUID()), /COLLAB_FORBIDDEN/);
  await assert.rejects(change(f.id, 'delete', { token: report.token, confirmName: '不匹配' }), /COLLAB_FIELD_DELETE_CHANGED/);
  const key = randomUUID(), input = { action: 'delete', version: report.version, token: report.token, confirmName: report.field.name };
  const result = await admin.changeField(tableId, f.id, input, key);
  assert.deepEqual(await admin.changeField(tableId, f.id, input, key), result);
  assert.equal(await db.collabField.count({ where: { id: f.id } }), 0);
  for (const id of [a.id, b.id]) { const row = await db.collabRecord.findUniqueOrThrow({ where: { id } }); assert.equal(Object.hasOwn(row.values as object, f.id), false); assert.ok(row.values[titleId]); }
  assert.ok((await db.collabRevision.findMany()).every(r => !Object.hasOwn(r.changes as object, f.id)));
  const operations = await db.collabRecordOperation.findMany({ where: { tableId } });
  assert.equal(operations.length, 2);
  for (const operation of operations) {
    assert.equal(JSON.stringify(operation.before).includes(f.id), false);
    assert.equal(JSON.stringify(operation.after).includes(f.id), false);
    assert.ok(JSON.stringify(operation.after).includes(titleId));
  }
  assert.equal(await db.operationLog.count({ where: { action: 'WORKSHEET_FIELD_DELETE', targetId: f.id } }), 1);
});
test('deletion preview expires if recycled data changes and rechecks dependencies at execution', async () => {
  const f = await add(); const row = await record(f.id, '原内容'); await change(f.id, 'stop');
  const report = await admin.previewRemoval(tableId, f.id);
  await db.collabRecord.update({ where: { id: row.id }, data: { version: { increment: 1 }, archived: true } });
  await assert.rejects(change(f.id, 'delete', { token: report.token, confirmName: report.field.name }), /COLLAB_FIELD_DELETE_CHANGED/);
  const fresh = await admin.previewRemoval(tableId, f.id);
  await db.collabRule.create({ data: { tableId, name: '新依赖', ownerId: admin.actor.userId, trigger: 'UPDATE', condition: { fieldId: f.id }, action: {} } });
  await assert.rejects(change(f.id, 'delete', { token: fresh.token, confirmName: fresh.field.name }), /COLLAB_FIELD_DEPENDENCIES/);
  assert.equal(await db.collabField.count({ where: { id: f.id } }), 1);
});
test('views, formula fields, dashboards, and grants block stop/delete and old archive API cannot bypass checks', async () => {
  const f = await add();
  const view = (await admin.describe(tableId)).views[0];
  await db.collabView.update({ where: { id: view.id }, data: { config: { groupBy: [f.id] } } });
  assert.match((await admin.previewRemoval(tableId, f.id, 'stop')).blockers.join(), /视图/);
  await assert.rejects(change(f.id, 'stop'), /COLLAB_FIELD_DEPENDENCIES/);
  await assert.rejects(admin.saveField(tableId, f.id, { archived: true, version: await version() }, randomUUID()), /COLLAB_REFERENCED_FIELD/);
  await db.collabView.update({ where: { id: view.id }, data: { config: {} } });
  await db.collabField.create({ data: { tableId, name: '计算', type: 'FORMULA', position: 5, options: { formula: '[' + f.id + '] * 2' } } });
  await db.analyticsDashboard.create({ data: { ownerId: admin.actor.userId, name: '图表', widgets: [{ fieldId: f.id }] } });
  await db.worksheetRolePolicy.upsert({ where: { tableId }, create: { tableId, rules: { example: { fields: { [f.id]: 'READ' } } } }, update: { rules: { example: { fields: { [f.id]: 'READ' } } } } });
  const blockers = (await admin.previewRemoval(tableId, f.id, 'stop')).blockers.join();
  assert.match(blockers, /公式或关联/); assert.match(blockers, /数据分析图表/); assert.match(blockers, /角色字段授权/);
});
test('system presentation edits preserve business identity and only optional fields may stop display', async () => {
  const f = await db.collabField.create({ data: { tableId, name: '地区', position: 10, options: { businessKey: 'intake.region', businessSource: 'CASES' } } });
  await assert.rejects(manager.changeField(tableId, f.id, { action: 'presentation', version: await version(), name: '地区名称' }, randomUUID()), /COLLAB_FORBIDDEN/);
  await change(f.id, 'presentation', { name: '地区名称', helpText: '填写地区' });
  const stored = await db.collabField.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(stored.name, '地区'); assert.equal(stored.options['businessKey'], 'intake.region');
  assert.equal((await admin.describe(tableId)).fields.find(field => field.id === f.id)?.name, '地区名称');
  await change(f.id, 'stop');
  assert.equal((await db.collabField.findUniqueOrThrow({ where: { id: f.id } })).archived, false);
  assert.ok((await admin.tableAccess(tableId)).fields.some(field => field.id === f.id));
  assert.equal((await admin.describe(tableId)).fields.some(field => field.id === f.id), false);
  await change(f.id, 'restore');
  await assert.rejects(change(f.id, 'delete'), /COLLAB_FIELD_DEPENDENCIES/);
  const core = await db.collabField.create({ data: { tableId, name: '主办律师', type: 'USER', position: 11, options: { businessKey: 'lawyerId' } } });
  await assert.rejects(change(core.id, 'stop'), /COLLAB_FIELD_PROTECTED/);
  await assert.rejects(change(titleId, 'stop'), /COLLAB_FIELD_PROTECTED/);
});
test('business extension deletion removes extension revisions without touching business records', async () => {
  const f = await add();
  await db.collabExtension.create({ data: { tableId, recordId: randomUUID(), updatedBy: admin.actor.userId, values: { [f.id]: '扩展值', keep: '保留' }, revisions: { create: { version: 1, actorId: admin.actor.userId, changes: { [f.id]: { before: null, after: '扩展值' } } } } } });
  await change(f.id, 'stop'); const report = await admin.previewRemoval(tableId, f.id);
  assert.equal(report.impact.extensionRecords, 1); assert.equal(report.impact.revisions, 1);
  await change(f.id, 'delete', { token: report.token, confirmName: report.field.name });
  assert.deepEqual((await db.collabExtension.findFirstOrThrow()).values, { keep: '保留' });
  assert.deepEqual((await db.collabExtensionRevision.findFirstOrThrow()).changes, {});
});
test('outbox failure rolls back destructive field changes atomically', async () => {
  const f = await add(); await record(f.id, '必须保留'); await change(f.id, 'stop');
  const report = await admin.previewRemoval(tableId, f.id);
  await withFailingCollaborationOutbox(db, async () => { await assert.rejects(change(f.id, 'delete', { token: report.token, confirmName: report.field.name })); });
  assert.equal(await db.collabField.count({ where: { id: f.id } }), 1);
  assert.equal((await db.collabRecord.findFirstOrThrow()).values[f.id], '必须保留');
});
