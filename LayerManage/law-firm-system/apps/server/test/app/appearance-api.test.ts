import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
let db: PrismaClient;
test.before(async () => { db = createTestPrisma(); await app.ready(); });
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); await app.close(); await mm.restore(); });

test('appearance persists only for the authenticated account and rejects foreign account or arbitrary settings', async () => {
  await clearTestApplicationData(db);
  const users = await Promise.all(['appearance-owner', 'appearance-other'].map(username => db.user.create({ data: { username, password: 'unused' } })));
  const sessions = new SessionService(db, new JwtTokenService('01234567890123456789012345678901'));
  const a = await sessions.create(users[0].id, 'PASSWORD', {}), b = await sessions.create(users[1].id, 'PASSWORD', {});
  const endpoint = '/api/v1/auth/appearance';
  const standard = { colorMode: 'light', fontSize: 'standard', background: 'default', rowHeight: 'standard' };
  const custom = { colorMode: 'dark', fontSize: 'extraLarge', background: 'green', rowHeight: 'comfortable' };
  await app.httpRequest().get(endpoint).expect(401);
  await app.httpRequest().patch(endpoint).send(custom).expect(401);
  const initial = await app.httpRequest().get(endpoint).set('Authorization', 'Bearer ' + a.accessToken).expect(200);
  assert.deepEqual(initial.body.data, standard);
  await app.httpRequest().patch(endpoint).set('Authorization', 'Bearer ' + a.accessToken).send(custom).expect(200);
  const saved = await app.httpRequest().get(endpoint).set('Authorization', 'Bearer ' + a.accessToken).expect(200);
  assert.deepEqual(saved.body.data, custom);
  const { colorMode: _mode, ...legacy } = custom;
  await app.httpRequest().patch(endpoint).set('Authorization', 'Bearer ' + a.accessToken).send(legacy).expect(200);
  assert.equal(((await db.user.findUniqueOrThrow({ where: { id: users[0].id } })).appearance as Record<string, unknown>).colorMode, 'dark');
  const other = await app.httpRequest().get(endpoint).set('Authorization', 'Bearer ' + b.accessToken).expect(200);
  assert.deepEqual(other.body.data, standard);
  for (const bad of [{ ...custom, colorMode: 'system' }, { ...custom, userId: users[1].id }, { ...custom, fontSize: '999px' }, { ...custom, permissions: ['*'] }, { ...custom, background: 'url(https://example.com)' }]) {
    await app.httpRequest().patch(endpoint).set('Authorization', 'Bearer ' + a.accessToken).send(bad).expect(422);
  }
  assert.deepEqual((await db.user.findUniqueOrThrow({ where: { id: users[1].id } })).appearance, {});
  assert.equal(await db.userRole.count(), 0);
  await app.httpRequest().patch(endpoint).set('Authorization', 'Bearer ' + a.accessToken).send(standard).expect(200);
  assert.deepEqual((await db.user.findUniqueOrThrow({ where: { id: users[0].id } })).appearance, standard);
});
