/**
 * 新建「医疗法律知识库」并批量导入 e:\A\konwledge-md\markdown。
 * 不写入标准规范库 / 鉴定方法库 / 脱敏案例库。
 *
 * 用法: node E:\A\scripts\import-medical-law-kb.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = (process.env.WK_BASE || 'http://127.0.0.1:8090').replace(/\/+$/, '')
const ROOT = path.resolve('E:/A/konwledge-md/markdown')
const KB_NAME = '医疗法律知识库'
const KB_DESC = '医疗卫生法律法规、司法解释、部门规章与批复。按原目录分类归档。独立知识库，不与标准规范库/鉴定方法库/脱敏案例库混放。'
const EXISTING_KB_NAMES = new Set(['标准规范库', '鉴定方法库', '脱敏案例库'])
const CONCURRENCY = 3
const HASH_SUFFIX = /_[0-9a-f]{8}$/i

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(__dirname, '.medical-law-kb.json')

let token = ''

async function api(method, p, { body, form } = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  const init = { method, headers }
  if (form) init.body = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8'
    init.body = JSON.stringify(body)
  }
  const r = await fetch(`${BASE}/api/v1${p}`, init)
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!r.ok && r.status !== 409) {
    const detail = json?.message || json?.error || json?.msg || text.slice(0, 240)
    throw new Error(`${method} ${p} HTTP ${r.status} ${detail}`)
  }
  return { status: r.status, json }
}

function unwrapList(j) {
  let arr = j?.data
  if (Array.isArray(arr)) return arr
  if (arr && typeof arr === 'object') return arr.items || arr.data || []
  return []
}

function parseFrontmatter(raw) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if (val === 'null' || val === '') val = ''
    else val = val.replace(/^["']|["']$/g, '')
    out[key] = val
  }
  return out
}

function stemOf(base) {
  return base.replace(/\.md$/i, '').replace(HASH_SUFFIX, '')
}

async function walkMd(dir, acc = []) {
  const ents = await fs.readdir(dir, { withFileTypes: true })
  for (const e of ents) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walkMd(full, acc)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) acc.push(full)
  }
  return acc
}

async function collectFiles() {
  const all = await walkMd(ROOT)
  const groups = new Map()
  for (const f of all) {
    const st = await fs.stat(f)
    const key = stemOf(path.basename(f))
    const cur = groups.get(key) || []
    cur.push({ file: f, size: st.size })
    groups.set(key, cur)
  }
  const selected = []
  const skipped = []
  for (const [stem, list] of groups) {
    list.sort((a, b) => b.size - a.size)
    selected.push(list[0].file)
    for (const extra of list.slice(1)) skipped.push(extra.file)
  }
  return { selected, skipped, total: all.length }
}

async function ensureKb() {
  const { json } = await api('GET', '/knowledge-bases?page=1&page_size=200')
  const items = unwrapList(json)
  const existing = items.find((k) => k.name === KB_NAME)
  if (existing) {
    if (EXISTING_KB_NAMES.has(existing.name)) {
      throw new Error('拒绝写入已有知识库')
    }
    console.log(`复用已建库 ${KB_NAME} id=${existing.id}`)
    return existing.id
  }
  const collide = items.find((k) => EXISTING_KB_NAMES.has(k.name) && k.name === KB_NAME)
  if (collide) throw new Error('目标名与已有知识库冲突')
  const { json: created } = await api('POST', '/knowledge-bases', {
    body: {
      name: KB_NAME,
      description: KB_DESC,
      type: 'document',
      embedding_model_id: 'builtin-embedding-bailian',
      chunking_config: { strategy: 'legacy', chunk_size: 512, chunk_overlap: 80, enable_parent_child: false },
      indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
    },
  })
  const id = created?.data?.id
  if (!id) throw new Error('创建知识库未返回 id')
  console.log(`已新建 ${KB_NAME} id=${id}`)
  return id
}

async function ensureTag(kbId, name, cache) {
  if (!name) return ''
  if (cache.has(name)) return cache.get(name)
  try {
    const { json, status } = await api('POST', `/knowledge-bases/${kbId}/tags`, { body: { name } })
    let id = json?.data?.id
    if (!id || status === 409) {
      const listed = await api('GET', `/knowledge-bases/${kbId}/tags?page=1&page_size=200`)
      for (const t of unwrapList(listed.json)) cache.set(t.name, t.id)
      id = cache.get(name)
    } else {
      cache.set(name, id)
    }
    return id || ''
  } catch (e) {
    console.warn(`  标签跳过 ${name}: ${e.message}`)
    cache.set(name, '')
    return ''
  }
}

async function listExistingNames(kbId) {
  const names = new Set()
  let page = 1
  while (true) {
    const { json } = await api('GET', `/knowledge-bases/${kbId}/knowledge?page=${page}&page_size=200`)
    const items = unwrapList(json)
    for (const it of items) {
      if (it.file_name) names.add(it.file_name)
      if (it.title) names.add(it.title)
    }
    if (items.length < 200) break
    page += 1
    if (page > 50) break
  }
  return names
}

async function uploadOne(kbId, file, tagCache) {
  const raw = await fs.readFile(file, 'utf8')
  const fm = parseFrontmatter(raw)
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const folder = path.posix.dirname(rel)
  const title = fm.title || path.basename(file, '.md')
  const tagNames = [fm.category, fm.document_type, fm.subcategory].filter(Boolean)
  const tagIds = []
  for (const n of tagNames) {
    const id = await ensureTag(kbId, n, tagCache)
    if (id) tagIds.push(id)
  }
  const meta = {
    标准编号: fm.document_number || '',
    发布机构: fm.issuing_authority || '',
    发布日期: fm.promulgation_date || '',
    文种: fm.document_type || '',
    分类: fm.category || '',
    子类: fm.subcategory || '',
    状态: '现行',
    来源路径: rel,
  }
  const form = new FormData()
  const buf = Buffer.from(raw, 'utf8')
  form.append('file', new Blob([buf], { type: 'text/markdown' }), path.basename(file))
  form.append('fileName', path.basename(file))
  form.append('tag_ids', tagIds.join(','))
  form.append('metadata', JSON.stringify(meta))
  const { json, status } = await api('POST', `/knowledge-bases/${kbId}/knowledge/file`, { form })
  const data = json?.data || {}
  const id = data.id
  if (!id) throw new Error(`上传无 id (${status}) ${rel}`)
  return { id, title, folder, rel, reused: status === 409 }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  let ok = 0
  let fail = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      const item = items[idx]
      try {
        out[idx] = await fn(item, idx)
        ok++
        if (ok % 20 === 0 || ok === items.length) {
          console.log(`  进度 ${ok + fail}/${items.length}（成功 ${ok} 失败 ${fail}）`)
        }
      } catch (e) {
        fail++
        out[idx] = { error: e.message, file: item }
        console.warn(`  ! ${path.relative(ROOT, item)}: ${e.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return { out, ok, fail }
}

async function main() {
  console.log(`==> 扫描 ${ROOT}`)
  const { selected, skipped, total } = await collectFiles()
  console.log(`  发现 ${total} 份 md，去重后导入 ${selected.length} 份，跳过重复 ${skipped.length} 份`)

  const setup = await fetch(`${BASE}/api/v1/auth/auto-setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (!setup.ok) throw new Error(`WeKnora 未启动或认证失败 HTTP ${setup.status}`)
  const sj = await setup.json()
  token = sj.token || sj.data?.token
  if (!token) throw new Error('auto-setup 未返回 token')

  const kbId = await ensureKb()
  if (EXISTING_KB_NAMES.has(KB_NAME)) throw new Error('拒绝写入已有知识库')

  const existing = await listExistingNames(kbId)
  const todo = selected.filter((f) => !existing.has(path.basename(f)))
  console.log(`  库中已有文件名 ${existing.size}，本次待上传 ${todo.length}`)

  const tagCache = new Map()
  const { json: tags } = await api('GET', `/knowledge-bases/${kbId}/tags?page=1&page_size=200`)
  for (const t of unwrapList(tags)) tagCache.set(t.name, t.id)

  const { out, ok, fail } = await mapPool(todo, CONCURRENCY, (file) => uploadOne(kbId, file, tagCache))
  const imported = out.filter((x) => x && x.id)

  const byFolder = new Map()
  for (const row of imported) {
    const key = row.folder === '.' ? '' : row.folder
    if (!key) continue
    const arr = byFolder.get(key) || []
    arr.push(row.id)
    byFolder.set(key, arr)
  }
  console.log('==> 归档文件夹')
  for (const [folder, ids] of byFolder) {
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80)
      try {
        await api('POST', '/knowledge/folder', { body: { kb_id: kbId, knowledge_ids: chunk, folder_path: folder } })
      } catch (e) {
        console.warn(`  文件夹失败 ${folder}: ${e.message}`)
      }
    }
  }

  console.log('==> 写标题')
  let titled = 0
  for (const row of imported) {
    if (!row.title) continue
    try {
      await api('PUT', `/knowledge/${row.id}`, { body: { title: row.title } })
      titled++
    } catch {
      // 解析中标题可能被覆盖，不阻断
    }
  }

  const state = { kbId, name: KB_NAME, imported: imported.length, failed: fail, skippedDup: skipped.length, at: new Date().toISOString() }
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  console.log(`完成。新建/复用知识库 ${KB_NAME}`)
  console.log(`  id=${kbId}`)
  console.log(`  上传成功 ${ok}  失败 ${fail}  标题 ${titled}  去重跳过 ${skipped.length}`)
  console.log(`  控制台 ${BASE}`)
}

main().catch((e) => {
  console.error(e.stack || e.message)
  process.exit(1)
})
