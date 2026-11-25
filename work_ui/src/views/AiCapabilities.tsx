import {useEffect,useState} from 'react'
import {api} from '@/api/integration'
import {ModelConnections,RouteSelect,type Route,type Catalog} from './ModelConnections'
type Defaults={primary:Route|null;backup:Route|null;ocr:Route|null;ocrBackup?:Route|null;localOnly:boolean}
type Policy={inherit:boolean;primary:Route|null;backup:Route|null;preset:string;network:boolean;maxTokens:number}
type Config={version:number;defaults:Defaults;policies:Record<string,Policy>;presets:string[];history:{version:number}[]}
const presetNames:Record<string,string>={'general-legal':'通用法律','injury':'伤残与伤情鉴定','medical-review':'医疗损害审查','traffic-accident':'交通事故鉴定'}
const names:Record<string,string>={general:'通用任务',disability:'伤残鉴定',injury:'伤情鉴定',malpractice:'医疗损害',traffic:'交通事故'}
export function AiCapabilities(){
 const [config,setConfig]=useState<Config>(),[catalog,setCatalog]=useState<Catalog>(),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const load=()=>api<Config>('/api/ai-capabilities').then(setConfig)
 const refresh=()=>api<Catalog>('/api/model-connections').then(setCatalog)
 useEffect(()=>{void Promise.all([load(),refresh()]).catch(e=>setStatus(e.message))},[])
 const change=(kind:string,patch:Partial<Policy>)=>setConfig(c=>c&&({...c,policies:{...c.policies,[kind]:{...c.policies[kind],...patch}}}))
 const defaults=(patch:Partial<Defaults>)=>setConfig(c=>c&&({...c,defaults:{...c.defaults,...patch}}))
 const run=async(action:string,body:unknown)=>{setBusy(true);try{await api('/api/ai-capabilities/'+action,body);setStatus(action==='check'?'静态参数检查通过。':'任务策略已发布。');if(action!=='check')await load()}catch(e){setStatus((e as Error).message)}finally{setBusy(false)}}
 const routes=catalog?.active.filter(c=>!config?.defaults.localOnly||c.scope==='local')||[]
 return <section className="oa-panel"><h2>AI 能力配置</h2>{catalog&&<ModelConnections catalog={catalog} refresh={refresh}/>}
 <h3>任务策略</h3>{status&&<p role="status">{status}</p>}{config&&<><p>当前发布版本 {config.version}。新启动任务采用已发布策略，运行中任务保留模型快照。启用全局纯本地后，现有任务的外部连接也立即关闭；在纯本地模式下启动的任务始终受本地限制。</p>
 <fieldset disabled={busy}><legend>全所默认</legend>
 <label><input type="checkbox" checked={config.defaults.localOnly} onChange={e=>defaults({localOnly:e.target.checked})}/>纯本地模式</label>
 <p><RouteSelect label="默认主模型" items={routes} value={config.defaults.primary} onChange={primary=>defaults({primary})}/> <RouteSelect label="默认备用模型" optional items={routes} value={config.defaults.backup} onChange={backup=>defaults({backup})}/></p>
 <RouteSelect label="图片识别模型" optional items={routes} value={config.defaults.ocr} onChange={ocr=>defaults({ocr})}/> <RouteSelect label="备用识别模型" optional items={routes} value={config.defaults.ocrBackup||null} onChange={ocrBackup=>defaults({ocrBackup})}/><p>文字材料优先直接提取；扫描页和图片使用识别模型。照片描述会与文字引文区分，无法辨认处标记待核实。</p></fieldset>
 {Object.entries(config.policies).map(([kind,p])=><fieldset key={kind} disabled={busy}><legend>{names[kind]}</legend>
 <label><input type="checkbox" checked={p.inherit} onChange={e=>change(kind,{inherit:e.target.checked})}/>继承全所主备配置</label>
 {!p.inherit&&<p><RouteSelect label={names[kind]+'主模型'} items={routes} value={p.primary} onChange={primary=>change(kind,{primary})}/> <RouteSelect label={names[kind]+'备用模型'} optional items={routes} value={p.backup} onChange={backup=>change(kind,{backup})}/></p>}
 <p>运行包 {presetNames[p.preset]||p.preset} · 办案工具按业务预设加载</p>
 <label><input type="checkbox" disabled={config.defaults.localOnly} checked={!config.defaults.localOnly&&p.network} onChange={e=>change(kind,{network:e.target.checked})}/>允许公共网络访问</label> <label>单次生成上限 <input type="number" min={1024} max={65536} value={p.maxTokens} onChange={e=>change(kind,{maxTokens:Number(e.target.value)})}/></label></fieldset>)}
 <p><button disabled={busy} onClick={()=>void run('check',config)}>静态检查</button> <button disabled={busy} onClick={()=>void run('publish',config)}>发布任务策略</button></p>
 {config.history.length>0&&<label>回退为历史配置 <select value="" onChange={e=>{if(e.target.value&&window.confirm('将所选策略和纯本地设置发布为新版本？'))void run('rollback',{version:config.version,targetVersion:Number(e.target.value)})}}><option value="">选择版本</option>{config.history.map(h=><option key={h.version} value={h.version}>版本 {h.version}</option>)}</select></label>}</>}</section>
}
