import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeBaseStore } from '@deepseek-ai/dsh-product-knowledge/src/store.ts'
import {
  decodeVector, encodeVector, normalizedCosine, reciprocalRankFusion,
  type KnowledgeEmbeddingProvider,
} from '@deepseek-ai/dsh-product-knowledge/src/semantic-retrieval.ts'

class TestEmbeddingProvider implements KnowledgeEmbeddingProvider {
  readonly model = 'test/multilingual'
  readonly revision = 'a'.repeat(40)
  readonly dimensions = 2
  passageBatches = 0
  passageTexts = 0
  queryBatches = 0
  closed = false
  fail = false

  async embed(texts: readonly string[]): Promise<readonly Float32Array[]> {
    if (this.fail) throw new Error('test provider unavailable')
    if (texts.every(text => text.startsWith('query:'))) this.queryBatches += 1
    else {
      this.passageBatches += 1
      this.passageTexts += texts.length
    }
    return texts.map(text => text.includes('domesticated canine') || text.includes('犬科动物')
      ? Float32Array.of(1, 0)
      : Float32Array.of(0, 1))
  }

  close(): void { this.closed = true }
}

function semantic(provider: KnowledgeEmbeddingProvider, maxScanChunks: number = 100) {
  return {
    provider, batchSize: 8, candidateLimit: 20, maxScanChunks,
    projectionMaxChars: 1_800, rankConstant: 60, minimumScore: 0.82,
  }
}

describe('local hybrid knowledge retrieval', () => {
  it('reports disabled index management without affecting lexical retrieval', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('lexical', 'Lexical')
      store.importMarkdown('lexical', 'Notice.md', '# Notice\nServe notice before enforcement.')
      expect(store.semanticIndexStatus('lexical')).toMatchObject({
        configuredMode: 'lexical', state: 'disabled', sourceChunkCount: 1,
        indexedChunkCount: 0, coverage: 0,
      })
      await expect(store.rebuildSemanticIndex('lexical')).rejects.toMatchObject({
        code: 'knowledge/semantic-disabled', details: { ref: 'lexical' },
      })
      expect(store.search('lexical', 'notice', 2)).toHaveLength(1)
    } finally { store.close() }
  })

  it('adds semantic candidates, publishes one revision, and rebuilds after content changes', async () => {
    const provider = new TestEmbeddingProvider()
    const store = new KnowledgeBaseStore(':memory:', {}, {}, semantic(provider))
    try {
      store.create('papers', 'Papers')
      store.importMarkdown('papers', '动物研究.md', '# 分类结论\n该物种属于犬科动物，并已适应人类居住环境。')
      store.importMarkdown('papers', '市场报告.md', '# 市场\n金融市场今日出现明显波动。')

      const first = await store.searchHybrid('papers', 'domesticated canine', 2)
      expect(first.hits[0]).toMatchObject({ documentName: '动物研究.md' })
      expect(first.retrieval).toMatchObject({
        requestedMode: 'hybrid', actualMode: 'hybrid', semanticIndexRevision: 2,
        semanticCandidateCount: 1, fallbackReason: null,
      })
      expect(provider.passageBatches).toBe(1)
      expect(provider.passageTexts).toBe(2)
      expect(provider.queryBatches).toBe(1)

      await store.searchHybrid('papers', 'domesticated canine', 2)
      expect(provider.passageBatches).toBe(1)
      expect(provider.queryBatches).toBe(2)

      store.importMarkdown('papers', '补充材料.md', '# 术语\n犬科动物也可称为 canid。')
      const rebuilt = await store.searchHybrid('papers', 'domesticated canine', 3)
      expect(rebuilt.retrieval.semanticIndexRevision).toBe(3)
      expect(provider.passageBatches).toBe(2)
      expect(provider.passageTexts).toBe(3)

      const market = store.documents('papers').find(document => document.name === '市场报告.md')
      expect(market).toBeDefined()
      store.deleteDocument('papers', market?.id ?? '')
      const afterDelete = await store.searchHybrid('papers', 'domesticated canine', 3)
      expect(afterDelete.retrieval.semanticIndexRevision).toBe(4)
      expect(afterDelete.hits.every(hit => hit.documentName !== '市场报告.md')).toBe(true)
      expect(provider.passageTexts).toBe(3)

      const answer = await store.askHybrid('papers', 'domesticated canine', 2)
      expect(answer.citations.map(citation => citation.documentName).sort()).toEqual(['动物研究.md', '补充材料.md'].sort())
      const repeated = await store.askHybrid('papers', 'domesticated canine', 2)
      expect(repeated.citations.map(citation => citation.documentId)).toEqual(answer.citations.map(citation => citation.documentId))

      const report = await store.evaluate('papers', [{
        id: 'cross-language', kind: 'concept-link', question: 'domesticated canine',
        expectedTerms: ['犬科动物'], expectedDocumentNames: ['动物研究.md'],
      }])
      expect(report.hybrid).toMatchObject({ profile: 'hybrid', recallAt10: 1 })
      expect(report.optimized.recallAt10).toBe(0)
      expect(report.hybridScoreDelta).toBeGreaterThanOrEqual(0)

      expect(store.semanticIndexStatus('papers')).toMatchObject({
        configuredMode: 'hybrid', state: 'ready', sourceRevision: 4, indexRevision: 4,
        sourceChunkCount: 2, indexedChunkCount: 2, coverage: 1,
      })
      expect(store.clearSemanticIndex('papers')).toMatchObject({ state: 'missing', indexedChunkCount: 0 })
      expect(store.search('papers', '犬科动物', 2)).not.toHaveLength(0)
      expect(await store.rebuildSemanticIndex('papers')).toMatchObject({ state: 'ready', coverage: 1 })
    } finally {
      store.close()
      expect(provider.closed).toBe(true)
    }
  })

  it('falls back to lexical evidence when the local semantic provider fails', async () => {
    const provider = new TestEmbeddingProvider()
    provider.fail = true
    const store = new KnowledgeBaseStore(':memory:', {}, {}, semantic(provider))
    try {
      store.create('fallback', 'Fallback')
      store.importMarkdown('fallback', 'Notice.md', '# Notice\nServe notice before enforcement.')
      const result = await store.searchHybrid('fallback', 'notice', 4)
      expect(result.hits).toHaveLength(1)
      expect(result.retrieval).toMatchObject({
        requestedMode: 'hybrid', actualMode: 'lexical', fallbackReason: 'semantic-unavailable',
      })
    } finally { store.close() }
  })

  it('refuses an unbounded exact scan and does not call the model', async () => {
    const provider = new TestEmbeddingProvider()
    const store = new KnowledgeBaseStore(':memory:', {}, {}, semantic(provider, 1))
    try {
      store.create('bounded', 'Bounded')
      store.importMarkdown('bounded', 'One.md', '# One\nFirst passage.')
      store.importMarkdown('bounded', 'Two.md', '# Two\nSecond passage.')
      const result = await store.searchHybrid('bounded', 'passage', 4)
      expect(result.retrieval.fallbackReason).toBe('semantic-scan-limit')
      expect(provider.passageBatches).toBe(0)
      expect(provider.queryBatches).toBe(0)
    } finally { store.close() }
  })

  it('keeps a complete active index across restart without re-embedding passages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-hybrid-restart-'))
    const path = join(directory, 'knowledge.db')
    try {
      const firstProvider = new TestEmbeddingProvider()
      const firstStore = new KnowledgeBaseStore(path, {}, {}, semantic(firstProvider))
      try {
        firstStore.create('restart', 'Restart')
        firstStore.importMarkdown('restart', 'Animals.md', '# Taxonomy\nA domesticated canine belongs to Canidae.')
        await firstStore.searchHybrid('restart', 'domesticated canine', 2)
        expect(firstProvider.passageTexts).toBe(1)
      } finally { firstStore.close() }

      const secondProvider = new TestEmbeddingProvider()
      const secondStore = new KnowledgeBaseStore(path, {}, {}, semantic(secondProvider))
      try {
        const result = await secondStore.searchHybrid('restart', 'domesticated canine', 2)
        expect(result.retrieval).toMatchObject({ actualMode: 'hybrid', semanticIndexRevision: 1 })
        expect(secondProvider.passageTexts).toBe(0)
        expect(secondProvider.queryBatches).toBe(1)
      } finally { secondStore.close() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('cleans a cancelled staging build and can rebuild on the next query', async () => {
    const provider = new TestEmbeddingProvider()
    const store = new KnowledgeBaseStore(':memory:', {}, {}, semantic(provider))
    try {
      store.create('cancel', 'Cancel')
      store.importMarkdown('cancel', 'Animals.md', '# Taxonomy\nA domesticated canine belongs to Canidae.')
      const controller = new AbortController()
      controller.abort(new Error('cancelled by test'))
      await expect(store.searchHybrid('cancel', 'domesticated canine', 2, controller.signal))
        .rejects.toThrow('cancelled by test')
      expect(provider.passageTexts).toBe(0)

      const result = await store.searchHybrid('cancel', 'domesticated canine', 2)
      expect(result.retrieval).toMatchObject({ actualMode: 'hybrid', semanticIndexRevision: 1 })
      expect(provider.passageTexts).toBe(1)
    } finally { store.close() }
  })

  it('round-trips vectors and fuses independent rankings deterministically', () => {
    const vector = Float32Array.of(0.25, -0.5, 0.75)
    expect([...decodeVector(encodeVector(vector), 3)]).toEqual([...vector])
    expect(normalizedCosine(vector, vector)).toBeCloseTo(0.875)
    const fused = reciprocalRankFusion([
      [{ id: 'a', value: 'A' }, { id: 'b', value: 'B' }],
      [{ id: 'b', value: 'B' }, { id: 'c', value: 'C' }],
    ], 60)
    expect(fused).toEqual(['B', 'A', 'C'])
  })
})
