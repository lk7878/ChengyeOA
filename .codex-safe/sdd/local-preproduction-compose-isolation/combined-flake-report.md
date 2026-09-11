# Local Preproduction Combined Flake Investigation

status: BLOCKED
stableClassification: COMBINED_FLAKE_ROOT_CAUSE_UNCONFIRMED
alertCodes:
  - INTERMITTENT_FAILURE_NOT_REPRODUCED
utcEnd: 2026-07-27T03:36:14.7706647Z

## Bounded results

- combinedRuns: 3
- combinedTotalObserved: 327
- combinedPassedObserved: 327
- combinedFailedObserved: 0
- combinedSkippedObserved: 0
- focusedLoaderRuns: 1
- focusedLoaderTotal: 25
- focusedLoaderPassed: 25
- focusedLoaderFailed: 0
- capturedFailureLabels: 0
- implementationFilesChanged: 0
- testFilesChanged: 0
- liveDockerCalls: 0
- liveDatabaseCalls: 0
- liveInitializerCalls: 0
- liveBootstrapCalls: 0
- livePackageManagerCalls: 0
- networkCalls: 0
- operatorInputRequests: 0
- gitCalls: 0
- githubCalls: 0

## Combined reproduction evidence

All three bounded combined runs executed Core followed by Workflow and returned 109/109.
No failing Describe, Context, Name, assertion category, or line label was captured.

Safe resource observations:

- run 1 handle count: 572 before, 727 after;
- run 2 handle count: 572 before, 738 after;
- run 3 handle count: 570 before, 728 after;
- each run ended with six loaded `LocalPreproduction.Core` module instances;
- each run ended with zero PowerShell Jobs.

These counts establish persistent test-process state, but do not by themselves identify the
previous single failing assertion.

## Confirmed test defects

### Loader child process lifecycle

`LocalPreproduction.Workflow.Tests.ps1:563-590` creates a `System.Diagnostics.Process`, starts it,
reads both streams, waits for exit, and returns without `Dispose()` or a `finally` block.

The focused loader Describe returned 25/25. Its handle count rose from 572 to 691. A forced GC and
finalizer drain reduced the count to 635 while the loaded module count stayed at one. Together with
the static missing-disposal path, this confirms that the helper retains finalizer-dependent native
resources after its child calls.

Minimal repair design, not implemented:

1. Capture exit code and stream text as plain values inside `try`.
2. Dispose the process unconditionally in `finally`.
3. Construct the safe result only from the captured plain values after disposal.
4. Cover normal, nonzero, and malformed-output paths with a test-only lifecycle observer that proves
   exactly one disposal; do not assert an unstable global handle absolute value.

### Native dual-pipe timing assertion

`LocalPreproduction.Workflow.Tests.ps1:2328-2339` passes a 5000 ms native timeout and also requires
the outer caller Stopwatch to be strictly below 5000 ms. `LocalPreproduction.Core.psm1:1019-1028`
reserves 1000 ms of that native timeout for termination, and timeout cleanup can continue after the
execution budget. The caller-side strict threshold therefore has no scheduling or cleanup margin.

Minimal repair design, not implemented:

1. Preserve the 5000 ms native behavior timeout.
2. Preserve the assertions that the operation succeeds and does not time out.
3. Use a separate test-only outer watchdog that includes the bounded cleanup and scheduling envelope;
   8000 ms is sufficient for the current two bounded cleanup confirmations.
4. Add a controllable local child fixture that completes dual-stream output near the internal execution
   budget, demonstrating that caller scheduling must not redefine the production timeout contract.

This changes only test determinism and does not relax the native behavior timeout gate.

## State isolation review

- `LocalPreproduction.Core.Tests.ps1:409-417` disposes the runspace pool, PowerShell instances, gates,
  and countdown object for its synchronized-writer fixture.
- `LocalPreproduction.Core.Tests.ps1:457-464` releases and disposes the mutex fixture.
- `LocalPreproduction.Core.Tests.ps1:791-805` and `811-823` restore `LOCALAPPDATA` in `finally`.
- Neither Core nor Workflow defines a global Pester setup or teardown hook.
- Workflow imports sandbox module instances from multiple physical test locations and does not remove
  all of them; six instances remain after a combined run. No evidence ties those instances to a failed
  assertion, and the focused finalizer experiment did not reduce module count.
- No PowerShell Job survived any combined run.

## Conclusion

The loader helper resource leak and the dual-pipe caller-side timing assertion are confirmed test
defects. The bounded three-run combined investigation did not reproduce the original 108/109 result,
and the original failure label is unavailable. It is therefore not possible to prove which defect, if
either, caused that single failure. Per the debugging gate, no RED test or repair was written and the
combined-flake root-cause investigation remains BLOCKED pending a captured safe failure label.

