# F001 migration provenance

## References

- Official implementation baseline: `deepseek-ai/deepseek-harness` at `0a53fb55bea101816fa226bb964ae2bed71c343b` (`0.1.2-alpha.2`).
- Capability reference: `fufankeji/deepseek-harness-studio` at `c403d45d63866e65452fdaf680519fdeaee7d3ad`.
- Studio scope reviewed: `packages/examples/ff-llm-wiki-plugin/`, including `application/apps/api/src/documents/processor.ts`, `wiki/`, `graph/`, `qa/`, `eval/`, `data/`, its API tests, and the corresponding `application/apps/web/src/components/` views.
- Reference license: MIT, copyright 2026 FF, as recorded in the Studio package's `LICENSE`.

## Adapted capability concepts

- A first-class Knowledge Base Center with overview, documents, wiki, graph, QA, evaluation, and settings destinations.
- Knowledge data as an independently persisted product resource rather than Session-owned state.
- A stable product entry and a future Preset binding seam.
- Wiki compilation, graph inspection, retrieval QA, repeatable evaluation, and lifecycle management as one coherent operator workflow.
- Bounded PDF, DOCX, Markdown, and TXT ingestion with explicit processing outcomes and source identity.
- XLSX and HTML as desired source formats; F004 implements their local conversion independently because Studio declared but did not implement those parsers.

## Deliberately not migrated

- The standalone Next/Fastify application, browser-launch bridge, child-process runtime, bundled seed database, and generated runtime tree.
- Environment-variable credential forwarding and Studio-specific Desktop/plugin-center integration.
- Studio's seven bundled Presets and historical package topology.
- Studio's DeepSeek-backed generative answer path, G6 graph dependency, filesystem compiler/runtime outputs, seed content, result fixtures, and placeholder XLSX/HTML parser behavior. The product uses local bounded format parsers, optional Harness-backed generation, native SVG, SQLite-owned source data, and logical JSON backups instead.

## Code reuse statement

F001 is a new implementation against current official Harness services, Typert Remotes, Client slots, Bundle/Profile composition, and `node:sqlite`. No Studio source file or generated artifact was copied into this package. Future direct code reuse must identify the exact source path and commit here and preserve the applicable license notice.
