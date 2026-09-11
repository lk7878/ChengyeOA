# Task 2 Brief: Strict CLI parsers and fixed command adapter

## Context

Extend the reviewed pure module. This task adds exact parsing and allow-listed local process construction. Tests must use injected process results only; no real project command, network, database, or production connection.

## Files

- Modify `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- Modify/add focused tests below `D:\2_test\16_ChengyeOA\.codex-safe\tests`

## Required public interfaces after Task 2

- Existing four Task 1 exports unchanged.
- `ConvertFrom-EventCheckSummary([string]$Text, [string]$ExpectedMode) -> PSCustomObject`
- `ConvertFrom-EventDrainSummary([string]$Text) -> PSCustomObject`
- `Invoke-SafeNativeCommand([string]$CommandKind, [string]$Mode, [string]$WorkspaceRoot) -> PSCustomObject`
- `Test-PinnedToolchain([string]$WorkspaceRoot) -> PSCustomObject`

## Exact check contract

Prefix: `Event observability:`. Required fields exactly once: `mode`, `status`, `undispatched`, `oldestUndispatchedSeconds`, `dueBacklog`, `oldestDueBacklogSeconds`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, `leaseLost15m`, `alertCodes`, `evaluatedAt`.

Modes: `preflight`, `canary`. Status: `READY`, `DEGRADED`, `BLOCKED`. Count and seconds fields are non-negative integers. UTC must parse as UTC. `alertCodes=none` becomes an empty array; otherwise each comma-separated code matches `^[A-Z0-9_]+$`.

## Exact drain contract

Prefix: `Event drain:`. Required fields exactly once: `dispatched`, `claimed`, `succeeded`, `retryScheduled`, `manual`, `leaseLost`, `status`.

Status: `complete`, `manual_attention_required`. All other fields are non-negative integers.

Both parsers reject multiline text, wrong prefix, duplicate/extra/missing fields, malformed numbers, invalid mode/status/UTC/alert codes, and return only stable safe summaries without echoing rejected text.

## Command adapter

Only these commands may be constructed:

- `source-check`, mode `preflight` or `canary`: pinned Node/npm invocation of the existing source `events:check` entry.
- `portable-check`, mode `preflight` only: existing `apps\dist\law-firm-system\law-firm-system.exe` with `events:check`.
- `source-drain`, with no mode: pinned Node/npm invocation of existing `events:drain`.

The adapter must use an injectable private process-launch boundary. Tests assert fixed executable/arguments/working directory and never launch the real process. Reject any other kind or mode before launch. Capture child output internally; never return or print raw standard error. Require exactly one formatter record.

Check exit mapping: `0 READY`, `3 DEGRADED`, `4 BLOCKED`, `2 CONFIG_INVALID`, `5 MIGRATION_OR_DATABASE_UNAVAILABLE`, `70 UNCLASSIFIED_FAILURE`; any other code is `COMMAND_EXIT_UNRECOGNIZED` and BLOCKED.

Drain exit mapping: `0 complete`, `4 manual_attention_required`, `2 CONFIG_INVALID`, `5 MIGRATION_OR_DATABASE_UNAVAILABLE`, `70 UNCLASSIFIED_FAILURE`; any other code is `COMMAND_EXIT_UNRECOGNIZED` and BLOCKED.

## Toolchain gate

Use the same injectable launcher. Only exact `v22.14.0` and `10.9.2`, each as one line, returns READY. Launch failure, extra line, or mismatch returns `TOOLCHAIN_VERSION_MISMATCH` without reporting observed strings. Return only `Status`, `NodeVersionOk`, `NpmVersionOk`, `AlertCodes`.

## TDD contract

Write new focused tests first and record RED because interfaces are missing. Then implement minimal behavior and run GREEN. Mutation cases must include every wrong field shape, exit mapping, unrecognized command/mode, and raw-error non-propagation. Preserve all 42 Task 1 tests.

## Global constraints

- No Git/GitHub commands.
- No real project command, network, database, production connection, or remote operation.
- Never output actual URL, production configuration value, credential, business-sensitive content, raw error, stack, host, PID, workerId, or lockedBy.
- Status/report data is limited to safe states, counts, alert codes, UTC, and elapsed seconds.

## Report

Write `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-2-report.md` with sanitized RED/GREEN counts, files, interfaces, command kinds, exit mappings, self-review, and concerns. Final response only: `DONE|DONE_WITH_CONCERNS|BLOCKED`, test counts, report path.
