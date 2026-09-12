---
description: "Persistent product knowledge bases, evidence-bearing retrieval, and the native Knowledge Base Center."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-knowledge

English | [中文](README.zh.md)

## Summary

This Host/Client package turns local PDF, DOCX, XLSX, HTML, Markdown, and TXT material into a searchable, source-grounded knowledge workspace. The Host normalizes source content, applies local PaddleOCR PP-OCRv5 only to PDF pages with missing or low-quality native text, and stores processing evidence, deterministic chunks, revisions, and SHA-256 hashes in SQLite. The Harness-native Client provides a real-data dashboard, document processing workspace, compiled Wiki reader, graph, streamed conversation with per-answer evidence, and settings. Typert Remotes expose bounded operations to the Client.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Select ready documents in the document list, acknowledge external processing and start batch compilation. The page dispatches ordinary compilations sequentially, reuses valid publications without model calls, reports per-document progress and failures, and continues after individual failures. Cancel or close the page to cancel the current request and skip unstarted documents; completed publications and pending queues persist, with validated extraction checkpoints available for an explicit resume. New vision calls and force recompilation remain explicit single-document actions. See the [batch compilation spec](../specs/F001-llm-wiki-knowledge-base/batch-compilation.md).

The default SQLite database stores original uploaded bytes in `documents.raw_content`, extracted text in `documents.content`, retrieval passages/indexes in their own tables, and compiled publications with visual transcripts and review records in `document_compilations.payload`. These are database records, not individual Markdown files. Profile configuration does not contain the knowledge data; profiles using the same Harness home share the default database unless `databasePath` is explicitly changed. Logical JSON backups omit original binary files. Complete compressed backups include originals, visual images, conversations, pending jobs, checkpoints and topics; see the [reliability contract](../specs/F001-llm-wiki-knowledge-base/reliability.md).

Native PDF quality scoring ignores standalone decorative rules without altering extracted evidence; empty and corrupt pages still require OCR. Missing-document errors close stale details and refresh the list. Compilation progress advances after validated batches, so a model call may leave it unchanged for minutes. The Client polls running compilations when reopened and reports failed refreshes instead of silently showing stale progress. See the [recovery spec](../specs/F003-local-paddleocr-document-ingestion/native-text-recovery.md).

The document picker accepts multiple files, each up to 20 MiB. The Client saves originals before sequential parsing through the existing single-file API, reports each outcome, continues after individual failures, and retains successful imports. Stop remaining imports skips unstarted files; the current Host parse may still finish. Closing the page stops dispatch; already uploaded originals and pending work can be resumed after reopening. Compilation and online vision remain separate explicit operations. See the [batch import spec](../specs/F001-llm-wiki-knowledge-base/batch-import.md).

Mount the Host and Client rows through `@deepseek-ai/dsh-product-bundle`. Data defaults to `$DSH_HOME/product/knowledge/knowledge.db`. The Product Bundle enables CPU OCR with `../.runtime/paddleocr/Scripts/python.exe`, stores downloaded models under `../.runtime/paddleocr-models`, and applies a 300-second page timeout, a 32-character native-text threshold, a 1,200-pixel render width, and a 200-page limit. XLSX ingestion accepts at most 64 worksheets, 100,000 non-empty rows across the workbook, and 256 used columns per worksheet. The worker binds only to a dynamic `127.0.0.1` port and uses a fresh random credential for each process generation. OCR configuration is independent of model-answer configuration.

Retrieval defaults to `lexical`. The experimental `hybrid` mode uses a pinned, explicitly installed `intfloat/multilingual-e5-small` ONNX model from `$DSH_HOME/product/knowledge/embedding-models`; normal runtime loading is offline-only. It creates revisioned SQLite vectors lazily, exact-scans at most 50,000 chunks, fuses lexical and semantic ranks deterministically, and returns the original persisted chunks. A missing or failed model, stale build, or scan-limit breach safely returns lexical evidence. Search and Q&A surfaces show the actual mode, vector-index revision, semantic-candidate count, and fallback reason. Settings shows index state, source/index revisions, coverage, and model metadata, and provides rebuild, cancellation, and derived-vector clearing. Advanced evaluation compares baseline, optimized, and hybrid on the same knowledge-base revision and reports Recall@10, MRR@10, query latency, seven quality dimensions, and regression status. Hybrid retrieval feeds search, local answers, and streamed model answers, but remains opt-in until a representative paper benchmark passes the F005 quality gate.

Archive a knowledge base to make its content read-only, or reactivate it before changing sources. Version 3 logical JSON backups include extracted Markdown, source metadata, compilation publications, visual candidates/transcripts and provenance, but exclude original binary bytes and credentials. Restore accepts logical versions 1–3 and compressed complete version 4, validates source hashes and compiled fact anchors before one transaction, and never overwrites an existing alias. Restored text remains searchable; reprocessing and new visual recognition require retained original bytes. Backup and destructive Remote operations reject while compilation is active; finish or cancel it first. Permanent deletion requires the exact alias.

In Wiki Settings, configure the independent compilation route under `product-knowledge-compiler`; a blank pair inherits Wiki QA, then Harness. Vision is disabled until explicitly enabled with an advertised image-input route; it never silently inherits a text model. The initial resource policy is 16,000 source characters per batch, 32,000 output tokens per call, 600 seconds per call, 200 calls per document and a 2,000px page raster, with an overall one-hour safety ceiling. These are configurable operational limits, not monetary approval thresholds. Output-limit errors identify exhaustion including reasoning tokens; adjust the compiler settings before retrying. Select a document in Documents or Wiki, acknowledge the displayed external-processing scope, and choose compilation or physical PDF pages for vision. Opening a page performs no inference.

<a id="understand-the-implementation"></a>

Q&A defaults to AI answers using the configured Harness route. With no retrieved evidence, the model may supply explicitly labelled general knowledge, not claims verified against your papers; local mode remains available without credentials. Chinese questions and empty-result questions may trigger one English query expansion, fused with the original results. `queryExpansionEnabled` defaults to true; `queryExpansionMaxTokens` defaults to 1,024 and `queryExpansionTimeoutMs` to 30,000. Expansion failures retain original retrieval; cancellation stops the operation. Greetings bypass retrieval evidence in AI mode. Source identifiers or years adjoining Chinese text remain searchable, and an explicitly named source contributes its first substantive passage as context. This is source routing and query expansion, not a claim of vector or semantic-graph retrieval.

## Understand the implementation

Compilation completion and human review are independent. The compilation panel links to individual findings with verified, unresolved or not-applicable dispositions, required notes and save times. Reviews persist locally with the current publication and logical backups, without model calls, token use or changes to source evidence or compiled knowledge. New successful compilation resets dispositions; reuse, failure and cancellation retain them. Superseded, stale or running publications reject review writes. Findings retain the compiler's original text, including historical visual-review warnings; saving a disposition does not resolve the underlying academic claim.

`src/compiler.ts` extracts quote-anchored facts from every contiguous source batch and then synthesizes an original-language paper page. Whitespace-only differences caused by PDF line wrapping are mapped back to exact source characters. Coverage offsets, source/quote hashes, line or physical-page locations, model identity, calls and token usage are persisted in the existing SQLite database. Reference and numeric checks reject unsupported output; basic English/Chinese language checks reject unwanted full translation. These checks do not prove semantic entailment. Each request retries a transport failure at most once within the remaining call limit; unmetered failed attempts make total usage unknown. Compiled facts guide retrieval back to native quotes or explicitly labelled, manually reviewed visual transcripts; generated navigation context stays labelled as derived.

Visual recognition renders only selected PDF pages through the existing parser and stores images through official attachments before logged model dispatch. The UI preserves transcription candidates, uncertainties, page/image provenance and a correction form. Only manually reviewed, uncertainty-free candidates enter compilation. Immutable visual snapshots keep an older publication traceable after new recognition. Ordinary compilation reuses a valid publication without model calls; additional reviewed pages and changed settings require explicit force recompilation with a visible token-cost notice. Cache identity records the original inputs, not an automatic refresh requirement. Source changes or reviewed corrections to visual pages already used by a publication exclude it from default QA; legacy stale states recover only after source-anchor validation. Failed or cancelled jobs retain the previous publication. Cross-paper previews compare selected excerpts and preserve human notes; semantic correctness remains subject to independent review.

Wiki paper guides expose verbatim excerpts under recognized abstract, methods, results, discussion/limitations, and conclusion headings, retaining source lines and hashes. Overview questions use these ranges from retrieved documents alongside ordinary passages. Guides consume no LLM tokens, require no reimport, and omit unrecognized sections; they are not generated semantic summaries or complete table understanding.

AI defaults to eight candidates when no limit is supplied. `evidenceSelectionEnabled` defaults to true; `evidenceSelectionMaxTokens` defaults to 2,048 and `evidenceSelectionTimeoutMs` to 30,000. One additional request on the existing route screens excerpts within the evidence budget, reorders valid source IDs, and reports its tokens/latency separately. Rejecting every candidate enables labelled general knowledge; invalid output or provider failure retains original evidence with diagnostics. Selection checks relevance, not final claim entailment.

`answerRepairEnabled` defaults to true and `answerRepairMaxTokens` to 2,048. Missing, unknown or grouped citations, or a Chinese question answered entirely without Chinese, trigger at most one structured correction over the same evidence within the remaining answer deadline. A structured insufficiency result publishes a fixed notice, not uncited factual claims. Failure publishes `model-failed`, never extracted source text. Evidence stays folded; retry restores the question to the composer. This checks citation membership, unsupported numeric literals and a narrow language defect, not factual entailment.

The Client uses 14px interface text and 16px section titles; Wiki prose and chat content follow the Harness content-font setting. Wiki and graph reload on entry. Q&A renders Markdown above a bottom composer and labels streamed or stopped text as unverified drafts. Answers continue across tabs within the same knowledge base; other tabs show return and stop controls. Answer activity and page loading are independent. Explicit stop, switching knowledge bases or closing the workspace cancels generation; late output is ignored. Model mode sends page-local conversation memory to resolve follow-ups, then retrieves original evidence again. Reopening loads persisted questions, terminal answers and historical citations; page-local summaries are rebuilt. Source-revision changes mark historical answers for review. Enter sends, Shift+Enter inserts a line, and IME composition does not submit.

Conversation memory includes completed answers, or only the question for stopped/failed turns. `historyMaxChars` defaults to 24,000, `historySummaryChars` to 4,000 and `historyRecentTurns` to four. Older turns are summarized above the effective threshold or at 100 uncompressed turns; recent turns are preferentially retained, but an oversized recent turn may also need summarization. Successful completion commits the summary locally. Failed compaction does not silently discard history. Known model context capacity can reduce these allowances; UTF-8 byte checks conservatively reserve input, output and framing space rather than claiming exact tokenization. History is not paper evidence. Answer details show the resolved query, compaction counts, model budgets and additional usage. See the [conversation spec](../specs/F001-llm-wiki-knowledge-base/conversation-context.md).

Every Wiki model request uses official route preparation and a standalone `wiki-` session with existing request-header, user-message and chunk events. Input flushes before dispatch and output before detachment. Missing or failed persistence prevents dispatch. These logs contain questions and sent excerpts, follow Harness session retention, and are not erased by deleting a knowledge-base document. They do not become conversational context or compiled knowledge.

`src/document-import.ts` owns bounded source classification, constant-stack base64 validation, XLSX and HTML projection, page-level PDF quality checks, problem-page rendering, normalization, and source hashing. `src/paddleocr-worker.ts` supervises the loopback worker, credentials, timeouts, and response validation; `worker/paddleocr_worker.py` is the low-resource PP-OCRv5 CPU provider. `src/semantic-retrieval.ts` owns offline local embeddings, vector serialization, cosine scoring, and reciprocal-rank fusion. `src/store.ts` owns processing state, SQLite transactions, chunking, lexical and hybrid retrieval, Wiki compilation, lifecycle rules, logical backups, and evidence hashes.

Compiled-knowledge navigation sends complete compiled sections and fact statements to the compiler route, then checks original quotes against up to four evidence needs. Derived pages guide lookup but are not citations. Successful navigation replaces expansion and generic selection; missing compilation, failed navigation or limits retain baseline retrieval with diagnostics. Local mode and greetings skip navigation. This adds at most two logged requests; the final answer still uses the Wiki QA route. `knowledgeNavigationEnabled` defaults to true, `knowledgeNavigationMaxInputChars` to 160,000, `knowledgeNavigationMaxTokens` to 8,192 per request, and `knowledgeNavigationTimeoutMs` to a shared 120,000ms deadline. Input exceeding the complete-page bound falls back without silently dropping papers. Whole original quotes must fit the existing answer evidence allowance. Details show per-need evidence IDs, gaps, model, calls, tokens and lookup count; relevance judgments are not proof. See the [navigation spec](../specs/F001-llm-wiki-knowledge-base/knowledge-navigation.md) for acceptance limits.

`KnowledgeController.retrieveEvidence` exposes the same evidence preparation to bound Preset tools without generating a final answer. It shares retrieval settings, compiled navigation, query expansion, selection, cancellation and evidence formatting with AI QA. Presets supply standalone questions from their own conversation context and use their Agent model for synthesis; auxiliary requests retain Wiki routing and official logs. See the [Preset retrieval contract](../product-knowledge-context/README.md).

<a id="further-exploration"></a>
## Further Exploration

Evaluation is a developer-maintenance capability, not a daily Wiki page. The Client has no evaluation tab, form or dispatch binding. The Host `evaluate` Remote retains deterministic scoring; `evaluateModel` runs independently labelled questions through the actual Wiki answer pipeline and returns full answers, timing, recall and blank human-review fields. These checks do not measure LLM academic understanding or synthesis quality. See the [maintenance-only evaluation spec](../specs/F001-llm-wiki-knowledge-base/evaluation-maintenance-only.md).

- [Knowledge context tools](../product-knowledge-context/README.md) — preset-scoped Agent access.
- [Product Bundle](../product-bundle/README.md) — formal profile composition.
- [Product package map](../README.md) — ownership and dependency rules.
- [Migration provenance](PROVENANCE.md) — exact Studio reference and non-migrated history.

<a id="model-experience"></a>
## Model Experience

### Knowledge provider

#### What the model sees

Local mode sends no model request. AI mode resolves the official Wiki Settings route or the Profile default when both route fields are blank. Expansion returns a query, never evidence. Generation receives the question and bounded source labels, line ranges and text. Instructions require synthesis in the question's language, preserve study/version boundaries, treat evidence as untrusted and disable tools. Evidence-backed answers require valid `[n]` citations; `model-general` has no source citations or evidence confidence. Correction reuses the same evidence and requests a structured answer or insufficiency result. Cancellation reaches the provider; failed output produces an explicit failure notice. Agent-tool retrieval remains separate.

#### Token effect

Local mode and local embeddings consume no LLM tokens. Generation uses the evidence budget (default 12,000 characters). Output tokens default to `0`, inheriting the model route's default allowance; a positive value of at least 64 overrides it without a Wiki-specific 16,384 ceiling. Missing default metadata requires an explicit value, and provider/context limits still apply. Saved overrides remain authoritative. Conversation memory adds one follow-up-resolution request and, when needed, one compaction request. Expansion, selection and conditional correction each add at most one bounded request. Correction shares the answer deadline but has a separate output cap. Auxiliary calls use `off` only when the exact model advertises it; final answers retain selected reasoning. Details report each request's token usage separately when supplied; generation latency includes correction.

#### KV Cache effect

Local mode has no effect. Model-mode Wiki QA is a standalone streamed request, so it does not extend an Agent Session's reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Ingestion accepts individual PDF, DOCX, XLSX, UTF-8 HTML, Markdown, and UTF-8 TXT uploads of at most 20 MiB. XLSX uses displayed cell text and does not recalculate formulas, execute macros, or preserve chart and pivot-table semantics; HTML parsing does not execute JavaScript or load remote resources. Scanned PDFs have local page-level OCR; persisted page coordinates, OCR cache, retry DPI, cancellation, detailed diagnostics UI, and an unattended background worker remain later F003 increments. File crawling, legacy XLS, scheduled ingestion, and multipart streaming are not implemented.
- Retrieval uses FTS5 for ASCII/number candidates, bounded parameterized substring queries for Chinese phrase/bigram candidates, then deterministic weighted lexical reranking. Experimental hybrid mode adds local multilingual embeddings, a revisioned SQLite vector index, bounded exact cosine scanning, deterministic reciprocal-rank fusion, and lexical fallback. It is not a Wiki compilation or availability requirement. The current Product Bundle still selects `lexical`; a graphical model installation/import flow, BGE-M3 comparison, and representative-paper acceptance testing remain F005 increments.
- Generated QA and compilation require configured official routes, credentials and working session persistence. Citation membership and literal-number preservation do not prove claim support. Language checks cover narrow English/Chinese defects, not every mixed-language case. Visual review is page-level, not a crop editor or exact curve digitizer; candidate-page heuristics can miss complex layouts, so users can edit the selected pages. Independent paper-quality acceptance remains required by the [academic quality spec](../specs/F001-llm-wiki-knowledge-base/academic-quality.md).
- The enhanced native SVG graph derives page, source, topic, page-type, and section nodes plus links-to, source, topic, type, containment, and sequence relations. It is capped at 300 nodes and 600 edges and is not a large-graph analytics or model-inferred entity engine.
- Evaluation compares baseline and optimized lexical profiles plus the optional hybrid profile on Recall@10, MRR@10, query latency, answer completion, retrieval hit, evidence coverage, citation validity, answer faithfulness, honest no-answer behavior, and input robustness. It is deterministic rather than LLM-as-judge or a semantic-quality benchmark.
- Logical backups omit originals; full compressed backups retain them and enforce symmetric size/hash validation. Neither is an incremental backup system.

<a id="dev-note"></a>
### Dev Note

This is product-owned code adapted to the current official Harness baseline. It is not a runtime dependency on DeepSeek Harness Studio.
