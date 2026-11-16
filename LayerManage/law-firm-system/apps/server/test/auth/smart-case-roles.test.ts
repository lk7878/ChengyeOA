import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestPrisma,clearTestApplicationData} from '../helpers/test-database';
import {smartCaseRoleIds} from '../../app/application/smart-case/roles';
const db=createTestPrisma();
test.before(async()=>{await clearTestApplicationData(db)});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect()});
test('smart case returns only live memberships, including roles with no OA permission grants',async()=>{
 const user=await db.user.create({data:{username:'smart-roles',password:'unused'}}),now=new Date('2026-11-16T00:00:00Z');
 for(const name of ['live','future','expired','revoked','disabled']){const role=await db.role.create({data:{name,code:'TEST_'+name,type:'BUSINESS',status:name==='disabled'?'DISABLED':'ENABLED'}});await db.userRole.create({data:{userId:user.id,roleId:role.id,source:name==='expired'?'TEMPORARY':'PERMANENT',validFrom:new Date(name==='future'?'2026-11-17':'2026-11-01'),validUntil:name==='expired'?now:null,revokedAt:name==='revoked'?now:null,revokedByUserId:name==='revoked'?user.id:null,revokeReason:name==='revoked'?'test role revocation':null}})}
 const roles=await smartCaseRoleIds(db,user.id,now);assert.equal(roles.length,1);assert.equal((await db.role.findUniqueOrThrow({where:{id:roles[0]}})).name,'live');
 await db.userRole.updateMany({where:{userId:user.id,roleId:roles[0]},data:{revokedAt:now,revokedByUserId:user.id,revokeReason:'test role revocation'}});assert.deepEqual(await smartCaseRoleIds(db,user.id,now),[]);
});
