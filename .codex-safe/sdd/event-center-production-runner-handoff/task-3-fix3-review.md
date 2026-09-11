# Task 3 Fix Round 3 Independent Review

## Verdicts

- `SPEC_COMPLIANCE: FAIL`
- `TASK_QUALITY: FAIL`

Finding counts: Critical 0, Important 2, Minor 1.

This was a full-file, local-only review of the design, implementation plan, original Task 3 review, fix-round-1 and fix-round-2 reviews, Group G/H briefs, current Core/wrapper/helpers, all fourteen current runner test files, and the progress ledger. No Git command, production connection, project command, helper or wrapper execution, or remote mutation was performed. The supplied fresh evidence of 209/209 tests, zero AST findings across eighteen PowerShell files, nine Core exports, zero runtime targets, and zero production-side activity is treated as supplied evidence rather than independently reproduced evidence.

## Important findings

### I6 - bootstrap history validation accepts duplicate JSON keys

`Invoke-EventCenterProductionRollout.ps1:30-87` validates an existing line only after `ConvertFrom-Json` has converted it to an object. Windows PowerShell accepts duplicate JSON keys and retains only the last value. The subsequent seven-property check therefore cannot detect a duplicated top-level field or a duplicated nested count field. Because the original line is then preserved unchanged at `193-207`, a structurally non-exact line can pass validation and be republished with the bootstrap record.

This violates Group H's exact seven-field validation and fail-closed preservation requirements. Group H tests cover a missing-field line and a read failure, but no duplicate-key case.

Required correction: detect and reject duplicate keys before lossy object conversion, including duplicates at the top level and inside the count dictionary. Add regressions proving the existing target remains unchanged and no temporary write is attempted.

### I7 - the uppercase alert-code rule is evaluated case-insensitively

The existing-history validator uses `-notmatch '^[A-Z0-9_]+$'` at `Invoke-EventCenterProductionRollout.ps1:67-70`. In PowerShell that operator is case-insensitive, so a lowercase-only code passes. The same defect exists in the Core safe-record validator at `ProductionRolloutRunner.Core.psm1:53-56`. This contradicts the exact uppercase pattern in the plan and Group H brief.

The current tests reject codes containing punctuation, but none uses a lowercase-only code. A focused local operator-semantics check confirmed that the current expression accepts such a value.

Required correction: use the case-sensitive match operator in both validators and add direct lowercase-only rejection cases for new records and preserved history.

## Minor finding

### M3 - two wrapper atomic-failure tests no longer reach their named operation

The partial-temporary-write and existing-target-replacement tests initialize the target with `ORIGINAL` at `ProductionRolloutRunner.StateMachine.FixRound2.GroupE.Tests.ps1:234-250` and `270-285`. After Group H added strict existing-line validation, that fixture is rejected before either injected operation is called. Both tests still pass because they assert only a sanitized failure, preservation, and cleanup; they no longer prove partial-write cleanup or replacement-failure preservation in the private bootstrap writer.

Required correction: initialize those cases with a valid safe JSONL record and assert an operation marker proving the intended injected operation was reached.

## Fix-round-2 closure table

| Fix-round-2 item | Result | Evidence-based assessment |
|---|---|---|
| C1 rollback UTC binding | CLOSED | `Core:757-759` obtains one UTC value, persists that exact value as both transition endpoints, and uses it as the checkpoint lower bound. Group G's advancing-clock case at `91-100` rejects the formerly exploitable between-read timestamp. |
| I1 second-drain classified exits | CLOSED | `Core:851-855` checks the classified result before reading any drain count. Group G `102-123` covers exits 2, 5, and 70 and proves no rollback transition occurs. |
| C3 abnormal canary clock persistence | CLOSED | `Core:872-875` persists a valid `CANARY/BLOCKED` transition with the stable clock code before returning 70. Group G `125-147` asserts the final persisted phase, state, UTC kind, ordering, and absence of later progression. |
| I3a bootstrap JSONL preservation | PARTIAL | Regular-file validation, safe read, prior-line order, append-last behavior, atomic publication, failure preservation, and cleanup are present. Exact-line validation remains incomplete under I6 and I7. |

## Prior-finding regression table

| Prior finding | Result | Evidence-based assessment |
|---|---|---|
| C2 | CLOSED | A non-ready canary branches before the governance checkpoint at `Core:882-893`; Group A retains the direct-rollback regression. |
| I2 | CLOSED | Post-rollback verification controls both final rollback records at `Core:760-764`; Group A covers the non-ready result. |
| I3b | CLOSED | The wrapper establishes a terminating bootstrap boundary at `wrapper:263-318`; Group E exercises the otherwise non-terminating import path and asserts a single sanitized outcome. |
| I4 | CLOSED | Each helper performs its self-contained physical-boundary validation before importing Core or creating artifacts. |
| I5 | CLOSED | Group F extracts the actual validator and reaches workspace, safe-directory, and target reparse branches; copied helpers prove adjacent Core is not executed first. |
| M1 | CLOSED | Group B observes the real copied wrapper's fixed source, portable, drain, canary, workspace, environment-name, local-file, foreground, and console/status bindings. |
| M2 | CLOSED | The original helper atomic primitive remains covered for partial temporary write, first publication, replacement failure, preservation, and cleanup. The separate wrapper-test regression is recorded as M3. |

## Safety assessment

- No new Worker control, governance command, rollback API, production connection, project command, or remote mutation path was found.
- Core state transitions remain restricted to the declared seven status fields and filtered counts/codes.
- The three Group G fixes are correctly ordered and behavior-tested with injected dependencies.
- Group H preserves valid existing lines in order and atomically appends the bootstrap line, but its validator is not yet strict for duplicate keys or lowercase-only alert codes.
- The supplied 209/209 evidence does not close I6, I7, or M3 because the affected fixtures are absent or stop before the operation they claim to exercise.
