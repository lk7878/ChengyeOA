import {randomUUID,createHash} from 'node:crypto'
import {createWriteStream,createReadStream} from 'node:fs'
import {mkdir,rename,rm,writeFile,readFile} from 'node:fs/promises'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {Store} from './atomic-store.js'
import {oa} from './oa-client.js'
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const hashFile=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex')}
export class TaskUploads {
 constructor(tasks,request=oa){this.tasks=tasks;this.request=request;this.active=new Set();this.store=new Store(path.join(tasks.root,'task-uploads.json'))}
 async prune(){
  for(const row of Object.values(this.store.read())){
   if(!row.staged||row.saved||row.oaId||this.active.has(row.id)||this.tasks.busy.has(row.taskId))continue
   if(!row.cancelled&&Date.now()-(row.updatedAt||row.createdAt||Date.now())<24*60*60*1000)continue
   this.store.update(d=>{d[row.id].cancelled=true})
   await rm(path.join(this.tasks.root,'upload-staging',row.id),{recursive:true,force:true})
  }
 }
 async authorize(id,user,token){const task=this.tasks.get(id,user.id);await this.tasks.validate(task,token);return this.tasks.get(id,user.id)}
 async create(id,user,token,body){
  const task=await this.authorize(id,user,token)
  await this.prune()
  if(task.inputs.length>=1000)fail('任务材料已达到上限')
  if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>200||/[\\/\x00-\x1f]/.test(body.name)||!Number.isSafeInteger(body.size)||body.size<0)fail('文件名称或大小无效')
  if(body.size>512*1024*1024)fail('单份材料超过 512 MB，请拆分上传')
  const uploadId=randomUUID();await mkdir(path.join(this.tasks.root,'upload-staging',uploadId),{recursive:true,mode:0o700});this.store.update(d=>{d[uploadId]={id:uploadId,taskId:id,owner:user.id,staged:true,createdAt:Date.now(),updatedAt:Date.now(),offset:0,name:body.name,size:body.size}})
  return {id:uploadId}
 }
 async get(id,uploadId,user,token){await this.authorize(id,user,token);const row=this.store.read()[uploadId];if(!row||row.cancelled||row.owner!==user.id||row.taskId!==id)fail('上传记录不存在',404);return row}
 async status(id,uploadId,user,token){const row=await this.get(id,uploadId,user,token),s=row.staged?{offset:row.offset,chunkSize:4*1024*1024}:await this.request(token,'/personal-files/uploads/'+row.oaId);return {id:uploadId,offset:s.offset,chunkSize:s.chunkSize,total:row.size}}
 async chunk(id,uploadId,user,token,offset,bytes){
  if(this.active.has(uploadId)||this.tasks.busy.has(id))fail('上传正在处理，请稍后重试',409)
  this.active.add(uploadId)
  try{
  const row=await this.get(id,uploadId,user,token)
  if(!Number.isSafeInteger(offset)||offset<0||!Buffer.isBuffer(bytes)||bytes.length>4*1024*1024)fail('上传分片无效')
  if(row.staged){if(offset!==row.offset||offset+bytes.length>row.size)fail('上传进度已变化，请重试',409);const dir=path.join(this.tasks.root,'upload-staging',uploadId);await writeFile(path.join(dir,String(offset)),bytes,{mode:0o600});this.store.update(d=>{if(d[uploadId].cancelled)fail('上传已取消',409);d[uploadId].offset=offset+bytes.length;d[uploadId].updatedAt=Date.now()});return {offset:offset+bytes.length}}
  const form=new FormData();form.append('file',new Blob([bytes]),'chunk.bin')
  return this.request(token,`/personal-files/uploads/${row.oaId}/chunk?offset=${offset}`,{method:'PUT',body:form})
  }finally{this.active.delete(uploadId)}
 }
 async cancel(id,uploadId,user,token){
  const row=await this.get(id,uploadId,user,token)
  if(this.active.has(uploadId))fail('分片正在保存，请稍后取消',409)
  if(this.tasks.busy.has(id)||row.saved||row.oaId)fail('已进入 OA 保存阶段，请完成后从任务移除',409)
  this.store.update(d=>{d[uploadId].cancelled=true});await rm(path.join(this.tasks.root,'upload-staging',uploadId),{recursive:true,force:true});return {ok:true}
 }
 async complete(id,uploadId,user,token){
  const row=await this.get(id,uploadId,user,token)
  if(this.tasks.busy.has(id)||this.active.has(uploadId))fail('任务正在处理，请稍后重试',409)
  this.tasks.busy.add(id);let temp
  try{
   if(row.staged&&!row.saved){
    if(row.offset!==row.size)fail('文件尚未上传完整',409)
    if(!row.oaId){row.oaId=(await this.request(token,'/personal-files/uploads',{method:'POST',body:{name:row.name,size:row.size,source:'smart-case-upload:'+id}})).id;this.store.update(d=>{d[uploadId].oaId=row.oaId})}
    const remote=await this.request(token,'/personal-files/uploads/'+row.oaId)
    for(let offset=remote.offset;offset<row.size;offset+=4*1024*1024){const bytes=await readFile(path.join(this.tasks.root,'upload-staging',uploadId,String(offset)));const form=new FormData();form.append('file',new Blob([bytes]),'chunk.bin');await this.request(token,`/personal-files/uploads/${row.oaId}/chunk?offset=${offset}`,{method:'PUT',body:form})}
   }
   const saved=row.saved||await this.request(token,`/personal-files/uploads/${row.oaId}/complete`,{method:'POST',body:{}})
   this.store.update(d=>{d[uploadId].saved=saved}) // Retry attachment without uploading a second OA file.
   const task=await this.authorize(id,user,token),existing=task.inputs.find(v=>v.fileId===saved.id&&v.version===saved.version)
   if(existing){await this.tasks.materialContext(task);await rm(path.join(this.tasks.root,'upload-staging',uploadId),{recursive:true,force:true});return {fileId:saved.id,version:saved.version,name:existing.name,path:'/workspace/materials/'+existing.localName}}
   if(task.inputs.length>=1000)fail('文件已保存到 OA，但任务材料已达到上限',409)
   const versions=await this.request(token,`/personal-files/${saved.id}/versions`),version=versions.find(v=>v.version===saved.version)
   if(!version)fail('文件已保存到 OA，但读取版本失败，请重试',409)
   const dir=this.tasks.directory(id),localName=`${saved.id}-v${saved.version}-${Array.from(version.name.replace(/[\\/\x00-\x1f]/g,'_')).slice(0,48).join('')}`
   await mkdir(path.join(dir,'workspace/materials'),{recursive:true,mode:0o700})
   temp=path.join(dir,'.upload-'+randomUUID())
   const response=await this.request(token,`/personal-files/${saved.id}/versions/${saved.version}/content`,{raw:true})
   await pipeline(response.body,createWriteStream(temp,{flags:'wx',mode:0o400}))
   if(await hashFile(temp)!==version.sha256)fail('材料校验失败，OA 文件保留，请重试',409)
   await this.authorize(id,user,token)
   const latest=await this.request(token,`/personal-files/${saved.id}/versions`)
   if(!latest.some(v=>v.version===saved.version&&v.sha256===version.sha256))fail('文件授权或版本已变化',403)
   await rename(temp,path.join(dir,'workspace/materials',localName));temp=null
   const updated=this.tasks.update(id,{inputs:[...this.tasks.get(id,user.id).inputs,{fileId:saved.id,...version,localName}]})
   await this.tasks.materialContext(updated)
   this.tasks.materials?.ensure(updated,token)
   await rm(path.join(this.tasks.root,'upload-staging',uploadId),{recursive:true,force:true})
   return {fileId:saved.id,version:saved.version,name:version.name,path:'/workspace/materials/'+localName}
  }finally{if(temp)await rm(temp,{force:true});this.tasks.busy.delete(id)}
 }
}
export async function registerTaskUploads(app,{request=oa}={}){
 const uploads=new TaskUploads(app.oaTasks,request)
 await app.register(async routes=>{
  routes.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:4*1024*1024},(_req,body,done)=>done(null,body))
  routes.post('/api/tasks/:id/material-uploads',async r=>uploads.create(r.params.id,r.user,r.oa.token,r.body))
  routes.delete('/api/tasks/:id/material-uploads/:uploadId',async r=>uploads.cancel(r.params.id,r.params.uploadId,r.user,r.oa.token))
  routes.get('/api/tasks/:id/material-uploads/:uploadId',async r=>uploads.status(r.params.id,r.params.uploadId,r.user,r.oa.token))
  routes.put('/api/tasks/:id/material-uploads/:uploadId/chunk',{bodyLimit:4*1024*1024},async r=>uploads.chunk(r.params.id,r.params.uploadId,r.user,r.oa.token,Number(r.query.offset),r.body))
  routes.post('/api/tasks/:id/material-uploads/:uploadId/complete',async r=>uploads.complete(r.params.id,r.params.uploadId,r.user,r.oa.token))
 })
}
