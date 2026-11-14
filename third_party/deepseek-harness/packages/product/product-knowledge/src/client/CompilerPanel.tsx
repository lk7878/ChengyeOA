/** Explicit academic compilation and visual review within the existing Harness Wiki workspace. */
import { useEffect, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeCompilationValue, KnowledgeCompilerSettings, KnowledgeCompilerSettingsValue, KnowledgeCompileRequest, KnowledgeDocumentDetailRequest, KnowledgeGapReviewRequest } from '../types.ts'
import css from './KnowledgeBaseCenter.module.css'

/** Native Client operations for compilation, role settings and explicit visual review. */
export interface CompilerActions {
  readonly compilerSettings: () => Promise<KnowledgeCompilerSettingsValue>
  readonly saveCompilerSettings: (settings: KnowledgeCompilerSettings) => Promise<KnowledgeCompilerSettingsValue>
  readonly compilation: (request: KnowledgeDocumentDetailRequest) => Promise<KnowledgeCompilationValue>
  readonly compileDocument: (request: KnowledgeCompileRequest, signal: AbortSignal) => Promise<KnowledgeCompilationValue>
  readonly reviewVision: (request: KnowledgeDocumentDetailRequest & { page: number; text: string }) => Promise<KnowledgeCompilationValue>
  readonly reviewGap: (request: KnowledgeGapReviewRequest) => Promise<KnowledgeCompilationValue>
}
type Locale = Pick<PropsLocale<'product.knowledge'>, 't'>

/** Role-specific settings, without duplicating provider credentials. */
export function CompilerSettingsPanel({ actions, t }: { actions: CompilerActions } & Locale) {
  const [value, setValue] = useState<KnowledgeCompilerSettingsValue | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; void actions.compilerSettings().then((result) => { if (live) setValue(result) }, () => { if (live) setError(t('compilerLoadFailed')) }); return () => { live = false } }, [actions.compilerSettings, t])
  if (value === null) return <p role="status">{error || t('loading')}</p>
  const settings = value.settings
  const update = (next: Partial<KnowledgeCompilerSettings>) =>{  setValue({ ...value, settings: { ...settings, ...next } }) }
  const route = (provider: string, model: string) => provider ? JSON.stringify([provider, model]) : ''
  const selectRoute = (text: string, vision: boolean) => {
    const [provider, model] = text ? JSON.parse(text) as [string, string] : ['', '']
    update(vision ? { visionProvider: provider, visionModel: model } : { provider, model })
  }
  return <section className={css.panel}>
    <h3>{t('compilerSettingsTitle')}</h3><p>{t('compilerSettingsDescription')}</p>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(''); void actions.saveCompilerSettings(settings).then(setValue, () =>{  setError(t('compilerSaveFailed')) }).finally(() =>{  setBusy(false) }) }}>
      <label>{t('compilerModel')}<select value={route(settings.provider, settings.model)} onChange={(event) =>{  selectRoute(event.currentTarget.value, false) }}>
        <option value="">{t('compilerInherit')}</option>{value.options.map(option => <option key={route(option.provider, option.model)} value={route(option.provider, option.model)}>{option.providerName} / {option.modelName}</option>)}
      </select></label>
      <p>{value.resolvedProvider} / {value.resolvedModel}</p>
      <label className={css.inlineCheck}><input type="checkbox" checked={settings.visionEnabled} onChange={(event) =>{  update({ visionEnabled: event.currentTarget.checked }) }} />{t('compilerVisionEnable')}</label>
      <label>{t('compilerVisionModel')}<select value={route(settings.visionProvider, settings.visionModel)} onChange={(event) =>{  selectRoute(event.currentTarget.value, true) }}>
        <option value="">{t('compilerVisionSelect')}</option>{value.options.filter(option => option.imageInput).map(option => <option key={route(option.provider, option.model)} value={route(option.provider, option.model)}>{option.providerName} / {option.modelName}</option>)}
      </select></label>
      <p>{t('compilerVisionCatalogHint')}</p>
      {(['maxInputChars', 'maxOutputTokens', 'timeoutMs', 'maxCalls', 'renderWidth'] as const).map(key => <label key={key}>{t(`compiler_${key}`)}<input type="number" required value={settings[key]} onChange={(event) =>{  update({ [key]: event.currentTarget.valueAsNumber }) }} /></label>)}
      <button type="submit" disabled={busy || !value.writable}>{t('compilerSave')}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}

/** Persisted original-language paper page, manual compilation and page-level review. */
export function CompilerPanel({ actions, source, t, externalBusy = false, onRunningChange }: {
  actions: CompilerActions
  source: KnowledgeDocumentDetailRequest
  externalBusy?: boolean
  onRunningChange?: (running: boolean) => void
} & Locale) {
  const [state, setState] = useState<KnowledgeCompilationValue | null>(null)
  const [pages, setPages] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [pollFailed, setPollFailed] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const gapsPanel = useRef<HTMLDetailsElement>(null)
  const abort = useRef<AbortController | null>(null)
  const live = useRef(true)
  const running = busy || state?.status === 'running'
  const locked = running || reviewBusy || externalBusy
  useEffect(() => {
    onRunningChange?.(running || reviewBusy)
    return () => { onRunningChange?.(false) }
  }, [running, reviewBusy, onRunningChange])
  const publication = state?.publication
  const reviews = state?.gapReviews ?? []
  const pending = (publication?.gaps.length ?? 0) - reviews.filter(item => item.status !== 'question').length
  useEffect(() => {
    live.current = true
    void actions.compilation(source).then((value) => { if (live.current) { setState(value); setPages(value.suggestedPages.join(', ')) } }, () => { if (live.current) setError(t('compilerLoadFailed')) })
    return () => { live.current = false; abort.current?.abort() }
  }, [actions.compilation, source.ref, source.documentId, t, externalBusy])
  useEffect(() => {
    if (!running) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = abort.current
    const poll = async () => {
      try {
        const value = await actions.compilation(source)
        if (!active || controller !== abort.current) return
        setState(value); setPollFailed(false)
      } catch { if (active && controller === abort.current) setPollFailed(true) }
      if (active) timer = setTimeout(() => { void poll() }, 2000)
    }
    timer = setTimeout(() => { void poll() }, 2000)
    return () => { active = false; clearTimeout(timer) }
  }, [running, busy, actions.compilation, source.ref, source.documentId])
  const run = async (operation: KnowledgeCompileRequest['operation'], force = false) => {
    const controller = new AbortController(); abort.current = controller
    setBusy(true); setError(''); setPollFailed(false)
    const selectedPages = pages.split(/[，,\s]+/u).filter(Boolean).map(Number)
    try {
      const value = await actions.compileDocument({ ...source, operation, pages: selectedPages, force }, controller.signal)
      if (live.current) setState(value)
    } catch { if (live.current) setError(controller.signal.aborted ? t('compilerCancelled') : t('compilerFailed')) }
    finally {
      if (live.current) {
        setBusy(false); abort.current = null
        void actions.compilation(source).then((value) => { if (live.current) setState(value) }, () => {})
      }
    }
  }
  return <section className={css.panel}>
    <h3>{t('compilerTitle')}</h3><p>{t('compilerDescription')}</p>
    <label className={css.inlineCheck}><input type="checkbox" checked={consent} onChange={(event) =>{  setConsent(event.currentTarget.checked) }} />{t('compilerConsent')}</label>
    <div className={css.rowActions}>
      <button type="button" disabled={locked || !consent} onClick={() => { void run('compile') }}>{t('compilerRun')}</button>
      <button type="button" disabled={locked || !consent} onClick={() => { void run('compile', true) }}>{t('compilerRerun')}</button>
      {busy && <button type="button" onClick={() => abort.current?.abort()}>{t('compilerCancel')}</button>}
    </div>
    {state && <p role="status">{t(`compilerStatus_${state.status === 'review' && publication ? 'complete' : state.status}`)} · {state.progress}%</p>}
    {publication && <div className={css.rowActions}>
      <p>{t('compilerReviewRemaining')}: {pending} / {publication.gaps.length}</p>
      {publication.gaps.length > 0 && <button type="button" onClick={() => {
        if (gapsPanel.current) { gapsPanel.current.open = true; gapsPanel.current.scrollIntoView({ block: 'start' }); gapsPanel.current.focus() }
      }}>{t('compilerReviewGo')}</button>}
    </div>}
    {state?.publication && state.status !== 'stale' && <p>{t('compilerReuseHint')}</p>}
    <p>{t('compilerRecompileCost')}</p>
    {running && <p role="note">{t('compilerProgressHint')}</p>}
    {running && pollFailed && <p role="alert">{t('compilerProgressUnavailable')}</p>}
    {(error || state?.error) && <p role="alert">{error || (state?.error === 'output-limit' ? t('compilerOutputLimit')
      : state?.error === 'timeout-or-cancelled' ? t('compilerTimeout') : t('compilerFailed'))}</p>}
    <details><summary>{t('compilerVisionTitle')}</summary>
      <p>{t('compilerVisionDescription')}</p>
      <label>{t('compilerPages')}<input value={pages} onChange={(event) =>{  setPages(event.currentTarget.value) }} /></label>
      <button type="button" disabled={locked || !consent || !state?.rawAvailable || pages.trim() === ''} onClick={() => { void run('vision') }}>{t('compilerVisionRun')}</button>
      {state && !state.rawAvailable && <p>{t('compilerRawMissing')}</p>}
      {state?.vision.map(page => <details key={page.page}><summary>{t('compilerPage')} {page.page} · {page.reviewed ? t('compilerReviewed') : t('compilerPending')}</summary>
        <p>{page.provider} / {page.model} · {page.imageHash.slice(0, 12)}</p>
        {page.uncertainties.map((item, index) => <p key={index}>{item}</p>)}
        <form className={css.form} onSubmit={(event) => {
          event.preventDefault()
          const text = new FormData(event.currentTarget).get('text')
          if (typeof text !== 'string') return
          setBusy(true)
          void actions.reviewVision({ ...source, page: page.page, text }).then(setState,
            () => { setError(t('compilerFailed')) }).finally(() => { setBusy(false) })
        }}>
          <label>{t('compilerReviewText')}<textarea name="text" rows={12} defaultValue={page.text} /></label>
          <label className={css.inlineCheck}><input type="checkbox" required />{t('compilerReviewConfirm')}</label>
          <button type="submit" disabled={locked}>{t('compilerReviewSave')}</button>
        </form>
      </details>)}
    </details>
    {state?.publication && <article>
      <h3>{state.publication.title}</h3><p>{t('compilerMachineNotice')}</p>
      <p>{state.publication.provider} / {state.publication.model} · {state.publication.createdAt} · {state.publication.calls} {t('compilerCalls')} · {state.publication.totalTokens ?? '—'} {t('compilerTokens')}</p>
      {state.publication.sections.map((section, index) => <section key={index}><h4>{section.heading}</h4><MarkdownText text={section.text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
        <details><summary>{t('sourceEvidence')}</summary>{section.factIds.map((id) => {
          const fact = state.publication?.facts.find(item => item.id === id)
          return fact && <blockquote key={id}><small>{id} · {fact.visionPage === null ? `${fact.startLine}–${fact.endLine}` : `${t('compilerPage')} ${fact.visionPage}`} · {fact.sourceHash.slice(0, 12)}</small><p>{fact.quote}</p></blockquote>
        })}</details>
      </section>)}
      <details><summary>{t('compilerCoverage')} · {state.publication.coverage.length}</summary><pre>{JSON.stringify(state.publication.coverage, null, 2)}</pre></details>
      {state.publication.gaps.length > 0 && <details ref={gapsPanel} tabIndex={-1} open><summary>{t('compilerGaps')}</summary>
        <p>{t('compilerGapNotice')}</p>
        <p>{t('compilerReviewRemaining')}: {pending} / {state.publication.gaps.length}</p>
        {state.publication.gaps.map((gap, index) => {
          const review = reviews.find(item => item.index === index)
          return <details key={`${state.publication?.createdAt}-${index}`} className={css.panel}>
            <summary>{t('compilerGapItem')} {index + 1} · {t(`compilerGap_${review?.status ?? 'pending'}`)}</summary>
            <p>{gap}</p>
            <form key={review?.reviewedAt ?? 'pending'} className={css.form} aria-label={`${t('compilerGapItem')} ${index + 1}`} onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const note = data.get('note')
              const current = state.publication
              if (!current || typeof note !== 'string') return
              setReviewBusy(true); setError('')
              void actions.reviewGap({ ...source, publicationKey: current.cacheKey, publicationCreatedAt: current.createdAt,
                index, status: data.get('status') as KnowledgeGapReviewRequest['status'], note }).then(
                (value) => { if (live.current) setState(value) },
                () => { if (live.current) setError(t('compilerGapSaveFailed')) },
              ).finally(() => { if (live.current) setReviewBusy(false) })
            }}>
              <label>{t('compilerGapDecision')}<select name="status" defaultValue={review?.status ?? 'question'} disabled={locked || state.status === 'stale'}>
                {(['verified', 'question', 'not-applicable'] as const).map(status => <option key={status} value={status}>{t(`compilerGap_${status}`)}</option>)}
              </select></label>
              <label>{t('compilerGapNote')}<textarea name="note" required maxLength={2000} rows={3} defaultValue={review?.note ?? ''} disabled={locked || state.status === 'stale'} /></label>
              <button type="submit" disabled={locked || state.status === 'stale'}>{t('compilerGapSave')}</button>
              {review && <p>{t('compilerGapSaved')}: <time dateTime={review.reviewedAt}>{review.reviewedAt}</time></p>}
            </form>
          </details>
        })}
      </details>}
    </article>}
  </section>
}
