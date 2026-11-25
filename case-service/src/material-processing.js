import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {writeFile,mkdir,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Store} from './atomic-store.js'
import {meteredCompletion} from './metered-model.js'
const here=path.dirname(fileURLToPath(import.meta.url))
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const keyOf=ref=>ref.fileId+':'+ref.version+':'+ref.sha256
const stamp=()=>new Date().toISOString()
const paragraphs=text=>text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean).map((text,i)=>({paragraph:i+1,text}))
export async function* extractMaterial(file,signal){
 const runtime=process.env.MATERIAL_RUNTIME_ROOT||path.resolve(here,'../../runtime')
 const args=['--die-with-parent','--unshare-all','--new-session','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',path.join(runtime,'python-deps'),'/deps','--ro-bind',path.join(here,'material-extract.py'),'/extract.py','--ro-bind',file,'/input'+path.extname(file),'--setenv','PYTHONPATH','/deps','/usr/bin/python3','/extract.py','/input'+path.extname(file)]
 const command=process.env.HARNESS_APPARMOR_PROFILE?'aa-exec':'bwrap'
 const launchArgs=[...(process.env.HARNESS_APPARMOR_PROFILE?['-p',process.env.HARNESS_APPARMOR_PROFILE,'--','bwrap']:[]),...args]
 const pythonIndex=launchArgs.indexOf('--setenv');launchArgs.splice(pythonIndex,0,'--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8')
 const child=spawn(command,launchArgs,{signal,stdio:['ignore','pipe','pipe']});let error=''
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error.split('\n').filter(Boolean).at(-1)||'材料解码失败')))})
 done.catch(()=>{})
 child.stderr.on('data',b=>{error=(error+b).slice(-2000)})
 let timer=setTimeout(()=>child.kill('SIGKILL'),120000)
 try{for await(const line of createInterface({input:child.stdout})){clearTimeout(timer);yield JSON.parse(line);timer=setTimeout(()=>child.kill('SIGKILL'),120000)}await done}
 finally{clearTimeout(timer);child.kill()}
}
export const recognitionPrompt='读取这张材料图片。只返回 JSON：{"text":"逐字转录的文字，按原段落换行，无法辨认标注[待核实]","description":"仅当存在照片、图示或非文字内容时，客观描述可见内容；不得推断诊断、身份或法律结论","uncertain":true或false}。不要编造。纯照片没有文字时 text 留空。'
export async function recognizeImage(policy,task,image,signal,actor){
 const snapshot=task.aiPolicy||policy.snapshot(task.kind),defaults=task.kind&&!snapshot.ocr?policy.snapshot(task.kind):snapshot,routes=[snapshot.ocr||defaults.ocr,snapshot.ocrBackup||defaults.ocrBackup].filter(Boolean)
 if(!routes.length)fail('尚未配置图片识别模型，请联系超级管理员',409)
 let last
 for(const choice of routes){
  signal.throwIfAborted()
  try{
   const route=policy.connections.resolve(choice,policy.localOnly||snapshot.localOnly)
   const response=await meteredCompletion({billing:policy.billing,context:{task:task.id?task:undefined,actor,connection:choice.connection,model:choice.model,purpose:task.id?'OCR':'ADMIN_TEST',attempt:routes.indexOf(choice)+1},route,signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),body:{model:route.model,stream:false,temperature:0,max_tokens:8192,messages:[{role:'user',content:[{type:'text',text:recognitionPrompt},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+image}}]}]}})
   const data=await response.json()
   if(!response.ok)throw Error('识别服务返回 HTTP '+response.status)
   if(data.choices?.[0]?.finish_reason==='length')throw Error('识别输出达到上限，请拆分页面')
   const content=data.choices?.[0]?.message?.content||'',json=JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''))
   if(typeof json.text!=='string'||typeof json.description!=='string'||typeof json.uncertain!=='boolean'||!(json.text.trim()||json.description.trim()))throw Error('识别结果格式不完整')
   return {...json,model:choice.model,connection:choice.connection}
  }catch(e){last=e}
 }
 throw last
}
export class MaterialProcessing{
 constructor(tasks,{extract=extractMaterial,recognize=recognizeImage}={}){
  this.tasks=tasks;this.extract=extract;this.recognize=recognize;this.jobs=new Map();this.store=new Store(path.join(tasks.root,'material-processing.json'));this.queue=Promise.resolve()
  this.store.update(s=>{for(const records of Object.values(s))for(const r of Object.values(records))if(['QUEUED','PARSING'].includes(r.status)){r.status='INTERRUPTED';r.error='解析已中断，可重试';r.updatedAt=stamp()}})
 }
 state(id,key){return this.store.read()[id]?.[key]}
 put(id,key,patch){return this.store.update(s=>{s[id]??={};s[id][key]={...s[id][key],...patch,updatedAt:stamp()};return s[id][key]})}
 async authorize(id,user,token){const task=this.tasks.get(id,user.id);await this.tasks.validate(task,token);return this.tasks.get(id,user.id)}
 list(task){return {items:task.inputs.map(ref=>({fileId:ref.fileId,version:ref.version,name:ref.name,path:'/workspace/materials/'+ref.localName,...(this.state(task.id,keyOf(ref))||{status:'SAVED',done:0,total:0})})).map(({pages,...row})=>row)}}
 async context(task){
  const dir=path.join(this.tasks.directory(task.id),'context');await mkdir(dir,{recursive:true,mode:0o700})
  const temp=path.join(dir,randomUUID());const entries=task.inputs.map(ref=>({fileId:ref.fileId,version:ref.version,sha256:ref.sha256,name:ref.name,localName:ref.localName,...this.state(task.id,keyOf(ref))}))
  await writeFile(temp,JSON.stringify({items:entries}),{mode:0o400});await rename(temp,path.join(dir,'material-results.json'))
 }
 enqueue(task,ref,token,retry=false){
  const key=keyOf(ref),jobKey=task.id+'/'+key,old=this.state(task.id,key)
  if(this.jobs.has(jobKey)||old?.status==='READY'||(old&&!retry))return
  const controller=new AbortController();this.jobs.set(jobKey,controller)
  this.put(task.id,key,{status:'QUEUED',startedAt:stamp(),total:old?.total||0,done:old?.done||0,pages:old?.pages||{},error:null})
  const run=async()=>{try{await this.process(task,ref,token,controller.signal)}catch(e){if(!controller.signal.aborted)this.put(task.id,key,{status:'FAILED',error:e.message})}finally{this.jobs.delete(jobKey);try{await this.context(this.tasks.get(task.id,task.owner))}catch{}}}
  // Bound CPU and recognition concurrency. A failed job never blocks the queue.
  this.queue=this.queue.then(run,run)
 }
 ensure(task,token){for(const ref of task.inputs)this.enqueue(task,ref,token)}
 async process(task,ref,token,signal){
  const key=keyOf(ref),alive=async()=>{signal.throwIfAborted();const current=this.tasks.get(task.id,task.owner);if(!current.inputs.some(r=>keyOf(r)===key))fail('材料已从任务移除',404);await this.tasks.validate(current,token);signal.throwIfAborted()}
  await alive();this.put(task.id,key,{status:'PARSING'});await this.context(task)
  for await(const page of this.extract(path.join(this.tasks.directory(task.id),'workspace/materials',ref.localName),signal)){
   await alive()
   if(page.total!==undefined){this.put(task.id,key,{total:page.total});continue}
   const prior=this.state(task.id,key).pages?.[page.page];if(prior&&!prior.error)continue
   let result
   try{
    const recognized=page.image?await this.recognize(this.tasks.aiPolicy,task,page.image,signal,{id:task.oaUserId}):{text:page.text,description:'',uncertain:false}
    await alive();result={page:page.page,location:page.location||'原文件第 '+page.page+' 页',paragraphs:paragraphs(recognized.text),description:recognized.description,uncertain:recognized.uncertain,kind:page.kind,model:recognized.model}
   }catch(e){signal.throwIfAborted();result={page:page.page,error:e.message}}
   const pages={...this.state(task.id,key).pages,[page.page]:result},done=Object.values(pages).filter(p=>!p.error).length
   this.put(task.id,key,{pages,done});await this.context(this.tasks.get(task.id,task.owner))
  }
  await alive();const current=this.state(task.id,key),failed=Object.values(current.pages).filter(p=>p.error)
  if(!current.total)throw Error('材料没有可读取的页面')
  this.put(task.id,key,{status:failed.length?'FAILED':'READY',completedAt:stamp(),error:failed.length?`${failed.length} 页未完成，可重试失败页：${failed[0].error}`:null});await this.context(this.tasks.get(task.id,task.owner))
 }
 async read(id,user,token,body={}){
  const task=await this.authorize(id,user,token);this.ensure(task,token)
  if(!body.fileId)return this.list(task)
  const ref=task.inputs.find(r=>r.fileId===body.fileId&&r.version===body.version);if(!ref)fail('材料不在当前任务中',404)
  const row=this.state(id,keyOf(ref)),page=row?.pages?.[body.page||1]
  return {source:ref.name,fileId:ref.fileId,version:ref.version,status:row?.status||'SAVED',done:row?.done,total:row?.total,error:row?.error,page:page?{...page,paragraphs:page.paragraphs?.slice(Math.max(0,(body.paragraph||1)-1),Math.max(0,(body.paragraph||1)-1)+40)}:null}
 }
 async retry(id,user,token,body){const task=await this.authorize(id,user,token),ref=task.inputs.find(r=>r.fileId===body.fileId&&r.version===body.version);if(!ref)fail('材料不存在',404);this.enqueue(task,ref,token,true);return this.list(task)}
 async remove(id,user,token,body){
  const task=await this.authorize(id,user,token),ref=task.inputs.find(r=>r.fileId===body.fileId&&r.version===body.version);if(!ref)fail('材料不存在',404)
  if(this.tasks.busy.has(id))fail('任务正在处理，请稍后重试',409)
  this.tasks.busy.add(id)
  try{
   // Stop the reader before changing its read-only mount; it cannot retain access to removed bytes.
   const running=this.tasks.runtimes.has(id);if(running)this.tasks.stop(id,user.id,'材料已移除，请重新打开 AI 会话；OA 原文件保留')
   this.jobs.get(id+'/'+keyOf(ref))?.abort()
   const next=this.tasks.update(id,{inputs:task.inputs.filter(r=>keyOf(r)!==keyOf(ref))})
   await this.tasks.manifest(next);await this.context(next)
   await rm(path.join(this.tasks.directory(id),'workspace/materials',ref.localName),{force:true})
   this.store.update(s=>{if(s[id])delete s[id][keyOf(ref)]})
   return {ok:true,restartRequired:running,message:running?'已移除。请返回 AI 任务重新启动，OA 原文件保留。':'已从任务移除，OA 原文件保留。'}
  }finally{this.tasks.busy.delete(id)}
 }
 close(){for(const c of this.jobs.values())c.abort()}
}
