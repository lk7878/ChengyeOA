import http from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {oa} from './oa-client.js'
import {installPublicTunnel} from './public-network.js'
export async function createTaskBroker({task,token,validate,knowledge,policy}){
 if(!policy)throw Object.assign(Error('旧运行通道已停用，请使用受控任务会话'),{statusCode:410});
 const dir=await mkdtemp(path.join(tmpdir(),'oa-broker-')),socket=path.join(dir,'api.sock')
 const server=http.createServer(async(req,res)=>{
  const cancel=new AbortController();res.on('close',()=>cancel.abort());
  try{
   await validate(task,token);const user=await oa(token,'/smart-case/me');
   const url=new URL(req.url,'http://task'),match=url.pathname.match(/^\/api\/v1\/knowledge-bases\/([^/]+)\/hybrid-search$/)
   if(req.method==='POST'&&url.pathname==='/api/v1/auth/auto-setup'){res.setHeader('content-type','application/json');res.end(JSON.stringify({token:'task-scoped'}));return}
   const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>32*1024*1024)throw Error('单次工具请求过大，请分批解析');parts.push(part)}const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):{}
   if(url.pathname==='/oa/knowledge/search'&&req.method==='POST'){const results=[];for(const kbId of task.knowledgeBases||[]){const found=await knowledge.search(kbId,user.id,user.permissions,body.query);results.push(...found.data.map(row=>({...row,kbId})))}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:results}));return}
   if(match&&req.method==='POST'){
    const requested=decodeURIComponent(match[1]),resolved=Object.entries(knowledge.acl.read()).find(([id,lib])=>id===requested||lib.legacyId===requested)?.[0];
    if(!resolved||!task.knowledgeBases?.includes(resolved))throw Error('此知识库未被选入任务');
    const result=await knowledge.search(resolved,user.id,user.permissions,body.query_text);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return
   }
   const channel=url.pathname.startsWith('/ocr/')?'OCR':(url.pathname.startsWith('/llm/')||url.pathname.startsWith('/clinical/'))?'CHAT':null
   if(channel&&req.method==='POST'&&url.pathname.endsWith('/chat/completions')){
    const stage=channel==='OCR'?'ocr':url.pathname.startsWith('/clinical/')?'clinical':'conversation';const route=policy.route(task,user,stage),base=route.connection.baseUrl,key=route.key;
    const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({...body,model:route.model.modelId}),signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(300000)])});res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});
    if(response.body)for await(const part of response.body){if(res.destroyed)break;res.write(part)}res.end();return
   }
   res.writeHead(404);res.end('工具接口不存在')
  }catch(e){if(res.destroyed)return;if(res.headersSent){res.destroy();return}res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}
 });const closeTunnels=installPublicTunnel(server,()=>validate(task,token));await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(socket,resolve)})
 return {socket,close(){closeTunnels();server.closeAllConnections();server.close();void rm(dir,{recursive:true,force:true})}}
}
