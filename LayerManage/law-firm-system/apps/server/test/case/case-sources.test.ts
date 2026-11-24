import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseSourceService } from '../../app/application/case/case-sources';
import { CaseService } from '../../app/application/case/case-service';
import { caseCustomerContext, CaseIntakeCustomerService } from '../../app/application/case/intake-customers';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';

test('source dictionary is global business metadata; only superadmin maintains it and source never grants case access', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const root = await db.user.create({data:{username:'source-admin',password:'unused'}});
    const role = await db.role.create({data:{name:'source-admin',code:'SYSTEM_SUPER_ADMIN',type:'SYSTEM'}});
    await db.userRole.create({data:{userId:root.id,roleId:role.id,validFrom:new Date(0)}});
    const admin = await new AuthorizationContextLoader(db).load(root.id);
    async function lawyer(name:string):Promise<AuthorizationContext> {
      const employee = await db.employee.create({data:{employeeNo:key(),name,phone:'0',type:'LAWYER',entryDate:new Date()}});
      const user = await db.user.create({data:{username:name,password:'unused',employeeId:employee.id}});
      const permissions:AuthorizationContext['permissionCodes']=['case.create','case.read','case.update'];
      return {userId:user.id,employeeId:employee.id,isSystemAdmin:false,isSystemSuperAdmin:false,evaluatedAt:new Date(),fieldRules:[],permissionCodes:permissions,
        grants:permissions.map(permissionCode=>({sourceType:'ROLE',sourceId:'fixture',permissionCode,resource:'case',scopeIds:['worksheet:self'],validUntil:null}))};
    }
    const a = await lawyer('source-lawyer'), b = await lawyer('source-other');
    const sources = new CaseSourceService(db,admin), ordinary = new CaseSourceService(db,a);
    for(const name of ['个人','大数据中心','侵权中心','律师部','门市']) await sources.save({name});
    await assert.rejects(ordinary.save({name:'越权来源'}), /仅超级管理员/);
    const forged = new CaseSourceService(db,{...a,isSystemSuperAdmin:true});
    await assert.rejects(forged.save({name:'伪造权限'}), /仅超级管理员/);
    assert.equal((await ordinary.list()).canManage,false);
    assert.equal((await ordinary.list()).items.length,5);
    await assert.rejects(sources.save({name:'门市'}), /已存在/);
    const orgId=key();
    const org = await db.organization.create({data:{id:orgId,code:key(),name:'律师部',type:'DEPARTMENT',path:'/'+orgId}});
    const customer = await new CaseIntakeCustomerService(db,{actorUserId:a.userId},a).create({name:'来源合成客户',phone:'13800000001'});
    const service = new CaseService(db,{actorUserId:a.userId},caseCustomerContext(a));
    const input={customerId:customer.customer.id,lawyerId:a.employeeId!,caseType:'合成纠纷',branchId:org.id,intakeData:{caseSource:'侵权中心'}};
    const row=await service.createCase(input);
    assert.equal(row.intakeData.caseSource,'侵权中心');
    assert.equal((await db.case.findUniqueOrThrow({where:{id:row.id}})).branchId,org.id);
    await assert.rejects(new CaseService(db,{actorUserId:b.userId},caseCustomerContext(b)).getCase(row.id));
    await assert.rejects(service.createCase({...input,intakeData:{caseSource:'不存在'}}), /案件来源/);
    const stopped=await sources.save({name:'侵权中心',version:1,enabled:false});
    assert.equal((await ordinary.list()).items.some(s=>s.name==='侵权中心'),false);
    await assert.rejects(service.createCase(input), /案件来源/);
    await assert.rejects(sources.save({name:'侵权中心',version:1,enabled:true}), /已被修改/);
    // An unchanged historical choice remains editable; other case data is not overwritten.
    const updated=await service.updateCase(row.id,{version:row.version,intakeData:{caseSource:'侵权中心',region:'修订地区'}});
    assert.equal(updated.intakeData.caseSource,'侵权中心');
    assert.equal(updated.intakeData.region,'修订地区');
    await sources.save({name:'侵权中心',version:stopped.version,enabled:true});
    assert.equal((await ordinary.list()).items.length,5);
    const owner=new CollaborationService(db,admin);
    const workspace=await owner.createWorkspace({name:'来源测试',organizationId:org.id},key());
    const base=await owner.createBase(workspace.id,{name:'来源测试'},key());
    const table=await owner.createTable(base.id,{name:'案件表',source:'CASES'},key());
    const description=await owner.describe(table.id);
    const field=description.fields.find(f=>(f.options as {businessKey?:string}).businessKey==='intake.caseSource')!;
    assert.equal(field.type,'SINGLE_SELECT');
    assert.equal((field.options as {choices:unknown[]}).choices.length,5);
    const grid=await owner.record(table.id,row.id);
    assert.equal((grid.record.values as Record<string,unknown>)[field.id],'侵权中心');
    await assert.rejects(owner.saveRecord(table.id,row.id,{values:{[field.id]:'伪造来源'},version:grid.record.version,schemaVersion:description.table.schemaVersion},key()),/案件来源/);
    assert.equal((await db.case.findUniqueOrThrow({where:{id:row.id}})).branchId,org.id);
    assert.ok(await db.operationLog.count({where:{action:'CASE_SOURCE_SAVE'}})>=7);
  } finally {await clearTestApplicationData(db);await db.$disconnect();}
});

test('schema upgrade adds source to existing default views while preserving historical intake and private views', async () => {
  const db=createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const user=await db.user.create({data:{username:'migration-source',password:'unused'}});
    const orgId=key();
    await db.organization.create({data:{id:orgId,code:key(),name:'旧组织',type:'FIRM',path:'/'+orgId}});
    const workspace=await db.collabWorkspace.create({data:{name:'旧工作区',organizationId:orgId,ownerId:user.id}});
    const base=await db.collabBase.create({data:{workspaceId:workspace.id,name:'旧工作表'}});
    const table=await db.collabTable.create({data:{baseId:base.id,name:'旧案件表',source:'CASES',createdBy:user.id}});
    const old=await db.collabField.create({data:{tableId:table.id,name:'案件来源',type:'TEXT'}});
    const defaultView=await db.collabView.create({data:{tableId:table.id,name:'总表',ownerId:user.id,shared:true,isDefault:true,config:{visibleFields:[old.id]}}});
    const privateView=await db.collabView.create({data:{tableId:table.id,name:'个人视图',ownerId:user.id,config:{visibleFields:[old.id]}}});
    const customer=await db.customer.create({data:{customerNo:key(),name:'历史客户',phone:'0',phoneHash:key(),createdBy:user.id}});
    const row=await db.case.create({data:{caseNo:key(),title:'历史案件',caseType:'民事',customerId:customer.id,branchId:orgId,intakeData:{region:'历史地区'}}});
    const {readFile}=await import('node:fs/promises');
    const sql=await readFile('prisma/migrations/20261124170000_case_sources/migration.sql','utf8');
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('DROP TABLE case_source');
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      assert.equal(await tx.caseSource.count(),5);
      const source=await tx.collabField.findFirstOrThrow({where:{tableId:table.id,options:{path:['businessKey'],equals:'intake.caseSource'}}});
      assert.equal(source.name,'案件来源（业务字典）');
      assert.equal(source.type,'SINGLE_SELECT');
      assert.deepEqual((await tx.collabView.findUniqueOrThrow({where:{id:defaultView.id}})).config,{visibleFields:[old.id,source.id]});
      assert.deepEqual((await tx.collabView.findUniqueOrThrow({where:{id:privateView.id}})).config,{visibleFields:[old.id]});
      const history=await tx.case.findUniqueOrThrow({where:{id:row.id}});
      assert.deepEqual(history.intakeData,{region:'历史地区'});
      assert.equal(history.branchId,orgId);
    });
  } finally {await clearTestApplicationData(db);await db.$disconnect();}
});
