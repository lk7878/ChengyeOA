import { randomBytes,createHash } from 'node:crypto'
import path from 'node:path'
import {readFile} from 'node:fs/promises'
import { Store } from './atomic-store.js'
import { oa } from './oa-client.js'
const parseCookie=value=>Object.fromEntries(String(value||'').split(';').map(s=>s.trim().split(/=(.*)/s)).filter(p=>p.length>=2).map(([k,v])=>[k,v]))
const sha=value=>createHash('sha256').update(value).digest('hex')
const cookie=(name,value,age=28800)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`
function oaReturnOrigin(requested){
 const configured=new URL(process.env.OA_PUBLIC_URL||'http://127.0.0.1:3000')
 const allowed=new Set([configured.origin])
 for(const host of ['localhost','127.0.0.1']){const alt=new URL(configured.href);alt.hostname=host;allowed.add(alt.origin)}
 for(const item of String(process.env.OA_ALLOWED_ORIGINS||'').split(',')){const value=item.trim();if(!value)continue;try{allowed.add(new URL(value).origin)}catch{}}
 if(typeof requested==='string'&&requested){let origin;try{origin=new URL(requested).origin}catch{throw Object.assign(Error('返回地址无效'),{statusCode:400})}if(!allowed.has(origin))throw Object.assign(Error('返回地址不允许'),{statusCode:400});return origin}
 return configured.origin
}
export async function registerOa(app){
 const store=new Store(path.join(process.env.DATA_DIR,'oa-sessions.json'))
 const mappings=new Store(path.join(process.env.DATA_DIR,'oa-user-map.json'))
 const allowedOrigin=new URL(process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180').origin
 const authenticate=async headers=>{
  const token=parseCookie(headers.cookie).oa_sid,session=token&&store.read()[sha(token)];
  if(!session||session.expiresAt<=Date.now())throw Object.assign(Error('请从 OA 登录'),{statusCode:401});
  const current=await oa(session.token,'/smart-case/me');
  const id=mappings.update(data=>data[current.id]??=('oa-'+current.id));
  return {oa:{token:session.token,...current},user:{id,oaUserId:current.id,appearance:current.appearance,username:current.username,displayName:current.displayName,isSystemSuperAdmin:current.isSystemSuperAdmin,status:'active',roles:current.permissions.includes('knowledge.review')?['public_admin']:['case_owner']}}
 }
 app.decorate('oaAuthenticate',authenticate)
 app.addHook('preHandler',async(req,reply)=>{
  const p=req.url.split('?')[0]
  if(req.method==='OPTIONS')return
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin&&req.headers.origin!==allowedOrigin)return reply.code(403).send({error:'来源不允许'})
  if(req.method==='POST'&&['/api/auth/logout','/api/oa/logout'].includes(p)){
   if(req.headers.origin!==allowedOrigin)return reply.code(403).send({error:'来源不允许'})
   return
  }
  if(p==='/api/health'||p.startsWith('/api/auth/start')||p==='/api/auth/oa/callback')return
  try{const auth=await authenticate(req.headers);req.oa=auth.oa;req.user=auth.user}catch(error){return reply.code(error.statusCode===403?403:401).send({error:'OA 会话失效或权限已撤销'})}
  // These legacy paths expose shared runtimes/passwords or bypass OA authoritative files.
  if(/^\/api\/(accounts|sharing-groups|ai\/visible-sessions|go\/|knowledge-bases|knowledge\/)/.test(p)||p==='/api/auth/login'||/\/cases\/[^/]+\/(session|materials|raw|preview|session-files|files|export-word)(\/|$)/.test(p))return reply.code(410).send({error:'此旧接口已停用，请使用 OA 授权任务和知识投稿'})
 })
 app.get('/api/oa/theme.js',async(_req,reply)=>{reply.type('application/javascript').header('Cache-Control','private, no-store');return readFile(new URL('../../work_ui/public/oa-theme.js',import.meta.url),'utf8')})
 app.get('/api/auth/start',async(req,reply)=>{
  let origin;try{origin=oaReturnOrigin(req.query.return)}catch(error){return reply.code(error.statusCode||400).send({error:error.message})}
  const verifier=randomBytes(32).toString('hex');const caseId=typeof req.query.caseId==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(req.query.caseId)?req.query.caseId:'';reply.header('set-cookie',[cookie('oa_login',verifier,120),cookie('oa_case',caseId,120)])
  reply.header('Cache-Control','private, no-store');reply.header('Referrer-Policy','no-referrer')
  if(req.query.response==='json')return {challenge:sha(verifier)}
  const url=new URL('/smart-case',origin);url.searchParams.set('challenge',sha(verifier));return reply.redirect(url.href)
 })
 app.get('/api/auth/oa/callback',async(req,reply)=>{
  const verifier=parseCookie(req.headers.cookie).oa_login
  if(!verifier)return reply.code(400).send({error:'登录校验已过期，请重新从 OA 进入'})
  const result=await oa(null,'/smart-case/exchange',{method:'POST',body:{code:req.query.code,verifier},headers:{'x-smart-case-client':process.env.SMART_CASE_CLIENT_SECRET||''}})
  await oa(result.token,'/smart-case/me')
  const token=randomBytes(32).toString('base64url')
  store.update(data=>{for(const [k,v]of Object.entries(data))if(v.expiresAt<Date.now())delete data[k];data[sha(token)]={token:result.token,expiresAt:Date.now()+result.expiresIn*1000}})
  reply.header('set-cookie',[cookie('oa_sid',token),cookie('oa_login','',0)]);reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');const caseId=parseCookie(req.headers.cookie).oa_case;const home=new URL(process.env.WORKBENCH_HOME||'/','http://local');if(caseId)home.searchParams.set('caseId',caseId);return reply.redirect(home.pathname+home.search)
 })
 app.decorate('oaLogout',async(req,reply)=>{
  const sid=parseCookie(req.headers.cookie).oa_sid,session=sid&&store.read()[sha(sid)];
  // Revoke even expired/permission-revoked sessions. A network/storage failure
  // must remain retryable; never tell the UI it logged out while the token lives.
  if(session)await oa(session.token,'/smart-case/logout',{method:'POST',body:{}})
  if(sid)store.update(data=>delete data[sha(sid)])
  reply.header('set-cookie',[cookie('oa_sid','',0),cookie('oa_login','',0),cookie('oa_case','',0)])
  reply.header('Cache-Control','no-store');return {ok:true}
 })
 app.post('/api/oa/logout',async(req,reply)=>app.oaLogout(req,reply))
 app.get('/api/oa/files',async req=>oa(req.oa.token,'/personal-files?'+new URLSearchParams(req.query)))
 app.get('/api/oa/files/:id/versions',async req=>oa(req.oa.token,`/personal-files/${encodeURIComponent(req.params.id)}/versions`))
 app.get('/api/oa/cases',async req=>oa(req.oa.token,'/smart-case/cases'))
}
