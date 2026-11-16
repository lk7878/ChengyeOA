import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {KnowledgePublication} from '../src/knowledge-publication.js'
test('pending, rejected and indexing knowledge never reaches retrieval; ACL and withdrawal rechecked',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-kb-test-'));const seen=[]
 const service=new KnowledgePublication(dir,{nativeApi:async(route,options)=>{seen.push(options?.body);return {data:[{knowledge_id:'ready',content:'published'},{knowledge_id:'pending',content:'private'},{knowledge_id:'rejected',content:'private'}]}}})
 try{service.acl.update(data=>{data.kb={name:'脱敏测试库',readers:['reader'],reviewers:['reviewer']}})
 service.store.update(data=>{for(const [id,status]of [['ready','PUBLISHED'],['pending','INDEXING'],['rejected','REJECTED']])data[id]={id,kbId:'kb',owner:'author',nativeId:id,status}})
 const result=await service.search('kb','reader',[],'test');assert.deepEqual(result.data.map(v=>v.content),['published']);assert.deepEqual(seen[0].knowledge_ids,['ready']);
 await assert.rejects(service.search('kb','other',[],'test'));assert.throws(()=>service.withdraw('ready',{id:'reviewer',permissions:[]}));
 service.withdraw('ready',{id:'reviewer',permissions:['knowledge.review']});assert.deepEqual((await service.search('kb','reader',[],'test')).data,[])
 assert.equal(service.list({id:'reader',permissions:[]}).length,0);assert.equal(service.list({id:'reviewer',permissions:['knowledge.review']}).length,3)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('review requires all checks and failed native import never claims published',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-kb-test-'));const service=new KnowledgePublication(dir,{nativeApi:async()=>{throw Error('native unavailable')}})
 try{service.acl.update(data=>{data.kb={reviewers:['reviewer'],readers:[]}});service.store.update(data=>{data.s={id:'s',kbId:'kb',owner:'author',status:'PENDING',source:{name:'sample.txt'}}});
 const actor={id:'reviewer',permissions:['knowledge.review']};assert.throws(()=>service.review('s',actor,{decision:'approve',checks:{source:true}}));
 service.review('s',actor,{decision:'approve',checks:{source:true,quality:true,duplicates:true,privacy:true}});await assert.rejects(service.publish('s',actor));assert.equal(service.store.read().s.status,'APPROVED');
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('reindexing supersedes an older successful completion and ACL revocation blocks in-flight search',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-kb-race-'));let finish;
 const service=new KnowledgePublication(dir,{nativeApi:()=>new Promise(resolve=>{finish=resolve})});
 try{service.acl.update(data=>{data.kb={readers:['reader'],reviewers:['reviewer']}});service.store.update(data=>{data.s={id:'s',kbId:'kb',nativeId:'native',status:'INDEXING',revision:0}});
 const pending=service.publish('s',{id:'reviewer',permissions:['knowledge.review']});service.store.update(data=>{data.s.revision=1});finish({data:{parse_status:'completed'}});assert.equal((await pending).status,'INDEXING');
 service.store.update(data=>{data.s.status='PUBLISHED'});const search=service.search('kb','reader',[],'test');service.acl.update(data=>{data.kb.readers=[]});finish({data:[{knowledge_id:'native',content:'restricted'}]});await assert.rejects(search)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('native duplicate imports reuse only byte-identical content in the same library',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-kb-duplicate-'));const content='synthetic duplicate';const{createHash}=await import('node:crypto');const hash=createHash('sha256').update(content).digest('hex');
 const service=new KnowledgePublication(dir,{nativeApi:async(route,options)=>{if(route.endsWith('/download'))return new Response(content);if(route.endsWith('/knowledge/file'))return {code:'duplicate_file',data:{id:'existing',knowledge_base_id:'kb'}};if(route==='/knowledge/existing')return {data:{parse_status:'completed'}};return {data:[]}}});
 try{await mkdir(path.join(dir,'submission-files'));await writeFile(path.join(dir,'submission-files','s'),content);service.acl.update(data=>{data.kb={reviewers:['reviewer']}});service.store.update(data=>{data.s={id:'s',kbId:'kb',status:'APPROVED',source:{name:'sample.txt',sha256:hash}}});assert.equal((await service.publish('s',{id:'reviewer',permissions:['knowledge.review']})).nativeId,'existing');assert.equal(service.store.read().s.status,'PUBLISHED')
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('overview and browsing only reveal authorized published knowledge; withdrawal during read blocks content',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-kb-browse-'));let finish;
 const s=new KnowledgePublication(dir,{nativeApi:()=>new Promise(resolve=>{finish=resolve})});
 try{s.acl.update(d=>{d.kb={name:'法律法规库',readers:['reader'],reviewers:['admin']};d.private={name:'私有',readers:[]}});
 s.store.update(d=>{d.yes={id:'yes',kbId:'kb',nativeId:'n',status:'PUBLISHED',source:{name:'测试法律.pdf',size:42,version:1}};d.no={id:'no',kbId:'kb',status:'PENDING',source:{name:'秘密'}}});
 assert.equal(s.overview('reader',[])[0].count,1);assert.equal(s.overview('stranger',[]).length,0);assert.throws(()=>s.documents('private','reader',[]));
 assert.deepEqual(s.documents('kb','reader',[],'法律').items.map(d=>d.id),['yes']);assert.equal(s.documents('kb','reader',[],'秘密').total,0);
 await assert.rejects(s.submit({id:'reader',permissions:[]},'token',{kbId:'kb'}),{statusCode:403});
 const reading=s.document('kb','yes','reader',[]);s.withdraw('yes',{id:'admin',permissions:['knowledge.review']});finish({data:[{knowledge_id:'n',content:'hidden'}]});await assert.rejects(reading,{statusCode:404});
 s.store.update(d=>{d.yes.status='PUBLISHED'});const live=s.document('kb','yes','reader',[]);finish({data:[{knowledge_id:'n',content:'visible'},{knowledge_id:'other',content:'leak'},{knowledge_id:'n',content:'disabled',is_enabled:false}]});assert.deepEqual((await live).items,[{content:'visible'}]);
 }finally{await rm(dir,{recursive:true,force:true})}
})
