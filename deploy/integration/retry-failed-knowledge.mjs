// Targeted repair: never creates publication records or changes library authorization.
// GATEWAY_ENV=... node retry-failed-knowledge.mjs [--execute --expected-count=26 --report=/private/path.json]
import '../../case-service/src/load-env.js'
import {KnowledgePublication} from '../../case-service/src/knowledge-publication.js'
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
const kb = new KnowledgePublication(process.env.DATA_DIR || fileURLToPath(new URL('../../data/integration',import.meta.url)))
const execute = process.argv.includes('--execute')
const expected = Number(process.argv.find(a=>a.startsWith('--expected-count='))?.split('=')[1])
const report = process.argv.find(a=>a.startsWith('--report='))?.slice('--report='.length)
if(execute&&(!report||!Number.isSafeInteger(expected)||expected<1))throw Error('执行须提供预期数量和私有报告路径')
const rows=[]
for(const id of Object.keys(kb.acl.read()))for(let page=1;;page++){
 const result=await kb.native(`/knowledge-bases/${id}/knowledge?page=${page}&page_size=200`)
 const items=Array.isArray(result.data)?result.data:result.data?.items||[]
 rows.push(...items.filter(n=>n.parse_status==='failed'&&n.error_message==='UNIQUE constraint failed: chunks.seq_id'))
 if(items.length<200)break
}
console.log(JSON.stringify({matchingFailures:rows.length,execute}))
if(!execute)process.exit(0)
if(rows.length!==expected)throw Error('失败数量已变化，请重新检查后再执行')
const results=[]
const hashOriginal=async id=>{
 const response=await kb.native('/knowledge/'+id+'/download',{raw:true}),hash=createHash('sha256')
 for await(const part of response.body)hash.update(part)
 return hash.digest('hex')
}
for(const row of rows){
 const record={id:row.id,kbId:row.knowledge_base_id,name:row.file_name||row.title,before:row.parse_status,errorBefore:row.error_message}
 results.push(record)
 try{
  // A tracked document requires the normal publication workflow to hide it before re-indexing.
  if(Object.values(kb.store.read()).some(s=>s.nativeId===row.id))throw Error('该资料已有审核记录，须通过工作台重试')
  record.sha256Before=await hashOriginal(row.id)
  await kb.native('/knowledge/'+row.id+'/reparse',{method:'POST',body:{}})
  for(let attempt=0;attempt<120;attempt++){
   await delay(1500)
   const result=await kb.native('/knowledge/'+row.id),current=result.data||result
   record.after=current.parse_status
   if(current.parse_status==='failed')throw Error(String(current.error_message||'解析失败').slice(0,500))
   if(current.parse_status==='completed')break
  }
  if(record.after!=='completed')throw Error('等待解析超时，保留资料供后续检查')
  record.sha256After=await hashOriginal(row.id)
  if(record.sha256Before!==record.sha256After)throw Error('原件校验不一致')
  const chunks=await kb.native(`/chunks/${row.id}?page=1&page_size=1`)
  record.hasChunks=(Array.isArray(chunks.data)?chunks.data:chunks.data?.items||[]).length>0
  if(!record.hasChunks)throw Error('解析结束但无分块，需要检查')
  record.ok=true
 }catch(error){record.error=error.message;record.ok=false}
 await writeFile(report,JSON.stringify(results,null,2),{mode:0o600})
 console.log(JSON.stringify({processed:results.length,total:rows.length,id:row.id,status:record.after,ok:record.ok,error:record.error}))
}
if(results.some(r=>!r.ok))process.exitCode=1
