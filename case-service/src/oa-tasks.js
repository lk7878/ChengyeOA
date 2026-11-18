import {randomUUID,createHash} from 'node:crypto'
import {mkdir,writeFile,rename,readdir,lstat,open,rm,copyFile} from 'node:fs/promises'
import {createReadStream,createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {AiPolicy} from './ai-policy.js'
import {personalWorkspaceTitle} from './harness-experience.js'
import {Store} from './atomic-store.js'
import {outputSnapshots} from './output-snapshots.js'
import {oa} from './oa-client.js'
import {createTaskBroker} from './task-broker.js'
import {launchIsolatedHarness,harnessRpc} from './isolated-harness.js'
const kinds=new Set(['general','disability','injury','malpractice','traffic'])
const presets={general:'general-legal',disability:'injury',injury:'injury',malpractice:'medical-review',traffic:'traffic-accident'}
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
const hashFile=async file=>{const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex')}
export class OaTasks {
 constructor(root,knowledge){this.aiPolicy=new AiPolicy(root);this.knowledge=knowledge;this.root=root;this.store=new Store(path.join(root,'tasks.json'));this.runtimes=new Map();this.busy=new Set();this.store.update(data=>{for(const t of Object.values(data))if(['PREPARING','RUNNING'].includes(t.status)){t.status='INTERRUPTED';t.error='服务重启，任务已中断，请重新启动';}})}
 list(owner){return Object.values(this.store.read()).filter(t=>t.owner===owner&&!t.deletedAt).map(({token,...t})=>t)}
 get(id,owner){const task=this.store.read()[id];if(!task||task.deletedAt||task.owner!==owner)fail('任务不存在',404);return task}
 update(id,patch){return this.store.update(data=>data[id]?.deletedAt?undefined:Object.assign(data[id],patch,{updatedAt:new Date().toISOString()}))}
 directory(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('任务不存在',404);return path.join(this.root,'executions',id)}
 async validate(task,token){const actor=await oa(token,'/smart-case/me');if(task.caseId)await oa(token,'/smart-case/cases/'+encodeURIComponent(task.caseId));for(const kbId of task.knowledgeBases||[])this.knowledge.authorize(kbId,actor.id,'read',actor.permissions);for(const input of task.inputs){const versions=await oa(token,`/personal-files/${input.fileId}/versions`);const v=versions.find(v=>v.version===input.version);if(!v||v.sha256!==input.sha256)fail('材料版本无效或授权已撤销',403)}}
 async create(user,token,input){
  const kind=input.kind||'general';if(!kinds.has(kind))fail('无效任务类型');if(!Array.isArray(input.inputs)||input.inputs.length>1000)fail('请选择具体材料版本');
  const caseSnapshot=input.caseId?await oa(token,'/smart-case/cases/'+encodeURIComponent(input.caseId)):null;
  const inputs=[];for(const ref of input.inputs){if(typeof ref.fileId!=='string'||!Number.isSafeInteger(ref.version))fail('无效材料引用');const rows=await oa(token,`/personal-files/${encodeURIComponent(ref.fileId)}/versions`);const version=rows.find(v=>v.version===ref.version);if(!version)fail('材料版本不存在',404);inputs.push({fileId:ref.fileId,...version})}
  const knowledgeBases=Array.isArray(input.knowledgeBases)?[...new Set(input.knowledgeBases.map(String))]:[];const actor=await oa(token,'/smart-case/me');for(const kbId of knowledgeBases)this.knowledge.authorize(kbId,actor.id,'read',actor.permissions);
  const id=randomUUID(),task={id,owner:user.id,oaUserId:user.oaUserId,title:String(input.title||'通用法律任务').slice(0,150),kind,knowledgeBases,caseId:input.caseId||null,caseSnapshot,inputs,outputs:{},status:'PREPARING',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.store.update(data=>{data[id]=task});this.busy.add(id)
  try{const dir=this.directory(id);for(const name of ['materials','drafts','reports'])await mkdir(path.join(dir,'workspace',name),{recursive:true,mode:0o700});
   for(const ref of inputs){const response=await oa(token,`/personal-files/${ref.fileId}/versions/${ref.version}/content`,{raw:true});const name=`${ref.fileId}-v${ref.version}-${path.basename(ref.name).replace(/[\\/]/g,'_')}`;const file=path.join(dir,'workspace/materials',name);await pipeline(response.body,createWriteStream(file,{flags:'wx',mode:0o400}));if(await hashFile(file)!==ref.sha256)fail('材料完整性校验失败',409);ref.localName=name}
   await writeFile(path.join(dir,'workspace/task.json'),JSON.stringify({...task,inputs},null,2),{mode:0o400});this.update(id,{status:'READY',inputs});return this.get(id,user.id)
  }catch(e){this.update(id,{status:'PREPARE_FAILED',error:e.message});throw e}finally{this.busy.delete(id)}
 }
 async manifest(task){const directory=path.join(this.directory(task.id),'workspace'),temp=path.join(directory,'.task-'+randomUUID());await writeFile(temp,JSON.stringify(task,null,2),{flag:'wx',mode:0o400});await rename(temp,path.join(directory,'task.json'))}
 async start(id,user,token){const task=this.get(id,user.id);if(task.status==='PREPARE_FAILED')fail('材料准备未完成，请重新创建任务',409);if(this.busy.has(id))fail('任务操作进行中',409);if(this.runtimes.has(id))return this.get(id,user.id);this.busy.add(id)
  try{await this.validate(task,token);task.aiPolicy=this.aiPolicy.snapshot(task.kind);this.update(id,{aiPolicy:task.aiPolicy});if(task.caseId)task.caseSnapshot=await oa(token,'/smart-case/cases/'+encodeURIComponent(task.caseId));await this.manifest(task);this.update(id,{status:'PREPARING',error:null});
   const broker=await createTaskBroker({task,token,validate:this.validate.bind(this),knowledge:this.knowledge});
   let runtime;try{runtime=await launchIsolatedHarness({dir:this.directory(id),id,publicBase:process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180',brokerSocket:broker.socket,preset:task.aiPolicy?.preset||presets[task.kind],policy:task.aiPolicy})}catch(e){broker.close();throw e};const stopRuntime=runtime.stop;runtime.stop=()=>{stopRuntime();broker.close()};
   try{const w=await harnessRpc(runtime,'workspace/create',{request:{path:runtime.workspacePath||'/workspace'}});if(w.created||w.workspace.title==='workspace')await harnessRpc(runtime,'workspace/rename',{request:{workspaceId:w.workspace.workspaceId,title:personalWorkspaceTitle(user)}});const s=await harnessRpc(runtime,'session/create',{request:{workspaceId:w.workspace.workspaceId,agentPreset:task.aiPolicy?.preset||presets[task.kind]}});this.runtimes.set(id,{...runtime,token});this.update(id,{status:'RUNNING',sessionId:s.sessionId,workspaceId:w.workspace.workspaceId});runtime.child.on('exit',()=>{if(this.runtimes.has(id)){this.runtimes.delete(id);this.update(id,{status:'INTERRUPTED',error:'运行进程退出，已有个人成果保留'})}})}catch(e){runtime.stop();throw e}
   return this.get(id,user.id)
  }catch(e){this.update(id,{status:'FAILED',error:e.message});throw e}finally{this.busy.delete(id)}
 }
 async runtime(id,user,token){const task=this.get(id,user.id);await this.validate(task,token);this.get(id,user.id);const runtime=this.runtimes.get(id);if(!runtime)fail('任务未运行',409);return {...runtime,approvedPreset:task.aiPolicy?.preset||presets[task.kind]}}
 stop(id,owner,reason='用户停止'){this.get(id,owner);const runtime=this.runtimes.get(id);this.runtimes.delete(id);runtime?.stop();this.update(id,{status:'INTERRUPTED',error:reason})}
 async candidates(id,user,token){
  const task=this.get(id,user.id);await this.validate(task,token);const dir=this.directory(id),items=[];
  for await(const entry of outputSnapshots(path.join(dir,'workspace'),dir)){
   const sha256=await hashFile(entry.snapshot),key=entry.relative+':'+sha256;
   items.push({key,name:entry.name,path:entry.relative,size:entry.size,sha256,saved:task.outputs[key]?.status==='SAVED'});
  }
  await this.validate(task,token);this.get(id,user.id);return {items};
 }
 async save(id,user,token,selection){
  this.get(id,user.id);
  if(!Array.isArray(selection)||!selection.length||selection.length>1000||selection.some(k=>typeof k!=='string'||!/^.+:[a-f0-9]{64}$/.test(k)))fail('请先勾选需要保存的成果版本');
  const pending=new Set(selection),paths=new Set(selection.map(k=>k.slice(0,-65)));
  const task=this.get(id,user.id);if(this.busy.has(id))fail('任务操作进行中，请稍后重试',409);this.busy.add(id)
  try{await this.validate(task,token);const dir=this.directory(id);
   for await(const entry of outputSnapshots(path.join(dir,'workspace'),dir,relative=>paths.has(relative))){const {snapshot}=entry,stat={size:entry.size};const sha256=await hashFile(snapshot),key=entry.relative+':'+sha256;if(!pending.has(key))continue;pending.delete(key);let out=this.get(id,user.id).outputs[key];
    try{if(out?.fileId)continue;
     if(!out?.uploadId){const previous=Object.entries(this.get(id,user.id).outputs).filter(([oldKey,value])=>oldKey.startsWith(entry.relative+':')&&value.status==='SAVED').at(-1)?.[1];let target={};if(previous){const access=await oa(token,`/personal-files/${previous.fileId}/access`),versions=await oa(token,`/personal-files/${previous.fileId}/versions`);if(versions[0]?.sha256!==previous.sha256)fail('OA 成果已被更新，请将任务成果另存为新名称后重试',409);target={fileId:previous.fileId,version:access.version,name:access.name}}const upload=await oa(token,'/personal-files/uploads',{method:'POST',body:{name:entry.name,...target,size:stat.size,source:'smart-case:'+id,lineage:task.inputs.map(({fileId,version,sha256})=>({fileId,version,sha256}))}});out={name:entry.name,sha256,uploadId:upload.id,status:'SAVING'};this.store.update(data=>{data[id].outputs[key]=out})}
     const upload=await oa(token,'/personal-files/uploads/'+out.uploadId),handle=await open(snapshot,'r');try{for(let offset=upload.offset;offset<stat.size;offset+=upload.chunkSize){const buffer=Buffer.alloc(Math.min(upload.chunkSize,stat.size-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(bytesRead!==buffer.length)throw Error('成果写入过程中发生变化，请重试');const form=new FormData();form.append('file',new Blob([buffer]),'chunk.bin');await oa(token,`/personal-files/uploads/${out.uploadId}/chunk?offset=${offset}`,{method:'PUT',body:form})}}finally{await handle.close()}
     const saved=await oa(token,`/personal-files/uploads/${out.uploadId}/complete`,{method:'POST',body:{}});this.store.update(data=>{data[id].outputs[key]={...out,fileId:saved.id,version:saved.version,status:'SAVED'}})
    }catch(e){this.store.update(data=>{data[id].outputs[key]={...out,name:entry.name,sha256,status:'SAVE_FAILED',error:e.message}});throw e}finally{await rm(snapshot,{force:true})}
   }if(pending.size)fail('部分成果已变更、删除或仍在写入，请刷新列表后重新勾选；已保存项保留',409);return this.get(id,user.id)
  }finally{this.busy.delete(id)}
 }
 remove(id,owner){
  const task=this.get(id,owner)
  if(this.busy.has(id)||task.status==='PREPARING')fail('任务操作进行中，请稍后再删除',409)
  const runtime=this.runtimes.get(id)
  this.runtimes.delete(id)
  try{runtime?.stop()}catch(error){this.runtimes.set(id,runtime);throw error}
  const deletedAt=new Date().toISOString()
  this.update(id,{status:'DELETED',deletedAt,error:null})
  return {ok:true}
 }
 async monitor(){for(const [id,runtime]of this.runtimes){
  const task=this.store.read()[id]
  try{await this.validate(task,runtime.token)}catch{
   if(this.runtimes.get(id)!==runtime)continue
   this.stop(id,task.owner,'OA 会话或材料授权失效');this.update(id,{status:'REVOKED'});continue
  }
  if(this.runtimes.get(id)!==runtime)continue
  // Generated drafts remain in the task until the owner confirms an exact content hash.
 }}
 close(){for(const runtime of this.runtimes.values())runtime.stop();this.runtimes.clear()}
}
export async function registerTasks(app){
 const tasks=new OaTasks(process.env.DATA_DIR,app.oaKnowledge);app.decorate('oaTasks',tasks)
 app.get('/api/tasks',async req=>({items:tasks.list(req.user.id)}))
 app.post('/api/tasks',async req=>tasks.create(req.user,req.oa.token,req.body))
 app.get('/api/tasks/:id',async req=>tasks.get(req.params.id,req.user.id))
 app.post('/api/tasks/:id/case',async req=>{const task=tasks.get(req.params.id,req.user.id);if(tasks.busy.has(task.id))fail('任务操作进行中',409);tasks.busy.add(task.id);try{const caseSnapshot=req.body.caseId?await oa(req.oa.token,'/smart-case/cases/'+encodeURIComponent(req.body.caseId)):null;if(tasks.runtimes.has(task.id))tasks.stop(task.id,req.user.id,'关联案件已变更，请重新启动以刷新上下文');return tasks.update(task.id,{caseId:req.body.caseId||null,caseSnapshot})}finally{tasks.busy.delete(task.id)}})
 app.post('/api/tasks/:id/start',async req=>tasks.start(req.params.id,req.user,req.oa.token))
 app.post('/api/tasks/:id/delete',async req=>tasks.remove(req.params.id,req.user.id))
 app.post('/api/tasks/:id/stop',async req=>{tasks.stop(req.params.id,req.user.id);return {ok:true}})
 app.get('/api/tasks/:id/outputs',async req=>tasks.candidates(req.params.id,req.user,req.oa.token))
 app.post('/api/tasks/:id/save',async req=>tasks.save(req.params.id,req.user,req.oa.token,req.body?.selection))
 app.post('/api/tasks/:id/archive',async req=>{const task=tasks.get(req.params.id,req.user.id);if(tasks.busy.has(task.id))fail('任务操作进行中',409);tasks.busy.add(task.id);try{await tasks.validate(task,req.oa.token);for(const input of task.inputs){const p=await oa(req.oa.token,`/personal-files/${input.fileId}/publication`);if(!p.canPublish)fail('共享材料没有发布授权，个人成果仍保留',403)}const out=Object.values(task.outputs).find(o=>o.fileId===req.body.fileId&&o.version===req.body.version);if(!out)fail('成果未保存',409);if(!task.caseId)fail('请先关联OA案件');const result=await oa(req.oa.token,'/smart-case/archive',{method:'POST',body:{fileId:out.fileId,version:out.version,caseId:task.caseId}});tasks.store.update(data=>{for(const output of Object.values(data[task.id].outputs))if(output.fileId===out.fileId&&output.version===out.version)output.archives={...output.archives,[task.caseId]:result.caseFileId}});return result}finally{tasks.busy.delete(task.id)}})
 let checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{await tasks.monitor()}finally{checking=false}},2000);timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);tasks.close()})
 return tasks
}
