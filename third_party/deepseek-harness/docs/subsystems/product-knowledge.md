# Product Knowledge

English | [中文](product-knowledge.zh.md)

The product-knowledge subsystem is the F001 native knowledge-base vertical slice. It keeps knowledge bases independent from Sessions, extracts bounded PDF, DOCX, Markdown, and TXT sources, persists normalized Markdown and source evidence in SQLite, exposes Host Remotes to the native Client page, and offers Preset-scoped Agent tools through a separate Consumer package. It is product-owned under `packages/product/`; Studio remains a provenance reference rather than a runtime dependency.

Source: [`product-knowledge`](../../packages/product/product-knowledge) · [`product-knowledge-context`](../../packages/product/product-knowledge-context) · [`product-bundle`](../../packages/product/product-bundle) · [`product-presets`](../../packages/product/product-presets)

## Ownership and data flow

`@deepseek-ai/dsh-product-knowledge` owns the contracts, authoritative SQLite store, Typert Remote methods, and native Knowledge Base Center. Its Host and Client halves share browser-safe types but keep Node persistence and parsers out of the Client build. A knowledge base has a stable alias and revision. Each file upload records format, size, source SHA-256, status, progress, and extraction error before normalized Markdown is split deterministically by headings and indexed through SQLite FTS5. Identical source bytes are idempotent within one knowledge base, and failed extraction leaves no searchable chunks. FTS5 recalls bounded ASCII/number candidates, while bounded parameterized substring queries supplement Chinese phrase/bigram candidates; a deterministic lexical ranker then combines exact-phrase, document-name, heading, content, and per-document-diversity signals. Search results and reads retain document, line, hash, and revision evidence.

`@deepseek-ai/dsh-product-knowledge-context` is the model-facing Consumer. It resolves one configured knowledge-base alias and registers `knowledge_search`, `knowledge_read`, and `knowledge_sources`. Results are bounded; a required missing binding, unknown alias, or revision mismatch fails visibly. The package never injects an entire knowledge base into the prompt.

## Native Client surface

The Knowledge Base Center registers through the root-scoped keyed `main.page` Slot and opens through `ctx.layout.openPrimaryPage`. It remains independent from the active Session while preserving the Harness sidebar and theme. The management workspace covers overview, bounded file upload or pasted Markdown, processing detail and local reprocessing, document deletion, evidence search and source inspection, a compiled Wiki manifest, an enhanced graph with cluster/structure views and entity focus, local or opt-in streamed cited QA, Settings-backed Wiki model routing and connectivity testing, paired deterministic evaluation, archive/reactivate, logical JSON backup/restore, and exact-alias knowledge-base deletion.

Wiki pages and graph nodes are deterministic projections of persisted Markdown rather than a second authority. The Wiki manifest exposes revision, stable content hash, aggregate counts, inferred page type and topic, source ranges, and resolved explicit links. The graph derives page, source, topic, page-type, and section nodes with links-to, has-source, has-topic, has-type, contains, and next relations. QA defaults to deterministic local extraction. When an operator explicitly selects model mode, the Host resolves the `product-knowledge` Settings route or falls back to the Profile default, sends bounded retrieved evidence, and streams start/delta/complete frames while propagating cancellation. Only answers with valid `[n]` citations are authoritative; timeout, adapter error, empty output, or invalid citations completes with the local answer. Evaluation runs baseline and optimized lexical profiles over caller-supplied direct, cross-source, concept-link, citation-jump, no-evidence, or adversarial cases and reports seven deterministic dimensions plus deltas and regression status; it does not present lexical behavior as semantic model quality.

## Composition and binding

The formal runtime path is the Product Bundle installed into a dedicated `product` Profile after the official base and Web bundles. `--patch` is limited to development and temporary overrides. Agent binding belongs in a domain Preset's `agent.cordis.yml`, not in `preset.yml` or the Product Bundle. F001 implements the Preset-level binding; Session-temporary and Workspace-default precedence are deferred.

The repository-local verifier runs the official plugin-management path in a temporary `DSH_HOME`, checks the ordered layers `base → web-app → product-bundle`, and confirms the composed configuration contains the knowledge runtime. See the [Product Bundle instructions](../../packages/product/product-bundle/README.md).

## Persistence boundary

The current store is a local single-process SQLite database using WAL mode and strict tables. Import completion, destructive document updates, and restore are transactional; database files are created with restricted permissions where supported; uploads are capped at 20 MiB; searches and graph projections are capped; reads return at most 200 lines. A version 2 logical backup contains versioned knowledge-base metadata, extracted Markdown, and source-processing metadata, but excludes original bytes. Restore accepts version 1 and version 2, validates extracted-content hashes, and commits atomically. Restored documents remain searchable but cannot be reprocessed without their original bytes. Runtime reopen and backup/restore round trips are covered by disk-backed tests.

Multi-process writes, file crawling, multipart upload streaming, XLSX/HTML parsing, OCR, background processing, schema migration across future incompatible backup formats, remote object storage, per-user access control, embedding/vector retrieval, model-generated Wiki compilation, LLM-as-judge evaluation, and model-inferred graph entities remain outside this F001 increment. The browser never receives a database path and cannot bypass the Host Remote boundary.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledgebases--knowledgecontroller"></a>

### `ctx.knowledgeBases` — `KnowledgeController`

Host service backing the generated `ctx.remote.knowledge` namespace.

```ts cordis-catalog
/**
 * List persisted knowledge bases for the management workspace.
 * @returns all knowledge-base summaries in update order.
 */
@Remote('list') list(): KnowledgeListValue

/**
 * Create or idempotently resolve one stable knowledge-base alias.
 * @param request - Alias and display name.
 * @returns the knowledge base and whether this call created it.
 */
@Remote('create') create(request: KnowledgeCreateRequest): KnowledgeCreateValue

/**
 * List source documents and evidence metadata.
 * @param request - Knowledge-base identity.
 * @returns bounded document summaries.
 */
@Remote('documents') documents(request: KnowledgeDocumentsRequest): KnowledgeDocumentsValue

/**
 * Import one Markdown source and replace the index atomically.
 * @param request - Knowledge-base identity, document name, and Markdown.
 * @returns the updated knowledge base and imported document.
 */
@Remote('importMarkdown') importMarkdown(request: KnowledgeImportRequest): KnowledgeImportValue

/**
 * Import and process one supported browser-selected source file.
 * @param request - Knowledge-base identity, original file name, and base64 bytes.
 * @returns final document state and duplicate signal.
 */
@Remote('importFile') async importFile(request: KnowledgeImportFileRequest): Promise<KnowledgeImportFileValue>

/**
 * Read persisted processing evidence and extracted preview.
 * @param request - Knowledge-base and document identities.
 * @returns document detail suitable for the management workspace.
 */
@Remote('documentDetail') documentDetail(request: KnowledgeDocumentDetailRequest): KnowledgeDocumentDetailValue

/**
 * Rerun extraction and indexing from locally retained source bytes.
 * @param request - Knowledge-base and document identities.
 * @returns final document and updated knowledge-base state.
 */
@Remote('reprocess') async reprocess(request: KnowledgeReprocessRequest): Promise<KnowledgeReprocessValue>

/**
 * Retrieve bounded source passages through the local index.
 * @param request - Knowledge-base identity, query, and optional limit.
 * @returns ranked evidence passages.
 */
@Remote('search') search(request: KnowledgeSearchRequest): KnowledgeSearchValue

/**
 * Read a bounded source range from one document.
 * @param request - Document identity and optional line range.
 * @returns source text with revision and hash evidence.
 */
@Remote('read') read(request: KnowledgeReadRequest): KnowledgeReadValue

/**
 * Compile the deterministic Wiki manifest or one complete page from Markdown.
 * @param request - Knowledge-base identity and optional document identity.
 * @returns revision, content hash, statistics, page metadata, sources, links, and optional sections.
 */
@Remote('wiki') wiki(request: KnowledgeWikiRequest): KnowledgeWikiValue

/**
 * Derive a bounded document and section relationship graph.
 * @param request - Knowledge-base identity.
 * @returns graph nodes, edges, totals, and truncation state.
 */
@Remote('graph') graph(request: KnowledgeGraphRequest): KnowledgeGraphValue

/**
 * Produce a cited local answer or explicitly request model-generated RAG.
 * @param request - Knowledge-base identity, question, evidence limit, and answer mode.
 * @param signal - caller cancellation propagated to optional model generation.
 * @returns the actual answer mode, evidence, citations, and generation metadata.
 */
@Remote('ask') async ask(request: KnowledgeAskRequest, signal: AbortSignal): Promise<KnowledgeAskValue>

/**
 * Stream a local answer or incremental model output with one authoritative completion frame.
 * @param request - knowledge-base identity, question, evidence limit, and answer mode.
 * @param signal - caller cancellation propagated to model generation.
 * @returns start, optional text deltas, and exactly one completion frame.
 */
@Remote({ mode: 'stream' }) async * askStream(request: KnowledgeAskRequest, signal: AbortSignal): AsyncIterable<KnowledgeAskFrame>

/**
 * Read current Settings-backed Wiki generation configuration and model catalog.
 * @returns persisted settings, resolved route, available models, and write capability.
 */
@Remote('modelSettings') async modelSettings(): Promise<KnowledgeModelSettingsValue>

/**
 * Persist the complete Wiki generation settings through the official Settings provider.
 * @param request - complete validated settings section.
 * @returns the freshly resolved settings and model catalog.
 */
@Remote('saveModelSettings') async saveModelSettings(request: KnowledgeSaveModelSettingsRequest): Promise<KnowledgeModelSettingsValue>

/**
 * Execute an explicit, bounded, tool-free model connectivity probe.
 * @param _request - explicit probe request reserved for future per-call overrides.
 * @param signal - caller cancellation propagated to the model stream.
 * @returns safe route, latency, and bounded output evidence.
 */
@Remote('testModel') async testModel(_request: KnowledgeTestModelRequest, signal: AbortSignal): Promise<KnowledgeModelTestValue>

/**
 * Run deterministic retrieval and expected-term evaluation cases.
 * @param request - Knowledge-base identity and evaluation cases.
 * @returns aggregate metrics and per-case results.
 */
@Remote('evaluate') evaluate(request: KnowledgeEvaluateRequest): KnowledgeEvaluateValue

/**
 * Change one knowledge base between active and archived states.
 * @param request - Knowledge-base identity and target state.
 * @returns the updated knowledge-base summary.
 */
@Remote('setStatus') setStatus(request: KnowledgeSetStatusRequest): KnowledgeSetStatusValue

/**
 * Delete one source document and its index rows.
 * @param request - Knowledge-base and document identities.
 * @returns the updated knowledge-base summary.
 */
@Remote('deleteDocument') deleteDocument(request: KnowledgeDeleteDocumentRequest): KnowledgeDeleteDocumentValue

/**
 * Permanently delete a knowledge base after exact-alias confirmation.
 * @param request - Knowledge-base identity and confirmation alias.
 * @returns the deleted alias.
 */
@Remote('delete') delete(request: KnowledgeDeleteRequest): KnowledgeDeleteValue

/**
 * Export a portable logical backup with a content hash.
 * @param request - Knowledge-base identity.
 * @returns serialized backup metadata and JSON.
 * @throws When a source is still processing and cannot be represented consistently.
 */
@Remote('backup') backup(request: KnowledgeBackupRequest): KnowledgeBackupValue

/**
 * Validate and transactionally restore a non-conflicting logical backup.
 * @param request - Serialized backup JSON.
 * @returns the restored knowledge-base summary.
 */
@Remote('restore') restore(request: KnowledgeRestoreRequest): KnowledgeRestoreValue
```

Source: [`packages/product/product-knowledge/src/index.ts`](../../packages/product/product-knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
