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

test('only active leaders see their teams even with ALL scope; super admins still see all', async () => {
  const own = await service.create({code:'OWN',name:'Own',categoryCode:'LEGAL',homeOrganizationId:rootId});
  const other = await service.create({code:'OTHER',name:'Other',categoryCode:'LEGAL',homeOrganizationId:branchId});
  await service.addMember(own.id,{employeeId:employeeA,memberRole:'LEAD'});
  await service.addMember(other.id,{employeeId:employeeA,memberRole:'LAWYER'});
  const leader = new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({employeeId:employeeA,superAdmin:false}));
  assert.deepEqual((await leader.list({page:1,pageSize:20})).list.map(t=>t.id),[own.id]);
  assert.equal((await service.list({page:1,pageSize:20})).list.length,2);
  await assert.rejects(()=>leader.detail(other.id),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(()=>leader.addMember(other.id,{employeeId:employeeB,memberRole:'EXPERT'}),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(()=>leader.memberOptions(other.id),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(()=>leader.update(other.id,{name:'changed',version:2}),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(()=>leader.remove(other.id,2),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(()=>leader.replaceLead(other.id,{employeeId:employeeB,teamVersion:2}),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  const added=await leader.addMember(own.id,{employeeId:employeeB,memberRole:'LAWYER'});
  const member=added.members.find(m=>m.employeeId===employeeB)!;
  await leader.endMember(own.id,member.id,member.version);
  const options=await leader.memberOptions(own.id,'EMP-B');
  assert.deepEqual(options,[{id:employeeB,name:'EMP-B',employeeNo:'EMP-B'}]);
  const detail=await leader.detail(own.id);
  assert.equal(detail.homeOrganizationName,'Root');
  assert.equal(detail.members.find(m=>m.employeeId===employeeB)?.employeeName,'EMP-B');
  await service.replaceLead(own.id,{employeeId:employeeB,teamVersion:detail.version});
  assert.deepEqual((await leader.list({page:1,pageSize:20})).list,[]);
  await assert.rejects(()=>leader.addMember(own.id,{employeeId:employeeA,memberRole:'LAWYER'}),hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  const unbound = new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({superAdmin:false}));
  assert.deepEqual((await unbound.list({page:1,pageSize:20})).list,[]);
});

test('expired and future leader assignments do not grant team visibility',async()=>{
  const team=await service.create({code:'DATES',name:'Dates',categoryCode:'LEGAL',homeOrganizationId:rootId});
  const member=await prisma.professionalTeamMember.create({data:{professionalTeamId:team.id,employeeId:employeeA,memberRole:'LEAD',startedAt:new Date(Date.now()+3600000)}});
  const leader=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({employeeId:employeeA,superAdmin:false}));
  assert.equal((await leader.list({page:1,pageSize:20})).pagination.total,0);
  await prisma.professionalTeamMember.update({where:{id:member.id},data:{startedAt:new Date('2026-01-01'),endedAt:new Date('2026-01-02')}});
  assert.equal((await leader.list({page:1,pageSize:20})).pagination.total,0);
});

test('requires both team and employee scope for member operations',async()=>{
  const branchTeam=await service.create({code:'MEMBER_SCOPE',name:'Member Scope',categoryCode:'LEGAL',homeOrganizationId:branchId});
  const branchScope=await prisma.dataScope.create({data:{
    name:'Branch member manage',scopeType:'BRANCH',organizationId:branchId,includeDescendants:true,
  }});
  await service.addMember(branchTeam.id,{employeeId:employeeB,memberRole:'LEAD'});
  const scoped=new ProfessionalTeamService(prisma,{actorUserId:'team-actor'},teamContext({
    permissionCodes:['professional_team.member.manage'],scopeIds:[branchScope.id],employeeId:employeeB,superAdmin:false,
  }));
  assert.deepEqual((await scoped.memberOptions(branchTeam.id)).map(e=>e.id),[employeeB]);
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


test('recreates a deleted team with the same name and code without inheriting memberships or scopes', async () => {
  const input = { code: 'REUSABLE', name: '医疗专业团队', categoryCode: '医疗', homeOrganizationId: rootId };
  const old = await service.create(input);
  const member = await prisma.professionalTeamMember.create({ data: { professionalTeamId: old.id, employeeId: employeeA, memberRole: 'LEAD', startedAt: new Date('2026-01-01') } });
  const scope = await prisma.dataScope.create({ data: { name: '旧团队授权', scopeType: 'TEAM', professionalTeamId: old.id } });
  await service.remove(old.id, old.version);
  const recreated = await service.create(input);
  assert.notEqual(recreated.id, old.id);
  assert.equal(recreated.name, old.name);
  assert.equal(recreated.code, old.code);
  assert.deepEqual(recreated.members, []);
  assert.equal(await prisma.dataScope.count({ where: { professionalTeamId: recreated.id } }), 0);
  assert.equal((await prisma.dataScope.findUniqueOrThrow({ where: { id: scope.id } })).professionalTeamId, old.id);
  const historicalMember = await prisma.professionalTeamMember.findUniqueOrThrow({ where: { id: member.id } });
  assert.equal(historicalMember.professionalTeamId, old.id);
  assert.ok(historicalMember.endedAt);
  const historicalTeam = await prisma.professionalTeam.findUniqueOrThrow({ where: { id: old.id } });
  assert.ok(historicalTeam.deletedAt);
  assert.equal(historicalTeam.code, old.code);
  await assert.rejects(() => service.enable(old.id, historicalTeam.version), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  const listing = await service.list({ page: 1, pageSize: 10, keyword: input.name });
  assert.deepEqual(listing.list.map(team => team.id), [recreated.id]);
  await service.remove(recreated.id, recreated.version);
  const third = await service.create(input);
  assert.notEqual(third.id, recreated.id);
  assert.equal(await prisma.professionalTeam.count({ where: { code: input.code } }), 3);
});

test('legacy deleted teams release codes while enabled and disabled teams reserve codes globally', async () => {
  const input = { code: 'LEGACY_TEAM', name: '历史团队', categoryCode: 'LEGAL', homeOrganizationId: rootId };
  const old = await prisma.professionalTeam.create({ data: { ...input, status: 'DISABLED', deletedAt: new Date() } });
  const current = await service.create({ ...input, code: ' legacy_team ', homeOrganizationId: branchId });
  assert.notEqual(current.id, old.id);
  await assert.rejects(() => service.create(input), hasCode('MASTER_DATA_CODE_CONFLICT'));
  await service.disable(current.id, current.version);
  await assert.rejects(() => service.create(input), hasCode('MASTER_DATA_CODE_CONFLICT'));
  // Names are descriptive, not unique identifiers; a different code remains valid.
  const sameName = await service.create({ ...input, code: 'OTHER_TEAM' });
  assert.equal(sameName.name, old.name);
});

test('concurrent recreation of a deleted team code creates only one replacement', async () => {
  const input = { code: 'RACE_TEAM', name: '并发团队', categoryCode: 'LEGAL', homeOrganizationId: rootId };
  const old = await service.create(input);
  await service.remove(old.id, old.version);
  const results = await Promise.allSettled([service.create(input), service.create({ ...input, homeOrganizationId: branchId })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected && hasCode('MASTER_DATA_CODE_CONFLICT')(rejected.reason));
});

test('failed team recreation rolls back the new identity and preserves deleted history', async () => {
  const input = { code: 'ROLLBACK_REUSE', name: '重建回滚团队', categoryCode: 'LEGAL', homeOrganizationId: rootId };
  const old = await service.create(input);
  await service.remove(old.id, old.version);
  const before = await prisma.professionalTeam.findUniqueOrThrow({ where: { id: old.id } });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_team_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_team_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_team_audit()`);
  await assert.rejects(() => service.create(input));
  assert.equal(await prisma.professionalTeam.count({ where: { code: input.code } }), 1);
  assert.deepEqual(await prisma.professionalTeam.findUniqueOrThrow({ where: { id: old.id } }), before);
  await dropAuditTrigger();
  assert.notEqual((await service.create(input)).id, old.id);
});
