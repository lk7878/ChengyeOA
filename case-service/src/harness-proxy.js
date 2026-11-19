import {canManageHarness,harnessBootstrap,isHarnessAdminRequest,harnessFrameAllowed,isHarnessStaticResource,harnessFrameRejection} from './harness-experience.js'
import {randomUUID} from 'node:crypto'
import http from 'node:http'
import WebSocket from '../../runtime/upstream/harness/node_modules/.pnpm/ws@8.21.3/node_modules/ws/index.js'

function headers(input,runtime){const result={...input,host:new URL(runtime.base).host,cookie:runtime.cookie};for(const h of ['authorization','origin','referer','x-forwarded-host','x-forwarded-for','x-forwarded-proto'])delete result[h];return result}

const CLIENT_SHIM=`(()=>{
const NativeWS=window.WebSocket;
if(!NativeWS||NativeWS.__oaPatched)return;
const isLoopback=location.hostname==='127.0.0.1'||location.hostname==='localhost';
class PatchedWebSocket extends EventTarget{
 constructor(rawUrl,protocols){
  const parsed=new URL(String(rawUrl),location.href);
  const match=(parsed.protocol==='ws:'||parsed.protocol==='wss:')&&parsed.host===location.host&&(!isLoopback||window.__OA_FORCE_HTTP_WS)&&parsed.pathname.match(/^(\\/harness\\/[a-f0-9-]{36})(\\/.*)$/);
  if(!match)return protocols!==undefined?new NativeWS(rawUrl,protocols):new NativeWS(rawUrl);
  super();
  this.url=parsed.href;
  this.readyState=0;
  this.protocol='';
  this.extensions='';
  this.bufferedAmount=0;
  this.binaryType='blob';
  this._handlers={open:null,message:null,error:null,close:null};
  this._prefix=match[1];
  this._target=match[2]+parsed.search;
  this._cid=null;
  this._queue=[];
  this._sending=false;
  this._clientClosing=false;
  this._closeCode=1000;
  this._closeReason='';
  this._closedEmitted=false;
  this._ac=new AbortController();
  this._connect();
 }
 _emit(ev){
  this.dispatchEvent(ev);
  const fn=this._handlers[ev.type];
  if(typeof fn==='function'){try{fn.call(this,ev)}catch(e){setTimeout(()=>{throw e},0)}}
 }
 _finishClose(code,reason,wasClean,withError){
  if(this._closedEmitted)return;
  this._closedEmitted=true;
  this.readyState=3;
  if(withError)this._emit(new Event('error'));
  const ev=typeof CloseEvent==='function'?new CloseEvent('close',{code,reason,wasClean}):new Event('close');
  this._emit(ev);
 }
 async _connect(){
  try{
   const res=await fetch(this._prefix+'/__ws/stream?path='+encodeURIComponent(this._target),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'text/event-stream'},signal:this._ac.signal});
   if(!res.ok||!res.body){this._finishClose(1006,'HTTP '+res.status,false,true);return}
   const reader=res.body.getReader(),decoder=new TextDecoder();
   let buf='';
   while(true){
    const {value,done}=await reader.read();
    if(done)break;
    buf+=decoder.decode(value,{stream:true});
    let nl;
    while((nl=buf.indexOf('\\n'))>=0){
     const line=buf.slice(0,nl).replace(/\\r$/,'');
     buf=buf.slice(nl+1);
     if(!line.startsWith('data: '))continue;
     const pkt=JSON.parse(line.slice(6));
     if(pkt.t==='open'){
      if(this.readyState!==0)continue;
      this._cid=pkt.cid;
      this.readyState=1;
      this._emit(new Event('open'));
      void this._flush();
     }else if(pkt.t==='msg'){
      if(this.readyState===1)this._emit(new MessageEvent('message',{data:pkt.d}));
     }else if(pkt.t==='bin'){
      if(this.readyState!==1)continue;
      const bin=atob(pkt.d),bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      this._emit(new MessageEvent('message',{data:this.binaryType==='arraybuffer'?bytes.buffer:new Blob([bytes])}));
     }else if(pkt.t==='close'){
      this._finishClose(pkt.code||1000,pkt.reason||'',true,false);
      return;
     }
    }
   }
   if(this._clientClosing)this._finishClose(this._closeCode,this._closeReason,true,false);
   else this._finishClose(1006,'stream ended',false,true);
  }catch{
   if(this._clientClosing)this._finishClose(this._closeCode,this._closeReason,true,false);
   else this._finishClose(1006,'connection failed',false,true);
  }
 }
 send(data){
  if(this.readyState===0)throw new DOMException('Still in CONNECTING state.','InvalidStateError');
  if(this.readyState!==1)return;
  if(typeof data==='string'){this._queue.push({b:0,d:data})}
  else if(data instanceof ArrayBuffer||ArrayBuffer.isView(data)){
   const u8=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
   let s='';for(let i=0;i<u8.length;i++)s+=String.fromCharCode(u8[i]);
   this._queue.push({b:1,d:btoa(s)});
  }else{this._queue.push({b:0,d:String(data)})}
  void this._flush();
 }
 async _flush(){
  if(this._sending||!this._cid||this.readyState!==1)return;
  this._sending=true;
  try{
   while(this._queue.length>0&&this.readyState===1){
    const frames=this._queue.splice(0,this._queue.length);
    const r=await fetch(this._prefix+'/__ws/send',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({cid:this._cid,frames})});
    if(!r.ok){this._ac.abort();this._finishClose(1006,'send failed',false,true);return}
   }
  }catch{
   if(!this._clientClosing){this._ac.abort();this._finishClose(1006,'send error',false,true)}
  }finally{this._sending=false}
 }
 close(code=1000,reason=''){
  if(this.readyState===2||this.readyState===3)return;
  const wasConnecting=this.readyState===0;
  this._clientClosing=true;
  this._closeCode=code;
  this._closeReason=reason;
  this.readyState=2;
  if(this._cid){
   void fetch(this._prefix+'/__ws/close',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'content-type':'application/json'},body:JSON.stringify({cid:this._cid,code,reason})}).catch(()=>{});
  }
  this._ac.abort();
  this._finishClose(code,reason,!wasConnecting,wasConnecting);
 }
 get onopen(){return this._handlers.open} set onopen(v){this._handlers.open=v}
 get onmessage(){return this._handlers.message} set onmessage(v){this._handlers.message=v}
 get onerror(){return this._handlers.error} set onerror(v){this._handlers.error=v}
 get onclose(){return this._handlers.close} set onclose(v){this._handlers.close=v}
}
for(const [k,v]of [['CONNECTING',0],['OPEN',1],['CLOSING',2],['CLOSED',3]]){PatchedWebSocket[k]=v;PatchedWebSocket.prototype[k]=v}
PatchedWebSocket.__oaPatched=true;
window.WebSocket=PatchedWebSocket;
})();\n`

export async function registerHarnessProxy(app){
 const tunnels=new Map(),webSockets=new WebSocket.WebSocketServer({noServer:true,maxPayload:32*1024*1024})
 app.addHook('onClose',async()=>{for(const ws of webSockets.clients)ws.terminate();webSockets.close()})
 app.addHook('onClose',async()=>{for(const entry of tunnels.values())entry.cleanup(true);tunnels.clear()})

 app.get('/harness/:id/__ws/shim.js',async(req,reply)=>{
  await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)
  reply.header('Content-Type','application/javascript; charset=utf-8')
  reply.header('Cache-Control','private, no-store')
  return CLIENT_SHIM
 })

 app.get('/harness/:id/__ws/stream',async(req,reply)=>{
  const suffix=String(req.query?.path||'')
  if(!suffix.startsWith('/')||suffix.startsWith('//')||new URL(suffix,'http://local').searchParams.has('token'))return reply.code(400).send({error:'无效连接参数'})
  const runtime=await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)
  const upstream=new WebSocket(runtime.base.replace(/^http/,'ws')+suffix,{headers:{cookie:runtime.cookie},perMessageDeflate:false})
  const pending=[];let deliver=null,earlyClose=null,closed=false,ping=null,authTimer=null
  const cid=randomUUID()
  function cleanup(closeWs){
   if(closed)return;closed=true
   if(ping)clearInterval(ping);if(authTimer)clearInterval(authTimer);tunnels.delete(cid)
   if(closeWs&&upstream.readyState<2){try{upstream.close()}catch{}}
   if(reply.sent&&!reply.raw.writableEnded&&!reply.raw.destroyed)reply.raw.end()
  }
  upstream.on('message',(data,isBinary)=>{
   const pkt=isBinary?{t:'bin',d:Buffer.from(data).toString('base64')}:{t:'msg',d:data.toString('utf8')}
   if(deliver)deliver(pkt);else pending.push(pkt)
  })
  upstream.on('close',(code,reason)=>{
   const pkt={t:'close',code,reason:reason?.toString()||''}
   if(deliver){deliver(pkt);cleanup(false)}else earlyClose=pkt
  })
  const opened=await new Promise(resolve=>{
   const onOpen=()=>{upstream.off('error',onErr);upstream.off('unexpected-response',onBad);resolve(true)}
   const onErr=()=>{upstream.off('open',onOpen);upstream.off('unexpected-response',onBad);resolve(false)}
   const onBad=(_r,res)=>{res.resume();onErr()}
   upstream.once('open',onOpen);upstream.once('error',onErr);upstream.once('unexpected-response',onBad)
  })
  if(!opened){try{upstream.close()}catch{}return reply.code(502).send({error:'上游实时通道不可用'})}
  upstream.on('error',()=>cleanup(true))
  reply.hijack()
  const raw=reply.raw;raw.socket?.setNoDelay(true)
  raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-cache, no-store, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'})
  const send=obj=>{if(!raw.writableEnded&&!raw.destroyed)raw.write('data: '+JSON.stringify(obj)+'\n\n')}
  raw.write(': '+' '.repeat(2048)+'\n\n')
  send({t:'open',cid})
  for(const pkt of pending)send(pkt);pending.length=0
  deliver=send
  if(earlyClose){send(earlyClose);cleanup(false);return}
  ping=setInterval(()=>send({t:'ping'}),15000);ping.unref()
  authTimer=setInterval(async()=>{try{await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)}catch{cleanup(true)}},2000);authTimer.unref()
  tunnels.set(cid,{ws:upstream,taskId:req.params.id,userId:req.user.id,cleanup,send})
  raw.on('close',()=>cleanup(true))
 })

 app.post('/harness/:id/__ws/send',async(req,reply)=>{
  const runtime=await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)
  const entry=tunnels.get(req.body?.cid)
  if(!entry||entry.taskId!==req.params.id||entry.userId!==req.user.id||entry.ws.readyState!==WebSocket.OPEN)return reply.code(410).send({error:'通道已关闭'})
  const frames=Array.isArray(req.body?.frames)?req.body.frames:[]
  const checked=frames.map(frame=>{const denied=!canManageHarness(req.user)&&!harnessFrameAllowed(String(frame?.d??''),frame?.b===1,runtime.approvedPreset);return {frame,denied,rejection:denied?harnessFrameRejection(String(frame?.d??''),frame?.b===1):null}})
  if(checked.some(item=>item.denied&&!item.rejection))return reply.code(403).send({error:'无效或未授权的 AI 请求'})
  for(const {frame,denied,rejection} of checked){
   if(denied){entry.send({t:'msg',d:JSON.stringify(rejection)});continue}
   if(frame?.b===1)entry.ws.send(Buffer.from(String(frame.d||''),'base64'))
   else entry.ws.send(String(frame?.d??''))
  }
  return {ok:true}
 })

 app.post('/harness/:id/__ws/close',async req=>{
  const entry=tunnels.get(req.body?.cid)
  if(entry&&entry.taskId===req.params.id&&entry.userId===req.user.id&&entry.ws.readyState<2){
   const code=req.body?.code,valid=typeof code==='number'&&(code===1000||(code>=3000&&code<=4999))?code:1000
   try{entry.ws.close(valid,String(req.body?.reason||'').slice(0,120))}catch{}
  }
  return {ok:true}
 })

 app.all('/harness/:id/*',async(req,reply)=>{
  const runtime=await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)
  const suffix=req.url.slice(('/harness/'+req.params.id).length)||'/'
  const parsedSuffix=new URL(suffix,'http://local')
  // An upstream launch token must never replace the backend-owned runtime credential.
  if(parsedSuffix.searchParams.has('token'))return reply.code(400).send({error:'无效连接参数'})
  if(!canManageHarness(req.user)){
   let envelope=req.body
   if(typeof envelope==='string'){try{envelope=JSON.parse(envelope)}catch{envelope=null}}
   const methods=[...(isHarnessStaticResource(req.method,suffix)?[]:[decodeURIComponent(parsedSuffix.pathname).replace(/^\/api\//,'')]),envelope?.method]
   if(methods.some(method=>isHarnessAdminRequest(method,envelope?.payload?.args,runtime.approvedPreset)))return reply.code(403).send({error:'仅 OA 超级管理员可管理 AI 助手设置'})
  }
  const maybeHtml=req.method==='GET'&&(parsedSuffix.pathname==='/'||parsedSuffix.pathname.endsWith('.html'))
  return new Promise((resolve,reject)=>{
   const h=headers(req.headers,runtime);if(maybeHtml)delete h['accept-encoding']
   const body=req.body?typeof req.body==='string'?req.body:JSON.stringify(req.body):null;if(body)h['content-length']=String(Buffer.byteLength(body));else delete h['content-length']
   const upstream=http.request(runtime.base+suffix,{method:req.method,headers:h},res=>{
    reply.code(res.statusCode||502)
    for(const [k,v]of Object.entries(res.headers))if(v&&!['set-cookie','connection','transfer-encoding','content-length'].includes(k))reply.header(k,v)
    reply.header('Cache-Control','private, no-store')
    if(maybeHtml&&res.statusCode===200&&String(res.headers['content-type']||'').includes('text/html')){
     const parts=[];res.on('data',c=>parts.push(c));res.on('error',reject);res.on('end',()=>{
      const html=Buffer.concat(parts).toString('utf8')
       .replace('<link rel="manifest" href="./manifest.webmanifest" />','<link rel="manifest" crossorigin="use-credentials" href="./manifest.webmanifest" />')
       .replace('<head>','<head>'+harnessBootstrap(req.user,runtime.model)+'<script src="./__ws/shim.js"></script>')
      reply.header('content-length',String(Buffer.byteLength(html)))
      resolve(reply.send(html))
     });return
    }
    resolve(reply.send(res))
   });upstream.on('error',reject);req.raw.on('close',()=>{if(req.raw.aborted)upstream.destroy()});upstream.end(body)
  })
 })

 app.server.on('upgrade',async(req,socket,head)=>{
  const match=req.url?.match(/^\/harness\/([a-f0-9-]{36})(\/.*)$/);if(!match){socket.destroy();return}
  try{
   const expected=new URL(process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180').origin
   if(req.headers.origin!==expected||new URL(match[2],'http://local').searchParams.has('token'))throw Error('来源不允许')
   const auth=await app.oaAuthenticate(req.headers)
   const runtime=await app.oaTasks.runtime(match[1],auth.user,auth.oa.token)
   const upstream=new WebSocket(runtime.base.replace(/^http/,'ws')+match[2],{headers:{cookie:runtime.cookie},perMessageDeflate:false})
   await new Promise((resolve,reject)=>{upstream.once('open',resolve);upstream.once('error',reject)})
   if(socket.destroyed){upstream.terminate();return}
   webSockets.handleUpgrade(req,socket,head,client=>{
    const timer=setInterval(async()=>{try{await app.oaTasks.runtime(match[1],auth.user,auth.oa.token)}catch{client.terminate();upstream.terminate()}},2000);timer.unref()
    const close=()=>{clearInterval(timer);client.terminate();upstream.terminate()}
    client.on('error',close);upstream.on('error',close);client.on('close',close);upstream.on('close',()=>{clearInterval(timer);client.close()})
    client.on('message',async(data,binary)=>{
     try{const fresh=await app.oaAuthenticate(req.headers);await app.oaTasks.runtime(match[1],fresh.user,fresh.oa.token)
      if(!canManageHarness(fresh.user)&&!harnessFrameAllowed(data,binary,runtime.approvedPreset)){const rejection=harnessFrameRejection(data,binary);if(rejection)client.send(JSON.stringify(rejection));else client.close(1008,'AI 配置由管理员管理');return}
      if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary})
     }catch{close()}
    })
    upstream.on('message',(data,binary)=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary})})
   })
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')}
 })
}
