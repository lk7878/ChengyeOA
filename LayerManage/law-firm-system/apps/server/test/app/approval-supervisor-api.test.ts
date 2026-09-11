// SPEC-041 Task 3: approverRule SUPERVISOR HTTP API 端到端测试（定义 CRUD SUPERVISOR 校验 +
// apply 按报告线解析直属上级审批人 + 畸形 levels 400）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/approval-supervisor-api.test.ts

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

async function createApprovalSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `approval.supervisor.${suffix}`, password: 'not-used', employeeId: null },
  });
  const role = await prisma.role.create({
    data: {
      name: `APPROVAL SUP ${suffix}`,
      code: `APP_SUP_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

async function createEmployee(name: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name,
      phone: '13800002222',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  return employee.id;
}

async function bindUser(userId: string, employeeId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { employeeId } });
}

async function createReportingLine(employeeId: string, managerEmployeeId: string): Promise<void> {
  await prisma.employeeReportingLine.create({
    data: { employeeId, managerEmployeeId, startedAt: new Date('2026-01-01T00:00:00.000Z'), version: 1 },
  });
}

const BASIC_FORM_SCHEMA = { fields: [{ key: 'amount', label: '金额', type: 'number', required: true }] };

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

test('creates a SUPERVISOR definition and applies with the direct supervisor as approver', async () => {
  const applicant = await createApprovalSession(['approval.apply', 'approval.manage']);
  const applicantEmployee = await createEmployee('申请人');
  const managerEmployee = await createEmployee('直属上级');
  await createReportingLine(applicantEmployee, managerEmployee);
  await bindUser(applicant.userId, applicantEmployee);
  const managerUser = await prisma.user.create({
    data: { username: `supervisor.manager.${randomUUID()}`, password: 'x', employeeId: managerEmployee },
  });

  // 定义管理创建 SUPERVISOR 规则定义。
  const created = await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(applicant.token))
    .send({
      code: 'LEAVE_SUP',
      name: '请假-上级审批',
      businessType: 'LEAVE',
      formSchema: BASIC_FORM_SCHEMA,
      approverRule: { type: 'SUPERVISOR' },
    })
    .expect(200);
  assert.equal(created.body.data.approverRule.type, 'SUPERVISOR');

  // apply → 节点[0] 审批人 = 直属上级绑定账号。
  const applied = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'LEAVE_SUP', title: '请假', content: { amount: 100 } })
    .expect(200);
  const instanceId = applied.body.data.id as string;

  const tasks = await prisma.approvalTask.findMany({ where: { instanceId } });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assigneeId, managerUser.id, 'direct supervisor becomes the approver');
});

test('definition CRUD rejects a malformed SUPERVISOR levels with 400', async () => {
  const session = await createApprovalSession(['approval.apply', 'approval.manage']);
  const bad = await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(session.token))
    .send({
      code: 'LEAVE_BAD',
      name: '坏定义',
      businessType: 'LEAVE',
      formSchema: BASIC_FORM_SCHEMA,
      approverRule: { type: 'SUPERVISOR', levels: 0 },
    })
    .expect(400);
  assert.equal(bad.body.message, 'APPROVAL_ASSIGNEE_INVALID');
});

test('applying a SUPERVISOR definition with no reporting line fails 400', async () => {
  const applicant = await createApprovalSession(['approval.apply', 'approval.manage']);
  const applicantEmployee = await createEmployee('无上级申请人');
  await bindUser(applicant.userId, applicantEmployee);

  await app.httpRequest()
    .post('/api/v1/approvals/definitions')
    .set(bearer(applicant.token))
    .send({
      code: 'LEAVE_SUP2',
      name: '请假-上级',
      businessType: 'LEAVE',
      formSchema: BASIC_FORM_SCHEMA,
      approverRule: { type: 'SUPERVISOR' },
    })
    .expect(200);

  const badApply = await app.httpRequest()
    .post('/api/v1/approvals')
    .set(bearer(applicant.token))
    .send({ definitionCode: 'LEAVE_SUP2', title: '请假', content: { amount: 100 } })
    .expect(400);
  assert.equal(badApply.body.message, 'APPROVAL_ASSIGNEE_INVALID');
});
