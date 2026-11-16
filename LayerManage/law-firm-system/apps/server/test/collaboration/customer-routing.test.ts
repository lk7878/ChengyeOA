import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { CustomerService } from '../../app/application/crm/customer-service';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { configureCustomerRouting, customerRoutingSources } from '../../scripts/maintenance/configure-customer-routing';
import { CUSTOMER_ROUTE_TRIGGER, CustomerRouteAction, syncCustomerSource } from '../../app/application/collaboration/customer-source-routing';
import { removeRetiredCustomerTable } from '../../scripts/maintenance/remove-retired-customer-table';
import { lawyerProspectTemplate } from '../../app/application/collaboration/lawyer-prospect-template';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, svc: CollaborationService, base: string, user: string, source: string, legacy: string;
const lawyers = ['刘佳律师','张恒溢律师','李辉律师'];
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({data:{id:org,code:org,name:'路由测试',type:'FIRM',path:'/'+org}});
  user=(await db.user.create({data:{username:key(),password:'unused'}})).id;
  const role=await db.role.create({data:{code:'SYSTEM_SUPER_ADMIN',name:'超级管理员',type:'SYSTEM'}});
  await db.userRole.create({data:{userId:user,roleId:role.id,grantedByUserId:user}});
  svc=new CollaborationService(db,await new AuthorizationContextLoader(db).load(user));
  const w=await svc.createWorkspace({name:'客户经营',organizationId:org},key());
  base=(await svc.createBase(w.id,{name:'客资测试'},key())).id;
  source=(await svc.createTable(base,{name:'客户记录',source:'CUSTOMERS'},key())).id;
  legacy=(await svc.createTable(base,{name:lawyers[0]+'客资表',source:'FOLLOWS'},key())).id;
  for(const name of customerRoutingSources.filter(name=>name!==lawyers[0])) await svc.createTable(base,{name:name+'客资表',template:lawyerProspectTemplate},key());
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();});
async function setup() {
  await configureCustomerRouting(db,user,{sourceTableId:source,sourceNames:customerRoutingSources,replaceLegacyTable:true},true);
  return (await db.collabRule.findFirstOrThrow({where:{tableId:source,trigger:CUSTOMER_ROUTE_TRIGGER}})).action as unknown as CustomerRouteAction;
}
const values=(v:unknown)=>v as Record<string,unknown>;

test('archive permits field-name reuse without losing old values and adds new columns only to default views',async()=>{
  const table=await svc.createTable(base,{name:'自定义'},key());
  const original=await svc.saveField(table.id,undefined,{name:'测试字段',type:'TEXT',version:1},key());
  const title=(await svc.describe(table.id)).fields[0];
  const record=await svc.saveRecord(table.id,undefined,{schemaVersion:2,values:{[title.id]:'标题',[original.id]:'旧值'}},key());
  const view=await db.collabView.findFirstOrThrow({where:{tableId:table.id,isDefault:true}});
  await db.collabView.update({where:{id:view.id},data:{config:{visibleFields:[original.id]}}});
  const privateView=await db.collabView.create({data:{tableId:table.id,name:'个人列',ownerId:user,config:{visibleFields:[original.id]}}});
  await svc.saveField(table.id,original.id,{archived:true,version:2},key());
  const fresh=await svc.saveField(table.id,undefined,{name:'测试字段',type:'TEXT',version:3},key());
  assert.notEqual(fresh.id,original.id);
  assert.equal(values((await db.collabRecord.findUniqueOrThrow({where:{id:record.id}})).values)[original.id],'旧值');
  assert.deepEqual(values((await db.collabView.findUniqueOrThrow({where:{id:view.id}})).config).visibleFields,[original.id,fresh.id]);
  assert.deepEqual(values((await db.collabView.findUniqueOrThrow({where:{id:privateView.id}})).config).visibleFields,[original.id]);
  await assert.rejects(svc.saveField(table.id,undefined,{name:'测试字段',type:'TEXT',version:4},key()),/COLLAB_NAME_OR_ID_CONFLICT/);
  assert.equal((await svc.describe(table.id)).table.schemaVersion,4);
});

test('setup previews replacement, retains other tables, and can be repeated without duplicate routing or columns',async()=>{
  const preview=await configureCustomerRouting(db,user,{sourceTableId:source,sourceNames:customerRoutingSources,replaceLegacyTable:true});
  assert.equal(preview.targets.filter(t=>t.replaceLegacy).length,1);
  assert.equal(await db.collabRule.count(),0);
  assert.equal((await db.collabTable.findUniqueOrThrow({where:{id:legacy}})).archived,false);
  const oldFields=(await svc.describe(legacy)).fields;
  const updated=oldFields.find(f=>f.options.businessKey==='updatedAt')!;
  const oldId=oldFields.find(f=>f.options.businessKey==='followNo')!;
  await db.worksheetRolePolicy.create({data:{tableId:legacy,rules:{EDITOR:{level:'EDITOR',rows:'ALL',fields:{[updated.id]:'READ',[oldId.id]:'READ'},business:{permissions:['lead.read'],scopeIds:['ALL']}}}}});
  const action=await setup();
  const replacement=await svc.describe(action.routes[lawyers[0]].targetTableId);
  const rule=values((await db.worksheetRolePolicy.findUniqueOrThrow({where:{tableId:replacement.table.id}})).rules).EDITOR as Record<string,unknown>;
  assert.deepEqual(rule.fields,{[replacement.fields.find(f=>f.name==='最后更新时间')!.id]:'READ'});
  assert.equal(rule.business,undefined);
  assert.equal((await db.collabTable.findUniqueOrThrow({where:{id:legacy}})).archived,true);
  assert.notEqual(action.routes[lawyers[0]].targetTableId,legacy);
  const second=await setup();
  assert.deepEqual(second,action);
  assert.equal(await db.collabRule.count(),1);
  assert.equal(await db.collabField.count({where:{tableId:source,name:'客户来源',archived:false}}),1);
});

test('create, edit, retry, reassignment and clearing source synchronize basic values while preserving follow-up',async()=>{
  const action=await setup(), route=action.routes[lawyers[0]], second=action.routes[lawyers[1]];
  const creationKey=key();
  const input={name:'测试客户',phone:'13800001234',wechat:'test-wechat',address:'测试地址',sourceFieldId:action.sourceFieldId,sourceValue:lawyers[0]};
  const customer=await svc.createBusinessRecord(source,input,creationKey);
  assert.equal((await svc.createBusinessRecord(source,input,creationKey)).id,customer.id);
  let target=await db.collabRecord.findFirstOrThrow({where:{tableId:route.targetTableId,archived:false}});
  for(const [id,core] of Object.entries(route.fields)) assert.equal(values(target.values)[id],values(await db.customer.findUniqueOrThrow({where:{id:customer.id}}))[core]);
  const follow=(await svc.describe(route.targetTableId)).fields.find(f=>f.name==='跟进人')!;
  await svc.saveRecord(route.targetTableId,target.id,{schemaVersion:2,version:target.version,values:{[follow.id]:'保留跟进'}},key());
  await new CustomerService(db,{actorUserId:user},svc.actor).updateCustomer(customer.id,{name:'更正姓名',phone:'13900001234'});
  target=await db.collabRecord.findUniqueOrThrow({where:{id:target.id}});
  assert.equal(values(target.values)[follow.id],'保留跟进');
  assert.equal(values(target.values)[Object.keys(route.fields).find(id=>route.fields[id]==='phone')!],'13900001234');
  await db.$transaction(tx=>syncCustomerSource(tx,customer.id,user));
  assert.equal(await db.collabRecord.count({where:{tableId:route.targetTableId}}),1);
  const changeSource=async(choice:string|null)=>{
    const detail=await svc.record(source,customer.id);
    return svc.saveRecord(source,customer.id,{schemaVersion:(await svc.describe(source)).table.schemaVersion,version:detail.record.version,values:{[action.sourceFieldId]:choice}},key());
  };
  await changeSource(lawyers[1]);
  assert.equal((await db.collabRecord.findUniqueOrThrow({where:{id:target.id}})).archived,true);
  assert.equal(await db.collabRecord.count({where:{tableId:second.targetTableId,archived:false}}),1);
  await changeSource(null);
  assert.equal(await db.collabRecord.count({where:{archived:false}}),0);
  await changeSource(lawyers[0]);
  assert.equal(await db.collabRecord.count({where:{tableId:route.targetTableId}}),1);
  assert.equal(values((await db.collabRecord.findUniqueOrThrow({where:{id:target.id}})).values)[follow.id],'保留跟进');
});

test('a broken destination rolls back reassignment, and a non-member cannot distribute customers',async()=>{
  const action=await setup();
  const c=await svc.createBusinessRecord(source,{name:'测试客户',phone:'13800001234',sourceFieldId:action.sourceFieldId,sourceValue:lawyers[0]},key());
  const old=await db.collabRecord.findFirstOrThrow({where:{tableId:action.routes[lawyers[0]].targetTableId}});
  await db.collabTable.update({where:{id:action.routes[lawyers[1]].targetTableId},data:{archived:true}});
  const detail=await svc.record(source,c.id);
  await assert.rejects(svc.saveRecord(source,c.id,{schemaVersion:2,version:detail.record.version,values:{[action.sourceFieldId]:lawyers[1]}},key()),/COLLAB_CUSTOMER_ROUTE_UNAVAILABLE/);
  assert.equal((await db.collabRecord.findUniqueOrThrow({where:{id:old.id}})).archived,false);
  assert.equal(values((await db.collabExtension.findUniqueOrThrow({where:{tableId_recordId:{tableId:source,recordId:c.id}}})).values)[action.sourceFieldId],lawyers[0]);
  const stranger=await db.user.create({data:{username:key(),password:'unused'}});
  const outsider=new CollaborationService(db,await new AuthorizationContextLoader(db).load(stranger.id));
  await assert.rejects(outsider.createBusinessRecord(source,{name:'越权',phone:'13800001235',sourceFieldId:action.sourceFieldId,sourceValue:lawyers[0]},key()),/COLLAB_FORBIDDEN|COLLAB_NOT_FOUND/);
  assert.equal(await db.customer.count(),1);
});

test('authorized source editors can distribute without receiving target-table access; readonly source fields remain protected',async()=>{
  const action=await setup();
  const userId=(await db.user.create({data:{username:key(),password:'unused'}})).id;
  const workspaceId=(await db.collabBase.findUniqueOrThrow({where:{id:base}})).workspaceId;
  await db.collabMember.create({data:{workspaceId,principalId:userId,role:'EDITOR',rowScope:'ALL'}});
  const editor=new CollaborationService(db,{...svc.actor,userId,isSystemSuperAdmin:false});
  const targetId=action.routes[lawyers[0]].targetTableId;
  await db.collabTable.update({where:{id:targetId},data:{accessPolicy:{restricted:true,grants:[]}}});
  const created=await editor.createBusinessRecord(source,{name:'授权业务员录入',phone:'13800002222',sourceFieldId:action.sourceFieldId,sourceValue:lawyers[0]},key());
  assert.ok(created.id);
  assert.equal(await db.collabRecord.count({where:{tableId:targetId,archived:false}}),1);
  await assert.rejects(editor.query(targetId,{}),/COLLAB_FORBIDDEN/);
  const phone=(await svc.describe(source)).fields.find(f=>f.options.businessKey==='phone')!;
  await db.collabTable.update({where:{id:source},data:{accessPolicy:{restricted:false,grants:[{principalType:'USER',principalId:userId,role:'EDITOR',rowScope:'ALL',canCreate:true,hiddenFields:[],readonlyFields:[phone.id]}]}}});
  await assert.rejects(editor.createBusinessRecord(source,{name:'不能写只读字段',phone:'13800003333'},key()),/COLLAB_FIELD_UNAVAILABLE/);
  assert.equal(await db.customer.count(),1);
});

test('all six sources backfill existing customers, route new customers, and reassign without duplicates',async()=>{
  await configureCustomerRouting(db,user,{sourceTableId:source,sourceNames:lawyers,replaceLegacyTable:true},true);
  let action=(await db.collabRule.findFirstOrThrow({where:{tableId:source}})).action as unknown as CustomerRouteAction;
  const channels=customerRoutingSources.filter(name=>!lawyers.includes(name));
  const customers=[];
  for(const name of channels) customers.push(await svc.createBusinessRecord(source,{name:'渠道测试',phone:'13800002222',sourceFieldId:action.sourceFieldId,sourceValue:name},key()));
  assert.equal(await db.collabRecord.count(),0);
  action=await setup();
  assert.deepEqual(Object.keys(action.routes).sort(),[...customerRoutingSources].sort());
  for(const name of lawyers) customers.push(await svc.createBusinessRecord(source,{name:'律师测试',phone:'13800003333',sourceFieldId:action.sourceFieldId,sourceValue:name},key()));
  for(const route of Object.values(action.routes)) assert.equal(await db.collabRecord.count({where:{tableId:route.targetTableId,archived:false}}),1);
  const before=await db.collabRecord.findMany({orderBy:{id:'asc'}});
  await setup();
  assert.deepEqual(await db.collabRecord.findMany({orderBy:{id:'asc'}}),before);
  await assert.rejects(configureCustomerRouting(db,user,{sourceTableId:source,sourceNames:lawyers},true),/遗漏已有分发来源/);
  assert.equal(await db.collabRule.count(),1);
  // One customer moves through every destination. Other customers stay in place.
  for(const name of customerRoutingSources) {
    const detail=await svc.record(source,customers[0].id);
    await svc.saveRecord(source,customers[0].id,{schemaVersion:(await svc.describe(source)).table.schemaVersion,version:detail.record.version,values:{[action.sourceFieldId]:name}},key());
    assert.equal(await db.collabRecord.count({where:{archived:false}}),6);
    const customer=await db.customer.findUniqueOrThrow({where:{id:customers[0].id}});
    for(const [sourceName,route] of Object.entries(action.routes)) {
      const number=Object.keys(route.fields).find(id=>route.fields[id]==='customerNo')!;
      assert.equal(await db.collabRecord.count({where:{tableId:route.targetTableId,archived:false,values:{path:[number],equals:customer.customerNo}}}),sourceName===name?1:0);
    }
  }
});

test('retired table cleanup removes the exact dead directory entry and dependencies while keeping the replacement',async()=>{
  const action=await setup(), replacement=action.routes[lawyers[0]].targetTableId;
  const customer=await svc.createBusinessRecord(source,{name:'保留客户',phone:'13800001111',sourceFieldId:action.sourceFieldId,sourceValue:lawyers[0]},key());
  const view=await db.collabView.findFirstOrThrow({where:{tableId:legacy}});
  await db.collabPreference.create({data:{userId:user,tableId:legacy,viewId:view.id}});
  const preview=await removeRetiredCustomerTable(db,user,legacy,replacement);
  assert.equal(preview.removed,false);
  assert.equal(preview.counts?.preferences,1);
  await assert.rejects(removeRetiredCustomerTable(db,user,replacement,legacy,true),/不匹配/);
  const reference=await db.collabRule.create({data:{tableId:source,name:'残留引用',ownerId:user,trigger:'TEST',action:{targetTableId:legacy}}});
  await assert.rejects(removeRetiredCustomerTable(db,user,legacy,replacement,true),/自动化规则引用/);
  await db.collabRule.delete({where:{id:reference.id}});
  await removeRetiredCustomerTable(db,user,legacy,replacement,true);
  assert.equal(await db.collabTable.count({where:{id:legacy}}),0);
  assert.equal(await db.collabView.count({where:{tableId:legacy}}),0);
  assert.equal(await db.collabField.count({where:{tableId:legacy}}),0);
  assert.equal(await db.collabPreference.count({where:{tableId:legacy}}),0);
  assert.equal((await svc.listTables(base)).tables.some(t=>t.id===legacy),false);
  assert.equal((await svc.listTables(base)).tables.some(t=>t.id===replacement),true);
  assert.equal(await db.collabRecord.count({where:{tableId:replacement,archived:false}}),1);
  assert.ok(await db.customer.findUnique({where:{id:customer.id}}));
  assert.ok(await db.collabEvent.findFirst({where:{baseId:base,kind:'table.deleted'}}));
  assert.equal((await removeRetiredCustomerTable(db,user,legacy,replacement,true)).alreadyRemoved,true);
});
