// SPEC-044 Task 2: 绩效业务指标 HTTP API 端到端测试（metrics 端点 + 权限 403 + 404）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/performance-metrics-api.test.ts

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

const METRICS_PERMISSIONS = ['performance.read', 'performance.create'];

async function createSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `perf.metrics.api.${suffix}`, password: 'not-used', employeeId: null },
  });
  const role = await prisma.role.create({
    data: {
      name: `PERF METRICS API ${suffix}`,
      code: `PMA_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const resources = [...new Set(permissions.map(code => code.split('.')[0]))];
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
    await prisma.roleDataScope.create({ data: { roleId: role.id, resource, dataScopeId: dataScope.id } });
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
      name: '指标员工',
      phone: '13800002222',
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

test('returns the performance business metrics with zero activity', async () => {
  const session = await createSession(METRICS_PERMISSIONS);
  const employeeId = await seedEmployee();
  const created = await app.httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'MONTHLY' })
    .expect(200);
  const performanceId = created.body.data.id as string;

  const metrics = await app.httpRequest()
    .get(`/api/v1/performances/${performanceId}/metrics`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(metrics.body.code, 200);
  assert.equal(metrics.body.data.closedCases, 0);
  assert.equal(metrics.body.data.confirmedRevenue, '0.00');
  assert.equal(metrics.body.data.autoScore, 0);
});

test('rejects the metrics endpoint without performance.read and returns 404 for a missing record', async () => {
  const reader = await createSession(['performance.create']);
  const employeeId = await seedEmployee();
  const created = await app.httpRequest()
    .post('/api/v1/performances')
    .set(bearer(reader.token))
    .send({ employeeId, period: '2026-04', type: 'MONTHLY' })
    .expect(200);
  const performanceId = created.body.data.id as string;

  // 无 performance.read → 403。
  await app.httpRequest()
    .get(`/api/v1/performances/${performanceId}/metrics`)
    .set(bearer(reader.token))
    .expect(403);

  // 不存在 → 404 PERFORMANCE_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/performances/${randomUUID()}/metrics`)
    .set(bearer((await createSession(METRICS_PERMISSIONS)).token))
    .expect(404);
  assert.equal(missing.body.message, 'PERFORMANCE_NOT_FOUND');
});
