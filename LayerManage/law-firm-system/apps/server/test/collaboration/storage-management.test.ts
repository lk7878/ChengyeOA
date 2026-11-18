import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, link, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { PrismaClient } from '@prisma/client';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { StorageManagement, measureBlobs } from '../../app/application/collaboration/storage-management';
import { DriveNavigationService } from '../../app/application/collaboration/drive-navigation-service';
import { PersonalFiles } from '../../app/application/collaboration/personal-files';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, root: string, admin: AuthorizationContext, alice: AuthorizationContext, bob: AuthorizationContext;
let workspace: string, otherWorkspace: string;
const context = (userId: string, superAdmin = false): AuthorizationContext => ({ userId, employeeId: null, isSystemAdmin: false,
  isSystemSuperAdmin: superAdmin, grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date() });
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const policy = (id: string) => ({ restricted: true, grants: [{ principalType: 'USER', principalId: id, role: 'MANAGER', rowScope: 'ALL', canCreate: true, hiddenFields: [], readonlyFields: [] }] });

test.before(async () => { db = createTestPrisma(); root = await mkdtemp(path.join(os.tmpdir(), 'oa-storage-fixture-')); process.env.PERSONAL_FILES_STORAGE_ROOT = root; });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const users = await Promise.all(['admin', 'alice', 'bob'].map(username => db.user.create({ data: { username, password: 'unused-test' } })));
  admin = context(users[0].id, true); alice = context(users[1].id); bob = context(users[2].id);
  const orgId = randomUUID();
  const org = await db.organization.create({ data: { id: orgId, code: randomUUID(), name: '测试部门', type: 'FIRM', path: '/' + orgId } });
  const a = await db.collabWorkspace.create({ data: { name: '公开给Alice', organizationId: org.id, ownerId: alice.userId,
    members: { create: { principalId: alice.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true } } } });
  const b = await db.collabWorkspace.create({ data: { name: 'Bob私有工作区', organizationId: org.id, ownerId: bob.userId,
    members: { create: { principalId: bob.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true } } } });
  workspace = a.id; otherWorkspace = b.id;
  for (const [actor, name] of [[alice, 'alice-file'], [bob, 'bob-file']] as const) {
    const file = await db.personalFile.create({ data: { ownerId: actor.userId, name, kind: 'FILE', size: 3, storageKey: name, contentVersion: 2, accessPolicy: policy(actor.userId) } });
    await writeFile(path.join(root, name), 'abc');
    for (const version of [1, 2]) await db.personalFileVersion.create({ data: { fileId: file.id, version, name, size: 3, storageKey: name,
      sha256: createHash('sha256').update('abc').digest('hex'), source: 'upload' } });
  }
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); await rm(root, { recursive: true, force: true }); delete process.env.PERSONAL_FILES_STORAGE_ROOT; });

test('ordinary users see only their own files and cannot forge organization or inaccessible workspace scope', async () => {
  const service = new StorageManagement(db, alice);
  const report = await service.report({});
  assert.equal(report.totals.files, 1); assert.equal(report.totals.versions, 2);
  assert.ok(report.items.every(r => r.ownerId === alice.userId)); assert.equal(report.disk, null);
  assert.equal((await service.report({ ownerId: bob.userId })).total, 0);
  await assert.rejects(service.report({ audience: 'organization' }), code('COLLAB_FORBIDDEN'));
  await assert.rejects(service.report({ workspace: otherWorkspace }), code('COLLAB_FORBIDDEN'));
  assert.ok(!JSON.stringify(report).includes(root), 'no filesystem paths in API response');
});

test('organization audit includes unshared files, counts versions and deduplicates the same physical object', async () => {
  const report = await new StorageManagement(db, admin).report({ audience: 'organization' });
  assert.equal(report.totals.files, 2); assert.equal(report.totals.logicalBytes, 12);
  assert.equal(report.totals.currentBytes, 6); assert.equal(report.totals.historyBytes, 6);
  assert.equal(report.measured.bytes, 6); assert.equal(report.measured.objects, 2);
  assert.equal(report.totals.duplicateGroups, 1); assert.equal(report.items.length, 4);
  assert.ok(report.disk && report.disk.total > 0);
  assert.equal(await db.operationLog.count({ where: { action: 'STORAGE_AUDIT' } }), 1);
});

test('a specific workspace excludes unassigned files; attachment attribution follows the canonical table workspace', async () => {
  const base = await db.collabBase.create({ data: { workspaceId: workspace, name: '表格应用' } });
  const table = await db.collabTable.create({ data: { baseId: base.id, name: '测试表', createdBy: alice.userId } });
  await db.collabAttachment.create({ data: { tableId: table.id, ownerId: alice.userId, name: '附件', mimeType: 'text/plain', size: 20, storageKey: randomUUID() } });
  const report = await new StorageManagement(db, admin).report({ audience: 'organization', workspace });
  assert.equal(report.total, 1); assert.equal(report.items[0].workspaceId, workspace);
  assert.equal(report.totals.logicalBytes, 20); assert.equal(report.measured.unavailable, 1);
  const unassigned = await new StorageManagement(db, admin).report({ audience: 'organization', workspace: '__unassigned__' });
  assert.equal(unassigned.totals.files, 2);
});

test('trash and history candidates do not delete files; candidate filters and pagination are stable', async () => {
  await db.personalFile.updateMany({ where: { ownerId: bob.userId }, data: { deletedAt: new Date() } });
  const report = await new StorageManagement(db, admin).report({ audience: 'organization', candidate: 'trash', pageSize: 1, page: 2 });
  assert.equal(report.total, 2); assert.equal(report.items.length, 1); assert.equal(report.totals.trashBytes, 6);
  assert.equal(report.totals.historyBytes, 3); assert.equal(await db.personalFile.count(), 2);
  await assert.rejects(new StorageManagement(db, { ...admin, previewRoleId: 'role' }).report({ audience: 'organization' }), code('COLLAB_FORBIDDEN'));
});

test('all workspaces reuses resource permissions, merges ordering and does not confer creation or administration rights', async () => {
  const aliceDrive = new DriveNavigationService(db, alice), bobDrive = new DriveNavigationService(db, bob);
  await aliceDrive.createFolder(workspace, { name: 'Alice资源' }, randomUUID());
  await bobDrive.createFolder(otherWorkspace, { name: 'Bob秘密资源' }, randomUUID());
  const report = await aliceDrive.listAll({ scope: 'all' });
  assert.equal(report.total, 1); assert.equal(report.items[0].name, 'Alice资源');
  assert.equal(report.items[0].workspaceName, '公开给Alice'); assert.equal(report.canManageAccess, false);
  assert.equal(report.canCreateFolder, false);
  const adminReport = await new DriveNavigationService(db, admin).listAll({ scope: 'all' });
  assert.equal(adminReport.total, 0, 'global storage audit does not change ordinary browsing authorization');
  await assert.rejects(aliceDrive.listAll({ scope: 'trash' }), code('COLLAB_INVALID_OPTION'));
});

test('personal folder size counts visible current descendants, excluding deleted files and historical versions', async () => {
  const folder = await db.personalFile.create({ data: { ownerId: alice.userId, name: '目录', kind: 'FOLDER', accessPolicy: policy(alice.userId) } });
  await db.personalFile.updateMany({ where: { ownerId: alice.userId, kind: 'FILE' }, data: { parentId: folder.id } });
  const service = new PersonalFiles(db, alice);
  assert.equal((await service.list({ scope: 'mine' })).items.find(r => r.id === folder.id)?.size, 3);
  await db.personalFile.updateMany({ where: { ownerId: alice.userId, kind: 'FILE' }, data: { deletedAt: new Date() } });
  assert.equal((await service.list({ scope: 'mine' })).items.find(r => r.id === folder.id)?.size, 0);
});

test('physical accounting does not follow escaped paths or symlinks and does not double-count hardlinks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oa-storage-physical-'));
  try {
    await writeFile(path.join(dir, 'a'), 'abcd'); await link(path.join(dir, 'a'), path.join(dir, 'b'));
    await symlink(path.join(dir, 'a'), path.join(dir, 'c'));
    const measured = await measureBlobs(['a', 'a', 'b', 'c', '../escape', 'missing'].map(storageKey => ({ root: dir, storageKey })));
    assert.equal(measured.bytes, 4); assert.equal(measured.objects, 1); assert.equal(measured.unavailable, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('all workspace search and pagination combine only authorized resources across workspaces', async () => {
  const first = new DriveNavigationService(db, alice), second = new DriveNavigationService(db, bob);
  await first.createFolder(workspace, { name: 'A-shared' }, randomUUID());
  const visible = await second.createFolder(otherWorkspace, { name: 'B-shared' }, randomUUID());
  await second.createFolder(otherWorkspace, { name: 'hidden' }, randomUUID());
  await second.saveFolderAccess(visible.id, { version: 1, policy: { restricted: false, grants: [] } }, randomUUID());
  await db.collabMember.create({ data: { workspaceId: otherWorkspace, principalId: alice.userId, role: 'READER', rowScope: 'ALL' } });
  const listing = await first.listAll({ scope: 'all', sort: 'name', pageSize: 1, page: 2 });
  assert.equal(listing.total, 2); assert.equal(listing.items[0].name, 'B-shared');
  assert.equal((await first.listAll({ q: 'hidden' })).total, 0);
  assert.equal((await first.listAll({ q: 'B-shared' })).total, 1);
});
