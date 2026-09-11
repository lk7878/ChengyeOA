# Task 2 brief — Process-Scoped Loader and Pinned Toolchain

Authority: Global Constraints and Task 2 in `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-26-local-preproduction-bootstrap.md`.

## Scope

- Create `.codex-safe/Load-ChengyeOALocalPreproduction.ps1`.
- Create or modify `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1` for Task 2 only.
- Reuse current Task 1 core and `Test-PinnedToolchain`/safe record contracts from `ProductionRolloutRunner.Core.psm1`.
- Do not modify application source, create the real fixed bundle, run project npm scripts, contact Docker/database, or work on Tasks 3–7.

## Required runtime contract

- The loader is dot-sourced into an operator shell and sets only the explicit 16-name allow list at Process scope. It never supports User/Machine scope or a Worker toggle, and forces `EVENT_WORKER_ENABLED=false` after import.
- It resolves the project root relative to `$PSScriptRoot` and uses only the available `npx.cmd` to acquire/resolve exactly Node 22.14.0 and npm 10.9.2.
- From the npx child context, capture `process.execPath` and child PATH in memory, identify exactly one matching `npm.cmd` directory, prepend only the resolved Node/npm directories to the current process PATH, then recheck exact `v22.14.0` and `10.9.2` without printing raw output.
- Any ambiguity, absence, launch error, or mismatch is `BLOCKED` with `TOOLCHAIN_VERSION_MISMATCH`; no fallback to ambient versions.
- Load the fixed DPAPI bundle only after fail-closed checks. Missing and invalid bundles map to the documented stable codes. Validate the exact environment through Task 1 before setting it.
- Emit exactly one safe record `local_preproduction_environment_load`; serialized output contains no environment value, resolved executable path, secret storage path, connection-string scheme, raw error, stack, host, process/container/worker/lock identifier.
- Failure must not partially import allow-listed variables or modify PATH. Successful load may modify only current Process environment and PATH; caller User/Machine values remain unchanged.

## TDD protocol

Write child-PowerShell behavior tests first using `$TestDrive`, a temporary DPAPI bundle, and controlled fake external boundaries where needed. Prove meaningful RED before production code. Cover at least: missing bundle; invalid ciphertext; valid child-only import of all 16 names; parent unchanged; Worker forced false; exact toolchain success; version mismatch; ambiguous npm location; resolver launch failure; validation failure; no partial mutation on any failure; exactly one safe record; and output/path/value leakage. Tests assert outcomes, not source text or mock existence. Do not make network availability a unit-test dependency.

Run focused RED/GREEN and the complete Task 1 + Task 2 PowerShell suite. Use systematic debugging for every unexpected failure. Use `apply_patch`; no Git/GitHub.

## Report

Write `.codex-safe/sdd/local-preproduction-bootstrap/task-2-report.md` with sanitized RED/GREEN counts, exact test commands, UTC/elapsed, alert codes, files changed, residual risks, and operation counts. Docker/database/project/Git/GitHub/real-fixed-bundle counts must all be zero. Never persist raw tool output, paths, values, errors, or stacks.
