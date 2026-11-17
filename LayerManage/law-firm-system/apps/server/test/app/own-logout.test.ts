import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import mm from 'egg-mock';
import {createTestPrisma,clearTestApplicationData} from '../helpers/test-database';
import {createApiSession} from '../helpers/auth-session';
const app=mm.app(),db=createTestPrisma();
const secret='01234567890123456789012345678901',origin='http://localhost:3000';
test.before(async()=>{await app.ready();});
test.beforeEach(async()=>{await clearTestApplicationData(db);});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();await app.close();});
async function account(name:string){const user=await db.user.create({data:{username:name,password:'unused'}});return {user,...await createApiSession(db,user.id)};}
function exit(s:Awaited<ReturnType<typeof account>>,token=s.token,refresh=s.refreshToken){return app.httpRequest().post('/api/v1/auth/logout').set('Origin',origin).set('Authorization',`Bearer ${token}`).set('X-CSRF-Token',s.csrfToken).set('Cookie',`chengye_refresh=${refresh}; chengye_csrf=${s.csrfToken}`);}

test('ordinary user logout revokes its real session and refresh credential, clears cookies, preserves other users',async()=>{
  const a=await account('logout-a'),b=await account('logout-b');
  const r=await exit(a).send({sessionId:b.sessionId}).expect(200);
  assert.ok((await db.authSession.findUniqueOrThrow({where:{id:a.sessionId}})).revokedAt);
  assert.equal((await db.authSession.findUniqueOrThrow({where:{id:b.sessionId}})).revokedAt,null);
  assert.match(String(r.headers['set-cookie']),/chengye_refresh=;/);
  await app.httpRequest().get('/api/v1/auth/me').set('Authorization',`Bearer ${a.token}`).expect(401);
  await app.httpRequest().post('/api/v1/auth/refresh').set('Origin',origin).set('X-CSRF-Token',a.csrfToken).set('Cookie',`chengye_refresh=${a.refreshToken}; chengye_csrf=${a.csrfToken}`).expect(401);
  await exit(a).expect(200);
  const next=await createApiSession(db,a.user.id);await app.httpRequest().get('/api/v1/auth/me').set('Authorization',`Bearer ${next.token}`).expect(200);
});

test('expired access/session and disabled account can revoke themselves without business permissions',async()=>{
  const a=await account('expired-exit');
  const expired=jwt.sign({userId:a.user.id,sessionId:a.sessionId,credentialVersion:1,assuranceLevel:'PASSWORD',tokenType:'access'},secret,{expiresIn:-1,algorithm:'HS256'});
  await db.user.update({where:{id:a.user.id},data:{status:'DISABLED'}});
  await db.authSession.update({where:{id:a.sessionId},data:{expiresAt:new Date(0)}});
  await app.httpRequest().get('/api/v1/auth/me').set('Authorization',`Bearer ${expired}`).expect(401);
  await exit(a,expired).expect(200);
  assert.ok((await db.authSession.findUniqueOrThrow({where:{id:a.sessionId}})).revokedAt);
});

test('CSRF mismatch reproduces the old 403; foreign origins, forged tokens and mixed account credentials cannot revoke',async()=>{
  const a=await account('safe-a'),b=await account('safe-b');
  const stale=await exit(a).set('X-CSRF-Token','stale-tab-value').expect(403);assert.equal(stale.body.message,'CSRF_INVALID');
  await exit(a).set('Origin','https://attacker.example').expect(403);
  await exit(a,'forged-token').expect(401);
  const mixed=await exit(a,a.token,b.refreshToken).expect(409);assert.equal(mixed.body.message,'LOGOUT_SESSION_CHANGED');assert.equal(mixed.headers['set-cookie'],undefined);
  for(const s of [a,b])assert.equal((await db.authSession.findUniqueOrThrow({where:{id:s.sessionId}})).revokedAt,null);
  await exit(a).expect(200);
  await app.httpRequest().post('/api/v1/auth/logout').set('Origin',origin).expect(200);
});

test('smart token logout works after menu permission revocation, but ordinary token access stays denied',async()=>{
  const a=await account('smart-exit');const token='sc_'+randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(token).digest('hex');
  await db.smartCaseSession.create({data:{hash,userId:a.user.id,sessionId:a.sessionId,credentialVersion:1,assuranceLevel:'PASSWORD',expiresAt:new Date(Date.now()+3600000)}});
  await app.httpRequest().get('/api/v1/smart-case/me').set('Authorization',`Bearer ${token}`).expect(403);
  await app.httpRequest().post('/api/v1/smart-case/logout').set('Authorization',`Bearer ${token}`).expect(200);
  assert.ok((await db.smartCaseSession.findUniqueOrThrow({where:{hash}})).revokedAt);
  assert.equal((await db.authSession.findUniqueOrThrow({where:{id:a.sessionId}})).revokedAt,null);
  await app.httpRequest().post('/api/v1/smart-case/logout').set('Authorization','Bearer bad').expect(401);
});
