---
description: "Preset-bound Agent tools for bounded, source-evidenced access to product knowledge bases."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-knowledge-context

English | [中文](README.zh.md)

## Summary

This package turns explicit Preset bindings into three Agent tools: `knowledge_search`, `knowledge_read`, and `knowledge_sources`. It resolves stable knowledge-base aliases at execution time, rejects unavailable required bindings and revision mismatches visibly, and never injects an entire knowledge base into the prompt.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it in a Preset's `agent.cordis.yml`, not globally in the Product Bundle. Declare one or more `bindings` with `role`, stable `ref`, optional revision, and `required`. A missing binding makes tool use fail closed instead of silently answering without knowledge.

<a id="understand-the-implementation"></a>
## Understand the implementation

Each call resolves the configured binding against `ctx.knowledgeBases`. Search shares Wiki AI QA evidence preparation: configured lexical/hybrid retrieval, compiled-page navigation, document-local source checks, query expansion and relevance selection. Its initial candidate limit defaults to eight; navigation can retain complementary quotes within the Wiki evidence budget. Reads return at most 200 source lines; source listing returns metadata without document bodies.

Search rejects cancellation, changed bindings/revisions and a complete rendered JSON result exceeding `maxResultChars` (default 64000). Source hashes and line ranges identify original passages; `excerptTruncated` labels shortened text. Multiple Presets can bind the same library without copying sources, compilations or indexes. See the [retrieval parity decision](../specs/F001-llm-wiki-knowledge-base/preset-retrieval-parity.md).

<a id="model-experience"></a>
## Model Experience

### Knowledge retrieval tools and results

#### What the model sees

The model receives `knowledge_search`, `knowledge_read`, and `knowledge_sources` schemas. Calls and evidence-rich JSON results remain in conversation history; results carry stable aliases, revisions, document ids, bounded line locations, retrieval fallbacks and navigation requirements. Derived navigation context is not source evidence. The current Harness Agent synthesizes the final answer; the tool does not dispatch a separate final-answer request.

#### Token effect

The three schemas add a small fixed cost while the Preset is active. Calls and bounded results add data-dependent suffix tokens until compaction. Navigation, expansion and selection can make bounded model calls using Wiki settings and compiler routing, recorded in official diagnostic sessions. Search does not compile papers, run OCR or send images.

#### KV Cache effect

Prefix-stable while the Preset bindings and tool definitions are unchanged; retrieved content is append-only after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- F001 implements Preset-level bindings only. Session-temporary and workspace-default precedence are deferred.
- Bindings are configuration, not a permission boundary; deployment policy must still control who can edit Presets.
- The Agent supplies a standalone question using its own conversation context. Wiki conversation compression and final-answer repair are not executed by this retrieval tool.

<a id="dev-note"></a>
### Dev Note

Business bindings belong in `agent.cordis.yml`; `preset.yml` remains display metadata.
