import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AnalysisService } from '../../app/application/quality/analysis-service';
import { AssessmentHandler } from '../../app/application/quality/assessment-handler';
import { WorkflowReviewClient } from '../helpers/workflow-review-client';
import { createEventServices } from '../../app/application/events/event-services-factory';
let db: PrismaClient, admin: string, reviewer: string, caseId: string, svc: AnalysisService;
const rejects = (code: string) => (error: unknown) => (error as { code: string }).code === code;
const input = (score: number | null, extra: Record<string, unknown> = {}) => ({
  score,
  source: '客户回访',
  evidence: '隔离回访记录可核验引用',
  assessedAt: '2026-09-17T00:00:00Z',
  requestKey: randomUUID(),
  ...extra,
});
async function service(id: string) {
  return new AnalysisService(db, { actorUserId: id }, await new AuthorizationContextLoader(db).load(id));
}
async function approval(id = reviewer) {
  return new WorkflowReviewClient(db, { actorUserId: id }, await new AuthorizationContextLoader(db).load(id));
}
async function deliver(id: string) {
  await db.$transaction((tx) =>
    new AssessmentHandler().handle(tx, {
      eventId: randomUUID(),
      deliveryId: randomUUID(),
      handlerCode: 'QUALITY_ASSESSMENT_ANALYSIS',
      orderingKey: id,
      eventType: 'quality.assessment.recorded',
      eventVersion: 1,
      payload: { id },
      traceId: id,
      attemptNumber: 1,
      workerId: 'test',
    }),
  );
}
async function ready() {
  const a = await svc.createAssessment(caseId, input(79));
  await deliver(a.id);
  const row = await db.specialAnalysis.findUniqueOrThrow({ where: { assessmentId: a.id } });
  await svc.save(row.id, {
    expectedVersion: 1,
    requestKey: randomUUID(),
    content: '分析原因及沟通经过',
    conclusion: '形成处理结论',
  });
  return row.id;
}
async function close(id: string, version = 2) {
  await svc.requestClose(id, {
    expectedVersion: version,
    requestKey: randomUUID(),
    reviewerUserId: reviewer,
  });
  const row = await db.analysisCloseRequest.findFirstOrThrow({
    where: { analysisId: id },
    orderBy: { createdAt: 'desc' },
  });
  return db.workflowTask.findFirstOrThrow({ where: { instanceId: row.workflowInstanceId! } });
}
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = randomUUID();
  await db.organization.create({
    data: { id: org, code: 'QA_ORG', name: '分析组织', type: 'FIRM', path: '/' + org },
  });
  const role = await db.role.create({
    data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
  });
  admin = (
    await db.user.create({
      data: { username: 'qa-admin', password: 'unused', userRoles: { create: { roleId: role.id } } },
    })
  ).id;
  const employee = await db.employee.create({
      data: {
        employeeNo: 'QA_REVIEWER',
        name: '专项审核人',
        phone: '13800000000',
        type: 'ASSISTANT',
        entryDate: new Date(),
      },
    }),
    all = await db.dataScope.create({ data: { name: '获权分析范围', scopeType: 'ALL' } }),
    reviewerRole = await db.role.create({
      data: {
        code: 'QA_REVIEWER',
        name: '专项审核岗',
        type: 'BUSINESS',
        permissions: {
          create: [
            'case.read',
            'quality.analysis.read',
            'quality.analysis.manage',
            'quality.analysis.decide',
            'approval.read',
            'approval.process',
            'approval.manage',
          ].map((code) => ({ permission: { connect: { code } } })),
        },
        dataScopes: { create: { resource: 'case', dataScopeId: all.id } },
      },
    });
  reviewer = (
    await db.user.create({
      data: {
        username: 'qa-reviewer',
        password: 'unused',
        employeeId: employee.id,
        userRoles: { create: { roleId: reviewerRole.id } },
      },
    })
  ).id;
  const customer = await db.customer.create({
    data: {
      customerNo: 'QA_CUSTOMER',
      name: '隔离客户',
      phone: '13800000000',
      phoneHash: 'test',
      createdBy: admin,
    },
  });
  caseId = (
    await db.case.create({
      data: {
        caseNo: 'QA_CASE',
        title: '满意度测试案件',
        customerId: customer.id,
        caseType: '医疗纠纷',
        branchId: org,
        createdBy: admin,
        status: 'CLOSED',
        closedAt: new Date(),
        satisfaction: 4,
      },
    })
  ).id;
  svc = await service(admin);
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
test('SQ5 79 triggers once while 80 and null do not; original stars remain untouched', async () => {
  const before = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  for (const score of [79, 80, null]) {
    const data = input(score),
      a = await svc.createAssessment(caseId, data);
    assert.equal((await svc.createAssessment(caseId, data)).id, a.id);
    await deliver(a.id);
    await deliver(a.id);
  }
  assert.equal(await db.specialAnalysis.count(), 1);
  assert.equal(await db.satisfactionAssessment.count(), 3);
  assert.deepEqual(await db.case.findUniqueOrThrow({ where: { id: caseId } }), before);
});
test('SQ5 corrections preserve low-score facts even when delivery is out of order', async () => {
  const a = await svc.createAssessment(caseId, input(79)),
    b = await svc.createAssessment(
      caseId,
      input(95, { correctionOfId: a.id, correctionReason: '核实评分误录' }),
    );
  await deliver(b.id);
  await deliver(a.id);
  await deliver(a.id);
  assert.equal(await db.specialAnalysis.count(), 1);
  assert.equal((await db.satisfactionAssessment.findUniqueOrThrow({ where: { id: a.id } })).score, 79);
  await assert.rejects(
    svc.createAssessment(caseId, input(90, { correctionOfId: a.id, correctionReason: '重复修正旧版' })),
    rejects('QUALITY_VERSION_CONFLICT'),
  );
  await assert.rejects(deliver(randomUUID()));
});
test('SQ5 original approval rejects then closes a new frozen analysis revision', async () => {
  const id = await ready(),
    first = await close(id),
    approver = await approval();
  await approver.processTask(first.id, { action: 'REJECT', remark: '请补充原因核验' });
  assert.equal((await svc.get(id)).status, 'ANALYZING');
  const current = await svc.get(id);
  await svc.save(id, {
    expectedVersion: current.version,
    requestKey: randomUUID(),
    content: '补充原因与证据',
    conclusion: '复核后的结论',
  });
  const fresh = await svc.get(id),
    second = await close(id, fresh.version);
  await assert.rejects(
    approver.processTask(first.id, { action: 'APPROVE' }),
    rejects('QUALITY_APPROVAL_STALE'),
  );
  await approver.processTask(second.id, { action: 'APPROVE' });
  assert.equal((await svc.get(id)).status, 'CLOSED');
  assert.equal(await db.analysisRevision.count({ where: { analysisId: id } }), 2);
  assert.equal(await db.analysisCloseRequest.count({ where: { analysisId: id } }), 2);
  assert.equal(
    (await db.workflowInstance.findUniqueOrThrow({ where: { id: second.instanceId } })).syncStatus,
    'SYNCED',
  );
});
test('SQ5 changed frozen content rolls back approval and completes after repair', async () => {
  const id = await ready(),
    task = await close(id),
    approver = await approval();
  await db.specialAnalysis.update({ where: { id }, data: { content: '变更冻结内容' } });
  await assert.rejects(
    approver.processTask(task.id, { action: 'APPROVE' }),
    rejects('QUALITY_APPROVAL_STALE'),
  );
  assert.equal((await svc.get(id)).status, 'PENDING_CLOSE');
  assert.equal(
    (await db.workflowInstance.findUniqueOrThrow({ where: { id: task.instanceId } })).status,
    'PENDING',
  );
  await db.specialAnalysis.update({ where: { id }, data: { content: '分析原因及沟通经过' } });
  await approver.processTask(task.id, { action: 'APPROVE' });
  assert.equal((await svc.get(id)).status, 'CLOSED');
});
test('SQ5 analysis authors cannot review and concurrent close cannot create duplicate approvals', async () => {
  const id = await ready(),
    reviewerSvc = await service(reviewer);
  await reviewerSvc.save(id, {
    expectedVersion: 2,
    requestKey: randomUUID(),
    content: '参与编写的分析',
    conclusion: '共同结论',
  });
  await assert.rejects(
    svc.requestClose(id, { expectedVersion: 3, requestKey: randomUUID(), reviewerUserId: reviewer }),
    rejects('QUALITY_SELF_REVIEW'),
  );
  assert.equal(await db.workflowInstance.count(), 0);
  const otherId = await ready(),
    values = { expectedVersion: 2, requestKey: randomUUID(), reviewerUserId: reviewer },
    results = await Promise.allSettled([
      svc.requestClose(otherId, values),
      svc.requestClose(otherId, { ...values, requestKey: randomUUID() }),
    ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.workflowInstance.count(), 1);
});
test('SQ5 current read scope, revoked reviewer and generic apply cannot bypass managed close', async () => {
  const id = await ready(),
    task = await close(id),
    approver = await approval(),
    def = await db.workflowDefinition.findFirstOrThrow({ where: { managedType: 'QUALITY_ANALYSIS' } });
  await assert.rejects(
    (await approval(admin)).start(
      {
        definitionId: def.id,
        title: '伪造关闭',
        content: { analysisId: id, closeRequestId: 'fake', contentHash: 'fake' },
      },
      randomUUID(),
    ),
  );
  await db.userRole.deleteMany({ where: { userId: reviewer } });
  await assert.rejects(approver.processTask(task.id, { action: 'APPROVE' }));
  const revoked = await service(reviewer);
  await assert.rejects(revoked.get(id));
  assert.equal((await svc.get(id)).status, 'PENDING_CLOSE');
});
test('SQ5 registered dispatcher and worker deliver persisted assessments exactly once', async () => {
  const a = await svc.createAssessment(caseId, input(79));
  const services = createEventServices(db, {
    enabled: false,
    shutdownSeconds: 30,
    pollMs: 1000,
    batchSize: 100,
    leaseSeconds: 60,
  });
  for (let n = 0; n < 3; n++) await services.worker.tick();
  assert.equal(await db.specialAnalysis.count({ where: { assessmentId: a.id } }), 1);
  const event = await db.eventLog.findFirstOrThrow({
    where: { eventType: 'quality.assessment.recorded', objectId: a.id },
  });
  assert.equal(
    (await db.eventDelivery.findFirstOrThrow({ where: { eventId: event.id } })).status,
    'SUCCEEDED',
  );
  await services.worker.tick();
  assert.equal(await db.specialAnalysis.count(), 1);
});

test('SQ5 assessment handler rollback retries without orphan analysis or duplicate changes', async () => {
  const { EventHandlerRegistry } = await import('../../app/application/events/event-handler-registry');
  const { EventHealthService } = await import('../../app/application/events/event-health-service');
  const { EventDispatcher } = await import('../../app/application/events/event-dispatcher');
  const { EventWorker } = await import('../../app/application/events/event-worker');
  const { RetryableEventError } = await import('../../app/domain/events/event-errors');
  const a = await svc.createAssessment(caseId, input(79)),
    registry = new EventHandlerRegistry(),
    health = new EventHealthService(false);
  let fail = true;
  registry.register({
    handlerCode: 'QUALITY_ASSESSMENT_ANALYSIS',
    eventType: 'quality.assessment.recorded',
    eventVersion: 1,
    handler: {
      async handle(tx, ctx) {
        await new AssessmentHandler().handle(tx, ctx);
        if (fail) {
          fail = false;
          throw new RetryableEventError('TEST_RETRY');
        }
      },
    },
  });
  let now = new Date();
  const worker = new EventWorker({
    prisma: db,
    registry,
    health,
    dispatcher: new EventDispatcher(db, registry, health),
    workerId: 'quality-retry-test',
    config: { pollMs: 1000, batchSize: 100, leaseSeconds: 60 },
    now: () => now,
  });
  const result = await worker.tick();
  assert.equal(result.retryScheduled, 1);
  assert.equal(await db.specialAnalysis.count(), 0);
  assert.equal(await db.eventLog.count({ where: { eventType: 'quality.changed' } }), 0);
  now = new Date(now.getTime() + 16000);
  await worker.tick();
  assert.equal(await db.specialAnalysis.count({ where: { assessmentId: a.id } }), 1);
  assert.equal(await db.operationLog.count({ where: { action: 'QUALITY_ANALYSIS_TRIGGERED' } }), 1);
});

test('managed visual timeout reminders do not auto-approve and respect revoked access', async () => {
  const { tickWorkflows } = await import('../../app/application/workflow/workflow-worker');
  const id = await ready(),
    task = await close(id);
  await db.workflowTask.update({ where: { id: task.id }, data: { dueAt: new Date(0) } });
  const roles = await db.userRole.findMany({ where: { userId: reviewer } });
  await db.userRole.deleteMany({ where: { userId: reviewer } });
  const before = await db.notification.count({ where: { userId: reviewer } });
  await tickWorkflows(db);
  assert.equal(await db.notification.count({ where: { userId: reviewer } }), before);
  assert.equal(
    (await db.workflowInstance.findUniqueOrThrow({ where: { id: task.instanceId } })).status,
    'PENDING',
  );
  await db.userRole.createMany({ data: roles });
  await db.workflowTask.update({ where: { id: task.id }, data: { dueAt: new Date(0) } });
  await tickWorkflows(db);
  assert.equal(await db.notification.count({ where: { userId: reviewer } }), before + 1);
});

test('SQ5 quality metrics intersect current case scope and omit unauthorized businesses', async () => {
  await ready();
  const role = await db.role.findUniqueOrThrow({ where: { code: 'QA_REVIEWER' } });
  await db.rolePermission.create({
    data: {
      roleId: role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'quality.metric.read' } })).id,
    },
  });
  let metrics = await (await service(reviewer)).metrics();
  assert.equal((metrics.analyses as { status: string; _count: { _all: number } }[])[0]._count._all, 1);
  assert.equal(metrics.issues, undefined);
  assert.equal(metrics.tasks, undefined);
  await db.dataScope.updateMany({ where: { name: '获权分析范围' }, data: { scopeType: 'SELF' } });
  metrics = await (await service(reviewer)).metrics();
  assert.deepEqual(metrics.analyses, []);
});
