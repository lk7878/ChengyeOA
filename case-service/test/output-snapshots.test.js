import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,utimes,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {outputSnapshots} from '../src/output-snapshots.js'
test('autosave includes nested drafts but never follows task-written links',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-output-test-'))
 try{await mkdir(path.join(dir,'workspace/reports/nested'),{recursive:true});await mkdir(path.join(dir,'workspace/drafts'));await writeFile(path.join(dir,'secret'),'private');await writeFile(path.join(dir,'workspace/reports/nested/result.md'),'report');await utimes(path.join(dir,'workspace/reports/nested/result.md'),new Date(0),new Date(0));await symlink(path.join(dir,'secret'),path.join(dir,'workspace/reports/leak'));await symlink(dir,path.join(dir,'workspace/drafts/escape'));
 const outputs=[];for await(const entry of outputSnapshots(path.join(dir,'workspace'),dir))outputs.push([entry.relative,await readFile(entry.snapshot,'utf8')]);assert.deepEqual(outputs,[['reports/nested/result.md','report']])
 }finally{await rm(dir,{recursive:true,force:true})}
})
