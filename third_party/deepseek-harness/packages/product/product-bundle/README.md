---
description: "Formal product plugin composition installed into a dedicated DeepSeek Harness Profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-product-bundle

English | [中文](README.zh.md)

## Summary

This static Bundle is the formal product composition source. Its `cordis.patch.yml` installs the persistent knowledge Host and matching Client into a dedicated Profile; it carries the knowledge-context and Preset packages in its dependency closure but leaves Agent bindings to each Preset.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Install the Bundle into the dedicated product Profile. Use CLI `--patch` only for development, tests, or temporary overrides. Do not add business logic or Skill contents here.

From the Harness repository root, create the dedicated Profile through the official plugin manager:

```powershell
pnpm run dsh -- plugin --profile product add ./packages/bundle/web-app
pnpm run dsh -- plugin --profile product add ./packages/product/product-bundle
pnpm run dsh -- --profile product --dump-default-config
pnpm run dsh -- --profile product
```

The resulting ordered layers are `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, then `@deepseek-ai/dsh-product-bundle`. Keep the two add operations separate so the product layer is appended after the Web layer. The commands create and maintain the Profile manifest; do not hand-write it. Run `pnpm --filter @deepseek-ai/dsh-product-bundle verify:profile` for an isolated composition and boot check that uses a temporary `DSH_HOME` and leaves the user's Profiles unchanged.

<a id="understand-the-implementation"></a>
## Understand the implementation

`cordis.patch.yml` inserts one stable `product-knowledge` row. That package owns its Host service, Remote namespace, Client page, persistence, and tests; the Bundle owns only ordered composition. A later id-targeted Profile patch must restate the row's complete configuration because patch rows replace, rather than deep-merge, `config`.

<a id="further-exploration"></a>
## Further Exploration

- [Product knowledge](../product-knowledge/README.md) — persisted knowledge and its native management surface.
- [Knowledge context](../product-knowledge-context/README.md) — bounded model-facing access.
- [Product package map](../README.md) — ownership and dependency direction.

<a id="model-experience"></a>
## Model Experience

### Composition carrier

#### What the model sees

Nothing directly. `cordis.patch.yml` selects available runtime capabilities; a Preset determines which model-facing tools are mounted for an Agent.

#### Token effect

The Bundle adds no tokens itself; its composed packages own their schema, prompt, and result costs.

#### KV Cache effect

The Bundle itself has no cache effect; changes to composed model-facing packages may change the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The current Bundle assembles F001 only.
- The repository-local Profile path is validated; packaged Profile distribution and the desktop delivery shell remain separate release concerns.

<a id="dev-note"></a>
### Dev Note

The logical product version is tracked separately from the official Harness package-manifest version in the private product Specs.
