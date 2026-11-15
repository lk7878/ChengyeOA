import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {acquireWriter} from '../src/writer-lock.js'
test('same data directory admits exactly one metadata writer',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'oa-writer-test-'));let release;try{release=await acquireWriter(dir);await assert.rejects(acquireWriter(dir));release();await new Promise(r=>setTimeout(r,10));release=await acquireWriter(dir)}finally{release?.();await rm(dir,{recursive:true,force:true})}})
