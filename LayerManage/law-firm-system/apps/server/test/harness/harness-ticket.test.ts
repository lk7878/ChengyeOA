import test from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { HarnessTicketService } from '../../app/application/harness/harness-ticket-service';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { JwtTokenService } from '../../app/domain/security/token-service';
process.env.EGG_TYPESCRIPT='true';
const app=mm.app();let db:PrismaClient,service:HarnessTicketService,token:string;
const secret=process.env.JWT_SECRET!,challenge='a'.repeat(64);
test.before(async()=>{db=createTestPrisma();await app.ready();});
test.beforeEach(async()=>{
  await clearTestApplicationData(db);
  const user=await db.user.create({data:{username:'harness-admin',password:'test-only',mustChangePassword:false}});
  const role=await db.role.create({data:{code:'SYSTEM_SUPER_ADMIN',name:'超级管理员',type:'SYSTEM',status:'ENABLED'}});
  await db.userRole.create({data:{userId:user.id,roleId:role.id}});
  token=(await createApiSession(db,user.id,'MFA')).token;service=new HarnessTicketService(db,secret);
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();await app.close();await mm.restore();});
async function issue(feature='knowledge'){
  const user=new JwtTokenService(secret).verifySessionAccess(token),context=await new AuthorizationContextLoader(db).load(user.userId);
  return service.issue({feature,challenge},user,context);
}
test('launch ticket is scoped to purpose and challenge and cannot authenticate as an OA access token',async()=>{
  const {ticket}=await issue();
  const result=await service.verify({ticket,challenge,feature:'knowledge'});assert.equal(result.protocol,1);assert.equal(result.feature,'knowledge');
  assert.throws(()=>new JwtTokenService(secret).verifySessionAccess(ticket));
  await assert.rejects(service.verify({ticket,challenge:'b'.repeat(64),feature:'knowledge'}));
  await assert.rejects(service.verify({ticket,challenge,feature:'smart-case'}));
  await assert.rejects(service.verify({ticket:ticket.slice(0,-8)+'tampered',challenge,feature:'knowledge'}));
  await assert.rejects(service.verify({ticket:token,challenge,feature:'knowledge'}));
});
test('expired tickets and revoked sessions cannot launch the local application',async()=>{
  const {ticket}=await issue();const claims=jwt.decode(ticket) as jwt.JwtPayload;delete claims.exp;delete claims.iat;
  const expired=jwt.sign({...claims,iat:Math.floor(Date.now()/1000)-120},secret,{algorithm:'HS256',expiresIn:60});
  await assert.rejects(service.verify({ticket:expired,challenge,feature:'knowledge'}));
  await db.authSession.updateMany({data:{revokedAt:new Date()}});
  await assert.rejects(service.verify({ticket,challenge,feature:'knowledge'}));
});
test('revoked menu permissions are checked again at redemption',async()=>{
  const {ticket}=await issue();await db.userRole.deleteMany();
  await assert.rejects(service.verify({ticket,challenge,feature:'knowledge'}));
  const user=new JwtTokenService(secret).verifySessionAccess(token);const context=await new AuthorizationContextLoader(db).load(user.userId);
  assert.throws(()=>service.issue({feature:'knowledge',challenge},user,context));
});
test('disabled accounts cannot redeem an issued ticket',async()=>{
  const {ticket}=await issue();await db.user.updateMany({data:{status:'DISABLED'}});
  await assert.rejects(service.verify({ticket,challenge,feature:'knowledge'}));
});

test('V1.2 retires connector HTTP endpoints and removes public ticket verification',async()=>{
  await app.httpRequest().post('/api/v1/harness/ticket').send({feature:'knowledge',challenge}).expect(401);
  await app.httpRequest().post('/api/v1/harness/ticket').set({Authorization:'Bearer '+token}).send({feature:'knowledge',challenge}).expect(404);
  await app.httpRequest().post('/api/v1/harness/verify-ticket').send({ticket:'invalid',feature:'knowledge',challenge}).expect(401);
});
