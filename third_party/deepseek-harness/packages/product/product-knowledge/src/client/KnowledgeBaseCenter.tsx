import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  KnowledgeAnswerView, KnowledgeBackupValue, KnowledgeBaseView, KnowledgeDocumentView,
  KnowledgeDocumentDetailValue, KnowledgeImportFileValue, KnowledgeReprocessValue,
  KnowledgeAskFrame,
  KnowledgeGraphNodeType, KnowledgeGraphRelation, KnowledgeGraphValue, KnowledgeModelSettings,
  KnowledgeModelSettingsValue, KnowledgeModelTestValue, KnowledgeConversation,
  KnowledgeRetrievalView, KnowledgeSearchValue, KnowledgeSemanticIndexStatusValue,
  KnowledgeWikiPageView, KnowledgeWikiValue,
  KnowledgeConversationPage,
  KnowledgeQueueValue,
} from '../types.ts'
import css from './KnowledgeBaseCenter.module.css'
import { CompilerPanel, CompilerSettingsPanel, type CompilerActions } from './CompilerPanel.tsx'
import { TopicPanel, type TopicActions } from './TopicPanel.tsx'

export interface KnowledgeClientActions extends CompilerActions, TopicActions {
  readonly queue: (ref: string, documentIds?: readonly string[]) => Promise<KnowledgeQueueValue>
  readonly conversation: (ref: string, before?: number) => Promise<KnowledgeConversationPage>
  readonly close: () => void
  readonly list: () => Promise<readonly KnowledgeBaseView[]>
  readonly create: (alias: string, name: string) => Promise<KnowledgeBaseView>
  readonly documents: (ref: string) => Promise<readonly KnowledgeDocumentView[]>
  readonly importMarkdown: (ref: string, name: string, markdown: string) => Promise<void>
  readonly importFile: (ref: string, file: File, stageOnly?: boolean) => Promise<KnowledgeImportFileValue>
  readonly documentDetail: (ref: string, documentId: string) => Promise<KnowledgeDocumentDetailValue>
  readonly reprocess: (ref: string, documentId: string) => Promise<KnowledgeReprocessValue>
  readonly search: (ref: string, query: string) => Promise<KnowledgeSearchValue>
  readonly wiki: (ref: string, documentId?: string) => Promise<KnowledgeWikiValue>
  readonly graph: (ref: string) => Promise<KnowledgeGraphValue>
  readonly ask: (
    ref: string, question: string, mode: 'local' | 'model', onFrame: (frame: KnowledgeAskFrame) => void,
    signal: AbortSignal, conversation?: KnowledgeConversation,
  ) => Promise<KnowledgeAnswerView>
  readonly modelSettings: () => Promise<KnowledgeModelSettingsValue>
  readonly saveModelSettings: (settings: KnowledgeModelSettings) => Promise<KnowledgeModelSettingsValue>
  readonly testModel: (signal: AbortSignal) => Promise<KnowledgeModelTestValue>
  readonly semanticIndexStatus: (ref: string) => Promise<KnowledgeSemanticIndexStatusValue>
  readonly rebuildSemanticIndex: (ref: string, signal: AbortSignal) => Promise<KnowledgeSemanticIndexStatusValue>
  readonly clearSemanticIndex: (ref: string) => Promise<KnowledgeSemanticIndexStatusValue>
  readonly setStatus: (ref: string, status: 'active' | 'archived') => Promise<KnowledgeBaseView>
  readonly deleteDocument: (ref: string, documentId: string) => Promise<void>
  readonly deleteKnowledgeBase: (ref: string, expectedAlias: string) => Promise<void>
  readonly backup: (ref: string, complete?: boolean) => Promise<KnowledgeBackupValue>
  readonly restore: (json: string) => Promise<KnowledgeBaseView>
}

type Props = PropsRuntime<'main.page'> & PropsLocale<'product.knowledge'> & KnowledgeClientActions
type Tab = 'overview' | 'documents' | 'wiki' | 'graph' | 'qa' | 'settings'

type ImportItem = {
  name: string
  status: 'pending' | 'processing' | 'imported' | 'duplicate' | 'failed' | 'skipped'
  message: string | null
}

type ChatTurn = {
  revision?: number
  savedId?: number
  sourceChanged?: boolean
  id: number
  question: string
  answer: KnowledgeAnswerView | null
  text: string
  status: 'generating' | 'complete' | 'stopped' | 'failed'
  error: string | null
}

type CompileItem = {
  id: string
  name: string
  status: 'pending' | 'running' | 'reused' | 'complete' | 'review' | 'failed' | 'cancelled' | 'skipped'
  progress: number
  message: string | null
}

function isMissingDocument(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'knowledge/document-not-found'
}

export function KnowledgeBaseCenter(props: Props) {
  const {
    ask, backup, close, create: createBase, deleteDocument, deleteKnowledgeBase,
    documentDetail, documents: listDocuments, graph: loadGraph, importFile,
    importMarkdown: importDocument, list, modelSettings: loadModelSettings, reprocess, restore,
    saveModelSettings, search: searchKnowledge, semanticIndexStatus: loadSemanticIndexStatus,
    rebuildSemanticIndex, clearSemanticIndex, setStatus, t, testModel, wiki: loadWiki,
  } = props
  const [bases, setBases] = useState<readonly KnowledgeBaseView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [documentRows, setDocumentRows] = useState<readonly KnowledgeDocumentView[]>([])
  const [searchResult, setSearchResult] = useState<KnowledgeSearchValue | null>(null)
  const [wikiPages, setWikiPages] = useState<readonly KnowledgeWikiPageView[]>([])
  const [wikiManifest, setWikiManifest] = useState<KnowledgeWikiValue | null>(null)
  const [wikiPage, setWikiPage] = useState<KnowledgeWikiPageView | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraphValue | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [pendingJobs, setPendingJobs] = useState<KnowledgeQueueValue>({ imports: [], compilations: [] })
  const conversationMemory = useRef({ summary: '', throughId: -1 })
  const [modelSettingsValue, setModelSettingsValue] = useState<KnowledgeModelSettingsValue | null>(null)
  const [modelTest, setModelTest] = useState<KnowledgeModelTestValue | null>(null)
  const [semanticStatus, setSemanticStatus] = useState<KnowledgeSemanticIndexStatusValue | null>(null)
  const [documentDetailValue, setDocumentDetailValue] = useState<KnowledgeDocumentDetailValue | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [managerOpen, setManagerOpen] = useState(false)
  const [busy, setBusy] = useState(true)
  const [answering, setAnswering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pageRef = useRef<HTMLElement | null>(null)
  const answerAbort = useRef<AbortController | null>(null)
  const nextTurnId = useRef(0)
  const navigationVersion = useRef(0)
  const indexAbort = useRef<AbortController | null>(null)
  const importAbort = useRef<AbortController | null>(null)
  const [imports, setImports] = useState<ImportItem[]>([])
  const importing = importAbort.current !== null
  const compileAbort = useRef<AbortController | null>(null)
  const [compilations, setCompilations] = useState<CompileItem[]>([])
  const [compiling, setCompiling] = useState(false)
  const [singleCompiling, setSingleCompiling] = useState(false)
  const [compilePollFailed, setCompilePollFailed] = useState(false)
  const activeCompileId = compilations.find(row => row.status === 'running')?.id

  useEffect(() => {
    if (!compiling || selected === null || activeCompileId === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await props.compilation({ ref: selected, documentId: activeCompileId })
        if (!active) return
        setCompilePollFailed(false)
        setCompilations(rows => rows.map(row => row.id === activeCompileId && row.status === 'running' ? { ...row, progress: value.progress } : row))
      } catch { if (active) setCompilePollFailed(true) }
      if (active) timer = setTimeout(() => { void poll() }, 2000)
    }
    timer = setTimeout(() => { void poll() }, 2000)
    return () => { active = false; clearTimeout(timer) }
  }, [compiling, selected, activeCompileId, props.compilation])

  useEffect(() => () => {
    navigationVersion.current++; answerAbort.current?.abort(); indexAbort.current?.abort(); importAbort.current?.abort()
    compileAbort.current?.abort()
  }, [])

  const reload = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const rows = await list()
      setBases(rows)
      if (selected !== null && rows.some(row => row.alias === selected)) {
        const documents = await listDocuments(selected)
        setDocumentRows(documents)
        setDocumentDetailValue(detail => detail !== null && documents.some(row => row.id === detail.document.id) ? detail : null)
      }
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }, [list, listDocuments, selected])

  useEffect(() => { void reload() }, [reload])

  const recoverDocumentError = async (cause: unknown, ref: string, version: number) => {
    if (navigationVersion.current !== version) return
    if (!isMissingDocument(cause)) {
      setError(errorText(cause)); return
    }
    setDocumentDetailValue(null); setWikiPage(null); setWikiPages([]); setWikiManifest(null)
    setNotice(t('documentUnavailable'))
    try {
      const [bases, documents] = await Promise.all([list(), listDocuments(ref)])
      if (navigationVersion.current !== version) return
      setBases(bases); setDocumentRows(documents)
    } catch (refreshError) {
      if (navigationVersion.current === version) setError(errorText(refreshError))
    }
  }

  const readDocumentDetail = async (ref: string, documentId: string, version: number) => {
    if (navigationVersion.current !== version) return
    setDocumentDetailValue(null)
    try {
      const detail = await documentDetail(ref, documentId)
      if (navigationVersion.current === version) setDocumentDetailValue(detail)
    } catch (cause) { await recoverDocumentError(cause, ref, version) }
  }

  const choose = async (ref: string) => {
    if (importAbort.current !== null || compileAbort.current !== null) return
    setImports([])
    setCompilations([])
    navigationVersion.current++
    if (pageRef.current !== null) pageRef.current.scrollTop = 0
    setSelected(ref); setTab('overview'); setSearchResult(null); setWikiPages([]); setWikiManifest(null); setWikiPage(null)
    answerAbort.current?.abort(); answerAbort.current = null; setAnswering(false)
    indexAbort.current?.abort(); indexAbort.current = null
    setGraph(null); setTurns([]); conversationMemory.current = { summary: '', throughId: -1 }; setSemanticStatus(null)
    setDocumentDetailValue(null); setNotice(null); setBusy(true); setError(null)
    const version = navigationVersion.current
    try {
      const [documents, history, queue] = await Promise.all([listDocuments(ref), props.conversation(ref), props.queue(ref)])
      if (navigationVersion.current !== version) return
      setDocumentRows(documents)
      setPendingJobs(queue)
      setHasOlder(history.hasMore)
      setTurns(history.turns.map(turn => ({ id: turn.id, savedId: turn.id, revision: turn.revision,
        question: turn.question, answer: turn.answer,
        text: turn.answer?.answer ?? '', status: turn.status === 'complete' ? 'complete' : turn.status === 'failed' ? 'failed' : 'stopped',
        error: null, sourceChanged: turn.sourceChanged })))
      nextTurnId.current = (history.turns.at(-1)?.id ?? 0) + 1
      if (history.hasMore) setNotice(t('olderHistoryAvailable'))
    } catch (cause) { if (navigationVersion.current === version) setError(errorText(cause)) }
    finally { if (navigationVersion.current === version) setBusy(false) }
  }

  const loadOlder = async () => {
    if (!selected || !turns[0]) return
    const version = navigationVersion.current
    setBusy(true)
    try {
      const page = await props.conversation(selected, turns[0].savedId ?? turns[0].id)
      if (navigationVersion.current !== version) return
      setTurns(current => [...page.turns.map((turn): ChatTurn => ({ id: turn.id, savedId: turn.id, revision: turn.revision,
        question: turn.question, answer: turn.answer,
        text: turn.answer?.answer ?? '', status: turn.status === 'complete' ? 'complete' : turn.status === 'failed' ? 'failed' : 'stopped',
        error: null, sourceChanged: turn.sourceChanged })), ...current])
      setHasOlder(page.hasMore)
    } catch (cause) { if (navigationVersion.current === version) setError(errorText(cause)) }
    finally { if (navigationVersion.current === version) setBusy(false) }
  }

  const createKnowledgeBase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError(null); setNotice(null)
    try {
      const base = await createBase(formText(data, 'alias'), formText(data, 'name'))
      form.reset(); await reload(); await choose(base.alias); setManagerOpen(false)
    } catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  const restoreBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get('backup')
    if (!(file instanceof File)) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const base = await restore(await file.text())
      form.reset(); await reload(); await choose(base.alias); setManagerOpen(false); setNotice(t('restoreComplete'))
    } catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  const importMarkdown = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (selected === null) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError(null); setNotice(null)
    try {
      await importDocument(selected, formText(data, 'documentName'), formText(data, 'markdown'))
      form.reset(); await reload(); setTab('documents'); setNotice(t('importComplete'))
    } catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  const importSourceFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (selected === null || busy || importAbort.current !== null) return
    const form = event.currentTarget
    const input = form.elements.namedItem('sourceFile')
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : []
    if (files.length === 0) return
    const ref = selected
    const version = navigationVersion.current
    const abort = new AbortController()
    importAbort.current = abort
    setImports(files.map(file => ({ name: file.name, status: 'pending', message: null })))
    setBusy(true); setError(null); setNotice(null); setDocumentDetailValue(null)
    let lastDocumentId: string | undefined
    const staged: Array<{ id: string; index: number }> = []
    try {
      // Persist original bytes before parsing, so staged work survives a page or process restart.
      for (const [index, file] of files.entries()) {
        if (abort.signal.aborted) break
        const update = (status: ImportItem['status'], message: string | null = null) => {
          setImports(rows => rows.map((row, position) => position === index ? { ...row, status, message } : row))
        }
        update('processing')
        try {
          if (file.size === 0) throw new Error(t('emptySourceFile'))
          if (file.size > 20 * 1024 * 1024) throw new Error(t('sourceFileTooLarge'))
          const result = await importFile(ref, file, true)
          if (result.document.status !== 'ready') staged.push({ id: result.document.id, index })
          lastDocumentId = result.document.id
          setBases(rows => rows.map(row => row.id === result.knowledgeBase.id ? result.knowledgeBase : row))
          setDocumentRows(rows => [result.document, ...rows.filter(row => row.id !== result.document.id)])
          update(result.document.status !== 'ready' ? 'pending' : result.duplicate ? 'duplicate' : 'imported')
        } catch (cause) {
          update('failed', isMissingDocument(cause) ? t('documentUnavailable') : errorText(cause))
          if (isMissingDocument(cause)) await recoverDocumentError(cause, ref, version)
        }
      }
      for (const item of staged) {
        if (abort.signal.aborted) break
        try {
          const result = await reprocess(ref, item.id)
          setBases(rows => rows.map(row => row.id === result.knowledgeBase.id ? result.knowledgeBase : row))
          setDocumentRows(rows => [result.document, ...rows.filter(row => row.id !== item.id)])
          setImports(rows => rows.map((row, index) => index === item.index ? { ...row,
            status: result.document.status === 'ready' ? 'imported' : 'failed', message: result.document.error } : row))
        } catch (cause) { setImports(rows => rows.map((row, index) => index === item.index ? { ...row, status: 'failed', message: errorText(cause) } : row)) }
      }
      if (navigationVersion.current === version) setPendingJobs(await props.queue(ref))
      if (!abort.signal.aborted && lastDocumentId !== undefined) await readDocumentDetail(ref, lastDocumentId, version)
    } catch (cause) { setError(errorText(cause)) } finally {
      setImports(rows => rows.map(row => row.status === 'pending' ? { ...row, status: 'skipped' } : row))
      importAbort.current = null
      form.reset(); setBusy(false)
    }
  }

  const stopImports = () => {
    importAbort.current?.abort()
    setImports(rows => rows.map(row => row.status === 'pending' ? { ...row, status: 'skipped' } : row))
  }

  const compileSelected = async (ids: readonly string[]) => {
    if (selected === null || busy || singleCompiling || compileAbort.current !== null
      || bases.find(base => base.alias === selected)?.status !== 'active') return
    const rows = documentRows.filter(row => row.status === 'ready' && ids.includes(row.id))
    if (rows.length === 0) return
    const ref = selected
    const version = navigationVersion.current
    const controller = new AbortController()
    const stopped = () => controller.signal.aborted
    compileAbort.current = controller
    setCompiling(true); setCompilePollFailed(false)
    setCompilations(rows.map(row => ({ id: row.id, name: row.name, status: 'pending', progress: 0, message: null })))
    const update = (id: string, status: CompileItem['status'], progress = 0, message: string | null = null) => {
      if (navigationVersion.current === version) {
        setCompilations(items => items.map(item => item.id === id ? { ...item, status, progress, message } : item))
      }
    }
    try {
      setPendingJobs(await props.queue(ref, rows.map(row => row.id)))
      for (const row of rows) {
        if (stopped()) break
        const source = { ref, documentId: row.id }
        setCompilePollFailed(false)
        update(row.id, 'running')
        try {
          const before = await props.compilation(source)
          controller.signal.throwIfAborted()
          if (before.status === 'running') { update(row.id, 'failed', before.progress, t('batchCompileAlreadyRunning')); continue }
          const result = await props.compileDocument({ ...source, operation: 'compile', force: false }, controller.signal)
          const complete = result.publication !== null && (result.status === 'complete' || result.status === 'review')
          const reused = complete && before.status !== 'stale' && before.publication !== null
            && before.publication.cacheKey === result.publication.cacheKey && before.publication.createdAt === result.publication.createdAt
          update(row.id, complete ? reused ? 'reused' : result.status === 'review' ? 'review' : 'complete'
            : result.status === 'cancelled' ? 'cancelled' : 'failed', result.progress,
          complete || result.status === 'cancelled' ? null : t('compilerFailed'))
        } catch (cause) {
          update(row.id, stopped() ? 'cancelled' : 'failed', 0, stopped() ? null : errorText(cause))
        }
      }
    } finally {
      if (navigationVersion.current === version) {
        try { setPendingJobs(await props.queue(ref)) } catch (cause) { setError(errorText(cause)) }
      }
      compileAbort.current = null
      if (navigationVersion.current === version) {
        setCompiling(false); setCompilePollFailed(false)
        setCompilations(items => items.map(item => item.status === 'pending' ? { ...item, status: 'skipped' } : item))
      }
    }
  }

  const resumeImports = async () => {
    if (!selected) return
    const ref = selected
    const version = navigationVersion.current
    const abort = new AbortController()
    importAbort.current = abort
    setBusy(true); setError(null)
    try {
      for (const id of pendingJobs.imports) {
        if (abort.signal.aborted) break
        try { await reprocess(ref, id) } catch (cause) { setError(errorText(cause)) }
      }
      if (navigationVersion.current === version) {
        setPendingJobs(await props.queue(ref)); setDocumentRows(await listDocuments(ref)); setBases(await list())
      }
    } finally { importAbort.current = null; if (navigationVersion.current === version) setBusy(false) }
  }

  const openDocumentDetail = async (documentId: string) => {
    if (selected === null) return
    const version = navigationVersion.current
    setBusy(true); setError(null); setNotice(null)
    try {
      await readDocumentDetail(selected, documentId, version)
    } finally { if (navigationVersion.current === version) setBusy(false) }
  }

  const reprocessDocument = async (documentId: string) => {
    if (selected === null) return
    const version = navigationVersion.current
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await reprocess(selected, documentId)
      if (navigationVersion.current !== version) return
      await reload()
      if (navigationVersion.current !== version) return
      setNotice(result.document.status === 'ready' ? t('reprocessComplete') : t('fileImportFailed'))
      await readDocumentDetail(selected, result.document.id, version)
    } catch (cause) { await recoverDocumentError(cause, selected, version) }
    finally { if (navigationVersion.current === version) setBusy(false) }
  }

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (selected === null) return
    const query = formText(new FormData(event.currentTarget), 'query')
    setBusy(true); setError(null); setNotice(null)
    try { setSearchResult(await searchKnowledge(selected, query)) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const selectTab = async (next: Tab) => {
    if (importAbort.current !== null || compileAbort.current !== null) return
    const version = ++navigationVersion.current
    if (pageRef.current !== null) pageRef.current.scrollTop = 0
    setTab(next); setError(null); setNotice(null)
    if (selected === null) return
    try {
      if (next === 'wiki') {
        setBusy(true)
        const manifest = await loadWiki(selected)
        const first = manifest.pages[0]
        const page = first === undefined ? null : (await loadWiki(selected, first.documentId)).pages[0] ?? null
        if (navigationVersion.current !== version) return
        setWikiManifest(manifest); setWikiPages(manifest.pages); setWikiPage(page)
      }
      if (next === 'graph') {
        setBusy(true)
        const currentGraph = await loadGraph(selected)
        if (navigationVersion.current !== version) return
        setGraph(currentGraph)
      }
      if (next === 'settings') {
        setBusy(true)
        const [settings, status] = await Promise.all([
          modelSettingsValue ?? loadModelSettings(), loadSemanticIndexStatus(selected),
        ])
        if (navigationVersion.current !== version) return
        setModelSettingsValue(settings); setSemanticStatus(status)
      }
    } catch (cause) {
      if (navigationVersion.current === version) setError(errorText(cause))
    } finally {
      if (navigationVersion.current === version) setBusy(false)
    }
  }

  const openWikiPage = async (documentId: string) => {
    if (selected === null) return
    setBusy(true); setError(null)
    try {
      setWikiPage((await loadWiki(selected, documentId)).pages[0] ?? null)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const askQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (selected === null || answerAbort.current !== null) return
    const form = event.currentTarget
    const data = new FormData(form)
    const question = formText(data, 'question').trim()
    if (question.length === 0) return
    const id = nextTurnId.current++
    const controller = new AbortController()
    answerAbort.current = controller
    setAnswering(true); setError(null); setNotice(null)
    setTurns(currentTurns => [...currentTurns, { id, revision: bases.find(base => base.alias === selected)?.revision ?? 0, question, answer: null, text: '', status: 'generating', error: null }])
    const input = form.elements.namedItem('question')
    if (input instanceof HTMLTextAreaElement) input.value = ''
    const update = (change: (turn: ChatTurn) => ChatTurn) => {
      setTurns(currentTurns => currentTurns.map(turn => turn.id === id ? change(turn) : turn))
    }
    const mode = data.get('mode') === 'model' ? 'model' : 'local'
    const previous = turns.filter(turn => turn.id > conversationMemory.current.throughId)
    const conversation: KnowledgeConversation = { summary: conversationMemory.current.summary,
      turns: previous.map(turn => ({ question: turn.question,
        answer: turn.status === 'complete' && !turn.sourceChanged && turn.answer?.status !== 'failed' ? turn.answer?.answer ?? '' : '',
      })) }
    try {
      const final = await ask(selected, question, mode, (frame) => {
        if (controller.signal.aborted) return
        if (frame.type === 'start') update(turn => ({ ...turn, answer: frame.answer }))
        if (frame.type === 'delta') update(turn => ({ ...turn, text: turn.text + frame.text }))
        if (frame.type === 'complete') update(turn => ({ ...turn, ...(frame.turnId === undefined ? {} : { savedId: frame.turnId }), answer: frame.answer, text: frame.answer.answer, status: 'complete' }))
      }, controller.signal, mode === 'model' ? conversation : undefined)
      if (!controller.signal.aborted) {
        update(turn => ({ ...turn, answer: final, text: final.answer, status: 'complete' }))
        if (final.conversation && final.status !== 'failed') {
          const throughId = previous[final.conversation.compactedTurns - 1]?.id ?? conversationMemory.current.throughId
          conversationMemory.current = { summary: final.conversation.summary, throughId }
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) update(turn => ({ ...turn, text: '', error: errorText(cause), status: 'failed' }))
    } finally {
      if (answerAbort.current === controller) { answerAbort.current = null; setAnswering(false) }
    }
  }

  const cancelAnswer = () => {
    answerAbort.current?.abort(); answerAbort.current = null; setAnswering(false)
    setTurns(currentTurns => currentTurns.map(turn => turn.status === 'generating' ? { ...turn, status: 'stopped' } : turn))
  }

  const saveGenerationSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(null); setNotice(null); setModelTest(null)
    try {
      setModelSettingsValue(await saveModelSettings({
        provider: formText(data, 'provider'), model: formText(data, 'model'),
        temperature: formNumber(data, 'temperature'), maxOutputTokens: formNumber(data, 'maxOutputTokens'),
        maxEvidenceChars: formNumber(data, 'maxEvidenceChars'), timeoutMs: formNumber(data, 'timeoutMs'),
        historyMaxChars: formNumber(data, 'historyMaxChars'), historySummaryChars: formNumber(data, 'historySummaryChars'),
        historyRecentTurns: formNumber(data, 'historyRecentTurns'),
      }))
      setNotice(t('modelSettingsSaved'))
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const testGenerationModel = async () => {
    const controller = new AbortController()
    setBusy(true); setError(null); setNotice(null); setModelTest(null)
    try { setModelTest(await testModel(controller.signal)) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const rebuildIndex = async () => {
    if (selected === null) return
    indexAbort.current?.abort()
    const controller = new AbortController()
    indexAbort.current = controller
    setBusy(true); setError(null); setNotice(null)
    setSemanticStatus(currentStatus => currentStatus === null ? null : { ...currentStatus, state: 'building' })
    try {
      setSemanticStatus(await rebuildSemanticIndex(selected, controller.signal))
      if (!controller.signal.aborted) setNotice(t('semanticIndexRebuilt'))
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause))
    } finally {
      if (indexAbort.current === controller) { indexAbort.current = null; setBusy(false) }
    }
  }

  const cancelIndex = () => {
    indexAbort.current?.abort(); indexAbort.current = null; setBusy(false); setNotice(t('semanticIndexCancelled'))
    if (selected !== null) void loadSemanticIndexStatus(selected).then(setSemanticStatus).catch(() => {})
  }

  const clearIndex = async () => {
    if (selected === null) return
    setBusy(true); setError(null); setNotice(null)
    try { setSemanticStatus(await clearSemanticIndex(selected)); setNotice(t('semanticIndexCleared')) }
    catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }


  const changeStatus = async (status: 'active' | 'archived') => {
    if (selected === null) return
    setBusy(true); setError(null); setNotice(null)
    try { await setStatus(selected, status); await reload(); setNotice(status === 'archived' ? t('archiveComplete') : t('activateComplete')) } catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  const removeDocument = async (documentId: string) => {
    if (selected === null) return
    const version = navigationVersion.current
    setBusy(true); setError(null); setNotice(null)
    try {
      await deleteDocument(selected, documentId)
      if (navigationVersion.current !== version) return
      setDocumentDetailValue(detail => detail?.document.id === documentId ? null : detail)
      await reload()
      if (navigationVersion.current === version) setNotice(t('documentDeleted'))
    } catch (cause) { await recoverDocumentError(cause, selected, version) }
    finally { if (navigationVersion.current === version) setBusy(false) }
  }

  const exportBackup = async (complete = false) => {
    if (selected === null) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await backup(selected, complete)
      download(result)
      setNotice(`${t('backupComplete')} · SHA-256 ${result.contentHash}`)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const removeKnowledgeBase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (selected === null) return
    const expectedAlias = formText(new FormData(event.currentTarget), 'expectedAlias')
    setBusy(true); setError(null); setNotice(null)
    try {
      await deleteKnowledgeBase(selected, expectedAlias)
      setBases(await list()); setSelected(null); setDocumentRows([]); setSearchResult(null); setBusy(false); setNotice(t('knowledgeBaseDeleted'))
    } catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  const current = bases.find(row => row.alias === selected)
  useEffect(() => {
    if (!current) return
    setTurns(rows => rows.map(turn => turn.revision !== undefined && turn.revision !== current.revision
      ? { ...turn, sourceChanged: true } : turn))
    conversationMemory.current = { summary: '', throughId: -1 }
  }, [current?.revision, selected])
  const destinations: Array<[Tab, string]> = [
    ['overview', t('overview')], ['documents', t('documents')], ['wiki', t('wiki')], ['graph', t('graph')],
    ['qa', t('qa')], ['settings', t('settings')],
  ]

  const selectBase = async (ref: string) => { setManagerOpen(false); await choose(ref) }

  return <main ref={pageRef} className={css.page} data-tab={tab}>
    <header className={css.header}>
      <div className={css.brand}><span className={css.brandMark} aria-hidden="true">{t('brandMark')}</span><div><h1>{t('title')}</h1><p>{t('titleDescription')}</p></div></div>
      <div className={css.headerActions}>
        {current && <button type="button" disabled={importing || compiling} className={css.secondaryButton} onClick={() => { setManagerOpen(true) }}>{t('manageKnowledgeBases')}</button>}
        <button type="button" className={css.secondaryButton} onClick={() => { close() }}>{t('close')}</button>
      </div>
    </header>
    {current && <section className={css.workspaceBar}>
      <div className={css.workspaceIdentity}>
        <span className={css.statusDot} data-status={current.status} aria-hidden="true" />
        <div><strong>{current.name}</strong><span>{current.alias} · {statusText(current.status, t)}</span></div>
      </div>
      <label className={css.basePicker}><span>{t('switchKnowledgeBase')}</span><select disabled={importing || compiling} value={current.alias} onChange={(event) => { void selectBase(event.currentTarget.value) }}>
        {bases.map(base => <option key={base.id} value={base.alias}>{base.name}</option>)}
      </select></label>
      <div className={css.workspaceFacts}><span>{current.documentCount} {t('documents')}</span><span>{current.chunkCount} {t('chunks')}</span><span>{revisionShort(current.revision, t)}</span></div>
    </section>}
    {current && <nav className={css.tabs} aria-label={t('workspaceNavigation')}>{destinations.map(([id, value]) => <button type="button" disabled={importing || compiling} key={id} data-active={tab === id || undefined} aria-current={tab === id ? 'page' : undefined} onClick={() => { void selectTab(id) }}>{value}</button>)}</nav>}
    {busy && <div className={css.loadingBar} role="progressbar" aria-label={t('loading')}><span /></div>}
    <section className={css.feedback} aria-live="polite">
      {answering && tab !== 'qa' && <div className={`${css.panel} ${css.rowActions}`}>
        <span role="status">{t('answerInBackground')}</span>
        <button type="button" disabled={importing || compiling} onClick={() => { void selectTab('qa') }}>{t('returnToAnswer')}</button>
        <button type="button" onClick={cancelAnswer}>{t('cancelGeneration')}</button>
      </div>}
      {error && <p role="alert" className={css.error}>{t('error')}: {error}</p>}
      {notice && <p role="status" className={css.notice}>{notice}</p>}
    </section>
    <section className={css.content}>
      {!current && <Welcome
        bases={bases} busy={busy} choose={selectBase} create={createKnowledgeBase} restore={restoreBackup} t={t}
      />}
      {current && <>
        {tab === 'documents' && <div>
          {pendingJobs.imports.length > 0 && <button disabled={busy || compiling} onClick={() => { void resumeImports() }}>{t('resumeImports')} ({pendingJobs.imports.length})</button>}
          {pendingJobs.compilations.length > 0 && <button disabled={busy || compiling} onClick={() => { void compileSelected(pendingJobs.compilations) }}>{t('resumeCompilations')} ({pendingJobs.compilations.length})</button>}
        </div>}
        {tab === 'overview' && <Overview current={current} documents={documentRows} result={searchResult} busy={busy} search={search} navigate={selectTab} t={t} />}
        {tab === 'documents' && <Documents key={current.alias}
          current={current} documents={documentRows} detail={documentDetailValue} busy={busy || compiling}
          compilations={compilations} compiling={compiling} compileBlocked={singleCompiling} compilePollFailed={compilePollFailed}
          compileSelected={compileSelected} cancelCompilation={() => { compileAbort.current?.abort() }}
          imports={imports} importing={importing} stopImports={stopImports}
          importFile={importSourceFile} importMarkdown={importMarkdown} openDetail={openDocumentDetail}
          reprocess={reprocessDocument} removeDocument={removeDocument} t={t}
        />}
        {tab === 'wiki' && <Wiki manifest={wikiManifest} pages={wikiPages} selected={wikiPage} open={openWikiPage} t={t}
          compiler={wikiPage && <CompilerPanel key={`${current.alias}:${wikiPage.documentId}`} actions={props} source={{ ref: current.alias, documentId: wikiPage.documentId }} t={t} />} />}
        {tab === 'wiki' && <TopicPanel key={current.alias} base={current.alias} actions={props} documents={documentRows} disabled={current.status !== 'active'} t={t} />}
        {tab === 'documents' && documentDetailValue && <CompilerPanel key={`${current.alias}:${documentDetailValue.document.id}`} actions={props} source={{ ref: current.alias, documentId: documentDetailValue.document.id }} t={t} externalBusy={compiling} onRunningChange={setSingleCompiling} />}
        {tab === 'graph' && <Graph graph={graph} busy={busy} refresh={() => { void selectTab('graph') }} t={t} />}
        {tab === 'qa' && <>{hasOlder && <button disabled={busy || answering} onClick={() => { void loadOlder() }}>{t('loadOlder')}</button>}<Qa turns={turns} busy={busy || answering} answering={answering} ask={askQuestion} cancel={cancelAnswer} t={t} /></>}
        {tab === 'settings' && <Settings
          current={current} modelSettings={modelSettingsValue} modelTest={modelTest} semanticStatus={semanticStatus} busy={busy}
          saveGeneration={saveGenerationSettings} testGeneration={testGenerationModel}
          rebuildIndex={rebuildIndex} cancelIndex={cancelIndex} clearIndex={clearIndex}
          changeStatus={changeStatus} exportBackup={exportBackup} remove={removeKnowledgeBase} t={t}
        />}
        {tab === 'settings' && <CompilerSettingsPanel actions={props} t={t} />}
      </>}
    </section>
    {current && managerOpen && <div className={css.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManagerOpen(false) }}>
      <section className={css.managerDialog} role="dialog" aria-modal="true" aria-labelledby="knowledge-manager-title">
        <header><div><h2 id="knowledge-manager-title">{t('manageKnowledgeBases')}</h2><p>{t('manageKnowledgeBasesDescription')}</p></div><button type="button" className={css.closeButton} aria-label={t('closeDialog')} onClick={() => { setManagerOpen(false) }}>×</button></header>
        <Catalog
          bases={bases}
          selected={selected}
          busy={busy}
          choose={selectBase}
          create={createKnowledgeBase}
          restore={restoreBackup}
          t={t}
        />
      </section>
    </div>}
  </main>
}

function Welcome({ bases, busy, choose, create, restore, t }: {
  bases: readonly KnowledgeBaseView[]
  busy: boolean
  choose: (ref: string) => Promise<void>
  create: (event: FormEvent<HTMLFormElement>) => Promise<void>
  restore: (event: FormEvent<HTMLFormElement>) => Promise<void>
  t: Props['t']
}) {
  return <div className={css.welcome}>
    <section className={css.welcomeCopy}><span className={css.eyebrow}>{t('knowledgeWorkspace')}</span><h2>{t('welcomeTitle')}</h2><p>{t('welcomeDescription')}</p></section>
    <Catalog bases={bases} selected={null} busy={busy} choose={choose} create={create} restore={restore} t={t} />
  </div>
}

function Catalog({ bases, selected, busy, choose, create, restore, t }: {
  bases: readonly KnowledgeBaseView[]
  selected: string | null
  busy: boolean
  choose: (ref: string) => Promise<void>
  create: (event: FormEvent<HTMLFormElement>) => Promise<void>
  restore: (event: FormEvent<HTMLFormElement>) => Promise<void>
  t: Props['t']
}) {
  return <div className={css.catalog}>
    <section className={css.libraryList}><div className={css.sectionHeading}><div><h3>{t('knowledgeBases')}</h3><p>{t('knowledgeBasesDescription')}</p></div><span>{bases.length}</span></div>
      <div className={css.baseList}>{bases.length === 0 && !busy && <div className={css.emptyState}><strong>{t('empty')}</strong><span>{t('emptyDescription')}</span></div>}
        {bases.map(base => <button type="button" key={base.id} data-active={selected === base.alias || undefined} onClick={() => { void choose(base.alias) }}>
          <span className={css.baseAvatar} aria-hidden="true">{base.name.slice(0, 1).toLocaleUpperCase()}</span><span><strong>{base.name}</strong><small>{base.alias} · {statusText(base.status, t)}</small><small>{base.documentCount} {t('documents')} · {base.chunkCount} {t('chunks')}</small></span>
        </button>)}</div>
    </section>
    <section className={css.managementForms}>
      <form onSubmit={(event) => { void create(event) }} className={`${css.form} ${css.formCard}`}><div><h3>{t('create')}</h3><p>{t('createDescription')}</p></div>
        <label>{t('alias')}<input name="alias" required pattern="[a-z0-9](?:[a-z0-9]|-)*" placeholder={t('aliasPlaceholder')} /></label>
        <label>{t('name')}<input name="name" required placeholder={t('namePlaceholder')} /></label><button disabled={busy}>{t('create')}</button>
      </form>
      <form onSubmit={(event) => { void restore(event) }} className={`${css.form} ${css.formCard}`}><div><h3>{t('restore')}</h3><p>{t('restoreDescription')}</p></div>
        <label>{t('backupFile')}<input type="file" name="backup" accept="application/json,.json" required /></label>
        <button disabled={busy}>{t('restore')}</button>
      </form>
    </section>
  </div>
}

function Overview({ current, documents, result, busy, search, navigate, t }: {
  current: KnowledgeBaseView
  documents: readonly KnowledgeDocumentView[]
  result: KnowledgeSearchValue | null
  busy: boolean
  search: (event: FormEvent<HTMLFormElement>) => Promise<void>
  navigate: (tab: Tab) => Promise<void>
  t: Props['t']
}) {
  const hits = result?.hits ?? []
  const ready = documents.filter(document => document.status === 'ready').length
  const processing = documents.filter(document => document.status !== 'ready').length
  return <div className={css.dashboard}>
    <section className={css.dashboardHero}><div><span className={css.eyebrow}>{t('workspaceOverview')}</span><h2>{current.name}</h2><p>{t('overviewDescription')}</p></div>
      <div className={css.heroActions}><button type="button" onClick={() => { void navigate('documents') }}>{t('importFile')}</button><button type="button" className={css.secondaryButton} onClick={() => { void navigate('qa') }}>{t('askKnowledge')}</button></div>
    </section>
    <section className={css.statGrid} aria-label={t('knowledgeBaseStatistics')}>
      <article><span>{t('documents')}</span><strong>{current.documentCount}</strong><small>{ready} {t('ready')}</small></article>
      <article><span>{t('chunks')}</span><strong>{current.chunkCount}</strong><small>{t('retrievableEvidence')}</small></article>
      <article><span>{t('revision')}</span><strong>{current.revision}</strong><small>{t('currentCompilation')}</small></article>
      <article data-warning={processing > 0 || undefined}><span>{t('processingQueue')}</span><strong>{processing}</strong><small>{processing === 0 ? t('allDocumentsReady') : t('documentsNeedAttention')}</small></article>
    </section>
    <div className={css.dashboardColumns}>
      <section className={`${css.panel} ${css.searchPanel}`}><div className={css.sectionHeading}><div><h2>{t('searchKnowledge')}</h2><p>{t('searchDescription')}</p></div>
        {result && <span>{retrievalModeText(result.retrieval.actualMode, t)}</span>}
      </div>
      <form onSubmit={(event) => { void search(event) }} className={css.searchForm}><label><span className={css.srOnly}>{t('query')}</span><input name="query" required placeholder={t('searchPlaceholder')} /></label><button disabled={busy}>{t('search')}</button></form>
      {result && <RetrievalDiagnostic retrieval={result.retrieval} t={t} />}
      <div className={css.results}>{result !== null && hits.length === 0 && <p className={css.emptyInline}>{t('noResults')}</p>}{hits.map(hit => <article key={hit.chunkId}><div><span className={css.resultKind}>{t('evidence')}</span><h3>{hit.heading}</h3></div><p>{hit.content}</p><small>
        {t('source')}: {hit.documentName} · {lineRange(hit.startLine, hit.endLine, t)} · {revisionShort(hit.revision, t)}
      </small></article>)}</div>
      </section>
      <aside className={`${css.panel} ${css.recentPanel}`}><div className={css.sectionHeading}><div><h2>{t('recentDocuments')}</h2><p>{t('recentDocumentsDescription')}</p></div><button type="button" className={css.textButton} onClick={() => { void navigate('documents') }}>{t('viewAll')}</button></div>
        <ul>{documents.slice(0, 5).map(document => <li key={document.id}><span className={css.fileBadge}>{document.kind.toUpperCase()}</span><span><strong>{document.name}</strong><small>{documentStatus(document, t)} · {document.chunkCount} {t('chunks')}</small></span></li>)}</ul>
        {documents.length === 0 && <div className={css.emptyState}><strong>{t('noDocuments')}</strong><span>{t('noDocumentsDescription')}</span></div>}
      </aside>
    </div>
  </div>
}

function Documents({ current, documents, detail, busy, imports, importing, stopImports,
  compilations, compiling, compileBlocked, compilePollFailed, compileSelected, cancelCompilation,
  importFile, importMarkdown, openDetail, reprocess, removeDocument, t }: {
  current: KnowledgeBaseView
  documents: readonly KnowledgeDocumentView[]
  detail: KnowledgeDocumentDetailValue | null
  busy: boolean
  imports: readonly ImportItem[]
  importing: boolean
  stopImports: () => void
  compilations: readonly CompileItem[]
  compiling: boolean
  compileBlocked: boolean
  compilePollFailed: boolean
  compileSelected: (ids: readonly string[]) => Promise<void>
  cancelCompilation: () => void
  importFile: (event: FormEvent<HTMLFormElement>) => Promise<void>
  importMarkdown: (event: FormEvent<HTMLFormElement>) => Promise<void>
  openDetail: (documentId: string) => Promise<void>
  reprocess: (documentId: string) => Promise<void>
  removeDocument: (documentId: string) => Promise<void>
  t: Props['t']
}) {
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<readonly string[]>([])
  const [compileConsent, setCompileConsent] = useState(false)
  const archived = current.status === 'archived'
  const filtered = documents.filter(document => document.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const eligible = filtered.filter(row => row.status === 'ready')
  const selectedIds = documents.filter(row => row.status === 'ready' && checked.includes(row.id)).map(row => row.id)
  return <div className={css.documentWorkspace}>
    <section className={css.pageIntro}><div><span className={css.eyebrow}>{t('sourceLibrary')}</span><h2>{t('documentCenter')}</h2><p>{t('documentCenterDescription')}</p></div><div className={css.countBadge}>{documents.length} {t('documents')}</div></section>
    {archived && <p className={css.notice}>{t('archivedWriteBlocked')}</p>}
    <section className={css.importGrid}>
      <form onSubmit={(event) => { void importFile(event) }} className={`${css.form} ${css.importCard}`}><div><span className={css.cardIcon} aria-hidden="true">↑</span><h3>{t('importFile')}</h3><p>{t('importFileDescription')}</p></div>
        <label className={css.fileInput}>{t('sourceFile')}<input type="file" name="sourceFile" multiple accept=".pdf,.docx,.xlsx,.html,.htm,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,text/markdown,text/plain" required disabled={busy || archived} /></label>
        <small className={css.muted}>{t('supportedFiles')}</small><button disabled={busy || archived}>{t('importFile')}</button>
      </form>
      <details className={css.markdownImport}><summary><span className={css.cardIcon} aria-hidden="true">M</span><span><strong>{t('pasteMarkdown')}</strong><small>{t('pasteMarkdownDescription')}</small></span></summary>
        <form onSubmit={(event) => { void importMarkdown(event) }} className={css.form}><label>{t('documentName')}<input name="documentName" required disabled={archived} /></label>
          <label>{t('markdown')}<textarea name="markdown" rows={7} required disabled={archived} /></label><button disabled={busy || archived}>{t('import')}</button></form>
      </details>
    </section>
    {imports.length > 0 && <section className={css.panel} aria-label={t('batchImport')}>
      <div className={css.listToolbar}><h3>{t('batchImport')}</h3><span role="status">{t('batchSettled')}: {imports.filter(row => row.status !== 'pending' && row.status !== 'processing').length}/{imports.length}</span>
        {importing && <button type="button" disabled={!imports.some(row => row.status === 'pending')} onClick={stopImports}>{t('stopImports')}</button>}</div>
      <p className={css.muted}>{t('batchImportHint')}</p>
      <ul>{imports.map((row, index) => <li key={index} className={row.status === 'failed' ? css.errorText : undefined}>
        {row.name} — {t(`batch_${row.status}`)}{row.message !== null && `: ${row.message}`}
      </li>)}</ul>
    </section>}
    <div className={css.documentColumns}>
      <section className={css.panel}><div className={css.listToolbar}><div><h3>{t('allDocuments')}</h3><span>{filtered.length} / {documents.length}</span></div><label><span className={css.srOnly}>{t('filterDocuments')}</span><input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} placeholder={t('filterDocuments')} /></label></div>
        <section className={css.batchCompiler} aria-label={t('batchCompile')}>
          <div className={css.rowActions}>
            <label className={css.inlineCheck}><input type="checkbox" disabled={busy || archived || eligible.length === 0}
              checked={eligible.length > 0 && eligible.every(row => selectedIds.includes(row.id))}
              onChange={(event) => { setChecked(event.currentTarget.checked ? [...new Set([...selectedIds, ...eligible.map(row => row.id)])] : selectedIds.filter(id => !eligible.some(row => row.id === id))) }} />{t('batchCompileSelectAll')}</label>
            <span>{t('batchCompileSelected')}: {selectedIds.length}</span>
            <button type="button" disabled={busy || selectedIds.length === 0} onClick={() => { setChecked([]) }}>{t('batchCompileClear')}</button>
          </div>
          <p className={css.muted}>{t('batchCompileHint')}</p>
          <label className={css.inlineCheck}><input type="checkbox" disabled={busy || archived} checked={compileConsent} onChange={(event) => { setCompileConsent(event.currentTarget.checked) }} />{t('batchCompileConsent')}</label>
          <div className={css.rowActions}>
            <button type="button" disabled={busy || archived || compileBlocked || !compileConsent || selectedIds.length === 0} onClick={() => { void compileSelected(selectedIds) }}>{t('batchCompile')}</button>
            {compiling && <button type="button" onClick={cancelCompilation}>{t('batchCompileCancel')}</button>}
          </div>
          {compileBlocked && !compiling && <p role="status">{t('batchCompileAlreadyRunning')}</p>}
          {compilations.length > 0 && <div aria-label={t('batchCompileResults')}>
            <p role="status">{t('batchSettled')}: {compilations.filter(row => row.status !== 'pending' && row.status !== 'running').length}/{compilations.length}</p>
            {compiling && <p className={css.muted}>{t('compilerProgressHint')}</p>}
            {compilePollFailed && <p role="alert">{t('compilerProgressUnavailable')}</p>}
            <ul>{compilations.map(row => <li key={row.id} className={row.status === 'failed' ? css.errorText : undefined}>
              {row.name} — {t(`batchCompile_${row.status}`)}{row.status === 'running' && ` · ${row.progress}%`}{row.message && `: ${row.message}`}
            </li>)}</ul>
          </div>}
        </section>
        <ul className={css.documentList}>{filtered.map(row => <li key={row.id} data-status={row.status}>
          <span className={css.documentSelection}><input type="checkbox"
            aria-label={t('batchCompileSelectDocument').replace('{name}', row.name)}
            disabled={busy || archived || row.status !== 'ready'} checked={selectedIds.includes(row.id)}
            onChange={(event) => {
              setChecked(event.currentTarget.checked ? [...selectedIds, row.id] : selectedIds.filter(id => id !== row.id))
            }} />
          <span className={css.fileBadge}>{row.kind.toUpperCase()}</span></span>
          <span className={css.documentIdentity}>
            <strong>{row.name}</strong><small>{formatBytes(row.sizeBytes)} · {row.chunkCount} {t('chunks')} · {revisionShort(row.revision, t)}</small>
            <small>{t('hashAlgorithm')} {row.sourceHash.slice(0, 12)} · {row.extractedChars} {t('characters')}</small>
            {row.error && <small className={css.errorText}>{row.error}</small>}
          </span>
          <span className={css.documentStatus} data-status={row.status}>{documentStatus(row, t)}</span>
          <span className={css.rowActions}>
            <button type="button" disabled={busy} onClick={() => { void openDetail(row.id) }}>{t('details')}</button>
            {row.status === 'failed' && <button type="button" disabled={busy || archived} onClick={() => { void reprocess(row.id) }}>{t('reprocess')}</button>}
            <button type="button" className={css.dangerButton} disabled={busy || archived} onClick={() => { void removeDocument(row.id) }}>{t('deleteDocument')}</button>
          </span></li>)}</ul>
        {filtered.length === 0 && <div className={css.emptyState}><strong>{documents.length === 0 ? t('noDocuments') : t('noFilteredDocuments')}</strong><span>{documents.length === 0 ? t('noDocumentsDescription') : t('adjustFilter')}</span></div>}
      </section>
      <aside className={`${css.panel} ${css.documentDetail}`}>
        {detail ? <><div className={css.sectionHeading}><div><span className={css.eyebrow}>{t('processingDetail')}</span><h3>{detail.document.originalName}</h3></div><span className={css.documentStatus} data-status={detail.document.status}>{documentStatus(detail.document, t)}</span></div>
          <ol>{detail.stages.map(stage => <li key={stage.key} data-status={stage.status}>
            <span className={css.stageDot} />
            <div><strong>{t(stage.key)}</strong><span>{stageDescription(stage.key, t)} · {stageStatus(stage.status, t)}</span></div>
          </li>)}</ol>
          <h3>{t('extractedPreview')}</h3><pre>{detail.preview || t('noExtractedPreview')}</pre>
          {!detail.reprocessable && <p className={css.muted}>{t('sourceNotInBackup')}</p>}</> : <div className={css.emptyState}><strong>{t('selectDocument')}</strong><span>{t('selectDocumentDescription')}</span></div>}
      </aside>
    </div>
  </div>
}

function Wiki({ manifest, pages, selected, open, compiler, t }: {
  manifest: KnowledgeWikiValue | null
  pages: readonly KnowledgeWikiPageView[]
  selected: KnowledgeWikiPageView | null
  open: (documentId: string) => Promise<void>
  compiler: ReactNode
  t: Props['t']
}) {
  const [query, setQuery] = useState('')
  const [pageType, setPageType] = useState('all')
  const pageTypes = [...new Set(pages.map(page => page.type))]
  const normalized = query.trim().toLocaleLowerCase()
  const visiblePages = pages.filter(page => (pageType === 'all' || page.type === pageType)
    && (normalized.length === 0 || `${page.title} ${page.topic} ${page.summary}`.toLocaleLowerCase().includes(normalized)))
  return <div className={css.wikiWorkspace}>
    <aside className={css.wikiIndex}>
      <div className={css.wikiIndexHeader}><span className={css.eyebrow}>{t('compiledKnowledge')}</span><h2>{t('wikiPages')}</h2>
        {manifest && <p>{revisionShort(manifest.revision, t)} · {t('hashAlgorithm')} {manifest.contentHash.slice(0, 12)}</p>}
      </div>
      <label className={css.wikiSearch}><span className={css.srOnly}>{t('searchWiki')}</span><input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} placeholder={t('searchWiki')} /></label>
      <div className={css.typeFilters}><button type="button" data-active={pageType === 'all' || undefined} onClick={() => { setPageType('all') }}>{t('all')}</button>{pageTypes.map(type => <button type="button" key={type} data-active={pageType === type || undefined} onClick={() => { setPageType(type) }}>{type}</button>)}</div>
      <div className={css.wikiPageList}>{visiblePages.length === 0 && <div className={css.emptyState}><strong>{t('noWikiPages')}</strong><span>{t('adjustWikiFilter')}</span></div>}
        {visiblePages.map(page => <button type="button" key={page.id} data-active={selected?.id === page.id || undefined} onClick={() => { void open(page.documentId) }}>
          <span className={css.pageType}>{page.type}</span><strong>{page.title}</strong><small>{page.topic} · {page.sections.length || '—'} {t('sections')}</small><span>{page.summary}</span>
        </button>)}</div>
      {manifest && <dl className={css.manifestStats}><div><dt>{t('pages')}</dt><dd>{manifest.stats.pageCount}</dd></div><div><dt>{t('sections')}</dt><dd>{manifest.stats.sectionCount}</dd></div><div><dt>{t('topics')}</dt><dd>{manifest.stats.topicCount}</dd></div></dl>}
    </aside>
    <article className={css.wikiPage}>{selected === null ? <div className={css.emptyState}><strong>{t('selectWikiPage')}</strong><span>{t('selectWikiPageDescription')}</span></div> : <>
      <header className={css.articleHeader}>
        <div className={css.articleMeta}>
          <span>{selected.type}</span><span>{selected.topic}</span><span>{revisionShort(selected.revision, t)}</span>
        </div>
        <h1>{selected.title}</h1><p>{selected.summary}</p>
        <div className={css.sourceLine}><span>{t('source')}</span><strong>{selected.documentName}</strong></div>
      </header>
      {compiler}
      {selected.links.length > 0 && <aside className={css.relatedPages}><strong>{t('relatedPages')}</strong><span>{selected.links.map(link => link.title).join(' · ')}</span></aside>}
      {selected.academicGuide && selected.academicGuide.length > 0 && <section className={css.articleBody} aria-label={t('academicGuide')}>
        <h2>{t('academicGuide')}</h2><p className={css.muted}>{t('academicGuideDescription')}</p>
        {selected.academicGuide.map(excerpt => <details key={excerpt.role} className={css.academicExcerpt}>
          <summary>{t(excerpt.role)} · {lineRange(excerpt.startLine, excerpt.endLine, t)}</summary><p>{excerpt.content}</p>
        </details>)}
      </section>}
      <div className={css.articleBody}>{selected.sections.map(section => <section key={section.id} className={css.wikiSection}>
        <div><h2>{section.heading}</h2><small>{lineRange(section.startLine, section.endLine, t)}</small></div><p>{section.content}</p>
      </section>)}</div>
      <footer className={css.articleFooter}>{t('compiledFromSource')} · {selected.contentHash.slice(0, 12)}</footer>
    </>}</article>
  </div>
}

function Graph({ graph, busy, refresh, t }: {
  graph: KnowledgeGraphValue | null
  busy: boolean
  refresh: () => void
  t: Props['t']
}) {
  const [mode, setMode] = useState<'cluster' | 'structure'>('cluster')
  const [nodeType, setNodeType] = useState<'all' | KnowledgeGraphNodeType>('all')
  const [relation, setRelation] = useState<'all' | KnowledgeGraphRelation>('all')
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  const visible = useMemo(() => {
    if (graph === null) return []
    const normalized = query.trim().toLocaleLowerCase()
    const neighbors = new Set<string>()
    if (focused !== null) {
      neighbors.add(focused)
      for (const edge of graph.edges) {
        if (edge.source === focused) neighbors.add(edge.target)
        if (edge.target === focused) neighbors.add(edge.source)
      }
    }
    return graph.nodes.filter(node => (nodeType === 'all' || node.type === nodeType)
      && (normalized.length === 0 || node.label.toLocaleLowerCase().includes(normalized))
      && (focused === null || neighbors.has(node.id)))
  }, [focused, graph, nodeType, query])
  const visibleIds = useMemo(() => new Set(visible.map(node => node.id)), [visible])
  const edges = graph?.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)
    && (relation === 'all' || edge.relation === relation)) ?? []
  const positions = useMemo(() => graphPositions(visible, mode), [mode, visible])
  const selected = graph?.nodes.find(node => node.id === focused) ?? null
  if (graph === null) return <div className={css.panel}><p>{busy ? t('loading') : t('noGraph')}</p></div>
  return <div className={css.panel}>
    <div className={css.sectionHeading}><div><h2>{t('knowledgeGraph')}</h2><p>{t('graphDescription')}</p></div>
      <button type="button" className={css.secondaryButton} disabled={busy} onClick={refresh}>{t('refreshGraph')}</button>
    </div>
    <p>{graph.totalNodes} {t('nodes')} · {graph.totalEdges} {t('edges')} · {revisionShort(graph.revision, t)}</p>
    {graph.truncated && <p>{t('graphTruncated')}</p>}
    <div className={css.graphControls}>
      <button type="button" data-active={mode === 'cluster' || undefined} onClick={() => { setMode('cluster') }}>{t('clusterView')}</button>
      <button type="button" data-active={mode === 'structure' || undefined} onClick={() => { setMode('structure') }}>{t('structureView')}</button>
      <label>{t('nodeType')}<select value={nodeType} onChange={(event) => { setNodeType(event.currentTarget.value as typeof nodeType) }}>
        <option value="all">{t('all')}</option>{GRAPH_NODE_TYPES.map(type => <option key={type} value={type}>{graphNodeTypeText(type, t)}</option>)}
      </select></label>
      <label>{t('relation')}<select value={relation} onChange={(event) => { setRelation(event.currentTarget.value as typeof relation) }}>
        <option value="all">{t('all')}</option>{GRAPH_RELATIONS.map(value => <option key={value} value={value}>{graphRelationText(value, t)}</option>)}
      </select></label>
      <label>{t('graphSearch')}<input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} /></label>
      <button type="button" onClick={() => { setFocused(null); setNodeType('all'); setRelation('all'); setQuery('') }}>{t('resetView')}</button>
    </div>
    {visible.length === 0 ? <div className={`${css.graph} ${css.emptyState}`}>
      <strong>{graph.totalNodes === 0 ? t('noGraph') : t('noMatchingNodes')}</strong>
      <span>{graph.totalNodes === 0 ? t('graphEmptyDescription') : t('adjustFilter')}</span>
    </div> : <svg className={css.graph} viewBox="0 0 960 560" role="img" aria-label={t('knowledgeGraph')}>
      {edges.map((edge) => {
        const source = positions.get(edge.source); const target = positions.get(edge.target)
        return source && target
          ? <line
            key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
            data-relation={edge.relation} style={{ strokeWidth: edge.weight }}
          />
          : null
      })}
      {visible.map((node) => {
        const point = positions.get(node.id)
        return point === undefined ? null : <g
          key={node.id}
          transform={`translate(${point.x} ${point.y})`}
          data-type={node.type}
          data-focused={focused === node.id || undefined}
          role="button"
          aria-label={node.label}
          tabIndex={0}
          onClick={() => { setFocused(node.id) }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setFocused(node.id) }}
        >
          <circle r={Math.min(28, 12 + node.degree * 1.5)} />
          <text y={Math.min(43, 27 + node.degree)}>{shortLabel(node.label)}</text>
        </g>
      })}
    </svg>}
    <ul className={css.legend}>{GRAPH_NODE_TYPES.map(type => <li key={type}>{graphNodeTypeText(type, t)}</li>)}</ul>
    {selected && <aside className={css.graphDetail}><strong>{selected.label}</strong><span>{graphNodeTypeText(selected.type, t)} · {t('degree')}: {selected.degree}</span>
      {selected.documentId && <span>{t('source')}: {selected.documentId}{selected.startLine === null ? '' : ` · ${lineRange(selected.startLine, selected.startLine, t)}`}</span>}
      <button type="button" onClick={() => { setFocused(null) }}>{t('clearFocus')}</button></aside>}
  </div>
}

function Qa({ turns, busy, answering, ask, cancel, t }: {
  turns: readonly ChatTurn[]
  busy: boolean
  answering: boolean
  ask: (event: FormEvent<HTMLFormElement>) => Promise<void>
  cancel: () => void
  t: Props['t']
}) {
  const transcript = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLFormElement | null>(null)
  const followOutput = useRef(true)
  const labels = useMemo(() => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }), [t])
  useEffect(() => {
    if (followOutput.current && transcript.current !== null) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [turns])
  return <section className={css.qaWorkspace} aria-label={t('askKnowledge')}>
    <header className={css.chatHeader}><h2>{t('groundedAssistant')}</h2><span>{t('chatSessionHint')}</span></header>
    <div ref={transcript} className={css.chatTranscript} role="log" aria-label={t('conversation')} onScroll={(event) => {
      const node = event.currentTarget
      followOutput.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    }}>
      {turns.length === 0 && <div className={css.chatWelcome}><h2>{t('askKnowledge')}</h2><p>{t('askKnowledgeDescription')}</p></div>}
      {turns.map(turn => <article key={turn.id} className={css.chatTurn}>
        <div className={css.userMessage}><span className={css.srOnly}>{t('you')}</span><p>{turn.question}</p></div>
        <div className={css.assistantMessage}>
          <span className={css.messageRole}>{t('groundedAssistant')}</span>
          {turn.sourceChanged && <p role="note" className={css.answerMeta}>{t('sourceChanged')}</p>}
          {turn.answer?.mode === 'model-rag' && <p role="note" className={css.answerMeta}>{t('answerNeedsReview')}</p>}
          {turn.answer?.mode === 'model-general' && <p className={css.answerMeta} role="note">{t('generalAnswerNotice')}</p>}
          {turn.status === 'complete' && turn.answer?.generation?.fallbackReason && <p className={css.errorText} role="status">{t('fallbackReason')}: {fallbackText(turn.answer.generation.fallbackReason, t)}</p>}
          {turn.text && <div className={css.answerText}><MarkdownText text={turn.text} streaming={turn.status === 'generating'} labels={labels} /></div>}
          {turn.status === 'generating' && <p className={css.answerMeta}>{t('generating')} · {t('unverifiedDraft')}</p>}
          {turn.status === 'stopped' && <p className={css.answerMeta}>{t('generationStopped')} · {t('unverifiedDraft')}</p>}
          {turn.error && <p className={css.errorText} role="alert">{t('error')}: {turn.error}</p>}
          {(turn.status === 'failed' || turn.answer?.mode === 'model-failed') && <button type="button" disabled={busy} onClick={() => {
            const input = composer.current?.elements.namedItem('question')
            if (input instanceof HTMLTextAreaElement) { input.value = turn.question; input.focus() }
          }}>{t('retryQuestion')}</button>}
          {turn.answer && <>
            {turn.status === 'complete' && turn.answer.status === 'no-evidence' && !turn.text && <p className={css.muted}>{t('noEvidence')}</p>}
            {turn.answer.citations.length > 0 && <details className={css.citationDisclosure}>
              <summary>{t('sourceEvidence')} · {turn.answer.citations.length}</summary>
              {turn.answer.citations.map(citation => <article key={citation.id}>
                <strong>[{citation.id}] {citation.heading}</strong>
                <small>{citation.documentName} · {citation.vision === undefined ? lineRange(citation.startLine, citation.endLine, t) : `${t('compilerPage')} ${citation.vision.page} · ${t('compilerReviewed')}`}</small>
                <p>{citation.content}</p>
              </article>)}
            </details>}
            <details className={css.answerDiagnostics}><summary>{t('answerDetails')}</summary>
              {turn.answer.retrieval && <RetrievalDiagnostic retrieval={turn.answer.retrieval} t={t} />}
              {turn.answer.knowledgeNavigation && <section>
                <h4>{t('knowledgeNavigation')}</h4><p>{t(`navigation_${turn.answer.knowledgeNavigation.status}`)} · {t('navigationNotice')}</p>
                <p>{turn.answer.knowledgeNavigation.provider} / {turn.answer.knowledgeNavigation.model} · {t('latency')}: {turn.answer.knowledgeNavigation.latencyMs} {t('millisecondsShort')} · {t('tokenUsage')}: {turn.answer.knowledgeNavigation.totalTokens ?? t('unavailable')}</p>
                <p>{turn.answer.knowledgeNavigation.calls} {t('compilerCalls')} · {t('navigationLookups')}: {turn.answer.knowledgeNavigation.lookupCount}</p>
                {turn.answer.knowledgeNavigation.reason === 'input-limit' && <p>{t('navigationInputLimit')}</p>}
                {turn.answer.knowledgeNavigation.reason === 'evidence-limit' && <p>{t('navigationEvidenceLimit')}</p>}
                <ul>{turn.answer.knowledgeNavigation.needs.map((need, index) => <li key={index}>{need.question} — {need.evidenceIds.length > 0 ? `${t('navigationEvidence')}: ${need.evidenceIds.map(id => `[${id}]`).join(' ')}` : t('navigationMissing')}</li>)}</ul>
              </section>}
              {turn.answer.queryExpansion && <p>{t('queryExpansion')}: {turn.answer.queryExpansion.query ?? t(turn.answer.queryExpansion.status === 'failed' ? 'queryExpansionFailed' : 'queryExpansionSkipped')}
                {' · '}{t('latency')}: {turn.answer.queryExpansion.generation.latencyMs} {t('millisecondsShort')}
                {' · '}{t('tokenUsage')}: {turn.answer.queryExpansion.generation.totalTokens ?? t('unavailable')}</p>}
              {turn.answer.evidenceSelection && <p>{t('evidenceSelection')}: {turn.answer.evidenceSelection.selectedCount} / {turn.answer.evidenceSelection.candidateCount}
                {' · '}{turn.answer.evidenceSelection.status === 'failed' ? t('evidenceSelectionFailed') : t('evidenceSelectionApplied')}
                {turn.answer.evidenceSelection.generation.fallbackReason && ` · ${fallbackText(turn.answer.evidenceSelection.generation.fallbackReason, t)}`}
                {' · '}{t('latency')}: {turn.answer.evidenceSelection.generation.latencyMs} {t('millisecondsShort')}
                {' · '}{t('tokenUsage')}: {turn.answer.evidenceSelection.generation.totalTokens ?? t('unavailable')}</p>}
              <p>{answerModeText(turn.answer.mode, t)} · {t('confidence')}: {confidenceText(turn.answer.confidence, t)}</p>
              {turn.answer.conversation && <div>
                <p>{t('resolvedQuestion')}: {turn.answer.conversation.query}</p>
                <p>{t('historyTurns')}: {turn.answer.conversation.historyTurns} · {t('compactedTurns')}: {turn.answer.conversation.compactedTurns}
                  {' · '}{t('maxOutputTokens')}: {turn.answer.conversation.outputTokens}
                  {' · '}{t('modelContext')}: {turn.answer.conversation.contextWindow ?? t('unavailable')}
                  {' · '}{t('memoryCalls')}: {turn.answer.conversation.calls}
                  {' · '}{t('tokenUsage')}: {turn.answer.conversation.totalTokens ?? t('unavailable')}</p>
                {turn.answer.conversation.summary && <details><summary>{t('conversationSummary')}</summary><p>{turn.answer.conversation.summary}</p></details>}
              </div>}
              {turn.answer.answerRepair && <p>{t('answerRepair')}: {t(turn.answer.answerRepair.status === 'repaired' ? 'repairSucceeded' : turn.answer.answerRepair.status === 'insufficient' ? 'repairInsufficient' : 'repairFailed')}
                {' · '}{turn.answer.answerRepair.reason === 'answer-language' ? t('answerLanguage') : t('fallbackCitations')}
                {' · '}{t('latency')}: {turn.answer.answerRepair.generation.latencyMs} {t('millisecondsShort')}
                {' · '}{t('tokenUsage')}: {turn.answer.answerRepair.generation.totalTokens ?? t('unavailable')}</p>}
              {turn.answer.generation && <p>
                {t('modelRoute')}: {turn.answer.generation.provider} / {turn.answer.generation.model}
                {' · '}{t('latency')}: {turn.answer.generation.latencyMs} {t('millisecondsShort')}
                {' · '}{t('tokenUsage')}: {turn.answer.generation.totalTokens ?? t('unavailable')}
                {turn.answer.generation.fallbackReason && ` · ${t('fallbackReason')}: ${fallbackText(turn.answer.generation.fallbackReason, t)}`}
              </p>}
            </details>
          </>}
        </div>
      </article>)}
    </div>
    <form ref={composer} onSubmit={(event) => { followOutput.current = true; void ask(event) }} className={css.questionComposer}>
      <label><span className={css.srOnly}>{t('question')}</span><textarea name="question" rows={2} maxLength={500} required placeholder={t('questionPlaceholder')} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (!busy) event.currentTarget.form?.requestSubmit()
        }
      }} /></label>
      <footer><label>{t('answerMode')}<select name="mode" defaultValue="model" disabled={busy}><option value="model">{t('modelMode')}</option><option value="local">{t('localMode')}</option></select></label>
        <span className={css.composerHint}>{t('composerHint')}</span>
        {answering ? <button type="button" className={css.secondaryButton} onClick={cancel}>{t('cancelGeneration')}</button> : <button disabled={busy}>{t('ask')}</button>}
      </footer>
    </form>
  </section>
}

function RetrievalDiagnostic({ retrieval, t }: { retrieval: KnowledgeRetrievalView; t: Props['t'] }) {
  const degraded = retrieval.requestedMode === 'hybrid' && retrieval.actualMode === 'lexical'
  return <p className={css.retrievalDiagnostic} data-degraded={degraded || undefined} role="status">
    <strong>{t('retrievalMode')}: {retrievalModeText(retrieval.actualMode, t)}</strong>
    {retrieval.semanticIndexRevision !== null && <> · {t('semanticIndexRevision')}: {retrieval.semanticIndexRevision}</>}
    {' · '}{t('semanticCandidates')}: {retrieval.semanticCandidateCount}
    {degraded && <> · {t('retrievalFallback')}: {retrievalFallbackText(retrieval.fallbackReason, t)}</>}
  </p>
}


function Settings({
  current, modelSettings, modelTest, semanticStatus, busy, saveGeneration, testGeneration,
  rebuildIndex, cancelIndex, clearIndex, changeStatus, exportBackup, remove, t,
}: {
  current: KnowledgeBaseView
  modelSettings: KnowledgeModelSettingsValue | null
  modelTest: KnowledgeModelTestValue | null
  semanticStatus: KnowledgeSemanticIndexStatusValue | null
  busy: boolean
  saveGeneration: (event: FormEvent<HTMLFormElement>) => Promise<void>
  testGeneration: () => Promise<void>
  rebuildIndex: () => Promise<void>
  cancelIndex: () => void
  clearIndex: () => Promise<void>
  changeStatus: (status: 'active' | 'archived') => Promise<void>
  exportBackup: (complete?: boolean) => Promise<void>
  remove: (event: FormEvent<HTMLFormElement>) => Promise<void>
  t: Props['t']
}) {
  return <div className={css.settingsGrid}>
    {semanticStatus && <section className={`${css.panel} ${css.semanticSettings}`}>
      <h2>{t('semanticIndex')}</h2><p className={css.muted}>{t('semanticIndexDescription')}</p>
      <dl className={css.semanticFacts}>
        <div><dt>{t('retrievalMode')}</dt><dd>{retrievalModeText(semanticStatus.configuredMode, t)}</dd></div>
        <div><dt>{t('indexState')}</dt><dd>{semanticIndexStateText(semanticStatus.state, t)}</dd></div>
        <div><dt>{t('indexCoverage')}</dt><dd>{Math.round(semanticStatus.coverage * 100)}% ({semanticStatus.indexedChunkCount}/{semanticStatus.sourceChunkCount})</dd></div>
        <div><dt>{t('semanticIndexRevision')}</dt><dd>{semanticStatus.indexRevision ?? t('none')} / {semanticStatus.sourceRevision}</dd></div>
        <div><dt>{t('embeddingModel')}</dt><dd>{semanticStatus.model ?? t('unavailable')}</dd></div>
        <div><dt>{t('minimumScore')}</dt><dd>{semanticStatus.minimumScore ?? t('unavailable')}</dd></div>
      </dl>
      {semanticStatus.modelRevision && <p className={css.modelRevision}>{t('modelRevision')}: <code>{semanticStatus.modelRevision}</code></p>}
      <div className={css.rowActions}>
        <button type="button" disabled={busy || semanticStatus.state === 'disabled'} onClick={() => { void rebuildIndex() }}>{t('rebuildSemanticIndex')}</button>
        {semanticStatus.state === 'building' && <button type="button" onClick={cancelIndex}>{t('cancelIndexBuild')}</button>}
        <button type="button" disabled={busy || semanticStatus.state === 'disabled' || semanticStatus.indexedChunkCount === 0} onClick={() => { void clearIndex() }}>{t('clearSemanticIndex')}</button>
      </div>
    </section>}
    {modelSettings && <section className={`${css.panel} ${css.modelSettings}`}><form key={JSON.stringify(modelSettings.settings)} onSubmit={(event) => { void saveGeneration(event) }} className={css.form}>
      <h2>{t('generationSettings')}</h2><p className={css.muted}>{t('generationSettingsDescription')}</p>
      <label>{t('provider')}<input name="provider" defaultValue={modelSettings.settings.provider} placeholder={modelSettings.resolvedProvider} list="knowledge-provider-models" /></label>
      <label>{t('model')}<input name="model" defaultValue={modelSettings.settings.model} placeholder={modelSettings.resolvedModel} list="knowledge-models" /></label>
      <datalist id="knowledge-provider-models">{[...new Set(modelSettings.options.map(option => option.provider))].map(provider => <option key={provider} value={provider} />)}</datalist>
      <datalist id="knowledge-models">{modelSettings.options.map(option => <option key={`${option.provider}/${option.model}`} value={option.model}>{option.providerName} · {option.modelName}</option>)}</datalist>
      <div className={css.parameterGrid}>
        <label>{t('temperature')}<input type="number" name="temperature" min="0" max="2" step="0.1" defaultValue={modelSettings.settings.temperature} required /></label>
        <label>{t('maxOutputTokens')}<input type="number" name="maxOutputTokens" min="0" defaultValue={modelSettings.settings.maxOutputTokens} required /></label>
        <label>{t('maxEvidenceChars')}<input type="number" name="maxEvidenceChars" min="1000" max="100000" defaultValue={modelSettings.settings.maxEvidenceChars} required /></label>
        <label>{t('timeoutMs')}<input type="number" name="timeoutMs" min="1000" max="300000" step="1000" defaultValue={modelSettings.settings.timeoutMs} required /></label>
        <label>{t('historyMaxChars')}<input type="number" name="historyMaxChars" min="2000" max="100000" defaultValue={modelSettings.settings.historyMaxChars ?? 24000} required /></label>
        <label>{t('historySummaryChars')}<input type="number" name="historySummaryChars" min="500" max="32000" defaultValue={modelSettings.settings.historySummaryChars ?? 4000} required /></label>
        <label>{t('historyRecentTurns')}<input type="number" name="historyRecentTurns" min="1" max="20" defaultValue={modelSettings.settings.historyRecentTurns ?? 4} required /></label>
      </div>
      <p className={css.muted}>{t('resolvedModel')}: {modelSettings.resolvedProvider} / {modelSettings.resolvedModel}</p>
      <p className={css.muted}>{t('outputBudgetHint')}</p>
      <div className={css.rowActions}><button disabled={busy || !modelSettings.writable}>{t('saveModelSettings')}</button><button type="button" disabled={busy} onClick={() => { void testGeneration() }}>{t('testModel')}</button></div>
      {modelTest && <p role="status">{t('modelTestPassed')}: {modelTest.provider} / {modelTest.model} · {modelTest.latencyMs} {t('millisecondsShort')} · {modelTest.output}</p>}
    </form></section>}
    <section className={css.panel}><h2>{t('lifecycle')}</h2><p>{t('currentStatus')}: {statusText(current.status, t)}</p>
      <button type="button" disabled={busy} onClick={() => { void changeStatus(current.status === 'active' ? 'archived' : 'active') }}>
        {current.status === 'active' ? t('archive') : t('activate')}
      </button></section>
    <section className={css.panel}><h2>{t('backup')}</h2><p>{t('backupDescription')}</p><button type="button" disabled={busy} onClick={() => { void exportBackup() }}>{t('downloadBackup')}</button><button type="button" disabled={busy} onClick={() => { void exportBackup(true) }}>{t('completeBackup')}</button><p>{t('completeBackupHint')}</p></section>
    <section className={`${css.panel} ${css.danger}`}><form onSubmit={(event) => { void remove(event) }} className={css.form}><h2>{t('deleteKnowledgeBase')}</h2>
      <p>{t('deleteDescription')}</p><label>{t('confirmAlias')}<input name="expectedAlias" required autoComplete="off" /></label>
      <button disabled={busy}>{t('deleteKnowledgeBase')}</button></form></section>
  </div>
}


function download(backup: KnowledgeBackupValue): void {
  const url = URL.createObjectURL(new Blob([backup.json], { type: 'application/json' }))
  const anchor = globalThis.document.createElement('a')
  anchor.href = url; anchor.download = backup.fileName; anchor.click(); URL.revokeObjectURL(url)
}

function statusText(status: KnowledgeBaseView['status'], t: Props['t']): string {
  return status === 'active' ? t('active') : t('archived')
}

function confidenceText(confidence: KnowledgeAnswerView['confidence'], t: Props['t']): string {
  if (confidence === 'none') return t('confidenceNone')
  if (confidence === 'low') return t('confidenceLow')
  if (confidence === 'medium') return t('confidenceMedium')
  return t('confidenceHigh')
}

function answerModeText(mode: KnowledgeAnswerView['mode'], t: Props['t']): string {
  if (mode === 'model-general') return t('modelGeneral')
  if (mode === 'model-rag') return t('modelRag')
  if (mode === 'model-failed') return t('modelFailed')
  if (mode === 'model-insufficient') return t('modelInsufficient')
  return t('localExtractive')
}

function retrievalModeText(mode: KnowledgeRetrievalView['actualMode'], t: Props['t']): string {
  return mode === 'hybrid' ? t('hybridRetrieval') : t('lexicalRetrieval')
}

function retrievalFallbackText(reason: KnowledgeRetrievalView['fallbackReason'], t: Props['t']): string {
  if (reason === 'semantic-scan-limit') return t('semanticScanLimit')
  if (reason === 'semantic-disabled') return t('semanticDisabled')
  return t('semanticUnavailable')
}

function semanticIndexStateText(state: KnowledgeSemanticIndexStatusValue['state'], t: Props['t']): string {
  if (state === 'ready') return t('indexReady')
  if (state === 'building') return t('indexBuilding')
  if (state === 'stale') return t('indexStale')
  if (state === 'missing') return t('indexMissing')
  return t('indexDisabled')
}

function fallbackText(reason: NonNullable<KnowledgeAnswerView['generation']>['fallbackReason'], t: Props['t']): string {
  if (reason === 'model-timeout') return t('fallbackTimeout')
  if (reason === 'output-limit') return t('fallbackOutputLimit')
  if (reason === 'empty-output') return t('fallbackEmpty')
  if (reason === 'invalid-citations') return t('fallbackCitations')
  if (reason === 'answer-language') return t('answerLanguage')
  return t('fallbackModelError')
}

function documentStatus(document: KnowledgeDocumentView, t: Props['t']): string {
  if (document.status === 'ready') return t('ready')
  if (document.status === 'failed') return t('processingFailed')
  return `${t('processing')} ${document.progress}%`
}

function stageDescription(stage: KnowledgeDocumentDetailValue['stages'][number]['key'], t: Props['t']): string {
  if (stage === 'upload') return t('uploadDescription')
  if (stage === 'parse') return t('parseDescription')
  if (stage === 'segment') return t('segmentDescription')
  if (stage === 'index') return t('indexDescription')
  return t('completeDescription')
}

function stageStatus(status: KnowledgeDocumentDetailValue['stages'][number]['status'], t: Props['t']): string {
  if (status === 'done') return t('stageDone')
  if (status === 'running') return t('stageRunning')
  if (status === 'failed') return t('stageFailed')
  return t('stagePending')
}

function lineRange(start: number, end: number, t: Props['t']): string {
  return t('lineRange').replace('{start}', String(start)).replace('{end}', String(end))
}

function revisionShort(revision: number, t: Props['t']): string {
  return t('revisionShort').replace('{revision}', String(revision))
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KiB`
  return `${Math.round((bytes / 1_048_576) * 10) / 10} MiB`
}

const GRAPH_NODE_TYPES: readonly KnowledgeGraphNodeType[] = ['page', 'source', 'topic', 'page-type', 'section']
const GRAPH_RELATIONS: readonly KnowledgeGraphRelation[] = ['links-to', 'has-source', 'has-topic', 'has-type', 'contains', 'next']

function graphPositions(nodes: readonly KnowledgeGraphValue['nodes'][number][], mode: 'cluster' | 'structure'): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const groups = new Map(GRAPH_NODE_TYPES.map(type => [type, nodes.filter(node => node.type === type)] as const))
  const centers = [[170, 280], [170, 90], [480, 80], [780, 80], [650, 340]] as const
  for (const [typeIndex, type] of GRAPH_NODE_TYPES.entries()) {
    const group = groups.get(type) ?? []
    for (const [index, node] of group.entries()) {
      if (mode === 'structure') {
        positions.set(node.id, { x: 75 + typeIndex * 202, y: 45 + index * (470 / Math.max(1, group.length - 1)) })
        continue
      }
      if (type === 'section' && group.length > 8) {
        const columns = Math.ceil(Math.sqrt(group.length))
        const rows = Math.ceil(group.length / columns)
        positions.set(node.id, { x: 390 + (index % columns) * (490 / columns), y: 180 + Math.floor(index / columns) * (330 / rows) })
        continue
      }
      const angle = (index / Math.max(1, group.length)) * Math.PI * 2
      const radius = 25 + Math.min(92, group.length * 5) + (index % 3) * 8
      const center = centers[typeIndex] ?? [480, 280]
      positions.set(node.id, group.length === 1
        ? { x: center[0], y: center[1] }
        : { x: center[0] + Math.cos(angle) * radius, y: center[1] + Math.sin(angle) * radius })
    }
  }
  return positions
}

function graphNodeTypeText(type: KnowledgeGraphNodeType, t: Props['t']): string {
  if (type === 'page') return t('graphPage')
  if (type === 'source') return t('graphSource')
  if (type === 'topic') return t('graphTopic')
  if (type === 'page-type') return t('graphPageType')
  return t('graphSection')
}

function graphRelationText(relation: KnowledgeGraphRelation, t: Props['t']): string {
  if (relation === 'links-to') return t('relationLinksTo')
  if (relation === 'has-source') return t('relationHasSource')
  if (relation === 'has-topic') return t('relationHasTopic')
  if (relation === 'has-type') return t('relationHasType')
  if (relation === 'contains') return t('relationContains')
  return t('relationNext')
}

function shortLabel(value: string): string { return value.length > 16 ? `${value.slice(0, 15)}…` : value }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function formText(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

function formNumber(data: FormData, key: string): number {
  const value = Number(formText(data, key))
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`)
  return value
}
