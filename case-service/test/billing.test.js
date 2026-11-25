import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import http from 'node:http'
import Fastify from 'fastify'
import ExcelJS from 'exceljs'
import {Billing,normalizeUsage,monthOf,money} from '../src/billing.js'
import {meteredCompletion} from '../src/metered-model.js'
import {registerBilling,workbook} from '../src/billing-routes.js'
import {createTaskBroker} from '../src/task-broker.js'
import {EventEmitter} from 'node:events'
const actor={id:'lawyer-a',username:'lawyer-a',displayName:'甲律师',employeeId:'employee-a'}
const task={id:'task-a',oaUserId:actor.id,title:'合成案件',kind:'injury'}
const rate={connection:'c1',model:'m1',input:'2',output:'8',cacheRead:'0.2',cacheWrite:'3',effectiveAt:'2026-11-01T00:00:00+08:00'}
async function fixture(t,clock=()=> '2026-11-25T00:00:00.000Z'){
 const root=await mkdtemp(path.join(tmpdir(),'billing-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,b:new Billing(root,{clock})}
}
const start=(b,extra={})=>b.start({task,actor,connection:'c1',model:'m1',...extra})
const complete=(b,ref,usage={prompt_tokens:1000000,completion_tokens:500000},extra={})=>b.finish(ref,{usage,...extra})
test('normalizes cache and reasoning once, rejects invalid usage instead of free charges',()=>{
 assert.deepEqual(normalizeUsage({prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:30}}),{input:60,output:50,cacheRead:40,cacheWrite:0,reasoning:30,totalInput:100})
 assert.equal(normalizeUsage({prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:80}).input,20)
 assert.equal(normalizeUsage({input_tokens:10,output_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:40}).totalInput,80)
 for(const raw of [undefined,{}, {prompt_tokens:1,completion_tokens:-1},{prompt_tokens:1,completion_tokens:1,prompt_cache_hit_tokens:2},{prompt_tokens:Number.MAX_SAFE_INTEGER+1,completion_tokens:0}])assert.equal(normalizeUsage(raw),null)
})
test('durable per-call snapshots, precision, missing usage/prices, deleted tasks and CNY only',async t=>{
 const {b,root}=await fixture(t);b.addPrice(rate,'admin')
 const first=start(b);b.addPrice({...rate,input:'9',effectiveAt:'2026-11-20T00:00:00Z'},'admin')
 complete(b,first,{prompt_tokens:1000000,completion_tokens:500000,prompt_tokens_details:{cached_tokens:400000},completion_tokens_details:{reasoning_tokens:200000}})
 complete(b,first,{prompt_tokens:1,completion_tokens:1}) // idempotent callback
 let r=b.report(actor,{month:'2026-11'},{[task.id]:task});assert.equal(r.rows.length,1);assert.equal(r.summary.cost,'5.28');assert.equal(r.rows[0].price.input,'2');assert.equal(r.rows[0].taskDeleted,false)
 assert.equal(b.report(actor,{month:'2026-11'},{[task.id]:{...task,deletedAt:'now'}}).rows[0].taskDeleted,true)
 const missing=start(b,{model:'unpriced'});complete(b,missing);assert.equal(b.report(actor,{month:'2026-11'}).summary.pending,1)
 b.addPrice({...rate,model:'unpriced'},'admin');assert.equal(b.reconcile('2026-11','admin').count,1)
 assert.equal(b.report(actor,{month:'2026-11'}).rows.find(r=>r.id===first.id).cost,'5.28')
 const bad=start(b);b.finish(bad,{});assert.equal(b.reconcile('2026-11','admin').count,0)
 assert.throws(()=>b.addPrice({...rate,currency:'USD'},'admin'),/人民币/)
 assert.throws(()=>b.addPrice({...rate,effectiveAt:'oops'},'admin'),/生效时间/)
 assert.throws(()=>start(b,{actor:{id:'intruder'}}),/可信/)
 const ledger=await readFile(path.join(root,'billing/2026-11.json'),'utf8');assert.doesNotMatch(ledger,/prompt_tokens_details|apiKey|messages/)
 assert.equal(money('5000000000000000'),'0.01');assert.equal(money('4999999999999999'),'0.00')
})
test('Beijing month belongs to dispatch, process restart marks unresolved calls pending',async t=>{
 let now='2026-11-30T15:59:59.000Z';const {root,b}=await fixture(t,()=>now);b.addPrice(rate,'admin');const ref=start(b)
 now='2026-11-30T16:00:01.000Z';complete(b,ref);assert.equal(monthOf(now),'2026-12');assert.equal(b.report(actor,{month:'2026-11'}).summary.calls,1);assert.equal(b.report(actor,{month:'2026-12'}).summary.calls,0)
 start(b);const restarted=new Billing(root,{clock:()=>now});const pending=restarted.report(actor,{month:'2026-12'}).rows[0];assert.equal(pending.outcome,'INTERRUPTED');assert.equal(pending.status,'PENDING')
 assert.match(b.report(actor,{month:'2026-10'}).coverage,/无可靠历史/)
})
test('scope grants, revocation, whole-month financial split, pending and stale review protection',async t=>{
 const {b}=await fixture(t);b.addPrice(rate,'admin');complete(b,start(b));const other={id:'lawyer-b',username:'b'};complete(b,start(b,{task:{...task,id:'task-b',oaUserId:other.id},actor:other}))
 const finance={id:'finance'};assert.equal(b.report(actor).summary.calls,1);assert.throws(()=>b.report(actor,{owner:other.id}),/不能查看/);assert.throws(()=>b.report(actor,{scope:'finance'}),/财务查看/)
 b.grant(finance.id,[actor.id],'admin');let r=b.report(finance,{scope:'finance'});assert.equal(r.people.length,1);assert.equal(r.summary.cost,'6.00')
 assert.throws(()=>b.report(finance,{scope:'finance',owner:other.id}),/不能查看/)
 assert.throws(()=>b.review(finance,{model:'m1'},{fingerprint:r.fingerprint,decisions:[]},{}),/整月/)
 assert.throws(()=>b.review(finance,{}, {fingerprint:'stale',decisions:[]},{}),/已变更/)
 b.review(finance,{}, {fingerprint:r.fingerprint,decisions:[{owner:actor.id,personal:'1.25'}]},{});assert.equal(b.report(actor).reconciliation.decisions[0].firm,'4.75')
 complete(b,start(b));assert.equal(b.report(actor).reconciliation,null)
 b.grant(finance.id,[],'admin');assert.throws(()=>b.report(finance,{scope:'finance'}),/财务查看/)
 assert.equal(b.report({id:'admin',isSystemSuperAdmin:true},{scope:'finance'}).summary.calls,3)
})
test('Excel exact call sum equals monthly total; untrusted titles are strings, no formulas or secrets',async t=>{
 const {b}=await fixture(t);b.addPrice({...rate,input:'0.123456',output:'0.000001'},'admin')
 for(let i=0;i<3;i++)complete(b,start(b,{task:{...task,title:'=HYPERLINK("invalid")'}}),{prompt_tokens:12345,completion_tokens:1234})
 const report=b.report(actor),buffer=await workbook(report),book=new ExcelJS.Workbook();await book.xlsx.load(buffer)
 assert.deepEqual(book.worksheets.map(w=>w.name),['月度汇总','模型汇总','调用明细'])
 const ws=book.getWorksheet('调用明细');let exact=0n;for(let row=2;row<=4;row++){assert.equal(typeof ws.getCell(row,5).value,'string');exact+=BigInt(ws.getCell(row,24).value)}
 assert.equal(money(exact),book.getWorksheet('月度汇总').getCell(2,4).value)
 assert.equal(ws.getCell(2,18).value,'0.123456')
})
test('stream/JSON metering uses final supplier actual model, cancellations remain pending and no content is persisted',async t=>{
 const {b,root}=await fixture(t);b.addPrice(rate,'admin');const seen=[]
 const server=http.createServer(async(req,res)=>{let text='';for await(const p of req)text+=p;const body=JSON.parse(text);seen.push(body)
  if(body.model==='cancel'){res.setHeader('content-type','text/event-stream');res.write('data: {"choices":[]}\n\n');return}
  const response={model:'m1',id:'supplier-id',usage:{prompt_tokens:1000000,completion_tokens:500000},choices:[{message:{content:'PRIVATE_RESPONSE'}}]}
  if(body.stream){res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({...response,usage:undefined})+'\n\ndata: '+JSON.stringify({...response,choices:[]})+'\n\ndata: [DONE]\n\n')}else{res.setHeader('content-type','application/json');res.end(JSON.stringify(response))}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const route={base:`http://127.0.0.1:${server.address().port}/v1`,scope:'local',model:'alias',key:'SECRET_KEY'}
 for(const stream of [false,true]){const res=await meteredCompletion({billing:b,context:{task,actor,connection:'c1',model:'alias'},route,body:{stream,messages:[{role:'user',content:'PRIVATE_PROMPT'}]},signal:AbortSignal.timeout(10000)});await res.text()}
 assert.equal(b.report(actor).summary.cost,'12.00');assert.equal(b.report(actor).rows[0].model,'m1');assert.equal(seen[1].stream_options.include_usage,true)
 const res=await meteredCompletion({billing:b,context:{task,actor,connection:'c1',model:'cancel'},route:{...route,model:'cancel'},body:{stream:true},signal:AbortSignal.timeout(10000)});await res.body.cancel()
 assert.equal(b.report(actor).summary.pending,1)
 assert.doesNotMatch(await readFile(path.join(root,'billing/2026-11.json'),'utf8'),/PRIVATE_|SECRET_KEY/)
})
test('real broker charges actual fallback and OCR separately, never attributes a supplied body owner',async t=>{
 const {b}=await fixture(t);b.addPrice(rate,'admin');const previous=process.env.OA_API_BASE
 const server=http.createServer(async(req,res)=>{if(req.url.endsWith('/smart-case/me'))return res.end(JSON.stringify({code:200,data:actor}));let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);if(body.model==='broken'){res.writeHead(503);return res.end('{"error":"busy"}')};res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'m1',usage:{prompt_tokens:1000000,completion_tokens:500000},choices:[{message:{content:'OK'}}]}))})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;process.env.OA_API_BASE=base
 const policy={billing:b,events:new EventEmitter(),connections:{resolve:r=>({...r,base:base+'/v1',scope:'local'}),list:()=>({active:[{id:'c1',label:'synthetic'}]})}}
 const broker=await createTaskBroker({task:{...task,aiPolicy:{primary:{connection:'c1',model:'broken'},backup:{connection:'c1',model:'m1'},ocr:{connection:'c1',model:'m1'}}},policy,token:'synthetic',validate:async()=>{},knowledge:{}})
 t.after(()=>{broker.close();server.closeAllConnections();server.close();if(previous===undefined)delete process.env.OA_API_BASE;else process.env.OA_API_BASE=previous})
 const invoke=p=>new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:p,method:'POST'},res=>{let text='';res.on('data',p=>text+=p);res.on('end',()=>resolve({status:res.statusCode,text}))});req.on('error',reject);req.end(JSON.stringify({messages:[],owner:'intruder',stream:false}))})
 const result=await invoke('/llm/v1/chat/completions');assert.equal(result.status,200,result.text);assert.match(result.text,/备用模型/)
 assert.equal((await invoke('/ocr/v1/chat/completions')).status,200);const rows=b.report(actor).rows;assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.purpose==='OCR').length,1);assert.equal(rows.filter(r=>r.status==='CALCULATED').length,2);assert.equal(new Set(rows.filter(r=>r.purpose==='CHAT').map(r=>r.requestId)).size,1);assert.ok(rows.every(r=>r.owner===actor.id))
})
test('HTTP read/export/admin routes enforce identity and revoked finance grants',async t=>{
 const {root}=await fixture(t);const previous=process.env.DATA_DIR;process.env.DATA_DIR=root
 const app=Fastify();app.decorate('aiPolicy',{connections:{list:()=>({active:[]})}});app.decorate('oaTasks',{store:{read:()=>({[task.id]:task})}})
 app.addHook('preHandler',async req=>{req.oa={id:req.headers['x-user']||actor.id,username:'a',isSystemSuperAdmin:req.headers['x-admin']==='yes'}})
 await registerBilling(app);t.after(async()=>{await app.close();if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous})
 app.billing.addPrice(rate,'admin');complete(app.billing,start(app.billing))
 for(const url of ['/api/billing/me?owner=other','/api/billing/export?scope=finance','/api/billing/admin','/api/billing/system'])assert.equal((await app.inject({url})).statusCode,403,url)
 for(const url of ['/api/billing/prices','/api/billing/grants','/api/billing/reconcile'])assert.equal((await app.inject({method:'POST',url,payload:{}})).statusCode,403)
 assert.equal((await app.inject({url:'/api/billing/me'})).json().rows.length,1)
 assert.equal((await app.inject({url:'/api/billing/me',headers:{'x-user':'other'}})).json().rows.length,0)
 assert.equal((await app.inject({url:'/api/billing/export'})).headers['content-type'],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 app.billing.grant('finance',[actor.id],'admin');assert.equal((await app.inject({url:'/api/billing/export?scope=finance',headers:{'x-user':'finance'}})).statusCode,200)
 app.billing.grant('finance',[],'admin');assert.equal((await app.inject({url:'/api/billing/export?scope=finance',headers:{'x-user':'finance'}})).statusCode,403)
})

test('long poll wakes on costs and revalidates revoked sessions before responding',async t=>{
 const {root}=await fixture(t),previous=process.env.DATA_DIR;process.env.DATA_DIR=root
 const app=Fastify();app.decorate('aiPolicy',{connections:{list:()=>({active:[]})}})
 app.addHook('preHandler',async req=>{req.oa=actor})
 let revoked=false,checks=0;app.decorate('oaAuthenticate',async()=>{checks++;if(revoked)throw Object.assign(Error('会话已失效'),{statusCode:401});return {oa:actor}})
 await registerBilling(app);await app.listen({port:0,host:'127.0.0.1'})
 t.after(async()=>{await app.close();if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous})
 const url=`http://127.0.0.1:${app.server.address().port}/api/billing/changes`
 const waitForListener=async()=>{for(let i=0;i<100&&!app.billing.events.listenerCount('updated');i++)await new Promise(r=>setTimeout(r,5));assert.equal(app.billing.events.listenerCount('updated'),1)}
 const first=fetch(url);await waitForListener();app.billing.grant(actor.id,['other'],'admin');const response=await first;assert.equal(response.status,200);assert.equal((await response.json()).canFinance,true);assert.equal(checks,1)
 const second=fetch(url);await waitForListener();revoked=true;app.billing.events.emit('updated',{owner:actor.id});assert.equal((await second).status,401);assert.equal(checks,2);assert.equal(app.billing.events.listenerCount('updated'),0)
})
