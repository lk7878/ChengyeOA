import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { clearTestApplicationData,createTestPrisma } from '../helpers/test-database';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { PersonalFiles } from '../../app/application/collaboration/personal-files';
import { NavigationMenuService } from '../../app/application/collaboration/navigation-menu';
import { medicalOptions,medicalCustomer } from '../../app/application/collaboration/medical-assessment';
import { officeTemplate,saveOfficeTemplate,applyOfficeTemplate } from '../../app/application/authorization/office-role-template';
import { defaultRule } from '../../app/application/collaboration/worksheet-roles';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
let db:PrismaClient,svc:CollaborationService,owner:AuthorizationContext,staff:AuthorizationContext,other:AuthorizationContext,org:string,workspace:string,base:string;
const context=(userId:string,root=false):AuthorizationContext=>({userId,employeeId:null,isSystemSuperAdmin:root,isSystemAdmin:false,evaluatedAt:new Date(),permissionCodes:PERMISSION_CATALOG.map(p=>p.code),fieldRules:[],grants:PERMISSION_CATALOG.map(p=>({sourceType:'ROLE',sourceId:'fixture',permissionCode:p.code,resource:p.resource,scopeIds:['ALL'],validUntil:null}))});
const code=(c:string)=>(e:unknown)=>(e as {code:string}).code===c;
const grant=(id:string,role='READER')=>({principalType:'USER',principalId:id,role,rowScope:'ALL',canCreate:role!=='READER',hiddenFields:[],readonlyFields:[]});
test.before(()=>{db=createTestPrisma();});
test.beforeEach(async()=>{
  await clearTestApplicationData(db);org=key();await db.organization.create({data:{id:org,code:org,name:'总所',type:'FIRM',path:'/'+org}});
  const users=await Promise.all(['root','staff','other'].map(username=>db.user.create({data:{username,password:'unused'}})));
  [owner,staff,other]=users.map((u,i)=>context(u.id,i===0));svc=new CollaborationService(db,owner);
  workspace=(await svc.createWorkspace({name:'原工作区',organizationId:org},key())).id;
  base=(await svc.createBase(workspace,{name:'原目录'},key())).id;
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();});

test('menu changes are root-only, versioned and cannot alter routes, permissions or create cycles',async()=>{
  const root=new NavigationMenuService(db,owner),normal=new NavigationMenuService(db,staff);
  const nodes=[{id:'g',label:'律师部',parentId:null,target:null,position:0},{id:'case',label:'办案入口',parentId:'g',target:'/cases',position:0}];
  const before=await db.permission.count();
  await assert.rejects(normal.save({version:0,nodes}),code('COLLAB_FORBIDDEN'));
  const saved=await root.save({version:0,nodes});assert.equal(saved.version,1);
  await assert.rejects(root.save({version:0,nodes}),code('COLLAB_ACCESS_CONFLICT'));
  await assert.rejects(root.save({version:1,nodes:[{...nodes[0],parentId:'g'}]}),code('COLLAB_INVALID_NAVIGATION'));
  await assert.rejects(root.save({version:1,nodes:[{...nodes[1],parentId:null,target:'/security/roles'}]}),code('COLLAB_INVALID_NAVIGATION'));
  await root.save({version:1,nodes:[]});assert.equal(await db.permission.count(),before);
});

test('worksheet move preserves IDs, fields, records, views and rules; target restrictions remain effective',async()=>{
  const table=await svc.createTable(base,{name:'迁移表'},key()),detail=await svc.describe(table.id),field=detail.fields[0];
  const record=await svc.saveRecord(table.id,undefined,{schemaVersion:1,values:{[field.id]:'保留记录'}},key());
  const targetWorkspace=(await svc.createWorkspace({name:'行政事务',organizationId:org},key())).id;
  const target=(await svc.createBase(targetWorkspace,{name:'目标目录'},key())).id;
  await db.collabMember.create({data:{workspaceId:workspace,principalId:staff.userId,role:'EDITOR',rowScope:'ALL'}});
  const normal=new CollaborationService(db,staff);
  assert.equal((await normal.query(table.id,{})).total,1);
  const preview=await svc.previewTableMove(table.id,{targetBaseId:target});
  await assert.rejects(normal.moveTable(table.id,{targetBaseId:target,previewToken:preview.previewToken},key()),code('COLLAB_FORBIDDEN'));
  const counts=[await db.collabField.count({where:{tableId:table.id}}),await db.collabView.count({where:{tableId:table.id}}),await db.collabRule.count({where:{tableId:table.id}})];
  await svc.moveTable(table.id,{targetBaseId:target,previewToken:preview.previewToken},key());
  assert.equal((await svc.describe(table.id)).table.baseId,target);
  assert.equal((await svc.record(table.id,record.id)).record.values[field.id],'保留记录');
  assert.deepEqual(counts,[await db.collabField.count({where:{tableId:table.id}}),await db.collabView.count({where:{tableId:table.id}}),await db.collabRule.count({where:{tableId:table.id}})]);
  await assert.rejects(normal.query(table.id,{}),code('COLLAB_FORBIDDEN'));
  await db.collabMember.create({data:{workspaceId:targetWorkspace,principalId:staff.userId,role:'READER',rowScope:'ALL'}});
  assert.equal((await normal.describe(table.id)).access.level,1);
  assert.equal((await normal.query(table.id,{})).total,1);
  await assert.rejects(normal.saveRecord(table.id,record.id,{schemaVersion:1,version:1,values:{[field.id]:'越权'}},key()),code('COLLAB_FORBIDDEN'));
  assert.equal((await svc.listTables(base)).tables.length,0);
  assert.equal((await svc.listTables(target)).tables[0].id,table.id);
  await svc.reverseRecordOperation(table.id,record.operationId,{direction:'undo'},key());
  assert.equal((await svc.query(table.id,{})).total,0);
  await svc.reverseRecordOperation(table.id,record.operationId,{direction:'redo'},key());
  assert.equal((await svc.query(table.id,{})).total,1);
});

test('medical assessments fill from permitted follows, lock linked fields and clear them on unlink',async()=>{
  const source=await svc.createTable(base,{name:'客户跟进记录表',source:'FOLLOWS'},key());
  const table=await svc.createTable(base,{name:'病例评估表',template:'MEDICAL_ASSESSMENT'},key());
  const lead=await db.lead.create({data:{leadNo:key(),name:'张客户',phone:'13800000000',phoneHash:key(),wechat:'wechat-name',branchId:org,createdBy:owner.userId}});
  const follow=await db.leadFollow.create({data:{leadId:lead.id,type:'PHONE',content:'已有跟进',createdBy:owner.userId}});
  const fields=(await svc.describe(table.id)).fields,link=fields.find(f=>(f.options as Prisma.JsonObject).medicalRelation)!,name=fields.find(f=>f.name==='患者姓名')!,identity=fields.find(f=>f.name==='ID')!;
  const selected=source.id+':'+follow.id;
  assert.ok((await medicalOptions(db,owner,table.id,'张')).some(o=>o.value===selected));
  assert.equal((await medicalCustomer(db,owner,selected)).customerName,'张客户');
  const created=await svc.saveRecord(table.id,undefined,{schemaVersion:1,values:{[identity.id]:'A1',[link.id]:selected}},key());
  assert.equal((await svc.record(table.id,created.id)).record.values[name.id],'张客户');
  await assert.rejects(svc.saveRecord(table.id,created.id,{schemaVersion:1,version:1,values:{[name.id]:'篡改'}},key()),code('MEDICAL_LINKED_FIELD_READONLY'));
  const cleared=await svc.saveRecord(table.id,created.id,{schemaVersion:1,version:1,values:{[link.id]:null}},key());
  assert.equal((await svc.record(table.id,created.id)).record.values[name.id],null);
  await svc.reverseRecordOperation(table.id,cleared.operationId,{direction:'undo'},key());
  assert.equal((await svc.record(table.id,created.id)).record.values[name.id],'张客户');
  const manual=await svc.saveRecord(table.id,undefined,{schemaVersion:1,values:{[identity.id]:'MANUAL',[name.id]:'原手填姓名'}},key());
  const linked=await svc.saveRecord(table.id,manual.id,{schemaVersion:1,version:1,values:{[link.id]:selected}},key());
  await svc.reverseRecordOperation(table.id,linked.operationId,{direction:'undo'},key());
  assert.equal((await svc.record(table.id,manual.id)).record.values[name.id],'原手填姓名');
  await svc.reverseRecordOperation(table.id,linked.operationId,{direction:'redo'},key());
  assert.equal((await svc.record(table.id,manual.id)).record.values[name.id],'张客户');
  await db.lead.update({where:{id:lead.id},data:{name:'源客户已改名'}});
  const unlinked=await svc.saveRecord(table.id,manual.id,{schemaVersion:1,version:4,values:{[link.id]:null}},key());
  await svc.reverseRecordOperation(table.id,unlinked.operationId,{direction:'undo'},key());
  assert.equal((await svc.record(table.id,manual.id)).record.values[name.id],'张客户','undo restores the actual historical snapshot');
  await assert.rejects(svc.saveRecords(table.id,{schemaVersion:1,records:[{id:manual.id,version:6,values:{[name.id]:'批量篡改'}}]},key()),code('MEDICAL_LINKED_FIELD_READONLY'));
  await db.lead.update({where:{id:lead.id},data:{deletedAt:new Date()}});
  assert.equal((await medicalOptions(db,owner,table.id,'张')).length,0);
  await assert.rejects(medicalCustomer(db,other,selected),code('COLLAB_FORBIDDEN'));
});

test('department row scopes follow appointments and subdepartments dynamically without exposing outsiders',async()=>{
  const manager=await db.employee.create({data:{employeeNo:key(),name:'负责人',phone:'13800000001',type:'SALES',entryDate:new Date('2020-01-01'),status:'FORMAL'}});
  await db.user.update({where:{id:staff.userId},data:{employeeId:manager.id}});staff={...staff,employeeId:manager.id};
  const dep=key(),child=key();await db.organization.create({data:{id:dep,code:dep,name:'部门',type:'DEPARTMENT',parentId:org,path:'/'+org+'/'+dep,level:1,managerEmployeeId:manager.id}});
  await db.organization.create({data:{id:child,code:child,name:'下级部门',type:'DEPARTMENT',parentId:dep,path:'/'+org+'/'+dep+'/'+child,level:2}});
  const worker=await db.employee.create({data:{employeeNo:key(),name:'下属',phone:'13800000002',type:'SALES',entryDate:new Date('2020-01-01'),status:'FORMAL'}});
  await db.user.update({where:{id:other.userId},data:{employeeId:worker.id}});
  const position=await db.position.create({data:{organizationId:child,code:key(),name:'岗位',categoryCode:'SALES'}});
  await db.employeeAssignment.create({data:{employeeId:worker.id,organizationId:child,positionId:position.id,assignmentType:'PRIMARY',startedAt:new Date('2020-01-01')}});
  const table=await svc.createTable(base,{name:'部门记录'},key()),field=(await svc.describe(table.id)).fields[0];
  for(const [createdBy,name] of [[staff.userId,'本人'],[other.userId,'下属'],[owner.userId,'外部']])await db.collabRecord.create({data:{tableId:table.id,ownerId:createdBy,createdBy,updatedBy:createdBy,values:{[field.id]:name}}});
  await db.collabMember.create({data:{workspaceId:workspace,principalId:staff.userId,role:'EDITOR',rowScope:'ALL'}});
  const rule={...defaultRule('EDITOR'),rows:'SUBDEPARTMENTS' as const};
  await db.worksheetRolePolicy.create({data:{tableId:table.id,rules:{EDITOR:rule},invitations:{}}});
  const member=new CollaborationService(db,staff);
  assert.equal((await member.query(table.id,{})).total,2);
  await db.position.update({where:{id:position.id},data:{deletedAt:new Date()}});
  assert.equal((await member.query(table.id,{})).total,1);
  await db.position.update({where:{id:position.id},data:{deletedAt:null}});
  await db.employee.update({where:{id:manager.id},data:{status:'LEAVED'}});
  await assert.rejects(member.query(table.id,{}),code('COLLAB_FORBIDDEN'));
  await db.employee.update({where:{id:manager.id},data:{status:'FORMAL'}});
  await db.organization.update({where:{id:dep},data:{managerEmployeeId:null}});
  assert.equal((await member.query(table.id,{})).total,1);
  const outsider=await db.collabRecord.findFirstOrThrow({where:{tableId:table.id,createdBy:owner.userId}});
  await assert.rejects(member.saveRecord(table.id,outsider.id,{schemaVersion:1,version:1,values:{[field.id]:'越权'}},key()),code('COLLAB_NOT_FOUND'));
});

test('personal file creation is intrinsic; sharing intersects every ancestor and a child grant cannot bypass denial',async()=>{
  const a=new PersonalFiles(db,staff),b=new PersonalFiles(db,other),root=new PersonalFiles(db,owner);
  const folder=await a.create({kind:'FOLDER',name:'私有文件夹'});
  const file=await a.create({kind:'FILE',name:'材料.txt',parentId:folder.id,content:Buffer.from('内部材料').toString('base64')});
  const access=await a.accessSettings(file.id);
  await a.share(file.id,{version:access.version,policy:{restricted:true,grants:[grant(other.userId)]}});
  await assert.rejects(b.download(file.id),code('COLLAB_FORBIDDEN'));
  assert.equal((await b.list({scope:'shared'})).items.length,0);
  await a.share(folder.id,{version:1,policy:{restricted:true,grants:[grant(other.userId,'EDITOR')]}});
  assert.equal(Buffer.from((await b.download(file.id)).content,'base64').toString(),'内部材料');
  assert.ok((await b.list({scope:'shared'})).items.some(i=>i.id===file.id));
  await assert.rejects(b.share(file.id,{version:2,policy:{restricted:true,grants:[]}}),code('COLLAB_FORBIDDEN'));
  const replacement={name:'材料修订.txt',version:2,content:Buffer.from('修订内容').toString('base64')};
  await assert.rejects(b.replace(file.id,replacement),code('COLLAB_FORBIDDEN'));
  await a.share(file.id,{version:2,policy:{restricted:true,grants:[grant(other.userId,'EDITOR')]}});
  await b.replace(file.id,{...replacement,version:3});
  assert.equal(Buffer.from((await a.download(file.id)).content,'base64').toString(),'修订内容');
  assert.equal((await a.accessSettings(file.id)).ownerId,staff.userId);
  await assert.rejects(b.replace(file.id,{...replacement,version:3}),code('COLLAB_ACCESS_CONFLICT'));
  await a.share(folder.id,{version:2,policy:{restricted:true,grants:[grant(other.userId,'DENY')]}});
  await assert.rejects(b.download(file.id),code('COLLAB_FORBIDDEN'));
  await assert.rejects(root.download(file.id),code('COLLAB_FORBIDDEN'));
  await assert.rejects(a.create({kind:'FILE',name:'../escape.txt',content:'QQ=='}),code('COLLAB_INVALID_VALUE'));
});

test('moving inventory sources and summaries preserves original formula bindings across modules',async()=>{
  const register=await svc.createTable(base,{name:'原领用登记',template:'INVENTORY_REGISTER'},key());
  const summary=await svc.createTable(base,{name:'原领用统计',template:'INVENTORY_SUMMARY'},key());
  const field=(await svc.describe(register.id)).fields.find(f=>f.name==='档案袋')!;
  const row=await svc.saveRecord(register.id,undefined,{schemaVersion:1,values:{[field.id]:7}},key());
  const target=(await svc.createBase(workspace,{name:'行政目录'},key())).id;
  const unrelated=await svc.createTable(target,{name:'目标目录自己的登记',template:'INVENTORY_REGISTER'},key());
  const unrelatedField=(await svc.describe(unrelated.id)).fields.find(f=>f.name==='档案袋')!;
  await svc.saveRecord(unrelated.id,undefined,{schemaVersion:1,values:{[unrelatedField.id]:100}},key());
  const summaryFields=(await svc.describe(summary.id)).fields;
  const name=summaryFields.find(f=>f.name==='物品名称')!.id,total=summaryFields.find(f=>f.name==='领用数量')!.id;
  const amount=async()=>Number((await svc.query(summary.id,{})).records.find(r=>r.values[name]==='档案袋')!.values[total]);
  assert.equal(await amount(),7);
  for(const table of [register,summary]){
    const preview=await svc.previewTableMove(table.id,{targetBaseId:target});
    await svc.moveTable(table.id,{targetBaseId:target,previewToken:preview.previewToken},key());
    assert.equal(await amount(),7,'moving either side must not rebind to the destination register');
  }
  await svc.saveRecord(register.id,row.id,{schemaVersion:1,version:1,values:{[field.id]:9}},key());
  assert.equal(await amount(),9);
});


test('upgrade adds the medical link without replacing historical fields, values or view filters',async()=>{
  const table=await svc.createTable(base,{name:'历史病例评估表'},key());
  const original=(await svc.describe(table.id)).fields[0];
  await db.collabField.update({where:{id:original.id},data:{name:'ID'}});
  for(const [i,name] of ['患者姓名','案件评估','医疗记录（病历）','微信名','抖音号','联系电话','地区'].entries())
    await db.collabField.create({data:{tableId:table.id,name,type:'TEXT',position:i+1}});
  const row=await db.collabRecord.create({data:{tableId:table.id,ownerId:owner.userId,createdBy:owner.userId,updatedBy:owner.userId,values:{[original.id]:'HISTORY-1'}}});
  const view=await db.collabView.findFirstOrThrow({where:{tableId:table.id,isDefault:true}});
  const filter={fieldId:original.id,operator:'contains',value:'HISTORY'};
  await db.collabView.update({where:{id:view.id},data:{config:{visibleFields:[original.id],filter}}});
  const migration=await readFile('prisma/migrations/202611140004_navigation_and_personal_files/migration.sql','utf8');
  const dataMigration=migration.slice(migration.indexOf('UPDATE collab_table t')).replace('COMMIT;','');
  await db.$transaction(async tx=>{for(const sql of dataMigration.split(';').filter(s=>s.trim()))await tx.$executeRawUnsafe(sql);});
  const detail=await svc.describe(table.id),link=detail.fields.find(f=>(f.options as {medicalRelation?:boolean}).medicalRelation)!;
  assert.equal(detail.table.followSupportKind,'MEDICAL_ASSESSMENT');
  assert.equal(detail.table.schemaVersion,2);assert.equal(detail.fields[0].id,original.id);assert.equal(link.position,1);
  assert.equal((await svc.record(table.id,row.id)).record.values[original.id],'HISTORY-1');
  const migrated=await db.collabView.findUniqueOrThrow({where:{id:view.id}});
  assert.deepEqual(migrated.config,{visibleFields:[original.id,link.id],filter});
});


test('office template saves and applies a versioned preview with the PostgreSQL advisory lock',async()=>{
  const initial=await officeTemplate(db);
  assert.ok(initial.capabilities.some(c=>c.includes('承业中心')));
  const saved=await saveOfficeTemplate(db,owner.userId,{version:initial.version,permissionCodes:[]});
  const role=await db.role.create({data:{code:key(),name:'办公模板测试',type:'BUSINESS'}});
  const input={roles:[{id:role.id,version:role.version}],templateVersion:saved.version,apply:false};
  assert.equal((await applyOfficeTemplate(db,owner.userId,input)).length,1);
  assert.equal((await db.role.findUniqueOrThrow({where:{id:role.id}})).version,role.version);
  await applyOfficeTemplate(db,owner.userId,{...input,apply:true});
  assert.equal((await db.role.findUniqueOrThrow({where:{id:role.id}})).version,role.version+1);
  await assert.rejects(applyOfficeTemplate(db,owner.userId,{...input,apply:true}),code('COLLAB_ACCESS_CONFLICT'));
});

test('personal file deletion validates every permission and version atomically; owners can restore history',async()=>{
  const a=new PersonalFiles(db,staff),b=new PersonalFiles(db,other),root=new PersonalFiles(db,owner);
  const make=(s:PersonalFiles,name:string)=>s.create({kind:'FILE',name,content:Buffer.from('retained version').toString('base64')});
  const first=await make(a,'第一份.txt'),second=await make(a,'第二份.txt'),foreign=await make(b,'他人文件.txt');
  await assert.rejects(root.remove({files:[{id:first.id,version:1}]}),code('COLLAB_FORBIDDEN'));
  await assert.rejects(a.remove({files:[{id:first.id,version:1},{id:foreign.id,version:1}]}),code('COLLAB_FORBIDDEN'));
  assert.equal((await a.list({})).items.length,2);
  await a.rename(second.id,{name:'更新后的文件.txt',version:1});
  await assert.rejects(a.remove({files:[{id:first.id,version:1},{id:second.id,version:1}]}),code('COLLAB_ACCESS_CONFLICT'));
  assert.equal((await a.list({})).items.length,2);
  await a.share(first.id,{version:1,policy:{restricted:true,grants:[grant(other.userId,'EDITOR')]}});
  await assert.rejects(b.remove({files:[{id:first.id,version:2}]}),code('COLLAB_FORBIDDEN'));
  assert.equal((await a.remove({files:[{id:first.id,version:2},{id:second.id,version:2}]})).count,2);
  assert.equal((await a.list({})).items.length,0);assert.equal((await a.trash()).items.length,2);
  await assert.rejects(a.download(first.id),code('COLLAB_FORBIDDEN'));await assert.rejects(b.download(first.id),code('COLLAB_FORBIDDEN'));
  await assert.rejects(b.restore(first.id,{version:3}),code('COLLAB_FORBIDDEN'));
  await assert.rejects(a.restore(first.id,{version:2}),code('COLLAB_ACCESS_CONFLICT'));
  await a.restore(first.id,{version:3});assert.equal(Buffer.from((await a.download(first.id)).content,'base64').toString(),'retained version');
  assert.equal((await a.trash()).items.length,1);
  assert.equal(await db.operationLog.count({where:{action:'PERSONAL_FILE_DELETE'}}),2);
});
