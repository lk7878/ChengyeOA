import {meteredCompletion} from './metered-model.js'
import {randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {sseLines} from './model-connections.js'

export async function runTaskModel({task,policy,channel,body,signal,localOnly,res,actor}){
 const snapshot=task.aiPolicy||{},registry=policy?.connections
 const selected=channel==='CHAT'?snapshot.primary:snapshot.ocr
 const model=selected?.model||(channel==='CHAT'?snapshot.model:undefined)||process.env[channel+'_MODEL']
 if((channel==='CHAT'||!registry)&&body.model&&body.model!==model)throw Error('此模型未获本任务批准')
 if(!model)throw Error('管理员尚未配置本任务所需模型')
 const route=(choice)=>{
  if(registry)return registry.resolve(choice,localOnly())
  const base=process.env[channel+'_BASE_URL'],key=process.env[channel+'_API_KEY']
  if(!base||!key||localOnly())throw Error('所需模型服务未配置')
  return {base:base.replace(/\/$/,''),key,model:choice.model}
 }
 const primary=route(selected||{connection:channel==='CHAT'?'legacy':'legacy-ocr',model})
 const backup=channel==='CHAT'&&(snapshot.backup||(snapshot.fallbackModel?{connection:'legacy',model:snapshot.fallbackModel}:null))
 const payload={...body}
 if(snapshot.maxTokens){
  delete payload.max_completion_tokens
  payload.max_tokens=Math.max(1,Math.min(Math.floor(Number(body.max_tokens))||snapshot.maxTokens,snapshot.maxTokens))
 }
 const requestId=randomUUID();let attempt=0
 const send=(target,choice)=>meteredCompletion({billing:policy?.billing,context:{task,actor,requestId,attempt:++attempt,connection:choice?.connection||(channel==='CHAT'?'legacy':'legacy-ocr'),connectionLabel:registry?.list().active.find(c=>c.id===choice?.connection)?.label,model:target.model,purpose:channel},route:target,body:payload,signal:AbortSignal.any([signal,AbortSignal.timeout(300000)])})
 const drainError=async(response)=>{if(!response?.body)return;try{let bytes=0;for await(const part of response.body){bytes+=part.length;if(bytes>1024*1024)break}}catch{/* Missing usage stays pending. */}}
 let response,usedBackup=false
 try{response=await send(primary,selected)}catch{if(!backup||signal.aborted)throw Error(localOnly()?'内网模型不可用，请联系管理员':'模型连接不可用')}
 if(backup&&(!response||[429,502,503,504].includes(response.status))){
  await drainError(response);signal.throwIfAborted()
  response=await send(route(backup),backup);usedBackup=true
 }
 if(!response.ok&&registry){await drainError(response);throw Error((localOnly()?'内网模型':'模型服务')+'返回 HTTP '+response.status)}
 try {
 const type=response.headers.get('content-type')||'application/json'
 res.writeHead(response.status,{'content-type':type})
 const write=async chunk=>{if(!res.write(chunk))await once(res,'drain',{signal})}
 if(usedBackup&&response.ok){
  const label='〔备用模型：'+backup.model+'〕\n\n'
  if(type.includes('text/event-stream')){
   let marked=false
   for await(const line of sseLines(response.body)){
    let out=line
    if(!marked&&line.startsWith('data:')&&line.slice(5).trim()!=='[DONE]'){
     const frame=JSON.parse(line.slice(5)),delta=frame.choices?.[0]?.delta
     if(delta&&(delta.content||delta.tool_calls?.length)){delta.content=label+(delta.content||'');marked=true;out='data: '+JSON.stringify(frame)}
    }
    await write(out+'\n')
   }
  }else{
   const data=await response.json()
   for(const choice of data.choices||[])if(choice.message)choice.message.content=label+(choice.message.content||'')
   await write(JSON.stringify(data))
  }
 }else if(response.body)for await(const part of response.body)await write(part)
 res.end()
 } finally {if(!response.bodyUsed)await response.body?.cancel()}
}
