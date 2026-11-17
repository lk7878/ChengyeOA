import {useEffect,useState} from 'react'
import {api} from '@/api/integration'
type Library={id:string;name:string;readers:string[];reviewers:string[];version?:number}
export function KnowledgeAccess(){
 const [data,setData]=useState<{libraries:Library[];users:{id:string;username:string;employee?:{name:string}}[]}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const refresh=()=>api<NonNullable<typeof data>>('/api/kb-access').then(setData).catch(e=>setError(e.message))
 useEffect(()=>{void refresh()},[])
 const toggle=(lib:Library,kind:'readers'|'reviewers',id:string,checked:boolean)=>setData(prev=>prev&&({...prev,libraries:prev.libraries.map(l=>l.id===lib.id?{...l,[kind]:checked?[...l[kind],id]:l[kind].filter(x=>x!==id)}:l)}))
 return <section className="oa-panel"><h2>目标知识库授权</h2><p>先在 OA 为人员追加“智慧办案使用者”角色，再按账号、按知识库分别配置阅读和审核权限。拥有使用资格不代表可以读取全部知识库。审核人还必须同时拥有 OA 的“审核知识投稿”权限；同角色不会自动共享私人材料。</p>{error&&<p className="oa-error">{error}</p>}{data?.libraries.map(lib=><details key={lib.id}><summary>{lib.name}</summary><table><thead><tr><th>人员</th><th>可浏览 / 任务检索</th><th>可审核</th></tr></thead><tbody>{data.users.map(u=><tr key={u.id}><td>{u.employee?.name||u.username}</td>{(['readers','reviewers'] as const).map(kind=><td key={kind}><input aria-label={(u.employee?.name||u.username)+kind} type="checkbox" checked={lib[kind].includes(u.id)} onChange={e=>toggle(lib,kind,u.id,e.target.checked)}/></td>)}</tr>)}</tbody></table><button disabled={busy} onClick={()=>{setBusy(true);void api('/api/kb-access/'+lib.id,{readers:lib.readers,reviewers:lib.reviewers,version:lib.version||0}).then(refresh).catch(e=>setError(e.message)).finally(()=>setBusy(false))}}>保存目标库授权</button></details>)}</section>
}
