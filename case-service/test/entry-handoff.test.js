import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import Fastify from 'fastify'
import {registerOa} from '../src/oa-integration.js'

test('JSON preparation preserves HttpOnly PKCE, return whitelist, case binding and legacy redirect',async t=>{
 const previous={DATA_DIR:process.env.DATA_DIR,OA_PUBLIC_URL:process.env.OA_PUBLIC_URL};
 const dir=await mkdtemp(path.join(tmpdir(),'oa-entry-'));process.env.DATA_DIR=dir;process.env.OA_PUBLIC_URL='http://oa.example';
 const app=Fastify();await registerOa(app);
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}});
 const result=await app.inject('/api/auth/start?response=json&return=http%3A%2F%2Foa.example&caseId=case-1');
 assert.equal(result.statusCode,200);assert.equal(result.headers.location,undefined);assert.match(result.headers['cache-control'],/no-store/);
 const cookies=result.headers['set-cookie'],verifier=cookies.find(c=>c.startsWith('oa_login=')).split(';')[0].slice(9);
 assert.match(cookies[0],/HttpOnly; SameSite=Lax; Max-Age=120/);assert.ok(cookies.some(c=>c.startsWith('oa_case=case-1;')));
 assert.deepEqual(result.json(),{challenge:createHash('sha256').update(verifier).digest('hex')});
 assert.equal(result.body.includes(verifier),false);
 const legacy=await app.inject('/api/auth/start?return=http%3A%2F%2Foa.example');assert.equal(legacy.statusCode,302);assert.match(legacy.headers.location,/^http:\/\/oa.example\/smart-case\?challenge=[a-f0-9]{64}$/);
 const forbidden=await app.inject('/api/auth/start?response=json&return=https%3A%2F%2Fevil.example');assert.equal(forbidden.statusCode,400);assert.equal(forbidden.headers['set-cookie'],undefined);
 const callback=await app.inject('/api/auth/oa/callback?code=untrusted');assert.equal(callback.statusCode,400);
});
