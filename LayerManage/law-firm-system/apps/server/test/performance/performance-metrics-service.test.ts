// SPEC-044 Task 1: 绩效业务指标服务契约测试（案件办结数/回款额聚合 + 周期解析 + 404/403）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PerformanceService } from '../../app/application/performance/performance-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { PERFORMANCE_ERROR_CODES, PerformanceError } from '../../app/domain/performance/performance-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const PERMISSIONS: PermissionCode[] = ['case.read', 'payment.read', 'performance.read'];

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

function context(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    permissionCodes: PERMISSIONS,
    grants: PERMISSIONS.map((permissionCode) => ({
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

async function serviceFor(): Promise<PerformanceService> {
  const user = await prisma.user.create({
    data: { username: `perf.metrics.${randomUUID()}`, password: 'x' },
  });
  const actor: AuditActor = { actorUserId: user.id, requestId: `req-${randomUUID()}` };
  return new PerformanceService(prisma, actor, context(user.id));
}

async function seedEmployee(): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: '指标员工',
      phone: '13800004444',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function seedCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '指标客户',
      phone: '13800003333',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  return customer.id;
}

async function seedPerformance(employeeId: string, period = '2026-04'): Promise<string> {
  const created = await prisma.performance.create({
    data: { employeeId, period, type: 'MONTHLY', kpiData: '{}', status: 'PENDING' },
  });
  return created.id;
}

async function seedContract(customerId: string): Promise<string> {
  const contract = await prisma.contract.create({
    data: {
      contractNo: `HT-${randomUUID()}`,
      contractType: 'FORMAL',
      title: '指标合同',
      customerId,
      status: 'EFFECTIVE',
      createdBy: 'seed',
    },
  });
  return contract.id;
}

async function seedClosedCase(lawyerId: string, contractId: string, closedAt: Date): Promise<void> {
  await prisma.case.create({
    data: {
      caseNo: `CA-${randomUUID()}`,
      title: '指标案',
      customerId: (await prisma.contract.findUnique({ where: { id: contractId } }))!.customerId,
      caseType: '民事',
      status: 'CLOSED',
      closedAt,
      lawyerId,
      contractId,
    },
  });
}

async function seedConfirmedPayment(
  contractId: string,
  customerId: string,
  amount: string,
  confirmedAt: Date,
): Promise<void> {
  await prisma.payment.create({
    data: {
      paymentNo: `PY-${randomUUID()}`,
      contractId,
      customerId,
      amount,
      status: 'CONFIRMED',
      confirmedAt,
      createdBy: 'seed',
    },
  });
}

test('getBusinessMetrics aggregates closed cases and confirmed revenue for the period', async () => {
  const service = await serviceFor();
  const employeeId = await seedEmployee();
  const customerId = await seedCustomer();
  const performanceId = await seedPerformance(employeeId, '2026-04');

  const contractA = await seedContract(customerId);
  const contractB = await seedContract(customerId);
  // 周期内：2 个结案 + 2 笔回款（3000 + 2000）。
  await seedClosedCase(employeeId, contractA, new Date('2026-04-15T00:00:00.000Z'));
  await seedClosedCase(employeeId, contractB, new Date('2026-04-20T00:00:00.000Z'));
  await seedConfirmedPayment(contractA, customerId, '3000.00', new Date('2026-04-10T00:00:00.000Z'));
  await seedConfirmedPayment(contractB, customerId, '2000.00', new Date('2026-04-12T00:00:00.000Z'));
  // 周期外：结案 + 回款不计。
  const contractOut = await seedContract(customerId);
  await seedClosedCase(employeeId, contractOut, new Date('2026-03-20T00:00:00.000Z'));
  await seedConfirmedPayment(contractOut, customerId, '9999.00', new Date('2026-03-15T00:00:00.000Z'));

  const metrics = await service.getBusinessMetrics(performanceId);
  assert.equal(metrics.closedCases, 2, 'only cases closed in the period');
  assert.equal(metrics.confirmedRevenue, '5000.00', 'only revenue confirmed in the period');
  // SPEC-045：autoScore = round(2×10 + 5000/10000) = round(20.5) = 21。
  assert.equal(metrics.autoScore, 21);
});

test('getBusinessMetrics returns zeros for an employee with no activity in the period', async () => {
  const service = await serviceFor();
  const employeeId = await seedEmployee();
  const performanceId = await seedPerformance(employeeId, '2026-04');

  const metrics = await service.getBusinessMetrics(performanceId);
  assert.equal(metrics.closedCases, 0);
  assert.equal(metrics.confirmedRevenue, '0.00');
  assert.equal(metrics.autoScore, 0);
});

test('getBusinessMetrics returns 404 for a missing performance and rejects without performance.read', async () => {
  const service = await serviceFor();
  await assert.rejects(
    () => service.getBusinessMetrics(randomUUID()),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND &&
      error.httpStatus === 404,
  );

  // 无 performance.read → 403。
  const user = await prisma.user.create({
    data: { username: `perf.metrics.deny.${randomUUID()}`, password: 'x' },
  });
  const actor: AuditActor = { actorUserId: user.id, requestId: `req-${randomUUID()}` };
  // context 始终含 performance.read——构造一个不含该权限的上下文。
  const deniedCtx = {
    ...context(user.id),
    permissionCodes: [] as PermissionCode[],
    grants: [] as AuthorizationContext['grants'],
  };
  const deniedService = new PerformanceService(prisma, actor, deniedCtx);
  await assert.rejects(() => deniedService.getBusinessMetrics(randomUUID()), { name: 'AuthorizationError' });
});
