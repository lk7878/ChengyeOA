# Agent Note: Isolate product extensions from the upstream foundation

Status: implemented

English | [中文](2026-08-31-isolate-product-extensions.zh.md)

## Problem

The product needs to add custom plugins, contracts, client behavior, presets, bundle composition, and desktop delivery while continuing to merge official DeepSeek Harness releases. Placing each addition in the matching upstream package group would distribute product ownership across the repository and make capability migration, review, and upstream conflict analysis harder. Copying DeepSeek Harness Studio's directory structure would also make a reference fork an architectural dependency.

## Decision

Official DeepSeek Harness is the only code baseline. Product-owned contracts, runtime plugins, client extensions, presets, and the formal product bundle live under `packages/product/`. `apps/product-desktop/` is the sole directory exception and owns only the desktop shell, operating-system integration, packaging, and delivery.

Product packages use official plugin, event, and Service Definition extension points. Changes to upstream-owned packages are exceptions that require a demonstrated missing extension point and a private patch-ledger entry. Studio remains a reference implementation: each adopted capability is assessed, adapted to the current Harness baseline, and placed under product ownership rather than imported as a workspace dependency or copied with Studio's topology.

`product-bundle/cordis.patch.yml` owns the formal product composition installed into a dedicated profile. CLI `--patch` overlays remain available for development, tests, and temporary overrides but are not the product launch mechanism.

Feature work proceeds as a vertical slice through only the applicable contract, runtime, client, preset, bundle, profile, and desktop steps. Completion requires a working user path through the dedicated profile; upstream integration separately verifies that product packages build, the bundle composes, the profile starts, and critical user paths still run.

The initial source tree contains ownership instructions and target-topology documentation, not speculative empty packages. An approved feature with a current consumer creates each package when needed. The package-group subsystem-page check carries an explicit `product` exemption until a product package owns a runtime subsystem reference.

## Alternatives considered

**Place product additions in existing Harness groups.** This follows upstream capability ownership but scatters product-specific code and increases the work needed to identify, migrate, or remove a complete product capability.

**Copy Studio's package and application layout.** This shortens initial migration but preserves Studio's historical choices and divergence instead of adapting capabilities to the current official baseline.

**Keep product plugins outside the workspace and load them with CLI `--patch`.** This is useful for experiments, but it does not provide a stable product composition, workspace dependency graph, or release unit.

**Put desktop delivery under `packages/product/`.** Desktop packaging and operating-system integration are application concerns. Keeping them in `apps/product-desktop/` preserves a thin delivery shell while reusable behavior remains in packages.

## Consequences

Product ownership is discoverable under one package group, and upstream merges can distinguish official changes from product additions. The dedicated bundle and profile provide one formal launch path, while temporary overlays remain available for development. The desktop application cannot become a second business implementation. New packages require an actual feature and consumer, so the documented topology may contain roles that do not yet have physical package directories. The temporary subsystem-page exemption must be removed when this group gains a runtime subsystem reference.
