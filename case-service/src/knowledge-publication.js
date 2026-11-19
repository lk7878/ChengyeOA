import {randomUUID,createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createWriteStream,createReadStream,openAsBlob} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {Store} from './atomic-store.js'
import {oa} from './oa-client.js'
import {reconcilePublications,legacyDocuments,registerLegacy,reparseLegacy} from './knowledge-lifecycle.js'
const fail=(message,statusCode=403)=>{throw Object.assign(new Error(message),{statusCode})}
export class KnowledgePublication {
 constructor(root,{nativeApi}={}){this.root=root;this.store=new Store(path.join(root,'submissions.json'));this.acl=new Store(path.join(root,'knowledge-acl.json'));this.nativeApi=nativeApi||this.native.bind(this);this.busy=new Set()}
 libraries(user,permissions=[]){return Object.entries(this.acl.read()).filter(([,v])=>v.readers?.includes(user)||v.reviewers?.includes(user)&&permissions.includes('knowledge.review')).map(([id,v])=>({id,name:v.name,canReview:permissions.includes('knowledge.review')&&v.reviewers?.includes(user)}))}
 authorize(kbId,user,permission='read',permissions=[]){const lib=this.acl.read()[kbId];if(!lib)fail('知识库未授权');if(permission==='review'){if(!permissions.includes('knowledge.review')||!lib.reviewers?.includes(user))fail('无该库审核权限')}else if(!lib.readers?.includes(user)&&!(permissions.includes('knowledge.review')&&lib.reviewers?.includes(user)))fail('知识库未授权');return lib}
 async native(route,{method='GET',body,raw=false,signal}={}){if(!process.env.WEKNORA_API_KEY)fail('知识服务尚未配置',503);const response=await fetch((process.env.WEKNORA_BASE||'http://127.0.0.1:8090')+'/api/v1'+route,{method,headers:{'X-API-Key':process.env.WEKNORA_API_KEY,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body?body instanceof FormData?body:JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});if(response.status===409&&method==='POST'&&route.endsWith('/knowledge/file')){const duplicate=await response.json();if(duplicate.code==='duplicate_file')return duplicate;fail('知识导入冲突，请检查重复材料',409)}if(!response.ok)fail('知识服务失败：'+response.status,502);return raw?response:response.json()}
 published(kbId,user,permissions=[]){this.authorize(kbId,user,'read',permissions);return Object.values(this.store.read()).filter(s=>s.kbId===kbId&&s.status==='PUBLISHED'&&s.nativeId)}
 overview(user,permissions=[]){return this.libraries(user,permissions).map(lib=>({...lib,count:this.published(lib.id,user,permissions).length,description:this.acl.read()[lib.id].description||''}))}
 documents(kbId,user,permissions,query='',page=1){
  const rows=this.published(kbId,user,permissions).filter(s=>String(s.source?.name||'').toLocaleLowerCase().includes(String(query).slice(0,200).toLocaleLowerCase())).sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
  page=Math.max(1,Number.isSafeInteger(Number(page))?Number(page):1);const pageSize=10;
  page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
  return {total:rows.length,page,pageSize,items:rows.slice((page-1)*pageSize,page*pageSize).map(s=>({id:s.id,name:s.source?.name||'知识文档',size:s.source?.size||0,version:s.source?.version||1,publishedAt:s.publishedAt}))};
 }
 async document(kbId,id,user,permissions,page=1){
  const get=()=>this.published(kbId,user,permissions).find(s=>s.id===id);
  const row=get();if(!row)fail('知识未发布或已下架',404);
  page=Math.max(1,Number.isSafeInteger(Number(page))?Number(page):1);
  const result=await this.nativeApi(`/chunks/${encodeURIComponent(row.nativeId)}?page=${page}&page_size=25`);
  if(!get())fail('知识未发布或已下架',404);
  const rows=Array.isArray(result.data)?result.data:result.data?.items||[];
  return {name:row.source?.name,page,hasMore:rows.length===25,items:rows.filter(c=>c.is_enabled!==false&&(!c.knowledge_id||c.knowledge_id===row.nativeId)).map(c=>({content:String(c.content||'')}))};
 }
 async submit(actor,token,input){this.authorize(input.kbId,actor.id,'review',actor.permissions);const id=randomUUID();const p=await oa(token,`/personal-files/${encodeURIComponent(input.fileId)}/publication?version=${input.version}`);if(!p.canPublish)fail('只有阅读权，不能投稿');const versions=await oa(token,`/personal-files/${encodeURIComponent(input.fileId)}/versions`),v=versions.find(x=>x.version===input.version);if(!v)fail('版本不存在',404);const source={fileId:input.fileId,...v};const dir=path.join(this.root,'submission-files');await mkdir(dir,{recursive:true,mode:0o700});const response=await oa(token,`/personal-files/${input.fileId}/versions/${input.version}/content`,{raw:true});await pipeline(response.body,createWriteStream(path.join(dir,id),{flags:'wx',mode:0o600}));const h=createHash('sha256');for await(const b of createReadStream(path.join(dir,id)))h.update(b);if(h.digest('hex')!==v.sha256)fail('投稿快照校验失败',409);const row={id,kbId:input.kbId,owner:actor.id,source,status:'PENDING',createdAt:new Date().toISOString(),checks:null};this.store.update(data=>{data[id]=row});return row}
 list(actor){return Object.values(this.store.read()).filter(s=>s.owner===actor.id||this.libraries(actor.id,actor.permissions).some(k=>k.id===s.kbId&&k.canReview))}
 review(id,actor,input){const s=this.store.read()[id];if(!s)fail('投稿不存在',404);this.authorize(s.kbId,actor.id,'review',actor.permissions);if(!['PENDING','REJECTED'].includes(s.status))fail('状态已改变',409);if(!['approve','reject'].includes(input.decision))fail('审核决定无效',400);if(input.decision==='approve'&&!['source','quality','duplicates','privacy'].every(k=>input.checks?.[k]===true))fail('须完成来源、质量、重复与隐私脱敏检查',400);return this.store.update(data=>Object.assign(data[id],{status:input.decision==='approve'?'APPROVED':'REJECTED',reviewer:actor.id,reviewedAt:new Date().toISOString(),approvedRevision:s.revision||0,checks:input.checks||{},reason:String(input.reason||'').slice(0,2000)}))}
 async publish(id,actor){let s=this.store.read()[id];if(!s)fail('投稿不存在',404);this.authorize(s.kbId,actor.id,'review',actor.permissions);if(!['APPROVED','IMPORTING','INDEXING','IMPORT_FAILED'].includes(s.status))fail('未批准或已经发布',409);if(this.busy.has(id))fail('正在处理',409);this.busy.add(id);const revision=s.revision||0
  try{if(!s.nativeId){const fileName=`submission-${s.id}-${s.source.name}`;
    // Reconcile a lost upstream upload response before retrying; duplicates never become published twice.
    let native;for(let page=1;!native;page++){const list=await this.nativeApi(`/knowledge-bases/${encodeURIComponent(s.kbId)}/knowledge?page=${page}&page_size=200`);const rows=Array.isArray(list.data)?list.data:list.data?.items||[];native=rows.find(r=>r.file_name===fileName||r.title===fileName);if(rows.length<200)break;}
    if(!native){this.store.update(data=>{data[id].status='IMPORTING'});const form=new FormData();form.append('file',await openAsBlob(path.join(this.root,'submission-files',id)),fileName);form.append('fileName',fileName);const response=await this.nativeApi(`/knowledge-bases/${encodeURIComponent(s.kbId)}/knowledge/file`,{method:'POST',body:form});native=response.data||response;if(response.code==='duplicate_file'){if(native.knowledge_base_id!==s.kbId)fail('重复知识不属于目标库',409);const original=await this.nativeApi('/knowledge/'+native.id+'/download',{raw:true}),hash=createHash('sha256');for await(const part of original.body)hash.update(part);if(hash.digest('hex')!==s.source.sha256)fail('原生重复检测与投稿内容不一致，请检查材料',409)}}
    if(!native.id)fail('原生导入未返回标识',502);s=this.store.update(data=>Object.assign(data[id],{nativeId:native.id,status:'INDEXING'}))
   }
   if(s.status==='IMPORT_FAILED'){await this.nativeApi('/knowledge/'+encodeURIComponent(s.nativeId)+'/reparse',{method:'POST',body:{}});this.store.update(data=>{data[id].status='INDEXING';data[id].error=null})}
   const result=await this.nativeApi('/knowledge/'+encodeURIComponent(s.nativeId)),native=result.data||result;
   const liveActor=actor.token?await oa(actor.token,'/smart-case/me'):actor;this.authorize(s.kbId,liveActor.id,'review',liveActor.permissions);if(this.store.read()[id].status==='WITHDRAWN'||(this.store.read()[id].revision||0)!==revision)return this.store.read()[id];
   if(native.id&&native.id!==s.nativeId||native.knowledge_base_id&&native.knowledge_base_id!==s.kbId)fail('原生资料与审核记录不匹配',409);
   if(s.nativeFingerprint&&(native.file_hash!==s.nativeFingerprint.fileHash||native.updated_at!==s.nativeFingerprint.updatedAt))fail('历史资料已改变，需重新登记审核',409);
   if(native.parse_status==='failed'){this.store.update(data=>{data[id].status='IMPORT_FAILED'});fail('索引失败，未发布',502)}
   if(native.parse_status==='completed')this.store.update(data=>Object.assign(data[id],{status:'PUBLISHED',error:null,publishedAt:new Date().toISOString()}));
   return this.store.read()[id]
  }catch(e){this.store.update(data=>{data[id].error=e.message});throw e}finally{this.busy.delete(id)}
 }
 withdraw(id,actor){if(this.busy.has(id))fail('发布处理中，请稍后重试下架',409);const s=this.store.read()[id];if(!s)fail('投稿不存在',404);this.authorize(s.kbId,actor.id,'review',actor.permissions);return this.store.update(data=>Object.assign(data[id],{status:'WITHDRAWN',withdrawnAt:new Date().toISOString(),withdrawnBy:actor.id}))}
 async search(kbId,user,permissions,query,signal){this.authorize(kbId,user,'read',permissions);const published=Object.values(this.store.read()).filter(s=>s.kbId===kbId&&s.status==='PUBLISHED'&&s.nativeId);if(!published.length)return {data:[]};const ids=published.map(s=>s.nativeId);const result=await this.nativeApi(`/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`,{method:'POST',signal,body:{query_text:String(query).slice(0,8000),match_count:10,knowledge_ids:ids}});this.authorize(kbId,user,'read',permissions);const live=new Set(Object.values(this.store.read()).filter(s=>s.kbId===kbId&&s.status==='PUBLISHED').map(s=>s.nativeId));const rows=Array.isArray(result.data)?result.data:[];return {data:rows.filter(r=>live.has(r.knowledge_id)).map(r=>({...r,source:'WeKnora已发布知识'}))}}
}
export async function registerKnowledge(app){
 app.addHook('preHandler',async req=>{const p=req.url.split('?')[0];if((/^\/api\/submissions(?:\/|$)/.test(p)||/^\/api\/kb\/[^/]+\/legacy(?:\/|$)/.test(p))&&req.oa?.isSystemSuperAdmin!==true)fail('知识库维护仅对超级管理员开放')});
 const kb=new KnowledgePublication(process.env.DATA_DIR);app.decorate('oaKnowledge',kb);
 let pending,closing=false;
 const reconcile=()=>{if(closing)return;return pending ||= reconcilePublications(kb).catch(error=>app.log.error({message:error.message},'knowledge reconciliation failed')).finally(()=>{pending=null})};
 const timer=setInterval(()=>void reconcile(),15000);timer.unref();
 app.addHook('onReady',async()=>{void reconcile()});
 app.addHook('onClose',async()=>{closing=true;clearInterval(timer);await pending});
 app.get('/api/kb/:id/legacy',async req=>legacyDocuments(kb,req.params.id,req.oa,req.query.page));
 app.post('/api/kb/:id/legacy/:nativeId/register',async req=>{if(typeof req.body?.revision!=='string'||!req.body.revision)fail('请刷新历史资料后审核',400);return registerLegacy(kb,req.params.id,req.params.nativeId,req.oa,req.body.revision)});
 app.post('/api/kb/:id/legacy/:nativeId/reparse',async req=>reparseLegacy(kb,req.params.id,req.params.nativeId,req.oa));
 app.get('/api/kb',async req=>({items:kb.overview(req.oa.id,req.oa.permissions).map(k=>({...k,canReview:req.oa.isSystemSuperAdmin===true&&k.canReview}))}));app.get('/api/kb/:id/documents',async req=>kb.documents(req.params.id,req.oa.id,req.oa.permissions,req.query.query,req.query.page));app.get('/api/kb/:id/documents/:documentId',async req=>kb.document(req.params.id,req.params.documentId,req.oa.id,req.oa.permissions,req.query.page));app.get('/api/submissions',async req=>({items:kb.list(req.oa)}));app.post('/api/submissions',async req=>kb.submit(req.oa,req.oa.token,req.body));app.post('/api/submissions/:id/review',async req=>kb.review(req.params.id,req.oa,req.body));app.post('/api/submissions/:id/publish',async req=>kb.publish(req.params.id,req.oa));app.post('/api/submissions/:id/withdraw',async req=>kb.withdraw(req.params.id,req.oa));app.get('/api/submissions/:id/content',async(req,reply)=>{const row=kb.list(req.oa).find(s=>s.id===req.params.id);if(!row)fail('投稿不存在',404);kb.authorize(row.kbId,req.oa.id,'review',req.oa.permissions);reply.header('Cache-Control','private, no-store');reply.type('application/octet-stream');return reply.send(createReadStream(path.join(kb.root,'submission-files',row.id)))});app.post('/api/kb/:id/search',async req=>kb.search(req.params.id,req.oa.id,req.oa.permissions,req.body.query));return kb}
