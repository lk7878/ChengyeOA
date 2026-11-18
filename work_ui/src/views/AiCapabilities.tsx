import {useEffect,useState} from 'react'
import {api} from '@/api/integration'
type Policy={preset:string;model:string;fallbackModel:string;network:boolean;maxTokens:number}
type Config={version:number;policies:Record<string,Policy>;models:string[];presets:string[];history:{version:number}[]}
const presetNames:Record<string,string>={'general-legal':'通用法律','injury':'伤残与伤情鉴定','medical-review':'医疗损害审查','traffic-accident':'交通事故鉴定'}
const names:Record<string,string>={general:'通用任务',disability:'伤残鉴定',injury:'伤情鉴定',malpractice:'医疗损害',traffic:'交通事故'}
export function AiCapabilities(){
 const [config,setConfig]=useState<Config>(),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const load=()=>api<Config>('/api/ai-capabilities').then(setConfig)
 useEffect(()=>{void load().catch(e=>setStatus(e.message))},[])
 const change=(kind:string,patch:Partial<Policy>)=>setConfig(c=>c&&({...c,policies:{...c.policies,[kind]:{...c.policies[kind],...patch}}}))
 const run=async(action:string,body:unknown)=>{setBusy(true);try{await api('/api/ai-capabilities/'+action,body);setStatus(action==='check'?'配置检查通过，可发布。':'已发布；已有运行任务继续使用原配置版本。');if(action!=='check')await load()}catch(e){setStatus((e as Error).message)}finally{setBusy(false)}}
 return <section className="oa-panel"><h2>AI 能力配置</h2><p>仅 OA 超级管理员可管理。知识库审核资格不包含此权限。模型密钥保留在服务器；Skills 与工具由已部署的任务组合提供。</p>
 {status&&<p role="status">{status}</p>}{config&&<><p>当前发布版本：{config.version}。配置检查不消耗模型调用；发布后用于后续启动任务，现有运行任务保持原版本。撤销人员或材料授权始终实时生效。</p>
 {Object.entries(config.policies).map(([kind,p])=><fieldset key={kind} disabled={busy}><legend>{names[kind]}</legend><label>默认模型 <select aria-label={names[kind]+'默认模型'} value={p.model} onChange={e=>change(kind,{model:e.target.value})}>{config.models.map(m=><option key={m}>{m}</option>)}</select></label> <label>备用模型 <select value={p.fallbackModel} onChange={e=>change(kind,{fallbackModel:e.target.value})}><option value="">不使用备用</option>{config.models.map(m=><option key={m}>{m}</option>)}</select></label><p><label>Skills / 工具组合 <select value={p.preset} onChange={e=>change(kind,{preset:e.target.value})}>{config.presets.map(s=><option key={s} value={s}>{presetNames[s]||s}</option>)}</select></label></p><label><input type="checkbox" checked={p.network} onChange={e=>change(kind,{network:e.target.checked})}/>允许公共网络访问</label> <label>单次生成上限 <input type="number" min={1024} max={65536} value={p.maxTokens} onChange={e=>change(kind,{maxTokens:Number(e.target.value)})}/></label></fieldset>)}
 <p><button disabled={busy} onClick={()=>void run('check',{policies:config.policies})}>检查配置</button> <button disabled={busy} onClick={()=>void run('publish',{version:config.version,policies:config.policies})}>发布配置</button></p>
 {config.history.length>0&&<label>回退为历史配置 <select aria-label="回退配置版本" value="" disabled={busy} onChange={e=>{if(e.target.value&&window.confirm('将此历史配置作为新版本发布？运行中任务不会重启。'))void run('rollback',{version:config.version,targetVersion:Number(e.target.value)})}}><option value="">选择版本</option>{config.history.map(h=><option key={h.version} value={h.version}>版本 {h.version}</option>)}</select></label>}</>}
 </section>
}
