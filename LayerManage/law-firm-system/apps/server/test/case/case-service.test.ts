// SPEC-033 Task 2: case 域服务契约测试（案件生命周期 + 任务状态机 + 沟通记录）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseService } from '../../app/application/case/case-service';
import { CaseTaskService } from '../../app/application/case/case-task-service';
import { CaseCommunicationService } from '../../app/application/case/case-communication-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CASE_ERROR_CODES, CaseError } from '../../app/domain/case/case-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const CASE_PERMISSIONS: PermissionCode[] = [
  'case.read',
  'case.create',
  'case.update',
  'case.close',
  'case.task.manage',
  'case.communication.create',
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

function caseContext(userId: string, overrides: { permissionCodes?: PermissionCode[]; employeeId?: string | null } = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? CASE_PERMISSIONS;
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
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

async function seedCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '客户甲',
      phone: '13800000001',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  return customer.id;
}

async function seedEmployee(): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: '律师甲',
      phone: '13800000002',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function seedCase(title = '案件一', status = 'PENDING'): Promise<string> {
  const customerId = await seedCustomer();
  const created = await prisma.case.create({
    data: { caseNo: `CA-${randomUUID()}`, title, customerId, caseType: '民事', status },
  });
  return created.id;
}

const serviceFor = (userId: string, actorUser: AuditActor, overrides?: { permissionCodes?: PermissionCode[] }): CaseService =>
  new CaseService(prisma, actorUser, caseContext(userId, overrides));

const taskServiceFor = (userId: string, actorUser: AuditActor): CaseTaskService =>
  new CaseTaskService(prisma, actorUser, caseContext(userId));

const commServiceFor = (userId: string, actorUser: AuditActor): CaseCommunicationService =>
  new CaseCommunicationService(prisma, actorUser, caseContext(userId));

test('createCase persists a PENDING case with CA number and audit, and validates customer/lawyer', async () => {
  const userId = 'case-admin';
  const actorUser = actor(userId);
  const service = serviceFor(userId, actorUser);
  const customerId = await seedCustomer();
  const lawyerId = await seedEmployee();

  const view = await service.createCase({
    title: '合同纠纷案', customerId, lawyerId, caseType: '合同纠纷', priority: 'HIGH', fee: '12000.00',
  });
  assert.equal(view.status, 'PENDING');
  assert.equal(view.priority, 'HIGH');
  assert.ok(view.caseNo.startsWith('CA'), 'case number uses the CA prefix');
  assert.equal(view.fee, '12000.00');
  assert.equal(view.tasks.length, 0);

  const audit = await prisma.operationLog.findFirst({ where: { action: 'CASE_CREATE', targetType: 'CASE' } });
  assert.ok(audit, 'a CASE_CREATE audit is written');

  // 客户不存在 → 400。
  await assert.rejects(
    () => service.createCase({ title: 'x', customerId: randomUUID(), caseType: '民事' }),
    { name: 'MasterDataError' },
  );

  // 无 case.create → 403。
  await assert.rejects(
    () => serviceFor(userId, actorUser, { permissionCodes: ['case.read'] })
      .createCase({ title: 'x', customerId, caseType: '民事' }),
    { name: 'AuthorizationError' },
  );
});

test('updateCase applies whitelist fields with optimistic lock and refuses a closed case', async () => {
  const userId = 'case-admin';
  const service = serviceFor(userId, actor(userId));
  const caseId = await seedCase();
  const lawyerId = await seedEmployee();

  const created = await service.getCase(caseId);
  assert.equal(created.version, 1, 'created case starts at version 1');

  const updated = await service.updateCase(caseId, { title: '改后标题', lawyerId, priority: 'URGENT', version: created.version });
  assert.equal(updated.title, '改后标题');
  assert.equal(updated.lawyerId, lawyerId);
  assert.equal(updated.priority, 'URGENT');
  assert.equal(updated.version, 2, 'successful update bumps version');

  // 结案后更新 → 409 CASE_STATE_INVALID（终态守卫先于乐观锁）。
  await service.closeCase(caseId, { result: '胜诉' });
  await assert.rejects(
    () => service.updateCase(caseId, { title: '再改', version: 2 }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_STATE_INVALID && error.httpStatus === 409,
  );
});

test('updateCase optimistic lock rejects a stale version with VERSION_CONFLICT', async () => {
  const userId = 'case-admin';
  const service = serviceFor(userId, actor(userId));
  const caseId = await seedCase();

  // 持旧 version 调用（另一会话已推进 version）→ 409 VERSION_CONFLICT。
  await service.updateCase(caseId, { title: '第一笔', version: 1 });
  await assert.rejects(
    () => service.updateCase(caseId, { title: '第二笔', version: 1 }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_VERSION_CONFLICT && error.httpStatus === 409,
  );
  // 缺 version → 400 VALIDATION_FAILED。
  await assert.rejects(
    () => service.updateCase(caseId, { title: '无版本' }),
    { name: 'MasterDataError' },
  );
});

test('listCases filters and paginates; getCase returns detail with tasks and communications', async () => {
  const userId = 'case-reader';
  const service = serviceFor(userId, actor(userId));
  const customerId = await seedCustomer();
  await prisma.case.createMany({
    data: [
      { caseNo: `CA-A-${randomUUID()}`, title: '民事甲', customerId, caseType: '民事', status: 'PENDING' },
      { caseNo: `CA-B-${randomUUID()}`, title: '刑事乙', customerId, caseType: '刑事', status: 'PROCESSING' },
    ],
  });

  const all = await service.listCases({ page: 1, pageSize: 10 });
  assert.equal(all.total, 2);
  const processing = await service.listCases({ status: 'PROCESSING' });
  assert.equal(processing.total, 1);
  const keyword = await service.listCases({ keyword: '刑事' });
  assert.equal(keyword.total, 1);

  // getCase 详情含 tasks/communications。
  const taskService = taskServiceFor(userId, actor(userId));
  const commService = commServiceFor(userId, actor(userId));
  await taskService.createTask(processing.list[0].id, { name: '立案', nodeType: '立案准备' });
  await commService.createCommunication(processing.list[0].id, { type: 'PHONE', content: '沟通一次', isKey: true });
  const withData = await service.getCase(processing.list[0].id);
  assert.equal(withData.tasks.length, 1);
  assert.equal(withData.communications.length, 1);
  assert.equal(withData.communications[0].isKey, true);
});

test('closeCase transitions to CLOSED with closedAt and refuses double-close', async () => {
  const userId = 'case-admin';
  const service = serviceFor(userId, actor(userId));
  const caseId = await seedCase('待结案件', 'PROCESSING');

  const closed = await service.closeCase(caseId, { result: '胜诉', satisfaction: 5 });
  assert.equal(closed.status, 'CLOSED');
  assert.ok(closed.closedAt, 'closedAt is set');
  assert.equal(closed.result, '胜诉');
  assert.equal(closed.satisfaction, 5);

  // 重复结案 → 409。
  await assert.rejects(
    () => service.closeCase(caseId, {}),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_STATE_INVALID && error.httpStatus === 409,
  );
});

test('case tasks follow the PENDING → IN_PROGRESS → COMPLETED state machine; communications require an open case', async () => {
  const userId = 'case-admin';
  const caseId = await seedCase();
  const taskService = taskServiceFor(userId, actor(userId));
  const commService = commServiceFor(userId, actor(userId));

  const task = await taskService.createTask(caseId, { name: '收集材料', nodeType: '材料收集' });
  assert.equal(task.status, 'PENDING');
  await taskService.updateTask(caseId, task.id, { status: 'IN_PROGRESS' });
  const done = await taskService.updateTask(caseId, task.id, { status: 'COMPLETED' });
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.completedAt, 'completedAt is set on COMPLETED');

  // 非法翻转 PENDING → COMPLETED → 409。
  const task2 = await taskService.createTask(caseId, { name: '文书', nodeType: '文书提交' });
  await assert.rejects(
    () => taskService.updateTask(caseId, task2.id, { status: 'COMPLETED' }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_TASK_STATE_INVALID,
  );

  await commService.createCommunication(caseId, { type: 'WECHAT', content: '沟通' });
  await assert.rejects(
    () => commService.createCommunication(randomUUID(), { type: 'PHONE', content: 'x' }),
    (error: unknown) => error instanceof CaseError && error.code === CASE_ERROR_CODES.CASE_NOT_FOUND,
  );
});
