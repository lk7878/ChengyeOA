import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';
process.env.CHENGYE_INTELLIGENCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'chengye-http-test-'));
const app = mm.app(); let db: PrismaClient; let token: string;
test.before(async () => { db = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const user = await db.user.create({ data: { username: 'intelligence-http', password: 'test-only', mustChangePassword: false } });
  token = (await createApiSession(db, user.id)).token;
});
test.after(async () => { await app.close(); await clearTestApplicationData(db); await db.$disconnect(); await mm.restore(); });
test('all intelligence endpoints require login and current module permissions', async () => {
  for (const endpoint of ['knowledge', 'case', 'events', 'desktop-knowledge']) {
    await app.httpRequest().post('/api/v1/intelligence/' + endpoint).send({ method: 'list' }).expect(401);
    const denied = await app.httpRequest().post('/api/v1/intelligence/' + endpoint).set('Authorization', 'Bearer ' + token).send({ method: 'list' }).expect(403);
    assert.equal(denied.body.message, 'PERMISSION_DENIED');
  }
});

test('desktop Wiki requires both permissions, current account and a live session', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { username: 'intelligence-http' } });
  const role = await db.role.create({ data: { code: 'DESKTOP_READER', name: '桌面读者', type: 'BUSINESS', status: 'ENABLED' } });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const post = (body = { userId: user.id, method: 'list' }) => app.httpRequest().post('/api/v1/intelligence/desktop-knowledge').set('Authorization', 'Bearer ' + token).send(body);
  for (const code of ['menu.knowledge', 'menu.smart_case']) {
    const permission = await db.permission.findUniqueOrThrow({ where: { code } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    if (code === 'menu.knowledge') await post().expect(403);
  }
  const ok = await post().expect(200); assert.equal(ok.body.data.value.userId, user.id);
  assert.deepEqual(ok.body.data.value.result.knowledgeBases.items, []);
  await post({ userId: 'other-account', method: 'list' }).expect(403);
  await db.rolePermission.deleteMany({ where: { roleId: role.id } }); await post().expect(403);
  await db.authSession.updateMany({ data: { revokedAt: new Date() } }); await post().expect(401);
});

test('even a system administrator cannot mutate Wiki through the desktop route', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { username: 'intelligence-http' } });
  const role = await db.role.create({ data: { code: 'SYSTEM_SUPER_ADMIN', name: '超级管理员', type: 'SYSTEM', status: 'ENABLED' } });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  token = (await createApiSession(db, user.id, 'MFA')).token;
  for (const method of ['create', 'delete', 'importFile', 'compileDocument', 'askStream', 'modelSettings']) {
    await app.httpRequest().post('/api/v1/intelligence/desktop-knowledge').set('Authorization', 'Bearer ' + token).send({ userId: user.id, method }).expect(400);
  }
});

test('revocation during retrieval discards the completed response', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { username: 'intelligence-http' } });
  const role = await db.role.create({ data: { code: 'ACTIVE_READER', name: '查询者', type: 'BUSINESS', status: 'ENABLED' } });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  for (const code of ['menu.knowledge', 'menu.smart_case']) {
    const permission = await db.permission.findUniqueOrThrow({ where: { code } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  const load = new Function('url', 'return import(url)');
  const module = await load(pathToFileURL(resolve(process.cwd(), '../../../../integrations/intelligence/cloud/service.mjs')).href);
  const prototype = module.IntelligenceService.prototype, original = prototype.desktopKnowledge;
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>(done => { ready = done; }), gate = new Promise<void>(done => { release = done; });
  prototype.desktopKnowledge = async function(...args: unknown[]) { const value = await original.apply(this, args); ready(); await gate; return value; };
  try {
    const response = app.httpRequest().post('/api/v1/intelligence/desktop-knowledge').set('Authorization', 'Bearer ' + token).send({ userId: user.id, method: 'list' }).then(value => value);
    await entered;
    await db.rolePermission.deleteMany({ where: { roleId: role.id } }); release();
    const denied = await response; assert.equal(denied.status, 403); assert.equal(denied.body.data, undefined);
  } finally { release(); prototype.desktopKnowledge = original; }
});
test('read-only Wiki callers cannot forge an admin flag in the custom upload transport', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { username: 'intelligence-http' } });
  const permission = await db.permission.upsert({ where: { code: 'menu.knowledge' }, update: {}, create: { code: 'menu.knowledge', name: '知识库', type: 'MENU', resource: 'menu', action: 'view', riskLevel: 'LOW', status: 'ENABLED' } });
  const role = await db.role.create({ data: { code: 'WIKI_READER', name: '知识库读者', type: 'BUSINESS', status: 'ENABLED' } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const denied = await app.httpRequest().post('/api/v1/intelligence/knowledge').set({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }).send(Buffer.from(JSON.stringify({ method: 'create', admin: true, args: { alias: 'forged', name: 'forged' } }))).expect(403);
  assert.match(denied.body.message, /系统管理员/);
});
