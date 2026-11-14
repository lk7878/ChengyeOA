# Agent Note: Keep the Wiki workspace native to the Harness application shell

Status: implemented

English | [中文](2026-09-05-harness-native-wiki-workspace-ui.zh.md)

## Problem

The product Wiki needs the task-oriented navigation and dense knowledge views demonstrated by Studio without embedding a second application shell inside Harness. Copying Studio's sidebar, routes, hardcoded theme, or demonstration metrics would compete with Harness navigation and create a visual and runtime dependency on the reference application.

## Decision

The product knowledge Client keeps the Harness global sidebar and keyed `main.page` as the only application shell. The Wiki page uses a knowledge-base context bar and horizontal navigation for the dashboard, documents, Wiki, graph, Q&A, and settings.

Studio supplies information-architecture reference only. The dashboard uses Remote document, chunk, revision, and processing facts; the document center combines source ingestion, filtering, and processing detail; the Wiki combines a searchable typed directory with a source-grounded reader; and Q&A uses a message list with a bottom composer and per-answer citation disclosures. Knowledge-base creation, restore, and switching live in one management dialog instead of a permanent nested sidebar.

The Client uses `--dsw-alias-*` theme variables, 14px interface text, 16px section titles, the Harness content-font variables, its Markdown primitive, and the typed `product.knowledge` locale dictionary. Wiki and graph projections reload on tab entry so a revision-zero empty result cannot hide later imports. Studio Tailwind styles, routes, standalone app shell, gradients, glass effects, and demonstration values are not runtime inputs.

## Alternatives considered

**Copy the Studio AppShell and sidebar** — rejected because Harness already owns global navigation, responsive behavior, and page lifecycle. Nested application chrome would duplicate those responsibilities and reduce usable space.

**Keep the permanent knowledge-base administration column** — rejected because creation and restore are occasional operations, while reading, retrieval, and evidence inspection need the full page width.

**Port Studio styling verbatim** — rejected because hardcoded dark colors and effects would not follow Harness light and dark themes and would create unnecessary attribution and maintenance work.

## Consequences

Users get a knowledge-focused layout that follows Harness theme and navigation behavior while retaining the useful Studio view organization. The workspace does not depend on Studio packages or fabricated dashboard data. Knowledge-base administration takes one additional dialog action after a workspace is open. Chat messages survive tab switches and reopen from persisted terminal snapshots under the [durable evidence decision](2026-09-10-wiki-durable-evidence.md); each request independently retrieves evidence. Graph nodes express source structure, not inferred entity or causal relationships.

## Verification

The Client behavior suite exercises workspace selection, the management dialog, ingestion, evidence-bearing search, every navigation destination, streamed-answer cancellation, retained questions and failures, graph refresh after PDF import, and lifecycle operations. A read-only copy of the user's parsed paper produces 29 graph nodes and 52 edges in an in-memory store. Client type checking, Product Profile browser checks, and the Product Desktop build verify integration.
