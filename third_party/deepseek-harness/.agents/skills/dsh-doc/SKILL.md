---
name: dsh-doc
description: Create, restructure, or audit DeepSeek Harness documentation and maintain its website projection. Use for Markdown, package README structure, bilingual pairs, navigation, or documentation checks; use dsh-prose-standard for sentence-level editing.
---

# DeepSeek Harness documentation

Keep documentation accurate, useful to its intended reader, and at the nearest owning level. [docs/AGENTS.md](../../../docs/AGENTS.md) owns document forms and budgets; [dsh-prose-standard](../dsh-prose-standard/SKILL.md) owns preservation of facts and editorial judgment. Follow [root scope and authority](../../../AGENTS.md#scope-and-authority); this workflow does not authorize deployment, external writes, or unrelated restructuring.

## Workflow

1. Infer the requested scope and read the applicable instructions, target page, and relevant source or tests. Consult navigation and bilingual records when affected.
2. Identify the reader, document purpose, nearest owner, and observable outcome. Keep essential behavior, failures, recovery, ownership, and limitations locally; link deeper detail to its owner.
3. Use the document's existing format. Package READMEs use the matching template below. Agent Notes retain their lifecycle skeleton; `AGENTS.md`, `SKILL.md`, and short references do not need README wrappers.
4. Check changed claims against their authoritative source using the evidence procedure below. Correct the owner before regenerating derivatives.
5. Update any bilingual counterpart minimally, preserving untouched prose, terminology, structural alignment, code, and links. Confirm meaning before `pnpm run verify-translation-pairing --write <pair>`. Routine translation stays with the active agent; the extended translation skill requires explicit user invocation.
6. Run the applicable validation once and review the complete diff for factual completeness, brevity, and unintended scope expansion.

## Fact-check procedure: test, do not assume

Use current package metadata for names and entry points, public types and source for supported behavior, focused tests for exercised paths, and active decision records for rationale. State whether evidence comes from inspection or execution; do not claim an unrun operation passed.

Exercise changed commands or configurations when runtime behavior cannot be established adequately by inspection, or when an executable tutorial is the deliverable. Use an isolated fixture for destructive examples. Documentation work alone does not authorize installation into a live profile, publication, deletion, credential use outside scope, or a paid service call.

If execution is unavailable, retain supported facts, identify the precise unverified claim and missing prerequisite, and continue independent edits. Correct claims contradicted by evidence; do not delete valid security, failure, or compatibility requirements simply because this host cannot reproduce them. Fetch a remote base only for a requested PR or upstream comparison; otherwise the current checkout is the working source.

## Kind system and templates

Inspect package metadata and the entry module before writing installation guidance. A bundle declares `dsh.bundle.patch` and supplies a profile layer; a plain plugin mounts in `cordis.yml`; a library exposes a module API. Installing an npm dependency alone does not activate a plain plugin or library.

Open only the template matching the [kind derivation](references/metadata-links-i18n.md#the-kind-system):

- [package-group](templates/package-group.md): package-family maps.
- [package-reference](templates/package-reference.md): Cordis plugins and services.
- [package-library](templates/package-library.md): plain module APIs.
- [package-bundle](templates/package-bundle.md): installable profile layers.

Preserve the required metadata and canonical Model Experience / Known Limitations sections. New kinds need a distinct template, declared owner, and focused format check.

For a worked package-reference example, see the session-persistence-sqlite README pair ([English](../../../packages/session/session-persistence-sqlite/README.md), [Chinese](../../../packages/session/session-persistence-sqlite/README.zh.md)).

## Audit the corpus

Audit only the requested files or tree. Use the [documentation standard's checklist](../../../docs/AGENTS.md#the-slop-checklist) to locate duplicate rules, copied catalogs, stale claims, and misplaced detail; judge each candidate against its current owner. Word counts locate outliers, not deletion quotas. Keep archived notes frozen and treat fixtures, snapshots, and generated catalogs as derivatives of their source.

When a proposed trim would change a supported feature or obligation, preserve it unless that behavior change is authorized. Use [the Agent Note rules](../../notes/README.md) for durable process or design decisions; do not turn routine prose editing into a code-simplification survey.

## Detailed references

Read only the reference needed for the affected format:

- [Metadata, links, and bilingual pairs](references/metadata-links-i18n.md): README fields, kind derivation, localized links, alignment, and sidecar records.
- [Page structure and hierarchy](references/structure-hierarchy.md): human-facing page order, depth, placement, and working-note ownership.
- [Page style](references/style.md#controlled-technical-english): English clarity, section separators, and folding.
- [Review criteria](references/review.md): consumer coverage and the package README example.
- [Website publication](references/website-sync.md): public allowlist, routes, projection, build validation, and deployment authorization.

## Validation

Select checks by the changed content; a successful check remains evidence until a later edit invalidates it.

- Instructions or Markdown prose: `pnpm run test:docs` covers the quick documentation checks without building runtime artifacts. Use scoped pairing checks during paired edits.
- Generated catalogs or compilable examples: run the owning freshness or type check; use `pnpm run doc-sync` for the complete documentation pass required before a documentation PR. It includes the quick checks, so do not run both aggregates on unchanged content.
- Website mappings or presentation: follow [website validation](references/website-sync.md#preview-and-validate).
- Changed scripts, generators, or product-visible strings: add the owning behavioral checks through [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md). Run lint for affected code; prose-only edits do not require a runtime build and full code lint.
- Skills: check invocation metadata, required frontmatter, and reference targets. New or changed executable guards need a meaningful negative case; wording edits do not need tests that match their wording.

Finish with `git diff --check`. Report inspected scope, edits, preserved constraints, actual commands and outcomes, and any pre-existing or environment failures separately.
