# Task 3 Fix Round 3 Independent Re-review

## Verdicts

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=NEEDS_FIXES`
- Critical findings: 0
- Important findings: 1
- Minor findings: 0
- Round-3 findings fully closed: 1/2
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

The start-before-assignment race and strict health sleep budget are corrected. Task 3 remains ineligible for live reset authorization because post-creation exception cleanup does not uniformly prove direct-process termination.

## Round-3 closure matrix

| Boundary | Verdict | Evidence |
| --- | --- | --- |
| `CREATE_SUSPENDED -> Assign Job -> Resume` ordering | `CLOSED` | The direct process cannot execute before successful Job assignment and resume. |
| Immediate descendant containment | `CLOSED` | The descendant fixture has no artificial delay; the parent and descendant are both terminated and unlocked. |
| Explicit assignment/resume false result | `CLOSED` | Both paths call direct terminate-and-wait before returning failure. |
| Post-creation exception cleanup | `OPEN` | Constructor cleanup ignores termination/wait outcomes, and a throwing assignment seam bypasses direct terminate-and-wait. |
| Handle, pipe, and stream cleanup on ordinary paths | `CLOSED` | Parent pipe writers are closed after creation; readers and process/thread handles are disposed; output and error drains remain private and concurrent. |
| Strict real sleep reserve | `CLOSED` | Production retains a 25-millisecond real reserve and does not sleep at or below it. |
| Scheduler-tolerance change | `CLOSED` | Only an outer test assertion changed; production timeouts, confirmation waits, health budget, and sleep reserve did not increase. |

## Important finding

### I1 — Some post-creation exceptions bypass positive termination confirmation

Locations: `.codex-safe/LocalPreproduction.Core.psm1:817`, `.codex-safe/LocalPreproduction.Core.psm1:824`, `.codex-safe/LocalPreproduction.Core.psm1:826`, `.codex-safe/LocalPreproduction.Core.psm1:830`, `.codex-safe/LocalPreproduction.Core.psm1:832`, `.codex-safe/LocalPreproduction.Core.psm1:932`, `.codex-safe/LocalPreproduction.Core.psm1:980`, `.codex-safe/LocalPreproduction.Core.psm1:983`, `.codex-safe/LocalPreproduction.Core.psm1:1076`.

If suspended-process construction fails after `CreateProcess` succeeds—for example while creating the managed pipe readers—the constructor requests direct termination and performs a bounded wait but ignores both results. It then throws without communicating whether exit was confirmed. The outer native wrapper retains its initial `TerminationConfirmed=true` and returns that value from its catch path.

A terminating exception from the injected assignment operation also escapes before either explicit assignment-result branch calls `TerminateAndWait`. Final cleanup closes the empty Job and the local process/thread handles, but closing those handles does not terminate the unassigned suspended process. This leaves an unconfirmed suspended-process/resource leak while the returned classification can remain confirmed.

These paths cannot execute the destructive command because the thread is still suspended, so this is Important rather than Critical. They nevertheless violate the round-3 requirement that every creation/assignment/resume failure terminate the created direct process, positively confirm exit, close resources, and report unconfirmed status when proof fails.

Bounded fix: centralize the entire post-create/pre-resume handshake in one cleanup guard. Track whether a process was created and whether execution was released; on every exception before successful resume, call `TerminateAndWait`, preserve its Boolean result, and expose it to the wrapper. Make constructor/factory failures after native creation return a typed result or exception carrying confirmation state rather than discarding termination and wait outcomes. Add terminating-exception and post-create reader-setup failure seams, asserting one sanitized result, positive unlock on confirmed cleanup, and `TerminationConfirmed=false` when confirmation is forced to fail.

## Verified closures

- Command-line construction creates the child with `CREATE_SUSPENDED` and no window.
- Job assignment precedes `ResumeThread`; false or malformed assignment results prevent execution.
- The immediate descendant is inherited into the kill-on-close Job and zero-active-process accounting confirms tree termination.
- Timeout paths retain concurrent stdout/stderr draining, Job-tree termination, bounded zero-active-process confirmation, and positive direct-process waiting.
- Unconfirmed native termination still produces one distinct blocked initializer record and zero later count/reset/start/health phases.
- The health budget remains 120000 milliseconds; the test-only override can only reduce it.
- Production reserves 1000 milliseconds for native termination accounting and 25 milliseconds before sleep/next-loop work.
- Requested sleep uses the minimum polling interval, post-reserve real remainder, and logical remainder.
- The scaled 250-millisecond test requires health elapsed at or below 260 milliseconds; the 10-millisecond tolerance exists only in test measurement.
- The outer caller assertion increase to 5000 milliseconds changes no production timeout or cleanup bound.

## Fresh sanitized evidence

- Focused original-plus-fix Task 3 matrix: total 26, passed 26, failed 0, skipped 0, elapsed seconds 10.961.
- Full Task 1–3 suite: total 89, passed 89, failed 0, skipped 0, elapsed seconds 62.533.
- Task 3 native-fixture root invocations: 8 per run; contained descendant invocations: 1 per run.
- Captured summaries contained only bounded counts and elapsed time; forbidden-output matches: 0.

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
- Harmless Task 3 native-fixture root invocations: 16.
- Harmless contained descendant invocations: 2.

The Task 3 fix-round report is not accepted as reset-authorization evidence until every post-creation exception path preserves positive direct-process termination confirmation.
