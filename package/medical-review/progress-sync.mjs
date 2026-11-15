/**
 * 按实际工具自动更新任务清单，并把思考过程落到案件目录。
 * 解决：todo 投影在 turn/start 被清空；模型忙着干活不勾任务；思考折叠后找不到。
 */
import z from '@deepseek-ai/schemastery'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export const name = 'progress-sync'
export const inject = ['tools']
export const Config = z.object({})

const WAVES = [
  { id: 'A', content: 'A 解析病历（OCR）' },
  { id: 'B', content: 'B 读目录、时间轴、元数据' },
  { id: 'C', content: 'C 审查：取证、应然、过错与损害' },
  { id: 'D', content: 'D 出件：七章病历分析报告' },
]

const STATUS = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' }

function caseDir(session) {
  const raw = session?.header?.cwd
  if (typeof raw === 'string' && raw.trim()) return path.resolve(raw.trim())
  return null
}

function reviewDir(cwd) {
  return path.join(cwd, 'reports', 'review')
}

function loadState(cwd) {
  const file = path.join(reviewDir(cwd), 'progress.json')
  if (!existsSync(file)) {
    return {
      wave: null,
      statuses: { A: STATUS.pending, B: STATUS.pending, C: STATUS.pending, D: STATUS.pending },
      detail: '',
      thinkingCount: 0,
      updatedAt: null,
    }
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return {
      wave: raw.wave || null,
      statuses: { ...{ A: STATUS.pending, B: STATUS.pending, C: STATUS.pending, D: STATUS.pending }, ...(raw.statuses || {}) },
      detail: String(raw.detail || ''),
      thinkingCount: Number(raw.thinkingCount || 0),
      updatedAt: raw.updatedAt || null,
    }
  } catch {
    return {
      wave: null,
      statuses: { A: STATUS.pending, B: STATUS.pending, C: STATUS.pending, D: STATUS.pending },
      detail: '',
      thinkingCount: 0,
      updatedAt: null,
    }
  }
}

function statusLabel(s) {
  if (s === STATUS.completed) return '已完成'
  if (s === STATUS.in_progress) return '进行中'
  return '待处理'
}

function saveState(cwd, state) {
  const dir = reviewDir(cwd)
  mkdirSync(dir, { recursive: true })
  const payload = { ...state, updatedAt: new Date().toISOString() }
  writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(payload, null, 2), 'utf8')
  const lines = [
    '# 鉴定进度',
    '',
    `- 当前波次：${payload.wave ? `${payload.wave} ${statusLabel(payload.statuses[payload.wave])}` : '尚未开始'}`,
    payload.detail ? `- 正在做：${payload.detail}` : '',
    `- 更新时间：${new Date(payload.updatedAt).toLocaleString('zh-CN', { hour12: false })}`,
    payload.thinkingCount ? `- 思考过程：已保存 ${payload.thinkingCount} 段到 thinking.md（对话里点「思考」也可展开）` : '',
    '',
    '| 波次 | 状态 |',
    '|------|------|',
    ...WAVES.map((w) => `| ${w.content} | ${statusLabel(payload.statuses[w.id])} |`),
    '',
  ].filter((line) => line !== '')
  writeFileSync(path.join(dir, 'progress.md'), `${lines.join('\n')}\n`, 'utf8')
}

function todosFrom(state) {
  const order = ['A', 'B', 'C', 'D']
  const current = state.wave
  return WAVES.map((w) => {
    let status = state.statuses[w.id] || STATUS.pending
    if (current && w.id === current && status !== STATUS.completed) status = STATUS.in_progress
    if (current && order.indexOf(w.id) < order.indexOf(current) && status !== STATUS.completed) {
      status = STATUS.completed
    }
    return { content: w.content, status }
  })
}

function applyWave(state, wave, detail, complete = false) {
  const order = ['A', 'B', 'C', 'D']
  const idx = order.indexOf(wave)
  if (idx < 0) return state
  const next = {
    ...state,
    wave,
    detail: detail || state.detail,
    statuses: { ...state.statuses },
  }
  for (let i = 0; i < idx; i++) next.statuses[order[i]] = STATUS.completed
  next.statuses[wave] = complete ? STATUS.completed : STATUS.in_progress
  if (complete && idx < order.length - 1) {
    next.wave = order[idx + 1]
    next.statuses[order[idx + 1]] = STATUS.in_progress
  }
  if (complete && wave === 'D') {
    next.wave = 'D'
    next.statuses.D = STATUS.completed
  }
  return next
}

function parseArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return {} }
}

function blobOf(value) {
  return typeof value === 'string' ? value : JSON.stringify(value || {})
}

function infer(name, args, resultBlob) {
  const a = parseArgs(args)
  const blob = `${blobOf(args)}\n${blobOf(resultBlob)}`.toLowerCase()
  const pathText = String(a.path || a.file_path || a.target_file || a.filePath || '')
  const skillName = String(a.skill || a.name || a.id || '')

  if (name === 'todo_write') return null

  if (name === 'parse_records' || name === 'parse_records_status') {
    const done = /"status"\s*:\s*"done"/.test(blob) || /\bstatus["']?\s*[:=]\s*done\b/i.test(blob)
    const err = /"status"\s*:\s*"error"/.test(blob)
    return { wave: 'A', detail: done ? '解析完成' : (err ? '解析失败' : '病历 OCR'), complete: done }
  }
  if (name === 'job_output' && /parse|ocr|catalog/i.test(blob)) {
    return { wave: 'A', detail: '解析任务结束', complete: true }
  }
  if (name === 'read' || name === 'Read') {
    if (/catalog\.md|timeline\.md|meta\.md|parse-warnings\.md/i.test(pathText)) {
      return { wave: 'B', detail: `读取 ${path.basename(pathText)}` }
    }
    if (/notes\.md/i.test(pathText)) return { wave: 'C', detail: '读审查笔记' }
    if (/病历分析报告/i.test(pathText)) return { wave: 'D', detail: '核对报告正文' }
  }
  if (name === 'glob' && /parse-warnings|catalog|timeline/i.test(blob)) {
    return { wave: 'B', detail: '核对解析产物' }
  }
  if (name === 'parse_records_query') {
    return { wave: 'C', detail: `取病历原文 ${a.category || a.keyword || ''}`.trim() }
  }
  if (/^weknora_|^expected_care_plan$|^web_search$/.test(name)) {
    return { wave: 'C', detail: name === 'expected_care_plan' ? '生成应然诊疗对照' : `检索 ${name}` }
  }
  if (name === 'skill') {
    if (/medical-report-writing|opinion-writing/i.test(skillName)) return { wave: 'D', detail: `加载 ${skillName || '写作 skill'}` }
    if (/medical-record-parse/i.test(skillName)) return { wave: 'A', detail: '加载解析 skill' }
    if (skillName) return { wave: 'C', detail: `加载 ${skillName}` }
  }
  if (name === 'write' || name === 'edit' || name === 'Write' || name === 'Edit') {
    if (/notes\.md/i.test(pathText)) return { wave: 'C', detail: '写审查笔记' }
    if (/病历分析报告/i.test(pathText)) return { wave: 'D', detail: '写报告正文' }
  }
  if (name === 'fill_report') {
    const ch = String(a.chapter || '')
    return { wave: 'D', detail: ch ? `填写 ${ch} 章` : '填写报告章节' }
  }
  if (name === 'export_md_to_word' || name === 'fill_statement') {
    return { wave: 'D', detail: name === 'export_md_to_word' ? '导出 Word' : '填写陈述书' }
  }
  if (name === 'present' && /病历分析报告/i.test(blob)) {
    return { wave: 'D', detail: '呈交病历分析报告', complete: true }
  }
  return null
}

function publishTodos(session, state) {
  if (!session || typeof session.append !== 'function') return
  queueMicrotask(() => {
    try {
      session.append('todo/write', { todos: todosFrom(state) })
    } catch {
      // 轮次未打开或重入 append 时忽略，下一工具再写。
    }
  })
}

function appendThinking(cwd, state, event) {
  const msg = event?.data?.message
  const blocks = Array.isArray(msg?.content) ? msg.content : []
  const thoughts = blocks
    .filter((b) => b && b.type === 'reasoning' && String(b.text || '').trim())
    .map((b) => String(b.text).trim())
  if (!thoughts.length) return state
  const dir = reviewDir(cwd)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'thinking.md')
  const turn = event.data?.turn
  const step = event.data?.step
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  const chunk = [
    '',
    `## ${stamp} · 第 ${turn ?? '?'} 轮 · 第 ${step ?? '?'} 步`,
    '',
    ...thoughts,
    '',
  ].join('\n')
  if (!existsSync(file)) writeFileSync(file, '# 鉴定思考过程\n\n对话里点「思考」可展开同一段原文。本文件在刷新后仍保留。\n', 'utf8')
  writeFileSync(file, readFileSync(file, 'utf8') + chunk, 'utf8')
  return { ...state, thinkingCount: Number(state.thinkingCount || 0) + thoughts.length }
}

export function apply(ctx) {
  const lastBySession = new Map()

  function touch(session, inferred) {
    const cwd = caseDir(session)
    if (!cwd || !inferred) return
    const prev = lastBySession.get(session.id) || loadState(cwd)
    const next = applyWave(prev, inferred.wave, inferred.detail, inferred.complete === true)
    lastBySession.set(session.id, next)
    saveState(cwd, next)
    publishTodos(session, next)
  }

  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    const cwd = caseDir(session)
    if (!cwd) return

    if (event.type === 'turn/start') {
      const state = lastBySession.get(session.id) || loadState(cwd)
      lastBySession.set(session.id, state)
      if (state.wave) {
        publishTodos(session, state)
      }
      return
    }

    if (event.type === 'tool/call') {
      const inferred = infer(event.data?.name, event.data?.arguments, '')
      if (inferred) touch(session, inferred)
      return
    }

    if (event.type === 'assistant/message') {
      const prev = lastBySession.get(session.id) || loadState(cwd)
      const next = appendThinking(cwd, prev, event)
      if (next.thinkingCount !== prev.thinkingCount) {
        lastBySession.set(session.id, next)
        saveState(cwd, next)
      }
    }
  })

  ctx.on('tools/result', (exec, result) => {
    const session = exec?.agent?.session
    if (!session) return
    const value = result && result.isError === false ? result.value : null
    const inferred = infer(exec.name, exec.arguments, value)
    if (inferred) touch(session, inferred)
  })
}
