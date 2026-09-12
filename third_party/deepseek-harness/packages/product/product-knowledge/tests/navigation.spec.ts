import { describe, expect, it } from 'vitest'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { compileAcademicDocument } from '../src/compiler.ts'
import { navigateKnowledge } from '../src/navigation.ts'
import { generateKnowledgeAnswer } from '../src/rag.ts'
import { KnowledgeBaseStore } from '../src/store.ts'
import type { KnowledgeAnswerView, KnowledgeCompilerSettings } from '../src/types.ts'

const settings: KnowledgeCompilerSettings = { provider: 'fixture', model: 'strong', visionEnabled: false,
  visionProvider: '', visionModel: '', maxInputChars: 1000, maxOutputTokens: 8192, timeoutMs: 2000, maxCalls: 20, renderWidth: 1200 }
const config = { maxInputChars: 160000, maxTokens: 8192, timeoutMs: 2000 }
const route = { provider: 'fixture', model: 'strong' }
const signal = () => new AbortController().signal
const local: KnowledgeAnswerView = { question: '比较了哪些模型，是否重新开发了风险函数，阈值是多少？', status: 'no-evidence',
  requestedMode: 'model', mode: 'local-extractive', confidence: 'none', answer: '', citations: [], generation: null }
function model(outputs: unknown[], requests: GenerateOptions[] = []): Pick<LlmRuntime, 'stream'> {
  return { async *stream(options) {
    requests.push(options)
    const value = outputs.shift()
    yield { type: 'block-end', index: 0, block: { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
}
async function fixture() {
  const store = new KnowledgeBaseStore(':memory:')
  store.create('papers', 'Papers')
  for (const [name, fact] of [['A', 'THUMS v7.1 and VIVA+ v2.0.0 were compared.'], ['B', 'THUMS v4.1 was calibrated separately.']] as const) {
    const method = 'The extracted strain values were used in the IRF developed by Larsson et al.'
    const document = store.importMarkdown('papers', `${name}.md`, `# Paper ${name}\n## Summary\n${fact}\n## Methods\n${method}\n## Appendix\nThreshold is ${name === 'A' ? '0.8' : '9.9'}.`).document
    const source = store.compilationSource('papers', document.id)
    const publication = await compileAcademicDocument(model([
      { facts: [{ statement: fact, quote: fact }, { statement: method, quote: method }], gaps: [] },
      { title: `Paper ${name}`, sections: [{ heading: 'Models', text: fact, factIds: ['F1'] },
        { heading: 'Methods', text: method, factIds: ['F2'] }], gaps: [] }]),
    route, settings, source, [], signal(), () => {})
    store.saveCompilation('papers', document.id, { ...store.compilation('papers', document.id), status: 'complete', progress: 100, publication }, source.contentHash)
  }
  const snapshot = store.navigation('papers')
  const source = { ...snapshot, documents: [...snapshot.documents].sort((a, b) => a.name.localeCompare(b.name)) }
  return { store, source }
}
const plan = { needs: [
  { question: '模型版本？', facts: [{ document: 'D1', id: 'F1' }], lookup: null },
  { question: '函数来源？', facts: [{ document: 'D1', id: 'F2' }], lookup: null },
  { question: '阈值？', facts: [], lookup: { document: 'D1', query: 'Threshold' } },
] }
const review = { needs: [{ id: 1, evidenceIds: [1] }, { id: 2, evidenceIds: [2] }, { id: 3, evidenceIds: [3] }] }

describe('compiled-knowledge source navigation', () => {
  it('reads full knowledge and resolves original method facts plus document-local missing details', async () => {
    const { store, source } = await fixture()
    try {
      const requests: GenerateOptions[] = []
      const answer = await navigateKnowledge(model([plan, review], requests), route, settings, config, source, local, 12000, signal())
      expect(answer.knowledgeNavigation).toMatchObject({ status: 'applied', calls: 2, lookupCount: 1, totalTokens: 40 })
      expect(answer.citations.map(c => c.content).join('\n')).toContain('developed by Larsson')
      expect(answer.citations.map(c => c.content).join('\n')).toContain('Threshold is 0.8')
      expect(answer.citations.every(c => c.documentName === 'A.md')).toBe(true)
      expect(requests.map(r => ({ system: r.system, content: r.messages[0]?.content }))).toMatchSnapshot()
      const finalRequests: GenerateOptions[] = []
      const final = await generateKnowledgeAnswer(model(['比较 THUMS v7.1 与 VIVA+ v2.0.0 [1]；采用 Larsson 已开发的函数 [2]；阈值为 0.8 [3]。'], finalRequests),
        { provider: 'fixture', model: 'answer' }, local, { maxEvidenceChars: 12000, maxOutputTokens: 4096, timeoutMs: 2000,
          navigate: async () => answer, evidenceSelection: { maxTokens: 1024, timeoutMs: 2000 } }, signal())
      expect(final.mode).toBe('model-rag')
      expect(finalRequests).toHaveLength(1)
      const finalInput = finalRequests[0]?.messages[0]?.content[0]
      expect(finalInput?.type === 'text' ? finalInput.text : '').toContain('evidenceRequirements')
      expect(finalRequests.map(r => ({ system: r.system, content: r.messages[0]?.content }))).toMatchSnapshot('source-backed final answer')
    } finally { store.close() }
  })
  it('rejects invented document, fact and evidence references and preserves the baseline', async () => {
    const { store, source } = await fixture()
    try {
      for (const outputs of [
        [{ needs: [{ ...plan.needs[0], facts: [{ document: 'D99', id: 'F1' }] }] }],
        [{ needs: [{ ...plan.needs[0], facts: [{ document: 'D1', id: 'F99' }] }] }],
        [plan, { needs: [{ id: 1, evidenceIds: [99] }, ...review.needs.slice(1)] }],
      ]) {
        const result = await navigateKnowledge(model(outputs), route, settings, config, source, local, 12000, signal())
        expect(result).toMatchObject({ citations: [], knowledgeNavigation: { status: 'failed', reason: 'model-or-source-error' } })
      }
    } finally { store.close() }
  })
  it('never silently clips knowledge pages or quotes to satisfy limits', async () => {
    const { store, source } = await fixture()
    try {
      const requests: GenerateOptions[] = []
      const oversized = await navigateKnowledge(model([], requests), route, settings,
        { ...config, maxInputChars: 100 }, source, local, 12000, signal())
      expect(oversized.knowledgeNavigation).toMatchObject({ status: 'limited', reason: 'input-limit', calls: 0 })
      expect(requests).toHaveLength(0)
      const noRoom = await navigateKnowledge(model([plan]), route, settings, config, source, local, 1, signal())
      expect(noRoom.knowledgeNavigation).toMatchObject({ status: 'limited', reason: 'evidence-limit', calls: 1 })
      expect(noRoom.citations).toEqual([])
    } finally { store.close() }
  })
  it('reports an uncovered subquestion and excludes evidence rejected by the source check', async () => {
    const { store, source } = await fixture()
    try {
      const result = await navigateKnowledge(model([plan, { needs: [...review.needs.slice(0, 2), { id: 3, evidenceIds: [] }] }]),
        route, settings, config, source, local, 12000, signal())
      expect(result.knowledgeNavigation).toMatchObject({ status: 'partial', needs: [expect.anything(), expect.anything(), { question: '阈值？', evidenceIds: [] }] })
      expect(result.citations).toHaveLength(2)
    } finally { store.close() }
  })
  it('propagates cancellation and rejects a source deleted while planning', async () => {
    const { store, source } = await fixture()
    try {
      const abort = new AbortController(); abort.abort()
      await expect(navigateKnowledge(model([]), route, settings, config, source, local, 12000, abort.signal)).rejects.toThrow()
      const deleted: Pick<LlmRuntime, 'stream'> = { async *stream(options): AsyncIterable<StreamChunk> {
        store.deleteDocument('papers', source.documents[0]!.id)
        yield * model([plan]).stream(options)
      } }
      expect((await navigateKnowledge(deleted, route, settings, config, source, local, 12000, signal())).knowledgeNavigation?.status).toBe('failed')
    } finally { store.close() }
  })
})
