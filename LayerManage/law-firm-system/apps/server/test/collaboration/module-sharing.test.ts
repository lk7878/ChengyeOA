import { retiredSources } from '../../app/domain/module-availability';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { domainSources } from '../../app/application/crm/workspace-domain-source';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';

const key = () => randomUUID();
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
let db: PrismaClient, owner: DriveService, reader: DriveService, editor: DriveService;
let workspace: string, readerRole: string, editorRole: string;
const context = (userId: string, admin = false): AuthorizationContext => ({
  userId,
  employeeId: null,
  isSystemSuperAdmin: admin,
  isSystemAdmin: false,
  permissionCodes: admin ? PERMISSION_CATALOG.map((p) => p.code) : ['case.read'],
  grants: [],
  fieldRules: [],
  evaluatedAt: new Date(),
});
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({
    data: { id: org, code: key(), name: '模块测试', type: 'FIRM', path: '/' + org },
  });
  const users = [];
  for (const name of ['owner', 'reader', 'editor'])
    users.push(await db.user.create({ data: { username: name, password: 'unused' } }));
  owner = new DriveService(db, context(users[0].id, true));
  reader = new DriveService(db, context(users[1].id));
  editor = new DriveService(db, context(users[2].id));
  readerRole = (await db.role.create({ data: { code: 'READER', name: '阅读角色', type: 'BUSINESS' } })).id;
  editorRole = (await db.role.create({ data: { code: 'EDITOR', name: '编辑角色', type: 'BUSINESS' } })).id;
  await db.userRole.createMany({
    data: [
      { userId: users[1].id, roleId: readerRole },
      { userId: users[2].id, roleId: editorRole },
    ],
  });
  workspace = (await owner.createWorkspace({ name: '案件管理', organizationId: org }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

async function share(roleId: string, role: string, baseId: string, rowScope = 'ALL') {
  return owner.saveMember(
    workspace,
    { principalType: 'ROLE', principalId: roleId, role, rowScope, baseId },
    key(),
  );
}
test('module creation connects real sources atomically and keeps business connection owner-only', async () => {
  for (const source of ['LEADS', 'FOLLOWS', ...Object.keys(domainSources)]) {
    const requestKey = key();
    const input = { name: source, moduleSource: source, connectBusiness: true };
    if (retiredSources.includes(source)) {
      await assert.rejects(owner.createDriveBase(workspace, input, requestKey), /MODULE_RETIRED/);
      continue;
    }
    const dedicated = ['INVENTORY_STOCKTAKES', 'INVENTORY_MOVEMENTS'].includes(source);
    const targetWorkspace = dedicated ? (await owner.provisionModuleWorkspace(workspace, { source }, key())).id : workspace;
    const result = await owner.createDriveBase(targetWorkspace, input, requestKey);
    assert.deepEqual(await owner.createDriveBase(targetWorkspace, input, requestKey), result);
    assert.equal((await db.collabTable.findUniqueOrThrow({ where: { id: result.tableId } })).source, dedicated ? 'CUSTOM' : source);
    assert.ok((await owner.describe(result.tableId)).fields.length > 0, source);
    assert.equal((await db.collabRecord.count({ where: { tableId: result.tableId } })), 0);
  }
  const base = await owner.createDriveBase(workspace, { name: '可分享表' }, key());
  await share(editorRole, 'EDITOR', base.id);
  const before = await db.collabBase.count();
  await assert.rejects(editor.createDriveBase(workspace, { name: '越权业务连接', moduleSource: 'CASES', connectBusiness: true }, key()), code('COLLAB_FORBIDDEN'));
  assert.equal(await db.collabBase.count(), before);
});

test('custom module tables are discoverable; private tables stay private; revocation and disabled roles remove access', async () => {
  const base = await owner.createDriveBase(workspace, { name: '案件台账', moduleSource: 'CASES' }, key());
  assert.equal((await owner.businessTables({ source: 'CASES' })).tables.length, 1);
  assert.equal((await reader.businessTables({ source: 'CASES' })).tables.length, 0);
  await share(readerRole, 'READER', base.id);
  assert.equal((await reader.businessTables({ source: 'CASES' })).tables[0].id, base.tableId);
  assert.equal((await reader.businessTables({ source: 'CASES', recordId: key() })).tables.length, 0);
  const privateBase = await owner.createDriveBase(
    workspace,
    { name: '私人表', moduleSource: 'CASES' },
    key(),
  );
  await assert.rejects(reader.tableAccess(privateBase.tableId), code('COLLAB_FORBIDDEN'));
  await db.role.update({ where: { id: readerRole }, data: { status: 'DISABLED' } });
  await assert.rejects(reader.tableAccess(base.tableId), code('COLLAB_FORBIDDEN'));
  await db.role.update({ where: { id: readerRole }, data: { status: 'ENABLED' } });
  await db.userRole.updateMany({
    where: { roleId: readerRole },
    data: {
      revokedAt: new Date(),
      revokedByUserId: owner.actor.userId,
      revokeReason: '回归测试撤销账号角色授权',
    },
  });
  assert.equal((await reader.businessTables({ source: 'CASES' })).tables.length, 0);
});

test('shared custom table supports create, query, update and archive with reader and self-only restrictions', async () => {
  const base = await owner.createDriveBase(workspace, { name: '协作表', moduleSource: 'CASES' }, key());
  const field = (await db.collabField.findFirstOrThrow({ where: { tableId: base.tableId } })).id;
  const row = await owner.saveRecord(
    base.tableId,
    undefined,
    { schemaVersion: 1, values: { [field]: '管理员记录' } },
    key(),
  );
  await share(readerRole, 'READER', base.id);
  await share(editorRole, 'EDITOR', base.id);
  assert.equal((await reader.query(base.tableId, {})).total, 1);
  await assert.rejects(
    reader.saveRecord(
      base.tableId,
      row.id,
      { schemaVersion: 1, version: row.version, values: { [field]: '不允许' } },
      key(),
    ),
    code('COLLAB_FORBIDDEN'),
  );
  const own = await editor.saveRecord(
    base.tableId,
    undefined,
    { schemaVersion: 1, values: { [field]: '新增' } },
    key(),
  );
  const updated = await editor.saveRecord(
    base.tableId,
    row.id,
    { schemaVersion: 1, version: row.version, values: { [field]: '修改' } },
    key(),
  );
  await assert.rejects(
    editor.saveRecord(
      base.tableId,
      row.id,
      { schemaVersion: 1, version: row.version, values: { [field]: '过期' } },
      key(),
    ),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal(
    (
      await reader.query(base.tableId, {
        config: { filter: { fieldId: field, operator: 'contains', value: '修改' } },
      })
    ).total,
    1,
  );
  await editor.saveRecord(
    base.tableId,
    row.id,
    { schemaVersion: 1, version: updated.version, archived: true },
    key(),
  );
  assert.equal((await reader.query(base.tableId, {})).total, 1);
  assert.equal((await db.collabRecord.findUniqueOrThrow({ where: { id: row.id } })).archived, true);
  const member = await db.collabMember.findFirstOrThrow({
    where: { workspaceId: workspace, principalId: readerRole },
  });
  await owner.saveMember(
    workspace,
    {
      principalType: 'ROLE',
      principalId: readerRole,
      role: 'EDITOR',
      rowScope: 'SELF',
      baseId: base.id,
      version: member.version,
    },
    key(),
  );
  assert.equal((await reader.query(base.tableId, {})).total, 0);
  await assert.rejects(
    reader.saveRecord(
      base.tableId,
      own.id,
      { schemaVersion: 1, version: own.version, archived: true },
      key(),
    ),
    code('COLLAB_NOT_FOUND'),
  );
});

test('existing tables can be assigned to modules with version checks and without granting access', async () => {
  const base = await owner.createDriveBase(workspace, { name: '原有表' }, key());
  assert.equal((await owner.businessTables({ source: 'CASES' })).tables.length, 0);
  await owner.saveBaseModule(base.id, { moduleSource: 'CASES', version: 1 }, key());
  assert.equal((await owner.businessTables({ source: 'CASES' })).tables.length, 1);
  await assert.rejects(
    owner.saveBaseModule(base.id, { moduleSource: null, version: 1 }, key()),
    code('COLLAB_DIRECTORY_CONFLICT'),
  );
  await share(readerRole, 'READER', base.id);
  await assert.rejects(
    reader.saveBaseModule(base.id, { moduleSource: null, version: 2 }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  await owner.saveBaseModule(base.id, { moduleSource: null, version: 2 }, key());
  assert.equal((await owner.businessTables({ source: 'CASES' })).tables.length, 0);
});

test('sharing respects private ancestors and table restrictions; invalid base sharing rolls back membership', async () => {
  const folder = await owner.createFolder(workspace, { name: '私有目录' }, key());
  const base = await owner.createDriveBase(
    workspace,
    { name: '目录内表格', parentId: folder.id, moduleSource: 'CASES' },
    key(),
  );
  await share(editorRole, 'EDITOR', base.id);
  await assert.rejects(editor.tableAccess(base.tableId), code('COLLAB_FORBIDDEN'));
  await owner.saveFolderAccess(
    folder.id,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [{ principalType: 'ROLE', principalId: editorRole, role: 'EDITOR', rowScope: 'ALL' }],
      },
    },
    key(),
  );
  assert.equal((await editor.businessTables({ source: 'CASES' })).tables.length, 1);
  await owner.saveResourceAccess(
    'TABLE',
    base.tableId,
    { version: 1, policy: { restricted: true, grants: [] } },
    key(),
  );
  assert.equal((await editor.businessTables({ source: 'CASES' })).tables.length, 0);
  await assert.rejects(share(readerRole, 'READER', key()), code('COLLAB_NOT_FOUND'));
  assert.equal(
    await db.collabMember.count({ where: { workspaceId: workspace, principalId: readerRole } }),
    0,
  );
});

test('all business modules discover associated custom tables and expired assignments lose access', async () => {
  const base = await owner.createDriveBase(workspace, { name: '跨模块验证' }, key());
  let version = 1;
  for (const source of ['LEADS', 'FOLLOWS', ...Object.keys(domainSources)]) {
    if (['INVENTORY_STOCKTAKES', 'INVENTORY_MOVEMENTS'].includes(source)) {
      await assert.rejects(owner.saveBaseModule(base.id, { moduleSource: source, version }, key()), code('COLLAB_MODULE_WORKSPACE_MISMATCH'));
      const targetWorkspace = (await owner.provisionModuleWorkspace(workspace, { source }, key())).id;
      const child = await owner.createDriveBase(targetWorkspace, { name: source, moduleSource: source }, key());
      assert.ok((await owner.businessTables({ source })).tables.some(t => t.id === child.tableId));
      continue;
    }
    await owner.saveBaseModule(base.id, { moduleSource: source, version: version++ }, key());
    assert.equal((await owner.businessTables({ source })).tables[0]?.id, base.tableId, source);
  }
  await share(readerRole, 'READER', base.id);
  await db.userRole.updateMany({
    where: { roleId: readerRole },
    data: { source: 'TEMPORARY', validFrom: new Date('2026-01-01'), validUntil: new Date('2026-02-01') },
  });
  await assert.rejects(reader.tableAccess(base.tableId), code('COLLAB_FORBIDDEN'));
});
