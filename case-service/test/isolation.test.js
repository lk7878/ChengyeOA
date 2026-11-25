import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,open,writeFile} from 'node:fs/promises'
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

test('sandbox launch failure stays failed and keeps diagnostics out of the user message',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-isolation-failure-'))
 const previous=process.env.HARNESS_APPARMOR_PROFILE
 try{
  await mkdir(path.join(dir,'workspace/materials'),{recursive:true})
  process.env.HARNESS_APPARMOR_PROFILE='oa-test-profile-that-does-not-exist'
  await assert.rejects(launchIsolatedHarness({dir,id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180'}),error=>{
   assert.match(error.message,/AI 任务运行环境启动失败/)
   assert.doesNotMatch(error.message,/aa-exec|at Server|改用本机/)
   return true
  })
  assert.match(await readFile(path.join(dir,'startup.log'),'utf8'),/aa-exec/)
 }finally{
  if(previous===undefined)delete process.env.HARNESS_APPARMOR_PROFILE;else process.env.HARNESS_APPARMOR_PROFILE=previous
  await rm(dir,{recursive:true,force:true})
 }
})


test('binary preview accepts 33 MiB while preserving a 128 MiB upper bound and workspace isolation',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-large-preview-'));let runtime;
 try{
  for(const box of ['materials','drafts','reports'])await mkdir(path.join(dir,'workspace',box),{recursive:true});
  for(const [name,size]of [['preview.pdf',33*1024*1024],['oversized.pdf',128*1024*1024+1]]){const f=await open(path.join(dir,'workspace/reports',name),'w');try{await f.truncate(size)}finally{await f.close()}}
  runtime=await launchIsolatedHarness({dir,id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180'});
  const w=await harnessRpc(runtime,'workspace/create',{request:{path:'/workspace'}}),s=await harnessRpc(runtime,'session/create',{request:{workspaceId:w.workspace.workspaceId,agentPreset:'general-legal'}});
  const read=path=>fetch(runtime.base+'/api/workspaceFiles/readBytes',{method:'POST',headers:{cookie:runtime.cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'workspaceFiles/readBytes',payload:{args:{workspaceFileScopeId:s.sessionId,path,options:{}}}})});
  const response=await read('/workspace/reports/preview.pdf');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/multipart/);assert.ok((await response.arrayBuffer()).byteLength>33*1024*1024);
  const rejected=await (await read('/workspace/reports/oversized.pdf')).json();assert.equal(rejected.result.error.code,'workspace-file/too-large');assert.equal(rejected.result.error.details.limit,128*1024*1024);
  const outside=await (await read('/etc/passwd')).json();assert.equal(outside.result.ok,false);
 }finally{runtime?.stop();await rm(dir,{recursive:true,force:true})}
})


test('staged deployment exposes approved Skills for every preset and ignores workspace-installed Skills',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-approved-skills-')),bundle=path.join(dir,'bundle');let runtime;
 try{
  execFileSync('python3',[fileURLToPath(new URL('../../deploy/integration/prepare-runtime.py',import.meta.url))],{env:{...process.env,OA_RUNTIME_BUNDLE_DIR:bundle}});
  for(const box of ['materials','drafts','reports','.agents/skills/unapproved'])await mkdir(path.join(dir,'workspace',box),{recursive:true});
  await writeFile(path.join(dir,'workspace/.agents/skills/unapproved/SKILL.md'),'---\nname: unapproved\ndescription: synthetic unapproved skill\n---\nDo not load this workspace skill.');
  runtime=await launchIsolatedHarness({dir,id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180',bundlePath:bundle});
  const work=await harnessRpc(runtime,'workspace/create',{request:{path:'/workspace'}});
  for(const preset of ['general-legal','injury','medical-review','traffic-accident']){
   const session=await harnessRpc(runtime,'session/create',{request:{workspaceId:work.workspace.workspaceId,agentPreset:preset}});
   const catalog=await harnessRpc(runtime,'skills/list',{request:{sessionId:session.sessionId}});
   assert.ok(catalog.skills.length>0,`approved Skills available for ${preset}`);
   assert.ok(catalog.skills.every(skill=>skill.name!=='unapproved'));
  }
  assert.doesNotMatch(runtime.diagnostics(),/did not activate|failed to import|skipping profile bundle/);
 }finally{if(runtime){const exit=new Promise(resolve=>runtime.child.once('exit',resolve));runtime.stop();await exit}await rm(dir,{recursive:true,force:true})}
});

test('historical business runtime receives maintenance reader without changing frozen preset rules',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oa-historical-materials-'));let runtime
 try{
  for(const box of ['materials','drafts','reports'])await mkdir(path.join(dir,'workspace',box),{recursive:true});await mkdir(path.join(dir,'context'))
  const version='20261119.2',bundle=fileURLToPath(new URL('../../runtime/business-bundles/'+version+'/',import.meta.url));
  const presets=JSON.parse(await readFile(path.join(bundle,'presets/business.json'),'utf8')),business=presets.find(p=>p.id==='general');business.runtimeVersion=version
  runtime=await launchIsolatedHarness({dir,id:crypto.randomUUID(),publicBase:'http://127.0.0.1:5180',preset:business.agent,business})
  const w=await harnessRpc(runtime,'workspace/create',{request:{path:'/workspace'}});await harnessRpc(runtime,'session/create',{request:{workspaceId:w.workspace.workspaceId,agentPreset:business.agent}})
  const declaration=await readFile(path.join(dir,'home/profiles/web/material-preset.yml'),'utf8');assert.match(declaration,/tool-read-material/);assert.match(declaration,/\/run\/oa-reader\/read-material.mjs/)
  assert.doesNotMatch(runtime.diagnostics(),/did not activate|failed to import|skipping profile bundle/)
 }finally{if(runtime){const exited=new Promise(r=>runtime.child.once('exit',r));runtime.stop();await exited}await rm(dir,{recursive:true,force:true})}
})
