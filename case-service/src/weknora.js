/**
 * WeKnora Lite 代理：列出知识库 / 条目，并转发文件导入。
 * 认证走 POST /api/v1/auth/auto-setup，token 缓存在进程内。
 */
import { marked } from 'marked'

const WEKNORA_BASE = (process.env.WEKNORA_BASE || 'http://127.0.0.1:8090').replace(/\/+$/, '')

let cachedToken = null
let tokenExp = 0

export function weknoraBase() {
  return WEKNORA_BASE
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExp) return cachedToken
  const r = await fetch(`${WEKNORA_BASE}/api/v1/auth/auto-setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!r.ok) {
    throw new Error(`WeKnora 认证失败（HTTP ${r.status}）。请确认 http://127.0.0.1:8090 已启动。`)
  }
  const j = await r.json()
  const tok = j.token || j.data?.token
  if (!tok) throw new Error('WeKnora auto-setup 未返回 token')
  cachedToken = tok
  tokenExp = Date.now() + 50 * 60 * 1000
  return tok
}

async function api(method, path, { body, token } = {}) {
  const tok = token || await getToken()
  const headers = { Authorization: `Bearer ${tok}` }
  const init = { method, headers }
  if (body !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8'
    init.body = JSON.stringify(body)
  }
  let r = await fetch(`${WEKNORA_BASE}/api/v1${path}`, init)
  if (r.status === 401) {
    cachedToken = null
    headers.Authorization = `Bearer ${await getToken()}`
    r = await fetch(`${WEKNORA_BASE}/api/v1${path}`, init)
  }
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!r.ok) {
    const detail = (json && (json.message || json.error || json.msg)) || text.slice(0, 300)
    throw new Error(`WeKnora ${method} ${path} 失败（HTTP ${r.status}）${detail ? `：${detail}` : ''}`)
  }
  return json
}

function unwrapList(j) {
  let arr = j?.data
  if (Array.isArray(arr)) return { items: arr, total: Number(j.total ?? arr.length) }
  if (arr && typeof arr === 'object') {
    const items = arr.items || arr.data || []
    return { items: Array.isArray(items) ? items : [], total: Number(arr.total ?? j.total ?? items.length) }
  }
  return { items: [], total: 0 }
}

function mapKb(kb) {
  return {
    id: kb.id,
    name: kb.name || '',
    description: kb.description || '',
    knowledgeCount: Number(kb.knowledge_count ?? 0),
    type: kb.type || 'document',
    updatedAt: kb.updated_at || kb.created_at || null,
  }
}

function mapKnowledge(d) {
  const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : {}
  return {
    id: d.id,
    title: d.title || d.file_name || '未命名',
    fileName: d.file_name || '',
    fileType: d.file_type || '',
    fileSize: Number(d.file_size || 0),
    folder: d.folder_path || '',
    parseStatus: d.parse_status || '',
    enableStatus: d.enable_status || '',
    standard: meta['标准编号'] || meta['标准号'] || meta['案例编号'] || '',
    publisher: meta['发布机构'] || '',
    status: meta['状态'] || '',
    tags: Array.isArray(d.tags) ? d.tags.map((t) => t.name).filter(Boolean) : [],
    createdAt: d.created_at || null,
    updatedAt: d.updated_at || null,
    metadata: meta,
  }
}

const KB_ORDER = ['标准规范库', '鉴定方法库', '脱敏案例库', '医疗法律知识库']

export async function listKnowledgeBases() {
  const j = await api('GET', '/knowledge-bases?page=1&page_size=200')
  const { items } = unwrapList(j)
  const mapped = items.map(mapKb)
  mapped.sort((a, b) => {
    const ia = KB_ORDER.indexOf(a.name)
    const ib = KB_ORDER.indexOf(b.name)
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name, 'zh')
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return mapped
}

export async function listKnowledge(kbId, { page = 1, pageSize = 200 } = {}) {
  const q = `page=${Number(page) || 1}&page_size=${Math.min(Math.max(Number(pageSize) || 200, 1), 200)}`
  const j = await api('GET', `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge?${q}`)
  const { items, total } = unwrapList(j)
  return {
    items: items.map(mapKnowledge),
    total,
    page: Number(j.page || page),
    pageSize: Number(j.page_size || pageSize),
  }
}

function guessType(filename) {
  const ext = String(filename || '').split('.').pop()?.toLowerCase()
  return {
    pdf: 'application/pdf',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    html: 'text/html',
    json: 'application/json',
  }[ext] || 'application/octet-stream'
}

export async function uploadKnowledge(kbId, { filename, buffer, contentType, title }) {
  const tok = await getToken()
  const form = new FormData()
  const type = contentType || guessType(filename)
  form.append('file', new Blob([buffer], { type }), filename)
  form.append('fileName', filename)
  const r = await fetch(
    `${WEKNORA_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/file`,
    { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form },
  )
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!r.ok) {
    const detail = (json && (json.message || json.error || json.msg)) || text.slice(0, 300)
    throw new Error(`导入失败（HTTP ${r.status}）${detail ? `：${detail}` : ''}`)
  }
  const data = json?.data || json || {}
  const kid = data.id
  if (kid && title && title !== filename) {
    try {
      await api('PUT', `/knowledge/${encodeURIComponent(kid)}`, { body: { title } })
    } catch {
      // 标题更新失败不影响已入库文件
    }
  }
  return { id: kid || '', raw: data }
}

export async function getKnowledgeDetail(id) {
  const j = await api('GET', `/knowledge/${encodeURIComponent(id)}`)
  const data = j?.data || j || {}
  const item = mapKnowledge(data)
  const tok = await getToken()
  let markdown = ''
  const r = await fetch(`${WEKNORA_BASE}/api/v1/knowledge/${encodeURIComponent(id)}/preview`, {
    headers: { Authorization: `Bearer ${tok}` },
  })
  if (r.ok) {
    markdown = await r.text()
  } else if (r.status !== 404) {
    const detail = (await r.text().catch(() => '')).slice(0, 200)
    throw new Error(`读取正文失败（HTTP ${r.status}）${detail ? `：${detail}` : ''}`)
  }
  return { item, markdown }
}

export function previewHtml(markdown) {
  const body = markdown && String(markdown).trim()
    ? marked.parse(String(markdown), { async: false })
    : '<p>暂无正文。该条目可能仍在解析，或尚未生成预览。</p>'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,"Microsoft YaHei",Segoe UI,Roboto,sans-serif;line-height:1.75;color:#1f2329;padding:28px 36px 48px;max-width:880px;margin:0 auto;}
  table{border-collapse:collapse;width:100%;margin:12px 0;}
  th,td{border:1px solid #d0d3d8;padding:6px 10px;text-align:left;}
  th{background:#f3f5f7;}
  h1,h2,h3{margin-top:1.4em;}
  blockquote{border-left:4px solid #c9ccd2;margin:0;padding:4px 16px;color:#5a6072;background:#f7f8fa;}
  img{max-width:100%;}
  code{background:#f3f5f7;padding:2px 5px;border-radius:4px;}
  pre{background:#f3f5f7;padding:12px;border-radius:6px;overflow:auto;}
</style></head><body>${body}</body></html>`
}
