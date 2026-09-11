# Local Preproduction Test Hygiene Fix Independent Review

## Verdict

- `SPEC_COMPLIANCE=PASS`
- `TASK_QUALITY=PASS`
- `Critical=0`
- `Important=0`
- `Minor=0`
- `FINAL_CLASSIFICATION=PASS`

No scoped defect was found in the test-hygiene fix.

## Loader process lifecycle

Reviewed locations:

- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:217-608`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:611-644`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1190-1226`

The helper acquires the test or real `System.Diagnostics.Process` inside a `try` and calls
`Dispose()` from its `finally` exactly once whenever a process object was acquired. Assignment of
`StartInfo`, `Start()`, both stream reads, `WaitForExit()`, and the `ExitCode` projection are all
inside that guarded region. An exception from any of those operations propagates through the
`finally`; the helper has no catch that can swallow it. A factory exception before it returns a
process has no acquired process to dispose.

Before disposal, the helper projects only ordinary values: stdout and stderr are forced to
`string`, and the exit code is forced to `int`. Line splitting, result construction, JSON parsing,
and property addition occur only after the `finally` has disposed the process. Normal exit,
nonzero exit, and exceptional `WaitForExit()` paths are represented by a test-only probe, and its
single counter rejects both a missing disposal and repeated disposal.

The lifecycle RED is deterministic and genuine for the defect under repair: with the disposal
removed, none of the three probes increments the counter and the one aggregate assertion fails;
with disposal duplicated, the same assertion also fails. The exceptional probe additionally proves
that the original exception is not converted to an ordinary result.

## Native dual-pipe timeout contract

Reviewed locations:

- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1033-1110`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:2389-2438`
- `.codex-safe/LocalPreproduction.Core.psm1:933-1132`

The production invocation still receives `TimeoutMilliseconds=5000`. Core starts stdout and stderr
`ReadToEndAsync()` before waiting and waits for both tasks together, preserving concurrent dual-pipe
draining. Its execution budget remains derived from the same 5000 ms input with a bounded termination
reserve; no production timeout or success gate was changed.

The test still requires `Succeeded=true`, `TimedOut=false`, one stdout line containing the expected
large payload, and no exposed `StdErr` property. The only 8000 ms value is the caller-side Stopwatch
assertion. It is not passed to Core or the child process.

The timing RED is deterministic rather than scheduler-dependent. The local `fill-delayed` fixture
sleeps 3000 ms before filling both pipes, and the test adds a fixed 2100 ms caller delay only after
the native operation returns. Their sequential lower bound exceeds the former strict 5000 ms caller
assertion, while the production call still has its original 5000 ms timeout and must succeed without
timing out. The 8000 ms assertion therefore acts only as an outer watchdog for the bounded native
call plus caller scheduling envelope.

## Verification evidence

- Fresh reviewer loader Describe: total 26, passed 26, failed 0, skipped 0; elapsed 54.27 s.
- Fresh reviewer native-boundary Describe: total 4, passed 4, failed 0, skipped 0; elapsed 7.45 s.
- Referenced root fresh relevant regression: total 110, passed 110, failed 0, skipped 0.
- The implementation report independently records relevant regression 110/110 and AST 4/4 with
  zero parse errors.
- An initial reviewer command attempted to filter by It names under Pester 3.4.0 and selected zero
  tests; it is explicitly excluded from verification evidence.
- A later combined focused command reached the outer command watchdog after displaying all 26 loader
  passes and before completing the native Describe; it is also excluded. A post-watchdog check found
  zero lingering native fixture processes. The two separate completed runs above are the fresh
  focused authority.

## Exploratory all-directory result

The reported all-directory run was 355 total, 298 passed, and 57 failed. This is not claimed as a
passing regression. The stored report contains no failure labels, so this review cannot independently
prove the 57 failures belong to particular unrelated files. It also contains no evidence tying any
of them to this fix: the only changed implementation surface is the Workflow test helper/test, the
Core implementation is unchanged, the current focused surfaces pass 30/30, and the scoped Core plus
Workflow regression is root-fresh 110/110. Under the stated review boundary, the exploratory result
does not block this scoped test-hygiene fix and no unrelated suite repair is requested.

## Prohibited-operation counts

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

The only durable write made by this independent review is this requested review report.

## Safe completion record

- `alertCodes={}`
- `LIVE_RESOURCE_CHANGES=0`
