# Task 3 Fix Round 4 Safe Checkpoint

## Classification

- Scope: local preproduction Task 3 fix round 4 of 5.
- Final status: READY_FOR_INDEPENDENT_REVIEW_ONLY.
- Open findings addressed: important 1/1.
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-3-fix4-report.md`

## Strict TDD evidence

- Clean fix-round RED: total 3, passed 0, failed 3.
- RED categories: `POST_CREATE_SETUP_SEAM_MISSING` cases 2 and `ASSIGNMENT_EXCEPTION_CLEANUP_BYPASS` cases 1.
- The assignment-exception RED returned the default confirmed value while the temporary fixture image remained locked by the suspended child.
- Initial RED harness correction: a suspended process exposes no managed `Path`, so exact-path cleanup could not find four temporary leaked fixtures. Those four exact harmless fixture processes were terminated, the fixture filename became parent-PID-unique, and cleanup was scoped to that unique process name.
- Clean RED automatic cleanup: one exact temporary suspended fixture terminated; leaked fixtures after RED: 0.
- Targeted final GREEN: total 3, passed 3, failed 0.
- Repeated targeted GREEN: 3 consecutive runs, aggregate total 9, passed 9, failed 0.
- Final original-plus-fix Task 3 matrix: total 29, passed 29, failed 0, skipped 0.
- Fresh Task 1 through Task 3 suite: total 92, passed 92, failed 0, skipped 0.

## Root cause and bounded fix

- Native `CreateProcess` ownership and managed reader initialization previously occurred inside one constructor.
- A constructor exception could therefore terminate and wait without preserving either Boolean outcome for the PowerShell wrapper.
- A terminating assignment hook escaped before the explicit false/malformed branches and bypassed their direct termination call.
- The wrapper retained `TerminationConfirmed=true` from function entry even when an unassigned suspended child remained alive.
- The process wrapper is now instantiated before native creation and exposes native-success ownership through `Created` even when `Create` throws.
- Native stdout/stderr read handles transfer to the owned object immediately after successful `CreateProcess`.
- Managed reader initialization is a separate pre-resume step, so its failures occur while the wrapper owns the suspended process.
- One post-create/pre-resume catch initializes confirmation to false, calls `TerminateAndWait(1000)`, preserves only its positive Boolean result, and treats an invalid, throwing, or false injected confirmation state as false.
- Assignment false, malformed assignment output, throwing assignment hooks, assignment API exceptions, and resume failure all pass through the same guard.
- Process execution remains suspended until successful Job assignment and `ResumeThread`; timeout and tree-containment behavior is unchanged.

## Behavior evidence

- Post-create setup exception: one sanitized result, confirmed direct exit 1/1, fixture image unlock 1/1.
- Terminating assignment-hook exception: one sanitized result, confirmed direct exit 1/1, fixture image unlock 1/1.
- Forced pre-resume confirmation failure: `TerminationConfirmed=false` 1/1 while actual direct cleanup still releases the fixture image 1/1.
- Result keys remain `ExitCode`, `Lines`, `Succeeded`, `TerminationConfirmed`, and `TimedOut`.
- Exception markers returned in result lines: 0.
- Leaked local fixture processes after focused, repeated, full, and all-stream verification: 0.

## Safe verification evidence

- Fresh full-suite UTC start: `2026-07-26T23:13:51.0664558Z`.
- Fresh full-suite UTC end: `2026-07-26T23:14:54.7634678Z`.
- Fresh full-suite elapsed seconds: 62.827.
- AST parse: files 3, errors 0.
- Fresh focused all-stream run: total 29, passed 29, failed 0, skipped 0.
- Focused all-stream UTC start: `2026-07-26T23:15:23.3988295Z`.
- Focused all-stream UTC end: `2026-07-26T23:15:34.7104390Z`.
- Focused all-stream elapsed seconds: 11.312.
- Error records in focused all-stream capture: 0.
- Captured-output forbidden matches: 0.
- Post-verification leaked local fixture processes: 0.
- Final alert codes: none.

## Root categories and fix counts

- `POST_CREATE_OWNERSHIP_TRANSFER`: production change set count 1.
- `MANAGED_READER_SETUP_LIFECYCLE_SPLIT`: production change set count 1.
- `CENTRAL_PRE_RESUME_TERMINATE_CONFIRM_GUARD`: production change set count 1.
- `TERMINATING_ASSIGNMENT_EXCEPTION_CLASSIFICATION`: production fix count 1.
- `FORCED_UNCONFIRMED_STATE_PROPAGATION`: production fix count 1.
- `PID_UNIQUE_SUSPENDED_FIXTURE_CLEANUP`: test safety correction count 1.

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
- External mutations: 0.
- Harmless local native-fixture root invocations in the final focused run: 11.
- Harmless contained descendant invocations in the final focused run: 1.
- Harmless temporary suspended fixtures explicitly terminated during initial RED harness correction: 4.
- Harmless temporary suspended fixtures automatically terminated during clean RED cleanup: 1.

## Residual risks

- Job Object containment, suspended process creation, and handle accounting are Windows-specific.
- The post-create setup and confirmation-state hooks are local test-only failure seams; they do not extend any production timeout or authorize execution.
- Operational Docker Compose and database processes remain intentionally unexecuted pending separate authorization and independent review.
- Migration, administrator bootstrap, backup, runtime launch, and source/portable preflight remain outside this task and were not executed.
