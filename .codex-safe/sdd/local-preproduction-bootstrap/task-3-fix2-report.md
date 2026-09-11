# Task 3 Fix Round 2 Safe Checkpoint

## Classification

- Scope: local preproduction Task 3 fix round 2 of 5.
- Final status: READY_FOR_INDEPENDENT_REVIEW_ONLY.
- Open findings addressed: critical 1/1, important 1/1.
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-3-fix2-report.md`

## Strict TDD evidence

- Confirmed-termination RED: total 4, passed 0, failed 4; categories `TERMINATION_CONFIRMATION_MISSING`, `TREE_TERMINATION_MISSING`, and `TERMINATION_INJECTION_MISSING`.
- Initializer propagation RED: total 5, passed 4, failed 1; category `UNCONFIRMED_TERMINATION_CLASSIFICATION`.
- Confirmed-termination final GREEN: total 5, passed 5, failed 0.
- Real sleep-budget RED: total 1, passed 0, failed 1; category `REAL_SLEEP_BUDGET_MISSING`.
- Slow-health fixture correction: the first scaled run reached health but used the default success result; the corrected failure fixture preserved the same production assertion.
- Real sleep-budget final GREEN: total 1, passed 1, failed 0.
- Final original-plus-fix Task 3 matrix: total 25, passed 25, failed 0.
- Fresh Task 1 through Task 3 suite: total 88, passed 88, failed 0, skipped 0.

## Finding closure

### C1 confirmed native termination

- Every real native launch is assigned to a Windows kill-on-close Job Object.
- Timeout termination targets the contained process tree, not only the direct child.
- A monotonic bounded confirmation loop requires zero active contained processes.
- The direct process also completes a positive bounded post-termination wait.
- A failed termination request and a truthy request with failed confirmation both return `TerminationConfirmed=false`.
- Containment close remains the final cleanup boundary even when injected termination fails.
- The initializer maps unconfirmed termination to `NATIVE_TERMINATION_UNCONFIRMED`, emits one blocked record, and performs no later count/reset/start/health call.

### I1 real Stopwatch sleep cap

- The production health budget remains 120000 milliseconds.
- A test-only budget can only reduce that value and cannot extend it.
- Real native health reserves the bounded termination-confirmation allowance.
- Immediately before sleep, real and logical remaining milliseconds are recomputed.
- Requested sleep is the minimum of 30000 milliseconds, real remainder, and logical remainder.
- The scaled fixture uses a 250 millisecond budget and a failed health operation consuming 180 milliseconds; the recorded sleep request remains at or below the real remainder and the measured health interval remains bounded.
- Constant, regressing, and no-op time fixtures from fix round 1 remain green.

## Bounded evidence

- Direct-child termination and unlock: 1/1.
- Descendant-tree termination and unlock: parent 1/1, descendant 1/1.
- Injected termination-request failure: classified 1/1; containment cleanup 1/1.
- Injected ignored post-termination wait: classified 1/1; containment cleanup 1/1.
- Initializer unconfirmed-termination records: exactly 1.
- Later native phases after unconfirmed termination: 0.
- Slow-health bounded sleep cases: 1/1.
- Constant/regressing/no-op health cases retained: 3/3.
- Approved destructive calls per eligible injected invocation: exactly 1.
- Real destructive calls: 0.

## Safe verification evidence

- Fresh full-suite UTC start: `2026-07-26T16:55:41.3616911Z`.
- Fresh full-suite UTC end: `2026-07-26T16:56:47.8988933Z`.
- Fresh full-suite elapsed seconds: 66.
- AST parse: files 3, errors 0.
- Fresh focused all-stream run: total 25, passed 25, failed 0.
- Focused all-stream UTC start: `2026-07-26T16:57:06.2894175Z`.
- Focused all-stream UTC end: `2026-07-26T16:57:16.9640413Z`.
- Focused all-stream elapsed seconds: 10.
- Error records in focused all-stream capture: 0.
- Captured-output forbidden matches: 0.
- Final alert codes: none.

## Root categories and fix counts

- `KILL_ON_CLOSE_TREE_CONTAINMENT`: production change set count 1.
- `BOUNDED_TERMINATION_CONFIRMATION`: production change set count 1.
- `PRIMARY_POST_TERMINATION_WAIT`: production fix count 1.
- `NATURAL_JOB_ACCOUNTING_SETTLE`: production fix count 1.
- `UNCONFIRMED_TERMINATION_PROPAGATION`: production fix count 1.
- `REAL_SLEEP_REMAINDER_CAP`: production change set count 1.
- `DESCENDANT_SELF_CLEANUP_RED_FIXTURE`: test safety correction count 1.
- `DIRECT_CHILD_STARTUP_OBSERVABILITY`: test fixture correction count 1.
- `SLOW_HEALTH_FAILURE_MODE`: test fixture correction count 1.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live reset executions: 0.
- Operational native commands: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Network operations: 0.
- Project npm operations: 0.
- Real fixed bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Later-task operations: 0.
- Harmless local native fixture launches in the final focused run: 7.

## Residual risks

- Job Object containment and accounting are Windows-specific and remain dependent on the current host supporting nested job assignment.
- Operational Docker Compose and database processes remain intentionally unexecuted pending separate authorization and independent review.
- The short health budget and termination hooks are local test-only reductions; the operator entry retains the fixed production maximum and every original gate.
- Migration, administrator bootstrap, backup, runtime launch, and source/portable preflight remain outside this task and were not executed.
