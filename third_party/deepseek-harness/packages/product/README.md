---
description: "Product-owned DeepSeek Harness extensions, composition, and dependency rules."
kind: "package-group"
---

# Product packages

English | [中文](README.zh.md)

## Summary

`packages/product/` owns every custom product contract, runtime plugin, client extension, preset, and product bundle. Official Harness packages remain the upstream foundation; product packages extend documented plugin, event, and service-definition mechanisms instead of copying Studio's package topology.

Product design specifications, governance rules, migration records, and version mappings live beside the implementation in the [product specification index](specs/INDEX.md). Harness-owned specifications remain in their upstream locations.

F001 now supplies the first real vertical slice: a persistent knowledge-base Host/Client package, a preset-scoped Agent tool consumer, the formal Product Bundle, and a reusable domain-preset template.

Subsystem reference: [product knowledge](../../docs/subsystems/product-knowledge.md).

## Target topology

```text
packages/product/
├─ specs/
├─ product-knowledge/
├─ product-knowledge-context/
├─ product-presets/
└─ product-bundle/
   └─ cordis.patch.yml
```

- `specs/` is the only maintained location for product Feature Specs and governance records.
- `product-knowledge/` owns F001 contracts, SQLite state, Remote methods, and the native Client page.
- `product-knowledge-context/` owns the three bounded Agent tools and preset binding policy.
- `product-presets/` owns product session compositions when a feature requires them.
- `product-bundle/` owns the formal product composition installed into a dedicated profile.

These names describe intended responsibilities, not mandatory packages. Split a role into another package only when its lifecycle or consumers require independent evolution.

## Dependencies

Contracts do not depend on runtime, client, preset, or bundle packages. Runtime and client packages depend on product contracts and official Service Definitions, not concrete providers. Presets and bundles compose plugins but do not own business behavior.

Studio packages are reference implementations, not product dependencies. Any adopted capability is assessed, adapted to the current Harness baseline, and placed in this group with applicable source and license records.

## Composition and verification

The product bundle's `cordis.patch.yml` is the formal composition source and is installed into a dedicated profile. CLI `--patch` overlays are limited to development, tests, and temporary overrides.

A product-visible capability is complete only after its applicable contract, runtime, client, preset, and bundle work is verified through the dedicated profile. Desktop-visible behavior also passes through `apps/product-desktop/` delivery verification.

F002 supplies the Windows development entry point without changing this composition boundary. See the [Product desktop instructions](../../apps/product-desktop/README.md) for Profile preparation, launch, lifecycle, and current delivery limits.

The ownership decision and alternatives are recorded in the [product-extension Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-isolate-product-extensions.md).
