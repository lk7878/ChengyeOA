// SPEC-043 Task 3: 绩效考核流程 HTTP API 端到端测试（目标设定/自评/主管评/确认 + 权限 403 + 状态守卫 409）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/performance-review-api.test.ts

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

const FULL_REVIEW_PERMISSIONS = ['performance.read', 'performance.create', 'performance.update', 'performance.confirm'];

async function createReviewSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `perf.review.api.${suffix}`, password: 'not-used', employeeId: null },
  });
  const role = await prisma.role.create({
    data: {
      name: `PERF REVIEW API ${suffix}`,
      code: `PRV_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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
      name: '考核员工',
      phone: '13800005555',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function createPerformanceViaApi(session: { token: string }, employeeId: string): Promise<string> {
  const created = await app.httpRequest()
    .post('/api/v1/performances')
    .set(bearer(session.token))
    .send({ employeeId, period: '2026-04', type: 'MONTHLY' })
    .expect(200);
  return created.body.data.id as string;
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

test('drives the full review flow: set goal → self review → manager review → confirm', async () => {
  const session = await createReviewSession(FULL_REVIEW_PERMISSIONS);
  const employeeId = await seedEmployee();
  const performanceId = await createPerformanceViaApi(session, employeeId);

  const goal = await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/set-goal`)
    .set(bearer(session.token))
    .send({ goal: '完成 5 个案源转化' })
    .expect(200);
  assert.equal(goal.body.data.goal, '完成 5 个案源转化');
  assert.equal(goal.body.data.status, 'PENDING');

  const self = await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/self-review`)
    .set(bearer(session.token))
    .send({ selfScore: 85, selfComment: '完成良好' })
    .expect(200);
  assert.equal(self.body.data.status, 'SELF_REVIEWED');
  assert.equal(self.body.data.selfScore, 85);

  const manager = await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/manager-review`)
    .set(bearer(session.token))
    .send({ managerScore: 90, managerComment: '达成优秀' })
    .expect(200);
  assert.equal(manager.body.data.status, 'MANAGER_REVIEWED');
  assert.ok(manager.body.data.reviewedAt, 'reviewedAt is set');

  const confirmed = await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/confirm`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(confirmed.body.data.status, 'CONFIRMED');
});

test('rejects review actions without the matching permission', async () => {
  const reader = await createReviewSession(['performance.read', 'performance.create', 'performance.confirm']);
  const employeeId = await seedEmployee();
  const performanceId = await createPerformanceViaApi(reader, employeeId);

  // 无 performance.update → set-goal / self-review 403。
  await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/set-goal`)
    .set(bearer(reader.token))
    .send({ goal: 'x' })
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/self-review`)
    .set(bearer(reader.token))
    .send({ selfScore: 80 })
    .expect(403);
});

test('carries review state-guard and validation error codes', async () => {
  const session = await createReviewSession(FULL_REVIEW_PERMISSIONS);
  const employeeId = await seedEmployee();
  const performanceId = await createPerformanceViaApi(session, employeeId);

  // 未自评 → 主管评 409。
  const earlyManager = await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/manager-review`)
    .set(bearer(session.token))
    .send({ managerScore: 90 })
    .expect(409);
  assert.equal(earlyManager.body.message, 'PERFORMANCE_STATE_INVALID');

  // 非法评分 → 400。
  await app.httpRequest()
    .post(`/api/v1/performances/${performanceId}/self-review`)
    .set(bearer(session.token))
    .send({ selfScore: 101 })
    .expect(400);

  // 不存在 → 404。
  await app.httpRequest()
    .post(`/api/v1/performances/${randomUUID()}/set-goal`)
    .set(bearer(session.token))
    .send({ goal: 'x' })
    .expect(404);
});
