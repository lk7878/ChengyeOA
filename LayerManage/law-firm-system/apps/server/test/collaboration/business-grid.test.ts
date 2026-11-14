import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { withFailingCollaborationOutbox } from '../helpers/collaboration-outbox-failure';
import { followColumns } from '../../app/application/crm/follow-worksheet-fields';
import { standardizeFollowWorksheets } from '../../scripts/maintenance/standardize-follow-worksheets';

let db: PrismaClient, svc: CollaborationService, base: string, org: string, user: string, employee: string;
const code = (name: string) => (error: unknown) => (error as { code?: string }).code === name;
test('standard follow fields share canonical edits, files and history across worksheets',async()=>{
  const t=await svc.createTable(base,{name:'客户跟进记录表',source:'FOLLOWS'},key());
  const id=await seed('FOLLOWS');
  const detail=await svc.describe(t.id);
  assert.deepEqual(detail.fields.map(f=>f.name),followColumns.map(c=>c[1]));
  const field=(name:string)=>detail.fields.find(f=>f.options.businessKey===name)!;
  const before=(await svc.record(t.id,id)).record;
  assert.match(String(before.values[field('followNo').id]),/^KH\d{2,}$/);
  const attachment=await db.collabAttachment.create({data:{tableId:t.id,ownerId:user,name:'录音.mp3',mimeType:'audio/mpeg',size:3,storageKey:key()}});
  const patch={customerName:'客户姓名',wechat:'微信名',douyinName:'抖音名',phone:'13811112222',region:'重庆',concerns:'赔偿',objections:'费用',customerStage:'已发材料',currentStage:'已约面',followedBy:employee,followRole:'客服',type:'SMS',result:'预约中',content:'补充记录',summary:'摘要',caseTypes:['医疗','合同'],nextPlan:'电话沟通',nextTime:'2026-10-23T02:00:00.000Z',enteredAt:'2026-10-22T02:00:00.000Z',dropAt:'2026-11-01T02:00:00.000Z',overdue:true,changes:'补充材料',attachments:[attachment.id]};
  const values=Object.fromEntries(Object.entries(patch).map(([k,v])=>[field(k).id,v]));
  const edited=await svc.saveRecord(t.id,id,{schemaVersion:1,version:before.version,values},key());
  const other=await svc.createTable(base,{name:'另一个跟进表',source:'FOLLOWS'},key());
  const otherDetail=await svc.describe(other.id),shared=(await svc.record(other.id,id)).record;
  assert.equal(shared.values[otherDetail.fields.find(f=>f.options.businessKey==='customerName')!.id],'客户姓名');
  assert.equal((await svc.attachment(other.id,attachment.id)).id,attachment.id);
  assert.equal(shared.values[otherDetail.fields.find(f=>f.options.businessKey==='lastOperator')!.id],employee);
  await assert.rejects(svc.saveRecord(t.id,id,{schemaVersion:1,version:edited.version,values:{[field('followNo').id]:'KH00'}},key()));
  await assert.rejects(svc.saveRecord(t.id,id,{schemaVersion:1,version:edited.version,values:{[field('currentStage').id]:'非法选项'}},key()));
  await svc.reverseRecordOperation(t.id,edited.operationId,{direction:'undo'},key());
  assert.equal((await svc.record(t.id,id)).record.values[field('customerName').id],'原线索');
  await svc.reverseRecordOperation(t.id,edited.operationId,{direction:'redo'},key());
  const latest=(await svc.record(t.id,id)).record;
  const deleted=await svc.saveRecord(t.id,id,{schemaVersion:1,version:latest.version,archived:true},key());
  assert.equal((await svc.query(other.id,{})).total,0);
  await svc.reverseRecordOperation(t.id,deleted.operationId,{direction:'undo'},key());
  assert.equal((await svc.query(other.id,{})).total,1);
  const legacy=await db.collabField.create({data:{tableId:t.id,name:'废弃字段',type:'TEXT',position:99}});
  await standardizeFollowWorksheets(db,user,true);
  assert.equal((await db.collabField.findUniqueOrThrow({where:{id:legacy.id}})).archived,true);
  assert.equal((await svc.describe(t.id)).fields.length,28);
  const schema=(await svc.describe(t.id)).table.schemaVersion;
  await standardizeFollowWorksheets(db,user,true);
  assert.equal((await svc.describe(t.id)).table.schemaVersion,schema,'upgrade is idempotent');
});
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
  const ctx: AuthorizationContext = {
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
test('deleting a business worksheet keeps canonical customers and removes only its extensions', async () => {
  const customer = await seed('CUSTOMERS');
  const table = await svc.createTable(base, { name: '客户工作表', source: 'CUSTOMERS' }, key());
  await db.collabExtension.create({
    data: { tableId: table.id, recordId: customer, values: { note: 'extension' }, updatedBy: user },
  });
  await svc.mutateTable(table.id, { remove: true, version: 1 }, key());
  assert.ok(await db.customer.findUnique({ where: { id: customer } }));
  assert.equal(await db.collabExtension.count({ where: { tableId: table.id } }), 0);
  const reconnected = await svc.createTable(base, { name: '客户工作表', source: 'CUSTOMERS' }, key());
  assert.equal((await svc.query(reconnected.id, {})).records[0].id, customer);
});
async function seed(source: string) {
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '原客户', phone: '13800000000', phoneHash: key(), createdBy: user },
  });
  if (source === 'CUSTOMERS') return customer.id;
  if (source === 'LEADS' || source === 'FOLLOWS') {
    const lead = await db.lead.create({
      data: {
        leadNo: key(),
        name: '原线索',
        phone: '13800000000',
        phoneHash: key(),
        branchId: org,
        createdBy: user,
      },
    });
    if (source === 'LEADS') return lead.id;
    return (
      await db.leadFollow.create({
        data: { leadId: lead.id, type: 'PHONE', content: '原跟进', createdBy: user },
      })
    ).id;
  }
  if (source === 'CONTRACTS')
    return (
      await db.contract.create({
        data: {
          contractNo: key(),
          contractType: 'FIRST_SIGN',
          title: '原合同',
          customerId: customer.id,
          branchId: org,
          amount: '100.00',
          createdBy: user,
        },
      })
    ).id;
  if (source === 'NEGOTIATIONS')
    return (
      await db.negotiation.create({
        data: {
          negotiationNo: key(),
          customerId: customer.id,
          negotiatorEmployeeId: employee,
          branchId: org,
          quotedAmount: '100.00',
          createdBy: user,
        },
      })
    ).id;
  if (source === 'CHANNELS')
    return (
      await db.channel.create({
        data: { code: key(), name: '原渠道', type: 'OTHER', branchId: org, createdBy: user },
      })
    ).id;
  if (source === 'COSTS')
    return (
      await db.costEntry.create({
        data: { category: 'OFFICE', amount: '100.00', occurredAt: new Date(), createdBy: user },
      })
    ).id;
  if (source === 'PERFORMANCES')
    return (
      await db.performance.create({
        data: { employeeId: employee, period: '2026-10', type: 'MONTHLY', kpiData: '{}', createdBy: user },
      })
    ).id;
  return (
    await db.inventoryItem.create({
      data: { code: key(), name: '原物品', kind: 'OFFICE', category: '文具', unit: '支', createdBy: user },
    })
  ).id;
}
async function table(source: string) {
  const id = (await svc.createTable(base, { name: source, source }, key())).id;
  const detail = await svc.describe(id);
  const fields = Object.fromEntries(
    detail.fields.map((f) => [String((f.options as { businessKey?: string }).businessKey), f.id]),
  );
  return { id, detail, fields };
}
for (const [source, field, value] of [
  ['LEADS', 'name', '修改线索'],
  ['FOLLOWS', 'content', '修改跟进'],
  ['CONTRACTS', 'title', '修改合同'],
  ['CUSTOMERS', 'name', '修改客户'],
  ['NEGOTIATIONS', 'quotedAmount', '200.50'],
  ['CHANNELS', 'name', '修改渠道'],
  ['COSTS', 'amount', '300.50'],
  ['INVENTORY_ITEMS', 'name', '修改物品'],
  ['PERFORMANCES', 'goal', '修改考核目标'],
])
  test(`${source} inline edit writes canonical data, is idempotent and rejects stale/protected writes`, async () => {
    const t = await table(source),
      id = await seed(source);
    assert.equal(t.detail.fields.find((f) => f.id === t.fields[field])?.writable, true);
    const input = { schemaVersion: 1, version: 1, values: { [t.fields[field]]: value } },
      mutation = key();
    const result = await svc.saveRecord(t.id, id, input, mutation);
    assert.equal(result.version, 2);
    assert.deepEqual(await svc.saveRecord(t.id, id, input, mutation), result);
    assert.equal((await svc.record(t.id, id)).record.values[t.fields[field]], value);
    assert.equal(await db.collabRecord.count({ where: { tableId: t.id } }), 0);
    await assert.rejects(svc.saveRecord(t.id, id, input, key()), code('COLLAB_RECORD_CONFLICT'));
    const protectedField = t.detail.fields.find((f) => !f.writable)!;
    await assert.rejects(
      svc.saveRecord(t.id, id, { ...input, version: 2, values: { [protectedField.id]: '伪造' } }, key()),
    );
    const denied = new CollaborationService(db, {
      ...svc.actor,
      permissionCodes: svc.actor.permissionCodes.filter(
        (p) =>
          ![
            'lead.update',
            'contract.update',
            'customer.update',
            'negotiation.update',
            'channel.update',
            'cost.update',
            'inventory.manage',
            'performance.update',
          ].includes(p),
      ),
    });
    await assert.rejects(
      denied.saveRecord(t.id, id, { ...input, version: 2 }, key()),
      code('COLLAB_FORBIDDEN'),
    );
  });
test('negotiation amount can be cleared; completed negotiations and invalid amounts cannot be edited', async () => {
  const t = await table('NEGOTIATIONS'),
    id = await seed('NEGOTIATIONS');
  const input = { schemaVersion: 1, version: 1, values: { [t.fields.quotedAmount]: null } };
  await svc.saveRecord(t.id, id, input, key());
  assert.equal((await db.negotiation.findUniqueOrThrow({ where: { id } })).quotedAmount, null);
  await assert.rejects(
    svc.saveRecord(t.id, id, { ...input, version: 2, values: { [t.fields.quotedAmount]: '-1' } }, key()),
    code('VALIDATION_FAILED'),
  );
  await db.negotiation.update({ where: { id }, data: { status: 'SIGNED' } });
  assert.equal((await svc.record(t.id, id)).record.writable, false);
  await assert.rejects(
    svc.saveRecord(t.id, id, { ...input, version: 2 }, key()),
    code('CONTRACT_STATE_TRANSITION_INVALID'),
  );
});
test('mixed customer fields and extensions roll back together when collaboration event fails', async () => {
  const t = await table('CUSTOMERS'),
    id = await seed('CUSTOMERS');
  const extra = await svc.saveField(t.id, undefined, { name: '备注', type: 'TEXT', version: 1 }, key());
  const schema = (await svc.describe(t.id)).table.schemaVersion;
  await assert.rejects(
    withFailingCollaborationOutbox(db, async () => {
      await svc.saveRecord(
        t.id,
        id,
        {
          schemaVersion: schema,
          version: 1,
          values: { [t.fields.name]: '不应保存', [extra.id]: '不应保存' },
        },
        key(),
      );
    }),
  );
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id } })).name, '原客户');
  assert.equal(await db.collabExtension.count({ where: { tableId: t.id } }), 0);
});
test('batch customer changes roll back on a later record version conflict', async () => {
  const t = await table('CUSTOMERS'),
    first = await seed('CUSTOMERS'),
    second = await seed('CUSTOMERS');
  await assert.rejects(
    svc.saveRecords(
      t.id,
      {
        schemaVersion: 1,
        records: [
          { id: first, version: 1, values: { [t.fields.name]: '不应保存' } },
          { id: second, version: 99, values: { [t.fields.name]: '不应保存' } },
        ],
      },
      key(),
    ),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: first } })).name, '原客户');
});
test('customer inline editing respects reader role, field restrictions and masked phone values', async () => {
  const t = await table('CUSTOMERS'),
    id = await seed('CUSTOMERS');
  const other = await db.user.create({ data: { username: key(), password: 'unused' } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  const member = await db.collabMember.create({
    data: { workspaceId, principalId: other.id, role: 'READER', rowScope: 'ALL' },
  });
  const editor = new CollaborationService(db, {
    ...svc.actor,
    userId: other.id,
    employeeId: null,
    isSystemSuperAdmin: false,
  });
  const input = { schemaVersion: 1, version: 1, values: { [t.fields.name]: '新名称' } };
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FORBIDDEN'));
  await db.collabMember.update({
    where: { id: member.id },
    data: { role: 'EDITOR', readonlyFields: [t.fields.name] },
  });
  assert.equal((await editor.describe(t.id)).fields.find((f) => f.id === t.fields.name)?.writable, false);
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FIELD_UNAVAILABLE'));
  await db.collabMember.update({ where: { id: member.id }, data: { readonlyFields: [] } });
  assert.equal((await editor.describe(t.id)).fields.find((f) => f.id === t.fields.phone)?.writable, false);
  await assert.rejects(
    editor.saveRecord(t.id, id, { ...input, values: { [t.fields.phone]: '138****0000' } }, key()),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  await editor.saveRecord(t.id, id, input, key());
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id } })).name, '新名称');
});

test('contract amount validation, lifecycle and downstream references protect canonical records', async () => {
  const t = await table('CONTRACTS'),
    id = await seed('CONTRACTS');
  const change = (amount: unknown) =>
    svc.saveRecord(t.id, id, { schemaVersion: 1, version: 1, values: { [t.fields.amount]: amount } }, key());
  for (const amount of [-1, '1.234', null]) await assert.rejects(change(amount), code('VALIDATION_FAILED'));
  await db.contract.update({
    where: { id },
    data: { paymentTerms: JSON.stringify([{ period: 1, amount: '100.00', dueDate: '2026-12-01' }]) },
  });
  await assert.rejects(change('200.00'), code('RECEIVABLE_PLAN_MISMATCH'));
  await db.contract.update({ where: { id }, data: { paymentTerms: null } });
  await change('200.00');
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).amount.toFixed(2), '200.00');
  for (const status of ['PENDING_APPROVAL', 'SIGNED', 'EFFECTIVE']) {
    await db.contract.update({ where: { id }, data: { status } });
    assert.equal((await svc.record(t.id, id)).record.writable, false);
    await assert.rejects(
      svc.saveRecord(t.id, id, { schemaVersion: 1, version: 2, archived: true }, key()),
      code('CONTRACT_GRID_STATE_INVALID'),
    );
    await assert.rejects(
      svc.saveRecord(
        t.id,
        id,
        { schemaVersion: 1, version: 2, values: { [t.fields.title]: '不可修改' } },
        key(),
      ),
      code('CONTRACT_GRID_STATE_INVALID'),
    );
  }
  await db.contract.update({ where: { id }, data: { status: 'VOID', receivedAmount: '1.00' } });
  await assert.rejects(
    svc.saveRecord(t.id, id, { schemaVersion: 1, version: 2, archived: true }, key()),
    code('CONTRACT_GRID_IN_USE'),
  );
  await db.contract.update({ where: { id }, data: { receivedAmount: '0.00' } });
  const current = await db.contract.findUniqueOrThrow({ where: { id } });
  await db.contract.create({
    data: {
      contractNo: key(),
      contractType: 'SUPPLEMENT',
      title: '补充协议',
      customerId: current.customerId,
      parentContractId: id,
      createdBy: user,
    },
  });
  await assert.rejects(
    svc.saveRecord(t.id, id, { schemaVersion: 1, version: 2, archived: true }, key()),
    code('CONTRACT_GRID_IN_USE'),
  );
});
test('contract deletion is scoped, versioned, atomic, idempotent and removes the canonical record from every worksheet', async () => {
  const t = await table('CONTRACTS'),
    id = await seed('CONTRACTS');
  const otherTable = await svc.createTable(base, { name: '另一合同表', source: 'CONTRACTS' }, key());
  const input = { schemaVersion: 1, version: 1, archived: true };
  const denied = new CollaborationService(db, {
    ...svc.actor,
    permissionCodes: svc.actor.permissionCodes.filter((p) => p !== 'contract.delete'),
  });
  assert.equal((await denied.describe(t.id)).canDeleteRecords, false);
  await assert.rejects(denied.saveRecord(t.id, id, input, key()), code('COLLAB_FORBIDDEN'));
  await assert.rejects(
    svc.saveRecord(t.id, id, { ...input, version: 99 }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  await assert.rejects(withFailingCollaborationOutbox(db, () => svc.saveRecord(t.id, id, input, key())));
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).deletedAt, null);
  assert.equal(await db.operationLog.count({ where: { targetId: id, action: 'contract.delete' } }), 0);
  const mutation = key();
  const result = await svc.saveRecord(t.id, id, input, mutation);
  assert.deepEqual(await svc.saveRecord(t.id, id, input, mutation), result);
  assert.ok((await db.contract.findUniqueOrThrow({ where: { id } })).deletedAt);
  assert.equal((await svc.query(t.id, {})).total, 0);
  assert.equal((await svc.query(otherTable.id, {})).total, 0);
  assert.equal(await db.operationLog.count({ where: { targetId: id, action: 'contract.delete' } }), 1);
});
test('contract core, extension and audit roll back together on event failure', async () => {
  const t = await table('CONTRACTS'),
    id = await seed('CONTRACTS');
  const extra = await svc.saveField(t.id, undefined, { name: '备注', type: 'TEXT', version: 1 }, key());
  const schemaVersion = (await svc.describe(t.id)).table.schemaVersion;
  await assert.rejects(
    withFailingCollaborationOutbox(db, () =>
      svc.saveRecord(
        t.id,
        id,
        { schemaVersion, version: 1, values: { [t.fields.title]: '回滚', [extra.id]: '回滚' } },
        key(),
      ),
    ),
  );
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).title, '原合同');
  assert.equal(await db.collabExtension.count({ where: { tableId: t.id } }), 0);
  assert.equal(await db.operationLog.count({ where: { targetId: id, action: 'contract.update' } }), 0);
});

test('follow creation only accepts visible active customers and persists to canonical CRM with idempotency', async () => {
  const t = await table('FOLLOWS'),
    leadId = await seed('LEADS');
  assert.equal(t.detail.canCreateBusiness, true);
  assert.ok(!(await svc.followLeadOptions(t.id)).leads.some((l) => l.id === leadId));
  await assert.rejects(svc.createBusinessRecord(t.id,{leadId,type:'PHONE',content:'排除线索'},key()),code('COLLAB_NOT_FOUND'));
  const customer=await db.customer.create({data:{name:'有效客户',customerNo:key(),phone:'13811110001',phoneHash:key(),createdBy:user,sourceLeadId:leadId}});
  const retired=await db.customer.create({data:{name:'回收站客户',customerNo:key(),phone:'13811110002',phoneHash:key(),createdBy:user,deletedAt:new Date()}});
  const master=await table('CUSTOMERS');
  const view=master.detail.views.find(v=>v.isDefault)!;
  await svc.saveView(master.id,view.id,{config:{filter:{fieldId:master.fields.name,operator:'eq',value:customer.name}},version:view.version},key());
  const options=(await svc.followLeadOptions(t.id)).leads;
  assert.deepEqual(options.map(c=>c.id),[customer.id]);
  assert.ok(options.some(row=>row.id===customer.id));
  assert.ok(!options.some(row=>row.id===retired.id));
  await assert.rejects(svc.createBusinessRecord(t.id,{leadId:retired.id,type:'PHONE',content:'已删除'},key()),code('COLLAB_NOT_FOUND'));
  const input = {
      leadId:customer.id,
      type: 'WECHAT',
      content: '沟通结果',
      nextPlan: '回访',
      nextTime: '2026-11-01T08:00:00.000Z',
    },
    mutation = key();
  const first = await svc.createBusinessRecord(t.id, input, mutation);
  assert.deepEqual(await svc.createBusinessRecord(t.id, input, mutation), first);
  assert.equal(await db.leadFollow.count({ where: { leadId } }), 1);
  assert.equal((await svc.query(t.id, {})).records[0].id, first.id);
  assert.equal((await db.leadFollow.findUniqueOrThrow({ where: { id: first.id } })).content, '沟通结果');
  await assert.rejects(
    svc.createBusinessRecord(t.id, { ...input, nextTime: 'invalid' }, key()),
    code('VALIDATION_FAILED'),
  );
  const foreignId = key();
  const foreign = await db.organization.create({
    data: { id: foreignId, code: key(), name: '其他分所', type: 'BRANCH', path: '/' + foreignId },
  });
  await db.lead.update({ where: { id: leadId }, data: { branchId: foreign.id } });
  const outside = await svc.followLeadOptions(t.id);
  assert.ok(!outside.leads.some((lead) => lead.id === leadId));
  await assert.rejects(svc.createBusinessRecord(t.id, input, key()), code('COLLAB_NOT_FOUND'));
});
test('customer worksheet shows records visible on the customer page, including creators outside the workspace', async () => {
  const t = await table('CUSTOMERS');
  const outsider = await db.user.create({ data: { username: key(), password: 'unused' } });
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '谢先生', phone: '13811110000', phoneHash: key(), createdBy: outsider.id },
  });
  assert.ok((await svc.query(t.id, {})).records.some((row) => row.id === customer.id));
});
test('new follows can target a customer record and keep that customer from being deleted', async () => {
  const t = await table('FOLLOWS');
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '谢先生', phone: '13811110001', phoneHash: key(), createdBy: user },
  });
  assert.ok((await svc.followLeadOptions(t.id)).leads.some((lead) => lead.id === customer.id && lead.name.includes('谢先生')));
  const created = await svc.createBusinessRecord(t.id, { leadId: customer.id, type: 'PHONE', content: '电话回访' }, key());
  const linked = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
  const follow = await db.leadFollow.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(linked.sourceLeadId, follow.leadId);
  assert.equal((await svc.query(t.id, {})).records.some((row) => row.id === created.id), true);
  const { CustomerService } = await import('../../app/application/crm/customer-service');
  await assert.rejects(
    new CustomerService(db, { actorUserId: user }, svc.actor).deleteCustomer(customer.id, { version: linked.version }),
    (error: unknown) => (error as { code?: string }).code === 'CUSTOMER_IN_USE',
  );
});
test('sharing grants selected tables and withholds the other tables in the same module', async () => {
  const visible = await svc.createTable(base, { name: '可见表', template: 'BLANK' }, key());
  const hidden = await svc.createTable(base, { name: '隐藏表', template: 'BLANK' }, key());
  const staffEmployee = await db.employee.create({
    data: {
      employeeNo: key(),
      name: '被授权同事',
      phone: '13700002222',
      type: 'LAWYER',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01'),
    },
  });
  const position = await db.position.findFirstOrThrow({ where: { organizationId: org } });
  await db.employeeAssignment.create({
    data: {
      employeeId: staffEmployee.id,
      organizationId: org,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  const account = await db.user.create({ data: { username: key(), password: 'unused', employeeId: staffEmployee.id } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  await svc.saveMember(
    workspaceId,
    {
      baseId: base,
      principalType: 'USER',
      principalId: account.id,
      role: 'EDITOR',
      canCreate: false,
      rowScope: 'ALL',
      tableGrants: [
        { tableId: visible.id, role: 'READER' },
        { tableId: hidden.id, role: 'DENY' },
      ],
    },
    key(),
  );
  const staff = new CollaborationService(db, { ...svc.actor, userId: account.id, isSystemSuperAdmin: false });
  const names = (await staff.listTables(base)).tables.map((item) => item.id);
  assert.ok(names.includes(visible.id));
  assert.equal(names.includes(hidden.id), false);
});
test('permission sharing lists enabled employees outside the workspace organization', async () => {
  const other = key();
  await db.organization.create({ data: { id: other, code: other, name: '大数据中心', type: 'DEPARTMENT', path: '/' + other } });
  const position = await db.position.create({
    data: { organizationId: other, code: key(), name: '主管', categoryCode: 'LAWYER' },
  });
  const person = await db.employee.create({
    data: {
      employeeNo: key(),
      name: '沈红梅',
      phone: '13700001111',
      type: 'LAWYER',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01'),
    },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: person.id,
      organizationId: other,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  const account = await db.user.create({ data: { username: key(), password: 'unused', employeeId: person.id } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  assert.ok((await svc.options(workspaceId)).users.some((item) => item.id === account.id && item.name === '沈红梅'));
});
test('follow revisions are shared across worksheets; clearing optional data and deletion update canonical history', async () => {
  const t = await table('FOLLOWS'),
    id = await seed('FOLLOWS');
  const second = await svc.createTable(base, { name: '另一跟进表', source: 'FOLLOWS' }, key());
  const current = await db.leadFollow.findUniqueOrThrow({ where: { id } });
  const input = {
    version: 1,
    schemaVersion: 1,
    values: { [t.fields.content]: '更新跟进', [t.fields.nextTime]: null },
  };
  await svc.saveRecord(t.id, id, input, key());
  assert.equal((await svc.record(second.id, id)).record.version, 2);
  await assert.rejects(svc.saveRecord(t.id, id, input, key()), code('COLLAB_RECORD_CONFLICT'));
  const denial = new CollaborationService(db, {
    ...svc.actor,
    permissionCodes: svc.actor.permissionCodes.filter((p) => p !== 'lead.follow.delete'),
  });
  await assert.rejects(
    denial.saveRecord(t.id, id, { version: 2, schemaVersion: 1, archived: true }, key()),
    code('COLLAB_FORBIDDEN'),
  );
  const mutation = key(),
    deletion = { version: 2, schemaVersion: 1, archived: true };
  const result = await svc.saveRecord(t.id, id, deletion, mutation);
  assert.deepEqual(await svc.saveRecord(t.id, id, deletion, mutation), result);
  assert.equal(await db.leadFollow.count({ where: { id, deletedAt: null } }), 0);
  assert.ok((await db.leadFollow.findUniqueOrThrow({ where: { id } })).deletedAt);
  assert.ok(await db.lead.findUnique({ where: { id: current.leadId } }));
  assert.equal((await svc.query(second.id, {})).total, 0);
  assert.equal(
    await db.operationLog.count({ where: { targetId: current.leadId, action: 'LEAD_FOLLOW_DELETE' } }),
    1,
  );
});
test('lead deletion hides its follows but protects converted customers and downstream business', async () => {
  const t = await table('LEADS'),
    follows = await table('FOLLOWS'),
    id = await seed('LEADS');
  await db.leadFollow.create({data:{leadId:id,type:'PHONE',content:'联系记录',createdBy:user}});
  const row = (await svc.record(t.id, id)).record;
  const input = { version: row.version, schemaVersion: 1, archived: true };
  await assert.rejects(withFailingCollaborationOutbox(db, () => svc.saveRecord(t.id, id, input, key())));
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id } })).deletedAt, null);
  await db.customer.create({
    data: {
      customerNo: key(),
      name: '转化客户',
      phone: '13800000000',
      phoneHash: key(),
      sourceLeadId: id,
      createdBy: user,
    },
  });
  await assert.rejects(svc.saveRecord(t.id, id, input, key()), code('LEAD_IN_USE'));
  await db.customer.deleteMany({ where: { sourceLeadId: id } });
  await svc.saveRecord(t.id, id, input, key());
  assert.equal((await svc.query(t.id, {})).total, 0);
  assert.equal((await svc.query(follows.id, {})).total, 0);
});
test('CRM field restrictions, reader and SELF scopes deny writes and follow creation', async () => {
  const t = await table('LEADS'),
    follow = await table('FOLLOWS'),
    id = await seed('LEADS');
  const other = await db.user.create({ data: { username: key(), password: 'unused' } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  const member = await db.collabMember.create({
    data: { workspaceId, principalId: other.id, role: 'READER', rowScope: 'ALL' },
  });
  const editor = new CollaborationService(db, {
    ...svc.actor,
    userId: other.id,
    employeeId: null,
    isSystemSuperAdmin: false,
  });
  const input = { version: 1, schemaVersion: 1, values: { [t.fields.name]: '不允许' } };
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FORBIDDEN'));
  assert.equal((await editor.describe(follow.id)).canCreateBusiness, false);
  await db.collabMember.update({
    where: { id: member.id },
    data: { role: 'EDITOR', readonlyFields: [t.fields.name] },
  });
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FIELD_UNAVAILABLE'));
  assert.equal((await editor.describe(t.id)).fields.find((f) => f.id === t.fields.phone)?.writable, false);
  await assert.rejects(
    editor.saveRecord(t.id, id, { ...input, values: { [t.fields.phone]: '138****0000' } }, key()),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  await db.collabMember.update({ where: { id: member.id }, data: { readonlyFields: [], rowScope: 'SELF' } });
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_NOT_FOUND'));
  await assert.rejects(
    editor.saveRecord(t.id, id, { version: 1, schemaVersion: 1, archived: true }, key()),
    code('COLLAB_NOT_FOUND'),
  );
});
test('CRM core and extension changes roll back together; lead phone hashes stay in sync', async () => {
  const t = await table('LEADS'),
    id = await seed('LEADS');
  const extra = await svc.saveField(t.id, undefined, { name: '备注', type: 'TEXT', version: 1 }, key());
  const schemaVersion = (await svc.describe(t.id)).table.schemaVersion;
  await assert.rejects(
    withFailingCollaborationOutbox(db, () =>
      svc.saveRecord(
        t.id,
        id,
        { schemaVersion, version: 1, values: { [t.fields.name]: '失败', [extra.id]: '失败' } },
        key(),
      ),
    ),
  );
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id } })).name, '原线索');
  assert.equal(await db.collabExtension.count({ where: { tableId: t.id } }), 0);
  await svc.saveRecord(
    t.id,
    id,
    { schemaVersion, version: 1, values: { [t.fields.phone]: '13900000000' } },
    key(),
  );
  const lead = await db.lead.findUniqueOrThrow({ where: { id } });
  assert.equal(lead.phone, '13900000000');
  assert.equal(lead.phoneHash, (await import('../../app/domain/crm/lead-policy')).hashPhone('13900000000'));
});

for (const source of ['COSTS', 'FOLLOWS', 'LEADS', 'CONTRACTS', 'CUSTOMERS', 'CHANNELS'])
  test(source + ' soft deletion can be restored and redone without losing canonical data', async () => {
    const t = await table(source),
      id = await seed(source);
    const removed = await svc.saveRecord(t.id, id, { schemaVersion: 1, version: 1, archived: true }, key());
    assert.equal((await svc.query(t.id, {})).total, 0);
    const denied = new CollaborationService(db, {
      ...svc.actor,
      permissionCodes: svc.actor.permissionCodes.filter((p) => !p.endsWith('.delete')),
    });
    await assert.rejects(
      denied.reverseRecordOperation(t.id, removed.operationId, { direction: 'undo' }, key()),
    );
    assert.equal((await svc.query(t.id, {})).total, 0);
    const restoreKey = key();
    const restored = await svc.reverseRecordOperation(
      t.id,
      removed.operationId,
      { direction: 'undo' },
      restoreKey,
    );
    assert.deepEqual(
      await svc.reverseRecordOperation(t.id, removed.operationId, { direction: 'undo' }, restoreKey),
      restored,
    );
    assert.equal((await svc.query(t.id, {})).records[0].id, id);
    await svc.reverseRecordOperation(t.id, removed.operationId, { direction: 'redo' }, key());
    assert.equal((await svc.query(t.id, {})).total, 0);
    assert.equal(await db.operationLog.count({ where: { targetId: id, action: 'WORKSHEET_UNDO' } }), 1);
  });
test('worksheet undo/redo restores deltas across consecutive edits and detects external changes', async () => {
  const t = await table('COSTS'),
    id = await seed('COSTS');
  const one = await svc.saveRecord(
    t.id,
    id,
    { schemaVersion: 1, version: 1, values: { [t.fields.amount]: '200.00' } },
    key(),
  );
  const two = await svc.saveRecord(
    t.id,
    id,
    { schemaVersion: 1, version: 2, values: { [t.fields.note]: '备注' } },
    key(),
  );
  await svc.reverseRecordOperation(t.id, two.operationId, { direction: 'undo' }, key());
  await svc.reverseRecordOperation(t.id, one.operationId, { direction: 'undo' }, key());
  assert.equal((await db.costEntry.findUniqueOrThrow({ where: { id } })).amount.toFixed(2), '100.00');
  await svc.reverseRecordOperation(t.id, one.operationId, { direction: 'redo' }, key());
  await svc.reverseRecordOperation(t.id, two.operationId, { direction: 'redo' }, key());
  const row = await db.costEntry.findUniqueOrThrow({ where: { id } });
  assert.equal(row.amount.toFixed(2), '200.00');
  assert.equal(row.note, '备注');
  await db.costEntry.update({ where: { id }, data: { amount: '900.00', version: { increment: 1 } } });
  await assert.rejects(
    svc.reverseRecordOperation(t.id, two.operationId, { direction: 'undo' }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal((await db.costEntry.findUniqueOrThrow({ where: { id } })).amount.toFixed(2), '900.00');
});
test('batch deletion rolls back records and recovery history on a stale row or outbox failure', async () => {
  const t = await table('COSTS'),
    first = await seed('COSTS'),
    second = await seed('COSTS');
  await assert.rejects(
    svc.deleteRecords(
      t.id,
      {
        schemaVersion: 1,
        records: [
          { id: first, version: 1 },
          { id: second, version: 99 },
        ],
      },
      key(),
    ),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal((await svc.query(t.id, {})).total, 2);
  assert.equal(await db.collabRecordOperation.count(), 0);
  await withFailingCollaborationOutbox(db, async () => {
    await assert.rejects(
      svc.deleteRecords(t.id, { schemaVersion: 1, records: [{ id: first, version: 1 }] }, key()),
    );
  });
  assert.equal(await db.collabRecordOperation.count(), 0);
  const deleted = await svc.deleteRecords(
    t.id,
    {
      schemaVersion: 1,
      records: [
        { id: first, version: 1 },
        { id: second, version: 1 },
      ],
    },
    key(),
  );
  assert.equal(deleted.records.length, 2);
  for (const row of deleted.records)
    await svc.reverseRecordOperation(t.id, row.operationId, { direction: 'undo' }, key());
  assert.equal((await svc.query(t.id, {})).total, 2);
});
test('unappointed workspace owner costs and null-organization contracts use the same visible business source', async () => {
  await db.user.update({ where: { id: user }, data: { employeeId: null } });
  svc = new CollaborationService(db, { ...svc.actor, employeeId: null });
  const t = await table('COSTS'),
    id = await seed('COSTS');
  assert.equal((await svc.query(t.id, {})).records[0].id, id);
  const contract = await seed('CONTRACTS');
  await db.contract.update({ where: { id: contract }, data: { branchId: null } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  assert.equal((await svc.contractChoices({ workspaceId, id: contract })).list[0].id, contract);
  const foreign = key();
  await db.organization.create({
    data: { id: foreign, code: foreign, name: '其他分所', type: 'BRANCH', path: '/' + foreign },
  });
  await db.contract.update({ where: { id: contract }, data: { branchId: foreign } });
  assert.equal((await svc.contractChoices({ workspaceId, id: contract })).total, 0);
  const denied = new CollaborationService(db, {
    ...svc.actor,
    permissionCodes: svc.actor.permissionCodes.filter((p) => p !== 'contract.read'),
  });
  await assert.rejects(denied.contractChoices({ workspaceId }));
});

test('undo never overwrites another writer between two commands by the same actor', async () => {
  const t = await table('COSTS'),
    id = await seed('COSTS');
  const one = await svc.saveRecord(
    t.id,
    id,
    { schemaVersion: 1, version: 1, values: { [t.fields.amount]: '200.00' } },
    key(),
  );
  await db.costEntry.update({ where: { id }, data: { amount: '800.00', version: { increment: 1 } } });
  const two = await svc.saveRecord(
    t.id,
    id,
    { schemaVersion: 1, version: 3, values: { [t.fields.amount]: '900.00' } },
    key(),
  );
  await svc.reverseRecordOperation(t.id, two.operationId, { direction: 'undo' }, key());
  assert.equal((await db.costEntry.findUniqueOrThrow({ where: { id } })).amount.toFixed(2), '800.00');
  await assert.rejects(
    svc.reverseRecordOperation(t.id, one.operationId, { direction: 'undo' }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
});
test('custom row creation, editing and deletion all retain recoverable data', async () => {
  const t = await table('CUSTOM');
  const field = await svc.saveField(t.id, undefined, { name: '内容', type: 'TEXT', version: 1 }, key());
  const schemaVersion = (await svc.describe(t.id)).table.schemaVersion;
  const created = await svc.saveRecord(
    t.id,
    undefined,
    {
      schemaVersion,
      values: {
        ...Object.fromEntries(t.detail.fields.filter((f) => f.required).map((f) => [f.id, '测试记录'])),
        [field.id]: '原始内容',
      },
    },
    key(),
  );
  await svc.reverseRecordOperation(t.id, created.operationId, { direction: 'undo' }, key());
  assert.equal((await svc.query(t.id, {})).total, 0);
  const trash = await svc.recordOperations(t.id, { trash: 'true' });
  assert.ok(!Array.isArray(trash) && trash.rows.some((r) => r.id === created.operationId));
  await svc.saveField(
    t.id,
    undefined,
    { name: '新必填字段', type: 'TEXT', required: true, defaultValue: '默认内容', version: schemaVersion },
    key(),
  );
  await svc.reverseRecordOperation(t.id, created.operationId, { direction: 'redo' }, key());
  assert.equal((await svc.record(t.id, created.id)).record.values[field.id], '原始内容');
});
test('all worksheet source families describe and query through the common permission-aware component', async () => {
  const { domainSources } = await import('../../app/application/crm/workspace-domain-source');
  for (const source of ['CUSTOM', 'LEADS', 'FOLLOWS', ...Object.keys(domainSources)]) {
    if (source === 'INVENTORY_MOVEMENTS' || source === 'INVENTORY_STOCKTAKES') {
      await assert.rejects(table(source),code('COLLAB_INVALID_SOURCE')); continue;
    }
    const t = await table(source);
    assert.equal(t.detail.table.source, source);
    const result = await svc.query(t.id, {});
    assert.equal(result.total, 0, source);
    assert.ok(
      t.detail.fields.every((field) => typeof field.writable === 'boolean'),
      source,
    );
  }
});

test('central worksheet roles enforce record conditions, masks, read-only convergence, preview and grant union',async()=>{
  const {WorksheetPermissions}=await import('../../app/application/collaboration/worksheet-permissions');
  const {defaultRule}=await import('../../app/application/collaboration/worksheet-roles');
  const policy=new WorksheetPermissions(db,svc.actor);
  const t=await table('CUSTOM');
  const column=t.detail.fields.find(f=>f.type==='TEXT')!;
  const secret=await svc.saveField(t.id,undefined,{name:'联系资料',type:'TEXT',version:1},key());
  const added=await svc.saveRecord(t.id,undefined,{values:{[column.id]:'公开',[secret.id]:'内部资料'},schemaVersion:2},key());
  const blocked=await svc.saveRecord(t.id,undefined,{values:{[column.id]:'私有',[secret.id]:'私有资料'},schemaVersion:2},key());
  const role=(await db.role.create({data:{code:key(),name:'业务阅读',type:'BUSINESS'}})).id;
  const account=await db.user.create({data:{username:key(),password:'unused',userRoles:{create:{roleId:role}}}});
  const member = new CollaborationService(db,{...svc.actor,userId:account.id,employeeId:null,isSystemSuperAdmin:false});
  const rule={...defaultRule('READER'),add:true,remove:true,rows:'FILTER',filter:{fieldId:column.id,operator:'eq',value:'公开'},fields:{[secret.id]:'MASK'}};
  await policy.change(t.id,{roleId:role,rule,version:0},false);
  await assert.rejects(policy.change(t.id,{roleId:role,rule,version:0},false),code('COLLAB_ACCESS_CONFLICT'));
  assert.ok((await member.listTables(base)).tables.some(item=>item.id===t.id));
  const data=await member.query(t.id,{});
  assert.equal(data.total,1); assert.equal(data.records[0].values[secret.id],'******');
  await assert.rejects(member.record(t.id,blocked.id),code('COLLAB_NOT_FOUND'));
  await assert.rejects(member.saveRecord(t.id,added.id,{values:{[column.id]:'改动'},schemaVersion:2,version:1},key()),code('COLLAB_FORBIDDEN'));
  const preview=await policy.preview(t.id,{target:'MEMBER',id:account.id});
  assert.equal(preview.canDelete,false);assert.equal(preview.total,1);assert.equal(preview.records[0].values[secret.id],'******');
  const role2=(await db.role.create({data:{code:key(),name:'业务编辑',type:'BUSINESS'}})).id;
  await db.userRole.create({data:{userId:account.id,roleId:role2}});
  await policy.change(t.id,{roleId:role2,rule:{...defaultRule('EDITOR'),rows:'FILTER',filter:{fieldId:column.id,operator:'eq',value:'私有'}},version:1},false);
  const merged=await member.query(t.id,{});
  assert.equal(merged.total,2);
  assert.equal(merged.records.find(r=>r.id===added.id)?.values[secret.id],'******');
  assert.equal(merged.records.find(r=>r.id===blocked.id)?.values[secret.id],'私有资料');
  const v=t.detail.views[0].id;
  await policy.change(t.id,{roleId:role,rule:{...rule,viewIds:[v]},version:2},false);
  await policy.change(t.id,{roleId:role2,rule:{...defaultRule('READER'),viewIds:[]},version:3},false);
  assert.deepEqual((await member.describe(t.id)).views.map(x=>x.id),[v]);
  await assert.rejects(member.query(t.id,{viewId:'unauthorized-view'}),code('COLLAB_FORBIDDEN'));
  await policy.change(t.id,{roleId:role,rule:{...rule,viewIds:[]},version:4},false);
  await assert.rejects(member.query(t.id,{}),code('COLLAB_FORBIDDEN'));
});

test('private worksheet preset preview applies saved row and field rules within the viewer access', async () => {
  const { WorksheetPermissions } = await import('../../app/application/collaboration/worksheet-permissions');
  const { defaultRule } = await import('../../app/application/collaboration/worksheet-roles');
  const policy = new WorksheetPermissions(db, svc.actor);
  const t = await table('CUSTOM');
  const title = t.detail.fields.find(f => f.type === 'TEXT')!;
  const secret = await svc.saveField(t.id, undefined, { name: '内部备注', type: 'TEXT', version: 1 }, key());
  for (const label of ['公开', '内部']) {
    await svc.saveRecord(t.id, undefined, { values: { [title.id]: label, [secret.id]: label }, schemaVersion: 2 }, key());
  }
  await db.collabBase.update({ where: { id: base }, data: { accessPolicy: { restricted: true, grants: [] } } });
  const subject = { target: 'PRESET', id: 'EDITOR' };
  const rule = {
    ...defaultRule('READER'), rows: 'FILTER', filter: { fieldId: title.id, operator: 'eq', value: '公开' },
    fields: { [secret.id]: 'MASK' },
  };
  await policy.change(t.id, { roleId: 'EDITOR', rule, version: 0 }, false);
  const preview = await policy.preview(t.id, subject);
  assert.equal(preview.total, 1);
  assert.equal(preview.records[0].values[title.id], '公开');
  assert.equal(preview.records[0].values[secret.id], '******');
  assert.equal(preview.canEdit, false);
  const outsider = new WorksheetPermissions(db, { ...svc.actor, userId: key(), employeeId: null });
  await assert.rejects(outsider.preview(t.id, subject), code('WORKSHEET_PREVIEW_VIEWER_DENIED'));
  await policy.change(t.id, { roleId: 'EDITOR', rule: { ...defaultRule('EDITOR'), rows: 'SELF' }, version: 1 }, false);
  assert.equal((await policy.preview(t.id, subject)).total, 0);
  await policy.change(t.id, { roleId: 'EDITOR', rule: defaultRule('DENY'), version: 2 }, false);
  await assert.rejects(policy.preview(t.id, subject), code('WORKSHEET_PREVIEW_TARGET_DENIED'));
});

test('worksheet case creation enforces required extensions and saves canonical and worksheet fields atomically',async()=>{
  const {CaseService}=await import('../../app/application/case/case-service');
  const cases=new CaseService(db,{actorUserId:user},svc.actor);
  const t=await table('CASES'), customerId=await seed('CUSTOMERS');
  const extra=await svc.saveField(t.id,undefined,{name:'内部案号备注',type:'TEXT',version:1},key());
  await db.collabField.update({where:{id:extra.id},data:{required:true}});
  const input={customerId,caseType:'民事纠纷',lawyerId:employee,branchId:org,worksheetId:t.id};
  await assert.rejects(cases.createCase(input),code('COLLAB_REQUIRED_FIELD'));
  assert.equal(await db.case.count(),0);
  const created=await cases.createCase({...input,worksheetValues:{[extra.id]:'所内编号'}});
  assert.equal((await svc.record(t.id,created.id)).record.values[extra.id],'所内编号');
});
