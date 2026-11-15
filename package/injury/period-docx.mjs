/**
 * 生成《误工护理营养期咨询意见》Word。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { para, writeNoteDocx } from './note-docx.mjs'
import {
  safeName,
  takeField,
  loadPriorFields,
  saveFields,
  uniqueDatedPair,
} from './report-paths.mjs'

const LAST_PERIOD = '.last-period.json'
const DISCLAIMER = '本意见供委托方参考，不是司法鉴定意见书。'
const LABELS = {
  subject_name: '被鉴定人姓名',
  client_name: '委托单位',
  materials: '委托检材',
  injury_digest: '伤情摘要',
  standard: '适用标准',
  opinion: '评定意见',
  notes: '待补充事项',
}

export function assertPeriod(fields) {
  const standard = String(fields.standard || '').trim()
  if (!standard || /待补充/.test(standard)) {
    throw new Error('三期意见须写明检索到的一部标准全称，不能填（待补充）')
  }
  if ((standard.match(/《/g) || []).length > 1 || /若(依据|适用)/.test(standard)) {
    throw new Error('三期意见只写一部标准')
  }
  const opinion = String(fields.opinion || '').trim()
  if (!opinion || /待补充/.test(opinion)) throw new Error('评定意见须写明误工期、护理期、营养期')
  if (/若(依据|适用)/.test(opinion)) throw new Error('三期须给出确定期限，不得写「若适用」')
  if (!/误工/.test(opinion) || !/护理/.test(opinion) || !/营养/.test(opinion) || !/出处/.test(opinion)) {
    throw new Error('意见须同时写明误工期、护理期、营养期，并标注【出处】')
  }
  if (!fields.injury_digest || /待补充/.test(fields.injury_digest)) {
    throw new Error('伤情摘要不能为空')
  }
}

export function periodStem(name) {
  return `误工护理营养期咨询意见（${safeName(name, '未署名')}）`
}

export function preparePeriodFields(raw, previous) {
  const pick = (key) => takeField(raw[key], previous?.[key], LABELS[key])
  const fields = {
    subject_name: pick('subject_name') || '（待补充）',
    client_name: pick('client_name') || '（待补充）',
    materials: pick('materials') || '（待补充）',
    injury_digest: pick('injury_digest'),
    standard: pick('standard'),
    opinion: pick('opinion'),
    notes: pick('notes') || '无。',
  }
  assertPeriod(fields)
  return fields
}

export function fieldsToMarkdown(fields) {
  return [
    '# 误工护理营养期咨询意见',
    '',
    DISCLAIMER,
    '',
    `被鉴定人：${fields.subject_name}`,
    `委托单位：${fields.client_name}`,
    `委托检材：${fields.materials}`,
    `适用标准：${fields.standard}`,
    '',
    '## 一、伤情摘要',
    '',
    fields.injury_digest,
    '',
    '## 二、评定意见',
    '',
    fields.opinion,
    '',
    '## 三、待补充事项',
    '',
    fields.notes,
    '',
  ].join('\n')
}

function documentBody(fields) {
  return [
    para('误工护理营养期咨询意见', { font: '黑体', size: 36, bold: true, align: 'center', before: 0, after: 280 }),
    para(DISCLAIMER, { size: 21, after: 200 }),
    para(`被鉴定人：${fields.subject_name}`, { after: 60 }),
    para(`委托单位：${fields.client_name}`, { after: 60 }),
    para(`委托检材：${fields.materials}`, { after: 60 }),
    para(`适用标准：${fields.standard}`, { after: 200 }),
    para('一、伤情摘要', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.injury_digest, { indent: 480 }),
    para('二、评定意见', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.opinion, { indent: 480 }),
    para('三、待补充事项', { font: '黑体', size: 28, bold: true, before: 200, after: 80 }),
    para(fields.notes, { indent: 480 }),
  ].join('')
}

export async function writePeriodPair(raw, reportsDir) {
  await mkdir(reportsDir, { recursive: true })
  const named = String(raw.subject_name || '').trim()
  const previous = await loadPriorFields(
    reportsDir,
    named && !/沿用|同前/.test(named) ? periodStem(named) : '',
    raw.subject_name,
    LAST_PERIOD,
  )
  const fields = preparePeriodFields(raw, previous)
  const stem = periodStem(fields.subject_name)
  const { docxPath, mdPath } = await uniqueDatedPair(reportsDir, stem)
  await writeNoteDocx(documentBody(fields), docxPath)
  await writeFile(mdPath, fieldsToMarkdown(fields), 'utf8')
  await saveFields(reportsDir, stem, fields, LAST_PERIOD)
  return { docxPath, mdPath }
}
