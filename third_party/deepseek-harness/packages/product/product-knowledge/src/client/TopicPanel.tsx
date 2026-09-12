import { useEffect, useRef, useState } from 'react'
import type { KnowledgeDocumentView, KnowledgeTopic, KnowledgeTopicRequest } from '../types.ts'
import type { KnowledgeLocaleKey } from './locales.ts'
import css from './KnowledgeBaseCenter.module.css'

export interface TopicActions {
  topics: (ref: string) => Promise<KnowledgeTopic[]>
  previewTopic: (request: KnowledgeTopicRequest, signal: AbortSignal) => Promise<KnowledgeTopic>
  saveTopic: (ref: string, topic: KnowledgeTopic) => Promise<KnowledgeTopic>
}

/** Explicit preview/publication keeps human notes separate from model-generated comparisons. */
export function TopicPanel({ actions, base, documents, disabled, t }: {
  actions: TopicActions
  base: string
  documents: readonly KnowledgeDocumentView[]
  disabled: boolean
  t: (key: KnowledgeLocaleKey) => string
}) {
  const [topics, setTopics] = useState<KnowledgeTopic[]>([])
  const [draft, setDraft] = useState<KnowledgeTopic | null>(null)
  const [title, setTitle] = useState('')
  const [selection, setSelection] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    let active = true
    alive.current = true
    void actions.topics(base).then((value) => { if (active) setTopics(value) })
      .catch((cause: unknown) => { if (active) setError(String(cause)) })
    return () => { active = false; alive.current = false; abort.current?.abort() }
  }, [actions.topics, base])
  const preview = async () => {
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(null)
    try {
      const value = await actions.previewTopic({ ref: base, title, documentIds: selection,
        ...(draft && draft.version > 0 ? { id: draft.id } : {}),
      }, controller.signal)
      if (alive.current && !controller.signal.aborted) setDraft({ ...value, notes: draft?.notes ?? value.notes })
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(String(cause)) }
    finally { if (alive.current) setBusy(false); abort.current = null }
  }
  const publish = async () => {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const saved = await actions.saveTopic(base, draft)
      if (alive.current) { setDraft(saved); setTopics(rows => [...rows.filter(row => row.id !== saved.id), saved]) }
    } catch (cause) { if (alive.current) setError(String(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className={css.panel}>
    <h2>{t('crossPaperTopics')}</h2><p>{t('topicHint')}</p>
    {error && <p role="alert">{error}</p>}
    <div>{topics.map(topic => <button key={topic.id} disabled={busy} onClick={() => {
      setDraft(topic); setTitle(topic.title); setSelection([...new Set(topic.sources.map(source => source.documentId))])
    }}>{topic.title}{topic.stale ? ` · ${t('sourceChanged')}` : ''}</button>)}</div>
    <button disabled={busy} onClick={() => { setDraft(null); setTitle(''); setSelection([]) }}>{t('newTopic')}</button>
    <label>{t('topicTitle')}<input value={title} maxLength={200} disabled={busy || disabled}
      onChange={(event) => { setTitle(event.target.value) }} /></label>
    <fieldset disabled={busy || disabled}><legend>{t('topicPapers')}</legend>
      {documents.filter(document => document.status === 'ready').map(document => <label key={document.id}>
        <input type="checkbox" checked={selection.includes(document.id)} onChange={(event) => {
          setSelection(ids => event.target.checked ? [...ids, document.id] : ids.filter(id => id !== document.id))
        }} />{document.name}
      </label>)}
    </fieldset>
    <button disabled={busy || disabled || !title.trim() || selection.length < 2 || selection.length > 12} onClick={() => { void preview() }}>{t('previewTopic')}</button>
    {busy && <button onClick={() => abort.current?.abort()}>{t('cancelGeneration')}</button>}
    {draft && <article>
      <h3>{draft.title}</h3>{draft.stale && <p role="status">{t('sourceChanged')}</p>}
      {draft.claims.map((claim, index) => <p key={index}><strong>{t(claim.kind)}</strong>: {claim.text} {claim.evidenceIds.map(id => `[${id}]`).join(' ')}</p>)}
      {draft.sources.map(source => <details key={source.id}>
        <summary>[{source.id}] {source.documentName} · {t('lineRange')
          .replace('{start}', String(source.startLine)).replace('{end}', String(source.endLine))}</summary>
        <blockquote>{source.content}</blockquote>
      </details>)}
      {draft.previousText && <details><summary>{t('previousTopic')}</summary><pre>{draft.previousText}</pre></details>}
      <label>{t('topicNotes')}<textarea value={draft.notes} maxLength={20000} disabled={busy || disabled}
        onChange={(event) => { setDraft({ ...draft, notes: event.target.value }) }} /></label>
      <button disabled={busy || disabled || draft.stale} onClick={() => { void publish() }}>{t('publishTopic')}</button>
    </article>}
  </section>
}
