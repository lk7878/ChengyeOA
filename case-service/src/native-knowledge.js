import {createReadStream} from 'node:fs'
import {readFile,stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../WeKnora/frontend/dist/',import.meta.url))
const fail=(message,statusCode=403)=>{throw Object.assign(Error(message),{statusCode})}
export async function registerNativeKnowledge(app){
 app.all('/knowledge-native/*',async(req,reply)=>{
  const kb=app.oaKnowledge,actor=req.oa,allowed=kb.libraries(actor.id,actor.permissions).filter(k=>k.canReview)
  if(!actor.isSystemSuperAdmin)fail('知识管理请使用智慧办案统一入口');
  if(!allowed.length)fail('仅已授权知识库审核人可进入原生管理')
  reply.header('Cache-Control','private, no-store')
  const url=new URL(req.url,'http://native');url.pathname=url.pathname.replace(/^\/knowledge-native/,'')
  if(!url.pathname.startsWith('/api/')){
   if(req.method!=='GET')fail('此页面不支持写入',405)
   let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==path.resolve(root)&&!file.startsWith(path.resolve(root)+path.sep))fail('无效路径')
   if(!path.extname(file))file=path.join(root,'index.html')
   const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[path.extname(file)]||'application/octet-stream'
   await stat(file).catch(()=>fail('页面资源不存在',404));reply.type(mime)
   if(file.endsWith('index.html'))return (await readFile(file,'utf8')).replace('</head>','<script defer src="/api/oa/theme.js"></script><style>:root{--td-brand-color:#3370ff;--td-brand-color-active:#245bdb}body{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif} .oa-native-notice{padding:10px 18px;background:#eef4ff;color:#245bdb;font-size:13px;position:fixed;bottom:0;left:0;right:0;z-index:10000}</style></head>').replace('</body>','<div class="oa-native-notice">知识库原生管理 · 新建或修改知识正文请通过工作台投稿审核；本页支持原文、分块、索引查看及重新解析。<a href="/wb/">返回工作台</a></div></body>')
   return reply.send(createReadStream(file))
  }
  const route=url.pathname.replace(/^\/api\/v1/,'')
  const principal={user:{id:actor.id,username:actor.username,email:'oa-user@local.invalid',tenant_id:1,is_active:true,is_system_admin:false,can_access_all_tenants:false},tenant:{id:1,name:'OA 授权知识空间',status:'active'},memberships:[{tenant_id:1,tenant_name:'OA 授权知识空间',role:'viewer'}]}
  if(route==='/auth/auto-setup'&&req.method==='POST')return {success:true,...principal,active_tenant:principal.tenant,token:'oa-session',refresh_token:'oa-session'}
  if(route==='/auth/me'&&req.method==='GET')return {success:true,data:{...principal,tenant_required:false,capabilities:{can_create_tenant:false}}}
  if(route==='/auth/refresh'&&req.method==='POST')return {success:true,access_token:'oa-session',refresh_token:'oa-session'}
  if(req.method==='GET'&&['/user/favorites','/organizations','/shared-knowledge-bases','/agents','/web-search-providers','/shared-agents','/im-channels','/embed-channels','/sessions'].includes(route))return {success:true,data:[],total:0}
  if(req.method==='GET'&&route==='/me/invitations/pending-count')return {success:true,data:{count:0}}
  if(req.method==='GET'&&route==='/tenants/kv/retrieval-config')return {success:true,data:{}}
  if(route==='/knowledge-bases'&&req.method==='GET'){const data=[];for(const lib of allowed){const result=await kb.native('/knowledge-bases/'+lib.id);data.push(result.data)}return {success:true,data}}
  if(['/system/info','/system/capabilities'].includes(route)&&req.method==='GET')return kb.native(route)
  if(route==='/models'&&req.method==='GET')return {success:true,data:[]}
  const library=route.match(/^\/knowledge-bases\/([a-f0-9-]{36})(?:\/(.*))?$/)
  if(library){kb.authorize(library[1],actor.id,'review',actor.permissions);if(req.method==='GET'&&['','knowledge','knowledge/folders','tags','activity','stats'].includes(library[2]||''))return kb.native(route+url.search);fail('请从工作台提交知识变更，审核并索引成功后发布',409)}
  if(!['GET','HEAD'].includes(req.method))fail('知识发布与索引由统一管理入口控制');
  const item=route.match(/^\/(knowledge|chunks)\/([a-f0-9-]{36})(?:\/(.*))?$/)
  if(item){const result=await kb.native('/knowledge/'+item[2]),knowledge=result.data||result;kb.authorize(knowledge.knowledge_base_id,actor.id,'review',actor.permissions)
   if(req.method==='GET'&&item[1]==='knowledge'&&item[3]==='download'){const response=await fetch(process.env.WEKNORA_BASE+'/api/v1'+route,{headers:{'X-API-Key':process.env.WEKNORA_API_KEY},signal:AbortSignal.timeout(120000)});if(!response.ok)fail('原文下载失败',502);reply.type(response.headers.get('content-type')||'application/octet-stream');reply.header('Content-Disposition','attachment');return reply.send(response.body)}
   if(req.method==='GET'&&(!item[3]||['stages','spans'].includes(item[3])||item[1]==='chunks'))return kb.native(route+url.search)
   if(item[1]==='knowledge'&&req.method==='POST'&&item[3]==='reparse'){
    // Remove visibility before any re-indexing starts. A reviewer must publish again.
    kb.store.update(data=>{for(const row of Object.values(data))if(row.nativeId===item[2]){row.status='INDEXING';row.revision=(row.revision||0)+1;row.reindexedBy=actor.id;row.reindexedAt=new Date().toISOString()}})
    return kb.native(route,{method:'POST',body:req.body||{}})
   }
   if(item[1]==='knowledge'&&req.method==='DELETE'&&!item[3]){kb.store.update(data=>{for(const row of Object.values(data))if(row.nativeId===item[2]){row.status='WITHDRAWN';row.revision=(row.revision||0)+1;row.withdrawnBy=actor.id;row.withdrawnAt=new Date().toISOString()}});return kb.native(route,{method:'DELETE'})}
  }
  fail('此原生功能未开放，请通过 OA 工作台管理授权和投稿')
 })
}
