import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,utimes,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {OaTasks} from '../src/oa-tasks.js'
test('outputs require explicit current hashes; monitoring never saves; confirmation is owner-only and idempotent',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'oa-confirm-')),tasks=new OaTasks(root,{}),id=randomUUID(),user={id:'owner'};
 tasks.store.update(d=>{d[id]={id,owner:user.id,status:'RUNNING',inputs:[],outputs:{}}});tasks.validate=async()=>{};
 const dir=path.join(tasks.directory(id),'workspace/reports');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'result.txt');const write=async text=>{await writeFile(file,text);await utimes(file,1,1)};await write('first');
 const fetchBefore=globalThis.fetch;let uploads=0;const chunks=[];
 globalThis.fetch=async(url,options)=>{url=String(url);let data={};if(url.endsWith('/uploads')){uploads++;data={id:'upload'}}else if(url.endsWith('/upload'))data={offset:0,chunkSize:1024};else if(url.includes('/chunk?'))chunks.push(await options.body.get('file').text());else if(url.endsWith('/complete'))data={id:'saved',version:1};else throw Error('Unexpected request');return Response.json({code:200,data})};
 t.after(async()=>{globalThis.fetch=fetchBefore;tasks.close();await rm(root,{recursive:true,force:true})});
 tasks.runtimes.set(id,{stop(){},token:'token'});await tasks.monitor();assert.equal(uploads,0);
 await assert.rejects(tasks.save(id,user,'token'),{statusCode:400});
 const first=(await tasks.candidates(id,user,'token')).items[0];await assert.rejects(tasks.candidates(id,{id:'other'},'token'),{statusCode:404});
 await write('second');await assert.rejects(tasks.save(id,user,'token',[first.key]),{statusCode:409});assert.equal(uploads,0);
 const current=(await tasks.candidates(id,user,'token')).items[0];assert.notEqual(first.key,current.key);
 await writeFile(path.join(dir,'script.py'),'unselected');await utimes(path.join(dir,'script.py'),1,1);
 await tasks.save(id,user,'token',[current.key]);assert.equal(uploads,1);assert.deepEqual(chunks,['second']);
 await tasks.save(id,user,'token',[current.key]);assert.equal(uploads,1);assert.equal(Object.keys(tasks.get(id,user.id).outputs).length,1);
 assert.equal((await tasks.candidates(id,user,'token')).items.find(i=>i.key===current.key).saved,true);
})
