import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ProfessionalTeamService } from '../../app/application/master-data/professional-team-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let branchId: string;
let employeeA: string;
let employeeB: string;
let service: ProfessionalTeamService;

const TEAM_PERMISSIONS = [
  'professional_team.read', 'professional_team.create', 'professional_team.update',
  'professional_team.status.manage', 'professional_team.member.manage', 'professional_team.lead.manage',
] as const;

function teamContext(input: {
  permissionCodes?: AuthorizationContext['permissionCodes'];
  scopeIds?: string[];
  employeeId?: string | null;
  superAdmin?: boolean;
} = {}): AuthorizationContext {
  const permissionCodes = input.permissionCodes ?? [...TEAM_PERMISSIONS];
  const scopeIds = input.scopeIds ?? ['ALL'];
  return {
    userId: 'team-actor', employeeId: input.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: input.superAdmin ?? scopeIds.includes('ALL'),
    grants: permissionCodes.map(permissionCode => ({
      sourceType: input.superAdmin === false ? 'ROLE' as const : 'SYSTEM_SUPER_ADMIN' as const,
      sourceId: 'team-role-grant', sourceRoleId: input.superAdmin === false ? 'team-role' : undefined,
      permissionCode,
      resource: 'professional_team',
      scopeIds, validUntil: null as Date | null,
    })),
    fieldRules: [], permissionCodes, evaluatedAt: new Date(),
  };
}

async function makeEmployee(no: string, orgId: string, positionId: string) {
  const employee = await prisma.employee.create({ data: { employeeNo: no, name: no, phone: '13800000000', type: 'LAWYER', entryDate: new Date('2026-01-01') } });
  await prisma.employeeAssignment.create({ data: { employeeId: employee.id, organizationId: orgId, positionId, assignmentType: 'PRIMARY', startedAt: employee.entryDate } });
  return employee;
}
async function dropAuditTrigger(){await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_team_audit_trigger ON "operation_log"');await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_team_audit()');}

test.before(async()=>{prisma=createTestPrisma();});
test.beforeEach(async()=>{
  await dropAuditTrigger(); await clearTestApplicationData(prisma);
  rootId=randomUUID(); branchId=randomUUID();
  await prisma.organization.create({data:{id:rootId,code:'ROOT',name:'Root',type:'FIRM',path:`/${rootId}`}});
  await prisma.organization.create({data:{id:branchId,code:'BRANCH',name:'Branch',type:'BRANCH',parentId:rootId,path:`/${rootId}/${branchId}`,level:1}});
  const rootPosition=await prisma.position.create({data:{organizationId:rootId,code:'LAWYER',name:'Lawyer',categoryCode:'LEGAL'}});
  const branchPosition=await prisma.position.create({data:{organizationId:branchId,code:'LAWYER',name:'Lawyer',categoryCode:'LEGAL'}});
  employeeA=(await makeEmployee('EMP-A',rootId,rootPosition.id)).id;
  employeeB=(await makeEmployee('EMP-B',branchId,branchPosition.id)).id;
  service=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext());
});
test.after(async()=>{await dropAuditTrigger();await clearTestApplicationData(prisma);await prisma.$disconnect();});

test('creates open-category teams and accepts cross-office members',async()=>{
  const team=await service.create({code:'FUTURE_AI',name:'Future AI',categoryCode:'NEW_CATEGORY',homeOrganizationId:rootId});
  await service.addMember(team.id,{employeeId:employeeA,memberRole:'LEAD'});
  const detail=await service.addMember(team.id,{employeeId:employeeB,memberRole:'EXPERT'});
  assert.deepEqual(detail.members.filter(x=>x.endedAt===null).map(x=>x.employeeId).sort(),[employeeA,employeeB].sort());
});

test('maps team code and active membership races to stable conflicts',async()=>{
  const results=await Promise.allSettled([
    service.create({code:'DUP_TEAM',name:'Team 1',categoryCode:'LEGAL',homeOrganizationId:rootId}),
    service.create({code:'DUP_TEAM',name:'Team 2',categoryCode:'LEGAL',homeOrganizationId:branchId}),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const rejected=results.find((x):x is PromiseRejectedResult=>x.status==='rejected');assert.ok(rejected);assert.equal(hasCode('MASTER_DATA_CODE_CONFLICT')(rejected.reason),true);
  const team=await service.create({code:'MEMBERS',name:'Members',categoryCode:'LEGAL',homeOrganizationId:rootId});
  await service.addMember(team.id,{employeeId:employeeA,memberRole:'LAWYER'});
  await assert.rejects(()=>service.addMember(team.id,{employeeId:employeeA,memberRole:'EXPERT'}),hasCode('MASTER_DATA_IN_USE'));
  await service.addMember(team.id,{employeeId:employeeB,memberRole:'LEAD'});
  await assert.rejects(()=>service.addMember(team.id,{employeeId:employeeA,memberRole:'LEAD'}),hasCode('TEAM_LEAD_CONFLICT'));
});

test('replaces the lead atomically and preserves ended membership history',async()=>{
  const team=await service.create({code:'LEAD_TEAM',name:'Lead Team',categoryCode:'LEGAL',homeOrganizationId:rootId});
  await service.addMember(team.id,{employeeId:employeeA,memberRole:'LEAD'});
  const before=await service.detail(team.id);
  const replaced=await service.replaceLead(team.id,{employeeId:employeeB,teamVersion:before.version});
  assert.equal(replaced.members.filter(x=>x.memberRole==='LEAD'&&x.endedAt===null)[0].employeeId,employeeB);
  assert.ok(replaced.members.find(x=>x.employeeId===employeeA&&x.endedAt!==null));
});

test('blocks disable with active members and enforces versions and enabled references',async()=>{
  const team=await service.create({code:'STATE_TEAM',name:'State Team',categoryCode:'LEGAL',homeOrganizationId:rootId});
  const withMember=await service.addMember(team.id,{employeeId:employeeA,memberRole:'LAWYER'});
  await assert.rejects(()=>service.disable(team.id,withMember.version),hasCode('MASTER_DATA_IN_USE'));
  const member=withMember.members[0]; await service.endMember(team.id,member.id,member.version);
  await assert.rejects(()=>service.disable(team.id,1),hasCode('VERSION_CONFLICT'));
  const current=await service.detail(team.id); const disabled=await service.disable(team.id,current.version); assert.equal(disabled.status,'DISABLED');
  await prisma.organization.update({where:{id:rootId},data:{status:'DISABLED'}});
  await assert.rejects(()=>service.enable(team.id,disabled.version),hasCode('MASTER_DATA_IN_USE'));
});

test('rolls back creation when team audit fails',async()=>{
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_team_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_team_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_team_audit()`);
  await assert.rejects(()=>service.create({code:'ROLLBACK_TEAM',name:'Rollback',categoryCode:'LEGAL',homeOrganizationId:rootId}));
  assert.equal(await prisma.professionalTeam.count({where:{code:'ROLLBACK_TEAM'}}),0);
});

test('unions home-organization TEAM and active SELF team visibility without ended memberships',async()=>{
  const rootTeam=await service.create({code:'ROOT_TEAM',name:'Root Team',categoryCode:'LEGAL',homeOrganizationId:rootId});
  const branchTeam=await service.create({code:'BRANCH_TEAM',name:'Branch Team',categoryCode:'LEGAL',homeOrganizationId:branchId});
  const memberDetail=await service.addMember(rootTeam.id,{employeeId:employeeA,memberRole:'LAWYER'});
  const member=memberDetail.members.find(item=>item.employeeId===employeeA)!;
  const branchScope=await prisma.dataScope.create({data:{
    name:'Branch teams',scopeType:'BRANCH',organizationId:branchId,includeDescendants:true,
  }});
  const teamScope=await prisma.dataScope.create({data:{
    name:'Root team only',scopeType:'TEAM',professionalTeamId:rootTeam.id,
  }});
  const selfScope=await prisma.dataScope.create({data:{name:'Current member self',scopeType:'SELF'}});

  const branchReader=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.read'],scopeIds:[branchScope.id],superAdmin:false,
  }));
  assert.deepEqual((await branchReader.list({page:1,pageSize:20})).list.map(item=>item.id),[branchTeam.id]);
  await assert.rejects(()=>branchReader.detail(rootTeam.id),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));

  const teamReader=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.read'],scopeIds:[teamScope.id],superAdmin:false,
  }));
  assert.deepEqual((await teamReader.list({page:1,pageSize:20})).list.map(item=>item.id),[rootTeam.id]);

  const selfReader=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.read'],scopeIds:[selfScope.id],employeeId:employeeA,superAdmin:false,
  }));
  assert.deepEqual((await selfReader.list({page:1,pageSize:20})).list.map(item=>item.id),[rootTeam.id]);
  await service.endMember(rootTeam.id,member.id,member.version);
  const endedSelfReader=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.read'],scopeIds:[selfScope.id],employeeId:employeeA,superAdmin:false,
  }));
  assert.deepEqual((await endedSelfReader.list({page:1,pageSize:20})).list,[]);
});

test('requires both team and employee scope for member operations',async()=>{
  const branchTeam=await service.create({code:'MEMBER_SCOPE',name:'Member Scope',categoryCode:'LEGAL',homeOrganizationId:branchId});
  const branchScope=await prisma.dataScope.create({data:{
    name:'Branch member manage',scopeType:'BRANCH',organizationId:branchId,includeDescendants:true,
  }});
  const scoped=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.member.manage'],scopeIds:[branchScope.id],superAdmin:false,
  }));
  assert.equal((await scoped.addMember(branchTeam.id,{employeeId:employeeB,memberRole:'LAWYER'})).activeMemberCount,1);
  await assert.rejects(
    ()=>scoped.addMember(branchTeam.id,{employeeId:employeeA,memberRole:'EXPERT'}),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('characterizes governance-shared description and status mutations with audit output',async()=>{
  const team=await service.create({code:'SHARED_TEAM',name:'Shared Team',categoryCode:'LEGAL',homeOrganizationId:rootId});
  const updated=await service.update(team.id,{description:'  Governance description  ',version:team.version});
  const disabled=await service.disable(team.id,updated.version);
  const enabled=await service.enable(team.id,disabled.version);
  assert.equal(updated.description,'Governance description');
  assert.equal(disabled.status,'DISABLED');
  assert.equal(enabled.status,'ENABLED');
  assert.equal(enabled.version,4);
  const logs=await prisma.operationLog.findMany({where:{targetId:team.id},orderBy:{createdAt:'asc'}});
  assert.deepEqual(logs.map(log=>log.action),['CREATE','UPDATE','DISABLE','ENABLE']);
  assert.deepEqual(JSON.parse(logs[1].newValues??'{}'),{
    code:'SHARED_TEAM',categoryCode:'LEGAL',organizationId:rootId,status:'ENABLED',version:2,
  });
});

test('team category supports trimmed Chinese creation, update and exact filtering', async () => {
  const team = await service.create({ code: 'CHINESE', name: '民商事团队', categoryCode: ' 民商事 / 争议解决 ', homeOrganizationId: rootId });
  assert.equal(team.categoryCode, '民商事 / 争议解决');
  const changed = await service.update(team.id, { categoryCode: '刑事辩护', version: team.version });
  assert.equal(changed.categoryCode, '刑事辩护');
  assert.equal((await service.list({ page: 1, pageSize: 20, categoryCode: ' 刑事辩护 ' })).list.length, 1);
});
