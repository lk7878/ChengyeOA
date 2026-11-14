import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

// SPEC-011 Task 10: cost HTTP API 端到端测试（成本台账 CRUD + 软删、锚点矩阵、乐观锁、
// 白名单、错误码透传、404 锁）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/cost-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

type ScopeFixture =
  | { kind: 'ALL' }
  | { kind: 'SELF' }
  | { kind: 'TEAM'; professionalTeamId: string }
  | { kind: 'BRANCH'; organizationId: string; includeDescendants?: boolean }
  | { kind: 'ORG'; organizationId: string };

interface FinanceSessionOptions {
  permissions: string[];
  scope?: ScopeFixture;
  employeeId?: string | null;
}

/** 业务会话夹具（仿 contract-api T10 先例；cost 不做行级 scope，scope 仅保持夹具同构）。 */
async function createFinanceSession(
  options: FinanceSessionOptions,
): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `finance.cost.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `FINANCE COST ${suffix}`,
      code: `FIN_COST_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: options.permissions.map((code) => ({ permission: { connect: { code } } })),
      },
    },
  });
  const scope = options.scope ?? { kind: 'ALL' };
  const resources = [...new Set(options.permissions.map((code) => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: {
        name: `Scope ${resource} ${suffix}`,
        scopeType: scope.kind,
        includeDescendants: scope.kind === 'BRANCH' ? (scope.includeDescendants ?? true) : false,
        organizationId: scope.kind === 'BRANCH' || scope.kind === 'ORG' ? scope.organizationId : null,
        professionalTeamId: scope.kind === 'TEAM' ? scope.professionalTeamId : null,
      },
    });
    await prisma.roleDataScope.create({
      data: { roleId: role.id, resource, dataScopeId: dataScope.id },
    });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

const FULL_COST_PERMISSIONS = ['channel.read', 'cost.create', 'cost.read', 'cost.update', 'cost.delete'];

async function createChannelFixture() {
  return prisma.channel.create({
    data: { code: `CH_COST_${randomUUID()}`, name: '成本渠道', type: 'SEARCH' },
  });
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('requires authentication for every cost endpoint', async () => {
  await app.httpRequest().get('/api/v1/costs').expect(401);
  await app
    .httpRequest()
    .post('/api/v1/costs')
    .send({ category: 'LABOR', amount: '100', occurredAt: '2026-08-01' })
    .expect(401);
  await app.httpRequest().get(`/api/v1/costs/${randomUUID()}`).expect(401);
  await app.httpRequest().patch(`/api/v1/costs/${randomUUID()}`).send({ note: 'x', version: 1 }).expect(401);
  await app.httpRequest().delete(`/api/v1/costs/${randomUUID()}`).expect(401);
});

test('rejects authenticated users without cost permissions', async () => {
  const ordinary = await createFinanceSession({ permissions: [] });
  const denied = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(ordinary.token))
    .send({ category: 'LABOR', amount: '100', occurredAt: '2026-08-01' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/costs').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest().delete(`/api/v1/costs/${randomUUID()}`).set(bearer(ordinary.token)).expect(403);

  // 只有 cost.read：读通、写拒。
  const reader = await createFinanceSession({ permissions: ['cost.read'] });
  await app.httpRequest().get('/api/v1/costs').set(bearer(reader.token)).expect(200);
  await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(reader.token))
    .send({ category: 'LABOR', amount: '100', occurredAt: '2026-08-01' })
    .expect(403);
});

test('creates, updates, lists, and soft-deletes a cost entry end to end', async () => {
  const session = await createFinanceSession({ permissions: FULL_COST_PERMISSIONS });
  const channel = await createChannelFixture();

  const created = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({
      category: 'CHANNEL',
      amount: '1200.50',
      occurredAt: '2026-08-01',
      note: '投放费',
      channelId: channel.id,
    })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.equal(created.body.data.category, 'CHANNEL');
  assert.equal(created.body.data.amount, '1200.50');
  assert.equal(created.body.data.channelId, channel.id);
  assert.equal(created.body.data.version, 1);
  const costId = created.body.data.id as string;

  const detail = await app
    .httpRequest()
    .get(`/api/v1/costs/${costId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, costId);

  const list = await app.httpRequest().get('/api/v1/costs').set(bearer(session.token)).expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, costId);

  const updated = await app
    .httpRequest()
    .patch(`/api/v1/costs/${costId}`)
    .set(bearer(session.token))
    .send({ amount: '1300.00', note: '调整后投放费', version: 1 })
    .expect(200);
  assert.equal(updated.body.data.amount, '1300.00');
  assert.equal(updated.body.data.note, '调整后投放费');
  assert.equal(updated.body.data.version, 2);

  // 软删：delete → get 404 → list 不见。
  const destroyed = await app
    .httpRequest()
    .delete(`/api/v1/costs/${costId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(destroyed.body.data.id, costId);
  await app.httpRequest().get(`/api/v1/costs/${costId}`).set(bearer(session.token)).expect(404);
  const afterDelete = await app.httpRequest().get('/api/v1/costs').set(bearer(session.token)).expect(200);
  assert.equal(afterDelete.body.data.total, 0);
});

test('carries cost validation, anchor, optimistic-lock, and not-found error codes', async () => {
  const session = await createFinanceSession({ permissions: FULL_COST_PERMISSIONS });
  const channel = await createChannelFixture();

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({ category: 'LABOR', amount: '100', occurredAt: '2026-08-01', bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 锚点矩阵：CHANNEL 缺 channelId → 400 COST_ANCHOR_REQUIRED；LABOR 带 channelId → 400 COST_ANCHOR_FORBIDDEN。
  const anchorRequired = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({ category: 'CHANNEL', amount: '100', occurredAt: '2026-08-01' })
    .expect(400);
  assert.equal(anchorRequired.body.message, 'COST_ANCHOR_REQUIRED');
  const anchorForbidden = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({ category: 'LABOR', amount: '100', occurredAt: '2026-08-01', channelId: channel.id })
    .expect(400);
  assert.equal(anchorForbidden.body.message, 'COST_ANCHOR_FORBIDDEN');

  // 伪造 channelId：400 VALIDATION_FAILED（存在性探针，非 P2003 500）。
  const forgedChannel = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({ category: 'CHANNEL', amount: '100', occurredAt: '2026-08-01', channelId: randomUUID() })
    .expect(400);
  assert.equal(forgedChannel.body.message, 'VALIDATION_FAILED');

  // 不存在：404 COST_NOT_FOUND。
  const missing = await app
    .httpRequest()
    .get(`/api/v1/costs/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'COST_NOT_FOUND');

  // update 注入不可变锚点字段：400 VALIDATION_FAILED。
  const created = await app
    .httpRequest()
    .post('/api/v1/costs')
    .set(bearer(session.token))
    .send({ category: 'CHANNEL', amount: '100', occurredAt: '2026-08-01', channelId: channel.id })
    .expect(200);
  const injected = await app
    .httpRequest()
    .patch(`/api/v1/costs/${created.body.data.id}`)
    .set(bearer(session.token))
    .send({ amount: '200', version: 1, category: 'LABOR' })
    .expect(400);
  assert.equal(injected.body.message, 'VALIDATION_FAILED');

  // 乐观锁：版本过期 → 409 VERSION_CONFLICT。
  const stale = await app
    .httpRequest()
    .patch(`/api/v1/costs/${created.body.data.id}`)
    .set(bearer(session.token))
    .send({ amount: '300', version: 99 })
    .expect(409);
  assert.equal(stale.body.message, 'VERSION_CONFLICT');

  // 分页参数非法：400 VALIDATION_FAILED。
  await app.httpRequest().get('/api/v1/costs?page=0').set(bearer(session.token)).expect(400);
  await app.httpRequest().get('/api/v1/costs?page=abc').set(bearer(session.token)).expect(400);
});
