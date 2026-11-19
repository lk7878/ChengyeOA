import path from 'node:path'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {Store} from './atomic-store.js'
import {oa} from './oa-client.js'

export const catalog=JSON.parse(readFileSync(new URL('../../presets/business.json',import.meta.url),'utf8'))
const byId=new Map(catalog.map(p=>[p.id,p]))
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const empty=()=>({kinds:[],defaultKind:null,exceptions:{}})
function subset(values,choices){
 if(!Array.isArray(values)||values.some(v=>!choices.includes(v)))fail('选项已失效，请刷新')
 return [...new Set(values)].sort()
}
function route(value,policy){
 if(!value)return null
 const result={connection:value.connection,model:value.model}
 policy.connections.resolve(result,policy.localOnly)
 return result
}

export class BusinessPresets{
 constructor(root,knowledge,policy){
  this.store=new Store(path.join(root,'business-presets.json'))
  this.knowledge=knowledge
  this.policy=policy
  if(!this.store.read().versions){
   const existing=Object.keys(new Store(path.join(root,'oa-user-map.json')).read())
   const libraries=knowledge.acl.read(),keys=Object.keys(libraries)
   const recommended=keys.filter(id=>libraries[id].name==='法律法规库')
   this.store.update(s=>{
    s.versions=Object.fromEntries(catalog.map(p=>[p.id,[{...p,version:1,allowed:keys,recommended,primary:null,backup:null}]]))
    s.accounts=Object.fromEntries(existing.map(id=>[id,{kinds:catalog.map(p=>p.id),defaultKind:'general',exceptions:{}}]))
    s.disabled=[];s.audit=[{action:'登记历史使用账号',at:new Date().toISOString(),users:existing}]
   })
  }
  this.recover()
 }
 recover(){
  const pending=this.store.read().pending
  if(!pending)return
  this.knowledge.acl.update(libs=>{for(const [id,change] of Object.entries(pending.libraries)){
   if(libs[id].version===change.version&&digest(libs[id].readers)===digest(change.readers))continue
   if((libs[id].version||0)!==change.version-1)fail('上次保存需核对知识库授权版本',409)
   Object.assign(libs[id],change)
  }})
  this.store.update(s=>{Object.assign(s.accounts,pending.accounts);s.audit.push(pending.event);delete s.pending})
 }
 definition(id,version){
  if(!byId.has(id))fail('历史业务类型待核对，请联系管理员',409)
  const history=this.store.read().versions[id]
  const result=version==null?history.at(-1):history.find(p=>p.version===version)
  if(!result)fail('预设版本不可用',409)
  return result
 }
 account(id){
  const s=this.store.read(),assignment=s.accounts[id]||empty(),libs=this.knowledge.acl.read()
  const readers=Object.keys(libs).filter(k=>libs[k].readers?.includes(id)).sort()
  const revision=digest([assignment,readers,Object.values(s.versions).map(v=>v.at(-1).version),s.disabled,this.policy.view().version,this.policy.connections?.list().active.map(c=>[c.id,c.revision])])
  return {...assignment,readers,revision}
 }
 require(id,kind){
  if(!byId.has(kind))fail('历史业务类型待核对，请联系管理员',409)
  if(!this.account(id).kinds.includes(kind))fail('此办案预设尚未授权或已撤销，请联系管理员',403)
  if(this.store.read().disabled.includes(kind))fail('此预设运行工具已暂停，请联系管理员',409)
 }
 resolve(id,kind,permissions,opts={}){
  const a=opts.assignment||this.account(id)
  if(!a.kinds.includes(kind))fail('此办案预设未获授权',403)
  if(this.store.read().disabled.includes(kind))fail('此预设运行工具已暂停',409)
  const preset=this.definition(kind,opts.version)
  const readable=opts.readers?Object.entries(this.knowledge.acl.read()).filter(([k,v])=>opts.readers.includes(k)||permissions.includes('knowledge.review')&&v.reviewers?.includes(id)).map(([id,v])=>({id,name:v.name})):this.knowledge.libraries(id,permissions)
  const available=readable.filter(k=>preset.tools.includes('knowledge')&&preset.allowed.includes(k.id))
  const policy=this.policy.snapshot(kind),exception=a.exceptions[kind]
  const primary=exception||preset.primary||policy.primary
  const backup=preset.primary?preset.backup:policy.backup
  if(this.policy.connections){
   if(!primary)fail('缺少必需的主模型连接，请先配置',409)
   for(const r of [primary,backup,policy.ocr].filter(Boolean))this.policy.connections.resolve(r,this.policy.localOnly)
  }
  const source=exception?'用户例外':preset.primary||policy.inherit===false?'预设策略':'全所默认'
  return {preset,available,recommended:preset.recommended.filter(k=>available.some(lib=>lib.id===k)),source,
   aiPolicy:{...policy,preset:preset.agent,primary,backup,model:primary?.model||policy.model,fallbackModel:backup?.model||'',network:preset.tools.includes('network')&&policy.network}}
 }
 choices(actor){
  const account=this.account(actor.id)
  const items=catalog.filter(p=>account.kinds.includes(p.id)).map(p=>{
   const def=this.definition(p.id)
   try{const r=this.resolve(actor.id,p.id,actor.permissions);return {id:p.id,name:p.name,hint:p.workflow,version:def.version,model:r.aiPolicy.model,available:r.available,recommended:r.recommended}}
   catch(e){return {id:p.id,name:p.name,hint:p.workflow,version:def.version,error:e.message,available:[],recommended:[]}}
  })
  return {defaultKind:account.defaultKind,items}
 }
 publish(kind,input,actor){
  const current=this.definition(kind)
  if(input.version!==current.version)fail('预设已更新，请刷新',409)
  const next=input.rollback!=null?{...this.definition(kind,input.rollback)}:{...current}
  if(input.rollback==null){
   next.skills=subset(input.skills??current.skills,byId.get(kind).skills)
   next.tools=subset(input.tools??current.tools,byId.get(kind).tools)
   next.allowed=subset(input.allowed,Object.keys(this.knowledge.acl.read()))
   next.recommended=subset(input.recommended,next.allowed)
   next.primary=route(input.primary,this.policy);next.backup=route(input.backup,this.policy)
   if(next.backup&&!next.primary)fail('请先设置预设主模型')
  }
  next.version=current.version+1
  this.store.update(s=>{s.versions[kind].push(next);s.audit.push({action:'发布预设',actor,kind,before:current.version,after:next.version,at:new Date().toISOString()})})
  return next
 }
 prepare(changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>200||new Set(changes.map(c=>c.id)).size!==changes.length)fail('请选择具体账号')
  const accounts={},libs=this.knowledge.acl.read(),libraries={},diff=[]
  for(const c of changes){
   const before=this.account(c.id)
   if(before.revision!==c.revision)fail('授权已变更，请刷新后重新预览',409)
   const kinds=subset(c.kinds,catalog.map(p=>p.id)),defaultKind=kinds.length===1?kinds[0]:c.defaultKind
   if(kinds.length?!kinds.includes(defaultKind):defaultKind!=null)fail('请指定唯一默认预设')
   const exceptions={}
   for(const [k,r] of Object.entries(c.exceptions||{})){
    if(!kinds.includes(k))fail('未分配的预设不能配置例外')
    exceptions[k]=route(r,this.policy)
   }
   const readers=subset(c.readers,Object.keys(libs))
   for(const [k,lib] of Object.entries(libs)){
    if(before.readers.includes(k)===readers.includes(k))continue
    const change=libraries[k]??={version:(lib.version||0)+1,readers:[...lib.readers]}
    change.readers=change.readers.filter(id=>id!==c.id)
    if(readers.includes(k))change.readers.push(c.id)
   }
   accounts[c.id]={kinds,defaultKind,exceptions}
   diff.push({id:c.id,before,after:{...accounts[c.id],readers}})
  }
  return {accounts,libraries,diff,confirmation:digest(diff)}
 }
 save(prepared,confirmation,actor){
  if(confirmation!==prepared.confirmation)fail('请先预览本次变更',409)
  this.store.update(s=>{s.pending={accounts:prepared.accounts,libraries:prepared.libraries,event:{action:'办案授权',actor,diff:prepared.diff,at:new Date().toISOString()}}})
  this.recover()
  return {accounts:Object.keys(prepared.accounts).map(id=>({id,...this.account(id)}))}
 }
}
export function registerPresetRoutes(app,presets){
 const admin=req=>{if(!req.oa.isSystemSuperAdmin)fail('仅 OA 超级管理员可配置办案预设与授权',403)}
 const directory=async req=>{admin(req);return oa(req.oa.token,'/smart-case/directory')}
 app.get('/api/my-presets',async req=>presets.choices(req.oa))
 app.get('/api/business-presets',async req=>{const users=await directory(req),s=presets.store.read()
  return {users:users.map(u=>({...u,account:presets.account(u.id)})),versions:s.versions,components:catalog,disabled:s.disabled,
   libraries:Object.entries(presets.knowledge.acl.read()).map(([id,v])=>({id,name:v.name})),connections:presets.policy.connections.list().active.map(({id,label,models})=>({id,label,models}))}
 })
 app.post('/api/business-presets/:id/publish',async req=>{admin(req);return presets.publish(req.params.id,req.body,req.oa.id)})
 app.post('/api/business-presets/:id/pause',async req=>{admin(req);const id=req.params.id;presets.definition(id)
  if(typeof req.body.disabled!=='boolean')fail('暂停状态无效')
  presets.store.update(s=>{s.disabled=s.disabled.filter(k=>k!==id);if(req.body.disabled)s.disabled.push(id);s.audit.push({action:'工具暂停状态',id,disabled:req.body.disabled,actor:req.oa.id,at:new Date().toISOString()})})
  if(req.body.disabled)for(const [taskId] of app.oaTasks.runtimes){const task=app.oaTasks.store.read()[taskId];if(task.kind===id)app.oaTasks.stop(taskId,task.owner,'预设工具已暂停')}
  return {disabled:presets.store.read().disabled.includes(id)}
 })
 for(const action of ['preview','save'])app.post('/api/business-grants/'+action,async req=>{
  const users=await directory(req),changes=req.body?.changes
  if(!Array.isArray(changes)||changes.some(c=>!users.some(u=>u.id===c.id)))fail('账号不存在或已停用')
  if(changes.some(c=>c.kinds?.length&&users.find(u=>u.id===c.id)?.smartCaseEligible!==true))fail('账号缺少智慧办案使用资格，请先在 OA 授权')
  const p=presets.prepare(changes)
  const effective=p.diff.map(d=>({id:d.id,items:d.after.kinds.map(kind=>{
   const user=users.find(u=>u.id===d.id)
   const r=presets.resolve(d.id,kind,user.canReviewKnowledge?['knowledge.review']:[],{assignment:d.after,readers:d.after.readers})
   return {name:r.preset.name,source:r.source,model:r.aiPolicy.model,available:r.available.map(k=>k.id),recommended:r.recommended}
  })}))
  if(action==='preview')return {confirmation:p.confirmation,diff:p.diff,effective}
  return presets.save(p,req.body.confirmation,req.oa.id)
 })
}
