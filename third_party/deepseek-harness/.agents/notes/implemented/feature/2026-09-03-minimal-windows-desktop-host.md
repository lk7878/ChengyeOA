# Agent Note: Minimal Windows desktop Host

Status: implemented

English | [中文](2026-09-03-minimal-windows-desktop-host.zh.md)

## Problem

The dedicated Product Profile and F001 Knowledge Base Center could run in a browser, but the product had no native Windows entry point. Reusing Studio's desktop application wholesale would also import its separate application composition, compatibility bridges, plugin UI, updater, and packaging assumptions. F002 needed the smallest shell that proves desktop ownership and lifecycle without duplicating product behavior or claiming release packaging.

## Decision

`apps/product-desktop` now owns a private Electron development application. It validates that `DSH_HOME` contains exactly the ordered Base, Web, and Product Bundle layers, then starts the built Harness CLI with `--profile product`, no patch overlay, loopback binding, and an operating-system-assigned port. A supervisor coalesces concurrent starts, accepts only the expected token-bearing loopback readiness URL, retains bounded token-redacted diagnostics, reports early or unexpected exits, and escalates a bounded graceful shutdown when required.

Electron owns one application instance, one sandboxed and context-isolated BrowserWindow, and one tray icon. There is no preload bridge, generic IPC, Node.js renderer integration, or filesystem bridge. The exact Host origin remains inside the window, other HTTP(S) destinations open in the system browser, and popups, other protocols, and renderer permissions are denied. Closing the window hides it without stopping the Host; a second launch or tray action restores it. Explicit tray quit stops the Host before the application exits.

The implementation remains development-only. Installer construction, runtime staging, signing, updating, release channels, and non-Windows delivery require separate approved features.

## Alternatives considered

**Copy the Studio desktop runtime.** Rejected because Studio is a reference, not the product runtime. Copying it would bring unrelated plugin management, updater, compatibility, and composition behavior across the ownership boundary.

**Compose product plugins in Electron.** Rejected because the formal Product Bundle and dedicated Profile already own composition. A desktop-only patch stack would create a second application definition and allow browser and desktop behavior to drift.

**Open the Product URL in the default browser.** Rejected because it would not prove a native window lifecycle, tray behavior, navigation boundary, or controlled Host shutdown—the user path F002 exists to establish.

**Expose a preload API for future features.** Rejected for this slice because F002 needs no renderer-to-OS capability. Starting with no bridge keeps the attack surface and future compatibility commitment smaller.

## Consequences

Windows developers can start the formal Product Profile through one repository command and use F001 in a native window. Unit tests pin readiness validation and redaction, Host generation and termination rules, Profile ordering, navigation policy, and lifecycle ordering. The shell adds no model-visible content and no second product composition. The generated tray image is intentionally temporary, and the current application cannot be distributed independently of the repository checkout and prepared `DSH_HOME`.
