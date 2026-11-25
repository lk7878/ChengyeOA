import {registerBilling} from './billing-routes.js'
import './load-env.js'
import {registerAiPolicy} from './ai-policy.js'
import {modelConfig} from './model-config.js'
/** OA is the only identity and file authority. Legacy handlers are not mounted. */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {registerOa} from './oa-integration.js'
import {registerTaskUploads} from './task-uploads.js'
import {registerTasks} from './oa-tasks.js'
import {registerKnowledge} from './knowledge-publication.js'
import {registerKnowledgeAccess} from './knowledge-access.js'
import {registerNativeKnowledge} from './native-knowledge.js'
import {registerHarnessProxy} from './harness-proxy.js'
import {acquireWriter} from './writer-lock.js'
const root=fileURLToPath(new URL('../..',import.meta.url))
process.env.DATA_DIR ||= path.join(root,'data/integration')
const release=await acquireWriter(process.env.DATA_DIR)
const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.cookie'],serializers:{req:req=>({method:req.method,url:req.url?.split('?')[0]})}},bodyLimit:32*1024*1024})
app.decorateRequest('user',null);app.decorateRequest('oa',null)
await app.register(cors,{origin:process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180',credentials:true})
await registerOa(app);await registerKnowledge(app);await registerAiPolicy(app,()=>[...new Set([process.env.CHAT_MODEL,...(modelConfig?.provider.models||[]).map(m=>m.id)].filter(Boolean))],true,modelConfig?.imports);await registerBilling(app);await registerTasks(app);await registerTaskUploads(app);await registerHarnessProxy(app);await registerNativeKnowledge(app);await registerKnowledgeAccess(app)
app.get('/api/health',async()=>({ok:true,service:'oa-smart-case'}))
app.get('/api/me',async req=>({user:req.user}))
app.get('/api/users',async req=>({users:[req.user]}))
app.get('/api/llm/status',async req=>{const route=app.aiPolicy.snapshot('general').primary;return {configured:Boolean(route),...(req.user?.isSystemSuperAdmin?{model:route?.model||null}:{})}})
app.get('/api/cases',async req=>({cases:app.oaTasks.list(req.user.id).map(t=>({...t,stage:t.status==='RUNNING'?'processing':t.status==='READY'?'intake':'review',category:t.caseId?'OA关联案件':'个人任务',priority:'normal'}))}))
app.post('/api/auth/logout',async(req,reply)=>app.oaLogout(req,reply))
app.addHook('onClose',async()=>release())
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.oaTasks.close();app.server.closeAllConnections();void app.close().finally(()=>process.exit(0))})
await app.listen({port:Number(process.env.PORT||5181),host:'127.0.0.1'})
