/**
 * 病历分析报告：按 reporter 七章结构落盘 Markdown。
 * 不生成鉴定咨询意见书。
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAppendix,
  clinicalChapterGaps,
  clinicalSourceNeed,
  forbiddenHeadingGaps,
  appraisalQualityGaps,
  overviewSourceGaps,
  postProcessReportText,
  sanitizeClinicalChapter,
} from './report-text.mjs'

export const FIELD_KEYS = [
  'patient_name',
  'overview',
  'integrity',
  'diagnosis',
  'treatment',
  'consent',
  'damage',
  'causation',
]

export const CHAPTER_KEYS = [
  'overview',
  'integrity',
  'diagnosis',
  'treatment',
  'consent',
  'damage',
  'causation',
]

export const STATE_FILENAME = '.report-fields.json'

const CHAPTER_ALIASES = {
  overview: 'overview',
  '1': 'overview',
  一: 'overview',
  诊疗概要: 'overview',
  患者诊疗过程概要: 'overview',
  诊断分析: 'diagnosis',
  integrity: 'integrity',
  '2': 'integrity',
  二: 'integrity',
  完整性: 'integrity',
  合规性: 'integrity',
  病历完整性分析: 'integrity',
  病历合规性分析: 'integrity',
  diagnosis: 'diagnosis',
  '3': 'diagnosis',
  三: 'diagnosis',
  诊断: 'diagnosis',
  诊断依据审查分析: 'diagnosis',
  治疗分析: 'treatment',
  treatment: 'treatment',
  '4': 'treatment',
  四: 'treatment',
  治疗: 'treatment',
  治疗合理性分析: 'treatment',
  consent: 'consent',
  '5': 'consent',
  五: 'consent',
  知情: 'consent',
  知情同意审查结果: 'consent',
  知情同意分析: 'consent',
  damage: 'damage',
  '6': 'damage',
  六: 'damage',
  损害: 'damage',
  损害后果: 'damage',
  causation: 'causation',
  '7': 'causation',
  七: 'causation',
  因果: 'causation',
  因果关系及原因力初判: 'causation',
  因果关系与原因力分析: 'causation',
}

export function normalizeChapterKey(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (CHAPTER_ALIASES[raw]) return CHAPTER_ALIASES[raw]
  const compact = raw.replace(/^第/, '').replace(/章$/, '').replace(/[、.．\s]/g, '')
  return CHAPTER_ALIASES[compact] || ''
}

const CHAPTER_HEADINGS = {
  overview: '## 一、患者诊疗过程概要',
  integrity: '## 二、病历合规性分析',
  diagnosis: '## 三、诊断依据审查分析',
  treatment: '## 四、治疗合理性分析',
  consent: '## 五、知情同意审查结果',
  damage: '## 六、损害后果',
  causation: '## 七、因果关系及原因力初判',
}

export const FIELD_LABELS = {
  patient_name: '患者姓名。标题写成「# 姓名案」。人称一律称「患者」。禁止把双花括号占位符写入正文。',
  overview:
    '一、患者诊疗过程概要。按时间顺序还原。每次门诊、急诊或一次住院单独起段，段内一个连贯自然段。禁止表格、禁止加粗、禁止章内再写大标题、禁止「小结」、禁止 ### 小节、禁止项目符号。无门诊不写门诊条；无急诊整条省略，不要写「无急诊记录」。拟行≠已做。同一医院多次住院按次分开。' +
    '段首不加粗，格式只能是：「YYYY年M月D日门诊（医院名称） ：」「YYYY年M月D日急诊（医院名称） ：」「第N次住院（医院名称，YYYY年M月D日至YYYY年M月D日）：」。' +
    '段首已写医院，引用简写【文书类型，第N页】，必须紧贴该事实，禁止整段只在段末挂一处出处。多文书写【手术及操作记录，第2页；手术记录，第26页】；连续页写【CT检查报告，第143–145页】；不相邻页写【出院记录，第7页、第28页】。页码不得编造。' +
    '出处优先用专门文书，禁止把检验、影像、用药、护理和病情经过改挂到出院记录或死亡记录。检验数值引检验报告；影像和病理结论引影像报告或病理报告；用药、护理级别、吸氧和监护引医嘱；护理观察引护理记录；病情首次变化引该事实第一次出现的病程页。入院诊断和入院查体引入院记录、病案首页或首次病程。手术经过引手术记录。出院记录只用于出院时间、出院诊断和出院医嘱；死亡记录只用于死亡时间和死亡诊断。' +
    '页码必须是 catalog 里的页，文书名与该页的大类或具体文书一致。写之前用 parse_records_query 核对，该页原文没有这句话就不要引。不要写「附件材料」。卷内确无报告单或医嘱单时，改引首次出现的病程或护理页，并写明「卷内未见检验报告单原件」或「卷内未见医嘱单」。' +
    '主诉和诊断用中文引号。检验异常按报告单在数值后标↑或↓。拟行手术不得写成已实施。',
  integrity:
    '二、病历合规性分析。禁止表格、禁止自拟「小结」。不得仅因目录没有某文书即认定必然应当存在。' +
    '必须有「### （一）病历完整性」：按医院逐条写「医院名-入院时间-出院时间：缺少的病历文书」。无明显缺失则写清未发现影响本案分析的关键病历缺失。' +
    '必须有「### （二）病历书写及管理规范性」：按问题编号，每项一个连贯段落：「1. 问题短标题。问题描述」。' +
    '仅确有异常时才写「### （三）病历真实性疑点及核验建议」。不得直接认定伪造或篡改。',
  diagnosis:
    '三、诊断依据审查分析。开篇按时间顺序概述诊断形成和变化（门诊、急诊、入院、术前、术后、病理、补充、修正、死亡、出院诊断）。禁止表格、禁止自拟「入院诊断/小结」。' +
    '必须有「### （一）主要诊断及依据充分性」。每个诊断用「#### 1. 诊断名称」然后：（1）诊断形成时间及文书；（2）临床依据；（3）诊疗指南依据：必须引用 expected_care_plan 已核实的《临床指南/教科书/专家共识》名称、机构、年份及具体要求，写成「1）《指南（年份）》：……」。禁止用《劳动能力鉴定 职工工伤与职业病致残等级》《人体损伤致残程度分级》、GB/T 16180、SF/T 0097 代替临床指南。未检索到写【医学常识】及「具体条款有待核实」，不得编造条款号；（4）依据充分性评价。缺数据写「（病历未记录）」，不得空写「依据充分」。' +
    '必须有「### （二）诊断环节可能存在的医疗过错」。每项「#### 1. 问题短标题」：（1）具体过错行为；（2）病历依据；（3）诊疗指南依据：同上，只引临床指南/教科书/共识；（4）过错总体评价。未发现问题写「根据现有材料，未发现明显诊断不当」。',
  treatment:
    '四、治疗合理性分析。开篇概述观察与支持治疗、药物治疗、抗感染、液体复苏、呼吸或循环支持、介入治疗、手术治疗、护理、康复及转诊等已实施治疗。只评已实施。禁止表格、禁止自拟「小结」。规范须标明教科书/临床指南/专家共识/医学常识，来自 expected_care_plan，禁止编造未检索到的条款。用药、过度医疗、机会丧失三节必须写；无对应问题写「根据现有材料，未发现明显不当」。有手术或有创操作必须写手术治疗节。' +
    '「### （一）一般治疗方案合理性」每个方案用「#### A. 治疗方案名称」：（1）治疗目的及适应证；（2）实际实施情况：开始时间、方案、疗程、调整及效果【医院名称，文书类型，第N页】；（3）发现的问题，未发现写「根据现有材料，未发现该治疗方案存在明显不当。」；（4）病历资料依据；（5）诊疗规范依据：只引 expected_care_plan 已核实的教科书/临床指南/专家共识，格式「1）《指南名称（年份）》：具体要求」。禁止把评残国标、工伤致残等级、人体损伤致残程度分级当作诊疗依据。没有临床指南则写【医学常识】，不要用伤残标准凑数；（6）综合分析指征、时机、方案、疗程、调整、监测及偏离影响。' +
    '「### （二）手术治疗合理性」每台用「#### A. 手术完整名称」：（1）手术基本信息：手术日期；手术级别（无法核实写「现有资料无法确定」）；（2）适应证、禁忌证及手术时机；（3）术前准备及风险评估；（4）术中操作及异常情况【手术记录，第N页】；（5）术后监测及处理；（6）发现的问题；（7）手术规范依据；（8）综合评价。' +
    '「### （三）用药合理性」必须设置。按药物或类别写：名称、剂量、途径、频次及疗程；适应证；禁忌证及过敏史；肝肾功能、相互作用及剂量调整；疗效和不良反应监测；抗菌药物选择、送检、降阶梯及疗程；与指南偏离及可能医学影响。无法核实写「现有资料无法核实」，不得推定。无对应用药写「根据现有材料，未发现明显用药不当。」' +
    '「### （四）过度医疗审查」必须设置。检查指征、短期无必要重复检查、治疗强度、手术或介入适应证、风险明显大于获益、无理由延长住院或扩大治疗范围。费用高、检查多或结果不佳本身不等同于过度医疗。未发现写「根据现有材料，未发现明显过度医疗」。' +
    '「### （五）救治机会丧失审查」必须设置。是否因延迟诊断、延迟治疗或手术、未及时复查会诊转诊、未识别恶化、未告知可选择方案、未采取当时可行抢救而使机会降低。须说明三要件是否同时成立，以及：（1）当时客观存在何种诊疗或生存、康复机会；（2）医疗行为如何影响该机会；（3）该机会是否具有现实性而非纯粹假设；（4）现有证据能否评估降低程度。' +
    '「### （六）其他医疗过错」：护理、转诊、医院管理、器械设备、感染控制、病理送检及结果追踪。',
  consent:
    '五、知情同意审查结果。禁止表格。' +
    '必须有「### （一）知情同意文书齐全性」。按医院「#### 1. 医院名称」列已经提供的《文书名称》【文书类型，第N页】，以及缺少或未见的、依法或依诊疗行为通常应当形成的文书。' +
    '必须有「### （二）合法性与实质告知审查」。每项「#### 1. 问题短标题」：（1）涉及的诊疗行为：手术、特殊检查、特殊治疗、输血、麻醉等；（2）文书及病历记载【文书类型，第N页】；（3）审查内容：是否行为前告知；告知人及签字人是否适格；是否说明病情、治疗目的、主要风险、替代方案及不治疗后果；是否给予合理选择机会；有无空白签字、代签、补签或签署时间异常；紧急情况未取得同意是否履行审批；（4）初步评价只能是：符合要求 / 形式齐全但实质告知不足 / 文书缺失 / 签署存在疑问 / 现有材料不足以评价。签字≠充分实质告知；缺文书≠完全未口头告知。' +
    '必须有「### （三）审查依据」，下设「#### 1. 法律法规依据」（名称、施行时间、条款必须核实，无法核实不得编造条款号）、「#### 2. 医疗规范依据」、「#### 3. 具体病历依据」。',
  damage:
    '六、损害后果。禁止表格、禁止写原因力、禁止自拟「待补项」。' +
    '必须有「### （一）最终损害后果」：以「患者姓名，性别，年龄岁。」起句，用180～300字一个连贯自然段概括目前或最终主要损害：原发疾病、诊疗中主要并发症或继发损害、重要器官功能障碍、后续治疗需求、生活自理能力、劳动能力及最终转归。只写有材料支持的损害。' +
    '仅死亡案例写「### （二）死亡原因初步分析」，写「根据现有病历资料对患者死亡原因可能性分析：患者直接死因为A，根本死因为B，死亡发展进程为C。」进行了尸检则另写：尸检报告结果为：“……”' +
    '仅治疗终结、伤情相对稳定且材料足够时写「### （三）伤残初步评定」：依据《人体损伤致残程度分级》已核实条款编号及核心内容，描述损伤及功能障碍，初步考虑可能构成的伤残等级，并写以实际鉴定结果为准。材料不足必须写：「现有资料尚不足以进行伤残等级评定，建议待治疗终结、伤情稳定并完善相应检查后再行鉴定。」',
  causation:
    '七、因果关系及原因力初判。禁止表格、禁止自拟「but-for检验」「原因力分析」。' +
    '必须有「### （一）因果关系初步分析」，开篇写：「根据患者现有病历资料，医疗过错行为与患者损害后果之间存在因果关系，具体分析如下：」（若某院无过错则不要写存在因果关系，改为该院「根据现有材料，未发现明显不当」，不计入医方原因力）。按医院「#### （1）医院名称的医疗过错行为：」下列 1.具体过错：病历事实—规范要求（含是否适用本案）—过错分析—病理生理符合性，附【医院名称，文书类型，第N页】。but-for 写成句不要当标题。同一医院多次住院不拆。已补充的诊断不得写成「始终未诊断」。本节不写约占百分比。' +
    '必须有「### （二）因果关系及原因力初判结果及参考依据」。开篇只写：「综合考虑患者原发疾病及医院的医疗过错，对损害后果的原因力初步划分如下：」。接着用「• 」条目，不要用表格，不要按单项过错拆百分比：' +
    '• 自身疾病因素（高龄、冠状动脉粥样硬化性心脏病三支病变等）：约占70%-95%（主要原因）。括号内列举本案对损害起作用的原发疾病、高龄和基础病，顿号分隔，可加「等」。' +
    '• 医院名称整体医疗过错：约占5%-30%（轻微至次要原因）。每家已认定过错的医院单独一条；未发现明显不当的医院不写；不要写成「医方」。' +
    '区间用半角连字符，如 70%-95%、5%-30%。同一档写（主要原因）；只允许跨相邻两档并写成（轻微至次要原因）。档位：无因果关系0%-4%；轻微5%-15%；次要16%-44%；同等45%-55%；主要56%-95%；全部96%-100%。自身疾病与各医院区间应对应，各条低端或高端相加宜为100%。本节不写法定反事实原句。原因力≠法律责任比例，≠法院赔偿比例。' +
    '未死亡或死亡已尸检，备注：1.上述评价为医学层面的原因力初判，提供对责任划分和赔偿比例的参考，但不直接等同于法律责任比例；2.后续处理建议：建议可首选在院内或通过医调委介入与医院在合理赔偿区间内协商调解，或共同选择鉴定机构；若调解不成，经慎重考虑后可通过诉讼解决。' +
    '死亡未尸检，备注另加：3.因本案未进行尸检，因此关于死亡原因的分析系根据现有病历资料归纳的较大可能性原因，不直接作为患者死亡原因的认定依据。诉讼风险极高，但若医患双方均认可医方出具的死亡原因诊断，建议仍可先行协商调解。',
}

export const REQUIRED_SUBHEADINGS = {
  overview: ['门诊（', '急诊（', '次住院（'],
  integrity: ['### （一）病历完整性', '### （二）病历书写及管理规范性'],
  diagnosis: ['### （一）主要诊断及依据充分性', '### （二）诊断环节可能存在的医疗过错'],
  treatment: [
    '### （一）一般治疗方案合理性',
    '### （三）用药合理性',
    '### （四）过度医疗审查',
    '### （五）救治机会丧失审查',
  ],
  consent: ['### （一）知情同意文书齐全性', '### （二）合法性与实质告知审查', '### （三）审查依据'],
  damage: ['### （一）最终损害后果'],
  causation: ['### （一）因果关系初步分析', '### （二）因果关系及原因力初判结果及参考依据'],
}

export const CHAPTER_FORMAT_HINT =
  '出件必须以 medical-report-writing 技能全文为准。禁止自拟「小结」「入院诊断」「原因力分析」「but-for检验」「待补项」，禁止把双花括号占位原文写入正文。' +
  Object.entries(FIELD_LABELS)
    .filter(([key]) => key !== 'patient_name')
    .map(([key, text]) => `【${key}】${text}`)
    .join('')

function headingPresent(raw, heading) {
  const core = heading.replace(/^#+\s+/, '')
  return raw.includes(heading) || raw.includes(core)
}

export function missingSubheadings(chapter, text, extras = {}) {
  const raw = String(text || '')
  if (!raw.trim()) return [...(REQUIRED_SUBHEADINGS[chapter] || [])]
  if (chapter === 'overview') {
    if (!/门诊（|急诊（|第.+次住院（/.test(raw)) {
      return ['YYYY年M月D日门诊（医院名称） ：、YYYY年M月D日急诊（医院名称） ： 或 第N次住院（医院名称，起止日）：']
    }
    const parts = raw.split(/(?=20\d{2}年\d{1,2}月\d{1,2}日\s*(?:门诊|急诊)|第\d+次住院（)/)
    const thin = parts.some((part) => {
      if (!/门诊（|急诊（|次住院（/.test(part)) return false
      const cites = (part.match(/【/g) || []).length
      return part.length > 220 && cites < 3
    })
    const sourceGaps = overviewSourceGaps(raw, extras.catalogText || '')
    if (thin) {
      return ['概要中体征、检查、诊断、手术、医嘱须分别紧跟【文书类型，第N页】，不要整段只在段末标注一次', ...sourceGaps]
    }
    return sourceGaps
  }
  const need = [...(REQUIRED_SUBHEADINGS[chapter] || [])]
  if (chapter === 'damage') {
    const death = extras.is_death_case === true || extras.is_death_case === 'true'
    if (death && !headingPresent(raw, '### （二）死亡原因初步分析')) {
      need.push('### （二）死亡原因初步分析')
    }
    if (
      !death
      && !headingPresent(raw, '伤残初步评定')
      && !raw.includes('现有资料尚不足以进行伤残等级评定')
    ) {
      need.push('### （三）伤残初步评定')
    }
  }
  need.push(...clinicalChapterGaps(chapter, raw))
  need.push(...forbiddenHeadingGaps(chapter, raw))
  need.push(...appraisalQualityGaps(chapter, raw))
  if (chapter === 'treatment' && /切开复位|腹腔镜|内固定术|切除术|置换术|成形术|引流术|手术记录|术中出血|全麻下/.test(raw)) {
    if (!headingPresent(raw, '### （二）手术治疗合理性')) {
      need.push('### （二）手术治疗合理性')
    }
  }
  return need.filter((heading) => !headingPresent(raw, heading))
}

export function collectSubheadGaps(fields = {}, extras = {}) {
  const gaps = {}
  for (const key of CHAPTER_KEYS) {
    const text = fields[key]
    if (!String(text || '').trim()) continue
    const miss = missingSubheadings(key, text, extras)
    if (miss.length) gaps[key] = miss
  }
  return gaps
}

function isAliveCase(extras = {}) {
  if (extras.is_death_case === true || extras.is_death_case === 'true') return false
  return extras.alive === true || extras.alive === 'true' || extras.is_death_case === false || extras.is_death_case === 'false'
}

function ensureHeading(text, heading) {
  const raw = text == null ? '' : String(text).trim()
  const body = raw
    .replace(/^#{1,3}\s+[一二三四五六七]、[^\n]*/, '')
    .trim()
  if (!body) return `${heading}\n\n（待补充）`
  return `${heading}\n\n${body}`
}

export function cleanFields(fields, extras = {}) {
  const alive = isAliveCase(extras)
  const out = { patient_name: String(fields.patient_name || '').trim() || '患者' }
  for (const key of Object.keys(CHAPTER_HEADINGS)) {
    const dates = key === 'overview' || key === 'damage'
    const deathSensitive = key === 'damage' || key === 'causation'
    out[key] = postProcessReportText(fields[key], { alive: alive && deathSensitive, dates })
  }
  return out
}

export function fieldsToMarkdown(fields, extras = {}) {
  const cleaned = cleanFields(fields, extras)
  const name = cleaned.patient_name
  const chapters = Object.entries(CHAPTER_HEADINGS).map(([key, heading]) =>
    ensureHeading(cleaned[key], heading),
  )
  const body = postProcessReportText(
    [`# ${name}案`, '', '# 病历分析报告', '', ...chapters, ''].join('\n'),
    { dates: true },
  )
  const appendixBlock = buildAppendix({
    guidelines: extras.appendix_guidelines,
    overview: cleaned.overview,
  })
  return `${body.trim()}\n\n${appendixBlock}`.trim()
}

export async function writeReportPair(fields, reportsDir, extras = {}) {
  await mkdir(reportsDir, { recursive: true })
  const mdPath = path.join(reportsDir, '病历分析报告.md')
  await writeFile(mdPath, `${fieldsToMarkdown(fields, extras).trim()}\n`, 'utf8')
  return { mdPath }
}

function extrasFromState(extras = {}) {
  const out = { ...extras }
  delete out.appendix
  return out
}

export async function loadReportState(reportsDir) {
  try {
    const raw = await readFile(path.join(reportsDir, STATE_FILENAME), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      fields: parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {},
      extras: parsed.extras && typeof parsed.extras === 'object' ? parsed.extras : {},
    }
  } catch {
    return { fields: {}, extras: {} }
  }
}

export function missingChapters(fields = {}) {
  return CHAPTER_KEYS.filter((key) => !String(fields[key] || '').trim())
}

const reportLocks = new Map()

function withReportLock(reportsDir, fn) {
  const key = path.resolve(reportsDir)
  const prev = reportLocks.get(key) || Promise.resolve()
  const next = prev.then(fn, fn)
  reportLocks.set(key, next.catch(() => {}))
  return next
}

export async function mergeAndWriteReport(reportsDir, patch = {}, extrasPatch = {}) {
  return withReportLock(reportsDir, async () => {
    const state = await loadReportState(reportsDir)
    const fields = { ...state.fields }
    const saved = []
    if (patch.patient_name && String(patch.patient_name).trim()) {
      fields.patient_name = String(patch.patient_name).trim()
      saved.push('patient_name')
    }
    for (const key of CHAPTER_KEYS) {
      if (patch[key] != null && String(patch[key]).trim()) {
        fields[key] = sanitizeClinicalChapter(key, String(patch[key]))
        saved.push(key)
      }
    }
    const extras = extrasFromState({ ...state.extras, ...extrasPatch })
    let catalogText = ''
    try {
      catalogText = await readFile(path.join(reportsDir, 'review', 'catalog.md'), 'utf8')
    } catch {
      catalogText = ''
    }
    await mkdir(reportsDir, { recursive: true })
    await writeFile(
      path.join(reportsDir, STATE_FILENAME),
      `${JSON.stringify({ fields, extras }, null, 2)}\n`,
      'utf8',
    )
    const { mdPath } = await writeReportPair(fields, reportsDir, extras)
    return {
      mdPath,
      saved,
      missing: missingChapters(fields),
      subheadGaps: collectSubheadGaps(fields, { ...extras, catalogText }),
      clinicalNeed: clinicalSourceNeed(fields, extras),
      patient_name: fields.patient_name || '',
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { readFile } = await import('node:fs/promises')
  const src = process.argv[2]
  const dest = process.argv[3] || path.join(process.cwd(), '病历分析报告.md')
  if (!src) {
    console.error('用法: node fill-docx.mjs <fields.json> [out.md]')
    process.exit(1)
  }
  const fields = JSON.parse(await readFile(src, 'utf8'))
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, `${fieldsToMarkdown(fields).trim()}\n`, 'utf8')
  console.log(dest)
}
