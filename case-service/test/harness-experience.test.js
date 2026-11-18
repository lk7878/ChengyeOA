import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {canManageHarness,personalWorkspaceTitle,isHarnessAdminRequest,isHarnessStaticResource} from '../src/harness-experience.js'
import {registerHarnessProxy} from '../src/harness-proxy.js'

test('native administration uses the real OA superadmin flag; chat and display preferences remain available',()=>{
 assert.equal(canManageHarness({roles:['platform_admin','public_admin']}),false)
 assert.equal(canManageHarness({isSystemSuperAdmin:'true'}),false)
 assert.equal(canManageHarness({isSystemSuperAdmin:true}),true)
 assert.equal(personalWorkspaceTitle({displayName:'李明',username:'liming'}),'李明的工作区')
 assert.equal(personalWorkspaceTitle({username:'chengye000'}),'chengye000的工作区')
 for(const method of ['account/startSignIn','credentials/set','settings/openSettingsDocument'])assert.equal(isHarnessAdminRequest(method),true)
 assert.equal(isHarnessAdminRequest('settings/mutate',{ns:'llm-pi-ai'}),true)
 assert.equal(isHarnessAdminRequest('settings/mutate',{ns:'ui-theme'}),false)
 for(const method of ['settings/describe','session/create','session/prompt','workspace/rename'])assert.equal(isHarnessAdminRequest(method),false)
})

test('browser bundle exception is limited to static HTTP reads, never management or RPC',()=>{
 const paths=['/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=59ce49505625','/plugins/??p1/client.js,@scope/p2/client.js&rev=abcd','/plugins/@scope/p/client.chunk-abc.js?rev=abcd','/plugins/@scope/p/assets/icons/file.svg']
 for(const url of paths){
  for(const method of ['GET','HEAD'])assert.equal(isHarnessStaticResource(method,url),true,url)
  for(const method of ['POST','PUT','DELETE'])assert.equal(isHarnessStaticResource(method,url),false,url)
 }
 for(const url of ['/api/plugins/install','/plugins/install','/plugins/events','/plugins/??p/client.node.js&rev=abcd','/plugins/p/client.node.js?rev=abcd','/plugins/p/client.node.chunk.js?rev=abcd','/plugins/p/assets/%2e%2e/secret','/plugins/p/client.js?rev=abcd&method=install'])assert.equal(isHarnessStaticResource('GET',url),false,url)
 assert.equal(isHarnessAdminRequest('plugins/install'),true)
})

test('ordinary users load native startup bundles after task authorization; management remains forbidden',async t=>{
 const upstream=Fastify(),proxy=Fastify();let authorized=true,hits=0
 t.after(async()=>{await proxy.close();await upstream.close()})
 upstream.all('/plugins/*',async(_req,reply)=>{hits++;return reply.type('text/javascript').send('window.__ModuleLoader__.load({id:"bootstrap"})')})
 const base=await upstream.listen({host:'127.0.0.1',port:0})
 proxy.decorate('oaTasks',{runtime:async()=>{if(!authorized)throw Object.assign(Error('forbidden'),{statusCode:403});return {base,cookie:'test-only'}}})
 proxy.addHook('preHandler',async req=>{req.user={id:'ordinary',isSystemSuperAdmin:false};req.oa={token:'test-only'}})
 await registerHarnessProxy(proxy)
 const prefix='/harness/00000000-0000-0000-0000-000000000001',bundle='/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=59ce49505625'
 for(const method of ['GET','HEAD']){const r=await proxy.inject({url:prefix+bundle,method});assert.equal(r.statusCode,200);assert.match(r.headers['content-type'],/javascript/)}
 for(const [method,url]of [['POST',bundle],['GET','/plugins/install'],['GET','/api/plugins/install'],['GET','/plugins/p/client.node.js?rev=abcd']])assert.equal((await proxy.inject({url:prefix+url,method})).statusCode,403)
 assert.equal(hits,2)
 authorized=false;assert.equal((await proxy.inject(prefix+bundle)).statusCode,403);assert.equal(hits,2)
})

test('proxy injects server-owned role and denies administration writes including mismatched RPC method',async t=>{
 const upstream=Fastify(),proxy=Fastify()
 t.after(async()=>{await proxy.close();await upstream.close()})
 upstream.get('/',async(_req,reply)=>reply.type('text/html').send('<html><head></head><body>native</body></html>'))
 upstream.post('/api/*',async()=>({ok:true}))
 const base=await upstream.listen({host:'127.0.0.1',port:0})
 proxy.decorate('oaTasks',{runtime:async()=>({base,cookie:'test-only'})})
 proxy.addHook('preHandler',async req=>{req.user={id:'owner',isSystemSuperAdmin:req.headers['x-test-admin']==='yes'};req.oa={token:'test-only'}})
 await registerHarnessProxy(proxy)
 const url='/harness/00000000-0000-0000-0000-000000000001'
 for(const admin of [false,true]){
  const headers=admin?{'x-test-admin':'yes'}:{}
  const html=await proxy.inject({url:url+'/',headers})
  assert.match(html.body,new RegExp(`"isSuperAdmin":${admin}`))
  assert.equal(html.headers['cache-control'],'private, no-store')
  const write=await proxy.inject({url:url+'/api/settings/mutate',method:'POST',headers,payload:{method:'settings/mutate',payload:{args:{ns:'llm-pi-ai'}}}})
  assert.equal(write.statusCode,admin?200:403)
 }
 const disguised=await proxy.inject({url:url+'/api/session/create',method:'POST',payload:{method:'credentials/set'}})
 assert.equal(disguised.statusCode,403)
 const textDisguised=await proxy.inject({url:url+'/api/session/create',method:'POST',headers:{'content-type':'text/plain'},payload:JSON.stringify({method:'credentials/set'})});assert.equal(textDisguised.statusCode,403)
 const chat=await proxy.inject({url:url+'/api/session/create',method:'POST',payload:{method:'session/create'}})
 assert.equal(chat.statusCode,200)
})
