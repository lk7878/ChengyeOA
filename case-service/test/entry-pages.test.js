import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import Fastify from 'fastify'
import {Store} from '../src/atomic-store.js'
import {registerOa} from '../src/oa-integration.js'
import {registerHarnessProxy} from '../src/harness-proxy.js'
import {registerNativeKnowledge} from '../src/native-knowledge.js'
import {safeWorkbenchNext} from '../src/entry-pages.js'
const id='00000000-0000-0000-0000-000000000001'
test('return target accepts only workbench navigation, drops credentials and rejects external/path tricks',()=>{
 for(const value of ['https://evil.test/','//evil.test/wb/','/wb/../harness/x/','/wb/\\evil','/wb/?x=1\r\nX:y','/wb/#token=x','/harness/'+id+'/'])assert.equal(safeWorkbenchNext(value),null,value)
 assert.equal(safeWorkbenchNext('/wb/?view=knowledge&kb=k1&kbPage=2&token=secret&next=evil'),'/wb/?view=knowledge&kb=k1&kbPage=2')
})
test('HTML entries distinguish expiry, forbidden, stopped, missing, and unavailable; APIs remain JSON; no task start',{timeout:20000},async t=>{
 const keys=['DATA_DIR','OA_API_BASE','OA_PUBLIC_URL','WORKBENCH_HOME'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 const dir=await mkdtemp(path.join(tmpdir(),'wb-entry-pages-')),oa=Fastify(),upstream=Fastify(),app=Fastify();let mode='running',identityStatus=200,runtimeCalls=0
 t.after(async()=>{await app.close();await upstream.close();await oa.close();await rm(dir,{recursive:true,force:true});for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
 oa.get('/api/v1/smart-case/me',async(_r,reply)=>{if(identityStatus!==200)return reply.code(identityStatus).send({message:'private upstream diagnostic'});return {code:200,data:{id:'owner',username:'owner',displayName:'测试成员',permissions:['menu.smart_case']}}})
 oa.post('/api/v1/smart-case/exchange',async()=>({code:200,data:{token:'synthetic-only',expiresIn:3600}}))
 upstream.get('/',async(_r,reply)=>reply.type('text/html').send('<html><head></head><body>Session fixture</body></html>'))
 const base=await upstream.listen({host:'127.0.0.1',port:0});process.env.DATA_DIR=dir;process.env.OA_API_BASE=await oa.listen({host:'127.0.0.1',port:0});process.env.OA_PUBLIC_URL='http://oa.example';process.env.WORKBENCH_HOME='/wb/'
 await registerOa(app)
 app.decorate('oaTasks',{runtime:async(task,user)=>{runtimeCalls++;assert.equal(user.id,'oa-owner');if(task!==id)throw Object.assign(Error('private task title'),{statusCode:404});if(mode!=='running')throw Object.assign(Error('private runtime diagnostic'),{statusCode:mode==='stopped'?409:mode==='forbidden'?403:503});return {base,cookie:'synthetic-only',approvedPreset:'general-legal'}}})
 app.decorate('oaKnowledge',{libraries:()=>[]});await registerHarnessProxy(app);await registerNativeKnowledge(app)
 const sid='synthetic-sid';new Store(path.join(dir,'oa-sessions.json')).update(d=>{d[createHash('sha256').update(sid).digest('hex')]={token:'synthetic-only',expiresAt:Date.now()+3600000}})
 const inject=(url,cookie=true,accept='text/html')=>app.inject({url,headers:{accept,...(cookie?{cookie:'oa_sid='+sid}:{})}})
 let r=await inject('/harness/'+id+'/',false);assert.equal(r.statusCode,401);assert.match(r.headers['content-type'],/text\/html/);assert.match(r.body,/登录已失效/);assert.equal(runtimeCalls,0);assert.equal(r.headers.location,undefined)
 r=await inject('/harness/'+id+'/',false,'application/json');assert.equal(r.statusCode,401);assert.match(r.headers['content-type'],/application\/json/)
 r=await inject('/harness/'+id+'/');assert.equal(r.statusCode,200);assert.match(r.body,/Session fixture/)
 for(const [state,status,message]of [['stopped',409,'任务已停止或中断'],['forbidden',403,'暂无访问权限'],['unavailable',503,'暂时无法打开']]){mode=state;r=await inject('/harness/'+id+'/');assert.equal(r.statusCode,status);assert.match(r.body,new RegExp(message));assert.equal(r.body.includes('private'),false);assert.equal(r.headers.location,undefined);assert.match(r.headers['cache-control'],/no-store/)}
 r=await inject('/harness/00000000-0000-0000-0000-000000000002/');assert.equal(r.statusCode,404);assert.match(r.body,/页面或任务不可用/);assert.equal(r.body.includes('private task'),false)
 r=await inject('/harness/'+id+'/api/session/list');assert.equal(r.statusCode,503);assert.match(r.headers['content-type'],/application\/json/)
 r=await inject('/knowledge-native/');assert.equal(r.statusCode,403);assert.match(r.body,/逐库授权/)
 r=await inject('/knowledge-native/api/v1/knowledge-bases');assert.equal(r.statusCode,403);assert.match(r.headers['content-type'],/application\/json/)
 identityStatus=503;r=await inject('/harness/'+id+'/');assert.equal(r.statusCode,503);assert.match(r.body,/暂时无法打开/)
 identityStatus=403;r=await inject('/harness/'+id+'/');assert.equal(r.statusCode,403);assert.match(r.body,/暂无访问权限/)
 identityStatus=200
 const next='/wb/?view=knowledge&kb=k1&kbFilter=合同&kbPage=2',prepared=await app.inject('/api/auth/start?next='+encodeURIComponent(next));assert.equal(prepared.statusCode,302)
 const cookies=prepared.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ')
 const callback=await app.inject({url:'/api/auth/oa/callback?code=synthetic',headers:{cookie:cookies}});assert.equal(callback.statusCode,302);assert.equal(callback.headers.location,safeWorkbenchNext(next));assert.ok(callback.headers['set-cookie'].some(c=>c.startsWith('oa_next=;')&&c.includes('Max-Age=0')))
 r=await app.inject('/api/auth/start?next=https://evil.example');assert.equal(r.statusCode,400);assert.equal(r.headers['set-cookie'],undefined)
 r=await inject('/api/auth/oa/callback?code=expired',false);assert.equal(r.statusCode,400);assert.match(r.body,/登录校验已过期/)
})
