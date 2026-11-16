import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {OaTasks} from '../src/oa-tasks.js'

async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'oa-delete-test-'))
 const tasks=new OaTasks(root,{}),id=randomUUID(),owner='oa-owner'
 tasks.store.update(data=>{data[id]={id,owner,status:'READY',inputs:[],outputs:{saved:{fileId:'oa-saved-file',version:1,status:'SAVED'}}}})
 tasks.validate=async()=>{}
 t.after(async()=>{tasks.close();await rm(root,{recursive:true,force:true})})
 return {tasks,id,owner,root}
}

test('only the owner can delete; deletion stops execution and preserves files and saved output references',async t=>{
 const {tasks,id,owner,root}=await fixture(t)
 const file=path.join(tasks.directory(id),'workspace/reports/result.md')
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'saved result')
 let stopped=0
 tasks.runtimes.set(id,{stop(){stopped++}})
 assert.throws(()=>tasks.remove(id,'oa-other'),{statusCode:404})
 assert.equal(stopped,0)
 assert.deepEqual(tasks.remove(id,owner),{ok:true})
 assert.equal(stopped,1)
 assert.equal(tasks.runtimes.has(id),false)
 assert.deepEqual(tasks.list(owner),[])
 for(const operation of [()=>tasks.get(id,owner),()=>tasks.remove(id,owner),()=>tasks.stop(id,owner)])assert.throws(operation,{statusCode:404})
 await assert.rejects(tasks.runtime(id,{id:owner},'token'),{statusCode:404})
 await assert.rejects(tasks.start(id,{id:owner},'token'),{statusCode:404})
 await assert.rejects(tasks.save(id,{id:owner},'token'),{statusCode:404})
 tasks.update(id,{status:'RUNNING'})
 assert.equal(tasks.store.read()[id].status,'DELETED')
 assert.equal(tasks.store.read()[id].outputs.saved.fileId,'oa-saved-file')
 assert.equal(await readFile(file,'utf8'),'saved result')
 assert.deepEqual(new OaTasks(root,{}).list(owner),[])
})

test('preparation and in-flight save prevent deletion until the operation settles',async t=>{
 const {tasks,id,owner}=await fixture(t)
 tasks.update(id,{status:'PREPARING'})
 assert.throws(()=>tasks.remove(id,owner),{statusCode:409})
 tasks.update(id,{status:'READY'})
 let finish
 tasks.validate=()=>new Promise(resolve=>{finish=resolve})
 await mkdir(path.join(tasks.directory(id),'workspace'),{recursive:true})
 const saving=tasks.save(id,{id:owner},'token')
 assert.throws(()=>tasks.remove(id,owner),{statusCode:409})
 finish();await saving
 tasks.remove(id,owner)
 assert.equal(tasks.list(owner).length,0)
})

for(const revoked of [false,true])test(`monitor cannot revive a deleted task after authorization settles (revoked=${revoked})`,async t=>{
 const {tasks,id,owner}=await fixture(t)
 let finish
 tasks.validate=()=>new Promise((resolve,reject)=>{finish=()=>revoked?reject(Error('revoked')):resolve()})
 tasks.runtimes.set(id,{token:'token',stop(){}})
 const monitoring=tasks.monitor()
 tasks.remove(id,owner);finish();await monitoring
 assert.equal(tasks.store.read()[id].status,'DELETED')
})
