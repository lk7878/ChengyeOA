import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { DriveNavigationService as DriveService } from '../../app/application/collaboration/drive-navigation-service';
import { PrismaEventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, owner: DriveService, manager: DriveService, staff: DriveService;
let workspace: string, org: string;
const key = () => randomUUID();
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
const context = (userId: string, employeeId: string | null = null): AuthorizationContext => ({
  userId,
  employeeId,
  isSystemAdmin: false,
  isSystemSuperAdmin: false,
  grants: [],
  fieldRules: [],
  permissionCodes: [],
  evaluatedAt: new Date(),
});
const grant = (principalId: string, role = 'EDITOR', rowScope = 'SELF') => ({
  principalType: 'USER',
  principalId,
  role,
  rowScope,
  canCreate: role === 'MANAGER',
  hiddenFields: [],
  readonlyFields: [],
});
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: key(), name: '云盘测试组织', type: 'FIRM', path: '/' + org },
  });
  const actors: DriveService[] = [];
  for (const name of ['owner', 'manager', 'staff']) {
    const user = await db.user.create({
      data: { username: 'drive-' + name, password: 'unused-fixture', mustChangePassword: false },
    });
    actors.push(new DriveService(db, context(user.id)));
  }
  [owner, manager, staff] = actors;
  workspace = (
    await db.collabWorkspace.create({
      data: {
        name: '云盘工作区',
        organizationId: org,
        ownerId: owner.actor.userId,
        members: {
          create: [
            { principalId: owner.actor.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true },
            { principalId: manager.actor.userId, role: 'MANAGER', rowScope: 'ALL', canCreate: true },
            { principalId: staff.actor.userId, role: 'EDITOR', rowScope: 'SELF' },
          ],
        },
      },
    })
  ).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('legacy backfill is repeatable and preserves Base identity, ACL and data', async () => {
  const legacy = await db.collabBase.create({
    data: {
      workspaceId: workspace,
      name: '原应用',
      accessPolicy: { restricted: true, grants: [grant(staff.actor.userId)] },
    },
  });
  const table = (await owner.createTable(legacy.id, { name: '原表' }, key())).id;
  const field = (await owner.describe(table)).fields[0];
  const record = await staff.saveRecord(
    table,
    undefined,
    { schemaVersion: 1, values: { [field.id]: '保留' } },
    key(),
  );
  const sql = await readFile('prisma/migrations/20260915120000_cloud_drive_catalog/migration.sql', 'utf8');
  const backfill = sql.slice(sql.lastIndexOf('INSERT INTO drive_node'));
  await db.$executeRawUnsafe(backfill);
  await db.$executeRawUnsafe(backfill);
  assert.equal(await db.driveNode.count(), 1);
  const node = await db.driveNode.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(node.baseId, legacy.id);
  assert.equal(node.createdAt, null);
  assert.deepEqual(await db.collabBase.findUnique({ where: { id: legacy.id } }), legacy);
  assert.equal((await staff.record(table, record.id)).record.values[field.id], '保留');
  const created = await owner.createBase(workspace, { name: '旧接口创建' }, key());
  assert.equal((await db.driveNode.findUniqueOrThrow({ where: { id: created.id } })).baseId, created.id);
});

test('private folders, shared discovery and SELF rows use the same Base and current parent permissions', async () => {
  const folder = await manager.createFolder(workspace, { name: '个人资料' }, key());
  const app = await manager.createDriveBase(workspace, { name: '项目台账', parentId: folder.id }, key());
  const title = (await manager.describe(app.tableId)).fields[0].id;
  assert.equal((await staff.list(workspace, { q: '项目台账' })).total, 0);
  await assert.rejects(staff.query(app.tableId, {}), code('COLLAB_FORBIDDEN'));
  await owner.saveFolderAccess(
    folder.id,
    {
      version: 1,
      policy: {
        restricted: true,
        grants: [grant(manager.actor.userId, 'MANAGER', 'ALL'), grant(staff.actor.userId)],
      },
    },
    key(),
  );
  const teamRecord = await manager.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '负责人记录' } },
    key(),
  );
  const own = await staff.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '本人记录' } },
    key(),
  );
  assert.equal((await staff.list(workspace, { scope: 'shared', q: '项目台账' })).items[0].id, app.baseId);
  assert.equal((await manager.list(workspace, { scope: 'mine', q: '项目台账' })).items[0].id, app.baseId);
  assert.equal((await staff.query(app.tableId, { config: {} })).total, 1);
  assert.equal((await manager.query(app.tableId, {})).total, 2);
  await assert.rejects(staff.record(app.tableId, teamRecord.id), code('COLLAB_NOT_FOUND'));
  await assert.rejects(staff.createFolder(workspace, { name: '越权新建' }, key()), code('COLLAB_FORBIDDEN'));
  const source = (await owner.createBase(workspace, { name: '独立来源' }, key())).id;
  const sourceTable = (await owner.createTable(source, { name: '关联来源' }, key())).id;
  const sourceTitle = (await owner.describe(sourceTable)).fields[0].id;
  const relation = await owner.saveField(
    sourceTable,
    undefined,
    { version: 1, name: '关联', type: 'RELATION', options: { targetTableId: app.tableId } },
    key(),
  );
  const linked = await staff.saveRecord(
    sourceTable,
    undefined,
    { schemaVersion: 2, values: { [sourceTitle]: '引用', [relation.id]: [own.id] } },
    key(),
  );
  await owner.saveFolderAccess(
    folder.id,
    { version: 2, policy: { restricted: false, grants: [grant(staff.actor.userId, 'DENY')] } },
    key(),
  );
  assert.equal((await staff.list(workspace, { q: '项目台账' })).total, 0);
  assert.equal((await staff.folders(workspace)).folders.length, 0);
  await assert.rejects(staff.baseAccess(app.baseId), code('COLLAB_FORBIDDEN'));
  await assert.rejects(staff.record(app.tableId, own.id), code('COLLAB_FORBIDDEN'));
  await assert.rejects(staff.attachment(app.tableId, key()), code('COLLAB_FORBIDDEN'));
  assert.deepEqual((await staff.record(sourceTable, linked.id)).record.values[relation.id], []);
  assert.equal((await owner.query(app.tableId, {})).total, 2);
});

test('position-based creators are selectable without creating a workspace user grant; leaving removes access', async () => {
  const position = await db.position.create({
    data: { organizationId: org, code: key(), name: '云盘管理岗位', categoryCode: 'SALES' },
  });
  const employee = await db.employee.create({
    data: {
      name: '岗位创建者',
      employeeNo: key(),
      phone: '13800001234',
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
  await db.user.update({ where: { id: manager.actor.userId }, data: { employeeId: employee.id } });
  const job = await db.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: org,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2025-01-01'),
    },
  });
  await db.collabMember.deleteMany({ where: { workspaceId: workspace, principalId: manager.actor.userId } });
  await db.collabMember.create({
    data: {
      workspaceId: workspace,
      principalType: 'POSITION',
      principalId: position.id,
      role: 'MANAGER',
      rowScope: 'ALL',
    },
  });
  manager = new DriveService(db, context(manager.actor.userId, employee.id));
  const folder = await manager.createFolder(workspace, { name: '岗位个人文件夹' }, key());
  const app = await manager.createDriveBase(workspace, { name: '岗位个人应用' }, key());
  const policy = { restricted: true, grants: [grant(manager.actor.userId, 'MANAGER', 'ALL')] };
  await owner.saveFolderAccess(folder.id, { version: 1, policy }, key());
  await owner.saveResourceAccess('BASE', app.baseId, { version: 1, policy }, key());
  assert.equal(
    await db.collabMember.count({
      where: { workspaceId: workspace, principalType: 'USER', principalId: manager.actor.userId },
    }),
    0,
  );
  await db.employeeAssignment.update({ where: { id: job.id }, data: { endedAt: new Date() } });
  await assert.rejects(manager.node(folder.id), code('COLLAB_FORBIDDEN'));
  await assert.rejects(manager.query(app.tableId, {}), code('COLLAB_FORBIDDEN'));
});

test('ownership does not override a downgraded parent, while the workspace owner retains its exception', async () => {
  const folder = await manager.createFolder(workspace, { name: '降权验证' }, key());
  const app = await manager.createDriveBase(workspace, { name: '本人创建应用', parentId: folder.id }, key());
  await owner.saveFolderAccess(
    folder.id,
    { version: 1, policy: { restricted: true, grants: [grant(manager.actor.userId, 'READER', 'ALL')] } },
    key(),
  );
  assert.equal((await manager.node(app.baseId)).canRename, false);
  await assert.rejects(
    manager.rename(app.baseId, { name: '越权改名', version: 1 }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  assert.equal((await owner.node(app.baseId)).canRename, true);
  assert.equal((await manager.describe(app.tableId)).access.level, 1);
});

test('directory writes keep idempotency, version checks and rollback every created object on outbox failure', async (t) => {
  const mutation = key(),
    body = { name: '幂等目录' };
  const folder = await owner.createFolder(workspace, body, mutation);
  assert.deepEqual(await owner.createFolder(workspace, body, mutation), folder);
  await assert.rejects(owner.createFolder(workspace, body, key()), code('COLLAB_NAME_OR_ID_CONFLICT'));
  const results = await Promise.allSettled(
    ['甲', '乙'].map((name) => owner.rename(folder.id, { name, version: 1 }, key())),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((result) => result.status === 'rejected' && code('DRIVE_VERSION_CONFLICT')(result.reason))
      .length,
    1,
  );
  await assert.rejects(
    owner.rename(folder.id, { name: '越权移动', version: 2, parentId: key() }, key()),
    code('COLLAB_UNKNOWN_PROPERTY'),
  );
  const counts = () =>
    Promise.all([
      db.driveNode.count(),
      db.collabBase.count(),
      db.collabTable.count(),
      db.collabField.count(),
      db.collabView.count(),
      db.collabEvent.count(),
      db.collabMutation.count(),
    ]);
  const before = await counts();
  const append = t.mock.method(PrismaEventOutboxWriter.prototype, 'append', async () => {
    throw new Error('synthetic catalog outbox failure');
  });
  await assert.rejects(
    owner.createDriveBase(workspace, { name: '原子创建' }, key()),
    /synthetic catalog outbox failure/,
  );
  assert.deepEqual(await counts(), before);
  append.mock.restore();
});

test('parent type, workspace and eight-level boundaries cannot be bypassed', async () => {
  let parentId: string | undefined;
  for (let depth = 1; depth <= 8; depth++)
    parentId = (await owner.createFolder(workspace, { name: '层级' + depth, parentId }, key())).id;
  await assert.rejects(
    owner.createFolder(workspace, { name: '第九层', parentId }, key()),
    code('DRIVE_DEPTH_LIMIT'),
  );
  const app = await owner.createDriveBase(workspace, { name: '最深层应用', parentId }, key());
  assert.equal((await owner.node(app.baseId)).path.length, 9);
  await assert.rejects(
    owner.createFolder(workspace, { name: '把表当文件夹', parentId: app.baseId }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  const other = await db.collabWorkspace.create({
    data: {
      name: '另一工作区',
      organizationId: org,
      ownerId: owner.actor.userId,
      members: { create: { principalId: owner.actor.userId, role: 'OWNER' } },
    },
  });
  await assert.rejects(
    owner.createFolder(other.id, { name: '跨边界', parentId }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  await assert.rejects(
    db.driveNode.create({
      data: { workspaceId: workspace, ownerId: owner.actor.userId, kind: 'FOLDER', folderName: null },
    }),
  );
  await assert.rejects(
    owner.createFolder(workspace, { name: '非法父级', parentId: false }, key()),
    code('COLLAB_INVALID_TEXT'),
  );
});

test('500 resources including eight levels filter counts and pages before returning within the G1 budget', async () => {
  const folders = Array.from({ length: 100 }, () => key()),
    bases = Array.from({ length: 400 }, () => key());
  await db.collabBase.createMany({
    data: bases.map((id, i) => ({
      id,
      workspaceId: workspace,
      name: '性能表' + String(i).padStart(3, '0'),
      accessPolicy: i % 2 ? { restricted: true, grants: [] } : Prisma.DbNull,
    })),
  });
  for (const [i, id] of folders.entries())
    await db.driveNode.create({
      data: {
        id,
        workspaceId: workspace,
        kind: 'FOLDER',
        folderName: '性能目录' + i,
        ownerId: owner.actor.userId,
        parentId: i > 0 && i < 8 ? folders[i - 1] : null,
        accessPolicy: i >= 8 && i % 2 ? { restricted: true, grants: [] } : Prisma.DbNull,
      },
    });
  await db.driveNode.createMany({
    data: bases.map((id) => ({
      id,
      baseId: id,
      workspaceId: workspace,
      parentId: folders[7],
      kind: 'BASE',
      ownerId: owner.actor.userId,
    })),
  });
  const query = { scope: 'shared', q: '性能', pageSize: 50, sort: 'name' };
  const first = await staff.list(workspace, query),
    second = await staff.list(workspace, { ...query, page: 2 });
  assert.equal(first.total, 254);
  assert.equal(first.items.length, 50);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 100);
  assert.equal((await staff.list(workspace, { ...query, page: 100 })).items.length, 0);
  const elapsed: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await staff.list(workspace, query);
    elapsed.push(performance.now() - start);
  }
  const p95 = elapsed.sort((a, b) => a - b)[9];
  console.log('drive directory 500-resource P95 ms:', Math.round(p95));
  assert.ok(p95 <= 2000, 'directory P95 > 2s');
  await db.driveShortcut.createMany({
    data: bases
      .slice(0, 200)
      .map((targetId) => ({
        workspaceId: workspace,
        parentId: folders[0],
        targetId,
        ownerId: owner.actor.userId,
      })),
  });
  await db.driveVisit.createMany({
    data: bases
      .slice(0, 100)
      .map((nodeId) => ({ userId: staff.actor.userId, nodeId, workspaceId: workspace })),
  });
  assert.equal((await staff.list(workspace, query)).total, 354);
  assert.equal((await staff.list(workspace, { scope: 'recent' })).total, 50);
  const mixed: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await staff.list(workspace, query);
    mixed.push(performance.now() - start);
  }
  const mixedP95 = mixed.sort((a, b) => a - b)[9];
  console.log('drive 500 resources + 200 shortcuts + 100 visits P95 ms:', Math.round(mixedP95));
  assert.ok(mixedP95 <= 2000, 'mixed directory P95 > 2s');
});
