import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseService } from '../../app/application/case/case-service';
import { CaseFileService } from '../../app/application/case/case-file-service';
import { CaseTaskService } from '../../app/application/case/case-task-service';
import { CaseCommunicationService } from '../../app/application/case/case-communication-service';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';

const db = createTestPrisma();
let staff: AuthorizationContext, manager: AuthorizationContext, org: string, customerId: string;
const files: string[] = [];
const permissions: AuthorizationContext['permissionCodes'] = [
  'case.read',
  'case.create',
  'case.update',
  'case.close',
  'case.delete',
  'case.file.read',
  'case.file.manage',
  'case.task.manage',
  'case.communication.create',
  'customer.read',
  'user.read',
  'organization.read',
];
const context = async (scopeId: string): Promise<AuthorizationContext> => {
  const employee = await db.employee.create({
    data: {
      employeeNo: key(),
      name: '案件成员',
      phone: key(),
      type: 'LAWYER',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
  const user = await db.user.create({
    data: { username: key(), password: 'fixture', employeeId: employee.id },
  });
  return {
    userId: user.id,
    employeeId: employee.id,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: permissions,
    fieldRules: [],
    grants: permissions.map((permissionCode) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      sourceRoleId: 'fixture',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: [permissionCode === 'customer.read' ? 'ALL' : scopeId],
      validUntil: null,
    })),
  };
};
const services = (actor: AuthorizationContext) => ({
  cases: new CaseService(db, { actorUserId: actor.userId }, actor),
  files: new CaseFileService(db, { actorUserId: actor.userId }, actor),
  tasks: new CaseTaskService(db, { actorUserId: actor.userId }, actor),
  communications: new CaseCommunicationService(db, { actorUserId: actor.userId }, actor),
});
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const seed = (creator: string | null, lawyerId = staff.employeeId) =>
  db.case.create({
    data: {
      caseNo: key(),
      title: '权限案件',
      customerId,
      caseType: '民事',
      lawyerId,
      createdBy: creator,
      branchId: org,
    },
  });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: key(), name: '案件组织', type: 'FIRM', path: '/' + org },
  });
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  staff = await context(self.id);
  manager = await context('ALL');
  customerId = (
    await db.customer.create({
      data: { customerNo: key(), name: '授权客户', phone: key(), phoneHash: key(), createdBy: staff.userId },
    })
  ).id;
});
test.afterEach(() => {
  for (const file of files.splice(0)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already removed */
    }
  }
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('creator SELF applies to list, detail, task, communication and file links; an assigned lawyer gains no creator access', async () => {
  const own = await seed(staff.userId),
    other = await seed(manager.userId),
    unknown = await seed(null);
  const user = services(staff),
    all = services(manager);
  assert.deepEqual(
    (await user.cases.listCases({})).list.map((row) => row.id),
    [own.id],
  );
  assert.equal((await all.cases.listCases({})).total, 3);
  await assert.rejects(user.cases.getCase(other.id), code('CASE_NOT_FOUND'));
  await assert.rejects(user.cases.getCase(unknown.id), code('CASE_NOT_FOUND'));
  await assert.rejects(
    user.cases.updateCase(other.id, { title: 'forbidden', version: 1 }),
    code('CASE_NOT_FOUND'),
  );
  await assert.rejects(
    user.tasks.createTask(other.id, { name: '任务', nodeType: '材料收集' }),
    code('CASE_NOT_FOUND'),
  );
  await assert.rejects(
    user.communications.createCommunication(other.id, { type: 'PHONE', content: '沟通' }),
    code('CASE_NOT_FOUND'),
  );
  const file = await all.files.upload(other.id, {
    fileName: 'fixture.txt',
    fileType: 'text/plain',
    base64: Buffer.from('scoped fixture').toString('base64'),
  });
  files.push(
    path.join(
      process.cwd(),
      'var/storage/case-files',
      (await db.caseFile.findUniqueOrThrow({ where: { id: file.id } })).filePath,
    ),
  );
  await assert.rejects(user.files.list(other.id, {}), code('CASE_NOT_FOUND'));
  await assert.rejects(user.files.download(file.id), code('CASE_NOT_FOUND'));
  await assert.rejects(user.files.remove(file.id), code('CASE_NOT_FOUND'));
  assert.equal((await all.files.download(file.id)).base64, Buffer.from('scoped fixture').toString('base64'));
  const narrowerFiles = {
    ...manager,
    grants: manager.grants.map((grant) =>
      grant.permissionCode === 'case.file.read' ? { ...grant, scopeIds: [] } : grant,
    ),
  };
  assert.equal((await services(narrowerFiles).cases.getCase(other.id)).files, undefined);
  const narrowerWrites = {
    ...manager,
    grants: manager.grants.map((grant) =>
      grant.permissionCode === 'case.file.manage' ? { ...grant, scopeIds: [] } : grant,
    ),
  };
  await assert.rejects(
    services(narrowerWrites).cases.updateCase(other.id, {
      version: (await all.cases.getCase(other.id)).version,
      removeAttachmentIds: [file.id],
    }),
    code('CASE_NOT_FOUND'),
  );
  assert.ok(await db.caseFile.findUnique({ where: { id: file.id } }));
});

test('creation records the true actor, controlled transitions reject stale versions and closed case child writes', async () => {
  const user = services(staff);
  const created = await user.cases.createCase({
    title: '员工录入',
    customerId,
    branchId: org,
    lawyerId: manager.employeeId!,
    caseType: '民事',
  });
  assert.equal(created.createdBy, staff.userId);
  assert.equal(created.branchId, org);
  await assert.rejects(user.cases.transitionCase(created.id, { status: 'ACCEPTED', version: 1 }), /登记/);
  // The registration integration suite covers the real approval; this test exercises later transitions.
  await db.caseRegistration.create({ data: { caseId: created.id, tableId: key(), caseVersion: 1, recordVersion: 1, submittedBy: staff.userId, reviewerId: manager.userId, status: 'APPROVED' } });
  await user.cases.transitionCase(created.id, { status: 'ACCEPTED', version: 1 });
  await assert.rejects(
    user.cases.transitionCase(created.id, { status: 'PROCESSING', version: 1 }),
    code('VERSION_CONFLICT'),
  );
  const processing = await user.cases.transitionCase(created.id, { status: 'PROCESSING', version: 2 });
  assert.equal(processing.status, 'PROCESSING');
  const task = await user.tasks.createTask(created.id, { name: '核对材料', nodeType: '材料收集' });
  const results = await Promise.allSettled([
    user.tasks.updateTask(created.id, task.id, { status: 'IN_PROGRESS' }),
    user.tasks.updateTask(created.id, task.id, { status: 'IN_PROGRESS' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const closed = await user.cases.closeCase(created.id, { result: '完成' });
  const archived = await user.cases.transitionCase(created.id, {
    status: 'ARCHIVED',
    version: closed.version,
  });
  assert.equal(archived.status, 'ARCHIVED');
  await assert.rejects(
    user.tasks.updateTask(created.id, task.id, { status: 'COMPLETED' }),
    code('CASE_STATE_INVALID'),
  );
});

test('CASES shares canonical records and extension versions while enforcing workspace creator scope', async () => {
  const workspace = await db.collabWorkspace.create({
    data: {
      name: '案件协作',
      organizationId: org,
      ownerId: manager.userId,
      members: {
        create: [
          { principalId: manager.userId, role: 'OWNER', canCreate: true },
          { principalId: staff.userId, role: 'EDITOR', rowScope: 'SELF' },
        ],
      },
    },
  });
  const owner = new CollaborationService(db, manager),
    member = new CollaborationService(db, staff);
  const base = await owner.createBase(workspace.id, { name: '交付' }, key());
  const table = await owner.createTable(base.id, { name: '案件', source: 'CASES' }, key());
  const row = await seed(staff.userId);
  await db.case.update({
    where: { id: row.id },
    data: { intakeData: { region: '案件地区', firstPaymentAmount: '1234.56' } },
  });
  await seed(manager.userId);
  await seed(null);
  assert.equal((await owner.query(table.id, {})).total, 3);
  assert.deepEqual(
    (await member.query(table.id, {})).records.map((record) => record.id),
    [row.id],
  );
  const field = await owner.saveField(
    table.id,
    undefined,
    { name: '交付备注', type: 'TEXT', version: 1 },
    key(),
  );
  const detail = await member.describe(table.id);
  const intakeField = detail.fields.find(
    (item) => (item.options as { businessKey?: string }).businessKey === 'intake.region',
  )!;
  assert.equal((await member.record(table.id, row.id)).record.values[intakeField.id], '案件地区');
  await member.saveRecord(
    table.id,
    row.id,
    { schemaVersion: detail.table.schemaVersion, version: row.version, values: { [field.id]: '协作信息' } },
    key(),
  );
  assert.equal((await owner.record(table.id, row.id)).record.values[field.id], '协作信息');
  assert.equal(await db.collabRecord.count({ where: { tableId: table.id } }), 0);
});

test('the case worksheet reads assigned cases by employee ID and follows reassignment immediately', async () => {
  const workspace = await db.collabWorkspace.create({ data: {
    name: '案件管理', organizationId: org, ownerId: manager.userId,
    members: { create: [
      { principalId: manager.userId, role: 'OWNER', canCreate: true },
      { principalId: staff.userId, role: 'READER', rowScope: 'ALL' },
    ] },
  } });
  const owner = new CollaborationService(db, manager);
  const member = new CollaborationService(db, staff);
  const base = await owner.createBase(workspace.id, { name: '总表' }, key());
  const table = await owner.createTable(base.id, { name: '案件管理表', source: 'CASES' }, key());
  const assigned = await seed(manager.userId);
  const unrelated = await seed(manager.userId, manager.employeeId);
  assert.deepEqual((await member.query(table.id, {})).records.map(r => r.id), [assigned.id]);
  assert.equal((await member.record(table.id, assigned.id)).record.id, assigned.id);
  await assert.rejects(member.record(table.id, unrelated.id));
  await assert.rejects(services(staff).cases.getCase(assigned.id), code('CASE_NOT_FOUND'));
  await assert.rejects(member.saveRecord(table.id, assigned.id, { values: {}, version: 1 }, key()));
  await db.case.update({ where: { id: assigned.id }, data: { lawyerId: manager.employeeId } });
  assert.equal((await member.query(table.id, {})).total, 0);
});

test('explicit audited identity repair makes unknown cases addressable without granting ordinary users repair authority', async () => {
  const row = await seed(null);
  await db.case.update({ where: { id: row.id }, data: { branchId: null } });
  assert.equal((await services(staff).cases.identityGaps({})).total, 0);
  const queue = await services(manager).cases.identityGaps({});
  assert.equal(queue.total, 1);
  assert.equal(queue.canRepair, true);
  const values = {
    createdBy: staff.userId,
    branchId: org,
    reason: '核对原建档审计与组织资料',
    version: row.version,
  };
  await assert.rejects(services(staff).cases.repairIdentity(row.id, values), code('PERMISSION_DENIED'));
  await services(manager).cases.repairIdentity(row.id, values);
  assert.equal((await services(staff).cases.getCase(row.id)).createdBy, staff.userId);
  await assert.rejects(services(manager).cases.repairIdentity(row.id, values), code('VERSION_CONFLICT'));
  await assert.rejects(
    services(manager).cases.repairIdentity(row.id, { ...values, version: row.version + 1 }),
    code('VALIDATION_FAILED'),
  );
  assert.equal((await services(manager).cases.identityGaps({})).total, 0);
  const audit = await db.operationLog.findFirstOrThrow({
    where: { targetId: row.id, action: 'CASE_IDENTITY_REPAIR' },
  });
  assert.equal(JSON.parse(audit.newValues!).reason, values.reason);
});

test('case identity repair requires independent directory grants and filters candidate scopes', async () => {
  const row = await seed(null);
  const values = { createdBy: staff.userId, reason: '核对原登记资料', version: row.version };
  const denied = {
    ...manager,
    permissionCodes: manager.permissionCodes.filter((code) => code !== 'user.read'),
  };
  const queue = await services(denied).cases.identityGaps({});
  assert.equal(queue.canRepair, false);
  assert.deepEqual(queue.users, []);
  assert.deepEqual(queue.organizations, []);
  await assert.rejects(services(denied).cases.repairIdentity(row.id, values), code('PERMISSION_DENIED'));
  const self = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const restricted = {
    ...manager,
    grants: manager.grants.map((grant) =>
      grant.resource === 'user' ? { ...grant, scopeIds: [self.id] } : grant,
    ),
  };
  const choices = await services(restricted).cases.identityGaps({});
  assert.equal(
    choices.users.some((user) => user.id === staff.userId),
    false,
  );
  assert.equal(
    choices.users.some((user) => user.id === manager.userId),
    true,
  );
  await assert.rejects(services(restricted).cases.repairIdentity(row.id, values), code('VALIDATION_FAILED'));
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: row.id } })).createdBy, null);
  assert.equal(
    await db.operationLog.count({ where: { targetId: row.id, action: 'CASE_IDENTITY_REPAIR' } }),
    0,
  );
});

test('worksheet editor can edit assigned lead cases without widening global case or delete access', async () => {
  const workspace = await db.collabWorkspace.create({ data: {
    name: '案件编辑回归', organizationId: org, ownerId: manager.userId,
    members: { create: [{ principalId: manager.userId, role: 'OWNER', canCreate: true }] },
  } });
  const owner = new CollaborationService(db, manager);
  const base = await owner.createBase(workspace.id, { name: '总表' }, key());
  const table = await owner.createTable(base.id, { name: '案件管理表', source: 'CASES' }, key());
  const { worksheetContext } = await import('../../app/application/collaboration/worksheet-business-grants');
  const { defaultRule } = await import('../../app/application/collaboration/worksheet-roles');
  const rule = {...defaultRule('EDITOR'), rows:'ALL', business:{permissions:['case.read','case.create','case.update'],scopeIds:['worksheet:self']}};
  await db.worksheetRolePolicy.create({data:{tableId:table.id,rules:{EDITOR:rule},invitations:{[staff.userId]:'EDITOR'}}});
  const raw = {...staff,permissionCodes:staff.permissionCodes.filter(p=>!['case.create','case.update','case.delete'].includes(p)),
    grants:staff.grants.filter(g=>!['case.create','case.update','case.delete'].includes(g.permissionCode))};
  const scoped = await worksheetContext(db,raw,table.id);
  const member = new CollaborationService(db,scoped);
  const assigned = await seed(manager.userId);
  const unrelated = await seed(manager.userId,manager.employeeId);
  const detail = await member.describe(table.id);
  const type = detail.fields.find(f=>(f.options as {businessKey?:string}).businessKey==='caseType')!;
  assert.equal(type.writable,true);
  assert.equal(detail.access.add,true);
  assert.equal((await member.query(table.id,{})).records.find(r=>r.id===assigned.id)?.writable,true);
  await member.saveRecord(table.id,assigned.id,{schemaVersion:detail.table.schemaVersion,version:1,values:{[type.id]:'劳动争议'}},key());
  assert.equal((await db.case.findUniqueOrThrow({where:{id:assigned.id}})).caseType,'劳动争议');
  await assert.rejects(member.saveRecord(table.id,unrelated.id,{schemaVersion:detail.table.schemaVersion,version:1,values:{[type.id]:'无权修改'}},key()));
  await assert.rejects(member.saveRecord(table.id,assigned.id,{schemaVersion:detail.table.schemaVersion,version:2,archived:true},key()));
  await assert.rejects(services(raw).cases.updateCase(assigned.id,{version:2,caseType:'无权修改'}));
  const {default: middleware} = await import('../../app/middleware/worksheetAuthorization');
  const ctx = {method:'POST',path:'/api/v1/cases',prisma:db,state:{authorization:raw},request:{body:{worksheetId:table.id}}};
  await middleware()(ctx as never,async()=>undefined);
  assert.equal(ctx.state.authorization.permissionCodes.includes('case.create'),true);
  const created = await services(ctx.state.authorization).cases.createCase({worksheetId:table.id,
    customerId,branchId:org,lawyerId:staff.employeeId!,caseType:'民事'});
  assert.equal(created.createdBy,staff.userId);
  const globalCtx = {...ctx,path:'/api/v1/cases/existing',state:{authorization:raw}};
  await middleware()(globalCtx as never,async()=>undefined);
  assert.equal(globalCtx.state.authorization.permissionCodes.includes('case.create'),false);
  await assert.rejects(middleware()({...ctx,path:'/api/v1/cases/conflict-screen',state:{authorization:raw},
    request:{body:{worksheetId:table.id,id:unrelated.id}}} as never,async()=>undefined));
  await db.worksheetRolePolicy.update({where:{tableId:table.id},data:{rules:{EDITOR:{...defaultRule('READER'),business:{permissions:['case.read'],scopeIds:['worksheet:self']}}}}});
  await assert.rejects(middleware()({...ctx,state:{authorization:raw}} as never,async()=>undefined));
  const revoked = new CollaborationService(db,await worksheetContext(db,raw,table.id));
  assert.equal((await revoked.query(table.id,{})).records[0].writable,false);
  await assert.rejects(revoked.saveRecord(table.id,assigned.id,{schemaVersion:detail.table.schemaVersion,version:2,values:{[type.id]:'撤销后不可编辑'}},key()));
});
