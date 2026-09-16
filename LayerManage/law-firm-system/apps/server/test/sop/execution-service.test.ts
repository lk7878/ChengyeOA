import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { SopTemplateService } from '../../app/application/sop/template-service';
import { SopExecutionService } from '../../app/application/sop/execution-service';
import { CaseTaskService } from '../../app/application/case/case-task-service';
import { CaseService } from '../../app/application/case/case-service';
import { parseSopContent } from '../../app/domain/sop/template-content';
let db: PrismaClient,
  admin: string,
  staff: string,
  other: string,
  caseId: string,
  versionId: string,
  ctx: AuthorizationContext,
  staffCtx: AuthorizationContext,
  svc: SopExecutionService;
const rejects = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const start = () =>
  svc.start({ caseId, templateVersionId: versionId, batchKey: 'PRIMARY', requestKey: randomUUID() });
const action = (name: string, expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  action: name,
  expectedVersion,
  requestKey: randomUUID(),
  ...extra,
});
const staffService = () => new SopExecutionService(db, { actorUserId: staff }, staffCtx);
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const orgId = randomUUID();
  await db.organization.create({
    data: { id: orgId, code: 'SQ2_ORG', name: '医疗组织', type: 'FIRM', path: '/' + orgId },
  });
  const team = await db.professionalTeam.create({
    data: { code: 'SQ2_TEAM', name: '医疗团队', categoryCode: 'MEDICAL', homeOrganizationId: orgId },
  });
  const self = await db.dataScope.create({ data: { name: '本人', scopeType: 'SELF' } });
  for (const [code, superAdmin] of [
    ['SQ2_ADMIN', true],
    ['SQ2_STAFF', false],
    ['SQ2_OTHER', false],
  ] as const) {
    const employee = await db.employee.create({
      data: { employeeNo: code, name: code, phone: '13800000000', type: 'ASSISTANT', entryDate: new Date() },
    });
    const user = await db.user.create({
      data: { username: code, password: 'unused', employeeId: employee.id },
    });
    const role = await db.role.create({
      data: {
        code: superAdmin ? 'SYSTEM_SUPER_ADMIN' : code,
        name: code,
        type: superAdmin ? 'SYSTEM' : 'BUSINESS',
        ...(!superAdmin
          ? {
              permissions: {
                create: ['sop.task.read', 'sop.task.execute'].map((code) => ({
                  permission: { connect: { code } },
                })),
              },
              dataScopes: { create: { resource: 'sop_task', dataScopeId: self.id } },
            }
          : {}),
      },
    });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (superAdmin) admin = user.id;
    else if (code === 'SQ2_STAFF') staff = user.id;
    else other = user.id;
  }
  ctx = await new AuthorizationContextLoader(db).load(admin);
  staffCtx = await new AuthorizationContextLoader(db).load(staff);
  svc = new SopExecutionService(db, { actorUserId: admin }, ctx);
  const template = await new SopTemplateService(db, { actorUserId: admin }, ctx).create({
    code: 'SQ2_TEMPLATE',
    name: '医疗办理',
    organizationId: orgId,
    professionalTeamId: team.id,
    caseType: '医疗纠纷',
    requestKey: randomUUID(),
    content: parseSopContent({
      schemaVersion: 1,
      nodes: [
        { code: 'FIRST', name: '材料收集' },
        { code: 'SECOND', name: '交付', dependsOn: ['FIRST'] },
        { code: 'REVIEW', name: '需审核节点', reviewRequired: true },
      ],
    }),
  });
  const revision = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
  versionId = revision.id;
  // Publication itself is tested through real MFA/governance in SQ1; isolated execution fixture starts published.
  await db.sopTemplateVersion.update({ where: { id: versionId }, data: { status: 'PUBLISHED' } });
  await db.sopTemplate.update({ where: { id: template.id }, data: { activeVersionId: versionId } });
  const customer = await db.customer.create({
    data: {
      customerNo: 'SQ2_CUSTOMER',
      name: '隐私客户',
      phone: '13800000000',
      phoneHash: 'test',
      createdBy: admin,
    },
  });
  const row = await db.case.create({
    data: {
      caseNo: 'SQ2_CASE',
      title: '不能向获派任务人员泄漏的案件标题',
      caseType: '医疗纠纷',
      customerId: customer.id,
      createdBy: admin,
      branchId: orgId,
      teamIds: JSON.stringify([team.id]),
    },
  });
  caseId = row.id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
test('start is idempotent by request and business batch, freezes nodes and emits durable audit/outbox', async () => {
  const input = { caseId, templateVersionId: versionId, batchKey: 'PRIMARY', requestKey: randomUUID() };
  const [a, b] = await Promise.all([svc.start(input), svc.start(input)]);
  assert.equal(a.id, b.id);
  assert.equal((await start()).id, a.id);
  assert.equal(await db.caseTask.count(), 3);
  assert.equal(await db.sopInstance.count(), 1);
  assert.equal(await db.eventLog.count({ where: { eventType: 'sop.instance.changed' } }), 1);
  await db.sopTemplateVersion.update({ where: { id: versionId }, data: { status: 'DISABLED' } });
  assert.equal((await svc.start(input)).id, a.id);
  await assert.rejects(
    svc.start({ ...input, batchKey: 'SECOND', requestKey: randomUUID() }),
    rejects('SOP_TEMPLATE_NOT_ACTIVE'),
  );
});
test('explicit task assignment authorizes necessary task content but not case, other tasks or management', async () => {
  const instance = await start();
  const task = await db.caseTask.findFirstOrThrow({
    where: { sopInstanceId: instance.id, nodeCode: 'FIRST' },
  });
  await assert.rejects(staffService().task(task.id), rejects('SOP_TASK_NOT_FOUND'));
  const assigned = await svc.taskAction(task.id, action('ASSIGN', 1, { assigneeUserId: staff }));
  const detail = await staffService().task(task.id);
  assert.equal(detail.case, null);
  assert.equal((await staffService().tasks({})).pagination.total, 1);
  assert.equal(detail.name, '材料收集');
  await assert.rejects(
    staffService().taskAction(task.id, action('SKIP', assigned.version, { reason: '不能管理' })),
    rejects('PERMISSION_DENIED'),
  );
  await assert.rejects(
    new CaseService(db, { actorUserId: staff }, staffCtx).getCase(caseId),
    rejects('PERMISSION_DENIED'),
  );
  const started = await staffService().taskAction(task.id, action('START', assigned.version));
  const done = await staffService().taskAction(task.id, action('COMPLETE', started.version));
  assert.equal(done.status, 'COMPLETED');
});
test('reassignment, expired grants and role revocation revoke the exception immediately', async () => {
  const instance = await start();
  const task = await db.caseTask.findFirstOrThrow({
    where: { sopInstanceId: instance.id, nodeCode: 'FIRST' },
  });
  const assigned = await svc.taskAction(task.id, action('ASSIGN', 1, { assigneeUserId: staff }));
  await staffService().task(task.id);
  await svc.taskAction(task.id, action('ASSIGN', assigned.version, { assigneeUserId: other }));
  await assert.rejects(staffService().task(task.id), rejects('SOP_TASK_NOT_FOUND'));
  const otherCtx = await new AuthorizationContextLoader(db).load(other);
  const otherService = new SopExecutionService(db, { actorUserId: other }, otherCtx);
  await otherService.task(task.id);
  await db.sopTaskAccess.updateMany({
    where: { principalUserId: other },
    data: { validFrom: new Date(Date.now() - 60000), validUntil: new Date(Date.now() - 1000) },
  });
  await assert.rejects(otherService.task(task.id), rejects('SOP_TASK_NOT_FOUND'));
  await db.userRole.deleteMany({ where: { userId: other } });
  const revoked = await new AuthorizationContextLoader(db).load(other);
  await assert.rejects(
    new SopExecutionService(db, { actorUserId: other }, revoked).tasks({}),
    rejects('PERMISSION_DENIED'),
  );
});
test('dependencies, pause and review requirements cannot be bypassed by SOP or original task API', async () => {
  const instance = await start();
  const tasks = await db.caseTask.findMany({ where: { sopInstanceId: instance.id } });
  const first = tasks.find((t) => t.nodeCode === 'FIRST')!,
    second = tasks.find((t) => t.nodeCode === 'SECOND')!,
    review = tasks.find((t) => t.nodeCode === 'REVIEW')!;
  await assert.rejects(svc.taskAction(second.id, action('START', 1)), rejects('SOP_DEPENDENCY_BLOCKED'));
  await assert.rejects(
    new CaseTaskService(db, { actorUserId: admin }, ctx).updateTask(caseId, first.id, {
      status: 'IN_PROGRESS',
    }),
    rejects('SOP_TASK_ACTION_REQUIRED'),
  );
  const paused = await svc.instanceAction(instance.id, action('PAUSE', 1));
  await assert.rejects(svc.taskAction(first.id, action('START', 1)), rejects('SOP_STATE_INVALID'));
  await svc.instanceAction(instance.id, action('RESUME', paused.version));
  const begun = await svc.taskAction(review.id, action('START', 1));
  await assert.rejects(
    svc.taskAction(review.id, action('COMPLETE', begun.version)),
    rejects('SOP_REVIEW_REQUIRED'),
  );
  const started = await svc.taskAction(first.id, action('START', 1));
  await svc.taskAction(first.id, action('COMPLETE', started.version));
  assert.equal((await svc.taskAction(second.id, action('START', 1))).status, 'IN_PROGRESS');
});
test('optimistic conflict, action replay, rescheduling and cancellation preserve history', async () => {
  const instance = await start();
  const task = await db.caseTask.findFirstOrThrow({
    where: { sopInstanceId: instance.id, nodeCode: 'FIRST' },
  });
  const input = action('START', 1);
  const done = await svc.taskAction(task.id, input);
  assert.equal((await svc.taskAction(task.id, input)).version, done.version);
  await assert.rejects(
    svc.taskAction(task.id, action('RESCHEDULE', 1, { dueDate: new Date().toISOString() })),
    rejects('SOP_VERSION_CONFLICT'),
  );
  const scheduled = await svc.taskAction(
    task.id,
    action('RESCHEDULE', done.version, { dueDate: new Date(Date.now() - 10000).toISOString() }),
  );
  assert.equal(scheduled.overdue, true);
  assert.equal(scheduled.status, 'IN_PROGRESS');
  assert.equal((await svc.tasks({ overdue: 'true', status: 'PENDING' })).pagination.total, 0);
  assert.equal((await svc.tasks({ overdue: 'true', status: 'IN_PROGRESS' })).pagination.total, 1);
  const current = await db.sopInstance.findUniqueOrThrow({ where: { id: instance.id } });
  await svc.instanceAction(instance.id, action('CANCEL', current.version, { reason: '客户调整计划' }));
  await assert.rejects(
    svc.taskAction(task.id, action('COMPLETE', scheduled.version)),
    rejects('SOP_STATE_INVALID'),
  );
  assert.equal(await db.caseTask.count(), 3);
});

test('case detail does not leak SOP tasks without independent SOP read permission', async () => {
  await start();
  const restricted = {
    ...ctx,
    permissionCodes: ctx.permissionCodes.filter((p) => p !== 'sop.task.read'),
    grants: ctx.grants.filter((g) => g.permissionCode !== 'sop.task.read'),
  };
  const result = await new CaseService(db, { actorUserId: admin }, restricted).getCase(caseId);
  assert.equal(result.tasks?.length, 0);
  const legacy = await new CaseTaskService(db, { actorUserId: admin }, ctx).createTask(caseId, {
    name: '原有普通任务',
    nodeType: '材料收集',
  });
  const begin = await new CaseTaskService(db, { actorUserId: admin }, ctx).updateTask(caseId, legacy.id, {
    status: 'IN_PROGRESS',
  });
  assert.equal(begin.status, 'IN_PROGRESS');
  const visible = await new CaseService(db, { actorUserId: admin }, restricted).getCase(caseId);
  assert.equal(visible.tasks?.length, 1);
});
test('concurrent task updates have one winner and hidden instance cannot be enumerated', async () => {
  const instance = await start();
  await assert.rejects(staffService().instance(instance.id), rejects('PERMISSION_DENIED'));
  const task = await db.caseTask.findFirstOrThrow({
    where: { sopInstanceId: instance.id, nodeCode: 'FIRST' },
  });
  const results = await Promise.allSettled([
    svc.taskAction(task.id, action('START', 1)),
    svc.taskAction(task.id, action('START', 1)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('organization and team task scopes use explicit template anchors, not case visibility', async () => {
  const instance = await start();
  const template = await db.sopTemplate.findFirstOrThrow();
  const outside = randomUUID();
  await db.organization.create({
    data: { id: outside, code: 'OUTSIDE', name: '另一组织', type: 'FIRM', path: '/' + outside },
  });
  const foreignTeam = await db.professionalTeam.create({
    data: { code: 'FOREIGN', name: '另一团队', categoryCode: 'MEDICAL', homeOrganizationId: outside },
  });
  const scopes = await Promise.all([
    db.dataScope.create({
      data: { name: '本组织', scopeType: 'ORG', organizationId: template.organizationId },
    }),
    db.dataScope.create({
      data: { name: '本团队', scopeType: 'TEAM', professionalTeamId: template.professionalTeamId },
    }),
    db.dataScope.create({ data: { name: '另一组织', scopeType: 'ORG', organizationId: outside } }),
    db.dataScope.create({
      data: { name: '另一团队', scopeType: 'TEAM', professionalTeamId: foreignTeam.id },
    }),
  ]);
  for (let i = 0; i < scopes.length; i++) {
    const scopedContext = {
      ...ctx,
      isSystemAdmin: false,
      grants: ctx.grants.map((g) =>
        ['sop_task', 'sop_instance'].includes(g.resource) ? { ...g, scopeIds: [scopes[i].id] } : g,
      ),
    };
    const scoped = new SopExecutionService(db, { actorUserId: admin }, scopedContext);
    assert.equal((await scoped.tasks({})).pagination.total, i < 2 ? 3 : 0);
    if (i < 2) assert.equal((await scoped.instance(instance.id)).progress.visible, 3);
    else await assert.rejects(scoped.instance(instance.id), rejects('SOP_INSTANCE_NOT_FOUND'));
  }
});
