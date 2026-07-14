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

test('GET /api/health confirms the PostgreSQL connection', async () => {
  const response = await app.httpRequest().get('/api/health').expect(200);
  assert.deepEqual(response.body, {
    code: 200,
    message: 'success',
    data: { status: 'healthy', database: 'available' },
  });
});
