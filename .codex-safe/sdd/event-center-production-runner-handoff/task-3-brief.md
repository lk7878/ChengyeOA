# Task 3 Brief: Foreground state machine and manual checkpoint protocol

## Context

Build the foreground runner on the reviewed Core module. The real runner is launched once from a new operator PowerShell that already contains the production environment. Tests use injected dependencies and fake command summaries only; no real Event Center command, database, network, or remote operation.

## Files

- Modify `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- Create `D:\2_test\16_ChengyeOA\.codex-safe\Invoke-EventCenterProductionRollout.ps1`
- Create `D:\2_test\16_ChengyeOA\.codex-safe\Set-ProductionRunnerCheckpoint.ps1`
- Create `D:\2_test\16_ChengyeOA\.codex-safe\Set-ProductionRolloutEvidence.ps1`
- Create `D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.StateMachine.Tests.ps1`

## Public interface

- Add `Start-EventCenterProductionRollout([hashtable]$Dependencies) -> int`.
- Preserve the eight reviewed Task 1/2 exports unchanged; final public export count is nine.

## Dependency contract

The state machine receives fixed delegates for: environment reader, UTC clock, sleep, evidence reader, checkpoint reader, safe status sink, toolchain gate, source check, portable preflight, and source drain. Production entry binds them to reviewed functions and exact `.codex-safe` files. Tests bind deterministic fakes and never wait or launch.

## Evidence gate

Before any project command, validate the exact Task 1 evidence receipt with maximum age 30 minutes. If absent or invalid, append `WAITING_EVIDENCE`, sleep through the injected dependency, and read again. Environment/toolchain failure exits before this wait or any project command.

## Checkpoint schema

Exact case-sensitive fields: `schemaVersion`, `sequence`, `command`, `issuedAtUtc`. `schemaVersion=1`; `sequence` positive and strictly greater than the last consumed sequence; UTC not future and not older than 30 minutes. Commands only: `GOVERNANCE_COMPLETED`, `SINGLE_WORKER_ENABLED`, `CANARY_GOVERNANCE_COMPLETED`, `ROLLBACK_CONFIRMED`. Reject other, stale, replayed, malformed, missing, or extra fields without echoing values.

The checkpoint helper accepts only a ValidateSet command and a positive sequence. The evidence helper accepts no free-form JSON; it writes the five exact VERIFIED conclusions with current UTC. Both derive their exact target from their own `.codex-safe` directory and write through same-directory temporary files with first-write move/existing-target replacement and cleanup.

## Snapshot agreement

Initial source and portable preflight must both be READY and match exactly on: `status`, `undispatched`, `dueBacklog`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, `leaseLost15m`. Do not compare age counters or evaluation UTC.

## State order

```text
ENV_GATE -> TOOLCHAIN_GATE -> EVIDENCE_GATE
-> PREFLIGHT_SOURCE -> PREFLIGHT_PORTABLE
-> WAITING_GOVERNANCE_ACTION
-> DRAIN_FIRST -> DRAIN_SECOND -> PREFLIGHT_AFTER_DRAIN
-> WAITING_SINGLE_WORKER_ENABLE
-> CANARY_STARTED -> CANARY + CANARY_GOVERNANCE_COMPLETED
-> READY
```

Requirements:

- Environment failure: BLOCKED, zero project commands.
- Toolchain failure: BLOCKED, zero project commands.
- Evidence missing/invalid: WAITING_EVIDENCE, zero project commands.
- Preflight mismatch: `PREFLIGHT_SNAPSHOT_MISMATCH`, BLOCKED.
- First drain must be complete. Second drain must be complete with `claimed=0`.
- Post-drain source preflight must be READY.
- Canary uses source mode `canary`; the existing command supplies the full 15-minute window.
- `CANARY_GOVERNANCE_COMPLETED` must be fresh, next-sequence, and issued between canary start/end UTC.
- DEGRADED writes `EXTENDED_OBSERVATION_REQUIRED` and exits `3`.
- Any BLOCKED/safety failure writes `ROLLBACK_REQUIRED`, waits only for a valid next `ROLLBACK_CONFIRMED`, reruns source preflight after confirmation, writes `ROLLED_BACK`, and exits `4`. It never performs the external rollback itself.
- READY exits `0`.
- Configuration/input failures exit `2`; dependency/database unavailability exits `5`; unclassified safe failure exits `70`.

Every transition appends exactly one safe status record. No raw child output or rejected receipt/checkpoint content is persisted.

## Runner entry point

Derive workspace root from `.codex-safe` script location. Import the module. Read only the seven fixed environment names. Use fixed files `.codex-safe\production-rollout-evidence.json`, `.codex-safe\production-runner-control.json`, and `.codex-safe\production-runner-status.jsonl`. Bind existing Core adapters. Remain foreground during waits. Console output must be the same safe JSON record written to status.

Operator command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex-safe\Invoke-EventCenterProductionRollout.ps1
```

## TDD contract

Write state-machine and helper behavior tests first and run expected RED. Cover all ordered paths, zero-call guarantees, snapshot mismatch, two-drain rule, checkpoint freshness/replay/order, canary time binding, DEGRADED, BLOCKED rollback wait, and exit mappings. Test helper scripts against controlled `.codex-safe` targets only. Then minimal implementation and full Task 1–3 GREEN. No real waits or commands in tests.

## Global constraints

- No Git/GitHub commands.
- No production connection, real project command, network, database, or remote operation in implementation tests/review.
- No new remote Worker toggle, governance CLI, or rollback API.
- Never output actual URL, configuration value, credential, business-sensitive content, raw error, stack, host, PID, workerId, or lockedBy.
- Record only safe status, counts, alert codes, UTC, and elapsed seconds.

## Report

Write `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-3-report.md` with sanitized RED/GREEN counts, files, state paths, exit mappings, self-review, and concerns. Final only: `DONE|DONE_WITH_CONCERNS|BLOCKED`, test counts, report path.
