import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import Fastify from 'fastify'
import WebSocket from '../../runtime/upstream/harness/node_modules/.pnpm/ws@8.21.3/node_modules/ws/index.js'
import {registerHarnessProxy} from '../src/harness-proxy.js'
import {harnessFrameAllowed,isHarnessAdminRequest} from '../src/harness-experience.js'

const rpc=(method,args={})=>JSON.stringify({type:'client-request',rpcId:'test',method,payload:{args}})
const taskId='00000000-0000-0000-0000-000000000001'
test('administration guard covers model, plugin, preset, slash-command and binary bypasses while allowing approved Skills',()=>{
 for(const method of ['pluginManager/install','pluginMarket/install','account/watch','credentials/set','session/selectModel','session/initializeDefaultModel','agentPresets/select','skills/install','schedules/create','schedule/delete','schedules/list'])assert.equal(harnessFrameAllowed(rpc(method)),false,method)
 assert.equal(harnessFrameAllowed(rpc('commands/execute',{line:'/permission danger-full-access'})),false)
 assert.equal(harnessFrameAllowed(rpc('session/create',{request:{agentPreset:'traffic-accident'}}),false,'general-legal'),false)
 assert.equal(harnessFrameAllowed(rpc('session/create',{request:{agentPreset:'general-legal'}}),false,'general-legal'),true)
 assert.equal(harnessFrameAllowed(rpc('skills/read',{name:'approved'})),true)
 assert.equal(harnessFrameAllowed(rpc('commands/execute',{line:'/approved-skill'})),true)
 assert.equal(harnessFrameAllowed(rpc('session/prompt')),true)
 assert.equal(harnessFrameAllowed(rpc('session/prompt'),true),false)
 assert.equal(harnessFrameAllowed('invalid'),false)
 assert.equal(isHarnessAdminRequest('/api/settings/mutate',{ns:'ui-theme'}),false)
})

test('HTTP, SSE and raw WebSocket use the same guard and existing connections stop after revocation',{timeout:20000},async t=>{
 const upstream=Fastify(),proxy=Fastify(),wss=new WebSocket.WebSocketServer({server:upstream.server}),seen=[]
 wss.on('connection',ws=>ws.on('message',data=>{seen.push(data.toString());ws.send(data.toString())}))
 upstream.post('/api/*',async()=>({ok:true}))
 const base=await upstream.listen({host:'127.0.0.1',port:0});let revoked=false,admin=false
 const auth=async()=>{if(revoked)throw Error('revoked');return {user:{id:'owner',isSystemSuperAdmin:admin},oa:{token:'synthetic'}}}
 proxy.decorate('oaAuthenticate',auth)
 proxy.decorate('oaTasks',{runtime:async()=>{if(revoked)throw Error('revoked');return {base,cookie:'test-only',approvedPreset:'general-legal'}}})
 proxy.addHook('preHandler',async req=>Object.assign(req,await auth()))
 await registerHarnessProxy(proxy)
 const proxyBase=await proxy.listen({host:'127.0.0.1',port:0}),prefix=proxyBase+'/harness/'+taskId
 const previous=process.env.WORKBENCH_PUBLIC_BASE;process.env.WORKBENCH_PUBLIC_BASE=proxyBase
 const abort=new AbortController()
 t.after(async()=>{abort.abort();for(const ws of wss.clients)ws.terminate();wss.close();await proxy.close();await upstream.close();if(previous===undefined)delete process.env.WORKBENCH_PUBLIC_BASE;else process.env.WORKBENCH_PUBLIC_BASE=previous})
 const blocked=await fetch(prefix+'/api/session/create',{method:'POST',headers:{'content-type':'application/json'},body:rpc('commands/execute',{line:'/permission danger-full-access'})})
 assert.equal(blocked.status,403);await blocked.body.cancel()
 const stream=await fetch(prefix+'/__ws/stream?path=%2Frpc',{signal:abort.signal}),reader=stream.body.getReader();let buffer='',cid
 while(!cid){const {value,done}=await reader.read();assert.equal(done,false);buffer+=new TextDecoder().decode(value);for(const line of buffer.split('\n'))if(line.startsWith('data: ')){const p=JSON.parse(line.slice(6));if(p.t==='open')cid=p.cid}}
 const send=frames=>fetch(prefix+'/__ws/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cid,frames})})
 const invalid=await send([{d:rpc('session/prompt')},{d:'invalid'}]);assert.equal(invalid.status,403);await invalid.body.cancel();assert.equal(seen.length,0,'malformed frames reject the whole batch')
 const deniedOpen=JSON.stringify({type:'open',streamId:'account-watch',endpoint:'account/watch',payload:{args:{}}})
 const deny=await send([{d:rpc('session/prompt')},{d:rpc('pluginManager/install')},{d:deniedOpen}]);assert.equal(deny.status,200);await deny.body.cancel()
 let rejected=false
 while(!rejected){const {value,done}=await reader.read();assert.equal(done,false);buffer+=new TextDecoder().decode(value);rejected=buffer.includes('FORBIDDEN')&&buffer.includes('account-watch')}
 assert.equal(seen.some(s=>s.includes('pluginManager/install')||s.includes('account/watch')),false,'denied RPC and subscriptions never reach upstream')
 const allow=await send([{d:rpc('skills/read')}]);assert.equal(allow.status,200);await allow.body.cancel()
 const socket=new WebSocket(prefix.replace(/^http/,'ws')+'/rpc',{origin:proxyBase});await once(socket,'open')
 let received=once(socket,'message');socket.send(rpc('session/prompt'));assert.equal((await received)[0].toString(),rpc('session/prompt'))
 received=once(socket,'message');socket.send(rpc('settings/mutate',{ns:'llm-pi-ai'}));assert.equal(JSON.parse((await received)[0]).result.error.code,'FORBIDDEN')
 received=once(socket,'message');socket.send(deniedOpen);const deniedStream=JSON.parse((await received)[0]);assert.equal(deniedStream.type,'error');assert.equal(deniedStream.streamId,'account-watch')
 received=once(socket,'message');socket.send(rpc('session/prompt'));assert.equal((await received)[0].toString(),rpc('session/prompt'),'normal conversation survives denied requests')
 socket.close()
 admin=true;const privileged=new WebSocket(prefix.replace(/^http/,'ws')+'/rpc',{origin:proxyBase});await once(privileged,'open')
 received=once(privileged,'message');privileged.send(rpc('settings/mutate',{ns:'llm-pi-ai'}));await received
 // Recheck identity per frame: removing superadmin while connection stays open must take effect.
 admin=false;received=once(privileged,'message');privileged.send(rpc('credentials/set'));assert.equal(JSON.parse((await received)[0]).result.error.code,'FORBIDDEN');privileged.close()
 const session=new WebSocket(prefix.replace(/^http/,'ws')+'/rpc',{origin:proxyBase});await once(session,'open')
 const lostEntry=once(session,'close');revoked=true;await lostEntry
 abort.abort()
})
