import {useEffect,useState} from 'react'
import {api,type FileRow,type Version,type Task,TASK_STATES} from '@/api/integration'
import type {CaseKind} from '@/types'
const taskError=(message:string)=>message.startsWith('Harness 启动')?'AI 任务运行环境启动失败，请点击“启动任务”重试；若仍失败，请联系管理员。':message
export function TaskWorkbench({kind='general'}:{kind?:CaseKind}){
 const [tasks,setTasks]=useState<Task[]>([]),[files,setFiles]=useState<FileRow[]>([]),[scope,setScope]=useState('mine'),[folders,setFolders]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState<Record<string,Version[]>>({}),[inputs,setInputs]=useState<Record<string,number>>({}),[title,setTitle]=useState(''),[caseId,setCase]=useState(new URLSearchParams(window.location.search).get('caseId')||''),[cases,setCases]=useState<{id:string;caseNo:string;title:string;status:string}[]>([]),[kbs,setKbs]=useState<{id:string;name:string}[]>([]),[knowledge,setKnowledge]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const parent=folders.at(-1)?.id||''
 const [reload,setReload]=useState(0),[filesLoading,setFilesLoading]=useState(true),[filesError,setFilesError]=useState('')
 const refresh=async()=>{const result=await api<{items:Task[]}>('/api/tasks');setTasks(result.items);setCases(await api<typeof cases>('/api/oa/cases'))}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));void api<typeof cases>('/api/oa/cases').then(setCases).catch(()=>setCases([]));void api<{items:typeof kbs}>('/api/kb').then(r=>{const ordered=[...r.items].sort((a,b)=>Number(b.name==='法律法规库')-Number(a.name==='法律法规库'));setKbs(ordered);setKnowledge(ordered.filter(k=>k.name==='法律法规库').map(k=>k.id))}).catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),5000);return()=>clearInterval(timer)},[])
 useEffect(()=>{
  let active=true;setFilesLoading(true);setFilesError('');setFiles([])
  void api<{items:FileRow[]}>('/api/oa/files?'+new URLSearchParams({scope,...(parent?{parentId:parent}:{})}))
   .then(r=>{if(active)setFiles(r.items)}).catch(e=>{if(active)setFilesError(e.message)})
   .finally(()=>{if(active)setFilesLoading(false)})
  return()=>{active=false}
 },[scope,parent,reload])
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="oa-workspace">
  <section className="oa-panel"><h2>新建任务</h2><p>选取 OA 文件的具体版本。原件已保存不代表已解析，模型可读性由任务工具确认。AI 只使用本任务材料，生成成果自动保存到我的文件；正式归档需另行复核确认。</p>
  <div className="oa-fields"><label>任务名称<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：合同履行争议分析"/></label><label>关联 OA 案件<select value={caseId} onChange={e=>setCase(e.target.value)}><option value="">独立个人任务</option>{cases.map(c=><option key={c.id} value={c.id}>{c.caseNo} · {c.title} · {c.status}</option>)}</select></label></div>
  <div className="oa-actions"><select aria-label="文件范围" value={scope} onChange={e=>{setScope(e.target.value);setFolders([])}}><option value="mine">我的文件</option><option value="shared">共享给我的文件</option></select>
   <button disabled={!parent} onClick={()=>setFolders([])}>{parent?'返回根目录':'已在根目录'}</button>
   {parent&&<button onClick={()=>setFolders(p=>p.slice(0,-1))}>返回上级</button>}
   <button disabled={filesLoading} onClick={()=>setReload(v=>v+1)}>{filesLoading?'正在刷新…':'刷新文件'}</button>
   <span>文件请先上传到 OA 我的文件，再刷新列表</span></div>
  <nav className="oa-file-path" aria-label="当前文件目录"><span>{scope==='mine'?'我的文件':'共享给我的文件'} / </span><button disabled={!parent} onClick={()=>setFolders([])}>根目录</button>{folders.map((folder,index)=><span key={folder.id}> / <button disabled={index===folders.length-1} onClick={()=>setFolders(p=>p.slice(0,index+1))}>{folder.name}</button></span>)}</nav>
  <div className="oa-file-list" aria-busy={filesLoading}><p role="status">{filesLoading?'正在加载文件…':filesError?'':files.length===0?'此目录暂无可用文件；上传后点击“刷新文件”。':`已加载 ${files.length} 项`}</p>
   {filesError&&<p role="alert" className="oa-error">读取文件失败：{filesError}。请点击“刷新文件”重试。</p>}
   {files.map(f=><div key={f.id}>{f.kind==='FOLDER'?<button onClick={()=>setFolders(p=>[...p,{id:f.id,name:f.name}])}>📁 {f.name}</button>:<><label><input type="checkbox" checked={f.id in inputs} onChange={e=>{if(!e.target.checked){setInputs(prev=>{const next={...prev};delete next[f.id];return next});return}void api<Version[]>('/api/oa/files/'+f.id+'/versions').then(v=>{if(!v.length)throw Error('此文件暂无可用版本');setSelected(p=>({...p,[f.id]:v}));setInputs(p=>({...p,[f.id]:v[0].version}))}).catch(e=>setError(e.message))}}/>{f.name}</label>{f.id in inputs&&<select aria-label={f.name+'版本'} value={inputs[f.id]} onChange={e=>setInputs(p=>({...p,[f.id]:Number(e.target.value)}))}>{selected[f.id]?.map(v=><option key={v.version} value={v.version}>版本 {v.version} · {v.sha256.slice(0,10)}</option>)}</select>}</>}</div>)}</div>
  {kbs.length>0&&<fieldset><legend>本任务可用知识库</legend>{kbs.map(k=><label key={k.id}><input type="checkbox" checked={knowledge.includes(k.id)} onChange={e=>setKnowledge(p=>e.target.checked?[...p,k.id]:p.filter(x=>x!==k.id))}/>{k.name}</label>)}</fieldset>}
  <button className="oa-primary" disabled={busy||!title.trim()} onClick={()=>void run(async()=>{await api('/api/tasks',{title,kind,caseId:caseId||null,inputs:Object.entries(inputs).map(([fileId,version])=>({fileId,version})),knowledgeBases:knowledge});setTitle('');setInputs({})})}>创建任务 · 已选 {Object.keys(inputs).length} 个版本</button></section>
  {error&&<p role="alert" className="oa-error">{taskError(error)}</p>}
  <h2>我的任务</h2>{tasks.filter(t=>t.kind===kind).map(t=><section key={t.id} className="oa-panel"><h3>{t.title} <small>{TASK_STATES[t.status]||t.status}</small></h3><p>{t.inputs.map(i=>`${i.name}（v${i.version}）`).join('、')||'未选择材料'}</p>{t.error&&<p className="oa-error">{taskError(t.error)}</p>}<div className="oa-actions"><label>关联案件<select value={t.caseId||''} disabled={busy} onChange={e=>void run(()=>api(`/api/tasks/${t.id}/case`,{caseId:e.target.value||null}))}><option value="">独立个人任务</option>{cases.map(c=><option key={c.id} value={c.id}>{c.caseNo} · {c.title} · {c.status}</option>)}</select></label>
  {t.status==='RUNNING'?<><a className="oa-primary" href={`/harness/${t.id}/#session=${t.sessionId}&workspace=${t.workspaceId}`} target="_blank" rel="noreferrer">打开 AI 会话</a><button disabled={busy} onClick={()=>void run(()=>api(`/api/tasks/${t.id}/stop`,{}))}>停止任务</button></>:<button disabled={busy} onClick={()=>void run(()=>api(`/api/tasks/${t.id}/start`,{}))}>启动任务</button>}
  <button disabled={busy} onClick={()=>void run(()=>api(`/api/tasks/${t.id}/save`,{}))}>保存成果 / 重试</button><button disabled={busy||t.status==='PREPARING'} onClick={()=>{if(window.confirm(`确认删除任务“${t.title}”？运行中的任务将停止，任务会从列表移除。OA 原始文件和已保存成果不受影响。`))void run(()=>api(`/api/tasks/${t.id}/delete`,{}))}}>删除任务</button></div>
  {Object.values(t.outputs).map(o=><div className="oa-output" key={o.name+o.fileId+o.version}>{o.name}{o.version&&` · v${o.version}`} · {o.status==='SAVED'?'已保存到我的文件':'待保存'}{o.error&&<span className="oa-error"> {o.error}</span>}{t.caseId&&o.archives?.[t.caseId]&&<span> · 已正式归档</span>}{o.fileId&&t.caseId&&!o.archives?.[t.caseId]&&<button disabled={busy} onClick={()=>{if(window.confirm('已完成律师复核，确认将此版本正式归档到关联 OA 案件？'))void run(()=>api(`/api/tasks/${t.id}/archive`,{fileId:o.fileId,version:o.version}))}}>复核后正式归档</button>}</div>)}</section>)}
 </div>
}
