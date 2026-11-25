import {Billing,monthOf} from './billing.js'
import {oa} from './oa-client.js'
import ExcelJS from 'exceljs'
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
export async function workbook(report){
 const book=new ExcelJS.Workbook();book.creator='承业智慧办案'
 const sheet=(name,headers,rows)=>{const ws=book.addWorksheet(name);ws.addRow(headers);for(const row of rows)ws.addRow(row.map(v=>v??''));ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];ws.columns.forEach(col=>{col.width=24});ws.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}}}
 const note=report.coverage+'；统计开始 '+report.startedAt+'；'+report.basis+'；筛选 '+JSON.stringify(report.filters||{})
 sheet('月度汇总',['月份','账号','姓名','已核算费用（人民币元）','待核算调用数','输入 Token（不含缓存）','输出 Token（含推理）','缓存读取 Token','缓存写入 Token','核对状态','统计范围说明'],
  (report.people.length?report.people:[{username:'',displayName:'',...report.summary}]).map(r=>[report.month,r.username,r.displayName,r.cost,r.pending,r.input,r.output,r.cacheRead,r.cacheWrite,report.reconciliation?'已核对':'按配置单价核算',note]))
 sheet('模型汇总',['连接','实际模型','已核算费用（人民币元）','调用数','待核算','输入 Token','输出 Token','缓存读取 Token','缓存写入 Token'],report.models.map(r=>[r.connectionLabel,r.model,r.cost,r.calls,r.pending,r.input,r.output,r.cacheRead,r.cacheWrite]))
 sheet('调用明细',['流水号','北京时间','账号','姓名','任务','任务状态','用途','连接','实际模型','请求模型','尝试次数','调用状态','输入 Token（不含缓存）','输出 Token（含推理）','缓存读取 Token','缓存写入 Token','推理 Token（已含输出）','输入单价/百万','输出单价/百万','缓存读单价/百万','缓存写单价/百万','价格版本','费用（人民币元）','精确费用（10^-18元）','核算状态'],report.rows.map(r=>[
  r.id,new Date(r.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),r.username,r.displayName,r.taskTitle,r.taskDeleted?'任务已删除':'',r.purpose,r.connectionLabel,r.model,r.requestedModel,r.attempt,r.outcome||'进行中',r.usage?.input,r.usage?.output,r.usage?.cacheRead,r.usage?.cacheWrite,r.usage?.reasoning,r.price?.input,r.price?.output,r.price?.cacheRead,r.price?.cacheWrite,r.price?.id,r.status==='PENDING'?'待核算':r.cost,r.amount,r.reason]))
 return Buffer.from(await book.xlsx.writeBuffer())
}
export async function registerBilling(app){
 const billing=new Billing(process.env.DATA_DIR);app.decorate('billing',billing);app.aiPolicy.billing=billing;app.aiPolicy.connections.billing=billing
 // WeKnora asynchronous operations do not expose trustworthy per-call usage.
 // Record their invocation separately as pending system costs, never as personal calls.
 if(app.oaKnowledge){const native=app.oaKnowledge.nativeApi;app.oaKnowledge.nativeApi=async(route,options={})=>{
  if(options.method!=='POST'||!/(\/knowledge\/file|\/reparse|\/hybrid-search)$/.test(route))return native(route,options)
  const ref=billing.start({connection:'weknora-system',model:'unreported',purpose:'PUBLIC_KNOWLEDGE'})
  try{const result=await native(route,options);billing.finish(ref,{status:'COMPLETED'});return result}catch(error){billing.finish(ref,{status:'FAILED'});throw error}
 }}
 const admin=req=>{if(!req.oa?.isSystemSuperAdmin)fail('仅超级管理员可以配置费用与授权',403)}
 app.addHook('onSend',async(req,reply,payload)=>{if(req.url.startsWith('/api/billing/'))reply.header('Cache-Control','private, no-store');return payload})
 const tasks=()=>app.oaTasks?.store.read()||{}
 const report=req=>billing.report(req.oa,req.query,tasks())
 app.get('/api/billing/summary',async req=>{const r=billing.report(req.oa,{},tasks());return {month:r.month,...r.summary,canFinance:r.canFinance,accessVersion:r.accessVersion}})
 app.get('/api/billing/me',async req=>report(req))
 app.get('/api/billing/export',async(req,reply)=>{const data=report(req);reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');reply.header('Content-Disposition',`attachment; filename="ai-cost-${data.month}.xlsx"`);reply.header('Cache-Control','private, no-store');return workbook(data)})
 app.get('/api/billing/admin',async req=>{admin(req);const s=billing.config.read();return {prices:s.prices,grants:s.grants,users:await oa(req.oa.token,'/smart-case/directory'),connections:app.aiPolicy.connections.list().active.map(({id,label,models})=>({id,label,models})),startedAt:s.startedAt}})
 app.get('/api/billing/system',async req=>{admin(req);const rows=Object.values(billing.ledger(req.query.month||monthOf(new Date())).read()).filter(r=>!r.personal).map(({priceCandidates,...r})=>r);return {rows}})
 app.post('/api/billing/prices',async req=>{admin(req);const {connection,model}=req.body||{};if(!app.aiPolicy.connections.list().active.some(c=>c.id===connection)||typeof model!=='string'||! /^[\w.:/@+-]{1,180}$/.test(model))fail('请选择有效连接并填写模型标识');return billing.addPrice(req.body,req.oa.id)})
 app.post('/api/billing/grants',async req=>{admin(req);const users=await oa(req.oa.token,'/smart-case/directory'),{financeId,owners}=req.body||{};if(!users.some(u=>u.id===financeId)||!Array.isArray(owners)||owners.some(id=>!users.some(u=>u.id===id)))fail('请选择有效账号');return billing.grant(financeId,owners,req.oa.id)})
 app.post('/api/billing/reconcile',async req=>{admin(req);return billing.reconcile(req.body?.month||monthOf(new Date()),req.oa.id)})
 app.post('/api/billing/review',async req=>billing.review(req.oa,req.query,req.body,tasks()))
 // An authenticated long poll updates only the amount, without refreshing the page.
 // Identity is revalidated after the wait, so revocation/session expiry is not cached.
 app.get('/api/billing/changes',async(req,reply)=>{
  const owner=req.oa.id
  await new Promise(resolve=>{const done=()=>{clearTimeout(timer);billing.events.off('updated',change);reply.raw.off('close',done);resolve()};const change=e=>{if(e.all||e.owner===owner)done()};const timer=setTimeout(done,20000);billing.events.on('updated',change);reply.raw.on('close',done)})
  if(reply.raw.destroyed)return reply
  const auth=await app.oaAuthenticate(req.headers);const r=billing.report(auth.oa,{},tasks());return {month:r.month,...r.summary,canFinance:r.canFinance,accessVersion:r.accessVersion}
 })
}
