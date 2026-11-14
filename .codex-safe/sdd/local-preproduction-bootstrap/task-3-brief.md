# Task 3 brief — Guarded Empty PostgreSQL Reinitialization

Authority: Global Constraints and Task 3 in `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-26-local-preproduction-bootstrap.md`.

## Scope and hard stop

- Modify `.codex-safe/LocalPreproduction.Core.psm1`.
- Create `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`.
- Extend `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1` for Task 3 only.
- Implement and test reset-ready behavior. Do **not** run the real initializer, Docker, Compose, database, project npm, network, or fixed bundle in this task.

## Required safety contract

- Canonical Compose file is only `LayerManage\law-firm-system\infra\postgres\compose.yml` under the trusted project. Reject alternate, relative, provider-qualified, reparse-traversing, missing, or physically escaping paths.
- Metadata calls are only `config --services` and `config --volumes`; require exactly service `postgres` and exactly named volume `chengye_postgres_data`. Never enumerate containers, resolved environment, caller-provided service/volume names, or global Docker state.
- `Invoke-LocalPreproductionNative` captures stdout in memory, discards stderr/raw errors, uses a narrow local test override, and returns only a sanitized internal result. No command arguments or paths in safe records.
- The initializer requires: explicit `-ConfirmEmptyDatabaseReset`; fixed valid DPAPI bundle matching the current validated 16-name Process environment; production mode; Worker false; exact Compose target; and fixed SQL result of one canonical integer zero. Nonzero is `DATABASE_NOT_EMPTY`; malformed/failure is `DATABASE_EMPTY_CHECK_FAILED`.
- Only after every gate may it invoke exactly scoped `down --volumes`, then `up -d`, then bounded health polling for no more than 120 seconds. Timeout is `DATABASE_HEALTH_TIMEOUT`. Any command failure maps to a stable code with stderr discarded.
- Destructive authorization is single-use within one invocation and cannot be supplied through environment or remote toggle. No prune, container identifier, broad volume enumeration, dynamic SQL/service/volume input, or event-history operation.
- Failure before or during reset must emit one safe BLOCKED record; success one READY record with bounded booleans/counts only. No URL, credential, payload, raw DB error, stack, host, process/container/worker/lock identifier, port, service/volume/path, or raw native output.

## TDD

Write behavior tests first using temporary storage and fully injected native operations. Meaningful RED must cover at least: path/physical boundary; exact metadata; missing confirmation with zero destructive calls; invalid/missing bundle or environment; Worker enabled; nonzero/malformed/failed table count; exact zero approved sequence; down/up failure; health success/timeout; stderr/raw exception suppression; single safe output; and command allow-list proving no container identifiers/global prune/extra destructive calls.

Tests inspect internal captured call shapes privately but output only booleans/counts. No source-grep tests. Use systematic debugging for failures. Run focused Task 3 and the full Task 1–3 PowerShell suite. Use `apply_patch`; no Git/GitHub.

## Report

Write `.codex-safe/sdd/local-preproduction-bootstrap/task-3-report.md` with sanitized RED/GREEN counts, AST/all-stream/forbidden scans, exact destructive-call authorization count in tests, UTC/elapsed, stable alerts, residual risks, and prohibited-operation counts (all real operations zero). Explicitly state `LIVE_RESET_EXECUTED=0` and `RESET_READY_ONLY=1`.
