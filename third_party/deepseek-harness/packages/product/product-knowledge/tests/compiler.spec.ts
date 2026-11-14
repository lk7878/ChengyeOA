import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { compilationKey, compilationRanges, compileAcademicDocument, compilerCall, numbersPreserved, validCompilation } from '../src/compiler.ts'
import { KnowledgeBaseStore } from '../src/store.ts'
import type { KnowledgeCompilerSettings, KnowledgeVisionPage } from '../src/types.ts'

const settings: KnowledgeCompilerSettings = { provider: '', model: '', visionEnabled: false, visionProvider: '', visionModel: '', maxInputChars: 1000, maxOutputTokens: 4096, timeoutMs: 1000, maxCalls: 20, renderWidth: 1200 }
const route = { provider: 'fixture', model: 'academic' }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const source = { name: 'Paper.md', sourceHash: hash('raw'), contentHash: hash('# Study\nTHUMS v4.1 used 13 conditions.\n'), content: '# Study\nTHUMS v4.1 used 13 conditions.\n' }
const fact = { statement: 'THUMS v4.1 used 13 conditions.', quote: 'THUMS v4.1 used 13 conditions.' }
const page = { title: 'Study', sections: [{ heading: 'Methods', text: fact.statement, factIds: ['F1'] }], gaps: [] }
function model(outputs: unknown[], requests: GenerateOptions[] = []): Pick<LlmRuntime, 'stream'> {
  return { async *stream(options): AsyncIterable<StreamChunk> {
    requests.push(options)
    const text = JSON.stringify(outputs.shift())
    yield { type: 'text-delta', index: 0, text: text.slice(0, 8) }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
}
const signal = () => new AbortController().signal

describe('original-language academic compilation', () => {
  it('recovers legacy stale publications without inference, but rejects source changes and revisions to used visual pages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-valid-publication-'))
    const path = join(root, 'knowledge.db')
    const store = new KnowledgeBaseStore(path)
    const db = new DatabaseSync(path)
    try {
      store.create('paper', 'Paper')
      const id = store.importMarkdown('paper', 'Paper.md', source.content).document.id
      const actual = store.compilationSource('paper', id)
      const publication = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page]),
        route, settings, actual, [], signal(), () => {})
      const vision: KnowledgeVisionPage = { page: 1, printedPage: '1', sourceHash: actual.sourceHash,
        imageHash: hash('image'), attachmentId: 'fixture', region: [0, 0, 1, 1], ...route,
        text: fact.quote, uncertainties: [], reviewed: true, totalTokens: 100 }
      const state = { ...store.compilation('paper', id), status: 'stale' as const, progress: 100, publication, vision: [vision] }
      db.prepare('INSERT INTO document_compilations(document_id, payload) VALUES (?, ?)').run(id, JSON.stringify(state))
      expect(store.compilation('paper', id)).toMatchObject({ status: 'complete', publication })
      expect((await store.askHybrid('paper', 'conditions', 4)).citations[0]?.compiledContext).toBe(fact.statement)
      expect(store.navigation('paper').documents[0]?.compilation).toEqual(publication)
      const reviewed = { ...publication, gaps: ['Check academic interpretation.'] }
      expect(store.saveCompilation('paper', id, { ...state, publication: reviewed }, actual.contentHash).status).toBe('review')
      const withVision = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, { facts: [fact], gaps: [] }, page]),
        route, settings, actual, [vision], signal(), () => {})
      expect(store.saveCompilation('paper', id, { ...state, publication: withVision }, actual.contentHash).status).toBe('complete')
      expect(store.saveCompilation('paper', id, { ...state, publication: withVision,
        vision: [{ ...vision, text: 'Corrected transcription.' }] }, actual.contentHash).status).toBe('stale')
      expect(store.navigation('paper').documents[0]?.compilation).toBeNull()
      expect((await store.askHybrid('paper', 'conditions', 4)).citations.every(item => item.compiledContext === undefined)).toBe(true)
      store.saveCompilation('paper', id, state, actual.contentHash)
      db.prepare('UPDATE documents SET source_hash = ? WHERE id = ?').run(hash('changed raw'), id)
      expect(store.compilation('paper', id).status).toBe('stale')
      db.prepare('UPDATE documents SET source_hash = ?, content_hash = ? WHERE id = ?').run(actual.sourceHash, hash('changed text'), id)
      expect(store.compilation('paper', id).status).toBe('stale')
      db.prepare('UPDATE documents SET content_hash = ? WHERE id = ?').run(actual.contentHash, id)
      db.prepare('UPDATE document_compilations SET payload = ? WHERE document_id = ?').run(JSON.stringify({ ...state,
        publication: { ...publication, facts: [{ ...publication.facts[0], quote: 'Invented' }] } }), id)
      expect(store.compilation('paper', id).status).toBe('stale')
    } finally { db.close(); store.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('covers every character including long lines and rejects invalid limits', () => {
    const content = `${'x'.repeat(2001)}\n${'y'.repeat(2400)}`
    const ranges = compilationRanges(content, 1000)
    expect(ranges.map(range => content.slice(range.startOffset, range.endOffset)).join('')).toBe(content)
    expect(ranges.every(range => range.endOffset - range.startOffset <= 1000)).toBe(true)
    expect(() => compilationRanges(content, 0)).toThrow()
  })
  it('performs source facts then synthesis, preserves language and records exact quote anchors', async () => {
    const requests: GenerateOptions[] = []
    const result = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page], requests),
      route, settings, source, [], signal(), () => {})
    expect(result.facts[0]).toMatchObject({ id: 'F1', startLine: 2, endLine: 2, startOffset: 8, quote: fact.quote })
    expect(result).toMatchObject({ title: 'Study', calls: 2, totalTokens: 300, provider: 'fixture', model: 'academic' })
    expect(validCompilation(result, source, [])).toBe(true)
    expect(requests.map(request => ({ system: request.system, content: request.messages[0]?.content }))).toMatchSnapshot()
  })
  it('keeps Chinese material in Chinese through both stages', async () => {
    const content = '# 研究\n模型使用13种工况。'
    const chinese = { ...source, content, contentHash: hash(content) }
    const result = await compileAcademicDocument(model([{ facts: [{ statement: '模型使用13种工况。', quote: '模型使用13种工况。' }], gaps: [] },
      { title: '研究', sections: [{ heading: '方法', text: '模型使用13种工况。', factIds: ['F1'] }], gaps: [] }]), route, settings, chinese, [], signal(), () => {})
    expect(result.sections[0]?.text).toBe('模型使用13种工况。')
  })
  it('anchors flattened PDF whitespace back to exact source ranges without accepting changed words', async () => {
    const content = '# Study\nTHUMS v4.1 used\n13 conditions.\n'
    const wrapped = { ...source, content, contentHash: hash(content) }
    const result = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page]),
      route, settings, wrapped, [], signal(), () => {})
    expect(result.facts[0]).toMatchObject({ quote: 'THUMS v4.1 used\n13 conditions.', startLine: 2, endLine: 3,
      sourceHash: hash('THUMS v4.1 used\n13 conditions.') })
    expect(validCompilation(result, wrapped, [])).toBe(true)
    await expect(compileAcademicDocument(model([{ facts: [{ ...fact, quote: 'THUMS v4.1 tested 13 conditions.' }], gaps: [] }]),
      route, settings, wrapped, [], signal(), () => {})).rejects.toThrow(/No source-supported/u)
  })
  it('rejects invented quotes and numeric facts without publishing empty knowledge', async () => {
    await expect(compileAcademicDocument(model([{ facts: [{ ...fact, statement: 'THUMS v7 used 99 conditions.' }], gaps: [] }]), route, settings, source, [], signal(), () => {})).rejects.toThrow(/No source-supported/u)
    expect(numbersPreserved('v7', 'v4.1')).toBe(false)
  })
  it('rejects unknown synthesis IDs and numbers instead of deleting citations', async () => {
    for (const invalid of [{ ...page, sections: [{ heading: 'Methods', text: fact.statement, factIds: ['F99'] }] },
      { ...page, sections: [{ heading: 'Methods', text: 'THUMS v7 used 99 conditions.', factIds: ['F1'] }] }]) {
      await expect(compileAcademicDocument(model([{ facts: [fact], gaps: [] }, invalid]),
        route, settings, source, [], signal(), () => {})).rejects.toThrow(/invalid fact references/u)
    }
  })
  it('stops before dispatch when complete coverage exceeds the call limit', async () => {
    const requests: GenerateOptions[] = []
    await expect(compileAcademicDocument(model([], requests), route, { ...settings, maxCalls: 2 }, { ...source, content: 'x'.repeat(4000) }, [], signal(), () => {})).rejects.toThrow(/no source was truncated/u)
    expect(requests).toHaveLength(0)
  })
  it('validates inline fact citations separately from numeric research claims, including during restore', async () => {
    const sections = [{ heading: 'Methods', text: `${fact.statement} (F1-F2) [F1, F2]`, factIds: ['F1', 'F2'] }]
    const result = await compileAcademicDocument(model([{ facts: [fact, fact], gaps: [] }, { ...page, sections }]),
      route, settings, source, [], signal(), () => {})
    expect(validCompilation(result, source, [])).toBe(true)
    for (const text of [`${fact.statement} (F13)`, `${fact.statement} (F1-F99)`, '99 conditions (F1).']) {
      const invalid = { ...page, sections: [{ ...sections[0]!, text }] }
      await expect(compileAcademicDocument(model([{ facts: [fact, fact], gaps: [] }, invalid]),
        route, settings, source, [], signal(), () => {})).rejects.toThrow(/invalid fact references/u)
      expect(validCompilation({ ...result, sections: invalid.sections }, source, [])).toBe(false)
    }
  })
  it('does not send unreviewed visual candidates as evidence', async () => {
    const vision: KnowledgeVisionPage = { page: 1, printedPage: null, sourceHash: source.sourceHash, imageHash: hash('image'), attachmentId: 'fixture', region: [0, 0, 1, 1], ...route,
      text: 'UNVERIFIED_SECRET_CANDIDATE', uncertainties: [], reviewed: false, totalTokens: 100 }
    const requests: GenerateOptions[] = []
    const result = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page], requests),
      route, settings, source, [vision], signal(), () => {})
    expect(result.gaps).toContain('Visual page 1: pending verification. ')
    expect(JSON.stringify(requests)).not.toContain('UNVERIFIED_SECRET_CANDIDATE')
    expect(compilationKey(source, settings, route, [vision]))
      .not.toBe(compilationKey(source, settings, route, [{ ...vision, reviewed: true }]))
  })
  it('never accepts a cancelled or truncated model call', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(compilerCall(model([{}]), route, settings, 'Test', [], controller.signal)).rejects.toThrow()
    await expect(compilerCall({ async *stream() { yield { type: 'text-delta', index: 0, text: '{}' }; yield { type: 'finish', reason: { kind: 'max-tokens' } } } }, route, settings, 'Test', [], signal())).rejects.toThrow(/finish normally/u)
    await expect(compilerCall({ async *stream() { yield { type: 'finish', reason: { kind: 'max-tokens' } } } }, route, settings, 'Test', [], signal())).rejects.toMatchObject({ code: 'output-limit' })
  })
  it('keeps method-section coverage for Chinese overviews after compiled facts are available', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper')
      const imported = store.importMarkdown('paper', 'Paper.md', `# Study\nABSTRACT\n${fact.quote}\nMETHODS\nA separate calibration procedure was used.\nCONCLUSIONS\nConditions must be evaluated independently.`)
      const actual = store.compilationSource('paper', imported.document.id)
      const publication = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page]),
        route, settings, actual, [], signal(), () => {})
      store.saveCompilation('paper', imported.document.id, { ...store.compilation('paper', imported.document.id),
        status: 'complete', progress: 100, publication }, actual.contentHash)
      const result = await store.askHybrid('paper', '请概括THUMS研究', 8)
      expect(result.citations.some(item => item.heading === 'methods' && item.content.includes('calibration procedure'))).toBe(true)
      expect(result.citations.some(item => item.compiledContext !== undefined)).toBe(true)
    } finally { store.close() }
  })
  it('retries one transport failure without publishing partial output or hiding the additional call', async () => {
    let attempts = 0
    const transient: Pick<LlmRuntime, 'stream'> = { async *stream() {
      attempts += 1
      if (attempts === 1) {
        yield { type: 'text-delta', index: 0, text: 'partial' }
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'offline' } } }
      } else {
        yield { type: 'text-delta', index: 0, text: '{}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    } }
    await expect(compilerCall(transient, route, settings, 'Test', [], signal()))
      .resolves.toEqual({ value: {}, totalTokens: null, calls: 2 })
    attempts = 0
    await expect(compilerCall(transient, route, { ...settings, maxCalls: 1 }, 'Test', [], signal()))
      .rejects.toMatchObject({ code: 'model-dispatch' })
    expect(attempts).toBe(1)
    await expect(compilerCall(transient, route, { ...settings, maxCalls: 0 }, 'Test', [], signal()))
      .rejects.toThrow(/call limit/u)
    expect(attempts).toBe(1)
  })
  it('persists, backs up, restores, rejects tampering, and removes derived data with its source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-compile-'))
    let store = new KnowledgeBaseStore(join(root, 'knowledge.db'))
    try {
      store.create('paper', 'Paper')
      const imported = store.importMarkdown('paper', 'Paper.md', source.content)
      const actual = store.compilationSource('paper', imported.document.id)
      const publication = await compileAcademicDocument(model([{ facts: [fact], gaps: [] }, page]),
        route, settings, actual, [], signal(), () => {})
      const state = store.compilation('paper', imported.document.id)
      const withGaps = { ...publication, gaps: ['Check original equation.'] }
      store.saveCompilation('paper', imported.document.id, { ...state, status: 'review', progress: 100, publication: withGaps }, actual.contentHash)
      const request = { ref: 'paper', documentId: imported.document.id, publicationKey: publication.cacheKey,
        publicationCreatedAt: publication.createdAt, index: 0, status: 'question' as const, note: 'Need original page 2.' }
      const reviewed = store.reviewGap(request)
      expect(reviewed.publication).toEqual(withGaps)
      expect(reviewed.gapReviews).toMatchObject([{ index: 0, status: 'question', note: request.note }])
      expect(() => store.reviewGap({ ...request, index: 1 })).toThrow(/Unknown/u)
      expect(() => store.reviewGap({ ...request, note: '' })).toThrow()
      expect(() => store.reviewGap({ ...request, note: 'x'.repeat(2001) })).toThrow()
      expect(() => store.reviewGap({ ...request, publicationCreatedAt: 'old' })).toThrow(/Publication changed/u)
      store.reviewGap({ ...request, status: 'not-applicable', note: 'Not relevant to this source.' })
      expect(store.compilation('paper', imported.document.id).gapReviews).toHaveLength(1)
      expect((await store.askHybrid('paper', 'conditions', 4)).citations[0]?.compiledContext).toBe(fact.statement)
      expect((await store.askHybrid('paper', 'Study', 4)).citations.some(item => item.compiledContext !== undefined)).toBe(false)
      const backup = store.backup('paper')
      store.close(); store = new KnowledgeBaseStore(join(root, 'knowledge.db'))
      expect(store.compilation('paper', imported.document.id).publication).toEqual(withGaps)
      expect(store.compilation('paper', imported.document.id).gapReviews?.[0]?.status).toBe('not-applicable')
      const corrupt = JSON.parse(backup.json) as {
        knowledgeBase: { alias: string }
        documents: Array<{ compilation: { publication: { facts: Array<{ quote: string }> } } }>
      }
      corrupt.knowledgeBase.alias = 'corrupt'
      corrupt.documents[0]!.compilation.publication.facts[0]!.quote = 'Invented'
      expect(() => store.restore(JSON.stringify(corrupt))).toThrow(/compilation-source/u)
      expect(store.list().some(item => item.alias === 'corrupt')).toBe(false)
      store.delete('paper', 'paper')
      store.restore(backup.json)
      const restoredId = store.documents('paper')[0]!.id
      expect(store.compilation('paper', restoredId)).toMatchObject({ status: 'review', rawAvailable: false, publication: withGaps,
        gapReviews: [{ index: 0, status: 'not-applicable' }] })
      store.deleteDocument('paper', restoredId)
      expect(() => store.compilation('paper', restoredId)).toThrow(/not found/u)
    } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
  })
})
