import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {KnowledgePublication} from '../src/knowledge-publication.js'
import {reconcilePublications,legacyDocuments,registerLegacy,reparseLegacy} from '../src/knowledge-lifecycle.js'

const actor={id:'reviewer',permissions:['knowledge.review']}
const checks={source:true,quality:true,duplicates:true,privacy:true}
const native={id:'native',knowledge_base_id:'kb',file_name:'历史材料.md',file_size:12,file_hash:'native-hash',updated_at:'2026-11-17',parse_status:'completed'}
async function fixture(t,api){
 const dir=await mkdtemp(path.join(tmpdir(),'knowledge-lifecycle-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const kb=new KnowledgePublication(dir,{nativeApi:api||(async()=>({data:native}))})
 kb.acl.update(d=>{d.kb={readers:['reader'],reviewers:['reviewer']};d.other={readers:[],reviewers:['someone']}})
 return kb
}
const approved=(id='s')=>({id,kbId:'kb',nativeId:'native',status:'INDEXING',reviewer:'reviewer',reviewedAt:'2026-11-17',checks,source:{name:'test'},createdAt:'2026-11-17'})

test('automatic completion publishes approved indexed documents, not unreviewed or superseded content',async t=>{
 const kb=await fixture(t)
 kb.store.update(d=>{
  d.s=approved();d.pending={...approved('pending'),status:'PENDING'}
  d.rejected={...approved('rejected'),status:'REJECTED'}
  d.noChecks={...approved('noChecks'),checks:{}}
  d.reindexed={...approved('reindexed'),revision:1}
  d.withdrawn={...approved('withdrawn'),status:'WITHDRAWN'}
 })
 await reconcilePublications(kb)
 assert.equal(kb.store.read().s.status,'PUBLISHED')
 assert.equal(kb.overview('reader')[0].count,1)
 assert.equal(kb.store.read().pending.status,'PENDING')
 assert.equal(kb.store.read().rejected.status,'REJECTED')
 assert.equal(kb.store.read().noChecks.status,'INDEXING')
 assert.equal(kb.store.read().reindexed.status,'INDEXING')
 assert.equal(kb.store.read().withdrawn.status,'WITHDRAWN')
 assert.equal(kb.overview('stranger').length,0)
})

test('completion rechecks withdrawal, revision and reviewer assignment after network response',async t=>{
 let finish;const kb=await fixture(t,()=>new Promise(r=>{finish=r}))
 for(const mutation of [d=>{d.s.status='WITHDRAWN'},d=>{d.s.revision=1},()=>{kb.acl.update(d=>{d.kb.reviewers=[]})}]){
  kb.acl.update(d=>{d.kb.reviewers=['reviewer']});kb.store.update(d=>{d.s=approved()})
  const work=reconcilePublications(kb);kb.store.update(mutation);finish({data:native});await work
  assert.notEqual(kb.store.read().s.status,'PUBLISHED')
 }
})

test('transient native failure retries later; parse failures and wrong-library completions stay private',async t=>{
 let response='outage';const kb=await fixture(t,async()=>{if(response==='outage')throw Error('unavailable');return {data:response}})
 kb.store.update(d=>{d.s=approved()});await reconcilePublications(kb);assert.equal(kb.store.read().s.status,'INDEXING')
 response={...native,knowledge_base_id:'other'};await reconcilePublications(kb);assert.equal(kb.store.read().s.status,'INDEXING')
 response={...native,parse_status:'failed'};await reconcilePublications(kb);assert.equal(kb.store.read().s.status,'IMPORT_FAILED')
 kb.store.update(d=>{d.s.status='INDEXING'});response=native;await reconcilePublications(kb)
 assert.equal(kb.store.read().s.status,'PUBLISHED');assert.equal(kb.store.read().s.error,null)
})

test('legacy original snapshot requires library reviewer and all checks before publication; repeated registration is idempotent',async t=>{
 const kb=await fixture(t,async(route)=>route.endsWith('/download')?new Response('original bytes'):{data:native})
 await assert.rejects(registerLegacy(kb,'kb','native',{id:'reader',permissions:[]}),{statusCode:403})
 await assert.rejects(registerLegacy(kb,'other','native',actor),{statusCode:403})
 await assert.rejects(registerLegacy(kb,'kb','native',actor,'outdated-list-revision'),{statusCode:409})
 const s=await registerLegacy(kb,'kb','native',actor)
 assert.equal(s.status,'PENDING');assert.equal(await readFile(path.join(kb.root,'submission-files',s.id),'utf8'),'original bytes')
 assert.equal((await registerLegacy(kb,'kb','native',actor)).id,s.id)
 await reconcilePublications(kb);assert.equal(kb.overview('reader')[0].count,0)
 assert.throws(()=>kb.review(s.id,actor,{decision:'approve',checks:{source:true}}))
 kb.review(s.id,actor,{decision:'approve',checks});await reconcilePublications(kb)
 assert.equal(kb.overview('reader')[0].count,1)
 assert.equal(Object.keys(kb.store.read()).length,1)
})

test('historical list and retry are reviewer-only, redact storage paths, and recheck access in flight',async t=>{
 let finish;const kb=await fixture(t,()=>new Promise(r=>{finish=r}))
 await assert.rejects(legacyDocuments(kb,'kb',{id:'reader',permissions:[]}),{statusCode:403})
 const work=legacyDocuments(kb,'kb',actor);finish({total:1,data:[{...native,file_path:'/secret',metadata:{secret:true}}]})
 const list=await work;assert.equal(list.items[0].status,'UNREVIEWED');assert.equal(list.items[0].file_path,undefined);assert.equal(list.items[0].metadata,undefined)
 const blocked=legacyDocuments(kb,'kb',actor);kb.acl.update(d=>{d.kb.reviewers=[]});finish({data:[native]});await assert.rejects(blocked,{statusCode:403})
 await assert.rejects(reparseLegacy(kb,'kb','native',{id:'reader',permissions:[]}),{statusCode:403})
})

test('legacy changed after snapshot cannot publish, renewed review keeps old snapshot and audit',async t=>{
 let current=native
 const kb=await fixture(t,async route=>route.endsWith('/download')?new Response(current.file_hash):{data:current})
 const s=await registerLegacy(kb,'kb','native',actor)
 kb.review(s.id,actor,{decision:'approve',checks});current={...native,file_hash:'changed',updated_at:'later'}
 await reconcilePublications(kb);assert.equal(kb.store.read()[s.id].status,'APPROVED')
 await assert.rejects(kb.publish(s.id,actor),{statusCode:409})
 kb.withdraw(s.id,actor)
 const replacement=await registerLegacy(kb,'kb','native',actor)
 assert.notEqual(replacement.id,s.id);assert.equal(replacement.status,'PENDING')
 assert.equal(kb.store.read()[s.id].supersededBy,replacement.id)
 assert.equal(await readFile(path.join(kb.root,'submission-files',s.id),'utf8'),'native-hash')
 kb.review(replacement.id,actor,{decision:'approve',checks});await reconcilePublications(kb)
 assert.equal(kb.overview('reader')[0].count,1)
})

test('failed history retries its original native record without approving or copying it',async t=>{
 const calls=[];const kb=await fixture(t,async(route,options)=>{calls.push({route,options});return {data:{...native,parse_status:'failed'}}})
 await reparseLegacy(kb,'kb','native',actor)
 assert.equal(calls[1].route,'/knowledge/native/reparse');assert.equal(calls[1].options.method,'POST')
 assert.deepEqual(kb.store.read(),{});assert.equal(kb.overview('reader')[0].count,0)
})

test('HTTP workflow requires reviewer access and observed revision; reader sees only approved completion',async t=>{
 const {default:Fastify}=await import('fastify')
 const {registerKnowledge}=await import('../src/knowledge-publication.js')
 const dir=await mkdtemp(path.join(tmpdir(),'knowledge-routes-')), previous=process.env.DATA_DIR
 process.env.DATA_DIR=dir
 const app=Fastify()
 app.decorateRequest('oa',null)
 app.addHook('onRequest',async req=>{req.oa=req.headers['x-test-reader']?{id:'reader',permissions:[]}:actor})
 await registerKnowledge(app)
 if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})})
 const kb=app.oaKnowledge
 kb.acl.update(d=>{d.kb={name:'测试库',readers:['reader'],reviewers:['reviewer']}})
 kb.nativeApi=async route=>route.endsWith('/download')?new Response('fixture'):route.includes('/knowledge?page=')?{total:1,data:[native]}:{data:native}
 const reader={'x-test-reader':'yes'}
 assert.equal((await app.inject({url:'/api/kb/kb/legacy',headers:reader})).statusCode,403)
 const list=(await app.inject({url:'/api/kb/kb/legacy'})).json()
 const url='/api/kb/kb/legacy/native/register'
 assert.equal((await app.inject({method:'POST',url,payload:{}})).statusCode,400)
 assert.equal((await app.inject({method:'POST',url,payload:{revision:list.items[0].revision},headers:reader})).statusCode,403)
 const registration=await app.inject({method:'POST',url,payload:{revision:list.items[0].revision}})
 assert.equal(registration.statusCode,200)
 const row=registration.json()
 assert.equal((await app.inject({url:'/api/kb',headers:reader})).json().items[0].count,0)
 assert.equal((await app.inject({url:`/api/submissions/${row.id}/content`,headers:reader})).statusCode,404)
 assert.equal((await app.inject({method:'POST',url:`/api/submissions/${row.id}/review`,payload:{decision:'approve',checks}})).statusCode,200)
 await reconcilePublications(kb)
 assert.equal((await app.inject({url:'/api/kb',headers:reader})).json().items[0].count,1)
 assert.equal((await app.inject({url:'/api/kb/kb/documents',headers:reader})).json().items[0].name,native.file_name)
 assert.equal((await app.inject({url:'/api/submissions',headers:reader})).json().items.length,0)
})
