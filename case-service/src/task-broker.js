import {runTaskModel} from './task-model.js'
import http from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {oa} from './oa-client.js'
import {installPublicTunnel} from './public-network.js'
export async function createTaskBroker({task,token,validate,knowledge,policy}){
 const dir=await mkdtemp(path.join(tmpdir(),'oa-broker-')),socket=path.join(dir,'api.sock')
 const localOnly=()=>Boolean(task.aiPolicy?.localOnly||policy?.localOnly)
 const requests=new Set()
 const server=http.createServer(async(req,res)=>{
  const cancel=new AbortController();requests.add(cancel);res.on('close',()=>{requests.delete(cancel);cancel.abort()});
  try{
   await validate(task,token);const user=await oa(token,'/smart-case/me');
   const url=new URL(req.url,'http://task'),match=url.pathname.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/hybrid-search$/)
   if(req.method==='POST'&&url.pathname==='/api/v1/auth/auto-setup'){res.setHeader('content-type','application/json');res.end(JSON.stringify({token:'task-scoped'}));return}
   if(url.pathname==='/clinical/api/v1/plugins/google-search'&&req.method==='GET'){if(localOnly()||task.aiPolicy?.network===false)throw Error('本任务未获准联网');const legacy=policy?.connections?.resolve({connection:'legacy',model:process.env.CHAT_MODEL});const target=new URL('/api/v1/plugins/google-search',legacy?.base||process.env.CHAT_BASE_URL);target.searchParams.set('query',url.searchParams.get('query')||'');target.searchParams.set('num','10');target.searchParams.set('page','1');const r=await fetch(target,{headers:{Authorization:'Bearer '+(legacy?.key||process.env.CHAT_API_KEY)},redirect:'error',signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(45000)])});res.writeHead(r.status,{'content-type':'application/json'});res.end(await r.text());return}
   const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>32*1024*1024)throw Error('单次工具请求过大，请分批解析');parts.push(part)}const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):{}
   if(task.businessSnapshot&&(match||url.pathname==='/oa/knowledge/search')&&!task.businessSnapshot.tools.includes('knowledge'))throw Error('此预设未启用知识检索')
   if(localOnly()&&(match||url.pathname==='/oa/knowledge/search')&&!knowledge.searchLocal)throw Error('本地检索未配置')
   const search=(...args)=>localOnly()?knowledge.searchLocal(...args):knowledge.search(...args)
   if(url.pathname==='/oa/knowledge/search'&&req.method==='POST'){const results=[];for(const kbId of task.knowledgeBases||[]){const found=await search(kbId,user.id,user.permissions,body.query,cancel.signal);results.push(...found.data.map(row=>({...row,kbId})))}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:results}));return}
   if(match&&req.method==='POST'){
    const requested=decodeURIComponent(match[1]),resolved=Object.entries(knowledge.acl.read()).find(([id,lib])=>id===requested||lib.legacyId===requested)?.[0];
    if(!resolved||!task.knowledgeBases?.includes(resolved))throw Error('此知识库未被选入任务');
    const result=await search(resolved,user.id,user.permissions,body.query_text,cancel.signal);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return
   }
   const channel=url.pathname.startsWith('/ocr/')?'OCR':(url.pathname.startsWith('/llm/')||url.pathname.startsWith('/clinical/'))?'CHAT':null
   if(channel&&req.method==='POST'&&url.pathname.endsWith('/chat/completions')){
    if(channel==='OCR'&&task.businessSnapshot&&!task.businessSnapshot.tools.includes('ocr'))throw Error('此预设未启用 OCR')
    if(channel==='OCR'&&policy?.connections&&!task.aiPolicy?.ocr)throw Error('本任务尚未配置 OCR 模型')
    await runTaskModel({task,policy,channel,body,localOnly,signal:cancel.signal,res,actor:user});return
   }
   res.writeHead(404);res.end('工具接口不存在')
  }catch(e){if(res.destroyed)return;if(res.headersSent){res.destroy();return}res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}
 });const closeTunnels=installPublicTunnel(server,async()=>{if(localOnly()||task.aiPolicy?.network===false)throw Error('本任务未获准联网');await validate(task,token)});await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(socket,resolve)})
 const restrict=()=>{closeTunnels();for(const request of requests)request.abort()}
 policy?.events.on('restrict',restrict)
 return {socket,close(){policy?.events.off('restrict',restrict);restrict();server.closeAllConnections();server.close();void rm(dir,{recursive:true,force:true})}}
}
