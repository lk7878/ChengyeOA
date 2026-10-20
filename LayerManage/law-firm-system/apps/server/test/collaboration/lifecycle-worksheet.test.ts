import { standardizeCaseWorksheets } from '../../scripts/maintenance/standardize-case-worksheets';
import { ContractService } from '../../app/application/contract/contract-service';
import { CaseService } from '../../app/application/case/case-service';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, svc: CollaborationService, base: string, org: string, user: string, employee: string;
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: org, name: '表格测试', type: 'FIRM', path: '/' + org },
  });
  employee = (
    await db.employee.create({
      data: {
        employeeNo: key(),
        name: '测试员工',
        phone: '13800000000',
        type: 'LAWYER',
        status: 'FORMAL',
        entryDate: new Date('2020-01-01'),
      },
    })
  ).id;
  const position = await db.position.create({
    data: { code: key(), name: '律师', organizationId: org, categoryCode: 'LAWYER' },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: employee,
      organizationId: org,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  user = (await db.user.create({ data: { username: key(), password: 'unused', employeeId: employee } })).id;
  ctx = {
    userId: user,
    employeeId: employee,
    isSystemSuperAdmin: true,
    isSystemAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map((p) => p.code),
    grants: PERMISSION_CATALOG.map((p) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      permissionCode: p.code,
      resource: p.resource,
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
  };
  svc = new CollaborationService(db, ctx);
  const workspace = await svc.createWorkspace({ name: '工作区', organizationId: org }, key());
  base = (await svc.createBase(workspace.id, { name: '业务表格' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
async function setup() {
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '客户甲', phone: '13800000001', phoneHash: key(), createdBy: user },
  });
  const contract = await db.contract.create({
    data: {
      contractNo: key(),
      contractType: 'FORMAL',
      title: '委托',
      customerId: customer.id,
      amount: '1200',
      createdBy: user,
      branchId: org,
      status: 'EFFECTIVE',
    },
  });
  const row = await db.case.create({
    data: {
      caseNo: key(),
      title: '案件甲',
      caseType: '合同纠纷',
      customerId: customer.id,
      contractId: contract.id,
      createdBy: user,
      branchId: org,
      lawyerId: employee,
    },
  });
  const after = await svc.createTable(base, { name: key(), template: 'AFTER_SALES' }, key());
  const refund = await svc.createTable(base, { name: key(), template: 'CASE_REFUNDS' }, key());
  const a = await svc.describe(after.id),
    r = await svc.describe(refund.id);
  const vals = (detail: typeof a, input: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(input).map(([k, v]) => [
        detail.fields.find((f) => (f.options as Record<string, unknown>).lifecycleKey === k)!.id,
        v,
      ]),
    );
  const create = (detail: typeof a, input: Record<string, unknown>) =>
    svc.saveRecord(
      detail.table.id,
      undefined,
      { schemaVersion: detail.table.schemaVersion, values: vals(detail, input) },
      key(),
    );
  return { customer, contract, row, a, r, vals, create };
}
test('an empty misconfigured after-sales table can become a refund table without replacing field IDs', async () => {
  const { a, row, create } = await setup();
  await svc.configureLifecycle(a.table.id, { kind: 'CASE_REFUNDS', schemaVersion: a.table.schemaVersion }, key());
  const changed = await svc.describe(a.table.id);
  assert.equal(changed.table.lifecycleKind, 'CASE_REFUNDS');
  for (const field of a.fields) assert.ok(changed.fields.some(f => f.id === field.id));
  assert.ok(changed.fields.some(f => (f.options as Record<string, unknown>).lifecycleKey === 'amount'));
  await assert.rejects(create(changed, { upstreamId: row.id, content: '不能直接选案件', amount: '1' }));
  assert.equal(await db.operationLog.count({ where: { targetId: a.table.id, action: 'WORKSHEET_LINK_CONFIGURE' } }), 1);
});

test('reconfiguration never clears existing lifecycle data', async () => {
  const { a, row, create } = await setup();
  await create(a, { upstreamId: row.id, content: '保留数据' });
  await assert.rejects(svc.configureLifecycle(a.table.id, { kind: 'CASE_REFUNDS', schemaVersion: a.table.schemaVersion }, key()), /LIFECYCLE_TABLE_NOT_EMPTY/);
  assert.equal((await svc.query(a.table.id, {})).total, 1);
});

test('linked worksheets query current upstream fields; edits, deletion and undo retain stable IDs', async () => {
  const { customer, contract, row, a, vals, create } = await setup();
  const saved = await create(a, { upstreamId: row.id, content: '未及时沟通' });
  const query = await svc.query(a.table.id, {});
  assert.equal(query.total, 1);
  const field = (k: string) =>
    a.fields.find((f) => (f.options as Record<string, unknown>).lifecycleKey === k)!;
  assert.equal(query.records[0].values[field('contractNo').id], contract.contractNo);
  assert.equal(query.records[0].values[field('customerName').id], customer.name);
  await db.case.update({ where: { id: row.id }, data: { title: '案件新名称' } });
  assert.equal((await svc.query(a.table.id, {})).records[0].values[field('caseTitle').id], '案件新名称');
  assert.equal(field('contractAmount').writable, false);
  await assert.rejects(
    svc.saveRecord(
      a.table.id,
      saved.id,
      { schemaVersion: 1, version: 1, values: vals(a, { contractAmount: '1' }) },
      key(),
    ),
    /COLLAB_READONLY_FIELD/,
  );
  const edited = await svc.saveRecord(
    a.table.id,
    saved.id,
    { schemaVersion: 1, version: 1, values: vals(a, { content: '已联系' }) },
    key(),
  );
  const undone = await svc.reverseRecordOperation(
    a.table.id,
    edited.operationId,
    { direction: 'undo' },
    key(),
  );
  const latest = await svc.record(a.table.id, saved.id);
  assert.equal(latest.record.values[field('content').id], '未及时沟通');
  await svc.deleteRecords(
    a.table.id,
    { schemaVersion: 1, records: [{ id: saved.id, version: latest.record.version }] },
    key(),
  );
  assert.equal((await svc.query(a.table.id, {})).total, 0);
  const trash = await svc.recordOperations(a.table.id, { trash: 'true' });
  assert.ok('rows' in trash);
  await svc.reverseRecordOperation(a.table.id, trash.rows[0].id, { direction: 'undo' }, key());
  assert.equal((await svc.query(a.table.id, {})).total, 1);
  assert.ok(undone);
});
test('refund requires unresolved after-sales; duplicates, orphan deletion and state rollback are rejected', async () => {
  const { row, a, r, vals, create } = await setup();
  const after = await create(a, { upstreamId: row.id, content: '退款争议' });
  await assert.rejects(
    create(r, { upstreamId: after.id, content: '退款', amount: '100' }),
    /LIFECYCLE_REFUND_STATE/,
  );
  const changed = await svc.saveRecord(
    a.table.id,
    after.id,
    { schemaVersion: 1, version: 1, values: vals(a, { status: 'REFUND_REQUIRED' }) },
    key(),
  );
  const refund = await create(r, { upstreamId: after.id, content: '协商失败退款', amount: '100' });
  assert.equal((await svc.lifecycleChoices(r.table.id, {})).rows[0].id, after.id);
  await assert.rejects(
    create(r, { upstreamId: after.id, content: '重复', amount: '100' }),
    /LIFECYCLE_DUPLICATE_CASE/,
  );
  await assert.rejects(
    svc.saveRecord(
      a.table.id,
      after.id,
      { schemaVersion: 1, version: changed.version, archived: true },
      key(),
    ),
    /LIFECYCLE_HAS_CHILDREN/,
  );
  await assert.rejects(
    svc.reverseRecordOperation(a.table.id, changed.operationId, { direction: 'undo' }, key()),
    /LIFECYCLE_HAS_CHILDREN/,
  );
  await assert.rejects(
    new CaseService(db, { actorUserId: user }, ctx).deleteCase(row.id, { version: 1 }),
    (e: unknown) => (e as { code: string }).code === 'CASE_IN_USE',
  );
  assert.ok(await db.collabRecord.findUnique({ where: { id: refund.id } }));
});
test('row scope, field permissions and current permissions are enforced on query, write and restore', async () => {
  const { row, a, create } = await setup();
  const saved = await create(a, { upstreamId: row.id, content: '私有售后' });
  const restricted = {
    ...ctx,
    isSystemSuperAdmin: false,
    grants: ctx.grants.filter((g) => !g.permissionCode.startsWith('case.')),
  };
  const reader = new CollaborationService(db, restricted);
  assert.equal((await reader.query(a.table.id, {})).total, 0);
  await assert.rejects(reader.record(a.table.id, saved.id), /COLLAB_NOT_FOUND/);
  await assert.rejects(
    reader.saveRecord(a.table.id, saved.id, { schemaVersion: 1, version: 1, archived: true }, key()),
    /LIFECYCLE_CASE_UNAVAILABLE/,
  );
  const deleted = await svc.saveRecord(
    a.table.id,
    saved.id,
    { schemaVersion: 1, version: 1, archived: true },
    key(),
  );
  await assert.rejects(
    reader.reverseRecordOperation(a.table.id, deleted.operationId, { direction: 'undo' }, key()),
    /LIFECYCLE_CASE_UNAVAILABLE/,
  );
  assert.equal((await db.collabRecord.findUniqueOrThrow({ where: { id: saved.id } })).archived, true);
});
test('empty custom tables can be linked without dropping columns; nonempty tables are protected', async () => {
  const empty = await svc.createTable(base, { name: key() }, key());
  const before = await svc.describe(empty.id);
  await svc.configureLifecycle(empty.id, { kind: 'AFTER_SALES', schemaVersion: 1 }, key());
  const after = await svc.describe(empty.id);
  assert.ok(after.fields.some((f) => f.id === before.fields[0].id));
  assert.equal(after.table.lifecycleKind, 'AFTER_SALES');
  const normal = await svc.createTable(base, { name: key() }, key());
  const detail = await svc.describe(normal.id);
  await svc.saveRecord(
    normal.id,
    undefined,
    { schemaVersion: 1, values: { [detail.fields[0].id]: '保留' } },
    key(),
  );
  await assert.rejects(
    svc.configureLifecycle(normal.id, { kind: 'AFTER_SALES', schemaVersion: 1 }, key()),
    /LIFECYCLE_TABLE_NOT_EMPTY/,
  );
});
test('contract source requires signed visible negotiation and consistent customer; case source requires effective contract', async () => {
  const { customer, contract, row } = await setup();
  const n = await db.negotiation.create({
    data: {
      negotiationNo: key(),
      customerId: customer.id,
      negotiatorEmployeeId: employee,
      createdBy: user,
      branchId: org,
    },
  });
  const service = new ContractService(db, { actorUserId: user }, ctx);
  const input = {
    contractType: 'FIRST_SIGN' as const,
    title: '关联签约',
    customerId: customer.id,
    sourceType: 'NEGOTIATION' as const,
    negotiationId: n.id,
    amount: '100',
  };
  await assert.rejects(service.createContract(input), /LIFECYCLE_NEGOTIATION_NOT_SIGNED/);
  await db.negotiation.update({ where: { id: n.id }, data: { status: 'SIGNED' } });
  const created = await service.createContract(input);
  assert.equal(created.negotiationId, n.id);
  const cases = new CaseService(db, { actorUserId: user }, ctx);
  await assert.rejects(
    cases.createCase({
      title: '未生效',
      customerId: customer.id,
      contractId: created.id,
      caseType: '合同',
      lawyerId: employee,
      branchId: org,
    }),
    /LIFECYCLE_CONTRACT_NOT_EFFECTIVE/,
  );
  await assert.rejects(
    cases.createCase({
      title: '重复关联',
      customerId: customer.id,
      contractId: contract.id,
      caseType: '合同',
      lawyerId: employee,
      branchId: org,
    }),
    /LIFECYCLE_CONTRACT_HAS_CASE/,
  );
  assert.ok(row);
});
test('concurrent insertion cannot create duplicate case links and a whole-table deletion cannot bypass history protection', async () => {
  const { row, a, create } = await setup();
  const results = await Promise.allSettled([
    create(a, { upstreamId: row.id, content: '问题一' }),
    create(a, { upstreamId: row.id, content: '问题二' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await svc.query(a.table.id, {})).total, 1);
  await assert.rejects(
    svc.mutateTable(a.table.id, { version: 1, remove: true }, key()),
    /LIFECYCLE_TABLE_HAS_RECORDS/,
  );
});
test('signed negotiation and effective contract display synchronized fields in downstream worksheets', async () => {
  const { customer, contract, row } = await setup();
  const n = await db.negotiation.create({
    data: {
      negotiationNo: key(),
      customerId: customer.id,
      negotiatorEmployeeId: employee,
      createdBy: user,
      branchId: org,
      status: 'SIGNED',
      quotedAmount: '888',
    },
  });
  await db.contract.update({ where: { id: contract.id }, data: { negotiationId: n.id } });
  const ct = await svc.createTable(base, { name: key(), source: 'CONTRACTS' }, key());
  const ca = await svc.createTable(base, { name: key(), source: 'CASES' }, key());
  const fields = (await svc.describe(ct.id)).fields;
  const quoted = fields.find((f) => (f.options as Record<string, unknown>).businessKey === 'quotedAmount')!;
  assert.equal(quoted.writable, false);
  assert.equal((await svc.query(ct.id, {})).records[0].values[quoted.id], '888.00');
  const caseFields = (await svc.describe(ca.id)).fields;
  const amount = caseFields.find(
    (f) => (f.options as Record<string, unknown>).businessKey === 'contractAmount',
  )!;
  assert.equal(
    (await svc.query(ca.id, {})).records.find((r) => r.id === row.id)!.values[amount.id],
    '1200.00',
  );
  const cs = new ContractService(db, { actorUserId: user }, ctx);
  await assert.rejects(
    cs.mutateDraft(contract.id, { version: 1, title: '修改已生效合同' }, false, db),
    (e) => (e as { code: string }).code === 'CONTRACT_GRID_STATE_INVALID',
  );
});
test('unlinked negotiation deletion is recoverable and linked signed negotiations remain protected', async () => {
  const { customer } = await setup();
  const n = await db.negotiation.create({
    data: {
      negotiationNo: key(),
      customerId: customer.id,
      negotiatorEmployeeId: employee,
      createdBy: user,
      branchId: org,
    },
  });
  const t = await svc.createTable(base, { name: key(), source: 'NEGOTIATIONS' }, key());
  const result = await svc.saveRecord(t.id, n.id, { schemaVersion: 1, version: 1, archived: true }, key());
  assert.ok((await db.negotiation.findUniqueOrThrow({ where: { id: n.id } })).deletedAt);
  await svc.reverseRecordOperation(t.id, result.operationId, { direction: 'undo' }, key());
  assert.equal((await db.negotiation.findUniqueOrThrow({ where: { id: n.id } })).deletedAt, null);
});
test('ordinary editor and reader roles share authorized cases while hidden fields stay out of selection previews', async () => {
  const { row, a, create, vals } = await setup();
  const saved = await create(a, { upstreamId: row.id, content: '管理员登记' });
  const other = await db.user.create({ data: { username: key(), password: 'unused' } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  const member = await db.collabMember.create({
    data: { workspaceId, principalId: other.id, role: 'READER', rowScope: 'ALL' },
  });
  const ordinary = new CollaborationService(db, {
    ...ctx,
    userId: other.id,
    employeeId: null,
    isSystemSuperAdmin: false,
  });
  assert.equal((await ordinary.query(a.table.id, {})).total, 1);
  await assert.rejects(
    ordinary.saveRecord(
      a.table.id,
      saved.id,
      { schemaVersion: 1, version: 1, values: vals(a, { content: '拒绝' }) },
      key(),
    ),
    /COLLAB_FORBIDDEN/,
  );
  const amount = a.fields.find(
    (f) => (f.options as Record<string, unknown>).lifecycleKey === 'contractAmount',
  )!;
  await db.collabMember.update({
    where: { id: member.id },
    data: { role: 'EDITOR', hiddenFields: [amount.id] },
  });
  const options = await ordinary.lifecycleChoices(a.table.id, {});
  const preview = (options.rows[0] as unknown as { preview: Record<string, unknown> }).preview;
  assert.equal(Object.hasOwn(preview, 'contractAmount'), false);
  assert.equal(preview.caseTitle, '案件甲');
  await ordinary.saveRecord(
    a.table.id,
    saved.id,
    { schemaVersion: 1, version: 1, values: vals(a, { content: '普通角色更新' }) },
    key(),
  );
  assert.equal(
    (await svc.record(a.table.id, saved.id)).record.values[Object.keys(vals(a, { content: '' }))[0]],
    '普通角色更新',
  );
});

test('contract-to-case lookup uses the canonical case scope and excludes deleted cases', async () => {
  const { row, contract } = await setup();
  const service = new CaseService(db, { actorUserId: user }, ctx);
  assert.deepEqual(
    (await service.listCases({ contractId: contract.id })).list.map((r) => r.id),
    [row.id],
  );
  assert.equal((await service.listCases({ contractId: key() })).total, 0);
  const otherUser = (await db.user.create({ data: { username: key(), password: 'unused' } })).id;
  const restricted: AuthorizationContext = {
    ...ctx,
    userId: otherUser,
    employeeId: null,
    isSystemSuperAdmin: false,
    permissionCodes: ['case.read'],
    grants: [
      {
        sourceType: 'ROLE',
        sourceId: 'restricted',
        permissionCode: 'case.read',
        resource: 'case',
        scopeIds: ['SELF'],
        validUntil: null,
      },
    ],
  };
  assert.equal(
    (await new CaseService(db, { actorUserId: otherUser }, restricted).listCases({ contractId: contract.id }))
      .total,
    0,
  );
  await db.case.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  assert.equal((await service.listCases({ contractId: contract.id })).total, 0);
});


test('standard fields synchronize case data and refund attachment lookup enforces parent field permissions', async()=>{
  const {a,r,row,contract,vals,create}=await setup();
  await db.case.update({where:{id:row.id},data:{intakeData:{contractNumber:'CUSTOM-001',signedDate:'2026-10-20T01:30:00.000Z',caseCategory:'民事',agencyProcedure:'["一审","二审"]',handlingLawyer:'张律师'}}});
  const caseOptions=await svc.lifecycleChoices(a.table.id,{keyword:'CUSTOM-001'});
  assert.equal(caseOptions.rows[0].id,row.id);
  const aField=(k:string)=>a.fields.find(f=>(f.options as Record<string,unknown>).lifecycleKey===k)!;
  const rField=(k:string)=>r.fields.find(f=>(f.options as Record<string,unknown>).lifecycleKey===k)!;
  const file=await db.collabAttachment.create({data:{tableId:a.table.id,ownerId:user,name:'退款凭证.pdf',mimeType:'application/pdf',size:1,storageKey:key()}});
  const parent=await create(a,{upstreamId:row.id,content:'协商退费',status:'REFUND_REQUIRED',feeTotal:'12,000.00',refundReceipt:[file.id],closed:'否',handling1:'第一次沟通'});
  const refund=await create(r,{upstreamId:parent.id,content:'解除委托',amount:'100',recipientName:'王某',recipientBank:'招商',recipientAccount:'0012345'});
  let view=(await svc.record(r.table.id,refund.id)).record;
  assert.equal(view.values[rField('feeTotalLookup').id],'12,000.00');
  assert.deepEqual(view.values[rField('refundReceiptLookup').id],[file.id]);
  assert.equal(view.values[rField('handlingLawyer').id],'张律师');
  assert.deepEqual(view.values[rField('agencyProcedure').id],['一审','二审']);
  assert.equal(view.values[rField('customerPhone').id],'13800000001');
  assert.equal(view.values[rField('terminated').id],null);
  assert.equal((await svc.record(a.table.id,parent.id)).record.values[aField('terminated').id],null);
  assert.equal(aField('terminated').writable,false);
  assert.equal(rField('terminated').writable,false);
  await assert.rejects(svc.saveRecord(a.table.id,parent.id,{schemaVersion:1,version:1,values:vals(a,{terminated:'是'})},key()),/COLLAB_READONLY_FIELD/);
  assert.equal((await svc.attachment(r.table.id,file.id)).id,file.id);
  await db.contract.update({where:{id:contract.id},data:{status:'TERMINATED'}});
  view=(await svc.record(r.table.id,refund.id)).record;
  assert.equal(view.values[rField('terminated').id],null);
  assert.equal((await svc.record(a.table.id,parent.id)).record.values[aField('terminated').id],null);
  assert.equal(rField('refundReceiptLookup').writable,false);
  await assert.rejects(svc.saveRecord(r.table.id,refund.id,{schemaVersion:1,version:1,values:vals(r,{refundReceiptLookup:[]})},key()),/COLLAB_READONLY_FIELD/);
  const other=(await db.user.create({data:{username:key(),password:'unused'}})).id;
  const actor={...ctx,userId:other,isSystemSuperAdmin:false};
  const ordinary=new CollaborationService(db,actor);
  const workspaceId=(await db.collabBase.findUniqueOrThrow({where:{id:base}})).workspaceId;
  const member=await db.collabMember.create({data:{workspaceId,principalId:other,role:'READER',rowScope:'ALL',hiddenFields:[aField('refundReceipt').id,aField('feeTotal').id]}});
  const hidden=(await ordinary.record(r.table.id,refund.id)).record;
  assert.equal(hidden.values[rField('refundReceiptLookup').id],null);
  assert.equal(hidden.values[rField('feeTotalLookup').id],null);
  assert.equal(hidden.values[rField('customerPhone').id],'138****0001');
  await assert.rejects(ordinary.attachment(r.table.id,file.id),/COLLAB_FORBIDDEN/);
  await db.collabMember.update({where:{id:member.id},data:{hiddenFields:[]}});
  assert.equal((await ordinary.attachment(r.table.id,file.id)).id,file.id);
  assert.equal((a.views[0].config as {visibleFields:string[]}).visibleFields.length,27);
  assert.equal((r.views[0].config as {visibleFields:string[]}).visibleFields.length,27);
});


test('field layout upgrade preserves records and IDs while applying exact defaults to existing tables',async()=>{
 const {a,r,row,create}=await setup();
 await db.user.update({where:{id:user},data:{username:'admin'}});
 const cases=await svc.createTable(base,{name:'案件管理表',source:'CASES'},key());
 const saved=await create(a,{upstreamId:row.id,content:'保留业务数据'});
 const missing=r.fields.find(f=>(f.options as Record<string,unknown>).lifecycleKey==='recipientBank')!;
 await db.collabField.delete({where:{id:missing.id}});
 const oldFields=await db.collabField.findMany({where:{tableId:cases.id}});
 const first=oldFields.find(f=>(f.options as Record<string,unknown>).businessKey==='contractDisplayId')!;
 await db.collabField.update({where:{id:first.id},data:{position:99}});
 await standardizeCaseWorksheets(db,true);
 await standardizeCaseWorksheets(db,true);
 assert.equal(await db.collabRecord.count({where:{id:saved.id}}),1);
 assert.equal(await db.collabField.count({where:{tableId:cases.id}}),oldFields.length);
 for(const f of oldFields)assert.ok(await db.collabField.findUnique({where:{id:f.id}}));
 const updated=await svc.describe(cases.id);
 const ids=(updated.views[0].config as {visibleFields:string[]}).visibleFields;
 assert.deepEqual(ids.map(id=>updated.fields.find(f=>f.id===id)!.name),['合同ID','合同未回','签约日期','合同编号','客户姓名','地区','客户电话','对方当事人','案件类型','案由','代理程序','代理费收款方式','固定代理费','案件基础代理费','风险代理金额','风险代理比例','代理费付款特别约定','所属业务部门','承办律师','合同附件','记录创建时间','最近修改时间','备注']);
 for(const t of [a,r])assert.equal(((await svc.describe(t.table.id)).views[0].config as {visibleFields:string[]}).visibleFields.length,27);
 assert.ok((await svc.describe(r.table.id)).fields.some(f=>(f.options as Record<string,unknown>).lifecycleKey==='recipientBank'));
});
