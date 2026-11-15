import http from 'node:http'
import net from 'node:net'
function headers(input,runtime){const result={...input,host:new URL(runtime.base).host,cookie:runtime.cookie};for(const h of ['authorization','origin','referer','x-forwarded-host','x-forwarded-for','x-forwarded-proto'])delete result[h];return result}
export async function registerHarnessProxy(app){
 app.all('/harness/:id/*',async(req,reply)=>{
  const runtime=await app.oaTasks.runtime(req.params.id,req.user,req.oa.token)
  const suffix=req.url.slice(('/harness/'+req.params.id).length)||'/'
  // An upstream launch token must never replace the backend-owned runtime credential.
  if(new URL(suffix,'http://local').searchParams.has('token'))return reply.code(400).send({error:'无效连接参数'})
  return new Promise((resolve,reject)=>{
   const h=headers(req.headers,runtime);const body=req.body?typeof req.body==='string'?req.body:JSON.stringify(req.body):null;if(body)h['content-length']=String(Buffer.byteLength(body));else delete h['content-length']
   const upstream=http.request(runtime.base+suffix,{method:req.method,headers:h},res=>{reply.code(res.statusCode||502);for(const [k,v]of Object.entries(res.headers))if(v&&!['set-cookie','connection','transfer-encoding','content-length'].includes(k))reply.header(k,v);reply.header('Cache-Control','private, no-store');resolve(reply.send(res))});upstream.on('error',reject);req.raw.on('close',()=>{if(req.raw.aborted)upstream.destroy()});upstream.end(body)
  })
 })
 app.server.on('upgrade',async(req,socket,head)=>{
  const match=req.url?.match(/^\/harness\/([a-f0-9-]{36})(\/.*)$/);if(!match){socket.destroy();return}
  try{const expected=new URL(process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180').origin;if(req.headers.origin!==expected)throw Error('来源不允许')
   const auth=await app.oaAuthenticate(req.headers);const runtime=await app.oaTasks.runtime(match[1],auth.user,auth.oa.token),url=new URL(runtime.base)
   const upstream=net.connect(Number(url.port),url.hostname);const timer=setInterval(async()=>{try{await app.oaTasks.runtime(match[1],auth.user,auth.oa.token)}catch{socket.destroy();upstream.destroy()}},2000);timer.unref()
   const close=()=>{clearInterval(timer);socket.destroy();upstream.destroy()};upstream.on('error',close);socket.on('error',close);socket.on('close',close);upstream.on('close',()=>{clearInterval(timer);socket.destroy()});
   upstream.on('connect',()=>{const h=headers(req.headers,runtime);upstream.write(`${req.method} ${match[2]} HTTP/1.1\r\n`+Object.entries(h).filter(([,v])=>v!=null).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket)})
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy()}
 })
}
