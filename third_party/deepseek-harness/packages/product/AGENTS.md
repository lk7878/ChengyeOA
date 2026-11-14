# AGENTS.md — Product packages

These rules supplement the repository and `packages/` instructions.

- Keep every custom product contract, runtime plugin, client extension, preset, and bundle under `packages/product/`.
- Keep every product Feature Spec, governance rule, migration record, and product version mapping under `packages/product/specs/`; do not move or edit Harness-owned specifications to maintain product decisions.
- Use official plugin, event, and Service Definition extension points. A change outside this group requires an approved upstream-extension exception and a corresponding private patch-ledger entry.
- Treat Studio as reference material, never as a runtime or workspace dependency. Preserve applicable source and license attribution for adapted code.
- Keep dependencies directed from runtime and client packages toward product contracts and official Service Definitions. Presets and bundles compose behavior; they do not implement it.
- Make `product-bundle/cordis.patch.yml` the formal product composition. Use CLI `--patch` only for development, tests, and temporary overrides.
- Verify product-visible behavior through the dedicated profile. Include `apps/product-desktop/` verification when the feature affects desktop delivery.
- Do not create a package until an approved feature has a current consumer and an explicit responsibility. Determine the product package namespace before creating the first publishable package.

The [product-extension Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-isolate-product-extensions.md) owns the rationale.
