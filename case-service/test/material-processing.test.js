import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {MaterialProcessing,extractMaterial} from '../src/material-processing.js'
import {TaskUploads} from '../src/task-uploads.js'
async function fixture(t,options={}){
 const root=await mkdtemp(path.join(tmpdir(),'oa-material-test-')),id=randomUUID(),ref={fileId:'synthetic',version:1,sha256:'hash',name:'合成.pdf',localName:'synthetic.pdf'},task={id,owner:'owner',oaUserId:'actor',kind:'general',inputs:[ref]};let revoked=false,stopped=false
 const tasks={root,aiPolicy:{},busy:new Set(),runtimes:new Map(),get:(key,owner)=>{if(key!==id||owner!=='owner')throw Object.assign(Error('not found'),{statusCode:404});return task},validate:async()=>{if(revoked)throw Object.assign(Error('revoked'),{statusCode:403})},directory:()=>root+'/execution',update:(_id,patch)=>Object.assign(task,patch),materialContext:async()=>{},manifest:async()=>{},stop:()=>{stopped=true;tasks.runtimes.clear()}}
 await mkdir(root+'/execution/workspace/materials',{recursive:true});await writeFile(root+'/execution/workspace/materials/synthetic.pdf','original')
 const service=new MaterialProcessing(tasks,options);t.after(async()=>{service.close();await service.queue;await rm(root,{recursive:true,force:true})})
 return {root,id,ref,task,tasks,service,revoke:()=>{revoked=true},stopped:()=>stopped}
}
test('page progress, exact provenance, failed-page retry, cache and persisted state',async t=>{
 let calls=0,fail=true
 const f=await fixture(t,{extract:async function*(){yield {total:3};yield {page:1,kind:'text',text:'第一段\n第二段'};yield {page:2,kind:'recognition',image:'scan'};yield {page:3,kind:'recognition',image:'photo'}},recognize:async(_p,_t,image)=>{calls++;if(image==='scan'&&fail)throw Error('temporary');return {text:image==='scan'?'核对段落':'',description:image==='photo'?'可见两件物品':'',uncertain:image==='photo',model:'vision'}}})
 f.service.ensure(f.task,'token');await f.service.queue
 assert.equal(f.service.list(f.task).items[0].status,'FAILED');assert.equal(f.service.list(f.task).items[0].done,2)
 assert.deepEqual((await f.service.read(f.id,{id:'owner'},'token',{fileId:f.ref.fileId,version:1,page:1,paragraph:2})).page.paragraphs,[{paragraph:2,text:'第二段'}])
 fail=false;await f.service.retry(f.id,{id:'owner'},'token',{fileId:f.ref.fileId,version:1});await f.service.queue;assert.equal(calls,3)
 f.service.ensure(f.task,'token');await f.service.queue;assert.equal(calls,3)
 const restarted=new MaterialProcessing(f.tasks);assert.equal(restarted.list(f.task).items[0].status,'READY')
 assert.equal((await f.service.read(f.id,{id:'owner'},'token',{fileId:'synthetic',version:1,page:3})).page.description,'可见两件物品')
 await assert.rejects(f.service.read(f.id,{id:'other'},'token'),{statusCode:404})
 f.revoke();await assert.rejects(f.service.read(f.id,{id:'owner'},'token'),{statusCode:403})
})
test('remove ends active reader, drops context, leaves OA original untouched and cannot read removed version',async t=>{
 const f=await fixture(t,{extract:async function*(){yield {total:1};yield {page:1,kind:'text',text:'test'}}});f.service.ensure(f.task,'token');await f.service.queue
 f.tasks.runtimes.set(f.id,{});const r=await f.service.remove(f.id,{id:'owner'},'token',{fileId:'synthetic',version:1});assert.equal(r.restartRequired,true);assert.equal(f.stopped(),true)
 assert.equal(f.task.inputs.length,0);await assert.rejects(access(f.root+'/execution/workspace/materials/synthetic.pdf'));assert.deepEqual(JSON.parse(await readFile(f.root+'/execution/context/material-results.json','utf8')).items,[])
 await assert.rejects(f.service.read(f.id,{id:'owner'},'token',{fileId:'synthetic',version:1}),{statusCode:404})
})
test('cancel staged upload cleans bytes and never creates an OA file',async t=>{
 const f=await fixture(t),uploads=new TaskUploads(f.tasks,async()=>{throw Error('OA should not be called')});const user={id:'owner'}
 const u=await uploads.create(f.id,user,'token',{name:'test.txt',size:5});await uploads.chunk(f.id,u.id,user,'token',0,Buffer.from('12345'))
 await uploads.cancel(f.id,u.id,user,'token');await assert.rejects(access(path.join(f.root,'upload-staging',u.id)));await assert.rejects(uploads.complete(f.id,u.id,user,'token'),{statusCode:404})
})
test('sandbox extracts Chinese image without network or host document access',async()=>{
 const rows=[];for await(const row of extractMaterial(path.resolve('case-service/fixtures/recognition.jpg'),new AbortController().signal))rows.push(row)
 assert.equal(rows[0].total,1);assert.equal(rows[1].page,1);assert.ok(rows[1].image.length>1000)
})

test('real mixed PDF and Word decoding preserves text pages and extracts embedded scans',async t=>{
 const {execFileSync}=await import('node:child_process');const root=await mkdtemp(path.join(tmpdir(),'oa-decode-'));t.after(()=>rm(root,{recursive:true,force:true}));
 execFileSync('python3',['-c',`import fitz,zipfile,sys
from pathlib import Path
root=Path(sys.argv[1]);image=Path(sys.argv[2]).read_bytes()
doc=fitz.open();p=doc.new_page();p.insert_text((72,72),'Paragraph 1: synthetic material.\\nParagraph 2: CODE-TEXT-42.');p=doc.new_page();p.insert_image(p.rect,stream=image);doc.save(root/'mixed.pdf');doc.close()
with zipfile.ZipFile(root/'image.docx','w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段 WORD-42</w:t></w:r></w:p></w:body></w:document>')
 z.writestr('word/media/image1.jpg',image)
`,root,path.resolve('case-service/fixtures/recognition.jpg')],{env:{...process.env,PYTHONPATH:path.resolve('runtime/python-deps')}})
 const pdf=[];for await(const row of extractMaterial(root+'/mixed.pdf',new AbortController().signal))pdf.push(row)
 assert.equal(pdf[0].total,2);assert.equal(pdf[1].kind,'text');assert.match(pdf[1].text,/CODE-TEXT-42/);assert.equal(pdf[2].kind,'recognition');assert.equal(pdf[2].page,2)
 const word=[];for await(const row of extractMaterial(root+'/image.docx',new AbortController().signal))word.push(row)
 assert.equal(word[0].total,2);assert.match(word[1].text,/第二段 WORD-42/);assert.match(word[1].location,/非印刷页码/);assert.equal(word[2].kind,'recognition')
})

test('recognition validates structured output and uses approved fallback with correct billing identity',async t=>{
 const {createServer}=await import('node:http'),{recognizeImage}=await import('../src/material-processing.js');let calls=0;const charged=[]
 const server=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'vision',usage:{prompt_tokens:2,completion_tokens:3},choices:[{message:{content:calls===1?'not structured':JSON.stringify({text:'第2段 CODE',description:'',uncertain:false})},finish_reason:'stop'}]}))})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const policy={connections:{resolve:choice=>({base:`http://127.0.0.1:${server.address().port}/v1`,model:choice.model})},billing:{start:c=>{charged.push(c);return {}},finish:()=>{}}}
 const result=await recognizeImage(policy,{id:'task',oaUserId:'actor',aiPolicy:{ocr:{connection:'primary',model:'plain'},ocrBackup:{connection:'fallback',model:'vision'}}},'synthetic',new AbortController().signal,{id:'actor'})
 assert.equal(calls,2);assert.equal(result.model,'vision');assert.equal(charged[1].actor.id,'actor');assert.equal(charged[1].attempt,2)
 await recognizeImage(policy,{aiPolicy:{ocr:{connection:'fallback',model:'vision'}}},'synthetic',new AbortController().signal,{id:'admin'});assert.equal(charged.at(-1).task,undefined);assert.equal(charged.at(-1).purpose,'ADMIN_TEST')
})

test('abandoned staging expires without deleting OA originals or active uploads',async t=>{
 const f=await fixture(t),uploads=new TaskUploads(f.tasks,async()=>{throw Error('OA should not be called')}),u=await uploads.create(f.id,{id:'owner'},'token',{name:'stale.txt',size:1})
 await uploads.chunk(f.id,u.id,{id:'owner'},'token',0,Buffer.from('x'));uploads.store.update(s=>{s[u.id].updatedAt=Date.now()-25*3600000})
 await uploads.prune();await assert.rejects(access(path.join(f.root,'upload-staging',u.id)));assert.equal(uploads.store.read()[u.id].cancelled,true)
})

test('material background job deduplicates and delivers result using current Jobs API',async()=>{
 let source=await readFile(path.resolve('package/injury-qa/read-material.mjs'),'utf8');source=source.replace("import {defineTool} from '@deepseek-ai/dsh-tools'","const defineTool=x=>x");const {apply}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
 const oldFetch=globalThis.fetch;let tool,hooks,started=0,ready=false,progress=''
 globalThis.fetch=async()=>Response.json({source:'test.txt',version:1,status:ready?'READY':'PARSING',done:ready?1:0,total:1,page:ready?{paragraphs:[{paragraph:2,text:'CODE'}]}:null})
 try{apply({tools:{register:t=>{tool=t}},jobs:{start:spec=>{started++;hooks=spec.run({updateProgress:value=>{progress=value}});return 'parse-1'}}})
 const args={fileId:'one',version:1,page:1,paragraph:2};await tool.execute(args,{agent:'session-a'});await tool.execute(args,{agent:'session-a'});assert.equal(started,1);ready=true
 const outcome=await hooks.done;assert.equal(outcome.status,'completed');assert.match(outcome.result,/CODE/);assert.match(outcome.result,/继续完成/);assert.equal(progress,'1/1 页')
 }finally{globalThis.fetch=oldFetch}
})
