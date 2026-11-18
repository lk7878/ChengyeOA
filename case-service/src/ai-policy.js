import path from 'node:path'
import {Store} from './atomic-store.js'
export const taskPresets={general:'general-legal',disability:'injury',injury:'injury',malpractice:'medical-review',traffic:'traffic-accident'}
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
export class AiPolicy {
 constructor(root,models=()=>[process.env.CHAT_MODEL].filter(Boolean)){this.store=new Store(path.join(root,'ai-capabilities.json'));this.models=models}
 baseline(){return Object.fromEntries(Object.entries(taskPresets).map(([kind,preset])=>[kind,{preset,model:process.env.CHAT_MODEL||'',fallbackModel:'',network:true,maxTokens:32768}]))}
 view(){const state=this.store.read();return {version:state.version||0,policies:state.policies||this.baseline(),models:this.models(),presets:[...new Set(Object.values(taskPresets))],history:state.history||[]}}
 validate(policies){
  if(!policies||Object.keys(policies).sort().join()!==Object.keys(taskPresets).sort().join())fail('请配置全部任务类型')
  for(const p of Object.values(policies)){
   if(!p||Object.keys(p).some(k=>!['preset','model','fallbackModel','network','maxTokens'].includes(k))||!Object.values(taskPresets).includes(p.preset)||!this.models().includes(p.model)||
    (typeof p.fallbackModel!=='string'||(p.fallbackModel&&!this.models().includes(p.fallbackModel)))||typeof p.network!=='boolean'||!Number.isSafeInteger(p.maxTokens)||p.maxTokens<1024||p.maxTokens>65536)fail('能力配置无效，只能使用已部署的模型和 Skills / 工具组合')
  }
  return structuredClone(policies)
 }
 publish(input,actor){if(!input||typeof input!=='object')fail('配置格式无效');const {version,policies}=input;const valid=this.validate(policies);return this.store.update(s=>{if(version!==(s.version||0))fail('配置已更新，请刷新后重试',409);const previous={version:s.version||0,policies:s.policies||this.baseline(),publishedBy:s.publishedBy,publishedAt:s.publishedAt};s.history=[...(s.history||[]),previous];s.version=(s.version||0)+1;s.policies=valid;s.publishedBy=actor;s.publishedAt=new Date().toISOString();return this.viewState(s)})}
 viewState(s){return {version:s.version,policies:s.policies,publishedAt:s.publishedAt}}
 snapshot(kind){const s=this.view();if(!s.policies[kind])fail('任务类型未配置');return {version:s.version,...structuredClone(s.policies[kind])}}
}
export async function registerAiPolicy(app,models){
 const policy=new AiPolicy(process.env.DATA_DIR,models);app.decorate('aiPolicy',policy)
 const guard=req=>{if(req.user?.isSystemSuperAdmin!==true)fail('仅 OA 超级管理员可配置 AI 能力',403)}
 app.get('/api/ai-capabilities',async req=>{guard(req);return policy.view()})
 app.post('/api/ai-capabilities/check',async req=>{guard(req);policy.validate(req.body?.policies);return {ok:true,message:'模型、已部署工具组合及限额检查通过；发布仅影响后续启动的任务'}})
 app.post('/api/ai-capabilities/publish',async req=>{guard(req);return policy.publish(req.body,req.user.id)})
 app.post('/api/ai-capabilities/rollback',async req=>{guard(req);const state=policy.view(),previous=state.history.find(h=>h.version===req.body?.targetVersion);if(!previous)fail('历史版本不存在',404);return policy.publish({version:req.body.version,policies:previous.policies},req.user.id)})
}
