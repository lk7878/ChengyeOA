# Task 3 Fix Round 4 — Group I Brief

## Scope

Fix I6, I7, and M3 from `task-3-fix3-review.md`. Offline only; no Git, production connection, real wrapper/helper/project execution, remote mutation, or runtime write.

## TDD sequence

1. Add/correct tests and prove meaningful RED before Core/wrapper edits.
2. Stop/report safe RED counts.
3. On follow-up, minimal implementation and full verification.

## Required behavior

- Before `ConvertFrom-Json`, the wrapper must reject duplicate object keys at any relevant nesting level, including duplicate top-level fields and duplicate `boundedCounts` keys. Detection must account for JSON escapes that decode to the same key and must not confuse string values with property names. Invalid history remains byte-for-byte unchanged and no temp write occurs.
- Core `Assert-SafeStatusRecord` and wrapper existing-history validation must use case-sensitive uppercase alert-code validation. A lowercase-only code must be rejected.
- Correct Group E partial-write and replacement-failure fixtures to start with valid safe JSONL and assert explicit operation markers proving the injected `WriteTemporary`/`ReplaceExisting` path ran. Preserve existing target and cleanup assertions.

## Files allowed

- `.codex-safe/ProductionRolloutRunner.Core.psm1`
- `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound4.GroupI.Tests.ps1`
- Group E/H/Core tests for minimal fixture/regression additions

Do not modify helpers.
