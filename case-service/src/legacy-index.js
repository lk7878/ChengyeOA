/**
 * case-service：百佑智业鉴定助手案件管理后端。
 * 端口 5181。登录 Cookie + 案件 ACL + harness 会话桥接。
 */
import './load-env.js'
import Fastify from 'fastify'
import {registerOa} from './oa-integration.js'
import {registerTasks} from './oa-tasks.js'
import {registerKnowledge} from './knowledge-publication.js'
import {registerHarnessProxy} from './harness-proxy.js'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import path from 'node:path'
import {
  listCases, getCase, createCase, updateCase, deleteCase, caseSessions,
  saveMaterial, deleteMaterial, listCaseFiles, resolveCaseFile, CASES_ROOT,
} from './cases.js'
import {
  ensureSessionLayout, listSessionBoxes, listWorkbenchReports, promoteSessionFile, newSessionKey,
  prepareOtherWorkspace, rememberOtherWorkspace, listOtherWorkspaces,
} from './session-layout.js'
import {
  createSessionForCase, renameWorkspace, deleteWorkspace, presetForKind,
  sessionExists, workbenchAiEntry, publicHarnessBase, publicKbBase, mintCookie,
  readToken, buildHarnessUrl, harnessBaseForRequest, aiApiBase,
} from './harness.js'
import { listKnowledgeBases, listKnowledge, uploadKnowledge, getKnowledgeDetail, previewHtml, weknoraBase } from './weknora.js'
import { fetchCloseBalance, llmStatusPayload, loadDshEnv } from './closeai.js'
import {
  bootstrapUsers, listUsers, getUserById, authenticate, createUser, updateUser,
  isPlatformAdmin, canWriteKnowledge, canOpenKbConsole, canSeeBalance,
  caseVisibleTo, canManageCase,
} from './users.js'
import {
  listSharingGroups, createSharingGroup, updateSharingGroup, deleteSharingGroup,
} from './sharing.js'
import { makeSessionCookie, readSessionUser, sessionCookieHeader, mintAiAclTicket, readAiAclUser } from './auth.js'
import { audit } from './audit.js'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import mammoth from 'mammoth'
import { marked } from 'marked'

const PORT = Number(process.env.PORT || 5181)
const UNLIMITED = Number.MAX_SAFE_INTEGER
const MD_TO_WORD_CLI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../plugins/dsh-md-to-word/export_cli.py',
)
const integrated=process.env.OA_INTEGRATION!=='0'
if(!integrated){loadDshEnv();bootstrapUsers()}

const app = Fastify({
  logger: { redact: ['req.headers.authorization','req.headers.cookie'], serializers: { req: req => ({method:req.method,url:req.url?.split('?')[0]}) } },
  bodyLimit: UNLIMITED,
  requestTimeout: 0,
  connectionTimeout: 0,
})

app.decorateRequest('user', null)

await app.register(cors, { origin: process.env.WORKBENCH_PUBLIC_BASE||'http://127.0.0.1:5180', credentials: true })
await app.register(multipart, {
  limits: { fileSize: Infinity },
  throwFileSizeLimit: false,
})

function publicPath(url) {
  const pathOnly = String(url || '').split('?')[0]
  return pathOnly
}

function isPublicRoute(req) {
  const p = publicPath(req.url)
  if (req.method === 'OPTIONS') return true
  if (req.method === 'GET' && p === '/api/health') return true
  if (req.method === 'POST' && p === '/api/auth/login') return true
  if (req.method === 'GET' && p === '/api/ai/visible-sessions') return true
  return false
}

if(integrated){await registerOa(app);await registerKnowledge(app);await registerTasks(app);await registerHarnessProxy(app)}

app.addHook('preHandler', async (req, reply) => {
  if(integrated)return
  if (isPublicRoute(req)) return
  let user = readSessionUser(req.headers.cookie)
  const p = publicPath(req.url)
  if (!user && req.method === 'GET' && (p === '/api/go/ai' || p === '/api/go/other')) {
    user = readAiAclUser(req.query?.ticket)
  }
  if (!user) {
    reply.code(401)
    return reply.send({ error: '未登录' })
  }
  req.user = user
})

async function loadVisibleCase(req, reply) {
  const c = await getCase(req.params.id)
  if (!c) {
    reply.code(404)
    return { error: '案件不存在' }
  }
  if (!caseVisibleTo(c, req.user)) {
    reply.code(404)
    return { error: '案件不存在' }
  }
  return { case: c }
}

function harnessBrowserCookie(cookiePair) {
  const domain = String(process.env.COOKIE_DOMAIN || '').trim()
  const secure = String(process.env.COOKIE_SECURE || '') === '1'
  const parts = [cookiePair, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (domain) parts.push(`Domain=${domain}`)
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function sessionTitle(meta, fresh) {
  const n = caseSessions(meta).length + (fresh ? 1 : 0)
  return `会话 ${Math.max(n, 1)}`
}

async function ensureCaseSession(c, { fresh = false } = {}) {
  const wantedPreset = presetForKind(c.kind)
  const known = caseSessions(c).find((s) => s.sessionId === c.sessionId)
  if (!fresh && c.sessionId && c.workspaceId && (c.agentPreset || wantedPreset) === wantedPreset && await sessionExists(c.sessionId)) {
    if (!known?.dir) await renameWorkspace(c.workspaceId, c.title)
    return {
      workspaceId: c.workspaceId,
      sessionId: c.sessionId,
      agentPreset: wantedPreset,
      reused: true,
      dir: known?.dir || null,
    }
  }
  const key = newSessionKey()
  const dir = await ensureSessionLayout(c.id, key)
  const title = sessionTitle(c, true)
  let result
  try {
    result = await createSessionForCase({
      caseId: c.id,
      casePath: dir.replace(/\\/g, '/'),
      title,
      kind: c.kind,
    })
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    throw err
  }
  const row = {
    sessionId: result.sessionId,
    workspaceId: result.workspaceId,
    dir: `sessions/${key}`,
    title,
    legacy: false,
    createdAt: new Date().toISOString(),
  }
  const sessions = caseSessions(c).filter((s) => s.sessionId !== row.sessionId)
  sessions.push(row)
  await updateCase(c.id, {
    workspaceId: result.workspaceId,
    sessionId: result.sessionId,
    agentPreset: result.agentPreset,
    sessions,
  })
  return { ...result, reused: false, dir: row.dir, title }
}

function directoryUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    roles: row.roles,
    status: row.status,
  }
}

app.get('/api/health', async () => ({
  ok: true,
  service: 'case-service',
  casesRoot: CASES_ROOT,
  weknora: weknoraBase(),
}))

app.post('/api/auth/login', async (req, reply) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) {
    reply.code(400)
    return { error: '请输入用户名和密码' }
  }
  try {
    const user = authenticate(username, password)
    if (!user) {
      reply.code(401)
      return { error: '用户名或密码错误' }
    }
    reply.header('Set-Cookie', sessionCookieHeader(makeSessionCookie(user.id), { headers: req.headers }))
    audit(user, 'login')
    return { user }
  } catch (e) {
    reply.code(403)
    return { error: e.message }
  }
})

app.post('/api/auth/logout', async (req, reply) => {
  if(integrated){await (await import('./oa-client.js')).oa(req.oa.token,'/smart-case/logout',{method:'POST',body:{}});return {ok:true}}
  audit(req.user, 'logout')
  reply.header('Set-Cookie', sessionCookieHeader('', { clear: true, headers: req.headers }))
  return { ok: true }
})

app.get('/api/me', async (req) => ({ user: req.user }))

app.get('/api/users', async (req) => ({
  users: integrated?[req.user]:listUsers().map(directoryUser),
}))

app.get('/api/accounts', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理账号' }
  }
  return { accounts: listUsers() }
})

app.post('/api/accounts', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理账号' }
  }
  try {
    const result = createUser(req.body || {}, { actor: req.user })
    audit(req.user, 'account.create', { targetId: result.user.id, username: result.user.username })
    return result
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.patch('/api/accounts/:id', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理账号' }
  }
  try {
    const user = updateUser(req.params.id, req.body || {}, { actor: req.user })
    if (!user) {
      reply.code(404)
      return { error: '账号不存在' }
    }
    audit(req.user, 'account.update', { targetId: user.id })
    return { user }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

function validateSharingUserIds(ids) {
  const known = new Set(listUsers().map((u) => u.id))
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`用户不存在: ${id}`)
  }
}

app.get('/api/sharing-groups', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理数据共享' }
  }
  return { groups: listSharingGroups() }
})

app.post('/api/sharing-groups', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理数据共享' }
  }
  try {
    const group = createSharingGroup(req.body || {}, { validateUserIds: validateSharingUserIds })
    audit(req.user, 'sharing.create', { groupId: group.id, name: group.name })
    return { group }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.patch('/api/sharing-groups/:id', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理数据共享' }
  }
  try {
    const group = updateSharingGroup(req.params.id, req.body || {}, { validateUserIds: validateSharingUserIds })
    if (!group) {
      reply.code(404)
      return { error: '共享组不存在' }
    }
    audit(req.user, 'sharing.update', { groupId: group.id })
    return { group }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.delete('/api/sharing-groups/:id', async (req, reply) => {
  if (!isPlatformAdmin(req.user)) {
    reply.code(403)
    return { error: '仅平台维护者可管理数据共享' }
  }
  const ok = deleteSharingGroup(req.params.id)
  if (!ok) {
    reply.code(404)
    return { error: '共享组不存在' }
  }
  audit(req.user, 'sharing.delete', { groupId: req.params.id })
  return { id: req.params.id, deleted: true }
})

app.get('/api/llm/status', async (req, reply) => {
  try {
    if (!canSeeBalance(req.user)) {
      return llmStatusPayload({
        ok: true,
        amount: null,
        used: null,
        granted: null,
        currency: 'CNY',
        source: null,
        configured: true,
        hidden: true,
        updatedAt: new Date().toISOString(),
      })
    }
    const balance = await fetchCloseBalance()
    return llmStatusPayload(balance)
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/knowledge-bases', async (_req, reply) => {
  try {
    return { knowledgeBases: await listKnowledgeBases() }
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/knowledge-bases/:id/knowledge', async (req, reply) => {
  try {
    const page = Number(req.query.page || 1)
    const pageSize = Number(req.query.page_size || 200)
    return await listKnowledge(req.params.id, { page, pageSize })
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.post('/api/knowledge-bases/:id/knowledge', async (req, reply) => {
  if (!canWriteKnowledge(req.user)) {
    reply.code(403)
    return { error: '仅公共库管理员或平台维护者可导入知识库' }
  }
  try {
    const data = await req.file()
    if (!data) { reply.code(400); return { error: '缺少上传字段 file' } }
    const buffer = await data.toBuffer()
    const title = (req.query.title || '').toString().trim()
    const result = await uploadKnowledge(req.params.id, {
      filename: data.filename || 'unnamed',
      buffer,
      contentType: data.mimetype,
      title,
    })
    audit(req.user, 'kb.upload', { kbId: req.params.id, filename: data.filename })
    return { file: result }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.get('/api/knowledge/:id', async (req, reply) => {
  try {
    return await getKnowledgeDetail(req.params.id)
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/knowledge/:id/preview', async (req, reply) => {
  try {
    const { markdown } = await getKnowledgeDetail(req.params.id)
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return previewHtml(markdown)
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/cases', async (req) => {
  const all = await listCases()
  return { cases: all.filter((c) => caseVisibleTo(c, req.user)) }
})

app.post('/api/cases', async (req, reply) => {
  try {
    const body = { ...(req.body || {}) }
    if (!isPlatformAdmin(req.user)) {
      body.ownerId = req.user.id
    } else {
      body.ownerId = body.ownerId || req.user.id
    }
    const owner = getUserById(body.ownerId) || req.user
    const members = Array.isArray(body.members) ? body.members : []
    if (!members.some((m) => m.accountId === owner.id)) {
      members.unshift({
        accountId: owner.id,
        role: owner.roles.includes('case_owner') ? 'case_owner' : (owner.roles[0] || 'appraiser'),
        joinedAt: new Date().toISOString(),
      })
    }
    body.members = members
    const meta = await createCase(body)
    audit(req.user, 'case.create', { caseId: meta.id })
    return { case: meta }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.get('/api/cases/:id', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  return { case: loaded.case }
})

app.patch('/api/cases/:id', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    const patch = { ...(req.body || {}) }
    if (patch.members != null || patch.ownerId != null) {
      if (!canManageCase(loaded.case, req.user)) {
        reply.code(403)
        return { error: '仅案件负责人或平台维护者可指派成员' }
      }
    }
    if (patch.ownerId && !isPlatformAdmin(req.user) && patch.ownerId !== loaded.case.ownerId) {
      reply.code(403)
      return { error: '仅平台维护者可变更负责人' }
    }
    const meta = await updateCase(req.params.id, patch)
    audit(req.user, 'case.update', { caseId: req.params.id })
    return { case: meta }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.delete('/api/cases/:id', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    if (!canManageCase(loaded.case, req.user)) {
      reply.code(403)
      return { error: '仅案件负责人或平台维护者可删除案件' }
    }
    const workspaceIds = new Set(caseSessions(loaded.case).map((s) => s.workspaceId).filter(Boolean))
    for (const workspaceId of workspaceIds) await deleteWorkspace(workspaceId)
    await deleteCase(req.params.id)
    audit(req.user, 'case.delete', { caseId: req.params.id })
    return { id: req.params.id, deleted: true }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.post('/api/cases/:id/materials', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    const data = await req.file()
    if (!data) { reply.code(400); return { error: '缺少上传字段 file' } }
    const info = await saveMaterial(req.params.id, data.filename || 'unnamed', data.file)
    audit(req.user, 'case.material.upload', { caseId: req.params.id, name: info.name })
    return { file: info }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.delete('/api/cases/:id/materials/:name', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    const info = await deleteMaterial(req.params.id, decodeURIComponent(req.params.name))
    audit(req.user, 'case.material.delete', { caseId: req.params.id, name: info.name })
    return { file: info }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.post('/api/cases/:id/session', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    const fresh = req.query.fresh === '1' || req.body?.fresh === true
    const result = await ensureCaseSession(loaded.case, { fresh })
    audit(req.user, 'case.session', { caseId: req.params.id, reused: result.reused })
    return {
      workspaceId: result.workspaceId,
      sessionId: result.sessionId,
      agentPreset: result.agentPreset,
      reused: result.reused,
      harnessUrl: workbenchAiEntry(req.params.id),
    }
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/ai/visible-sessions', async (req, reply) => {
  const user = readAiAclUser(req.query.ticket) || readSessionUser(req.headers.cookie)
  if (!user) {
    reply.code(401)
    return { error: '未登录' }
  }
  const cases = await listCases()
  const sessions = []
  const caseIds = []
  for (const c of cases) {
    if (!caseVisibleTo(c, user)) continue
    caseIds.push(c.id)
    for (const s of caseSessions(c)) {
      sessions.push({
        sessionId: s.sessionId,
        workspaceId: s.workspaceId || null,
        caseId: c.id,
        title: s.title || c.title || c.id,
        caseTitle: c.title || c.id,
        dir: s.dir || null,
        legacy: !s.dir,
        ownerId: c.ownerId || null,
      })
    }
  }
  const others = await listOtherWorkspaces()
  return { caseIds, sessions, others }
})

app.get('/api/go/ai', async (req, reply) => {
  const caseId = String(req.query.caseId || '').trim()
  try {
    let sessionId
    let workspaceId
    if (caseId) {
      const c = await getCase(caseId)
      if (!c || !caseVisibleTo(c, req.user)) {
        reply.code(404)
        return { error: '案件不存在' }
      }
      const fresh = String(req.query.fresh || '') === '1'
      const session = await ensureCaseSession(c, { fresh })
      sessionId = session.sessionId
      workspaceId = session.workspaceId
    }
    const token = await readToken()
    const location = buildHarnessUrl(token, {
      sessionId,
      workspaceId,
      caseId: caseId || undefined,
      withToken: true,
      base: harnessBaseForRequest(req),
      aclTicket: mintAiAclTicket(req.user.id),
      apiBase: aiApiBase(req),
    })
    audit(req.user, 'ai.open', { caseId: caseId || null })
    reply.redirect(302, location)
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/go/other', async (req, reply) => {
  try {
    const prepared = await prepareOtherWorkspace(req.query.title)
    const result = await createSessionForCase({
      casePath: prepared.dir.replace(/\\/g, '/'),
      title: prepared.title,
    })
    await rememberOtherWorkspace({
      ...prepared,
      workspaceId: result.workspaceId,
      sessionId: result.sessionId,
    })
    const token = await readToken()
    const location = buildHarnessUrl(token, {
      sessionId: result.sessionId,
      workspaceId: result.workspaceId,
      withToken: true,
      base: harnessBaseForRequest(req),
      aclTicket: mintAiAclTicket(req.user.id),
      apiBase: aiApiBase(req),
    })
    audit(req.user, 'ai.other', { id: prepared.id })
    reply.redirect(302, location)
  } catch (e) {
    reply.code(502)
    return { error: e.message }
  }
})

app.get('/api/cases/:id/session-files', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  const boxes = await listSessionBoxes(req.params.id, loaded.case)
  return { boxes }
})

app.post('/api/cases/:id/session-files/promote', async (req, reply) => {
  try {
    const loaded = await loadVisibleCase(req, reply)
    if (!loaded.case) return loaded
    const key = String(req.body?.key || '')
    const from = String(req.body?.from || '')
    const name = String(req.body?.name || '')
    const to = String(req.body?.to || 'materials')
    const file = await promoteSessionFile(req.params.id, key, from, name, to)
    audit(req.user, 'case.session.promote', { caseId: req.params.id, key, from, to, name: file.name })
    return { file }
  } catch (e) {
    reply.code(400)
    return { error: e.message }
  }
})

app.get('/api/go/kb', async (req, reply) => {
  if (!canOpenKbConsole(req.user)) {
    reply.code(403)
    return { error: '知识库控制台仅对平台维护者与公共库管理员开放' }
  }
  audit(req.user, 'kb.open')
  reply.redirect(302, `${publicKbBase()}/`)
})

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.html': 'text/html; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function extOf(p) { return path.extname(p).toLowerCase() }

app.get('/api/cases/:id/files', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  const sub = (req.query.sub || '').toString()
  if (sub && !/^[A-Za-z0-9_-]+$/.test(sub)) { reply.code(400); return { error: '非法的 sub' } }
  const files = sub === 'reports'
    ? await listWorkbenchReports(req.params.id)
    : await listCaseFiles(req.params.id, sub)
  return { files }
})

app.get('/api/cases/:id/raw', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  const rel = (req.query.path || '').toString()
  const abs = await resolveCaseFile(req.params.id, rel)
  if (!abs) { reply.code(404); return { error: '文件不存在' } }
  const ct = CONTENT_TYPES[extOf(abs)] || 'application/octet-stream'
  reply.header('Content-Type', ct)
  reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(abs))}"`)
  const buf = await fs.readFile(abs)
  return buf
})

app.get('/api/cases/:id/preview', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  const rel = (req.query.path || '').toString()
  const abs = await resolveCaseFile(req.params.id, rel)
  if (!abs) { reply.code(404); return { error: '文件不存在' } }
  const ext = extOf(abs)
  const wrap = (body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,"Microsoft YaHei",Segoe UI,Roboto,sans-serif;line-height:1.75;color:#1f2329;padding:32px 40px;max-width:880px;margin:0 auto;}
  table{border-collapse:collapse;width:100%;margin:12px 0;}
  th,td{border:1px solid #d0d3d8;padding:6px 10px;text-align:left;}
  th{background:#f3f5f7;}
  h1,h2,h3{margin-top:1.4em;}
  blockquote{border-left:4px solid #c9ccd2;margin:0;padding:4px 16px;color:#5a6072;background:#f7f8fa;}
  img{max-width:100%;}
  code{background:#f3f5f7;padding:2px 5px;border-radius:4px;}
  pre{background:#f3f5f7;padding:12px;border-radius:6px;overflow:auto;}
</style></head><body>${body}</body></html>`
  try {
    if (ext === '.docx') {
      const result = await mammoth.convertToHtml({ path: abs })
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return wrap(result.value || '<p>（文档为空）</p>')
    }
    if (ext === '.md' || ext === '.markdown') {
      const text = await fs.readFile(abs, 'utf8')
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return wrap(marked.parse(text, { async: false }))
    }
    reply.redirect(302, `/api/cases/${encodeURIComponent(req.params.id)}/raw?path=${encodeURIComponent(rel)}`)
  } catch (e) {
    reply.code(500)
    return { error: '预览转换失败: ' + e.message }
  }
})

function runMdToWord(input, output, title) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-u', MD_TO_WORD_CLI, '--input', input, '--output', output, '--title', title || ''], {
      cwd: path.dirname(MD_TO_WORD_CLI),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

app.post('/api/cases/:id/export-word', async (req, reply) => {
  const loaded = await loadVisibleCase(req, reply)
  if (!loaded.case) return loaded
  const rel = String(req.body?.path || req.query.path || 'reports/病历分析报告.md').replace(/\\/g, '/')
  if (!/\.md$/i.test(rel) && !/\.markdown$/i.test(rel)) {
    reply.code(400)
    return { error: '只支持导出 Markdown（.md）' }
  }
  const abs = await resolveCaseFile(req.params.id, rel)
  if (!abs) { reply.code(404); return { error: '找不到该 Markdown 文件' } }
  const dest = abs.replace(/\.markdown$/i, '.docx').replace(/\.md$/i, '.docx')
  try {
    const result = await runMdToWord(abs, dest, path.basename(abs, path.extname(abs)))
    const line = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
    let payload = null
    try { payload = JSON.parse(line) } catch { payload = null }
    if (!payload?.ok) {
      reply.code(500)
      return { error: payload?.error || result.stderr.trim() || 'Word 导出失败' }
    }
    const wordRel = rel.replace(/\.markdown$/i, '.docx').replace(/\.md$/i, '.docx')
    audit(req.user, 'case.export-word', { caseId: req.params.id, path: wordRel })
    return { ok: true, word: wordRel.replace(/\\/g, '/'), bytes: payload.bytes || 0 }
  } catch (e) {
    reply.code(500)
    return { error: '无法启动转换：' + e.message }
  }
})

app.listen({ port: PORT, host: '127.0.0.1' }, (err, address) => {
  if (err) { app.log.error(err); process.exit(1) }
  app.log.info(`case-service listening on ${address}`)
})
