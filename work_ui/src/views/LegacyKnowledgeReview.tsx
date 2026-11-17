import {useEffect,useState} from 'react'
import {api} from '@/api/integration'
import type {Library} from './KnowledgeOverview'

type Legacy={id:string;name:string;size:number;parseStatus:string;revision:string;status:string;submissionId?:string;error?:string}
const statuses:Record<string,string>={UNREVIEWED:'尚未审核发布',PENDING:'待审核',APPROVED:'已批准',INDEXING:'索引中',PUBLISHED:'已发布',REJECTED:'已拒绝',WITHDRAWN:'已下架',IMPORT_FAILED:'索引失败',IMPORTING:'导入中'}
const labels={source:'已核对资料来源及使用权限',quality:'已检查原文与解析内容质量',duplicates:'已检查重复资料',privacy:'已完成隐私及脱敏检查'}
const emptyChecks=()=>({source:false,quality:false,duplicates:false,privacy:false})

export function LegacyKnowledgeReview({lib,onChanged}:{lib:Library;onChanged:()=>Promise<void>}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<{items:Legacy[];total:number}>({items:[],total:0})
 const [selected,setSelected]=useState<Legacy>(),[checks,setChecks]=useState(emptyChecks),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 useEffect(()=>{setPage(1);setSelected(undefined);setData({items:[],total:0});setError('');setNotice('')},[lib.id])
 useEffect(()=>{
  let active=true;setLoading(true)
  void api<typeof data>(`/api/kb/${lib.id}/legacy?page=${page}`).then(r=>{if(active)setData(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[lib.id,lib.count,page,revision])
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();setRevision(n=>n+1);await onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const approve=async()=>{
  if(!selected||!Object.values(checks).every(Boolean))return
  const row=await api<{id:string}>(`/api/kb/${lib.id}/legacy/${selected.id}/register`,{revision:selected.revision})
  await api(`/api/submissions/${row.id}/review`,{decision:'approve',checks})
  setSelected(undefined);setNotice('审核已批准，系统将在索引状态确认后自动发布。')
 }
 return <section className="oa-panel" aria-label="历史资料审核发布"><div className="oa-actions"><h2>历史资料审核发布 · {lib.name}</h2><button disabled={busy||loading} onClick={()=>setRevision(n=>n+1)}>刷新历史资料</button></div>
  <p>这里列出知识库中已上传的资料。解析成功不代表已发布；请核对原文与解析内容，完成四项检查后再批准。发布后仍仅限逐人授权的用户查看。</p>
  <p role="status">{loading?'正在读取…':`共 ${data.total} 份已有资料 · 第 ${page} 页`}</p>
  {error&&<p role="alert" className="oa-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!loading&&!data.items.length&&<p>暂无历史资料。</p>}
  {!loading&&data.items.map(row=><article key={row.id} className="kb-reading"><h3>{row.name}</h3><p>{Math.ceil((row.size||0)/1024)} KB · {row.parseStatus==='completed'?'解析成功':row.parseStatus==='failed'?'解析失败':'解析处理中'} · {statuses[row.status]||row.status}</p>{row.error&&<p className="oa-error">{row.error}</p>}
   <div className="oa-actions"><a target="_blank" rel="noreferrer" href={`/knowledge-native/api/v1/knowledge/${row.id}/download`}>查看原文</a><a target="_blank" rel="noreferrer" href="/knowledge-native/">查看解析内容</a>
    {['UNREVIEWED','PENDING','REJECTED','WITHDRAWN','IMPORT_FAILED'].includes(row.status)&&row.parseStatus==='completed'&&<button disabled={busy} onClick={()=>{setSelected(row);setChecks(emptyChecks());setError('');setNotice('')}}>审核发布</button>}
    {row.parseStatus==='failed'&&row.status==='UNREVIEWED'&&<button disabled={busy} onClick={()=>void run(async()=>{await api(`/api/kb/${lib.id}/legacy/${row.id}/reparse`,{});setNotice('已提交重新解析，请稍后刷新；成功后仍需审核发布。')})}>重新解析</button>}
   </div>
   {selected?.id===row.id&&<fieldset disabled={busy}><legend>审核确认：{row.name}</legend>{(Object.keys(labels) as (keyof typeof labels)[]).map(key=><label key={key} style={{display:'block',margin:'10px 0'}}><input type="checkbox" checked={checks[key]} onChange={e=>setChecks(c=>({...c,[key]:e.target.checked}))}/> {labels[key]}</label>)}<div className="oa-actions"><button disabled={!Object.values(checks).every(Boolean)} onClick={()=>void run(approve)}>批准并发布</button><button onClick={()=>setSelected(undefined)}>取消</button></div></fieldset>}
  </article>)}
  <div className="oa-actions"><button disabled={busy||loading||page<=1} onClick={()=>{setSelected(undefined);setPage(p=>p-1)}}>上一页</button><button disabled={busy||loading||page*20>=data.total} onClick={()=>{setSelected(undefined);setPage(p=>p+1)}}>下一页</button></div>
 </section>
}
