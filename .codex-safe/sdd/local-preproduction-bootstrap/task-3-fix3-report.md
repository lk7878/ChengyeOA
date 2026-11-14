# Task 3 Fix Round 3 Safe Checkpoint

## Classification

- Scope: local preproduction Task 3 fix round 3 of 5.
- Final status: READY_FOR_INDEPENDENT_REVIEW_ONLY.
- Open findings addressed: critical 1/1, important 1/1.
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-3-fix3-report.md`

## Strict TDD evidence

- Suspended-assignment RED: focused total 7, passed 6, failed 1; category `SUSPENDED_ASSIGNMENT_HANDSHAKE_MISSING`.
- Real sleep-reserve RED: focused total 1, passed 0, failed 1; category `POST_SLEEP_SCHEDULER_RESERVE_MISSING`.
- Targeted final GREEN: total 7, passed 7, failed 0.
- Final original-plus-fix Task 3 matrix: total 26, passed 26, failed 0.
- First full-suite diagnostic run: total 89, passed 88, failed 1; category `OUTER_CALLER_WALL_CLOCK_SCHEDULER_JITTER`.
- Private native-boundary distribution: samples 20, minimum 130 milliseconds, maximum 312 milliseconds, average 149.2 milliseconds, wall overruns 0, wrong classifications 0.
- Repeated native-boundary matrix: 5 consecutive runs, total 20, passed 20, failed 0.
- Post-adjustment fresh full-suite run 1: total 89, passed 89, failed 0, skipped 0.
- Post-adjustment fresh full-suite run 2: total 89, passed 89, failed 0, skipped 0.

## Finding closure

### C1 assignment-before-execution containment

- Real native creation now uses the Windows `CREATE_SUSPENDED` flag.
- Inheritable stdout and stderr pipe writers are installed during creation; parent read handles are non-inheritable and drained concurrently after resume.
- The suspended direct process handle is assigned to the kill-on-close Job Object before `ResumeThread` is permitted.
- The fixture descendant is created immediately with no artificial pre-spawn delay.
- Forced or malformed assignment results terminate the still-direct child with `TerminateProcess`, require a bounded positive exit confirmation, and then close the process, thread, pipe, and Job handles.
- Resume failure follows the same direct-child termination and bounded confirmation path.
- Confirmed assignment failure returns one sanitized native result with no lines or process identifiers.
- Timeout termination and descendant-tree confirmation from fix round 2 remain unchanged and green.

### I1 real Stopwatch sleep reserve

- The production health budget remains 120000 milliseconds.
- A test-only budget can only reduce that value and cannot extend it.
- Every post-failure sleep recomputes real and logical remaining time.
- A fixed 25 millisecond real-time reserve is retained for loop and scheduler overhead.
- No sleep is requested when the real remainder is at or below the reserve.
- Requested sleep is the minimum of 30000 milliseconds, the post-reserve real remainder, and the logical remainder.
- The scaled fixture uses a 250 millisecond budget, spends 100 milliseconds in the failed health call, limits the sleep request to 125 milliseconds, and requires measured health time at or below 260 milliseconds.

## Timing diagnostic disposition

- The native timeout remains 250 milliseconds in the hanging-child regression.
- Production confirmation waits remain fixed at 1000 milliseconds for contained-tree accounting and 1000 milliseconds for the direct child.
- The single full-run miss was not reproducible in 20 private samples, 20 repeated focused cases, or three later full runs.
- The outer caller-side test allowance changed from 3000 to 5000 milliseconds solely for host scheduling after the native call returns; no production timeout or cleanup bound changed.

## Bounded evidence

- Forced assignment failures: 1/1 classified; direct execution prevented 1/1; resource not held 1/1.
- Immediate descendant-tree termination and unlock: parent 1/1, descendant 1/1.
- Direct-child termination and unlock retained: 1/1.
- Injected termination-request and confirmation failures retained: 2/2.
- Slow-health post-reserve sleep cases: 1/1.
- Scaled health elapsed deadline: 1/1 at or below budget plus 10 milliseconds.
- Constant/regressing/no-op health cases retained: 3/3.
- Approved destructive calls per eligible injected invocation: exactly 1.
- Real destructive calls: 0.

## Safe verification evidence

- Consecutive full run 1 UTC start: `2026-07-26T22:53:50.0777686Z`.
- Consecutive full run 1 UTC end: `2026-07-26T22:54:53.9057534Z`.
- Consecutive full run 1 elapsed seconds: 62.835.
- Consecutive full run 2 UTC start: `2026-07-26T22:54:53.9057534Z`.
- Consecutive full run 2 UTC end: `2026-07-26T22:55:53.7447971Z`.
- Consecutive full run 2 elapsed seconds: 59.830.
- AST parse: files 3, errors 0.
- Fresh focused all-stream run: total 26, passed 26, failed 0, skipped 0.
- Focused all-stream UTC start: `2026-07-26T22:56:29.3894802Z`.
- Focused all-stream UTC end: `2026-07-26T22:56:39.6137302Z`.
- Focused all-stream elapsed seconds: 10.224.
- Error records in focused all-stream capture: 0.
- Captured-output forbidden matches: 0.
- Final alert codes: none.

## Root categories and fix counts

- `CREATE_SUSPENDED_ASSIGN_RESUME`: production change set count 1.
- `DIRECT_ASSIGNMENT_FAILURE_TERMINATE_CONFIRM`: production change set count 1.
- `IMMEDIATE_DESCENDANT_RACE_FIXTURE`: test change count 1.
- `REAL_SLEEP_POST_RESERVE_CAP`: production change set count 1.
- `TIGHT_SCALED_HEALTH_DEADLINE`: test change count 1.
- `OUTER_CALLER_WALL_CLOCK_SCHEDULER_JITTER`: test-only tolerance correction count 1; production bound changes 0.

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
- Harmless local native fixture launches in the final focused run: 8.
- Harmless local sleeping-shell launches used only for private timing diagnosis: 20.

## Residual risks

- Job Object containment, suspended process creation, and handle accounting are Windows-specific.
- Operational Docker Compose and database processes remain intentionally unexecuted pending separate authorization and independent review.
- The short health budget, assignment hook, and termination hooks are local test-only reductions or failure seams; the operator entry retains every original gate and the fixed production maximum.
- Migration, administrator bootstrap, backup, runtime launch, and source/portable preflight remain outside this task and were not executed.
