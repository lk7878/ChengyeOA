# Task 3 Fix Round 1 Independent Re-review

## Verdicts

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=NEEDS_FIXES`
- Critical findings: 1
- Important findings: 1
- Minor findings: 0
- Original findings closed: 4/6
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

Task 3 remains ineligible for live reset authorization. Fresh tests are green, but C1 and I1 are only partially remediated.

## Original-finding closure matrix

| Finding | Verdict | Evidence |
| --- | --- | --- |
| C1 native real-time bound and termination | `OPEN` | Concurrent drains, monotonic bounded return, remaining health budget, and sanitized timeout are present. Termination is attempted but never confirmed. |
| C2 repository-root and ancestor reparse boundary | `CLOSED` | The walker now starts at the filesystem root and checks every existing component through the leaf. Independent root and ancestor junction fixtures require zero metadata calls. |
| I1 nonadvancing injected health clock | `OPEN` | Constant/regressing/no-op fixtures are finite through a real Stopwatch and five-attempt cap, but the sleep interval is not capped by remaining real time. |
| I2 injected all-stream isolation and exact schema | `CLOSED` | All five non-success streams are privately captured; noisy, malformed, wrong-cardinality, wrong-key, and wrong-type results fail closed without extra output. |
| I3 exact SQL/token and Windows quoting boundary | `CLOSED` | The complete fixed count-call array and query are pinned; remove/add/reorder/substitute mutations fail; four quoting cases also round-trip through the local echo fixture. |
| M1 all-name environment equality | `CLOSED` | All sixteen names are independently mismatched and block with one mismatch alert before metadata or destruction. |

## Critical finding

### C1 — Timeout can return before termination is known to have succeeded

Locations: `.codex-safe/LocalPreproduction.Core.psm1:580`, `.codex-safe/LocalPreproduction.Core.psm1:582`, `.codex-safe/LocalPreproduction.Core.psm1:583`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1526`.

The concurrent drain and monotonic wait close the original indefinite caller hang. On timeout, however, termination exceptions are discarded and the result of the bounded post-termination wait is ignored. The function then reports a sanitized timeout and disposes its handle even when the child may still be executing. For a destructive command, that permits a `BLOCKED` record while the timed-out operation continues outside the safety boundary.

The hanging-child test proves only that the caller returns quickly with `TimedOut`; it never proves that the child is no longer running and has no termination-failure or descendant case. The report itself limits its evidence to a child without descendants.

Bounded fix: place each native launch in a kill-on-close containment boundary, terminate the contained process tree on timeout, and require positive bounded confirmation that no contained process remains. A failed termination confirmation must have a distinct stable failure classification and must never be treated as ordinary completed timeout. Add observable no-identifier fixtures for direct-child, descendant, and injected termination-failure paths.

## Important finding

### I1 — Health sleep is not capped by the remaining real Stopwatch budget

Locations: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:175`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:182`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:196`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:203`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:204`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1701`.

Health command timeouts are capped by both logical and real remaining time, and the attempt cap closes the infinite-loop defect. After a failed health command, the implementation recomputes only logical remaining seconds for sleep. If a command consumes most of the real 120-second budget while logical time advances little, the code can enter an additional sleep of up to 30 seconds and exceed the required real health ceiling before the loop condition is checked again.

The three new fixtures return immediately and use no-op sleep, so none places the Stopwatch close to expiry before observing the requested sleep interval.

Bounded fix: recompute real remaining milliseconds immediately before sleep, break when none remains, and sleep for the minimum of logical remaining, real remaining, and the polling interval. Add a short scaled fixture in which a failed health call consumes most of the real budget and assert the requested sleep and total elapsed time cannot cross that budget.

## Verified closures

- Concurrent asynchronous stdout/stderr draining prevents the prior full-pipe deadlock.
- Every native call has a finite caller wait and sanitized result schema.
- The physical Compose walk includes the repository root and every ancestor from the filesystem root.
- Noisy injected streams produce one safe initializer record with zero extra streams.
- Exact metadata forms/results, fixed SQL semantics, canonical integer parsing, confirmation ordering, one reset call, one start call, failure mapping, and prohibited-command allow-list remain intact.
- No global enumeration, broad cleanup, dynamic service/volume/query input, or Event Center history operation is introduced.

## Fresh sanitized evidence

- Focused original-plus-fix Task 3 matrix: total 19, passed 19, failed 0, skipped 0, elapsed seconds 4.861.
- Full Task 1–3 suite: total 82, passed 82, failed 0, skipped 0, elapsed seconds 57.716.
- Focused harmless local fixture launches: 3.
- Full-suite harmless local fixture launches: 3.
- Captured Pester summaries contained only bounded counts and elapsed time; forbidden-output matches: 0.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live reset executions: 0.
- Operational native commands: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Network operations: 0.
- Project npm operations: 0.
- Fixed bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- External mutations: 0.
- Harmless local native fixture launches: 6.

The Task 3 fix-round report is not accepted as reset-authorization evidence until C1 termination confirmation and I1 strict real-time sleep budgeting are corrected and independently re-reviewed.
