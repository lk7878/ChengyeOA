import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createConnector, validateConfig } from '../connector.mjs';
import { accountPaths, childEnvironment, redactDiagnostic, HarnessRuntime } from '../runtime.mjs';

const origin='http://localhost:3000';
async function fixture(t, overrides={}) {
  const root=mkdtempSync(join(tmpdir(),'oa-connector-test-'));
  for(const file of ['apps/cli/lib/bin.js','apps/web/dist/index.html','packages/product/product-knowledge/lib/index.js','packages/product/product-knowledge/lib/client.js']){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'');}
  writeFileSync(join(root,'apps/cli/package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'fixture'}));
  const launched=[],stopped=[];
  const runtime={launch:async user=>{launched.push(user);return {protocol:1,url:'http://127.0.0.1:45000/?token='+'a'.repeat(43),version:'fixture',dataDirectory:'local'};},stop:user=>stopped.push(user),close:()=>{}};
  const server=createConnector(validateConfig({harnessRoot:root,oaApiOrigin:'http://localhost:7001',allowedOrigins:[origin]}),{runtime,verify:async body=>({userId:'authenticated-user',challenge:body.challenge,feature:body.feature}),...overrides});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.shutdown();await new Promise(resolve=>server.listening?server.once('close',resolve):resolve());rmSync(root,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port;
  const health=async()=> (await fetch(url+'/health',{headers:{Origin:origin}})).json();
  const post=async(body,path='/launch',requestOrigin=origin)=>fetch(url+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {url,health,post,launched,stopped};
}

test('connector rejects untrusted origins and Host headers before issuing a challenge',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.url+'/health')).status,403);
  assert.equal((await fetch(f.url+'/health',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const status=await new Promise((resolve,reject)=>{const req=request(f.url+'/health',{headers:{Origin:origin,Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
  const res=await fetch(f.url+'/health',{headers:{Origin:origin}});assert.equal(res.headers.get('access-control-allow-origin'),origin);assert.equal(res.headers.get('cache-control'),'no-store');
});

test('one-use challenge launches only verified identity and stop preserves identity boundary',async t=>{
  const f=await fixture(t);const {challenge}=await f.health();const body={ticket:'opaque-ticket',challenge,feature:'knowledge'};
  const res=await f.post(body);assert.equal(res.status,200);const launched=await res.json();assert.equal(new URL(launched.url).hostname,'localhost');assert.equal(new URL(launched.url).hash,'#oa-view=knowledge');assert.deepEqual(f.launched,['authenticated-user']);
  assert.equal((await f.post(body)).status,400);
  const next=await f.health();assert.equal((await f.post({...body,challenge:next.challenge},'/stop')).status,200);assert.deepEqual(f.stopped,['authenticated-user']);
});

test('body cannot provide user id, server URL, or bypass rejected verification',async t=>{
  const f=await fixture(t,{verify:async()=>{throw new Error('OA_AUTH_REJECTED');}});const {challenge}=await f.health();
  const body={ticket:'opaque',challenge,feature:'knowledge'};
  assert.equal((await (await f.post({...body,userId:'other-user'})).json()).error,'INVALID_REQUEST');
  assert.equal((await (await f.post({...body,oaApiOrigin:'https://untrusted.example'})).json()).error,'INVALID_REQUEST');
  assert.equal((await (await f.post(body)).json()).error,'OA_AUTH_REJECTED');assert.deepEqual(f.launched,[]);
  assert.equal((await (await f.post(body)).json()).error,'CHALLENGE_INVALID');
});

test('personal paths isolate OA installations and users; child process receives no inherited credentials',()=>{
  const root=join(tmpdir(),'oa-path-test');const a=accountPaths(root,'http://localhost:7001','../user-a');const b=accountPaths(root,'http://localhost:7001','user-b');
  assert.notEqual(a.home,b.home);assert.notEqual(a.home,accountPaths(root,'https://oa.example','../user-a').home);assert.equal(a.key.length,64);assert.equal(a.home,accountPaths(root,'http://localhost:7001','../user-a').home);
  const old=process.env.OA_TEST_API_KEY;process.env.OA_TEST_API_KEY='test-credential';try{const env=childEnvironment(a.home);assert.equal(env.OA_TEST_API_KEY,undefined);assert.equal(env.DSH_HOME,a.home);assert.equal(env.DSH_TELEMETRY_DISABLED,'1');}finally{if(old===undefined)delete process.env.OA_TEST_API_KEY;else process.env.OA_TEST_API_KEY=old;}
  assert.equal(redactDiagnostic('http://localhost:1/?token=private-value Bearer another-value'),'http://localhost:1/?token=[redacted] Bearer [redacted]');
  assert.throws(()=>new HarnessRuntime({harnessRoot:root,dataRoot:join(root,'private')}),/DATA_ROOT_INSIDE_SOURCE/);
  assert.throws(()=>new HarnessRuntime({harnessRoot:root,dataRoot:join(root,'..private')}),/DATA_ROOT_INSIDE_SOURCE/);
});

test('configuration rejects remote plaintext endpoints and unsupported bounds',()=>{
  const valid={harnessRoot:tmpdir(),oaApiOrigin:'http://localhost:7001',allowedOrigins:[origin]};
  assert.throws(()=>validateConfig({...valid,oaApiOrigin:'http://oa.example'}));assert.throws(()=>validateConfig({...valid,allowedOrigins:['https://oa.example/path']}));assert.throws(()=>validateConfig({...valid,maxInstances:0}));assert.throws(()=>validateConfig({...valid,port:80}));
});
