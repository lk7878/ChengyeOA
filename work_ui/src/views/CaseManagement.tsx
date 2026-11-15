import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaseRecord, CaseStage, CasePriority, CaseKind, Account, CaseMember, Role } from '@/types'
import { CASE_STAGE_LABELS, CASE_PRIORITY_LABELS, CASE_KIND_LABELS, ROLE_LABELS, hasRole } from '@/types'
import { Button } from '@/components/Button'
import { Tag } from '@/components/Tag'
import { Modal, ModalActions } from '@/components/Modal'
import { StageTag, StageSelect, PriorityTag, KindTag } from '@/components/StatusTags'
import { IconPlus, IconSearch, IconSpark, IconBook, IconClose } from '@/components/icons'
import {
  listCases, getCase, createCase, updateCase, uploadMaterial, deleteMaterial, startSession, deleteCase,
  listCaseFiles, listSessionBoxes, promoteSessionFile, rawFileUrl, previewFileUrl, exportCaseMarkdownToWord, assistantEntryUrl,
  type CaseDetail, type CaseFile, type SessionBox,
} from '@/api/client'
import { isLocalWorkbench } from '@/config/links'
import './CaseManagement.css'

export interface CaseManagementProps {
  kind: CaseKind
  accounts: Account[]
  onOpenExternal: (id: 'ai_assistant' | 'knowledge_base') => void
  currentUser: Account
}

const STAGE_FILTERS: { id: CaseStage | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  ...Object.entries(CASE_STAGE_LABELS).map(([id, label]) => ({ id: id as CaseStage, label })),
]

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return iso }
}

export function CaseManagement({ kind, accounts, onOpenExternal, currentUser }: CaseManagementProps) {
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [stage, setStage] = useState<CaseStage | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await listCases(); setCases(r.cases ?? []) }
    catch (e: any) { setError(e?.message || '加载案件失败') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = useCallback(async (caseId: string) => {
    if (!window.confirm(`确认删除案件 ${caseId}？\n将一并删除案件目录、材料与 harness 工作区注册，且不可恢复。`)) return
    try { await deleteCase(caseId); if (selectedId === caseId) setSelectedId(null); await refresh() }
    catch (e: any) { setError(e?.message || '删除失败') }
  }, [refresh, selectedId])

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(a.id, a)
    return m
  }, [accounts])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return cases.filter((c) => {
      if (c.kind !== kind) return false
      if (stage !== 'all' && c.stage !== stage) return false
      if (!kw) return true
      return c.id.toLowerCase().includes(kw) || c.title.toLowerCase().includes(kw)
        || c.appellant.toLowerCase().includes(kw) || c.respondent.toLowerCase().includes(kw)
    })
  }, [cases, keyword, stage, kind])

  const effectiveSelectedId = selectedId && filtered.some((c) => c.id === selectedId)
    ? selectedId : filtered[0]?.id ?? null

  return (
    <div className="wb-cases">
      <div className="wb-cases__toolbar">
        <div className="wb-cases__search">
          <IconSearch size={16} />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="按案号、标题、当事人搜索" />
          {keyword && <button className="wb-cases__clear" onClick={() => setKeyword('')} aria-label="清除"><IconClose size={14} /></button>}
        </div>
        <div className="wb-cases__filters">
          {STAGE_FILTERS.map((f) => (
            <button key={f.id} className={stage === f.id ? 'wb-cases__filter is-active' : 'wb-cases__filter'} onClick={() => setStage(f.id)}>{f.label}</button>
          ))}
        </div>
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>新建{CASE_KIND_LABELS[kind]}</Button>
      </div>

      {error && <div className="wb-cases__banner wb-cases__banner--err">{error}</div>}

      <div className="wb-cases__body">
        <div className="wb-cases__list">
          <div className="wb-cases__listHead">{loading ? '加载中…' : `共 ${filtered.length} 件`}</div>
          {filtered.length === 0 && !loading && <div className="wb-cases__empty">没有匹配的{CASE_KIND_LABELS[kind]}案件</div>}
          {filtered.map((c) => (
            <button key={c.id} className={effectiveSelectedId === c.id ? 'wb-caseCard is-active' : 'wb-caseCard'} onClick={() => setSelectedId(c.id)}>
              <div className="wb-caseCard__head"><span className="wb-caseCard__id">{c.id}</span><StageTag stage={c.stage} /></div>
              <div className="wb-caseCard__title">{c.title}</div>
              <div className="wb-caseCard__meta"><span>{c.appellant} 诉 {c.respondent || '—'}</span></div>
              <div className="wb-caseCard__foot">
                <Tag>{c.category || '—'}</Tag><PriorityTag priority={c.priority} />
                <span className="wb-caseCard__date">更新 {fmtDate(c.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="wb-cases__detail">
          {effectiveSelectedId ? (
            <CaseDetail key={effectiveSelectedId} caseId={effectiveSelectedId} accountMap={accountMap}
              onOpenExternal={onOpenExternal} onMaterialChanged={refresh} onUpdated={refresh} onDelete={handleDelete}
              currentUser={currentUser} accounts={accounts} />
          ) : <div className="wb-cases__empty">选择左侧案件查看详情</div>}
        </div>
      </div>

      <CreateCaseModal open={createOpen} onClose={() => setCreateOpen(false)} accounts={accounts} kind={kind}
        currentUser={currentUser}
        onCreated={async (id) => { await refresh(); setSelectedId(id); setCreateOpen(false) }} />
    </div>
  )
}

type DetailTab = 'info' | 'materials' | 'files' | 'assistant'

function CaseDetail({ caseId, accountMap, onOpenExternal, onMaterialChanged, onUpdated, onDelete, currentUser, accounts }: {
  caseId: string
  accountMap: Map<string, Account>
  onOpenExternal: (id: 'ai_assistant' | 'knowledge_base') => void
  onMaterialChanged: () => Promise<void>
  onUpdated: () => Promise<void>
  onDelete: (caseId: string) => Promise<void>
  currentUser: Account
  accounts: Account[]
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('info')
  const [assistantOpened, setAssistantOpened] = useState(false)
  const [startingSession, setStartingSession] = useState(false)
  const [fileFocus, setFileFocus] = useState<{ sub: 'materials' | 'reports'; name: string } | null>(null)
  const [savingStage, setSavingStage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await getCase(caseId); setDetail(r.case) }
    catch (e: any) { setError(e?.message || '加载案件详情失败') }
    finally { setLoading(false) }
  }, [caseId])
  useEffect(() => { refresh() }, [refresh])

  const record = detail as CaseRecord | null
  const materials = detail?.materials ?? []

  const handleStartAssistant = useCallback(async () => {
    const url = assistantEntryUrl(caseId)
    // 须在 await 之前打开，否则浏览器会当作非用户手势而拦截弹窗。
    const opened = window.open(url, '_blank', 'noopener')
    setStartingSession(true); setError(null)
    try {
      await startSession(caseId)
      if (!opened) {
        setError('浏览器拦截了新标签页，请允许本站弹窗后重试，或复制链接在新标签打开：' + url)
      } else {
        setAssistantOpened(true)
        setTab('assistant')
      }
    } catch (e: any) { setError(e?.message || '启动 AI 助手失败（请确认 harness 已启动）') }
    finally { setStartingSession(false) }
  }, [caseId])

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    try { for (const f of Array.from(files)) { await uploadMaterial(caseId, f) } await refresh(); await onMaterialChanged() }
    catch (e: any) { setError(e?.message || '上传失败') }
    finally { if (fileInputRef.current) fileInputRef.current.value = '' }
  }, [caseId, refresh, onMaterialChanged])

  const handleStageChange = useCallback(async (next: CaseStage) => {
    if (!detail || next === detail.stage) return
    setSavingStage(true); setError(null)
    try {
      const r = await updateCase(caseId, { stage: next })
      setDetail(r.case)
      await onUpdated()
    } catch (e: any) { setError(e?.message || '更新案件状态失败') }
    finally { setSavingStage(false) }
  }, [caseId, detail, onUpdated])

  const handleDeleteMaterial = useCallback(async (name: string) => {
    setError(null)
    try { await deleteMaterial(caseId, name); await refresh(); await onMaterialChanged() }
    catch (e: any) { setError(e?.message || '删除失败') }
  }, [caseId, refresh, onMaterialChanged])

  if (loading && !detail) return <div className="wb-cases__empty">加载中…</div>
  if (!record) return <div className="wb-cases__empty">{error || '案件不存在'}</div>
  const owner = accountMap.get(record.ownerId)
  const canAssign = hasRole(currentUser, 'platform_admin') || record.ownerId === currentUser.id
  const canDelete = canAssign

  return (
    <div className="wb-caseDetail">
      <div className="wb-caseDetail__head">
        <div>
          <div className="wb-caseDetail__idRow">
            <span className="wb-caseDetail__id">{record.id}</span>
            <KindTag kind={record.kind} />
            <StageSelect stage={record.stage} disabled={savingStage} onChange={handleStageChange} />
            <PriorityTag priority={record.priority} />
          </div>
          <h2 className="wb-caseDetail__title">{record.title}</h2>
          <div className="wb-caseDetail__parties">{record.appellant} 诉 {record.respondent || '—'}</div>
        </div>
        <div className="wb-caseDetail__headActions">
          <Button variant="outline" icon={<IconBook size={16} />} onClick={() => onOpenExternal('knowledge_base')}>案件空间</Button>
          <Button variant="primary" icon={<IconSpark size={16} />} onClick={handleStartAssistant} disabled={startingSession}>
            {startingSession ? '启动中…' : '进入 AI 助手'}
          </Button>
          {canDelete ? (
            <Button variant="danger" icon={<IconClose size={16} />} onClick={() => onDelete(record.id)}>删除案件</Button>
          ) : null}
        </div>
      </div>

      {error && <div className="wb-cases__banner wb-cases__banner--err">{error}</div>}

      <div className="wb-caseDetail__tabs">
        <button className={tab === 'info' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setTab('info')}>案件信息</button>
        <button className={tab === 'materials' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setTab('materials')}>鉴定材料（{materials.length}）</button>
        <button className={tab === 'files' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setTab('files')}>文件预览</button>
        <button className={tab === 'assistant' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setTab('assistant')}>AI 助手</button>
      </div>

      {tab === 'info' && (
        <>
          <div className="wb-caseDetail__grid">
            <Field label="鉴定类型">{CASE_KIND_LABELS[record.kind]}</Field>
            <Field label="案件状态">
              <StageSelect stage={record.stage} disabled={savingStage} onChange={handleStageChange} />
            </Field>
            <Field label="案由 / 专科">{record.category || '—'}</Field>
            <Field label="案件负责人">{owner?.displayName ?? record.ownerId}</Field>
            <Field label="材料数量">{record.materialCount} 份</Field>
            <Field label="创建时间">{fmtDate(record.createdAt)}</Field>
            <Field label="最近更新">{fmtDate(record.updatedAt)}</Field>
            <Field label="办理期限">{record.dueAt ? fmtDate(record.dueAt) : '—'}</Field>
          </div>
          <section className="wb-caseDetail__section"><h3>案情摘要</h3><p>{record.description || '—'}</p></section>
          <section className="wb-caseDetail__section">
            <h3>案件成员</h3>
            <div className="wb-caseDetail__members">
              {record.members.length === 0 && <span className="wb-caseDetail__hint">暂无成员</span>}
              {record.members.map((m) => {
                const a = accountMap.get(m.accountId)
                return (
                  <div key={m.accountId} className="wb-caseDetail__member">
                    <div className="wb-caseDetail__avatar">{(a?.displayName ?? '?').slice(0, 1)}</div>
                    <div>
                      <div className="wb-caseDetail__memberName">{a?.displayName ?? m.accountId}</div>
                      <div className="wb-caseDetail__memberRole">{ROLE_LABELS[m.role]} · 加入于 {fmtDate(m.joinedAt)}</div>
                    </div>
                    {canAssign && m.accountId !== record.ownerId ? (
                      <button
                        type="button"
                        className="wb-materials__del"
                        title="移除"
                        onClick={async () => {
                          const next = record.members.filter((x) => x.accountId !== m.accountId)
                          try {
                            await updateCase(record.id, { members: next })
                            await refresh()
                            await onUpdated()
                          } catch (e: unknown) {
                            setError(e instanceof Error ? e.message : '移除失败')
                          }
                        }}
                      >
                        <IconClose size={14} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {canAssign ? (
              <MemberAssign
                accounts={accounts}
                members={record.members}
                ownerId={record.ownerId}
                onAdd={async (member) => {
                  try {
                    await updateCase(record.id, { members: [...record.members, member] })
                    await refresh()
                    await onUpdated()
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : '指派失败')
                  }
                }}
              />
            ) : null}
          </section>
          <section className="wb-caseDetail__section">
            <h3>案件目录</h3>
            <p className="wb-caseDetail__hint">正式材料在 materials，已归入的文书在 reports。每条助手会话另有自己的收件和草稿，不会写进其他会话。</p>
          </section>
        </>
      )}

      {tab === 'materials' && (
        <section className="wb-caseDetail__section">
          <div className="wb-materials__head">
            <h3>鉴定材料</h3>
            <div>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp,.bmp,.txt,.md,.html" style={{ display: 'none' }} onChange={(e) => handleUpload(e.target.files)} />
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => fileInputRef.current?.click()}>上传材料</Button>
            </div>
          </div>
          <p className="wb-caseDetail__hint">这里上传的是本案正式材料，各条会话都能查阅。助手里另传的文件先留在该会话的收件箱，确认后再归入这里。</p>
          {materials.length === 0 ? <div className="wb-cases__empty">尚未上传材料</div> : (
            <ul className="wb-materials__list">
              {materials.map((f) => (
                <li key={f.name} className="wb-materials__item">
                  <button className="wb-materials__name" title={`预览 ${f.name}`} onClick={() => { setFileFocus({ sub: 'materials', name: f.name }); setTab('files') }}>{f.name}</button>
                  <span className="wb-materials__size">{(f.size / 1024).toFixed(1)} KB</span>
                  <span className="wb-materials__time">{fmtDate(f.mtime)}</span>
                  <button className="wb-materials__preview" type="button" onClick={() => { setFileFocus({ sub: 'materials', name: f.name }); setTab('files') }}>预览</button>
                  <button className="wb-materials__del" title="删除" onClick={() => handleDeleteMaterial(f.name)}><IconClose size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <SessionBoxes caseId={record.id} onChanged={refresh} />
        </section>
      )}

      {tab === 'files' && (
        <FilePreviewPane caseId={record.id} focus={fileFocus} />
      )}

      {tab === 'assistant' && (
        <section className="wb-caseDetail__section wb-assistant">
          <div className="wb-cases__empty">
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', maxWidth: 520, margin: '0 auto' }}>
              {assistantOpened ? (
                <p>
                  {isLocalWorkbench()
                    ? <>AI 助手已在<strong>新标签页</strong>打开（本机地址应为 <code>http://127.0.0.1:3081/…</code>）。若未看到窗口，请检查浏览器是否拦截弹窗。</>
                    : <>AI 助手已在<strong>新标签页</strong>打开公网入口。交付文书请在助手里预览或「另存为」到您的电脑，不会在服务器桌面弹出 Word。</>}
                </p>
              ) : (
                <p>
                  {isLocalWorkbench()
                    ? <>本机请用 <code>http://127.0.0.1:5180</code> 打开工作台；AI 助手会在新标签页打开 <code>127.0.0.1:3081</code>。公网请从 <code>https://162.14.78.238:10443</code> 登录后再点「打开 AI 助手」。</>
                    : <>请从本工作台打开 AI 助手。直接访问 <code>https://162.14.78.238:11443</code> 可能落到服务器本机默认工作区，看不到本案文书。</>}
                </p>
              )}
              <p className="wb-caseDetail__hint">
                打开后只显示本案会话。新会话各自保存上传和草稿；助手首页另建的工作区归入「其他工作区」，不会出现在本案里。
              </p>
              <Button variant="primary" icon={<IconSpark size={16} />} onClick={handleStartAssistant} disabled={startingSession}>
                {startingSession ? '启动中…' : assistantOpened ? '再次打开 AI 助手' : '在新标签页打开 AI 助手'}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

const BOX_LABELS = { inbox: '收件', drafts: '草稿', reports: '未归入文书' } as const

function SessionBoxes({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const [boxes, setBoxes] = useState<SessionBox[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await listSessionBoxes(caseId)
      setBoxes(result.boxes || [])
      setErr(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载会话文件失败')
    }
  }, [caseId])

  useEffect(() => { load() }, [load])

  const visible = boxes.filter((box) => box.inbox.length + box.drafts.length + box.reports.length > 0)
  if (!err && visible.length === 0) return null

  async function promote(box: SessionBox, from: 'inbox' | 'drafts' | 'reports', name: string, to: 'materials' | 'reports') {
    setErr(null)
    try {
      await promoteSessionFile(caseId, { key: box.key, from, name, to })
      await load()
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '归入失败')
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <h3>会话收件与草稿</h3>
      <p className="wb-caseDetail__hint">这些文件只属于对应会话。归入后才会进入本案材料或文书，其他会话不会被盖住。</p>
      {err && <div className="wb-cases__banner wb-cases__banner--err">{err}</div>}
      {visible.map((box) => (
        <section key={box.key} style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>{box.title}</h4>
          {(['inbox', 'drafts', 'reports'] as const).map((folder) => box[folder].length === 0 ? null : (
            <ul key={folder} className="wb-materials__list">
              {box[folder].map((file) => (
                <li key={`${folder}-${file.name}`} className="wb-materials__item">
                  <a className="wb-materials__name" href={rawFileUrl(caseId, file.rel)} target="_blank" rel="noreferrer">{BOX_LABELS[folder]} · {file.name}</a>
                  <span className="wb-materials__size">{(file.size / 1024).toFixed(1)} KB</span>
                  <button className="wb-materials__preview" type="button" onClick={() => promote(box, folder, file.name, folder === 'inbox' ? 'materials' : 'reports')}>
                    {folder === 'inbox' ? '归入材料' : '归入文书'}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </section>
      ))}
    </div>
  )
}

const PREVIEW_IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'])

function FilePreviewPane({ caseId, focus }: {
  caseId: string
  focus?: { sub: 'materials' | 'reports'; name: string } | null
}) {
  const [sub, setSub] = useState<'materials' | 'reports'>(focus?.sub ?? 'reports')
  const [files, setFiles] = useState<CaseFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(focus?.name ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const refresh = useCallback(async (s: 'materials' | 'reports', prefer?: string | null) => {
    setLoading(true); setErr(null)
    try {
      const r = await listCaseFiles(caseId, s)
      const list = r.files ?? []
      setFiles(list)
      setSelected((cur) => {
        const keyOf = (f: CaseFile) => f.rel || `${s}/${f.name}`
        if (prefer) {
          const hit = list.find((f) => f.name === prefer || f.rel === prefer || keyOf(f) === prefer)
          if (hit) return keyOf(hit)
        }
        if (cur && list.some((f) => keyOf(f) === cur || f.name === cur)) {
          const hit = list.find((f) => keyOf(f) === cur || f.name === cur)
          return hit ? keyOf(hit) : cur
        }
        return list[0] ? keyOf(list[0]) : null
      })
    }
    catch (e: any) { setErr(e?.message || '加载文件失败') }
    finally { setLoading(false) }
  }, [caseId])

  useEffect(() => { refresh(sub, focus?.name ?? null) }, [refresh, sub, focus?.name])

  useEffect(() => {
    if (!focus) return
    if (focus.sub !== sub) setSub(focus.sub)
  }, [focus, sub])

  const selectedFile = files.find((f) => (f.rel || `${sub}/${f.name}`) === selected) ?? null
  const selectedName = selectedFile?.name || (selected ? selected.split('/').pop() || '' : '')
  const ext = selectedName ? selectedName.slice(selectedName.lastIndexOf('.')).toLowerCase() : ''
  const rel = selectedFile?.rel || (selectedName ? `${sub}/${selectedName}` : '')
  const isImg = PREVIEW_IMG_EXT.has(ext)
  const isPdf = ext === '.pdf'
  const isHtml = ext === '.docx' || ext === '.md' || ext === '.markdown' || ext === '.html' || ext === '.htm'
  const isText = ext === '.txt' || ext === '.csv' || ext === '.json' || ext === '.xml'
  const src = selected ? (isHtml ? previewFileUrl(caseId, rel) : rawFileUrl(caseId, rel)) : ''
  const canExportWord = ext === '.md' || ext === '.markdown'

  async function handleExportWord() {
    if (!selected || !canExportWord) return
    setExporting(true)
    setErr(null)
    try {
      const r = await exportCaseMarkdownToWord(caseId, rel)
      const name = (r.word || '').split(/[\\/]/).pop() || selectedName.replace(/\.md$/i, '.docx')
      await refresh(sub, name)
    } catch (e: any) {
      setErr(e?.message || '导出 Word 失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="wb-caseDetail__section wb-filePreview">
      <div className="wb-filePreview__bar">
        <div className="wb-filePreview__tabs">
          <button className={sub === 'reports' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setSub('reports')}>文书 reports/</button>
          <button className={sub === 'materials' ? 'wb-tab is-active' : 'wb-tab'} onClick={() => setSub('materials')}>材料 materials/</button>
        </div>
        <div className="wb-filePreview__actions">
          {canExportWord && (
            <button className="wb-filePreview__link" type="button" disabled={exporting} onClick={() => void handleExportWord()}>
              {exporting ? '导出中…' : '导出 Word'}
            </button>
          )}
          {selectedName && <a className="wb-filePreview__link" href={rawFileUrl(caseId, rel)} target="_blank" rel="noreferrer">新窗口打开</a>}
          {selectedName && <a className="wb-filePreview__link" href={rawFileUrl(caseId, rel)} download={selectedName}>下载</a>}
          <button className="wb-filePreview__refresh" onClick={() => refresh(sub, selected)} title="刷新">↻</button>
        </div>
      </div>
      {err && <div className="wb-cases__banner wb-cases__banner--err">{err}</div>}
      <div className="wb-filePreview__body">
        <div className="wb-filePreview__list">
          {loading && <div className="wb-cases__empty">加载中…</div>}
          {!loading && files.length === 0 && <div className="wb-cases__empty">{sub === 'reports' ? '尚未生成文书（AI 撰写后会出现在 reports/）' : '尚未上传材料'}</div>}
          {files.map((f) => {
            const key = f.rel || `${sub}/${f.name}`
            return (
            <button key={key} className={selected === key ? 'wb-filePreview__item is-active' : 'wb-filePreview__item'} onClick={() => setSelected(key)} title={f.name}>
              <span className="wb-filePreview__name">{f.name}</span>
              <span className="wb-filePreview__size">{(f.size / 1024).toFixed(1)} KB</span>
            </button>
            )
          })}
        </div>
        <div className="wb-filePreview__pane">
          {!selectedName && <div className="wb-cases__empty">选择左侧文件预览</div>}
          {selectedName && isPdf && (
            <iframe className="wb-filePreview__frame" src={src} title={selectedName} />
          )}
          {selectedName && isImg && (
            <img className="wb-filePreview__img" src={src} alt={selectedName} />
          )}
          {selectedName && (isHtml || isText) && (
            <iframe className="wb-filePreview__frame" src={src} title={selectedName} />
          )}
          {selectedName && !isPdf && !isImg && !isHtml && !isText && (
            <div className="wb-cases__empty">
              <p>该格式暂不支持在线预览，请下载后用本地软件打开。</p>
              <a className="wb-filePreview__dl" href={rawFileUrl(caseId, rel)} download={selectedName}>下载文件</a>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function MemberAssign({
  accounts, members, ownerId, onAdd,
}: {
  accounts: Account[]
  members: CaseMember[]
  ownerId: string
  onAdd: (member: CaseMember) => Promise<void>
}) {
  const taken = new Set(members.map((m) => m.accountId))
  taken.add(ownerId)
  const candidates = useMemo(
    () => accounts.filter((a) => a.status === 'active' && !taken.has(a.id)),
    [accounts, members, ownerId],
  )
  const [pick, setPick] = useState('')
  const [role, setRole] = useState<Role>('appraiser')
  useEffect(() => {
    if (!pick || !candidates.some((a) => a.id === pick)) {
      setPick(candidates[0]?.id ?? '')
    }
  }, [candidates, pick])
  if (!candidates.length) return <p className="wb-caseDetail__hint">可指派的账号已全部加入本案。</p>
  return (
    <div className="wb-form__row wb-form__row--2" style={{ marginTop: 12 }}>
      <select className="wb-form__input" value={pick} onChange={(e) => setPick(e.target.value)}>
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>{a.displayName}（{a.username}）</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="wb-form__input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(['appraiser', 'reviewer', 'case_owner'] as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!pick) return
            void onAdd({ accountId: pick, role, joinedAt: new Date().toISOString() })
          }}
        >
          指派
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="wb-caseDetail__field">
      <div className="wb-caseDetail__fieldLabel">{label}</div>
      <div className="wb-caseDetail__fieldValue">{children}</div>
    </div>
  )
}

function CreateCaseModal({ open, onClose, accounts, kind, onCreated, currentUser }: {
  open: boolean
  onClose: () => void
  accounts: Account[]
  kind: CaseKind
  onCreated: (id: string) => Promise<void>
  currentUser: Account
}) {
  const canPickOwner = hasRole(currentUser, 'platform_admin')
  const owners = accounts.filter((a) => a.roles.includes('case_owner') || a.roles.includes('platform_admin'))
  const [form, setForm] = useState({
    title: '', appellant: '', respondent: '', category: '',
    priority: 'normal' as CasePriority, ownerId: currentUser.id, description: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.title.trim()) { setError('请填写案件标题'); return }
    setSubmitting(true); setError(null)
    try {
      const r = await createCase({
        title: form.title.trim(), kind, appellant: form.appellant, respondent: form.respondent,
        category: form.category, priority: form.priority, ownerId: form.ownerId, description: form.description,
      })
      await onCreated(r.case.id)
    } catch (e: any) { setError(e?.message || '创建失败') }
    finally { setSubmitting(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={`新建${CASE_KIND_LABELS[kind]}`}
      description={`将创建${CASE_KIND_LABELS[kind]}案件空间 CASE-<内部案号>，并初始化 materials 目录。`}
      width={620}
      footer={<ModalActions onCancel={onClose} onConfirm={submit} confirmText={submitting ? '创建中…' : '创建'} />}>
      <div className="wb-form">
        {error && <div className="wb-cases__banner wb-cases__banner--err">{error}</div>}
        <div className="wb-form__row">
          <label className="wb-form__label">案件标题</label>
          <input className="wb-form__input" placeholder={kind === 'traffic' ? '如：轿车与电动自行车碰撞车速鉴定' : '如：腰椎间盘突出术后神经损伤鉴定'} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="wb-form__row wb-form__row--2">
          <div>
            <label className="wb-form__label">委托方 / 申请人</label>
            <input className="wb-form__input" placeholder="姓名或单位" value={form.appellant} onChange={(e) => set('appellant', e.target.value)} />
          </div>
          <div>
            <label className="wb-form__label">{kind === 'traffic' ? '对方当事人 / 单位' : '被申请人 / 医疗机构'}</label>
            <input className="wb-form__input" placeholder={kind === 'traffic' ? '姓名或单位' : '医疗机构名称'} value={form.respondent} onChange={(e) => set('respondent', e.target.value)} />
          </div>
        </div>
        <div className="wb-form__row wb-form__row--2">
          <div>
            <label className="wb-form__label">案由 / 专科</label>
            <input className="wb-form__input" placeholder={kind === 'traffic' ? '如：车速 / 痕迹' : '如：骨科 / 手术'} value={form.category} onChange={(e) => set('category', e.target.value)} />
          </div>
          <div>
            <label className="wb-form__label">优先级</label>
            <select className="wb-form__input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {Object.entries(CASE_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {canPickOwner ? (
        <div className="wb-form__row">
          <label className="wb-form__label">案件负责人</label>
          <select className="wb-form__input" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            {(owners.length ? owners : [currentUser]).map((o) => <option key={o.id} value={o.id}>{o.displayName}（{o.username}）</option>)}
          </select>
        </div>
        ) : (
        <div className="wb-form__row">
          <label className="wb-form__label">案件负责人</label>
          <input className="wb-form__input" value={currentUser.displayName} disabled />
        </div>
        )}
        <div className="wb-form__row">
          <label className="wb-form__label">案情摘要</label>
          <textarea className="wb-form__input" rows={3} placeholder="简要描述争议焦点与待鉴定事项" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

