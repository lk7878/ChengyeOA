import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  for (const endpoint of ['knowledge', 'case', 'events']) {
    await app.httpRequest().post('/api/v1/intelligence/' + endpoint).send({ method: 'list' }).expect(401);
    const denied = await app.httpRequest().post('/api/v1/intelligence/' + endpoint).set('Authorization', 'Bearer ' + token).send({ method: 'list' }).expect(403);
    assert.equal(denied.body.message, 'PERMISSION_DENIED');
  }
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
