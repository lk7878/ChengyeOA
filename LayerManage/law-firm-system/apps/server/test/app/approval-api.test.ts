import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

// SPEC-013 Task 6: approval HTTP API 端到端测试（审批中心全链：
// definitions → apply → list/get → process 定稿 → withdraw → 三权限门禁 403 → 错误码透传 → 幂等）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/approval-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

const BASIC_FORM_SCHEMA = {
  fields: [
    { key: 'amount', label: '金额', type: 'number', required: true },
    { key: 'category', label: '类别', type: 'text', required: true },
  ],
};

/** 审批会话夹具（仿 invoice-api T10 先例）：BUSINESS 角色 + RolePermission connect by code。
 *  审批无组织锚（不建 DataScope）——服务层只 requireAction 动作码，不参与范围解析。 */
async function createApprovalSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `approval.api.${suffix}`,
      password: 'not-used',
      employeeId: null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `APPROVAL ${suffix}`,
      code: `APPROVAL_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

async function createDefinition(overrides: {
  code: string;
  createdBy: string;
  businessType?: string;
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  status?: string;
}) {
  return prisma.approvalDefinition.create({
    data: {
      code: overrides.code,
      name: overrides.code,
      businessType: overrides.businessType ?? 'EXPENSE',
      formSchema: overrides.formSchema ?? (BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue),
      approverRule: overrides.approverRule ?? ({ type: 'USER', userIds: [] } as unknown as Prisma.InputJsonValue),
      status: overrides.status ?? 'ACTIVE',
      createdBy: overrides.createdBy,
    },
  });
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

const VALID_CONTENT = { amount: '1200.50', category: '差旅' };

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

test('requires authentication for every approval endpoint', async () => {
  await app.httpRequest().get('/api/v1/approvals').expect(401);
  await app.httpRequest().get('/api/v1/approvals/definitions').expect(401);
  await app.httpRequest().get(`/api/v1/approvals/${randomUUID()}`).expect(401);
  await app.httpRequest().post('/api/v1/approvals').send({}).expect(401);
  await app.httpRequest().post(`/api/v1/approvals/${randomUUID()}/withdraw`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/approvals/${randomUUID()}/process`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/approvals/${randomUUID()}/forward`).send({}).expect(401);
});

test('rejects authenticated users without approval permissions on every gate', async () => {
  const ordinary = await createApprovalSession([]);
  const denied = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(ordinary.token))
    .send({ definitionCode: 'EXPENSE', title: 'x', content: VALID_CONTENT })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/approvals?role=APPLIED').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest().get('/api/v1/approvals/definitions').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/process`)
    .set(bearer(ordinary.token))
    .send({ action: 'APPROVE' })
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/withdraw`)
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/forward`)
    .set(bearer(ordinary.token))
    .send({ forwardToUserId: 'x' })
    .expect(403);
});

test('approval.read permits list/get but gates create, withdraw, process, and definitions', async () => {
  const reader = await createApprovalSession(['approval.read']);
  const list = await app.httpRequest()
    .get('/api/v1/approvals?role=APPLIED')
    .set(bearer(reader.token))
    .expect(200);
  assert.equal(list.body.data.total, 0);

  const missing = await app.httpRequest()
    .get(`/api/v1/approvals/${randomUUID()}`)
    .set(bearer(reader.token))
    .expect(404);
  assert.equal(missing.body.message, 'APPROVAL_INSTANCE_NOT_FOUND');

  await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(reader.token))
    .send({ definitionCode: 'EXPENSE', title: 'x', content: VALID_CONTENT })
    .expect(403);
  await app.httpRequest().get('/api/v1/approvals/definitions').set(bearer(reader.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/withdraw`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/process`)
    .set(bearer(reader.token))
    .send({ action: 'APPROVE' })
    .expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/forward`)
    .set(bearer(reader.token))
    .send({ forwardToUserId: 'x' })
    .expect(403);
});

test('approval.apply permits create/withdraw/definitions but gates read and process', async () => {
  const applyOnly = await createApprovalSession(['approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applyOnly.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });

  const definitions = await app.httpRequest()
    .get('/api/v1/approvals/definitions')
    .set(bearer(applyOnly.token))
    .expect(200);
  assert.equal(definitions.body.data.length, 1);

  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applyOnly.token))
    .send({ definitionCode: 'EXPENSE', title: '仅发起', content: VALID_CONTENT })
    .expect(200);
  assert.equal(created.body.data.status, 'PENDING');

  // withdraw 自己发起的实例可通（approval.apply）。
  const withdrawn = await app.httpRequest()
    .post(`/api/v1/approvals/${created.body.data.id}/withdraw`)
    .set(bearer(applyOnly.token))
    .send({})
    .expect(200);
  assert.equal(withdrawn.body.data.status, 'WITHDRAWN');

  // 无 approval.read / approval.process：list、process 均 403。
  await app.httpRequest().get('/api/v1/approvals?role=APPLIED').set(bearer(applyOnly.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/approvals/${randomUUID()}/process`)
    .set(bearer(applyOnly.token))
    .send({ action: 'APPROVE' })
    .expect(403);
});

test('approval.process permits process but gates create, read, and definitions', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '待审批', content: VALID_CONTENT })
    .expect(200);
  const taskId = created.body.data.tasks[0].id as string;

  const processed = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(approver.token))
    .send({ action: 'APPROVE' })
    .expect(200);
  assert.equal(processed.body.data.status, 'APPROVED');

  await app.httpRequest().post('/api/v1/approvals').set(bearer(approver.token)).send({}).expect(403);
  await app.httpRequest().get('/api/v1/approvals?role=APPLIED').set(bearer(approver.token)).expect(403);
  await app.httpRequest().get('/api/v1/approvals/definitions').set(bearer(approver.token)).expect(403);
});

test('end to end: definitions → apply → list APPLIED → get → process finalize → list states', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  await createDefinition({
    code: 'SEAL',
    createdBy: applicant.userId,
    businessType: 'SEAL',
    status: 'DISABLED',
  });

  // 发起审批页表单渲染：仅 ACTIVE 定义，code 升序。
  const definitions = await app.httpRequest()
    .get('/api/v1/approvals/definitions')
    .set(bearer(applicant.token))
    .expect(200);
  assert.deepEqual(definitions.body.data.map((item: { code: string }) => item.code), ['EXPENSE']);
  assert.equal(definitions.body.data[0].businessType, 'EXPENSE');
  assert.equal(definitions.body.data[0].status, 'ACTIVE');
  assert.deepEqual(
    definitions.body.data[0].formSchema.fields.map((field: { key: string }) => field.key),
    ['amount', 'category'],
  );

  // apply：PENDING + 恰 1 task 指派给 approver。
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '七月差旅报销', content: VALID_CONTENT })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.equal(created.body.message, 'success');
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.applicantId, applicant.userId);
  assert.equal(created.body.data.title, '七月差旅报销');
  assert.deepEqual(created.body.data.content, VALID_CONTENT);
  assert.equal(created.body.data.decidedBy, null);
  assert.equal(created.body.data.version, 1);
  assert.equal(created.body.data.tasks.length, 1);
  const instanceId = created.body.data.id as string;
  const taskId = created.body.data.tasks[0].id as string;
  assert.equal(created.body.data.tasks[0].assigneeId, approver.userId);
  assert.equal(created.body.data.tasks[0].status, 'PENDING');

  // list APPLIED：仅申请人可见，分页默认 page1/pageSize20。
  const applied = await app.httpRequest()
    .get('/api/v1/approvals?role=APPLIED')
    .set(bearer(applicant.token))
    .expect(200);
  assert.equal(applied.body.data.total, 1);
  assert.equal(applied.body.data.page, 1);
  assert.equal(applied.body.data.pageSize, 20);
  assert.equal(applied.body.data.list[0].id, instanceId);
  assert.equal(applied.body.data.list[0].tasks.length, 1);

  // get 详情。
  const detail = await app.httpRequest()
    .get(`/api/v1/approvals/${instanceId}`)
    .set(bearer(applicant.token))
    .expect(200);
  assert.equal(detail.body.data.id, instanceId);
  assert.deepEqual(detail.body.data.content, VALID_CONTENT);

  // process 定稿：任一通过 → APPROVED + 实例 version+1。
  const processed = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(approver.token))
    .send({ action: 'APPROVE', remark: '资料齐全，同意' })
    .expect(200);
  assert.equal(processed.body.data.status, 'APPROVED');
  assert.equal(processed.body.data.decidedBy, approver.userId);
  assert.ok(processed.body.data.decidedAt);
  assert.equal(processed.body.data.version, 2);
  assert.equal(processed.body.data.tasks[0].status, 'APPROVED');
  assert.equal(processed.body.data.tasks[0].remark, '资料齐全，同意');

  // 列表状态翻转：approver TODO 0 / DONE 1；applicant APPLIED 已是 APPROVED。
  const todo = await app.httpRequest()
    .get('/api/v1/approvals?role=TODO')
    .set(bearer(approver.token))
    .expect(200);
  assert.equal(todo.body.data.total, 0);
  const done = await app.httpRequest()
    .get('/api/v1/approvals?role=DONE')
    .set(bearer(approver.token))
    .expect(200);
  assert.equal(done.body.data.total, 1);
  assert.equal(done.body.data.list[0].id, instanceId);
  const appliedAfter = await app.httpRequest()
    .get('/api/v1/approvals?role=APPLIED')
    .set(bearer(applicant.token))
    .expect(200);
  assert.equal(appliedAfter.body.data.list[0].status, 'APPROVED');

  // 事件 + 审计落库（钉死：恰 1 完成事件）。
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
  );
});

test('applicant withdraws a PENDING instance; stranger 404; non-PENDING 409', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  const stranger = await createApprovalSession(['approval.read', 'approval.apply']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '可撤回申请', content: VALID_CONTENT })
    .expect(200);
  const instanceId = created.body.data.id as string;

  // 非申请人撤回：统一 404 不泄露存在性。
  const strangerWithdraw = await app.httpRequest()
    .post(`/api/v1/approvals/${instanceId}/withdraw`)
    .set(bearer(stranger.token))
    .send({ reason: '越权撤回' })
    .expect(404);
  assert.equal(strangerWithdraw.body.message, 'APPROVAL_INSTANCE_NOT_FOUND');
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope withdraw never mutates the instance');

  // 申请人撤回：PENDING → WITHDRAWN + 待办取消。
  const withdrawn = await app.httpRequest()
    .post(`/api/v1/approvals/${instanceId}/withdraw`)
    .set(bearer(applicant.token))
    .send({ reason: '重复提交' })
    .expect(200);
  assert.equal(withdrawn.body.data.status, 'WITHDRAWN');
  assert.equal(withdrawn.body.data.version, 2);
  assert.ok(withdrawn.body.data.tasks.every((task: { status: string }) => task.status === 'CANCELLED'));

  // 非 PENDING 再撤回：409 APPROVAL_STATE_INVALID。
  const again = await app.httpRequest()
    .post(`/api/v1/approvals/${instanceId}/withdraw`)
    .set(bearer(applicant.token))
    .send({})
    .expect(409);
  assert.equal(again.body.message, 'APPROVAL_STATE_INVALID');
});

test('process with a duplicate idempotencyKey replays idempotently with zero extra events', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '幂等重放', content: VALID_CONTENT })
    .expect(200);
  const taskId = created.body.data.tasks[0].id as string;

  const first = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(approver.token))
    .send({ action: 'APPROVE', idempotencyKey: 'cb-api-1' })
    .expect(200);
  const replayed = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(approver.token))
    .send({ action: 'APPROVE', idempotencyKey: 'cb-api-1' })
    .expect(200);
  assert.equal(replayed.body.data.status, 'APPROVED');
  assert.equal(replayed.body.data.version, first.body.data.version, 'replay returns the first result state');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
  );
});

test('process on a task cancelled by another approver returns APPROVAL_STATE_INVALID 409', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approverA = await createApprovalSession(['approval.read', 'approval.process']);
  const approverB = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: {
      type: 'USER',
      userIds: [approverA.userId, approverB.userId],
    } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '双审批人', content: VALID_CONTENT })
    .expect(200);
  const tasks = created.body.data.tasks as Array<{ id: string; assigneeId: string }>;
  const taskA = tasks.find(task => task.assigneeId === approverA.userId)!;
  const taskB = tasks.find(task => task.assigneeId === approverB.userId)!;

  await app.httpRequest()
    .post(`/api/v1/approvals/${taskA.id}/process`)
    .set(bearer(approverA.token))
    .send({ action: 'APPROVE' })
    .expect(200);

  const cancelled = await app.httpRequest()
    .post(`/api/v1/approvals/${taskB.id}/process`)
    .set(bearer(approverB.token))
    .send({ action: 'APPROVE' })
    .expect(409);
  assert.equal(cancelled.body.message, 'APPROVAL_STATE_INVALID');
  assert.equal(cancelled.body.code, 409);
});

test('carries approval validation and state error codes through the API envelope', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  await createDefinition({
    code: 'SEAL',
    createdBy: applicant.userId,
    businessType: 'SEAL',
    approverRule: { type: 'USER', userIds: [] } as unknown as Prisma.InputJsonValue,
  });

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: 'x', content: VALID_CONTENT, bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // content 缺必填字段：400 VALIDATION_FAILED。
  const missingField = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: 'x', content: { category: '差旅' } })
    .expect(400);
  assert.equal(missingField.body.message, 'VALIDATION_FAILED');

  // 未知定义：404 APPROVAL_DEFINITION_NOT_FOUND。
  const noDefinition = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'NOPE', title: 'x', content: VALID_CONTENT })
    .expect(404);
  assert.equal(noDefinition.body.message, 'APPROVAL_DEFINITION_NOT_FOUND');

  // 空审批人 USER 列表：400 APPROVAL_ASSIGNEE_INVALID。
  const noApprover = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'SEAL', title: 'x', content: VALID_CONTENT })
    .expect(400);
  assert.equal(noApprover.body.message, 'APPROVAL_ASSIGNEE_INVALID');

  // 自审：409 APPROVAL_SELF_REVIEW_FORBIDDEN。
  await createDefinition({
    code: 'SELF',
    createdBy: applicant.userId,
    businessType: 'TRANSFER',
    approverRule: { type: 'USER', userIds: [applicant.userId] } as unknown as Prisma.InputJsonValue,
  });
  const selfReview = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'SELF', title: '自审', content: VALID_CONTENT })
    .expect(409);
  assert.equal(selfReview.body.message, 'APPROVAL_SELF_REVIEW_FORBIDDEN');

  // 列表 role 非法：400 VALIDATION_FAILED。
  const badRole = await app.httpRequest()
    .get('/api/v1/approvals?role=ARCHIVED')
    .set(bearer(applicant.token))
    .expect(400);
  assert.equal(badRole.body.message, 'VALIDATION_FAILED');

  // 列表缺 role：400 VALIDATION_FAILED（role 必填透传）。
  const noRole = await app.httpRequest()
    .get('/api/v1/approvals')
    .set(bearer(applicant.token))
    .expect(400);
  assert.equal(noRole.body.message, 'VALIDATION_FAILED');

  // page 非法：400 VALIDATION_FAILED。
  const badPage = await app.httpRequest()
    .get('/api/v1/approvals?role=APPLIED&page=abc')
    .set(bearer(applicant.token))
    .expect(400);
  assert.equal(badPage.body.message, 'VALIDATION_FAILED');

  // 实例缺失：404 APPROVAL_INSTANCE_NOT_FOUND。
  const noInstance = await app.httpRequest()
    .get(`/api/v1/approvals/${randomUUID()}`)
    .set(bearer(applicant.token))
    .expect(404);
  assert.equal(noInstance.body.message, 'APPROVAL_INSTANCE_NOT_FOUND');

  // 处理他人 task（有 approval.process 但非 assignee）：404 APPROVAL_TASK_NOT_FOUND。
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: 'x', content: VALID_CONTENT })
    .expect(200);
  const taskId = created.body.data.tasks[0].id as string;
  const otherProcessor = await createApprovalSession(['approval.process']);
  const wrongTask = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(otherProcessor.token))
    .send({ action: 'APPROVE' })
    .expect(404);
  assert.equal(wrongTask.body.message, 'APPROVAL_TASK_NOT_FOUND');
});

test('list paginates with page/pageSize and stays within actor scope', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  for (let index = 0; index < 3; index += 1) {
    await app.httpRequest()
      .post('/api/v1/approvals')
      .set(bearer(applicant.token))
      .send({ definitionCode: 'EXPENSE', title: `第${index}个`, content: VALID_CONTENT })
      .expect(200);
  }

  const paged = await app.httpRequest()
    .get('/api/v1/approvals?role=APPLIED&page=2&pageSize=2')
    .set(bearer(applicant.token))
    .expect(200);
  assert.equal(paged.body.data.total, 3);
  assert.equal(paged.body.data.page, 2);
  assert.equal(paged.body.data.pageSize, 2);
  assert.equal(paged.body.data.list.length, 1);
  // createdAt DESC：第 3 个最新 → 第 1 个最旧；page2 应为最旧的第 1 个。
  assert.equal(paged.body.data.list[0].title, '第0个');
});

// ==================== SPEC-017 Task 2: 定义管理 API（approval.manage）====================

test('definition management endpoints require authentication', async () => {
  await app.httpRequest().post('/api/v1/approvals/definitions').send({}).expect(401);
  await app.httpRequest().get('/api/v1/approvals/definitions/manage').expect(401);
  await app.httpRequest().patch('/api/v1/approvals/definitions/EXPENSE').send({}).expect(401);
});

test('definition management endpoints require approval.manage (403 without it)', async () => {
  const ordinary = await createApprovalSession([]);
  await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);
  await app.httpRequest()
    .get('/api/v1/approvals/definitions/manage')
    .set(bearer(ordinary.token))
    .expect(403);
  await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);
});

test('POST /approvals/definitions creates an ACTIVE definition with approval.manage', async () => {
  const manager = await createApprovalSession(['approval.manage']);

  const created = await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(manager.token))
    .send({
      code: 'SITE_VISIT',
      name: '到访审批',
      businessType: 'SEAL',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] },
    })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.equal(created.body.message, 'success');
  assert.equal(created.body.data.code, 'SITE_VISIT');
  assert.equal(created.body.data.name, '到访审批');
  assert.equal(created.body.data.businessType, 'SEAL');
  assert.equal(created.body.data.version, 1);
  assert.equal(created.body.data.status, 'ACTIVE');
  assert.equal(created.body.data.nodeSchema, null);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'SITE_VISIT' } });
  assert.equal(stored.version, 1);
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(stored.createdBy, manager.userId);

  // 重复 code：400 APPROVAL_DEFINITION_CODE_CONFLICT，零写入。
  const conflict = await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(manager.token))
    .send({
      code: 'SITE_VISIT',
      name: '重复到访',
      businessType: 'SEAL',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] },
    })
    .expect(400);
  assert.equal(conflict.body.message, 'APPROVAL_DEFINITION_CODE_CONFLICT');
  assert.equal(await prisma.approvalDefinition.count(), 1);

  // 非法 code：400 VALIDATION_FAILED。
  const badCode = await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(manager.token))
    .send({
      code: 'site visit',
      name: '小写带空格',
      businessType: 'SEAL',
      formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
      approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] },
    })
    .expect(400);
  assert.equal(badCode.body.message, 'VALIDATION_FAILED');
  assert.equal(await prisma.approvalDefinition.count(), 1);
});

test('GET /approvals/definitions/manage returns every definition including DISABLED ordered by code', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });
  await createDefinition({ code: 'SEAL', createdBy: manager.userId, businessType: 'SEAL', status: 'DISABLED' });

  const list = await app.httpRequest()
    .get('/api/v1/approvals/definitions/manage')
    .set(bearer(manager.token))
    .expect(200);
  assert.deepEqual(list.body.data.map((item: { code: string }) => item.code), ['EXPENSE', 'SEAL']);
  assert.equal(list.body.data.find((item: { code: string }) => item.code === 'SEAL').status, 'DISABLED');
  assert.equal(list.body.data.find((item: { code: string }) => item.code === 'EXPENSE').status, 'ACTIVE');
});

test('PATCH /approvals/definitions/:code updates whitelist fields and bumps version', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  const updated = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({ name: '费用报销（新）' })
    .expect(200);
  assert.equal(updated.body.data.code, 'EXPENSE');
  assert.equal(updated.body.data.name, '费用报销（新）');
  assert.equal(updated.body.data.status, 'ACTIVE');
  assert.equal(updated.body.data.version, 2);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2);
  assert.equal(stored.name, '费用报销（新）');

  // 缺失定义：404 APPROVAL_DEFINITION_NOT_FOUND。
  const missing = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/NOPE')
    .set(bearer(manager.token))
    .send({ name: 'x' })
    .expect(404);
  assert.equal(missing.body.message, 'APPROVAL_DEFINITION_NOT_FOUND');
});

test('PATCH /approvals/definitions/:code status=DISABLED disables the definition for apply', async () => {
  const manager = await createApprovalSession(['approval.manage', 'approval.apply']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  const disabled = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({ status: 'DISABLED' })
    .expect(200);
  assert.equal(disabled.body.data.status, 'DISABLED');
  assert.equal(disabled.body.data.version, 2);

  // apply 列表不再含 EXPENSE（DISABLED 拒 apply）。
  const defs = await app.httpRequest()
    .get('/api/v1/approvals/definitions')
    .set(bearer(manager.token))
    .expect(200);
  assert.deepEqual(defs.body.data.map((item: { code: string }) => item.code), []);

  // manage 列表仍含 EXPENSE（DISABLED 可见）。
  const manage = await app.httpRequest()
    .get('/api/v1/approvals/definitions/manage')
    .set(bearer(manager.token))
    .expect(200);
  assert.deepEqual(manage.body.data.map((item: { code: string }) => item.code), ['EXPENSE']);
  assert.equal(manage.body.data[0].status, 'DISABLED');
});

test('PATCH /approvals/definitions/:code with both update fields and status applies both', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  const combined = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({ name: '费用报销（新）', status: 'DISABLED' })
    .expect(200);
  assert.equal(combined.body.data.name, '费用报销（新）', 'update applied');
  assert.equal(combined.body.data.status, 'DISABLED', 'status applied');
  assert.equal(combined.body.data.version, 3, 'update + status flip each bump version once');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.name, '费用报销（新）');
  assert.equal(stored.status, 'DISABLED');
  assert.equal(stored.version, 3);

  // 组合方法单事务确定性信号：同体 PATCH 只产生一条合并审计（旧两调用路径会产生
  // APPROVAL_DEFINITION_UPDATE + APPROVAL_DEFINITION_STATUS 两条，且 version 语义不同）。
  // 注：createDefinition helper 走裸 prisma create（不经服务层），故不产生 CREATE 审计——
  // 此处断言恰为一条合并 UPDATE。
  const audits = await prisma.operationLog.findMany({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: stored.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(
    audits.map(audit => audit.action),
    ['APPROVAL_DEFINITION_UPDATE'],
    'the same-body PATCH writes a single merged audit (single-transaction combined method)',
  );
  const merged = JSON.parse(audits[0].newValues ?? '{}') as Record<string, unknown>;
  assert.equal(merged.fromVersion, 1);
  assert.equal(merged.toVersion, 3);
  assert.equal(merged.fromStatus, 'ACTIVE');
  assert.equal(merged.toStatus, 'DISABLED');
});

// ==================== SPEC-024 同体 PATCH 真原子（组合方法）====================

test('PATCH /approvals/definitions/:code same-body with a stale client version yields a deterministic APPROVAL_STATE_INVALID 409', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  // 确定性 409 构造（SPEC-024 评审 M3 裁决）：不依赖两 HTTP 请求的时序竞争（可被服务器串行化
  // 导致双 200），而是用「先异动 version、再以旧 version 调用」——先直接推进 version（模拟并发
  // 写入者已提交），客户端随后持旧 version 发同体 PATCH → 组合方法第一段 guardVersion=1 与
  // 当前 version=2 不符 → updateMany count=0 → 409 APPROVAL_STATE_INVALID。全程无时序依赖。
  await prisma.approvalDefinition.update({ where: { code: 'EXPENSE' }, data: { version: { increment: 1 } } });

  const res = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({ name: '旧版本同体', status: 'DISABLED', version: 1 })
    .expect(409);
  assert.equal(res.body.message, 'APPROVAL_STATE_INVALID');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2, 'the stale-version PATCH writes nothing');
  assert.equal(stored.name, 'EXPENSE');
  assert.equal(stored.status, 'ACTIVE');
});

test('PATCH /approvals/definitions/:code same-body with an invalid status is a 400 that writes nothing', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({ name: '费用（非法 status）', status: 'BOGUS' })
    .expect(400);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.name, 'EXPENSE', 'update fields are not applied when status is invalid');
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(stored.version, 1, 'no write occurred — validation precedes the transaction');
});

test('PATCH /approvals/definitions/:code with an empty body is a 400', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPENSE')
    .set(bearer(manager.token))
    .send({})
    .expect(400);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 1, 'an empty PATCH changes nothing');
});

// ==================== SPEC-019 审批转交（forward）====================

test('forward requires approval.process: 403 for a session without it even with approval.manage', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '待转交', content: VALID_CONTENT })
    .expect(200);
  const taskId = created.body.data.tasks[0].id as string;

  // 无 approval.process（applicant 有 read+apply）：403。
  await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(applicant.token))
    .send({ forwardToUserId: approver.userId })
    .expect(403);
  // approval.manage 但无 approval.process：403。
  await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(manager.token))
    .send({ forwardToUserId: approver.userId })
    .expect(403);
  // 评审 Important 修复：转交→申请人被拒（自审绕过，409 且零变异）。
  const toApplicant = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: applicant.userId })
    .expect(409);
  assert.equal(toApplicant.body.message, 'APPROVAL_SELF_REVIEW_FORBIDDEN');

  // 有 approval.process 的 assignee 可通（200 + 视图 assigneeId 变更）——目标用申请人以外的任意 userId。
  const targetUserId = randomUUID();
  const forwarded = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: targetUserId })
    .expect(200);
  assert.equal(forwarded.body.data.tasks[0].assigneeId, targetUserId);
  assert.equal(forwarded.body.data.tasks[0].status, 'PENDING');
});

test('POST /api/v1/approvals/:id/forward transfers the PENDING task to the target user', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approverA = await createApprovalSession(['approval.read', 'approval.process']);
  const approverB = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approverA.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '转交测试', content: VALID_CONTENT })
    .expect(200);
  const instanceId = created.body.data.id as string;
  const taskId = created.body.data.tasks[0].id as string;
  assert.equal(created.body.data.tasks[0].assigneeId, approverA.userId);

  const forwarded = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approverA.token))
    .send({ forwardToUserId: approverB.userId, remark: '休假转交' })
    .expect(200);
  assert.equal(forwarded.body.code, 200);
  assert.equal(forwarded.body.message, 'success');
  assert.equal(forwarded.body.data.status, 'PENDING', 'instance status unchanged');
  assert.equal(forwarded.body.data.version, 1, 'instance version unchanged');
  assert.equal(forwarded.body.data.currentNode, 0);
  const task = forwarded.body.data.tasks.find((t: { id: string }) => t.id === taskId);
  assert.equal(task.assigneeId, approverB.userId, 'assigneeId changed to the target user');
  assert.equal(task.status, 'PENDING', 'task status stays PENDING');
  assert.equal(task.version, 2, 'task version bumped once');

  // 审计 + 零事件 + 零 callbackAction（D6/D7/D8）。
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_TASK', targetId: taskId, action: 'APPROVAL_TASK_FORWARD' },
  });
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    taskId,
    fromUserId: approverA.userId,
    toUserId: approverB.userId,
    hasReason: true,
  });
  assert.ok(!audit.newValues?.includes('休假转交'), 'remark stays out of audit values');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId } }),
    1,
    'exactly one apply-time created event, zero new forward events',
  );
  assert.equal(await prisma.callbackAction.count({ where: { instanceId } }), 0, 'forward creates no callbackAction');
});

test('forward error codes pass through the API envelope', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  const stranger = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '错误码', content: VALID_CONTENT })
    .expect(200);
  const taskId = created.body.data.tasks[0].id as string;

  // 非 assignee（stranger 有 approval.process）：404 APPROVAL_TASK_NOT_FOUND。
  const notMine = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(stranger.token))
    .send({ forwardToUserId: approver.userId })
    .expect(404);
  assert.equal(notMine.body.message, 'APPROVAL_TASK_NOT_FOUND');

  // 转交→申请人：409 APPROVAL_SELF_REVIEW_FORBIDDEN（评审修复：禁止自审绕过）。
  const toApplicant = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: applicant.userId })
    .expect(409);
  assert.equal(toApplicant.body.message, 'APPROVAL_SELF_REVIEW_FORBIDDEN');

  // 转交给自己：400 APPROVAL_ASSIGNEE_INVALID。
  const selfForward = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: approver.userId })
    .expect(400);
  assert.equal(selfForward.body.message, 'APPROVAL_ASSIGNEE_INVALID');

  // 目标 userId 空：400 VALIDATION_FAILED。
  const emptyTarget = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: '' })
    .expect(400);
  assert.equal(emptyTarget.body.message, 'VALIDATION_FAILED');

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: applicant.userId, bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 定稿后 task 非 PENDING：409 APPROVAL_STATE_INVALID。
  await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/process`)
    .set(bearer(approver.token))
    .send({ action: 'APPROVE' })
    .expect(200);
  const nonPending = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/forward`)
    .set(bearer(approver.token))
    .send({ forwardToUserId: applicant.userId })
    .expect(409);
  assert.equal(nonPending.body.message, 'APPROVAL_STATE_INVALID');
  assert.equal(nonPending.body.code, 409);
});

// ==================== SPEC-020 审批加签（add-signers） ====================

test('add-signers requires approval.process: 403 for a session without it even with approval.manage', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '待加签', content: VALID_CONTENT })
    .expect(200);
  const instanceId = created.body.data.id as string;
  const taskId = created.body.data.tasks[0].id as string;
  const targetUserId = randomUUID();

  // 无 approval.process（applicant 有 read+apply）：403。
  await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/add-signers`)
    .set(bearer(applicant.token))
    .send({ addSignerUserIds: [targetUserId] })
    .expect(403);
  // approval.manage 但无 approval.process：403。
  await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/add-signers`)
    .set(bearer(manager.token))
    .send({ addSignerUserIds: [targetUserId] })
    .expect(403);
  // 无权限时零变异：任务数不变、零审计。
  assert.equal(await prisma.approvalTask.count({ where: { instanceId } }), 1, 'no task is added on a 403');
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', action: 'APPROVAL_TASK_ADD_SIGNER' } }),
    0,
  );
});

test('POST /api/v1/approvals/:id/add-signers adds signers to the current node and returns the updated view', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const approverA = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approverA.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '加签测试', content: VALID_CONTENT })
    .expect(200);
  const instanceId = created.body.data.id as string;
  const taskId = created.body.data.tasks[0].id as string;
  assert.equal(created.body.data.tasks.length, 1);

  const targetUserId = randomUUID();
  const added = await app.httpRequest()
    .post(`/api/v1/approvals/${taskId}/add-signers`)
    .set(bearer(approverA.token))
    .send({ addSignerUserIds: [targetUserId], remark: '请协助审核' })
    .expect(200);
  assert.equal(added.body.code, 200);
  assert.equal(added.body.message, 'success');
  assert.equal(added.body.data.status, 'PENDING', 'instance status unchanged');
  assert.equal(added.body.data.version, 1, 'instance version unchanged');
  assert.equal(added.body.data.currentNode, 0);
  assert.equal(added.body.data.tasks.length, 2, 'view tasks increased by one');
  const newTask = added.body.data.tasks.find((t: { assigneeId: string }) => t.assigneeId === targetUserId);
  assert.equal(newTask.status, 'PENDING');
  assert.equal(newTask.nodeName, '审批', 'new task shares the base node');
  const orig = added.body.data.tasks.find((t: { id: string }) => t.id === taskId);
  assert.equal(orig.assigneeId, approverA.userId, 'the acting task is untouched');
  assert.equal(orig.status, 'PENDING');

  // 审计 + 零事件 + 零 callbackAction（D4/D7/D8）。
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_TASK', targetId: taskId, action: 'APPROVAL_TASK_ADD_SIGNER' },
  });
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    taskId,
    addedUserIds: [targetUserId],
    hasReason: true,
  });
  assert.ok(!audit.newValues?.includes('请协助审核'), 'remark stays out of audit values');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId } }),
    1,
    'exactly one apply-time created event, zero new add-signer events',
  );
  assert.equal(await prisma.callbackAction.count({ where: { instanceId } }), 0, 'add-signers creates no callbackAction');
});

// ==================== SPEC-025 审批定义导入导出（export/import API，approval.manage）====================

test('GET /approvals/definitions/export requires approval.manage (403 without it)', async () => {
  const ordinary = await createApprovalSession([]);
  await app.httpRequest()
    .get('/api/v1/approvals/definitions/export')
    .set(bearer(ordinary.token))
    .expect(403);
});

test('GET /approvals/definitions/export returns every definition including DISABLED ordered by code', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });
  await createDefinition({ code: 'SEAL', createdBy: manager.userId, businessType: 'SEAL', status: 'DISABLED' });

  const exported = await app.httpRequest()
    .get('/api/v1/approvals/definitions/export')
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(exported.body.code, 200);
  assert.equal(exported.body.message, 'success');
  // SPEC-029：导出为 { schemaVersion, definitions } 包络。
  assert.equal(exported.body.data.schemaVersion, 1, 'export carries the current schema version');
  assert.ok(Array.isArray(exported.body.data.definitions), 'export body data.definitions is an array');
  assert.deepEqual(
    exported.body.data.definitions.map((item: { code: string }) => item.code),
    ['EXPENSE', 'SEAL'],
  );
  const seal = exported.body.data.definitions.find((item: { code: string }) => item.code === 'SEAL');
  assert.equal(seal.status, 'DISABLED', 'export includes DISABLED definitions');
  const expense = exported.body.data.definitions.find((item: { code: string }) => item.code === 'EXPENSE');
  assert.equal(expense.businessType, 'EXPENSE');
  assert.deepEqual(
    expense.formSchema.fields.map((field: { key: string }) => field.key),
    ['amount', 'category'],
  );
  assert.equal(typeof expense.version, 'number');
  assert.equal(expense.status, 'ACTIVE');
});

test('POST /approvals/definitions/import requires approval.manage (403 without it)', async () => {
  const ordinary = await createApprovalSession([]);
  await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(ordinary.token))
    .send({ definitions: [] })
    .expect(403);
});

test('POST /approvals/definitions/import upserts definitions by code and returns {imported, updated}', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });
  // SPEC-029 角色校验：定义引用 MANAGER 角色——先供给该角色（测试库无 bootstrap）。
  await prisma.role.create({
    data: {
      name: 'Manager Role', code: 'MANAGER', type: 'BUSINESS', status: 'ENABLED',
      permissions: { create: [] },
    },
  });

  const imported = await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(manager.token))
    .send({
      definitions: [
        {
          code: 'EXPENSE',
          name: '费用报销（导入）',
          businessType: 'EXPENSE',
          formSchema: { fields: [{ key: 'amount', label: '金额', type: 'number', required: true }] },
          approverRule: { type: 'USER', userIds: [] },
        },
        {
          code: 'SITE_VISIT',
          name: '到访审批',
          businessType: 'SEAL',
          formSchema: { fields: [{ key: 'reason', label: '事由', type: 'text', required: true }] },
          approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] },
        },
      ],
    })
    .expect(200);
  assert.equal(imported.body.code, 200);
  assert.equal(imported.body.message, 'success');
  assert.deepEqual(imported.body.data, { imported: 1, updated: 1 });

  const expense = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(expense.name, '费用报销（导入）', 'existing definition updated by import');
  assert.equal(expense.version, 2, 'existing definition bumps version once on import update');
  const siteVisit = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'SITE_VISIT' } });
  assert.equal(siteVisit.version, 1);
  assert.equal(siteVisit.status, 'ACTIVE');
  assert.equal(siteVisit.createdBy, manager.userId);
  assert.equal(await prisma.approvalDefinition.count(), 2, 'import upserts by code, never duplicates');
});

test('literal export/import routes win over the parameterized :code route', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  // 定义真实 code 字面量 EXPORT——确认 :code 参数路由未被字面量路由破坏。
  await createDefinition({ code: 'EXPORT', createdBy: manager.userId });

  // GET /definitions/export 命中字面量导出（200 包络），而非被 :code 吞并（404/单对象）。
  const exported = await app.httpRequest()
    .get('/api/v1/approvals/definitions/export')
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(exported.body.data.schemaVersion, 1, 'export route carries the schema version');
  assert.ok(Array.isArray(exported.body.data.definitions), 'export route is not swallowed by the :code route');
  assert.deepEqual(exported.body.data.definitions.map((item: { code: string }) => item.code), ['EXPORT']);

  // PATCH /definitions/EXPORT 仍命中 :code 更新路由（字面量不吞参数路由）。
  const patched = await app.httpRequest()
    .patch('/api/v1/approvals/definitions/EXPORT')
    .set(bearer(manager.token))
    .send({ name: '导出字面量测试' })
    .expect(200);
  assert.equal(patched.body.data.name, '导出字面量测试');

  // POST /definitions/import 命中字面量导入（200），而非落到 :code（405/404）。
  const imported = await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(manager.token))
    .send({ definitions: [] })
    .expect(200);
  assert.deepEqual(imported.body.data, { imported: 0, updated: 0 });
});

// ==================== SPEC-029 增量导出 + 格式版本 + 关联角色校验（API）====================

test('GET /approvals/definitions/export filters by codes and businessType (SPEC-029)', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });
  await createDefinition({ code: 'SEAL', createdBy: manager.userId, businessType: 'SEAL' });

  const byCodes = await app.httpRequest()
    .get('/api/v1/approvals/definitions/export')
    .query({ codes: 'SEAL,EXPENSE' })
    .set(bearer(manager.token))
    .expect(200);
  assert.deepEqual(
    byCodes.body.data.definitions.map((item: { code: string }) => item.code),
    ['EXPENSE', 'SEAL'],
    'codes comma-list filter narrows the export',
  );

  const byType = await app.httpRequest()
    .get('/api/v1/approvals/definitions/export')
    .query({ businessType: 'SEAL' })
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(byType.body.data.definitions.length, 1);
  assert.equal(byType.body.data.definitions[0].code, 'SEAL');
});

test('POST /approvals/definitions/import rejects a future schemaVersion and missing roles (SPEC-029)', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  const role = await prisma.role.create({
    data: {
      name: 'Import Role', code: 'IMPORT_OK', type: 'BUSINESS', status: 'ENABLED',
      permissions: { create: [] },
    },
  });
  void role;

  // schemaVersion=2（未来格式）→ 400。
  await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(manager.token))
    .send({ schemaVersion: 2, definitions: [] })
    .expect(400);

  // 引用缺失角色 → 400 IMPORTED_ROLE_NOT_FOUND。
  const missing = await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(manager.token))
    .send({
      schemaVersion: 1,
      definitions: [{
        code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE',
        formSchema: BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
        approverRule: { type: 'ROLE', roleCodes: ['NOT_EXIST'] } as unknown as Prisma.InputJsonValue,
      }],
    })
    .expect(400);
  assert.equal(missing.body.message, 'IMPORTED_ROLE_NOT_FOUND');

  // 引用存在角色 → 通过（imported 1）。
  const ok = await app.httpRequest()
    .post('/api/v1/approvals/definitions/import')
    .set(bearer(manager.token))
    .send({
      schemaVersion: 1,
      definitions: [{
        code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE',
        formSchema: BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
        approverRule: { type: 'ROLE', roleCodes: ['IMPORT_OK'] } as unknown as Prisma.InputJsonValue,
      }],
    })
    .expect(200);
  assert.deepEqual(ok.body.data, { imported: 1, updated: 0 });
});

// ==================== SPEC-028 全组织视图导出（/approvals/export，approval.manage）====================

test('GET /approvals/export requires approval.manage (403 without it) and is not captured by :id', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  const reader = await createApprovalSession(['approval.read']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  await app.httpRequest().get('/api/v1/approvals/export').set(bearer(reader.token)).expect(403);

  const exported = await app.httpRequest()
    .get('/api/v1/approvals/export')
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(exported.body.code, 200);
  assert.ok(typeof exported.body.data === 'string', 'export data is the CSV text');
  assert.ok(exported.body.data.startsWith('\uFEFF'), 'CSV starts with a UTF-8 BOM');
  const lines = exported.body.data.replace(/^\uFEFF/, '').split('\r\n');
  assert.deepEqual(lines[0].split(','), ['instanceId', 'businessType', 'title', 'status', 'applicantId', 'currentNode', 'createdAt', 'updatedAt']);
  // \u7A7A\u7ED3\u679C CSV = header + \u5C3E\u90E8 \r\n\uFF08split \u5F97 ['header', '']\uFF09\u3002
  assert.equal(lines.length, 2, 'header + trailing newline when no instances seeded');
  assert.equal(lines[1], '', 'the trailing segment after the final newline is empty');
});

test('GET /approvals/export applies filters and a literal EXPORT instance still resolves to :id', async () => {
  // 导出需 approval.manage；detail（:id）需 approval.read——manager 双持以验证字面量/参数化路由共存。
  const manager = await createApprovalSession(['approval.manage', 'approval.read']);
  const applicant = await createApprovalSession(['approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });

  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '导出筛选用例', content: VALID_CONTENT })
    .expect(200);

  const filtered = await app.httpRequest()
    .get('/api/v1/approvals/export')
    .query({ businessType: 'EXPENSE', keyword: '导出筛选' })
    .set(bearer(manager.token))
    .expect(200);
  const lines = filtered.body.data.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines.length, 2, 'header + one matching instance');
  assert.ok(lines[1].includes('导出筛选用例'));

  const none = await app.httpRequest()
    .get('/api/v1/approvals/export')
    .query({ businessType: 'SEAL' })
    .set(bearer(manager.token))
    .expect(200);
  // \u65E0 SEAL \u5B9E\u4F8B \u2192 header + \u5C3E\u90E8 \r\n\uFF08split \u5F97 2 \u6BB5\uFF0C\u7B2C\u4E8C\u6BB5\u4E3A\u7A7A\uFF09\u3002
  assert.equal(none.body.data.replace(/^\uFEFF/, '').split('\r\n').length, 2, 'no SEAL instances (header + trailing newline)');

  // 字面量 /export 不被 :id 吞并——真实 code EXPORT 详情仍走 :id。
  const detail = await app.httpRequest()
    .get(`/api/v1/approvals/${created.body.data.id}`)
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(detail.body.data.id, created.body.data.id);
});

// ==================== SPEC-030 审批统计（/approvals/stats，approval.manage）====================

test('GET /approvals/stats requires approval.manage and returns the aggregate envelope', async () => {
  const manager = await createApprovalSession(['approval.manage']);
  const reader = await createApprovalSession(['approval.read']);
  await createDefinition({ code: 'EXPENSE', createdBy: manager.userId });

  await app.httpRequest().get('/api/v1/approvals/stats').set(bearer(reader.token)).expect(403);

  const stats = await app.httpRequest()
    .get('/api/v1/approvals/stats')
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(stats.body.code, 200);
  assert.equal(stats.body.data.total, 0, 'no instances seeded');
  assert.equal(stats.body.data.pendingCount, 0);
  assert.equal(stats.body.data.decidedCount, 0);
  assert.deepEqual(stats.body.data.byBusinessType, []);
  assert.deepEqual(stats.body.data.byStatus, []);
  assert.equal(stats.body.data.avgDecisionHours, null);
});

test('GET /approvals/stats applies filters and a literal stats route is not captured by :id', async () => {
  const manager = await createApprovalSession(['approval.manage', 'approval.read']);
  const applicant = await createApprovalSession(['approval.apply']);
  const approver = await createApprovalSession(['approval.read', 'approval.process']);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.userId,
    approverRule: { type: 'USER', userIds: [approver.userId] } as unknown as Prisma.InputJsonValue,
  });
  const created = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'EXPENSE', title: '统计筛选用例', content: VALID_CONTENT })
    .expect(200);

  const stats = await app.httpRequest()
    .get('/api/v1/approvals/stats')
    .query({ businessType: 'EXPENSE' })
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(stats.body.data.total, 1);
  assert.equal(stats.body.data.pendingCount, 1);
  assert.ok(stats.body.data.byStatus.some((item: { status: string; count: number }) => item.status === 'PENDING' && item.count === 1));

  // 字面量 /stats 不被 :id 吞并——真实 id 详情仍走 :id。
  const detail = await app.httpRequest()
    .get(`/api/v1/approvals/${created.body.data.id}`)
    .set(bearer(manager.token))
    .expect(200);
  assert.equal(detail.body.data.id, created.body.data.id);
});


test('approval materials multipart upload, personal type, attachment binding, preview and export use real HTTP authorization', async () => {
  const applicant = await createApprovalSession(['approval.read', 'approval.apply']);
  const reviewer = await createApprovalSession(['approval.read', 'approval.process']);
  const stranger = await createApprovalSession(['approval.read', 'approval.apply']);
  await createDefinition({ code: 'EXPENSE', createdBy: applicant.userId, approverRule: { type: 'USER', userIds: [reviewer.userId] } });
  const type = await app.httpRequest().post('/api/v1/approvals/personal-definitions').set(bearer(applicant.token)).send({ name: '工资绩效发放', templateCode: 'EXPENSE' }).expect(200);
  assert.equal(type.body.data.businessType, 'CUSTOM');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
  const upload = await app.httpRequest().post('/api/v1/approval-files').set(bearer(applicant.token)).attach('file', png, { filename: 'receipt.png', contentType: 'image/png' }).expect(200);
  const fileId = upload.body.data.id;
  assert.equal(upload.body.data.mimeType, 'image/png'); assert.equal(upload.body.data.bytes, undefined);
  await app.httpRequest().get('/api/v1/approval-files/' + fileId).expect(401);
  await app.httpRequest().get('/api/v1/approval-files/' + fileId).set(bearer(stranger.token)).expect(404);
  const created = await app.httpRequest().post('/api/v1/approvals').set(bearer(applicant.token)).send({ definitionCode: type.body.data.code, title: '工资发放', content: VALID_CONTENT, attachmentIds: [fileId], idempotencyKey: randomUUID() }).expect(200);
  const id = created.body.data.id;
  assert.equal(created.body.data.formSnapshot.name, '工资绩效发放');
  const preview = await app.httpRequest().get('/api/v1/approval-files/' + fileId + '?purpose=PREVIEW').set(bearer(reviewer.token)).expect(200);
  assert.equal(preview.body.data.base64, png.toString('base64'));
  await app.httpRequest().delete('/api/v1/approval-files/' + fileId).set(bearer(applicant.token)).expect(409);
  await app.httpRequest().get('/api/v1/approvals/' + id + '/files').set(bearer(stranger.token)).expect(404);
  const exported = await app.httpRequest().get('/api/v1/approvals/' + id + '/material').set(bearer(reviewer.token)).expect(200);
  assert.equal(exported.body.data.attachments.length, 1);
  await app.httpRequest().post('/api/v1/approval-files').set(bearer(applicant.token)).attach('file', png, { filename: 'fake.pdf', contentType: 'application/pdf' }).expect(400);
  const noPermission = await createApprovalSession([]);
  await app.httpRequest().post('/api/v1/approval-files').set(bearer(noPermission.token)).attach('file', png, { filename: 'receipt.png' }).expect(403);
});
