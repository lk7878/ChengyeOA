import {readFileSync,readdirSync,existsSync} from 'node:fs'
export const STAGES = Object.freeze({
  conversation:{name:'任务沟通',checks:['chat','stream','tools']},
  ocr:{name:'病历与材料图片识别',checks:['vision']},
  ocr_complex:{name:'复杂图片复核',checks:['vision']},
  extraction:{name:'事实与信息提取',checks:['chat','stream','tools']},
  analysis:{name:'专业分析',checks:['chat','stream','tools']},
  clinical:{name:'诊疗规范与应然诊疗分析',checks:['chat']},
  drafting:{name:'报告与文书起草',checks:['chat','stream','tools']},
  review:{name:'报告与文书复核',checks:['chat','stream','tools']},
  embedding:{name:'知识向量化',checks:['embedding']},
  rerank:{name:'知识检索重排序',checks:['rerank']},
})
const legalSkills = JSON.parse(readFileSync(new URL('../../package/general-legal/skills.json',import.meta.url),'utf8'))
export const SKILLS=['general-legal','injury','medical-review','traffic-accident'].flatMap(bundle=>readdirSync(new URL('../../package/'+bundle+'/.agents/skills/',import.meta.url),{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(new URL('../../package/'+bundle+'/.agents/skills/'+e.name+'/SKILL.md',import.meta.url))).map(e=>{const id=e.name,content=readFileSync(new URL('../../package/'+bundle+'/.agents/skills/'+id+'/SKILL.md',import.meta.url),'utf8'),label=legalSkills.find(s=>s.id===id)?.label||content.match(/^# +(.+)$/m)?.[1]||id;return {id:bundle==='general-legal'?id:bundle+'-'+id,label,bundle,directory:id}}))
export const TOOLS = [
  {id:'files',name:'任务文件读取与检索'}, {id:'documents',name:'草稿与报告生成'},
  {id:'knowledge',name:'已授权知识库检索'}, {id:'ocr',name:'图片与扫描材料解析'},
  {id:'clinical',name:'临床规范分析'},
]
export const CAPABILITIES = [
  {id:'general',name:'通用法律',preset:'general-legal'},
  {id:'disability',name:'伤残鉴定',preset:'injury'},
  {id:'injury',name:'伤情鉴定',preset:'injury'},
  {id:'malpractice',name:'医疗损害',preset:'medical-review'},
  {id:'traffic',name:'交通事故',preset:'traffic-accident'},
]
const business={general:'法律检索、合同审查、应诉准备、证据整理、法律文书与事实时间线。',disability:'人体损伤致残程度咨询；先核实委托类型及适用标准，每份咨询意见仅适用一部标准。不得把咨询意见标为司法鉴定结论。',injury:'人体损伤程度分析；先明确伤情与伤残的区别，核对适用标准、原始损伤和检查依据，不推测缺失指标。',malpractice:'医疗损害分析；先核查病历完整性，再分别分析诊疗规范、过错、因果关系与损害后果，区分事实、医学判断与法律评价。',traffic:'交通事故鉴定咨询；先选择适用专项，核实原始视频、车辆和现场痕迹来源，明确测量误差、假设、参数与标准依据。'}
export function initialDraft(){return {connections:[],models:[],capabilities:CAPABILITIES.map(c=>({...c,enabled:true,instructions:business[c.id]+'仅使用当前任务材料和经授权的知识，所有结论、引用和报告均需律师复核。',roleIds:[],skills:SKILLS.filter(s=>s.bundle===c.preset||s.bundle==='general-legal').map(s=>s.id),tools:TOOLS.filter(t=>t.id!=='clinical'||c.id==='malpractice').map(t=>t.id),knowledgeBases:[],stages:Object.fromEntries(Object.keys(STAGES).filter(s=>!['embedding','rerank'].includes(s)&&(s!=='clinical'||c.id==='malpractice')).map(s=>[s,null]))})),skillGrants:Object.fromEntries(SKILLS.map(s=>[s.id,[]])),knowledge:{embedding:null,rerank:null}}}
