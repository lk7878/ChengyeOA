import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveNavigationService as DriveService } from '../../app/application/collaboration/drive-navigation-service';
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

test('personal shortcuts are isolated, shared references require both paths and preserve SELF content', async () => {
  const source = await folder('共享来源'),
    destination = await folder('共享位置');
  const app = await owner.createDriveBase(workspace, { name: '原表格', parentId: source }, key());
  const title = (await owner.describe(app.tableId)).fields[0].id;
  const own = await staff.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '本人记录' } },
    key(),
  );
  await owner.saveRecord(
    app.tableId,
    undefined,
    { schemaVersion: 1, values: { [title]: '他人记录' } },
    key(),
  );
  const personal = await staff.createShortcut(workspace, { targetId: app.id, parentId: null }, key());
  assert.equal((await staff.list(workspace, { scope: 'shortcuts' })).items[0].id, personal.id);
  assert.equal((await owner.list(workspace, { scope: 'shortcuts' })).total, 0);
  await assert.rejects(owner.shortcut(personal.id), code('COLLAB_FORBIDDEN'));
  await assert.rejects(owner.removeShortcut(workspace, personal.id, {}, key()), code('COLLAB_FORBIDDEN'));
  await assert.rejects(
    staff.createShortcut(workspace, { targetId: app.id, parentId: destination }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  const shared = await manager.createShortcut(workspace, { targetId: app.id, parentId: destination }, key());
  assert.equal((await staff.shortcut(shared.id)).target.id, app.id);
  assert.equal((await staff.list(workspace, { parentId: destination })).total, 1);
  assert.equal((await staff.query(app.tableId, {})).total, 1);
  assert.equal((await staff.record(app.tableId, own.id)).record.values[title], '本人记录');
  await owner.saveFolderAccess(destination, { version: 2, policy: { restricted: true, grants: [] } }, key());
  await assert.rejects(staff.shortcut(shared.id), code('COLLAB_FORBIDDEN'));
  assert.equal((await staff.shortcut(personal.id)).target.id, app.id);
  await owner.saveFolderAccess(source, { version: 2, policy: { restricted: true, grants: [] } }, key());
  assert.equal((await staff.list(workspace, { scope: 'shortcuts' })).total, 0);
  await assert.rejects(staff.shortcut(personal.id), code('COLLAB_FORBIDDEN'));
  // Removing a known personal reference after target revocation reveals no target metadata.
  assert.deepEqual(await staff.removeShortcut(workspace, personal.id, {}, key()), { id: personal.id });
  assert.equal(await db.collabRecord.count({ where: { tableId: app.tableId } }), 2);
});

test('links follow canonical rename and moves; target or location trash hides links without deleting data', async () => {
  const source = await folder('来源'),
    destination = await folder('链接位置'),
    moved = await folder('新位置');
  const app = await owner.createDriveBase(workspace, { name: '跟随目标', parentId: source }, key());
  const link = await owner.createShortcut(workspace, { targetId: app.id, parentId: destination }, key());
  await owner.rename(app.id, { name: '当前名称', version: 1 }, key());
  await apply(app.id, { action: 'MOVE', parentId: moved });
  assert.equal((await staff.shortcut(link.id)).target.name, '当前名称');
  assert.equal((await staff.shortcut(link.id)).target.parentId, moved);
  await staff.visit(app.id, {}, key());
  assert.equal((await staff.list(workspace, { scope: 'recent' })).total, 1);
  await apply(moved, { action: 'TRASH' });
  for (const service of [owner, staff]) {
    await assert.rejects(service.shortcut(link.id), code('COLLAB_FORBIDDEN'));
    assert.equal((await service.list(workspace, { scope: 'shortcuts', q: '当前名称' })).total, 0);
  }
  assert.equal((await staff.list(workspace, { scope: 'recent' })).total, 0);
  await apply(moved, { action: 'RESTORE' });
  assert.equal((await staff.list(workspace, { scope: 'recent' })).total, 1);
  const reviewed = await owner.previewLifecycle(destination, { action: 'TRASH' });
  assert.equal(reviewed.affected.shortcuts, 1);
  assert.equal(reviewed.affected.bases, 0);
  await owner.applyLifecycle(destination, { action: 'TRASH', previewToken: reviewed.previewToken }, key());
  await assert.rejects(owner.shortcut(link.id), code('COLLAB_FORBIDDEN'));
  assert.equal((await staff.describe(app.tableId)).table.id, app.tableId);
  await apply(destination, { action: 'RESTORE' });
  assert.equal((await staff.shortcut(link.id)).target.id, app.id);
  await owner.removeShortcut(workspace, link.id, {}, key());
  assert.equal((await staff.describe(app.tableId)).table.id, app.tableId);
  assert.equal(await db.collabBase.count(), 1);
});

test('duplicate creation, concurrent creation, removal retries and revoked receipts are safe', async () => {
  const source = await folder('来源'),
    destination = await folder('引用目录');
  const body = { targetId: source, parentId: destination },
    mutation = key();
  const link = await manager.createShortcut(workspace, body, mutation);
  assert.deepEqual(await manager.createShortcut(workspace, body, mutation), link);
  await assert.rejects(owner.createShortcut(workspace, body, key()), code('DRIVE_SHORTCUT_EXISTS'));
  const removal = key();
  await manager.removeShortcut(workspace, link.id, {}, removal);
  await manager.removeShortcut(workspace, link.id, {}, removal);
  assert.equal(
    await db.operationLog.count({ where: { action: 'drive.shortcut.removed', targetId: link.id } }),
    1,
  );
  const outcomes = await Promise.allSettled(
    [owner, manager].map((service) => service.createShortcut(workspace, body, key())),
  );
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  await owner.saveFolderAccess(destination, { version: 2, policy: { restricted: true, grants: [] } }, key());
  await assert.rejects(manager.createShortcut(workspace, body, mutation), code('COLLAB_FORBIDDEN'));
  await assert.rejects(manager.removeShortcut(workspace, link.id, {}, removal), code('COLLAB_FORBIDDEN'));
});

test('cross-workspace references, shortcut chains, non-folder parents and impersonation inputs are rejected', async () => {
  const target = await folder('目标');
  await assert.rejects(
    owner.createShortcut(workspace, { targetId: target, parentId: false }, key()),
    code('COLLAB_INVALID_TEXT'),
  );
  await assert.rejects(owner.list(workspace, { parentId: false }), code('COLLAB_INVALID_TEXT'));
  const app = await owner.createDriveBase(workspace, { name: '表格不能存放链接', parentId: target }, key());
  const link = await staff.createShortcut(workspace, { targetId: target }, key());
  await assert.rejects(
    staff.createShortcut(workspace, { targetId: link.id }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  await assert.rejects(
    owner.createShortcut(workspace, { targetId: target, parentId: app.id }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  const other = await db.collabWorkspace.create({
    data: { name: '外区', organizationId: org, ownerId: owner.actor.userId },
  });
  const foreign = await db.driveNode.create({
    data: { workspaceId: other.id, kind: 'FOLDER', folderName: '跨区目标', ownerId: owner.actor.userId },
  });
  await assert.rejects(
    owner.createShortcut(workspace, { targetId: foreign.id }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  await assert.rejects(
    db.driveShortcut.create({
      data: { workspaceId: workspace, targetId: foreign.id, ownerId: owner.actor.userId },
    }),
  );
  await assert.rejects(
    db.driveShortcut.create({
      data: { workspaceId: workspace, parentId: app.id, targetId: target, ownerId: owner.actor.userId },
    }),
  );
  await assert.rejects(
    staff.visit(target, { userId: owner.actor.userId }, key()),
    code('COLLAB_UNKNOWN_PROPERTY'),
  );
  await assert.rejects(
    staff.clearRecent(workspace, { userId: owner.actor.userId }, key()),
    code('COLLAB_UNKNOWN_PROPERTY'),
  );
});

test('recent visits are private, deduplicated and bounded; polling never changes activity, events or versions', async () => {
  const parent = await folder('访问集');
  const resources = Array.from({ length: 105 }, (_, index) => ({
    id: key(),
    workspaceId: workspace,
    parentId: parent,
    kind: 'FOLDER',
    folderName: '资源' + index,
    ownerId: owner.actor.userId,
  }));
  await db.driveNode.createMany({ data: resources });
  const timestamp = new Date('2026-01-01');
  await db.driveVisit.createMany({
    data: resources.slice(0, 100).map((node) => ({
      userId: staff.actor.userId,
      workspaceId: workspace,
      nodeId: node.id,
      visitedAt: timestamp,
    })),
  });
  const before = await db.driveNode.findMany({ orderBy: { id: 'asc' } }),
    events = await db.collabEvent.count();
  await Promise.all(resources.slice(100).map((node) => staff.visit(node.id, {}, key())));
  assert.equal(await db.driveVisit.count({ where: { userId: staff.actor.userId } }), 100);
  assert.equal((await owner.list(workspace, { scope: 'recent' })).total, 0);
  const history = await staff.list(workspace, { scope: 'recent', pageSize: 100 });
  assert.equal(history.total, 100);
  assert.ok(
    resources.slice(100).every((node) => history.items.slice(0, 5).some((item) => item.id === node.id)),
  );
  const mutation = key();
  await staff.visit(resources[104].id, {}, mutation);
  const once = await db.driveVisit.findUniqueOrThrow({
    where: { userId_nodeId: { userId: staff.actor.userId, nodeId: resources[104].id } },
  });
  await staff.visit(resources[104].id, {}, mutation);
  assert.deepEqual(
    await db.driveVisit.findUnique({
      where: { userId_nodeId: { userId: staff.actor.userId, nodeId: resources[104].id } },
    }),
    once,
  );
  await staff.list(workspace, {});
  await staff.node(resources[104].id);
  assert.deepEqual(await db.driveNode.findMany({ orderBy: { id: 'asc' } }), before);
  assert.equal(await db.collabEvent.count(), events);
  await owner.visit(resources[104].id, {}, key());
  const clearKey = key();
  await staff.clearRecent(workspace, {}, clearKey);
  await staff.visit(resources[103].id, {}, key());
  await staff.clearRecent(workspace, {}, clearKey);
  assert.equal(
    (await staff.list(workspace, { scope: 'recent' })).total,
    1,
    'a lost clear response must not erase newer history',
  );
  assert.equal((await owner.list(workspace, { scope: 'recent' })).total, 1);
});

test('recent queries exclude revoked and trashed resources before totals and pagination, including old receipts', async () => {
  const a = await folder('甲'),
    b = await folder('乙');
  const mutation = key();
  await staff.visit(a, {}, mutation);
  await staff.visit(b, {}, key());
  await owner.saveFolderAccess(a, { version: 2, policy: { restricted: true, grants: [] } }, key());
  assert.equal((await staff.list(workspace, { scope: 'recent', pageSize: 1 })).total, 1);
  assert.equal((await staff.list(workspace, { scope: 'recent', q: '甲' })).total, 0);
  assert.equal((await staff.list(workspace, { scope: 'recent', pageSize: 1, page: 2 })).items.length, 0);
  await assert.rejects(staff.visit(a, {}, mutation), code('COLLAB_FORBIDDEN'));
  await apply(b, { action: 'TRASH' });
  assert.equal((await staff.list(workspace, { scope: 'recent' })).total, 0);
  await staff.clearRecent(workspace, {}, key());
  assert.equal(await db.driveVisit.count({ where: { userId: staff.actor.userId } }), 0);
});

test('adding a shortcut invalidates the folder lifecycle preview; references never increase target content counts', async () => {
  const source = await folder('引用目录'),
    target = await folder('独立目标');
  const reviewed = await owner.previewLifecycle(source, { action: 'TRASH' });
  await owner.createShortcut(workspace, { targetId: target, parentId: source }, key());
  await assert.rejects(
    owner.applyLifecycle(source, { action: 'TRASH', previewToken: reviewed.previewToken }, key()),
    code('DRIVE_PREVIEW_STALE'),
  );
  const fresh = await owner.previewLifecycle(source, { action: 'TRASH' });
  assert.equal(fresh.affected.shortcuts, 1);
  assert.equal(fresh.affected.folders, 1);
  await owner.applyLifecycle(source, { action: 'TRASH', previewToken: fresh.previewToken }, key());
  assert.equal((await owner.node(target)).id, target);
});

test('shortcut audit failure rolls back the reference and idempotency receipt', async () => {
  const target = await folder('回滚目标'),
    mutation = key();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION g2b_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'drive.shortcut.created' THEN RAISE EXCEPTION 'synthetic shortcut audit failure'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER g2b_reject_audit BEFORE INSERT ON operation_log FOR EACH ROW EXECUTE FUNCTION g2b_reject_audit()`,
  );
  try {
    await assert.rejects(
      owner.createShortcut(workspace, { targetId: target }, mutation),
      /synthetic shortcut audit failure/,
    );
    assert.equal(await db.driveShortcut.count(), 0);
    assert.equal(await db.collabMutation.count({ where: { actorId: owner.actor.userId, key: mutation } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER g2b_reject_audit ON operation_log');
    await db.$executeRawUnsafe('DROP FUNCTION g2b_reject_audit()');
  }
});
