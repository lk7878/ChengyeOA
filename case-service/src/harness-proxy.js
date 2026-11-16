// Native Harness RPC exposes configuration, code execution and plugin installation.
// Managed task chat is the only supported runtime surface; never proxy arbitrary RPC.
export async function registerHarnessProxy(app){
 app.all('/harness/*',async(_req,reply)=>reply.code(410).send({error:'原生运行入口已停用，请返回智慧办案的任务对话。'}))
 app.server.on('upgrade',(req,socket)=>{if(req.url?.startsWith('/harness/'))socket.end('HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n')})
}
