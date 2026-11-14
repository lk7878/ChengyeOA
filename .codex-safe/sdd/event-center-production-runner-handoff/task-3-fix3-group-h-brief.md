# Task 3 Fix Round 3 — Group H Brief

## Scope

Fix only bootstrap JSONL history preservation from `task-3-fix2-review.md`. Offline only. Do not modify Core/helpers. No Git, production connection, project command, real wrapper execution, remote mutation, or real runtime write.

## TDD sequence

1. Add focused behavior tests and prove RED before wrapper edit.
2. Stop/report safe counts.
3. On follow-up, minimal wrapper fix and full verification.

## Required behavior

The private bootstrap atomic writer must, after physical target validation and before writing temp content:

- read an existing target only when it is a regular non-reparse file;
- validate every non-empty existing JSONL line independently as an exact seven-field safe status record: safe non-address-like phase/status, dictionary non-negative integer counts, alert codes `^[A-Z0-9_]+$`, valid UTC start/end, non-negative integer elapsed, and no extra/missing fields;
- if any existing line/read is invalid, fail persistence without changing the target; caller emits console-only sanitized bootstrap record and exits 70;
- otherwise preserve the existing safe lines in their original order and append exactly one bootstrap JSON line, using the existing same-directory atomic first move/replacement and cleanup behavior;
- never truncate, skip, reorder, or rewrite prior safe status history.

Tests must start with two distinct valid prior lines, invoke the real extracted wrapper function in TestDrive, and assert both prior lines remain in order and the new bootstrap line is last. Add invalid-existing-line preservation and existing-read failure coverage. Correct any old Group E expectation that replacement discards old content.

## Files allowed

- `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound3.GroupH.Tests.ps1`
- Group E tests only for fixture correction/reuse

Do not modify Core/helpers.
