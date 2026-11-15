/**
 * 生成《伤残鉴定报告审核意见》Word。章节固定，正文由模型按 skill 填短字段。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { para, writeNoteDocx } from './note-docx.mjs'
import {
  safeName,
  isKeepToken,
  takeField,
  readJson,
  saveFields,
  uniqueDatedPair,
} from './report-paths.mjs'

const VERDICTS = ['结论合理', '部分条款需调整', '结论不合理']
const LAST_REVIEW = '.last-review.json'
const DISCLAIMER = '本意见供委托方参考，不是司法鉴定意见书。只评价鉴定结论与分析讨论是否符合所引标准。病历与法医临床检查按报告陈述采信。'

const LABELS = {
  subject_name: '被鉴定人姓名',
  report_ref: '审核对象',
  applied_standard: '适用标准',
  original_conclusion: '原鉴定结论',
  review_verdict: '审核结论',
  item_review: '条款对照',
  risk_notes: '潜在风险提示',
}

export function assertVerdict(text) {
  const t = String(text || '').trim()
  if (!VERDICTS.some((v) => t.startsWith(v))) {
    throw new Error('review_verdict 必须以「结论合理」「部分条款需调整」或「结论不合理」开头')
  }
  return t
}

export function normalizeRisk(text) {
  let t = String(text || '').trim() || '无。'
  if (/^(无|无。|无风险|无明显风险|暂无)[。.]?$/.test(t)) return '无。'
  const core = t.replace(/上述事项不影响审核结论。?/g, '').replace(/可能为OCR识别问题，请人工进行审查。?/g, '').trim()
  const timingOk = /已满|已逾|已超过|符合鉴定时限|时限符合|可以鉴定/.test(core)
  const timingBad = /未满|不足|未到|过早|偏早|时机未|尚未/.test(core)
  const other = /内固定|功能锻炼|复查|条款|标准名称|编号|名称与|错别字|书写错误|日期矛盾|笔误|OCR|前后不一|其他不合理/.test(core)
  if (timingOk && !timingBad && !other) return '无。'
  if (/时限|未满|不足.{0,6}月|鉴定时机|内固定/.test(t) && !/不影响/.test(t)) {
    t = `${t}\n上述事项不影响审核结论。`
  }
  if (/错别字|书写错误|日期矛盾|笔误/.test(t) && !/可能为OCR识别问题，请人工进行审查/.test(t)) {
    t = `${t}\n可能为OCR识别问题，请人工进行审查。`
  }
  return t
}

export function assertCitedStandard(fields) {
  const applied = fields.applied_standard
  const discussed = `${fields.review_verdict}\n${fields.item_review}`
  if (/44893/.test(applied) && /人身保险伤残评定标准/.test(applied) && !/及代码/.test(applied)) {
    if (!/及代码/.test(discussed) || !/名称|编号/.test(discussed)) {
      throw new Error('报告把 GB/T 44893—2024 写成了《人身保险伤残评定标准》。适用标准栏照录报告原文。审核结论或条款对照必须写明：该编号对应的名称是《人身保险伤残评定及代码》')
    }
  }
}

export function compactRef(ref) {
  return String(ref || '')
    .replace(/\s+/g, '')
    .replace(/[〔【﹝\[]/g, '[')
    .replace(/[〕】﹞\]]/g, ']')
    .replace(/[，,、；;]/g, '')
}

/** 从「机构，文号」抽出文件名用的短标记，同一人不同文号不会落到同一个文件。 */
export function reviewTag(reportRef) {
  const raw = String(reportRef || '').trim()
  if (!raw || isKeepToken(raw) || /未注明|待补充/.test(raw)) return ''
  const num = raw.match(/第\s*([0-9０-９]{1,6})\s*号/)
  const n = num
    ? `${num[1].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))}号`
    : ''
  let org = raw.split(/[，,、；;]/)[0]
  org = org.replace(/司法鉴定中心|司法鉴定所|鉴定中心|鉴定所/g, '')
  org = org.replace(/^[\u4e00-\u9fff]{2,8}?(?:省|市|自治区|区|县)/, '')
  org = org.replace(/[〔\[【﹝].*$/, '')
  org = safeName(org, '').replace(/\s+/g, '')
  if (org.length > 6) org = org.slice(0, 6)
  return safeName(`${org}${n}`, n || '未编号').slice(0, 20)
}

export function sameRef(a, b) {
  const ca = compactRef(a)
  const cb = compactRef(b)
  if (!ca || !cb || isKeepToken(a) || isKeepToken(b)) return false
  if (ca === cb) return true
  const ta = reviewTag(a)
  const tb = reviewTag(b)
  return Boolean(ta && ta === tb)
}

export function reviewStem(subjectName, reportRef) {
  const name = safeName(subjectName, '未署名')
  const tag = reviewTag(reportRef)
  return tag
    ? `伤残鉴定报告审核意见（${name}·${tag}）`
    : `伤残鉴定报告审核意见（${name}）`
}

export async function loadReviewPrior(reportsDir, raw) {
  const name = String(raw.subject_name || '').trim()
  const ref = String(raw.report_ref || '').trim()
  const last = await readJson(path.join(reportsDir, LAST_REVIEW))
  const lastFields = last?.fields || null
  const nameKeep = isKeepToken(name)
  const refKeep = isKeepToken(ref)

  if (nameKeep || refKeep) {
    if (!lastFields) return null
    if (!nameKeep && lastFields.subject_name !== name) return null
    if (!refKeep && !sameRef(lastFields.report_ref, ref)) return null
    return lastFields
  }

  const own = await readJson(path.join(reportsDir, `${reviewStem(name, ref)}.fields.json`))
  if (own && own.subject_name === name && sameRef(own.report_ref, ref)) return own
  if (lastFields && lastFields.subject_name === name && sameRef(lastFields.report_ref, ref)) return lastFields
  return null
}

export function prepareFields(raw, previous) {
  const pick = (key) => takeField(raw[key], previous?.[key], LABELS[key])
  const fields = {
    subject_name: pick('subject_name') || '（未注明）',
    report_ref: pick('report_ref') || '（未注明）',
    applied_standard: pick('applied_standard') || '（未注明）',
    original_conclusion: pick('original_conclusion') || '（报告未摘录到鉴定意见）',
    review_verdict: assertVerdict(pick('review_verdict')),
    item_review: pick('item_review'),
    risk_notes: normalizeRisk(pick('risk_notes')),
  }
  if (!fields.item_review) throw new Error('item_review 不能为空')
  if (/[（(）)]|鉴定/.test(fields.subject_name)) {
    throw new Error('subject_name 只写被鉴定人姓名。鉴定机构与文号写在 report_ref，不要写进姓名')
  }
  if (!fields.report_ref || /未注明|待补充/.test(fields.report_ref)) {
    throw new Error('report_ref 须写明鉴定机构和文号。同一人在多家机构的意见书各出一份，不能共用一个文件')
  }
  assertCitedStandard(fields)
  return fields
}

export function fieldsToMarkdown(fields) {
  return [
    '# 伤残鉴定报告审核意见',
    '',
    DISCLAIMER,
    '',
    `被鉴定人：${fields.subject_name}`,
    `审核对象：${fields.report_ref}`,
    `适用标准：${fields.applied_standard}`,
    '',
    '## 一、原鉴定结论',
    '',
    fields.original_conclusion,
    '',
    '## 二、审核结论',
    '',
    fields.review_verdict,
    '',
    '## 三、条款对照',
    '',
    fields.item_review,
    '',
    '## 四、潜在风险提示',
    '',
    fields.risk_notes,
    '',
  ].join('\n')
}

function documentBody(fields) {
  return [
    para('伤残鉴定报告审核意见', { font: '黑体', size: 36, bold: true, align: 'center', before: 0, after: 280, line: 360 }),
    para(`被鉴定人：${fields.subject_name}`, { size: 24, after: 60 }),
    para(`审核对象：${fields.report_ref}`, { size: 24, after: 60 }),
    para(`适用标准：${fields.applied_standard}`, { size: 24, after: 200 }),
    para('一、原鉴定结论', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.original_conclusion, { indent: 480 }),
    para('二、审核结论', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.review_verdict, { indent: 480 }),
    para('三、条款对照', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.item_review, { indent: 480 }),
    para('四、潜在风险提示', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.risk_notes, { indent: 480 }),
    para(DISCLAIMER, { size: 21, after: 0, before: 360 }),
  ].join('')
}

export async function writeReviewDocx(fields, outDocxPath) {
  return writeNoteDocx(documentBody(fields), outDocxPath)
}

export async function writeReviewPair(raw, reportsDir) {
  await mkdir(reportsDir, { recursive: true })
  const previous = await loadReviewPrior(reportsDir, raw)
  const fields = prepareFields(raw, previous)
  const stem = reviewStem(fields.subject_name, fields.report_ref)
  const { docxPath, mdPath } = await uniqueDatedPair(reportsDir, stem)
  await writeReviewDocx(fields, docxPath)
  await writeFile(mdPath, fieldsToMarkdown(fields), 'utf8')
  await saveFields(reportsDir, stem, fields, LAST_REVIEW)
  return { docxPath, mdPath }
}

export function reviewBasename(subjectName, reportRef) {
  return reviewStem(subjectName, reportRef)
}
