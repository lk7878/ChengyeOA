import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import {createTaskBroker} from '../src/task-broker.js'
test('cancelling a streamed model response keeps the broker available',async()=>{
 const previous=Object.fromEntries(['OA_API_BASE','CHAT_BASE_URL','CHAT_API_KEY','CHAT_MODEL'].map(k=>[k,process.env[k]]));let broker
 const mock=http.createServer((req,res)=>{if(req.url==='/api/v1/smart-case/me'){res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data:{id:'synthetic',permissions:[]}}));return}res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');const timer=setTimeout(()=>res.end('data: done\n\n'),1000);res.on('close',()=>clearTimeout(timer))})
 try{await new Promise(r=>mock.listen(0,'127.0.0.1',r));process.env.OA_API_BASE=process.env.CHAT_BASE_URL='http://127.0.0.1:'+mock.address().port;process.env.CHAT_API_KEY='synthetic-only';process.env.CHAT_MODEL='approved';broker=await createTaskBroker({task:{},token:'synthetic-only',validate:async()=>{},knowledge:{}})
 await new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:'/llm/v1/chat/completions',method:'POST'},res=>{assert.equal(res.statusCode,200);res.once('data',()=>{res.destroy();resolve()})});req.on('error',reject);req.end(JSON.stringify({stream:true,messages:[]}))});await delay(100)
 const status=await new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:'/unknown'},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()});assert.equal(status,404)
 }finally{broker?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v}
})

test('knowledge broker searches only the task selection and rejects unselected libraries',async()=>{
 const previous=process.env.OA_API_BASE;let broker;const searched=[];
 const mock=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data:{id:'reader',permissions:[]}}))});
 try{await new Promise(r=>mock.listen(0,'127.0.0.1',r));process.env.OA_API_BASE='http://127.0.0.1:'+mock.address().port;
 broker=await createTaskBroker({task:{knowledgeBases:['chosen']},token:'fixture',validate:async()=>{},knowledge:{acl:{read:()=>({chosen:{},'not-selected':{}})},search:async id=>{searched.push(id);return {data:[{content:'selected'}]}}}});
 const call=pathname=>new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:pathname,method:'POST'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end(JSON.stringify({query:'synthetic',query_text:'synthetic'}))});
 assert.equal(await call('/oa/knowledge/search'),200);assert.deepEqual(searched,['chosen']);
 assert.equal(await call('/api/v1/knowledge-bases/chosen/hybrid-search'),200);assert.deepEqual(searched,['chosen','chosen']);
 assert.equal(await call('/api/v1/knowledge-bases/not-selected/hybrid-search'),403);assert.deepEqual(searched,['chosen','chosen']);
 }finally{broker?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));if(previous===undefined)delete process.env.OA_API_BASE;else process.env.OA_API_BASE=previous}
})

test('task model configuration binds model, token limit, fallback, network and live authorization',async t=>{
 const previous=Object.fromEntries(['OA_API_BASE','CHAT_BASE_URL','CHAT_API_KEY'].map(k=>[k,process.env[k]])),calls=[];let broker,revoked=false
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json')
  if(req.url==='/api/v1/smart-case/me'){res.end(JSON.stringify({code:200,data:{id:'owner',permissions:[]}}));return}
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);calls.push(body)
  res.statusCode=body.model==='primary'?503:200;res.end('{}')
 })
 t.after(async()=>{broker?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));process.env.OA_API_BASE=process.env.CHAT_BASE_URL='http://127.0.0.1:'+mock.address().port;process.env.CHAT_API_KEY='fixture'
 broker=await createTaskBroker({task:{aiPolicy:{model:'primary',fallbackModel:'fallback',maxTokens:2048,network:false}},token:'fixture',validate:async()=>{if(revoked)throw Error('revoked')},knowledge:{}})
 const call=(body={},url='/llm/v1/chat/completions',method='POST')=>new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:url,method},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end(method==='GET'?undefined:JSON.stringify(body))})
 assert.equal(await call({model:'unapproved'}),403);assert.equal(calls.length,0)
 assert.equal(await call({model:'primary',max_tokens:99999,max_completion_tokens:99999}),200)
 assert.deepEqual(calls.map(c=>c.model),['primary','fallback']);assert.ok(calls.every(c=>c.max_tokens===2048&&c.max_completion_tokens===undefined))
 assert.equal(await call({},'/clinical/api/v1/plugins/google-search','GET'),403)
 revoked=true;assert.equal(await call(),403);assert.equal(calls.length,2)
})
