import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { QualityService } from '../../app/application/quality/quality-service';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { qualityMonth, sampleIds } from '../../app/domain/quality/quality-policy';
import { CaseFileService } from '../../app/application/case/case-file-service';
let db: PrismaClient, admin: string, staff: string, org: string, caseId: string, svc: QualityService;
const checks = [{ code: 'REPORT', name: '报告及材料核验' }];
const reject = (code: string) => (e: unknown) => (e as { code: string }).code === code;
async function service(id: string) {
  return new QualityService(db, { actorUserId: id }, await new AuthorizationContextLoader(db).load(id));
}
async function policy(amount = 1) {
  return svc.createPolicy({
    code: 'MEDICAL',
    name: '医疗交付抽检',
    organizationId: org,
    mode: 'COUNT',
    amount,
    stratified: false,
    checklist: checks,
    requestKey: randomUUID(),
  });
}
async function run(amount = 1) {
  const p = await policy(amount);
  return svc.createRun({ policyId: p.id, month: '2026-08', requestKey: randomUUID() });
}
async function failInspection() {
  const r = await run(),
    item = await db.qualitySamplingItem.findFirstOrThrow({ where: { runId: r.id } });
  await svc.inspect(item.id, {
    expectedVersion: 1,
    requestKey: randomUUID(),
    checklist: checks.map((c) => ({ ...c, result: 'FAIL', reason: '缺少材料来源说明' })),
  });
  return db.qualityIssue.findFirstOrThrow({ where: { inspectionId: item.id } });
}
const action = (action: string, version: number, extra: Record<string, unknown> = {}) => ({
  action,
  expectedVersion: version,
  requestKey: randomUUID(),
  ...extra,
});
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = randomUUID();
  await db.organization.create({
    data: { id: org, code: 'QC_ORG', name: '抽检组织', type: 'FIRM', path: '/' + org },
  });
  const role = await db.role.create({
    data: { code: 'SYSTEM_SUPER_ADMIN', name: '测试管理员', type: 'SYSTEM' },
  });
  const user = await db.user.create({
    data: { username: 'qc-admin', password: 'unused', userRoles: { create: { roleId: role.id } } },
  });
  admin = user.id;
  const employee = await db.employee.create({
    data: {
      employeeNo: 'QC_EMP',
      name: '整改员',
      phone: '13800000000',
      type: 'ASSISTANT',
      entryDate: new Date(),
    },
  });
  const all = await db.dataScope.create({ data: { name: '获权范围', scopeType: 'ALL' } });
  const employeeRole = await db.role.create({ data: { code: 'QC_EMP', name: '整改岗位', type: 'BUSINESS' } });
  for (const code of [
    'case.read',
    'case.file.read',
    'quality.issue.read',
    'quality.issue.resolve',
    'quality.issue.verify',
  ])
    await db.rolePermission.create({
      data: {
        roleId: employeeRole.id,
        permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id,
      },
    });
  await db.roleDataScope.create({ data: { roleId: employeeRole.id, resource: 'case', dataScopeId: all.id } });
  staff = (
    await db.user.create({
      data: {
        username: 'qc-staff',
        password: 'unused',
        employeeId: employee.id,
        userRoles: { create: { roleId: employeeRole.id } },
      },
    })
  ).id;
  const customer = await db.customer.create({
    data: {
      customerNo: 'QC_CUSTOMER',
      name: '测试客户',
      phone: '13800000000',
      phoneHash: 'test',
      createdBy: admin,
    },
  });
  caseId = (
    await db.case.create({
      data: {
        caseNo: 'QC_CASE',
        title: '已结案真实记录',
        customerId: customer.id,
        caseType: '医疗纠纷',
        status: 'CLOSED',
        closedAt: new Date('2026-08-31T15:59:59Z'),
        branchId: org,
        createdBy: admin,
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
test('SQ4 Shanghai month and seeded samples are reproducible without replacement', () => {
  const m = qualityMonth(undefined, new Date('2026-09-01T00:00:00Z'));
  assert.equal(m.month, '2026-08');
  assert.equal(m.start.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(m.end.toISOString(), '2026-08-31T16:00:00.000Z');
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), stratum: String(i % 2) }));
  const a = sampleIds(rows, 'seed', 'COUNT', 2, true);
  assert.equal(a.length, 4);
  assert.equal(new Set(a).size, 4);
  assert.deepEqual(a, sampleIds([...rows].reverse(), 'seed', 'COUNT', 2, true));
});
test('SQ4 unique concurrent batch, immutable policy versions, shortages, zero candidates and reasoned supplement', async () => {
  const p = await policy(5);
  const request = { policyId: p.id, month: '2026-08', requestKey: randomUUID() };
  const [a, b] = await Promise.all([
    svc.createRun(request),
    svc.createRun({ ...request, requestKey: randomUUID() }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await db.qualitySamplingItem.count({ where: { runId: a.id } }), 1);
  const snapshot = await db.qualitySamplingRun.findUniqueOrThrow({ where: { id: a.id } });
  assert.deepEqual(
    (await svc.run(a.id)).items.map((i) => i.caseId),
    sampleIds(
      snapshot.candidateSnapshot as { id: string; stratum: string }[],
      snapshot.seed,
      'COUNT',
      5,
      false,
    ),
  );
  await assert.rejects(
    svc.createRun({ ...request, batchKey: 'EXTRA', requestKey: randomUUID() }),
    reject('QUALITY_REASON_REQUIRED'),
  );
  const extra = await svc.createRun({
    ...request,
    batchKey: 'EXTRA',
    reason: '复核补抽',
    requestKey: randomUUID(),
  });
  assert.equal(await db.qualitySamplingItem.count({ where: { runId: extra.id } }), 0);
  const zero = await svc.createRun({ ...request, month: '2026-07', requestKey: randomUUID() });
  assert.equal((await svc.run(zero.id)).candidates.length, 0);
  assert.equal((await policy(2)).number, 2);
  assert.equal((await db.qualitySamplingPolicy.findUniqueOrThrow({ where: { id: p.id } })).amount, 5);
});
test('SQ4 failure creates issue, return and resubmit preserve revisions and never change closed case', async () => {
  const before = await db.case.findUniqueOrThrow({ where: { id: caseId } }),
    issue = await failInspection();
  await svc.act(issue.id, action('ASSIGN', 1, { assigneeUserId: staff, dueAt: '2026-10-01T00:00:00Z' }));
  const worker = await service(staff);
  await worker.act(issue.id, action('START', 2));
  await worker.act(issue.id, action('SUBMIT', 3, { content: '补齐来源依据' }));
  await assert.rejects(
    worker.act(issue.id, action('VERIFY', 4, { content: '自行复核' })),
    reject('QUALITY_SELF_REVIEW'),
  );
  await svc.act(issue.id, action('RETURN', 4, { content: '仍需完整说明' }));
  await worker.act(issue.id, action('SUBMIT', 5, { content: '完整修订依据' }));
  const final = action('VERIFY', 6, { content: '已核验补正材料' });
  await svc.act(issue.id, final);
  await svc.act(issue.id, final);
  const result = await svc.issue(issue.id);
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.revisions.length, 6);
  assert.deepEqual(await db.case.findUniqueOrThrow({ where: { id: caseId } }), before);
});
test('SQ4 scope contraction and employee departure prevent stale-context writes', async () => {
  const issue = await failInspection();
  await svc.act(issue.id, action('ASSIGN', 1, { assigneeUserId: staff, dueAt: '2026-10-01T00:00:00Z' }));
  const worker = await service(staff),
    user = await db.user.findUniqueOrThrow({ where: { id: staff } });
  await db.employee.update({ where: { id: user.employeeId! }, data: { status: 'LEAVED' } });
  await assert.rejects(worker.act(issue.id, action('START', 2)), reject('QUALITY_ACTOR_INACTIVE'));
  assert.equal((await db.qualityIssue.findUniqueOrThrow({ where: { id: issue.id } })).status, 'OPEN');
});
test('SQ4 SELF excludes other creators in direct issue and sample visibility', async () => {
  const issue = await failInspection();
  const role = await db.role.findUniqueOrThrow({ where: { code: 'QC_EMP' } }),
    self = await db.dataScope.create({ data: { name: '本人', scopeType: 'SELF' } });
  await db.roleDataScope.updateMany({ where: { roleId: role.id }, data: { dataScopeId: self.id } });
  const worker = await service(staff);
  assert.equal((await worker.issues()).total, 0);
  await assert.rejects(worker.issue(issue.id), reject('QUALITY_NOT_FOUND'));
});
test('SQ4 primary lawyer cannot inspect own closed case and inspection result is immutable', async () => {
  const r = await run(),
    item = await db.qualitySamplingItem.findFirstOrThrow({ where: { runId: r.id } }),
    employee = (await db.user.findUniqueOrThrow({ where: { id: staff } })).employeeId;
  await db.user.update({ where: { id: staff }, data: { employeeId: null } });
  await db.user.update({ where: { id: admin }, data: { employeeId: employee } });
  await db.case.update({ where: { id: caseId }, data: { lawyerId: employee } });
  await assert.rejects(
    svc.inspect(item.id, {
      expectedVersion: 1,
      requestKey: randomUUID(),
      checklist: checks.map((c) => ({ ...c, result: 'PASS' })),
    }),
    reject('QUALITY_SELF_REVIEW'),
  );
  await db.case.update({ where: { id: caseId }, data: { lawyerId: null } });
  await svc.inspect(item.id, {
    expectedVersion: 1,
    requestKey: randomUUID(),
    checklist: checks.map((c) => ({ ...c, result: 'PASS' })),
  });
  await assert.rejects(
    svc.inspect(item.id, {
      expectedVersion: 2,
      requestKey: randomUUID(),
      checklist: checks.map((c) => ({ ...c, result: 'FAIL', reason: '改写' })),
    }),
    reject('QUALITY_STATE_INVALID'),
  );
});
test('SQ4 referenced remediation files cannot be deleted or replaced before verification', async () => {
  const issue = await failInspection();
  await svc.act(issue.id, action('ASSIGN', 1, { assigneeUserId: staff, dueAt: '2026-10-01T00:00:00Z' }));
  const ctx = await new AuthorizationContextLoader(db).load(admin),
    files = new CaseFileService(db, { actorUserId: admin }, ctx);
  // Closed cases intentionally reject ordinary uploads; use an earlier real stored version as fixture.
  await db.case.update({ where: { id: caseId }, data: { status: 'PROCESSING' } });
  const file = await files.upload(caseId, {
    fileName: '整改依据.txt',
    fileType: 'text/plain',
    base64: Buffer.from('历史材料').toString('base64'),
  });
  await db.case.update({ where: { id: caseId }, data: { status: 'CLOSED' } });
  const worker = await service(staff);
  await worker.act(issue.id, action('START', 2));
  await worker.act(issue.id, action('SUBMIT', 3, { content: '引用核验材料', fileIds: [file.id] }));
  const old = await db.caseFile.findUniqueOrThrow({ where: { id: file.id } });
  await db.caseFile.update({ where: { id: file.id }, data: { fileSize: old.fileSize + 1 } });
  await assert.rejects(
    svc.act(issue.id, action('VERIFY', 4, { content: '核验' })),
    reject('SOP_MATERIAL_CHANGED'),
  );
  await db.caseFile.update({ where: { id: file.id }, data: { fileSize: old.fileSize } });
  await svc.act(issue.id, action('VERIFY', 4, { content: '核验通过' }));
  assert.equal((await svc.download(issue.id, file.id)).fileName, '整改依据.txt');
});

test('SQ4 new remediation uploads require independent file permission and preserve closed case on retry', async () => {
  const before = await db.case.findUniqueOrThrow({ where: { id: caseId } }),
    issue = await failInspection();
  await svc.act(issue.id, action('ASSIGN', 1, { assigneeUserId: staff, dueAt: '2026-10-01T00:00:00Z' }));
  let worker = await service(staff);
  await worker.act(issue.id, action('START', 2));
  const input = action('SUBMIT', 3, {
    content: '新增整改证据',
    uploads: [
      {
        fileName: '整改新证据.txt',
        fileType: 'text/plain',
        base64: Buffer.from('整改证据').toString('base64'),
      },
    ],
  });
  await assert.rejects(worker.act(issue.id, input), reject('PERMISSION_DENIED'));
  assert.equal(await db.issueAttachment.count(), 0);
  assert.equal((await svc.issue(issue.id)).status, 'IN_PROGRESS');
  const role = await db.role.findUniqueOrThrow({ where: { code: 'QC_EMP' } });
  await db.rolePermission.create({
    data: {
      roleId: role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'case.file.manage' } })).id,
    },
  });
  worker = await service(staff);
  await worker.act(issue.id, input);
  await worker.act(issue.id, input);
  assert.equal(await db.issueAttachment.count(), 1);
  assert.equal(await db.caseFile.count(), 1);
  assert.deepEqual(await db.case.findUniqueOrThrow({ where: { id: caseId } }), before);
  await svc.act(issue.id, action('VERIFY', 4, { content: '核验新增材料' }));
});
test('SQ4 inspection conflicts and revoked record permission never duplicate issues', async () => {
  const r = await run(),
    item = await db.qualitySamplingItem.findFirstOrThrow({ where: { runId: r.id } }),
    input = {
      expectedVersion: 1,
      requestKey: randomUUID(),
      checklist: checks.map((c) => ({ ...c, result: 'FAIL', reason: '核验缺口' })),
    };
  const results = await Promise.allSettled([
    svc.inspect(item.id, input),
    svc.inspect(item.id, { ...input, requestKey: randomUUID() }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.qualityIssue.count(), 1);
  await db.userRole.deleteMany({ where: { userId: admin } });
  await assert.rejects(svc.inspect(item.id, input));
  assert.equal(await db.qualityIssue.count(), 1);
});

test('SQ5 closed-case remediation notifications remain actionable and skip stale or revoked recipients',async()=>{
 const {QualityChangeNotification}=await import('../../app/application/sop/change-notification');const issue=await failInspection();await svc.act(issue.id,action('ASSIGN',1,{assigneeUserId:staff,dueAt:'2026-10-01T00:00:00Z'}));const row=await db.qualityIssue.findUniqueOrThrow({where:{id:issue.id}});
 const deliver=(version:number)=>db.$transaction(tx=>new QualityChangeNotification().handle(tx,{eventId:randomUUID(),deliveryId:randomUUID(),handlerCode:'QUALITY_CHANGE_NOTIFICATION',orderingKey:row.id,eventType:'quality.changed',eventVersion:1,payload:{id:row.id,type:'QUALITY_ISSUE',action:'ASSIGN',version},traceId:row.id,attemptNumber:1,workerId:'test'}));await deliver(row.version-1);assert.equal(await db.notification.count(),0);await deliver(row.version);await deliver(row.version);assert.equal(await db.notification.count({where:{userId:staff}}),1);assert.equal((await db.notification.findFirstOrThrow()).routeUrl,'/quality/issues/'+row.id);await db.notification.deleteMany();await db.userRole.deleteMany({where:{userId:staff}});await deliver(row.version);assert.equal(await db.notification.count(),0);
});
