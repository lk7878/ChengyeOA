import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { caseArchiveFields, caseArchiveKinds, caseArchiveNames, CaseArchiveKind } from '../../app/application/collaboration/case-archive-worksheets';
import { standardizeCaseArchives } from '../../scripts/maintenance/standardize-case-archives';

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
  await db.organization.create({ data: { id: org, code: key(), name: '归档回归律所', type: 'FIRM', path: '/' + org } });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  root = (await admin.createWorkspace({ name: '律所', organizationId: org }, key())).id;
  workspace = (await admin.provisionModuleWorkspace(root, { source: 'CASES' }, key())).id;
  base = (await admin.createDriveBase(workspace, { name: '案件管理', moduleSource: 'CASES', connectBusiness: true }, key())).id;
  table = (await db.collabTable.findFirstOrThrow({ where: { baseId: base } })).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
async function peer(role: string, self = false, hiddenFields: string[] = []) {
  const user = await db.user.create({ data: { username: key(), password: 'unused' } });
  const businessRole = await db.role.create({ data: { code: key(), name: '档案测试角色' + key(), type: 'BUSINESS' } });
  await db.userRole.create({ data: { userId: user.id, roleId: businessRole.id } });
  await admin.saveMember(workspace, { principalType: 'ROLE', principalId: businessRole.id, role, rowScope: self ? 'SELF' : 'ALL', canCreate: role === 'EDITOR', baseId: base, hiddenFields }, key());
  return new DriveService(db, context(user.id, false, ['case.read']));
}
async function sheet(kind:CaseArchiveKind) {
  const t=await admin.createTable(base,{name:caseArchiveNames[kind],template:kind},key());
  const detail=await admin.describe(t.id);
  return {id:t.id,detail,f:Object.fromEntries(detail.fields.map(f=>[f.name,f.id]))};
}

const sample:Record<CaseArchiveKind,Record<string,unknown>>={
 CASE_ARCHIVE_REVIEW:{审理时间:'2026-10-28T00:00:00+08:00',合同编号:'HT-001',当事人:'测试当事人',案件类型:'民事',是否盖章归档:'否',质保金是否签字:'不涉及'},
 CASE_ARCHIVE_REGISTER:{归档时间:'2026-10-28T00:00:00+08:00',类型:'民事',档号:'卷-001',案由:'合同纠纷',当事人:'测试当事人',律师:'测试律师'},
 CASE_ARCHIVE_OFFLINE:{归档时间:'2026-10-28T00:00:00+08:00',类型:'非诉',档号:'卷-001',案由:'合同纠纷',当事人:'测试当事人',律师:'测试律师'},
};
function save(t:Awaited<ReturnType<typeof sheet>>,data:Record<string,unknown>,svc=admin) {
 return svc.saveRecord(t.id,undefined,{schemaVersion:t.detail.table.schemaVersion,values:Object.fromEntries(Object.entries(data).map(([k,v])=>[t.f[k],v]))},key());
}
test('archive schemas, shared inline edits, required values, attachments, soft delete and undo/redo',async()=>{
 const editor=await peer('EDITOR'),reader=await peer('READER'),self=await peer('EDITOR',true);
 for(const [i,kind] of caseArchiveKinds.entries()) {
  const t=await sheet(kind),schemaVersion=t.detail.table.schemaVersion;
  assert.equal(t.detail.fields.length,[9,12,12][i]);
  assert.deepEqual(t.detail.fields.map(f=>[f.name,f.type,f.required]),caseArchiveFields(kind).map(f=>[f.name,f.type,f.required]));
  assert.equal(t.detail.fields[0].writable,false);
  assert.ok(t.detail.fields.slice(1).every(f=>f.writable));
  await assert.rejects(save(t,{},editor),/COLLAB_REQUIRED_FIELD/);
  await assert.rejects(save(t,sample[kind],reader),/COLLAB_FORBIDDEN/);
  const a=await save(t,sample[kind],editor);
  assert.deepEqual((await admin.query(t.id,{})).records,(await reader.query(t.id,{})).records);
  assert.equal((await self.query(t.id,{})).total,0);
  const column=kind==='CASE_ARCHIVE_REVIEW'?'问题':'备注';
  const edit=await editor.saveRecord(t.id,a.id,{schemaVersion,version:1,values:{[t.f[column]]:'已检查'}},key());
  assert.equal((await reader.record(t.id,a.id)).record.values[t.f[column]],'已检查');
  await editor.reverseRecordOperation(t.id,edit.operationId,{direction:'undo'},key());
  await editor.reverseRecordOperation(t.id,edit.operationId,{direction:'redo'},key());
  if(kind==='CASE_ARCHIVE_REVIEW') {
   await assert.rejects(save(t,{...sample[kind],是否盖章归档:'不涉及'},editor),/COLLAB_INVALID_OPTION/);
   const file=await db.collabAttachment.create({data:{tableId:t.id,ownerId:editor.actor.userId,name:'凭证.pdf',mimeType:'application/pdf',size:8,storageKey:key()}});
   const row=(await editor.record(t.id,a.id)).record;
   await editor.saveRecord(t.id,a.id,{schemaVersion,version:row.version,values:{[t.f['质保金结算凭证']]:[file.id],[t.f['是否盖章归档']]:'是'}},key());
   assert.equal((await reader.attachment(t.id,file.id)).id,file.id);
   await assert.rejects(self.attachment(t.id,file.id),/COLLAB_FORBIDDEN/);
  }
  await save(t,{...sample[kind],...(kind!=='CASE_ARCHIVE_REVIEW'?{档号:'卷-002'}:{})},editor);
  const rows=(await editor.query(t.id,{})).records;
  await assert.rejects(reader.deleteRecords(t.id,{schemaVersion,records:rows.map(r=>({id:r.id,version:r.version}))},key()),/COLLAB_FORBIDDEN/);
  await editor.deleteRecords(t.id,{schemaVersion,records:rows.map(r=>({id:r.id,version:r.version}))},key());
  assert.equal((await admin.query(t.id,{})).total,0);
  assert.equal(await db.collabRecord.count({where:{tableId:t.id,archived:true}}),2);
  for(const op of (await editor.recordOperations(t.id,{trash:'true'})).rows) await editor.reverseRecordOperation(t.id,op.id,{direction:'undo'},key());
  assert.equal((await admin.query(t.id,{})).total,2);
  assert.ok((await editor.record(t.id,a.id)).revisions.length>=4);
  assert.ok(await db.operationLog.count({where:{action:'CASE_ARCHIVE_DELETE',targetId:a.id}}));
  assert.ok(await db.operationLog.count({where:{action:'WORKSHEET_UNDO'}}));
 }
});
test('duplicate archive numbers fail atomically in concurrent create, edit, paste and restoration',async()=>{
 const t=await sheet('CASE_ARCHIVE_REGISTER');
 const attempts=await Promise.allSettled([save(t,sample.CASE_ARCHIVE_REGISTER),save(t,sample.CASE_ARCHIVE_REGISTER)]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.match(String((attempts.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/COLLAB_ARCHIVE_NUMBER_DUPLICATE/);
 const b=await save(t,{...sample.CASE_ARCHIVE_REGISTER,档号:'卷-002'});
 await assert.rejects(admin.saveRecord(t.id,b.id,{schemaVersion:1,version:1,values:{[t.f['档号']]:'卷-001'}},key()),/COLLAB_ARCHIVE_NUMBER_DUPLICATE/);
 await assert.rejects(admin.saveRecords(t.id,{schemaVersion:1,records:[{id:b.id,version:1,values:{[t.f['档号']]:'卷-001'}}]},key()),/COLLAB_ARCHIVE_NUMBER_DUPLICATE/);
 const a=(await admin.query(t.id,{})).records.find(r=>r.id!==b.id)!;
 await admin.deleteRecords(t.id,{schemaVersion:1,records:[{id:a.id,version:a.version}]},key());
 const op=(await admin.recordOperations(t.id,{trash:'true'})).rows[0];
 await save(t,sample.CASE_ARCHIVE_REGISTER);
 await assert.rejects(admin.reverseRecordOperation(t.id,op.id,{direction:'undo'},key()),/COLLAB_ARCHIVE_NUMBER_DUPLICATE/);
 assert.equal((await admin.query(t.id,{})).total,2);
});
test('archive tables stay inside the cases module and need case read plus table access',async()=>{
 const t=await sheet('CASE_ARCHIVE_REVIEW'),editor=await peer('EDITOR');
 const revoked=new DriveService(db,context(editor.actor.userId,false,['inventory.read']));
 await assert.rejects(revoked.describe(t.id),/COLLAB_FORBIDDEN/);
 await assert.rejects(revoked.saveRecord(t.id,undefined,{schemaVersion:1,values:{}},key()),/COLLAB_FORBIDDEN/);
 const other=await admin.createDriveBase(root,{name:'普通工作表'},key());
 await assert.rejects(admin.createTable(other.id,{name:'错误位置',template:'CASE_ARCHIVE_REVIEW'},key()),/COLLAB_MODULE_WORKSPACE_MISMATCH/);
 assert.equal(await db.collabTable.count({where:{baseId:other.id,inventoryKind:'CASE_ARCHIVE_REVIEW'}}),0);
 await assert.rejects(admin.saveField(t.id,undefined,{name:'冗余',type:'TEXT'},key()),/COLLAB_READONLY_FIELD/);
});
test('archive migration retains table and ACL identities, replaces all visible schemas, and preserves case data',async()=>{
 const before=await db.collabTable.findUniqueOrThrow({where:{id:table},include:{fields:true,views:true}});
 const original=[];
 for(const kind of caseArchiveKinds) original.push(await admin.createTable(base,{name:caseArchiveNames[kind]},key()));
 const reader=await peer('READER');
 const grants=await db.collabMember.findMany({orderBy:{id:'asc'}});
 await standardizeCaseArchives(db,admin.actor.userId,true);
 for(const [i,t] of original.entries()) {
  const detail=await reader.describe(t.id);
  assert.deepEqual(detail.fields.map(f=>f.name),caseArchiveFields(caseArchiveKinds[i]).map(f=>f.name));
  assert.equal(detail.fields.some(f=>f.name==='标题'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.views[0].config)),{visibleFields:detail.fields.map(f=>f.id)});
 }
 assert.deepEqual(await db.collabMember.findMany({orderBy:{id:'asc'}}),grants);
 assert.deepEqual(await db.collabTable.findUniqueOrThrow({where:{id:table},include:{fields:true,views:true}}),before);
 assert.ok((await standardizeCaseArchives(db,admin.actor.userId)).every(r=>!r.changed));
 assert.equal(await db.collabRecord.count(),0);
});
