import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { SopTemplateService } from '../../app/application/sop/template-service';
import { SopExecutionService } from '../../app/application/sop/execution-service';
import { SopSubmissionService } from '../../app/application/sop/submission-service';
import { SopSourceFileService } from '../../app/application/sop/source-file-service';
import { SopContinuationService } from '../../app/application/sop/continuation-service';
import { SOP_PRESETS, parseSopContent } from '../../app/domain/sop/template-content';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import { LeadService } from '../../app/application/crm/lead-service';
import { ContractService } from '../../app/application/contract/contract-service';
import { CaseService } from '../../app/application/case/case-service';
let db: PrismaClient, admin: string, reviewer: string, worker: string, org: string, team: string;
const rejects = (code: string) => (e: unknown) => (e as { code: string }).code === code;
const actor = (id: string) => ({ actorUserId: id });
const ctx = (id = admin) => new AuthorizationContextLoader(db).load(id);
async function execution(id = admin) {
  return new SopExecutionService(db, actor(id), await ctx(id));
}
async function submissions(id = admin) {
  return new SopSubmissionService(db, actor(id), await ctx(id));
}
async function files(id = admin) {
  return new SopSourceFileService(db, actor(id), await ctx(id));
}
const command = (action: string, expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  action,
  expectedVersion,
  requestKey: randomUUID(),
  ...extra,
});
async function template(code = 'MEDICAL', material = false, dependency = false) {
  const preset = SOP_PRESETS.find((p) => p.code === code)!;
  const content = parseSopContent({
    ...preset.content,
    nodes: preset.content.nodes.map((n, i) => ({
      ...n,
      reviewRequired: i === 0,
      ...(dependency && i === 1 ? { dependsOn: [preset.content.nodes[0].code] } : {}),
      materials: material && i === 0 ? [{ code: 'DOC', name: '原始材料', required: true }] : n.materials,
    })),
  });
  const tpl = await new SopTemplateService(db, actor(admin), await ctx()).create({
    code: 'TEST_' + code + '_' + randomUUID().slice(0, 8).toUpperCase(),
    name: preset.name + '流程',
    organizationId: org,
    professionalTeamId: team,
    caseType: preset.name,
    content,
    requestKey: randomUUID(),
  });
  const v = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: tpl.id } });
  await db.sopTemplateVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED' } });
  await db.sopTemplate.update({ where: { id: tpl.id }, data: { activeVersionId: v.id } });
  return { versionId: v.id, content, preset };
}
async function lead() {
  return db.lead.create({
    data: {
      leadNo: 'L' + randomUUID(),
      name: '前期隔离来源',
      phone: '13800000000',
      phoneHash: 'test',
      status: 'VISITED',
      branchId: org,
      professionalTeamId: team,
      createdBy: admin,
      assignedTo: (await db.user.findUniqueOrThrow({ where: { id: admin } })).employeeId,
    },
  });
}
async function start(
  ref: Record<string, unknown>,
  versionId: string,
  nodeCodes: string[],
  batchKey = 'PRIMARY',
) {
  return (await execution()).start({
    ...ref,
    templateVersionId: versionId,
    nodeCodes,
    batchKey,
    requestKey: randomUUID(),
  });
}
async function business(leadId: string, caseType: string) {
  const c = await new LeadService(db, actor(admin), await ctx()).convertToCustomer(
      leadId,
      { name: '真实转换客户', phone: '13800000000' },
      { name: '联系人', phone: '13800000000', relation: '本人', isPrimary: true },
      randomUUID(),
    ),
    contracts = new ContractService(db, actor(admin), await ctx());
  async function contract(type: 'FIRST_SIGN' | 'FORMAL' | 'RISK_NOTICE', sourceId?: string) {
    const row = await contracts.createContract({
      contractType: type,
      title: type + '隔离合同',
      customerId: c.id,
      branchId: org,
      professionalTeamId: team,
      amount: '100',
      ...(sourceId ? { sourceType: 'ANALYSIS' as const, sourceId } : {}),
    });
    const submitted = await contracts.submitContract(row.id);
    if (submitted.status === 'PENDING_APPROVAL') await contracts.approveContract(row.id, {});
    await contracts.signContract(row.id, {});
    if (type !== 'RISK_NOTICE') await contracts.effectContract(row.id, {});
    return row;
  }
  const first = await contract('FIRST_SIGN'),
    engagement = await db.analysisEngagement.findUniqueOrThrow({ where: { contractId: first.id } });
  await contract('RISK_NOTICE');
  const formal = await contract('FORMAL', engagement.id),
    caseRow = await db.case.findUniqueOrThrow({ where: { contractId: formal.id } });
  await new CaseService(db, actor(admin), await ctx()).updateCase(caseRow.id, {
    version: caseRow.version,
    caseType,
    teamIds: [team],
  });
  return { customer: c, engagement, caseRow: await db.case.findUniqueOrThrow({ where: { id: caseRow.id } }) };
}
async function approve(subId: string, reject = false) {
  const sub = await (await submissions(reviewer)).get(subId),
    approvals = new ApprovalInstanceService(db, actor(reviewer), await ctx(reviewer)),
    task = await db.approvalTask.findFirstOrThrow({
      where: { instanceId: sub.review!.approvalId!, status: 'PENDING' },
    });
  if (!reject)
    await (
      await submissions(reviewer)
    ).checklist(sub.review!.id, {
      expectedVersion: sub.review!.version,
      checks: [
        { code: 'MATERIALS', result: 'PASS', reason: '' },
        { code: 'REPORT', result: 'PASS', reason: '' },
      ],
    });
  await approvals.processTask(task.id, {
    action: reject ? 'REJECT' : 'APPROVE',
    ...(reject ? { remark: '补充核验依据' } : {}),
  });
  return task;
}

test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = randomUUID();
  await db.organization.create({
    data: { id: org, code: 'SQ6_ORG', name: '前期测试组织', type: 'FIRM', path: '/' + org },
  });
  team = (
    await db.professionalTeam.create({
      data: { code: 'SQ6_TEAM', name: '前期专业团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
    })
  ).id;
  const all = await db.dataScope.create({ data: { name: '全部获权来源', scopeType: 'ALL' } }),
    self = await db.dataScope.create({ data: { name: '本人', scopeType: 'SELF' } });
  for (const [code, superAdmin, isWorker] of [
    ['ADMIN', true, false],
    ['REVIEWER', false, false],
    ['WORKER', false, true],
  ] as const) {
    const employee = await db.employee.create({
      data: { employeeNo: code, name: code, phone: '13800000000', type: 'ASSISTANT', entryDate: new Date() },
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
                  'sop.material.read',
                  'sop.material.manage',
                  'sop.instance.read',
                  'approval.read',
                  'approval.apply',
                  ...(isWorker
                    ? []
                    : [
                        'quality.review.read',
                        'quality.review.decide',
                        'approval.process',
                        'lead.read',
                        'contract.read',
                        'case.read',
                        'case.file.read',
                      ]),
                ].map((code) => ({ permission: { connect: { code } } })),
              },
              dataScopes: {
                create: ['sop_task', 'sop_instance', 'lead', 'contract', 'case'].map((resource) => ({
                  resource,
                  dataScopeId: isWorker ? self.id : all.id,
                })),
              },
            }
          : {}),
      },
    });
    const user = await db.user.create({
      data: {
        username: code,
        password: 'unused',
        employeeId: employee.id,
        userRoles: { create: { roleId: role.id } },
      },
    });
    if (superAdmin) admin = user.id;
    else if (isWorker) worker = user.id;
    else reviewer = user.id;
  }
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('SQ6 starts a real Lead with selected nodes, no fabricated Case or Contract, and DB rejects mixed sources', async () => {
  const t = await template(),
    l = await lead(),
    svc = await execution();
  await assert.rejects(
    svc.start({
      leadId: l.id,
      templateVersionId: t.versionId,
      batchKey: 'PRIMARY',
      requestKey: randomUUID(),
    }),
    rejects('SOP_NODE_SELECTION_REQUIRED'),
  );
  const input = {
      leadId: l.id,
      templateVersionId: t.versionId,
      nodeCodes: [t.content.nodes[0].code],
      batchKey: 'PRIMARY',
      requestKey: randomUUID(),
    },
    a = await svc.start(input);
  assert.equal((await svc.start(input)).id, a.id);
  assert.equal(await db.case.count(), 0);
  assert.equal(await db.contract.count(), 0);
  const task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: a.id } });
  assert.equal(task.caseId, null);
  assert.equal((await svc.task(task.id)).source?.id, l.id);
  await assert.rejects(
    svc.start({ ...input, nodeCodes: [t.content.nodes[1].code], requestKey: randomUUID() }),
    rejects('SOP_BATCH_CONFLICT'),
  );
  await assert.rejects(db.sopInstance.update({ where: { id: a.id }, data: { leadId: null } }));
  await assert.rejects(db.caseTask.create({ data: { name: '无来源旧任务', nodeType: 'TEST' } }));
  await assert.rejects(
    svc.start({ ...input, caseId: randomUUID(), requestKey: randomUUID() }),
    rejects('SOP_SOURCE_INVALID'),
  );
});

test('SQ6 explicit task access does not grant its pre-case source or files; independent source permission is required', async () => {
  const t = await template('MEDICAL'),
    l = await lead(),
    instance = await start({ leadId: l.id }, t.versionId, [t.content.nodes[0].code]),
    task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: instance.id } });
  await (await execution()).taskAction(task.id, command('ASSIGN', task.version, { assigneeUserId: worker }));
  assert.equal((await (await execution(worker)).task(task.id)).source, null);
  await assert.rejects((await files(worker)).list(task.id));
  const role = await db.role.findUniqueOrThrow({ where: { code: 'WORKER' } });
  await db.rolePermission.create({
    data: {
      roleId: role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'lead.read' } })).id,
    },
  });
  await assert.rejects((await files(worker)).list(task.id), rejects('SOP_SOURCE_NOT_FOUND'));
  await db.lead.update({
    where: { id: l.id },
    data: { assignedTo: (await db.user.findUniqueOrThrow({ where: { id: worker } })).employeeId },
  });
  const file = await (
    await files(worker)
  ).upload(task.id, {
    fileName: '前期资料.txt',
    fileType: 'text/plain',
    base64: Buffer.from('前期独立资料').toString('base64'),
    requestKey: randomUUID(),
  });
  assert.equal((await (await files(worker)).download(task.id, file.id)).fileName, '前期资料.txt');
  await db.userRole.deleteMany({ where: { userId: worker } });
  await assert.rejects((await files(worker)).download(task.id, file.id));
});

test('SQ6 frozen pre-case materials use real SourceFile references and tampering fails original approval sync', async () => {
  const t = await template('MEDICAL', true),
    l = await lead(),
    instance = await start({ leadId: l.id }, t.versionId, [t.content.nodes[0].code]),
    task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: instance.id } }),
    svc = await execution();
  const begun = await svc.taskAction(task.id, command('START', task.version)),
    file = await (
      await files()
    ).upload(task.id, {
      fileName: '原始报告.txt',
      fileType: 'text/plain',
      base64: Buffer.from('未变更材料').toString('base64'),
      requestKey: randomUUID(),
    }),
    sub = await (
      await submissions()
    ).submit(task.id, {
      expectedVersion: begun.version,
      requestKey: randomUUID(),
      report: '前期报告',
      materials: [{ code: 'DOC', fileId: file.id }],
      reviewerUserId: reviewer,
    });
  const attachment = await db.submissionAttachment.findFirstOrThrow({ where: { submissionId: sub.id } });
  assert.equal(attachment.fileId, null);
  assert.equal(attachment.sourceFileId, file.id);
  assert.equal(await db.caseFile.count(), 0);
  await assert.rejects(db.sopSourceFile.delete({ where: { id: file.id } }));
  const stored = await db.sopSourceFile.findUniqueOrThrow({ where: { id: file.id } });
  fs.writeFileSync(path.resolve('var/storage/sop-source-files', stored.filePath), '变更材料');
  await approve(sub.id);
  assert.equal((await svc.task(task.id)).status, 'IN_REVIEW');
  const review = await db.qualityReview.findUniqueOrThrow({ where: { submissionId: sub.id } });
  assert.equal(
    (await db.approvalSyncRecord.findUniqueOrThrow({ where: { instanceId: review.approvalInstanceId! } }))
      .status,
    'FAILED',
  );
});

for (const preset of SOP_PRESETS)
  test(
    'SQ6 ' +
      preset.code +
      ' full chain preserves original conversion, contract and task histories through return and approval',
    async () => {
      await db.professionalTeam.update({ where: { id: team }, data: { categoryCode: preset.code } });
      const t = await template(preset.code),
        l = await lead(),
        svc = await execution(),
        first = await start({ leadId: l.id }, t.versionId, [t.content.nodes[0].code]),
        task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: first.id } });
      let begun = await svc.taskAction(task.id, command('START', task.version)),
        sub = await (
          await submissions()
        ).submit(task.id, {
          expectedVersion: begun.version,
          requestKey: randomUUID(),
          report: '第一版前期报告',
          materials: [],
          reviewerUserId: reviewer,
        });
      const old = await approve(sub.id, true);
      begun = await svc.taskAction(task.id, command('START', (await svc.task(task.id)).version));
      sub = await (
        await submissions()
      ).submit(task.id, {
        expectedVersion: begun.version,
        requestKey: randomUUID(),
        report: '第二版补齐核验依据',
        materials: [],
        reviewerUserId: reviewer,
      });
      await approve(sub.id);
      await assert.rejects(
        new ApprovalInstanceService(db, actor(reviewer), await ctx(reviewer)).processTask(old.id, {
          action: 'APPROVE',
        }),
      );
      const original = await db.caseTask.findUniqueOrThrow({ where: { id: task.id } }),
        b = await business(l.id, preset.name),
        split = preset.code === 'MEDICAL' ? 6 : preset.code === 'EXECUTION' ? 5 : 4,
        mid = await start(
          { analysisEngagementId: b.engagement.id },
          t.versionId,
          t.content.nodes.slice(1, split).map((n) => n.code),
        ),
        last = await start(
          { caseId: b.caseRow.id },
          t.versionId,
          t.content.nodes.slice(split).map((n) => n.code),
        );
      for (const inst of [mid, last]) {
        for (const node of await db.caseTask.findMany({
          where: { sopInstanceId: inst.id },
          orderBy: { nodeCode: 'asc' },
        })) {
          const current = await svc.taskAction(node.id, command('START', node.version));
          await svc.taskAction(node.id, command('COMPLETE', current.version));
        }
        await svc.instanceAction(inst.id, command('COMPLETE', (await svc.instance(inst.id)).version));
      }
      await svc.instanceAction(first.id, command('COMPLETE', (await svc.instance(first.id)).version));
      const continuation = new SopContinuationService(db, actor(admin), await ctx());
      for (const [from, to] of [
        [first, mid],
        [mid, last],
      ]) {
        const input = {
          targetInstanceId: to.id,
          expectedVersion: (await svc.instance(from.id)).version,
          targetVersion: (await svc.instance(to.id)).version,
          reason: '原业务完成后接续',
          requestKey: randomUUID(),
        };
        const link = await continuation.create(from.id, input);
        assert.equal((await continuation.create(from.id, input)).id, link.id);
      }
      assert.equal(await db.sopContinuation.count(), 2);
      assert.equal(await db.caseTask.count(), preset.content.nodes.length);
      assert.equal(await db.case.count(), 1);
      assert.equal(await db.contract.count(), 3);
      assert.deepEqual(await db.caseTask.findUniqueOrThrow({ where: { id: task.id } }), original);
      assert.equal(await db.sopSubmission.count({ where: { taskId: task.id } }), 2);
      assert.equal((await db.lead.findUniqueOrThrow({ where: { id: l.id } })).status, 'CONVERTED');
      assert.equal(await db.collabRecord.count(), 0);
      assert.ok(
        SOP_PRESETS.find((p) => p.code === 'CRIMINAL')!.content.nodes.every((n) =>
          n.materials.every((m) => !m.required),
        ),
      );
    },
  );

test('SQ6 continuation rejects unrelated customers and does not grant earlier materials from a later Case', async () => {
  const t = await template(),
    a = await lead(),
    first = await start({ leadId: a.id }, t.versionId, [t.content.nodes[0].code]),
    task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: first.id } });
  await (await execution()).taskAction(task.id, command('ASSIGN', task.version, { assigneeUserId: worker }));
  const file = await (
      await files()
    ).upload(task.id, {
      fileName: '原线索资料.txt',
      fileType: 'text/plain',
      base64: Buffer.from('仅原来源获权人可读').toString('base64'),
      requestKey: randomUUID(),
    }),
    b = await business(a.id, t.preset.name),
    last = await start(
      { caseId: b.caseRow.id },
      t.versionId,
      t.content.nodes.slice(1).map((n) => n.code),
    ),
    continuation = new SopContinuationService(db, actor(admin), await ctx());
  const input = {
    targetInstanceId: last.id,
    expectedVersion: (await (await execution()).instance(first.id)).version,
    targetVersion: last.version,
    reason: '真实原客户接续',
    requestKey: randomUUID(),
  };
  await continuation.create(first.id, input);
  const role = await db.role.findUniqueOrThrow({ where: { code: 'WORKER' } }),
    all = await db.dataScope.findFirstOrThrow({ where: { scopeType: 'ALL' } });
  await db.rolePermission.create({
    data: {
      roleId: role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'case.read' } })).id,
    },
  });
  await db.roleDataScope.updateMany({
    where: { roleId: role.id, resource: 'case' },
    data: { dataScopeId: all.id },
  });
  assert.equal(
    (await new CaseService(db, actor(worker), await ctx(worker)).getCase(b.caseRow.id)).id,
    b.caseRow.id,
  );
  await assert.rejects((await files(worker)).download(task.id, file.id));
  const unrelated = await lead(),
    other = await start({ leadId: unrelated.id }, t.versionId, [t.content.nodes[0].code]);
  await assert.rejects(
    continuation.create(other.id, {
      ...input,
      expectedVersion: other.version,
      targetVersion: (await (await execution()).instance(last.id)).version,
      requestKey: randomUUID(),
    }),
    rejects('SOP_CONTINUATION_INVALID'),
  );
  assert.equal(await db.sopContinuation.count(), 1);
});

test('SQ6 SourceFile cannot be submitted or attached across source instances', async () => {
  const t = await template('MEDICAL', true),
    a = await lead(),
    b = await lead(),
    one = await start({ leadId: a.id }, t.versionId, [t.content.nodes[0].code]),
    two = await start({ leadId: b.id }, t.versionId, [t.content.nodes[0].code]),
    tasks = await Promise.all(
      [one, two].map((i) => db.caseTask.findFirstOrThrow({ where: { sopInstanceId: i.id } })),
    ),
    svc = await execution();
  const uploads = [];
  for (const task of tasks) {
    uploads.push(
      await (
        await files()
      ).upload(task.id, {
        fileName: '源资料.txt',
        fileType: 'text/plain',
        base64: Buffer.from('来源资料').toString('base64'),
        requestKey: randomUUID(),
      }),
    );
    await svc.taskAction(task.id, command('START', task.version));
  }
  const input = {
    expectedVersion: (await svc.task(tasks[1].id)).version,
    requestKey: randomUUID(),
    report: '来源核验',
    materials: [{ code: 'DOC', fileId: uploads[0].id }],
    reviewerUserId: reviewer,
  };
  await assert.rejects((await submissions()).submit(tasks[1].id, input), rejects('SOP_MATERIAL_NOT_FOUND'));
  const sub = await (
    await submissions()
  ).submit(tasks[0].id, {
    ...input,
    expectedVersion: (await svc.task(tasks[0].id)).version,
    requestKey: randomUUID(),
  });
  await assert.rejects(
    db.submissionAttachment.create({
      data: {
        submissionId: sub.id,
        sourceFileId: uploads[1].id,
        materialCode: 'OTHER',
        sha256: '0'.repeat(64),
        fileSize: 1,
      },
    }),
  );
});

test('SQ6 pre-case reminder uses source state and does not require a fabricated Case', async () => {
  const { SopReminderScanner, SopReminderHandler } = await import('../../app/application/sop/sop-reminder');
  const t = await template(),
    l = await lead(),
    instance = await start({ leadId: l.id }, t.versionId, [t.content.nodes[1].code]),
    task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: instance.id } }),
    svc = await execution();
  await svc.taskAction(task.id, command('ASSIGN', task.version, { assigneeUserId: worker }));
  const current = await db.caseTask.findUniqueOrThrow({ where: { id: task.id } }),
    now = new Date();
  await db.caseTask.update({
    where: { id: task.id },
    data: {
      dueDate: new Date(now.getTime() + 3600000),
      nodeSnapshot: { ...(current.nodeSnapshot as object), reminderDays: 1 },
    },
  });
  await new SopReminderScanner(db).scanOnce(now);
  const emission = await db.sopReminderEmission.findFirstOrThrow({ where: { taskId: task.id } });
  await db.lead.update({ where: { id: l.id }, data: { status: 'LOST' } });
  await db.$transaction((tx) =>
    new SopReminderHandler().handle(tx, {
      eventId: randomUUID(),
      deliveryId: randomUUID(),
      handlerCode: 'SOP_REMINDER_NOTIFICATION',
      orderingKey: emission.id,
      eventType: 'sop.reminder.due',
      eventVersion: 1,
      payload: { id: emission.id },
      traceId: emission.id,
      attemptNumber: 1,
      workerId: 'test',
    }),
  );
  assert.equal(await db.notification.count(), 0);
  await assert.rejects(
    svc.taskAction(task.id, command('START', (await svc.task(task.id)).version)),
    rejects('SOP_STATE_INVALID'),
  );
});


test('SQ6 selected nodes include dependency closure and freeze the published graph', async () => {
  const t=await template('MEDICAL',false,true), l=await lead();
  await assert.rejects(start({leadId:l.id},t.versionId,[t.content.nodes[1].code]),rejects('SOP_NODE_SELECTION_INVALID'));
  assert.equal(await db.sopInstance.count(),0);
  const row=await start({leadId:l.id},t.versionId,t.content.nodes.slice(0,2).map(n=>n.code));
  const tasks=await db.caseTask.findMany({where:{sopInstanceId:row.id}});
  assert.equal(tasks.length,2);
  assert.deepEqual((tasks.find(tk=>tk.nodeCode===t.content.nodes[1].code)!.nodeSnapshot as {dependsOn:string[]}).dependsOn,[t.content.nodes[0].code]);
});

test('SQ6 concurrent continuation is unique, preserves task truth and rechecks revoked authority on replay', async () => {
  const t=await template(), l=await lead(), first=await start({leadId:l.id},t.versionId,[t.content.nodes[0].code]), b=await business(l.id,t.preset.name), next=await start({analysisEngagementId:b.engagement.id},t.versionId,[t.content.nodes[1].code]);
  const service=new SopContinuationService(db,actor(admin),await ctx()), original=await db.caseTask.findMany({orderBy:{id:'asc'}}), input={targetInstanceId:next.id,expectedVersion:first.version,targetVersion:next.version,reason:'真实前后关联',requestKey:randomUUID()};
  await assert.rejects(service.create(first.id,{...input,targetVersion:99}),rejects('SOP_VERSION_CONFLICT'));
  const results=await Promise.all([service.create(first.id,input),service.create(first.id,{...input,requestKey:randomUUID()})]);
  assert.equal(results[0].id,results[1].id);assert.equal(await db.sopContinuation.count(),1);
  assert.deepEqual(await db.caseTask.findMany({orderBy:{id:'asc'}}),original);
  await db.userRole.deleteMany({where:{userId:admin}});
  await assert.rejects(service.create(first.id,input));
  assert.equal(await db.sopContinuation.count(),1);
});

test('SQ6 task and instance idempotency replays reload authority inside the transaction', async () => {
  const t = await template(), l = await lead(), instance = await start({ leadId: l.id }, t.versionId, [t.content.nodes[1].code]);
  const svc = await execution(), task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: instance.id } });
  const taskInput = command('START', task.version);
  await svc.taskAction(task.id, taskInput);
  const instanceInput = command('PAUSE', (await svc.instance(instance.id)).version);
  await svc.instanceAction(instance.id, instanceInput);
  await db.userRole.deleteMany({ where: { userId: admin } });
  await assert.rejects(svc.taskAction(task.id, taskInput));
  await assert.rejects(svc.instanceAction(instance.id, instanceInput));
  assert.equal((await db.caseTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'IN_PROGRESS');
  assert.equal((await db.sopInstance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'PAUSED');
});
