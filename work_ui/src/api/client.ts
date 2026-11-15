/**
 * case-service API 客户端。
 *
 * 后端（E:\A\case-service，端口 5181）提供：
 *   案件 CRUD、材料上传/删除、harness 会话桥接。
 *
 * 形结构与 src/types.ts 的 CaseRecord 保持一致；额外携带 materials、
 * workspaceId、sessionId 等桥接字段。
 */
import { CASE_SERVICE_BASE } from '@/config/links'
import type { CaseRecord, CasePriority, CaseStage, CaseKind } from '@/types'
import { normalizeCaseStage, normalizeCaseKind } from '@/types'

export interface MaterialFile {
  name: string
  size: number
  mtime: string
}

/** 案件详情（含材料列表与 harness 桥接字段）。 */
export interface CaseDetail extends CaseRecord {
  materials?: MaterialFile[]
  workspaceId?: string | null
  sessionId?: string | null
}

export interface CreateCaseInput {
  title: string
  kind?: CaseKind
  appellant?: string
  respondent?: string
  category?: string
  priority?: CasePriority
  stage?: CaseStage
  ownerId?: string
  members?: import('@/types').CaseMember[]
  description?: string
  dueAt?: string | null
}

export interface SessionBridgeResult {
  workspaceId: string
  sessionId: string
  harnessUrl: string
  reused: boolean
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CASE_SERVICE_BASE}${path}`, {
    ...init,
    credentials: 'include',
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

function withStage<T extends { stage?: string; kind?: string }>(c: T): T & { stage: CaseStage; kind: CaseKind } {
  return { ...c, stage: normalizeCaseStage(c.stage), kind: normalizeCaseKind(c.kind) }
}

/** 列出全部案件。 */
export async function listCases(): Promise<{ cases: CaseRecord[] }> {
  const r = await jsonRequest<{ cases: CaseRecord[] }>('/api/cases')
  return { cases: (r.cases ?? []).map(withStage) }
}

/** 获取案件详情（含材料列表）。 */
export async function getCase(id: string): Promise<{ case: CaseDetail }> {
  const r = await jsonRequest<{ case: CaseDetail }>(`/api/cases/${encodeURIComponent(id)}`)
  return { case: withStage(r.case) }
}

/** 创建案件。 */
export async function createCase(input: CreateCaseInput): Promise<{ case: CaseDetail }> {
  const r = await jsonRequest<{ case: CaseDetail }>('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return { case: withStage(r.case) }
}

/** 更新案件元数据（合并）。 */
export async function updateCase(id: string, patch: Partial<CreateCaseInput>): Promise<{ case: CaseDetail }> {
  const r = await jsonRequest<{ case: CaseDetail }>(`/api/cases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return { case: withStage(r.case) }
}

/** 删除案件（含目录与材料；并尝试删除 harness workspace 注册）。 */
export function deleteCase(id: string): Promise<{ id: string, deleted: boolean }> {
  return jsonRequest(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 案件子目录文件条目。 */
export interface CaseFile { name: string; size: number; mtime: string; rel?: string }

/** 列出案件某子目录文件（materials / reports）。 */
export function listCaseFiles(id: string, sub: string): Promise<{ files: CaseFile[] }> {
  const q = sub ? `?sub=${encodeURIComponent(sub)}` : ''
  return jsonRequest(`/api/cases/${encodeURIComponent(id)}/files${q}`)
}

/** 构造原始文件流 URL（PDF/图片可直接放进 iframe/img）。 */
export function rawFileUrl(id: string, rel: string): string {
  return `${CASE_SERVICE_BASE}/api/cases/${encodeURIComponent(id)}/raw?path=${encodeURIComponent(rel)}`
}

/** 构造预览转换 URL（docx/md 返回 HTML，其它类型 302 回退到 raw）。 */
export function previewFileUrl(id: string, rel: string): string {
  return `${CASE_SERVICE_BASE}/api/cases/${encodeURIComponent(id)}/preview?path=${encodeURIComponent(rel)}`
}

/** 把案件内 Markdown 转为公文排版 Word。 */
export function exportCaseMarkdownToWord(id: string, rel: string): Promise<{ ok: boolean; word: string; bytes: number }> {
  return jsonRequest(`/api/cases/${encodeURIComponent(id)}/export-word`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: rel }),
  })
}

/** 上传材料文件（multipart）。 */
export async function uploadMaterial(caseId: string, file: File): Promise<MaterialFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${CASE_SERVICE_BASE}/api/cases/${encodeURIComponent(caseId)}/materials`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data = await res.json()
  return data.file
}

/** 删除材料文件。 */
export function deleteMaterial(caseId: string, name: string): Promise<{ file: MaterialFile }> {
  return jsonRequest(`/api/cases/${encodeURIComponent(caseId)}/materials/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

export interface SessionBoxFile { name: string; size: number; mtime: string; rel: string }
export interface SessionBox {
  key: string
  title: string
  legacy: boolean
  inbox: SessionBoxFile[]
  drafts: SessionBoxFile[]
  reports: SessionBoxFile[]
}

/** 本案各会话自己的收件、草稿和未归入文书。 */
export function listSessionBoxes(id: string): Promise<{ boxes: SessionBox[] }> {
  return jsonRequest(`/api/cases/${encodeURIComponent(id)}/session-files`)
}

/** 把会话文件归入案件 materials 或 reports。 */
export function promoteSessionFile(id: string, input: {
  key: string
  from: 'inbox' | 'drafts' | 'reports'
  name: string
  to: 'materials' | 'reports'
}): Promise<{ file: { name: string } }> {
  return jsonRequest(`/api/cases/${encodeURIComponent(id)}/session-files/promote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** 创建（或复用）本案 harness 会话；浏览器入口始终是 /api/go/ai，不含 launch token。 */
export function startSession(caseId: string): Promise<SessionBridgeResult> {
  return jsonRequest(`/api/cases/${encodeURIComponent(caseId)}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
}

export function assistantEntryUrl(caseId: string): string {
  const q = new URLSearchParams({ caseId })
  if (typeof window !== 'undefined' && /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname)) {
    q.set('local', '1')
  }
  return `/api/go/ai?${q.toString()}`
}

export function kbConsoleUrl(): string {
  return '/api/go/kb'
}

export interface AuthUser {
  id: string
  username: string
  displayName: string
  email?: string
  roles: import('@/types').Role[]
  status: import('@/types').AccountStatus
  createdAt?: string
  lastActiveAt?: string | null
}

export function login(username: string, password: string): Promise<{ user: AuthUser }> {
  return jsonRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export function logout(): Promise<{ ok: boolean }> {
  return jsonRequest('/api/auth/logout', { method: 'POST' })
}

export function getMe(): Promise<{ user: AuthUser }> {
  return jsonRequest('/api/me')
}

export function listDirectoryUsers(): Promise<{ users: AuthUser[] }> {
  return jsonRequest('/api/users')
}

export function listAccounts(): Promise<{ accounts: import('@/types').Account[] }> {
  return jsonRequest('/api/accounts')
}

export function createAccount(input: {
  username: string
  displayName: string
  email?: string
  roles: string[]
  status?: string
  password?: string
}): Promise<{ user: import('@/types').Account; initialPassword: string | null }> {
  return jsonRequest('/api/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateAccount(id: string, patch: Record<string, unknown>): Promise<{ user: import('@/types').Account }> {
  return jsonRequest(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function listSharingGroups(): Promise<{ groups: import('@/types').SharingGroup[] }> {
  return jsonRequest('/api/sharing-groups')
}

export function createSharingGroup(input: {
  name: string
  memberIds: string[]
}): Promise<{ group: import('@/types').SharingGroup }> {
  return jsonRequest('/api/sharing-groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateSharingGroup(
  id: string,
  patch: { name?: string; memberIds?: string[] },
): Promise<{ group: import('@/types').SharingGroup }> {
  return jsonRequest(`/api/sharing-groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteSharingGroup(id: string): Promise<{ id: string; deleted: boolean }> {
  return jsonRequest(`/api/sharing-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  knowledgeCount: number
  type: string
  updatedAt: string | null
}

export interface KnowledgeItem {
  id: string
  title: string
  fileName: string
  fileType: string
  fileSize: number
  folder: string
  parseStatus: string
  enableStatus: string
  standard: string
  publisher: string
  status: string
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
  metadata: Record<string, string>
}

export function listKnowledgeBases(): Promise<{ knowledgeBases: KnowledgeBase[] }> {
  return jsonRequest('/api/knowledge-bases')
}

export function knowledgePreviewUrl(id: string): string {
  return `${CASE_SERVICE_BASE}/api/knowledge/${encodeURIComponent(id)}/preview`
}

export function getKnowledge(
  id: string,
): Promise<{ item: KnowledgeItem; markdown: string }> {
  return jsonRequest(`/api/knowledge/${encodeURIComponent(id)}`)
}

export interface LlmModel {
  id: string
  name: string
  role: 'main' | 'reasoning' | 'flash' | 'vision'
}

export interface LlmBalance {
  ok: boolean
  amount: number | null
  used: number | null
  granted: number | null
  currency: string
  source: string | null
  configured: boolean
  hidden?: boolean
  error?: string
  updatedAt: string
}

export interface LlmStatus {
  provider: string
  providerLabel: string
  defaultModel: string
  parseModel: string
  parseVisionModel?: string
  parseProvider: string
  embeddingModel: string
  closeEmbedding: string
  search: string
  models: LlmModel[]
  balance: LlmBalance
}

export function getLlmStatus(): Promise<LlmStatus> {
  return jsonRequest('/api/llm/status')
}

export function formatBalance(amount: number | null | undefined, currency = 'CNY'): string {
  if (amount == null || Number.isNaN(Number(amount))) return '—'
  const n = Number(amount)
  const formatted = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'USD' ? `$${formatted}` : `¥${formatted}`
}

export function listKnowledge(
  kbId: string,
  page = 1,
  pageSize = 200,
): Promise<{ items: KnowledgeItem[]; total: number; page: number; pageSize: number }> {
  const q = `?page=${page}&page_size=${pageSize}`
  return jsonRequest(`/api/knowledge-bases/${encodeURIComponent(kbId)}/knowledge${q}`)
}

export async function uploadKnowledge(kbId: string, file: File, title?: string): Promise<{ file: { id: string } }> {
  const form = new FormData()
  form.append('file', file)
  const q = title ? `?title=${encodeURIComponent(title)}` : ''
  const res = await fetch(
    `${CASE_SERVICE_BASE}/api/knowledge-bases/${encodeURIComponent(kbId)}/knowledge${q}`,
    { method: 'POST', body: form, credentials: 'include' },
  )
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}
