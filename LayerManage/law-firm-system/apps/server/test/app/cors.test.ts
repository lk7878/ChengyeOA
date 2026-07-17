import assert from 'node:assert/strict';
import mm from 'egg-mock';
import test from 'node:test';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();

test.before(async () => { await app.ready(); });
test.after(async () => {
  await app.context.prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('allows credentialed preflight from the configured local web origin', async () => {
  const response = await app.httpRequest()
    .options('/api/health')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'GET')
    .expect(204);

  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});

test('does not grant CORS headers to an unlisted origin', async () => {
  const response = await app.httpRequest()
    .get('/api/health')
    .set('Origin', 'https://attacker.example')
    .expect(200);

  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
});
