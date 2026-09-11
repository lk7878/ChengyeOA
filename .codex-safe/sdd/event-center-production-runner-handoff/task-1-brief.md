# Task 1 Brief: Pure safety gates and safe status writer

## Context

This is the first component of the approved Event Center production runner. It must be pure and testable; no production command, process launch, network, or database access is allowed.

## Files

- Create `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- Create `D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1`

## Required interfaces

- `Test-ProductionEnvironmentGate([hashtable]$Environment) -> PSCustomObject`
- `Test-ProductionEvidenceReceipt([pscustomobject]$Receipt, [datetime]$NowUtc, [timespan]$MaxAge) -> PSCustomObject`
- `New-SafeStatusRecord([string]$Phase, [string]$Status, [hashtable]$BoundedCounts, [string[]]$AlertCodes, [datetime]$UtcStart, [datetime]$UtcEnd) -> ordered hashtable`
- `Write-SafeStatusRecord([string]$Path, [hashtable]$Record) -> void`

## Environment gate

Use exactly these six required names: `DATABASE_URL`, `JWT_SECRET`, `APP_KEYS`, `MFA_ENCRYPTION_KEY_V1`, `CORS_ALLOWED_ORIGINS`, `EVENT_WORKER_ENABLED`.

READY requires all six non-empty, `NODE_ENV` exactly `production`, and `EVENT_WORKER_ENABLED` exactly `false`. Return only `Status`, `PresentCount`, `RequiredCount`, `NodeEnvProduction`, `WorkerDisabled`, `AlertCodes`. Never return an input value.

## Evidence receipt

Require exactly: `schemaVersion=1`, `backup=VERIFIED`, `isolatedRestorePoint=VERIFIED`, `allWorkersDisabled=VERIFIED`, `serverWebSameRelease=VERIFIED`, `governanceApproval=VERIFIED`, and `verifiedAtUtc` as UTC. Reject extra/missing fields, malformed time, future time, or age above 30 minutes. Return only status and stable alert codes.

## Safe record

Allow only top-level keys `phase`, `status`, `boundedCounts`, `alertCodes`, `utcStart`, `utcEnd`, `elapsedSeconds`. Counts are non-negative integers. Alert codes match `^[A-Z0-9_]+$`. Reject non-allow-listed keys and any address-like scheme. Tests must construct the scheme token from separate string fragments so no complete address-like literal is persisted.

`Write-SafeStatusRecord` writes compact JSON Lines via a same-directory temporary file and exact target replacement. Resolve and verify the target remains below `D:\2_test\16_ChengyeOA\.codex-safe`. No glob, recursion, or broad filesystem operation.

## TDD contract

Write behavior tests first and run them. Record the RED output proving failure because the functions are missing. Then implement minimal code and rerun for GREEN. Tests must cover each missing required name, exact-case failures, invalid Worker spellings, evidence schema/time failures, output-key rejection, negative counts, invalid alert codes, and safe append behavior.

## Global constraints

- No Git/GitHub commands.
- No production connection or project Event Center command.
- Never output or persist production configuration values or sensitive data.
- Console/report content is limited to safe status, counts, alert codes, UTC, and elapsed seconds.

## Report

Write the full report to `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-1-report.md`. Include RED command/result, GREEN command/result, files created, exported functions, self-review, and concerns. Do not include raw test fixtures that resemble production values. Final response must contain only `DONE|DONE_WITH_CONCERNS|BLOCKED`, test pass/fail counts, and report path.
