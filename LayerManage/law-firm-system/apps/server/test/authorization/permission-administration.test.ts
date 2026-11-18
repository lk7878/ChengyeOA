import test from 'node:test';
import assert from 'node:assert/strict';
import authMiddleware from '../../app/middleware/auth';
import {createHash} from 'node:crypto';
import type {Context} from 'egg';
import { PrismaClient } from '@prisma/client';
import { RoleAuthorizationService } from '../../app/application/authorization/role-authorization-service';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ensureKnowledgeReviewers } from '../../app/application/smart-case/knowledge-review-eligibility';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
let db:PrismaClient, actor:AuthorizationContext, service:RoleAuthorizationService, userId:string;
const hasCode=(code:string)=>(e:unknown)=>(e as {code:string}).code===code;
test.before(()=>{db=createTestPrisma();});
test.beforeEach(async()=>{
 await clearTestApplicationData(db);
 const admin=await db.user.create({data:{username:'synthetic-admin',password:'unused'}});
 userId=(await db.user.create({data:{username:'synthetic-staff',password:'unused'}})).id;
 actor={userId:admin.id,employeeId:null,isSystemSuperAdmin:true,isSystemAdmin:false,grants:[],fieldRules:[],permissionCodes:PERMISSION_CATALOG.map(p=>p.code),evaluatedAt:new Date()};
 service=new RoleAuthorizationService(db,{actorUserId:admin.id},actor);
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();});
test('role deletion previews scheduled grants and atomically revokes them without reusing identity',async()=>{
 const role=await service.create({name:'合成角色',code:'SYNTHETIC',basicOffice:false});
 await db.userRole.create({data:{userId,roleId:role.id,validFrom:new Date(Date.now()+86400000)}});
 const impact=await service.deletionImpact(role.id);assert.equal(impact.members.length,1);
 await assert.rejects(()=>service.remove(role.id,{version:role.version}),hasCode('AUTHORIZATION_IN_USE'));
 await service.remove(role.id,{version:role.version,revokeMembers:true,impactToken:impact.token,reason:'已核对合成账号授权并撤销删除测试角色'});
 assert.equal((await db.userRole.findFirstOrThrow({where:{roleId:role.id}})).revokedByUserId,actor.userId);
 assert.equal((await db.role.findUniqueOrThrow({where:{id:role.id}})).status,'DELETED');
 const replacement=await service.create({name:'合成角色',basicOffice:false});assert.notEqual(replacement.id,role.id);
 assert.equal(await db.userRole.count({where:{roleId:replacement.id}}),0);
});
test('changed membership rejects stale deletion confirmation without revoking anything',async()=>{
 const role=await service.create({name:'并发授权',basicOffice:false}),impact=await service.deletionImpact(role.id);
 await db.userRole.create({data:{userId,roleId:role.id}});
 await assert.rejects(()=>service.remove(role.id,{version:role.version,revokeMembers:true,impactToken:impact.token,reason:'确认影响后尝试删除旧版预览的合成角色'}),hasCode('VERSION_CONFLICT'));
 assert.equal(await db.userRole.count({where:{roleId:role.id,revokedAt:null}}),1);
});
test('active approval references block deletion even with confirmed revocation',async()=>{
 const role=await service.create({name:'流程审批角色',code:'APPROVAL_FIXTURE',basicOffice:false});
 await db.approvalDefinition.create({data:{code:'FIXTURE',name:'合成流程',businessType:'LEAVE',createdBy:actor.userId,formSchema:{},approverRule:{type:'ROLE',roleCodes:[role.code]}}});
 const impact=await service.deletionImpact(role.id);assert.equal(impact.blockers.length,1);
 await assert.rejects(()=>service.remove(role.id,{version:role.version,revokeMembers:true,impactToken:impact.token,reason:'测试审批依赖必须先调整才能删除角色'}),hasCode('AUTHORIZATION_IN_USE'));
});
test('non-membership administrators cannot revoke members through role deletion',async()=>{
 const role=await service.create({name:'不可越权',basicOffice:false}),impact=await service.deletionImpact(role.id);
 const limited=new RoleAuthorizationService(db,{actorUserId:actor.userId},{...actor,isSystemSuperAdmin:false,permissionCodes:['role.status.manage']});
 await assert.rejects(()=>limited.remove(role.id,{version:role.version,revokeMembers:true,impactToken:impact.token,reason:'普通状态管理员不能通过删除角色撤销授权'}),hasCode('PRIVILEGE_ESCALATION_BLOCKED'));
});
test('non-table functions add dependencies atomically and preserve unrelated legacy rules',async()=>{
 let role=await service.create({name:'功能组角色',basicOffice:false});
 role=await service.replacePermissions(role.id,{version:role.version,permissionCodes:['case.read']});
 const scope=await db.dataScope.create({data:{name:'本人范围',scopeType:'SELF'}});
 role=await service.replaceDataScopes(role.id,{version:role.version,bindings:[{resource:'case',dataScopeId:scope.id}]});
 role=await service.saveOtherFunctions(role.id,{version:role.version,groupId:'employee',permissionCodes:['employee.update'],scopeIds:[scope.id]});
 assert.ok(role.permissionCodes.includes('employee.read'));assert.ok(role.permissionCodes.includes('menu.employee'));assert.ok(role.permissionCodes.includes('case.read'));
 assert.ok(!role.permissionCodes.includes('employee.leave'));assert.ok(!role.permissionCodes.includes('role.permission.manage'));
 assert.ok(role.dataScopeBindings.some(s=>s.resource==='case'&&s.dataScopeId===scope.id));
 await assert.rejects(()=>service.saveOtherFunctions(role.id,{version:role.version,groupId:'employee',permissionCodes:['role.permission.manage'],scopeIds:[]}),hasCode('AUTHORIZATION_INPUT_INVALID'));
});
test('knowledge review provisioning adds only review eligibility and remains idempotent, without smart access or AI administration',async()=>{
 await ensureKnowledgeReviewers(db,actor,[userId]);await ensureKnowledgeReviewers(db,actor,[userId]);
 const context=await new AuthorizationContextLoader(db).load(userId);
 assert.deepEqual(context.permissionCodes,['knowledge.review']);assert.equal(context.isSystemSuperAdmin,false);
 assert.equal(await db.userRole.count({where:{userId}}),1);
 await assert.rejects(()=>ensureKnowledgeReviewers(db,{...actor,isSystemSuperAdmin:false},[userId]),hasCode('COLLAB_FORBIDDEN'));
});

test('editing function operations preserves different resource scopes unless explicitly replaced',async()=>{
 let role=await service.create({name:'分资源范围',basicOffice:false});
 role=await service.replacePermissions(role.id,{version:role.version,permissionCodes:['employee.read','employee.assignment.read']});
 const own=await db.dataScope.create({data:{name:'本人',scopeType:'SELF'}}),all=await db.dataScope.create({data:{name:'全部',scopeType:'ALL'}});
 role=await service.replaceDataScopes(role.id,{version:role.version,bindings:[{resource:'employee',dataScopeId:own.id},{resource:'employee_assignment',dataScopeId:all.id}]});
 const before=role.dataScopeBindings;
 role=await service.saveOtherFunctions(role.id,{version:role.version,groupId:'employee',permissionCodes:['employee.update']});
 assert.deepEqual(role.dataScopeBindings,before);
});

test('Smart SSO may reach the narrow reviewer provisioning route but not general OA administration',async()=>{
 const entry=await db.role.create({data:{code:'SMART_CASE_USER',name:'智慧办案使用者',type:'BUSINESS',permissions:{create:{permissionId:'permission:menu.smart_case'}}}});
 await db.userRole.create({data:{userId,roleId:entry.id}});
 const session=await db.authSession.create({data:{userId,credentialVersion:1,refreshTokenHash:'fixture',assuranceLevel:'PASSWORD',expiresAt:new Date(Date.now()+3600000)}});
 const token='sc_synthetic_review_test';
 await db.smartCaseSession.create({data:{userId,sessionId:session.id,credentialVersion:1,assuranceLevel:'PASSWORD',hash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const ctx={path:'/api/v1/smart-case/knowledge-reviewers/ensure',get:()=> 'Bearer '+token,prisma:db,state:{}} as unknown as Context;
 let reached=false;await authMiddleware()(ctx,async()=>{reached=true});assert.equal(reached,true);
 await assert.rejects(()=>ensureKnowledgeReviewers(db,{...actor,isSystemSuperAdmin:false},[userId]),hasCode('COLLAB_FORBIDDEN'));
 ctx.path='/api/v1/users';await assert.rejects(()=>authMiddleware()(ctx,async()=>{}),hasCode('TOKEN_INVALID'));
});
