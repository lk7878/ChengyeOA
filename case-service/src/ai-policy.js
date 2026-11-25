import {readFile} from 'node:fs/promises'
import {recognizeImage} from './material-processing.js'
import {EventEmitter} from 'node:events'
import {ModelConnections,invalid} from './model-connections.js'
import path from 'node:path'
import {Store} from './atomic-store.js'
import {catalog} from './business-presets.js'
export const taskPresets=Object.fromEntries(catalog.map(p=>[p.id,p.runtime]))
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
export class AiPolicy {
 constructor(root,models=()=>[process.env.CHAT_MODEL].filter(Boolean),connections){this.connections=connections;this.events=new EventEmitter();this.events.setMaxListeners(0);this.store=new Store(path.join(root,'ai-capabilities.json'));this.models=models}
 baseline(){return Object.fromEntries(Object.entries(taskPresets).map(([kind,preset])=>[kind,{preset,model:process.env.CHAT_MODEL||'',fallbackModel:'',network:true,maxTokens:32768}]))}
 defaults(){
  const model=process.env.CHAT_MODEL||''
  return {primary:model?{connection:'legacy',model}:null,backup:null,ocr:process.env.OCR_MODEL?{connection:this.connections&&!this.connections.store.read().active?.['legacy-ocr']?'legacy':'legacy-ocr',model:process.env.OCR_MODEL}:null,localOnly:false}
 }
 normalize(policies,defaults){
  for(const p of Object.values(policies)){
   if(p.inherit!==undefined)continue
   p.primary=p.model?{connection:'legacy',model:p.model}:null
   p.backup=p.fallbackModel?{connection:'legacy',model:p.fallbackModel}:null
   p.inherit=p.model===defaults.primary?.model&&!p.backup
  }
  return policies
 }
 migrate(){
  if(this.store.read().defaults)return
  this.store.update(s=>{
   s.defaults=this.defaults()
   s.policies=this.normalize(s.policies||this.baseline(),s.defaults)
   for(const entry of s.history||[]){entry.defaults=s.defaults;this.normalize(entry.policies,entry.defaults)}
  })
 }
 view(){
  const state=this.store.read(),defaults=state.defaults||this.defaults(),policies=state.policies||this.baseline()
  return {version:state.version||0,policies,defaults,models:this.models(),presets:[...new Set(Object.values(taskPresets))],history:state.history||[]}
 }
 get localOnly(){return this.store.read().defaults?.localOnly===true}
 validateRouting(input){
  const {defaults,policies}=input||{}
  if(!defaults||typeof defaults.localOnly!=='boolean'||!policies||Object.keys(policies).sort().join()!==Object.keys(taskPresets).sort().join())invalid('任务配置不完整')
  const route=(value,required=false)=>{
   if(!value&&!required)return null
   if(!value||typeof value.connection!=='string'||typeof value.model!=='string')invalid('请选择已启用的连接和模型')
   this.connections.resolve(value,defaults.localOnly)
   return {connection:value.connection,model:value.model}
  }
  const checked={primary:route(defaults.primary,true),backup:route(defaults.backup),ocr:route(defaults.ocr),ocrBackup:route(defaults.ocrBackup),localOnly:defaults.localOnly}
  const clean={}
  for(const [kind,p] of Object.entries(policies)){
   if(!p||typeof p.inherit!=='boolean'||p.preset!==taskPresets[kind]||typeof p.network!=='boolean'||!Number.isSafeInteger(p.maxTokens)||p.maxTokens<1024||p.maxTokens>65536)invalid('任务参数无效')
   const primary=p.inherit?checked.primary:route(p.primary,true),backup=p.inherit?checked.backup:route(p.backup)
   clean[kind]={inherit:p.inherit,primary,backup,model:primary.model,fallbackModel:backup?.model||'',network:p.network,preset:p.preset,maxTokens:p.maxTokens}
  }
  return {defaults:checked,policies:clean}
 }
  validate(policies){
  if(!policies||Object.keys(policies).sort().join()!==Object.keys(taskPresets).sort().join())fail('请配置全部任务类型')
  for(const p of Object.values(policies)){
   if(!p||Object.keys(p).some(k=>!['preset','model','fallbackModel','network','maxTokens'].includes(k))||!Object.values(taskPresets).includes(p.preset)||!this.models().includes(p.model)||
    (typeof p.fallbackModel!=='string'||(p.fallbackModel&&!this.models().includes(p.fallbackModel)))||typeof p.network!=='boolean'||!Number.isSafeInteger(p.maxTokens)||p.maxTokens<1024||p.maxTokens>65536)fail('能力配置无效，只能使用已部署的模型和 Skills / 工具组合')
  }
  return structuredClone(policies)
 }
 publish(input,actor){if(!input||typeof input!=='object')fail('配置格式无效');const {version,policies}=input;const config=this.connections?this.validateRouting(input):{policies:this.validate(policies)};const result=this.store.update(s=>{if(version!==(s.version||0))fail('配置已更新，请刷新后重试',409);const previous={version:s.version||0,policies:this.view().policies,defaults:s.defaults||this.defaults(),publishedBy:s.publishedBy,publishedAt:s.publishedAt};s.history=[...(s.history||[]),previous];s.version=(s.version||0)+1;Object.assign(s,config);s.publishedBy=actor;s.publishedAt=new Date().toISOString();return this.viewState(s)});if(config.defaults?.localOnly)this.events.emit('restrict');return result}
 viewState(s){return {version:s.version,policies:s.policies,publishedAt:s.publishedAt}}
 snapshot(kind){const s=this.view();if(!s.policies[kind])fail('任务类型未配置');const p=structuredClone(s.policies[kind]);return {version:s.version,...p,...(this.connections?{ocr:s.defaults.ocr,ocrBackup:s.defaults.ocrBackup,localOnly:s.defaults.localOnly}:{})}}
}
export async function registerAiPolicy(app,models,managed=false,imports=[]){
 const connections=managed?new ModelConnections(process.env.DATA_DIR):null
 if(connections)connections.migrate(models(),imports)
 const policy=new AiPolicy(process.env.DATA_DIR,models,connections);if(connections)policy.migrate();app.decorate('aiPolicy',policy)
 const guard=req=>{if(req.user?.isSystemSuperAdmin!==true)fail('仅 OA 超级管理员可配置 AI 能力',403)}
 if(connections){
  app.get('/api/model-connections',async req=>{guard(req);return connections.list()})
  app.post('/api/model-connections/save',async req=>{guard(req);return connections.save(req.body)})
  app.post('/api/model-connections/:id/test',async req=>{guard(req);return connections.test(req.params.id,req.body?.revision,req.body?.model,req.oa)})
  app.post('/api/model-connections/:id/test-recognition',async req=>{
   guard(req);const row=connections.store.read().drafts?.[req.params.id]||connections.store.read().active?.[req.params.id]
   if(!row||row.revision!==req.body?.revision||!row.models.includes(req.body?.model))fail('连接已变更，请刷新',409)
   const image=(await readFile(new URL('../fixtures/recognition.jpg',import.meta.url))).toString('base64')
   const selected={connection:row.id,model:req.body.model},testPolicy={localOnly:policy.localOnly,billing:connections.billing,connections:{resolve:(choice,localOnly)=>{if(localOnly&&row.scope!=='local')fail('纯本地模式禁止外部识别',403);return connections.resolveRow(row,choice.model)}}}
   const result=await recognizeImage(testPolicy,{aiPolicy:{ocr:selected}},image,AbortSignal.timeout(180000),req.oa)
   const passed=result.text.includes('CY-5826')&&result.text.includes('123.45')&&result.text.includes('第2段')
   return {ok:passed,message:passed?'图片识别实测通过：已正确读取中文、核对码和金额。':'连接可响应，但图片内容核对未通过，请勿作为识别模型使用。'}
  })
  app.post('/api/model-connections/:id/enable',async req=>{guard(req);return connections.enable(req.params.id,req.body?.revision)})
 }
 app.get('/api/ai-capabilities',async req=>{guard(req);return policy.view()})
 app.post('/api/ai-capabilities/check',async req=>{guard(req);if(connections)policy.validateRouting(req.body);else policy.validate(req.body?.policies);return {ok:true,message:'模型、已部署工具组合及限额检查通过；发布仅影响后续启动的任务'}})
 app.post('/api/ai-capabilities/publish',async req=>{guard(req);return policy.publish(req.body,req.user.id)})
 app.post('/api/ai-capabilities/rollback',async req=>{guard(req);const state=policy.view(),previous=state.history.find(h=>h.version===req.body?.targetVersion);if(!previous)fail('历史版本不存在',404);return policy.publish({version:req.body.version,policies:previous.policies,defaults:previous.defaults||policy.defaults()},req.user.id)})
}
