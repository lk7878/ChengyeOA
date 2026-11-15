/**
 * 案件 CRUD + 材料文件管理。
 *
 * 磁盘布局：
 *   E:\A\cases\<caseId>\
 *     ├── meta.json        案件元数据
 *     ├── materials\       工作台上传的正式材料，各会话只读共用
 *     ├── reports\         已归入的成稿
 *     └── sessions\<key>\  一条会话的 inbox / drafts / reports
 *
 * meta.json 与 work_ui/src/types.ts 的 CaseRecord 保持同形结构，
 * 便于前端直接替换 mock。
 */
import { promises as fs, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const CASES_ROOT = process.env.CASES_ROOT || path.resolve('cases')

const CASE_STAGES = new Set(['intake', 'processing', 'review', 'closed'])
const STAGE_ALIASES = { drafting: 'processing', approved: 'closed' }
const CASE_KINDS = new Set(['general', 'disability', 'injury', 'malpractice', 'traffic'])

function normalizeStage(stage) {
  const mapped = STAGE_ALIASES[stage] || stage
  return CASE_STAGES.has(mapped) ? mapped : 'intake'
}

function normalizeKind(kind) {
  return CASE_KINDS.has(kind) ? kind : 'general'
}

const ALLOWED_EXT = new Set([
  '.pdf', '.docx', '.doc',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.txt', '.md', '.markdown', '.html', '.htm',
])

function todayStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function nowIso() {
  return new Date().toISOString()
}

function newCaseId() {
  const hex = randomBytes(3).toString('hex').toUpperCase()
  return `CASE-${todayStamp()}-${hex}`
}

function caseDir(caseId) {
  return path.join(CASES_ROOT, caseId)
}

function metaPath(caseId) {
  return path.join(caseDir(caseId), 'meta.json')
}

function materialsDir(caseId) {
  return path.join(caseDir(caseId), 'materials')
}

async function ensureCasesRoot() {
  await fs.mkdir(CASES_ROOT, { recursive: true })
}

async function readMeta(caseId) {
  try {
    const raw = await fs.readFile(metaPath(caseId), 'utf8')
    const meta = JSON.parse(raw)
    const stage = normalizeStage(meta.stage)
    const kind = normalizeKind(meta.kind)
    if (stage !== meta.stage || kind !== meta.kind) {
      meta.stage = stage
      meta.kind = kind
      await writeMeta(caseId, meta)
    }
    return meta
  } catch {
    return null
  }
}

async function writeMeta(caseId, meta) {
  await fs.writeFile(metaPath(caseId), JSON.stringify(meta, null, 2), 'utf8')
}

async function listMaterialFiles(caseId) {
  try {
    const entries = await fs.readdir(materialsDir(caseId), { withFileTypes: true })
    const out = []
    for (const e of entries) {
      if (!e.isFile()) continue
      const full = path.join(materialsDir(caseId), e.name)
      const stat = await fs.stat(full)
      out.push({ name: e.name, size: stat.size, mtime: stat.mtime.toISOString() })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 列出全部案件（按更新时间倒序）。 */
export async function listCases() {
  await ensureCasesRoot()
  const entries = await fs.readdir(CASES_ROOT, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const meta = await readMeta(e.name)
    if (!meta) continue
    const materials = await listMaterialFiles(e.name)
    out.push({ ...meta, materialCount: materials.length })
  }
  out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  return out
}

/** 获取单个案件详情（含材料文件列表）。 */
export async function getCase(caseId) {
  const meta = await readMeta(caseId)
  if (!meta) return null
  const materials = await listMaterialFiles(caseId)
  return { ...meta, materialCount: materials.length, materials }
}

/** 创建案件：建目录 + 写 meta.json。 */
export async function createCase(input) {
  await ensureCasesRoot()
  const id = newCaseId()
  const dir = caseDir(id)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(materialsDir(id), { recursive: true })
  await fs.mkdir(path.join(dir, 'reports'), { recursive: true })
  const now = nowIso()
  const meta = {
    id,
    title: input.title || '未命名案件',
    kind: normalizeKind(input.kind),
    appellant: input.appellant || '',
    respondent: input.respondent || '',
    category: input.category || '',
    stage: input.stage || 'intake',
    priority: input.priority || 'normal',
    ownerId: input.ownerId || 'u-001',
    members: input.members || [],
    createdAt: now,
    updatedAt: now,
    dueAt: input.dueAt || null,
    description: input.description || '',
    // harness 桥接结果（首次启动 AI 助手时填充）
    workspaceId: null,
    sessionId: null,
    agentPreset: null,
    sessions: [],
  }
  await writeMeta(id, meta)
  return meta
}

/** 案件上登记过的会话。旧数据只有 sessionId 时，补一条历史会话。 */
export function caseSessions(meta) {
  const list = Array.isArray(meta?.sessions) ? meta.sessions.filter((s) => s && s.sessionId) : []
  if (meta?.sessionId && !list.some((s) => s.sessionId === meta.sessionId)) {
    list.unshift({
      sessionId: meta.sessionId,
      workspaceId: meta.workspaceId || null,
      dir: null,
      title: meta.title || '历史会话',
      legacy: true,
      createdAt: meta.updatedAt || meta.createdAt || null,
    })
  }
  return list
}

/** 更新案件元数据（合并）。 */
export async function updateCase(caseId, patch) {
  const meta = await readMeta(caseId)
  if (!meta) return null
  if (patch.stage != null && !CASE_STAGES.has(patch.stage)) {
    throw new Error(`无效的案件状态: ${patch.stage}`)
  }
  if (patch.kind != null && !CASE_KINDS.has(patch.kind)) {
    throw new Error(`无效的鉴定类型: ${patch.kind}`)
  }
  const next = { ...meta, ...patch, id: caseId, updatedAt: nowIso() }
  // 不允许外部覆盖桥接字段与时间戳，除非显式传入
  await writeMeta(caseId, next)
  return next
}

/** 保存上传材料到 materials/。source 可以是 Buffer 或可读流。 */
export async function saveMaterial(caseId, originalName, source) {
  const ext = path.extname(originalName).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`不支持的文件类型: ${ext}（允许: ${[...ALLOWED_EXT].join(', ')}）`)
  }
  const dir = materialsDir(caseId)
  await fs.mkdir(dir, { recursive: true })
  // 防止路径穿越与重名：保留原名，重名则追加序号
  let target = path.join(dir, path.basename(originalName))
  let i = 1
  while (true) {
    try {
      await fs.access(target)
      const parsed = path.parse(path.join(dir, path.basename(originalName)))
      target = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`)
      i += 1
    } catch {
      break
    }
  }
  if (Buffer.isBuffer(source)) {
    await fs.writeFile(target, source)
  } else {
    await pipeline(source, createWriteStream(target))
  }
  const stat = await fs.stat(target)
  // 更新案件 updatedAt
  await updateCase(caseId, {})
  return { name: path.basename(target), size: stat.size, mtime: stat.mtime.toISOString() }
}

/** 删除材料文件。 */
export async function deleteMaterial(caseId, name) {
  const base = path.basename(name)
  const target = path.join(materialsDir(caseId), base)
  await fs.unlink(target)
  await updateCase(caseId, {})
  return { name: base }
}

/** 删除案件：递归删除案件目录（含 meta.json 与 materials/）。 */
export async function deleteCase(caseId) {
  const dir = caseDir(caseId)
  await fs.rm(dir, { recursive: true, force: true })
  return { id: caseId }
}

/**
 * 列出案件某子目录的文件（materials/ 或 reports/，或案件根下的任意一级子目录）。
 * sub 为相对子目录名（如 'materials'、'reports'），允许为空表示案件根。
 */
export async function listCaseFiles(caseId, sub = '') {
  const base = path.join(caseDir(caseId), sub || '')
  const out = []
  try {
    const entries = await fs.readdir(base, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      const full = path.join(base, e.name)
      const stat = await fs.stat(full)
      out.push({ name: e.name, size: stat.size, mtime: stat.mtime.toISOString() })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/**
 * 安全解析案件目录内的相对文件路径，返回绝对路径；越界返回 null。
 * rel 形如 'materials/xx.pdf' 或 'reports/鉴定意见书.docx'。
 */
export async function resolveCaseFile(caseId, rel) {
  if (!rel || typeof rel !== 'string') return null
  const root = caseDir(caseId)
  const target = path.resolve(root, rel)
  // 必须仍在案件目录内
  const relFromRoot = path.relative(root, target)
  if (!relFromRoot || relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) return null
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) return null
    return target
  } catch {
    return null
  }
}
