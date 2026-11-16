import {randomUUID,createHash} from 'node:crypto'
import {mkdir,writeFile,rename,readdir,lstat,open,rm,copyFile} from 'node:fs/promises'
import {createReadStream,createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {Store} from './atomic-store.js'
import {outputSnapshots} from './output-snapshots.js'
import {oa} from './oa-client.js'
import {ManagedAgent} from './managed-agent.js'
const kinds=new Set(['general','disability','injury','malpractice','traffic'])
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
const hashFile=async file=>{const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex')}
export class OaTasks {
 constructor(root,knowledge,policy){this.policy=policy;this.agent=new ManagedAgent(this);this.knowledge=knowledge;this.root=root;this.store=new Store(path.join(root,'tasks.json'));this.runtimes=new Map();this.busy=new Set();this.store.update(data=>{for(const t of Object.values(data))if(['PREPARING','RUNNING'].includes(t.status)){t.status='INTERRUPTED';t.error='服务重启，任务已中断，请重新启动';}})}
 list(owner){return Object.values(this.store.read()).filter(t=>t.owner===owner).map(({token,...t})=>t)}
 get(id,owner){const task=this.store.read()[id];if(!task||task.owner!==owner)fail('任务不存在',404);return task}
 update(id,patch){return this.store.update(data=>Object.assign(data[id],patch,{updatedAt:new Date().toISOString()}))}
 directory(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('任务不存在',404);return path.join(this.root,'executions',id)}
 async actor(token){return oa(token,'/smart-case/me')}
 async validate(task,token){const actor=await this.actor(token);if(actor.id!==task.oaUserId)fail('任务不属于当前账号',403);if(task.policy)this.policy.authorize(task,actor);if(task.caseId)await oa(token,'/smart-case/cases/'+encodeURIComponent(task.caseId));for(const kbId of task.knowledgeBases||[])this.knowledge.authorize(kbId,actor.id,'read',actor.permissions);for(const input of task.inputs){const versions=await oa(token,`/personal-files/${input.fileId}/versions`);const v=versions.find(v=>v.version===input.version);if(!v||v.sha256!==input.sha256)fail('材料版本无效或授权已撤销',403)}}
 async create(user,token,input){
  const kind=input.kind||'general';if(!kinds.has(kind))fail('无效任务类型');if(!Array.isArray(input.inputs)||input.inputs.length>1000)fail('请选择具体材料版本');
  const caseSnapshot=input.caseId?await oa(token,'/smart-case/cases/'+encodeURIComponent(input.caseId)):null;
  const inputs=[];for(const ref of input.inputs){if(typeof ref.fileId!=='string'||!Number.isSafeInteger(ref.version))fail('无效材料引用');const rows=await oa(token,`/personal-files/${encodeURIComponent(ref.fileId)}/versions`);const version=rows.find(v=>v.version===ref.version);if(!version)fail('材料版本不存在',404);inputs.push({fileId:ref.fileId,...version})}
  const knowledgeBases=Array.isArray(input.knowledgeBases)?[...new Set(input.knowledgeBases.map(String))]:[];const actor=await oa(token,'/smart-case/me');for(const kbId of knowledgeBases)this.knowledge.authorize(kbId,actor.id,'read',actor.permissions);
  const policy=this.policy.pin(kind,actor);
  const id=randomUUID(),task={id,policy,owner:user.id,oaUserId:user.oaUserId,title:String(input.title||'通用法律任务').slice(0,150),kind,knowledgeBases,caseId:input.caseId||null,caseSnapshot,inputs,outputs:{},status:'PREPARING',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};this.store.update(data=>{data[id]=task})
  try{const dir=this.directory(id);for(const name of ['materials','drafts','reports'])await mkdir(path.join(dir,'workspace',name),{recursive:true,mode:0o700});
   for(const ref of inputs){const response=await oa(token,`/personal-files/${ref.fileId}/versions/${ref.version}/content`,{raw:true});const name=`${ref.fileId}-v${ref.version}-${path.basename(ref.name).replace(/[\\/]/g,'_')}`;const file=path.join(dir,'workspace/materials',name);await pipeline(response.body,createWriteStream(file,{flags:'wx',mode:0o400}));if(await hashFile(file)!==ref.sha256)fail('材料完整性校验失败',409);ref.localName=name}
   await writeFile(path.join(dir,'workspace/task.json'),JSON.stringify({...task,inputs},null,2),{mode:0o400});this.update(id,{status:'READY',inputs});return this.get(id,user.id)
  }catch(e){this.update(id,{status:'PREPARE_FAILED',error:e.message});throw e}
 }
 async manifest(task){const directory=path.join(this.directory(task.id),'workspace'),temp=path.join(directory,'.task-'+randomUUID());await writeFile(temp,JSON.stringify(task,null,2),{flag:'wx',mode:0o400});await rename(temp,path.join(directory,'task.json'))}
 async start(id,user,token){const task=this.get(id,user.id);if(task.status==='PREPARE_FAILED')fail('材料准备未完成，请重新创建任务',409);if(this.busy.has(id))fail('任务操作进行中',409);if(this.runtimes.has(id))return this.get(id,user.id);this.busy.add(id)
  try{await this.validate(task,token);if(task.caseId)task.caseSnapshot=await oa(token,'/smart-case/cases/'+encodeURIComponent(task.caseId));await this.manifest(task);this.update(id,{status:'PREPARING',error:null});
   if(!task.policy){task.policy=this.policy.pin(task.kind,await this.actor(token));this.update(id,{policy:task.policy});await this.manifest(task)}
   this.policy.authorize(task,await this.actor(token));this.runtimes.set(id,{token,stop:()=>this.agent.cancel(id)});this.update(id,{status:'RUNNING',error:null});
   return this.get(id,user.id)
  }catch(e){this.update(id,{status:'FAILED',error:e.message});throw e}finally{this.busy.delete(id)}
 }
 async runtime(id,user,token){const task=this.get(id,user.id);await this.validate(task,token);const runtime=this.runtimes.get(id);if(!runtime)fail('任务未运行',409);return runtime}
 stop(id,owner,reason='用户停止'){this.get(id,owner);const runtime=this.runtimes.get(id);this.runtimes.delete(id);runtime?.stop();this.update(id,{status:'INTERRUPTED',error:reason})}
 async save(id,user,token){const task=this.get(id,user.id);await this.validate(task,token);if(this.busy.has(id))return this.get(id,user.id);this.busy.add(id)
  try{const dir=this.directory(id);
   for await(const entry of outputSnapshots(path.join(dir,'workspace'),dir)){const {snapshot}=entry,stat={size:entry.size};const sha256=await hashFile(snapshot),key=entry.relative+':'+sha256;let out=this.get(id,user.id).outputs[key];
    try{if(out?.fileId)continue;
     if(!out?.uploadId){const upload=await oa(token,'/personal-files/uploads',{method:'POST',body:{name:entry.name,size:stat.size,source:'smart-case:'+id,lineage:task.inputs.map(({fileId,version,sha256})=>({fileId,version,sha256}))}});out={name:entry.name,sha256,uploadId:upload.id,status:'SAVING'};this.store.update(data=>{data[id].outputs[key]=out})}
     const upload=await oa(token,'/personal-files/uploads/'+out.uploadId),handle=await open(snapshot,'r');try{for(let offset=upload.offset;offset<stat.size;offset+=upload.chunkSize){const buffer=Buffer.alloc(Math.min(upload.chunkSize,stat.size-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(bytesRead!==buffer.length)throw Error('成果写入过程中发生变化，请重试');const form=new FormData();form.append('file',new Blob([buffer]),'chunk.bin');await oa(token,`/personal-files/uploads/${out.uploadId}/chunk?offset=${offset}`,{method:'PUT',body:form})}}finally{await handle.close()}
     const saved=await oa(token,`/personal-files/uploads/${out.uploadId}/complete`,{method:'POST',body:{}});this.store.update(data=>{data[id].outputs[key]={...out,fileId:saved.id,version:saved.version,status:'SAVED'}})
    }catch(e){this.store.update(data=>{data[id].outputs[key]={...out,name:entry.name,sha256,status:'SAVE_FAILED',error:e.message}});throw e}finally{await rm(snapshot,{force:true})}
   }return this.get(id,user.id)
  }finally{this.busy.delete(id)}
 }
 async monitor(){for(const [id,runtime]of this.runtimes){const task=this.store.read()[id];try{await this.validate(task,runtime.token)}catch{this.stop(id,task.owner,'OA 会话或材料授权失效');this.update(id,{status:'REVOKED'});continue}try{await this.save(id,{id:task.owner},runtime.token)}catch(e){this.update(id,{error:'个人成果待保存：'+e.message})}}}
 close(){this.agent.close();for(const runtime of this.runtimes.values())runtime.stop();this.runtimes.clear()}
}
export async function registerTasks(app){
 const tasks=new OaTasks(process.env.DATA_DIR,app.oaKnowledge,app.modelPolicy);app.decorate('oaTasks',tasks)
 app.get('/api/tasks',async req=>({items:tasks.list(req.user.id).map(t=>({...t,workspaceName:(req.user.displayName||req.user.username)+' · '+t.title}))}))
 app.post('/api/tasks',async req=>tasks.create(req.user,req.oa.token,req.body))
 app.get('/api/tasks/:id',async req=>tasks.get(req.params.id,req.user.id))
 app.get('/api/tasks/:id/chat',async req=>tasks.agent.state(tasks.get(req.params.id,req.user.id)))
 app.post('/api/tasks/:id/chat',async req=>{const t=await tasks.start(req.params.id,req.user,req.oa.token);return tasks.agent.send(t,req.oa.token,req.body.text,req.body.stage)})
 app.post('/api/tasks/:id/chat/stop',async req=>{tasks.get(req.params.id,req.user.id);tasks.agent.cancel(req.params.id);return {ok:true}})
 app.get('/api/tasks/:id/outputs/:fileId/:version',async(req,reply)=>{const t=tasks.get(req.params.id,req.user.id);const out=Object.values(t.outputs).find(o=>o.fileId===req.params.fileId&&o.version===Number(req.params.version));if(!out)fail('成果不存在',404);const response=await oa(req.oa.token,`/personal-files/${out.fileId}/versions/${out.version}/content`,{raw:true});reply.header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`).type(response.headers.get('content-type')||'application/octet-stream');return reply.send(response.body)})
 app.post('/api/tasks/:id/case',async req=>{const task=tasks.get(req.params.id,req.user.id);const caseSnapshot=req.body.caseId?await oa(req.oa.token,'/smart-case/cases/'+encodeURIComponent(req.body.caseId)):null;if(tasks.runtimes.has(task.id))tasks.stop(task.id,req.user.id,'关联案件已变更，请重新启动以刷新上下文');return tasks.update(task.id,{caseId:req.body.caseId||null,caseSnapshot})})
 app.post('/api/tasks/:id/start',async req=>tasks.start(req.params.id,req.user,req.oa.token))
 app.post('/api/tasks/:id/stop',async req=>{tasks.stop(req.params.id,req.user.id);return {ok:true}})
 app.post('/api/tasks/:id/save',async req=>tasks.save(req.params.id,req.user,req.oa.token))
 app.post('/api/tasks/:id/archive',async req=>{const task=tasks.get(req.params.id,req.user.id);await tasks.validate(task,req.oa.token);for(const input of task.inputs){const p=await oa(req.oa.token,`/personal-files/${input.fileId}/publication`);if(!p.canPublish)fail('共享材料没有发布授权，个人成果仍保留',403)}const out=Object.values(task.outputs).find(o=>o.fileId===req.body.fileId&&o.version===req.body.version);if(!out)fail('成果未保存',409);if(!task.caseId)fail('请先关联OA案件');const result=await oa(req.oa.token,'/smart-case/archive',{method:'POST',body:{fileId:out.fileId,version:out.version,caseId:task.caseId}});tasks.store.update(data=>{for(const output of Object.values(data[task.id].outputs))if(output.fileId===out.fileId&&output.version===out.version)output.archives={...output.archives,[task.caseId]:result.caseFileId}});return result})
 let checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{await tasks.monitor()}finally{checking=false}},2000);timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);tasks.close()})
 return tasks
}
