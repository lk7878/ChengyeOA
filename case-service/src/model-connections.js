import path from 'node:path'
import {openSync,closeSync,writeFileSync,readFileSync,fsyncSync} from 'node:fs'
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import {Readable} from 'node:stream'
import {Store} from './atomic-store.js'

export function invalid(message,statusCode=400){throw Object.assign(new Error(message),{statusCode})}
export function localEndpoint(host){
 if(net.isIP(host)!==4)return false
 const [a,b]=host.split('.').map(Number)
 return a===127||a===10||(a===192&&b===168)||(a===172&&b>=16&&b<=31)
}
function endpoint(base,scope){
 let url
 try{url=new URL(base)}catch{invalid('请输入完整的模型 Base URL')}
 if(url.username||url.password||url.search||url.hash||!['cloud','local'].includes(scope))invalid('模型地址或连接类型无效')
 if(scope==='local'&&(!localEndpoint(url.hostname)||!['http:','https:'].includes(url.protocol)))invalid('内网连接请使用回环或私有 IPv4 地址，可使用 HTTP 或 HTTPS')
 if(scope==='cloud'&&url.protocol!=='https:')invalid('云端连接需要 HTTPS')
 return url.href.replace(/\/+$/,'')
}
const modelName=value=>typeof value==='string'&&/^[\w.:/@+-]{1,180}$/.test(value)
function encryptionKey(file){
 let fd
 try{fd=openSync(file,'wx',0o600)}catch(e){if(e.code!=='EEXIST')throw e}
 if(fd!==undefined){try{writeFileSync(fd,randomBytes(32));fsyncSync(fd)}finally{closeSync(fd)}}
 const value=readFileSync(file)
 if(value.length!==32)throw Error('服务器模型密钥文件无效')
 return value
}
function encrypt(key,plain,id){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(Buffer.from(id))
 const data=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()])
 return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.')
}
function decrypt(key,value,id){
 const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64')),cipher=createDecipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(Buffer.from(id));cipher.setAuthTag(tag)
 return Buffer.concat([cipher.update(data),cipher.final()]).toString()
}
function describe(row){
 const {id,label,base,models,scope,revision,verifiedAt}=row
 return {id,label,base,models,scope,revision,verifiedAt,testedModels:Object.keys(row.tested||{}),authenticated:Boolean(row.secret)}
}
export class ModelConnections {
 constructor(root){
  this.store=new Store(path.join(root,'model-connections.json'))
  this.key=encryptionKey(path.join(root,'model-encryption.key'))
 }
 migrate(catalog,imports=[]){
  if(this.store.read().active)return
  const active={}
  for(const [id,prefix,label] of [['legacy','CHAT','现用对话连接'],['legacy-ocr','OCR','现用 OCR 连接']]){
   const base=process.env[prefix+'_BASE_URL'],model=process.env[prefix+'_MODEL'],key=process.env[prefix+'_API_KEY']
   if(!base||!model)continue
   if(id==='legacy-ocr'&&active.legacy&&base.replace(/\/+$/,'')===active.legacy.base&&key===process.env.CHAT_API_KEY){
    if(!active.legacy.models.includes(model))active.legacy.models.push(model)
    continue
   }
   const scope=localEndpoint(new URL(base).hostname)?'local':'cloud'
   active[id]={id,label,scope,base:base.replace(/\/+$/,''),models:[...new Set(id==='legacy'?[model,...catalog]:[model])],revision:1,secret:key?encrypt(this.key,key,id):null}
  }
  const drafts={}
  for(const entry of imports){
   const url=new URL(entry.base)
   if(url.hostname==='localhost')url.hostname='127.0.0.1'
   const scope=localEndpoint(url.hostname)?'local':'cloud'
   drafts[entry.id]={id:entry.id,label:entry.label,base:endpoint(url.href,scope),scope,models:entry.models,revision:1,secret:entry.key?encrypt(this.key,entry.key,entry.id):null}
  }
  this.store.update(s=>{s.active=active;s.drafts=drafts})
 }
 list(){const state=this.store.read();return {active:Object.values(state.active).map(describe),drafts:Object.values(state.drafts).map(describe)}}
 save(input){
  const {label,scope,models,apiKey,auth}=input||{},base=endpoint(input?.base,scope)
  if(typeof label!=='string'||!label.trim()||label.length>100||!Array.isArray(models)||!models.length||models.length>100||!models.every(modelName)||!['key','none'].includes(auth)||auth==='none'&&scope!=='local')invalid('请检查名称、模型标识和认证方式')
  const id=input.id||randomUUID()
  return this.store.update(s=>{
   const live=s.active[id],old=s.drafts[id]||live
   if(input.id&&!Object.hasOwn(s.active,id)&&!Object.hasOwn(s.drafts,id))invalid('连接不存在',404)
   if((old?.revision||0)!==(input.revision||0))invalid('连接已更新，请刷新',409)
   if(live&&(base!==live.base||scope!==live.scope||live.models.some(m=>!models.includes(m))))invalid('已启用连接需保留地址和模型；更换端点请新增连接')
   if(apiKey!=null&&(typeof apiKey!=='string'||apiKey.length>8192||/[\r\n]/.test(apiKey)))invalid('密钥格式无效')
   const secret=auth==='none'?null:apiKey?encrypt(this.key,apiKey,id):old?.base===base?old.secret:null
   if(auth==='key'&&!secret)invalid('请输入该地址的 API Key')
   const row={id,label:label.trim(),scope,base,models:[...new Set(models)],revision:(old?.revision||0)+1,secret}
   s.drafts[id]=row
   return describe(row)
  })
 }
 async test(id,revision,model){
  const s=this.store.read(),row=s.drafts[id]||s.active[id]
  if(!row||row.revision!==revision||!row.models.includes(model))invalid('模型或连接版本已变更，请刷新',409)
  await probe(this.resolveRow(row,model))
  this.store.update(now=>{
   const current=now.drafts[id]||now.active[id]
   if(current?.revision!==revision)invalid('测试期间连接已更新，请重新测试',409)
   current.tested={...current.tested,[model]:true}
   if(current.models.every(m=>Object.hasOwn(current.tested,m)||now.active[id]?.models.includes(m)))current.verifiedAt=new Date().toISOString()
  })
  return {ok:true}
 }
 enable(id,revision){
  return this.store.update(s=>{
   const row=s.drafts[id]
   if(!row||row.revision!==revision||!row.verifiedAt)invalid('请先测试当前凭据，并测试本次新增的每个模型')
   s.active[id]=row;delete s.drafts[id];return describe(row)
  })
 }
 resolveRow(row,model){
  return {model,scope:row.scope,base:row.base,key:row.secret?decrypt(this.key,row.secret,row.id):''}
 }
 resolve(route,localOnly=false){
  const row=route&&this.store.read().active[route.connection]
  if(!row?.models?.includes(route.model))invalid('所需模型连接尚未启用',503)
  if(localOnly&&(row.scope!=='local'||!localEndpoint(new URL(row.base).hostname)))invalid('纯本地模式下此连接不可用，请管理员配置内网模型',403)
  return this.resolveRow(row,route.model)
 }
}
export function completion(route,body,signal){
 if(route.scope==='local'){
  const url=new URL(route.base+'/chat/completions')
  if(!localEndpoint(url.hostname))invalid('本地模型地址无效')
  return new Promise((resolve,reject)=>{
   const transport=url.protocol==='https:'?https:http
   const request=transport.request(url,{method:'POST',agent:false,signal,headers:{'content-type':'application/json',...(route.key?{Authorization:'Bearer '+route.key}:{})}},response=>{
    if([204,205,304].includes(response.statusCode)){response.resume();resolve(new Response(null,{status:response.statusCode}));return}
    resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:{'content-type':response.headers['content-type']||'application/json'}}))
   })
   request.on('error',reject);request.end(JSON.stringify({...body,model:route.model}))
  })
 }
 return fetch(route.base+'/chat/completions',{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(route.key?{Authorization:'Bearer '+route.key}:{})},body:JSON.stringify({...body,model:route.model}),signal})
}
export async function* sseLines(body){
 const decoder=new TextDecoder();let pending=''
 for await(const chunk of body){
  pending+=decoder.decode(chunk,{stream:true})
  let end
  while((end=pending.indexOf('\n'))>=0){yield pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1)}
  if(pending.length>4*1024*1024)throw Error('模型响应片段过大')
 }
 pending+=decoder.decode();if(pending)yield pending
}
async function probe(route){
 const signal=AbortSignal.timeout(45000)
 try{
  const stream=await completion(route,{stream:true,messages:[{role:'user',content:'Reply only OK.'}],max_tokens:128},signal)
  if(!stream.ok){await stream.body?.cancel();invalid('流式测试失败，服务返回 HTTP '+stream.status,422)}
  let text=false,done=false,size=0
  for await(const line of sseLines(stream.body)){
   if((size+=line.length)>524288)invalid('测试响应超出预期',422)
   if(!line.startsWith('data:'))continue
   const value=line.slice(5).trim();if(value==='[DONE]'){done=true;break}
   const item=JSON.parse(value).choices?.[0]
   if(item?.delta?.content)text=true
   if(item?.finish_reason)done=true
  }
  if(!text||!done)invalid('模型未返回完整流式文本',422)
  const tool={type:'function',function:{name:'oa_ping',description:'Connectivity probe',parameters:{type:'object',properties:{},additionalProperties:false}}}
  const result=await completion(route,{messages:[{role:'user',content:'Call oa_ping once.'}],tools:[tool],tool_choice:{type:'function',function:{name:'oa_ping'}},max_tokens:128},signal)
  if(!result.ok){await result.body?.cancel();invalid('工具测试失败，服务返回 HTTP '+result.status,422)}
  let parts=[],bytes=0
  for await(const part of result.body){bytes+=part.length;if(bytes>524288)invalid('测试响应超出预期',422);parts.push(part)}
  const call=JSON.parse(Buffer.concat(parts)).choices?.[0]?.message?.tool_calls?.[0]
  const args=call?.function?.arguments?JSON.parse(call.function.arguments):null
  if(call?.type!=='function'||call.function.name!=='oa_ping'||!args||Array.isArray(args)||typeof args!=='object')invalid('模型未按要求返回工具调用',422)
 }catch(e){if(e.statusCode)throw e;invalid('模型服务未连通、响应超时或协议不兼容',422)}
}
