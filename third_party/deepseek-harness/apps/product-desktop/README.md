---
description: "Windows development desktop shell for the dedicated DeepSeek Harness product Profile."
kind: "application"
---

# Product desktop

English | [中文](README.zh.md)

## Summary

This application is the F002 minimal Windows desktop Host. It starts the formal `product` Profile on an
operating-system-assigned loopback port and displays the same Web Product UI in one hardened Electron window.
Product behavior remains owned by `packages/product/`; this directory owns only process supervision, desktop
lifecycle, operating-system integration, and future delivery work.

## Table of Contents

- [Prepare and launch](#prepare-and-launch)
- [Desktop behavior](#desktop-behavior)
- [Security boundary](#security-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="prepare-and-launch"></a>
## Prepare and launch

Use Node.js 22 or later and pnpm 11.7.0. From the repository root, build the Host, Client, and Web assets, then
create the dedicated Profile through the official plugin-management path. The two add operations must remain
separate so the product Bundle follows the Web Bundle.

```powershell
$env:DSH_HOME = 'D:\path\to\dsh-home'
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run dsh -- plugin --profile product add ./packages/bundle/web-app
pnpm run dsh -- plugin --profile product add ./packages/product/product-bundle
pnpm run dev:desktop
```

The desktop preflight rejects a missing or reordered Profile instead of silently composing another application.
A successful launch opens one window titled `DeepSeek Harness Product`. The Knowledge Base Center is available
through the product navigation.

<a id="desktop-behavior"></a>
## Desktop behavior

Only one desktop instance, one Host generation, and one main window run at a time. Launching the application again
restores and focuses the existing window. Closing the window hides it while the tray process and Host remain alive;
double-click the tray icon or choose **Show** to restore it. Choose **Quit** to stop the Host before Electron exits.
Startup timeout, premature Host exit, and main-frame load failure produce bounded diagnostics with launch tokens
redacted.

<a id="security-boundary"></a>
## Security boundary

The shell accepts only the readiness URL emitted as `http://127.0.0.1:<port>/?token=<token>` or its `localhost`
equivalent, with one legal token and no additional query state. The renderer has sandboxing and context isolation
enabled, Node.js integration disabled, no preload bridge, and no generic IPC or filesystem API. Same-origin
navigation stays in the window, other HTTP(S) links open in the system browser, and other protocols, permissions,
and popups are denied.

<a id="model-experience"></a>
## Model Experience

### Product Profile carrier

#### What the model sees

Nothing is added by the desktop shell. The dedicated Product Profile and its Presets continue to define all
model-facing tools, prompts, and knowledge context.

#### Token effect

The shell adds no model tokens. Any token use comes from the same Product Profile behavior available in the Web UI.

#### KV Cache effect

The shell does not alter the reusable model prefix or cache behavior.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- F002 is a Windows development shell; it does not yet produce an installer or stage a standalone runtime.
- Code signing, auto-update, release channels, and macOS/Linux delivery are deferred.
- Tray art is a generated placeholder until product branding assets are approved.
- Plugin Center, recovery/safe mode, Preset Square, App Center, and broader product enhancements are separate features.
