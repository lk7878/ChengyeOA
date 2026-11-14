import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { KnowledgeBaseStore } from '../src/store.ts'
import { generateKnowledgeAnswer } from '../src/rag.ts'
import { compileAcademicDocument } from '../src/compiler.ts'
import { evaluateModelCases } from '../src/evaluation.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

describe('knowledge reliability regressions', () => {
  it('preserves cross-paper notes, history, pending jobs and checkpoints in an atomic full restore', async () => {
    const store = new KnowledgeBaseStore(':memory:'); const restored = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper')
      const a = store.importMarkdown('paper', 'A.md', 'The experiment used 10 samples.').document
      const b = store.importMarkdown('paper', 'B.md', 'The experiment used 20 samples.').document
      const sources = store.topicSources('paper', 'samples', [a.id, b.id])
      const topic = store.saveTopic('paper', { id: randomUUID(), title: 'Samples', revision: store.list()[0]!.revision,
        version: 0, notes: 'Different populations; do not merge.', previousText: '', stale: false, sources,
        claims: [{ text: 'Sample counts differ: 10 and 20.', kind: 'conflict', evidenceIds: [1, 2] }] })
      expect(() => store.saveTopic('paper', { ...topic, version: 0 })).toThrow(/edited elsewhere/u)
      expect(() => store.saveTopic('paper', { ...topic, claims: [{ text: '999 samples.', kind: 'consensus', evidenceIds: [1, 2] }] })).toThrow(/unsupported numbers/u)
      store.saveCompilerCheckpoint('paper', a.id, { key: 'source-bound', completed: 0, facts: [], gaps: [], calls: 1, totalTokens: null })
      store.queue('paper', [a.id])
      await store.importFile('paper', 'Pending.txt', Buffer.from('Pending source').toString('base64'), true)
      for (let index = 0; index < 55; index++) store.finishTurn(store.beginTurn('paper', `Question ${index}`), 'complete', store.ask('paper', 'samples'))
      const recent = store.conversation('paper')
      expect(recent.turns).toHaveLength(50); expect(recent.hasMore).toBe(true)
      expect(store.conversation('paper', recent.turns[0]!.id).turns).toHaveLength(5)
      restored.restore(store.backup('paper', true).json)
      expect(restored.topics('paper')[0]?.notes).toBe(topic.notes)
      const queue = restored.queue('paper')
      expect(queue.imports).toHaveLength(1); expect(queue.compilations).toHaveLength(1)
      expect(restored.compilerCheckpoint('paper', queue.compilations[0]!)).toMatchObject({ calls: 1, totalTokens: null })
      expect(restored.conversation('paper').turns[0]?.answer?.citations[0]?.documentId).not.toBe(a.id)
      await restored.reprocess('paper', queue.imports[0]!)
      expect(restored.topics('paper')[0]?.stale).toBe(true)
      expect(() => restored.saveTopic('paper', restored.topics('paper')[0]!)).toThrow(/Sources|sources/u)
    } finally { store.close(); restored.close() }
  })

  it('leaves semantic accuracy unscored even when a live-model-shaped answer retrieves the expected source', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper'); store.importMarkdown('paper', 'A.md', 'There are 10 samples.')
      const report = await evaluateModelCases([{ id: 'samples', question: 'samples', expectedAnswer: '10', expectedDocumentNames: ['A.md'], unanswerable: false }],
        1, async () => ({ ...store.ask('paper', 'samples'), mode: 'model-rag', answer: 'There are 999 samples [1].' }), new AbortController().signal)
      expect(report.meanRetrievalRecall).toBe(1)
      expect(report.semanticAccuracy).toBeNull()
      expect(report.results[0]?.humanReview.answerCorrect).toBeNull()
      expect(report.results[0]?.answer.answer).toContain('999')
    } finally { store.close() }
  })

  it('retrieves late exact Chinese matches and bounds long Unicode lines without losing tail evidence', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper')
      store.importMarkdown('paper', 'Paper.md', Array.from({ length: 22 }, (_, index) =>
        `# Section ${index}\n${index === 21 ? '胸部损伤风险函数使用概率模型标定。' : '胸部的一般背景。'}`).join('\n\n'))
      expect(store.search('paper', '胸部损伤风险函数')[0]?.content).toContain('概率模型')
      store.importMarkdown('paper', 'Long.md', `${'🧪研究 '.repeat(2000)}末尾独特证据`)
      const hit = store.search('paper', '末尾独特证据')[0]!
      expect(hit.content.length).toBeLessThanOrEqual(1600)
      expect(hit.content).not.toMatch(/[\uD800-\uDBFF]$/u)
      expect(hit.content).toContain('末尾独特证据')
    } finally { store.close() }
  })

  it('refuses oversized logical exports and restores a complete large archive with original bytes', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    const restored = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper')
      for (let index = 0; index < 5; index++) store.importMarkdown('paper', `doc${index}.md`, 'a'.repeat(1610000))
      expect(() => store.backup('paper')).toThrow(/complete backup/u)
      const backup = store.backup('paper', true)
      restored.restore(backup.json)
      const doc = restored.documents('paper')[0]!
      expect(restored.detail('paper', doc.id).reprocessable).toBe(true)
      expect((await restored.reprocess('paper', doc.id)).document.status).toBe('ready')
      const corrupt = JSON.parse(backup.json) as { sha256: string; data: string; format: string }
      corrupt.sha256 = '0'.repeat(64)
      expect(() => restored.restore(JSON.stringify(corrupt))).toThrow(/complete-payload/u)
    } finally { store.close(); restored.close() }
  }, 20000)

  it('retains answers and queued raw imports across restart and marks changed sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wiki-durable-'))
    let store = new KnowledgeBaseStore(join(dir, 'knowledge.db'))
    try {
      store.create('paper', 'Paper'); store.create('other', 'Other')
      const doc = store.importMarkdown('paper', 'Paper.md', '# Samples\nThe experiment used 10 samples.').document
      const turn = store.beginTurn('paper', 'samples')
      store.finishTurn(turn, 'complete', store.ask('paper', 'samples'))
      store.beginTurn('paper', 'interrupted')
      const queued = await store.importFile('paper', 'queued.txt', Buffer.from('Queued scientific source.').toString('base64'), true)
      store.close(); store = new KnowledgeBaseStore(join(dir, 'knowledge.db'))
      expect(store.conversation('paper').turns.map(row => row.status)).toEqual(['complete', 'cancelled'])
      expect(store.conversation('other').turns).toEqual([])
      expect(store.queue('paper').imports).toEqual([queued.document.id])
      await store.reprocess('paper', queued.document.id)
      expect(store.queue('paper').imports).toEqual([])
      store.deleteDocument('paper', doc.id)
      expect(store.conversation('paper').turns[0]).toMatchObject({ sourceChanged: true, answer: { citations: [{ content: '# Samples\nThe experiment used 10 samples.' }] } })
      const restored = new KnowledgeBaseStore(':memory:')
      try { restored.restore(store.backup('paper', true).json); expect(restored.conversation('paper').turns).toHaveLength(2) }
      finally { restored.close() }
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('rebuilds legacy derived chunks without changing source bytes or content revisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wiki-migration-'))
    const path = join(dir, 'knowledge.db')
    let store = new KnowledgeBaseStore(path)
    try {
      store.create('paper', 'Paper'); store.importMarkdown('paper', 'Long.md', 'x'.repeat(10000))
      const revision = store.list()[0]!.revision
      store.close()
      const db = new DatabaseSync(path); db.exec('PRAGMA user_version = 4'); db.close()
      store = new KnowledgeBaseStore(path)
      expect(store.list()[0]!.revision).toBe(revision)
      expect(store.documents('paper')[0]!.chunkCount).toBeGreaterThan(1)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects a fabricated sample count despite its valid citation number', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper'); store.importMarkdown('paper', 'Paper.md', 'The experiment used 10 samples.')
      let calls = 0
      const model = { async *stream(): AsyncIterable<StreamChunk> {
        calls++
        yield { type: 'text-delta', index: 0, text: calls === 1 ? 'The experiment used 999 samples [1].' : JSON.stringify({ status: 'answered', answer: 'The experiment used 999 samples [1].' }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } }
      const result = await generateKnowledgeAnswer(model, { provider: 'fixture', model: 'fixture' }, store.ask('paper', 'samples'),
        { maxEvidenceChars: 4000, maxOutputTokens: 400, timeoutMs: 1000, answerRepair: { maxTokens: 128 } })
      expect(result.mode).toBe('model-failed'); expect(result.answer).not.toContain('999'); expect(calls).toBe(2)
    } finally { store.close() }
  })

  it('reuses validated compiler batches after synthesis failure', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('paper', 'Paper')
      const doc = store.importMarkdown('paper', 'Paper.md', 'The experiment used 10 samples.').document
      const source = store.compilationSource('paper', doc.id)
      let extracts = 0; let synthesizes = 0
      const model = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        let output
        if (options.system?.startsWith('Extract')) { extracts++; output = { facts: [{ statement: source.content, quote: source.content }], gaps: [] } }
        else { synthesizes++; output = synthesizes === 1 ? {} : { title: 'Samples', sections: [{ heading: 'Results', text: source.content, factIds: ['F1'] }], gaps: [] } }
        yield { type: 'text-delta', index: 0, text: JSON.stringify(output) }; yield { type: 'finish', reason: { kind: 'stop' } }
      } }
      const settings = { provider: '', model: '', visionEnabled: false, visionProvider: '', visionModel: '', maxInputChars: 1000, maxOutputTokens: 4000, timeoutMs: 1000, maxCalls: 20, renderWidth: 1200 }
      const checkpoints = { read: () => store.compilerCheckpoint('paper', doc.id), save: (value: NonNullable<ReturnType<typeof store.compilerCheckpoint>>) => { store.saveCompilerCheckpoint('paper', doc.id, value) } }
      const run = () => compileAcademicDocument(model, { provider: 'fixture', model: 'fixture' }, settings, source, [], new AbortController().signal, () => {}, checkpoints)
      await expect(run()).rejects.toThrow()
      expect((await run()).facts).toHaveLength(1); expect(extracts).toBe(1); expect(synthesizes).toBe(2)
    } finally { store.close() }
  })
})
