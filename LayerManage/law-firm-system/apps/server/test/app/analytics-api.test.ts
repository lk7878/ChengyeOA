import assert from 'node:assert/strict';
import test from 'node:test';
import mm from 'egg-mock';
import { PrismaClient } from '@prisma/client';
import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
let db: PrismaClient;
test.before(async () => {
  db = createTestPrisma();
  await app.ready();
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
  await app.close();
  await mm.restore();
});
test('analytics HTTP routes enforce authentication and owner-only config writes', async () => {
  await clearTestApplicationData(db);
  await app.httpRequest().get('/api/v1/analytics/sources').expect(401);
  await app.httpRequest().post('/api/v1/analytics/query').send({}).expect(401);
  await app.httpRequest().get('/api/v1/analytics/dashboards').expect(401);
  const sessions = new SessionService(db, new JwtTokenService('01234567890123456789012345678901'));
  const a = await db.user.create({ data: { username: 'board-owner', password: 'unused' } }),
    b = await db.user.create({ data: { username: 'board-reader', password: 'unused' } });
  const tokenA = (await sessions.create(a.id, 'PASSWORD', {})).accessToken,
    tokenB = (await sessions.create(b.id, 'PASSWORD', {})).accessToken;
  const url = '/api/v1/analytics/dashboards';
  const saved = await app
    .httpRequest()
    .post(url)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ name: '配置测试', widgets: [], shared: true })
    .expect(200);
  const id = saved.body.data.id;
  const visible = await app
    .httpRequest()
    .get(url)
    .set('Authorization', 'Bearer ' + tokenB)
    .expect(200);
  assert.equal(visible.body.data[0].id, id);
  await app
    .httpRequest()
    .patch(url + '/' + id)
    .set('Authorization', 'Bearer ' + tokenB)
    .send({ name: '越权修改', widgets: [], shared: true, version: 1 })
    .expect(409);
  await app
    .httpRequest()
    .post(url + '/' + id + '/delete')
    .set('Authorization', 'Bearer ' + tokenB)
    .send({ version: 1 })
    .expect(409);
  await app
    .httpRequest()
    .post(url)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ name: '注入', widgets: [], ownerId: b.id })
    .expect(422);
  await app
    .httpRequest()
    .post(url + '/' + id + '/delete')
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ version: 1 })
    .expect(200);
  assert.equal(await db.analyticsDashboard.count(), 0);
});
