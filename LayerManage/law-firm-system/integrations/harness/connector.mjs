import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HarnessRuntime, validateInstallation } from './runtime.mjs';
export function validateConfig(input) {
  const oa = new URL(input.oaApiOrigin);
  const allowed = input.allowedOrigins;
  const safeOrigin = value => { const u=new URL(value); return u.origin===value && !u.username && !u.password && (u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname))); };
  if (!safeOrigin(input.oaApiOrigin) || !Array.isArray(allowed) || !allowed.length || !allowed.every(safeOrigin)) throw new Error('CONFIG_ORIGIN_INVALID');
  const config={...input,oaApiOrigin:oa.origin,harnessRoot:resolve(input.harnessRoot),dataRoot:resolve(input.dataRoot || join(process.env.LOCALAPPDATA || homedir(),'ChengyeOA','Harness')),port:input.port ?? 43123,startupTimeoutMs:input.startupTimeoutMs ?? 60000,maxInstances:input.maxInstances ?? 4};
  if(!Number.isInteger(config.port)||config.port<1024||config.port>65535||!Number.isInteger(config.startupTimeoutMs)||config.startupTimeoutMs<1000||config.startupTimeoutMs>180000||!Number.isInteger(config.maxInstances)||config.maxInstances<1||config.maxInstances>16)throw new Error('CONFIG_LIMIT_INVALID');
  return config;
}
async function jsonBody(req) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('INVALID_REQUEST');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('INVALID_REQUEST');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function verifyTicket(config, body) {
  const response=await fetch(config.oaApiOrigin+'/api/v1/harness/verify-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('OA_AUTH_REJECTED');const payload=await response.json();const value=payload.data;
  if(payload.code!==200||value?.protocol!==1||typeof value.userId!=='string'||value.challenge!==body.challenge||value.feature!==body.feature)throw new Error('OA_AUTH_REJECTED');return value;
}
export function createConnector(config, dependencies={}) {
  const runtime=dependencies.runtime || new HarnessRuntime(config), verify=dependencies.verify || (body=>verifyTicket(config,body));const challenges=new Map();
  const server=createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    const port=server.address()?.port || config.port;
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return reply(403,{error:'ORIGIN_REJECTED'});
    const origin=req.headers.origin;
    if(typeof origin!=='string'||!config.allowedOrigins.includes(origin))return reply(403,{error:'ORIGIN_REJECTED'});
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;}
    try {
      if(req.method==='GET'&&req.url==='/health'){
        for(const [key,value]of challenges)if(value.expiresAt<Date.now())challenges.delete(key);
        if(challenges.size>=128)return reply(429,{error:'BUSY'});
        const challenge=randomBytes(32).toString('hex');challenges.set(challenge,{origin,expiresAt:Date.now()+60000});
        let version;try{version=validateInstallation(config.harnessRoot);}catch{return reply(503,{error:'HARNESS_NOT_BUILT'});}
        return reply(200,{protocol:1,challenge,version});
      }
      if(req.method!=='POST'||!['/launch','/stop'].includes(req.url))return reply(404,{error:'NOT_FOUND'});
      const body=await jsonBody(req);
      if(!body||typeof body!=='object'||Object.keys(body).some(key=>!['ticket','challenge','feature'].includes(key))||typeof body.ticket!=='string'||body.ticket.length>4096||!['knowledge','smart-case'].includes(body.feature))throw new Error('INVALID_REQUEST');
      const challenge=challenges.get(body.challenge);challenges.delete(body.challenge);
      if(!challenge||challenge.origin!==origin||challenge.expiresAt<Date.now())throw new Error('CHALLENGE_INVALID');
      const identity=await verify(body);
      if(identity.challenge!==body.challenge||identity.feature!==body.feature||typeof identity.userId!=='string')throw new Error('OA_AUTH_REJECTED');
      if(req.url==='/stop'){runtime.stop(identity.userId);return reply(200,{stopped:true});}
      const result=await runtime.launch(identity.userId);
      const url=new URL(result.url);if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||!url.port||!/^[-_A-Za-z0-9]{43}$/.test(url.searchParams.get('token')||''))throw new Error('HARNESS_START_FAILED');
      if(new URL(origin).hostname==='localhost')url.hostname='localhost';
      url.hash='oa-view='+body.feature;
      return reply(200,{...result,url:url.toString(),feature:body.feature});
    } catch(error) {
      const known=new Set(['INVALID_REQUEST','CHALLENGE_INVALID','OA_AUTH_REJECTED','HARNESS_NOT_BUILT','HARNESS_SETUP_TIMEOUT','HARNESS_SETUP_FAILED','HARNESS_START_FAILED','HARNESS_START_TIMEOUT','HARNESS_INSTANCE_LIMIT','HARNESS_ALREADY_RUNNING','HARNESS_LOCK_INVALID']);
      return reply(400,{error:known.has(error.message)?error.message:'CONNECTOR_FAILED'});
    }
  });
  server.shutdown=()=>{runtime.close();server.close();server.closeAllConnections();};
  server.on('close',()=>runtime.close());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const path=process.argv[2];if(!path)throw new Error('请指定本机配置文件：node connector.mjs <config.json>');
  const config=validateConfig(JSON.parse(readFileSync(path,'utf8')));const server=createConnector(config);
  server.listen(config.port,'127.0.0.1',()=>console.log('律师智慧管理系统：本机连接器已启动，端口 '+config.port));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.shutdown());
}
