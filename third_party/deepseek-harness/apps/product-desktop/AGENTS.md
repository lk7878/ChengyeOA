# AGENTS.md — Product desktop

- Keep this application limited to the desktop shell, operating-system integration, packaging, and delivery.
- Put reusable contracts, runtime plugins, client extensions, presets, and bundle composition under `packages/product/`.
- Launch product behavior through the dedicated profile and formal product bundle; do not build a second application composition in the desktop shell.
- Require an approved desktop feature with an explicit user path and delivery acceptance criteria before adding implementation.
- Verify desktop-visible behavior through the packaged application path in addition to the product profile.

The [product-extension Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-isolate-product-extensions.md) owns the rationale.
