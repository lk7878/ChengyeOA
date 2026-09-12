# Agent Note: Durable Wiki evidence and resumable local work

Status: implemented

English | [中文](2026-09-10-wiki-durable-evidence.zh.md)

## Problem

Page-local conversations and queues lose context across restarts. Logical export can exceed its own import limit, while discarded originals prevent reprocessing. Citation membership and retrieval success can be mistaken for academic correctness. Chinese candidate truncation and oversized single-line chunks also lose useful evidence.

## Decision

The existing product SQLite store owns conversation snapshots, resumable import/compilation work, source-bound extraction checkpoints, retained visual images and cross-paper topic pages. Immutable answer citations and retained visual images survive ordinary source deletion. A bounded compressed backup restores the complete library transactionally with remapped identities. Schema migration rebuilds derived indexes without altering source revisions.

Model answers remain semantically unverified. Numeric checks reject a concrete hallucination class; independently labelled live-model evaluation preserves raw outputs and leaves human correctness fields blank. Topic drafts compare selected original excerpts, require an explicit save, preserve human notes and reject stale edits. The [reliability contract](../../../../packages/product/specs/F001-llm-wiki-knowledge-base/reliability.md) owns bounds and recovery semantics.

This partially supersedes the persistence limitations in the [workspace decision](2026-09-02-product-knowledge-workspace.md) and [native UI decision](2026-09-05-harness-native-wiki-workspace-ui.md). Their product ownership, portable recovery and application-shell rationale remain active. The [academic QA decision](2026-09-05-academic-qa-provenance.md) retains AI-default and general-answer provenance authority; its quality caveats remain applicable. The proposed local-hybrid retrieval decision remains independent of these lexical repairs. No existing note is fully superseded or archived.

## Alternatives considered

**Keep browser memory and retry whole compilations.** This loses completed work and source snapshots after restart. SQLite already owns the library and supports the required transaction boundary without another service.

**Use physical database copies as the only backup.** This binds recovery to schema and WAL/filesystem state. Versioned compressed data keeps portable validation while retaining original bytes.

**Treat valid citations as verified answers.** Source identity cannot establish entailment. Numeric checks and explicit uncertainty help, but semantic accuracy requires independent labels and review.

## Consequences

Restoration is bounded by memory and transport limits. Missing originals or unrecoverable historical images stop full export. Pending paid compilation resumes only through an explicit user action. Topic comparison uses bounded excerpts and can miss relevant full-paper context. Retained conversations and visual images occupy local storage until the library is deleted. Real-paper quality claims remain unavailable without the labelled acceptance run.

## Verification

Regression tests cover candidate ranking, source-preserving migration, large complete backups, restart recovery, pagination, interrupted compilation, fabricated numbers and topic editing. Loader composition and Client snapshots exercise durable final answers and reviewed topic publication. Product compilation and desktop checks validate the shared deliverable.
