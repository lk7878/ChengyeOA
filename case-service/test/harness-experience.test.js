import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {canManageHarness,personalWorkspaceTitle,isHarnessAdminRequest} from '../src/harness-experience.js'
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
 const chat=await proxy.inject({url:url+'/api/session/create',method:'POST',payload:{method:'session/create'}})
 assert.equal(chat.statusCode,200)
})
