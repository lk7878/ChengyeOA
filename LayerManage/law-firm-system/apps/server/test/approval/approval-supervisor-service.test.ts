// SPEC-041 Task 1: approverRule SUPERVISOR（直属上级）服务契约测试。
// 覆盖：SUPERVISOR 按申请人报告线解析直属上级 / levels 多级上溯 / 各缺失分支 400。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/approval-supervisor-service.test.ts

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { APPROVAL_ERROR_CODES, ApprovalError } from '../../app/domain/approval/approval-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const APPROVAL_PERMISSIONS: PermissionCode[] = ['approval.apply'];

const BASIC_FORM_SCHEMA = {
  fields: [{ key: 'amount', label: '金额', type: 'number', required: true }],
};

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

function approvalContext(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: APPROVAL_PERMISSIONS.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes: APPROVAL_PERMISSIONS,
    evaluatedAt: new Date(),
  };
}

async function createEmployee(name: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name,
      phone: '13800003333',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function createBoundUser(employeeId: string, tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `supervisor.${tag}.${randomUUID()}`, password: 'x', employeeId },
  });
  return user.id;
}

async function createReportingLine(employeeId: string, managerEmployeeId: string): Promise<void> {
  await prisma.employeeReportingLine.create({
    data: {
      employeeId,
      managerEmployeeId,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      version: 1,
    },
  });
}

async function createSupervisorDefinition(approverRule: unknown): Promise<string> {
  const definition = await prisma.approvalDefinition.create({
    data: {
      code: 'LEAVE',
      name: '请假申请',
      businessType: 'LEAVE',
      formSchema: BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
      approverRule: approverRule as unknown as Prisma.InputJsonValue,
      status: 'ACTIVE',
      createdBy: 'seed',
    },
  });
  return definition.code;
}

async function applyAs(userId: string, definitionCode: string): Promise<string> {
  const actor: AuditActor = { actorUserId: userId, requestId: `req-${randomUUID()}` };
  const service = new ApprovalInstanceService(prisma, actor, approvalContext(userId));
  const view = await service.applyForApproval({ definitionCode, title: '请假', content: { amount: 100 } });
  return view.id;
}

test('SUPERVISOR rule resolves the applicant direct supervisor as the approver', async () => {
  const applicantEmployee = await createEmployee('申请人');
  const managerEmployee = await createEmployee('直属上级');
  await createReportingLine(applicantEmployee, managerEmployee);
  const applicantUserId = await createBoundUser(applicantEmployee, 'applicant');
  const managerUserId = await createBoundUser(managerEmployee, 'manager');
  await createSupervisorDefinition({ type: 'SUPERVISOR' });

  const instanceId = await applyAs(applicantUserId, 'LEAVE');
  const tasks = await prisma.approvalTask.findMany({ where: { instanceId } });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assigneeId, managerUserId, 'direct supervisor becomes the approver');
});

test('SUPERVISOR levels=2 resolves the grandparent supervisor', async () => {
  const applicantEmployee = await createEmployee('申请人');
  const managerEmployee = await createEmployee('直接上级');
  const grandManagerEmployee = await createEmployee('上级的上级');
  await createReportingLine(applicantEmployee, managerEmployee);
  await createReportingLine(managerEmployee, grandManagerEmployee);
  const applicantUserId = await createBoundUser(applicantEmployee, 'applicant');
  await createBoundUser(managerEmployee, 'manager');
  const grandManagerUserId = await createBoundUser(grandManagerEmployee, 'grand');
  await createSupervisorDefinition({ type: 'SUPERVISOR', levels: 2 });

  const instanceId = await applyAs(applicantUserId, 'LEAVE');
  const tasks = await prisma.approvalTask.findMany({ where: { instanceId } });
  assert.equal(tasks[0].assigneeId, grandManagerUserId, 'grandparent supervisor becomes the approver');
});

test('SUPERVISOR rule fails 400 when the applicant has no employee binding', async () => {
  const noEmployeeUserId = await prisma.user.create({
    data: { username: `supervisor.nobind.${randomUUID()}`, password: 'x', employeeId: null },
  }).then(user => user.id);
  await createSupervisorDefinition({ type: 'SUPERVISOR' });

  const actor: AuditActor = { actorUserId: noEmployeeUserId, requestId: `req-${randomUUID()}` };
  const service = new ApprovalInstanceService(prisma, actor, approvalContext(noEmployeeUserId));
  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'LEAVE', title: '请假', content: { amount: 100 } }),
    (error: unknown) => error instanceof ApprovalError && error.code === APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID && error.httpStatus === 400,
  );
});

test('SUPERVISOR rule fails 400 when the applicant has no active reporting line', async () => {
  const applicantEmployee = await createEmployee('申请人');
  const applicantUserId = await createBoundUser(applicantEmployee, 'applicant');
  await createSupervisorDefinition({ type: 'SUPERVISOR' });

  const actor: AuditActor = { actorUserId: applicantUserId, requestId: `req-${randomUUID()}` };
  const service = new ApprovalInstanceService(prisma, actor, approvalContext(applicantUserId));
  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'LEAVE', title: '请假', content: { amount: 100 } }),
    (error: unknown) => error instanceof ApprovalError && error.code === APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID && error.httpStatus === 400,
  );
});

test('SUPERVISOR rule fails 400 when the supervisor has no user binding', async () => {
  const applicantEmployee = await createEmployee('申请人');
  const managerEmployee = await createEmployee('直属上级');
  await createReportingLine(applicantEmployee, managerEmployee);
  const applicantUserId = await createBoundUser(applicantEmployee, 'applicant');
  // 上级 employee 无绑定账号。
  await createSupervisorDefinition({ type: 'SUPERVISOR' });

  const actor: AuditActor = { actorUserId: applicantUserId, requestId: `req-${randomUUID()}` };
  const service = new ApprovalInstanceService(prisma, actor, approvalContext(applicantUserId));
  await assert.rejects(
    () => service.applyForApproval({ definitionCode: 'LEAVE', title: '请假', content: { amount: 100 } }),
    (error: unknown) => error instanceof ApprovalError && error.code === APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID && error.httpStatus === 400,
  );
});

test('SUPERVISOR definition CRUD rejects a malformed levels value with 400', async () => {
  // levels 非法（0）→ definition-service assertApproverRuleValid 400。
  const adminActor: AuditActor = { actorUserId: randomUUID(), requestId: `req-${randomUUID()}` };
  const { ApprovalDefinitionService } = await import('../../app/application/approval/approval-definition-service');
  const manageContext = approvalContext(adminActor.actorUserId);
  const definitionService = new ApprovalDefinitionService(
    prisma,
    adminActor,
    { ...manageContext, permissionCodes: ['approval.manage' as PermissionCode], grants: [{ sourceType: 'ROLE' as const, sourceId: 'g', sourceRoleId: 'r', permissionCode: 'approval.manage' as PermissionCode, resource: 'approval', scopeIds: ['ALL'], validUntil: null }] },
  );
  await assert.rejects(
    () => definitionService.createDefinition({
      code: 'LEAVE2',
      name: '请假2',
      businessType: 'LEAVE',
      formSchema: BASIC_FORM_SCHEMA,
      approverRule: { type: 'SUPERVISOR', levels: 0 },
    }),
    (error: unknown) => error instanceof ApprovalError && error.code === APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID && error.httpStatus === 400,
  );
});
