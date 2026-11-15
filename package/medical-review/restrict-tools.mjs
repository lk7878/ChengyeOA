// 挡住 convert_file / inspect_file 整本识图，以及用网页工具读本地路径。
import z from '@deepseek-ai/schemastery'
import { isClinicalCareQuery } from './report-text.mjs'

export const name = 'restrict-tools'
export const inject = ['tools']
export const Config = z.object({})

const DENY = [
  'inspect_file',
  'convert_file',
  'batch_convert',
  'list_conversions',
]

export function apply(ctx) {
  // 仅 deny 当前已注册的全局工具。部署 profile 若未装 dsh-file-convert，
  // restrict 会对未知名抛错，导致无法切换到 medical-review。
  const known = new Set(
    (typeof ctx.tools.schemas === 'function' ? ctx.tools.schemas() : [])
      .map((t) => t?.name)
      .filter(Boolean),
  )
  const deny = DENY.filter((name) => known.has(name))
  if (deny.length) ctx.tools.restrict({ deny })
  ctx.tools.guard((execution) => {
    const name = String(execution?.name || '')
    if (DENY.includes(name)) {
      return '病历识图只用 parse_records。本地文本用 read。不要 inspect_file / convert_file。'
    }
    if (name === 'web_fetch' && looksLikeLocalPath(execution.arguments)) {
      return '本地文件不要 web_fetch。文本用 read，扫描件用 parse_records。'
    }
    if (name === 'weknora_search' || name === 'web_search' || name === 'web_query') {
      const blob = JSON.stringify(execution.arguments || {})
      if (isClinicalCareQuery(blob)) {
        return '临床指南、手术指征、应然诊疗请用 weknora_clinical 查临床知识库，再用 expected_care_plan 生成应然方案。weknora_search 只查伤残/病历书写/鉴定程序，不要 web_search 重复搜疾病指南。'
      }
    }
    if (name === 'subagent' || name === 'subagent_fork') {
      const blob = JSON.stringify(execution.arguments || {})
      if (/ocr|识图|扫描|逐页|pages?\s*\d/i.test(blob)) {
        return '禁止用 subagent 做病历 OCR。只调 parse_records。'
      }
    }
    return undefined
  })
}

function looksLikeLocalPath(args) {
  const blob = JSON.stringify(args || {})
  return /file:\/\//i.test(blob)
    || /[A-Za-z]:[\\/]/.test(blob)
    || /(?:^|")(?:\.\/)?materials[\\/]/i.test(blob)
}
