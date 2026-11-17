import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import Fastify from 'fastify'
import {Store} from '../src/atomic-store.js'
import {registerOa} from '../src/oa-integration.js'

test('logout revokes only the presented session despite expiry/revocation and preserves failures for retry',async t=>{
 const oldDir=process.env.DATA_DIR,oldBase=process.env.WORKBENCH_PUBLIC_BASE,oldFetch=globalThis.fetch;
 const dir=await mkdtemp(path.join(tmpdir(),'smart-logout-'));process.env.DATA_DIR=dir;process.env.WORKBENCH_PUBLIC_BASE='http://smart.example';
 const store=new Store(path.join(dir,'oa-sessions.json')),hash=s=>createHash('sha256').update(s).digest('hex');
 store.update(d=>{d[hash('expired-sid')]={token:'expired-oa-token',expiresAt:0};d[hash('other-sid')]={token:'other-oa-token',expiresAt:Date.now()+10000}});
 const calls=[];let fail=true;
 globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),token:options.headers.Authorization});
  assert.ok(String(url).endsWith('/smart-case/logout'),'logout must not depend on menu permission /me');
  return fail?Response.json({message:'暂不可用'},{status:503}):Response.json({code:200,data:{ok:true}});
 };
 const app=Fastify();await registerOa(app);app.post('/api/auth/logout',async(req,reply)=>app.oaLogout(req,reply));
 t.after(async()=>{globalThis.fetch=oldFetch;await app.close();await rm(dir,{recursive:true,force:true});for(const [key,value] of [['DATA_DIR',oldDir],['WORKBENCH_PUBLIC_BASE',oldBase]]){if(value===undefined)delete process.env[key];else process.env[key]=value}});
 const logout=(url='/api/auth/logout',origin='http://smart.example',sid='expired-sid')=>app.inject({method:'POST',url,headers:{origin,cookie:'oa_sid='+sid}});
 const denied=await logout('/api/auth/logout','https://evil.example');assert.equal(denied.statusCode,403);assert.equal(calls.length,0);
 const failed=await logout();assert.equal(failed.statusCode,503);assert.equal(failed.headers['set-cookie'],undefined);assert.ok(store.read()[hash('expired-sid')]);
 fail=false;const ok=await logout();assert.equal(ok.statusCode,200);assert.equal(store.read()[hash('expired-sid')],undefined);assert.ok(store.read()[hash('other-sid')]);
 assert.ok(ok.headers['set-cookie'].some(c=>c.startsWith('oa_sid=;')&&c.includes('Max-Age=0')));
 assert.ok(calls.every(c=>c.token==='Bearer expired-oa-token'));
 assert.equal((await logout('/api/oa/logout')).statusCode,200);assert.equal(calls.length,2);
 assert.equal((await app.inject({method:'GET',url:'/api/oa/files',headers:{cookie:'oa_sid=expired-sid'}})).statusCode,401);
});
