import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import {registerAiPolicy} from '../src/ai-policy.js'
import {createTaskBroker} from '../src/task-broker.js'

test('migrated policy, staged key rotation, real probes, local routing and reply-level fallback',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'oa-connections-')),seen=[]
 const app=Fastify(),prior={...process.env}
 const mock=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/smart-case/me'))return res.end(JSON.stringify({code:200,data:{id:'member'}}))
  let raw='';for await(const part of req)raw+=part
  const body=JSON.parse(raw)
  seen.push({body,key:req.headers.authorization})
  if(body.model==='limited'&&!body.tools&&!body.messages?.some(m=>m.content==='Reply only OK.')){res.writeHead(503);return res.end()}
  if(body.tools){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{tool_calls:[{type:'function',function:{name:'oa_ping',arguments:'{}'}}]}}]}))}
  res.setHeader('content-type','text/event-stream')
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'OK'}}]})+'\n\ndata: [DONE]\n\n')
 })
 await new Promise(r=>mock.listen(0,'127.0.0.1',r))
 const base='http://127.0.0.1:'+mock.address().port
 Object.assign(process.env,{DATA_DIR:root,CHAT_MODEL:'cloud-model',CHAT_BASE_URL:'https://unused.invalid/v1',CHAT_API_KEY:'legacy-fixture-key',OCR_BASE_URL:'https://unused.invalid/v1',OCR_MODEL:'ocr',OCR_API_KEY:'fixture-ocr',OA_API_BASE:base})
 let brokers=[]
 t.after(async()=>{for(const b of brokers)b.close();await app.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);await rm(root,{recursive:true,force:true})})
 app.addHook('preHandler',async req=>{req.user={id:'actor',isSystemSuperAdmin:req.headers.admin==='yes'}})
 await registerAiPolicy(app,()=>['cloud-model'],true)
 const policy=app.aiPolicy,registry=policy.connections
 const oldTask=policy.snapshot('general')
 const call=(url,payload,admin=true)=>app.inject({method:payload?'POST':'GET',url,payload,headers:admin?{admin:'yes'}:{}})
 for(const [url,body] of [['/api/model-connections'],['/api/model-connections/save',{}],['/api/model-connections/legacy/test',{}],['/api/model-connections/legacy/enable',{}],['/api/ai-capabilities/publish',{}]])assert.equal((await call(url,body,false)).statusCode,403)
 const draft={label:'测试内网',scope:'local',base:base+'/v1',models:['limited','local-model'],auth:'key',apiKey:'fixture-first'}
 const saved=(await call('/api/model-connections/save',draft)).json(),id=saved.id
 const route=model=>({connection:id,model})
 assert.ok(id);assert.doesNotMatch(JSON.stringify(saved),/fixture-first/)
 assert.throws(()=>registry.enable(id,1))
 for(const model of draft.models)await registry.test(id,1,model)
 registry.enable(id,1)
 assert.equal(seen.length,4)
 assert.ok(seen.every(c=>c.body.messages.length===1&&['Call oa_ping once.','Reply only OK.'].includes(c.body.messages[0].content)))
 const config=policy.view()
 config.defaults={localOnly:true,primary:route('limited'),backup:route('local-model'),ocr:null}
 let published=await call('/api/ai-capabilities/publish',config)
 assert.equal(published.statusCode,200,published.body)
 assert.equal(policy.snapshot('traffic').model,'limited')
 assert.equal(oldTask.model,'cloud-model')
 const makeBroker=async snapshot=>{const b=await createTaskBroker({task:{aiPolicy:snapshot},policy,token:'fixture',validate:async()=>{},knowledge:{}});brokers.push(b);return b}
 const via=(b,url,body={},method='POST')=>new Promise((resolve,reject)=>{const req=http.request({socketPath:b.socket,path:url,method},res=>{let text='';res.on('data',p=>text+=p);res.on('end',()=>resolve({code:res.statusCode,text}))});req.on('error',reject);req.end(method==='POST'?JSON.stringify(body):undefined)})
 const priorBroker=await makeBroker(oldTask),fresh=await makeBroker(policy.snapshot('general'))
 const count=seen.length
 for(const [url,method] of [['/llm/v1/chat/completions','POST'],['/ocr/v1/chat/completions','POST'],['/clinical/api/v1/plugins/google-search','GET'],['/oa/knowledge/search','POST']])assert.equal((await via(priorBroker,url,{},method)).code,403)
 assert.equal(seen.length,count)
 const chat=()=>via(fresh,'/llm/v1/chat/completions',{stream:true,messages:[{role:'user',content:'synthetic'}]})
 assert.match((await chat()).text,/备用模型：local-model/)
 assert.equal(seen.at(-1).key,'Bearer fixture-first')
 const edit=registry.save({...draft,id,revision:1,apiKey:'fixture-rotated'})
 assert.equal(registry.resolve(route('local-model')).key,'fixture-first')
 assert.throws(()=>registry.enable(id,edit.revision))
 await registry.test(id,edit.revision,'local-model');registry.enable(id,edit.revision)
 await chat();assert.equal(seen.at(-1).key,'Bearer fixture-rotated')
 assert.doesNotMatch(await readFile(path.join(root,'model-connections.json'),'utf8'),/fixture-first|fixture-rotated|legacy-fixture-key/)
 assert.throws(()=>registry.save({...draft,base:'https://public.example/v1'}))
 const bad=policy.view();bad.defaults.backup={connection:'legacy',model:'cloud-model'}
 assert.equal((await call('/api/ai-capabilities/check',bad)).statusCode,403)
 const anon=registry.save({...draft,label:'无认证',auth:'none',apiKey:undefined,models:['local-model']})
 await registry.test(anon.id,1,'local-model');assert.equal(seen.at(-1).key,undefined)
 const selected=policy.view();selected.policies.general={...selected.policies.general,inherit:false,primary:route('local-model'),backup:null}
 policy.publish(selected,'actor');assert.equal(policy.snapshot('general').model,'local-model');assert.equal(policy.snapshot('traffic').model,'limited')
})

test('bootstrap secrets round-trip, and tampered or transplanted ciphertext fails closed',async t=>{
 const {sourceSecret}=await import('../src/source-secrets.js')
 const {ModelConnections}=await import('../src/model-connections.js')
 const root=await mkdtemp(path.join(os.tmpdir(),'oa-model-key-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 new ModelConnections(root)
 const sealed=sourceSecret('synthetic','local-key',root,true)
 assert.doesNotMatch(sealed,/synthetic/)
 assert.equal(sourceSecret(sealed,'local-key',root,true),sealed)
 assert.equal(sourceSecret(sealed,'local-key',root),'synthetic')
 assert.throws(()=>sourceSecret(sealed,'different-key',root))
})
