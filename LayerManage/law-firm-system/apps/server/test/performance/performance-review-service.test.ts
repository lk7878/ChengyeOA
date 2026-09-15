// SPEC-043 Task 2: 绩效考核流程服务契约测试（目标设定/自评/主管评/确认 + 状态守卫 + 权限）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PerformanceService } from '../../app/application/performance/performance-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { PERFORMANCE_ERROR_CODES, PerformanceError } from '../../app/domain/performance/performance-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const PERFORMANCE_PERMISSIONS: PermissionCode[] = [
  'performance.read',
  'performance.create',
  'performance.update',
  'performance.confirm',
];

const prisma = createTestPrisma();

test.before(async () => {
  await prisma.$connect();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function performanceContext(
  userId: string,
  overrides: { permissionCodes?: PermissionCode[] } = {},
): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? PERFORMANCE_PERMISSIONS;
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    permissionCodes,
    grants: permissionCodes.map((permissionCode) => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    dataScope: { clause: '1=1', params: [], forcePersonLevel: false },
    delegatedScopes: [],
    isDelegated: false,
  };
}

async function serviceFor(
  permissionCodes: PermissionCode[] = PERFORMANCE_PERMISSIONS,
): Promise<{ service: PerformanceService; userId: string }> {
  const user = await prisma.user.create({
    data: { username: `perf.review.${randomUUID()}`, password: 'x' },
  });
  const actor: AuditActor = { actorUserId: user.id, requestId: `req-${randomUUID()}` };
  return {
    service: new PerformanceService(prisma, actor, performanceContext(user.id, { permissionCodes })),
    userId: user.id,
  };
}

async function seedEmployee(): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: '考核员工',
      phone: '13800006666',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function seedPerformance(status = 'PENDING'): Promise<string> {
  const employeeId = await seedEmployee();
  const created = await prisma.performance.create({
    data: { employeeId, period: '2026-04', type: 'MONTHLY', kpiData: '{}', status },
  });
  return created.id;
}

test('setGoal sets the goal in PENDING and refuses other states', async () => {
  const { service } = await serviceFor();
  const id = await seedPerformance();

  const updated = await service.setGoal(id, { goal: '完成 5 个案源转化' });
  assert.equal(updated.goal, '完成 5 个案源转化');
  assert.equal(updated.status, 'PENDING');

  const audit = await prisma.operationLog.findFirst({
    where: { action: 'PERFORMANCE_GOAL_SET', targetType: 'PERFORMANCE' },
  });
  assert.ok(audit, 'a PERFORMANCE_GOAL_SET audit is written');

  // 已自评 → 设目标 409。
  const selfReviewedId = await seedPerformance('SELF_REVIEWED');
  await assert.rejects(
    () => service.setGoal(selfReviewedId, { goal: 'x' }),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID &&
      error.httpStatus === 409,
  );

  // 无 performance.update → 403。
  await assert.rejects(
    async () => (await serviceFor(['performance.read'])).service.setGoal(id, { goal: 'x' }),
    { name: 'AuthorizationError' },
  );
});

test('selfReview transitions PENDING → SELF_REVIEWED and refuses invalid states', async () => {
  const { userId } = await serviceFor();
  const id = await seedPerformance();
  const record = await prisma.performance.findUniqueOrThrow({ where: { id } });
  await prisma.user.update({ where: { id: userId }, data: { employeeId: record.employeeId } });
  const service = new PerformanceService(
    prisma,
    { actorUserId: userId },
    { ...performanceContext(userId), employeeId: record.employeeId },
  );

  const updated = await service.selfReview(id, { selfScore: 85, selfComment: '完成情况良好' });
  assert.equal(updated.status, 'SELF_REVIEWED');
  assert.equal(updated.selfScore, 85);
  assert.equal(updated.selfComment, '完成情况良好');

  // 非法评分 → 400。
  await assert.rejects(() => service.selfReview(id, { selfScore: 101 }), { name: 'MasterDataError' });

  // 已自评 → 再自评 409。
  await assert.rejects(
    () => service.selfReview(id, { selfScore: 90 }),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID &&
      error.httpStatus === 409,
  );
});

test('managerReview transitions SELF_REVIEWED → MANAGER_REVIEWED and records reviewer', async () => {
  const { service, userId } = await serviceFor();
  const id = await seedPerformance('SELF_REVIEWED');

  const updated = await service.managerReview(id, { managerScore: 90, managerComment: '达成优秀' });
  assert.equal(updated.status, 'MANAGER_REVIEWED');
  assert.equal(updated.managerScore, 90);
  assert.equal(updated.reviewerId, userId);
  assert.ok(updated.reviewedAt, 'reviewedAt is set');

  // 未自评 → 主管评 409。
  const pendingId = await seedPerformance('PENDING');
  await assert.rejects(
    () => service.managerReview(pendingId, { managerScore: 90 }),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID &&
      error.httpStatus === 409,
  );
});

test('confirm accepts any non-terminal state and refuses double-confirm', async () => {
  const { service } = await serviceFor();
  // PENDING → CONFIRMED（既有路径兼容）。
  const pendingId = await seedPerformance('PENDING');
  const confirmed1 = await service.confirmPerformance(pendingId);
  assert.equal(confirmed1.status, 'CONFIRMED');

  // SELF_REVIEWED → CONFIRMED / MANAGER_REVIEWED → CONFIRMED。
  const selfReviewedId = await seedPerformance('SELF_REVIEWED');
  const confirmed2 = await service.confirmPerformance(selfReviewedId);
  assert.equal(confirmed2.status, 'CONFIRMED');
  const managerReviewedId = await seedPerformance('MANAGER_REVIEWED');
  const confirmed3 = await service.confirmPerformance(managerReviewedId);
  assert.equal(confirmed3.status, 'CONFIRMED');

  // 重复确认 → 409。
  await assert.rejects(
    () => service.confirmPerformance(confirmed1.id),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID &&
      error.httpStatus === 409,
  );
});
