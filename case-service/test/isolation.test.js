import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {launchIsolatedHarness,harnessRpc} from '../src/isolated-harness.js'
test('latest Harness creates all professional presets without shared cookies or sessions',async()=>{
 const dirs=await Promise.all([1,2].map(()=>mkdtemp(path.join(tmpdir(),'oa-isolation-test-'))));const runtimes=[]
 try{for(const dir of dirs){for(const box of ['materials','drafts','reports'])await mkdir(path.join(dir,'workspace',box),{recursive:true});runtimes.push(await launchIsolatedHarness({dir,id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180'}))}
 assert.notEqual(runtimes[0].cookie,runtimes[1].cookie)
 const work=await harnessRpc(runtimes[0],'workspace/create',{request:{path:'/workspace'}})
 for(const kind of ['general-legal','injury','medical-review','traffic-accident']){const s=await harnessRpc(runtimes[0],'session/create',{request:{workspaceId:work.workspace.workspaceId,agentPreset:kind}});assert.ok(s.sessionId)}
 const other=await harnessRpc(runtimes[1],'session/list',{_request:{}});assert.equal(other.items.length,0)
 const escaped=await harnessRpc(runtimes[0],'workspace/create',{request:{path:'/opt/oa-system'}}).then(()=>true,()=>false);assert.equal(escaped,false)
 const stolen=await fetch(runtimes[1].base+'/api/session/list',{method:'POST',headers:{cookie:runtimes[0].cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'session/list',payload:{args:{_request:{}}}})});assert.ok([401,403].includes(stolen.status))
 runtimes[0].stop();await new Promise(resolve=>runtimes[0].child.once('exit',resolve));runtimes[0]=await launchIsolatedHarness({dir:dirs[0],id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180'});const restored=await harnessRpc(runtimes[0],'session/list',{_request:{}});assert.equal(restored.items.length,4)
 for(const r of runtimes)assert.doesNotMatch(r.diagnostics(),/did not activate|failed to import|skipping profile bundle/)
 }finally{for(const r of runtimes)r.stop();await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true})))}
})
