import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import {KnowledgePublication,registerKnowledge} from '../src/knowledge-publication.js'
import {registerNativeKnowledge} from '../src/native-knowledge.js'
test('published document pages contain ten rows and clamp obsolete page numbers',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'kb-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));const kb=new KnowledgePublication(root)
 kb.acl.update(d=>{d.lib={name:'法律法规库',readers:['reader'],reviewers:[]}})
 kb.store.update(d=>{for(let i=0;i<42;i++)d['d'+i]={id:'d'+i,kbId:'lib',status:'PUBLISHED',nativeId:'n'+i,source:{name:'file'+i},publishedAt:String(i).padStart(3,'0')};d.hidden={id:'hidden',kbId:'lib',status:'PENDING',source:{name:'unpublished'}}})
 assert.equal(kb.documents('lib','reader',[]).items.length,10)
 assert.equal(kb.documents('lib','reader',[],'',5).items.length,2)
 assert.equal(kb.documents('lib','reader',[],'',999).page,5)
 assert.equal(kb.documents('lib','reader',[],'missing',3).page,1)
 assert.equal(kb.documents('lib','reader',[],'',0).total,42)
 assert.throws(()=>kb.documents('lib','other',[]),{statusCode:403})
})
test('personal reviewer can read authorized knowledge but cannot access maintenance endpoints',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'kb-role-')),old=process.env.DATA_DIR;process.env.DATA_DIR=root
 const app=Fastify();let admin=false
 app.addHook('preHandler',async r=>{r.oa={id:'reader',permissions:['knowledge.review'],isSystemSuperAdmin:admin}})
 await registerKnowledge(app);await registerNativeKnowledge(app)
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old})
 app.oaKnowledge.acl.update(d=>{d.lib={name:'法律法规库',readers:[],reviewers:['reader']}})
 let r=await app.inject('/api/kb');assert.equal(r.statusCode,200);assert.equal(r.json().items[0].canReview,false)
 assert.equal((await app.inject('/api/kb/lib/documents')).statusCode,200)
 for(const [method,url]of [['GET','/api/submissions'],['GET','/api/submissions/x/content'],['POST','/api/submissions'],['POST','/api/submissions/x/review'],['POST','/api/submissions/x/publish'],['POST','/api/submissions/x/withdraw'],['GET','/api/kb/lib/legacy'],['POST','/api/kb/lib/legacy/n/register'],['POST','/api/kb/lib/legacy/n/reparse'],['GET','/knowledge-native/']])assert.equal((await app.inject({method,url,...(method==='POST'?{payload:{}}:{})})).statusCode,403,url)
 admin=true;r=await app.inject('/api/kb');assert.equal(r.json().items[0].canReview,true);assert.equal((await app.inject('/api/submissions')).statusCode,200)
})
