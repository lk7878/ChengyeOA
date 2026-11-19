// Runs only SQLite reads over previously parsed, published local documents.
import {parentPort,workerData,Worker} from 'node:worker_threads'
import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
export function localSearch(file,kbId,published,query,signal){
 if(!published.length||!query.trim())return Promise.resolve([])
 signal?.throwIfAborted()
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{execArgv:[],workerData:{file,kbId,ids:published.map(p=>p.nativeId),query:query.trim().slice(0,500)}})
  const abort=()=>{void worker.terminate();reject(Error('本地检索已取消或超时'))}
  const timer=setTimeout(abort,20000)
  signal?.addEventListener('abort',abort,{once:true})
  worker.once('message',r=>r.ok?resolve(r.rows):reject(Error('本地解析索引不可用，请联系管理员')))
  worker.once('error',reject)
  worker.once('exit',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)})
 })
}
export function localIndexPath(root){return path.join(process.env.SMART_CASE_KNOWLEDGE_DATA||path.join(root,'weknora'),'weknora.db')}
if(parentPort&&workerData?.ids){
 let db
 try{
  db=new DatabaseSync(workerData.file,{readOnly:true})
  const rows=db.prepare(`SELECT id,knowledge_id,chunk_index,substr(content,max(1,instr(content,?)-200),1800) AS content
   FROM chunks WHERE knowledge_base_id=? AND deleted_at IS NULL AND is_enabled=1
   AND knowledge_id IN (SELECT value FROM json_each(?)) AND instr(content,?)>0
   ORDER BY knowledge_id,chunk_index,id LIMIT 10`).all(workerData.query,workerData.kbId,JSON.stringify(workerData.ids),workerData.query)
  parentPort.postMessage({ok:true,rows})
 }catch{parentPort.postMessage({ok:false})}finally{db?.close()}
}
