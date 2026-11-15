/**
 * 会话目录与「其他工作区」。
 *
 * 一条新会话独占 cases/<caseId>/sessions/<key>/，不再把上传写进案件根目录。
 * materials 用目录联接指回案件正式材料，草稿留在本会话里，确认后再归入。
 * 助手里新建、且不属于任何案件的工作区放在 other-workspaces/。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { CASES_ROOT, caseSessions, listCaseFiles } from './cases.js'

export const OTHER_ROOT = process.env.OTHER_WORKSPACES_ROOT
  || path.join(path.dirname(CASES_ROOT), 'other-workspaces')

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const OTHER_REGISTRY = path.join(DATA_DIR, 'other-workspaces.json')

const BOUNDARY = `本目录是案件中的一条会话，不是整个案件。

- 新上传的材料放在 inbox\\
- 文书草稿放在 drafts\\
- materials\\ 是本案正式材料，只供查阅。不要把其他案件的文件写进这里。
- 成稿先放在本会话的 reports\\。确认后由工作台归入案件的 reports\\。
- 如果这段对话实际是另一个案件，请让用户回工作台新建案件，不要继续把文件堆在本目录。
`

export function newSessionKey() {
  return `s${randomBytes(4).toString('hex')}`
}

export function sessionDir(caseId, key) {
  return path.join(CASES_ROOT, caseId, 'sessions', key)
}

function safeName(name) {
  const base = path.basename(String(name || ''))
  if (!base || base === '.' || base === '..') throw new Error('无效的文件名')
  return base
}

async function linkMaterials(caseId, dir) {
  const source = path.join(CASES_ROOT, caseId, 'materials')
  const link = path.join(dir, 'materials')
  await fs.mkdir(source, { recursive: true })
  try {
    const stat = await fs.lstat(link)
    if (stat.isSymbolicLink?.() || stat.isDirectory()) return
  } catch {
    /* 尚未建立联接 */
  }
  try {
    await fs.symlink(source, link, 'junction')
  } catch {
    await fs.mkdir(link, { recursive: true })
    await fs.writeFile(path.join(link, '正式材料在案件目录.txt'), `本案正式材料目录：\n${source}\n`, 'utf8')
  }
}

/** 建好一条隔离会话的目录。key 形如 s1a2b3c4。 */
export async function ensureSessionLayout(caseId, key) {
  if (!/^s[0-9a-f]{8}$/.test(key)) throw new Error('无效的会话目录')
  const dir = sessionDir(caseId, key)
  await fs.mkdir(path.join(dir, 'inbox'), { recursive: true })
  await fs.mkdir(path.join(dir, 'drafts'), { recursive: true })
  await fs.mkdir(path.join(dir, 'reports'), { recursive: true })
  await fs.mkdir(path.join(CASES_ROOT, caseId, 'reports'), { recursive: true })
  await linkMaterials(caseId, dir)
  await fs.writeFile(path.join(dir, '会话边界.txt'), BOUNDARY, 'utf8')
  return dir
}

async function uniqueTarget(dir, name) {
  let target = path.join(dir, name)
  const parsed = path.parse(name)
  let i = 1
  while (true) {
    try {
      await fs.access(target)
      target = path.join(dir, `${parsed.name}-${i}${parsed.ext}`)
      i += 1
    } catch {
      return target
    }
  }
}

/**
 * 把会话里的文件归入案件正式目录。
 * from: inbox | drafts | reports（会话内）
 * to: materials | reports（案件根）
 */
export async function promoteSessionFile(caseId, key, from, name, to) {
  if (!/^s[0-9a-f]{8}$/.test(key)) throw new Error('无效的会话目录')
  if (!['inbox', 'drafts', 'reports'].includes(from)) throw new Error('无效的来源目录')
  if (!['materials', 'reports'].includes(to)) throw new Error('只能归入材料或文书')
  const base = safeName(name)
  const source = path.join(sessionDir(caseId, key), from, base)
  const root = path.join(CASES_ROOT, caseId)
  const rel = path.relative(root, source)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界')
  await fs.access(source)
  const destDir = path.join(root, to)
  await fs.mkdir(destDir, { recursive: true })
  const dest = await uniqueTarget(destDir, base)
  await fs.copyFile(source, dest)
  await fs.unlink(source)
  return { name: path.basename(dest), from, to }
}

function boxFiles(dir, key, folder, entries) {
  return entries
    .filter((e) => e.isFile())
    .map((e) => ({
      name: e.name,
      rel: `sessions/${key}/${folder}/${e.name}`,
    }))
}

async function readBox(dir, key, folder) {
  try {
    const entries = await fs.readdir(path.join(dir, folder), { withFileTypes: true })
    const files = []
    for (const e of boxFiles(dir, key, folder, entries)) {
      const stat = await fs.stat(path.join(dir, folder, e.name))
      files.push({ ...e, size: stat.size, mtime: stat.mtime.toISOString() })
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  } catch {
    return []
  }
}

const REPORT_EXT = new Set(['.md', '.markdown', '.docx', '.doc', '.pdf', '.html', '.htm', '.txt'])

/**
 * 工作台「文书」列表。成稿常先落在会话 reports\，案件根 reports\ 仍是已归入的副本。
 * 只取这两处的直接文件，不展开 review\ 里的解析底稿。
 */
export async function listWorkbenchReports(caseId) {
  const files = []
  for (const file of await listCaseFiles(caseId, 'reports')) {
    if (file.name.startsWith('.')) continue
    files.push({ ...file, rel: `reports/${file.name}` })
  }
  const root = path.join(CASES_ROOT, caseId, 'sessions')
  let keys = []
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    keys = entries.filter((e) => e.isDirectory() && /^s[0-9a-f]{8}$/.test(e.name)).map((e) => e.name)
  } catch {
    keys = []
  }
  for (const key of keys.sort()) {
    const dir = path.join(root, key, 'reports')
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      if (!REPORT_EXT.has(path.extname(entry.name).toLowerCase())) continue
      const stat = await fs.stat(path.join(dir, entry.name))
      files.push({
        name: entry.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        rel: `sessions/${key}/reports/${entry.name}`,
      })
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 列出本案各隔离会话的收件、草稿和未归入文书。 */
export async function listSessionBoxes(caseId, meta) {
  const titled = new Map(caseSessions(meta).map((s) => [s.dir, s]))
  const root = path.join(CASES_ROOT, caseId, 'sessions')
  let keys = []
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    keys = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    keys = []
  }
  const out = []
  for (const key of keys.sort()) {
    const row = titled.get(`sessions/${key}`)
    const dir = sessionDir(caseId, key)
    out.push({
      key,
      title: row?.title || key,
      legacy: false,
      inbox: await readBox(dir, key, 'inbox'),
      drafts: await readBox(dir, key, 'drafts'),
      reports: await readBox(dir, key, 'reports'),
    })
  }
  return out
}

async function readOtherRegistry() {
  try {
    const raw = await fs.readFile(OTHER_REGISTRY, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeOtherRegistry(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(OTHER_REGISTRY, JSON.stringify(rows, null, 2), 'utf8')
}

export async function listOtherWorkspaces() {
  return readOtherRegistry()
}

export function otherWorkspaceDir(id) {
  return path.join(OTHER_ROOT, id)
}

export async function prepareOtherWorkspace(title) {
  const id = `ow-${randomBytes(4).toString('hex')}`
  const dir = otherWorkspaceDir(id)
  await fs.mkdir(path.join(dir, 'inbox'), { recursive: true })
  await fs.mkdir(path.join(dir, 'drafts'), { recursive: true })
  const now = new Date().toISOString()
  const row = {
    id,
    title: String(title || '').trim() || '未命名工作区',
    dir,
    createdAt: now,
    workspaceId: null,
    sessionId: null,
  }
  return row
}

export async function rememberOtherWorkspace(row) {
  const rows = await readOtherRegistry()
  const next = rows.filter((item) => item.id !== row.id)
  next.unshift(row)
  await writeOtherRegistry(next)
  return row
}
