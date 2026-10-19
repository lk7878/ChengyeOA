// SPEC-033 Task 2: case 域服务契约测试（案件生命周期 + 任务状态机 + 沟通记录）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseService } from '../../app/application/case/case-service';
import { INTAKE_FIELDS, INTAKE_OPTIONS, CaseIntake } from '../../app/application/case/intake-contract';
import { CaseTaskService } from '../../app/application/case/case-task-service';
import { CaseCommunicationService } from '../../app/application/case/case-communication-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CASE_ERROR_CODES, CaseError } from '../../app/domain/case/case-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const CASE_PERMISSIONS: PermissionCode[] = [
  'customer.read', 'contract.read',
  'case.delete',
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

test('editing persists every intake field, exact money, customer/lawyer names and searchable values', async () => {
  const service = serviceFor('editor', actor('editor'));
  const id = await seedCase();
  const customerId = await seedCustomer(), lawyerId = await seedEmployee();
  const departmentId = randomUUID();
  const department = await prisma.organization.create({ data: { id: departmentId, name: '案件业务部', code: randomUUID(), path: `/${departmentId}`, type: 'DEPARTMENT', status: 'ENABLED' } });
  const intakeData: CaseIntake = {};
  for (const [key, , kind] of INTAKE_FIELDS.filter(field => !field[2].startsWith('formula'))) intakeData[key] = kind === 'datetime' ? '2026-09-14T02:30:00.000Z' : kind === 'boolean' ? 'true' : kind === 'user' ? lawyerId : kind === 'multi' ? JSON.stringify([INTAKE_OPTIONS[key][0]]) : kind === 'integerRatio' ? '25' : kind === 'number' ? '123.45' : kind === 'money' ? '123.45' : kind === 'ratio' ? '25.00' : kind === 'department' ? department.id : kind === 'select' ? INTAKE_OPTIONS[key][0] : key === 'customerPhone' ? '13800000001' : `字段-${key}`;
  intakeData.agencyProcedure = '自定义';
  const updated = await service.updateCase(id, { customerId, lawyerId, fee: '9999999999999999.99', intakeData, description: '完整描述', version: 1 });
  assert.deepEqual(updated.intakeData, intakeData);
  assert.equal(updated.fee, '9999999999999999.99');
  assert.equal((await service.getCase(id)).lawyerName, '律师甲');
  for (const keyword of ['字段-contractNumber', '字段-region', '刑事', '客户甲']) assert.equal((await service.listCases({ keyword })).list.some(item => item.id === id), true);
  const cleared = await service.updateCase(id, { intakeData: {}, fee: '0', description: '', version: 2 });
  assert.deepEqual(cleared.intakeData, {});
  assert.equal(cleared.description, null);
  await assert.rejects(() => service.updateCase(id, { lawyerId: null, version: 3 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(() => service.updateCase(id, { intakeData: { departmentId: 'missing' }, version: 3 }), { code: 'VALIDATION_FAILED' });
});

test('editing attachments is atomic, rejects foreign files and cleans replaced disk files', async () => {
  const context = caseContext('files', { permissionCodes: [...CASE_PERMISSIONS, 'case.file.manage', 'case.file.read'] });
  const service = new CaseService(prisma, actor('files'), context);
  const file = { fileName: '合同.pdf', fileType: 'application/pdf', category: '合同附件' as const, base64: Buffer.from('original').toString('base64') };
  const created = await service.createCase({ title: '带附件', caseType: '民事', customerId: await seedCustomer(), lawyerId: await seedEmployee(), attachments: [file] });
  const stored = await prisma.caseFile.findFirstOrThrow({ where: { caseId: created.id } });
  const disk = path.join(process.cwd(), 'var/storage/case-files', stored.filePath);
  const failing = prisma.$extends({ query: { operationLog: { create: async () => { throw new Error('injected audit failure'); } } } });
  await assert.rejects(() => new CaseService(failing as typeof prisma, actor('files'), context).updateCase(created.id, { version: 1, title: '不应保存', removeAttachmentIds: [stored.id], attachments: [{ ...file, base64: Buffer.from('new').toString('base64') }] }), /injected audit failure/);
  assert.equal((await service.getCase(created.id)).version, 1);
  assert.equal(fs.readFileSync(disk, 'utf8'), 'original');
  await assert.rejects(() => service.updateCase(created.id, { version: 1, removeAttachmentIds: ['foreign-file'] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(() => serviceFor('no-files', actor('no-files')).updateCase(created.id, { version: 1, removeAttachmentIds: [stored.id] }), { code: 'PERMISSION_DENIED', status: 403 });
  await service.updateCase(created.id, { version: 1, removeAttachmentIds: [stored.id], attachments: [{ ...file, category: '退款凭证' }] });
  assert.equal(fs.existsSync(disk), false);
  const list = await service.listCases({});
  assert.equal(list.list[0].files?.[0].category, '退款凭证');
  assert.equal((await serviceFor('no-files', actor('no-files')).getCase(created.id)).files, undefined);
  await service.deleteCase(created.id, { version: 2 });
});

test('deletion enforces permission/version/state and protects financial contracts and costs', async () => {
  const service = serviceFor('delete', actor('delete'));
  const id = await seedCase();
  await assert.rejects(() => serviceFor('reader', actor('reader'), { permissionCodes: ['case.read'] }).deleteCase(id, { version: 1 }), { code: 'PERMISSION_DENIED', status: 403 });
  await assert.rejects(() => service.deleteCase(id, { version: 2 }), { code: 'VERSION_CONFLICT' });
  const row = await prisma.case.findUniqueOrThrow({ where: { id } });
  const contract = await prisma.contract.create({ data: { contractNo: randomUUID(), contractType: 'FORMAL', title: '关联财务合同', customerId: row.customerId, createdBy: 'seed' } });
  await prisma.case.update({ where: { id }, data: { contractId: contract.id } });
  await assert.rejects(() => service.deleteCase(id, { version: 1 }), { code: 'CASE_IN_USE' });
  const otherCustomerId = await seedCustomer();
  await assert.rejects(() => service.updateCase(id, { version: 1, customerId: otherCustomerId }), { code: 'VALIDATION_FAILED' });
  await prisma.case.update({ where: { id }, data: { contractId: null } });
  await prisma.costEntry.create({ data: { category: 'CASE_HANDLING', occurredAt: new Date(), amount: 10, caseId: id, createdBy: 'seed' } });
  await assert.rejects(() => service.deleteCase(id, { version: 1 }), { code: 'CASE_IN_USE' });
  const closed = await seedCase('已结案', 'CLOSED');
  await assert.rejects(() => service.deleteCase(closed, { version: 1 }), { code: 'CASE_STATE_INVALID' });
});

test('deletion rolls back on audit failure and preserves the selected case children for recovery', async () => {
  const service = serviceFor('delete', actor('delete'));
  const id = await seedCase(), otherId = await seedCase('保留案件');
  await taskServiceFor('delete', actor('delete')).createTask(id, { name: '本案任务', nodeType: '立案准备' });
  await commServiceFor('delete', actor('delete')).createCommunication(id, { type: 'PHONE', content: '本案沟通' });
  const version = (await service.getCase(id)).version;
  const failing = prisma.$extends({ query: { operationLog: { create: async () => { throw new Error('injected delete audit failure'); } } } });
  await assert.rejects(() => new CaseService(failing as typeof prisma, actor('delete'), caseContext('delete')).deleteCase(id, { version }), /injected delete audit failure/);
  assert.equal((await service.getCase(id)).tasks.length, 1);
  await service.deleteCase(id, { version });
  await assert.rejects(() => service.getCase(id), { code: 'CASE_NOT_FOUND' });
  assert.equal(await prisma.caseTask.count({ where: { caseId: id } }), 1);
  assert.equal(await prisma.communication.count({ where: { caseId: id } }), 1);
  assert.equal((await service.getCase(otherId)).title, '保留案件');
  assert.ok(await prisma.operationLog.findFirst({ where: { targetId: id, action: 'CASE_DELETE' } }));
});

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

test('case intake and categorized attachments persist atomically and missing lawyer/invalid department are rejected', async () => {
  const customerId = await seedCustomer(), lawyerId = await seedEmployee();
  const service = serviceFor('intake-user', actor('intake-user'), { permissionCodes: [...CASE_PERMISSIONS, 'case.file.manage'] });
  const input = { title: '扩展建档', customerId, lawyerId, caseType: '合同纠纷' };
  await assert.rejects(() => service.createCase({ ...input, lawyerId: undefined }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(() => service.createCase({ ...input, customerId: '' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(() => service.createCase({ ...input, intakeData: { departmentId: 'missing' } }), { code: 'VALIDATION_FAILED' });
  const attachments = [{ fileName: '合同.pdf', fileType: 'application/pdf', category: '合同附件' as const, base64: Buffer.from('test document').toString('base64') }];
  await assert.rejects(() => serviceFor('no-files', actor('no-files')).createCase({ ...input, attachments }), { name: 'AuthorizationError' });
  const row = await service.createCase({ ...input, intakeData: { fixedAgencyFee: '12.30', signedDate: '2026-09-14', caseCategory: '民事', totalReceivedAmount: '1000', riskAgencyRatio: '20' }, attachments });
  const stored = await service.getCase(row.id);
  assert.equal(stored.intakeData.fixedAgencyFee, '12.30');
  assert.equal(stored.intakeData.riskAgencyRatio, '20.00');
  assert.equal(stored.intakeData.signedDate, '2026-09-14');
  const file = await prisma.caseFile.findFirstOrThrow({ where: { caseId: row.id } });
  assert.equal(file.category, '合同附件');
  const storedPath = path.join(process.cwd(), 'var/storage/case-files', file.filePath);
  assert.equal(fs.readFileSync(storedPath, 'utf8'), 'test document');
  fs.unlinkSync(storedPath);
  assert.ok(stored.createdAt && stored.updatedAt);

  const storage = path.join(process.cwd(), 'var/storage/case-files');
  const before = fs.readdirSync(storage).sort();
  const failing = prisma.$extends({ query: { operationLog: { async create() { throw new Error('simulated transaction failure'); } } } });
  const failingService = new CaseService(failing as unknown as typeof prisma, actor('intake-user'), caseContext('intake-user', { permissionCodes: [...CASE_PERMISSIONS, 'case.file.manage'] }));
  await assert.rejects(() => failingService.createCase({ ...input, attachments }), /simulated transaction failure/);
  assert.deepEqual(fs.readdirSync(storage).sort(), before);
  assert.equal(await prisma.case.count(), 1);
  assert.equal(await prisma.caseFile.count(), 1);
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

test('pending formula amounts retain historical values and reject direct overwrites', async () => {
  const service=serviceFor('editor',actor('editor'));
  const id=await seedCase();
  await prisma.case.update({where:{id},data:{intakeData:{lawyerCommissionAmount:'120.00'}}});
  await assert.rejects(service.updateCase(id,{version:1,intakeData:{lawyerCommissionAmount:'1.00'}}),{code:'VALIDATION_FAILED'});
  const saved=await service.updateCase(id,{version:1,intakeData:{region:'上海'}});
  assert.equal(saved.intakeData?.lawyerCommissionAmount,'120.00');
});
