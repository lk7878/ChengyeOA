/** SQLite-backed product knowledge-base store. */

import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { academicGuide, isOverviewQuestion } from './academic.ts'
import type { KnowledgeNavigationSource } from './navigation.ts'
import { compilationSchema, gapReviewsSchema, validCompilation, visionPageSchema, type CompilerSource } from './compiler.ts'
import { checkpointSchema, type CompilationCheckpoint } from './compiler.ts'
import { checkTopicClaims, topicSchema } from './topics.ts'
import { decodeKnowledgeFile, extractKnowledgeDocument, type KnowledgeDocumentExtractionConfig } from './document-import.ts'
import type { DecodedKnowledgeFile } from './document-import.ts'
import {
  decodeVector, encodeVector, normalizedCosine, reciprocalRankFusion,
  type KnowledgeEmbeddingProvider,
} from './semantic-retrieval.ts'
import type {
  KnowledgeAnswerView, KnowledgeBackupValue, KnowledgeBaseView, KnowledgeDocumentView,
  KnowledgeDocumentDetailValue, KnowledgeDocumentKind, KnowledgeImportFileValue,
  KnowledgeEvaluationCase, KnowledgeEvaluationCaseResult, KnowledgeEvaluationMetric,
  KnowledgeEvaluationProfileReport, KnowledgeEvaluationReport, KnowledgeEvaluationScore, KnowledgeGraphEdgeView,
  KnowledgeGraphNodeView, KnowledgeGraphValue, KnowledgeReadValue, KnowledgeSearchHit,
  KnowledgeRetrievalView, KnowledgeSearchValue, KnowledgeSemanticIndexStatusValue,
  KnowledgeWikiPageType, KnowledgeWikiPageView,
  KnowledgeWikiSectionView, KnowledgeWikiValue,
  KnowledgeCompilationValue,
  KnowledgeGapReviewRequest,
  KnowledgeConversationPage,
  KnowledgeQueueValue,
  KnowledgeTopic, KnowledgeAnswerCitation,
} from './types.ts'

const MAX_DOCUMENT_CHARS = 2_000_000
const MAX_BACKUP_CHARS = 8_000_000
const MAX_COMPLETE_BYTES = 256 * 1024 * 1024
const MAX_COMPLETE_PACKED_CHARS = 28_000_000
const MAX_SEARCH_LIMIT = 20
const MAX_EVALUATION_CASES = 50
const MAX_EXPECTED_TERMS = 20
const MAX_GRAPH_NODES = 300
const MAX_GRAPH_EDGES = 600
const CHUNK_CHAR_LIMIT = 1_600
const SCHEMA_VERSION = 5

/** Tunable deterministic ranking policy owned by the product Runtime. */
export interface KnowledgeRankingConfig {
  readonly candidateLimit: number
  readonly maxPerDocument: number
  readonly exactPhraseWeight: number
  readonly documentNameWeight: number
  readonly headingWeight: number
  readonly contentWeight: number
}

/** Bounded local semantic candidate and fusion policy. */
export interface KnowledgeSemanticRetrievalConfig {
  readonly provider: KnowledgeEmbeddingProvider
  readonly batchSize: number
  readonly candidateLimit: number
  readonly maxScanChunks: number
  readonly projectionMaxChars: number
  readonly rankConstant: number
  readonly minimumScore: number
}

const DEFAULT_RANKING: KnowledgeRankingConfig = {
  candidateLimit: 20,
  maxPerDocument: 2,
  exactPhraseWeight: 8,
  documentNameWeight: 4,
  headingWeight: 5,
  contentWeight: 1,
}

type BaseRow = {
  id: string
  alias: string
  name: string
  status: 'active' | 'archived'
  revision: number
  created_at: string
  updated_at: string
  document_count: number
  chunk_count: number
}
type DocumentRow = {
  id: string
  knowledge_base_id: string
  name: string
  original_name: string
  kind: KnowledgeDocumentKind
  source_hash: string
  size_bytes: number
  status: 'processing' | 'ready' | 'failed'
  progress: number
  error: string | null
  extracted_chars: number
  raw_content: Uint8Array | null
  content: string
  content_hash: string
  revision: number
  imported_at: string
  chunk_count: number
}
type ChunkRow = {
  id: string
  knowledge_base_id: string
  document_id: string
  heading: string
  start_line: number
  end_line: number
  content: string
  content_hash: string
  alias: string
  revision: number
  document_name: string
}
type SemanticIndexRow = {
  active_build_id: string
  model: string
  model_revision: string
  dimensions: number
  projection_version: string
  source_revision: number
  chunk_count: number
  built_at: string
}
type SemanticChunkRow = ChunkRow & { vector: Uint8Array }
type BackupDocument = {
  id?: string
  rawBase64?: string
  compilation?: Pick<KnowledgeCompilationValue, 'publication' | 'vision' | 'gapReviews'>
  name: string
  originalName: string
  kind: KnowledgeDocumentKind
  sourceHash: string
  sizeBytes: number
  status: 'ready' | 'failed'
  error: string | null
  extractedChars: number
  markdown: string
  contentHash: string
  revision: number
  importedAt: string
}
type Backup = {
  schemaVersion: 1 | 2 | 3 | 4
  turns?: Array<{ question: string; answer: KnowledgeAnswerView | null; status: 'complete' | 'cancelled' | 'failed'; revision: number; createdAt: string }>
  assets?: Array<{ hash: string; base64: string }>
  jobs?: Array<{ documentId: string; operation: 'import' | 'compile' }>
  checkpoints?: Array<{ documentId: string; value: CompilationCheckpoint }>
  topics?: KnowledgeTopic[]
  exportedAt: string
  knowledgeBase: { alias: string; name: string; status: 'active' | 'archived'; revision: number }
  documents: BackupDocument[]
}
type NormalizedEvaluationCase = Pick<KnowledgeEvaluationCaseResult,
  'id' | 'kind' | 'question' | 'expectedTerms' | 'expectedDocumentNames' | 'expectedStatus'>

/** Authoritative persistent store used by both Remote methods and Agent tools. */
export class KnowledgeBaseStore {
  readonly #db: DatabaseSync
  readonly #ranking: KnowledgeRankingConfig
  readonly #extraction: KnowledgeDocumentExtractionConfig
  readonly #semantic: KnowledgeSemanticRetrievalConfig | undefined
  readonly #semanticBuilds = new Map<string, Promise<void>>()
  readonly #processing = new Set<string>()

  constructor(
    path: string,
    ranking: Partial<KnowledgeRankingConfig> = {},
    extraction: KnowledgeDocumentExtractionConfig = {},
    semantic?: KnowledgeSemanticRetrievalConfig,
  ) {
    const actual = path === ':memory:' ? path : resolve(path)
    if (actual !== ':memory:') {
      mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
      try { closeSync(openSync(actual, 'wx', 0o600)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    this.#db = new DatabaseSync(actual)
    this.#ranking = { ...DEFAULT_RANKING, ...ranking }
    this.#extraction = extraction
    this.#semantic = semantic
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL')
    this.#migrate()
  }

  /** Close the underlying SQLite connection. */
  close(): void {
    this.#extraction.ocr?.close()
    this.#semantic?.provider.close()
    this.#db.close()
  }

  /**
   * Read a page of immutable conversation snapshots, marking changed source revisions.
   * @param ref - knowledge-base identity.
   * @param before - exclusive older-turn cursor.
   * @returns up to fifty turns in chronological order and a pagination flag.
   */
  conversation(ref: string, before: number = Number.MAX_SAFE_INTEGER): KnowledgeConversationPage {
    const base = this.#requireBase(ref)
    if (!Number.isSafeInteger(before) || before < 1) throw new Error('Invalid conversation cursor.')
    const rows = this.#db.prepare('SELECT * FROM knowledge_turns WHERE knowledge_base_id = ? AND id < ? ORDER BY id DESC LIMIT 51')
      .all(base.id, before) as Array<{ id: number; question: string; answer: string | null; status: 'running' | 'complete' | 'cancelled' | 'failed'; revision: number; created_at: string }>
    return { hasMore: rows.length > 50, turns: rows.slice(0, 50).reverse().map(row => ({
      id: row.id, question: row.question, answer: row.answer === null ? null : JSON.parse(row.answer) as KnowledgeAnswerView,
      status: row.status, revision: row.revision, createdAt: row.created_at, sourceChanged: base.revision !== row.revision,
    })) }
  }

  /**
   * Commit a question before retrieval or generation starts.
   * @param ref - knowledge-base identity.
   * @param question - bounded user input.
   * @returns durable turn identity.
   */
  beginTurn(ref: string, question: string): number {
    const base = this.#requireBase(ref)
    const result = this.#db.prepare('INSERT INTO knowledge_turns(knowledge_base_id, question, status, revision, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(base.id, requiredText(question, 'question', 500), 'running', base.revision, new Date().toISOString())
    return Number(result.lastInsertRowid)
  }

  /**
   * Publish one terminal answer before exposing its completion to the Client.
   * @param id - durable turn identity.
   * @param status - terminal outcome; drafts never become persisted answers.
   * @param answer - complete answer with the original citation snapshots.
   */
  finishTurn(id: number, status: 'complete' | 'cancelled' | 'failed', answer: KnowledgeAnswerView | null): void {
    this.#db.prepare("UPDATE knowledge_turns SET status = ?, answer = ? WHERE id = ? AND status = 'running'")
      .run(status, answer === null ? null : JSON.stringify(answer), id)
  }

  /**
   * Read validated resumable compiler batches for one existing source.
   * @param ref - knowledge-base identity.
   * @param documentId - source identity.
   * @returns source/config-bound checkpoint, or null.
   */
  compilerCheckpoint(ref: string, documentId: string): CompilationCheckpoint | null {
    this.#documentRow(this.#requireBase(ref).id, documentId)
    const row = this.#db.prepare('SELECT payload FROM compiler_checkpoints WHERE document_id = ?').get(documentId) as { payload: string } | undefined
    return row ? checkpointSchema.parse(JSON.parse(row.payload)) : null
  }

  /**
   * Save validated batches without changing the last published Wiki page.
   * @param ref - knowledge-base identity.
   * @param documentId - source identity.
   * @param value - source/config-bound, validated checkpoint or null to clear.
   */
  saveCompilerCheckpoint(ref: string, documentId: string, value: CompilationCheckpoint | null): void {
    this.#documentRow(this.#requireBase(ref).id, documentId)
    if (value === null) { this.#db.prepare('DELETE FROM compiler_checkpoints WHERE document_id = ?').run(documentId); return }
    this.#db.prepare('INSERT INTO compiler_checkpoints(document_id, payload) VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET payload = excluded.payload')
      .run(documentId, JSON.stringify(checkpointSchema.parse(value)))
  }

  /**
   * Read an immutable image retained by a complete restore.
   * @param ref - knowledge-base identity.
   * @param hash - exact rendered-image hash.
   * @returns verified image bytes or null when they must be reconstructed from the original PDF.
   */
  backupImage(ref: string, hash: string): Uint8Array | null {
    const row = this.#db.prepare('SELECT bytes FROM knowledge_assets WHERE knowledge_base_id = ? AND hash = ?')
      .get(this.#requireBase(ref).id, hash) as { bytes: Uint8Array } | undefined
    if (!row) return null
    if (sha256Bytes(row.bytes) !== hash) throw new Error('Stored image hash mismatch.')
    return row.bytes
  }

  /**
   * Retain a visual source independently of attachment retention and later source deletion.
   * @param ref - knowledge-base identity.
   * @param bytes - rendered image used for a vision request.
   */
  retainImage(ref: string, bytes: Uint8Array): void {
    const base = this.#requireBase(ref)
    this.#db.prepare('INSERT OR IGNORE INTO knowledge_assets(knowledge_base_id, hash, bytes) VALUES (?, ?, ?)')
      .run(base.id, sha256Bytes(bytes), bytes)
  }

  /**
   * Add compilation work and read outstanding jobs; existing completed publications can be reused.
   * @param ref - active knowledge-base identity for mutation.
   * @param documentIds - source ids to enqueue, omitted for a read.
   * @returns persisted work grouped by operation.
   */
  queue(ref: string, documentIds?: readonly string[]): KnowledgeQueueValue {
    const base = this.#requireBase(ref)
    if (documentIds) {
      this.#requireActive(base, 'enqueue compilation')
      if (documentIds.length > 1000) throw new Error('Too many queued documents.')
      for (const id of documentIds) if (this.#documentRow(base.id, id).status !== 'ready') throw new Error('Compile only parsed documents.')
      this.#transaction(() => {
        for (const id of documentIds) this.#db.prepare("INSERT OR IGNORE INTO knowledge_jobs(document_id, operation) VALUES (?, 'compile')").run(id)
      })
    }
    const rows = this.#db.prepare('SELECT j.document_id, j.operation FROM knowledge_jobs j JOIN documents d ON d.id = j.document_id WHERE d.knowledge_base_id = ? ORDER BY j.rowid')
      .all(base.id) as Array<{ document_id: string; operation: string }>
    return { imports: rows.filter(row => row.operation === 'import').map(row => row.document_id), compilations: rows.filter(row => row.operation === 'compile').map(row => row.document_id) }
  }

  /**
   * Acknowledge successful work; failed and cancelled jobs stay resumable.
   * @param documentId - completed source identity.
   * @param operation - completed job kind.
   */
  finishJob(documentId: string, operation: 'import' | 'compile'): void {
    this.#db.prepare('DELETE FROM knowledge_jobs WHERE document_id = ? AND operation = ?').run(documentId, operation)
  }

  /**
   * Read topic pages and flag any knowledge-base revision change for review.
   * @param ref - knowledge-base identity.
   * @returns persistent topic pages, without inference.
   */
  topics(ref: string): KnowledgeTopic[] {
    const base = this.#requireBase(ref)
    return (this.#db.prepare('SELECT payload FROM knowledge_topics WHERE knowledge_base_id = ? ORDER BY rowid').all(base.id) as Array<{ payload: string }>)
      .map((row) => {
        const topic = topicSchema.parse(JSON.parse(row.payload))
        return { ...topic, stale: topic.revision !== base.revision }
      })
  }

  /**
   * Select a source passage independently within each selected paper.
   * @param ref - knowledge-base identity.
   * @param title - topic query.
   * @param ids - two to twelve selected documents.
   * @returns original quoted evidence with stable lines and hashes.
   */
  topicSources(ref: string, title: string, ids: readonly string[]): KnowledgeAnswerCitation[] {
    const base = this.#requireBase(ref)
    if (ids.length < 2 || ids.length > 12 || new Set(ids).size !== ids.length) throw new Error('Select two to twelve distinct papers.')
    const query = requiredText(title, 'title', 200)
    return ids.map((id, index) => {
      const document = this.#documentRow(base.id, id)
      if (document.status !== 'ready') throw new Error('Only parsed papers can be compared.')
      const rows = this.#db.prepare('SELECT *, ? AS document_name FROM chunks WHERE document_id = ? ORDER BY ordinal').all(document.name, id) as ChunkRow[]
      const ranked = rows.map(row => ({ row, score: retrievalScore(row, query, retrievalTerms(query), this.#ranking) }))
        .sort((a, b) => b.score - a.score)
      const row = ranked[0]?.row
      if (!row) throw new Error('A selected paper has no source evidence.')
      return { id: index + 1, documentId: id, documentName: document.name, heading: row.heading,
        startLine: row.start_line, endLine: row.end_line, content: row.content, contentHash: row.content_hash }
    })
  }

  /**
   * Publish a reviewed draft using optimistic version checks and current source validation.
   * @param ref - active knowledge-base identity.
   * @param input - generated draft or current topic with edited human notes.
   * @returns the saved topic; old generation is retained as comparison text.
   */
  saveTopic(ref: string, input: KnowledgeTopic): KnowledgeTopic {
    const base = this.#requireBase(ref); this.#requireActive(base, 'save topic')
    const topic = topicSchema.parse(input); checkTopicClaims(topic)
    if (topic.revision !== base.revision) throw new Error('Topic sources changed. Generate a fresh preview.')
    const previous = this.topics(ref).find(item => item.id === topic.id)
    if ((previous?.version ?? 0) !== topic.version) throw new Error('Topic was edited elsewhere. Reload before saving.')
    for (const source of topic.sources) {
      const document = this.#documentRow(base.id, source.documentId)
      if (source.contentHash !== sha256(source.content) || !document.content.split('\n').slice(source.startLine - 1, source.endLine).join('\n').includes(source.content)) throw new Error('Topic evidence no longer matches its source.')
    }
    const claimsChanged = previous && JSON.stringify(previous.claims) !== JSON.stringify(topic.claims)
    const value: KnowledgeTopic = { ...topic, version: topic.version + 1, stale: false,
      previousText: claimsChanged ? previous.claims.map(claim => claim.text).join('\n\n') : previous?.previousText ?? '' }
    const result = this.#db.prepare('INSERT INTO knowledge_topics(id, knowledge_base_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload WHERE knowledge_topics.knowledge_base_id = excluded.knowledge_base_id')
      .run(topic.id, base.id, JSON.stringify(value))
    if (result.changes !== 1) throw new Error('Topic identity belongs to another library.')
    return value
  }

  /**
   * List all persisted knowledge-base summaries in update order.
   * @returns fresh knowledge-base summary snapshots.
   */
  list(): KnowledgeBaseView[] {
    return (this.#db.prepare(`
      SELECT kb.*, COUNT(DISTINCT d.id) AS document_count, COUNT(DISTINCT c.id) AS chunk_count
      FROM knowledge_bases kb
      LEFT JOIN documents d ON d.knowledge_base_id = kb.id
      LEFT JOIN chunks c ON c.knowledge_base_id = kb.id
      GROUP BY kb.id ORDER BY kb.updated_at DESC, kb.id
    `).all() as BaseRow[]).map(baseView)
  }

  /**
   * Create or idempotently resolve one normalized stable alias.
   * @param aliasInput - stable user-facing alias.
   * @param nameInput - display name.
   * @returns the current summary and whether a row was created.
   */
  create(aliasInput: string, nameInput: string): { knowledgeBase: KnowledgeBaseView; created: boolean } {
    const alias = normalizeAlias(aliasInput)
    const name = requiredText(nameInput, 'name', 120)
    const existing = this.#base(alias)
    if (existing !== undefined) {
      if (existing.name !== name) throw new RemoteError('knowledge/alias-conflict', `Knowledge base alias "${alias}" already exists.`, { alias })
      return { knowledgeBase: existing, created: false }
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    this.#db.prepare(`INSERT INTO knowledge_bases(id, alias, name, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 0, ?, ?)` ).run(id, alias, name, now, now)
    return { knowledgeBase: this.#requireBase(id), created: true }
  }

  /**
   * List imported source-document metadata for one knowledge base.
   * @param ref - knowledge-base id or alias.
   * @returns fresh document metadata snapshots.
   */
  documents(ref: string): KnowledgeDocumentView[] {
    return this.#documentRows(ref).map(documentView)
  }

  /**
   * Import, chunk, and index one bounded Markdown document transactionally.
   * @param ref - target knowledge-base id or alias.
   * @param nameInput - source display name.
   * @param markdown - bounded Markdown source.
   * @returns the committed document and updated base summary.
   */
  importMarkdown(ref: string, nameInput: string, markdown: string): { document: KnowledgeDocumentView; knowledgeBase: KnowledgeBaseView } {
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'import Markdown')
    const name = requiredText(nameInput, 'name', 240)
    const normalized = validMarkdown(markdown)
    const documentId = randomUUID()
    const revision = base.revision + 1
    const importedAt = new Date().toISOString()
    const raw = Buffer.from(normalized, 'utf8')
    this.#transaction(() => {
      this.#insertDocument(base.id, documentId, name, normalized, revision, importedAt, {
        originalName: name, kind: 'md', sourceHash: sha256Bytes(raw), sizeBytes: raw.byteLength,
        status: 'ready', progress: 100, error: null, extractedChars: normalized.length, rawContent: raw,
      })
      this.#db.prepare('UPDATE knowledge_bases SET revision = ?, updated_at = ? WHERE id = ?').run(revision, importedAt, base.id)
    })
    const document = this.documents(base.id).find(row => row.id === documentId)
    if (document === undefined) throw new Error('knowledge: committed document was not readable')
    return { document, knowledgeBase: this.#requireBase(base.id) }
  }

  /**
   * Persist, extract, chunk, and index one bounded supported source file.
   * @param ref - target knowledge-base id or alias.
   * @param fileName - original source file name.
   * @param base64 - base64-encoded source bytes.
   * @returns final document state, base summary, and duplicate signal.
   */
  async importFile(ref: string, fileName: string, base64: string, stageOnly: boolean = false): Promise<KnowledgeImportFileValue> {
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'import a source file')
    const file = decodeKnowledgeFile(fileName, base64)
    const duplicate = this.#db.prepare(`SELECT d.*, COUNT(c.id) AS chunk_count FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id
      WHERE d.knowledge_base_id = ? AND d.source_hash = ? GROUP BY d.id LIMIT 1`,
    ).get(base.id, file.sourceHash) as DocumentRow | undefined
    if (duplicate !== undefined) {
      return { document: documentView(duplicate), knowledgeBase: this.#requireBase(base.id), duplicate: true }
    }
    const documentId = randomUUID()
    const importedAt = new Date().toISOString()
    this.#db.prepare(`INSERT INTO documents(
      id, knowledge_base_id, name, original_name, kind, source_hash, size_bytes,
      status, progress, error, extracted_chars, raw_content, content, content_hash, revision, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 10, NULL, 0, ?, '', '', ?, ?)` ).run(
      documentId, base.id, file.fileName, file.fileName, file.kind, file.sourceHash,
      file.bytes.byteLength, Buffer.from(file.bytes), base.revision, importedAt,
    )
    this.#db.prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?').run(importedAt, base.id)
    this.#db.prepare("INSERT OR IGNORE INTO knowledge_jobs(document_id, operation) VALUES (?, 'import')").run(documentId)
    if (stageOnly) return { document: documentView(this.#documentRow(base.id, documentId)),
      knowledgeBase: this.#requireBase(base.id), duplicate: false }
    const document = await this.#processFile(base.id, documentId, file, false)
    return { document, knowledgeBase: this.#requireBase(base.id), duplicate: false }
  }

  /**
   * Read processing evidence and a bounded extracted preview for one document.
   * @param ref - knowledge-base id or alias.
   * @param documentId - source document identity.
   * @returns document metadata, stages, preview, and reprocessing capability.
   */
  detail(ref: string, documentId: string): KnowledgeDocumentDetailValue {
    const base = this.#requireBase(ref)
    const row = this.#documentRow(base.id, documentId)
    return {
      document: documentView(row), preview: row.content.slice(0, 4_000),
      stages: processingStages(row), reprocessable: row.raw_content !== null,
    }
  }

  /**
   * Rerun extraction and indexing from locally retained source bytes.
   * @param ref - knowledge-base id or alias.
   * @param documentId - source document identity.
   * @returns the final document state and updated base summary.
   */
  async reprocess(ref: string, documentId: string): Promise<{ document: KnowledgeDocumentView; knowledgeBase: KnowledgeBaseView }> {
    if (this.#processing.has(documentId)) throw new Error('This source is already being processed.')
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'reprocess a source file')
    const row = this.#documentRow(base.id, documentId)
    if (row.raw_content === null) {
      throw new RemoteError('knowledge/reprocess-unavailable', 'The original source bytes are not available for reprocessing.', { documentId })
    }
    const file: DecodedKnowledgeFile = {
      fileName: row.original_name, kind: row.kind, bytes: row.raw_content, sourceHash: row.source_hash,
    }
    this.#db.prepare("UPDATE documents SET status = 'processing', progress = 10, error = NULL WHERE id = ?").run(documentId)
    this.#db.prepare("INSERT OR IGNORE INTO knowledge_jobs(document_id, operation) VALUES (?, 'import')").run(documentId)
    const document = await this.#processFile(base.id, documentId, file, row.status === 'ready')
    return { document, knowledgeBase: this.#requireBase(base.id) }
  }

  /**
   * Retrieve bounded ranked passages from the local full-text index.
   * @param ref - knowledge-base id or alias.
   * @param queryInput - non-empty full-text query.
   * @param limitInput - requested result cap.
   * @param profile - baseline ranking or optimized source priority and document diversity.
   * @returns ranked source passages with revision evidence.
   */
  search(ref: string, queryInput: string, limitInput: number = 8, profile: 'baseline' | 'optimized' = 'optimized'): KnowledgeSearchHit[] {
    const base = this.#requireBase(ref)
    const query = requiredText(queryInput, 'query', 500)
    const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limitInput)))
    const queryTerms = retrievalTerms(query)
    if (queryTerms.length === 0) {
      throw new RemoteError('knowledge/invalid-input', 'query must contain at least one searchable letter or number.', {
        field: 'query', reason: 'searchable-content',
      })
    }
    const candidateLimit = Math.max(limit, this.#ranking.candidateLimit)
    const candidates = new Map<string, ChunkRow>()
    // A named source's opening passage gives version, scope, and abstract context alongside passage matches.
    const sourceTerms = queryTerms.filter(term => /^[a-z\d_-]{4,}$/u.test(term) && /\d/u.test(term)).slice(0, 4)
    const sourceRows = sourceTerms.length === 0 ? [] : this.#db.prepare(`
      SELECT c.*, kb.alias, kb.revision, d.name AS document_name
      FROM documents d JOIN knowledge_bases kb ON kb.id = d.knowledge_base_id
      JOIN chunks c ON c.document_id = d.id AND c.ordinal <= 1
      WHERE d.knowledge_base_id = ? AND (${sourceTerms.map(() => "d.name LIKE ? ESCAPE '\\'").join(' OR ')})
      ORDER BY d.name, d.id, c.ordinal LIMIT ?
    `).all(base.id, ...sourceTerms.map(term => `%${escapeLike(term)}%`), candidateLimit * 2) as ChunkRow[]
    const openingDocuments = new Set<string>()
    for (const row of sourceRows) {
      if (openingDocuments.has(row.document_id) || row.content.replace(/^#{1,6}[^\n]*(?:\n|$)/gmu, '').trim().length === 0) continue
      openingDocuments.add(row.document_id)
      candidates.set(row.id, row)
    }
    const openingIds = new Set(candidates.keys())
    const ftsTerms = queryTerms.filter(term => !HAN_TEXT.test(term))
    if (ftsTerms.length > 0) {
      const terms = ftsTerms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
      const rows = this.#db.prepare(`
        SELECT c.*, kb.alias, kb.revision, d.name AS document_name
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.chunk_id
        JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
        JOIN documents d ON d.id = c.document_id
        WHERE f.knowledge_base_id = ? AND chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts), c.document_id, c.ordinal LIMIT ?
      `).all(base.id, terms, candidateLimit) as ChunkRow[]
      for (const row of rows) candidates.set(row.id, row)
    }
    const hanTerms = queryTerms.filter(term => HAN_TEXT.test(term)).slice(0, 8)
    if (hanTerms.length > 0) {
      const conditions = hanTerms
        .map(() => "(d.name LIKE ? ESCAPE '\\' OR c.heading LIKE ? ESCAPE '\\' OR c.content LIKE ? ESCAPE '\\')")
        .join(' OR ')
      const parameters = hanTerms.flatMap((term) => {
        const pattern = `%${escapeLike(term)}%`
        return [pattern, pattern, pattern]
      })
      const rows = this.#db.prepare(`
        SELECT c.*, kb.alias, kb.revision, d.name AS document_name
        FROM chunks c
        JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
        JOIN documents d ON d.id = c.document_id
        WHERE c.knowledge_base_id = ? AND (${conditions})
        ORDER BY
          (instr(lower(c.content), ?) > 0 OR instr(lower(c.heading), ?) > 0 OR instr(lower(d.name), ?) > 0) DESC,
          (${hanTerms.map(() => '(CASE WHEN instr(c.heading, ?) > 0 THEN 5 ELSE 0 END + CASE WHEN instr(c.content, ?) > 0 THEN 1 ELSE 0 END)').join(' + ')}) DESC,
          d.name, c.ordinal, c.id LIMIT ?
      `).all(base.id, ...parameters, query.toLocaleLowerCase(), query.toLocaleLowerCase(), query.toLocaleLowerCase(),
        ...hanTerms.flatMap(term => [term, term]), candidateLimit) as ChunkRow[]
      for (const row of rows) candidates.set(row.id, row)
    }
    const rows = [...candidates.values()]
    const scored = rows.map((row, index) => ({
      row,
      index,
      score: retrievalScore(row, query, queryTerms, this.#ranking),
    })).sort((left, right) =>
      (profile === 'optimized' ? Number(openingIds.has(right.row.id)) - Number(openingIds.has(left.row.id)) : 0)
      || right.score - left.score || left.index - right.index)
    if (profile === 'baseline') return scored.slice(0, limit).map(candidate => searchHit(candidate.row))
    const selected: typeof scored = []
    const deferred: typeof scored = []
    const perDocument = new Map<string, number>()
    for (const candidate of scored) {
      const count = perDocument.get(candidate.row.document_id) ?? 0
      if (count >= this.#ranking.maxPerDocument) {
        deferred.push(candidate)
        continue
      }
      selected.push(candidate)
      perDocument.set(candidate.row.document_id, count + 1)
      if (selected.length === limit) break
    }
    if (selected.length < limit) selected.push(...deferred.slice(0, limit - selected.length))
    return selected.slice(0, limit).map(candidate => searchHit(candidate.row))
  }

  /**
   * Retrieve lexical evidence plus optional local semantic candidates.
   * @param ref - knowledge-base id or alias.
   * @param queryInput - bounded user query.
   * @param limitInput - requested result cap.
   * @param signal - cancellation for model loading, indexing, and query embedding.
   * @returns fused authoritative chunks and explicit retrieval diagnostics.
   */
  async searchHybrid(
    ref: string,
    queryInput: string,
    limitInput: number = 8,
    signal?: AbortSignal,
  ): Promise<KnowledgeSearchValue> {
    const query = requiredText(queryInput, 'query', 500)
    const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limitInput)))
    const lexical = this.search(ref, query, Math.max(limit, this.#semantic?.candidateLimit ?? limit))
    const semantic = this.#semantic
    if (semantic === undefined) return {
      hits: lexical.slice(0, limit),
      retrieval: {
        requestedMode: 'lexical', actualMode: 'lexical', semanticIndexRevision: null,
        semanticCandidateCount: 0, fallbackReason: 'semantic-disabled',
      },
    }
    const base = this.#requireBase(ref)
    const chunkCount = (this.#db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE knowledge_base_id = ?')
      .get(base.id) as { count: number }).count
    if (chunkCount > semantic.maxScanChunks) return {
      hits: lexical.slice(0, limit),
      retrieval: {
        requestedMode: 'hybrid', actualMode: 'lexical', semanticIndexRevision: null,
        semanticCandidateCount: 0, fallbackReason: 'semantic-scan-limit',
      },
    }
    try {
      await this.#ensureSemanticIndex(base.id, signal)
      signal?.throwIfAborted()
      const current = this.#requireBase(base.id)
      const index = this.#semanticIndex(base.id)
      if (index === undefined || index.source_revision !== current.revision) throw new Error('Semantic index is unavailable.')
      const [queryVector] = await semantic.provider.embed([`query: ${query}`], signal)
      if (queryVector === undefined) throw new Error('Embedding provider returned no query vector.')
      const rows = this.#db.prepare(`
        SELECT c.*, kb.alias, kb.revision, d.name AS document_name, e.vector
        FROM chunk_embeddings e
        JOIN chunks c ON c.id = e.chunk_id
        JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
        JOIN documents d ON d.id = c.document_id
        WHERE e.knowledge_base_id = ? AND e.build_id = ?
        ORDER BY c.document_id, c.ordinal
      `).all(base.id, index.active_build_id) as SemanticChunkRow[]
      const semanticHits = rows.map(row => ({
        row,
        score: normalizedCosine(queryVector, decodeVector(row.vector, semantic.provider.dimensions)),
      })).sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id))
        .filter(candidate => candidate.score >= semantic.minimumScore)
        .slice(0, semantic.candidateLimit).map(candidate => searchHit(candidate.row))
      const fused = reciprocalRankFusion([
        lexical.map(hit => ({ id: hit.chunkId, value: hit })),
        semanticHits.map(hit => ({ id: hit.chunkId, value: hit })),
      ], semantic.rankConstant)
      return {
        hits: selectDiverseHits(fused, limit, this.#ranking.maxPerDocument),
        retrieval: {
          requestedMode: 'hybrid', actualMode: 'hybrid', semanticIndexRevision: index.source_revision,
          semanticCandidateCount: semanticHits.length, fallbackReason: null,
        },
      }
    } catch {
      signal?.throwIfAborted()
      return {
        hits: lexical.slice(0, limit),
        retrieval: {
          requestedMode: 'hybrid', actualMode: 'lexical', semanticIndexRevision: null,
          semanticCandidateCount: 0, fallbackReason: 'semantic-unavailable',
        },
      }
    }
  }

  /**
   * Read at most 200 exact source lines with revision evidence.
   * @param ref - knowledge-base id or alias.
   * @param documentId - source document identity.
   * @param startLineInput - optional one-based first line.
   * @param endLineInput - optional inclusive last line.
   * @returns the bounded exact source range.
   */
  read(ref: string, documentId: string, startLineInput?: number, endLineInput?: number): KnowledgeReadValue {
    const base = this.#requireBase(ref)
    const row = this.#documentRow(base.id, documentId)
    const lines = row.content.split('\n')
    const startLine = Math.max(1, Math.trunc(startLineInput ?? 1))
    const requestedEnd = Math.trunc(endLineInput ?? startLine + 199)
    const endLine = Math.min(lines.length, startLine + 199, Math.max(startLine, requestedEnd))
    return {
      knowledgeBaseId: base.id, knowledgeBaseAlias: base.alias, revision: base.revision,
      document: documentView(row), startLine, endLine, content: lines.slice(startLine - 1, endLine).join('\n'),
    }
  }

  /**
   * Snapshot complete source material for an explicit Host compilation, never a browser payload.
   * @param ref - knowledge-base identity.
   * @param documentId - source identity.
   * @returns immutable source metadata and retained raw bytes.
   */
  compilationSource(ref: string, documentId: string): CompilerSource & {
    kind: KnowledgeDocumentKind
    raw: Uint8Array | null
  } {
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'compile a document')
    const row = this.#documentRow(base.id, documentId)
    if (row.status !== 'ready') throw new Error('Source extraction must finish before compilation.')
    return { name: row.name, sourceHash: row.source_hash, contentHash: row.content_hash,
      content: row.content, kind: row.kind, raw: row.raw_content }
  }

  /**
   * Read independent compilation lifecycle, prior publication and visual review candidates.
   * @param ref - knowledge-base identity.
   * @param documentId - source identity.
   * @returns current compilation state without raw bytes.
   */
  compilation(ref: string, documentId: string): KnowledgeCompilationValue {
    const row = this.#documentRow(this.#requireBase(ref).id, documentId)
    const stored = this.#db.prepare('SELECT payload FROM document_compilations WHERE document_id = ?')
      .get(documentId) as { payload: string } | undefined
    const value: KnowledgeCompilationValue = stored === undefined ? {
      status: 'uncompiled', progress: 0, error: null, publication: null, vision: [], suggestedPages: [], rawAvailable: false,
    } : JSON.parse(stored.payload) as KnowledgeCompilationValue
    const publication = value.publication
    const stale = publication !== null && (publication.sourceHash !== row.source_hash
      || publication.contentHash !== row.content_hash
      || publication.visionSources.some(used => value.vision.some(candidate => candidate.reviewed
        && candidate.sourceHash === used.sourceHash && candidate.page === used.page
        && (candidate.text !== used.text || candidate.printedPage !== used.printedPage
          || candidate.imageHash !== used.imageHash))))
    // Legacy visual-review invalidation is recoverable only after validating the immutable publication.
    const recovered = !stale && value.status === 'stale' && publication !== null
      && validCompilation(publication, { name: row.name, sourceHash: row.source_hash,
        contentHash: row.content_hash, content: row.content }, value.vision)
    let status = value.status
    if (stale && status !== 'running') status = 'stale'
    else if (recovered) status = publication.gaps.length > 0 ? 'review' : 'complete'
    const pages = [...row.content.matchAll(/^## Page (\d+)\s*\n([\s\S]*?)(?=^## Page \d+|$(?![\s\S]))/gmu)]
    return { ...value, status, rawAvailable: row.raw_content !== null,
      suggestedPages: pages.filter(match => (match[2]?.trim().length ?? 0) < 200 || /(?:table|figure|equation|formula|图|表|公式|[∑∫√=])/iu.test(match[2] ?? '')).map(match => Number(match[1])) }
  }

  /**
   * Commit job progress or a validated new publication while checking source and base liveness.
   * @param ref - knowledge-base identity.
   * @param documentId - source identity.
   * @param value - complete independent compilation state.
   * @param expectedHash - source snapshot hash; prevents late publication after replacement.
   * @returns the fresh stored state.
   */
  saveCompilation(ref: string, documentId: string, value: KnowledgeCompilationValue, expectedHash: string): KnowledgeCompilationValue {
    const source = this.compilationSource(ref, documentId)
    if (source.contentHash !== expectedHash) throw new Error('Source changed during compilation; publication was not replaced.')
    if (value.publication !== null && value.publication.contentHash === expectedHash
      && !validCompilation(value.publication, source, value.vision)) throw new Error('Compiled source anchors are invalid.')
    this.#db.prepare('INSERT INTO document_compilations(document_id, payload) VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET payload = excluded.payload')
      .run(documentId, JSON.stringify(value))
    return this.compilation(ref, documentId)
  }

  /**
   * Save one local review without changing evidence, publication or model usage.
   * @param request - current publication identity, item index and human disposition.
   * @returns persisted compilation state; stale, running or superseded inputs are rejected.
   */
  reviewGap(request: KnowledgeGapReviewRequest): KnowledgeCompilationValue {
    const source = this.compilationSource(request.ref, request.documentId)
    const state = this.compilation(request.ref, request.documentId)
    const publication = state.publication
    if (publication === null || state.status === 'stale' || state.status === 'running'
      || request.publicationKey !== publication.cacheKey || request.publicationCreatedAt !== publication.createdAt) {
      throw new Error('Publication changed or is unavailable; refresh before reviewing.')
    }
    const [review] = gapReviewsSchema.parse([{ index: request.index, status: request.status,
      note: request.note, reviewedAt: new Date().toISOString() }])
    if (review === undefined || review.index >= publication.gaps.length) throw new Error('Unknown compilation gap.')
    return this.saveCompilation(request.ref, request.documentId, { ...state,
      gapReviews: [...(state.gapReviews ?? []).filter(item => item.index !== review.index), review].sort((a, b) => a.index - b.index),
    }, source.contentHash)
  }

  /**
   * Compile deterministic Wiki pages from persisted Markdown sources.
   * @param ref - knowledge-base id or alias.
   * @param documentId - optional single-document filter.
   * @returns Wiki page projections in document order.
   */
  wiki(ref: string, documentId?: string): KnowledgeWikiValue {
    const base = this.#requireBase(ref)
    const rows = this.#documentRows(base.id)
    if (documentId !== undefined && !rows.some(row => row.id === documentId)) {
      throw new RemoteError('knowledge/document-not-found', `Knowledge document "${documentId}" was not found.`, { ref, documentId })
    }
    const complete = rows.filter(row => row.status === 'ready').map(row => compileWikiPage(row, true))
    const linked = resolveWikiLinks(complete)
    const selected = linked
      .filter(page => documentId === undefined || page.documentId === documentId)
      .map(page => documentId === undefined ? { ...page, sections: [] } : page)
    const stats = {
      pageCount: linked.length,
      sectionCount: linked.reduce((count, page) => count + page.sections.length, 0),
      sourceCount: linked.reduce((count, page) => count + page.sources.length, 0),
      linkCount: linked.reduce((count, page) => count + page.links.length, 0),
      topicCount: new Set(linked.map(page => page.topic)).size,
      types: wikiTypeCounts(linked),
    }
    return {
      revision: base.revision,
      compiledAt: base.updatedAt,
      contentHash: sha256(JSON.stringify({ revision: base.revision, pages: linked, stats })),
      stats,
      pages: selected,
    }
  }

  /**
   * Project a bounded enhanced graph from the current Wiki revision.
   * @param ref - knowledge-base id or alias.
   * @returns graph data and truncation metadata.
   */
  graph(ref: string): KnowledgeGraphValue {
    const base = this.#requireBase(ref)
    const pages = resolveWikiLinks(this.#documentRows(base.id).filter(row => row.status === 'ready').map(row => compileWikiPage(row, true)))
    const nodes: KnowledgeGraphNodeView[] = []
    const edges: KnowledgeGraphEdgeView[] = []
    const pageByTarget = new Map<string, KnowledgeWikiPageView>()
    for (const page of pages) {
      const targets = [
        page.slug, page.title.toLowerCase(), page.documentName.toLowerCase(), fileStem(page.documentName).toLowerCase(),
      ]
      for (const target of targets) {
        pageByTarget.set(target, page)
      }
      const sourceId = `source:${page.documentId}`
      const topicId = `topic:${encodeURIComponent(page.topic)}`
      const pageTypeId = `page-type:${page.type}`
      nodes.push({ id: page.id, type: 'page', label: page.title, documentId: page.documentId, startLine: 1, degree: 0 })
      if (!nodes.some(node => node.id === sourceId)) {
        nodes.push({ id: sourceId, type: 'source', label: page.documentName, documentId: page.documentId, startLine: 1, degree: 0 })
      }
      if (!nodes.some(node => node.id === topicId)) {
        nodes.push({ id: topicId, type: 'topic', label: page.topic, documentId: null, startLine: null, degree: 0 })
      }
      if (!nodes.some(node => node.id === pageTypeId)) {
        nodes.push({ id: pageTypeId, type: 'page-type', label: page.type, documentId: null, startLine: null, degree: 0 })
      }
      edges.push(graphEdge(edges.length, page.id, sourceId, 'has-source', 'has source'))
      edges.push(graphEdge(edges.length, page.id, topicId, 'has-topic', 'has topic'))
      edges.push(graphEdge(edges.length, page.id, pageTypeId, 'has-type', 'has type'))
      for (const [index, section] of page.sections.entries()) {
        nodes.push({ id: section.id, type: 'section', label: section.heading, documentId: page.documentId, startLine: section.startLine, degree: 0 })
        edges.push(graphEdge(edges.length, page.id, section.id, 'contains', 'contains'))
        const previous = page.sections[index - 1]
        if (previous !== undefined) edges.push(graphEdge(edges.length, previous.id, section.id, 'next', 'next'))
      }
    }
    const links = new Set<string>()
    for (const page of pages) {
      for (const section of page.sections) {
        for (const targetText of wikiLinks(section.content)) {
          const target = pageByTarget.get(targetText.toLowerCase())
          if (target === undefined || target.id === page.id) continue
          const key = `${page.id}\0${target.id}`
          if (links.has(key)) continue
          links.add(key)
          edges.push(graphEdge(edges.length, page.id, target.id, 'links-to', 'links to'))
        }
      }
    }
    const degrees = new Map<string, number>()
    for (const edge of edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
    }
    const projectedNodes = nodes.map(node => ({ ...node, degree: degrees.get(node.id) ?? 0 }))
    const totalNodes = nodes.length
    const totalEdges = edges.length
    const visibleNodes = projectedNodes.slice(0, MAX_GRAPH_NODES)
    const visibleIds = new Set(visibleNodes.map(node => node.id))
    const visibleEdges = edges
      .filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .slice(0, MAX_GRAPH_EDGES)
    return {
      revision: base.revision, totalNodes, totalEdges,
      truncated: visibleNodes.length !== totalNodes || visibleEdges.length !== totalEdges,
      nodes: visibleNodes, edges: visibleEdges,
    }
  }

  /**
   * Build a cited local extractive answer without invoking a language model.
   * @param ref - knowledge-base id or alias.
   * @param questionInput - evidence retrieval question.
   * @param limitInput - requested citation cap.
   * @param profile - deterministic retrieval profile.
   * @returns an extractive answer or explicit no-evidence result.
   */
  ask(ref: string, questionInput: string, limitInput: number = 4, profile: 'baseline' | 'optimized' = 'optimized'): KnowledgeAnswerView {
    const question = requiredText(questionInput, 'question', 500)
    const hits = retrievalTerms(question).length === 0
      ? []
      : this.search(ref, question, Math.max(1, Math.min(8, limitInput)), profile)
    return answerFromHits(question, hits, {
      requestedMode: 'lexical', actualMode: 'lexical', semanticIndexRevision: null,
      semanticCandidateCount: 0, fallbackReason: 'semantic-disabled',
    })
  }

  /**
   * Capture current compiled pages and source-scoped readers without writing or sending model requests.
   * @param ref - active knowledge-base identity.
   * @returns full publications, exact quote lookup and stale-source validation; readers reject unknown IDs.
   */
  navigation(ref: string): KnowledgeNavigationSource {
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'navigate compiled knowledge')
    const documents = this.documents(ref).filter(document => document.status === 'ready').map((document) => {
      const state = this.compilation(ref, document.id)
      const compilation = state.status === 'stale' || state.publication?.contentHash !== document.contentHash ? null : state.publication
      return { id: document.id, name: document.name, contentHash: document.contentHash, compilation }
    })
    const used = new Set<string>()
    const current = (id: string) => {
      this.#requireActive(this.#requireBase(ref), 'read navigation evidence')
      const captured = documents.find(document => document.id === id)
      if (captured === undefined) throw new Error('Unknown navigation source.')
      const row = this.#documentRow(base.id, id)
      if (row.status !== 'ready' || row.content_hash !== captured.contentHash) throw new Error('Navigation source changed.')
      if (captured.compilation !== null) {
        const state = this.compilation(ref, id)
        if (state.status === 'stale' || state.publication?.cacheKey !== captured.compilation.cacheKey
          || !validCompilation(captured.compilation,
            { name: row.name, content: row.content, sourceHash: row.source_hash, contentHash: row.content_hash }, [])) {
          throw new Error('Navigation publication changed or is invalid.')
        }
      }
      used.add(id)
      return { captured, row }
    }
    return { documents, validate: () => { for (const id of used) current(id) }, read: (id, factIds, query) => {
      const { captured, row } = current(id)
      const citations = factIds.map((factId) => {
        const fact = captured.compilation?.facts.find(item => item.id === factId)
        if (fact === undefined) throw new Error('Unknown navigation fact.')
        const vision = captured.compilation?.visionSources.find(page => page.page === fact.visionPage)
        return { id: 0, documentId: id, documentName: row.name, heading: `Compiled fact ${fact.id}`,
          startLine: fact.startLine, endLine: fact.endLine, content: fact.quote, contentHash: fact.sourceHash,
          ...(vision === undefined ? {} : { vision: { page: vision.page, sourceHash: vision.sourceHash, imageHash: vision.imageHash } }) }
      })
      if (query !== null) {
        const text = requiredText(query, 'navigation query', 250)
        const terms = retrievalTerms(text)
        const rows = this.#db.prepare(`SELECT c.*, kb.alias, kb.revision, d.name AS document_name
          FROM chunks c JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id JOIN documents d ON d.id = c.document_id
          WHERE c.knowledge_base_id = ? AND c.document_id = ? ORDER BY c.ordinal`).all(base.id, id) as ChunkRow[]
        const ranked = rows.map(chunk => ({ chunk, score: retrievalScore({ ...chunk, document_name: '' }, text, terms, this.#ranking) }))
          .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
        citations.push(...ranked.map(({ chunk }) => ({ id: 0, documentId: id, documentName: row.name,
          heading: chunk.heading, startLine: chunk.start_line, endLine: chunk.end_line,
          content: chunk.content, contentHash: chunk.content_hash })))
      }
      return citations
    } }
  }

  /**
   * Build a cited answer from the configured lexical or hybrid evidence path.
   * @param ref - knowledge-base id or alias.
   * @param questionInput - evidence retrieval question.
   * @param limitInput - requested citation cap.
   * @param signal - cancellation for local semantic inference.
   * @param originalQuestion - original intent retained during auxiliary English retrieval.
   * @returns an extractive answer referencing authoritative source passages.
   */
  async askHybrid(
    ref: string,
    questionInput: string,
    limitInput: number = 4,
    signal?: AbortSignal,
    originalQuestion: string = questionInput,
  ): Promise<KnowledgeAnswerView> {
    const question = requiredText(questionInput, 'question', 500)
    if (retrievalTerms(question).length === 0) return answerFromHits(question, [])
    const result = await this.searchHybrid(ref, question, Math.max(1, Math.min(8, limitInput)), signal)
    let answer = answerFromHits(question, result.hits, result.retrieval)
    // Compiled knowledge routes questions to original quotes; generated prose never replaces authoritative evidence.
    const terms = retrievalTerms(question)
    const compiled = this.documents(ref).flatMap((document) => {
      const state = this.compilation(ref, document.id)
      if (state.publication === null || state.status === 'stale' || state.publication.contentHash !== document.contentHash) return []
      return state.publication.facts.map(fact => ({ fact, document,
        vision: state.publication?.visionSources.find(page => page.page === fact.visionPage),
        score: terms.filter(term => fact.statement.toLowerCase().includes(term)).length }))
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(limitInput / 2)))
    if (compiled.length > 0) {
      const candidates = [...compiled.map(({ fact, document, vision }) => ({ id: 0, documentId: document.id, documentName: document.name,
        heading: 'Source located by academic compilation', startLine: fact.startLine, endLine: fact.endLine,
        content: fact.quote, contentHash: fact.sourceHash,
        compiledContext: fact.statement,
        ...(vision === undefined ? {} : { vision: { page: vision.page, sourceHash: vision.sourceHash, imageHash: vision.imageHash } }),
      })), ...answer.citations]
      const citations = candidates.filter((item, index) => !candidates.slice(0, index).some(other =>
        other.documentId === item.documentId && other.contentHash === item.contentHash))
        .slice(0, Math.min(8, limitInput)).map((item, index) => ({ ...item, id: index + 1 }))
      answer = { ...answer, status: 'answered', confidence: 'low', citations, answer: citations.map(item => `[${item.id}] ${item.content}`).join('\n\n') }
    }
    if (!isOverviewQuestion(originalQuestion) || result.hits.length === 0) return answer
    const limit = Math.max(1, Math.min(8, limitInput))
    const documents = [...new Set(result.hits.map(hit => hit.documentId))]
    const base = this.#requireBase(ref)
    const guides = documents.map((id) => {
      const row = this.#documentRow(base.id, id)
      return compileWikiPage(row, false).academicGuide?.map(excerpt => ({
        id: 0, documentId: id, documentName: row.name, heading: excerpt.role,
        startLine: excerpt.startLine, endLine: excerpt.endLine, content: excerpt.content, contentHash: excerpt.contentHash,
      })) ?? []
    })
    // ponytail: deterministic section coverage; a learned selector handles question-specific relevance downstream.
    const ordered = ['abstract', 'conclusion', 'methods', 'results', 'discussion'].flatMap(role =>
      guides.flatMap(guide => guide.filter(item => item.heading === role)))
    const candidates = [...ordered.slice(0, Math.max(1, limit - documents.length)), ...answer.citations, ...ordered]
    const unique = candidates.filter((item, index) => !candidates.slice(0, index).some(other =>
      other.documentId === item.documentId && other.startLine === item.startLine && other.contentHash === item.contentHash))
    const citations = unique.slice(0, limit).map((item, index) => ({ ...item, id: index + 1 }))
    return { ...answer, citations, confidence: 'low', answer: citations.map(item => `[${item.id}] ${item.content}`).join('\n\n') }
  }

  /**
   * Read semantic-index configuration, lifecycle, and coverage without loading the model.
   * @param ref - knowledge-base id or alias.
   * @returns current source/index revisions and coverage.
   */
  semanticIndexStatus(ref: string): KnowledgeSemanticIndexStatusValue {
    const base = this.#requireBase(ref)
    const sourceChunkCount = (this.#db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE knowledge_base_id = ?')
      .get(base.id) as { count: number }).count
    const semantic = this.#semantic
    if (semantic === undefined) return {
      configuredMode: 'lexical', state: 'disabled', model: null, modelRevision: null,
      dimensions: null, minimumScore: null, sourceRevision: base.revision, indexRevision: null,
      sourceChunkCount, indexedChunkCount: 0, coverage: 0, builtAt: null,
    }
    const index = this.#semanticIndex(base.id)
    const indexedChunkCount = index === undefined ? 0 : (this.#db.prepare(`SELECT COUNT(*) AS count
      FROM chunk_embeddings WHERE knowledge_base_id = ? AND build_id = ?`)
      .get(base.id, index.active_build_id) as { count: number }).count
    const matches = index !== undefined
      && index.source_revision === base.revision
      && index.model === semantic.provider.model
      && index.model_revision === semantic.provider.revision
      && index.dimensions === semantic.provider.dimensions
      && index.projection_version === 'document-heading-content-v1'
      && indexedChunkCount === sourceChunkCount
    const state = this.#semanticBuilds.has(base.id)
      ? 'building'
      : index === undefined ? 'missing' : matches ? 'ready' : 'stale'
    return {
      configuredMode: 'hybrid', state, model: semantic.provider.model,
      modelRevision: semantic.provider.revision, dimensions: semantic.provider.dimensions,
      minimumScore: semantic.minimumScore, sourceRevision: base.revision,
      indexRevision: index?.source_revision ?? null, sourceChunkCount, indexedChunkCount,
      coverage: sourceChunkCount === 0 ? (matches ? 1 : 0) : round(indexedChunkCount / sourceChunkCount),
      builtAt: index?.built_at ?? null,
    }
  }

  /**
   * Explicitly rebuild and atomically publish the configured semantic index.
   * @param ref - knowledge-base id or alias.
   * @param signal - optional cancellation before publication.
   * @returns published index status; disabled semantic retrieval throws.
   */
  async rebuildSemanticIndex(ref: string, signal?: AbortSignal): Promise<KnowledgeSemanticIndexStatusValue> {
    const base = this.#requireBase(ref)
    if (this.#semantic === undefined) {
      throw new RemoteError('knowledge/semantic-disabled', 'Semantic retrieval is disabled in this Profile.', { ref })
    }
    await this.#startSemanticBuild(base.id, signal)
    return this.semanticIndexStatus(base.id)
  }

  /**
   * Remove all derived vectors while preserving source documents and lexical search.
   * @param ref - knowledge-base id or alias.
   * @returns cleared index status; an active build prevents removal.
   */
  clearSemanticIndex(ref: string): KnowledgeSemanticIndexStatusValue {
    const base = this.#requireBase(ref)
    if (this.#semanticBuilds.has(base.id)) {
      throw new RemoteError('knowledge/semantic-busy', 'Cancel the active semantic build before clearing its index.', { ref })
    }
    this.#transaction(() => {
      this.#db.prepare('DELETE FROM chunk_embeddings WHERE knowledge_base_id = ?').run(base.id)
      this.#db.prepare('DELETE FROM semantic_indexes WHERE knowledge_base_id = ?').run(base.id)
    })
    return this.semanticIndexStatus(base.id)
  }

  /**
   * Compare baseline and optimized retrieval through seven deterministic dimensions.
   * @param ref - knowledge-base id or alias.
   * @param casesInput - bounded evaluation cases.
   * @param signal - optional cancellation during semantic evaluation.
   * @returns per-case outcomes and aggregate rates.
   */
  async evaluate(
    ref: string,
    casesInput: readonly KnowledgeEvaluationCase[],
    signal?: AbortSignal,
  ): Promise<KnowledgeEvaluationReport> {
    const base = this.#requireBase(ref)
    if (casesInput.length === 0 || casesInput.length > MAX_EVALUATION_CASES) {
      throw new RemoteError('knowledge/invalid-input', `cases must contain 1-${MAX_EVALUATION_CASES} entries.`, { field: 'cases', reason: 'size' })
    }
    const cases = casesInput.map((candidate, index) => {
      const question = requiredText(candidate.question, 'question', 500)
      if (candidate.expectedTerms.length > MAX_EXPECTED_TERMS) {
        throw new RemoteError('knowledge/invalid-input', `expectedTerms must contain 0-${MAX_EXPECTED_TERMS} entries.`, { field: 'expectedTerms', reason: 'size' })
      }
      const expectedTerms = candidate.expectedTerms.map(term => requiredText(term, 'expectedTerm', 120))
      const expectedDocumentNames = (candidate.expectedDocumentNames ?? []).map(name => requiredText(name, 'expectedDocumentName', 240))
      if (expectedDocumentNames.length > MAX_EXPECTED_TERMS) {
        throw new RemoteError('knowledge/invalid-input', `expectedDocumentNames must contain 0-${MAX_EXPECTED_TERMS} entries.`, { field: 'expectedDocumentNames', reason: 'size' })
      }
      return {
        id: candidate.id === undefined ? `case-${index + 1}` : requiredText(candidate.id, 'caseId', 120),
        kind: candidate.kind ?? 'direct-fact', question, expectedTerms, expectedDocumentNames,
        expectedStatus: candidate.expectedStatus ?? (candidate.kind === 'no-evidence' ? 'no-evidence' : 'answered'),
      }
    })
    const baseline = evaluationProfile('baseline', cases.map(candidate => this.#evaluateCase(base.id, candidate, 'baseline')))
    const optimized = evaluationProfile('optimized', cases.map(candidate => this.#evaluateCase(base.id, candidate, 'optimized')))
    let hybrid: KnowledgeEvaluationProfileReport | null = null
    if (this.#semantic !== undefined) {
      const hybridResults: KnowledgeEvaluationCaseResult[] = []
      for (const candidate of cases) {
        signal?.throwIfAborted()
        hybridResults.push(await this.#evaluateHybridCase(base.id, candidate, signal))
      }
      hybrid = evaluationProfile('hybrid', hybridResults)
    }
    const metricDeltas = evaluationMetricDeltas(baseline, optimized)
    const hybridMetricDeltas = hybrid === null ? null : evaluationMetricDeltas(optimized, hybrid)
    const optimizedExpectedCount = optimized.results.reduce((count, result) => count + result.expectedTerms.length, 0)
    const optimizedMatchedCount = optimized.results.reduce((count, result) => count + result.matchedTerms.length, 0)
    return {
      revision: base.revision, evaluatedAt: base.updatedAt, caseCount: cases.length, baseline, optimized, hybrid,
      scoreDelta: round(optimized.totalScore - baseline.totalScore), metricDeltas,
      regressionFree: optimized.totalScore >= baseline.totalScore
        && Object.values(metricDeltas).every(delta => delta === null || delta >= 0),
      hybridScoreDelta: hybrid === null ? null : round(hybrid.totalScore - optimized.totalScore),
      hybridMetricDeltas,
      hybridRegressionFree: hybrid === null || hybridMetricDeltas === null ? null
        : hybrid.totalScore >= optimized.totalScore
          && Object.values(hybridMetricDeltas).every(delta => delta === null || delta >= 0),
      answeredRate: ratio(optimized.results.filter(result => result.answered).length, optimized.results.length),
      citationRate: ratio(optimized.results.filter(result => result.citationCount > 0).length, optimized.results.length),
      expectedTermCoverage: ratio(optimizedMatchedCount, optimizedExpectedCount),
      passedRate: ratio(optimized.passed, optimized.results.length), results: optimized.results,
    }
  }

  #evaluateCase(
    ref: string,
    candidate: NormalizedEvaluationCase,
    profile: 'baseline' | 'optimized',
  ): KnowledgeEvaluationCaseResult {
    const startedAt = performance.now()
    try {
      const hits = retrievalTerms(candidate.question).length === 0 ? [] : this.search(ref, candidate.question, 10, profile)
      const retrieval: KnowledgeRetrievalView = {
        requestedMode: 'lexical', actualMode: 'lexical', semanticIndexRevision: null,
        semanticCandidateCount: 0, fallbackReason: 'semantic-disabled',
      }
      return evaluatedCase(candidate, answerFromHits(candidate.question, hits, retrieval), performance.now() - startedAt)
    } catch {
      return failedEvaluationCase(candidate, performance.now() - startedAt, 'lexical')
    }
  }

  async #evaluateHybridCase(
    ref: string,
    candidate: NormalizedEvaluationCase,
    signal?: AbortSignal,
  ): Promise<KnowledgeEvaluationCaseResult> {
    const startedAt = performance.now()
    try {
      const result = retrievalTerms(candidate.question).length === 0
        ? {
          hits: [],
          retrieval: {
            requestedMode: 'hybrid', actualMode: 'hybrid', semanticIndexRevision: null,
            semanticCandidateCount: 0, fallbackReason: null,
          } satisfies KnowledgeRetrievalView,
        }
        : await this.searchHybrid(ref, candidate.question, 10, signal)
      return evaluatedCase(
        candidate,
        answerFromHits(candidate.question, result.hits, result.retrieval),
        performance.now() - startedAt,
      )
    } catch {
      signal?.throwIfAborted()
      return failedEvaluationCase(candidate, performance.now() - startedAt, 'hybrid')
    }
  }

  /**
   * Archive or reactivate a knowledge base without deleting its sources.
   * @param ref - knowledge-base id or alias.
   * @param status - desired lifecycle status.
   * @returns the updated summary.
   */
  setStatus(ref: string, status: 'active' | 'archived'): KnowledgeBaseView {
    const base = this.#requireBase(ref)
    if (base.status === status) return base
    this.#db.prepare('UPDATE knowledge_bases SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), base.id)
    return this.#requireBase(base.id)
  }

  /**
   * Transactionally delete one source and its index entries from an active base.
   * @param ref - knowledge-base id or alias.
   * @param documentId - source document identity.
   * @returns the updated knowledge-base summary.
   */
  deleteDocument(ref: string, documentId: string): KnowledgeBaseView {
    const base = this.#requireBase(ref)
    this.#requireActive(base, 'delete a document')
    this.#documentRow(base.id, documentId)
    const now = new Date().toISOString()
    this.#transaction(() => {
      this.#db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId)
      this.#db.prepare('DELETE FROM documents WHERE knowledge_base_id = ? AND id = ?').run(base.id, documentId)
      this.#db.prepare('UPDATE knowledge_bases SET revision = ?, updated_at = ? WHERE id = ?').run(base.revision + 1, now, base.id)
    })
    return this.#requireBase(base.id)
  }

  /**
   * Delete one knowledge base after exact normalized-alias confirmation.
   * @param ref - knowledge-base id or alias.
   * @param expectedAliasInput - explicit destructive-operation confirmation.
   * @returns the deleted stable alias.
   */
  delete(ref: string, expectedAliasInput: string): string {
    const base = this.#requireBase(ref)
    const expectedAlias = normalizeAlias(expectedAliasInput)
    if (expectedAlias !== base.alias) {
      throw new RemoteError('knowledge/delete-confirmation', `Delete confirmation must exactly match alias "${base.alias}".`, { ref })
    }
    this.#transaction(() => {
      this.#db.prepare('DELETE FROM chunks_fts WHERE knowledge_base_id = ?').run(base.id)
      this.#db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(base.id)
    })
    return base.alias
  }

  /**
   * Serialize one knowledge base as a hashed versioned logical JSON backup.
   * @param ref - knowledge-base id or alias.
   * @returns the file name, JSON payload, and payload hash.
   * @throws When a source is still processing and cannot be represented consistently.
   */
  backup(ref: string, complete: boolean = false, assets: Array<{ hash: string; base64: string }> = []): KnowledgeBackupValue {
    const base = this.#requireBase(ref)
    const rows = this.#documentRows(base.id)
    if (rows.some(row => row.status === 'processing' && (!complete || this.#processing.has(row.id)))) {
      throw new RemoteError('knowledge/invalid-input', 'Wait for source processing to finish before creating a backup.', {
        field: 'backup', reason: 'processing',
      })
    }
    const backup: Backup = {
      schemaVersion: complete ? 4 : 3, exportedAt: new Date().toISOString(),
      knowledgeBase: { alias: base.alias, name: base.name, status: base.status, revision: base.revision },
      documents: rows.map(row => ({
        ...(complete ? { id: row.id, ...(row.raw_content === null ? {} : { rawBase64: Buffer.from(row.raw_content).toString('base64') }) } : {}),
        name: row.name, originalName: row.original_name, kind: row.kind, sourceHash: row.source_hash,
        sizeBytes: row.size_bytes, status: row.status === 'ready' ? 'ready' : 'failed', error: row.error,
        extractedChars: row.extracted_chars, markdown: row.content, contentHash: row.content_hash,
        revision: row.revision, importedAt: row.imported_at,
        compilation: { publication: this.compilation(ref, row.id).publication, vision: this.compilation(ref, row.id).vision,
          gapReviews: this.compilation(ref, row.id).gapReviews ?? [] },
      })),
    }
    if (complete) {
      if (rows.some(row => row.raw_content === null)) throw new Error('Complete backup requires retained original files for every document; use logical export for this library.')
      const turns = this.#db.prepare('SELECT * FROM knowledge_turns WHERE knowledge_base_id = ? ORDER BY id').all(base.id) as Array<{ question: string; answer: string | null; status: string; revision: number; created_at: string }>
      if (turns.some(turn => turn.status === 'running')) throw new Error('Wait for active answers before backing up.')
      backup.turns = turns.map(turn => ({ question: turn.question,
        answer: turn.answer ? JSON.parse(turn.answer) as KnowledgeAnswerView : null,
        status: turn.status as 'complete' | 'cancelled' | 'failed', revision: turn.revision, createdAt: turn.created_at }))
      const stored = this.#db.prepare('SELECT hash, bytes FROM knowledge_assets WHERE knowledge_base_id = ?').all(base.id) as Array<{ hash: string; bytes: Uint8Array }>
      backup.assets = [...new Map([...stored.map(item => ({ hash: item.hash, base64: Buffer.from(item.bytes).toString('base64') })), ...assets].map(item => [item.hash, item])).values()]
      const queue = this.queue(ref)
      backup.jobs = [...queue.imports.map(documentId => ({ documentId, operation: 'import' as const })),
        ...queue.compilations.map(documentId => ({ documentId, operation: 'compile' as const }))]
      backup.checkpoints = rows.flatMap((row) => {
        const value = this.compilerCheckpoint(ref, row.id)
        return value ? [{ documentId: row.id, value }] : []
      })
      backup.topics = this.topics(ref)
    }
    let json = `${JSON.stringify(backup, null, 2)}\n`
    if (complete) {
      if (Buffer.byteLength(json) > MAX_COMPLETE_BYTES) invalidBackup('complete-size')
      json = JSON.stringify({ format: 'knowledge-complete-gzip-v1', sha256: sha256(json), data: gzipSync(json).toString('base64') })
      if (json.length > MAX_COMPLETE_PACKED_CHARS) invalidBackup('complete-packed-size')
      parseBackup(json)
      return { fileName: `${base.alias}.knowledge-complete.json`, json, contentHash: sha256(json) }
    }
    if (json.length > MAX_BACKUP_CHARS) {
      throw new RemoteError('knowledge/invalid-backup', `Logical backup exceeds ${MAX_BACKUP_CHARS} characters; use a complete backup.`, { reason: 'size' })
    }
    return { fileName: `${base.alias}.knowledge-backup.json`, json, contentHash: sha256(json) }
  }

  /**
   * Validate and atomically restore one logical backup under a unique alias.
   * @param jsonInput - bounded logical backup JSON.
   * @returns the restored knowledge-base summary.
   */
  restore(jsonInput: string): KnowledgeBaseView {
    const backup = parseBackup(jsonInput)
    if (this.#base(backup.knowledgeBase.alias) !== undefined) {
      throw new RemoteError('knowledge/alias-conflict', `Knowledge base alias "${backup.knowledgeBase.alias}" already exists.`, { alias: backup.knowledgeBase.alias })
    }
    const baseId = randomUUID()
    const restoredAt = new Date().toISOString()
    this.#transaction(() => {
      this.#db.prepare(`INSERT INTO knowledge_bases(id, alias, name, status, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)` ).run(
        baseId, backup.knowledgeBase.alias, backup.knowledgeBase.name, backup.knowledgeBase.status,
        backup.knowledgeBase.revision, restoredAt, restoredAt,
      )
      const documentIds = new Map<string, string>()
      for (const document of backup.documents) {
        const documentId = randomUUID()
        if (document.id) documentIds.set(document.id, documentId)
        this.#insertDocument(baseId, documentId, document.name, document.markdown, document.revision, document.importedAt, {
          originalName: document.originalName, kind: document.kind, sourceHash: document.sourceHash,
          sizeBytes: document.sizeBytes, status: document.status, progress: document.status === 'ready' ? 100 : 35,
          error: document.error, extractedChars: document.extractedChars, rawContent: document.rawBase64 === undefined ? null : Buffer.from(document.rawBase64, 'base64'),
        })
        if (document.compilation !== undefined) {
          const { publication, vision, gapReviews } = document.compilation
          const state: KnowledgeCompilationValue = { publication, vision, gapReviews: gapReviews ?? [],
            status: publication === null ? 'uncompiled' : publication.gaps.length > 0 ? 'review' : 'complete',
            progress: publication === null ? 0 : 100, error: null, suggestedPages: [], rawAvailable: false }
          this.#db.prepare('INSERT INTO document_compilations(document_id, payload) VALUES (?, ?)').run(documentId, JSON.stringify(state))
        }
      }
      for (const turn of backup.turns ?? []) {
        const answer = turn.answer === null ? null : { ...turn.answer, citations: turn.answer.citations.map(citation => ({
          ...citation, documentId: documentIds.get(citation.documentId) ?? citation.documentId,
        })) }
        this.#db.prepare('INSERT INTO knowledge_turns(knowledge_base_id, question, answer, status, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(baseId, turn.question, answer === null ? null : JSON.stringify(answer), turn.status, turn.revision, turn.createdAt)
      }
      for (const asset of backup.assets ?? []) this.#db.prepare('INSERT OR IGNORE INTO knowledge_assets(knowledge_base_id, hash, bytes) VALUES (?, ?, ?)')
        .run(baseId, asset.hash, Buffer.from(asset.base64, 'base64'))
      for (const job of backup.jobs ?? []) this.#db.prepare('INSERT OR IGNORE INTO knowledge_jobs(document_id, operation) VALUES (?, ?)')
        .run(documentIds.get(job.documentId) ?? invalidBackup('job-document'), job.operation)
      for (const checkpoint of backup.checkpoints ?? []) this.#db.prepare('INSERT INTO compiler_checkpoints(document_id, payload) VALUES (?, ?)')
        .run(documentIds.get(checkpoint.documentId) ?? invalidBackup('checkpoint-document'), JSON.stringify(checkpoint.value))
      for (const topic of backup.topics ?? []) {
        const value = { ...topic, id: randomUUID(), sources: topic.sources.map(source => ({
          ...source, documentId: documentIds.get(source.documentId) ?? source.documentId,
        })) }
        this.#db.prepare('INSERT INTO knowledge_topics(id, knowledge_base_id, payload) VALUES (?, ?, ?)').run(value.id, baseId, JSON.stringify(value))
      }
    })
    return this.#requireBase(baseId)
  }

  #documentRows(ref: string): DocumentRow[] {
    const base = this.#requireBase(ref)
    return this.#db.prepare(`
      SELECT d.*, COUNT(c.id) AS chunk_count FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id WHERE d.knowledge_base_id = ?
      GROUP BY d.id ORDER BY d.imported_at DESC, d.id
    `).all(base.id) as DocumentRow[]
  }

  #documentRow(baseId: string, documentId: string): DocumentRow {
    const row = this.#db.prepare(`SELECT d.*, COUNT(c.id) AS chunk_count FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id WHERE d.knowledge_base_id = ? AND d.id = ? GROUP BY d.id`,
    ).get(baseId, documentId) as DocumentRow | undefined
    if (row === undefined) {
      throw new RemoteError('knowledge/document-not-found', `Knowledge document "${documentId}" was not found.`, { ref: baseId, documentId })
    }
    return row
  }

  async #processFile(
    baseId: string, documentId: string, file: DecodedKnowledgeFile, preserveReadyOnFailure: boolean,
  ): Promise<KnowledgeDocumentView> {
    this.#processing.add(documentId)
    try {
      this.#db.prepare('UPDATE documents SET progress = 30 WHERE id = ?').run(documentId)
      const extracted = await extractKnowledgeDocument(file, this.#extraction)
      const base = this.#requireBase(baseId)
      const revision = base.revision + 1
      const completedAt = new Date().toISOString()
      this.#transaction(() => {
        if (this.#documentRow(baseId, documentId).content_hash !== sha256(extracted.markdown)) this.#db.prepare('DELETE FROM compiler_checkpoints WHERE document_id = ?').run(documentId)
        this.#db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId)
        this.#db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId)
        this.#insertChunks(baseId, documentId, extracted.markdown)
        this.#db.prepare(`UPDATE documents SET content = ?, content_hash = ?, revision = ?, status = 'ready',
          progress = 100, error = NULL, extracted_chars = ? WHERE id = ?`).run(
          extracted.markdown, sha256(extracted.markdown), revision, extracted.extractedChars, documentId,
        )
        this.#db.prepare('UPDATE knowledge_bases SET revision = ?, updated_at = ? WHERE id = ?').run(revision, completedAt, baseId)
        this.finishJob(documentId, 'import')
      })
    } catch (error) {
      const message = processingError(error)
      this.#transaction(() => {
        if (preserveReadyOnFailure) {
          this.#db.prepare("UPDATE documents SET status = 'ready', progress = 100, error = ? WHERE id = ?")
            .run(`Reprocessing failed: ${message}`.slice(0, 500), documentId)
          return
        }
        this.#db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId)
        this.#db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId)
        this.#db.prepare("UPDATE documents SET content = '', content_hash = '', status = 'failed', progress = 35, error = ?, extracted_chars = 0 WHERE id = ?")
          .run(message, documentId)
      })
    } finally { this.#processing.delete(documentId) }
    return documentView(this.#documentRow(baseId, documentId))
  }

  #insertDocument(
    baseId: string, documentId: string, name: string, markdown: string, revision: number, importedAt: string,
    metadata: {
      originalName: string
      kind: KnowledgeDocumentKind
      sourceHash: string
      sizeBytes: number
      status: 'processing' | 'ready' | 'failed'
      progress: number
      error: string | null
      extractedChars: number
      rawContent: Uint8Array | null
    },
  ): void {
    const contentHash = metadata.status === 'ready' ? sha256(markdown) : ''
    this.#db.prepare(`INSERT INTO documents(
      id, knowledge_base_id, name, original_name, kind, source_hash, size_bytes,
      status, progress, error, extracted_chars, raw_content, content, content_hash, revision, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).run(
      documentId, baseId, name, metadata.originalName, metadata.kind, metadata.sourceHash, metadata.sizeBytes,
      metadata.status, metadata.progress, metadata.error, metadata.extractedChars,
      metadata.rawContent === null ? null : Buffer.from(metadata.rawContent), markdown, contentHash, revision, importedAt,
    )
    if (metadata.status === 'ready') this.#insertChunks(baseId, documentId, markdown)
  }

  #insertChunks(baseId: string, documentId: string, markdown: string): void {
    const chunks = chunkMarkdown(markdown)
    const insertChunk = this.#db.prepare(`INSERT INTO chunks(
      id, knowledge_base_id, document_id, ordinal, heading, start_line, end_line, content, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertFts = this.#db.prepare('INSERT INTO chunks_fts(chunk_id, knowledge_base_id, heading, content) VALUES (?, ?, ?, ?)')
    for (const [ordinal, chunk] of chunks.entries()) {
      const chunkId = randomUUID()
      insertChunk.run(
        chunkId, baseId, documentId, ordinal, chunk.heading,
        chunk.startLine, chunk.endLine, chunk.content, sha256(chunk.content),
      )
      insertFts.run(chunkId, baseId, chunk.heading, chunk.content)
    }
  }

  async #ensureSemanticIndex(baseId: string, signal?: AbortSignal): Promise<void> {
    const semantic = this.#semantic
    if (semantic === undefined) return
    const base = this.#requireBase(baseId)
    const existing = this.#semanticIndex(base.id)
    if (existing !== undefined
      && existing.source_revision === base.revision
      && existing.model === semantic.provider.model
      && existing.model_revision === semantic.provider.revision
      && existing.dimensions === semantic.provider.dimensions
      && existing.projection_version === 'document-heading-content-v1') return
    await this.#startSemanticBuild(base.id, signal)
  }

  async #startSemanticBuild(baseId: string, signal?: AbortSignal): Promise<void> {
    const inFlight = this.#semanticBuilds.get(baseId)
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    const build = this.#buildSemanticIndex(baseId, signal).finally(() => {
      if (this.#semanticBuilds.get(baseId) === build) this.#semanticBuilds.delete(baseId)
    })
    this.#semanticBuilds.set(baseId, build)
    await build
  }

  async #buildSemanticIndex(baseId: string, signal?: AbortSignal): Promise<void> {
    const semantic = this.#semantic
    if (semantic === undefined) return
    const base = this.#requireBase(baseId)
    const previous = this.#semanticIndex(base.id)
    const rows = this.#db.prepare(`
      SELECT c.*, kb.alias, kb.revision, d.name AS document_name
      FROM chunks c
      JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
      JOIN documents d ON d.id = c.document_id
      WHERE c.knowledge_base_id = ? ORDER BY c.document_id, c.ordinal
    `).all(base.id) as ChunkRow[]
    if (rows.length > semantic.maxScanChunks) throw new Error('Semantic index exceeds the configured scan limit.')
    const cached = new Map<string, Uint8Array>()
    if (previous !== undefined
      && previous.model === semantic.provider.model
      && previous.model_revision === semantic.provider.revision
      && previous.dimensions === semantic.provider.dimensions
      && previous.projection_version === 'document-heading-content-v1') {
      const cachedRows = this.#db.prepare(`SELECT chunk_id, content_hash, vector FROM chunk_embeddings
        WHERE knowledge_base_id = ? AND build_id = ?`).all(base.id, previous.active_build_id) as Array<{
        chunk_id: string
        content_hash: string
        vector: Uint8Array
      }>
      for (const row of cachedRows) {
        if (row.vector.byteLength === semantic.provider.dimensions * Float32Array.BYTES_PER_ELEMENT) {
          cached.set(`${row.chunk_id}:${row.content_hash}`, row.vector)
        }
      }
    }
    const buildId = randomUUID()
    try {
      for (let start = 0; start < rows.length; start += semantic.batchSize) {
        signal?.throwIfAborted()
        const batch = rows.slice(start, start + semantic.batchSize)
        const missing = batch.filter(row => !cached.has(`${row.id}:${row.content_hash}`))
        const vectors = missing.length === 0 ? [] : await semantic.provider.embed(
          missing.map(row => semanticPassage(row, semantic.projectionMaxChars)), signal,
        )
        if (vectors.length !== missing.length) throw new Error('Embedding provider returned an incomplete batch.')
        const generated = new Map<string, Uint8Array>()
        missing.forEach((row, index) => {
          const vector = vectors[index]
          if (vector === undefined || vector.length !== semantic.provider.dimensions) {
            throw new Error(`Embedding provider must return ${semantic.provider.dimensions} dimensions.`)
          }
          generated.set(row.id, encodeVector(vector))
        })
        this.#transaction(() => {
          const insert = this.#db.prepare(`INSERT INTO chunk_embeddings(
            build_id, knowledge_base_id, chunk_id, content_hash, vector
          ) VALUES (?, ?, ?, ?, ?)`)
          batch.forEach((row) => {
            const vector = cached.get(`${row.id}:${row.content_hash}`) ?? generated.get(row.id)
            if (vector === undefined) throw new Error('Semantic build is missing a chunk vector.')
            insert.run(buildId, base.id, row.id, row.content_hash, vector)
          })
        })
      }
      const current = this.#requireBase(base.id)
      if (current.revision !== base.revision) throw new Error('Knowledge revision changed while building the semantic index.')
      const builtAt = new Date().toISOString()
      this.#transaction(() => {
        this.#db.prepare(`INSERT INTO semantic_indexes(
          knowledge_base_id, active_build_id, model, model_revision, dimensions,
          projection_version, source_revision, chunk_count, built_at
        ) VALUES (?, ?, ?, ?, ?, 'document-heading-content-v1', ?, ?, ?)
        ON CONFLICT(knowledge_base_id) DO UPDATE SET
          active_build_id = excluded.active_build_id, model = excluded.model,
          model_revision = excluded.model_revision, dimensions = excluded.dimensions,
          projection_version = excluded.projection_version, source_revision = excluded.source_revision,
          chunk_count = excluded.chunk_count, built_at = excluded.built_at`).run(
          base.id, buildId, semantic.provider.model, semantic.provider.revision,
          semantic.provider.dimensions, base.revision, rows.length, builtAt,
        )
        this.#db.prepare('DELETE FROM chunk_embeddings WHERE knowledge_base_id = ? AND build_id <> ?')
          .run(base.id, buildId)
      })
    } catch (error) {
      this.#db.prepare('DELETE FROM chunk_embeddings WHERE build_id = ?').run(buildId)
      throw error
    }
  }

  #semanticIndex(baseId: string): SemanticIndexRow | undefined {
    return this.#db.prepare('SELECT * FROM semantic_indexes WHERE knowledge_base_id = ?')
      .get(baseId) as SemanticIndexRow | undefined
  }

  #base(ref: string): KnowledgeBaseView | undefined {
    const row = this.#db.prepare(`
      SELECT kb.*, COUNT(DISTINCT d.id) AS document_count, COUNT(DISTINCT c.id) AS chunk_count
      FROM knowledge_bases kb LEFT JOIN documents d ON d.knowledge_base_id = kb.id
      LEFT JOIN chunks c ON c.knowledge_base_id = kb.id
      WHERE kb.id = ? OR kb.alias = ? GROUP BY kb.id
    `).get(ref, ref) as BaseRow | undefined
    return row === undefined ? undefined : baseView(row)
  }

  #requireBase(ref: string): KnowledgeBaseView {
    const base = this.#base(ref)
    if (base === undefined) throw new RemoteError('knowledge/not-found', `Knowledge base "${ref}" was not found.`, { ref })
    return base
  }

  #requireActive(base: KnowledgeBaseView, operation: string): void {
    if (base.status === 'archived') {
      throw new RemoteError('knowledge/archived', `Archived knowledge base "${base.alias}" cannot ${operation}.`, { ref: base.alias, operation })
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.#db.exec('COMMIT')
      return value
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  #migrate(): void {
    const current = (this.#db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (current > SCHEMA_VERSION) {
      throw new Error(`knowledge: database schema ${current} is newer than supported schema ${SCHEMA_VERSION}`)
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases(
        id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','archived')),
        revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS documents(
        id TEXT PRIMARY KEY, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        name TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'md',
        source_hash TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready', progress INTEGER NOT NULL DEFAULT 100, error TEXT,
        extracted_chars INTEGER NOT NULL DEFAULT 0, raw_content BLOB,
        content TEXT NOT NULL, content_hash TEXT NOT NULL,
        revision INTEGER NOT NULL, imported_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chunks(
        id TEXT PRIMARY KEY, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, heading TEXT NOT NULL, start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
        UNIQUE(document_id, ordinal)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS document_compilations(
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS knowledge_turns(
        id INTEGER PRIMARY KEY, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        question TEXT NOT NULL, answer TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS knowledge_turns_base ON knowledge_turns(knowledge_base_id, id);
      CREATE TABLE IF NOT EXISTS compiler_checkpoints(
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS knowledge_assets(
        knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        hash TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(knowledge_base_id, hash)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS knowledge_jobs(
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, operation TEXT NOT NULL,
        PRIMARY KEY(document_id, operation)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS knowledge_topics(
        id TEXT PRIMARY KEY, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE, payload TEXT NOT NULL
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED, knowledge_base_id UNINDEXED, heading, content, tokenize='unicode61'
      );
      CREATE TABLE IF NOT EXISTS semantic_indexes(
        knowledge_base_id TEXT PRIMARY KEY REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        active_build_id TEXT NOT NULL, model TEXT NOT NULL, model_revision TEXT NOT NULL,
        dimensions INTEGER NOT NULL, projection_version TEXT NOT NULL,
        source_revision INTEGER NOT NULL, chunk_count INTEGER NOT NULL, built_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chunk_embeddings(
        build_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL, vector BLOB NOT NULL,
        PRIMARY KEY(build_id, chunk_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS chunk_embeddings_build ON chunk_embeddings(knowledge_base_id, build_id);
    `)
    const columns = new Set((this.#db.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>).map(row => row.name))
    const migrations: Array<[string, string]> = [
      ['original_name', "TEXT NOT NULL DEFAULT ''"], ['kind', "TEXT NOT NULL DEFAULT 'md'"],
      ['source_hash', "TEXT NOT NULL DEFAULT ''"], ['size_bytes', 'INTEGER NOT NULL DEFAULT 0'],
      ['status', "TEXT NOT NULL DEFAULT 'ready'"], ['progress', 'INTEGER NOT NULL DEFAULT 100'],
      ['error', 'TEXT'], ['extracted_chars', 'INTEGER NOT NULL DEFAULT 0'], ['raw_content', 'BLOB'],
    ]
    const addedRawContent = !columns.has('raw_content')
    for (const [name, definition] of migrations) {
      if (!columns.has(name)) this.#db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`)
    }
    this.#db.exec(`
      UPDATE documents SET original_name = name WHERE original_name = '';
      UPDATE documents SET source_hash = content_hash WHERE source_hash = '';
      UPDATE documents SET size_bytes = length(CAST(content AS BLOB)) WHERE size_bytes = 0;
      UPDATE documents SET extracted_chars = length(content) WHERE extracted_chars = 0 AND content <> '';
      UPDATE documents SET status = 'failed', progress = 35,
        error = 'Processing was interrupted before completion.' WHERE status = 'processing';
    `)
    if (addedRawContent) {
      this.#db.exec("UPDATE documents SET raw_content = CAST(content AS BLOB) WHERE kind = 'md' AND content <> ''")
    }
    this.#db.exec(`DELETE FROM chunk_embeddings
      WHERE build_id NOT IN (SELECT active_build_id FROM semantic_indexes)`)
    this.#db.exec("UPDATE knowledge_turns SET status = 'cancelled' WHERE status = 'running'")
    if (current < 5) {
      this.#transaction(() => {
        const sources = this.#db.prepare("SELECT id, knowledge_base_id, content FROM documents WHERE status = 'ready'").all() as Array<{ id: string; knowledge_base_id: string; content: string }>
        this.#db.exec('DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM semantic_indexes; DELETE FROM chunk_embeddings;')
        for (const source of sources) this.#insertChunks(source.knowledge_base_id, source.id, source.content)
        this.#db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      })
    }
    this.#db.exec('UPDATE document_compilations SET payload = json_set(payload, \'$.status\', \'cancelled\', \'$.error\', \'Compilation was interrupted before completion.\') WHERE json_extract(payload, \'$.status\') = \'running\'')
  }
}

function answerFromHits(
  question: string,
  hits: readonly KnowledgeSearchHit[],
  retrieval?: KnowledgeRetrievalView,
): KnowledgeAnswerView {
  if (hits.length === 0) {
    return {
      status: 'no-evidence', requestedMode: 'local', mode: 'local-extractive', question,
      answer: '', confidence: 'none', citations: [], generation: null,
      ...(retrieval === undefined ? {} : { retrieval }),
    }
  }
  const citations = hits.map((hit, index) => ({
    id: index + 1, documentId: hit.documentId, documentName: hit.documentName, heading: hit.heading,
    startLine: hit.startLine, endLine: hit.endLine, content: hit.content, contentHash: hit.contentHash,
  }))
  return {
    status: 'answered', requestedMode: 'local', mode: 'local-extractive', question,
    answer: citations.map(citation => `[${citation.id}] ${citation.content}`).join('\n\n'),
    confidence: 'low', citations,
    generation: null, ...(retrieval === undefined ? {} : { retrieval }),
  }
}

function requiredText(value: string, field: string, max: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) {
    throw new RemoteError('knowledge/invalid-input', `${field} must contain 1-${max} characters.`, { field, reason: 'size' })
  }
  return normalized
}

function validMarkdown(markdown: string): string {
  if (markdown.length === 0 || markdown.length > MAX_DOCUMENT_CHARS) {
    throw new RemoteError('knowledge/invalid-input', `Markdown must contain 1-${MAX_DOCUMENT_CHARS} characters.`, { field: 'markdown', reason: 'size' })
  }
  return markdown.replace(/\r\n?/g, '\n')
}

function normalizeAlias(value: string): string {
  const alias = value.trim().toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(alias)) {
    throw new RemoteError('knowledge/invalid-input', 'alias must use lowercase letters, digits, and internal hyphens.', { field: 'alias', reason: 'format' })
  }
  return alias
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

function sha256Bytes(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }

function baseView(row: BaseRow): KnowledgeBaseView {
  return { id: row.id, alias: row.alias, name: row.name, status: row.status, revision: row.revision,
    documentCount: row.document_count, chunkCount: row.chunk_count, createdAt: row.created_at, updatedAt: row.updated_at }
}

function documentView(row: DocumentRow): KnowledgeDocumentView {
  return { id: row.id, knowledgeBaseId: row.knowledge_base_id, name: row.name,
    originalName: row.original_name, kind: row.kind, sourceHash: row.source_hash, sizeBytes: row.size_bytes,
    status: row.status, progress: row.progress, error: row.error, extractedChars: row.extracted_chars, contentHash: row.content_hash,
    revision: row.revision, chunkCount: row.chunk_count, importedAt: row.imported_at }
}

function processingStages(row: DocumentRow): KnowledgeDocumentDetailValue['stages'] {
  const definitions = [
    { key: 'upload' as const, threshold: 10, message: 'Source bytes persisted locally.' },
    { key: 'parse' as const, threshold: 40, message: 'Text extracted into normalized Markdown.' },
    { key: 'segment' as const, threshold: 70, message: 'Markdown split into evidence chunks.' },
    { key: 'index' as const, threshold: 90, message: 'Evidence chunks written to the local full-text index.' },
    { key: 'complete' as const, threshold: 100, message: 'Document is ready for Wiki, graph, search, and QA.' },
  ]
  return definitions.map((stage) => {
    if (row.status === 'ready') return { key: stage.key, status: 'done' as const, progress: stage.threshold, message: stage.message }
    if (row.status === 'failed' && stage.key === 'parse') {
      return { key: stage.key, status: 'failed' as const, progress: row.progress, message: row.error ?? 'Source processing failed.' }
    }
    if (row.progress >= stage.threshold) return { key: stage.key, status: 'done' as const, progress: stage.threshold, message: stage.message }
    if (row.status === 'processing' && stage.key === 'parse') {
      return { key: stage.key, status: 'running' as const, progress: row.progress, message: 'Extracting source text.' }
    }
    return { key: stage.key, status: 'pending' as const, progress: 0, message: stage.message }
  })
}

function processingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/gu, ' ').trim().slice(0, 500) || 'Source processing failed.'
}

function searchHit(row: ChunkRow): KnowledgeSearchHit {
  return { knowledgeBaseId: row.knowledge_base_id, knowledgeBaseAlias: row.alias, revision: row.revision,
    documentId: row.document_id, documentName: row.document_name, chunkId: row.id, heading: row.heading,
    startLine: row.start_line, endLine: row.end_line, content: row.content, contentHash: row.content_hash }
}

function semanticPassage(row: ChunkRow, maxChars: number): string {
  return `passage: ${row.document_name}\n${row.heading}\n${row.content}`.slice(0, maxChars)
}

function selectDiverseHits(
  candidates: readonly KnowledgeSearchHit[],
  limit: number,
  maxPerDocument: number,
): KnowledgeSearchHit[] {
  const selected: KnowledgeSearchHit[] = []
  const deferred: KnowledgeSearchHit[] = []
  const perDocument = new Map<string, number>()
  for (const candidate of candidates) {
    const count = perDocument.get(candidate.documentId) ?? 0
    if (count >= maxPerDocument) {
      deferred.push(candidate)
      continue
    }
    selected.push(candidate)
    perDocument.set(candidate.documentId, count + 1)
    if (selected.length === limit) break
  }
  if (selected.length < limit) selected.push(...deferred.slice(0, limit - selected.length))
  return selected.slice(0, limit)
}

function compileWikiPage(row: DocumentRow, includeSections: boolean): KnowledgeWikiPageView {
  const sections = compileSections(row)
  const guide = academicGuide(row.content, CHUNK_CHAR_LIMIT)
  const firstHeading = sections.find(section => section.heading !== 'Document')?.heading
  const title = firstHeading === undefined || /^Page\s+\d+$/iu.test(firstHeading) ? fileStem(row.name) : firstHeading
  const abstract = guide.find(excerpt => excerpt.role === 'abstract')?.content
    .replace(/^(?:#{1,6}\s*)?(?:abstract|summary|摘要)\s*[:：—–-]?\s*/iu, '').replace(/\s+/gu, ' ').slice(0, 240)
  const summary = abstract ?? sections.flatMap(section => section.content.split('\n'))
    .map(line => line.replace(/^\s*(?:[-*>]|\d+\.)\s*/u, '').trim())
    .find(line => /[\p{L}\p{N}]/u.test(line))?.slice(0, 240) ?? ''
  const type = wikiPageType(`${title} ${row.name}`)
  const topic = sections.find(section => section.level > 1)?.heading ?? title
  return {
    id: `page:${row.id}`, slug: `${slug(fileStem(row.name))}-${row.id.slice(0, 8)}`, title, summary,
    type, topic, documentId: row.id, documentName: row.name, revision: row.revision, contentHash: row.content_hash,
    sources: sections.map(section => ({
      documentId: row.id,
      documentName: row.name,
      startLine: section.startLine,
      endLine: section.endLine,
      contentHash: section.contentHash,
    })),
    links: [],
    sections: includeSections ? sections : [],
    academicGuide: guide,
  }
}

function resolveWikiLinks(pages: readonly KnowledgeWikiPageView[]): KnowledgeWikiPageView[] {
  const targets = new Map<string, KnowledgeWikiPageView>()
  for (const page of pages) {
    for (const target of [page.slug, page.title, page.documentName, fileStem(page.documentName)]) {
      targets.set(target.toLocaleLowerCase(), page)
    }
  }
  return pages.map((page) => {
    const linked = new Map<string, KnowledgeWikiPageView>()
    for (const targetText of page.sections.flatMap(section => wikiLinks(section.content))) {
      const target = targets.get(targetText.toLocaleLowerCase())
      if (target !== undefined && target.id !== page.id) linked.set(target.id, target)
    }
    return {
      ...page,
      links: [...linked.values()].map(target => ({ slug: target.slug, title: target.title, type: target.type })),
    }
  })
}

function wikiPageType(value: string): KnowledgeWikiPageType {
  if (/(?:policy|rule|regulation|standard|制度|规定|规则|规范)/iu.test(value)) return 'policy'
  if (/(?:procedure|process|workflow|runbook|guide|操作|流程|步骤|指引|指南)/iu.test(value)) return 'procedure'
  if (/(?:reference|appendix|catalog|index|清单|索引|附录|参考)/iu.test(value)) return 'reference'
  return 'concept'
}

function wikiTypeCounts(pages: readonly KnowledgeWikiPageView[]): Record<KnowledgeWikiPageType, number> {
  const counts: Record<KnowledgeWikiPageType, number> = { policy: 0, procedure: 0, reference: 0, concept: 0 }
  for (const page of pages) counts[page.type] += 1
  return counts
}

function retrievalTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLocaleLowerCase()
  const terms = new Set(normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [])
  // Preserve Latin identifiers and years adjoining Chinese text (for example, "Forman2022论文").
  for (const part of normalized.split(/\p{Script=Han}+/u)) {
    for (const term of part.match(/[\p{L}\p{N}_-]+/gu) ?? []) terms.add(term)
  }
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2))
  }
  return [...terms].filter(Boolean).slice(0, 32)
}

const HAN_TEXT = /\p{Script=Han}/u

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function retrievalScore(
  row: ChunkRow,
  query: string,
  terms: readonly string[],
  config: KnowledgeRankingConfig,
): number {
  const phrase = query.normalize('NFKC').toLocaleLowerCase()
  const name = row.document_name.normalize('NFKC').toLocaleLowerCase()
  const heading = row.heading.normalize('NFKC').toLocaleLowerCase()
  const content = row.content.normalize('NFKC').toLocaleLowerCase()
  let score = (name.includes(phrase) || heading.includes(phrase) || content.includes(phrase))
    ? config.exactPhraseWeight
    : 0
  for (const term of terms) {
    score += occurrences(name, term) * config.documentNameWeight
    score += occurrences(heading, term) * config.headingWeight
    score += Math.log2(1 + occurrences(content, term)) * config.contentWeight
  }
  return score
}

function occurrences(value: string, term: string): number {
  let count = 0
  let offset = 0
  while (term.length > 0 && (offset = value.indexOf(term, offset)) >= 0) {
    count += 1
    offset += term.length
  }
  return count
}

function compileSections(row: DocumentRow): KnowledgeWikiSectionView[] {
  const lines = row.content.split('\n')
  const sections: KnowledgeWikiSectionView[] = []
  let heading = 'Document'
  let level = 1
  let headingLine = 1
  let started = false
  let buffer: string[] = []
  const flush = (endLine: number): void => {
    const content = buffer.join('\n').trim()
    if (content.length > 0 || started) {
      sections.push({
        id: `section:${row.id}:${sections.length}`, heading, level, startLine: headingLine,
        endLine: Math.max(headingLine, endLine), content, contentHash: sha256(content),
      })
    }
    buffer = []
  }
  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (match === null) {
      buffer.push(line)
      continue
    }
    if (started || buffer.some(candidate => candidate.trim().length > 0)) flush(index)
    heading = match[2]?.trim() ?? 'Document'
    level = match[1]?.length ?? 1
    headingLine = index + 1
    started = true
  }
  flush(lines.length)
  return sections.length > 0 ? sections : [{
    id: `section:${row.id}:0`, heading: fileStem(row.name), level: 1, startLine: 1,
    endLine: lines.length, content: row.content, contentHash: sha256(row.content),
  }]
}

function graphEdge(index: number, source: string, target: string, relation: KnowledgeGraphEdgeView['relation'], label: string): KnowledgeGraphEdgeView {
  const weights: Record<KnowledgeGraphEdgeView['relation'], number> = {
    'links-to': 2, 'has-source': 1.3, 'has-topic': 1.3, 'has-type': 0.6, contains: 1, next: 0.8,
  }
  return { id: `edge:${index}`, source, target, relation, label, weight: weights[relation] }
}

function wikiLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu)].map(match => match[1]?.trim() ?? '').filter(Boolean)
}

function fileStem(name: string): string { return name.replace(/\.[^.]+$/u, '') }

function slug(value: string): string {
  const normalized = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
  return normalized.length > 0 ? normalized.slice(0, 64) : 'page'
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000
}

const EVALUATION_METRICS: readonly KnowledgeEvaluationMetric[] = [
  'answer-completed', 'retrieval-hit', 'evidence-coverage', 'citation-valid',
  'answer-faithful', 'no-answer-honest', 'input-robust',
]

function evaluationScores(
  candidate: Pick<KnowledgeEvaluationCaseResult, 'expectedStatus' | 'expectedTerms' | 'expectedDocumentNames' | 'kind'>,
  answer: KnowledgeAnswerView,
  matchedTerms: readonly string[],
  documentNames: readonly string[],
): KnowledgeEvaluationScore[] {
  const statusMatches = answer.status === candidate.expectedStatus
  const answerCompleted = candidate.expectedStatus === 'answered'
    ? statusMatches && answer.answer.length > 0 && answer.citations.length > 0
    : statusMatches && answer.answer.length === 0 && answer.citations.length === 0
  const expectedDocuments = new Set(candidate.expectedDocumentNames.map(name => name.toLocaleLowerCase()))
  const actualDocuments = new Set(documentNames.map(name => name.toLocaleLowerCase()))
  const usedIds = new Set([...answer.answer.matchAll(/\[(\d+)\]/gu)].map(match => Number(match[1])))
  const citationIds = new Set(answer.citations.map(citation => citation.id))
  const citationReconciled = usedIds.size === citationIds.size
    && [...usedIds].every(id => citationIds.has(id))
  const validCitations = answer.citations.every(citation => citation.contentHash === sha256(citation.content))
  const score = (key: KnowledgeEvaluationMetric, value: boolean | null, comment: string): KnowledgeEvaluationScore => ({
    key, score: value === null ? null : value ? 1 : 0, comment,
  })
  return [
    score('answer-completed', answerCompleted, answerCompleted ? 'expected answer state completed' : 'answer state did not match expectation'),
    score('retrieval-hit', expectedDocuments.size === 0 ? null : [...expectedDocuments].every(name => actualDocuments.has(name)),
      expectedDocuments.size === 0 ? 'not applicable' : 'expected source documents checked'),
    score('evidence-coverage', candidate.expectedStatus !== 'answered' || candidate.expectedTerms.length === 0
      ? null : matchedTerms.length === candidate.expectedTerms.length,
    candidate.expectedTerms.length === 0 ? 'not applicable' : 'expected evidence terms checked'),
    score('citation-valid', answer.status !== 'answered' ? null : validCitations,
      answer.status !== 'answered' ? 'not applicable' : 'citation hashes checked'),
    score('answer-faithful', answer.status !== 'answered' ? null : citationReconciled,
      answer.status !== 'answered' ? 'not applicable' : 'answer markers reconciled with citations'),
    score('no-answer-honest', candidate.expectedStatus !== 'no-evidence' ? null : answer.status === 'no-evidence' && answer.answer.length === 0,
      candidate.expectedStatus !== 'no-evidence' ? 'not applicable' : 'no-evidence behavior checked'),
    score('input-robust', candidate.kind === 'adversarial' ? statusMatches : true,
      candidate.kind === 'adversarial' ? 'adversarial input status checked' : 'case completed without an exception'),
  ]
}

function evaluatedCase(
  candidate: NormalizedEvaluationCase,
  answer: KnowledgeAnswerView,
  queryLatencyMs: number,
): KnowledgeEvaluationCaseResult {
  const searchable = `${answer.answer}\n${answer.citations.map(citation => citation.content).join('\n')}`.toLocaleLowerCase()
  const matchedTerms = candidate.expectedTerms.filter(term => searchable.includes(term.toLocaleLowerCase()))
  const documentNames = [...new Set(answer.citations.map(citation => citation.documentName))]
  const expectedDocuments = new Set(candidate.expectedDocumentNames.map(name => name.toLocaleLowerCase()))
  const rankedDocuments = answer.citations.map(citation => citation.documentName.toLocaleLowerCase())
  const matchedDocuments = [...expectedDocuments].filter(name => rankedDocuments.includes(name))
  const firstExpectedRank = rankedDocuments.findIndex(name => expectedDocuments.has(name))
  const scores = evaluationScores(candidate, answer, matchedTerms, documentNames)
  return {
    ...candidate, matchedTerms, answered: answer.status === 'answered', citationCount: answer.citations.length,
    documentNames,
    recallAt10: expectedDocuments.size === 0 ? null : round(matchedDocuments.length / expectedDocuments.size),
    reciprocalRankAt10: expectedDocuments.size === 0 ? null : firstExpectedRank < 0 ? 0 : round(1 / (firstExpectedRank + 1)),
    queryLatencyMs: Math.max(0, round(queryLatencyMs)),
    retrieval: answer.retrieval ?? {
      requestedMode: 'lexical', actualMode: 'lexical', semanticIndexRevision: null,
      semanticCandidateCount: 0, fallbackReason: 'semantic-disabled',
    },
    scores, error: null, passed: scores.every(score => score.score === null || score.score === 1),
  }
}

function failedEvaluationCase(
  candidate: NormalizedEvaluationCase,
  queryLatencyMs: number,
  requestedMode: 'lexical' | 'hybrid',
): KnowledgeEvaluationCaseResult {
  const scores = EVALUATION_METRICS.map((key): KnowledgeEvaluationScore => ({
    key, score: key === 'no-answer-honest' ? null : 0, comment: 'case failed safely',
  }))
  return {
    ...candidate, matchedTerms: [], answered: false, citationCount: 0, documentNames: [],
    recallAt10: candidate.expectedDocumentNames.length === 0 ? null : 0,
    reciprocalRankAt10: candidate.expectedDocumentNames.length === 0 ? null : 0,
    queryLatencyMs: Math.max(0, round(queryLatencyMs)),
    retrieval: {
      requestedMode, actualMode: 'lexical', semanticIndexRevision: null,
      semanticCandidateCount: 0,
      fallbackReason: requestedMode === 'hybrid' ? 'semantic-unavailable' : 'semantic-disabled',
    },
    scores, error: 'case-error', passed: false,
  }
}

function evaluationMetricDeltas(
  before: KnowledgeEvaluationProfileReport,
  after: KnowledgeEvaluationProfileReport,
): Record<KnowledgeEvaluationMetric, number | null> {
  return Object.fromEntries(EVALUATION_METRICS.map((metric) => {
    const left = before.metricMeans[metric]
    const right = after.metricMeans[metric]
    return [metric, left.n === 0 || right.n === 0 ? null : round(right.mean - left.mean)]
  })) as Record<KnowledgeEvaluationMetric, number | null>
}

function evaluationProfile(
  profile: KnowledgeEvaluationProfileReport['profile'],
  results: readonly KnowledgeEvaluationCaseResult[],
): KnowledgeEvaluationProfileReport {
  const metricMeans = Object.fromEntries(EVALUATION_METRICS.map((metric) => {
    const values = results.flatMap(result => result.scores)
      .filter(score => score.key === metric && score.score !== null)
      .map(score => score.score as number)
    const mean = values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length)
    return [metric, { mean, n: values.length }]
  })) as Record<KnowledgeEvaluationMetric, { mean: number; n: number }>
  const applicable = Object.values(metricMeans).filter(metric => metric.n > 0)
  const recallValues = results.flatMap(result => result.recallAt10 === null ? [] : [result.recallAt10])
  const reciprocalRanks = results.flatMap(result => result.reciprocalRankAt10 === null ? [] : [result.reciprocalRankAt10])
  return {
    profile,
    totalScore: applicable.length === 0 ? 0 : round((applicable.reduce((sum, metric) => sum + metric.mean, 0) / applicable.length) * 100),
    passed: results.filter(result => result.passed).length,
    recallAt10: recallValues.length === 0 ? null : round(recallValues.reduce((sum, value) => sum + value, 0) / recallValues.length),
    mrrAt10: reciprocalRanks.length === 0 ? null : round(reciprocalRanks.reduce((sum, value) => sum + value, 0) / reciprocalRanks.length),
    meanQueryLatencyMs: results.length === 0 ? 0 : round(results.reduce((sum, result) => sum + result.queryLatencyMs, 0) / results.length),
    metricMeans,
    results,
  }
}

function round(value: number): number { return Math.round(value * 10_000) / 10_000 }

function parseBackup(jsonInput: string): Backup {
  if (jsonInput.length === 0 || jsonInput.length > MAX_COMPLETE_PACKED_CHARS) invalidBackup('size')
  let parsed: unknown
  try { parsed = JSON.parse(jsonInput) } catch { invalidBackup('json') }
  let complete = false
  if (record(parsed) && parsed.format === 'knowledge-complete-gzip-v1') {
    if (typeof parsed.data !== 'string' || typeof parsed.sha256 !== 'string') invalidBackup('complete-envelope')
    try {
      const decoded = gunzipSync(Buffer.from(parsed.data, 'base64'), { maxOutputLength: MAX_COMPLETE_BYTES }).toString('utf8')
      if (sha256(decoded) !== parsed.sha256) invalidBackup('complete-hash')
      parsed = JSON.parse(decoded); complete = true
    } catch { invalidBackup('complete-payload') }
  }
  if (!complete && jsonInput.length > MAX_BACKUP_CHARS) invalidBackup('size')
  if (!record(parsed) || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3
    && !(complete && parsed.schemaVersion === 4))
    || !record(parsed.knowledgeBase) || !Array.isArray(parsed.documents)) {
    invalidBackup('schema')
  }
  const schemaVersion = parsed.schemaVersion
  const knowledgeBase = parsed.knowledgeBase
  if (typeof knowledgeBase.alias !== 'string' || typeof knowledgeBase.name !== 'string'
    || (knowledgeBase.status !== 'active' && knowledgeBase.status !== 'archived')
    || !Number.isSafeInteger(knowledgeBase.revision) || (knowledgeBase.revision as number) < 0) invalidBackup('knowledge-base')
  const alias = normalizeAlias(knowledgeBase.alias)
  const name = requiredText(knowledgeBase.name, 'name', 120)
  const documentsInput: unknown[] = parsed.documents
  const documents = documentsInput.map((candidate): BackupDocument => {
    if (!record(candidate) || typeof candidate.name !== 'string' || typeof candidate.markdown !== 'string'
      || typeof candidate.contentHash !== 'string' || typeof candidate.importedAt !== 'string'
      || !Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < (schemaVersion >= 2 ? 0 : 1)) invalidBackup('document')
    const status = schemaVersion >= 2 && candidate.status === 'failed' ? 'failed' : 'ready'
    const markdown = status === 'failed' && candidate.markdown.length === 0 ? '' : validMarkdown(candidate.markdown)
    if ((markdown.length === 0 ? '' : sha256(markdown)) !== candidate.contentHash) invalidBackup('content-hash')
    if (Number.isNaN(Date.parse(candidate.importedAt))) invalidBackup('imported-at')
    const name = requiredText(candidate.name, 'name', 240)
    let originalName = name
    let kind: KnowledgeDocumentKind = 'md'
    let sourceHash = candidate.contentHash
    let sizeBytes = Buffer.byteLength(candidate.markdown, 'utf8')
    let error: string | null = null
    let extractedChars = markdown.length
    if (schemaVersion >= 2) {
      if (typeof candidate.originalName !== 'string'
        || (candidate.kind !== 'pdf' && candidate.kind !== 'docx' && candidate.kind !== 'md' && candidate.kind !== 'txt'
          && candidate.kind !== 'xlsx' && candidate.kind !== 'html')
        || typeof candidate.sourceHash !== 'string' || !/^[a-f\d]{64}$/u.test(candidate.sourceHash)
        || !Number.isSafeInteger(candidate.sizeBytes) || (candidate.sizeBytes as number) < 0
        || (candidate.status !== 'ready' && candidate.status !== 'failed')
        || (candidate.error !== null && typeof candidate.error !== 'string')
        || !Number.isSafeInteger(candidate.extractedChars) || (candidate.extractedChars as number) < 0) invalidBackup('document-metadata')
      originalName = requiredText(candidate.originalName, 'originalName', 240)
      kind = candidate.kind
      sourceHash = candidate.sourceHash
      sizeBytes = candidate.sizeBytes as number
      error = candidate.error
      extractedChars = candidate.extractedChars as number
      if ((status === 'ready' && extractedChars !== markdown.length) || (status === 'failed' && extractedChars !== 0)) {
        invalidBackup('extracted-chars')
      }
    }
    let compilation: BackupDocument['compilation']
    if (schemaVersion >= 3 && candidate.compilation !== undefined) {
      if (!record(candidate.compilation)) invalidBackup('compilation')
      const result = compilationSchema.nullable().safeParse(candidate.compilation.publication)
      const pages = visionPageSchema.array().safeParse(candidate.compilation.vision)
      const reviews = gapReviewsSchema.safeParse(candidate.compilation.gapReviews ?? [])
      if (!result.success || !pages.success || !reviews.success) invalidBackup('compilation-schema')
      if (new Set(reviews.data.map(item => item.index)).size !== reviews.data.length
        || reviews.data.some(item => item.index >= (result.data?.gaps.length ?? 0))) invalidBackup('compilation-reviews')
      if (result.data !== null && !validCompilation(result.data, { name, sourceHash, contentHash: candidate.contentHash, content: markdown }, pages.data)) invalidBackup('compilation-source')
      compilation = { publication: result.data, vision: pages.data, gapReviews: reviews.data }
    }
    return {
      ...(schemaVersion === 4 ? (() => {
        if (typeof candidate.id !== 'string' || typeof candidate.rawBase64 !== 'string') invalidBackup('original-missing')
        const raw = Buffer.from(candidate.rawBase64, 'base64')
        if (raw.toString('base64') !== candidate.rawBase64 || raw.length !== sizeBytes || sha256Bytes(raw) !== sourceHash) invalidBackup('original-hash')
        return { id: candidate.id, rawBase64: candidate.rawBase64 }
      })() : {}),
      name, originalName, kind, sourceHash, sizeBytes,
      ...(compilation === undefined ? {} : { compilation }),
      status, error, extractedChars, markdown, contentHash: candidate.contentHash,
      revision: candidate.revision as number, importedAt: candidate.importedAt,
    }
  })
  const turns = schemaVersion === 4 ? backupTurnsSchema.parse(parsed.turns ?? []) : undefined
  const jobs = schemaVersion === 4 ? z.array(z.object({ documentId: z.string(), operation: z.enum(['import', 'compile']) }).strict()).parse(parsed.jobs ?? []) : undefined
  const checkpoints = schemaVersion === 4
    ? z.array(z.object({ documentId: z.string(), value: checkpointSchema }).strict()).parse(parsed.checkpoints ?? []) : undefined
  const topics = schemaVersion === 4 ? z.array(topicSchema).parse(parsed.topics ?? []) : undefined
  for (const job of jobs ?? []) if (!documents.some(document => document.id === job.documentId)) invalidBackup('job-document')
  if (new Set(checkpoints?.map(item => item.documentId)).size !== (checkpoints?.length ?? 0)) invalidBackup('duplicate-checkpoint')
  for (const checkpoint of checkpoints ?? []) {
    const document = documents.find(item => item.id === checkpoint.documentId)
    if (!document) invalidBackup('checkpoint-document')
    for (const fact of checkpoint.value.facts) {
      const source = fact.visionPage === null ? document.markdown
        : document.compilation?.vision.find(page => page.page === fact.visionPage && page.reviewed)?.text
      if (source?.slice(fact.startOffset, fact.endOffset) !== fact.quote || sha256(fact.quote) !== fact.sourceHash) invalidBackup('checkpoint-evidence')
    }
  }
  for (const topic of topics ?? []) {
    checkTopicClaims(topic)
    if (topic.sources.some(source => sha256(source.content) !== source.contentHash)) invalidBackup('topic-evidence')
  }
  const assets = schemaVersion === 4
    ? z.array(z.object({ hash: z.string().regex(/^[a-f\d]{64}$/u), base64: z.string() }).strict()).parse(parsed.assets ?? []) : undefined
  for (const asset of assets ?? []) if (sha256Bytes(Buffer.from(asset.base64, 'base64')) !== asset.hash) invalidBackup('image-hash')
  if (schemaVersion === 4) {
    for (const turn of (turns ?? []) as NonNullable<Backup['turns']>) {
      if (turn.answer?.citations.some(citation => citation.vision && !assets?.some(asset => asset.hash === citation.vision?.imageHash))) {
        invalidBackup('historical-image-missing')
      }
    }
    if (new Set(documents.map(document => document.id)).size !== documents.length) invalidBackup('duplicate-document-id')
    for (const document of documents) {
      const images = [...(document.compilation?.vision ?? []), ...(document.compilation?.publication?.visionSources ?? [])]
      if (images.some(image => !assets?.some(asset => asset.hash === image.imageHash))) invalidBackup('image-missing')
    }
  }
  return {
    ...(turns === undefined ? {} : { turns: turns as NonNullable<Backup['turns']> }),
    ...(assets === undefined ? {} : { assets }),
    ...(jobs === undefined ? {} : { jobs }), ...(checkpoints === undefined ? {} : { checkpoints }),
    ...(topics === undefined ? {} : { topics }),
    schemaVersion,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    knowledgeBase: {
      alias, name, status: knowledgeBase.status, revision: knowledgeBase.revision as number,
    },
    documents,
  }
}

const backupTurnsSchema = z.array(z.object({
  question: z.string().min(1).max(500), status: z.enum(['complete', 'cancelled', 'failed']),
  revision: z.number().int().nonnegative(), createdAt: z.iso.datetime(),
  answer: z.object({ question: z.string(), answer: z.string().max(250000),
    status: z.enum(['answered', 'no-evidence', 'failed']), requestedMode: z.enum(['local', 'model']),
    mode: z.enum(['local-extractive', 'model-rag', 'model-general', 'model-failed', 'model-insufficient']),
    confidence: z.enum(['none', 'low', 'medium', 'high']), generation: z.record(z.string(), z.unknown()).nullable(),
    citations: z.array(z.object({ id: z.number().int().positive(), documentId: z.string(), documentName: z.string(),
      heading: z.string(), startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative(),
      content: z.string(), contentHash: z.string().regex(/^[a-f\d]{64}$/u),
    }).loose().refine(value => sha256(value.content) === value.contentHash)),
  }).loose().nullable(),
}).strict())

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidBackup(reason: string): never {
  throw new RemoteError('knowledge/invalid-backup', `Knowledge backup is invalid (${reason}).`, { reason })
}

function chunkMarkdown(markdown: string): Array<{ heading: string; startLine: number; endLine: number; content: string }> {
  const lines = markdown.split('\n')
  const chunks: Array<{ heading: string; startLine: number; endLine: number; content: string }> = []
  let heading = 'Document'
  let start = 1
  let buffer: string[] = []
  const flush = (endLine: number): void => {
    const content = buffer.join('\n').trim()
    if (content.length > 0) chunks.push({ heading, startLine: start, endLine, content })
    buffer = []
  }
  for (const [index, line] of lines.entries()) {
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (headingMatch !== null && buffer.length > 0) flush(index)
    if (headingMatch !== null) {
      heading = headingMatch[2]?.trim() ?? 'Document'
      start = index + 1
    }
    if (buffer.length === 0) start = index + 1
    if (buffer.length > 0 && buffer.join('\n').length + 1 + line.length > CHUNK_CHAR_LIMIT) flush(index)
    if (line.length > CHUNK_CHAR_LIMIT) {
      let offset = 0
      while (offset < line.length) {
        let end = Math.min(offset + CHUNK_CHAR_LIMIT, line.length)
        if (end < line.length && /[\uD800-\uDBFF]/u.test(line.charAt(end - 1))) end--
        const boundary = line.slice(offset, end).search(/[.!?。！？；;\s][^.!?。！？；;\s]*$/u)
        if (end < line.length && boundary > CHUNK_CHAR_LIMIT / 2) end = offset + boundary + 1
        const content = line.slice(offset, end).trim()
        if (content) chunks.push({ heading, startLine: index + 1, endLine: index + 1, content })
        offset = end
      }
      continue
    }
    if (buffer.length === 0) start = index + 1
    buffer.push(line)
    if (buffer.join('\n').length >= CHUNK_CHAR_LIMIT) flush(index + 1)
  }
  flush(lines.length)
  return chunks.length > 0 ? chunks : [{ heading: 'Document', startLine: 1, endLine: 1, content: markdown }]
}
