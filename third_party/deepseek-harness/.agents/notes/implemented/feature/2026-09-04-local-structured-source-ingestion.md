# Agent Note: Keep structured source ingestion independent of semantic retrieval

Status: implemented

English | [中文](2026-09-04-local-structured-source-ingestion.zh.md)

## Problem

The product Wiki needs to compile locally supplied spreadsheets and HTML documents. Treating those input formats as part of an embedding project would make basic ingestion depend on another model, index lifecycle, storage format, and evaluation regime even though the existing lexical path already compiles and cites normalized Markdown.

## Decision

The product knowledge package classifies XLSX and UTF-8 HTML as local document kinds and converts them to bounded Markdown before the existing persistence, chunking, lexical retrieval, Wiki compilation, citation, and backup operations. This behavior is owned by [F004](../../../../packages/product/specs/F004-xlsx-html-document-ingestion/spec.md).

XLSX worksheets become second-level headings and Markdown tables that retain source row numbers and displayed cell text. Product configuration limits worksheet count, total non-empty rows, and used columns per worksheet. The parser does not recalculate formulas or execute macros.

HTML conversion retains visible document text while skipping scripts, styles, noscript fallbacks, and navigation regions. It does not create a browser, execute JavaScript, or load remote resources.

Weighted lexical retrieval remains the authoritative default. Embedding and vector indexes are optional enhancements that require a separate Feature and corpus-specific recall evidence; they are not prerequisites for ingestion, Wiki compilation, or product availability.

## Alternatives considered

**Require vector retrieval for the new formats** — rejected because a source parser and a retrieval index solve independent problems. The dependency would add model and index operations without proving better compilation or citation.

**Implement XLSX ZIP/XML and HTML parsing directly** — rejected because maintained local dependencies remove format-parser code and tests the product would otherwise own.

**Execute HTML in a headless browser** — rejected because local files do not need active page behavior, and script execution or remote loading would enlarge the security and privacy surface.

## Consequences

Users can import spreadsheets and saved HTML pages through the same local knowledge workflow without model tokens or network parsing. XLSX chart, pivot-table, macro, and formula-calculation semantics are deliberately absent, and JavaScript-rendered page content must be saved as static HTML or supplied through another supported format. Semantic retrieval can still be added later without changing the ingestion contract.

## Verification

The product knowledge tests cover searchable XLSX worksheet content, source row projection, worksheet limits, searchable HTML body content, and exclusion of script and navigation text. Host type checking and Product Profile composition verify the configured limits and package dependency graph.
