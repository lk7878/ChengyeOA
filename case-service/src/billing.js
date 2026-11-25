import path from 'node:path'
import {readdirSync} from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {Store} from './atomic-store.js'
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const SCALE=10n**18n
const safe=v=>Number.isSafeInteger(v)&&v>=0
export const monthOf=date=>new Date(new Date(date).getTime()+8*3600000).toISOString().slice(0,7)
export const money=amount=>{const cents=(BigInt(amount)+SCALE/200n)/(SCALE/100n);return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`}
const decimal=v=>{if(!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(String(v)))fail('单价须为非负数，最多六位小数');const [a,b='']=String(v).split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'))}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function normalizeUsage(raw){
 if(!raw||typeof raw!=='object')return null
 const input=raw.prompt_tokens??raw.input_tokens,output=raw.completion_tokens??raw.output_tokens
 const cached=raw.prompt_cache_hit_tokens??raw.prompt_tokens_details?.cached_tokens??raw.input_tokens_details?.cached_tokens??raw.cache_read_input_tokens??0
 const written=raw.cache_creation_input_tokens??0,reasoning=raw.completion_tokens_details?.reasoning_tokens??raw.output_tokens_details?.reasoning_tokens??0
 const separate=Object.hasOwn(raw,'cache_read_input_tokens')||Object.hasOwn(raw,'cache_creation_input_tokens')
 const fresh=separate?input:input-cached-written
 if(![input,output,cached,written,reasoning,fresh,fresh+cached+written].every(safe)||reasoning>output)return null
 // OpenAI/DeepSeek input and output include cache hits / reasoning respectively.
 // Anthropic-compatible cache counters are additional to input_tokens.
 return {input:fresh,output,cacheRead:cached,cacheWrite:written,reasoning,totalInput:fresh+cached+written}
}
export class Billing {
 constructor(root,{clock=()=>new Date().toISOString()}={}){
  this.root=root;this.clock=clock;this.config=new Store(path.join(root,'billing-config.json'));this.events=new EventEmitter();this.events.setMaxListeners(0)
  this.config.update(s=>{s.startedAt??=clock();s.prices??=[];s.grants??={};s.audit??=[]})
  // The writer lock is held by the service: unfinished dispatches belong to a prior process.
  this.ledger(monthOf(clock()))
  for(const file of readdirSync(path.join(root,'billing')).filter(f=>/^\d{4}-\d{2}\.json$/.test(f))){
   const store=this.ledger(file.slice(0,7));if(Object.values(store.read()).some(r=>!r.completedAt))store.update(s=>{for(const r of Object.values(s))if(!r.completedAt){r.completedAt=clock();r.outcome='INTERRUPTED';r.reason='服务重启前调用未完成，用量待供应商核对';delete r.priceCandidates}})
  }
 }
 ledger(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('月份无效');return new Store(path.join(this.root,'billing',month+'.json'))}
 start({task,actor,connection,connectionLabel,model,purpose='CHAT',attempt=1,requestId=randomUUID()}){
  const at=this.clock(),id=randomUUID(),month=monthOf(at)
  if(task&&(!task.oaUserId||!task.id||actor?.id!==task.oaUserId))fail('缺少可信任务计费身份',503)
  const owner=task?.oaUserId||null
  const row={id,month,startedAt:at,requestId,attempt,owner,employeeId:actor?.employee?.id||actor?.employeeId||null,
   username:actor?.username||'',displayName:actor?.employee?.name||actor?.displayName||actor?.username||'',
   taskId:task?.id||null,taskTitle:task?.title||'',kind:task?.kind||'',connection,connectionLabel:connectionLabel||connection,
   requestedModel:model,model,purpose,personal:Boolean(owner),status:'PENDING',reason:'调用尚未完成',amount:'0',
   // Freeze eligible prices before dispatch. An in-flight call never picks up a later change.
   priceCandidates:this.config.read().prices.filter(p=>p.connection===connection&&p.effectiveAt<=at)}
  this.ledger(month).update(s=>{s[id]=row});return {id,month}
 }
 finish(ref,{usage,model,responseId,status='COMPLETED',httpStatus}={}){
  let changed=false
  const result=this.ledger(ref.month).update(s=>{
   const row=s[ref.id];if(!row)fail('计费流水不存在',404);if(row.completedAt)return row
   changed=true;row.completedAt=this.clock();row.outcome=status;row.httpStatus=httpStatus;row.responseId=typeof responseId==='string'?responseId.slice(0,200):null
   row.model=typeof model==='string'&&model.length<=180?model:row.requestedModel
   row.usage=normalizeUsage(usage)
   row.price=[...row.priceCandidates].reverse().find(p=>p.model===row.model)||null;delete row.priceCandidates
   this.calculate(row);return row
  })
  if(changed)this.events.emit('updated',{owner:result.owner,month:ref.month})
  return result
 }
 calculate(row){
  if(!row.usage){row.status='PENDING';row.reason='供应商未返回完整有效用量（中断或失败也可能产生费用）';return}
  if(!row.price){row.status='PENDING';row.reason='实际模型未配置生效单价';return}
  const u=row.usage,p=row.price
  if(['input','output','cacheRead','cacheWrite'].some(k=>u[k]>0&&p[k]==null)){row.status='PENDING';row.reason='缺少缓存或 Token 计价项';return}
  let amount=0n
  for(const k of ['input','output','cacheRead','cacheWrite'])amount+=BigInt(u[k])*decimal(p[k]??'0')*1000000n
  row.amount=amount.toString();row.status='CALCULATED';row.reason='按配置单价核算'
 }
 addPrice(body,actor){
  const {connection,model}=body||{};const currency='CNY'
  if(typeof connection!=='string'||!connection||typeof model!=='string'||!model)fail('连接或模型无效')
  if(body.currency&&body.currency!=='CNY')fail('仅支持人民币计价')
  if(!body.effectiveAt||!Number.isFinite(new Date(body.effectiveAt).getTime()))fail('生效时间无效')
  const effectiveAt=new Date(body.effectiveAt).toISOString(),at=this.clock()
  // Backdated rates are allowed only to explicitly reconcile pending rows; priced rows stay frozen.
  const price={id:randomUUID(),connection,model,currency,effectiveAt,createdAt:at,createdBy:actor}
  for(const k of ['input','output','cacheRead','cacheWrite']){price[k]=body[k]==null||body[k]===''?null:String(body[k]);if(price[k]!==null)decimal(price[k])}
  if(price.input===null||price.output===null)fail('请填写输入和输出单价')
  this.config.update(s=>{s.prices.push(price);s.prices.sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt)||a.createdAt.localeCompare(b.createdAt));s.audit.push({action:'price',actor,id:price.id,at})});return price
 }
 grant(financeId,owners,actor){
  if(!Array.isArray(owners)||owners.some(id=>typeof id!=='string')||new Set(owners).size!==owners.length)fail('授权范围无效')
  this.config.update(s=>{s.grants[financeId]=owners;s.audit.push({action:'finance-scope',actor,financeId,owners,at:this.clock()})});this.events.emit('updated',{owner:financeId});return {ok:true}
 }
 allowed(principal,finance){
  if(!principal?.id)fail('请登录',401)
  if(!finance)return [principal.id]
  if(principal.isSystemSuperAdmin)return null
  const granted=this.config.read().grants[principal.id];if(!granted?.length)fail('没有财务查看授权',403);return granted
 }
 report(principal,query={},tasks={}){
  if(query.scope&&!['finance','personal'].includes(query.scope))fail('查询范围无效')
  const month=query.month||monthOf(this.clock()),finance=query.scope==='finance',owners=this.allowed(principal,finance)
  // Non-finance requests cannot select another account, even through an export URL.
  if(query.owner&&owners&&!owners.includes(query.owner))fail('不能查看该账号费用',403)
  const all=Object.values(this.ledger(month).read()).filter(r=>r.personal&&(!owners||owners.includes(r.owner))&&(!query.owner||r.owner===query.owner))
  for(const date of [query.from,query.to].filter(Boolean))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!date.startsWith(month)||!Number.isFinite(new Date(date+'T00:00:00+08:00').getTime()))fail('筛选日期应属于所选月份')
  if(query.from&&query.to&&query.from>query.to)fail('开始日期不能晚于结束日期')
  const rows=all.filter(r=>(!query.model||r.model===query.model)&&(!query.task||r.taskId===query.task)&&(!query.from||r.startedAt>=new Date(query.from+'T00:00:00+08:00').toISOString())&&(!query.to||r.startedAt<new Date(new Date(query.to+'T00:00:00+08:00').getTime()+86400000).toISOString()))
   .sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(({priceCandidates,...r})=>({...r,taskDeleted:!!tasks[r.taskId]?.deletedAt||!tasks[r.taskId],cost:money(r.amount)}))
  const summarize=items=>{let amount=0n;const sum={calls:items.length,pending:0,input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0};for(const r of items){amount+=BigInt(r.amount);if(r.status==='PENDING')sum.pending++;for(const k of ['input','output','cacheRead','cacheWrite','reasoning'])sum[k]+=r.usage?.[k]||0}return {...sum,amount:amount.toString(),cost:money(amount)}}
  const groups=(key)=>{const map=new Map();for(const r of rows){const id=key(r);if(!map.has(id))map.set(id,[]);map.get(id).push(r)}return [...map.values()].map(items=>({...items[0],...summarize(items)}))}
  const config=this.config.read(),coverage=monthOf(config.startedAt)<=month?(config.startedAt<=new Date(month+'-01T00:00:00+08:00').toISOString()?'本月自月初开始记录':'本月仅含统计启用后的调用'):'此月份早于统计启用时间，无可靠历史账单'
  const fingerprint=digest(all.map(r=>[r.id,r.status,r.amount,r.completedAt]))
  const reviewRows=[...new Set(all.map(r=>r.owner))].map(owner=>{
   const review=config.reviews?.[month+':'+owner],items=all.filter(r=>r.owner===owner)
   return review?.fingerprint===digest(items.map(r=>[r.id,r.status,r.amount,r.completedAt]))?review:null
  })
  const review=reviewRows.length&&reviewRows.every(Boolean)?{decisions:reviewRows,at:reviewRows.map(r=>r.at).sort().at(-1)}:null
  return {month,filters:{from:query.from||null,to:query.to||null,model:query.model||null,task:query.task||null,owner:query.owner||null},startedAt:config.startedAt,coverage,completeHistory:coverage==='本月自月初开始记录',basis:'按供应商用量和配置单价核算，调用开始时间归属北京时间自然月',
   summary:summarize(rows),models:groups(r=>r.connection+'\0'+r.model),tasks:groups(r=>r.taskId),people:groups(r=>r.owner),rows,
   fingerprint,accessVersion:digest([!!principal.isSystemSuperAdmin,config.grants[principal.id]||[]]),canFinance:principal.isSystemSuperAdmin||!!config.grants[principal.id]?.length,
   reconciliation:review}
 }
 reconcile(month,actor){
  const prices=this.config.read().prices
  const result=this.ledger(month).update(s=>{let count=0;for(const r of Object.values(s)){if(!r.id||r.status!=='PENDING'||!r.completedAt||!r.usage)continue;const price=[...prices].reverse().find(p=>p.connection===r.connection&&p.model===r.model&&p.effectiveAt<=r.startedAt);if(!price)continue;r.price=price;this.calculate(r);if(r.status==='CALCULATED'){r.reconciledBy=actor;r.reconciledAt=this.clock();count++}}return {count}})
  if(result.count)this.events.emit('updated',{all:true,month});return result
 }
 review(principal,query,body,tasks){
  if(query.from||query.to||query.task||query.model)fail('财务确认须核对所选人员的整月账单')
  const report=this.report(principal,{...query,scope:'finance'},tasks)
  if(!report.people.length||body.fingerprint!==report.fingerprint||report.summary.pending)fail('账单已变更或仍有待核算调用，请刷新核对',409)
  // Store a scoped per-person settlement decision. No payroll writes or deductions occur here.
  const decisions=body.decisions
  if(!Array.isArray(decisions)||decisions.length!==report.people.length||new Set(decisions.map(d=>d.owner)).size!==decisions.length)fail('请逐人确认承担金额')
  const approved=decisions.map(d=>{const p=report.people.find(r=>r.owner===d.owner);if(!p)fail('费用归属无效');if(!/^\d+(\.\d{1,2})?$/.test(String(d.personal)))fail('个人结算金额无效');const personal=decimal(d.personal)*10n**12n;const rounded=decimal(p.cost)*10n**12n;if(personal>rounded)fail('个人结算金额不能超过核算金额');return {owner:d.owner,personal:String(d.personal),firm:money(rounded-personal),note:String(d.note||'').slice(0,300)}})
  const at=this.clock()
  this.config.update(s=>{s.reviews??={};for(const decision of approved){const review={...decision,actor:principal.id,at};
   // Use the durable ledger order, independent of the presentation sort.
   review.fingerprint=digest(Object.values(this.ledger(report.month).read()).filter(r=>r.personal&&r.owner===decision.owner).map(r=>[r.id,r.status,r.amount,r.completedAt]));s.reviews[report.month+':'+decision.owner]=review;
   s.audit.push({action:'finance-review',...review,month:report.month})}})
  return {ok:true,at}
 }
}
