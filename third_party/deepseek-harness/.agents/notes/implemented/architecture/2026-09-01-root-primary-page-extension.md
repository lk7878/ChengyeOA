# Agent Note: Add a minimal root primary-page extension seam

Status: implemented

English | [中文](2026-09-01-root-primary-page-extension.zh.md)

## Problem

Product plugins need full-height, root-level destinations such as a Knowledge Base Center. The official shell previously exposed sidebar, conversation, details, and overlay seats only. Replacing the Web app or putting product routing into an upstream package would mix business ownership into the foundation.

## Decision

`dsh-client-ui-layout` declares one generic root-scoped keyed slot, `main.page`, with the owner prop `{ pageId: string }`. A plugin contributes a stable key and opens or closes it through `ctx.layout.openPrimaryPage(key)` and `ctx.layout.closePrimaryPage()`. While selected, AppFrame preserves the shell and sidebar, renders the keyed page in the center, and suppresses conversation/details.

The layout service and transient store own selection. The contributor owns all page content, remote calls, and business state. The seam contains no knowledge-base naming or Studio dependency. This patch is recorded as UP-001 in the private upstream patch ledger and must be revalidated on every official baseline merge.

## Alternatives considered

**Separate Next application.** Rejected because it duplicates boot, Client plugin, theme, locale, and Profile composition behavior.

**Put the Knowledge Base Center inside conversation details.** Rejected because a durable product resource is not Session-owned and needs a first-class navigation destination.

**Add a knowledge-specific route to ui-layout.** Rejected because the upstream-owned package must expose only a reusable extension contract.

## Consequences

Product destinations can remain additive Client plugins. Keys are a shared namespace and an occupied key is a replacement point. Selection is transient across process reloads. The shell remains responsible only for navigation geometry; product packages remain independently migratable under `packages/product/`.
