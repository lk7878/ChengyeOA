import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { KnowledgeBaseStore } from '@deepseek-ai/dsh-product-knowledge/src/store.ts'
import { decodeKnowledgeFile, hasUsableNativeText, MAX_KNOWLEDGE_FILE_BYTES } from '@deepseek-ai/dsh-product-knowledge/src/document-import.ts'

const DOCX_FIXTURE_BASE64 = [
  'UEsDBBQAAAAIAItuIl3mdcR+2gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbHyQPU7EMBCFrxK5RWsHCgqUZAugBQouYDmT',
  'xMIztmZmg7k9yu6yBVqo38/39Lp9xdSswBIz9ebWtmY/dO9fBaSpmEh6s6iWB+ckLIBebC5AFdOUGb2KzTy74sOHn8Hdte29C5k',
  'USHe6dZihe4LJH5I2z1WBThSGJKZ5PBk3Vm98KSkGrzGTW2n8RdmdCZYhHT2yxCI3FZNxVwmb8jfgnHtdgTmO0Lx51heP0Bv3mX',
  'l0Yw4HBFL7f82VnXmaYoBLfmsrnAOIRJox2YuCPtLPfne8e/gGAAD//wMAUEsDBBQAAAAIAItuIl3Uw/NmwwAAAP4AAAARAAAAd29y',
  'ZC9kb2N1bWVudC54bWxEjsFqwzAQRH9F6F7L7SEUYzuHlF6bQwu9qtLGWZB2hXYTO39f5B56eQPD8JjxuOVk7lAFmSb73PXWAAWO',
  'SMtkvz7fn16tEfUUfWKCyT5A7HEe1yFyuGUgNVtOJMM62atqGZyTcIXspeMCtOV04Zq9Ssd1cSvXWCoHEEFacnIvfX9w2SPZpvzh',
  '+GhZGmqDzm8fp28Dd4xAAYzcSuGq0h7jBSEapAVEkakbXds31p27RSDoubq9+NO7/+vzLwAAAP//AwBQSwMEFAAAAAgAi24iXV8zlVKe',
  'AAAABwEAAAsAAABfcmVscy8ucmVsc4zPsQ7CIBQF0F8h7wP6WgcHU9rFpavpDxB4bYnAI4CKf+/iYI2D683Nubn9WL0Td0rZcpDQ',
  'NS2MQ38hp4rlkDcbs6jehSxhKyWeELPeyKvccKRQvVs4eVVyw2nFqPRVrYSHtj1i+jRgb4rJSEiT6UDMz0j/2LwsVtOZ9c1TKD8m',
  'vhogZpVWKhIenAyad9xU7wCHHncXhxcAAAD//wMAUEsBAhQAFAAAAAgAi24iXeZ1xH7aAAAAiwEAABMAAAAAAAAAAAAAAAAAAAAA',
  'AFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACACLbiJd1MPzZsMAAAD+AAAAEQAAAAAAAAAAAAAAAAALAQAAd29yZC9kb2N1',
  'bWVudC54bWxQSwECFAAUAAAACACLbiJdXzOVUp4AAAAHAQAACwAAAAAAAAAAAAAAAAD9AQAAX3JlbHMvLnJlbHNQSwUGAAAAAAMAAw',
  'C5AAAAxAIAAAAA',
].join('')

const PDF_FIXTURE_BASE64 = [
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUg',
  'L1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAg',
  'UiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMg',
  'NSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNh',
  'ID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNzAgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgKFBERiBldmlk',
  'ZW5jZSBzdXBwb3J0cyB2ZXJpZmllZCBpbmdlc3Rpb24uKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAw',
  'MDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAw',
  'MDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFy',
  'dHhyZWYKNDMzCiUlRU9GCg==',
].join('')

describe('KnowledgeBaseStore', () => {
  it('ignores standalone decorative rules for quality scoring without accepting empty or corrupt pages', () => {
    const text = 'Predicting rib fracture risk with whole-body finite element models.'
    for (const rule of ['_'.repeat(34), '-'.repeat(34), '='.repeat(34), '─'.repeat(34), '━'.repeat(34), '═'.repeat(34)]) {
      expect(hasUsableNativeText(`${text}\n  ${rule}\n${text}`, 32)).toBe(true)
      expect(hasUsableNativeText(`${text}\r\n  ${rule}\r\n${text}`, 32)).toBe(true)
      expect(hasUsableNativeText(rule, 32)).toBe(false)
    }
    expect(hasUsableNativeText(`Short\n${'_'.repeat(34)}`, 32)).toBe(false)
    expect(hasUsableNativeText(`${text}\n${'A'.repeat(34)}`, 32)).toBe(false)
    expect(hasUsableNativeText(`${text}\n${'\uFFFD'.repeat(34)}`, 32)).toBe(false)
    expect(hasUsableNativeText(`${text}\n${'\u0000'.repeat(34)}`, 32)).toBe(false)
    expect(hasUsableNativeText(' '.repeat(100), 32)).toBe(false)
  })

  it('rejects an oversized source before allocating decoded bytes', () => {
    const encodedLength = Math.ceil((MAX_KNOWLEDGE_FILE_BYTES + 1) / 3) * 4
    expect(() => decodeKnowledgeFile('large.txt', 'A'.repeat(encodedLength))).toThrow(/exceeds/u)
  })

  it('validates a multi-megabyte browser payload without overflowing the call stack', () => {
    const source = Buffer.alloc(8 * 1024 * 1024, 0xa5)
    const decoded = decodeKnowledgeFile('paper.pdf', source.toString('base64'))
    expect(decoded.bytes.byteLength).toBe(source.byteLength)
    expect(Buffer.from(decoded.bytes).equals(source)).toBe(true)
    expect(() => decodeKnowledgeFile('paper.pdf', 'AA=A')).toThrow(/not valid base64/u)
  })

  it('persists a source-evidenced Markdown search loop', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      const created = store.create('legal-enforcement', 'Legal Enforcement')
      expect(created.created).toBe(true)
      expect(store.create('legal-enforcement', 'Legal Enforcement').created).toBe(false)

      const imported = store.importMarkdown('legal-enforcement', 'Procedure.md', [
        '# Filing',
        'An enforcement filing requires a valid instrument and party identity.',
        '',
        '## Notice',
        'Serve notice before compulsory measures unless an exception applies.',
      ].join('\n'))
      expect(imported.knowledgeBase.revision).toBe(1)
      expect(imported.document.chunkCount).toBe(2)

      const hits = store.search('legal-enforcement', 'compulsory notice', 3)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({
        knowledgeBaseAlias: 'legal-enforcement', documentName: 'Procedure.md', heading: 'Notice', revision: 1,
      })
      expect(hits[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/u)

      const read = store.read('legal-enforcement', imported.document.id, 4, 5)
      expect(read).toMatchObject({ knowledgeBaseAlias: 'legal-enforcement', startLine: 4, endLine: 5 })
      expect(read.content).toContain('compulsory measures')
      expect(store.list()[0]).toMatchObject({ documentCount: 1, chunkCount: 2, revision: 1 })
    } finally { store.close() }
  })

  it('ranks Chinese evidence deterministically with title, heading, and phrase signals', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('chinese-ranking', 'Chinese Ranking')
      store.importMarkdown('chinese-ranking', '通用手册.md', '# 流程\n执行前应当送达告知书。')
      store.importMarkdown('chinese-ranking', '送达告知.md', '# 其他事项\n完成后保存回执。')

      const first = store.search('chinese-ranking', '送达告知', 2)
      const repeated = store.search('chinese-ranking', '送达告知', 2)
      expect(first).toHaveLength(2)
      expect(first[0]).toMatchObject({ documentName: '送达告知.md' })
      expect(repeated[0]?.chunkId).toBe(first[0]?.chunkId)
      expect(repeated[1]?.chunkId).toBe(first[1]?.chunkId)
      expect(() => store.search('chinese-ranking', '……')).toThrow(/searchable letter or number/u)
    } finally { store.close() }
  })

  it('rejects invalid aliases, missing bases, and unbound documents', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      expect(() => store.create('../escape', 'Bad')).toThrow(/lowercase letters/)
      expect(() => store.search('missing', 'query')).toThrow(/was not found/)
      const base = store.create('one', 'One').knowledgeBase
      expect(() => store.read(base.id, 'missing')).toThrow(/document .* was not found/i)
    } finally { store.close() }
  })

  it('retains named-paper opening context when a source identifier adjoins a Chinese question', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('papers', 'Papers')
      store.importMarkdown('papers', 'Author2025.md', '# Paper title\n\n## Abstract\nTwo models were compared.\n\n## References\nmodel model model model')
      store.importMarkdown('papers', 'Other2022.md', '# Models\nmodel model model model model')
      expect(store.search('papers', 'Author2025论文比较了什么？', 4)[0]).toMatchObject({ documentName: 'Author2025.md', heading: 'Abstract' })
      expect(store.search('papers', '2025年 model', 4)[0]).toMatchObject({ documentName: 'Author2025.md', heading: 'Abstract' })
    } finally { store.close() }
  })

  it('rolls a failed import back without advancing revision', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('one', 'One')
      expect(() => store.importMarkdown('one', 'Empty', '')).toThrow(/Markdown must contain/)
      expect(store.list()[0]).toMatchObject({ revision: 0, documentCount: 0, chunkCount: 0 })
    } finally { store.close() }
  })

  it('imports supported source bytes idempotently and retains failed processing evidence', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('files', 'Files')
      const source = Buffer.from('Serve notice before enforcement.', 'utf8').toString('base64')
      const imported = await store.importFile('files', 'Runbook.txt', source)
      expect(imported).toMatchObject({ duplicate: false, document: {
        kind: 'txt', status: 'ready', progress: 100, originalName: 'Runbook.txt',
      } })
      expect(imported.document.extractedChars).toBeGreaterThan(0)
      expect(imported.document.sourceHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(store.search('files', 'enforcement')).toHaveLength(1)

      const docx = await store.importFile('files', 'Evidence.docx', DOCX_FIXTURE_BASE64)
      expect(docx.document).toMatchObject({ kind: 'docx', status: 'ready', chunkCount: 1 })
      expect(store.search('files', 'verified ingestion')).toHaveLength(1)

      const pdf = await store.importFile('files', 'Evidence.pdf', PDF_FIXTURE_BASE64)
      expect(pdf.document).toMatchObject({ kind: 'pdf', status: 'ready', chunkCount: 2 })
      expect(store.search('files', 'PDF')).toHaveLength(1)

      const duplicate = await store.importFile('files', 'Renamed.txt', source)
      expect(duplicate).toMatchObject({ duplicate: true, document: { id: imported.document.id } })
      expect(store.list()[0]).toMatchObject({ revision: 3, documentCount: 3 })

      const failed = await store.importFile('files', 'Broken.docx', Buffer.from('not-a-docx').toString('base64'))
      expect(failed.document).toMatchObject({ kind: 'docx', status: 'failed', progress: 35, chunkCount: 0 })
      expect(failed.document.error).toBeTruthy()
      const detail = store.detail('files', failed.document.id)
      expect(detail).toMatchObject({ preview: '', reprocessable: true })
      expect(detail.stages.some(stage => stage.status === 'failed')).toBe(true)
      expect(store.search('files', 'not-a-docx')).toHaveLength(0)
      expect((await store.reprocess('files', failed.document.id)).document.status).toBe('failed')
      await expect(store.importFile('files', 'Unsupported.pptx', source)).rejects.toThrow(/not a supported/u)
    } finally { store.close() }
  })

  it('imports HTML body content without executable or navigation text', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('html-files', 'HTML Files')
      const html = `<!doctype html><html><body><nav>Navigation Secret</nav><main>
        <h1>研究结论</h1><p>结构化网页证据支持知识编译。</p><script>Executable Secret</script>
      </main></body></html>`
      const imported = await store.importFile('html-files', 'Research.HTML', Buffer.from(html).toString('base64'))
      expect(imported.document).toMatchObject({ kind: 'html', status: 'ready' })
      expect(store.search('html-files', '结构化网页')).toHaveLength(1)
      expect(store.search('html-files', 'Executable Secret')).toHaveLength(0)
      expect(store.search('html-files', 'Navigation Secret')).toHaveLength(0)
    } finally { store.close() }
  })

  it('imports bounded XLSX worksheets as searchable Markdown tables', async () => {
    const workbook = new ExcelJS.Workbook()
    const findings = workbook.addWorksheet('实验结果')
    findings.addRow(['样本', '结论'])
    findings.addRow(['A-01', '局部部署的识别结果有效'])
    const bytes = await workbook.xlsx.writeBuffer()
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('spreadsheets', 'Spreadsheets')
      const imported = await store.importFile('spreadsheets', 'Results.XLSX', Buffer.from(bytes).toString('base64'))
      expect(imported.document).toMatchObject({ kind: 'xlsx', status: 'ready' })
      expect(store.search('spreadsheets', '局部部署')).toHaveLength(1)
      expect(store.search('spreadsheets', '实验结果')).toHaveLength(1)
    } finally { store.close() }
  })

  it('rejects XLSX sources beyond configured worksheet limits', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('One').addRow(['first'])
    workbook.addWorksheet('Two').addRow(['second'])
    const bytes = await workbook.xlsx.writeBuffer()
    const store = new KnowledgeBaseStore(':memory:', {}, { maxSpreadsheetSheets: 1 })
    try {
      store.create('bounded-xlsx', 'Bounded XLSX')
      const imported = await store.importFile('bounded-xlsx', 'TooMany.xlsx', Buffer.from(bytes).toString('base64'))
      expect(imported.document).toMatchObject({ kind: 'xlsx', status: 'failed', chunkCount: 0 })
      expect(imported.document.error).toMatch(/configured maximum is 1/u)
    } finally { store.close() }
  })

  it('uses local OCR only when a PDF page fails the native-text quality gate', async () => {
    const calls: number[] = []
    const store = new KnowledgeBaseStore(':memory:', {}, {
      nativeMinCharsPerPage: 10_000,
      ocr: {
        async recognize(_image, pageNumber) {
          calls.push(pageNumber)
          return {
            text: '本地 PaddleOCR 识别出的扫描论文正文。',
            blocks: [{ text: '本地 PaddleOCR 识别出的扫描论文正文。', type: 'text', box: [0, 0, 10, 10], confidence: 0.98 }],
            model: 'PP-OCRv5-server', engine: 'PaddleOCR', elapsedMs: 10,
          }
        },
        close() {},
      },
    })
    try {
      store.create('scanned', 'Scanned')
      const imported = await store.importFile('scanned', '论文.pdf', PDF_FIXTURE_BASE64)
      expect(imported.document).toMatchObject({ status: 'ready', kind: 'pdf' })
      expect(calls).toEqual([1])
      expect(store.search('scanned', '扫描论文').length).toBeGreaterThan(0)
    } finally { store.close() }
  })

  it('retains knowledge and evidence after the runtime reopens its database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-product-knowledge-'))
    const database = join(directory, 'knowledge.sqlite')
    try {
      const first = new KnowledgeBaseStore(database)
      const imported = (() => {
        try {
          first.create('persistent-base', 'Persistent Base')
          return first.importMarkdown(
            'persistent-base',
            'Persistent.md',
            '# Durable evidence\nThe source remains searchable after restart.',
          )
        } finally {
          first.close()
        }
      })()

      const reopened = new KnowledgeBaseStore(database)
      try {
        expect(reopened.list()[0]).toMatchObject({
          alias: 'persistent-base', documentCount: 1, chunkCount: 1, revision: 1,
        })
        expect(reopened.search('persistent-base', 'searchable restart')).toHaveLength(1)
        expect(reopened.read('persistent-base', imported.document.id, 1, 2)).toMatchObject({
          document: { contentHash: imported.document.contentHash },
          revision: 1,
        })
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('upgrades the pre-file-ingestion document table without losing Markdown', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-product-knowledge-migration-'))
    const database = join(directory, 'knowledge.sqlite')
    try {
      const legacy = new DatabaseSync(database)
      legacy.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE knowledge_bases(
          id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
          status TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE documents(
          id TEXT PRIMARY KEY, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          name TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
          revision INTEGER NOT NULL, imported_at TEXT NOT NULL
        ) STRICT;
      `)
      const timestamp = '2026-09-01T00:00:00.000Z'
      legacy.prepare("INSERT INTO knowledge_bases VALUES ('kb', 'legacy', 'Legacy', 'active', 1, ?, ?)")
        .run(timestamp, timestamp)
      legacy.prepare("INSERT INTO documents VALUES ('doc', 'kb', 'Legacy.md', '# Legacy', ?, 1, ?)")
        .run('a'.repeat(64), timestamp)
      legacy.close()

      const store = new KnowledgeBaseStore(database)
      try {
        expect(store.documents('legacy')[0]).toMatchObject({
          originalName: 'Legacy.md', kind: 'md', status: 'ready', progress: 100, extractedChars: 8,
        })
        expect(store.detail('legacy', 'doc').reprocessable).toBe(true)
      } finally { store.close() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('derives Wiki pages, a traceable graph, cited answers, and reproducible evaluation', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('handbook', 'Handbook')
      const procedure = store.importMarkdown('handbook', 'Procedure.md', [
        '# Procedure',
        'Serve notice before compulsory measures. See [[Policy]].',
        '',
        '## Evidence',
        'Record the delivery receipt.',
      ].join('\n'))
      store.importMarkdown('handbook', 'Policy.md', '# Policy\nCompulsory measures require documented notice.')

      expect(store.list()[0]).toMatchObject({ documentCount: 2, chunkCount: 3 })

      const manifest = store.wiki('handbook')
      expect(manifest.pages).toHaveLength(2)
      expect(manifest.pages.every(page => page.sections.length === 0)).toBe(true)
      expect(manifest).toMatchObject({ revision: 2, stats: { pageCount: 2, linkCount: 1 } })
      expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(store.wiki('handbook', procedure.document.id).pages[0]).toMatchObject({
        title: 'Procedure',
        type: 'procedure',
        topic: 'Evidence',
        sections: [
          { heading: 'Procedure', startLine: 1 },
          { heading: 'Evidence', startLine: 4 },
        ],
      })

      const graph = store.graph('handbook')
      expect(graph.nodes.some(node => node.type === 'page' && node.label === 'Policy')).toBe(true)
      expect(new Set(graph.nodes.map(node => node.type))).toEqual(new Set(['page', 'source', 'topic', 'page-type', 'section']))
      expect(graph.edges.some(edge => edge.relation === 'links-to')).toBe(true)
      expect(new Set(graph.edges.map(edge => edge.relation))).toEqual(new Set(['has-source', 'has-topic', 'has-type', 'contains', 'next', 'links-to']))
      expect(graph.nodes.every(node => node.degree >= 0)).toBe(true)
      expect(graph.truncated).toBe(false)

      const answer = store.ask('handbook', 'compulsory notice')
      expect(answer).toMatchObject({ status: 'answered', requestedMode: 'local', mode: 'local-extractive', generation: null })
      expect(answer.answer).toContain('[1]')
      expect(answer.citations[0]).toMatchObject({ documentName: 'Policy.md' })
      expect(store.ask('handbook', 'unfindable-token')).toMatchObject({ status: 'no-evidence', citations: [] })
      expect(store.ask('handbook', '，，，？？？')).toMatchObject({ status: 'no-evidence', citations: [] })

      const report = await store.evaluate('handbook', [{
        id: 'direct-policy', kind: 'direct-fact', question: 'compulsory notice',
        expectedTerms: ['compulsory', 'notice'], expectedDocumentNames: ['Policy.md'],
      }])
      expect(report).toMatchObject({
        caseCount: 1, answeredRate: 1, citationRate: 1, expectedTermCoverage: 1, passedRate: 1,
        baseline: { profile: 'baseline' }, optimized: { profile: 'optimized', results: [{ id: 'direct-policy', passed: true }] },
        hybrid: null, regressionFree: true, hybridRegressionFree: null,
      })
      expect(report.optimized).toMatchObject({ recallAt10: 1, mrrAt10: 1 })
      expect(Object.keys(report.optimized.metricMeans)).toHaveLength(7)
      expect(report.optimized.results[0]?.scores).toHaveLength(7)
    } finally { store.close() }
  })

  it('archives writes and restores a validated logical backup without partial state', () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('recoverable', 'Recoverable')
      const imported = store.importMarkdown('recoverable', 'Runbook.md', '# Recovery\nKeep a verified backup.')
      expect(store.setStatus('recoverable', 'archived').status).toBe('archived')
      expect(() => store.importMarkdown('recoverable', 'Blocked.md', '# Blocked')).toThrow(/Archived knowledge base/u)

      const backup = store.backup('recoverable')
      expect(JSON.parse(backup.json)).toMatchObject({ schemaVersion: 3, documents: [{ kind: 'md', originalName: 'Runbook.md' }] })
      expect(backup.json).not.toContain('raw_content')
      expect(backup.contentHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(() => store.delete('recoverable', 'wrong-alias')).toThrow(/exactly match/u)
      expect(store.delete('recoverable', 'recoverable')).toBe('recoverable')
      expect(store.list()).toHaveLength(0)

      const restored = store.restore(backup.json)
      expect(restored).toMatchObject({ alias: 'recoverable', status: 'archived', revision: 1 })
      expect(store.search('recoverable', 'verified backup')).toHaveLength(1)
      expect(store.documents('recoverable')[0]?.contentHash).toBe(imported.document.contentHash)

      const invalid = JSON.parse(backup.json) as { knowledgeBase: { alias: string }; documents: Array<{ contentHash: string }> }
      invalid.knowledgeBase.alias = 'broken-copy'
      invalid.documents[0]!.contentHash = '0'.repeat(64)
      expect(() => store.restore(JSON.stringify(invalid))).toThrow(/invalid \(content-hash\)/u)
      expect(store.list().some(base => base.alias === 'broken-copy')).toBe(false)

      store.setStatus('recoverable', 'active')
      const documentId = store.documents('recoverable')[0]!.id
      expect(store.deleteDocument('recoverable', documentId)).toMatchObject({ documentCount: 0, chunkCount: 0, revision: 2 })
      expect(store.search('recoverable', 'verified backup')).toHaveLength(0)
    } finally { store.close() }
  })
})
