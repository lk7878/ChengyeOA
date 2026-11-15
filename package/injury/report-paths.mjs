/**
 * 咨询意见、审核意见、三期意见共用的文件名与「沿用上一份」读取。
 * 同一天再出一份会加 -2、-3，不覆盖已有 Word。
 */
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function todayStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

export function safeName(name, fallback) {
  const s = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim()
  if (!s || s === '（待补充）' || s === '（未注明）') return fallback
  return s
}

export function isKeepToken(value) {
  const t = String(value ?? '').trim()
  return t === '（沿用）' || t === '（同前）' || t === '沿用' || t === '同前'
}

export function takeField(rawValue, previousValue, label) {
  const text = rawValue == null ? '' : String(rawValue).trim()
  if (!isKeepToken(text)) return text
  const prev = previousValue == null ? '' : String(previousValue).trim()
  if (!prev) throw new Error(`没有上一份文书可沿用（${label}）。请写出完整内容`)
  return prev
}

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    if (e && e.code === 'ENOENT') return null
    throw e
  }
}

export async function loadPriorFields(reportsDir, stem, nameRaw, lastFile) {
  if (isKeepToken(nameRaw)) {
    const last = await readJson(path.join(reportsDir, lastFile))
    return last?.fields ?? null
  }
  if (stem) {
    const own = await readJson(path.join(reportsDir, `${stem}.fields.json`))
    if (own) return own
  }
  const last = await readJson(path.join(reportsDir, lastFile))
  const lastName = String(last?.fields?.name || last?.fields?.subject_name || '').trim()
  const asked = String(nameRaw || '').trim()
  const placeholder = !lastName || lastName === '（待补充）' || lastName === '（未注明）'
  if (last?.fields && (placeholder || lastName === asked)) return last.fields
  return null
}

export async function saveFields(reportsDir, stem, fields, lastFile) {
  await writeFile(path.join(reportsDir, `${stem}.fields.json`), JSON.stringify(fields, null, 2), 'utf8')
  await writeFile(path.join(reportsDir, lastFile), JSON.stringify({ fields }, null, 2), 'utf8')
}

export async function uniqueDatedPair(dir, base, stamp = todayStamp()) {
  for (let n = 1; n <= 50; n++) {
    const suffix = n === 1 ? stamp : `${stamp}-${n}`
    const docxPath = path.join(dir, `${base}-${suffix}.docx`)
    try {
      await access(docxPath)
    } catch (e) {
      if (e?.code === 'ENOENT') {
        return { docxPath, mdPath: path.join(dir, `${base}-${suffix}.md`) }
      }
      throw e
    }
  }
  throw new Error('同名文书版本过多')
}
