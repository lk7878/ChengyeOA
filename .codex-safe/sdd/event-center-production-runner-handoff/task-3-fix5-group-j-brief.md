# Task 3 Fix Round 5 — Group J Brief

## Scope

Final allowed fix round for I6 and I8 from `task-3-fix4-review.md`. Offline only; no Git, production connection, real project command, remote mutation, or real runtime write.

## TDD sequence

1. Add behavior tests and prove RED before wrapper edit.
2. Stop/report safe RED counts.
3. On follow-up, minimal wrapper/test fix, full verification, independent review.

## Required behavior

- The custom parser must fail closed unless it consumes exactly one complete standards-conforming JSON value with standard JSON whitespace only and no duplicate decoded keys in any object scope.
- Primitive parsing must accept only JSON strings, objects, arrays, `true`, `false`, `null`, or grammar-valid JSON numbers. Reject single-quoted/unquoted keys or strings, non-standard whitespace, invalid/unterminated escapes, incomplete Unicode escapes, trailing separators/data, and malformed numbers.
- Same-named keys in distinct object scopes remain allowed; nested arrays/objects are parsed and checked.
- `Read-RunnerJsonFile` must invoke the strict complete duplicate-aware parser before `ConvertFrom-Json` for evidence and checkpoint files. Any strict-parse failure returns null without exposing input.
- Ambiguous/duplicate/non-standard evidence stays at the evidence wait with zero project command calls. Ambiguous checkpoint never advances its expected checkpoint or starts the next command stage.

## Files allowed

- `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound5.GroupJ.Tests.ps1`
- Group B/I tests only for minimal harness reuse/correction

Do not modify Core/helpers.
