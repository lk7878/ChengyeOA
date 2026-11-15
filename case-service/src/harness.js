/**
 * harness 桥接：用 launch token 换 cookie，再调 Typert RPC 创建 workspace + session。
 *
 * 通信格式（来自 packages/client/connection/src/client/rpc.ts）：
 *   POST http://127.0.0.1:3081/api/{namespace}/{method}
 *   Content-Type: application/json
 *   Cookie: dsh-auth-...=...
 *   body: { type:'client-request', rpcId, method:'{namespace}/{method}', payload:{ args:{...} } }
 *   resp: { type:'server-response', rpcId, result:{ ok:true, value } | { ok:false, error:{code,message,details} } }
 *
 * 认证（packages/client/connection/src/browser-auth.ts）：
 *   GET /?token=<launchToken> → 303 Set-Cookie: dsh-auth-<authority>=v1....; HttpOnly; SameSite=Strict
 *   之后 /api/* 用该 cookie 鉴权。token 可重复用于签发 cookie（不失效）。
 *
 * 信任围栏（api-request-trust.ts）：Host=loopback、无 Origin/sec-fetch-site 即放行，
 * 后端 fetch 默认不发 Origin/sec-fetch-site，满足条件。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isLocalRequestHost, requestHost } from './auth.js'

const HARNESS_BASE = process.env.HARNESS_BASE || 'http://127.0.0.1:3081'
const KB_PUBLIC_BASE = (process.env.KB_PUBLIC_BASE || 'http://127.0.0.1:8090').replace(/\/+$/, '')

export function publicHarnessBase() {
  return (process.env.AI_PUBLIC_BASE || HARNESS_BASE).replace(/\/+$/, '')
}

export function publicWorkbenchBase() {
  return (process.env.WORKBENCH_PUBLIC_BASE || '').replace(/\/+$/, '')
}

export function localCaseApiBase() {
  const port = process.env.PORT || process.env.CASE_SERVICE_PORT || '5181'
  return `http://127.0.0.1:${port}`
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
}

function originFromHeader(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * 用户是否在本机工作台。不能看 Host：Caddy/frp 把上游写成 127.0.0.1 后，
 * 公网访客会被误判成本机，从而打开服务器 E:\\A 默认文件。
 * window.open(..., noreferrer) 会去掉 Referer，故部署栈以 AI_PUBLIC_BASE 为准。
 */
export function requestLooksLocal(req) {
  if (String(req?.query?.local ?? '') === '1') return true
  for (const header of [req?.headers?.referer, req?.headers?.origin]) {
    const url = originFromHeader(header)
    if (!url) continue
    return isLoopbackHostname(url.hostname)
  }
  const forwarded = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim()
  if (forwarded) return isLocalRequestHost(forwarded)
  if (!isLoopbackUrl(publicHarnessBase())) return false
  return isLocalRequestHost(requestHost(req?.headers || {}))
}

/** 本机工作台走 HARNESS_BASE；公网网关走 AI_PUBLIC_BASE。 */
export function harnessBaseForRequest(req) {
  if (requestLooksLocal(req)) return HARNESS_BASE.replace(/\/+$/, '')
  return publicHarnessBase()
}

/** 浏览器侧栏拉可见会话用的工作台 /api 根。公网必须是 10443，不能是 127.0.0.1:5181。 */
export function aiApiBase(req) {
  if (requestLooksLocal(req)) return localCaseApiBase()
  for (const header of [req?.headers?.referer, req?.headers?.origin]) {
    const url = originFromHeader(header)
    if (!url || isLoopbackHostname(url.hostname)) continue
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '')
  }
  const forwarded = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim()
  if (forwarded && !isLocalRequestHost(forwarded)) {
    const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https'
    return `${proto}://${forwarded}`.replace(/\/+$/, '')
  }
  const publicWb = publicWorkbenchBase()
  if (publicWb && !isLoopbackUrl(publicWb)) return publicWb
  const ai = publicHarnessBase()
  if (!isLoopbackUrl(ai)) {
    try {
      const url = new URL(ai)
      if (url.port === '11443') url.port = '10443'
      return url.toString().replace(/\/+$/, '')
    } catch { /* fall through */ }
  }
  const host = requestHost(req?.headers || {})
  if (host && !isLocalRequestHost(host)) {
    const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https'
    return `${proto}://${host}`.replace(/\/+$/, '')
  }
  return localCaseApiBase()
}

export function publicKbBase() {
  return KB_PUBLIC_BASE
}

function isLoopbackUrl(url) {
  return /127\.0\.0\.1|localhost/i.test(url)
}
const DSH_HOME = process.env.DSH_HOME || 'E:\\A\\.dsh'
const TOKEN_FILE = process.env.HARNESS_TOKEN_FILE || path.join(DSH_HOME, 'harness-launch-token.txt')
const BOOT_LOG = process.env.HARNESS_BOOT_LOG || path.join(DSH_HOME, 'harness-boot.log')
const TOKEN_RE = /token=([A-Za-z0-9_-]+)/

async function readTokenFromBootLog() {
  try {
    const log = await fs.readFile(BOOT_LOG, 'utf8')
    const m = log.match(TOKEN_RE)
    if (!m?.[1]) return null
    await fs.writeFile(TOKEN_FILE, m[1], 'utf8')
    return m[1]
  } catch {
    return null
  }
}
let cachedCookie = null // 形如 "dsh-auth-xxxx=v1.yyy.zzz"
const PRESET_BY_KIND = {
  general: 'general-legal',
  disability: process.env.INJURY_PRESET || 'injury',
  injury: process.env.INJURY_PRESET || 'injury',
  malpractice: process.env.MALPRACTICE_PRESET || 'medical-review',
  traffic: process.env.TRAFFIC_PRESET || 'traffic-accident',
}

/** 按案件鉴定类型选择 Harness agent preset。 */
export function presetForKind(kind) {
  return PRESET_BY_KIND[kind] || PRESET_BY_KIND.general
}

export async function mintHarnessSetCookies() {
  const cookie = await mintCookie()
  return cookie
}

export async function readToken() {
  try {
    const txt = (await fs.readFile(TOKEN_FILE, 'utf8')).trim()
    if (!txt) throw new Error('token 文件为空')
    return txt
  } catch (e) {
    const fromLog = await readTokenFromBootLog()
    if (fromLog) return fromLog
    throw new Error(`无法读取 harness launch token（${TOKEN_FILE}）：${e.message}。请先启动 harness。`)
  }
}

/** 拼 iframe URL 时用：读不到 token 则返回空串，不打断已有会话复用。 */
export async function readTokenForUrl() {
  try {
    const txt = (await fs.readFile(TOKEN_FILE, 'utf8')).trim()
    if (txt) return txt
  } catch { /* fall through */ }
  return (await readTokenFromBootLog()) || ''
}

/** 用 launch token 换取并缓存 dsh-auth cookie。 */
export async function mintCookie(force = false) {
  if (cachedCookie && !force) return cachedCookie
  const token = await readToken()
  const url = `${HARNESS_BASE}/?token=${encodeURIComponent(token)}`
  // redirect:'manual' 以便从 303 响应头取 Set-Cookie
  const res = await fetch(url, { method: 'GET', redirect: 'manual' })
  // 期望 303 + set-cookie；若 200 也尝试取
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  let cookie = null
  for (const sc of setCookies) {
    const m = sc.match(/(dsh-auth-[^=]+=[^;]+)/)
    if (m) { cookie = m[1]; break }
  }
  if (!cookie) {
    throw new Error(`未从 harness 取得 dsh-auth cookie（HTTP ${res.status}）。请确认 token 正确且 harness 已启动。`)
  }
  cachedCookie = cookie
  return cookie
}

/** 调一次单元 RPC。401 时重新换 cookie 重试一次。 */
async function rpc(namespace, method, args) {
  const endpoint = `${namespace}/${method}`
  const url = `${HARNESS_BASE}/api/${endpoint}`
  const doCall = async () => {
    const cookie = await mintCookie()
    const body = {
      type: 'client-request',
      rpcId: randomUUID(),
      method: endpoint,
      payload: { args },
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
    if (res.status === 401) return { __unauthorized: true }
    if (!res.ok) throw new Error(`transport failure for ${endpoint}: HTTP ${res.status}`)
    const env = await res.json()
    if (!env || env.type !== 'server-response') throw new Error('invalid server-response envelope')
    return env.result
  }
  let result = await doCall()
  if (result && result.__unauthorized) {
    cachedCookie = null
    result = await doCall()
  }
  if (!result || !result.ok) {
    const err = result?.error || {}
    throw new Error(`RPC ${endpoint} 失败: ${err.code || ''} ${err.message || ''}`)
  }
  return result.value
}

/**
 * 用案件标题重命名 workspace（幂等）。失败仅告警，不抛错以免阻断会话。
 */
export async function renameWorkspace(workspaceId, title) {
  if (!workspaceId || !title) return
  try {
    await rpc('workspace', 'rename', { request: { workspaceId, title } })
  } catch (e) {
    console.warn('[harness] workspace/rename 失败（忽略）:', e.message)
  }
}

/** 删除 harness workspace 注册（不删磁盘目录）。失败仅告警。 */
export async function deleteWorkspace(workspaceId) {
  if (!workspaceId) return
  try {
    await rpc('workspace', 'delete', { request: { workspaceId } })
  } catch (e) {
    console.warn('[harness] workspace/delete 失败（忽略）:', e.message)
  }
}

/**
 * 组装工作台打开助手的地址。
 * 浏览器只拿到 /api/go/ai?caseId= 这一跳；token 不进 URL（本机 loopback 调试除外）。
 */
export function workbenchAiEntry(caseId) {
  return `/api/go/ai?caseId=${encodeURIComponent(caseId)}`
}

/**
 * 组装 harness 最终入口。
 * token 必须放 query（鉴权 303 会丢掉其它 query）；
 * session / workspace 放 hash（浏览器跳转会保留 fragment）。
 * 公网部署（AI_PUBLIC_BASE 非 loopback）不把 launch token 放进浏览器。
 */
export function buildHarnessUrl(token, {
  sessionId, workspaceId, caseId, withToken = false, base: baseOverride, aclTicket, apiBase,
} = {}) {
  const base = (baseOverride || publicHarnessBase()).replace(/\/+$/, '')
  const qs = new URLSearchParams()
  // 浏览器首次打开助手须走 ?token= 换 cookie；hash 里放 session/workspace（303 会清 query）。
  if (token && (withToken || isLoopbackUrl(base))) qs.set('token', token)
  const hash = new URLSearchParams()
  if (sessionId) hash.set('session', sessionId)
  if (workspaceId) hash.set('workspace', workspaceId)
  if (caseId) hash.set('case', caseId)
  if (aclTicket) hash.set('acl', aclTicket)
  if (apiBase) hash.set('wb', apiBase)
  const query = qs.toString()
  const frag = hash.toString()
  return `${base}/${query ? `?${query}` : ''}${frag ? `#${frag}` : ''}`
}

/** 本案 session 是否仍在 Harness 会话列表中。 */
export async function sessionExists(sessionId) {
  if (!sessionId) return false
  try {
    const value = await rpc('session', 'list', { _request: {} })
    const items = value?.items ?? []
    return items.some((it) => (it?.sessionId ?? it?.id) === sessionId)
  } catch (e) {
    console.warn('[harness] session/list 失败（视为不存在）:', e.message)
    return false
  }
}

/**
 * 为案件创建（或复用）harness workspace + session。
 * @param {{caseId?:string, casePath:string, title?:string, kind?:string}} param
 * casePath 是该会话自己的目录。同一案件的多条会话不能共用案件根目录。
 * @returns {Promise<{workspaceId:string, sessionId:string, harnessUrl:string, agentPreset:string}>}
 */
export async function createSessionForCase({ caseId, casePath, title, kind }) {
  const wsValue = await rpc('workspace', 'create', { request: { path: casePath } })
  const workspace = wsValue?.workspace
  // workspaceView 返回字段名为 workspaceId（非 id）
  const workspaceId = workspace?.workspaceId ?? workspace?.id
  if (!workspaceId) throw new Error('workspace/create 未返回 workspaceId')

  // 用案件标题重命名 workspace，使 harness UI 工作区列表显示标题而非目录名（案件ID）。
  // rename 对同名是 no-op，幂等；重名会报 name-conflict，捕获忽略以免阻断建会话。
  if (title) {
    await renameWorkspace(workspaceId, title)
  }

  const agentPreset = kind ? presetForKind(kind) : null
  const request = { workspaceId }
  if (agentPreset) request.agentPreset = agentPreset
  const ssValue = await rpc('session', 'create', { request })
  const sessionId = ssValue?.sessionId
  if (!sessionId) throw new Error('session/create 未返回 sessionId')

  const token = isLoopbackUrl(publicHarnessBase()) ? await readToken() : ''
  const harnessUrl = buildHarnessUrl(token, { sessionId, workspaceId, caseId })

  return { workspaceId, sessionId, harnessUrl, agentPreset }
}
