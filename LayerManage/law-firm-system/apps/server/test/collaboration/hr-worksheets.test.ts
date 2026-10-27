import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DriveService } from '../../app/application/collaboration/drive-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hrFields,hrKinds,hrNames,HrKind } from '../../app/application/collaboration/hr-worksheets';
import { standardizeHrWorksheets } from '../../scripts/maintenance/standardize-hr-worksheets';

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
  await db.organization.create({ data: { id: org, code: key(), name: '人事回归律所', type: 'FIRM', path: '/' + org } });
  const user = await db.user.create({ data: { username: 'owner', password: 'unused' } });
  admin = new DriveService(db, context(user.id));
  root = (await admin.createWorkspace({ name: '律所', organizationId: org }, key())).id;
  workspace = (await admin.provisionModuleWorkspace(root, { source: 'INVENTORY_STOCKTAKES' }, key())).id;
  base = (await admin.createDriveBase(workspace, { name: '人力资源', moduleSource: 'INVENTORY_STOCKTAKES', connectBusiness: true }, key())).id;
  table = (await db.collabTable.findFirstOrThrow({ where: { baseId: base } })).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });

async function peer(codes:AuthorizationContext['permissionCodes']) {
  const user=await db.user.create({data:{username:key(),password:'unused'}});
  const role=await db.role.create({data:{code:key(),name:key(),type:'BUSINESS'}});
  await db.userRole.create({data:{userId:user.id,roleId:role.id}});
  await admin.saveMember(workspace,{principalType:'ROLE',principalId:role.id,role:'EDITOR',rowScope:'ALL',canCreate:true,baseId:base},key());
  return new DriveService(db,context(user.id,false,codes));
}
async function sheet(kind:HrKind) {
  const t=kind==='HR_ROSTER'?{id:table}:await admin.createTable(base,{name:hrNames[kind],template:kind},key());
  const detail=await admin.describe(t.id);
  const f=Object.fromEntries(detail.fields.map(f=>[f.name,f.id]));
  const values=Object.fromEntries(detail.fields.filter(f=>f.required).map(f=>[f.id,f.type==='DATETIME'?(f.name==='入职时间'?'2024.06':'2024-07-01T00:00:00+08:00'):f.type==='NUMBER'?3:f.type==='SINGLE_SELECT'?(f.options as {choices:{id:string}[]}).choices[0].id:'回归测试']));
  return {...t,detail,f,values};
}
test('all eight HR schemas provide CRUD, month precision, read-only role, private masking, encrypted history and reversible deletion',async()=>{
  const editor=await peer(['hr.worksheet.read','hr.worksheet.manage','hr.worksheet.sensitive']);
  const reader=await peer(['hr.worksheet.read']);
  const inventory=await peer(['inventory.read']);
  for(const [i,kind] of hrKinds.entries()) {
    const t=await sheet(kind), schemaVersion=t.detail.table.schemaVersion;
    assert.equal(t.detail.fields.length,[25,12,6,11,11,9,56,10][i]);
    assert.deepEqual(t.detail.fields.map(f=>[f.name,f.type,f.required]),hrFields(kind).map(f=>[f.name,f.type,f.required]));
    await assert.rejects(inventory.describe(t.id),/COLLAB_FORBIDDEN/);
    const privateField=t.detail.fields.find(f=>(f.options as {hrSensitive?:boolean}).hrSensitive&&f.type==='TEXT')!;
    const identity=t.detail.fields.find(f=>(f.options as {hrIdentity?:boolean}).hrIdentity);
    const privateValue=identity&&privateField.id===identity.id?'110101199001011234':'保密测试手机号';
    const values={...t.values,...(t.f['入职时间']?{[t.f['入职时间']]:'2024.06'}:{}),[privateField.id]:privateValue,...(identity?{[identity.id]:'110101199001011234'}:{})};
    const a=await editor.saveRecord(t.id,undefined,{schemaVersion,values},key());
    assert.equal((await admin.record(t.id,a.id)).record.values[privateField.id],privateValue);
    assert.equal((await reader.query(t.id,{})).total,1);
    assert.ok((await reader.describe(t.id)).fields.every(f=>!f.writable));
    await assert.rejects(reader.saveRecord(t.id,a.id,{schemaVersion,version:1,values:{}},key()),/COLLAB_FORBIDDEN/);
    const read=JSON.stringify(await reader.record(t.id,a.id));
    assert.ok(!read.includes(privateValue)); assert.ok(!read.includes('110101199001011234'));assert.ok(!read.includes('hr:v1:'));
    const raw=await db.collabRecord.findUniqueOrThrow({where:{id:a.id},include:{revisions:true}});
    const recovery=await db.collabRecordOperation.findMany({where:{recordId:a.id}});
    assert.ok(!JSON.stringify([raw,recovery]).includes(privateValue));
    assert.ok(!JSON.stringify([raw,recovery]).includes('110101199001011234'));
    const month=t.f['入职时间'];
    if(month) {
      assert.equal((await admin.record(t.id,a.id)).record.values[month],'2024-06');
      assert.equal((await editor.query(t.id,{config:{sorts:[{fieldId:month,direction:'asc'}]}})).total,1);
    }
    if(t.f['年龄']) assert.equal((await admin.record(t.id,a.id)).record.values[t.f['年龄']],new Date().getFullYear()-1990);
    for(const config of [{sorts:[{fieldId:privateField.id,direction:'asc'}]},{groupBy:[privateField.id]},{filter:{fieldId:privateField.id,operator:'eq',value:privateValue}}]) await assert.rejects(reader.query(t.id,{config}),/COLLAB_PRIVATE_FIELD_QUERY/);
    const edited=await editor.saveRecord(t.id,a.id,{schemaVersion,version:1,values:{[privateField.id]:'保密更新值'}},key());
    await editor.reverseRecordOperation(t.id,edited.operationId,{direction:'undo'},key());
    assert.equal((await admin.record(t.id,a.id)).record.values[privateField.id],privateValue);
    await editor.reverseRecordOperation(t.id,edited.operationId,{direction:'redo'},key());
    assert.equal((await admin.record(t.id,a.id)).record.values[privateField.id],'保密更新值');
    const row=(await editor.query(t.id,{})).records[0];
    await editor.deleteRecords(t.id,{schemaVersion,records:[{id:a.id,version:row.version}]},key());
    assert.equal((await admin.query(t.id,{})).total,0);
    const op=(await editor.recordOperations(t.id,{trash:'true'})).rows[0];
    await editor.reverseRecordOperation(t.id,op.id,{direction:'undo'},key());
    assert.equal((await admin.query(t.id,{})).total,1);
    assert.ok(!JSON.stringify(await reader.record(t.id,a.id)).includes('保密更新值'));
  }
});
test('HR field permissions protect uploads, paste and undo; conditional family field and date precision validate',async()=>{
  const t=await sheet('HR_NEW_HIRES'),editor=await peer(['hr.worksheet.read','hr.worksheet.manage','hr.worksheet.sensitive']);
  const restricted=new DriveService(db,context(editor.actor.userId,false,['hr.worksheet.read','hr.worksheet.manage']));
  const schemaVersion=t.detail.table.schemaVersion;
  const values={...t.values,[t.f['是否有亲属朋友在我公司工作']]:'是'};
  await assert.rejects(editor.saveRecord(t.id,undefined,{schemaVersion,values},key()),/COLLAB_REQUIRED_FIELD/);
  values[t.f['亲属姓名']]='测试亲属';values[t.f['入职时间']]='2024.06';
  const file=await db.collabAttachment.create({data:{tableId:t.id,ownerId:editor.actor.userId,name:'相片.png',mimeType:'image/png',size:8,storageKey:key()}});
  await assert.rejects(restricted.attachment(t.id,file.id),/COLLAB_FORBIDDEN/);
  const a=await editor.saveRecord(t.id,undefined,{schemaVersion,values:{...values,[t.f['个人相片']]:[file.id],[t.f['体重']]:55.5}},key());
  assert.equal((await editor.attachment(t.id,file.id)).id,file.id);
  assert.equal((await editor.record(t.id,a.id)).record.values[t.f['体重']],55.5);
  await assert.rejects(restricted.saveRecords(t.id,{schemaVersion,records:[{id:a.id,version:1,values:{[t.f['薪酬']]:'12345'}}]},key()),/COLLAB_READONLY_FIELD/);
  const edit=await editor.saveRecord(t.id,a.id,{schemaVersion,version:1,values:{[t.f['薪酬']]:'12345'}},key());
  await assert.rejects(restricted.reverseRecordOperation(t.id,edit.operationId,{direction:'undo'},key()),/COLLAB_READONLY_FIELD/);
  await assert.rejects(editor.saveRecord(t.id,a.id,{schemaVersion,version:2,values:{[t.f['入职时间']]:'2024.13'}},key()),/COLLAB_INVALID_DATE/);
  assert.ok(await db.operationLog.count({where:{action:'HR_RECORD_CREATE'}}));
});
test('empty HR migration preserves identities, other tables, ACLs and remains idempotent',async()=>{
  // Recreate the original mixed inventory workspace layout with no staff rows.
  const inventory=(await admin.provisionModuleWorkspace(root,{source:'INVENTORY_ITEMS'},key())).id;
  await db.$executeRawUnsafe('ALTER TABLE drive_node DISABLE TRIGGER drive_parent_guard');
  try {await db.collabBase.update({where:{id:base},data:{workspaceId:inventory}});}finally{await db.$executeRawUnsafe('ALTER TABLE drive_node ENABLE TRIGGER drive_parent_guard');}
  for(const kind of hrKinds.slice(1)) await db.collabTable.create({data:{baseId:base,name:hrNames[kind],createdBy:admin.actor.userId}});
  const before=await db.collabBase.findUniqueOrThrow({where:{id:base}});
  const out=await standardizeHrWorksheets(db,admin.actor.userId,true);assert.equal(out[0].tableIds.length,8);
  for(const kind of hrKinds) assert.equal(await db.collabField.count({where:{table:{baseId:base,inventoryKind:kind},archived:false}}),hrFields(kind).length);
  assert.deepEqual((await db.collabBase.findUniqueOrThrow({where:{id:base}})).accessPolicy,before.accessPolicy);
  assert.ok((await standardizeHrWorksheets(db,admin.actor.userId)).every(r=>!r.changed));
  assert.equal(await db.collabRecord.count(),0);
});
