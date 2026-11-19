import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {BusinessPresets,catalog,registerPresetRoutes} from '../src/business-presets.js'
import {KnowledgePublication} from '../src/knowledge-publication.js'
import {OaTasks} from '../src/oa-tasks.js'
import Fastify from 'fastify'

async function setup(t){
 const root=await mkdtemp(path.join(tmpdir(),'oa-preset-test-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const knowledge=new KnowledgePublication(root)
 knowledge.acl.update(s=>{s.law={name:'法律法规库',readers:[],reviewers:['u']};s.clinical={name:'临床',readers:[],reviewers:[]}})
 const base={connection:'fixture',model:'standard'},policy={localOnly:false,view:()=>({version:1}),snapshot:()=>({primary:base,model:base.model,network:true,inherit:true}),connections:{resolve:r=>{if(r.connection!=='fixture')throw Error('连接已停用')},list:()=>({active:[]})}}
 const business=new BusinessPresets(root,knowledge,policy)
 const change=(kinds,other={})=>({id:'u',...business.account('u'),kinds,defaultKind:kinds[0]||null,...other})
 const apply=c=>{const plan=business.prepare([c]);business.save(plan,plan.confirmation,'admin')}
 return {root,business,knowledge,policy,change,apply}
}
test('两项独立授权、撤销和默认值；原审核权与个人阅读权分别保留',async t=>{
 const {business:b,change,apply,knowledge}=await setup(t)
 assert.equal(b.choices({id:'new'}).items.length,0)
 for(const kinds of [['disability'],['injury'],['injury','disability'],['disability']]){
  apply(change(kinds,{readers:['law']}))
  for(const k of ['injury','disability']){
   if(kinds.includes(k))assert.doesNotThrow(()=>b.require('u',k))
   else assert.throws(()=>b.require('u',k),e=>e.statusCode===403)
  }
  assert.equal(b.choices({id:'u'}).defaultKind,kinds[0])
 }
 assert.deepEqual(knowledge.acl.read().law.reviewers,['u'])
 assert.throws(()=>b.prepare([change(['injury','disability'],{defaultKind:'unknown'})]))
 const plan=b.prepare([change([], {readers:[]})]);assert.throws(()=>b.save(plan,'incorrect','admin'))
 apply(change([],{readers:[]}));assert.deepEqual(knowledge.libraries('u',[]),[])
 assert.equal(knowledge.libraries('u',['knowledge.review']).length,1)
})
test('模型优先级、三方知识库交集、独立发布回退和不可变旧版本',async t=>{
 const {business:b,change,apply}=await setup(t)
 apply(change(['injury','disability'],{readers:['law','clinical']}))
 const initial=b.resolve('u','injury',[]);assert.equal(initial.source,'全所默认')
 const updated=b.publish('injury',{...initial.preset,allowed:['clinical'],recommended:[],primary:{connection:'fixture',model:'professional'}},'admin')
 assert.equal(updated.version,2);assert.equal(b.definition('disability').version,1)
 assert.deepEqual(b.resolve('u','injury',[]).available.map(k=>k.id),['clinical'])
 assert.equal(b.resolve('u','injury',[]).source,'预设策略')
 apply(change(['injury','disability'],{exceptions:{injury:{connection:'fixture',model:'personal'}}}))
 assert.equal(b.resolve('u','injury',[]).aiPolicy.primary.model,'personal')
 assert.equal(b.resolve('u','disability',[]).aiPolicy.primary.model,'standard')
 assert.equal(b.publish('injury',{version:2,rollback:1},'admin').version,3)
 assert.deepEqual(b.definition('injury',2),updated)
 assert.throws(()=>b.publish('injury',{version:2,rollback:1},'admin'),e=>e.statusCode===409)
 const stale=change(['injury']);apply(change(['disability'],{exceptions:{}}));assert.throws(()=>b.prepare([stale]),e=>e.statusCode===409)
})
test('用户身份先于创建、启动和在办访问；相同材料的两个专项具有不同工具与结论',async t=>{
 const {business,knowledge,policy,root,change,apply}=await setup(t)
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old})
 globalThis.fetch=async url=>{
  const info=String(url).includes('/versions')?[{version:1,name:'相同脱敏材料.txt',sha256:'sample'}]:{id:'u',permissions:[]}
  return Response.json({code:200,data:info})
 }
 const tasks=new OaTasks(root,knowledge,policy,business),user={id:'oa-u',oaUserId:'u'}
 const uploaded=[{fileId:'file',version:1,sha256:'sample'}]
 for(const kind of ['injury','disability']){
  apply(change([kind]))
  const r=business.resolve('u',kind,[]),task=await tasks.create(user,'fixture',{kind,inputs:[],knowledgeBases:[]})
  tasks.update(task.id,{inputs:uploaded,businessSnapshot:r.preset})
  await tasks.validate(tasks.get(task.id,user.id),'fixture')
  assert.equal(r.preset.outputs,kind==='disability');assert.equal(r.preset.runtime,'injury')
  assert.equal(r.preset.agent,kind==='injury'?'injury-qa':'injury')
  assert.ok(r.preset.conclusion.includes(kind==='injury'?'损伤程度':'伤残等级'))
  apply(change([kind==='injury'?'disability':'injury']))
  await assert.rejects(tasks.create(user,'fixture',{kind,inputs:[]}),e=>e.statusCode===403)
  await assert.rejects(tasks.start(task.id,user,'fixture'),e=>e.statusCode===403)
  await assert.rejects(tasks.runtime(task.id,user,'fixture'),e=>e.statusCode===403)
 }
})
test('普通用户及仅有审核权者不能预览或更改他人配置、发布预设或暂停工具',async t=>{
 const {business}=await setup(t),app=Fastify();t.after(()=>app.close())
 app.addHook('preHandler',async req=>{req.oa={id:'u',permissions:['knowledge.review'],isSystemSuperAdmin:false}})
 registerPresetRoutes(app,business)
 for(const [method,url] of [['GET','/api/business-presets'],['POST','/api/business-grants/preview'],['POST','/api/business-grants/save'],['POST','/api/business-presets/injury/publish'],['POST','/api/business-presets/disability/pause']]){
  assert.equal((await app.inject({method,url})).statusCode,403)
 }
 assert.equal((await app.inject('/api/my-presets')).statusCode,200)
})
test('纯本地检索只读取已发布授权片段，标注版本及段落并实时检查撤权',async t=>{
 const {root,knowledge}=await setup(t);await mkdir(path.join(root,'weknora'))
 const db=new DatabaseSync(path.join(root,'weknora','weknora.db'))
 db.exec("CREATE TABLE chunks(id,knowledge_id,knowledge_base_id,chunk_index,content,is_enabled,deleted_at); INSERT INTO chunks VALUES('c','published','law',3,'合成材料关键词',1,NULL),('h','unpublished','law',2,'关键词',1,NULL)")
 db.close()
 knowledge.acl.update(s=>{s.law.readers=['u']})
 knowledge.store.update(s=>{s.doc={kbId:'law',nativeId:'published',status:'PUBLISHED',source:{version:7,name:'验收样例'}}})
 const {data}=await knowledge.searchLocal('law','u',[],'关键词')
 assert.equal(data.length,1);assert.equal(data[0].paragraph,4);assert.equal(data[0].version,7)
 knowledge.acl.update(s=>{s.law.readers=[]})
 await assert.rejects(knowledge.searchLocal('law','u',[],'关键词'),e=>e.statusCode===403)
})
test('专项运行预设确有独立声明及部署技能；伤情不注册文书、Shell 或写文件工具',async ()=>{
 const p=catalog.find(p=>p.id==='injury'),declaration=await readFile(new URL('../../package/injury-qa/agent.cordis.yml',import.meta.url),'utf8')
 assert.equal(p.templates.length,0);assert.match(declaration,/tool-oa-knowledge/);assert.doesNotMatch(declaration,/fill-report|tool-bash|tool-fs|tool-pwsh/)
 for(const [id,n] of [['disability',3],['malpractice',18],['traffic',30]])assert.equal(catalog.find(p=>p.id===id).skills.length,n)
})
test('医疗损害七章和交通事故 HTML 模板可用同一脱敏材料独立出件并定位依据',async t=>{
 const {writeReportPair,CHAPTER_KEYS}=await import('../../package/medical-review/fill-docx.mjs')
 const dir=await mkdtemp(path.join(tmpdir(),'oa-professional-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const citation='【合成材料 A · v1 · 第 2 段】'
 const fields=Object.fromEntries(CHAPTER_KEYS.map((k,i)=>[k,`第 ${i+1} 章校对 ${citation}`]))
 const {mdPath}=await writeReportPair(fields,dir),report=await readFile(mdPath,'utf8')
 assert.equal(CHAPTER_KEYS.length,7);for(const v of Object.values(fields))assert.ok(report.includes(v))
 const html=await readFile(new URL('../../package/traffic-accident/.agents/skills/traffic-report-writing/report_render.html',import.meta.url),'utf8')
 const output=html.replaceAll('{{鉴定材料}}',citation)
 await writeFile(path.join(dir,'交通样例.html'),output)
 assert.ok(output.includes(citation));assert.match(output,/交通事故鉴定咨询意见/)
})
test('管理员预览及批量保存后回读与普通账号的实际任务策略一致，审核人保留',async t=>{
 const {business,knowledge}=await setup(t),app=Fastify(),original=globalThis.fetch
 t.after(()=>{globalThis.fetch=original;return app.close()})
 globalThis.fetch=async()=>Response.json({code:200,data:[{id:'u',smartCaseEligible:true,canReviewKnowledge:true},{id:'v',smartCaseEligible:true},{id:'off',smartCaseEligible:false}]})
 app.addHook('preHandler',async req=>{req.oa={id:req.headers['x-fixture-admin']?'admin':'u',isSystemSuperAdmin:!!req.headers['x-fixture-admin'],permissions:['knowledge.review']}})
 registerPresetRoutes(app,business)
 const post=(action,payload)=>app.inject({method:'POST',url:'/api/business-grants/'+action,headers:{'x-fixture-admin':'yes'},payload})
 const changes=['u','v'].map(id=>({id,...business.account(id),kinds:['injury','disability'],readers:['clinical'],defaultKind:'injury',exceptions:{injury:{connection:'fixture',model:'pilot'}}}))
 const preview=await post('preview',{changes});assert.equal(preview.statusCode,200,preview.body)
 const p=preview.json(),saved=await post('save',{changes,confirmation:p.confirmation})
 assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().accounts.length,2)
 assert.equal((await post('save',{changes,confirmation:p.confirmation})).statusCode,409)
 const mine=(await app.inject('/api/my-presets')).json(),injury=mine.items.find(k=>k.id==='injury')
 assert.equal(mine.defaultKind,'injury');assert.equal(injury.model,'pilot')
 const adminPreview=p.effective[0].items.find(i=>i.name==='伤情鉴定')
 assert.deepEqual(injury.available.map(k=>k.id),adminPreview.available)
 assert.deepEqual(knowledge.acl.read().law.reviewers,['u'])
 assert.equal((await post('preview',{changes:[{...changes[0],id:'off'}]})).statusCode,400)
})
