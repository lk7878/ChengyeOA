import http from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {oa} from './oa-client.js'
import {installPublicTunnel} from './public-network.js'
export async function createTaskBroker({task,token,validate,knowledge}){
 const dir=await mkdtemp(path.join(tmpdir(),'oa-broker-')),socket=path.join(dir,'api.sock')
 const server=http.createServer(async(req,res)=>{
  const cancel=new AbortController();res.on('close',()=>cancel.abort());
  try{
   await validate(task,token);const user=await oa(token,'/smart-case/me');
   const url=new URL(req.url,'http://task'),match=url.pathname.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/hybrid-search$/)
   if(req.method==='POST'&&url.pathname==='/api/v1/auth/auto-setup'){res.setHeader('content-type','application/json');res.end(JSON.stringify({token:'task-scoped'}));return}
   if(url.pathname==='/clinical/api/v1/plugins/google-search'&&req.method==='GET'){if(task.aiPolicy?.network===false)throw Error('本任务未获准联网');const target=new URL('/api/v1/plugins/google-search',process.env.CHAT_BASE_URL);target.searchParams.set('query',url.searchParams.get('query')||'');target.searchParams.set('num','10');target.searchParams.set('page','1');const r=await fetch(target,{headers:{Authorization:'Bearer '+process.env.CHAT_API_KEY},signal:AbortSignal.timeout(45000)});res.writeHead(r.status,{'content-type':'application/json'});res.end(await r.text());return}
   const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>32*1024*1024)throw Error('单次工具请求过大，请分批解析');parts.push(part)}const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):{}
   if(url.pathname==='/oa/knowledge/search'&&req.method==='POST'){const results=[];for(const kbId of task.knowledgeBases||[]){const found=await knowledge.search(kbId,user.id,user.permissions,body.query);results.push(...found.data.map(row=>({...row,kbId})))}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:results}));return}
   if(match&&req.method==='POST'){
    const requested=decodeURIComponent(match[1]),resolved=Object.entries(knowledge.acl.read()).find(([id,lib])=>id===requested||lib.legacyId===requested)?.[0];
    if(!resolved||!task.knowledgeBases?.includes(resolved))throw Error('此知识库未被选入任务');
    const result=await knowledge.search(resolved,user.id,user.permissions,body.query_text);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return
   }
   const channel=url.pathname.startsWith('/ocr/')?'OCR':(url.pathname.startsWith('/llm/')||url.pathname.startsWith('/clinical/'))?'CHAT':null
   if(channel&&req.method==='POST'&&url.pathname.endsWith('/chat/completions')){
    const base=process.env[channel+'_BASE_URL'],key=process.env[channel+'_API_KEY'];if(!base||!key)throw Error(channel+' 模型服务未配置');
    const approvedModel=channel==='CHAT'?(task.aiPolicy?.model||process.env.CHAT_MODEL):process.env.OCR_MODEL;if(!approvedModel)throw Error('管理员尚未配置模型');
    if(body.model&&body.model!==approvedModel)throw Error('此模型未获本任务批准');
    const requestBody={...body,model:approvedModel};if(task.aiPolicy?.maxTokens){delete requestBody.max_completion_tokens;requestBody.max_tokens=Math.max(1,Math.min(Math.floor(Number(body.max_tokens))||task.aiPolicy.maxTokens,task.aiPolicy.maxTokens))}
    let response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(requestBody),signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(300000)])});if([429,502,503,504].includes(response.status)&&channel==='CHAT'&&task.aiPolicy?.fallbackModel){await response.body?.cancel();response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({...requestBody,model:task.aiPolicy.fallbackModel}),signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(300000)])})}res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});
    if(response.body)for await(const part of response.body){if(res.destroyed)break;res.write(part)}res.end();return
   }
   res.writeHead(404);res.end('工具接口不存在')
  }catch(e){if(res.destroyed)return;if(res.headersSent){res.destroy();return}res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}
 });const closeTunnels=installPublicTunnel(server,async()=>{if(task.aiPolicy?.network===false)throw Error('本任务未获准联网');await validate(task,token)});await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(socket,resolve)})
 return {socket,close(){closeTunnels();server.closeAllConnections();server.close();void rm(dir,{recursive:true,force:true})}}
}
