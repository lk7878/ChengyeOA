// SPEC-037 Task 3: performance HTTP API 端到端测试（绩效录入/列表/详情/确认 + 权限 403 +
// 错误码透传 + 审计透传）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/performance-api.test.ts

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

const FULL_PERFORMANCE_PERMISSIONS = [
  'employee.read',
  'performance.read',
  'performance.create',
  'performance.confirm',
];

/** 绩效域业务会话夹具（仿 case-api 先例；performance 不做行级 scope）。 */
async function createPerformanceSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `perf.api.${suffix}`,
      password: 'not-used',
      employeeId: null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `PERF API ${suffix}`,
      code: `PERF_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: permissions.map((code) => ({ permission: { connect: { code } } })),
      },
    },
  });
  const resources = [...new Set(permissions.map((code) => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: {
        name: `Scope ${resource} ${suffix}`,
        scopeType: 'ALL',
        includeDescendants: false,
        organizationId: null,
        professionalTeamId: null,
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

async function seedEmployee(): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: '绩效员工',
      phone: '13800006666',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
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

test('requires authentication for every performance endpoint', async () => {
  await app.httpRequest().get('/api/v1/performances').expect(401);
  await app.httpRequest().get(`/api/v1/performances/${randomUUID()}`).expect(401);
  await app
    .httpRequest()
    .post('/api/v1/performances')
    .send({ employeeId: 'x', period: '2026-04', type: 'MONTHLY' })
    .expect(401);
  await app.httpRequest().post(`/api/v1/performances/${randomUUID()}/confirm`).expect(401);
});

test('rejects authenticated users without performance permissions', async () => {
  const ordinary = await createPerformanceSession([]);
  await app.httpRequest().get('/api/v1/performances').set(bearer(ordinary.token)).expect(403);
  const denied = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(ordinary.token))
    .send({ employeeId: randomUUID(), period: '2026-04', type: 'MONTHLY' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');

  // 只有 performance.read：读通、写拒。
  const reader = await createPerformanceSession(['performance.read']);
  await app.httpRequest().get('/api/v1/performances').set(bearer(reader.token)).expect(200);
  await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(reader.token))
    .send({ employeeId: randomUUID(), period: '2026-04', type: 'MONTHLY' })
    .expect(403);
  await app
    .httpRequest()
    .post(`/api/v1/performances/${randomUUID()}/confirm`)
    .set(bearer(reader.token))
    .expect(403);
});

test('creates, lists, reads, and confirms a performance record end to end with audit passthrough', async () => {
  const session = await createPerformanceSession(FULL_PERFORMANCE_PERMISSIONS);
  const employeeId = await seedEmployee();

  const created = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({
      employeeId,
      period: '2026-04',
      type: 'MONTHLY',
      kpiData: '{"cases":5}',
      score: '92.50',
      bonus: '3000.00',
      remark: '优秀',
    })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.score, '92.50');
  assert.equal(created.body.data.employee.id, employeeId);
  const performanceId = created.body.data.id as string;

  // 审计透传：API 写操作落 operation_log，actor 为请求用户。
  const createAudit = await prisma.operationLog.findFirst({
    where: { action: 'PERFORMANCE_CREATE', targetType: 'PERFORMANCE', targetId: performanceId },
  });
  assert.ok(createAudit, 'a PERFORMANCE_CREATE audit is written');
  assert.equal(createAudit.userId, session.userId);

  const list = await app.httpRequest().get('/api/v1/performances').set(bearer(session.token)).expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, performanceId);

  const detail = await app
    .httpRequest()
    .get(`/api/v1/performances/${performanceId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, performanceId);
  assert.equal(detail.body.data.status, 'PENDING');

  const confirmed = await app
    .httpRequest()
    .post(`/api/v1/performances/${performanceId}/confirm`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(confirmed.body.data.status, 'CONFIRMED');

  const confirmAudit = await prisma.operationLog.findFirst({
    where: { action: 'PERFORMANCE_CONFIRM', targetType: 'PERFORMANCE', targetId: performanceId },
  });
  assert.ok(confirmAudit, 'a PERFORMANCE_CONFIRM audit is written');

  // 重复确认 → 409 PERFORMANCE_STATE_INVALID。
  const doubleConfirm = await app
    .httpRequest()
    .post(`/api/v1/performances/${performanceId}/confirm`)
    .set(bearer(session.token))
    .expect(409);
  assert.equal(doubleConfirm.body.message, 'PERFORMANCE_STATE_INVALID');
});

test('carries performance validation, duplicate, and not-found error codes', async () => {
  const session = await createPerformanceSession(FULL_PERFORMANCE_PERMISSIONS);
  const employeeId = await seedEmployee();

  // body 未知键 → 400 VALIDATION_FAILED。
  const unknownKey = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'MONTHLY', bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 员工不存在 → 400。
  const forgedEmployee = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId: randomUUID(), period: '2026-04', type: 'MONTHLY' })
    .expect(400);
  assert.equal(forgedEmployee.body.message, 'VALIDATION_FAILED');

  // period 格式非法 / type 枚举非法 → 400。
  await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026', type: 'MONTHLY' })
    .expect(400);
  await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'ANNUAL' })
    .expect(400);

  // 非法分页 → 400。
  await app.httpRequest().get('/api/v1/performances?page=0').set(bearer(session.token)).expect(400);

  // 不存在 → 404 PERFORMANCE_NOT_FOUND。
  const missing = await app
    .httpRequest()
    .get(`/api/v1/performances/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'PERFORMANCE_NOT_FOUND');

  // 重复录入（employeeId+period+type）→ 409 PERFORMANCE_DUPLICATE。
  const first = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'QUARTERLY' })
    .expect(200);
  assert.equal(first.body.data.status, 'PENDING');
  const duplicate = await app
    .httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'QUARTERLY' })
    .expect(409);
  assert.equal(duplicate.body.message, 'PERFORMANCE_DUPLICATE');
});
