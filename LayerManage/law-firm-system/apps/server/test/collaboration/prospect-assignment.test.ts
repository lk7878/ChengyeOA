import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {migrateProspectAssignments} from '../../app/application/collaboration/prospect-assignment-migration';
import {defaultRule} from '../../app/application/collaboration/worksheet-roles';
import {CollaborationService} from '../../app/application/collaboration/collaboration-service';
import {AuthorizationContext} from '../../app/application/authorization/authorization-service';
import {PERMISSION_CATALOG} from '../../app/domain/authorization/permission-catalog';
import {clearTestApplicationData,createTestPrisma} from '../helpers/test-database';

let db:PrismaClient, admin:CollaborationService, manager:CollaborationService, alice:CollaborationService, bob:CollaborationService, outsider:CollaborationService;
let table:string, org:string, field:string, title:string, schema:number, aliceRow:string, bobRow:string, pending:string, workspace:string;
const key=()=>randomUUID();
const code=(expected:string)=>(e:unknown)=>(e as {code?:string}).code===expected;
const context=(id:string,employeeId:string|null,superAdmin=false):AuthorizationContext=>({userId:id,employeeId,isSystemSuperAdmin:superAdmin,isSystemAdmin:false,evaluatedAt:new Date(),permissionCodes:PERMISSION_CATALOG.map(p=>p.code),fieldRules:[],grants:PERMISSION_CATALOG.map(p=>({sourceType:'SYSTEM_SUPER_ADMIN',sourceId:'test',permissionCode:p.code,resource:p.resource,scopeIds:['ALL'],validUntil:null}))});
test.before(()=>{db=createTestPrisma();});
test.beforeEach(async()=>{
 await clearTestApplicationData(db);
 org=key(); const outside=key();
 for(const id of [org,outside]) await db.organization.create({data:{id,code:id,name:id===org?'大数据中心':'其他部门',type:'DEPARTMENT',path:'/'+id}});
 const user=await db.user.create({data:{username:'admin',password:'unused'}});admin=new CollaborationService(db,context(user.id,null,true));
 async function staff(name:string,organizationId=org){
  const position=await db.position.create({data:{organizationId,code:key(),name:'职员',categoryCode:'SALES'}});
  const employee=await db.employee.create({data:{name,employeeNo:key(),phone:'13800001234',type:'SALES',status:'FORMAL',entryDate:new Date('2025-01-01')}});
  const account=await db.user.create({data:{username:name,password:'unused',employeeId:employee.id}});
  await db.employeeAssignment.create({data:{organizationId,employeeId:employee.id,positionId:position.id,assignmentType:'PRIMARY',startedAt:new Date('2025-01-01')}});
  return new CollaborationService(db,context(account.id,employee.id));
 }
 manager=await staff('经理');alice=await staff('甲');bob=await staff('乙');outsider=await staff('其他部门员工',outside);
 await db.organization.update({where:{id:org},data:{managerEmployeeId:manager.actor.employeeId}});
 workspace=(await admin.createWorkspace({name:'客资测试',organizationId:org},key())).id;
 const base=(await admin.createBase(workspace,{name:'客资'},key())).id;
 table=(await admin.createTable(base,{name:'律师客资表',template:'LAWYER_PROSPECTS'},key())).id;
 for(const svc of [manager,alice,bob,outsider])await db.collabMember.create({data:{workspaceId:workspace,principalType:'USER',principalId:svc.actor.userId,role:'EDITOR',rowScope:'ALL',canCreate:true}});
 const detail=await admin.describe(table);schema=detail.table.schemaVersion;field=detail.fields.find(f=>f.name==='跟进人')!.id;title=detail.fields.find(f=>f.name==='客户姓名')!.id;
 for(const [name,person] of [['甲客资',alice.actor.employeeId],['乙客资',bob.actor.employeeId],['待分配',null]]){
  const r=await admin.saveRecord(table,undefined,{schemaVersion:schema,values:{[title]:name,[field]:person}},key());
  if(person===alice.actor.employeeId)aliceRow=r.id;else if(person===bob.actor.employeeId)bobRow=r.id;else pending=r.id;
 }
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();});

test('members see assigned records; manager sees team and pending records; table access still required',async()=>{
 assert.deepEqual((await alice.query(table,{})).records.map(r=>r.id),[aliceRow]);
 assert.equal((await manager.query(table,{})).total,3);
 assert.equal((await outsider.query(table,{})).total,0);
 await assert.rejects(alice.record(table,bobRow),code('COLLAB_NOT_FOUND'));
 await assert.rejects(alice.saveRecord(table,bobRow,{schemaVersion:schema,version:1,values:{[title]:'forged'}},key()),code('COLLAB_NOT_FOUND'));
 await db.collabMember.deleteMany({where:{workspaceId:workspace,principalId:alice.actor.userId}});
 await assert.rejects(alice.query(table,{}),code('COLLAB_FORBIDDEN'));
});

test('only organization manager assigns and reassignment immediately changes visibility',async()=>{
 const f=(await manager.describe(table)).fields.find(f=>f.id===field)!;assert.equal(f.type,'USER');assert.equal(f.writable,true);
 assert.equal((await alice.describe(table)).fields.find(f=>f.id===field)!.writable,false);
 await assert.rejects(alice.saveRecord(table,aliceRow,{schemaVersion:schema,version:1,values:{[field]:bob.actor.employeeId}},key()),code('COLLAB_READONLY_FIELD'));
 await assert.rejects(manager.saveRecord(table,aliceRow,{schemaVersion:schema,version:1,values:{[field]:outsider.actor.employeeId}},key()),code('COLLAB_MEMBER_UNAVAILABLE'));
 await manager.saveRecord(table,aliceRow,{schemaVersion:schema,version:1,values:{[field]:bob.actor.employeeId}},key());
 assert.equal((await alice.query(table,{})).total,0);assert.equal((await bob.query(table,{})).total,2);
 await assert.rejects(alice.record(table,aliceRow),code('COLLAB_NOT_FOUND'));
});

test('staff-created records belong to self and SELF grants use assignee rather than creator',async()=>{
 const own=await alice.saveRecord(table,undefined,{schemaVersion:schema,values:{[title]:'自行录入'}},key());
 assert.equal((await alice.record(table,own.id)).record.values[field],alice.actor.employeeId);
 await db.collabMember.updateMany({where:{workspaceId:workspace,principalId:alice.actor.userId},data:{rowScope:'SELF'}});
 assert.equal((await alice.query(table,{})).total,2);
 const rules={EDITOR:{...defaultRule('EDITOR'),rows:'SELF'}};
 await db.worksheetRolePolicy.create({data:{tableId:table,rules}});
 assert.equal((await alice.query(table,{})).total,2);
});

test('ended employment and manager changes revoke scope; direct detail and export obey same boundary',async()=>{
 const exported=await alice.exportRecords(table,{});
 assert.ok(JSON.stringify(exported).includes('甲客资'));assert.ok(!JSON.stringify(exported).includes('乙客资'));
 await db.organization.update({where:{id:org},data:{managerEmployeeId:bob.actor.employeeId}});
 assert.equal((await manager.query(table,{})).total,0);assert.equal((await bob.query(table,{})).total,3);
 await db.employeeAssignment.updateMany({where:{employeeId:alice.actor.employeeId!},data:{endedAt:new Date()}});
 assert.equal((await alice.query(table,{})).total,0);
 await assert.rejects(bob.saveRecord(table,pending,{schemaVersion:schema,version:1,values:{[field]:alice.actor.employeeId}},key()),code('COLLAB_MEMBER_UNAVAILABLE'));
});

test('assignment field cannot be archived or changed back to free text; defaults must reference active employees',async()=>{
 await assert.rejects(admin.saveField(table,field,{version:schema,archived:true},key()),code('COLLAB_ASSIGNMENT_FIELD_REQUIRED'));
 await assert.rejects(admin.saveField(table,field,{version:schema,options:{prospectAssignee:true,assignmentOrganizationId:org},defaultValue:outsider.actor.employeeId},key()),code('COLLAB_MEMBER_UNAVAILABLE'));
 await admin.saveField(table,field,{version:schema,type:'LONG_TEXT',options:{},name:'负责员工'},key());
 const f=(await admin.describe(table)).fields.find(f=>f.id===field)!;assert.equal(f.type,'USER');assert.equal((f.options as {prospectAssignee?:boolean}).prospectAssignee,true);
});

test('department rules follow assigned employees, including unassigned manager queue, instead of the record creator',async()=>{
 await db.worksheetRolePolicy.create({data:{tableId:table,rules:{EDITOR:{...defaultRule('EDITOR'),rows:'SUBDEPARTMENTS'}}}});
 assert.equal((await manager.query(table,{})).total,3);
 assert.equal((await alice.query(table,{})).total,1);
 await manager.saveRecord(table,pending,{schemaVersion:schema,version:1,values:{[field]:alice.actor.employeeId}},key());
 assert.equal((await alice.query(table,{})).total,2);
});

test('configured department head can distribute across branches and retain the team overview',async()=>{
 const branch=await db.organization.findFirstOrThrow({where:{name:'其他部门'}});
 // Same firm, different branch; this remains outside the assignment department.
 const parent=key();await db.organization.create({data:{id:parent,code:parent,name:'律所集团',type:'FIRM',path:'/'+parent}});
 for(const id of [org,branch.id])await db.organization.update({where:{id},data:{parentId:parent,level:1,path:'/'+parent+'/'+id}});
 await db.worksheetRolePolicy.create({data:{tableId:table,rules:{EDITOR:{...defaultRule('EDITOR'),rows:'SUBDEPARTMENTS'}}}});
 await manager.saveRecord(table,aliceRow,{schemaVersion:schema,version:1,values:{[field]:outsider.actor.employeeId}},key());
 assert.equal((await manager.query(table,{})).total,3);
 assert.deepEqual((await outsider.query(table,{})).records.map(r=>r.id),[aliceRow]);
 assert.equal((await alice.query(table,{})).total,0);
 const candidates=(await manager.describe(table)).fields.find(f=>f.id===field)!.options as {choices:{id:string;label:string}[]};
 assert.ok(candidates.choices.some(e=>e.id===outsider.actor.employeeId&&e.label.includes('其他部门')));
});

test('legacy migration preserves IDs and revisions, maps exact names, is idempotent and rejects unresolved data',async()=>{
 await db.collabField.update({where:{id:field},data:{type:'LONG_TEXT',options:{}}});
 const row=await db.collabRecord.findUniqueOrThrow({where:{id:aliceRow}});
 await db.collabRecord.update({where:{id:aliceRow},data:{values:{...(row.values as object),[field]:'甲'}}});
 const target=[{tableId:table,organizationId:org}];
 assert.equal((await migrateProspectAssignments(db,admin.actor,target))[0].converted,1);
 assert.equal((await db.collabField.findUniqueOrThrow({where:{id:field}})).type,'LONG_TEXT');
 await migrateProspectAssignments(db,admin.actor,target,true);
 assert.equal((await alice.record(table,aliceRow)).record.values[field],alice.actor.employeeId);
 assert.equal((await db.collabRecord.findUniqueOrThrow({where:{id:aliceRow}})).version,2);
 assert.equal((await migrateProspectAssignments(db,admin.actor,target,true))[0].changed,false);
 await db.collabField.update({where:{id:field},data:{type:'LONG_TEXT',options:{}}});
 await db.collabRecord.update({where:{id:aliceRow},data:{values:{...(row.values as object),[field]:'无法确定的员工'}}});
 await assert.rejects(migrateProspectAssignments(db,admin.actor,target,true),code('COLLAB_ASSIGNMENT_LEGACY_UNRESOLVED'));
 assert.equal((await db.collabField.findUniqueOrThrow({where:{id:field}})).type,'LONG_TEXT');
});
