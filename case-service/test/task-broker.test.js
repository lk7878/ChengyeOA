import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import {createTaskBroker} from '../src/task-broker.js'
test('cancelling a streamed model response keeps the broker available',async()=>{
 const previous=Object.fromEntries(['OA_API_BASE','CHAT_BASE_URL','CHAT_API_KEY'].map(k=>[k,process.env[k]]));let broker
 const mock=http.createServer((req,res)=>{if(req.url==='/api/v1/smart-case/me'){res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data:{id:'synthetic',permissions:[]}}));return}res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');const timer=setTimeout(()=>res.end('data: done\n\n'),1000);res.on('close',()=>clearTimeout(timer))})
 try{await new Promise(r=>mock.listen(0,'127.0.0.1',r));process.env.OA_API_BASE=process.env.CHAT_BASE_URL='http://127.0.0.1:'+mock.address().port;process.env.CHAT_API_KEY='synthetic-only';broker=await createTaskBroker({policy:{route:()=>({connection:{baseUrl:process.env.CHAT_BASE_URL},key:process.env.CHAT_API_KEY,model:{modelId:process.env.CHAT_MODEL}})},task:{},token:'synthetic-only',validate:async()=>{},knowledge:{}})
 await new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:'/llm/v1/chat/completions',method:'POST'},res=>{res.once('data',()=>{res.destroy();resolve()})});req.on('error',reject);req.end(JSON.stringify({stream:true,messages:[]}))});await delay(100)
 const status=await new Promise((resolve,reject)=>{const req=http.request({socketPath:broker.socket,path:'/unknown'},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()});assert.equal(status,404)
 }finally{broker?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
