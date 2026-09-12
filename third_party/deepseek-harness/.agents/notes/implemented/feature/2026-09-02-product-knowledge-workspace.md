# Agent Note: Complete local product-knowledge workspace

Status: implemented

English | [中文](2026-09-02-product-knowledge-workspace.zh.md)

## Problem

F001 persisted Markdown and exposed bounded FTS5 search, but most of the Knowledge Base Center remained placeholder navigation. Operators could not browse compiled pages, inspect relationships, ask an evidence-bearing question, run a repeatable quality check, manage lifecycle state, or move a knowledge base safely between profiles. Copying Studio's standalone Next/Fastify application would also break the official-Harness baseline and product ownership boundary.

## Decision

The product-owned `product-knowledge` Host/Client package implements the local workspace through the `knowledge` Typert Remote and keyed `main.page` contribution. The Host accepts bounded PDF, DOCX, Markdown, and TXT source bytes, retains them locally, records their format and SHA-256 identity, and extracts normalized Markdown before indexing. Exact source bytes are idempotent within one knowledge base. Failed extraction persists a visible failed document without FTS5 rows, and an operator can rerun extraction when the original bytes remain available. Markdown is compiled on demand into a deterministic Wiki manifest with revision, stable content hash, aggregate statistics, inferred page type/topic, source ranges, and resolved `[[Wiki Link]]` relations. The enhanced graph derives page, source, topic, page-type, and section nodes together with links-to, has-source, has-topic, has-type, contains, and next relations; the Client provides bounded cluster and structure layouts, type/relation filters, search, focus, and entity details. FTS5 recalls bounded ASCII/number candidates; bounded parameterized substring queries supplement Chinese phrase/bigram candidates because `unicode61` does not segment continuous Han text. A deterministic weighted lexical ranker then combines exact phrase, file name, heading, content, and per-document diversity.

The [academic QA note](2026-09-05-academic-qa-provenance.md) owns the AI-default and general-answer policy. The official Settings service owns Wiki generation routes and budgets, with the Profile default used when both route fields are blank. Stream cancellation and safe model failure diagnostics remain independent of the chosen answer mode. Deterministic evaluation compares baseline and optimized retrieval across seven dimensions; general model answers do not count as retrieval success.

All content mutations require an active knowledge base. Destructive and restore operations enforce their invariants in the store rather than relying on disabled buttons. Logical backup version 3 preserves extracted Markdown, source metadata, and processing outcomes but excludes original source bytes; restore also accepts versions 1 and 2 and validates every extracted-content hash before entering one SQLite transaction. The [durable evidence decision](2026-09-10-wiki-durable-evidence.md) owns complete backups, conversations and resumable work. The product Bundle and dedicated Profile remain the formal composition path, and official baseline packages are unchanged.

## Alternatives considered

**Embed Studio's standalone application.** Rejected because it would introduce a parallel Next/Fastify runtime, child-process launcher, generated data tree, and Studio-specific configuration instead of adapting capabilities to current Harness services.

**Adopt G6 as a required runtime dependency.** Rejected for this increment. The migrated contract is the Studio graph's information and interaction capability, not its rendering library. Deterministic native SVG cluster and structure layouts satisfy the 300-node/600-edge inspection boundary while keeping the Client package small; a graph library remains an evidence-driven future choice if scale or interaction requirements exceed that boundary.

**Replace local retrieval with generation.** Rejected because credentials and nondeterministic output would weaken offline acceptance and failure recovery. The [academic QA decision](2026-09-05-academic-qa-provenance.md) changes the Client default but preserves explicit local retrieval and distinguishes general model knowledge from source evidence.

**Copy the SQLite database as backup.** Rejected because a physical snapshot couples recovery to schema and filesystem state. The logical format is portable, hash-verifiable, non-overwriting, and transactionally restored.

## Consequences

Every visible Knowledge Base Center tab is functional, including the four Studio parity gaps closed by the follow-up increment: enhanced graph interaction, true Host-to-Client answer streaming, Settings-backed Wiki model routing, and seven-dimension baseline/optimized evaluation. Remaining limits are explicit: individual 20 MiB file uploads rather than crawling or multipart streaming, no XLSX/HTML or OCR extraction, lexical rather than vector retrieval, deterministic rather than judge-model evaluation, and bounded non-inferred graph rendering. AI QA consumes model tokens, while explicit local mode remains credential-free; the academic QA note owns provenance and fallback behavior. Restored documents remain searchable but cannot be reprocessed because logical backups omit original bytes. Host and Client tests pin supported source processing, deduplication and failure isolation, deterministic English/Chinese ranking, Wiki-manifest/enhanced-graph behavior, streamed local/model/fallback QA, Settings route parameters, paired evaluation behavior, archive and delete rules, backup integrity, restore collision handling, and the management UI flow. Migration provenance records the Studio concepts reviewed and the runtime/history deliberately excluded.
