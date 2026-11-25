import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile,lstat,cp,access,mkdtemp,rm} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import http from 'node:http'
import net from 'node:net'
import {modelConfig} from './model-config.js'
const root=fileURLToPath(new URL('../..',import.meta.url))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
export async function launchIsolatedHarness({dir,id,publicBase,brokerSocket,preset='general-legal',policy,business,bundlePath}){
 const engine=path.join(root,'runtime/upstream/harness'),bundle=bundlePath||(business?path.join(root,'runtime/business-bundles',business.runtimeVersion):path.join(root,'runtime/bundle')),node=path.join(root,'runtime/node24'),home=path.join(dir,'home')
 for(const directory of [home,path.join(home,'profiles')]){const info=await lstat(directory).catch(e=>{if(e.code!=='ENOENT')throw e});if(info&&!info.isDirectory())await rm(directory,{force:true});await mkdir(directory,{recursive:true,mode:0o700})}
 // A task may alter its writable home. Recreate only the deployment profile after
 // checking its parents; never follow a task-created link into the host.
 await rm(path.join(home,'profiles/web'),{recursive:true,force:true});await cp(path.join(bundle,'profile'),path.join(home,'profiles/web'),{recursive:true,verbatimSymlinks:true})
 await rm(path.join(home,'settings.yaml'),{force:true});
 const presetPatch=path.join(home,'profiles/web/cordis.patch.yml');await writeFile(presetPatch,(await readFile(presetPatch,'utf8'))+'\n- id: workspace-files\n  config:\n    maxFileBytes: 134217728\n- id: agent-preset-registry\n  config: '+JSON.stringify({default:preset})+'\n',{mode:0o600});
 const approvedModel=policy?.model||modelConfig?.route.model
 if(approvedModel){
  const providerId=modelConfig?.route.provider||'oa'
  const definition=modelConfig?.provider.models?.find(m=>m.id===approvedModel)||{id:approvedModel,name:approvedModel,input:['text']}
  const provider={...modelConfig?.provider,api:'openai-completions',baseURL:'http://127.0.0.1:8090/llm/v1',apiKeyEnv:'OA_TASK_MODEL_KEY',models:[definition],headers:{}}
  await writeFile(presetPatch,'\n- id: llm-pi-ai\n  config: '+JSON.stringify({providers:{[providerId]:provider}})+'\n- id: agent-default-model\n  config: '+JSON.stringify({provider:providerId,model:approvedModel})+'\n',{flag:'a',mode:0o600})
 }
 const manifest=path.join(dir,'workspace/task.json'),manifestExists=await access(manifest).then(()=>true,()=>false)
 const bwrapArgs=['--die-with-parent','--unshare-all','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc','--ro-bind','/etc/ssl','/etc/ssl','--ro-bind',engine,'/engine','--ro-bind',bundle,'/app','--ro-bind',path.join(root,'runtime/plugin-deps'),'/deps','--ro-bind',node,'/runtime','--ro-bind',path.join(root,'runtime/python-deps'),'/pydeps','--bind',home,'/home/task']
 bwrapArgs.push('--ro-bind',path.join(root,'plugins/dsh-baiyou-brand'),'/app/plugins/dsh-baiyou-brand','--ro-bind',path.join(root,'package/injury-qa/read-material.mjs'),'/run/oa-reader/read-material.mjs','--symlink','/app/node_modules','/run/oa-reader/node_modules')
 bwrapArgs.push('--ro-bind',path.join(root,'package/record-parse/worker.py'),'/app/package/record-parse/worker.py','--ro-bind',path.join(root,'package/record-parse/parse-records.mjs'),'/app/package/record-parse/parse-records.mjs')
 if(business){
  bwrapArgs.push('--ro-bind',path.join(dir,'context'),'/run/oa-task')
  const declaration=path.join(bundle,'plugins/oa-legal-presets',preset+'.yml')
  await access(declaration)
  // Common material reader is a maintenance fix, independent of frozen business rules.
  let patched=await readFile(declaration,'utf8')
  patched=patched.replaceAll('/app/package/injury-qa/read-material.mjs','/run/oa-reader/read-material.mjs')
  if(!patched.includes('tool-read-material'))patched+='\n          - id: tool-read-material\n            name: /run/oa-reader/read-material.mjs\n'
  if(!patched.includes('材料读取优先使用 read_task_material'))patched=patched.replace(/^(\s*)prefix: (.*)$/m,(_match,indent,value)=>{
   const note='材料读取优先使用 read_task_material；按工具返回的文件名、版本、页码和段落引用，图片描述不是原文。解析中需等待工具后台完成通知，不要重复识别。 '
   return /^[>|]/.test(value)?indent+'prefix: '+value+'\n'+indent+'  '+note:indent+'prefix: '+note+value
  })
  const materialDeclaration=path.join(home,'profiles/web/material-preset.yml');await writeFile(materialDeclaration,patched,{mode:0o400})
  bwrapArgs.push('--ro-bind',materialDeclaration,'/app/plugins/oa-legal-presets/cordis.patch.yml')
  const deployed=JSON.parse(await readFile(path.join(bundle,'presets/business.json'),'utf8')).find(p=>p.id===business.id)
  for(const skill of deployed.skills.filter(id=>!business.skills.includes(id))){
   bwrapArgs.push('--tmpfs','/app/package/'+business.agent+'/.agents/skills/'+skill)
  }
  if(!business.outputs){
   const profile=path.join(home,'profiles/web/package.json')
   const pkg=JSON.parse(await readFile(profile,'utf8'))
   const permitted=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','oa-legal-presets','dsh-baiyou-brand']
   pkg.dsh.profile.bundles=pkg.dsh.profile.bundles.filter(name=>permitted.includes(name))
   pkg.dependencies=Object.fromEntries(Object.entries(pkg.dependencies).filter(([name])=>permitted.includes(name)))
   await writeFile(profile,JSON.stringify(pkg))
   for(const name of ['injury','medical-review','traffic-accident'])bwrapArgs.push('--tmpfs','/app/package/'+name)
  }
 }
 async function boot(start){
  const channel=await mkdtemp(path.join(tmpdir(),'oa-harness-')),socketPath=path.join(channel,'api.sock')
  const gateway=http.createServer((req,res)=>{const upstream=http.request({socketPath,method:req.method,path:req.url,headers:req.headers},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});upstream.on('error',()=>{res.writeHead(503);res.end('任务进程未就绪')});req.pipe(upstream)})
  const sockets=new Set();gateway.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))})
  gateway.on('upgrade',(req,socket,head)=>{const upstream=net.connect(socketPath);upstream.on('connect',()=>{upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket)});upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());socket.on('error',()=>upstream.destroy())})
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${gateway.address().port}`
  const child=start(channel,socketPath);let output='',exited=false
  child.stdout.on('data',b=>{output=(output+b.toString()).slice(-200000)});child.stderr.on('data',b=>{output=(output+b.toString()).slice(-200000)});child.on('exit',()=>{exited=true});child.on('error',error=>{output+='\n'+error.message;exited=true})
  const stop=()=>{child.kill('SIGTERM');for(const s of sockets)s.destroy();gateway.close();void rm(channel,{recursive:true,force:true})}
  const diagnostics=()=>output.replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]')
  try{for(let i=0;i<300;i++){
   if(exited){await sleep(50);throw Error('Harness 启动失败')}const match=output.match(/token=([A-Za-z0-9_-]+)/)
   if(match){try{await access(socketPath);const r=await fetch(base+'/?token='+match[1],{redirect:'manual'});const cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(cookie)return {base,cookie,stop,child,diagnostics}}catch{} }
   await sleep(100)
  }throw Error('Harness 启动超时')}catch(e){const detail=diagnostics();stop();e.detail=detail;throw e}
 }
 const sandbox=()=>boot((channel,socketPath)=>spawn(process.env.HARNESS_APPARMOR_PROFILE?'aa-exec':'bwrap',[...(process.env.HARNESS_APPARMOR_PROFILE?['-p',process.env.HARNESS_APPARMOR_PROFILE,'--','bwrap']:[]),...bwrapArgs,'--bind',channel,'/run/channel','--bind',path.join(dir,'workspace'),'/workspace','--ro-bind',path.join(dir,'workspace/materials'),'/workspace/materials',...(manifestExists?['--ro-bind',manifest,'/workspace/task.json']:[]),...(brokerSocket?['--ro-bind',brokerSocket,'/run/task-broker.sock']:[]),'--clearenv','--setenv','HOME','/home/task','--setenv','DSH_HOME','/home/task','--setenv','PATH','/runtime/bin:/usr/bin:/bin','--setenv','LANG','C.UTF-8','--setenv','PYTHONPATH','/pydeps','--setenv','OA_TASK_MODEL_KEY','task-scoped','--setenv','CLOSEAI_API_KEY','task-scoped','--setenv','RECORD_PARSE_API_KEY','task-scoped','--setenv','RECORD_PARSE_BASE_URL','http://127.0.0.1:8090/ocr/v1','--setenv','NODE_USE_ENV_PROXY','1','--setenv','HTTP_PROXY','http://127.0.0.1:8090','--setenv','HTTPS_PROXY','http://127.0.0.1:8090','--setenv','NO_PROXY','127.0.0.1,localhost','--chdir','/workspace','/bin/sh','-c','/runtime/bin/node /app/task-bridge.mjs & exec /runtime/bin/node /engine/apps/cli/lib/bin.js web --host 127.0.0.1 --port 3081 --no-open --public-url "$1" --trusted-host "$2"','sh',`${publicBase}/harness/${id}/`,new URL(publicBase).host],{stdio:['ignore','pipe','pipe']}))
 try{return {...await sandbox(),workspacePath:'/workspace'}}catch(e){
  await writeFile(path.join(dir,'startup.log'),e.detail||String(e),{mode:0o600});
  throw Error(/RTM_NEWADDR|uid map|Operation not permitted/.test(e.detail||'')
    ? 'AI 任务隔离环境不可用，请联系管理员检查运行权限后重试。'
    : 'AI 任务运行环境启动失败，请重试；若仍失败，请联系管理员查看启动日志。');
 }

}
export async function harnessRpc(instance,method,args){const response=await fetch(instance.base+'/api/'+method,{method:'POST',headers:{cookie:instance.cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});const data=await response.json();if(!response.ok||!data.result?.ok)throw Error(data.result?.error?.message||'Harness RPC failed');return data.result.value}
