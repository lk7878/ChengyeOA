import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import Fastify from 'fastify'
import {Store} from '../src/atomic-store.js'
import {registerOa} from '../src/oa-integration.js'
import {registerKnowledge} from '../src/knowledge-publication.js'
import {registerKnowledgeAccess} from '../src/knowledge-access.js'

test('OA entry is rechecked on every request and knowledge still requires per-user ACL and dual review permission', async t=>{
 const previous={DATA_DIR:process.env.DATA_DIR,WORKBENCH_PUBLIC_BASE:process.env.WORKBENCH_PUBLIC_BASE},oldFetch=globalThis.fetch;
 const dir=await mkdtemp(path.join(tmpdir(),'oa-capability-'));process.env.DATA_DIR=dir;process.env.WORKBENCH_PUBLIC_BASE='http://smart.example';
 const hash=s=>createHash('sha256').update(s).digest('hex');
 new Store(path.join(dir,'oa-sessions.json')).update(d=>{d[hash('test-sid')]={token:'oa-test-token',expiresAt:Date.now()+3600000}});
 let permissions=['menu.smart_case'],status=200,superAdmin=false,checks=0;
 globalThis.fetch=async url=>{assert.ok(String(url).endsWith('/smart-case/me'));checks++;return status===200?Response.json({code:200,data:{id:'oa-user',username:'reception-user',displayName:'前台测试',permissions,isSystemSuperAdmin:superAdmin}}):Response.json({message:'PERMISSION_DENIED'},{status})};
 const app=Fastify();await registerOa(app);const kb=await registerKnowledge(app);await registerKnowledgeAccess(app);
 t.after(async()=>{await app.close();globalThis.fetch=oldFetch;await rm(dir,{recursive:true,force:true});for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}});
 kb.acl.update(d=>{d.kb={name:'法律法规库',readers:[],reviewers:[]}});
 const request=(url='/api/kb',body)=>app.inject({method:body?'POST':'GET',url,headers:{cookie:'oa_sid=test-sid',origin:'http://smart.example'},...(body?{payload:body}:{})});
 assert.deepEqual((await request()).json().items,[]);
 assert.equal((await request('/api/kb/kb/documents')).statusCode,403);
 assert.equal((await request('/api/kb-access')).statusCode,403);
 kb.acl.update(d=>{d.kb.readers=['oa-user']});
 assert.equal((await request()).json().items[0].canReview,false);
 kb.store.update(d=>{d.pending={id:'pending',kbId:'kb',owner:'other-user',status:'PENDING'}});
 const review=()=>request('/api/submissions/pending/review',{decision:'approve',checks:{source:true,quality:true,duplicates:true,privacy:true}});
 assert.equal((await review()).statusCode,403);
 permissions=['menu.smart_case','knowledge.review'];
 assert.equal((await review()).statusCode,403);
 kb.acl.update(d=>{d.kb.reviewers=['oa-user'];d.kb.readers=[]});
 permissions=['menu.smart_case'];assert.deepEqual((await request()).json().items,[]);assert.equal((await review()).statusCode,403);
 permissions=['menu.smart_case','knowledge.review'];assert.equal((await request()).json().items[0].canReview,true);assert.equal((await review()).statusCode,200);
 // Even an existing smart cookie and knowledge-review permission cannot replace entry eligibility.
 permissions=['knowledge.review'];const revoked=await request();assert.equal(revoked.statusCode,403);assert.match(revoked.json().error,/智慧办案使用者/);
 assert.equal((await request('/api/oa/files')).statusCode,403);
 status=403;assert.equal((await request()).statusCode,403);
 status=401;assert.equal((await request()).statusCode,401);
 status=200;superAdmin=true;permissions=['menu.smart_case','knowledge.review'];kb.acl.update(d=>{d.kb.reviewers=[]});
 assert.deepEqual((await request()).json().items,[],'super admin does not bypass library ACL');
 assert.ok(checks>=15);
});
