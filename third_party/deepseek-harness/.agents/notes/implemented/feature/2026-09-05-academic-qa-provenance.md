# Agent Note: Academic QA query expansion and general-answer provenance

Status: implemented

English | [中文](2026-09-05-academic-qa-provenance.zh.md)

## Problem

Chinese questions over English papers lack lexical matches, while a greeting can accidentally match a URL in a reference list. Returning an empty result without a model request makes the knowledge chat appear unresponsive. Fluent general answers, however, must not be presented as verified paper findings.

## Decision

AI is the Client's default answer mode; explicit local retrieval remains credential-free. The official Harness model route handles evidence-backed answers and, when evidence is absent, explicitly labelled general knowledge with no numbered citations or evidence confidence. Greetings bypass incidental retrieval matches. A bounded query-only model request can translate Chinese or empty-result questions into English keywords; original and expanded retrieval results use the existing rank-fusion helper and retain authoritative source ranges and hashes. Failed expansion retains original retrieval, cancellation propagates, and answer diagnostics separate expansion cost from generation cost.

Mixed Chinese/Latin tokenization preserves source identifiers. A query naming a source identifier or year seeds its first substantive opening passage alongside keyword candidates; title-only chunks are excluded. This supplies local document context without treating an index label or generated query as evidence. General answers and evidence-backed answers have different citation validation rules and an explicit wire discriminant.

This partially supersedes the default-mode decision in the [workspace note](2026-09-02-product-knowledge-workspace.md); its ownership, offline retrieval, lifecycle, and Settings rationale remain active. The [academic quality specification](../../../../packages/product/specs/F001-llm-wiki-knowledge-base/academic-quality.md) owns research references, pilot limitations, and the separate stable-release evaluation requirements.

## Alternatives considered

**Keep the evidence-only default.** It preserves offline behavior but does not satisfy the explicitly requested general-response fallback; an explicit local mode preserves that use case.

**Enable the existing embedding configuration immediately.** The two-paper pilot does not justify this default. Model installation alone does not establish relevant passage retrieval, so hybrid remains opt-in.

**Adopt a complete external RAG application.** Query expansion and source context fit the existing product package, SQLite store, and official LLM route. Another service stack would not itself fix evidence quality and would duplicate configuration and deployment responsibilities.

## Consequences

Source-only academic guides share verbatim ranges between Wiki browsing and overview retrieval, without a generated index or compilation token cost. Heading recognition remains incomplete. Logarithmic term frequency reduces repeated-keyword dominance. One bounded request on the official model route selects authoritative evidence IDs before generation; failure retains original candidates with separate diagnostics. This is relevance filtering, not an entailment judge. Desktop delivery requires verification after rebuilding, not merely a temporary Profile page.

Desktop verification exposed reasoning consuming auxiliary output budgets and a saved Wiki token limit overriding the new default. Auxiliary requests use reasoning off only when model metadata advertises it; final-answer reasoning is preserved. The default answer budget is 4096 tokens, with saved settings remaining authoritative. Updating the existing Wiki limit from 1200 to 4096 allowed the Chinese THUMS overview to complete, but a query-expansion failure and unsupported terminology translation remain explicit evaluation cases.

AI mode uses credentials and can add one query-generation request; local mode and deterministic evaluation do not. Valid source numbers prove source identity, not entailment: semantic relevance and factual support still require representative evaluation. Model completion and general fallback do not count as retrieval success. The real Profile answers Chinese greetings and the 2025 paper's version/load-case question, while fixed retrieval-only checks retain failing cases. Unit and Client checks cover provenance, invalid citations, bounded expansion, cancellation, source routing, and visible failure states. Multi-turn context, learned reranking, and the 90-point academic acceptance target remain unverified.
