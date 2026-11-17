import {randomUUID, createHash} from 'node:crypto'
import {mkdir, unlink} from 'node:fs/promises'
import {createWriteStream, createReadStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {oa} from './oa-client.js'

const fail = (message, statusCode = 403) => { throw Object.assign(Error(message), {statusCode}) }
const fingerprint = native => createHash('sha256').update(JSON.stringify([native.id,native.file_hash,native.updated_at])).digest('hex')
const checksComplete = row => row.reviewer && row.reviewedAt && ['source','quality','duplicates','privacy'].every(key => row.checks?.[key] === true)

// Completes an existing approval, never creates one. Re-parsing invalidates its revision.
export async function reconcilePublications(kb) {
 if (kb.reconciling) return
 kb.reconciling = true
 try {
  for (const row of Object.values(kb.store.read())) {
   const eligible = current => current && ['APPROVED','IMPORTING','INDEXING'].includes(current.status)
    && current.nativeId && checksComplete(current)
    && (current.approvedRevision || 0) === (current.revision || 0)
    && kb.acl.read()[current.kbId]?.reviewers?.includes(current.reviewer)
   if (!eligible(row) || kb.busy.has(row.id)) continue
   kb.busy.add(row.id)
   try {
    const result = await kb.nativeApi('/knowledge/' + encodeURIComponent(row.nativeId))
    const native = result.data || result
    const current = kb.store.read()[row.id]
    if (!eligible(current) || current.revision !== row.revision || current.nativeId !== row.nativeId) continue
    if (native.id !== row.nativeId || native.knowledge_base_id !== row.kbId) throw Error('原生资料与审核记录不匹配，未发布')
    if (row.nativeFingerprint && (native.file_hash !== row.nativeFingerprint.fileHash || native.updated_at !== row.nativeFingerprint.updatedAt)) throw Error('历史资料已改变，未自动发布，请重新登记审核')
    if (native.parse_status === 'completed') kb.store.update(data => Object.assign(data[row.id], {
     status:'PUBLISHED', error:null, publishedAt:new Date().toISOString(), publicationMethod:'approved-index-completion',
    }))
    else if (native.parse_status === 'failed') kb.store.update(data => Object.assign(data[row.id], {status:'IMPORT_FAILED',error:'解析失败，请检查原文并重新解析'}))
   } catch (error) {
    // A transient outage must not lose the pending job or expose an unindexed document.
    kb.store.update(data => { if (data[row.id]) data[row.id].error = String(error.message).slice(0,500) })
   } finally { kb.busy.delete(row.id) }
  }
 } finally { kb.reconciling = false }
}

async function checkReviewer(kb, kbId, actor) {
 const live = actor.token ? await oa(actor.token, '/smart-case/me') : actor
 kb.authorize(kbId, live.id, 'review', live.permissions)
}

export async function legacyDocuments(kb, kbId, actor, page = 1) {
 kb.authorize(kbId, actor.id, 'review', actor.permissions)
 page = Math.max(1, Number.isSafeInteger(Number(page)) ? Number(page) : 1)
 const result = await kb.nativeApi(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge?page=${page}&page_size=20`)
 await checkReviewer(kb, kbId, actor)
 const rows = Array.isArray(result.data) ? result.data : result.data?.items || []
 const submissions = Object.values(kb.store.read()).filter(s => s.kbId === kbId)
 return {page, total:Number(result.total) || 0, items:rows.filter(n => n.knowledge_base_id === kbId).map(n => {
  const tracked = submissions.filter(s => s.nativeId === n.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
  return {id:n.id, name:n.file_name || n.title, size:n.file_size, parseStatus:n.parse_status, revision:fingerprint(n),
   error:n.parse_status === 'failed' ? String(n.error_message || '解析失败').slice(0,300) : undefined,
   submissionId:tracked?.id, status:tracked?.status || 'UNREVIEWED'}
 })}
}

// Register an immutable original for review without uploading or duplicating native knowledge.
export async function registerLegacy(kb, kbId, nativeId, actor, expectedRevision) {
 kb.authorize(kbId, actor.id, 'review', actor.permissions)
 const lock = 'legacy:' + nativeId
 if (kb.busy.has(lock)) fail('该资料正在登记，请稍后刷新',409)
 kb.busy.add(lock)
 let snapshot
 try {
  const existing = Object.values(kb.store.read()).filter(s => s.kbId === kbId && s.nativeId === nativeId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
  if (existing && (existing.origin !== 'legacy' || ['APPROVED','IMPORTING','INDEXING','PUBLISHED'].includes(existing.status))) return existing
  const result = await kb.nativeApi('/knowledge/' + encodeURIComponent(nativeId)), native = result.data || result
  if (native.id !== nativeId || native.knowledge_base_id !== kbId) fail('资料不属于目标知识库',404)
  if (expectedRevision && expectedRevision !== fingerprint(native)) fail('资料已变化，请刷新并重新核对后审核',409)
  if (existing?.status === 'PENDING' && existing.nativeFingerprint?.fileHash === native.file_hash && existing.nativeFingerprint?.updatedAt === native.updated_at) return existing
  if (native.parse_status !== 'completed') fail('资料尚未解析成功，请先处理解析问题',409)
  const id = randomUUID(), dir = path.join(kb.root,'submission-files')
  await mkdir(dir,{recursive:true,mode:0o700})
  snapshot = path.join(dir,id)
  const response = await kb.nativeApi('/knowledge/' + encodeURIComponent(nativeId) + '/download',{raw:true})
  await pipeline(response.body,createWriteStream(snapshot,{flags:'wx',mode:0o600}))
  const hash = createHash('sha256'); let size = 0
  for await (const bytes of createReadStream(snapshot)) { hash.update(bytes); size += bytes.length }
  const latestResult = await kb.nativeApi('/knowledge/' + encodeURIComponent(nativeId)), latest = latestResult.data || latestResult
  await checkReviewer(kb,kbId,actor)
  if (latest.id !== nativeId || latest.knowledge_base_id !== kbId || latest.parse_status !== 'completed' || latest.file_hash !== native.file_hash || latest.updated_at !== native.updated_at) fail('资料已发生变化，请刷新后重新登记',409)
  const row = {id,kbId,nativeId,owner:actor.id,origin:'legacy',status:'PENDING',checks:null,createdAt:new Date().toISOString(),
   source:{name:native.file_name || native.title || '历史资料',size,version:1,sha256:hash.digest('hex')},
   nativeFingerprint:{fileHash:native.file_hash,updatedAt:native.updated_at}}
  kb.store.update(data => {
   if (existing) Object.assign(data[existing.id],{status:'WITHDRAWN',supersededBy:id,withdrawnBy:actor.id,withdrawnAt:new Date().toISOString(),revision:(existing.revision||0)+1})
   data[id] = row
  })
  snapshot = null
  return row
 } finally {
  if (snapshot) await unlink(snapshot).catch(() => {})
  kb.busy.delete(lock)
 }
}

export async function reparseLegacy(kb, kbId, nativeId, actor) {
 kb.authorize(kbId,actor.id,'review',actor.permissions)
 const result = await kb.nativeApi('/knowledge/' + encodeURIComponent(nativeId)), native = result.data || result
 await checkReviewer(kb,kbId,actor)
 if (native.id !== nativeId || native.knowledge_base_id !== kbId) fail('资料不属于目标知识库',404)
 if (native.parse_status !== 'failed') fail('仅解析失败的资料可从此入口重试',409)
 if (Object.values(kb.store.read()).some(s => s.nativeId === nativeId)) fail('此资料已有审核记录，请在审核记录中重试',409)
 await kb.nativeApi('/knowledge/' + encodeURIComponent(nativeId) + '/reparse',{method:'POST',body:{}})
 return {ok:true}
}
