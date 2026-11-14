/** Read-only source snapshot benchmark; isolated indexes never mutate the supplied knowledge base. */
import { DatabaseSync } from 'node:sqlite'
import { KnowledgeBaseStore } from '../src/store.ts'
import { LocalTransformersEmbeddingProvider } from '../src/semantic-retrieval.ts'

const [databasePath, alias, cachePath] = process.argv.slice(2)
if (databasePath === undefined || alias === undefined) throw new Error('Usage: benchmark-academic-retrieval.ts database-path alias [embedding-cache-path]')
const source = new DatabaseSync(databasePath, { readOnly: true })
const rows = source.prepare(`SELECT d.name, d.content FROM documents d JOIN knowledge_bases kb ON kb.id = d.knowledge_base_id
  WHERE kb.alias = ? AND d.status = 'ready' ORDER BY d.name`).all(alias) as Array<{ name: string; content: string }>
source.close()
if (!rows.some(row => row.name.includes('IRCOBI2025')) || !rows.some(row => row.name.includes('Forman2022'))) {
  throw new Error('This pilot requires the 2025 HBM comparison and Forman 2022 papers; missing sources are not a passing result.')
}
const provider = cachePath === undefined ? undefined : new LocalTransformersEmbeddingProvider({
  model: 'intfloat/multilingual-e5-small', revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  cachePath, modelFileName: 'model', dtype: 'fp32', dimensions: 384,
})
const store = new KnowledgeBaseStore(':memory:', {}, {}, provider === undefined ? undefined : {
  provider, batchSize: 8, candidateLimit: 20, maxScanChunks: 50_000,
  projectionMaxChars: 1_800, rankConstant: 60, minimumScore: 0.82,
})
const cases = [
  { question: '2025年这篇论文比较了哪两个版本的人体模型？', source: 'IRCOBI2025', terms: ['v7.1', 'v2.0.0'] },
  { question: 'THUMS VIVA model versions comparison', source: 'IRCOBI2025', terms: ['v7.1', 'v2.0.0'] },
  { question: '2025年的研究测试了哪些加载工况？', source: 'IRCOBI2025', terms: ['denuded', 'lateral', 'sled'] },
  { question: 'denuded thoracic compression frontal lateral hub impacts sled', source: 'IRCOBI2025', terms: ['denuded', 'lateral', 'sled'] },
  { question: 'Forman2022每个人体模型做了多少次仿真，涵盖多少种加载模式？', source: 'Forman2022', terms: ['seventy', 'thirteen'] },
  { question: 'Forman2022 simulations thirteen frontal impact loading modes', source: 'Forman2022', terms: ['seventy', 'thirteen'] },
  { question: '为什么要针对不同的人体模型分别标定局部应变损伤风险函数？', source: 'Forman2022', terms: ['tuning', 'comparable'] },
  { question: 'tuning local strain IRFs comparable injury prediction differing construction', source: 'Forman2022', terms: ['tuning', 'comparable'] },
  { question: '你好', source: null, terms: [] },
  { question: 'hello', source: null, terms: [] },
  { question: '番茄种植需要什么肥料', source: null, terms: [] },
]
try {
  store.create('pilot', 'Academic pilot')
  for (const row of rows) store.importMarkdown('pilot', row.name, row.content)
  const started = performance.now()
  const results = []
  for (const test of cases) {
    const begin = performance.now()
    const answer = await store.askHybrid('pilot', test.question, 4)
    const relevant = answer.citations.filter(item => test.source !== null && item.documentName.includes(test.source))
    const matched = test.terms.filter(term => relevant.some(item => item.content.toLowerCase().includes(term)))
    results.push({ question: test.question, expectedSource: test.source,
      passed: test.source === null ? answer.citations.length === 0 : matched.length === test.terms.length,
      matchedTerms: matched, actualMode: answer.retrieval?.actualMode, semanticCandidates: answer.retrieval?.semanticCandidateCount,
      latencyMs: Math.round(performance.now() - begin),
      passages: answer.citations.map(item => ({ source: item.documentName, section: item.heading, startLine: item.startLine })),
    })
  }
  console.log(JSON.stringify({ scope: 'Two-paper retrieval-only pilot; not a product quality score. No model answers or query expansion.',
    documentCount: rows.length, sourceHashes: store.documents('pilot').map(item => ({ name: item.name, hash: item.contentHash })),
    passed: results.filter(item => item.passed).length, total: results.length,
    elapsedMs: Math.round(performance.now() - started), results }, null, 2))
} finally { store.close() }
