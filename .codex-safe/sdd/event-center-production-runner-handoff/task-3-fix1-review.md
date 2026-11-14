# Task 3 Fix Round 1 Independent Review

## Verdicts

- `SPEC_COMPLIANCE: FAIL`
- `TASK_QUALITY: FAIL`

Finding counts: Critical 1, Important 3, Minor 1.

This was a full-file, local-only review of the design, implementation plan, original Task 3 review, Group A/B/C briefs, current Core/wrapper/helpers, Task 3 baseline and Group A/B/C tests, and progress ledger. No Git command, production connection, project command, helper production path, or remote mutation was run. The supplied fresh evidence of 9 files and 182/182 passing tests is treated as supplied evidence rather than independently reproduced evidence.

## Critical findings

### C3 - READY does not enforce the complete 15-minute canary window

`ProductionRolloutRunner.Core.psm1:868-886` records start/end UTC but never checks that the elapsed canary duration is at least 15 minutes. Any dependency result with `Status=READY` can therefore reach the governance checkpoint and terminal `READY` even if it returned immediately. The baseline fake always advances its clock by 15 minutes at `ProductionRolloutRunner.StateMachine.Tests.ps1:141-147`, and the ready-path assertion at `178-190` supplies no shorter-window rejection case. The implementation therefore relies on the current command's behavior instead of enforcing the state-machine invariant required by the design and plan.

Required correction: reject a READY canary whose measured UTC window is shorter than 15 minutes, keep the result fail-closed without requesting a successful canary-governance completion, and add a dependency-injected regression that proves a short READY result cannot reach terminal READY.

## Important findings

### I3a - the bootstrap fallback bypasses the safe atomic/path-validated writer

`Invoke-EventCenterProductionRollout.ps1:21-26` uses `File.AppendAllText` directly. It neither validates the trusted physical directory/target nor performs same-directory atomic publication or replacement. A reparse target can consequently be followed, and interruption can leave a partial JSONL append. The Group B harness copies the wrapper to an arbitrary directory and expects that location-relative fallback write to succeed (`ProductionRolloutRunner.StateMachine.FixRound1.GroupB.Tests.ps1:120-129`, `209-219`, `243-252`), so it does not establish the production boundary or atomicity of the fallback.

The emitted fallback object itself is constant, contains only the seven allowed safe-record fields, and does not include the caught diagnostic. The defect is the persistence boundary and atomicity, not a direct value leak.

Required correction: implement a bootstrap-safe, same-directory atomic writer that independently validates the exact physical target without requiring a successful Core import; if safe persistence cannot be established, emit only the sanitized console record and exit 70.

### I3b - the top-level boundary does not force cmdlet failures to become terminating before diagnostics can escape

The wrapper has a `try/catch`, but `Import-Module` at `Invoke-EventCenterProductionRollout.ps1:35` is invoked without a terminating-error policy. The script also does not establish a local stop policy. A non-terminating import failure can therefore emit ordinary PowerShell diagnostics before later control reaches the sanitized fallback. The Group B import-failure fixture executes an explicit terminating `throw` (`ProductionRolloutRunner.StateMachine.FixRound1.GroupB.Tests.ps1:127-129`), so its empty-error-stream assertion does not exercise this path.

Required correction: make bootstrap cmdlet failures terminating inside the protected boundary and add a behavior test for an import failure mode that otherwise uses the non-terminating error stream. Continue to assert exactly one sanitized console/status outcome and no diagnostic passthrough.

### I4/I5 - helper physical-boundary validation is ordered after module execution, while the reparse tests pass at the lexical guard

Both helpers first compare `PSScriptRoot` lexically and then import the adjacent Core before the complete ancestor walk (`Set-ProductionRunnerCheckpoint.ps1:12-21`; `Set-ProductionRolloutEvidence.ps1:2-11`). `Assert-SafePhysicalPath` is called with the safe directory itself as `SafeRoot`, so it checks that directory and the target but not the trusted workspace component above it (`ProductionRolloutRunner.Core.psm1:148-182`). The broader ancestor walk exists only later inside `Invoke-SafeStatusAtomicWrite` (`218-255`). Thus Core code from the path is executed before the helper has established the complete trusted-workspace-to-safe-directory physical boundary, and that imported code is itself used to perform the first validation.

The Group C ancestor and target reparse cases copy each helper to a TestDrive directory (`ProductionRolloutRunner.StateMachine.FixRound1.GroupC.Tests.ps1:98-149`). Every such execution is rejected first by the hard-coded lexical comparison in the helper, independent of whether the tested ancestor/target is a reparse point. These cases are false-green for the claimed physical checks and do not prove the production path's complete ancestor validation.

Required correction: perform a self-contained physical component check from the trusted workspace through `.codex-safe`, including the exact target, before importing Core or creating any artifact. Test that validator directly or through a non-redirectable no-write validation mode so the reparse condition, rather than copied-location mismatch, is the reason for rejection.

## Minor findings

### M1 - wrapper behavior coverage still does not observe source/portable path arguments

The Group B success module accepts `WorkspaceRoot`, `CommandKind`, and `Mode` but does not record or assert them (`ProductionRolloutRunner.StateMachine.FixRound1.GroupB.Tests.ps1:149-169`). Its observation records only environment names and evidence/checkpoint markers (`173`, `225-240`). Console/status equivalence, fixed environment-name reads, foreground completion, and evidence/checkpoint paths are behavior-tested, but the fixed source/portable command bindings remain protected only by source inspection.

## Original-finding closure

| Finding | Closure | Review result |
|---|---|---|
| C1 | CLOSED | Rollback captures a request-time lower bound, passes it to checkpoint validation, and Group A rejects an older higher-sequence confirmation before accepting a later one (`Core:754-764`; Group A tests `22-43`). No production-input route was found that bypasses both sequence and UTC checks. |
| C2 | CLOSED | BLOCKED canary branches directly to rollback before the canary-governance wait; Group A makes an unexpected governance wait fail (`Core:870-884`; Group A tests `45-66`). |
| I1 | CLOSED | Classified adapter exits 2/5/70 are read before protocol rollback at each applicable stage (`Core:777-884`) and Group B covers source, portable, drain, and canary result objects (`77-96`). The production wrapper supplies fixed delegates directly to `Invoke-SafeNativeCommand`; command text, receipt, checkpoint, environment values, and the private atomic test seam cannot add an `ExitCode` property to a parsed successful result. No production-input forgery path was found. |
| I2 | CLOSED | `ROLLED_BACK` derives its status from the post-confirmation preflight and remains BLOCKED when verification is non-ready (`Core:760-764`; Group A tests `68-79`). |
| I3 | OPEN | The top-level catch and constant safe record close the original absence of a wrapper boundary, but findings I3a and I3b leave persistence and diagnostic containment incomplete. |
| I4 | OPEN | The eventual atomic writer checks ancestors, but complete physical trust is established only after adjacent module execution; the focused tests do not reach this condition. |
| I5 | OPEN | Group A/B fixtures now expose C1/C2/I1, but the Group C reparse fixtures remain false-green for copied-location rejection. |
| M1 | PARTIAL | Environment, evidence/checkpoint, foreground, and console/status behavior are covered; source/portable argument bindings are not observed. |
| M2 | CLOSED | The private atomic primitive is behavior-tested for partial temporary write, failed first move, failed replacement, first publication, replacement, target preservation, and artifact cleanup (`Group C tests:153-213`). Its operations seam is private, not exported, and omitted by both production helper calls, so no production input route to it was found. Physical-boundary coverage remains accounted for under I4/I5. |

## Safety assessment

- No new Worker toggle, governance command, rollback API, remote action, or production configuration persistence was found.
- Status construction in Core remains limited to the seven allowed fields and sanitized counts/codes.
- The four Task 3 test files use injected dependencies or controlled temporary locations and do not intentionally execute project commands or production connections. No test writes a receipt or checkpoint at the real production helper targets.
- The supplied 182/182 result does not close the findings above because the short-canary case is absent, the bootstrap tests use a terminating import fixture and happy-path append, and the helper reparse cases are rejected before the reparse validation under review.
