import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import {AiPolicy,registerAiPolicy} from '../src/ai-policy.js'
import {registerKnowledgeAccess} from '../src/knowledge-access.js'
import {Store} from '../src/atomic-store.js'

async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'oa-ai-policy-'))
 const prior={DATA_DIR:process.env.DATA_DIR,CHAT_MODEL:process.env.CHAT_MODEL}
 process.env.DATA_DIR=root;process.env.CHAT_MODEL='approved'
 t.after(async()=>{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v}await rm(root,{recursive:true,force:true})})
 return root
}

test('only OA superadmin may check/publish/rollback; tasks retain their immutable snapshot',async t=>{
 const root=await fixture(t),app=Fastify()
 t.after(()=>app.close())
 app.addHook('preHandler',async req=>{req.user={id:'synthetic',isSystemSuperAdmin:req.headers['x-admin']==='yes',roles:['public_admin'],permissions:['knowledge.review']}})
 await registerAiPolicy(app,()=>['approved','fallback'])
 const policy=new AiPolicy(root,()=>['approved','fallback']),before=policy.snapshot('general'),config=policy.view()
 config.policies.general.fallbackModel='fallback';config.policies.general.network=false
 for(const suffix of ['check','publish','rollback'])assert.equal((await app.inject({url:'/api/ai-capabilities/'+suffix,method:'POST',payload:{version:0,policies:config.policies,targetVersion:0}})).statusCode,403)
 assert.equal((await app.inject({url:'/api/ai-capabilities'})).statusCode,403)
 const publish=body=>app.inject({url:'/api/ai-capabilities/publish',method:'POST',headers:{'x-admin':'yes'},payload:body})
 assert.equal((await publish({version:0,policies:config.policies})).statusCode,200)
 assert.equal(policy.view().version,1);assert.equal(policy.snapshot('general').network,false);assert.equal(before.network,true);assert.equal(before.version,0)
 assert.equal((await publish({version:0,policies:config.policies})).statusCode,409)
 config.policies.general.model='unapproved';assert.equal((await publish({version:1,policies:config.policies})).statusCode,400)
 assert.equal(policy.view().version,1)
 const rollback=await app.inject({url:'/api/ai-capabilities/rollback',method:'POST',headers:{'x-admin':'yes'},payload:{version:1,targetVersion:0}})
 assert.equal(rollback.statusCode,200);assert.equal(policy.view().version,2);assert.equal(policy.snapshot('general').network,true)
 assert.equal(policy.store.read().publishedBy,'synthetic')
})

test('library reviewer provisioning is required before ACL save and cannot overwrite concurrent edits',async t=>{
 const root=await fixture(t),app=Fastify(),previous=globalThis.fetch,acl=new Store(path.join(root,'acl.json'))
 let rejectEnsure=false,conflict=false,ensured=[]
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/directory'))return Response.json({code:200,data:[{id:'reviewer'},{id:'reader'}]})
  assert.ok(String(url).endsWith('/knowledge-reviewers/ensure'));ensured=JSON.parse(options.body).userIds
  if(conflict)acl.update(d=>{d.kb.version++})
  return rejectEnsure?Response.json({message:'denied'},{status:403}):Response.json({code:200,data:{ok:true}})
 }
 t.after(async()=>{await app.close();globalThis.fetch=previous})
 acl.update(d=>{d.kb={readers:[],reviewers:[],version:0}})
 app.decorate('oaKnowledge',{acl});app.addHook('preHandler',async req=>{req.oa={id:'root',token:'synthetic',isSystemSuperAdmin:req.headers['x-admin']==='yes'}})
 await registerKnowledgeAccess(app)
 const save=()=>app.inject({url:'/api/kb-access/kb',method:'POST',headers:{'x-admin':'yes'},payload:{version:0,readers:['reader'],reviewers:['reviewer']}})
 rejectEnsure=true;assert.notEqual((await save()).statusCode,200);assert.deepEqual(acl.read().kb.reviewers,[])
 rejectEnsure=false;conflict=true;assert.equal((await save()).statusCode,409);assert.deepEqual(acl.read().kb.reviewers,[])
 conflict=false;acl.update(d=>{d.kb.version=0});assert.equal((await save()).statusCode,200)
 assert.deepEqual(ensured,['reviewer']);assert.deepEqual(acl.read().kb,{version:1,readers:['reader'],reviewers:['reviewer']})
})
