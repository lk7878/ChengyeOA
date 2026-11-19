import {useEffect,useState} from 'react'
import {api} from '@/api/integration'
import {RouteSelect,type Connection,type Route} from './ModelConnections'

type Assignment={kinds:string[];defaultKind:string|null;exceptions:Record<string,Route>;readers:string[];revision:string}
type User={id:string;username:string;employee?:{name:string};smartCaseEligible:boolean;account:Assignment}
type Definition={id:string;name:string;version:number;workflow:string;skills:string[];tools:string[];required:string[];agent:string;runtime:string;runtimeVersion:string;templates:string[];allowed:string[];recommended:string[];primary:Route|null;backup:Route|null}
type Data={components:Definition[];users:User[];versions:Record<string,Definition[]>;libraries:{id:string;name:string}[];connections:Connection[];disabled:string[]}
const toggle=(ids:string[],id:string)=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]
const presets=(data:Data)=>Object.values(data.versions).map(rows=>rows[rows.length-1])
type Preview={confirmation:string;diff:{id:string;before:Assignment;after:Assignment}[];effective:{id:string;items:{name:string;model:string;source:string;available:string[];recommended:string[]}[]}[]}
export function BusinessPresets(){
 const [receipt,setReceipt]=useState('')
 const [data,setData]=useState<Data>(),[userId,selectUser]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState('')
 const refresh=async()=>{const next=await api<Data>('/api/business-presets');setData(next);return next}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 const user=data?.users.find(u=>u.id===userId)
 const query=search.trim().toLowerCase()
 const matches=data?.users.filter(u=>[u.username,u.employee?.name].some(value=>value?.toLowerCase().includes(query)))??[]
 function chooseAccount(id:string){
  selectUser(id)
  setSearch('')
  setReceipt('')
 }
 const accountLabel=(u:User)=>u.employee?.name ? u.employee.name+'（'+u.username+'）' : u.username
 return <><section className="oa-panel"><h2>用户办案授权</h2>
 {error&&<p role="alert">{error}</p>}
 <div className="oa-actions">
  <label>搜索账号或姓名 <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
   onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&query&&matches.length===1)chooseAccount(matches[0].id)}}/></label>
  {!query&&<label>选择人员 <select value={userId} onChange={e=>chooseAccount(e.target.value)}><option value="">选择账号</option>
   {data?.users.map(u=><option key={u.id} value={u.id}>{accountLabel(u)}</option>)}</select></label>}
 </div>
 {query&&!error&&<><p role="status">{!data?'正在加载人员…':matches.length?'找到 '+matches.length+' 个匹配账号':'未找到匹配账号，请核对账号或姓名。'}</p>
  {matches.length>0&&<ul className="oa-account-matches" aria-label="匹配账号">{matches.map(u=>
   <li key={u.id}><button type="button" onClick={()=>chooseAccount(u.id)}>{accountLabel(u)}</button></li>)}</ul>}</>}
 <div hidden={Boolean(query)}>{data&&user&&<Editor key={user.id+user.account.revision} data={data} user={user} refresh={refresh} onSaved={setReceipt}/>}
 <p role="status">{receipt}</p></div></section>
 {data&&<section className="oa-panel"><h2>办案预设与发布记录</h2>{presets(data).map(p=><PresetEditor key={p.id+p.version+data.disabled.includes(p.id)} current={p} data={data} refresh={refresh}/>)}</section>}</>
}
function Editor({user,data,refresh,onSaved}:{user:User;data:Data;refresh:()=>Promise<Data>;onSaved:(message:string)=>void}){
 const [form,setForm]=useState(user.account),[extra,setExtra]=useState<string[]>([]),[preview,setPreview]=useState<Preview>(),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const names=(ids:string[])=>ids.map(id=>data.libraries.find(k=>k.id===id)?.name||presets(data).find(p=>p.id===id)?.name||id).join('、')||'无'
 const change=(patch:Partial<Assignment>)=>{setForm({...form,...patch});setPreview(undefined);setMessage('')}
 const apply=async(save:boolean)=>{
  setBusy(true);setMessage('')
  try{
   const changes=[user,...data.users.filter(u=>extra.includes(u.id))].map(u=>({...form,id:u.id,revision:u.account.revision}))
   if(save){
    const result=await api<{accounts:({id:string}&Assignment)[]}>('/api/business-grants/save',{changes,confirmation:preview?.confirmation})
    const actual=await refresh()
    if(!result.accounts.every(a=>actual.users.find(u=>u.id===a.id)?.account.revision===a.revision))throw Error('回读结果已变更，请重新核对')
    setPreview(undefined);onSaved('已保存并回读核对 '+changes.length+' 个账号')
   }else setPreview(await api<Preview>('/api/business-grants/preview',{changes}))
  }catch(e){setPreview(undefined);setMessage((e as Error).message)}finally{setBusy(false)}
 }
 if(!user.smartCaseEligible)return <p>该账号缺少智慧办案使用资格。<a href="/security/users">前往 OA 人员授权</a></p>
 return <fieldset disabled={busy}><legend>{user.employee?.name||user.username} · 已有智慧办案使用资格</legend>
 {presets(data).map(p=><div key={p.id}><label><input type="checkbox" checked={form.kinds.includes(p.id)} onChange={()=>{
  const kinds=toggle(form.kinds,p.id),exceptions={...form.exceptions};if(!kinds.includes(p.id))delete exceptions[p.id]
  change({kinds,exceptions,defaultKind:kinds.includes(form.defaultKind||'')?form.defaultKind:kinds[0]||null})
 }}/>{p.name}</label> {form.kinds.includes(p.id)&&<><label><input type="radio" name="default-business" checked={form.defaultKind===p.id} onChange={()=>change({defaultKind:p.id})}/>默认</label> <RouteSelect optional label="例外模型" items={data.connections} value={form.exceptions[p.id]||null} onChange={r=>{const exceptions={...form.exceptions};if(r)exceptions[p.id]=r;else delete exceptions[p.id];change({exceptions})}}/></>}</div>)}
 <fieldset><legend>知识库阅读权</legend>{data.libraries.map(k=><label key={k.id}><input type="checkbox" checked={form.readers.includes(k.id)} onChange={()=>change({readers:toggle(form.readers,k.id)})}/>{k.name}</label>)}</fieldset>
 <details><summary>将以上配置同时应用到其他账号</summary>{data.users.filter(u=>u.id!==user.id&&u.smartCaseEligible).map(u=><label key={u.id}><input type="checkbox" checked={extra.includes(u.id)} onChange={()=>{setExtra(toggle(extra,u.id));setPreview(undefined)}}/>{u.employee?.name||u.username}</label>)}</details>
 <button onClick={()=>void apply(false)}>预览变更</button> {preview&&<><ul>{preview.diff.map(d=><li key={d.id}>{data.users.find(u=>u.id===d.id)?.username} · 预设 {names(d.before.kinds)} → {names(d.after.kinds)}；默认 {names([d.after.defaultKind||'无'])}；阅读权 {names(d.before.readers)} → {names(d.after.readers)}</li>)}</ul>
 {preview.effective.map(r=><div key={r.id}>{r.items.map(p=><p key={p.name}>{p.name} · {p.source} · {p.model} · 可选 {names(p.available)} · 推荐 {names(p.recommended)}</p>)}</div>)}
 <button onClick={()=>void apply(true)}>确认应用到 {preview.diff.length} 个账号</button></>}{message&&<p role="status">{message}</p>}</fieldset>
}
function PresetEditor({current:p,data,refresh}:{current:Definition;data:Data;refresh:()=>Promise<Data>}){
 const source=data.components.find(c=>c.id===p.id)!
 const toolNames:Record<string,string>={ocr:'材料 OCR',knowledge:'授权知识检索',network:'公共网络'}
 const [draft,setDraft]=useState(p),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const run=async(action:string,body:unknown)=>{setBusy(true);try{await api('/api/business-presets/'+p.id+'/'+action,body);await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <details><summary>{p.name} · v{p.version}{data.disabled.includes(p.id)?' · 已暂停':''}</summary><fieldset disabled={busy}><legend>{p.workflow}</legend>
 <p>运行包 {p.runtime} · {p.runtimeVersion}。{p.templates.join('、')}</p>
 <p>必需组件 {p.required.join('、')}</p>
 {source.tools.map(id=><label key={id}><input type="checkbox" checked={draft.tools.includes(id)} onChange={()=>setDraft({...draft,tools:toggle(draft.tools,id)})}/>{toolNames[id]}</label>)}
 {source.skills.length>0&&<details><summary>已部署 Skills（{draft.skills.length} / {source.skills.length}）</summary>{source.skills.map(id=><label key={id}><input type="checkbox" checked={draft.skills.includes(id)} onChange={()=>setDraft({...draft,skills:toggle(draft.skills,id)})}/>{id}</label>)}</details>}
 {data.libraries.map(k=><div key={k.id}>{k.name} <label><input type="checkbox" checked={draft.allowed.includes(k.id)} onChange={()=>{const allowed=toggle(draft.allowed,k.id);setDraft({...draft,allowed,recommended:draft.recommended.filter(id=>allowed.includes(id))})}}/>可选</label> <label><input type="checkbox" disabled={!draft.allowed.includes(k.id)} checked={draft.recommended.includes(k.id)} onChange={()=>setDraft({...draft,recommended:toggle(draft.recommended,k.id)})}/>推荐</label></div>)}
 <RouteSelect label="预设主模型" optional value={draft.primary} items={data.connections} onChange={r=>setDraft({...draft,primary:r,backup:r?draft.backup:null})}/>
 {draft.primary&&<RouteSelect label="预设备用模型" optional value={draft.backup} items={data.connections} onChange={r=>setDraft({...draft,backup:r})}/>}
 <button onClick={()=>void run('publish',draft)}>发布新版本</button> <button onClick={()=>{if(window.confirm('立即变更该预设的运行状态？暂停会结束正在使用该预设的任务。'))void run('pause',{disabled:!data.disabled.includes(p.id)})}}>{data.disabled.includes(p.id)?'恢复工具':'紧急暂停工具'}</button>
 {data.versions[p.id].slice(0,-1).map(v=><button key={v.version} onClick={()=>{if(window.confirm('将此历史版本重新发布？'))void run('publish',{version:p.version,rollback:v.version})}}>回退至 v{v.version}</button>)}{error&&<p role="alert">{error}</p>}</fieldset></details>
}
