/** Browser-safe contracts for the product knowledge-base domain. */

/** Supported source formats for product-owned knowledge documents. */
export type KnowledgeDocumentKind = 'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'html'

/** Persisted processing lifecycle for one source document. */
export type KnowledgeDocumentStatus = 'processing' | 'ready' | 'failed'

/** Browser-safe summary of one persisted knowledge base. */
export interface KnowledgeBaseView {
  readonly id: string
  readonly alias: string
  readonly name: string
  readonly status: 'active' | 'archived'
  readonly revision: number
  readonly documentCount: number
  readonly chunkCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Browser-safe metadata for one imported source document. */
export interface KnowledgeDocumentView {
  readonly id: string
  readonly knowledgeBaseId: string
  readonly name: string
  readonly originalName: string
  readonly kind: KnowledgeDocumentKind
  readonly sourceHash: string
  readonly sizeBytes: number
  readonly status: KnowledgeDocumentStatus
  readonly progress: number
  readonly error: string | null
  readonly extractedChars: number
  readonly contentHash: string
  readonly revision: number
  readonly chunkCount: number
  readonly importedAt: string
}

/** Stable processing-stage key used by the document detail UI. */
export type KnowledgeProcessingStageKey = 'upload' | 'parse' | 'segment' | 'index' | 'complete'

/** Browser-safe state for one deterministic processing stage. */
export interface KnowledgeProcessingStageView {
  readonly key: KnowledgeProcessingStageKey
  readonly status: 'pending' | 'running' | 'done' | 'failed'
  readonly progress: number
  readonly message: string
}

/** Ranked source passage with stable line and hash evidence. */
export interface KnowledgeSearchHit {
  readonly knowledgeBaseId: string
  readonly knowledgeBaseAlias: string
  readonly revision: number
  readonly documentId: string
  readonly documentName: string
  readonly chunkId: string
  readonly heading: string
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly contentHash: string
}

/** One deterministic section in a compiled Wiki page. */
export interface KnowledgeWikiSectionView {
  readonly id: string
  readonly heading: string
  readonly level: number
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly contentHash: string
}

/** Stable product-neutral class inferred for one compiled Wiki page. */
export type KnowledgeWikiPageType = 'policy' | 'procedure' | 'reference' | 'concept'

/** Source range proving where one compiled Wiki page came from. */
export interface KnowledgeWikiSourceView {
  readonly documentId: string
  readonly documentName: string
  readonly startLine: number
  readonly endLine: number
  readonly contentHash: string
}

/** Resolved explicit Wiki link between two compiled pages. */
export interface KnowledgeWikiLinkView {
  readonly slug: string
  readonly title: string
  readonly type: KnowledgeWikiPageType
}

/** Verbatim passage under a recognized academic heading. Missing sections are not inferred. */
export interface KnowledgeAcademicExcerpt {
  readonly role: 'abstract' | 'methods' | 'results' | 'discussion' | 'conclusion'
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly contentHash: string
}

/** One deterministic Wiki projection of an imported Markdown document. */
export interface KnowledgeWikiPageView {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly summary: string
  readonly type: KnowledgeWikiPageType
  readonly topic: string
  readonly documentId: string
  readonly documentName: string
  readonly revision: number
  readonly contentHash: string
  readonly sources: readonly KnowledgeWikiSourceView[]
  readonly links: readonly KnowledgeWikiLinkView[]
  readonly sections: readonly KnowledgeWikiSectionView[]
  /** Verbatim academic source excerpts, not model-generated summaries. */
  readonly academicGuide?: readonly KnowledgeAcademicExcerpt[]
}

/** Aggregate facts for one deterministic Wiki compilation. */
export interface KnowledgeWikiStatsView {
  readonly pageCount: number
  readonly sectionCount: number
  readonly sourceCount: number
  readonly linkCount: number
  readonly topicCount: number
  readonly types: Readonly<Record<KnowledgeWikiPageType, number>>
}

/** Stable entity classes in the enhanced knowledge graph projection. */
export type KnowledgeGraphNodeType = 'page' | 'source' | 'topic' | 'page-type' | 'section'

/** Stable relation classes in the enhanced knowledge graph projection. */
export type KnowledgeGraphRelation = 'links-to' | 'has-source' | 'has-topic' | 'has-type' | 'contains' | 'next'

/** Bounded traceable node in the knowledge graph projection. */
export interface KnowledgeGraphNodeView {
  readonly id: string
  readonly type: KnowledgeGraphNodeType
  readonly label: string
  readonly documentId: string | null
  readonly startLine: number | null
  readonly degree: number
}

/** Deterministic semantic edge derived from the current Wiki revision. */
export interface KnowledgeGraphEdgeView {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly relation: KnowledgeGraphRelation
  readonly label: string
  readonly weight: number
}

/** Source passage cited by an extractive knowledge answer. */
export interface KnowledgeAnswerCitation {
  readonly id: number
  readonly documentId: string
  readonly documentName: string
  readonly heading: string
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly contentHash: string
  /** Reviewed visual transcription, explicitly distinct from native extracted source text. */
  readonly vision?: { readonly page: number; readonly sourceHash: string; readonly imageHash: string }
  /** Model-derived navigation context, never independent source evidence. */
  readonly compiledContext?: string
}

/** Answer provenance distinguishes retrieved evidence from uncited general model knowledge. */
export interface KnowledgeAnswerView {
  /** Structural checks do not establish semantic truth; every generated answer remains reviewable. */
  readonly verification?: 'unverified' | 'conflict'
  /** Model-planned evidence needs; support labels are judgments, not verified correctness scores. */
  readonly knowledgeNavigation?: {
    readonly status: 'applied' | 'partial' | 'skipped' | 'failed' | 'limited'
    readonly reason: 'no-compilation' | 'input-limit' | 'evidence-limit' | 'model-or-source-error' | null
    readonly provider: string
    readonly model: string
    readonly calls: number
    readonly totalTokens: number | null
    readonly latencyMs: number
    readonly lookupCount: number
    readonly needs: readonly { readonly question: string; readonly evidenceIds: readonly number[] }[]
  }
  readonly status: 'answered' | 'no-evidence' | 'failed'
  readonly requestedMode: 'local' | 'model'
  readonly mode: 'local-extractive' | 'model-rag' | 'model-general' | 'model-failed' | 'model-insufficient'
  readonly question: string
  readonly answer: string
  readonly confidence: 'none' | 'low' | 'medium' | 'high'
  readonly citations: readonly KnowledgeAnswerCitation[]
  readonly generation: KnowledgeGenerationView | null
  /** Page-local history processing; summary is not a knowledge-base claim. */
  readonly conversation?: KnowledgeConversationResult
  /** One bounded revision over the same evidence; this is not a semantic correctness score. */
  readonly answerRepair?: {
    readonly reason: 'missing-citations' | 'unknown-citations' | 'citation-format' | 'answer-language' | 'unsupported-number'
    readonly status: 'repaired' | 'insufficient' | 'failed'
    readonly generation: KnowledgeGenerationView
  }
  /** Evidence retrieval path used before local extraction or model generation. */
  readonly retrieval?: KnowledgeRetrievalView
  /** Optional relevance selection; rejected candidates never become source citations. */
  readonly evidenceSelection?: {
    readonly status: 'applied' | 'failed'
    readonly candidateCount: number
    readonly selectedCount: number
    readonly generation: KnowledgeGenerationView
  }
  /** Optional cross-language query attempt; its output is never source evidence. */
  readonly queryExpansion?: {
    readonly query: string | null
    readonly status: 'applied' | 'skipped' | 'failed'
    readonly generation: KnowledgeGenerationView
  }
}

/** Source evidence prepared for an Agent, without a generated final answer. */
export interface KnowledgeEvidenceValue extends Pick<KnowledgeAnswerView,
  'question' | 'retrieval' | 'knowledgeNavigation' | 'queryExpansion' | 'evidenceSelection'> {
  readonly status: 'evidence' | 'no-evidence'
  /** Hashes and line ranges identify the original source; shortened content is explicitly labelled. */
  readonly hits: readonly (KnowledgeAnswerCitation & { readonly excerptTruncated: boolean })[]
}

/** Safe provider-neutral facts for one optional generated answer attempt. */
export interface KnowledgeGenerationView {
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly totalTokens: number | null
  readonly fallbackReason: 'model-timeout' | 'model-error' | 'output-limit' | 'empty-output' | 'invalid-citations' | 'answer-language' | null
}

/** One frame in a cancellable model-answer stream. */
export type KnowledgeAskFrame =
  | { readonly type: 'start'; readonly answer: KnowledgeAnswerView; readonly provider: string | null; readonly model: string | null }
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'complete'; readonly answer: KnowledgeAnswerView; readonly turnId?: number }

/** Provider-neutral persisted settings for Wiki answer generation. */
export interface KnowledgeModelSettings {
  readonly provider: string
  readonly model: string
  readonly temperature: number
  /** Zero inherits the resolved model route default. */
  readonly maxOutputTokens: number
  readonly maxEvidenceChars: number
  readonly timeoutMs: number
  readonly historyMaxChars?: number
  readonly historySummaryChars?: number
  readonly historyRecentTurns?: number
}

/** Untrusted page-local conversation memory, never source evidence. */
export interface KnowledgeConversation {
  readonly summary: string
  readonly turns: readonly { readonly question: string; readonly answer: string }[]
}

/** Memory committed with an answer, plus observable query and budget diagnostics. */
export interface KnowledgeConversationResult {
  readonly summary: string
  readonly compactedTurns: number
  readonly historyTurns: number
  readonly query: string
  readonly outputTokens: number
  readonly contextWindow: number | null
  readonly calls: number
  readonly totalTokens: number | null
}

/** Model catalog item exposed without credentials. */
export interface KnowledgeModelOption {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly imageInput?: boolean
}

/** Independently persisted compilation and explicitly enabled vision routes; no credentials. */
export interface KnowledgeCompilerSettings {
  readonly provider: string
  readonly model: string
  readonly visionEnabled: boolean
  readonly visionProvider: string
  readonly visionModel: string
  readonly maxInputChars: number
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly maxCalls: number
  readonly renderWidth: number
}
/** Source-anchored machine fact, not an independently verified paper conclusion. */
export interface KnowledgeCompiledFact {
  readonly id: string
  readonly statement: string
  readonly quote: string
  readonly startLine: number
  readonly endLine: number
  readonly startOffset: number
  readonly endOffset: number
  readonly sourceHash: string
  readonly visionPage: number | null
}
/** Original-language paper synthesis with links to immutable source facts. */
export interface KnowledgeCompilation {
  readonly version: 1
  readonly sourceHash: string
  readonly contentHash: string
  readonly cacheKey: string
  readonly provider: string
  readonly model: string
  readonly createdAt: string
  readonly title: string
  readonly sections: readonly { readonly heading: string; readonly text: string; readonly factIds: readonly string[] }[]
  readonly facts: readonly KnowledgeCompiledFact[]
  readonly visionSources: readonly KnowledgeVisionPage[]
  readonly gaps: readonly string[]
  readonly coverage: readonly { readonly startOffset: number; readonly endOffset: number }[]
  readonly calls: number
  readonly totalTokens: number | null
  readonly latencyMs: number
}
/** One page-level visual recognition candidate, preserved separately from extracted text. */
export interface KnowledgeVisionPage {
  readonly page: number
  readonly printedPage: string | null
  readonly sourceHash: string
  readonly imageHash: string
  readonly attachmentId: string
  readonly region: readonly number[]
  readonly provider: string
  readonly model: string
  readonly text: string
  readonly uncertainties: readonly string[]
  readonly reviewed: boolean
  readonly totalTokens: number | null
}
/** Durable compilation result and separate latest-attempt lifecycle. */
export interface KnowledgeCompilationValue {
  readonly status: 'uncompiled' | 'running' | 'review' | 'complete' | 'failed' | 'cancelled' | 'stale'
  readonly progress: number
  readonly error: string | null
  readonly publication: KnowledgeCompilation | null
  readonly vision: readonly KnowledgeVisionPage[]
  readonly suggestedPages: readonly number[]
  readonly rawAvailable: boolean
  /** Local human dispositions for this publication; absent in older saved states. */
  readonly gapReviews?: readonly KnowledgeGapReview[]
}
/** Human disposition, not a correction of compiled knowledge or model evidence. */
export interface KnowledgeGapReview {
  readonly index: number
  readonly status: 'verified' | 'question' | 'not-applicable'
  readonly note: string
  readonly reviewedAt: string
}
/** Publication-bound local review; rejects submissions from superseded pages. */
export interface KnowledgeGapReviewRequest extends KnowledgeDocumentDetailRequest {
  readonly publicationKey: string
  readonly publicationCreatedAt: string
  readonly index: number
  readonly status: KnowledgeGapReview['status']
  readonly note: string
}
/** Explicit selected-source operation; online calls never start merely by opening Wiki. */
export interface KnowledgeCompileRequest extends KnowledgeDocumentDetailRequest {
  readonly operation: 'compile' | 'vision'
  readonly pages?: readonly number[]
  readonly force?: boolean
}
/** Compiler Settings snapshot and credential-free catalog. */
export interface KnowledgeCompilerSettingsValue {
  readonly settings: KnowledgeCompilerSettings
  readonly resolvedProvider: string
  readonly resolvedModel: string
  readonly options: readonly KnowledgeModelOption[]
  readonly writable: boolean
}

/** Current Wiki generation settings and resolved default-aware target. */
export interface KnowledgeModelSettingsValue {
  readonly settings: KnowledgeModelSettings
  readonly resolvedProvider: string
  readonly resolvedModel: string
  readonly options: readonly KnowledgeModelOption[]
  readonly writable: boolean
}

/** Result of an explicit minimal model connectivity test. */
export interface KnowledgeModelTestValue {
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly output: string
}

/** Stable evaluation-case categories inherited from the Studio acceptance suite. */
export interface KnowledgeModelEvaluationReport {
  readonly schemaVersion: 1
  readonly revision: number
  readonly createdAt: string
  readonly semanticAccuracy: null
  readonly meanRetrievalRecall: number | null
  readonly p95LatencyMs: number
  readonly results: readonly {
    readonly id: string
    readonly question: string
    readonly expectedAnswer: string
    readonly expectedDocumentNames: readonly string[]
    readonly unanswerable: boolean
    readonly answer: KnowledgeAnswerView
    readonly latencyMs: number
    readonly retrievalRecall: number | null
    readonly humanReview: { readonly answerCorrect: boolean | null; readonly claimsSupported: boolean | null; readonly refusalAppropriate: boolean | null; readonly notes: string }
  }[]
}

/** Stable evaluation-case categories inherited from the Studio acceptance suite. */
export type KnowledgeEvaluationKind = 'direct-fact' | 'cross-source' | 'concept-link' | 'citation-jump' | 'no-evidence' | 'adversarial'

/** Reproducible retrieval question and its expected evidence facts. */
export interface KnowledgeEvaluationCase {
  readonly id?: string
  readonly kind?: KnowledgeEvaluationKind
  readonly question: string
  readonly expectedTerms: readonly string[]
  readonly expectedDocumentNames?: readonly string[]
  readonly expectedStatus?: 'answered' | 'no-evidence'
}

/** One of the seven deterministic evaluation dimensions. */
export type KnowledgeEvaluationMetric = 'answer-completed' | 'retrieval-hit' | 'evidence-coverage' | 'citation-valid' | 'answer-faithful' | 'no-answer-honest' | 'input-robust'

/** One applicable or explicitly skipped dimension score. */
export interface KnowledgeEvaluationScore {
  readonly key: KnowledgeEvaluationMetric
  readonly score: number | null
  readonly comment: string
}

/** Deterministic outcome for one case under one retrieval profile. */
export interface KnowledgeEvaluationCaseResult {
  readonly id: string
  readonly kind: KnowledgeEvaluationKind
  readonly question: string
  readonly expectedTerms: readonly string[]
  readonly expectedDocumentNames: readonly string[]
  readonly expectedStatus: 'answered' | 'no-evidence'
  readonly matchedTerms: readonly string[]
  readonly answered: boolean
  readonly citationCount: number
  readonly documentNames: readonly string[]
  readonly recallAt10: number | null
  readonly reciprocalRankAt10: number | null
  readonly queryLatencyMs: number
  readonly retrieval: KnowledgeRetrievalView
  readonly scores: readonly KnowledgeEvaluationScore[]
  readonly error: string | null
  readonly passed: boolean
}

/** Aggregate result for one deterministic retrieval profile. */
export interface KnowledgeEvaluationProfileReport {
  readonly profile: 'baseline' | 'optimized' | 'hybrid'
  readonly totalScore: number
  readonly passed: number
  readonly recallAt10: number | null
  readonly mrrAt10: number | null
  readonly meanQueryLatencyMs: number
  readonly metricMeans: Readonly<Record<KnowledgeEvaluationMetric, { readonly mean: number; readonly n: number }>>
  readonly results: readonly KnowledgeEvaluationCaseResult[]
}

/** Aggregate baseline/optimized comparison for one persisted revision. */
export interface KnowledgeEvaluationReport {
  readonly revision: number
  readonly evaluatedAt: string
  readonly caseCount: number
  readonly baseline: KnowledgeEvaluationProfileReport
  readonly optimized: KnowledgeEvaluationProfileReport
  readonly hybrid: KnowledgeEvaluationProfileReport | null
  readonly scoreDelta: number
  readonly metricDeltas: Readonly<Record<KnowledgeEvaluationMetric, number | null>>
  readonly regressionFree: boolean
  readonly hybridScoreDelta: number | null
  readonly hybridMetricDeltas: Readonly<Record<KnowledgeEvaluationMetric, number | null>> | null
  readonly hybridRegressionFree: boolean | null
  /** Compatibility projection of the optimized report. */
  readonly answeredRate: number
  /** Compatibility projection of the optimized report. */
  readonly citationRate: number
  /** Compatibility projection of the optimized report. */
  readonly expectedTermCoverage: number
  /** Compatibility projection of the optimized report. */
  readonly passedRate: number
  /** Compatibility projection of the optimized per-case results. */
  readonly results: readonly KnowledgeEvaluationCaseResult[]
}

/** Request to create or idempotently resolve a stable knowledge-base alias. */
export interface KnowledgeCreateRequest { readonly alias: string; readonly name: string }
/** Result of creating or resolving a knowledge base. */
export interface KnowledgeCreateValue {
  readonly knowledgeBase: KnowledgeBaseView
  readonly created: boolean
}
/** Current persisted knowledge-base summaries. */
export interface KnowledgeListValue { readonly knowledgeBases: readonly KnowledgeBaseView[] }
/** Request to list documents for one knowledge-base id or alias. */
export interface KnowledgeDocumentsRequest { readonly ref: string }
/** Current documents belonging to one knowledge base. */
export interface KnowledgeDocumentsValue { readonly documents: readonly KnowledgeDocumentView[] }
/** Request to import a bounded Markdown source. */
export interface KnowledgeImportRequest {
  readonly ref: string
  readonly name: string
  readonly markdown: string
}
/** Committed document and updated knowledge-base summary. */
export interface KnowledgeImportValue {
  readonly document: KnowledgeDocumentView
  readonly knowledgeBase: KnowledgeBaseView
}
/** Request to import one browser-selected supported source file. */
export interface KnowledgeImportFileRequest {
  readonly stageOnly?: boolean
  readonly ref: string
  readonly fileName: string
  readonly base64: string
}
/** Persisted source result, including idempotent duplicate resolution. */
export interface KnowledgeImportFileValue {
  readonly document: KnowledgeDocumentView
  readonly knowledgeBase: KnowledgeBaseView
  readonly duplicate: boolean
}
/** Request for processing evidence and extracted preview for one document. */
export interface KnowledgeDocumentDetailRequest { readonly ref: string; readonly documentId: string }
/** Document processing evidence, extracted preview, and reprocessing availability. */
export interface KnowledgeDocumentDetailValue {
  readonly document: KnowledgeDocumentView
  readonly preview: string
  readonly stages: readonly KnowledgeProcessingStageView[]
  readonly reprocessable: boolean
}
/** Request to rerun extraction from a locally retained source file. */
export interface KnowledgeReprocessRequest { readonly ref: string; readonly documentId: string }
/** Persisted outcome after rerunning source extraction and indexing. */
export interface KnowledgeReprocessValue {
  readonly document: KnowledgeDocumentView
  readonly knowledgeBase: KnowledgeBaseView
}
/** Request for bounded full-text evidence retrieval. */
export interface KnowledgeSearchRequest {
  readonly ref: string
  readonly query: string
  readonly limit?: number
}
/** Ranked evidence passages returned by local retrieval. */
export interface KnowledgeSearchValue {
  readonly hits: readonly KnowledgeSearchHit[]
  readonly retrieval: KnowledgeRetrievalView
}
/** Safe diagnostic summary for one evidence-retrieval operation. */
export interface KnowledgeRetrievalView {
  readonly requestedMode: 'lexical' | 'hybrid'
  readonly actualMode: 'lexical' | 'hybrid'
  readonly semanticIndexRevision: number | null
  readonly semanticCandidateCount: number
  readonly fallbackReason: 'semantic-disabled' | 'semantic-unavailable' | 'semantic-scan-limit' | null
}
/** Current local semantic-index lifecycle and coverage diagnostics. */
export interface KnowledgeSemanticIndexStatusValue {
  readonly configuredMode: 'lexical' | 'hybrid'
  readonly state: 'disabled' | 'missing' | 'building' | 'ready' | 'stale'
  readonly model: string | null
  readonly modelRevision: string | null
  readonly dimensions: number | null
  readonly minimumScore: number | null
  readonly sourceRevision: number
  readonly indexRevision: number | null
  readonly sourceChunkCount: number
  readonly indexedChunkCount: number
  readonly coverage: number
  readonly builtAt: string | null
}
/** Request for a bounded line range from one source document. */
export interface KnowledgeReadRequest {
  readonly ref: string
  readonly documentId: string
  readonly startLine?: number
  readonly endLine?: number
}
/** Exact source range and revision evidence. */
export interface KnowledgeReadValue {
  readonly knowledgeBaseId: string
  readonly knowledgeBaseAlias: string
  readonly revision: number
  readonly document: KnowledgeDocumentView
  readonly startLine: number
  readonly endLine: number
  readonly content: string
}
/** Request for all Wiki pages or one document projection. */
export interface KnowledgeWikiRequest { readonly ref: string; readonly documentId?: string }
/** Deterministic Wiki manifest compiled from one authoritative knowledge-base revision. */
export interface KnowledgeWikiValue {
  readonly revision: number
  readonly compiledAt: string
  readonly contentHash: string
  readonly stats: KnowledgeWikiStatsView
  readonly pages: readonly KnowledgeWikiPageView[]
}
/** Request for the bounded knowledge graph projection. */
export interface KnowledgeGraphRequest { readonly ref: string }
/** Graph nodes, edges, totals, and truncation state for one revision. */
export interface KnowledgeGraphValue {
  readonly revision: number
  readonly totalNodes: number
  readonly totalEdges: number
  readonly truncated: boolean
  readonly nodes: readonly KnowledgeGraphNodeView[]
  readonly edges: readonly KnowledgeGraphEdgeView[]
}
/** Request for evidence-bounded local or explicitly generated QA. */
export interface KnowledgeAskRequest {
  readonly ref: string
  readonly question: string
  readonly limit?: number
  readonly mode?: 'local' | 'model'
  readonly conversation?: KnowledgeConversation
}
/** Evidence-bounded answer returned by the knowledge service. */
export interface KnowledgeAskValue { readonly answer: KnowledgeAnswerView }
/** Immutable answer snapshot, retained even when its cited source changes or is deleted. */
export interface KnowledgeSavedTurn {
  readonly id: number
  readonly question: string
  readonly answer: KnowledgeAnswerView | null
  readonly status: 'running' | 'complete' | 'cancelled' | 'failed'
  readonly revision: number
  readonly createdAt: string
  readonly sourceChanged: boolean
}
/** A reverse-paginated conversation, returned in chronological order. */
export interface KnowledgeConversationPage {
  readonly turns: readonly KnowledgeSavedTurn[]
  readonly hasMore: boolean
}
/** Read older conversation snapshots without mutating or invoking a model. */
export interface KnowledgeConversationRequest { readonly ref: string; readonly before?: number }
/** Durable work remains queued until its result succeeds; resuming is explicit. */
export interface KnowledgeQueueValue { readonly imports: readonly string[]; readonly compilations: readonly string[] }
/** Add document identities to the persistent compilation queue. */
export interface KnowledgeQueueRequest { readonly ref: string; readonly documentIds?: readonly string[] }
/** Human-reviewable cross-paper synthesis, with immutable evidence and separate user notes. */
export interface KnowledgeTopic {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly version: number
  readonly notes: string
  readonly claims: readonly { readonly text: string; readonly kind: 'consensus' | 'conflict' | 'insufficient'; readonly evidenceIds: readonly number[] }[]
  readonly sources: readonly KnowledgeAnswerCitation[]
  readonly previousText: string
  readonly stale: boolean
}
/** Topic selection and explicit draft generation; selected source text is sent to the compiler route. */
export interface KnowledgeTopicRequest { readonly ref: string; readonly id?: string; readonly title: string; readonly documentIds: readonly string[] }
/** Optimistically publish an inspected draft or edit its human notes. */
export interface KnowledgeSaveTopicRequest { readonly ref: string; readonly topic: KnowledgeTopic }
/** Request to save the complete Wiki generation settings section. */
export interface KnowledgeSaveModelSettingsRequest { readonly settings: KnowledgeModelSettings }
/** Request to explicitly validate the current saved/default-aware model route. */
export interface KnowledgeTestModelRequest { readonly useSavedSettings?: boolean }
/** Request to evaluate reproducible retrieval cases. */
export interface KnowledgeEvaluateRequest {
  readonly ref: string
  readonly cases: readonly KnowledgeEvaluationCase[]
}
/** Deterministic evaluation report for the selected revision. */
export interface KnowledgeEvaluateValue { readonly report: KnowledgeEvaluationReport }
/** Request for semantic-index status or mutation in one knowledge base. */
export interface KnowledgeSemanticIndexRequest { readonly ref: string }
/** Current status after an explicit semantic-index operation. */
export interface KnowledgeSemanticIndexValue { readonly status: KnowledgeSemanticIndexStatusValue }
/** Request to archive or reactivate a knowledge base. */
export interface KnowledgeSetStatusRequest { readonly ref: string; readonly status: 'active' | 'archived' }
/** Updated knowledge-base lifecycle summary. */
export interface KnowledgeSetStatusValue { readonly knowledgeBase: KnowledgeBaseView }
/** Request to delete one document from an active knowledge base. */
export interface KnowledgeDeleteDocumentRequest { readonly ref: string; readonly documentId: string }
/** Updated knowledge base after document deletion. */
export interface KnowledgeDeleteDocumentValue { readonly knowledgeBase: KnowledgeBaseView }
/** Exact-alias-confirmed knowledge-base deletion request. */
export interface KnowledgeDeleteRequest { readonly ref: string; readonly expectedAlias: string }
/** Stable acknowledgement of the deleted alias. */
export interface KnowledgeDeleteValue { readonly deletedAlias: string }
/** Request for a versioned logical backup. */
export interface KnowledgeBackupRequest { readonly ref: string; readonly complete?: boolean }
/** Downloadable logical backup payload and content hash. */
export interface KnowledgeBackupValue {
  readonly fileName: string
  readonly json: string
  readonly contentHash: string
}
/** Request to validate and atomically restore one logical backup. */
export interface KnowledgeRestoreRequest { readonly json: string }
/** Restored knowledge-base summary. */
export interface KnowledgeRestoreValue { readonly knowledgeBase: KnowledgeBaseView }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'knowledge/not-found': { readonly ref: string }
    'knowledge/document-not-found': { readonly ref: string; readonly documentId: string }
    'knowledge/alias-conflict': { readonly alias: string }
    'knowledge/invalid-input': { readonly field: string; readonly reason: string }
    'knowledge/archived': { readonly ref: string; readonly operation: string }
    'knowledge/delete-confirmation': { readonly ref: string }
    'knowledge/invalid-backup': { readonly reason: string }
    'knowledge/unsupported-file-type': { readonly fileName: string }
    'knowledge/file-too-large': { readonly fileName: string; readonly maxBytes: number }
    'knowledge/invalid-base64': { readonly fileName: string }
    'knowledge/reprocess-unavailable': { readonly documentId: string }
    'knowledge/semantic-disabled': { readonly ref: string }
    'knowledge/semantic-busy': { readonly ref: string }
  }
}
