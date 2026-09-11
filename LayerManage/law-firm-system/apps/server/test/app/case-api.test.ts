// SPEC-033 Task 3: case HTTP API 端到端测试（案件生命周期 + 任务状态机 + 沟通 + 结案）。
// 覆盖 plan Task 3 Step 1 三焦点：权限 403 / 状态机 / 审计透传，另含字面量子路由参数透传
// （PATCH /cases/:id/tasks/:taskId 双参数作用域）与错误码透传。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/case-api.test.ts

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

const FULL_CASE_PERMISSIONS = [
  'case.read', 'case.create', 'case.update', 'case.close', 'case.task.manage', 'case.communication.create',
];

/** 案件域业务会话夹具（仿 cost-api T10 先例；case 不做行级 scope，scope 仅保持夹具同构）。 */
async function createCaseSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `case.api.${suffix}`,
      password: 'not-used',
      employeeId: null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CASE API ${suffix}`,
      code: `CASE_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

async function seedCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '案件客户',
      phone: '13800009999',
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
      name: '主办律师',
      phone: '13800008888',
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

test('requires authentication for every case endpoint', async () => {
  await app.httpRequest().get('/api/v1/cases').expect(401);
  await app.httpRequest().get(`/api/v1/cases/${randomUUID()}`).expect(401);
  await app.httpRequest().post('/api/v1/cases').send({ title: 'x' }).expect(401);
  await app.httpRequest().put(`/api/v1/cases/${randomUUID()}`).send({ title: 'x' }).expect(401);
  await app.httpRequest().post(`/api/v1/cases/${randomUUID()}/close`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/cases/${randomUUID()}/tasks`).send({ name: 'x' }).expect(401);
  await app.httpRequest().patch(`/api/v1/cases/${randomUUID()}/tasks/${randomUUID()}`).send({ status: 'IN_PROGRESS' }).expect(401);
  await app.httpRequest().post(`/api/v1/cases/${randomUUID()}/communications`).send({ type: 'PHONE', content: 'x' }).expect(401);
});

test('rejects authenticated users without case permissions', async () => {
  const ordinary = await createCaseSession([]);
  await app.httpRequest().get('/api/v1/cases').set(bearer(ordinary.token)).expect(403);
  const denied = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(ordinary.token))
    .send({ title: 'x', customerId: randomUUID(), caseType: '民事' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');

  // 只有 case.read：读通、写拒。
  const reader = await createCaseSession(['case.read']);
  await app.httpRequest().get('/api/v1/cases').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(reader.token))
    .send({ title: 'x', customerId: randomUUID(), caseType: '民事' })
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/cases/${randomUUID()}/close`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/cases/${randomUUID()}/tasks`)
    .set(bearer(reader.token))
    .send({ name: 'x', nodeType: '立案准备' })
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/cases/${randomUUID()}/communications`)
    .set(bearer(reader.token))
    .send({ type: 'PHONE', content: 'x' })
    .expect(403);
});

test('creates, lists, updates, and reads a case end to end with audit passthrough', async () => {
  const session = await createCaseSession(FULL_CASE_PERMISSIONS);
  const customerId = await seedCustomer();
  const lawyerId = await seedEmployee();

  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '合同纠纷案', customerId, lawyerId, caseType: '合同纠纷', priority: 'HIGH', fee: '12000.00' })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.priority, 'HIGH');
  assert.equal(created.body.data.fee, '12000.00');
  assert.ok(created.body.data.caseNo.startsWith('CA'), 'case number uses the CA prefix');
  assert.equal(created.body.data.lawyerId, lawyerId);
  assert.equal(created.body.data.version, 1, 'created case view exposes version 1');
  const caseId = created.body.data.id as string;

  // 审计透传：API 写操作落 operation_log，actor 为请求用户。
  const audit = await prisma.operationLog.findFirst({ where: { action: 'CASE_CREATE', targetType: 'CASE', targetId: caseId } });
  assert.ok(audit, 'a CASE_CREATE audit is written');
  assert.equal(audit.userId, session.userId);

  const list = await app.httpRequest()
    .get('/api/v1/cases')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, caseId);
  assert.equal(list.body.data.list[0].lawyerId, lawyerId);

  const updated = await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '改后标题', priority: 'URGENT', version: 1 })
    .expect(200);
  assert.equal(updated.body.data.title, '改后标题');
  assert.equal(updated.body.data.priority, 'URGENT');
  assert.equal(updated.body.data.version, 2, 'successful update bumps version');

  const detail = await app.httpRequest()
    .get(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, caseId);
  assert.equal(detail.body.data.title, '改后标题');
  assert.equal(detail.body.data.version, 2);
  assert.equal(detail.body.data.tasks.length, 0);
  assert.equal(detail.body.data.communications.length, 0);
});

test('enforces the case optimistic lock and version whitelist through the API', async () => {
  const session = await createCaseSession(FULL_CASE_PERMISSIONS);
  const customerId = await seedCustomer();
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '乐观锁案件', customerId, caseType: '民事' })
    .expect(200);
  const caseId = created.body.data.id as string;
  assert.equal(created.body.data.version, 1);

  // 缺 version → 400 VALIDATION_FAILED（白名单/校验透传）。
  const noVersion = await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '缺版本' })
    .expect(400);
  assert.equal(noVersion.body.message, 'VALIDATION_FAILED');

  // 非法 version（0）→ 400 VALIDATION_FAILED。
  await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '零版本', version: 0 })
    .expect(400);

  // 正确 version → 200 + version+1。
  const ok = await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '第一笔', version: 1 })
    .expect(200);
  assert.equal(ok.body.data.version, 2);

  // 持旧 version 再改 → 409 VERSION_CONFLICT（与成本域语义对齐）。
  const stale = await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '第二笔', version: 1 })
    .expect(409);
  assert.equal(stale.body.message, 'VERSION_CONFLICT');
});

test('drives the case task state machine and communications through the API, then closes', async () => {
  const session = await createCaseSession(FULL_CASE_PERMISSIONS);
  const customerId = await seedCustomer();
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '刑案', customerId, caseType: '刑事' })
    .expect(200);
  const caseId = created.body.data.id as string;

  const task = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/tasks`)
    .set(bearer(session.token))
    .send({ name: '收集材料', nodeType: '材料收集', dueDate: '2026-08-10' })
    .expect(200);
  assert.equal(task.body.data.status, 'PENDING');
  const taskId = task.body.data.id as string;

  const inProgress = await app.httpRequest()
    .patch(`/api/v1/cases/${caseId}/tasks/${taskId}`)
    .set(bearer(session.token))
    .send({ status: 'IN_PROGRESS' })
    .expect(200);
  assert.equal(inProgress.body.data.status, 'IN_PROGRESS');

  const completed = await app.httpRequest()
    .patch(`/api/v1/cases/${caseId}/tasks/${taskId}`)
    .set(bearer(session.token))
    .send({ status: 'COMPLETED' })
    .expect(200);
  assert.equal(completed.body.data.status, 'COMPLETED');
  assert.ok(completed.body.data.completedAt, 'completedAt is set on COMPLETED');

  const communication = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/communications`)
    .set(bearer(session.token))
    .send({ type: 'WECHAT', content: '已与客户沟通', isKey: true })
    .expect(200);
  assert.equal(communication.body.data.isKey, true);

  // 详情透传 tasks + communications。
  const withData = await app.httpRequest()
    .get(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(withData.body.data.tasks.length, 1);
  assert.equal(withData.body.data.tasks[0].status, 'COMPLETED');
  assert.equal(withData.body.data.communications.length, 1);
  assert.equal(withData.body.data.communications[0].type, 'WECHAT');

  // 结案 → CLOSED + closedAt；重复结案 → 409。
  const closed = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/close`)
    .set(bearer(session.token))
    .send({ result: '胜诉', satisfaction: 5 })
    .expect(200);
  assert.equal(closed.body.data.status, 'CLOSED');
  assert.ok(closed.body.data.closedAt, 'closedAt is set');
  assert.equal(closed.body.data.result, '胜诉');
  assert.equal(closed.body.data.satisfaction, 5);

  const closeAudit = await prisma.operationLog.findFirst({ where: { action: 'CASE_CLOSE', targetType: 'CASE', targetId: caseId } });
  assert.ok(closeAudit, 'a CASE_CLOSE audit is written');
  assert.equal(closeAudit.userId, session.userId);

  const doubleClose = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/close`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(doubleClose.body.message, 'CASE_STATE_INVALID');

  // 终态动作拒：结案后更新/任务/沟通 → 409 CASE_STATE_INVALID。
  await app.httpRequest()
    .put(`/api/v1/cases/${caseId}`)
    .set(bearer(session.token))
    .send({ title: '再改', version: 1 })
    .expect(409);
  await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/tasks`)
    .set(bearer(session.token))
    .send({ name: '新任务', nodeType: '执行' })
    .expect(409);
  await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/communications`)
    .set(bearer(session.token))
    .send({ type: 'PHONE', content: 'x' })
    .expect(409);
});

test('carries case validation, state-machine, and not-found error codes; scopes task params', async () => {
  const session = await createCaseSession(FULL_CASE_PERMISSIONS);
  const customerId = await seedCustomer();

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: 'x', customerId, caseType: '民事', bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 客户不存在 → 400 VALIDATION_FAILED（存在性探针，非 FK 500）。
  const forgedCustomer = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: 'x', customerId: randomUUID(), caseType: '民事' })
    .expect(400);
  assert.equal(forgedCustomer.body.message, 'VALIDATION_FAILED');

  // 律师不存在 → 400 VALIDATION_FAILED。
  const forgedLawyer = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: 'x', customerId, lawyerId: randomUUID(), caseType: '民事' })
    .expect(400);
  assert.equal(forgedLawyer.body.message, 'VALIDATION_FAILED');

  // 缺 title / 非法优先级 / 非法分页：400 VALIDATION_FAILED。
  await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ customerId, caseType: '民事' })
    .expect(400);
  await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: 'x', customerId, caseType: '民事', priority: 'MAXIMUM' })
    .expect(400);
  await app.httpRequest().get('/api/v1/cases?page=0').set(bearer(session.token)).expect(400);
  await app.httpRequest().get('/api/v1/cases?page=abc').set(bearer(session.token)).expect(400);

  // 不存在案件：404 CASE_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/cases/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'CASE_NOT_FOUND');
  await app.httpRequest()
    .post(`/api/v1/cases/${randomUUID()}/close`)
    .set(bearer(session.token))
    .send({})
    .expect(404);

  // 任务参数透传 + 作用域：caseId 存在但 taskId 不存在 → 404 CASE_TASK_NOT_FOUND；
  // 跨案件任务（A 的任务挂在 B 下）→ 404（findFirst 按 {id, caseId} 作用域）。
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '作用域案件', customerId, caseType: '民事' })
    .expect(200);
  const caseA = created.body.data.id as string;
  const other = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '另一案件', customerId, caseType: '民事' })
    .expect(200);
  const caseB = other.body.data.id as string;
  const task = await app.httpRequest()
    .post(`/api/v1/cases/${caseA}/tasks`)
    .set(bearer(session.token))
    .send({ name: '立案', nodeType: '立案准备' })
    .expect(200);
  const taskA = task.body.data.id as string;

  const missingTask = await app.httpRequest()
    .patch(`/api/v1/cases/${caseA}/tasks/${randomUUID()}`)
    .set(bearer(session.token))
    .send({ status: 'IN_PROGRESS' })
    .expect(404);
  assert.equal(missingTask.body.message, 'CASE_TASK_NOT_FOUND');

  const crossCase = await app.httpRequest()
    .patch(`/api/v1/cases/${caseB}/tasks/${taskA}`)
    .set(bearer(session.token))
    .send({ status: 'IN_PROGRESS' })
    .expect(404);
  assert.equal(crossCase.body.message, 'CASE_TASK_NOT_FOUND');

  // 非法状态翻转 PENDING → COMPLETED：409 CASE_TASK_STATE_INVALID。
  const invalidFlip = await app.httpRequest()
    .patch(`/api/v1/cases/${caseA}/tasks/${taskA}`)
    .set(bearer(session.token))
    .send({ status: 'COMPLETED' })
    .expect(409);
  assert.equal(invalidFlip.body.message, 'CASE_TASK_STATE_INVALID');

  // 沟通 type 非法枚举：400 VALIDATION_FAILED。
  const badComm = await app.httpRequest()
    .post(`/api/v1/cases/${caseA}/communications`)
    .set(bearer(session.token))
    .send({ type: 'SMS', content: 'x' })
    .expect(400);
  assert.equal(badComm.body.message, 'VALIDATION_FAILED');
});
