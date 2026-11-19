import {useEffect,useRef,useState} from 'react'
import {api,IntegrationError,type FileRow,type Version,type Task,TASK_STATES} from '@/api/integration'
import {useTaskDraft} from './task-draft'
import {updateLocation} from '../navigation'
import type {CaseKind} from '@/types'
const taskError=(message:string)=>message.startsWith('Harness 启动')?'AI 任务运行环境启动失败，请点击“启动任务”重试；若仍失败，请联系管理员。':message
export function TaskWorkbench({kind='general',accountId,currentVersion}:{kind?:CaseKind;accountId:string;currentVersion:number}){
 const {draft,update,clear,storageError}=useTaskDraft(accountId,kind)
 const {title,caseId,inputs,knowledge,scope,folders}=draft
 const setTitle=(title:string)=>update({title}),setCase=(caseId:string)=>{update({caseId});updateLocation({caseId},true)},setScope=(scope:string)=>update({scope})
 const setFolders=(value:typeof folders|((p:typeof folders)=>typeof folders))=>update(d=>({...d,folders:typeof value==='function'?value(d.folders):value}))
 const setInputs=(fn:(p:typeof inputs)=>typeof inputs)=>update(d=>({...d,inputs:fn(d.inputs)}))
 const setKnowledge=(fn:(p:string[])=>string[])=>update(d=>({...d,knowledge:fn(d.knowledge),knowledgeInitialized:true}))
 const [tasks,setTasks]=useState<Task[]>([]),[files,setFiles]=useState<FileRow[]>([]),[selected,setSelected]=useState<Record<string,Version[]>>({}),[cases,setCases]=useState<{id:string;caseNo:string;title:string;status:string}[]>([]),[kbs,setKbs]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [kbLoading,setKbLoading]=useState(true),[kbError,setKbError]=useState(''),[ready,setReady]=useState(false),[validation,setValidation]=useState(0),[notice,setNotice]=useState('')
 const mounted=useRef(true),selectionRequests=useRef<Record<string,number>>({})
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 // Restore only after current OA authorization, case visibility and exact versions are checked.
 const validateDraft=async(current:typeof draft)=>{
  const [availableCases,result]=await Promise.all([api<typeof cases>('/api/oa/cases'),api<{items:{id:string;available:typeof kbs;recommended:string[];error?:string}[]}>('/api/my-presets')])
  const config=result.items.find(p=>p.id===kind)
  if(!config||config.error)throw Error(config?.error||'此预设已撤销，请重新选择')
  const ordered=[...config.available].sort((a,b)=>Number(b.name==='法律法规库')-Number(a.name==='法律法规库'))
  const versions:Record<string,Version[]>={},validInputs:Record<string,number>={}
  await Promise.all(Object.entries(current.inputs).map(async([id,version])=>{
   try{const items=await api<Version[]>('/api/oa/files/'+encodeURIComponent(id)+'/versions');versions[id]=items;if(items.some(v=>v.version===version))validInputs[id]=version}
   catch(e){if(!(e instanceof IntegrationError)||![403,404,410].includes(e.status))throw e}
  }))
  const next={...current,caseId:availableCases.some(c=>c.id===current.caseId)?current.caseId:'',inputs:validInputs,knowledge:current.knowledgeInitialized?current.knowledge.filter(id=>ordered.some(k=>k.id===id)):config.recommended,knowledgeInitialized:true}
  const changed=next.caseId!==current.caseId||Object.keys(validInputs).length!==Object.keys(current.inputs).length||(current.knowledgeInitialized&&next.knowledge.length!==current.knowledge.length)
  return {next,changed,ordered,availableCases,versions}
 }
 const [pendingFiles,setPendingFiles]=useState<Record<string,boolean>>({})
 const toggleFile=async(id:string,checked:boolean)=>{
  const request=(selectionRequests.current[id]||0)+1;selectionRequests.current[id]=request
  setPendingFiles(p=>({...p,[id]:checked}))
  if(!checked){setInputs(p=>{const next={...p};delete next[id];return next});return}
  try{const versions=await api<Version[]>('/api/oa/files/'+encodeURIComponent(id)+'/versions');if(!mounted.current||selectionRequests.current[id]!==request)return;if(!versions.length)throw Error('此文件暂无可用版本');setSelected(p=>({...p,[id]:versions}));setInputs(p=>({...p,[id]:versions[0].version}))}
  catch(e){if(mounted.current&&selectionRequests.current[id]===request)setError((e as Error).message)}
  finally{if(mounted.current&&selectionRequests.current[id]===request)setPendingFiles(p=>({...p,[id]:false}))}
 }
 const [outputs,setOutputs]=useState<Record<string,{key:string;name:string;path:string;size:number;sha256:string;saved:boolean}[]>>({}),[chosen,setChosen]=useState<Record<string,string[]>>({})
 const loadOutputs=async(id:string)=>{const r=await api<{items:typeof outputs[string]}>(`/api/tasks/${id}/outputs`);setOutputs(p=>({...p,[id]:r.items}));setChosen(p=>({...p,[id]:[]}))}
 const parent=folders.at(-1)?.id||''
 const [reload,setReload]=useState(0),[filesLoading,setFilesLoading]=useState(true),[filesError,setFilesError]=useState('')
 const refresh=async()=>{const result=await api<{items:Task[]}>('/api/tasks');if(mounted.current)setTasks(result.items)}
 useEffect(()=>{let active=true;setReady(false);setKbLoading(true);setKbError('')
  void validateDraft(draft).then(r=>{if(!active)return;setCases(r.availableCases);setKbs(r.ordered);setSelected(r.versions);update(r.next);if(r.next.caseId!==draft.caseId)updateLocation({caseId:r.next.caseId},true);setReady(true);setNotice(r.changed?'草稿中已失效的案件、文件版本或知识库授权已移除，请核对后创建任务。':'')}).catch(e=>{if(active)setKbError('草稿授权校验未完成：'+e.message)}).finally(()=>{if(active)setKbLoading(false)})
  return()=>{active=false}
 },[validation])
 useEffect(()=>{void refresh().catch(e=>{if(mounted.current)setError(e.message)});const timer=setInterval(()=>void refresh().catch(e=>{if(mounted.current)setError(e.message)}),5000);return()=>clearInterval(timer)},[])
 useEffect(()=>{
  let active=true;setFilesLoading(true);setFilesError('');setFiles([])
  void api<{items:FileRow[]}>('/api/oa/files?'+new URLSearchParams({scope,...(parent?{parentId:parent}:{})}))
   .then(r=>{if(active)setFiles(r.items)}).catch(e=>{if(active)setFilesError(e.message)})
   .finally(()=>{if(active)setFilesLoading(false)})
  return()=>{active=false}
 },[scope,parent,reload])
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <>
  <section className="oa-panel"><h2>新建任务</h2><p>未创建的任务会在当前浏览器标签页保留，切换栏目或刷新后可继续填写。</p><p>选取 OA 文件的具体版本。原件已保存不代表已解析，模型可读性由任务工具确认。AI 只使用本任务材料，生成成果需在下方勾选确认后保存到我的文件；正式归档需另行复核确认。</p>
  {storageError&&<p role="alert">{storageError}</p>}{notice&&<p role="status">{notice}</p>}<fieldset disabled={!ready||busy} style={{border:0,padding:0,minWidth:0}}><div className="oa-fields"><label>任务名称<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：合同履行争议分析"/></label><label>关联 OA 案件<select value={caseId} onChange={e=>setCase(e.target.value)}><option value="">独立个人任务</option>{cases.map(c=><option key={c.id} value={c.id}>{c.caseNo} · {c.title} · {c.status}</option>)}</select></label></div>
  <button disabled={busy||!ready} onClick={()=>void run(async()=>{
   const checked=await validateDraft(draft);if(checked.changed){update(checked.next);throw Error('材料或授权已变化，请重新确认')}
   const t=await api<Task>('/api/tasks',{kind,title:title.trim()||'新对话',caseId:caseId||null,inputs:Object.entries(inputs).map(([fileId,version])=>({fileId,version})),knowledgeBases:knowledge})
   const session=await api<Task>(`/api/tasks/${t.id}/start`,{});clear();window.location.assign(`/harness/${t.id}/#session=${session.sessionId}&workspace=${session.workspaceId}`)
  })}>开始对话并上传材料</button>
  <div className="oa-actions"><select aria-label="文件范围" value={scope} onChange={e=>{setScope(e.target.value);setFolders([])}}><option value="mine">我的文件</option><option value="shared">共享给我的文件</option></select>
   <button disabled={!parent} onClick={()=>setFolders([])}>{parent?'返回根目录':'已在根目录'}</button>
   {parent&&<button onClick={()=>setFolders(p=>p.slice(0,-1))}>返回上级</button>}
   <button disabled={filesLoading} onClick={()=>setReload(v=>v+1)}>{filesLoading?'正在刷新…':'刷新文件'}</button>
   <span>文件请先上传到 OA 我的文件，再刷新列表</span></div>
  <nav className="oa-file-path" aria-label="当前文件目录"><span>{scope==='mine'?'我的文件':'共享给我的文件'} / </span><button disabled={!parent} onClick={()=>setFolders([])}>根目录</button>{folders.map((folder,index)=><span key={folder.id}> / <button disabled={index===folders.length-1} onClick={()=>setFolders(p=>p.slice(0,index+1))}>{folder.name}</button></span>)}</nav>
  <div className="oa-file-list" aria-busy={filesLoading}><p role="status">{filesLoading?'正在加载文件…':filesError?'':files.length===0?'此目录暂无可用文件；上传后点击“刷新文件”。':`已加载 ${files.length} 项`}</p>
   {filesError&&<p role="alert" className="oa-error">读取文件失败：{filesError}。请点击“刷新文件”重试。</p>}
   {files.map(f=><div key={f.id}>{f.kind==='FOLDER'?<button onClick={()=>setFolders(p=>[...p,{id:f.id,name:f.name}])}>📁 {f.name}</button>:<><label><input type="checkbox" checked={f.id in inputs||!!pendingFiles[f.id]} onChange={e=>void toggleFile(f.id,e.target.checked)}/>{f.name}{pendingFiles[f.id]&&'（正在读取版本…）'}</label>{f.id in inputs&&<select aria-label={f.name+'版本'} value={inputs[f.id]} onChange={e=>setInputs(p=>({...p,[f.id]:Number(e.target.value)}))}>{selected[f.id]?.map(v=><option key={v.version} value={v.version}>版本 {v.version} · {v.sha256.slice(0,10)}</option>)}</select>}</>}</div>)}</div>
  {Object.keys(inputs).some(id=>!files.some(f=>f.id===id))&&<fieldset><legend>其他目录已选材料</legend>{Object.entries(inputs).filter(([id])=>!files.some(f=>f.id===id)).map(([id,version])=><p key={id}>{selected[id]?.find(v=>v.version===version)?.name||'已选文件'} · v{version} <button onClick={()=>setInputs(p=>{const n={...p};delete n[id];return n})}>取消选择</button></p>)}</fieldset>}
  {<fieldset><legend>本任务可用知识库</legend><p>只检索勾选的知识库，可按任务需要多选或全部取消；未勾选时不检索知识库。</p>{kbLoading?<p role="status">正在加载知识库…</p>:kbError?<p role="alert" className="oa-error">{kbError}，请刷新页面重试。</p>:kbs.length===0?<p>暂无获授权的知识库。智慧办案使用资格与知识库权限分别管理，请联系管理员为您的账号逐库分配阅读权限，授权后刷新页面即可勾选。</p>:null}{kbs.map(k=><label key={k.id}><input type="checkbox" checked={knowledge.includes(k.id)} onChange={e=>setKnowledge(p=>e.target.checked?[...p,k.id]:p.filter(x=>x!==k.id))}/>{k.name}</label>)}</fieldset>}
  <button className="oa-primary" disabled={busy||Object.values(pendingFiles).some(Boolean)||!ready||kbLoading||!!kbError||!title.trim()} onClick={()=>void run(async()=>{const checked=await validateDraft(draft);if(!mounted.current)return;setCases(checked.availableCases);setKbs(checked.ordered);setSelected(checked.versions);if(checked.changed){update(checked.next);throw Error('授权或材料版本已变化，已更新选择，请核对后重新创建。')}await api('/api/tasks',{title,kind,caseId:caseId||null,inputs:Object.entries(inputs).map(([fileId,version])=>({fileId,version})),knowledgeBases:knowledge});clear();setSelected({});setNotice('任务已创建，对应草稿已清除。');if(mounted.current)updateLocation({caseId:null},true)})}>创建任务 · 已选 {Object.keys(inputs).length} 个版本</button></fieldset>{kbError&&<div role="alert"><p className="oa-error">{kbError}</p><button onClick={()=>setValidation(v=>v+1)}>重新校验草稿</button></div>}</section>
  {error&&<p role="alert" className="oa-error">{taskError(error)}</p>}
  <h2>我的任务</h2>{tasks.filter(t=>t.kind===kind).map(t=><section key={t.id} className="oa-panel"><h3>{t.title} <small>{TASK_STATES[t.status]||t.status}</small></h3><p>{t.businessSnapshot?`预设 v${t.businessSnapshot.version} · 运行包 ${t.businessSnapshot.runtimeVersion}`:'原预设版本未知，首次启动时登记'} {t.businessSnapshot&&t.businessSnapshot.version!==currentVersion&&t.status!=='RUNNING'&&<button disabled={busy} onClick={()=>{if(window.confirm('使用当前发布版本续办？原配置将记入任务历史。'))void run(()=>api(`/api/tasks/${t.id}/upgrade`,{fromVersion:t.businessSnapshot!.version,toVersion:currentVersion}))}}>升级至 v{currentVersion}</button>}</p><p>{t.inputs.map(i=>`${i.name}（v${i.version}）`).join('、')||'未选择材料'}</p><p>任务知识库：{t.knowledgeBases?.length?t.knowledgeBases.map(id=>kbs.find(k=>k.id===id)?.name||'已选知识库（当前不可用）').join('、'):'未选择，不检索知识库'}</p>{t.error&&<p className="oa-error">{taskError(t.error)}</p>}<div className="oa-actions"><label>关联案件<select value={t.caseId||''} disabled={busy} onChange={e=>void run(()=>api(`/api/tasks/${t.id}/case`,{caseId:e.target.value||null}))}><option value="">独立个人任务</option>{cases.map(c=><option key={c.id} value={c.id}>{c.caseNo} · {c.title} · {c.status}</option>)}</select></label>
  {t.status==='RUNNING'?<><a className="oa-primary" href={`/harness/${t.id}/#session=${t.sessionId}&workspace=${t.workspaceId}`} target="_blank" rel="noreferrer">打开 AI 会话</a><button disabled={busy} onClick={()=>{if(window.confirm('结束运行会关闭整个 AI 运行进程，未保存成果仍保留在任务中。再次启动会新建会话。仅停止当前回答，请在 AI 会话内操作。确认结束？'))void run(()=>api(`/api/tasks/${t.id}/stop`,{}))}}>结束运行</button></>:<button disabled={busy} onClick={()=>void run(()=>api(`/api/tasks/${t.id}/start`,{}))}>启动任务</button>}
  <button disabled={busy} onClick={()=>void run(()=>loadOutputs(t.id))}>查看 / 刷新待确认成果</button><button disabled={busy||t.status==='PREPARING'} onClick={()=>{if(window.confirm(`确认删除任务“${t.title}”？运行中的任务将停止，任务会从列表移除，未保存成果将无法再从任务页面访问，请先勾选保存需要的文件。OA 原始文件和已保存成果不受影响。`))void run(()=>api(`/api/tasks/${t.id}/delete`,{}))}}>删除任务</button></div>
  {outputs[t.id]&&<fieldset><legend>确认保存到 OA 的成果</legend><p>只保存勾选的文件版本，默认不选。修改后的内容需刷新并重新确认；此操作不等同于正式归档。</p>{outputs[t.id].length===0&&<p>暂无稳定成果，生成结束后请刷新。</p>}{outputs[t.id].map(o=><label key={o.key} style={{display:'block',margin:'8px 0'}}><input type="checkbox" disabled={busy||o.saved} checked={chosen[t.id]?.includes(o.key)||false} onChange={e=>setChosen(p=>({...p,[t.id]:e.target.checked?[...(p[t.id]||[]),o.key]:(p[t.id]||[]).filter(k=>k!==o.key)}))}/>{o.path} · {Math.ceil(o.size/1024)} KB · {o.sha256.slice(0,10)}{o.saved?' · 此版本已保存':''}</label>)}<button disabled={busy||!chosen[t.id]?.length} onClick={()=>void run(async()=>{try{await api(`/api/tasks/${t.id}/save`,{selection:chosen[t.id]})}finally{await loadOutputs(t.id);await refresh()}})}>保存已勾选成果（{chosen[t.id]?.length||0}）</button></fieldset>}
  {Object.values(t.outputs).map(o=><div className="oa-output" key={o.name+o.fileId+o.version}>{o.name}{o.version&&` · v${o.version}`} · {o.status==='SAVED'?<>已保存到承业空间 → 我的资源 · <a href="/workspaces?workspace=__all__&scope=mine" target="_blank" rel="noopener noreferrer">查看文件</a></>:'待保存'}{o.error&&<span className="oa-error"> {o.error}</span>}{t.caseId&&o.archives?.[t.caseId]&&<span> · 已正式归档</span>}{o.fileId&&t.caseId&&!o.archives?.[t.caseId]&&<button disabled={busy} onClick={()=>{if(window.confirm('已完成律师复核，确认将此版本正式归档到关联 OA 案件？'))void run(()=>api(`/api/tasks/${t.id}/archive`,{fileId:o.fileId,version:o.version}))}}>复核后正式归档</button>}</div>)}</section>)}
 </>
}
