/**
 * 按《百佑智业鉴定咨询意见书》Word 模板填字段。
 * 模板里的 {{placeholder}} 可能被 Word 拆进多个 <w:t>，因此按段落拼接后再替换。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import {
  safeName,
  takeField,
  loadPriorFields,
  saveFields,
  uniqueDatedPair,
} from './report-paths.mjs'

export const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'template',
  '百佑智业_鉴定咨询意见书模板.docx',
)

export const FIELD_KEYS = [
  'insurance_company_name',
  'standard',
  'materials',
  'name',
  'gender',
  'id_number',
  'basic_case_details',
  'medical_history_digest',
  'reading_record',
  'analysis_explanation',
  'public_opinion',
]

export const FIELD_LABELS = {
  insurance_company_name: '委托单位',
  standard: '适用标准（只写一部全称）',
  materials: '委托检材',
  name: '被鉴定人姓名',
  gender: '性别',
  id_number: '身份证号',
  basic_case_details: '基本案情',
  medical_history_digest: '病史摘要',
  reading_record: '阅片记录',
  analysis_explanation: '分析说明',
  public_opinion: '伤残等级评估与意见（一个确定结论）',
}

export const CONSULTATION_TITLE = '鉴定咨询意见书'
export const CONSULTATION_DISCLAIMER = '本意见供委托方参考，不是司法鉴定意见书。'
const LAST_CONSULTATION = '.last-consultation.json'

const STANDARD_GROUPS = [
  { id: 'civil', test: /人体损伤致残程度分级/ },
  { id: 'work', test: /劳动能力鉴定|GB\/?\s*T?\s*16180/i },
  { id: 'insurance', test: /人身保险伤残|GB\/?\s*T?\s*44893/i },
  { id: 'degree', test: /人体损伤程度鉴定标准/ },
]

export function matchingStandards(text) {
  const s = String(text || '')
  return STANDARD_GROUPS.filter((g) => g.test.test(s)).map((g) => g.id)
}

export function assertSingleStandard(standard) {
  const text = String(standard || '').trim()
  if (!text || /待补充/.test(text)) {
    throw new Error('适用标准未确定。先询问委托类型（民事赔偿、工伤或人身保险），不要出件')
  }
  const hits = matchingStandards(text)
  if (hits.includes('degree')) {
    throw new Error('《人体损伤程度鉴定标准》只用于轻伤、重伤，不能写入伤残咨询意见。请改用《人体损伤致残程度分级》、工伤标准或《人身保险伤残评定及代码》')
  }
  if (hits.length === 0) {
    throw new Error('适用标准须写明一部全称：《人体损伤致残程度分级》、《劳动能力鉴定 职工工伤与职业病致残等级》或《人身保险伤残评定及代码》')
  }
  if (hits.length > 1) {
    throw new Error('一份咨询意见只评一部标准。请先问清委托类型，再只保留一部')
  }
  if (/44893/.test(text) && !/及代码/.test(text)) {
    throw new Error('GB/T 44893—2024 的标准名称是《人身保险伤残评定及代码》')
  }
  if (/16180/.test(text) && !/劳动能力鉴定/.test(text)) {
    throw new Error('请写工伤标准全称《劳动能力鉴定 职工工伤与职业病致残等级》（GB/T 16180-2014）')
  }
  return text
}

export function assertDefiniteOpinion(text, standard) {
  const t = String(text || '').trim()
  if (!t || /待补充/.test(t)) {
    throw new Error('伤残等级评估与意见须写出确定结论，不能填（待补充）')
  }
  if (/若(依据|适用|属于)/.test(t)) {
    throw new Error('意见须给出确定结论。标准未定时先询问委托类型，不得以「若适用」并列多部标准或多档等级')
  }
  if (/[一二三四五六七八九十0-9]{1,3}级(?:伤残)?(?:或者|或)[一二三四五六七八九十0-9]{1,3}级/.test(t)) {
    throw new Error('意见只能有一个等级，不能写「十级或九级」这类并列')
  }
  const suggestions = t.match(/建议(?:评定|评估)为/g) || []
  if (suggestions.length > 1) throw new Error('意见只能给出一个等级，不能同时建议两档')
  const definite = /构成.{0,12}[一二三四五六七八九十0-9]{1,3}级伤残|评定为.{0,8}[一二三四五六七八九十0-9]{1,3}级伤残|不构成伤残|未达伤残|未构成伤残|不评定伤残|不应进行致残|不符合评残前提|不进行伤残等级评定/
  if (!definite.test(t)) {
    throw new Error('意见须写明确定结论，例如「构成十级伤残」，或「不符合评残前提，不评定伤残等级」')
  }
  const chosen = matchingStandards(standard).filter((id) => id !== 'degree')
  const extras = matchingStandards(t).filter((id) => id !== 'degree' && !chosen.includes(id))
  if (extras.length) throw new Error('意见中出现了另一部标准。一份咨询意见只评已选定的那一部')
  return t
}

export function consultationStem(name) {
  return `${CONSULTATION_TITLE}（${safeName(name, '未署名')}）`
}

export function prepareConsultationFields(raw, previous) {
  const fields = {}
  for (const key of FIELD_KEYS) {
    fields[key] = takeField(raw[key], previous?.[key], FIELD_LABELS[key])
  }
  for (const key of FIELD_KEYS) {
    if (!fields[key] && key !== 'standard' && key !== 'public_opinion') fields[key] = '（待补充）'
  }
  assertSingleStandard(fields.standard)
  assertDefiniteOpinion(fields.public_opinion, fields.standard)
  return fields
}

export function applyConsultationChrome(xml) {
  let out = xml.replace('伤残等级评估意见书', CONSULTATION_TITLE)
  if (!out.includes(CONSULTATION_DISCLAIMER)) {
    const note = `<w:p><w:pPr><w:spacing w:before="360" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="仿宋" w:hAnsi="仿宋" w:eastAsia="仿宋" w:cs="仿宋"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr><w:t xml:space="preserve">${CONSULTATION_DISCLAIMER}</w:t></w:r></w:p>`
    out = out.replace('<w:sectPr>', `${note}<w:sectPr>`)
  }
  return out
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fillParagraph(pXml, fields) {
  const runs = []
  const marked = pXml.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (m, attrs, text) => {
    const i = runs.length
    runs.push({ attrs, text })
    return `__T${i}__`
  })
  if (runs.length === 0) return pXml
  const joined = runs.map((r) => r.text).join('')
  if (!joined.includes('{{')) return pXml

  let filled = joined
  for (const key of FIELD_KEYS) {
    const token = `{{${key}}}`
    if (!filled.includes(token)) continue
    const raw = fields[key]
    const value = raw == null || raw === '' ? '（待补充）' : String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    filled = filled.split(token).join(value)
  }
  if (filled === joined) return pXml

  const lines = filled.split('\n')
  if (!marked.includes('__T0__')) return pXml

  // 清空除第一处外的原 w:t，把填好的内容放进第一处；换行用 <w:br/>
  let body = marked.replace(/__T0__/, () => {
    return lines.map((line, i) => {
      const tEl = `<w:t${/xml:space/.test(runs[0].attrs) ? runs[0].attrs : `${runs[0].attrs} xml:space="preserve"`}>${escapeXml(line)}</w:t>`
      return i === 0 ? tEl : `<w:br/>${tEl}`
    }).join('')
  })
  for (let i = 1; i < runs.length; i++) {
    body = body.replace(`__T${i}__`, `<w:t${runs[i].attrs} xml:space="preserve"></w:t>`)
  }
  return body
}

export function fillDocumentXml(xml, fields) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => fillParagraph(p, fields))
}

export function fieldsToMarkdown(fields) {
  const v = (k) => {
    const raw = fields[k]
    return raw == null || String(raw).trim() === '' ? '（待补充）' : String(raw)
  }
  return [
    `# ${CONSULTATION_TITLE}`,
    '',
    CONSULTATION_DISCLAIMER,
    '',
    '## 一、基本情况',
    '',
    `委托单位：${v('insurance_company_name')}`,
    `委托事项：伤残等级咨询在（${v('standard')}）`,
    `委托检材：${v('materials')}`,
    `身份信息：${v('name')}，${v('gender')}，身份证号：${v('id_number')}。`,
    '',
    '## 二、基本案情',
    '',
    v('basic_case_details'),
    '',
    '## 三、病史摘要',
    '',
    v('medical_history_digest'),
    '',
    '## 四、阅片记录',
    '',
    v('reading_record'),
    '',
    '## 五、分析说明',
    '',
    v('analysis_explanation'),
    '',
    '## 六、伤残等级评估与意见',
    '',
    v('public_opinion'),
    '',
  ].join('\n')
}

export async function fillTemplate(fields, outDocxPath) {
  const buf = await readFile(TEMPLATE_PATH)
  const zip = await JSZip.loadAsync(buf)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('模板缺少 word/document.xml')
  const xml = applyConsultationChrome(fillDocumentXml(await docFile.async('string'), fields))
  zip.file('word/document.xml', xml)
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  await mkdir(path.dirname(outDocxPath), { recursive: true })
  await writeFile(outDocxPath, out)
  return outDocxPath
}

export async function writeReportPair(raw, reportsDir) {
  await mkdir(reportsDir, { recursive: true })
  const previous = await loadPriorFields(
    reportsDir,
    isNamed(raw.name) ? consultationStem(raw.name) : '',
    raw.name,
    LAST_CONSULTATION,
  )
  const fields = prepareConsultationFields(raw, previous)
  const stem = consultationStem(fields.name)
  const { docxPath, mdPath } = await uniqueDatedPair(reportsDir, stem)
  await fillTemplate(fields, docxPath)
  await writeFile(mdPath, fieldsToMarkdown(fields), 'utf8')
  await saveFields(reportsDir, stem, fields, LAST_CONSULTATION)
  return { docxPath, mdPath }
}

function isNamed(name) {
  const text = String(name || '').trim()
  return text !== '' && !/^[（(]?(沿用|同前)[）)]?$/.test(text)
}

// CLI：node fill-docx.mjs fields.json [out.docx]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = process.argv[2]
  const dest = process.argv[3] || path.join(process.cwd(), '鉴定咨询意见书.docx')
  if (!src) {
    console.error('用法: node fill-docx.mjs <fields.json> [out.docx]')
    process.exit(1)
  }
  const fields = prepareConsultationFields(JSON.parse(await readFile(src, 'utf8')), null)
  await fillTemplate(fields, dest)
  console.log(dest)
}
