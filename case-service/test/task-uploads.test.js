import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {OaTasks} from '../src/oa-tasks.js'
import {TaskUploads} from '../src/task-uploads.js'
import {uploadTaskFile} from '../../plugins/dsh-baiyou-brand/src/oa-upload.js'
test('upload saves an owner-only OA version and attaches it once; retries do not duplicate; access rechecked',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'task-upload-')),tasks=new OaTasks(root,{}),id=randomUUID(),user={id:'owner'},bytes=Buffer.from('original material'),sha256=createHash('sha256').update(bytes).digest('hex')
 let revoked=false,completed=0,created=0,failDownload=true
 tasks.store.update(d=>{d[id]={id,owner:'owner',status:'READY',inputs:[],outputs:{}}})
 tasks.validate=async()=>{if(revoked)throw Object.assign(Error('revoked'),{statusCode:403})}
 const uploads=new TaskUploads(tasks,async(token,route,options={})=>{
  assert.equal(token,'owner-token')
  if(route==='/personal-files/uploads'){created++;assert.equal(options.body.fileId,undefined);assert.equal(options.body.parentId,undefined);return {id:'oa-upload'}}
  if(route.endsWith('/oa-upload'))return {offset:0,chunkSize:4*1024*1024}
  if(route.includes('/chunk?')){assert.equal(await options.body.get('file').text(),bytes.toString());return {offset:bytes.length}}
  if(route.endsWith('/complete')){completed++;return {id:'oa-file',version:1}}
  if(route.endsWith('/versions'))return [{name:'材料.txt',version:1,sha256,size:bytes.length}]
  if(route.endsWith('/content')){if(failDownload)throw Error('attachment offline');return new Response(bytes)}
  throw Error('Unexpected route '+route)
 })
 t.after(async()=>{tasks.close();await tasks.materials.queue;await rm(root,{recursive:true,force:true})})
 await assert.rejects(uploads.create(id,{id:'other'},'owner-token',{name:'a',size:1}),{statusCode:404});assert.equal(created,0)
 await assert.rejects(uploads.create(id,user,'owner-token',{name:'../file',size:1}))
 const u=await uploads.create(id,user,'owner-token',{name:'材料.txt',size:bytes.length})
 await assert.rejects(uploads.status(id,u.id,{id:'other'},'owner-token'),{statusCode:404})
 await uploads.chunk(id,u.id,user,'owner-token',0,bytes)
 await assert.rejects(uploads.complete(id,u.id,user,'owner-token'),/attachment offline/);assert.equal(completed,1);assert.equal(tasks.get(id,user.id).inputs.length,0)
 failDownload=false;const result=await uploads.complete(id,u.id,user,'owner-token');assert.equal(completed,1);assert.equal(tasks.get(id,user.id).inputs.length,1)
 assert.equal(await readFile(path.join(tasks.directory(id),'workspace/materials',tasks.get(id,user.id).inputs[0].localName),'utf8'),bytes.toString())
 assert.deepEqual(await uploads.complete(id,u.id,user,'owner-token'),result);assert.equal(tasks.get(id,user.id).inputs.length,1)
 revoked=true;await assert.rejects(uploads.complete(id,u.id,user,'owner-token'),{statusCode:403})
})
test('browser uploader resumes chunks and retries completion using same upload ID',async()=>{
 const file=new File(['abcdefgh'],'test.txt'),state={},calls=[];let offset=0,fail=true
 const browser={fetch:async(url,options={})=>{calls.push([url,options.method]);if(url.endsWith('material-uploads'))return Response.json({id:'one'});if(url.endsWith('/one'))return Response.json({offset,chunkSize:4});if(url.includes('/chunk?')){offset+=options.body.size;return Response.json({offset})}if(fail){fail=false;return Response.json({error:'retry completion'},{status:503})}return Response.json({fileId:'file',path:'/workspace/materials/file'})}}
 await assert.rejects(uploadTaskFile('task',file,state,()=>{},browser),/retry completion/)
 assert.equal((await uploadTaskFile('task',file,state,()=>{},browser)).fileId,'file')
 assert.equal(calls.filter(([p])=>p.endsWith('material-uploads')).length,1);assert.equal(calls.filter(([p])=>p.includes('/chunk?')).length,2)
})

test('upload routes parse binary chunks without affecting JSON and reject other owners',async t=>{
 const {default:Fastify}=await import('fastify'),{registerTaskUploads}=await import('../src/task-uploads.js')
 const root=await mkdtemp(path.join(tmpdir(),'task-upload-routes-')),tasks=new OaTasks(root,{}),id=randomUUID(),app=Fastify();let owner='owner',forwarded=0
 tasks.store.update(d=>{d[id]={id,owner:'owner',status:'READY',inputs:[]}});tasks.validate=async()=>{}
 app.decorate('oaTasks',tasks);app.addHook('preHandler',async r=>{r.user={id:owner};r.oa={token:'synthetic'}})
 await registerTaskUploads(app,{request:async(_token,route,options)=>{
  if(route.endsWith('/uploads'))return {id:'upload'}
  if(route.includes('/chunk?')){forwarded++;assert.equal(await options.body.get('file').text(),'abcd');return {offset:4}}
  return {offset:0,chunkSize:4}
 }})
 t.after(async()=>{await app.close();tasks.close();await rm(root,{recursive:true,force:true})})
 const created=await app.inject({method:'POST',url:`/api/tasks/${id}/material-uploads`,payload:{name:'sample.txt',size:4}})
 assert.equal(created.statusCode,200);const base=`/api/tasks/${id}/material-uploads/${created.json().id}`
 assert.equal((await app.inject({method:'PUT',url:base+'/chunk?offset=0',headers:{'content-type':'application/octet-stream'},payload:Buffer.from('abcd')})).statusCode,200)
 assert.equal((await app.inject({method:'PUT',url:base+'/chunk?offset=0',headers:{'content-type':'application/octet-stream'},payload:Buffer.alloc(4*1024*1024+1)})).statusCode,413)
 owner='other';assert.equal((await app.inject({method:'GET',url:base})).statusCode,404)
 assert.equal((await app.inject({method:'PUT',url:base+'/chunk?offset=0',headers:{'content-type':'application/octet-stream'},payload:Buffer.from('abcd')})).statusCode,404);assert.equal(forwarded,0)
})

test('composer upload is scoped to its own input, serializes files and inserts saved material paths',async()=>{
 const {Window}=await import('../../runtime/upstream/harness/node_modules/.pnpm/happy-dom@20.11.6/node_modules/happy-dom/lib/index.js')
 const {bindOaUpload}=await import('../../plugins/dsh-baiyou-brand/src/oa-upload.js')
 const browser=new Window({url:'http://localhost/harness/00000000-0000-0000-0000-000000000001/'}),doc=browser.document
 doc.body.innerHTML='<button class="oa-upload-trigger">＋</button><button class="oa-upload-trigger">其他会话</button>'
 let inserted='',persisted=0,active=0,maxActive=0,sequence=0
 browser.fetch=async(url,options={})=>{
  if(url.endsWith('material-uploads')){active++;maxActive=Math.max(maxActive,active);return Response.json({id:String(++sequence)})}
  if(url.endsWith('/complete')){await new Promise(r=>setTimeout(r,5));active--;return Response.json({name:'材料.txt',path:'/workspace/materials/'+sequence})}
  if(url.includes('/chunk?'))return Response.json({offset:4})
  return Response.json({offset:0,chunkSize:4})
 }
 const anchor=doc.querySelector('button'),dispose=bindOaUpload({}, {captureInsertion:()=>({draftRev:1}),insertText:(text,span)=>{assert.equal(span.draftRev,1);inserted=text;return true},persistDraft:()=>persisted++},browser,anchor)
 doc.querySelectorAll('.oa-upload-trigger')[1].click();assert.equal(doc.querySelector('dialog'),null)
 anchor.click();assert.ok(doc.querySelector('dialog[open]'))
 const picker=doc.querySelector('input[type=file]');Object.defineProperty(picker,'files',{value:[new File(['abcd'],'one.txt'),new File(['abcd'],'two.txt')]});picker.dispatchEvent(new browser.Event('change'))
 for(let i=0;i<100&&doc.querySelectorAll('.oa-upload-list span').length===2&&!Array.from(doc.querySelectorAll('.oa-upload-list span')).every(e=>e.textContent.includes('已保存到 OA'));i++)await new Promise(r=>setTimeout(r,5))
 assert.equal(maxActive,1);assert.equal(active,0)
 const insert=Array.from(doc.querySelectorAll('dialog button')).find(b=>b.textContent==='将已上传文件加入输入框');assert.equal(insert.disabled,false);insert.click()
 assert.match(inserted,/materials\/1/);assert.match(inserted,/materials\/2/);assert.equal(persisted,1);assert.equal(doc.querySelector('dialog'),null)
 dispose();anchor.click();assert.equal(doc.querySelector('dialog'),null);await browser.happyDOM.close()
})
