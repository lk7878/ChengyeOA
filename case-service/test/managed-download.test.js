import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import Fastify from 'fastify'
import {fixture} from './policy-fixture.js'
import {registerTasks} from '../src/oa-tasks.js'
test('task output download streams original bytes, rechecks OA access and rejects other owners',async t=>{
 const {root,policy,task}=await fixture(t),content='2026年11月16日，智慧办案成果下载测试';let upstreamCalls=0,revoked=false;
 const server=http.createServer((req,res)=>{upstreamCalls++;assert.equal(req.headers.authorization,'Bearer scoped-test-token');if(revoked){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({message:'access revoked'}));return}assert.equal(req.url,'/api/v1/personal-files/result/versions/1/content');res.writeHead(200,{'content-type':'text/markdown; charset=utf-8'});res.end(content)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const previous={data:process.env.DATA_DIR,base:process.env.OA_API_BASE};process.env.DATA_DIR=root;process.env.OA_API_BASE='http://127.0.0.1:'+server.address().port;
 const app=Fastify();app.decorate('oaKnowledge',{});app.decorate('modelPolicy',policy);app.addHook('preHandler',async req=>{req.user={id:req.headers['x-test-owner']||task.owner};req.oa={token:'scoped-test-token'}});const tasks=await registerTasks(app);tasks.store.update(s=>{s[task.id]={...task,outputs:{result:{fileId:'result',version:1,name:'验收报告.md'}}}});
 t.after(async()=>{await app.close();await new Promise(resolve=>server.close(resolve));if(previous.data===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous.data;if(previous.base===undefined)delete process.env.OA_API_BASE;else process.env.OA_API_BASE=previous.base});
 const route='/api/tasks/'+task.id+'/outputs/result/1',result=await app.inject(route);assert.equal(result.statusCode,200);assert.equal(result.body,content);assert.match(result.headers['content-disposition'],/attachment; filename\*=UTF-8''/);assert.equal((await app.inject({url:route,headers:{'x-test-owner':'someone-else'}})).statusCode,404);assert.equal(upstreamCalls,1);revoked=true;assert.equal((await app.inject(route)).statusCode,403)
})
