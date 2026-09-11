// SPEC-037 Task 2: performance 域服务契约测试（创建/列表/详情/确认 + 校验/唯一/审计）。
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

function performanceContext(userId: string, overrides: { permissionCodes?: PermissionCode[] } = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? PERFORMANCE_PERMISSIONS;
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    permissionCodes,
    grants: permissionCodes.map(permissionCode => ({
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

function actor(tag: string): AuditActor {
  return { actorUserId: `user-${tag}`, requestId: `req-${tag}-${randomUUID()}` };
}

async function seedEmployee(): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: '绩效员工',
      phone: '13800007777',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

const serviceFor = (userId: string, actorUser: AuditActor, overrides?: { permissionCodes?: PermissionCode[] }): PerformanceService =>
  new PerformanceService(prisma, actorUser, performanceContext(userId, overrides));

test('createPerformance persists a PENDING record with audit and validates inputs', async () => {
  const userId = 'perf-admin';
  const actorUser = actor(userId);
  const service = serviceFor(userId, actorUser);
  const employeeId = await seedEmployee();

  const view = await service.createPerformance({
    employeeId, period: '2026-04', type: 'MONTHLY',
    kpiData: '{"cases":5}', score: '92.50', bonus: '3000.00', remark: '优秀',
  });
  assert.equal(view.status, 'PENDING');
  assert.equal(view.type, 'MONTHLY');
  assert.equal(view.score, '92.50');
  assert.equal(view.bonus, '3000.00');
  assert.equal(view.employee.id, employeeId);

  const audit = await prisma.operationLog.findFirst({ where: { action: 'PERFORMANCE_CREATE', targetType: 'PERFORMANCE' } });
  assert.ok(audit, 'a PERFORMANCE_CREATE audit is written');

  // 员工不存在 → 400。
  await assert.rejects(
    () => service.createPerformance({ employeeId: randomUUID(), period: '2026-04', type: 'MONTHLY' }),
    { name: 'MasterDataError' },
  );

  // period 格式非法 → 400。
  await assert.rejects(
    () => service.createPerformance({ employeeId, period: '2026', type: 'MONTHLY' }),
    { name: 'MasterDataError' },
  );

  // type 枚举非法 → 400。
  await assert.rejects(
    () => service.createPerformance({ employeeId, period: '2026-04', type: 'ANNUAL' as never }),
    { name: 'MasterDataError' },
  );

  // kpiData 非法 JSON → 400。
  await assert.rejects(
    () => service.createPerformance({ employeeId, period: '2026-04', type: 'MONTHLY', kpiData: '{bad' }),
    { name: 'MasterDataError' },
  );

  // 无 performance.create → 403。
  await assert.rejects(
    () => serviceFor(userId, actorUser, { permissionCodes: ['performance.read'] })
      .createPerformance({ employeeId, period: '2026-04', type: 'MONTHLY' }),
    { name: 'AuthorizationError' },
  );
});

test('createPerformance rejects duplicate employeeId+period+type with 409 PERFORMANCE_DUPLICATE', async () => {
  const userId = 'perf-admin';
  const service = serviceFor(userId, actor(userId));
  const employeeId = await seedEmployee();

  await service.createPerformance({ employeeId, period: '2026-04', type: 'QUARTERLY' });
  await assert.rejects(
    () => service.createPerformance({ employeeId, period: '2026-04', type: 'QUARTERLY' }),
    (error: unknown) => error instanceof PerformanceError && error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_DUPLICATE && error.httpStatus === 409,
  );

  // 同员工不同周期不冲突。
  await service.createPerformance({ employeeId, period: '2026-07', type: 'QUARTERLY' });
});

test('listPerformances filters and paginates; getPerformance returns detail with employee projection', async () => {
  const userId = 'perf-reader';
  const service = serviceFor(userId, actor(userId));
  const employeeId = await seedEmployee();
  await prisma.performance.createMany({
    data: [
      { employeeId, period: '2026-01', type: 'MONTHLY', kpiData: '{}', status: 'PENDING' },
      { employeeId, period: '2026-02', type: 'MONTHLY', kpiData: '{}', status: 'PENDING' },
    ],
  });

  const all = await service.listPerformances({ page: 1, pageSize: 10 });
  assert.equal(all.total, 2);
  const monthly = await service.listPerformances({ type: 'MONTHLY', period: '2026-01' });
  assert.equal(monthly.total, 1);
  assert.equal(monthly.list[0].employee.id, employeeId);

  const detail = await service.getPerformance(all.list[0].id);
  assert.equal(detail.id, all.list[0].id);
  assert.equal(detail.employee.id, employeeId);
  assert.ok(detail.employee.primaryAssignment !== undefined, 'employee projection includes primaryAssignment');
});

test('confirmPerformance transitions PENDING→CONFIRMED and refuses double-confirm', async () => {
  const userId = 'perf-admin';
  const service = serviceFor(userId, actor(userId));
  const employeeId = await seedEmployee();
  const created = await service.createPerformance({ employeeId, period: '2026-04', type: 'YEARLY', score: '88.00' });

  const confirmed = await service.confirmPerformance(created.id);
  assert.equal(confirmed.status, 'CONFIRMED');

  const audit = await prisma.operationLog.findFirst({ where: { action: 'PERFORMANCE_CONFIRM', targetType: 'PERFORMANCE' } });
  assert.ok(audit, 'a PERFORMANCE_CONFIRM audit is written');

  // 重复确认 → 409 PERFORMANCE_STATE_INVALID。
  await assert.rejects(
    () => service.confirmPerformance(created.id),
    (error: unknown) => error instanceof PerformanceError && error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID && error.httpStatus === 409,
  );

  // 不存在 → 404。
  await assert.rejects(
    () => service.confirmPerformance(randomUUID()),
    (error: unknown) => error instanceof PerformanceError && error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND && error.httpStatus === 404,
  );
});
