import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { administrativeFields, administrativeKinds, administrativeNames, AdministrativeKind } from '../../app/application/collaboration/administrative-registers';
import { standardizeAdministrativeRegisters } from '../../scripts/maintenance/standardize-administrative-registers';

let db: PrismaClient, admin: DriveService, root: string, workspace: string, base: string, table: string;
const context = (userId: string, superAdmin = true, codes = PERMISSION_CATALOG.map(p => p.code)): AuthorizationContext => ({
  userId, employeeId: null, isSystemSuperAdmin: superAdmin, isSystemAdmin: false, permissionCodes: codes,
  evaluatedAt: new Date(), fieldRules: [], grants: PERMISSION_CATALOG.filter(p => codes.includes(p.code)).map(p => ({
    sourceType: 'ROLE', sourceId: 'fixture', permissionCode: p.code, resource: p.resource, scopeIds: ['ALL'], validUntil: null,
  })),
});
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({ data: { id: org, code: key(), name: '费用回归律所', type: 'FIRM', path: '/' + org } });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  root = (await admin.createWorkspace({ name: '律所', organizationId: org }, key())).id;
  workspace = (await admin.provisionModuleWorkspace(root, { source: 'INVENTORY_MOVEMENTS' }, key())).id;
  base = (await admin.createDriveBase(workspace, { name: '行政事务', moduleSource: 'INVENTORY_MOVEMENTS', connectBusiness: true }, key())).id;
  table = (await db.collabTable.findFirstOrThrow({ where: { baseId: base } })).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
async function peer(role: string, self = false, hiddenFields: string[] = []) {
  const user = await db.user.create({ data: { username: key(), password: 'unused' } });
  const businessRole = await db.role.create({ data: { code: key(), name: '行政测试角色' + key(), type: 'BUSINESS' } });
  await db.userRole.create({ data: { userId: user.id, roleId: businessRole.id } });
  await admin.saveMember(workspace, { principalType: 'ROLE', principalId: businessRole.id, role, rowScope: self ? 'SELF' : 'ALL', canCreate: role === 'EDITOR', baseId: base, hiddenFields }, key());
  return new DriveService(db, context(user.id, false, ['inventory.read']));
}
async function sheet(kind:AdministrativeKind) {
  const t=await admin.createTable(base,{name:administrativeNames[kind],template:kind},key());
  const detail=await admin.describe(t.id);
  return {id:t.id,detail,f:Object.fromEntries(detail.fields.map(f=>[f.name,f.id]))};
}
const sample:Record<AdministrativeKind,Record<string,unknown>>={
  ADMIN_SEAL:{申请人:'测试申请人'},
  ADMIN_SENT:{来文单位:'测试单位',文件标题:'文件标题\n第二行',收文人:'登记人'},
  ADMIN_RECEIVED:{文件标题:'测试公文',主送单位:'测试单位',印发份数:2},
  ADMIN_MEETINGS:{会议名称:'测试会议',会议时间:'2026-10-27T08:30:00+08:00',会议地点:'会议室',主持人:'甲',记录人:'乙'},
};
function save(t:Awaited<ReturnType<typeof sheet>>,data:Record<string,unknown>,svc=admin) {
  return svc.saveRecord(t.id,undefined,{schemaVersion:t.detail.table.schemaVersion,values:Object.fromEntries(Object.entries(data).map(([k,v])=>[t.f[k],v]))},key());
}
test('four schemas share editable records, defaults, attachments, scoped permissions and reversible deletion',async()=>{
  const editor=await peer('EDITOR'),reader=await peer('READER'),self=await peer('EDITOR',true);
  const counts=[6,15,17,15];
  for(const [index,kind] of administrativeKinds.entries()) {
    const t=await sheet(kind);
    assert.equal(t.detail.fields.length,counts[index]);
    assert.deepEqual(t.detail.fields.map(f=>[f.name,f.type,f.required]),administrativeFields(kind).map(f=>[f.name,f.type,f.required]));
    assert.equal(t.detail.fields[0].writable,false);
    await assert.rejects(save(t,{},editor),/COLLAB_REQUIRED_FIELD/);
    const fileField=t.detail.fields.find(f=>f.type==='FILE')!;
    const file=await db.collabAttachment.create({data:{tableId:t.id,ownerId:editor.actor.userId,name:'测试.pdf',mimeType:'application/pdf',size:8,storageKey:key()}});
    const a=await save(t,{...sample[kind],[fileField.name]:[file.id]},editor);
    const loaded=await editor.record(t.id,a.id);
    assert.deepEqual(loaded.record.values[fileField.id],[file.id]);
    const time=t.detail.fields.find(f=>(f.options as {defaultNow?:boolean}).defaultNow);
    if(time) assert.ok(Date.now()-Date.parse(String(loaded.record.values[time.id]))<60000);
    if(kind==='ADMIN_SENT') assert.equal(loaded.record.values[t.f['收文份数']],1);
    assert.deepEqual((await admin.query(t.id,{})).records,(await reader.query(t.id,{})).records);
    assert.equal((await self.query(t.id,{})).total,0);
    await assert.rejects(save(t,sample[kind],reader),/COLLAB_FORBIDDEN/);
    const editName=kind==='ADMIN_SEAL'?'申请事项':'备注';
    const edit=await editor.saveRecord(t.id,a.id,{schemaVersion:1,version:1,values:{[t.f[editName]]:'编辑后\n保留多行'}},key());
    if(time) assert.equal((await editor.record(t.id,a.id)).record.values[time.id],loaded.record.values[time.id]);
    await editor.reverseRecordOperation(t.id,edit.operationId,{direction:'undo'},key());
    await editor.reverseRecordOperation(t.id,edit.operationId,{direction:'redo'},key());
    const b=await save(t,sample[kind],editor);
    const rows=(await editor.query(t.id,{})).records;
    await assert.rejects(reader.deleteRecords(t.id,{schemaVersion:1,records:[{id:b.id,version:1}]},key()),/COLLAB_FORBIDDEN/);
    await editor.deleteRecords(t.id,{schemaVersion:1,records:rows.map(r=>({id:r.id,version:r.version}))},key());
    assert.equal((await admin.query(t.id,{})).total,0);
    for(const op of (await editor.recordOperations(t.id,{trash:'true'})).rows) await editor.reverseRecordOperation(t.id,op.id,{direction:'undo'},key());
    assert.equal((await admin.query(t.id,{})).total,2);
    assert.deepEqual((await editor.record(t.id,a.id)).record.values[fileField.id],[file.id]);
    assert.ok((await editor.record(t.id,a.id)).revisions.length>3);
  }
});

test('seal review is enforced for edits, paste and undo after permission revocation',async()=>{
  const t=await sheet('ADMIN_SEAL'),applicant=await peer('EDITOR'),reviewerBase=await peer('EDITOR');
  const reviewer=new DriveService(db,context(reviewerBase.actor.userId,false,['inventory.read','inventory.seal.review']));
  const row=await save(t,sample.ADMIN_SEAL,applicant),review=t.f['审核意见'];
  assert.equal((await applicant.describe(t.id)).fields.find(f=>f.id===review)!.writable,false);
  assert.equal((await reviewer.describe(t.id)).fields.find(f=>f.id===review)!.writable,true);
  const approved=JSON.stringify({decision:'同意',reason:'已核对'});
  await assert.rejects(applicant.saveRecord(t.id,row.id,{schemaVersion:1,version:1,values:{[review]:approved}},key()),/COLLAB_READONLY_FIELD/);
  await assert.rejects(save(t,{...sample.ADMIN_SEAL,审核意见:approved},applicant),/COLLAB_READONLY_FIELD/);
  await assert.rejects(applicant.saveRecords(t.id,{schemaVersion:1,records:[{id:row.id,version:1,values:{[review]:approved}}]},key()),/COLLAB_READONLY_FIELD/);
  await assert.rejects(reviewer.saveRecord(t.id,row.id,{schemaVersion:1,version:1,values:{[review]:JSON.stringify({decision:'驳回',reason:''})}},key()),/COLLAB_REVIEW_REASON_REQUIRED/);
  const approval=await reviewer.saveRecord(t.id,row.id,{schemaVersion:1,version:1,values:{[review]:approved}},key());
  assert.equal((await applicant.record(t.id,row.id)).record.values[review],approved);
  await assert.rejects(reviewerBase.reverseRecordOperation(t.id,approval.operationId,{direction:'undo'},key()),/COLLAB_READONLY_FIELD/);
  await reviewer.reverseRecordOperation(t.id,approval.operationId,{direction:'undo'},key());
  await reviewer.reverseRecordOperation(t.id,approval.operationId,{direction:'redo'},key());
  assert.equal((await admin.record(t.id,row.id)).record.values[review],approved);
  assert.ok(await db.operationLog.count({where:{userId:reviewer.actor.userId}})>0);
});

test('meeting numbers remain unique through concurrent writes and restores; counts reject fractions',async()=>{
  const t=await sheet('ADMIN_MEETINGS');
  await assert.rejects(save(t,{...sample.ADMIN_MEETINGS,应到人数:-1}),/COLLAB_NONNEGATIVE_INTEGER_REQUIRED/);
  await assert.rejects(save(t,{...sample.ADMIN_MEETINGS,实到人数:1.5}),/COLLAB_NONNEGATIVE_INTEGER_REQUIRED/);
  const results=await Promise.allSettled([save(t,{...sample.ADMIN_MEETINGS,会议编号:'MT-001'}),save(t,{...sample.ADMIN_MEETINGS,会议编号:'MT-001'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const row=(await admin.query(t.id,{})).records[0];
  await admin.deleteRecords(t.id,{schemaVersion:1,records:[{id:row.id,version:row.version}]},key());
  const op=(await admin.recordOperations(t.id,{trash:'true'})).rows[0];
  await save(t,{...sample.ADMIN_MEETINGS,会议编号:'MT-001'});
  await assert.rejects(admin.reverseRecordOperation(t.id,op.id,{direction:'undo'},key()),/COLLAB_MEETING_NUMBER_DUPLICATE/);
});

test('registration migration retains IDs and ACLs, clears obsolete visible fields and leaves expenses intact',async()=>{
  const before=await db.collabTable.findUniqueOrThrow({where:{id:table},include:{fields:true,views:true,records:true}});
  const original=[];
  for(const kind of administrativeKinds) original.push(await admin.createTable(base,{name:administrativeNames[kind]},key()));
  const reader=await peer('READER');
  await standardizeAdministrativeRegisters(db,admin.actor.userId,true);
  for(const [index,t] of original.entries()) {
    const detail=await reader.describe(t.id);
    assert.deepEqual(detail.fields.map(f=>f.name),administrativeFields(administrativeKinds[index]).map(f=>f.name));
    assert.equal(detail.access.level,1);
    assert.ok(detail.views.every(v=>JSON.stringify(v.config).includes(detail.fields[0].id)));
  }
  assert.deepEqual(await db.collabTable.findUniqueOrThrow({where:{id:table},include:{fields:true,views:true,records:true}}),before);
  assert.ok((await standardizeAdministrativeRegisters(db,admin.actor.userId,true)).every(r=>!r.changed));
  const unsafeBase=await admin.createDriveBase(workspace,{name:'保留数据测试',moduleSource:'INVENTORY_MOVEMENTS'},key());
  const unsafe=await admin.createTable(unsafeBase.id,{name:'用印登记'},key());
  const field=(await admin.describe(unsafe.id)).fields[0];
  await admin.saveRecord(unsafe.id,undefined,{schemaVersion:1,values:{[field.id]:'不可丢失'}},key());
  await assert.rejects(standardizeAdministrativeRegisters(db,admin.actor.userId,true),/原表已有记录/);
  assert.equal((await admin.query(unsafe.id,{})).total,1);
});
