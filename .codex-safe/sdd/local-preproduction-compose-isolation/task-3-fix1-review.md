# Task 3 Fix 1 Independent Launch-Readiness Review

## Verdict

- `SPEC_COMPLIANCE=PASS`
- `TASK_QUALITY=PASS`
- `Critical=0`
- `Important=0`
- `Minor=0`
- `LAUNCH_READINESS=READY`
- `LIVE_ISOLATED_RESOURCES_CREATED=0`

The reviewed candidate is ready to enter the separately authorized controlled live-isolated initialization boundary. This review created no isolated resource and does not authorize any default-project operation.

## Scope and evidence boundary

The review read the approved isolation design and plan, the preserved bootstrap-plan addendum, all Task 1 and Task 2 briefs/reports/reviews/fix reviews, the preserved Task 3 blocked report, the combined-flake investigation, the test-hygiene fix and independent review, the launch-readiness candidate, and the current override, Core, loader, initializer, and Workflow tests.

The root fresh relevant regression is referenced as the authority required by the review brief: total 110, passed 110, failed 0, skipped 0. The full suite and real loader were not repeated. Fresh reviewer verification was limited to the injected Task 1/2 focused surface and static checks.

## Contract verification

### Fixed isolated identity and default-volume exclusion

- The target resolver internally fixes one project identity and exactly two ordered Compose files.
- Both metadata calls and all five initializer operational call sites use the centralized prefix builder.
- Native Docker call sites reviewed: 7; missing centralized builder: 0; base-only operational calls: 0.
- Caller-supplied project, file, service, or volume parameters: 0.
- The override changes only the explicit container resource; duplicated image, environment, port, health, and volume definitions: 0.
- The logical volume remains project-scoped. With the fixed distinct project identity on every call and no base-only fallback, the existing default volume containing 87 user tables is unreachable from the initializer path.
- The command-tail guard rejects all 10 required project/file option spellings and compares case-insensitively. The current test matrix also covers 5 differently cased forms and preserves one ordinary tail fixture.

### Ordered reset authorization

The successful injected fixture retains the required 12-call order: two metadata gates, baseline start, baseline health, strict table count, one scoped destructive reset, restart, post-reset health, and the four Task 4 stages.

- First-metadata execution and missing/extra/incorrect semantic results stop after exactly one metadata call.
- Second-metadata execution and missing/extra/incorrect semantic results stop after exactly two metadata calls and before baseline start.
- Baseline start, both health gates, count execution, reset, restart, and all Task 4 boundaries stop all later calls on failure.
- Count acceptance requires exactly one output line matching a canonical unsigned-integer grammar; signed, whitespace-polluted, multiline, empty, malformed, failed, and nonzero fixtures authorize zero destructive calls.
- Exactly zero authorizes exactly one scoped `down --volumes`; static scoped destructive sites: 1; broad prune/direct-volume-remove patterns: 0.
- The second health gate completes before the database-ready state consumed by Task 4.

### Native containment, timeout, and test hygiene

- Core still creates the child suspended, assigns it to a kill-on-close Job Object, then resumes it.
- Stdout and stderr are drained concurrently.
- Timeout handling retains a monotonic Stopwatch budget, bounded termination request, Job emptiness confirmation, primary-child exit confirmation, and a distinct unconfirmed-termination result.
- Initializer health polling reuses the same native boundary, carries a bounded remaining timeout into each attempt, and caps sleep by the real remaining budget.
- The loader test helper now captures only plain output/exit values inside `try` and disposes every acquired process exactly once in `finally`, including exceptional completion.
- The production dual-pipe timeout remains 5000 ms. The only 8000 ms value is a test-only outer Stopwatch watchdog; it is not passed to Core or the child.

### Loader and hidden bootstrap

Referenced root loader evidence is complete for this checkpoint: status ready, exact pinned Node and npm checks true, production mode true, Worker disabled true, environment present 16/16, offline mode forced, one safe record, zero extra streams, and zero network resolution.

The initializer revalidates exact equality for all 16 process values before metadata. Worker must remain exactly disabled. Hidden bootstrap is reached only after post-reset health, empty assertion, migration, and bootstrap-contract success; it uses the silent safe-interactive entry point, inherits the console, has no password argument, and redirects no standard stream.

### Safe output and static evidence

- Fresh Task 1/2 focused verification: total 12, passed 12, failed 0, skipped 0.
- PowerShell AST: files 3, parse errors 0.
- Forbidden direct output commands in the three runtime files: 0.
- Persistent User/Machine environment setters: 0.
- Remote Worker-enable assignments or gates: 0.
- Caller identity parameters: 0.
- Plan addenda matching the approved append-only heading: 1.
- Safe records retain the bounded status/count/code/time schema, and injected raw output/additional-stream tests remain in the passing focused surface.

## Historical single-failure disposition

`HISTORICAL_SINGLE_FAILURE_HANDLING=SUFFICIENT`

The original 108/109 event remains preserved as a blocked historical report and was not rewritten as a pass. Bounded reproduction did not recover its assertion label, so the record correctly remains classified as not reproduced rather than falsely root-caused. The later investigation nevertheless identified two concrete deterministic test defects: finalizer-dependent loader-process disposal and a caller-side timing assertion coupled to the production timeout. Both were repaired with meaningful RED/GREEN evidence, independently reviewed with zero findings, and followed by the root fresh 110/110 relevant regression. The present code and tests preserve process disposal and separate the 8000 ms outer watchdog from the unchanged 5000 ms production timeout. This is sufficient remediation for launch readiness while retaining the uncertainty of the historical event.

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Safe operation counts

- `LIVE_DOCKER=0`
- `LIVE_DATABASE=0`
- `LIVE_INITIALIZER=0`
- `LIVE_BOOTSTRAP=0`
- `LIVE_PACKAGE_MANAGER=0`
- `LIVE_NETWORK=0`
- `LIVE_OPERATOR_INPUT=0`
- `LIVE_DEFAULT_VOLUME_ACCESS=0`
- `LIVE_ISOLATED_RESOURCES_CREATED=0`
- `GIT=0`
- `GITHUB=0`
- `EXTERNAL_MUTATION=0`

## Final classification

- `ISOLATED_INITIALIZER_READY=1`
- `LAUNCH_READINESS=READY`
- `alertCodes={}`

The next permitted action is the controlled Task 4 live-isolated initialization. Any non-ready phase must stop immediately; any evidence of default-project targeting is a Critical safety incident.
