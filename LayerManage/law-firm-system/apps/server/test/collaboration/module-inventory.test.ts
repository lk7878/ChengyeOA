import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { moduleGroups } from '../../app/application/collaboration/module-workspaces';
import { inventoryItems } from '../../app/application/collaboration/inventory-worksheets';
import { standardizeModuleInventory } from '../../scripts/maintenance/standardize-module-inventory';

let db: PrismaClient, admin: DriveService, root: string;
const context = (
  userId: string,
  codes = PERMISSION_CATALOG.map((p) => p.code),
  superAdmin = true,
): AuthorizationContext => ({
  userId,
  employeeId: null,
  isSystemSuperAdmin: superAdmin,
  isSystemAdmin: false,
  permissionCodes: codes,
  evaluatedAt: new Date(),
  fieldRules: [],
  grants: PERMISSION_CATALOG.filter((p) => codes.includes(p.code)).map((p) => ({
    sourceType: 'ROLE',
    sourceId: 'fixture',
    permissionCode: p.code,
    resource: p.resource,
    scopeIds: ['ALL'],
    validUntil: null,
  })),
});
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({
    data: { id: org, code: key(), name: '回归律所', type: 'FIRM', path: '/' + org },
  });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  root = (await admin.createWorkspace({ name: '案件管理', organizationId: org }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

async function workbook() {
  const workspace = await admin.provisionModuleWorkspace(root, { source: 'INVENTORY_ITEMS' }, key());
  const base = await admin.createDriveBase(
    workspace.id,
    { name: '物品工作表', moduleSource: 'INVENTORY_ITEMS' },
    key(),
  );
  const register = await admin.createTable(
    base.id,
    { name: '定制物品领用登记表', template: 'INVENTORY_REGISTER' },
    key(),
  );
  const summary = await admin.createTable(
    base.id,
    { name: '定制物品领用统计', template: 'INVENTORY_SUMMARY' },
    key(),
  );
  return { workspace: workspace.id, base: base.id, register: register.id, summary: summary.id };
}
test('module workspace options, binding validation and role access cover every business source', async () => {
  for (const [group, definition] of Object.entries(moduleGroups)) {
    for (const source of definition.sources) {
      const selected = await admin.provisionModuleWorkspace(root, { source }, key());
      const options = await admin.listWorkspaces({ source });
      assert.equal(options.workspaces.length, 1);
      assert.equal(options.workspaces[0].id, selected.id);
      assert.equal(options.workspaces[0].moduleGroup, group);
    }
  }
  const inventory = (await admin.listWorkspaces({ source: 'INVENTORY_ITEMS' })).workspaces[0];
  const finance = (await admin.listWorkspaces({ source: 'COSTS' })).workspaces[0];
  await assert.rejects(
    admin.createDriveBase(inventory.id, { name: '错误归属', moduleSource: 'COSTS' }, key()),
    /COLLAB_MODULE_WORKSPACE_MISMATCH/,
  );
  const base = await admin.createDriveBase(finance.id, { name: '财务工作表', moduleSource: 'COSTS' }, key());
  await assert.rejects(
    admin.saveBaseModule(base.id, { moduleSource: 'CASES', version: 1 }, key()),
    /COLLAB_MODULE_WORKSPACE_MISMATCH/,
  );
  await assert.rejects(
    admin.createTable(base.id, { name: '越界连接', source: 'INVENTORY_ITEMS' }, key()),
    /COLLAB_MODULE_WORKSPACE_MISMATCH/,
  );
  const user = await db.user.create({ data: { username: 'limited', password: 'unused' } });
  for (const workspaceId of [finance.id, inventory.id])
    await db.collabMember.create({
      data: { workspaceId, principalId: user.id, role: 'MANAGER', rowScope: 'ALL' },
    });
  const limited = new DriveService(db, context(user.id, ['inventory.read'], false));
  assert.deepEqual(
    (await limited.listWorkspaces()).workspaces.map((w) => w.id),
    [inventory.id],
  );
  await assert.rejects(limited.listTables(base.id), /COLLAB_FORBIDDEN/);
  await assert.rejects(limited.describe(base.tableId), /COLLAB_FORBIDDEN/);
  await assert.rejects(limited.provisionModuleWorkspace(root, { source: 'COSTS' }, key()));
});

test('inventory edits, deletion, undo/redo recompute scoped read-only totals and retain numbering', async () => {
  const w = await workbook();
  const detail = await admin.describe(w.register);
  assert.deepEqual(
    detail.fields.map((f) => f.name),
    ['序号', '领取日期', '领取部门', '领用人', ...inventoryItems],
  );
  const f = Object.fromEntries(detail.fields.map((f) => [f.name, f.id]));
  assert.equal(detail.fields[0].writable, false);
  assert.deepEqual(
    (detail.fields[2].options as { choices: Array<{ id: string }> }).choices.map((c) => c.id),
    ['侵权中心', '律师部', '行政后勤', '大数据中心'],
  );
  const values = Object.fromEntries(inventoryItems.map((name, i) => [f[name], i + 1]));
  const a = await admin.saveRecord(
    w.register,
    undefined,
    {
      schemaVersion: 1,
      values: {
        ...values,
        [f['领用人']]: '甲',
        [f['领取日期']]: '2026-10-23T02:00:00Z',
        [f['领取部门']]: '律师部',
      },
    },
    key(),
  );
  const b = await admin.saveRecord(w.register, undefined, { schemaVersion: 1, values }, key());
  const stats = await admin.describe(w.summary);
  const sf = Object.fromEntries(stats.fields.map((f) => [f.name, f.id]));
  assert.ok(stats.fields.every((f) => !f.writable));
  assert.equal(stats.canDeleteRecords, false);
  const totals = async (svc = admin) => (await svc.query(w.summary, {})).records;
  const rows = await totals();
  assert.equal(rows.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(rows[i].values[sf['物品名称']], inventoryItems[i]);
    assert.equal(rows[i].values[sf['领用数量']], 2 * (i + 1));
  }
  assert.equal((await admin.record(w.register, a.id)).record.values[f['序号']], 1);
  assert.equal((await admin.record(w.register, b.id)).record.values[f['序号']], 2);
  await assert.rejects(
    admin.saveRecord(w.register, a.id, { schemaVersion: 1, version: 1, values: { [f['序号']]: 123 } }, key()),
    /COLLAB_READONLY_FIELD/,
  );
  await assert.rejects(
    admin.saveRecord(
      w.summary,
      rows[0].id,
      { schemaVersion: 1, version: 1, values: { [sf['领用数量']]: 999 } },
      key(),
    ),
    /COLLAB_READONLY_FIELD/,
  );
  await assert.rejects(
    admin.deleteRecords(w.summary, { schemaVersion: 1, records: [{ id: rows[0].id, version: 1 }] }, key()),
    /COLLAB_READONLY_FIELD/,
  );
  const updated = await admin.saveRecord(
    w.register,
    a.id,
    { schemaVersion: 1, version: 1, values: { [f['档案袋']]: 100 } },
    key(),
  );
  assert.equal((await totals())[0].values[sf['领用数量']], 101);
  await admin.reverseRecordOperation(w.register, updated.operationId, { direction: 'undo' }, key());
  assert.equal((await totals())[0].values[sf['领用数量']], 2);
  await admin.reverseRecordOperation(w.register, updated.operationId, { direction: 'redo' }, key());
  const active = (await admin.query(w.register, {})).records;
  await admin.deleteRecords(
    w.register,
    { schemaVersion: 1, records: active.map((r) => ({ id: r.id, version: r.version })) },
    key(),
  );
  assert.equal((await totals())[0].values[sf['领用数量']], 0);
  const history = await admin.recordOperations(w.register, { trash: 'true' });
  for (const op of history.rows)
    await admin.reverseRecordOperation(w.register, op.id, { direction: 'undo' }, key());
  assert.equal((await totals())[0].values[sf['领用数量']], 101);
  const c = await admin.saveRecord(w.register, undefined, { schemaVersion: 1, values: {} }, key());
  assert.equal((await admin.record(w.register, c.id)).record.values[f['序号']], 3);
  const filter = await admin.query(w.summary, {
    config: { filter: { fieldId: sf['领用数量'], operator: 'gt', value: 50 } },
  });
  assert.equal(filter.total, 1);
  assert.equal((await admin.record(w.summary, rows[0].id)).record.values[sf['领用数量']], 101);
  const copy = await admin.mutateTable(w.summary, { duplicate: true, name: '统计副本', version: 1 }, key());
  assert.equal((await admin.query(copy.id, {})).total, 10);
  assert.ok((await db.collabRevision.count({ where: { recordId: a.id } })) > 3);
  assert.ok((await db.collabEvent.count({ where: { baseId: w.base, kind: 'record.updated' } })) > 0);
  const person = await db.user.create({ data: { username: 'editor', password: 'unused' } });
  const role = await db.role.create({
    data: { code: 'INVENTORY_EDITOR', name: '物品编辑', type: 'BUSINESS' },
  });
  await db.userRole.create({ data: { userId: person.id, roleId: role.id } });
  await admin.saveMember(
    w.workspace,
    {
      principalType: 'ROLE',
      principalId: role.id,
      role: 'EDITOR',
      canCreate: true,
      rowScope: 'SELF',
      baseId: w.base,
    },
    key(),
  );
  const editor = new DriveService(db, context(person.id, ['inventory.read'], false));
  assert.equal((await totals(editor))[0].values[sf['领用数量']], 0);
  const own = await editor.saveRecord(
    w.register,
    undefined,
    { schemaVersion: 1, values: { [f['档案袋']]: 7 } },
    key(),
  );
  assert.equal((await totals(editor))[0].values[sf['领用数量']], 7);
  assert.equal((await totals())[0].values[sf['领用数量']], 108);
  await db.collabMember.updateMany({
    where: { workspaceId: w.workspace, principalId: role.id },
    data: { rowScope: 'ALL', role: 'READER', hiddenFields: [f['档案袋']] },
  });
  assert.equal((await totals(editor))[0].values[sf['领用数量']], 0);
  await assert.rejects(
    editor.saveRecord(
      w.register,
      own.id,
      { schemaVersion: 1, version: 1, values: { [f['案卷盒']]: 5 } },
      key(),
    ),
    /COLLAB_FORBIDDEN/,
  );
});

test('maintenance preserves table IDs, ACLs and history, and is idempotent', async () => {
  const base = await admin.createDriveBase(
    root,
    { name: '物品库存工作表', moduleSource: 'INVENTORY_ITEMS', connectBusiness: true },
    key(),
  );
  await db.collabTable.update({ where: { id: base.tableId }, data: { name: '定制物品领用登记表' } });
  const summary = await admin.createTable(base.id, { name: '领定制物品领用统计' }, key());
  const preview = await standardizeModuleInventory(db, admin.actor.userId);
  assert.ok(preview.length);
  assert.equal((await db.collabBase.findUniqueOrThrow({ where: { id: base.id } })).workspaceId, root);
  await standardizeModuleInventory(db, admin.actor.userId, true);
  const now = await db.collabBase.findUniqueOrThrow({
    where: { id: base.id },
    include: { workspace: true, driveNode: true },
  });
  assert.equal(now.workspace.moduleGroup, 'INVENTORY');
  assert.equal(now.driveNode?.workspaceId, now.workspaceId);
  assert.equal((await admin.describe(base.tableId)).fields.length, 14);
  assert.equal((await admin.describe(summary.id)).table.name, '定制物品领用统计');
  assert.equal((await admin.query(summary.id, {})).total, 10);
  const count = await db.operationLog.count();
  await standardizeModuleInventory(db, admin.actor.userId, true);
  assert.equal(await db.operationLog.count(), count);
  assert.equal((await admin.query(summary.id, {})).total, 10);
});
