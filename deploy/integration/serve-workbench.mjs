/** Production static entry with streaming HTTP and WebSocket forwarding. */
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
const root=fileURLToPath(new URL('../../work_ui/dist/',import.meta.url)),target=new URL(process.env.CASE_API_PROXY||'http://127.0.0.1:5181')
const proxyPath=url=>/^\/(api|harness|knowledge-native)(\/|$)/.test(url)
const server=http.createServer(async(req,res)=>{
 if(proxyPath(req.url)){const up=http.request(new URL(req.url,target),{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res)});up.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('服务暂不可用')});req.on('aborted',()=>up.destroy());req.pipe(up);return}
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
 try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);let file=path.resolve(root,'.'+name);if(file!==path.resolve(root)&&!file.startsWith(root)){res.writeHead(400);res.end();return}if(!path.extname(file))file=path.join(root,'index.html');const info=await stat(file);if(!info.isFile())throw Error();const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'content-type':mime,'content-length':info.size,'x-content-type-options':'nosniff','cache-control':file.endsWith('index.html')?'no-cache':'public, max-age=3600'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res)}catch{res.writeHead(404);res.end('页面不存在')}
})
server.on('upgrade',(req,socket,head)=>{if(!req.url.startsWith('/harness/')){socket.destroy();return}const up=net.connect(Number(target.port),target.hostname);up.on('connect',()=>{up.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)up.write(head);socket.pipe(up).pipe(socket)});up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());socket.on('close',()=>up.destroy());up.on('close',()=>socket.destroy())})
server.listen(Number(process.env.WORK_UI_PORT||5180),'127.0.0.1')
