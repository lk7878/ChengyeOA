import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { PersonalFileTransfer } from '../../app/application/collaboration/personal-file-transfer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
const db = createTestPrisma();
const actor = (userId: string): AuthorizationContext => ({ userId, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date() });
let owner: PersonalFileTransfer, reader: PersonalFileTransfer, other: PersonalFileTransfer, dir: string;
const previous = process.env.PERSONAL_FILES_STORAGE_ROOT;
const grant = (principalId: string, role = 'READER') => ({ principalType: 'USER', principalId, role, rowScope: 'ALL', canCreate: role === 'MANAGER', hiddenFields: [], readonlyFields: [] });
const folder = (name: string, parentId?: string) => owner.create({ name, kind: 'FOLDER', parentId });
const file = (parentId?: string, name = '材料.txt') => owner.create({ name, kind: 'FILE', parentId, content: Buffer.from('版本一').toString('base64') });
async function share(id: string, user = reader, restricted = false, role = 'READER') {
  const row = await db.personalFile.findUniqueOrThrow({ where: { id } });
  await owner.share(id, { version: row.version, policy: { restricted, grants: [grant(user.actor.userId, role)] } });
}
async function body(id: string, targetId: string | null, operation = 'move', collision = 'rename') {
  const row = await db.personalFile.findUniqueOrThrow({ where: { id } });
  return { files: [{ id, version: row.version }], targetId, operation, collision };
}
async function run(id: string, targetId: string | null, operation = 'move', collision = 'rename') {
  const input = await body(id, targetId, operation, collision), preview = await owner.previewOrganization(input);
  return { preview, result: await owner.organize({ ...input, token: preview.token }) };
}
test.before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'oa-organize-')); process.env.PERSONAL_FILES_STORAGE_ROOT = dir; });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const users = await Promise.all(['owner', 'reader', 'other'].map(username => db.user.create({ data: { username, password: 'unused' } })));
  [owner, reader, other] = users.map(u => new PersonalFileTransfer(db, actor(u.id)));
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.PERSONAL_FILES_STORAGE_ROOT; else process.env.PERSONAL_FILES_STORAGE_ROOT = previous; });
test('shared managers and superadmins cannot organize others files or use others destinations', async () => {
  const f = await file(), destination = await folder('目标'); await share(f.id, reader, true, 'MANAGER'); await share(destination.id, reader, true, 'MANAGER');
  const input = await body(f.id, null);
  for (const service of [reader, new PersonalFileTransfer(db, { ...actor(reader.actor.userId), isSystemSuperAdmin: true })]) {
    await assert.rejects(service.previewOrganization(input), /PERSONAL_ORGANIZE_OWNER_ONLY/);
    await assert.rejects(service.organize({ ...input, token: 'forged' }), /PERSONAL_ORGANIZE_OWNER_ONLY/);
    assert.deepEqual((await service.organizationFolders()).items, []);
  }
  const theirs = await reader.create({ name: '本人.txt', kind: 'FILE', content: Buffer.from('x').toString('base64') });
  await assert.rejects(reader.previewOrganization(await body(theirs.id, destination.id)), /PERSONAL_ORGANIZE_OWNER_ONLY/);
});
test('moving standalone shared subtree retains IDs, versions, readonly access, private ancestors and siblings', async () => {
  const parent = await folder('原父目录'), shared = await folder('共享案件', parent.id), f = await file(shared.id), target = await folder('新父目录'), sibling = await file(target.id);
  await share(shared.id); const before = await db.personalFile.findUniqueOrThrow({ where: { id: f.id } });
  await run(shared.id, target.id);
  const listed = await reader.list({ scope: 'shared' }); assert.deepEqual(listed.items.map(r => r.id), [shared.id]);
  assert.equal(listed.items[0].parentId, null); assert.equal(listed.items[0].level, 1);
  assert.equal((await db.personalFile.findUniqueOrThrow({ where: { id: f.id } })).contentVersion, before.contentVersion);
  await reader.content(f.id, 1); await assert.rejects(reader.list({ parentId: target.id }), /COLLAB_FORBIDDEN/); await assert.rejects(reader.download(sibling.id), /COLLAB_FORBIDDEN/);
  await owner.rename(shared.id, { name: '案件新名称', version: 3 });
  assert.equal((await reader.list({ scope: 'shared' })).items[0].name, '案件新名称');
  await owner.revokeShare(shared.id, { version: 4, principalType: 'USER', principalId: reader.actor.userId });
  await assert.rejects(reader.content(f.id, 1), /COLLAB_FORBIDDEN/);
});
test('preview exposes old and new inherited readers and requires unchanged confirmation', async () => {
  const old = await folder('旧共享'), target = await folder('新共享'); await share(old.id); await share(target.id, other);
  const f = await file(old.id), input = await body(f.id, target.id), preview = await owner.previewOrganization(input);
  assert.equal(preview.changes.find(c => c.name.includes('reader'))?.lost, 1);
  assert.equal(preview.changes.find(c => c.name.includes('other'))?.gained, 1);
  await owner.organize({ ...input, token: preview.token }); await assert.rejects(reader.download(f.id), /COLLAB_FORBIDDEN/); await other.download(f.id);
  await assert.rejects(owner.organize({ ...input, token: preview.token }), /PERSONAL_ORGANIZE_CHANGED/);
  const next = await body(f.id, null), check = await owner.previewOrganization(next); await share(target.id, reader);
  await assert.rejects(owner.organize({ ...next, token: check.token }), /PERSONAL_ORGANIZE_CHANGED/);
});
test('exited parent sharing is not revived by moving a directly shared child elsewhere', async () => {
  const old = await folder('旧共享'), target = await folder('新共享'), child = await folder('子目录', old.id), f = await file(child.id);
  await share(old.id); await share(child.id); await share(target.id);
  await reader.leaveShare(old.id, { version: 2 }); await run(child.id, target.id);
  await assert.rejects(reader.download(f.id), /COLLAB_FORBIDDEN/);
  assert.equal((await owner.accessSettings(child.id)).audience.find(p => p.userId === reader.actor.userId)?.level, 0);
});
test('copy creates independent current versions, excludes historical/trash data and direct shares; purge does not affect original', async () => {
  const source = await folder('源目录'), f = await file(source.id), trashed = await file(source.id, '已删除.txt');
  await owner.replace(f.id, { name: '材料.txt', version: 1, content: Buffer.from('版本二').toString('base64') });
  await owner.remove({ files: [{ id: trashed.id, version: 1 }] }); await share(source.id);
  const result = await run(source.id, null, 'copy'), copyId = result.result.ids[0];
  const children = (await owner.list({ parentId: copyId })).items; assert.equal(children.length, 1);
  assert.equal(children[0].contentVersion, 1); assert.equal((await owner.versions(children[0].id)).length, 1);
  assert.equal(Buffer.from((await owner.download(children[0].id)).content, 'base64').toString(), '版本二');
  await assert.rejects(reader.list({ parentId: copyId }), /COLLAB_FORBIDDEN/);
  const original = await db.personalFile.findUniqueOrThrow({ where: { id: f.id } }), copy = await db.personalFile.findUniqueOrThrow({ where: { id: children[0].id } }); assert.notEqual(copy.storageKey, original.storageKey);
  await owner.replace(copy.id, { name: copy.name, version: 1, content: Buffer.from('只修改副本').toString('base64') });
  assert.equal(Buffer.from((await owner.download(f.id)).content, 'base64').toString(), '版本二');
  await owner.remove({ files: [{ id: copyId, version: 1 }] });
  const trash = (await owner.trash()).items.find(r => r.id === copyId)!; await owner.purge(copyId, { version: trash.version });
  await owner.content(f.id, 1); await owner.content(f.id, 2);
});
test('copy into shared destination shows new readers and honors restricted subfolders', async () => {
  const source = await folder('私有'), f = await file(source.id), privateChild = await folder('不继承', source.id), hidden = await file(privateChild.id), target = await folder('目标');
  await owner.share(privateChild.id, { version: 1, policy: { restricted: true, grants: [] } }); await share(target.id);
  const { result, preview } = await run(source.id, target.id, 'copy'); assert.equal(preview.changes[0].gained, 2);
  const children = (await owner.list({ parentId: result.ids[0] })).items;
  await reader.download(children.find(r => r.name === '材料.txt')!.id); await assert.rejects(reader.list({ parentId: children.find(r => r.name === '不继承')!.id }), /COLLAB_FORBIDDEN/);
  await assert.rejects(reader.download(f.id), /COLLAB_FORBIDDEN/); await assert.rejects(reader.download(hidden.id), /COLLAB_FORBIDDEN/);
});
test('collision rename/skip, overlapping selections and cycles are handled without overwriting', async () => {
  const source = await folder('目录'), child = await file(source.id), target = await folder('目标');
  await folder('目录', target.id);
  const skipped = await run(source.id, target.id, 'move', 'skip'); assert.equal(skipped.result.count, 0);
  assert.equal((await db.personalFile.findUniqueOrThrow({ where: { id: source.id } })).parentId, null);
  const input = await body(source.id, target.id, 'copy'); input.files.push({ id: child.id, version: 1 });
  const preview = await owner.previewOrganization(input); assert.equal(preview.count, 2); assert.equal(preview.entries.length, 1); assert.equal(preview.entries[0].to, '目录（副本1）');
  await owner.organize({ ...input, token: preview.token });
  for (const operation of ['move', 'copy']) await assert.rejects(owner.previewOrganization(await body(source.id, source.id, operation)), /PERSONAL_ORGANIZE_INVALID_TARGET/);
});
test('mixed-owner children block a folder operation and copy failure leaves no partial data or storage', async () => {
  const source = await folder('混合目录'), target = await folder('目标'); await share(source.id, reader, false, 'MANAGER');
  await reader.create({ name: '别人的.txt', kind: 'FILE', parentId: source.id, content: Buffer.from('x').toString('base64') });
  await assert.rejects(owner.previewOrganization(await body(source.id, target.id)), /PERSONAL_ORGANIZE_MIXED_OWNER/);
  const f = await file(), row = await db.personalFile.findUniqueOrThrow({ where: { id: f.id } });
  const input = await body(f.id, target.id, 'copy'), preview = await owner.previewOrganization(input);
  await rm(path.join(dir, row.storageKey!)); const before = (await readdir(dir)).sort(); const count = await db.personalFile.count();
  await assert.rejects(owner.organize({ ...input, token: preview.token })); assert.equal(await db.personalFile.count(), count); assert.deepEqual((await readdir(dir)).sort(), before);
});
