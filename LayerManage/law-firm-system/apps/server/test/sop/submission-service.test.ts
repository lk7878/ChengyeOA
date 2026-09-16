import { ApprovalDefinitionService } from '../../app/application/approval/approval-definition-service';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { SopTemplateService } from '../../app/application/sop/template-service';
import { SopExecutionService } from '../../app/application/sop/execution-service';
import { CaseService } from '../../app/application/case/case-service';
import { SopSubmissionService } from '../../app/application/sop/submission-service';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import { ApprovalSyncService } from '../../app/application/approval/approval-sync-service';
import { CaseFileService } from '../../app/application/case/case-file-service';
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
                create: [
                  'sop.task.read',
                  'sop.task.execute',
                  'sop.report.read',
                  'sop.report.submit',
                  'sop.guidance.read',
                  'sop.guidance.create',
                  'approval.apply',
                  'approval.read',
                ].map((code) => ({
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
        {
          code: 'REVIEW',
          name: '需审核节点',
          reviewRequired: true,
          closeGate: true,
          materials: [{ code: 'REPORT_FILE', name: '分析报告材料', required: true }],
        },
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

const submissions = () => new SopSubmissionService(db, { actorUserId: admin }, ctx);
async function prepare() {
  const instance = await start();
  const task = await db.caseTask.findFirstOrThrow({
    where: { sopInstanceId: instance.id, nodeCode: 'REVIEW' },
  });
  const begun = await svc.taskAction(task.id, action('START', 1));
  const file = await new CaseFileService(db, { actorUserId: admin }, ctx).upload(caseId, {
    fileName: '分析材料.txt',
    fileType: 'text/plain',
    base64: Buffer.from('冻结材料内容').toString('base64'),
  });
  const role = await db.role.findUniqueOrThrow({ where: { code: 'SQ2_OTHER' } });
  const all = await db.dataScope.create({ data: { name: '获权业务范围', scopeType: 'ALL' } });
  await db.roleDataScope.deleteMany({ where: { roleId: role.id } });
  await db.roleDataScope.createMany({
    data: ['sop_task', 'case'].map((resource) => ({ roleId: role.id, dataScopeId: all.id, resource })),
  });
  for (const code of ['quality.review.read', 'quality.review.decide', 'approval.process', 'case.file.read'])
    await db.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id,
      },
    });
  const reviewerCtx = await new AuthorizationContextLoader(db).load(other);
  const reviewSvc = new SopSubmissionService(db, { actorUserId: other }, reviewerCtx);
  const approvalSvc = new ApprovalInstanceService(db, { actorUserId: other }, reviewerCtx);
  const input = {
    expectedVersion: begun.version,
    requestKey: randomUUID(),
    report: '事实、风险与目标说明',
    materials: [{ code: 'REPORT_FILE', fileId: file.id }],
    reviewerUserId: other,
  };
  return { task, begun, file, input, reviewSvc, approvalSvc, reviewerCtx };
}
async function passChecklist(svc: SopSubmissionService, submissionId: string) {
  const row = await svc.get(submissionId);
  await svc.checklist(row.review!.id, {
    expectedVersion: row.review!.version,
    checks: [
      { code: 'MATERIALS', result: 'PASS', reason: '' },
      { code: 'REPORT', result: 'PASS', reason: '' },
    ],
  });
  return db.approvalTask.findFirstOrThrow({
    where: { instanceId: row.review!.approvalId!, status: 'PENDING' },
  });
}
test('submission freezes material and report; original approval return then new revision completes the gate', async () => {
  const { task, input, reviewSvc, approvalSvc } = await prepare();
  const first = await submissions().submit(task.id, input);
  assert.equal((await submissions().submit(task.id, input)).id, first.id);
  const review = await submissions().get(first.id);
  assert.equal(review.materials.length, 1);
  await assert.rejects(
    new CaseFileService(db, { actorUserId: admin }, ctx).remove(review.materials[0].fileId),
    rejects('SOP_MATERIAL_REFERENCED'),
  );
  await assert.rejects(
    new CaseService(db, { actorUserId: admin }, ctx).closeCase(caseId, {}),
    rejects('SOP_CLOSE_GATE_BLOCKED'),
  );
  const approvalTask = await db.approvalTask.findFirstOrThrow({
    where: { instanceId: review.review!.approvalId! },
  });
  await approvalSvc.processTask(approvalTask.id, { action: 'REJECT', remark: '请补充风险分析' });
  assert.equal((await svc.task(task.id)).status, 'CHANGES_REQUESTED');
  const current = await svc.task(task.id);
  const begun = await svc.taskAction(task.id, action('START', current.version));
  const second = await submissions().submit(task.id, {
    ...input,
    expectedVersion: begun.version,
    requestKey: randomUUID(),
    report: '已修订风险分析',
  });
  await assert.rejects(
    approvalSvc.processTask(approvalTask.id, { action: 'APPROVE' }),
    rejects('SOP_REVIEW_STALE'),
  );
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  const fresh = await passChecklist(reviewSvc, second.id);
  await approvalSvc.processTask(fresh.id, { action: 'APPROVE' });
  assert.equal((await svc.task(task.id)).status, 'COMPLETED');
  assert.equal((await submissions().get(first.id)).report, input.report);
  assert.equal(
    (await new CaseService(db, { actorUserId: admin }, ctx).closeCase(caseId, {})).status,
    'CLOSED',
  );
});
test('self review, missing material and incomplete checklist cannot be bypassed', async () => {
  const { task, input, approvalSvc } = await prepare();
  await assert.rejects(
    submissions().submit(task.id, { ...input, reviewerUserId: admin }),
    rejects('SOP_SELF_REVIEW'),
  );
  await assert.rejects(
    submissions().submit(task.id, { ...input, materials: [] }),
    rejects('SOP_MATERIALS_REQUIRED'),
  );
  const sub = await submissions().submit(task.id, input);
  const review = await submissions().get(sub.id);
  const at = await db.approvalTask.findFirstOrThrow({ where: { instanceId: review.review!.approvalId! } });
  await assert.rejects(
    approvalSvc.processTask(at.id, { action: 'APPROVE' }),
    rejects('SOP_CHECKLIST_INCOMPLETE'),
  );
  await assert.rejects(
    approvalSvc.forwardTask(at.id, { forwardToUserId: staff }),
    rejects('SOP_REVIEW_ROUTING_FIXED'),
  );
});
test('paused or stale business targets keep approval sync failed and retry checks current facts', async () => {
  const { task, input, reviewSvc, approvalSvc } = await prepare();
  const sub = await submissions().submit(task.id, input),
    at = await passChecklist(reviewSvc, sub.id);
  const instance = await db.sopInstance.findUniqueOrThrow({ where: { id: task.sopInstanceId! } });
  await svc.instanceAction(instance.id, action('PAUSE', instance.version));
  const decision = await approvalSvc.processTask(at.id, { action: 'APPROVE' });
  assert.equal(decision.businessSync?.status, 'FAILED');
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  const paused = await db.sopInstance.findUniqueOrThrow({ where: { id: instance.id } });
  await svc.instanceAction(instance.id, action('RESUME', paused.version));
  await new ApprovalSyncService(db, { actorUserId: admin }, ctx).retry(at.instanceId);
  assert.equal((await svc.task(task.id)).status, 'COMPLETED');
});

test('waiting review assignment, withdrawal and expert guidance preserve distinct history', async () => {
  const { task, input } = await prepare();
  const sub = await submissions().submit(task.id, { ...input, reviewerUserId: null });
  let review = (await submissions().get(sub.id)).review!;
  assert.equal(review.status, 'WAITING_ASSIGNMENT');
  assert.equal(review.approvalId, null);
  await submissions().assign(review.id, {
    reviewerUserId: other,
    expectedVersion: review.version,
    requestKey: randomUUID(),
  });
  review = (await submissions().get(sub.id)).review!;
  const guidance = await submissions().guide(task.id, {
    content: '请核验材料来源，指导不是审核决定',
    submissionId: sub.id,
    requestKey: randomUUID(),
  });
  assert.ok(guidance.id);
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  await new ApprovalInstanceService(db, { actorUserId: admin }, ctx).withdrawInstance(review.approvalId!, {
    reason: '补充成果',
  });
  assert.equal((await svc.task(task.id)).status, 'CHANGES_REQUESTED');
  assert.equal((await submissions().get(sub.id)).review?.status, 'CANCELLED');
  assert.equal((await submissions().guidance(task.id)).length, 1);
});
test('material drift causes business sync failure without falsely completing the node', async () => {
  const { task, input, file, reviewSvc, approvalSvc } = await prepare();
  const sub = await submissions().submit(task.id, input);
  const approvalTask = await passChecklist(reviewSvc, sub.id);
  const original = await db.caseFile.findUniqueOrThrow({ where: { id: file.id } });
  await db.caseFile.update({ where: { id: file.id }, data: { fileSize: original.fileSize + 1 } });
  const result = await approvalSvc.processTask(approvalTask.id, { action: 'APPROVE' });
  assert.equal(result.businessSync?.status, 'FAILED');
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  await db.caseFile.update({ where: { id: file.id }, data: { fileSize: original.fileSize } });
  await new ApprovalSyncService(db, { actorUserId: admin }, ctx).retry(approvalTask.instanceId);
  assert.equal((await svc.task(task.id)).status, 'COMPLETED');
});
test('revoking the reviewer permission blocks a decision even with an old service context', async () => {
  const { task, input, reviewSvc, approvalSvc } = await prepare();
  const sub = await submissions().submit(task.id, input),
    at = await passChecklist(reviewSvc, sub.id);
  const role = await db.role.findUniqueOrThrow({ where: { code: 'SQ2_OTHER' } });
  await db.rolePermission.deleteMany({
    where: { roleId: role.id, permission: { code: 'quality.review.decide' } },
  });
  await assert.rejects(approvalSvc.processTask(at.id, { action: 'APPROVE' }), rejects('PERMISSION_DENIED'));
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  assert.equal(
    (await db.approvalInstance.findUniqueOrThrow({ where: { id: at.instanceId } })).status,
    'PENDING',
  );
});

test('assigned report permission does not grant case file access', async () => {
  const { task, input } = await prepare();
  const current = await svc.task(task.id);
  const assigned = await svc.taskAction(
    task.id,
    action('ASSIGN', current.version, { assigneeUserId: staff }),
  );
  assert.ok((await staffService().task(task.id)).permissions.includes('sop.report.submit'));
  const staffReports = new SopSubmissionService(db, { actorUserId: staff }, staffCtx);
  await assert.rejects(
    staffReports.submit(task.id, { ...input, expectedVersion: assigned.version }),
    rejects('PERMISSION_DENIED'),
  );
  await assert.rejects(staffReports.materialOptions(task.id, {}), rejects('PERMISSION_DENIED'));
  assert.equal(await db.sopSubmission.count(), 0);
});
test('generic approval application and definition editing cannot forge an SOP review', async () => {
  const { task, input } = await prepare();
  const sub = await submissions().submit(task.id, input);
  const review = (await submissions().get(sub.id)).review!;
  const approval = await db.approvalInstance.findUniqueOrThrow({
    where: { id: review.approvalId! },
    include: { definition: true },
  });
  await assert.rejects(
    new ApprovalInstanceService(db, { actorUserId: admin }, ctx).applyForApproval({
      definitionCode: approval.definition.code,
      title: '伪造复审',
      content: { submissionId: sub.id, contentHash: 'changed' },
    }),
  );
  await assert.rejects(
    new ApprovalDefinitionService(db, { actorUserId: admin }, ctx).updateDefinition(
      approval.definition.code,
      { approverRule: { type: 'USER', userIds: [admin] } },
    ),
    rejects('SOP_REVIEW_ROUTING_FIXED'),
  );
  assert.equal(await db.approvalInstance.count(), 1);
});
