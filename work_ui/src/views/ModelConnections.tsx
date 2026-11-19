import {useState} from 'react'
import {api} from '@/api/integration'

export type Connection={id:string;label:string;base:string;models:string[];scope:'cloud'|'local';revision:number;verifiedAt?:string;testedModels?:string[];authenticated:boolean}
export type Catalog={active:Connection[];drafts:Connection[]}
export type Route={connection:string;model:string}
export function RouteSelect({label,value,onChange,items,optional=false}:{label:string;value:Route|null;onChange:(v:Route|null)=>void;items:Connection[];optional?:boolean}){
 const options=items.flatMap(c=>c.models.map(model=>({route:JSON.stringify({connection:c.id,model}),label:c.label+' · '+model})))
 return <label>{label} <select aria-label={label} value={value?JSON.stringify({connection:value.connection,model:value.model}):''} onChange={e=>onChange(e.target.value?JSON.parse(e.target.value):null)}>
 <option value="" disabled={!optional}>{optional?'不使用':'请选择'}</option>{options.map(o=><option key={o.route} value={o.route}>{o.label}</option>)}</select></label>
}
export function ModelConnections({catalog,refresh}:{catalog:Catalog;refresh:()=>Promise<void>}){
 const [selected,select]=useState<Connection>(),[label,setLabel]=useState(''),[base,setBase]=useState(''),[models,setModels]=useState(''),[scope,setScope]=useState<'local'|'cloud'>('cloud'),[auth,setAuth]=useState(true),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
 function edit(row?:Connection){
  select(row);setLabel(row?.label||'');setBase(row?.base||'');setModels(row?.models.join('\n')||'');setScope(row?.scope||'cloud');setAuth(row?.authenticated??true);setKey('')
 }
 async function run(action:()=>Promise<string>){
  setBusy(true);setStatus('')
  try{setStatus(await action());await refresh()}catch(e){setStatus((e as Error).message)}finally{setBusy(false)}
 }
 const rows=[...catalog.drafts,...catalog.active.filter(a=>!catalog.drafts.some(d=>d.id===a.id))]
 return <section><h3>模型连接</h3><fieldset disabled={busy}>
 <label>连接 <select value={selected?.id||''} onChange={e=>edit(rows.find(r=>r.id===e.target.value))}><option value="">新增连接</option>{rows.map(r=><option key={r.id} value={r.id}>{r.label}{catalog.drafts.includes(r)?'（草稿）':''}</option>)}</select></label>
 <p><label>连接名称 <input value={label} onChange={e=>setLabel(e.target.value)}/></label> <label>部署位置 <select value={scope} onChange={e=>{setScope(e.target.value as 'local'|'cloud');setAuth(true)}}><option value="cloud">云端</option><option value="local">内网</option></select></label></p>
 <label>Base URL <input value={base} placeholder={scope==='local'?'http://127.0.0.1:8000/v1':'https://…/v1'} onChange={e=>setBase(e.target.value)}/></label>
 <p><label>认证 <select value={auth?'key':'none'} onChange={e=>setAuth(e.target.value==='key')}><option value="key">API Key</option>{scope==='local'&&<option value="none">本地无认证</option>}</select></label> {auth&&<label>API Key <input type="password" autoComplete="new-password" value={key} placeholder={selected?.authenticated?'留空沿用已保存密钥':'输入密钥'} onChange={e=>setKey(e.target.value)}/></label>}</p>
 <label>模型标识（每行一个） <textarea value={models} onChange={e=>setModels(e.target.value)}/></label>
 <p><button onClick={()=>void run(async()=>{
  const saved=await api<Connection>('/api/model-connections/save',{id:selected?.id,revision:selected?.revision||0,label,scope,base,models:models.split(/\s+/).filter(Boolean),auth:auth?'key':'none',apiKey:key})
  edit(saved);return '已保存连接草稿'
 })}>保存连接草稿</button></p></fieldset>
 <h3>连通性测试</h3><p>服务器发送固定测试消息，分别验证流式回复和工具调用。新增模型须逐个测试。仅轮换密钥时，任选一个已启用的模型测试即可。</p>
 {rows.map(row=><fieldset key={row.id} disabled={busy}><legend>{row.label} · {catalog.drafts.includes(row)?'草稿':'已启用'}</legend>
 {row.models.map(m=><button key={m} onClick={()=>void run(async()=>{await api('/api/model-connections/'+row.id+'/test',{revision:row.revision,model:m});return m+' 流式回复和工具调用测试通过'})}>{row.testedModels?.includes(m)?'重新测试':'测试'} {m}</button>)}
 {catalog.drafts.includes(row)&&<button disabled={!row.verifiedAt} onClick={()=>void run(async()=>{await api('/api/model-connections/'+row.id+'/enable',{revision:row.revision});return '连接已启用'})}>启用已测试连接</button>}</fieldset>)}
 {status&&<p role="status">{status}</p>}</section>
}
