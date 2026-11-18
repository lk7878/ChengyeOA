import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {Store} from './atomic-store.js'
import {oa} from './oa-client.js'
export async function registerKnowledgeAccess(app){
 const events=new Store(path.join(process.env.DATA_DIR,'knowledge-access-audit.json'))
 const guard=req=>{if(!req.oa.isSystemSuperAdmin)throw Object.assign(Error('仅超级管理员可配置目标知识库授权'),{statusCode:403})}
 app.get('/api/kb-access',async req=>{guard(req);return {libraries:Object.entries(app.oaKnowledge.acl.read()).map(([id,v])=>({id,...v})),users:await oa(req.oa.token,'/smart-case/directory')}})
 app.post('/api/kb-access/:id',async req=>{guard(req);const body=req.body;if(!Array.isArray(body.readers)||!Array.isArray(body.reviewers))throw Error('授权人员格式无效');const users=await oa(req.oa.token,'/smart-case/directory'),ids=new Set(users.map(u=>u.id));if([...body.readers,...body.reviewers].some(id=>!ids.has(id)))throw Error('授权人员不存在或已停用');const before=app.oaKnowledge.acl.read()[req.params.id];if(!before)throw Error('知识库不存在');if((before.version||0)!==body.version)throw Object.assign(Error('授权已被其他操作更新，请刷新'),{statusCode:409});await oa(req.oa.token,'/smart-case/knowledge-reviewers/ensure',{method:'POST',body:{userIds:body.reviewers}});const next={...before,readers:[...new Set(body.readers)],reviewers:[...new Set(body.reviewers)],version:(before.version||0)+1};app.oaKnowledge.acl.update(data=>{if((data[req.params.id]?.version||0)!==body.version)throw Object.assign(Error('授权已更新，请刷新后重试'),{statusCode:409});data[req.params.id]=next});events.update(data=>{data[randomUUID()]={actor:req.oa.id,kbId:req.params.id,before,after:next,at:new Date().toISOString()}});return {ok:true}})
}
