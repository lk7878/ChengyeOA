import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DriveNavigationService as DriveService } from '../../app/application/collaboration/drive-navigation-service';
import { withFailingCollaborationOutbox } from '../helpers/collaboration-outbox-failure';
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
  // Purge tests below exercise the data transaction after the HTTP administrator proof has been checked.
  owner.verifyPermanentDeletion = async () => {};
  manager.verifyPermanentDeletion = async () => {};
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

async function folder(name: string, shared = true, parentId?: string) {
  const result = await owner.createFolder(workspace, { name, parentId }, key());
  if (shared)
    await owner.saveFolderAccess(result.id, { version: 1, policy: { restricted: false, grants: [] } }, key());
  return result.id;
}
async function apply(id: string, input: Record<string, unknown>, service = owner) {
  const preview = await service.previewLifecycle(id, input);
  return service.applyLifecycle(id, { ...input, previewToken: preview.previewToken }, key());
}

test('purge removes a trashed subtree, attachments and shortcuts and supports receipt retries', async () => {
  const parent = await folder('彻底删除目录');
  const child = await folder('内部文件夹', true, parent);
  const app = await owner.createDriveBase(workspace, { name: '待删除文档', parentId: child }, key());
  const storageKey = key();
  const root = path.join(process.cwd(), 'var', 'storage', 'collaboration');
  const file = path.join(root, storageKey);
  await mkdir(root, { recursive: true });
  await writeFile(file, 'purge regression attachment', { flag: 'wx' });
  try {
    await db.collabAttachment.create({ data: { tableId: app.tableId, ownerId: owner.actor.userId, name: 'test.txt', mimeType: 'text/plain', size: 27, storageKey } });
    await db.driveShortcut.create({ data: { workspaceId: workspace, parentId: child, targetId: app.id, ownerId: owner.actor.userId } });
    await apply(parent, { action: 'TRASH' });
    const preview = await owner.previewLifecycle(parent, { action: 'PURGE' });
    assert.equal(preview.affected.bases, 1);
    const input = { action: 'PURGE', previewToken: preview.previewToken }, receiptKey = key();
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_purge_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'drive.purge' THEN RAISE EXCEPTION 'purge_audit_failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_purge_audit_trigger BEFORE INSERT ON operation_log FOR EACH ROW EXECUTE FUNCTION fail_purge_audit()`);
    try {
      await assert.rejects(owner.applyLifecycle(parent, input, receiptKey), /purge_audit_failure/);
      assert.ok(await db.collabBase.findUnique({ where: { id: app.id } }));
      assert.equal(await db.collabAttachment.count({ where: { tableId: app.tableId } }), 1);
      await access(file);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_purge_audit_trigger ON operation_log');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_purge_audit()');
    }
    const result = await owner.applyLifecycle(parent, input, receiptKey);
    assert.deepEqual(await owner.applyLifecycle(parent, input, receiptKey), result);
    assert.equal(await db.driveNode.count({ where: { id: { in: [parent, child, app.id] } } }), 0);
    assert.equal(await db.collabBase.count({ where: { id: app.id } }), 0);
    assert.equal(await db.collabTable.count({ where: { id: app.tableId } }), 0);
    assert.equal(await db.collabAttachment.count({ where: { tableId: app.tableId } }), 0);
    assert.equal(await db.driveShortcut.count(), 0);
    await assert.rejects(access(file));
    assert.equal(await db.operationLog.count({ where: { action: 'drive.purge', targetId: parent } }), 1);
    await assert.rejects(owner.previewLifecycle(parent, { action: 'RESTORE' }), code('COLLAB_NOT_FOUND'));
  } finally { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
});

test('purge rejects live resources, unauthorized users and stale previews', async () => {
  const id = await folder('删除保护');
  await assert.rejects(owner.previewLifecycle(id, { action: 'PURGE' }), code('DRIVE_STATE_CONFLICT'));
  await apply(id, { action: 'TRASH' });
  await assert.rejects(staff.previewLifecycle(id, { action: 'PURGE' }), code('COLLAB_FORBIDDEN'));
  const preview = await owner.previewLifecycle(id, { action: 'PURGE' });
  await db.driveNode.update({ where: { id }, data: { version: { increment: 1 } } });
  await assert.rejects(owner.applyLifecycle(id, { action: 'PURGE', previewToken: preview.previewToken }, key()), code('DRIVE_PREVIEW_STALE'));
  assert.ok(await db.driveNode.findUnique({ where: { id } }));
});

test('purge preserves a document referenced by an outside table until the reference is removed', async () => {
  const app = await owner.createDriveBase(workspace, { name: '被引用文档' }, key());
  const other = await owner.createDriveBase(workspace, { name: '保留文档' }, key());
  const field = await db.collabField.create({ data: { tableId: other.tableId, name: '关联', type: 'RELATION', options: { targetTableId: app.tableId } } });
  await apply(app.id, { action: 'TRASH' });
  await assert.rejects(apply(app.id, { action: 'PURGE' }), code('COLLAB_REFERENCED_TABLE'));
  assert.ok(await db.collabBase.findUnique({ where: { id: app.id } }));
  await db.collabField.delete({ where: { id: field.id } });
  await apply(app.id, { action: 'PURGE' });
  assert.ok(await db.collabBase.findUnique({ where: { id: other.id } }));
});

test('move previews rules, preserves identity and SELF records; current ancestor permissions govern old links', async () => {
  const source = await folder('原目录'),
    target = await folder('私有目标', false);
  const app = await owner.createDriveBase(workspace, { name: '共享数据', parentId: source }, key());
  const title = (await owner.describe(app.tableId)).fields[0].id;
  const own = await staff.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '本人数据' } },
    key(),
  );
  await owner.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '负责人数据' } },
    key(),
  );
  const body = { action: 'MOVE', parentId: target };
  const preview = await owner.previewLifecycle(app.id, body);
  assert.equal(preview.beforeRules[0].policy.restricted, false);
  assert.equal(preview.afterRules[0].policy.restricted, true);
  assert.deepEqual(preview.affected, { folders: 0, bases: 1, independentlyTrashed: 0, shortcuts: 0 });
  assert.equal((await staff.query(app.tableId, {})).total, 1);
  // A record edit is unrelated to the reviewed metadata/ACL snapshot.
  await staff.saveRecord(
    app.tableId,
    own.id,
    { schemaVersion: 1, version: 1, values: { [title]: '保留编辑' } },
    key(),
  );
  await owner.applyLifecycle(app.id, { ...body, previewToken: preview.previewToken }, key());
  await assert.rejects(staff.record(app.tableId, own.id), code('COLLAB_FORBIDDEN'));
  assert.equal((await staff.list(workspace, { q: '共享数据' })).total, 0);
  assert.equal((await owner.node(app.id)).parentId, target);
  await apply(app.id, { action: 'MOVE', parentId: source });
  assert.equal((await staff.record(app.tableId, own.id)).record.values[title], '保留编辑');
  assert.equal((await staff.query(app.tableId, {})).total, 1);
  assert.ok((await owner.describe(app.tableId)).views.some((view) => view.id === app.viewId));
  assert.equal(await db.collabRecord.count({ where: { tableId: app.tableId } }), 2);
});

test('lifecycle requires explicit access administration and MANAGER on every source descendant and destination', async () => {
  const source = await folder('可管理'),
    target = await folder('私有目标', false);
  await assert.rejects(staff.previewLifecycle(source, { action: 'TRASH' }), code('COLLAB_FORBIDDEN'));
  await assert.rejects(manager.previewLifecycle(source, { action: 'TRASH' }), code('COLLAB_FORBIDDEN'));
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: manager.actor.userId },
    data: { canManageAccess: true },
  });
  await assert.rejects(
    manager.previewLifecycle(source, { action: 'MOVE', parentId: target }),
    code('COLLAB_FORBIDDEN'),
  );
  const child = await owner.createDriveBase(workspace, { name: '私有子资源', parentId: source }, key());
  await owner.saveResourceAccess(
    'BASE',
    child.id,
    { version: 1, policy: { restricted: true, grants: [] } },
    key(),
  );
  await assert.rejects(manager.previewLifecycle(source, { action: 'TRASH' }), code('COLLAB_FORBIDDEN'));
  assert.equal((await owner.previewLifecycle(source, { action: 'TRASH' })).affected.bases, 1);
  const admin = new DriveService(db, {
    ...context(staff.actor.userId),
    isSystemAdmin: true,
    isSystemSuperAdmin: true,
  });
  await assert.rejects(admin.previewLifecycle(source, { action: 'TRASH' }), code('COLLAB_FORBIDDEN'));
});

test('cycles, cross-workspace targets, trashed targets and whole-subtree depth are rejected before writes', async () => {
  const source = await folder('待移动'),
    child = await folder('子目录', true, source);
  await assert.rejects(
    owner.previewLifecycle(source, { action: 'MOVE', parentId: source }),
    code('DRIVE_CYCLE'),
  );
  await assert.rejects(
    owner.previewLifecycle(source, { action: 'MOVE', parentId: child }),
    code('DRIVE_CYCLE'),
  );
  const other = await db.collabWorkspace.create({
    data: { name: '另一工作区', organizationId: org, ownerId: owner.actor.userId },
  });
  const foreign = await db.driveNode.create({
    data: { workspaceId: other.id, kind: 'FOLDER', folderName: '外部', ownerId: owner.actor.userId },
  });
  await assert.rejects(
    owner.previewLifecycle(source, { action: 'MOVE', parentId: foreign.id }),
    code('COLLAB_FORBIDDEN'),
  );
  let target: string | undefined;
  for (let depth = 1; depth <= 7; depth++) target = await folder('目标层' + depth, true, target);
  await assert.rejects(
    owner.previewLifecycle(source, { action: 'MOVE', parentId: target }),
    code('DRIVE_DEPTH_LIMIT'),
  );
  await apply(target!, { action: 'TRASH' });
  await assert.rejects(
    owner.previewLifecycle(source, { action: 'MOVE', parentId: target }),
    code('DRIVE_PARENT_UNAVAILABLE'),
  );
  assert.equal((await owner.node(source)).parentId, null);
});

test('preview is invalidated by directory, folder ACL, table ACL and workspace member changes', async () => {
  const source = await folder('来源'),
    target = await folder('目标');
  const app = await owner.createDriveBase(workspace, { name: '快照资源', parentId: source }, key());
  const body = { action: 'MOVE', parentId: target };
  const mutations = [
    async () =>
      owner.rename(source, { version: (await owner.node(source)).version, name: '来源新名称' }, key()),
    async () =>
      owner.saveFolderAccess(
        target,
        { version: (await owner.folderAccess(target)).version, policy: { restricted: true, grants: [] } },
        key(),
      ),
    async () =>
      owner.saveResourceAccess(
        'TABLE',
        app.tableId,
        { version: 1, policy: { restricted: true, grants: [] } },
        key(),
      ),
    async () =>
      owner.saveMember(
        workspace,
        {
          principalType: 'USER',
          principalId: staff.actor.userId,
          role: 'EDITOR',
          rowScope: 'ALL',
          version: 1,
          remove: true,
        },
        key(),
      ),
  ];
  for (const mutate of mutations) {
    const preview = await owner.previewLifecycle(app.id, body);
    await mutate();
    await assert.rejects(
      owner.applyLifecycle(app.id, { ...body, previewToken: preview.previewToken }, key()),
      code('DRIVE_PREVIEW_STALE'),
    );
    assert.equal((await owner.node(app.id)).parentId, source);
  }
  await assert.rejects(owner.applyLifecycle(app.id, body, key()), code('DRIVE_PREVIEW_STALE'));
});

test('concurrent move and trash have one winner; retry receipt is idempotent and still requires current authority', async () => {
  const source = await folder('并发资源'),
    target = await folder('并发目标');
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: manager.actor.userId },
    data: { canManageAccess: true },
  });
  const bodies = [{ action: 'MOVE', parentId: target }, { action: 'TRASH' }];
  const inputs = await Promise.all(
    bodies.map(async (body) => ({
      ...body,
      previewToken: (await manager.previewLifecycle(source, body)).previewToken,
    })),
  );
  const keys = [key(), key()];
  const results = await Promise.allSettled(
    inputs.map((body, index) => manager.applyLifecycle(source, body, keys[index])),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  const count = await db.operationLog.count();
  assert.deepEqual(
    await manager.applyLifecycle(source, inputs[winner], keys[winner]),
    (results[winner] as PromiseFulfilledResult<unknown>).value,
  );
  assert.equal(await db.operationLog.count(), count);
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: manager.actor.userId },
    data: { canManageAccess: false },
  });
  await assert.rejects(
    manager.applyLifecycle(source, inputs[winner], keys[winner]),
    code('COLLAB_FORBIDDEN'),
  );
});

test('ancestor trash blocks owner and staff content, attachments, ACL and relation hydration; restore retains data', async () => {
  const parent = await folder('整组回收');
  const app = await owner.createDriveBase(workspace, { name: '被关联目标', parentId: parent }, key());
  const title = (await owner.describe(app.tableId)).fields[0].id;
  const record = await staff.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '可恢复' } },
    key(),
  );
  const source = await owner.createDriveBase(workspace, { name: '独立关联来源' }, key());
  const sourceTitle = (await owner.describe(source.tableId)).fields[0].id;
  const relation = await owner.saveField(
    source.tableId,
    undefined,
    { version: 1, name: '关联', type: 'RELATION', options: { targetTableId: app.tableId } },
    key(),
  );
  const linked = await owner.saveRecord(
    source.tableId,
    undefined,
    { schemaVersion: 2, values: { [sourceTitle]: '来源', [relation.id]: [record.id] } },
    key(),
  );
  await apply(parent, { action: 'TRASH' });
  for (const service of [owner, staff]) {
    for (const operation of [
      () => service.baseAccess(app.id),
      () => service.listTables(app.id),
      () => service.query(app.tableId, {}),
      () => service.record(app.tableId, record.id),
      () => service.attachment(app.tableId, key()),
      () => service.saveRecord(app.tableId, undefined, { schemaVersion: 1, values: {} }, key()),
    ])
      await assert.rejects(operation(), code('COLLAB_FORBIDDEN'));
    assert.equal((await service.list(workspace, { q: '被关联目标' })).total, 0);
  }
  await assert.rejects(owner.folderAccess(parent), code('COLLAB_FORBIDDEN'));
  await assert.rejects(owner.resourceAccess('BASE', app.id), code('COLLAB_FORBIDDEN'));
  await assert.rejects(owner.resourceAccess('TABLE', app.tableId), code('COLLAB_FORBIDDEN'));
  assert.deepEqual((await owner.record(source.tableId, linked.id)).record.values[relation.id], []);
  const restore = await owner.previewLifecycle(parent, { action: 'RESTORE' });
  assert.equal(restore.beforeAccess, null);
  await owner.applyLifecycle(parent, { action: 'RESTORE', previewToken: restore.previewToken }, key());
  assert.equal((await staff.record(app.tableId, record.id)).record.values[title], '可恢复');
  assert.deepEqual((await owner.record(source.tableId, linked.id)).record.values[relation.id], [record.id]);
});

test('independent child trash survives parent restore; collapsed trash and name conflict resolution preserve original parent', async () => {
  const parent = await folder('原目录'),
    child = await folder('同名目录', true, parent);
  const app = await owner.createDriveBase(workspace, { name: '独立回收', parentId: child }, key());
  await apply(app.id, { action: 'TRASH' });
  await assert.rejects(owner.describe(app.tableId), code('COLLAB_FORBIDDEN'));
  await apply(child, { action: 'TRASH' });
  assert.equal((await owner.list(workspace, { scope: 'trash' })).total, 1);
  await assert.rejects(
    owner.previewLifecycle(app.id, { action: 'RESTORE' }),
    code('DRIVE_PARENT_UNAVAILABLE'),
  );
  await folder('同名目录', true, parent);
  await assert.rejects(
    owner.previewLifecycle(child, { action: 'RESTORE' }),
    code('COLLAB_NAME_OR_ID_CONFLICT'),
  );
  await apply(child, { action: 'RESTORE', name: '恢复后目录' });
  assert.equal((await owner.node(child)).parentId, parent);
  assert.equal((await owner.list(workspace, { scope: 'trash' })).items[0].id, app.id);
  await assert.rejects(owner.describe(app.tableId), code('COLLAB_FORBIDDEN'));
  await apply(app.id, { action: 'RESTORE', name: '恢复后的表格' });
  assert.equal((await owner.node(app.id)).name, '恢复后的表格');
  assert.equal((await owner.describe(app.tableId)).table.id, app.tableId);
});

test('trash search, pagination and totals contain only manageable explicit tombstones', async () => {
  const shared = await folder('可恢复甲'),
    privateId = await folder('不可见乙', false);
  await apply(shared, { action: 'TRASH' });
  await apply(privateId, { action: 'TRASH' });
  await assert.rejects(staff.list(workspace, { scope: 'trash' }), code('COLLAB_FORBIDDEN'));
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: manager.actor.userId },
    data: { canManageAccess: true },
  });
  const listing = await manager.list(workspace, { scope: 'trash', pageSize: 1, sort: 'name' });
  assert.equal(listing.total, 1);
  assert.equal(listing.items[0].id, shared);
  assert.equal(listing.items[0].canRestore, true);
  assert.equal((await manager.list(workspace, { scope: 'trash', q: '不可见' })).total, 0);
  assert.equal((await manager.list(workspace, { scope: 'trash', pageSize: 1, page: 2 })).items.length, 0);
  assert.equal((await owner.list(workspace, { scope: 'trash' })).total, 2);
});

test('outbox failure rolls back move/trash/restore, versions, audit, events and mutation receipt', async () => {
  const parent = await folder('原子目录'),
    target = await folder('原子目标');
  const app = await owner.createDriveBase(workspace, { name: '原子表格', parentId: parent }, key());
  const snapshot = () =>
    Promise.all([
      db.driveNode.findMany({ orderBy: { id: 'asc' } }),
      db.collabBase.findMany(),
      db.operationLog.count(),
      db.collabEvent.count(),
      db.collabMutation.count(),
    ]);
  for (const body of [{ action: 'MOVE', parentId: target }, { action: 'TRASH' }, { action: 'RESTORE' }]) {
    if (body.action === 'RESTORE') await apply(parent, { action: 'TRASH' });
    const preview = await owner.previewLifecycle(parent, body),
      before = await snapshot();
    await withFailingCollaborationOutbox(db, async () => {
      await assert.rejects(
        owner.applyLifecycle(parent, { ...body, previewToken: preview.previewToken }, key()),
        /collab_test_outbox_failure/,
      );
      assert.deepEqual(await snapshot(), before);
    });
  }
  assert.equal(await db.collabTable.count({ where: { baseId: app.id } }), 1);
});

test('oversized subtrees fail without partial tombstones or audit writes', async () => {
  const parent = await folder('大目录');
  await db.driveNode.createMany({
    data: Array.from({ length: 500 }, (_, index) => ({
      workspaceId: workspace,
      parentId: parent,
      kind: 'FOLDER',
      folderName: '子目录' + index,
      ownerId: owner.actor.userId,
    })),
  });
  const audits = await db.operationLog.count();
  await assert.rejects(owner.previewLifecycle(parent, { action: 'TRASH' }), code('DRIVE_SUBTREE_LIMIT'));
  assert.equal(await db.driveNode.count({ where: { deletedAt: { not: null } } }), 0);
  assert.equal(await db.operationLog.count(), audits);
});

test('data-bearing purge fails closed without verification while empty folders remain deletable', async () => {
  const doc = await owner.createDriveBase(workspace, { name: 'Protected data' }, key());
  await apply(doc.id, { action: 'TRASH' });
  owner.verifyPermanentDeletion = undefined;
  await assert.rejects(apply(doc.id, { action: 'PURGE' }), code('ADMIN_HIGH_RISK_ONLY'));
  assert.ok(await db.collabBase.findUnique({ where: { id: doc.id } }));
  const empty = await folder('Empty directory');
  await apply(empty, { action: 'TRASH' });
  await apply(empty, { action: 'PURGE' });
  assert.equal(await db.driveNode.findUnique({ where: { id: empty } }), null);
});
