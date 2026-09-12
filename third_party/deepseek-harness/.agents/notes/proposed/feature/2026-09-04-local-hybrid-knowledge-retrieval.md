# Agent Note: Add local hybrid retrieval without weakening source evidence

Status: proposed

English | [中文](2026-09-04-local-hybrid-knowledge-retrieval.zh.md)

## Problem

The product knowledge base must retrieve evidence from Chinese and English academic material where a user's wording can differ substantially from the source. Weighted lexical retrieval preserves exact terms, identifiers, formulas, and deterministic citations, but it can miss paraphrases and cross-language concepts. Dense retrieval can improve those cases, yet a model index adds installation, invalidation, resource, privacy, and failure behavior that must not become a prerequisite for Wiki compilation.

## Proposal

Implement [F005](../../../../packages/product/specs/F005-local-hybrid-retrieval/spec.md) as an optional local semantic candidate source beside the existing lexical retriever. Fuse candidate ranks deterministically, then apply the existing result bounds and return only authoritative persisted chunks with revision, line, and hash evidence.

Store versioned vectors as local derived data and build them after textual revisions commit. Model installation is explicit and normal operation is offline. Missing, stale, incomplete, cancelled, or failed semantic indexes fall back to lexical retrieval with bounded diagnostics.

Begin with an exact cosine-scan baseline and benchmark a lightweight multilingual E5 model against BGE-M3 on the current CPU host. Keep hybrid mode experimental until a fixed corpus-specific evaluation demonstrates better semantic recall without reducing citation validity or honest no-answer behavior.

## Alternatives considered

**Replace lexical retrieval with dense retrieval** — rejected because exact academic terms and source identifiers remain important, while model similarity alone does not prove evidence relevance.

**Use a hosted embedding API and vector database** — rejected for the first implementation because private documents should remain local and the Wiki must not acquire another credential, network, billing, or service dependency.

**Adopt an approximate native index immediately** — rejected until corpus size and exact-scan measurements demonstrate a need; a native extension would add Windows packaging and recovery risks before it solves a measured limit.

## Acceptance criteria

- Lexical mode remains fully functional without model or index files.
- Hybrid results retain exact chunk evidence and deterministic fusion ordering.
- Index lifecycle follows document revisions and never exposes stale or partial vectors as complete.
- A representative paper evaluation records semantic recall, citations, no-answer behavior, latency, memory, build time, and disk usage.
- Hybrid mode becomes recommended only when the recorded evaluation meets the F005 upgrade gate.

## Risks

OCR errors can create semantically misleading vectors, and long academic chunks can exceed a model's input length. The implementation therefore depends on stable F003 text quality, versions the embedding projection, retains lexical candidates, and reports truncation and coverage. Exact scanning will not scale indefinitely; the first implementation uses a configured bound and requires a later measured indexing decision beyond it.
