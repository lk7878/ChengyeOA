import assert from 'node:assert/strict';
import test from 'node:test';
import mm from 'egg-mock';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
test('logged-in staff can browse and download published material; only super admins maintain it', async () => {
  const db = createTestPrisma();
  const app = mm.app();
  try {
    await app.ready();
    await clearTestApplicationData(db);
    const password = 'Synthetic-portal-923';
    const hash = await new BcryptPasswordHasher(4).hash(password);
    const tokens: string[] = [];
    for (const username of ['editor', 'reader']) {
      const user = await db.user.create({ data: { username, password: hash } });
      if (username === 'editor') {
        const role = await db.role.create({
          data: { name: '管理员', code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM' },
        });
        await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      }
      const login = await app
        .httpRequest()
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      assert.ok(login.body.data.token);
      tokens.push('Bearer ' + login.body.data.token);
    }
    const [editor, reader] = tokens;
    const path = '/api/v1/portal/admin';
    await app.httpRequest().get('/api/v1/showcase').expect(200);
    await app.httpRequest().get('/api/v1/portal').expect(401);
    await app.httpRequest().get(path).set('Authorization', reader).expect(403);
    await app
      .httpRequest()
      .post(path)
      .set('Authorization', reader)
      .send({ kind: 'NEWS', title: '禁止写入' })
      .expect(403);
    const draft = await app
      .httpRequest()
      .post(path)
      .set('Authorization', editor)
      .send({
        kind: 'DOWNLOAD',
        title: '测试模板',
        file: { name: 'template.txt', data: Buffer.from('test template').toString('base64') },
      })
      .expect(200);
    const id = draft.body.data.id;
    const list = await app.httpRequest().get(path).set('Authorization', editor).expect(200);
    const file = list.body.data.entries[0].draft.file.id;
    const url = '/api/v1/portal/files/' + id + '/' + file;
    await app.httpRequest().get(url).set('Authorization', reader).expect(404);
    await app
      .httpRequest()
      .post(path + '/' + id + '/publish')
      .set('Authorization', editor)
      .send({ version: 1 })
      .expect(200);
    const feed = await app.httpRequest().get('/api/v1/portal').set('Authorization', reader).expect(200);
    assert.equal(feed.body.data.entries[0].title, '测试模板');
    const response = await app.httpRequest().get(url).set('Authorization', reader).expect(200);
    assert.equal(Buffer.from(response.body).toString(), 'test template');
    await app
      .httpRequest()
      .get(url + '?preview=1')
      .set('Authorization', reader)
      .expect('X-OA-Preview', 'text')
      .expect(200);
    await app.httpRequest().get('/api/v1/showcase/photo').query({ id, asset: file }).expect(404);
    await app
      .httpRequest()
      .get(path + '/' + id + '/1/files/' + file)
      .set('Authorization', reader)
      .expect(403);
    await app
      .httpRequest()
      .post(path + '/' + id + '/withdraw')
      .set('Authorization', reader)
      .send({ version: 2 })
      .expect(403);
    await app
      .httpRequest()
      .post(path + '/' + id + '/withdraw')
      .set('Authorization', editor)
      .send({ version: 2 })
      .expect(200);
    await app.httpRequest().get(url).set('Authorization', reader).expect(404);
  } finally {
    await app.close();
    mm.restore();
    await db.$disconnect();
  }
});
