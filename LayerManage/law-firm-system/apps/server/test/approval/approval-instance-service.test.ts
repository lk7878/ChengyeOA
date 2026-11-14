import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ApprovalDefinition, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ApprovalDefinitionService } from '../../app/application/approval/approval-definition-service';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import type { ApprovalInstanceView } from '../../app/application/approval/approval-types';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  APPROVAL_ERROR_CODES,
  ApprovalError,
} from '../../app/domain/approval/approval-errors';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-013 Task 5: approval-instance-service 契约测试（审批中心业务核心）。
// 形态逐段镜像 test/finance/invoice-service.test.ts：直建行夹具（user/role/userRole/
// approvalDefinition）+ 授权上下文桩（resource=permissionCode 前缀）+ 服务调用断言
// （事件/审计/状态翻转/幂等/权限拒绝）。
// 钉死点：approval.instance.created 恰 5 键 / completed 恰 3 键；审计只落标识符
//   （instanceId/definitionCode/businessType/fromStatus/toStatus/hasReason 布尔，
//   content/remark 自由文本不落）；空审批人 ASSIGNEE_INVALID 400 优雅兜底（种子 roleCodes
//   未建角色）；自审 409；任一通过定稿 + 余 task CANCELLED；重复 callbackKey 幂等零事件零审计。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/approval-instance-service.test.ts

let prisma: PrismaClient;

const APPROVAL_PERMISSIONS: PermissionCode[] = [
  'approval.read',
  'approval.apply',
  'approval.process',
];

const BASIC_FORM_SCHEMA = {
  fields: [
    { key: 'amount', label: '金额', type: 'number', required: true },
    { key: 'category', label: '类别', type: 'text', required: true },
  ],
};

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

interface ApprovalContextOverrides {
  permissionCodes?: PermissionCode[];
}

/** 审批授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function approvalContext(userId: string, overrides: ApprovalContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? APPROVAL_PERMISSIONS;
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createApprovalActor(tag: string): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `approval.${tag}.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function instanceServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: ApprovalContextOverrides = {},
): ApprovalInstanceService {
  return new ApprovalInstanceService(prisma, actor, approvalContext(userId, overrides));
}

function definitionServiceFor(userId: string, actor: AuditActor): ApprovalDefinitionService {
  return new ApprovalDefinitionService(prisma, actor, approvalContext(userId));
}

async function createDefinition(overrides: {
  code: string;
  createdBy: string;
  businessType?: string;
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  status?: string;
}): Promise<ApprovalDefinition> {
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

async function createRole(code: string) {
  return prisma.role.create({ data: { name: code, code, type: 'BUSINESS' } });
}

async function assignRole(roleId: string, userId: string) {
  return prisma.userRole.create({ data: { roleId, userId } });
}

/** SPEC-016 多级定义：nodeSchema 链权威，顶层 approverRule 为占位（链消费方忽略）。 */
async function createTwoNodeDefinition(overrides: {
  code: string;
  createdBy: string;
  nodeSchema: Prisma.InputJsonValue;
  businessType?: string;
  formSchema?: Prisma.InputJsonValue;
  status?: string;
}): Promise<ApprovalDefinition> {
  return prisma.approvalDefinition.create({
    data: {
      code: overrides.code,
      name: overrides.code,
      businessType: overrides.businessType ?? 'EXPENSE',
      formSchema: overrides.formSchema ?? (BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue),
      approverRule: { type: 'USER', userIds: [] } as unknown as Prisma.InputJsonValue,
      nodeSchema: overrides.nodeSchema,
      status: overrides.status ?? 'ACTIVE',
      createdBy: overrides.createdBy,
    },
  });
}

function isApprovalError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => error instanceof ApprovalError && error.code === code && error.httpStatus === httpStatus;
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

// ==================== applyForApproval ====================

test('applyForApproval returns APPROVAL_DEFINITION_NOT_FOUND 404 for an unknown or disabled code', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = instanceServiceFor(userId, actor);
  await createDefinition({ code: 'EXPENSE', createdBy: userId, status: 'DISABLED' });

  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'NOPE', title: '不存在', content: {} }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
    'unknown code is indistinguishable from missing',
  );
  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'EXPENSE', title: '已停用', content: {} }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
    'DISABLED definition is not applyable',
  );
  assert.equal(await prisma.approvalInstance.count(), 0);
});

test('applyForApproval rejects content missing a required formSchema field with 400', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = instanceServiceFor(userId, actor);
  const { userId: approverId } = await createApprovalActor('approver');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'EXPENSE', title: '缺金额', content: { category: '差旅' } }),
    isValidationFailed400,
    'required field amount is absent',
  );
  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'EXPENSE', title: '非对象', content: 'not-an-object' as unknown as Record<string, unknown> }),
    isValidationFailed400,
    'content must be a plain object',
  );
  assert.equal(await prisma.approvalInstance.count(), 0);
});

test('applyForApproval returns ASSIGNEE_INVALID 400 when the ROLE resolves to an empty member set', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = instanceServiceFor(userId, actor);
  // 种子 roleCodes（HR/SEAL_ADMIN/...）尚未建角色 → 无行 → 空成员 → 优雅兜底 400 不崩溃。
  await createDefinition({
    code: 'LEAVE',
    createdBy: userId,
    businessType: 'LEAVE',
    formSchema: { fields: [{ key: 'reason', label: '事由', type: 'textarea', required: true }] } as unknown as Prisma.InputJsonValue,
    approverRule: { type: 'ROLE', roleCodes: ['HR'] } as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'LEAVE', title: '无审批人', content: { reason: '家事' } }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
  );
  assert.equal(await prisma.approvalInstance.count(), 0);
});

test('applyForApproval returns ASSIGNEE_INVALID 400 for an empty USER approver list', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = instanceServiceFor(userId, actor);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [] } as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'EXPENSE', title: '无审批人', content: { amount: 1, category: '差旅' } }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
  );
});

test('applyForApproval returns SELF_REVIEW_FORBIDDEN 409 when the applicant is among the approvers', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = instanceServiceFor(userId, actor);
  const { userId: otherId } = await createApprovalActor('approver');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [userId, otherId] } as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'EXPENSE', title: '自审', content: { amount: 1, category: '差旅' } }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409),
  );
  assert.equal(await prisma.approvalInstance.count(), 0);
});

test('applyForApproval creates a PENDING instance with N tasks, approval.instance.created and APPROVAL_APPLY audit', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const service = instanceServiceFor(userId, actor);
  // ROLE 规则：经 roleMemberByCode 解析出 2 成员 → 2 task。
  const role = await createRole('FINANCE');
  await assignRole(role.id, approverA);
  await assignRole(role.id, approverB);
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'ROLE', roleCodes: ['FINANCE'] } as unknown as Prisma.InputJsonValue,
  });

  const view = await service.applyForApproval({
    definitionCode: 'EXPENSE',
    title: '七月差旅报销',
    content: { amount: '1200.50', category: '差旅' },
  });

  assert.ok(view.id);
  assert.equal(view.businessType, 'EXPENSE');
  assert.equal(view.title, '七月差旅报销');
  assert.deepEqual(view.content, { amount: '1200.50', category: '差旅' });
  assert.equal(view.applicantId, userId);
  assert.equal(view.status, 'PENDING');
  assert.equal(view.decidedBy, null);
  assert.equal(view.decidedAt, null);
  assert.equal(view.version, 1);
  assert.equal(view.tasks.length, 2, 'two approvers yield two tasks');
  assert.deepEqual(
    view.tasks.map(task => task.assigneeId).sort(),
    [approverA, approverB].sort(),
  );
  assert.ok(view.tasks.every(task => task.status === 'PENDING' && task.processedBy === null));

  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.definitionVersion, 1);
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id, status: 'PENDING' } }), 2);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: view.id, eventType: 'approval.instance.created' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'APPROVAL');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, null, 'approval has no organizational anchor');
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    instanceId: view.id,
    businessType: 'EXPENSE',
    title: '七月差旅报销',
    applicantId: userId,
    status: 'PENDING',
  }, 'approval.instance.created carries exactly five keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: view.id, action: 'APPROVAL_APPLY' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId: view.id,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'DRAFT',
    toStatus: 'PENDING',
    currentNode: 0,
    hasReason: false,
  }, 'audit holds identifiers only');
  assert.ok(!operationLog.newValues?.includes('差旅'), 'content free text stays out of audit values');
});

test('applyForApproval requires the approval.apply action permission', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: approverId } = await createApprovalActor('approver');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const denied = instanceServiceFor(userId, actor, {
    permissionCodes: ['approval.read', 'approval.process'],
  });

  await assert.rejects(
    () => denied.applyForApproval({ definitionCode: 'EXPENSE', title: '无权限', content: { amount: 1, category: '差旅' } }),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.approvalInstance.count(), 0);
});

// ==================== processTask ====================

async function seedTwoTaskInstance(applicant: AuditActor, approverA: string, approverB: string) {
  const service = instanceServiceFor(applicant.actorUserId, applicant);
  const definition = await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.actorUserId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const view = await service.applyForApproval({
    definitionCode: definition.code,
    title: '双审批人报销',
    content: { amount: '800.00', category: '差旅' },
  });
  const tasks = await prisma.approvalTask.findMany({ where: { instanceId: view.id } });
  return { instanceId: view.id, definition, tasks };
}

/** 共享同一定义建两个独立审批实例（code @unique 不能重复建定义，故复用一次 createDefinition）。 */
async function seedTwoInstances(applicant: AuditActor, approverA: string, approverB: string) {
  const service = instanceServiceFor(applicant.actorUserId, applicant);
  const definition = await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.actorUserId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const viewA = await service.applyForApproval({
    definitionCode: definition.code,
    title: '双审批人报销A',
    content: { amount: '800.00', category: '差旅' },
  });
  const viewB = await service.applyForApproval({
    definitionCode: definition.code,
    title: '双审批人报销B',
    content: { amount: '900.00', category: '差旅' },
  });
  const tasksA = await prisma.approvalTask.findMany({ where: { instanceId: viewA.id } });
  const tasksB = await prisma.approvalTask.findMany({ where: { instanceId: viewB.id } });
  return { instanceAId: viewA.id, instanceBId: viewB.id, tasksA, tasksB };
}

test('processTask APPROVE finalizes the instance and cancels the remaining PENDING tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const taskB = tasks.find(task => task.assigneeId === approverB)!;
  const service = instanceServiceFor(approverA, actorA);

  const view = await service.processTask(taskA.id, { action: 'APPROVE', remark: '资料齐全，同意' });

  assert.equal(view.status, 'APPROVED');
  assert.equal(view.decidedBy, approverA);
  assert.ok(view.decidedAt instanceof Date);
  assert.equal(view.version, 2, 'process bumps the instance version once');
  const afterA = view.tasks.find(task => task.id === taskA.id)!;
  assert.equal(afterA.status, 'APPROVED');
  assert.equal(afterA.processedBy, approverA);
  assert.equal(afterA.remark, '资料齐全，同意');
  assert.equal(afterA.version, 2);
  const afterB = view.tasks.find(task => task.id === taskB.id)!;
  assert.equal(afterB.status, 'CANCELLED', 'remaining PENDING task is cancelled on finalization');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId, eventType: 'approval.instance.completed' },
  });
  assert.equal(event.sourceModule, 'APPROVAL');
  assert.deepEqual(event.payload, {
    instanceId,
    businessType: 'EXPENSE',
    status: 'APPROVED',
  }, 'approval.instance.completed carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: instanceId, action: 'APPROVAL_PROCESS' },
  });
  assert.equal(operationLog.userId, approverA);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
    hasReason: true,
  });
  assert.ok(!operationLog.newValues?.includes('同意'), 'remark free text stays out of audit values');
});

test('processTask REJECT finalizes the instance REJECTED and cancels the remaining tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const taskB = tasks.find(task => task.assigneeId === approverB)!;
  const service = instanceServiceFor(approverA, actorA);

  const view = await service.processTask(taskA.id, { action: 'REJECT' });

  assert.equal(view.status, 'REJECTED');
  assert.equal(view.decidedBy, approverA);
  assert.equal(view.version, 2);
  assert.equal(view.tasks.find(task => task.id === taskA.id)!.status, 'REJECTED');
  assert.equal(view.tasks.find(task => task.id === taskB.id)!.status, 'CANCELLED');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId, eventType: 'approval.instance.completed' },
  });
  assert.deepEqual(event.payload, { instanceId, businessType: 'EXPENSE', status: 'REJECTED' });
  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: instanceId, action: 'APPROVAL_PROCESS' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'PENDING',
    toStatus: 'REJECTED',
    hasReason: false,
  }, 'no remark yields hasReason false');
});

test('processTask returns APPROVAL_TASK_NOT_FOUND 404 for a task not assigned to the actor', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('approver-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const service = instanceServiceFor(approverB, actorB);

  await assert.rejects(
    () => service.processTask(taskA.id, { action: 'APPROVE' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
    'a task assigned to someone else is indistinguishable from missing',
  );
  await assert.rejects(
    () => service.processTask(randomUUID(), { action: 'APPROVE' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope process never mutates the task');
});

test('processTask with a duplicate callbackKey replays idempotently with zero events and audits', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const service = instanceServiceFor(approverA, actorA);

  const first = await service.processTask(taskA.id, { action: 'APPROVE', idempotencyKey: 'cb-1' });
  const replayed = await service.processTask(taskA.id, { action: 'APPROVE', idempotencyKey: 'cb-1' });

  assert.equal(replayed.status, 'APPROVED');
  assert.equal(replayed.version, first.version, 'replay returns the first result state');
  assert.equal(replayed.decidedBy, approverA);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'exactly one approval.instance.completed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
    'exactly one APPROVAL_PROCESS audit',
  );

  const callback = await prisma.callbackAction.findFirstOrThrow({
    where: { callbackKey: 'cb-1' },
  });
  assert.equal(callback.instanceId, instanceId);
  assert.equal(callback.action, 'APPROVE');
  assert.equal(callback.status, 'RESPONDED');
  assert.deepEqual(callback.result as unknown as Record<string, unknown>, {
    instanceId,
    action: 'APPROVE',
    status: 'APPROVED',
    decidedBy: approverA,
  });
});

test('processTask reusing a callbackKey already bound to another instance returns CALLBACK_KEY_CONFLICT 409 and leaves the second instance untouched', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('approver-b');
  const { instanceAId, instanceBId, tasksA, tasksB } = await seedTwoInstances(applicant, approverA, approverB);
  const taskA = tasksA.find(task => task.assigneeId === approverA)!;
  const taskB = tasksB.find(task => task.assigneeId === approverB)!;
  const serviceA = instanceServiceFor(approverA, actorA);
  const serviceB = instanceServiceFor(approverB, actorB);

  await serviceA.processTask(taskA.id, { action: 'APPROVE', idempotencyKey: 'shared-cb' });

  await assert.rejects(
    () => serviceB.processTask(taskB.id, { action: 'APPROVE', idempotencyKey: 'shared-cb' }),
    error =>
      error instanceof ApprovalError
        && error.code === APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT
        && error.httpStatus === 409
        && error.message === 'idempotency key already used for another approval'
        && !error.message.includes(instanceAId),
    'cross-instance callbackKey reuse is a 409 and leaks no foreign instance id',
  );

  const storedTaskB = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskB.id } });
  assert.equal(storedTaskB.status, 'PENDING', 'the second task is never touched');
  assert.equal(storedTaskB.processedBy, null);
  const storedInstanceB = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceBId } });
  assert.equal(storedInstanceB.status, 'PENDING', 'the second instance stays pending');
  assert.equal(storedInstanceB.decidedBy, null);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'exactly one completed event (from instance A)',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
    'exactly one APPROVAL_PROCESS audit (from instance A)',
  );
  assert.equal(await prisma.callbackAction.count({ where: { callbackKey: 'shared-cb' } }), 1);
});

test('processTask concurrently reusing a callbackKey across instances yields one success and one CALLBACK_KEY_CONFLICT 409, never a 500', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('approver-b');
  const { instanceAId, instanceBId, tasksA, tasksB } = await seedTwoInstances(applicant, approverA, approverB);
  const taskA = tasksA.find(task => task.assigneeId === approverA)!;
  const taskB = tasksB.find(task => task.assigneeId === approverB)!;
  const serviceA = instanceServiceFor(approverA, actorA);
  const serviceB = instanceServiceFor(approverB, actorB);

  const results = await Promise.allSettled([
    serviceA.processTask(taskA.id, { action: 'APPROVE', idempotencyKey: 'shared-cb' }),
    serviceB.processTask(taskB.id, { action: 'APPROVE', idempotencyKey: 'shared-cb' }),
  ]);

  assert.equal(results.length, 2);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent process wins the callbackKey');
  assert.equal(rejected.length, 1, 'exactly one concurrent process is rejected');

  const winner = fulfilled[0] as PromiseFulfilledResult<ApprovalInstanceView>;
  assert.equal(winner.value.status, 'APPROVED');

  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ApprovalError, `loser fails with ApprovalError, not ${String(loser.reason)}`);
  assert.equal(loser.reason.code, APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT);
  assert.equal(loser.reason.httpStatus, 409, 'loser is a 409 conflict, not a 500');
  assert.equal(loser.reason.message, 'idempotency key already used for another approval');

  const decidedA = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceAId } });
  const decidedB = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceBId } });
  assert.deepEqual(
    [decidedA.status, decidedB.status].sort(),
    ['APPROVED', 'PENDING'].sort(),
    'the winner finalizes, the loser rolls back to PENDING',
  );
  assert.equal(await prisma.callbackAction.count({ where: { callbackKey: 'shared-cb' } }), 1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'exactly one completed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
    'exactly one APPROVAL_PROCESS audit',
  );
});

test('processTask on an already-processed task without a key replays the current state idempotently', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const service = instanceServiceFor(approverA, actorA);

  const first = await service.processTask(taskA.id, { action: 'APPROVE' });
  const replayed = await service.processTask(taskA.id, { action: 'REJECT' });

  assert.equal(replayed.status, 'APPROVED', 'second call does not change the decided state');
  assert.equal(replayed.version, first.version);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_PROCESS' } }),
    1,
  );
});

test('processTask on a CANCELLED task returns APPROVAL_STATE_INVALID 409', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('approver-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const taskB = tasks.find(task => task.assigneeId === approverB)!;
  const serviceA = instanceServiceFor(approverA, actorA);
  const serviceB = instanceServiceFor(approverB, actorB);

  await serviceA.processTask(taskA.id, { action: 'APPROVE' });

  await assert.rejects(
    () => serviceB.processTask(taskB.id, { action: 'APPROVE' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'a task cancelled by the finalizing approval cannot be processed',
  );
  const storedB = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskB.id } });
  assert.equal(storedB.status, 'CANCELLED');
  assert.equal(storedB.processedBy, null, 'cancelled task is never marked processed');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'the rejected retry writes zero events',
  );
});

test('processTask requires the approval.process action permission', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const denied = instanceServiceFor(approverA, actorA, {
    permissionCodes: ['approval.read', 'approval.apply'],
  });

  await assert.rejects(
    () => denied.processTask(taskA.id, { action: 'APPROVE' }),
    hasCode('PERMISSION_DENIED'),
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.status, 'PENDING');
});

// ==================== withdrawInstance ====================

test('withdrawInstance returns APPROVAL_INSTANCE_NOT_FOUND 404 for a non-owner', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const stranger = instanceServiceFor(approverA, actorA);

  await assert.rejects(
    () => stranger.withdrawInstance(instanceId, { reason: '越权撤回' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND, 404),
    'a non-applicant withdraw is indistinguishable from missing',
  );
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope withdraw never mutates the instance');
});

test('withdrawInstance returns APPROVAL_STATE_INVALID 409 for a non-PENDING instance', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  await instanceServiceFor(approverA, actorA).processTask(taskA.id, { action: 'APPROVE' });

  const owner = instanceServiceFor(applicant.actorUserId, applicant);
  await assert.rejects(
    () => owner.withdrawInstance(instanceId, {}),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'an already-decided instance cannot be withdrawn',
  );
});

test('withdrawInstance withdraws a PENDING instance, cancels its tasks, emits completed(WITHDRAWN) and audit', async () => {
  const { userId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const owner = instanceServiceFor(userId, applicant);

  const view = await owner.withdrawInstance(instanceId, { reason: '重复提交，撤回' });

  assert.equal(view.status, 'WITHDRAWN');
  assert.equal(view.version, 2, 'withdraw bumps the instance version once');
  assert.equal(view.decidedBy, null, 'withdraw does not record a decider');
  assert.equal(view.decidedAt, null);
  assert.ok(view.tasks.every(task => task.status === 'CANCELLED'), 'all pending tasks are cancelled');
  assert.ok(view.tasks.every(task => task.processedBy === null && task.processedAt === null));

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId, eventType: 'approval.instance.completed' },
  });
  assert.deepEqual(event.payload, {
    instanceId,
    businessType: 'EXPENSE',
    status: 'WITHDRAWN',
  }, 'completed(WITHDRAWN) carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: instanceId, action: 'APPROVAL_WITHDRAW' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'PENDING',
    toStatus: 'WITHDRAWN',
    hasReason: true,
  });
  assert.ok(!operationLog.newValues?.includes('重复提交'), 'withdraw reason free text stays out of audit values');
});

test('withdrawInstance requires the approval.apply action permission', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const denied = instanceServiceFor(applicant.actorUserId, applicant, {
    permissionCodes: ['approval.read', 'approval.process'],
  });

  await assert.rejects(() => denied.withdrawInstance(instanceId, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  assert.equal(stored.status, 'PENDING');
});

// ==================== SPEC-016 multilevel (nodeSchema chain) ====================

const TWO_NODE_FORM_SCHEMA = {
  fields: [
    { key: 'contractId', label: '合同', type: 'text', required: true },
    { key: 'changeSummary', label: '变更摘要', type: 'textarea', required: true },
  ],
};

/** 建 2 节点 USER 链定义：主管初审(managerId) → 合伙人终审(partnerId)。 */
async function seedTwoNodeDefinition(
  applicantId: string,
  managerId: string,
  partnerId: string,
  overrides: { code?: string; nodeSchema?: Prisma.InputJsonValue } = {},
): Promise<ApprovalDefinition> {
  return createTwoNodeDefinition({
    code: overrides.code ?? 'EXPENSE',
    createdBy: applicantId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema:
      overrides.nodeSchema
      ?? ([
        { name: '主管初审', approverRule: { type: 'USER', userIds: [managerId] } },
        { name: '合伙人终审', approverRule: { type: 'USER', userIds: [partnerId] } },
      ] as unknown as Prisma.InputJsonValue),
  });
}

test('applyForApproval with a two-node nodeSchema creates only the node[0] task, currentNode=0, and APPLY audit carries currentNode', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: managerId } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const service = instanceServiceFor(userId, actor);
  await seedTwoNodeDefinition(userId, managerId, partnerId);

  const view = await service.applyForApproval({
    definitionCode: 'EXPENSE',
    title: '合同变更',
    content: { contractId: 'CT-2026-001', changeSummary: '延长交付期' },
  });

  assert.equal(view.status, 'PENDING');
  assert.equal(view.currentNode, 0);
  assert.equal(view.decidedBy, null);
  assert.equal(view.tasks.length, 1, 'apply creates only node[0] tasks');
  assert.equal(view.tasks[0].nodeName, '主管初审');
  assert.equal(view.tasks[0].assigneeId, managerId);
  assert.equal(view.tasks[0].status, 'PENDING');

  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.currentNode, 0);
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id } }), 1, 'no node[1] tasks yet');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: view.id, action: 'APPROVAL_APPLY' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.currentNode, 0, 'APPLY audit carries currentNode:0');
});

test('processTask APPROVE on node[0] advances currentNode to 1, creates the node[1] task, and emits no completed event', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedTwoNodeDefinition(applicant.actorUserId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '多级报销', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const node0Task = view.tasks[0];

  const advanced = await instanceServiceFor(managerId, managerActor).processTask(node0Task.id, { action: 'APPROVE', remark: '初审通过' });

  assert.equal(advanced.status, 'PENDING', 'instance stays PENDING at a non-final node');
  assert.equal(advanced.currentNode, 1);
  assert.equal(advanced.decidedBy, null);
  assert.equal(advanced.decidedAt, null);
  const afterNode0 = advanced.tasks.find(task => task.id === node0Task.id)!;
  assert.equal(afterNode0.status, 'APPROVED');
  assert.equal(afterNode0.processedBy, managerId);
  assert.equal(afterNode0.remark, '初审通过');
  const node1Task = advanced.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(node1Task.status, 'PENDING');
  assert.equal(node1Task.assigneeId, partnerId);
  assert.equal(node1Task.processedBy, null);
  assert.equal(advanced.tasks.filter(task => task.status === 'PENDING').length, 1, 'only the node[1] task remains pending');

  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.currentNode, 1);
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.decidedBy, null);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'node advancement emits no completed event',
  );

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: view.id, action: 'APPROVAL_PROCESS' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId: view.id,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'PENDING',
    toStatus: 'PENDING',
    currentNode: 1,
    hasReason: true,
  }, 'advancement audit carries from/to PENDING and currentNode:1');
});

test('processTask APPROVE on the final node finalizes APPROVED with exactly one completed event', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId, actor: partnerActor } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedTwoNodeDefinition(applicant.actorUserId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '两级审批', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const advanced = await instanceServiceFor(managerId, managerActor).processTask(view.tasks[0].id, { action: 'APPROVE' });
  const node1Task = advanced.tasks.find(task => task.nodeName === '合伙人终审')!;

  const final = await instanceServiceFor(partnerId, partnerActor).processTask(node1Task.id, { action: 'APPROVE', remark: '同意' });

  assert.equal(final.status, 'APPROVED');
  assert.equal(final.currentNode, 1);
  assert.equal(final.decidedBy, partnerId);
  assert.ok(final.decidedAt instanceof Date);
  assert.equal(final.version, 3, 'apply + two process calls bump version to 3');
  const n0 = final.tasks.find(task => task.nodeName === '主管初审')!;
  const n1 = final.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(n0.status, 'APPROVED');
  assert.equal(n1.status, 'APPROVED');
  assert.equal(n1.processedBy, partnerId);
  assert.equal(final.tasks.length, 2);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'exactly one completed event across the whole flow',
  );
  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: view.id, eventType: 'approval.instance.completed' },
  });
  assert.deepEqual(event.payload, { instanceId: view.id, businessType: 'EXPENSE', status: 'APPROVED' });
});

test('processTask replay of a node-advancement callbackKey returns the advanced state without duplicating node[1] tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedTwoNodeDefinition(applicant.actorUserId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '推进幂等', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const node0Task = view.tasks[0];
  const managerService = instanceServiceFor(managerId, managerActor);

  const first = await managerService.processTask(node0Task.id, { action: 'APPROVE', idempotencyKey: 'cb-advance' });
  assert.equal(first.status, 'PENDING');
  assert.equal(first.currentNode, 1);

  const replayed = await managerService.processTask(node0Task.id, { action: 'APPROVE', idempotencyKey: 'cb-advance' });
  assert.equal(replayed.currentNode, 1, 'replay returns the advanced state');
  assert.equal(replayed.version, first.version, 'replay writes nothing new');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id } }), 2, 'node[1] task created exactly once');

  const callback = await prisma.callbackAction.findFirstOrThrow({ where: { callbackKey: 'cb-advance' } });
  assert.equal(callback.instanceId, view.id);
  assert.equal(callback.action, 'APPROVE');
  assert.equal(callback.status, 'RESPONDED');
  assert.deepEqual(callback.result as unknown as Record<string, unknown>, {
    instanceId: view.id,
    action: 'APPROVE',
    status: 'PENDING',
    currentNode: 1,
  });
});

test('processTask REJECT at node[0] finalizes REJECTED immediately without creating later node tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedTwoNodeDefinition(applicant.actorUserId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '首节点驳回', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });

  const final = await instanceServiceFor(managerId, managerActor).processTask(view.tasks[0].id, { action: 'REJECT' });

  assert.equal(final.status, 'REJECTED');
  assert.equal(final.currentNode, 0, 'rejection does not advance the node');
  assert.equal(final.decidedBy, managerId);
  assert.equal(final.tasks.length, 1, 'no node[1] tasks were ever created');
  assert.equal(final.tasks[0].status, 'REJECTED');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id } }), 1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
});

test('processTask REJECT at node[1] finalizes REJECTED and leaves no PENDING tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId, actor: partnerActor } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedTwoNodeDefinition(applicant.actorUserId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '末节点驳回', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const advanced = await instanceServiceFor(managerId, managerActor).processTask(view.tasks[0].id, { action: 'APPROVE' });
  const node1Task = advanced.tasks.find(task => task.nodeName === '合伙人终审')!;

  const final = await instanceServiceFor(partnerId, partnerActor).processTask(node1Task.id, { action: 'REJECT', remark: '不符合要求' });

  assert.equal(final.status, 'REJECTED');
  assert.equal(final.currentNode, 1);
  assert.equal(final.decidedBy, partnerId);
  const n0 = final.tasks.find(task => task.nodeName === '主管初审')!;
  const n1 = final.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(n0.status, 'APPROVED', 'already-approved node[0] task stays approved');
  assert.equal(n1.status, 'REJECTED');
  assert.equal(n1.processedBy, partnerId);
  assert.ok(final.tasks.every(task => task.status !== 'PENDING'), 'no task stays pending after rejection');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
});

test('processTask APPROVE advancing to a node whose approvers include the applicant returns SELF_REVIEW_FORBIDDEN 409 and rolls back', async () => {
  const { userId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(userId, applicant);
  // 节点[1] 审批人含申请人 → 推进时自审 409（禁止自审适用全部节点）。
  await seedTwoNodeDefinition(userId, managerId, partnerId, {
    nodeSchema: [
      { name: '主管初审', approverRule: { type: 'USER', userIds: [managerId] } },
      { name: '合伙人终审', approverRule: { type: 'USER', userIds: [userId, partnerId] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '下节点自审', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const node0Task = view.tasks[0];

  await assert.rejects(
    () => instanceServiceFor(managerId, managerActor).processTask(node0Task.id, { action: 'APPROVE' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409),
    'next-node self-review is forbidden at every node',
  );

  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.status, 'PENDING', 'advancement rolls back the instance');
  assert.equal(stored.currentNode, 0, 'currentNode is not advanced');
  const node0Stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: node0Task.id } });
  assert.equal(node0Stored.status, 'PENDING', 'the approved task flip rolls back');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id } }), 1, 'no node[1] tasks created');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
  );
});

test('applyForApproval with NULL nodeSchema falls back to the top-level approverRule single node', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: approverId, actor: approverActor } = await createApprovalActor('approver');
  const service = instanceServiceFor(userId, actor);
  await createDefinition({
    code: 'LEAVE',
    createdBy: userId,
    businessType: 'LEAVE',
    formSchema: { fields: [{ key: 'reason', label: '事由', type: 'textarea', required: true }] } as unknown as Prisma.InputJsonValue,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });

  const view = await service.applyForApproval({ definitionCode: 'LEAVE', title: '请假', content: { reason: '家事' } });

  assert.equal(view.status, 'PENDING');
  assert.equal(view.currentNode, 0);
  assert.equal(view.tasks.length, 1);
  assert.equal(view.tasks[0].nodeName, '审批', 'synthetic single-node name is 审批');
  assert.equal(view.tasks[0].assigneeId, approverId);

  const finalized = await instanceServiceFor(approverId, approverActor).processTask(view.tasks[0].id, { action: 'APPROVE' });
  assert.equal(finalized.status, 'APPROVED');
  assert.equal(finalized.currentNode, 0);
  assert.equal(finalized.version, 2);
});

test('withdrawInstance at node[1] withdraws a PENDING instance and cancels the pending node[1] task', async () => {
  const { userId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId } = await createApprovalActor('partner');
  const applyService = instanceServiceFor(userId, applicant);
  await seedTwoNodeDefinition(userId, managerId, partnerId);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '节点一撤回', content: { contractId: 'CT-1', changeSummary: '调整金额' },
  });
  const advanced = await instanceServiceFor(managerId, managerActor).processTask(view.tasks[0].id, { action: 'APPROVE' });
  assert.equal(advanced.status, 'PENDING');
  assert.equal(advanced.currentNode, 1);
  const node1Task = advanced.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(node1Task.status, 'PENDING');

  const withdrawn = await instanceServiceFor(userId, applicant).withdrawInstance(view.id, { reason: '商务调整，撤回' });

  assert.equal(withdrawn.status, 'WITHDRAWN');
  assert.equal(withdrawn.currentNode, 1);
  assert.equal(withdrawn.decidedBy, null);
  assert.equal(withdrawn.decidedAt, null);
  const n0 = withdrawn.tasks.find(task => task.nodeName === '主管初审')!;
  const n1 = withdrawn.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(n0.status, 'APPROVED', 'already-approved node[0] task stays approved');
  assert.equal(n1.status, 'CANCELLED', 'pending node[1] task is cancelled');
  assert.equal(n1.processedBy, null);
  assert.ok(withdrawn.tasks.every(task => task.status !== 'PENDING'));

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'APPROVAL_INSTANCE', objectId: view.id, eventType: 'approval.instance.completed' },
  });
  assert.deepEqual(event.payload, { instanceId: view.id, businessType: 'EXPENSE', status: 'WITHDRAWN' });
});

test('applyForApproval resolves node approvers via ROLE roleCodes in nodeSchema and advances through ROLE nodes', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('manager');
  const { userId: partnerId, actor: partnerActor } = await createApprovalActor('partner');
  const managerRole = await createRole('MANAGER');
  await assignRole(managerRole.id, managerId);
  const partnerRole = await createRole('PARTNER');
  await assignRole(partnerRole.id, partnerId);
  const service = instanceServiceFor(userId, actor);
  // 沿 Task 2 种子 CONTRACT_CHANGE 形态：MANAGER → PARTNER 角色链。
  await seedTwoNodeDefinition(userId, managerId, partnerId, {
    code: 'CONTRACT_CHANGE',
    nodeSchema: [
      { name: '主管初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] } },
      { name: '合伙人终审', approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] } },
    ] as unknown as Prisma.InputJsonValue,
  });

  const view = await service.applyForApproval({
    definitionCode: 'CONTRACT_CHANGE',
    title: '合同变更',
    content: { contractId: 'CT-2026-002', changeSummary: '变更付款条款' },
  });
  assert.equal(view.tasks.length, 1);
  assert.equal(view.tasks[0].nodeName, '主管初审');
  assert.equal(view.tasks[0].assigneeId, managerId);

  const advanced = await instanceServiceFor(managerId, managerActor).processTask(view.tasks[0].id, { action: 'APPROVE' });
  assert.equal(advanced.status, 'PENDING');
  assert.equal(advanced.currentNode, 1);
  const node1Task = advanced.tasks.find(task => task.nodeName === '合伙人终审')!;
  assert.equal(node1Task.assigneeId, partnerId, 'node[1] ROLE resolves to the PARTNER member');

  const final = await instanceServiceFor(partnerId, partnerActor).processTask(node1Task.id, { action: 'APPROVE' });
  assert.equal(final.status, 'APPROVED');
  assert.equal(final.decidedBy, partnerId);
});

// ==================== listInstances / getInstance ====================

test('listInstances APPLIED returns only the actor applications', async () => {
  const { userId, actor } = await createApprovalActor('me');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const service = instanceServiceFor(userId, actor);
  await service.applyForApproval({ definitionCode: 'EXPENSE', title: '我申请一', content: { amount: 1, category: '差旅' } });
  await service.applyForApproval({ definitionCode: 'EXPENSE', title: '我申请二', content: { amount: 2, category: '差旅' } });
  // 他人申请（applicant=approverA）不属 APPLIED。
  const { userId: other, actor: otherActor } = await createApprovalActor('other');
  const otherService = instanceServiceFor(other, otherActor);
  await otherService.applyForApproval({ definitionCode: 'EXPENSE', title: '他人申请', content: { amount: 3, category: '差旅' } });

  const page = await service.listInstances({ role: 'APPLIED' });
  assert.equal(page.total, 2);
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 20);
  assert.ok(page.list.every(item => item.applicantId === userId));
  assert.deepEqual(page.list.map(item => item.title).sort(), ['我申请一', '我申请二']);
});

test('listInstances TODO returns instances with PENDING tasks assigned to the actor, DONE excludes them', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('approver-b');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicant.actorUserId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  // I1: approverA 待办。
  const i1 = await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '待办A', content: { amount: 1, category: '差旅' } });
  // I2: approverA 处理定稿 → DONE。
  const i2 = await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '已办A', content: { amount: 2, category: '差旅' } });
  // I3: approverB 处理定稿 → approverA 的 task 被取消 → DONE。
  const i3 = await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '他人已办', content: { amount: 3, category: '差旅' } });

  const serviceA = instanceServiceFor(approverA, actorA);
  const taskA2 = await prisma.approvalTask.findFirstOrThrow({ where: { instanceId: i2.id, assigneeId: approverA } });
  await serviceA.processTask(taskA2.id, { action: 'APPROVE' });
  const serviceB = instanceServiceFor(approverB, actorB);
  const taskB3 = await prisma.approvalTask.findFirstOrThrow({ where: { instanceId: i3.id, assigneeId: approverB } });
  await serviceB.processTask(taskB3.id, { action: 'APPROVE' });

  const todo = await serviceA.listInstances({ role: 'TODO' });
  assert.equal(todo.total, 1, 'only the still-pending task instance shows in TODO');
  assert.equal(todo.list[0].id, i1.id);
  const done = await serviceA.listInstances({ role: 'DONE' });
  assert.equal(done.total, 2, 'approved and cancelled task instances both count as DONE');
  assert.deepEqual(
    done.list.map(item => item.id).sort(),
    [i2.id, i3.id].sort(),
  );
});

test('listInstances paginates with createdAt DESC id ASC ordering', async () => {
  const { userId, actor } = await createApprovalActor('me');
  const { userId: approverA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: userId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const service = instanceServiceFor(userId, actor);
  for (let index = 0; index < 3; index += 1) {
    await service.applyForApproval({ definitionCode: 'EXPENSE', title: `第${index}个`, content: { amount: index, category: '差旅' } });
  }

  const paged = await service.listInstances({ role: 'APPLIED', page: 2, pageSize: 2 });
  assert.equal(paged.page, 2);
  assert.equal(paged.pageSize, 2);
  assert.equal(paged.total, 3);
  assert.equal(paged.list.length, 1);
  // createdAt DESC：第 3 个最新 → 第 1 个最旧；page2 应为最旧的第 1 个。
  assert.equal(paged.list[0].title, '第0个');
});

test('getInstance returns the view for owner and assignee, and 404s for a stranger or missing id', async () => {
  const { userId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('approver-a');
  const { userId: approverB } = await createApprovalActor('approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);

  const owner = instanceServiceFor(userId, applicant);
  const ownerView = await owner.getInstance(instanceId);
  assert.equal(ownerView.id, instanceId);
  assert.equal(ownerView.applicantId, userId);
  assert.equal(ownerView.tasks.length, 2);

  const assignee = instanceServiceFor(approverA, actorA);
  const assigneeView = await assignee.getInstance(instanceId);
  assert.equal(assigneeView.id, instanceId);

  const { userId: strangerId, actor: strangerActor } = await createApprovalActor('stranger');
  const stranger = instanceServiceFor(strangerId, strangerActor);
  await assert.rejects(
    () => stranger.getInstance(instanceId),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND, 404),
    'a stranger cannot see the instance (fail-closed)',
  );
  await assert.rejects(
    () => owner.getInstance(randomUUID()),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND, 404),
  );
});

test('listInstances and getInstance require the approval.read action permission', async () => {
  const { userId, actor } = await createApprovalActor('me');
  const denied = instanceServiceFor(userId, actor, {
    permissionCodes: ['approval.apply', 'approval.process'],
  });

  await assert.rejects(() => denied.listInstances({ role: 'APPLIED' }), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.getInstance(randomUUID()), hasCode('PERMISSION_DENIED'));
});

test('listInstances with an invalid role value returns VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createApprovalActor('me');
  const service = instanceServiceFor(userId, actor);
  await assert.rejects(
    () => service.listInstances({ role: 'ARCHIVED' as never }),
    isValidationFailed400,
  );
});

// ==================== SPEC-023 org-wide view (role ALL + getInstance manage passthrough) ====================

test('listInstances role="ALL" without approval.manage returns PERMISSION_DENIED', async () => {
  const { userId, actor } = await createApprovalActor('all-denied');
  const denied = instanceServiceFor(userId, actor, {
    permissionCodes: ['approval.read', 'approval.apply', 'approval.process'],
  });

  await assert.rejects(
    () => denied.listInstances({ role: 'ALL' }),
    hasCode('PERMISSION_DENIED'),
    'the org-wide view requires approval.manage even when approval.read is granted',
  );
});

test('listInstances role="ALL" with approval.manage returns the org-wide list (foreign instances, pagination, createdAt DESC)', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('all-applicant');
  const { userId: approverA } = await createApprovalActor('all-approver-a');
  const { userId: approverB } = await createApprovalActor('all-approver-b');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('all-manager');
  await createDefinition({
    code: 'EXPENSE',
    createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverA, approverB] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicantId, applicant);
  for (let index = 0; index < 3; index += 1) {
    await applyService.applyForApproval({
      definitionCode: 'EXPENSE', title: `全组织${index}`, content: { amount: index, category: '差旅' },
    });
  }
  // 管理用户仅持 approval.manage（无 approval.read）——role ALL 门控只看 manage（D3 动态门控）。
  const managerService = instanceServiceFor(managerId, managerActor, {
    permissionCodes: ['approval.manage'],
  });

  const page1 = await managerService.listInstances({ role: 'ALL' });
  assert.equal(page1.total, 3, 'org-wide list sees every instance regardless of the actor');
  assert.ok(
    page1.list.every(item => item.applicantId !== managerId && item.tasks.every(task => task.assigneeId !== managerId)),
    'the org-wide list includes instances the manager neither applied for nor approves',
  );

  const page = await managerService.listInstances({ role: 'ALL', page: 2, pageSize: 2 });
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 2);
  assert.equal(page.total, 3);
  assert.equal(page.list.length, 1);
  assert.equal(page.list[0].title, '全组织0', 'createdAt DESC: page 2 holds the oldest instance');
});

// ==================== SPEC-028 org-wide filters / search / CSV export ====================

test('listInstances role="ALL" filters by businessType and status', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('filt-applicant');
  const { userId: approverId } = await createApprovalActor('filt-approver');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('filt-manager');
  await createDefinition({
    code: 'EXPENSE', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  await createDefinition({
    code: 'SEAL', businessType: 'SEAL', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicantId, applicant);
  await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '费用一', content: { amount: 1, category: '差旅' } });
  const sealView = await applyService.applyForApproval({ definitionCode: 'SEAL', title: '印章一', content: { amount: 2, category: '用印' } });

  const managerService = instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.manage'] });
  const sealOnly = await managerService.listInstances({ role: 'ALL', businessType: 'SEAL' });
  assert.equal(sealOnly.total, 1, 'businessType SEAL filter keeps only the seal instance');
  assert.equal(sealOnly.list[0].businessType, 'SEAL');
  const expenseOnly = await managerService.listInstances({ role: 'ALL', businessType: 'EXPENSE' });
  assert.equal(expenseOnly.total, 1);

  // 撤回印章实例 → WITHDRAWN，按 status 过滤。
  await applyService.withdrawInstance(sealView.id, {});
  const withdrawnOnly = await managerService.listInstances({ role: 'ALL', status: 'WITHDRAWN' });
  assert.equal(withdrawnOnly.total, 1, 'status WITHDRAWN filter keeps only the withdrawn instance');
  assert.equal(withdrawnOnly.list[0].status, 'WITHDRAWN');
  const pendingOnly = await managerService.listInstances({ role: 'ALL', status: 'PENDING' });
  assert.equal(pendingOnly.total, 1);
});

test('listInstances role="ALL" filters by applicantId and searches title by keyword with AND combination', async () => {
  const { userId: applicantAId, actor: applicantA } = await createApprovalActor('filt-applicant-a');
  const { userId: applicantBId, actor: applicantB } = await createApprovalActor('filt-applicant-b');
  const { userId: approverId } = await createApprovalActor('filt-approver-2');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('filt-manager-2');
  await createDefinition({
    code: 'EXPENSE', createdBy: applicantAId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const serviceA = instanceServiceFor(applicantAId, applicantA);
  const serviceB = instanceServiceFor(applicantBId, applicantB);
  await serviceA.applyForApproval({ definitionCode: 'EXPENSE', title: '差旅报销七月', content: { amount: 1, category: '差旅' } });
  await serviceA.applyForApproval({ definitionCode: 'EXPENSE', title: '差旅报销八月', content: { amount: 2, category: '差旅' } });
  await serviceB.applyForApproval({ definitionCode: 'EXPENSE', title: '差旅垫付', content: { amount: 3, category: '差旅' } });

  const managerService = instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.manage'] });
  const applicantFilter = await managerService.listInstances({ role: 'ALL', applicantId: applicantAId });
  assert.equal(applicantFilter.total, 2, 'applicantId filter keeps only applicant A instances');

  const keyword = await managerService.listInstances({ role: 'ALL', keyword: '报销' });
  assert.equal(keyword.total, 2, 'keyword title search matches two 报销 titles');

  const combined = await managerService.listInstances({ role: 'ALL', applicantId: applicantAId, keyword: '七月' });
  assert.equal(combined.total, 1, 'AND combination narrows to the one July title');
  assert.equal(combined.list[0].title, '差旅报销七月');
});

test('listInstances role="ALL" rejects invalid filter values and non-ALL filters with 400', async () => {
  const { userId, actor } = await createApprovalActor('filt-invalid');
  // 需 read + manage：role='ALL' 门控看 manage、role='APPLIED' 门控看 read（非 ALL 传筛选 400 先于权限域之外）。
  const service = instanceServiceFor(userId, actor, { permissionCodes: ['approval.manage', 'approval.read'] });

  await assert.rejects(
    () => service.listInstances({ role: 'ALL', businessType: 'BOGUS' }),
    isValidationFailed400,
    'an unknown businessType filter is a 400',
  );
  await assert.rejects(
    () => service.listInstances({ role: 'ALL', status: 'BOGUS' }),
    isValidationFailed400,
    'an unknown status filter is a 400',
  );

  // 其余 role 传筛选参数 → 400（语义防混用）。
  await assert.rejects(
    () => service.listInstances({ role: 'APPLIED', keyword: 'x' }),
    isValidationFailed400,
    'a filter on a non-ALL role is a 400',
  );
});

test('exportInstances requires approval.manage and returns RFC 4180 CSV with BOM, escaping, and maxRows', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('csv-applicant');
  const { userId: approverId } = await createApprovalActor('csv-approver');
  const { userId: readerId, actor: readerActor } = await createApprovalActor('csv-reader');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('csv-manager');
  await createDefinition({
    code: 'EXPENSE', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicantId, applicant);
  await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '费用,含逗号', content: { amount: 1, category: '差旅' } });
  await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '费用含"引号"', content: { amount: 2, category: '差旅' } });

  // 无 approval.manage → 403。
  await assert.rejects(
    () => instanceServiceFor(readerId, readerActor, { permissionCodes: ['approval.read'] }).exportInstances({}),
    hasCode('PERMISSION_DENIED'),
    'export requires approval.manage',
  );

  const managerService = instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.manage'] });
  const csv = await managerService.exportInstances({});
  assert.ok(csv.startsWith('\uFEFF'), 'CSV starts with a UTF-8 BOM');
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.deepEqual(lines[0].split(','), ['instanceId', 'businessType', 'title', 'status', 'applicantId', 'currentNode', 'createdAt', 'updatedAt']);
  assert.equal(lines.length, 3, 'header + two instances');
  // 逗号/引号标题字段被 RFC 4180 双引号包裹转义。
  assert.ok(lines.some(line => line.includes('"费用,含逗号"')), 'comma title is quoted');
  assert.ok(lines.some(line => line.includes('"费用含""引号"""')), 'quote title has doubled quotes');

  // maxRows 截断。
  const truncated = await managerService.exportInstances({ maxRows: 1 });
  assert.equal(truncated.replace(/^\uFEFF/, '').split('\r\n').length, 2, 'maxRows=1 keeps header + one row');

  // maxRows 非法 → 400。
  await assert.rejects(
    () => managerService.exportInstances({ maxRows: 10001 }),
    isValidationFailed400,
    'maxRows over the 10000 cap is a 400',
  );
});

// ==================== SPEC-030 approval stats (getStats, approval.manage) ====================

test('getStats requires approval.manage and aggregates total/pending/decided/type/status/avgDecisionHours', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('stats-applicant');
  const { userId: approverId } = await createApprovalActor('stats-approver');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('stats-manager');
  await createDefinition({
    code: 'EXPENSE', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  await createDefinition({
    code: 'SEAL', businessType: 'SEAL', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicantId, applicant);
  await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '费用一', content: { amount: 1, category: '差旅' } });
  const expenseView = await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '费用二', content: { amount: 2, category: '差旅' } });
  const sealView = await applyService.applyForApproval({ definitionCode: 'SEAL', title: '印章一', content: { amount: 3, category: '用印' } });
  // 撤回一张（WITHDRAWN）+ 审批一张（APPROVED）——2 decided + 1 pending。
  await applyService.withdrawInstance(expenseView.id, {});
  await instanceServiceFor(approverId, { actorUserId: approverId, requestId: 'req-stats' }).processTask(
    sealView.tasks.find(task => task.assigneeId === approverId)!.id,
    { action: 'APPROVE' },
  );

  // 无 approval.manage → 403。
  const reader = instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.read'] });
  await assert.rejects(() => reader.getStats({}), hasCode('PERMISSION_DENIED'));

  const managerService = instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.manage'] });
  const stats = await managerService.getStats({});
  assert.equal(stats.total, 3);
  assert.equal(stats.pendingCount, 1, 'one instance stays PENDING');
  assert.equal(stats.decidedCount, 2, 'withdrawn + approved are decided');
  const expenseCount = stats.byBusinessType.find(item => item.businessType === 'EXPENSE');
  const sealCount = stats.byBusinessType.find(item => item.businessType === 'SEAL');
  assert.equal(expenseCount?.count, 2);
  assert.equal(sealCount?.count, 1);
  assert.ok(stats.byStatus.some(item => item.status === 'PENDING' && item.count === 1));
  assert.ok(stats.byStatus.some(item => item.status === 'WITHDRAWN' && item.count === 1));
  assert.ok(stats.byStatus.some(item => item.status === 'APPROVED' && item.count === 1));
  assert.equal(typeof stats.avgDecisionHours, 'number', 'decided instances yield a numeric average');

  // 筛选：仅 SEAL → total 1（印章实例）。
  const sealStats = await managerService.getStats({ businessType: 'SEAL' });
  assert.equal(sealStats.total, 1);
  assert.equal(sealStats.pendingCount, 0, 'the SEAL instance was approved');
  assert.equal(sealStats.decidedCount, 1);
});

test('getStats returns null avgDecisionHours when no instance is decided', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('stats-pending');
  const { userId: approverId } = await createApprovalActor('stats-pending-approver');
  const { userId: managerId, actor: managerActor } = await createApprovalActor('stats-pending-manager');
  await createDefinition({
    code: 'EXPENSE', createdBy: applicantId,
    approverRule: { type: 'USER', userIds: [approverId] } as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicantId, applicant);
  await applyService.applyForApproval({ definitionCode: 'EXPENSE', title: '仅待办', content: { amount: 1, category: '差旅' } });

  const stats = await instanceServiceFor(managerId, managerActor, { permissionCodes: ['approval.manage'] }).getStats({});
  assert.equal(stats.total, 1);
  assert.equal(stats.pendingCount, 1);
  assert.equal(stats.decidedCount, 0);
  assert.equal(stats.avgDecisionHours, null, 'no decided instance → null average');
});

test('getInstance with approval.manage can view any instance detail even when neither applicant nor assignee', async () => {
  const { actor: applicant } = await createApprovalActor('gm-applicant');
  const { userId: approverA } = await createApprovalActor('gm-approver-a');
  const { userId: approverB } = await createApprovalActor('gm-approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const { userId: managerId, actor: managerActor } = await createApprovalActor('gm-manager');
  const managerService = instanceServiceFor(managerId, managerActor, {
    permissionCodes: ['approval.read', 'approval.manage'],
  });

  const view = await managerService.getInstance(instanceId);

  assert.equal(view.id, instanceId);
  assert.equal(view.applicantId, applicant.actorUserId, 'manager sees the true applicant of a foreign instance');
  assert.equal(view.tasks.length, 2);
  assert.ok(view.tasks.every(task => task.assigneeId !== managerId), 'manager is not an assignee yet the detail is visible');
});

test('getInstance without approval.manage still 404s for a non-applicant non-assignee', async () => {
  const { actor: applicant } = await createApprovalActor('gm-applicant');
  const { userId: approverA } = await createApprovalActor('gm-approver-a');
  const { userId: approverB } = await createApprovalActor('gm-approver-b');
  const { instanceId } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const { userId: readerId, actor: readerActor } = await createApprovalActor('gm-reader');
  const readerService = instanceServiceFor(readerId, readerActor, {
    permissionCodes: ['approval.read'],
  });

  await assert.rejects(
    () => readerService.getInstance(instanceId),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND, 404),
    'approval.read alone never exposes a stranger instance (fail-closed)',
  );
});

// ==================== definition service ====================

test('getActiveDefinition returns the ACTIVE definition and 404s for DISABLED or missing', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = definitionServiceFor(userId, actor);
  await createDefinition({ code: 'EXPENSE', createdBy: userId });
  await createDefinition({ code: 'SEAL', createdBy: userId, businessType: 'SEAL', status: 'DISABLED' });

  const view = await service.getActiveDefinition('EXPENSE');
  assert.equal(view.code, 'EXPENSE');
  assert.equal(view.businessType, 'EXPENSE');
  assert.equal(view.status, 'ACTIVE');
  assert.equal(view.version, 1);

  await assert.rejects(
    () => service.getActiveDefinition('SEAL'),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
  );
  await assert.rejects(
    () => service.getActiveDefinition('NOPE'),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
  );
});

test('listDefinitions returns only ACTIVE definitions ordered by code', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const service = definitionServiceFor(userId, actor);
  await createDefinition({ code: 'TRANSFER', createdBy: userId, businessType: 'TRANSFER' });
  await createDefinition({ code: 'LEAVE', createdBy: userId, businessType: 'LEAVE' });
  await createDefinition({ code: 'SEAL', createdBy: userId, businessType: 'SEAL', status: 'DISABLED' });

  const list = await service.listDefinitions();
  assert.deepEqual(list.map(item => item.code), ['LEAVE', 'TRANSFER'], 'DISABLED excluded, code asc');
});

test('definition service requires the approval.apply action permission', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const context = approvalContext(userId, { permissionCodes: ['approval.read', 'approval.process'] });
  const denied = new ApprovalDefinitionService(prisma, actor, context);

  await assert.rejects(() => denied.getActiveDefinition('EXPENSE'), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listDefinitions(), hasCode('PERMISSION_DENIED'));
});

// ==================== SPEC-015 role-provisioning end-to-end ====================

interface EndToEndTypeSpec {
  code: string;
  roleCode: string;
  formSchema: Prisma.InputJsonValue;
  title: string;
  content: Record<string, string>;
}

/** 沿 Definition 种子（migration 20260801120000_approval_provision）的五类 + formSchema 必填字段。 */
const FIVE_TYPE_END_TO_END: readonly EndToEndTypeSpec[] = [
  {
    code: 'LEAVE',
    roleCode: 'HR',
    formSchema: {
      fields: [
        { key: 'startDate', label: '开始日期', type: 'date', required: true },
        { key: 'endDate', label: '结束日期', type: 'date', required: true },
        { key: 'reason', label: '事由', type: 'textarea', required: true },
      ],
    },
    title: '请假申请',
    content: { startDate: '2026-08-03', endDate: '2026-08-05', reason: '家事' },
  },
  {
    code: 'SEAL',
    roleCode: 'SEAL_ADMIN',
    formSchema: {
      fields: [
        { key: 'sealType', label: '用印类型', type: 'text', required: true },
        { key: 'docCount', label: '份数', type: 'number', required: true },
      ],
    },
    title: '用印申请',
    content: { sealType: '公章', docCount: '2' },
  },
  {
    code: 'EXPENSE',
    roleCode: 'FINANCE',
    formSchema: {
      fields: [
        { key: 'amount', label: '金额', type: 'number', required: true },
        { key: 'category', label: '类别', type: 'text', required: true },
      ],
    },
    title: '费用报销',
    content: { amount: '1200.50', category: '差旅' },
  },
  {
    code: 'CONTRACT_CHANGE',
    roleCode: 'PARTNER',
    formSchema: {
      fields: [
        { key: 'contractId', label: '合同', type: 'text', required: true },
        { key: 'changeSummary', label: '变更摘要', type: 'textarea', required: true },
      ],
    },
    title: '合同变更',
    content: { contractId: 'CT-2026-001', changeSummary: '延长交付期' },
  },
  {
    code: 'TRANSFER',
    roleCode: 'HR',
    formSchema: {
      fields: [
        { key: 'targetTeam', label: '目标团队', type: 'text', required: true },
        { key: 'reason', label: '事由', type: 'textarea', required: true },
      ],
    },
    title: '转所申请',
    content: { targetTeam: '深圳分所', reason: '家庭原因' },
  },
];

/**
 * SPEC-015 Task 2 端到端可用性验证：测试内建种子角色（HR/SEAL_ADMIN/FINANCE/PARTNER）成员，
 * 沿 Definition 种子 roleCodes 发起申请 → 断言审批人解析非空（apply 不再 ASSIGNEE_INVALID 400）
 * + 申请成功（PENDING + 恰好 1 task 指派给角色成员）+ 对应成员审批定稿 APPROVED。
 * 每类独立 applicant/approver 用户，规避自审 409。生产代码零改动——纯验证型测试。
 */
async function verifyRoleProvisionedType(type: EndToEndTypeSpec): Promise<void> {
  const { actor: applicant } = await createApprovalActor(`applicant-${type.code}`);
  const { userId: approverId, actor: approverActor } = await createApprovalActor(`approver-${type.code}`);
  const role = await createRole(type.roleCode);
  await assignRole(role.id, approverId);
  await createDefinition({
    code: type.code,
    createdBy: applicant.actorUserId,
    businessType: type.code,
    formSchema: type.formSchema,
    approverRule: { type: 'ROLE', roleCodes: [type.roleCode] } as unknown as Prisma.InputJsonValue,
  });

  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const view = await applyService.applyForApproval({
    definitionCode: type.code,
    title: type.title,
    content: type.content,
  });

  assert.equal(view.status, 'PENDING', `${type.code}: approver resolution non-empty (no ASSIGNEE_INVALID 400)`);
  assert.equal(view.tasks.length, 1, `${type.code}: single role member yields exactly one task`);
  assert.equal(view.tasks[0].assigneeId, approverId, `${type.code}: task assigned to the ${type.roleCode} member`);
  assert.equal(view.tasks[0].status, 'PENDING');

  const processService = instanceServiceFor(approverId, approverActor);
  const finalized = await processService.processTask(view.tasks[0].id, { action: 'APPROVE', remark: '同意' });

  assert.equal(finalized.status, 'APPROVED', `${type.code}: finalizes APPROVED`);
  assert.equal(finalized.decidedBy, approverId);
  assert.equal(finalized.version, 2, `${type.code}: process bumps the instance version once`);
  assert.equal(finalized.tasks.find(task => task.id === view.tasks[0].id)?.status, 'APPROVED');
}

for (const type of FIVE_TYPE_END_TO_END) {
  test(`${type.code} applies via ${type.roleCode} role member and finalizes APPROVED`, async () => {
    await verifyRoleProvisionedType(type);
  });
}

// ==================== SPEC-016 minor 加固（nodeSchema 畸形防护 + 多级测试补强） ====================

test('applyForApproval rejects an empty nodeSchema array with ASSIGNEE_INVALID 400 and zero side effects', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: managerId } = await createApprovalActor('manager');
  const service = instanceServiceFor(userId, actor);
  // 空数组 []（真值但 length 0）→ buildApprovalChain 抛 ASSIGNEE_INVALID 400（既有分支，本用例补直接覆盖）。
  await seedTwoNodeDefinition(userId, managerId, managerId, { code: 'EXPENSE_EMPTY', nodeSchema: [] as unknown as Prisma.InputJsonValue });

  await assert.rejects(
    () => service.applyForApproval({
      definitionCode: 'EXPENSE_EMPTY', title: '空链', content: { contractId: 'CT-1', changeSummary: 'x' },
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
  );
  assert.equal(await prisma.approvalInstance.count(), 0, 'zero instances created');
  assert.equal(await prisma.approvalTask.count(), 0, 'zero tasks created');
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', action: 'APPROVAL_APPLY' } }),
    0,
    'zero APPLY audits on a malformed schema',
  );
});

test('applyForApproval rejects a non-array object nodeSchema with ASSIGNEE_INVALID 400 (harden silent fallback)', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: managerId } = await createApprovalActor('manager');
  const service = instanceServiceFor(userId, actor);
  // SPEC-016 minor 加固（Task 3 ⚠️②）：非数组对象（如 {"foo":"bar"}）此前静默走单节点回落，现抛 400。
  await seedTwoNodeDefinition(userId, managerId, managerId, {
    code: 'EXPENSE_MALFORMED',
    nodeSchema: { foo: 'bar' } as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({
      definitionCode: 'EXPENSE_MALFORMED', title: '畸形链', content: { contractId: 'CT-1', changeSummary: 'x' },
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
  );
  assert.equal(await prisma.approvalInstance.count(), 0, 'zero instances created');
});

test('a three-node chain advances currentNode step by step and finalizes APPROVED at the last node', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: n1 } = await createApprovalActor('node1');
  const { userId: n2 } = await createApprovalActor('node2');
  const { userId: n3 } = await createApprovalActor('node3');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const n1Service = instanceServiceFor(n1, { actorUserId: n1, requestId: 'req-n1' });
  const n2Service = instanceServiceFor(n2, { actorUserId: n2, requestId: 'req-n2' });
  const n3Service = instanceServiceFor(n3, { actorUserId: n3, requestId: 'req-n3' });
  // 3 节点链（USER ×3）——SPEC-016 minor 加固（Task 3 ⚠️④）：补 3 节点直接用例。
  await createTwoNodeDefinition({
    code: 'EXPENSE_3NODE',
    createdBy: applicant.actorUserId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema: [
      { name: '节点一', approverRule: { type: 'USER', userIds: [n1] } },
      { name: '节点二', approverRule: { type: 'USER', userIds: [n2] } },
      { name: '节点三', approverRule: { type: 'USER', userIds: [n3] } },
    ] as unknown as Prisma.InputJsonValue,
  });

  const applied = await applyService.applyForApproval({
    definitionCode: 'EXPENSE_3NODE', title: '三节点', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(applied.currentNode, 0);
  assert.equal(applied.tasks.length, 1, 'only node[0] task at apply');
  assert.equal(applied.tasks[0].nodeName, '节点一');

  const advanced1 = await n1Service.processTask(applied.tasks[0].id, { action: 'APPROVE' });
  assert.equal(advanced1.currentNode, 1, 'node[0] approve advances to node[1]');
  assert.equal(advanced1.tasks.length, 2, 'node[1] task created');
  assert.equal(advanced1.tasks[1].nodeName, '节点二');
  assert.equal(advanced1.tasks[1].status, 'PENDING');

  const advanced2 = await n2Service.processTask(advanced1.tasks[1].id, { action: 'APPROVE' });
  assert.equal(advanced2.currentNode, 2, 'node[1] approve advances to node[2]');
  assert.equal(advanced2.tasks.length, 3, 'node[2] task created');
  assert.equal(advanced2.tasks[2].nodeName, '节点三');

  const finalized = await n3Service.processTask(advanced2.tasks[2].id, { action: 'APPROVE' });
  assert.equal(finalized.status, 'APPROVED', 'final node approve finalizes APPROVED');
  // 每节点一个审批人 APPROVE 后 task 保持 APPROVED——3 节点链全部 3 个 task 均为 APPROVED。
  assert.equal(finalized.tasks.filter(t => t.status === 'APPROVED').length, 3, 'all three node tasks end APPROVED');
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: finalized.id } });
  assert.equal(stored.currentNode, 2, 'currentNode stays at last node index');
});

test('any-one-approves within a multilevel node: first APPROVE cancels sibling PENDING tasks and creates the next-node task', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1 } = await createApprovalActor('node1a');
  const { userId: a2 } = await createApprovalActor('node1b');
  const { userId: b1 } = await createApprovalActor('node2a');
  const a1Service = instanceServiceFor(a1, { actorUserId: a1, requestId: 'req-a1' });
  // SPEC-016 minor 加固（Task 3 ⚠️③）：多级节点内任一通过直接用例——节点[0] 双审批人，
  // 第一个 APPROVE 取消节点[0] 余 PENDING + 创建节点[1] tasks + currentNode=1。
  await createTwoNodeDefinition({
    code: 'EXPENSE_ANYONE',
    createdBy: applicant.actorUserId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema: [
      { name: '双人初审', approverRule: { type: 'USER', userIds: [a1, a2] } },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const applied = await applyService.applyForApproval({
    definitionCode: 'EXPENSE_ANYONE', title: '任一通过', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(applied.tasks.length, 2, 'node[0] has two approver tasks');
  const [first] = applied.tasks;

  const advanced = await a1Service.processTask(first.id, { action: 'APPROVE' });
  assert.equal(advanced.currentNode, 1, 'first node[0] APPROVE advances to node[1]');
  const node0Tasks = advanced.tasks.filter(t => t.nodeName === '双人初审');
  assert.equal(node0Tasks.length, 2, 'node[0] tasks preserved in view');
  assert.equal(node0Tasks.filter(t => t.status === 'APPROVED').length, 1, 'approver who acted is APPROVED');
  assert.equal(node0Tasks.filter(t => t.status === 'CANCELLED').length, 1, 'sibling PENDING task CANCELLED');
  const node1Tasks = advanced.tasks.filter(t => t.nodeName === '终审');
  assert.equal(node1Tasks.length, 1, 'node[1] task created');
  assert.equal(node1Tasks[0].status, 'PENDING');

  // 节点[1] 单审批人 APPROVE → 定稿。
  const b1Service = instanceServiceFor(b1, { actorUserId: b1, requestId: 'req-b1' });
  const finalized = await b1Service.processTask(node1Tasks[0].id, { action: 'APPROVE' });
  assert.equal(finalized.status, 'APPROVED', 'node[1] approve finalizes APPROVED');
});

// ==================== SPEC-018 counter-sign (node mode ALL) ====================

/** SPEC-018 会签定义：node[0] mode ALL 双审批人 → node[1] 单审批人（可经 overrides.nodeSchema 覆写）。 */
async function seedCounterSignDefinition(
  applicantId: string,
  approverA1: string,
  approverA2: string,
  approverB1: string,
  overrides: { code?: string; nodeSchema?: Prisma.InputJsonValue } = {},
): Promise<ApprovalDefinition> {
  return createTwoNodeDefinition({
    code: overrides.code ?? 'EXPENSE',
    createdBy: applicantId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema:
      overrides.nodeSchema
      ?? ([
        { name: '会签初审', approverRule: { type: 'USER', userIds: [approverA1, approverA2] }, mode: 'ALL' },
        { name: '终审', approverRule: { type: 'USER', userIds: [approverB1] } },
      ] as unknown as Prisma.InputJsonValue),
  });
}

test('SPEC-018 ALL: first APPROVE at an ALL node stays (currentNode 0, instance PENDING, sibling kept, zero completed, audit mode ALL, callback status PENDING)', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: a2 } = await createApprovalActor('cs-a2');
  const { userId: b1 } = await createApprovalActor('cs-b1');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedCounterSignDefinition(applicant.actorUserId, a1, a2, b1);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '会签审批', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(view.tasks.length, 2, 'ALL node[0] has two approver tasks');
  assert.deepEqual(
    view.nodeSchema as unknown,
    [
      { name: '会签初审', approverRule: { type: 'USER', userIds: [a1, a2] }, mode: 'ALL' },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ],
    'ApprovalInstanceView carries the definition nodeSchema for the frontend counter-sign tag',
  );
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = view.tasks.find(t => t.assigneeId === a2)!;

  const stayed = await instanceServiceFor(a1, actorA1).processTask(taskA1.id, { action: 'APPROVE', idempotencyKey: 'cb-all-stay' });

  assert.equal(stayed.status, 'PENDING', 'instance stays PENDING');
  assert.equal(stayed.currentNode, 0, 'currentNode is unchanged');
  assert.equal(stayed.version, 1, 'instance version is unchanged (task-only flip)');
  assert.equal(stayed.decidedBy, null);
  assert.equal(stayed.decidedAt, null);
  assert.equal(stayed.tasks.find(t => t.id === taskA1.id)!.status, 'APPROVED', 'acting task flips APPROVED');
  assert.equal(stayed.tasks.find(t => t.id === taskA2.id)!.status, 'PENDING', 'sibling PENDING task is kept, not cancelled');
  assert.equal(stayed.tasks.length, 2, 'no next-node task is created');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events on an ALL stay',
  );

  const callback = await prisma.callbackAction.findFirstOrThrow({ where: { callbackKey: 'cb-all-stay' } });
  assert.equal(callback.instanceId, view.id);
  assert.equal(callback.action, 'APPROVE');
  assert.equal(callback.status, 'RESPONDED');
  assert.deepEqual(callback.result as unknown as Record<string, unknown>, {
    instanceId: view.id,
    action: 'APPROVE',
    status: 'PENDING',
    currentNode: 0,
  }, 'ALL stay callback result is {status PENDING, currentNode 0}');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_INSTANCE', targetId: view.id, action: 'APPROVAL_PROCESS' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    instanceId: view.id,
    definitionCode: 'EXPENSE',
    businessType: 'EXPENSE',
    fromStatus: 'PENDING',
    toStatus: 'PENDING',
    currentNode: 0,
    mode: 'ALL',
    hasReason: false,
  }, 'ALL stay audit carries toStatus PENDING and mode ALL');
});

test('SPEC-018 ALL: APPROVE by the last ALL approver advances to the next node with zero completed events', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('cs-a2');
  const { userId: b1 } = await createApprovalActor('cs-b1');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedCounterSignDefinition(applicant.actorUserId, a1, a2, b1);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '会签推进', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = view.tasks.find(t => t.assigneeId === a2)!;
  await instanceServiceFor(a1, actorA1).processTask(taskA1.id, { action: 'APPROVE' });

  const advanced = await instanceServiceFor(a2, actorA2).processTask(taskA2.id, { action: 'APPROVE' });

  assert.equal(advanced.status, 'PENDING', 'instance stays PENDING at the next node');
  assert.equal(advanced.currentNode, 1, 'last ALL approver advances currentNode to 1');
  assert.equal(advanced.version, 2, 'advancement bumps the instance version once');
  assert.equal(advanced.decidedBy, null);
  const node0 = advanced.tasks.filter(t => t.nodeName === '会签初审');
  assert.equal(node0.filter(t => t.status === 'APPROVED').length, 2, 'both ALL approvers end APPROVED');
  assert.equal(node0.filter(t => t.status === 'PENDING').length, 0);
  const node1 = advanced.tasks.filter(t => t.nodeName === '终审');
  assert.equal(node1.length, 1, 'next-node task is created');
  assert.equal(node1[0].status, 'PENDING');
  assert.equal(node1[0].assigneeId, b1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events on ALL advancement',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_INSTANCE', targetId: view.id, action: 'APPROVAL_PROCESS' } }),
    2,
    'one PROCESS audit per approved task',
  );
});

test('SPEC-018 ALL: the final ALL node requires every approver and finalizes APPROVED with exactly one completed event', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: b1, actor: actorB1 } = await createApprovalActor('cs-b1');
  const { userId: b2, actor: actorB2 } = await createApprovalActor('cs-b2');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  // 末节点 mode ALL 双审批人：node[0] ANY 单审批 → node[1] ALL 双审批。
  await seedCounterSignDefinition(applicant.actorUserId, a1, a1, b1, {
    nodeSchema: [
      { name: '初审', approverRule: { type: 'USER', userIds: [a1] } },
      { name: '会签终审', approverRule: { type: 'USER', userIds: [b1, b2] }, mode: 'ALL' },
    ] as unknown as Prisma.InputJsonValue,
  });
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '末节点会签', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const advanced = await instanceServiceFor(a1, actorA1).processTask(view.tasks[0].id, { action: 'APPROVE' });
  assert.equal(advanced.currentNode, 1, 'node[0] ANY advances to the final node');
  const finalTasks = advanced.tasks.filter(t => t.nodeName === '会签终审');
  assert.equal(finalTasks.length, 2);
  const taskB1 = finalTasks.find(t => t.assigneeId === b1)!;
  const taskB2 = finalTasks.find(t => t.assigneeId === b2)!;

  const afterFirst = await instanceServiceFor(b1, actorB1).processTask(taskB1.id, { action: 'APPROVE' });
  assert.equal(afterFirst.status, 'PENDING', 'first final-node ALL approval stays PENDING');
  assert.equal(afterFirst.currentNode, 1);
  assert.equal(afterFirst.tasks.find(t => t.id === taskB2.id)!.status, 'PENDING', 'final-node ALL sibling stays PENDING');

  const final = await instanceServiceFor(b2, actorB2).processTask(taskB2.id, { action: 'APPROVE' });
  assert.equal(final.status, 'APPROVED', 'last final-node ALL approval finalizes APPROVED');
  assert.equal(final.currentNode, 1);
  assert.equal(final.decidedBy, b2);
  assert.equal(final.tasks.find(t => t.id === taskB1.id)!.status, 'APPROVED');
  assert.equal(final.tasks.find(t => t.id === taskB2.id)!.status, 'APPROVED');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
    'exactly one completed event across the whole flow',
  );
});

test('SPEC-018 ALL: REJECT at an ALL node is a one-vote veto that finalizes REJECTED and cancels sibling PENDING tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1 } = await createApprovalActor('cs-a1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('cs-a2');
  const { userId: b1 } = await createApprovalActor('cs-b1');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedCounterSignDefinition(applicant.actorUserId, a1, a2, b1);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '会签驳回', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = view.tasks.find(t => t.assigneeId === a2)!;

  const final = await instanceServiceFor(a2, actorA2).processTask(taskA2.id, { action: 'REJECT' });

  assert.equal(final.status, 'REJECTED', 'REJECT vetoes regardless of mode');
  assert.equal(final.currentNode, 0);
  assert.equal(final.decidedBy, a2);
  assert.equal(final.tasks.find(t => t.id === taskA2.id)!.status, 'REJECTED');
  assert.equal(final.tasks.find(t => t.id === taskA1.id)!.status, 'CANCELLED', 'sibling PENDING task is cancelled');
  assert.equal(final.tasks.length, 2, 'no next-node tasks are created');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    1,
  );
});

test('SPEC-018 ANY: a node without mode defaults to ANY and the first APPROVE advances', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: a2 } = await createApprovalActor('cs-a2');
  const { userId: b1 } = await createApprovalActor('cs-b1');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  // node[0] 缺省 mode（无 mode 字段）双审批人 → ANY 语义：首 APPROVE 即推进（向后兼容零回归）。
  await seedCounterSignDefinition(applicant.actorUserId, a1, a2, b1, {
    nodeSchema: [
      { name: '双人初审', approverRule: { type: 'USER', userIds: [a1, a2] } },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: 'ANY 缺省', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(view.tasks.length, 2);
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;

  const advanced = await instanceServiceFor(a1, actorA1).processTask(taskA1.id, { action: 'APPROVE' });

  assert.equal(advanced.currentNode, 1, 'first APPROVE advances under default ANY');
  const node0 = advanced.tasks.filter(t => t.nodeName === '双人初审');
  assert.equal(node0.filter(t => t.status === 'APPROVED').length, 1);
  assert.equal(node0.filter(t => t.status === 'CANCELLED').length, 1, 'sibling PENDING task is cancelled under ANY');
  const node1 = advanced.tasks.filter(t => t.nodeName === '终审');
  assert.equal(node1.length, 1, 'next-node task is created');
});

test('SPEC-018 validation: applyForApproval rejects an unknown node mode with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('applicant');
  const { userId: managerId } = await createApprovalActor('manager');
  const service = instanceServiceFor(userId, actor);
  await seedCounterSignDefinition(userId, managerId, managerId, managerId, {
    code: 'EXPENSE_BADMODE',
    nodeSchema: [
      { name: '坏模式', approverRule: { type: 'USER', userIds: [managerId] }, mode: 'OTHER' },
    ] as unknown as Prisma.InputJsonValue,
  });

  await assert.rejects(
    () => service.applyForApproval({
      definitionCode: 'EXPENSE_BADMODE', title: '坏模式', content: { contractId: 'CT-1', changeSummary: 'x' },
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a node mode outside {ANY, ALL} is rejected at chain build time',
  );
  assert.equal(await prisma.approvalInstance.count(), 0, 'zero instances created');
});

test('SPEC-018 ALL: advancing to a node whose approvers include the applicant returns SELF_REVIEW_FORBIDDEN 409 and rolls back', async () => {
  const { userId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('cs-a2');
  const applyService = instanceServiceFor(userId, applicant);
  // node[0] ALL 双审批人 → node[1] 审批人含申请人 → 最后一签推进时自审 409 事务回滚。
  await seedCounterSignDefinition(userId, a1, a2, userId, {
    nodeSchema: [
      { name: '会签初审', approverRule: { type: 'USER', userIds: [a1, a2] }, mode: 'ALL' },
      { name: '终审', approverRule: { type: 'USER', userIds: [userId, a1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '会签自审', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = view.tasks.find(t => t.assigneeId === a2)!;
  await instanceServiceFor(a1, actorA1).processTask(taskA1.id, { action: 'APPROVE' });

  await assert.rejects(
    () => instanceServiceFor(a2, actorA2).processTask(taskA2.id, { action: 'APPROVE' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409),
    'next-node self-review is forbidden even after ALL node approvals',
  );

  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.status, 'PENDING', 'advancement rolls back the instance');
  assert.equal(stored.currentNode, 0, 'currentNode is not advanced');
  const storedA1 = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA1.id } });
  assert.equal(storedA1.status, 'APPROVED', 'the earlier ALL stay commits in its own transaction and is not rolled back');
  const storedA2 = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA2.id } });
  assert.equal(storedA2.status, 'PENDING', 'the last-approver task flip rolls back with the failed advancement');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId: view.id } }), 2, 'no node[1] tasks are created');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
  );
});

// ==================== forwardTask（SPEC-019 审批转交） ====================

test('forwardTask transfers a PENDING task to the target user and keeps the instance semantics unchanged', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB } = await createApprovalActor('forward-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const instanceBefore = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const serviceA = instanceServiceFor(approverA, actorA);

  const view = await serviceA.forwardTask(taskA.id, { forwardToUserId: approverB, remark: '休假转交' });

  const forwardedTask = view.tasks.find(task => task.id === taskA.id)!;
  assert.equal(forwardedTask.assigneeId, approverB, 'assigneeId changes to the target user');
  assert.equal(forwardedTask.status, 'PENDING', 'task status stays PENDING');
  assert.equal(forwardedTask.nodeName, '审批', 'nodeName is unchanged');
  assert.equal(forwardedTask.processedBy, null, 'forward never marks the task processed');
  assert.equal(forwardedTask.processedAt, null);
  assert.equal(forwardedTask.version, 2, 'forward bumps the task version once');
  assert.equal(view.status, 'PENDING', 'instance status is unchanged');
  assert.equal(view.currentNode, 0, 'currentNode is unchanged');
  assert.equal(view.version, instanceBefore.version, 'instance version is unchanged');
  assert.equal(view.decidedBy, null);
  assert.equal(view.decidedAt, null);

  // 审计：targetType APPROVAL_TASK，newValues 含 taskId/fromUserId/toUserId/hasReason（remark 不落）。
  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_TASK', targetId: taskA.id, action: 'APPROVAL_TASK_FORWARD' },
  });
  assert.equal(operationLog.userId, approverA);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    taskId: taskA.id,
    fromUserId: approverA,
    toUserId: approverB,
    hasReason: true,
  }, 'forward audit holds task identifiers and the hasReason boolean only');
  assert.ok(!operationLog.newValues?.includes('休假转交'), 'remark free text stays out of audit values');

  // 零 outbox 事件：不产 completed、不建 callbackAction（D7/D8）。
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'forward emits no completed event',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId } }),
    1,
    'only the apply-time approval.instance.created event exists',
  );
  assert.equal(await prisma.callbackAction.count({ where: { instanceId } }), 0, 'forward creates no callbackAction');
});

test('forwardTask returns APPROVAL_STATE_INVALID 409 for a non-PENDING task', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('forward-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const taskB = tasks.find(task => task.assigneeId === approverB)!;
  // approverA 定稿 → 自己 task APPROVED、对方 task CANCELLED，均非 PENDING。
  await instanceServiceFor(approverA, actorA).processTask(taskA.id, { action: 'APPROVE' });

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).forwardTask(taskA.id, { forwardToUserId: approverB }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'an APPROVED task cannot be forwarded',
  );
  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).forwardTask(taskB.id, { forwardToUserId: approverA }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'a CANCELLED task cannot be forwarded',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', action: 'APPROVAL_TASK_FORWARD' } }),
    0,
    'zero forward audits on rejected forwards',
  );
});

test('forwardTask returns APPROVAL_TASK_NOT_FOUND 404 for a task not assigned to the actor', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('forward-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('forward-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).forwardTask(taskA.id, { forwardToUserId: approverA }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
    'a task assigned to someone else is indistinguishable from missing',
  );
  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).forwardTask(randomUUID(), { forwardToUserId: approverA }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.assigneeId, approverA, 'out-of-scope forward never mutates the task');
  assert.equal(stored.version, 1);
});

test('forwardTask returns APPROVAL_ASSIGNEE_INVALID 400 when the target is the actor themselves', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB } = await createApprovalActor('forward-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).forwardTask(taskA.id, { forwardToUserId: approverA }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'forwarding to yourself is meaningless',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.assigneeId, approverA, 'self-forward never mutates the task');
  assert.equal(stored.version, 1);
});

test('forwardTask returns APPROVAL_SELF_REVIEW_FORBIDDEN 409 when the target is the instance applicant', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB } = await createApprovalActor('forward-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).forwardTask(taskA.id, { forwardToUserId: applicantId }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409),
    'forwarding to the applicant would enable self-review',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.assigneeId, approverA, 'applicant-targeted forward never mutates the task');
  assert.equal(stored.version, 1);
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', action: 'APPROVAL_TASK_FORWARD' } }),
    0,
    'zero forward audits on an applicant-targeted forward',
  );
});

test('forwardTask returns VALIDATION_FAILED 400 for an empty or missing forwardToUserId', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB } = await createApprovalActor('forward-b');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const serviceA = instanceServiceFor(approverA, actorA);

  await assert.rejects(
    () => serviceA.forwardTask(taskA.id, { forwardToUserId: '' }),
    isValidationFailed400,
    'empty target is rejected',
  );
  await assert.rejects(
    () => serviceA.forwardTask(taskA.id, { forwardToUserId: '   ' }),
    isValidationFailed400,
    'blank target is rejected',
  );
  await assert.rejects(
    () => serviceA.forwardTask(taskA.id, {} as never),
    isValidationFailed400,
    'missing target is rejected',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.assigneeId, approverA);
  assert.equal(stored.version, 1);
});

test('forwardTask concurrent competition yields exactly one forward and one rejected (APPROVAL_STATE_INVALID 409 or APPROVAL_TASK_NOT_FOUND 404)', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('forward-a');
  const { userId: approverB } = await createApprovalActor('forward-b');
  const { userId: approverC } = await createApprovalActor('forward-c');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const serviceA = instanceServiceFor(approverA, actorA);

  const results = await Promise.allSettled([
    serviceA.forwardTask(taskA.id, { forwardToUserId: approverB }),
    serviceA.forwardTask(taskA.id, { forwardToUserId: approverC }),
  ]);

  assert.equal(results.length, 2);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent forward wins the task');
  assert.equal(rejected.length, 1, 'exactly one concurrent forward is rejected');

  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ApprovalError, `loser fails with ApprovalError, not ${String(loser.reason)}`);
  // SPEC-026 确定性化：loser 读落 winner 提交前 → forwardTask 的 updateMany
  // {id, version, status:'PENDING'} count=0 → 409 APPROVAL_STATE_INVALID；
  // 读落 winner 提交后 → findFirst {id, assigneeId: actor} 失配 → 404 APPROVAL_TASK_NOT_FOUND。
  // 二者均为合法"败者"结果（非 500），断言宽容以消除时序 flake（原固定 409 断言在
  // loser 读落 winner 提交后 → 404 时误报失败）。
  assert.ok(
    (loser.reason.code === APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID && loser.reason.httpStatus === 409)
      || (loser.reason.code === APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND && loser.reason.httpStatus === 404),
    `loser is 409 APPROVAL_STATE_INVALID or 404 APPROVAL_TASK_NOT_FOUND, not ${String(loser.reason)}`,
  );

  const winner = fulfilled[0] as PromiseFulfilledResult<ApprovalInstanceView>;
  const afterTask = winner.value.tasks.find(task => task.id === taskA.id)!;
  assert.ok([approverB, approverC].includes(afterTask.assigneeId), 'the winner target takes over the task');
  assert.equal(afterTask.status, 'PENDING');
  assert.equal(afterTask.version, 2);

  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.version, 2, 'the task ends at exactly one forward');
  assert.ok([approverB, approverC].includes(stored.assigneeId));
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', targetId: taskA.id, action: 'APPROVAL_TASK_FORWARD' } }),
    1,
    'exactly one forward audit is written',
  );
});

// SPEC-018 minor 加固（Task 1 ⚠️①）：ALL 并发用例——同节点双 APPROVE 并发，验证实例行
// FOR UPDATE 串行化下 remainingPending 计数正确（不双推进、不双定稿）。任一顺序：首签停留
// → 末签落推进/定稿；两签均成功（进程内并发由 FOR UPDATE 串行化保证，与 callbackKey 并发同型）。
test('SPEC-018 ALL: concurrent APPROVEs at an ALL node serialize correctly — exactly one stay then one advance, both succeed', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-ca1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('cs-ca2');
  const { userId: b1 } = await createApprovalActor('cs-cb1');
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  await seedCounterSignDefinition(applicant.actorUserId, a1, a2, b1);
  const view = await applyService.applyForApproval({
    definitionCode: 'EXPENSE', title: '会签并发', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const taskA1 = view.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = view.tasks.find(t => t.assigneeId === a2)!;
  const serviceA1 = instanceServiceFor(a1, actorA1);
  const serviceA2 = instanceServiceFor(a2, actorA2);

  const results = await Promise.allSettled([
    serviceA1.processTask(taskA1.id, { action: 'APPROVE' }),
    serviceA2.processTask(taskA2.id, { action: 'APPROVE' }),
  ]);
  assert.equal(results.length, 2);
  assert.ok(
    results.every(r => r.status === 'fulfilled'),
    'both concurrent APPROVEs succeed under FOR UPDATE serialization (no 500/409/state-invalid)',
  );

  // 终态以数据库实况为准（两个并发返回值各自为事务内快照，先完成者可能只见到停留态）。
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.currentNode, 1, 'the last ALL approve advances to node[1]');
  assert.equal(stored.status, 'PENDING', 'instance stays PENDING awaiting node[1]');
  assert.equal(stored.version, 2, 'instance version bumped once (initial 1 + single advance bump)');
  assert.equal(
    await prisma.approvalTask.count({ where: { instanceId: view.id, nodeName: '会签初审', status: 'APPROVED' } }),
    2,
    'both ALL node[0] tasks end APPROVED (both signed)',
  );
  assert.equal(
    await prisma.approvalTask.count({ where: { instanceId: view.id, nodeName: '终审', status: 'PENDING' } }),
    1,
    'node[1] task created after ALL node completes',
  );
  assert.equal(
    await prisma.approvalTask.count({ where: { instanceId: view.id, status: 'CANCELLED' } }),
    0,
    'no sibling cancelled under ALL mode (all must sign, not any-one)',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events (instance still PENDING at node[1])',
  );
});

// ==================== SPEC-020 审批加签（addSigners） ====================

test('addSigners creates N new PENDING tasks at the same node, keeps instance semantics, audits, and emits zero events', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB } = await createApprovalActor('add-b');
  const { userId: approverC } = await createApprovalActor('add-c');
  const { userId: approverD } = await createApprovalActor('add-d');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const instanceBefore = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const serviceA = instanceServiceFor(approverA, actorA);

  const view = await serviceA.addSigners(taskA.id, { addSignerUserIds: [approverC, approverD], remark: '请协办' });

  assert.equal(view.status, 'PENDING', 'instance status is unchanged');
  assert.equal(view.currentNode, 0, 'currentNode is unchanged');
  assert.equal(view.version, instanceBefore.version, 'instance version is unchanged');
  assert.equal(view.decidedBy, null);
  assert.equal(view.decidedAt, null);
  const addedTasks = view.tasks.filter(t => t.assigneeId === approverC || t.assigneeId === approverD);
  assert.equal(addedTasks.length, 2, 'N new PENDING tasks are created');
  assert.ok(addedTasks.every(t => t.status === 'PENDING' && t.nodeName === taskA.nodeName && t.processedBy === null), 'new tasks share the base nodeName and stay PENDING');
  assert.equal(view.tasks.length, 4, 'original 2 + added 2');
  const orig = view.tasks.find(t => t.id === taskA.id)!;
  assert.equal(orig.status, 'PENDING', 'the acting task is untouched');
  assert.equal(orig.assigneeId, approverA);
  assert.equal(orig.version, 1, 'task version is untouched');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_TASK', targetId: taskA.id, action: 'APPROVAL_TASK_ADD_SIGNER' },
  });
  assert.equal(operationLog.userId, approverA);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    taskId: taskA.id,
    addedUserIds: [approverC, approverD],
    hasReason: true,
  }, 'add-signer audit holds taskId/addedUserIds/hasReason only');
  assert.ok(!operationLog.newValues?.includes('请协办'), 'remark free text stays out of audit values');

  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'add signers emits no completed event',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', objectId: instanceId } }),
    1,
    'only the apply-time approval.instance.created event exists',
  );
  assert.equal(await prisma.callbackAction.count({ where: { instanceId } }), 0, 'add signers creates no callbackAction');
});

test('addSigners returns APPROVAL_STATE_INVALID 409 for a non-PENDING task', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('add-b');
  const { userId: approverC } = await createApprovalActor('add-c');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const taskB = tasks.find(task => task.assigneeId === approverB)!;
  // approverA 定稿 → 自己 task APPROVED、对方 task CANCELLED，均非 PENDING。
  await instanceServiceFor(approverA, actorA).processTask(taskA.id, { action: 'APPROVE' });

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).addSigners(taskA.id, { addSignerUserIds: [approverC] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'an APPROVED task cannot be the add-signer base',
  );
  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).addSigners(taskB.id, { addSignerUserIds: [approverC] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'a CANCELLED task cannot be the add-signer base',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', action: 'APPROVAL_TASK_ADD_SIGNER' } }),
    0,
    'zero add-signer audits on rejected adds',
  );
});

test('addSigners returns APPROVAL_TASK_NOT_FOUND 404 for a task not assigned to the actor', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA } = await createApprovalActor('add-a');
  const { userId: approverB, actor: actorB } = await createApprovalActor('add-b');
  const { userId: approverC } = await createApprovalActor('add-c');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).addSigners(taskA.id, { addSignerUserIds: [approverC] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
    'a task assigned to someone else is indistinguishable from missing',
  );
  await assert.rejects(
    () => instanceServiceFor(approverB, actorB).addSigners(randomUUID(), { addSignerUserIds: [approverC] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND, 404),
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.assigneeId, approverA, 'out-of-scope addSigners never mutates the task');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId } }), 2, 'no tasks are added');
});

test('addSigners returns APPROVAL_ASSIGNEE_INVALID 400 when a target is the actor themselves', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB } = await createApprovalActor('add-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).addSigners(taskA.id, { addSignerUserIds: [approverA] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'adding yourself as an additional signer is meaningless',
  );
  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).addSigners(taskA.id, { addSignerUserIds: [approverA, approverB] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a mixed list containing the actor is also rejected',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.version, 1, 'self-target add never mutates the task');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId } }), 2, 'no tasks are added');
});

test('addSigners returns APPROVAL_SELF_REVIEW_FORBIDDEN 409 when a target is the instance applicant', async () => {
  const { userId: applicantId, actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB } = await createApprovalActor('add-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;

  await assert.rejects(
    () => instanceServiceFor(approverA, actorA).addSigners(taskA.id, { addSignerUserIds: [applicantId] }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409),
    'adding the applicant would enable self-review',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.version, 1, 'applicant-target add never mutates the task');
  assert.equal(await prisma.approvalTask.count({ where: { instanceId } }), 2, 'no tasks are added');
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'APPROVAL_TASK', action: 'APPROVAL_TASK_ADD_SIGNER' } }),
    0,
    'zero add-signer audits on an applicant-target add',
  );
});

test('addSigners returns VALIDATION_FAILED 400 for an empty, blank, over-long, over-limit or missing addSignerUserIds', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB } = await createApprovalActor('add-b');
  const { instanceId, tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const serviceA = instanceServiceFor(approverA, actorA);

  await assert.rejects(
    () => serviceA.addSigners(taskA.id, { addSignerUserIds: [] }),
    isValidationFailed400,
    'empty target array is rejected',
  );
  await assert.rejects(
    () => serviceA.addSigners(taskA.id, { addSignerUserIds: ['   '] }),
    isValidationFailed400,
    'blank target is rejected',
  );
  await assert.rejects(
    () => serviceA.addSigners(taskA.id, {} as never),
    isValidationFailed400,
    'missing target array is rejected',
  );
  await assert.rejects(
    () => serviceA.addSigners(taskA.id, { addSignerUserIds: ['x'.repeat(101)] }),
    isValidationFailed400,
    'over-length target is rejected',
  );
  await assert.rejects(
    () => serviceA.addSigners(taskA.id, { addSignerUserIds: Array.from({ length: 11 }, (_, index) => `u${index}`) }),
    isValidationFailed400,
    'over-limit target count is rejected',
  );
  const stored = await prisma.approvalTask.findUniqueOrThrow({ where: { id: taskA.id } });
  assert.equal(stored.version, 1);
  assert.equal(await prisma.approvalTask.count({ where: { instanceId } }), 2, 'no tasks are added');
});

test('addSigners deduplicates repeated target userIds and creates exactly one task per unique user', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: approverA, actor: actorA } = await createApprovalActor('add-a');
  const { userId: approverB } = await createApprovalActor('add-b');
  const { userId: approverC } = await createApprovalActor('add-c');
  const { userId: approverD } = await createApprovalActor('add-d');
  const { tasks } = await seedTwoTaskInstance(applicant, approverA, approverB);
  const taskA = tasks.find(task => task.assigneeId === approverA)!;
  const serviceA = instanceServiceFor(approverA, actorA);

  const view = await serviceA.addSigners(taskA.id, { addSignerUserIds: [approverC, approverD, approverC] });

  assert.equal(view.tasks.filter(t => t.assigneeId === approverC).length, 1, 'duplicate userId creates exactly one task');
  assert.equal(view.tasks.filter(t => t.assigneeId === approverD).length, 1, 'unique userId creates exactly one task');
  assert.equal(view.tasks.length, 4, 'original 2 + two unique new tasks');
  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_TASK', targetId: taskA.id, action: 'APPROVAL_TASK_ADD_SIGNER' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues.addedUserIds, [approverC, approverD], 'audit holds the deduplicated list');
});

test('addSigners at an ANY node lets the first APPROVE advance and cancels the added signer together with the sibling PENDING tasks', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('any-a1');
  const { userId: a2 } = await createApprovalActor('any-a2');
  const { userId: c1 } = await createApprovalActor('any-c1');
  const { userId: b1 } = await createApprovalActor('any-b1');
  await createTwoNodeDefinition({
    code: 'EXPENSE_ANY_ADD',
    createdBy: applicant.actorUserId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema: [
      { name: '双人初审', approverRule: { type: 'USER', userIds: [a1, a2] } },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const applied = await applyService.applyForApproval({
    definitionCode: 'EXPENSE_ANY_ADD', title: 'ANY 加签推进', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(applied.tasks.length, 2);
  const taskA1 = applied.tasks.find(t => t.assigneeId === a1)!;
  const serviceA1 = instanceServiceFor(a1, actorA1);

  const added = await serviceA1.addSigners(taskA1.id, { addSignerUserIds: [c1] });
  assert.equal(added.tasks.filter(t => t.nodeName === '双人初审' && t.status === 'PENDING').length, 3, 'added signer joins node[0]');

  // 任一通过：a1 APPROVE → 取消 node[0] 余 PENDING（含 a2 与新增 c1）+ 推进 node[1]。
  const advanced = await serviceA1.processTask(taskA1.id, { action: 'APPROVE' });
  assert.equal(advanced.status, 'PENDING', 'instance stays PENDING at node[1]');
  assert.equal(advanced.currentNode, 1, 'first APPROVE advances to node[1]');
  const node0 = advanced.tasks.filter(t => t.nodeName === '双人初审');
  assert.equal(node0.filter(t => t.status === 'APPROVED').length, 1, 'the acting approver is APPROVED');
  assert.equal(node0.filter(t => t.status === 'CANCELLED').length, 2, 'sibling + added signer tasks are CANCELLED');
  const node1 = advanced.tasks.filter(t => t.nodeName === '终审');
  assert.equal(node1.length, 1, 'node[1] task is created');
  assert.equal(node1[0].status, 'PENDING');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events on an ANY advance',
  );
});

test('addSigners at an ALL node keeps the added signer in remainingPending until the full countersign advances', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('cs-a1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('cs-a2');
  const { userId: c1, actor: actorC1 } = await createApprovalActor('cs-c1');
  const { userId: b1 } = await createApprovalActor('cs-b1');
  await createTwoNodeDefinition({
    code: 'EXPENSE_ALL_ADD',
    createdBy: applicant.actorUserId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema: [
      { name: '会签初审', approverRule: { type: 'USER', userIds: [a1, a2] }, mode: 'ALL' },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const applied = await applyService.applyForApproval({
    definitionCode: 'EXPENSE_ALL_ADD', title: '会签加签', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  assert.equal(applied.tasks.length, 2);
  const taskA1 = applied.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = applied.tasks.find(t => t.assigneeId === a2)!;

  await instanceServiceFor(a1, actorA1).addSigners(taskA1.id, { addSignerUserIds: [c1] });
  const afterAdd = await prisma.approvalTask.findMany({
    where: { instanceId: applied.id, nodeName: '会签初审', status: 'PENDING' },
  });
  assert.equal(afterAdd.length, 3, 'added signer joins the ALL node PENDING set');

  const stay = await instanceServiceFor(a1, actorA1).processTask(taskA1.id, { action: 'APPROVE' });
  assert.equal(stay.status, 'PENDING', 'instance stays PENDING');
  assert.equal(stay.currentNode, 0, 'ALL node stays until every signer approves');
  assert.equal(stay.version, 1, 'instance version unchanged on a stay');

  const stay2 = await instanceServiceFor(a2, actorA2).processTask(taskA2.id, { action: 'APPROVE' });
  assert.equal(stay2.status, 'PENDING');
  assert.equal(stay2.currentNode, 0);

  const c1Task = await prisma.approvalTask.findFirstOrThrow({
    where: { instanceId: applied.id, nodeName: '会签初审', assigneeId: c1 },
  });
  const advanced = await instanceServiceFor(c1, actorC1).processTask(c1Task.id, { action: 'APPROVE' });
  assert.equal(advanced.status, 'PENDING', 'instance stays PENDING at node[1]');
  assert.equal(advanced.currentNode, 1, 'the added signer is the last ALL approver and advances the node');
  assert.equal(advanced.tasks.filter(t => t.nodeName === '会签初审' && t.status === 'APPROVED').length, 3, 'all three signers approved');
  const node1 = advanced.tasks.filter(t => t.nodeName === '终审');
  assert.equal(node1.length, 1, 'node[1] task is created');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events (instance still PENDING at node[1])',
  );
});

test('addSigners racing processTask serializes on the instance row FOR UPDATE and never leaves an orphan PENDING task', async () => {
  const { actor: applicant } = await createApprovalActor('applicant');
  const { userId: a1, actor: actorA1 } = await createApprovalActor('race-a1');
  const { userId: a2, actor: actorA2 } = await createApprovalActor('race-a2');
  const { userId: c1 } = await createApprovalActor('race-c1');
  const { userId: b1 } = await createApprovalActor('race-b1');
  await createTwoNodeDefinition({
    code: 'EXPENSE_RACE',
    createdBy: applicant.actorUserId,
    formSchema: TWO_NODE_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
    nodeSchema: [
      { name: '双人初审', approverRule: { type: 'USER', userIds: [a1, a2] } },
      { name: '终审', approverRule: { type: 'USER', userIds: [b1] } },
    ] as unknown as Prisma.InputJsonValue,
  });
  const applyService = instanceServiceFor(applicant.actorUserId, applicant);
  const applied = await applyService.applyForApproval({
    definitionCode: 'EXPENSE_RACE', title: '加签竞速', content: { contractId: 'CT-1', changeSummary: 'x' },
  });
  const taskA1 = applied.tasks.find(t => t.assigneeId === a1)!;
  const taskA2 = applied.tasks.find(t => t.assigneeId === a2)!;
  const serviceA1 = instanceServiceFor(a1, actorA1);
  const serviceA2 = instanceServiceFor(a2, actorA2);

  const results = await Promise.allSettled([
    serviceA1.processTask(taskA1.id, { action: 'APPROVE' }),
    serviceA2.addSigners(taskA2.id, { addSignerUserIds: [c1] }),
  ]);
  assert.equal(results.length, 2);

  // processTask 必成功（node[0] ANY APPROVE 推进）；addSigners 或成功（新 task 随后被推进取消）
  // 或败于锁后重验（task 已 CANCELLED → 409）——二者均无孤儿 PENDING task。
  const processResult = results[0];
  assert.equal(processResult.status, 'fulfilled', 'the concurrent APPROVE always advances');
  const advanced = (processResult as PromiseFulfilledResult<ApprovalInstanceView>).value;
  assert.equal(advanced.status, 'PENDING');
  assert.equal(advanced.currentNode, 1, 'node[0] ANY APPROVE advances to node[1]');

  const addResult = results[1];
  if (addResult.status === 'rejected') {
    const reason = addResult.reason;
    assert.ok(
      reason instanceof ApprovalError
        && reason.code === APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID
        && reason.httpStatus === 409,
      `the losing addSigners fails with APPROVAL_STATE_INVALID 409, not ${String(reason)}`,
    );
  }

  const orphaned = await prisma.approvalTask.findMany({
    where: { instanceId: applied.id, nodeName: '双人初审', status: 'PENDING' },
  });
  assert.equal(orphaned.length, 0, 'no orphan PENDING task survives at node[0] after the race');
  const stored = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: applied.id } });
  assert.equal(stored.currentNode, 1, 'instance advanced to node[1]');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'APPROVAL_INSTANCE', eventType: 'approval.instance.completed' } }),
    0,
    'zero completed events (instance still PENDING at node[1])',
  );
});
