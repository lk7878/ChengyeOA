# Task 3 Fix Round 2 Independent Re-review

## Verdicts

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=NEEDS_FIXES`
- Critical findings: 1
- Important findings: 1
- Minor findings: 0
- Round-2 open findings closed: 0/2
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

Task 3 remains ineligible for live reset authorization. Round 2 adds meaningful containment and deadline controls, but neither open safety finding is fully closed.

## Round-2 closure matrix

| Boundary | Verdict | Evidence |
| --- | --- | --- |
| Windows kill-on-close containment | `PARTIAL` | The Job Object uses kill-on-close, tree termination, zero-active-process accounting, and positive direct-process waiting. Process creation and Job assignment are not atomic. |
| Descendant termination | `PARTIAL` | The delayed descendant fixture is terminated and both resources unlock. The fixture deliberately waits before spawning, so it does not cover a descendant escaping before assignment. |
| Injected termination failures | `CLOSED` | Failed termination requests and failed post-termination confirmation remain unconfirmed, containment cleanup runs, and safe status is propagated. |
| No later phases after unconfirmed termination | `CLOSED` | The initializer emits one distinct blocked record and performs zero count/reset/start/health calls after metadata termination is unconfirmed. |
| Real Stopwatch health sleep cap | `PARTIAL` | Sleep is capped by the current real and logical remainder, but no allowance remains for sleep overshoot or post-sleep loop work, and the test permits measured overrun. |

## Critical finding

### C1 — Process start precedes Job assignment, leaving an escape and assignment-failure window

Locations: `.codex-safe/LocalPreproduction.Core.psm1:731`, `.codex-safe/LocalPreproduction.Core.psm1:738`, `.codex-safe/LocalPreproduction.Core.psm1:740`, `.codex-safe/LocalPreproduction.Core.psm1:798`, `.codex-safe/LocalPreproduction.Core.psm1:802`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:847`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:853`.

The native process starts running before `AssignProcessToJobObject` is called. A fast child can spawn a descendant during this interval; assigning the parent afterward does not retroactively contain the already independent descendant. The current descendant fixture waits 100 milliseconds before spawning, which makes assignment win the race and therefore cannot prove safe containment for immediate descendants.

There is also an unsafe assignment-failure path. If Job assignment fails, the code marks termination unconfirmed and throws, but `timedOut` is still false. Final cleanup closes an empty Job, while the direct process receives no kill request and no positive exit wait. The initializer blocks later phases, yet the already-started native command can continue outside containment.

Bounded fix: create the process suspended and assign it to the Job before resuming its primary thread, or use an atomic process-creation Job attribute on supported Windows versions. On any create/assign/resume failure, terminate the suspended/direct process and positively confirm exit before returning. Add an immediate-descendant fixture with no delay and an injected/forced assignment-failure fixture that proves the direct resource is released without exposing identifiers.

## Important finding

### I1 — The scaled health test and sleep calculation still permit the real deadline to be exceeded

Locations: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:254`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:259`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:263`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1980`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1989`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1990`.

Immediately before sleep, the requested duration may equal the entire remaining Stopwatch budget. Scheduler overshoot and the work needed to return from sleep and re-evaluate the loop are not reserved, so total real health elapsed can cross the fixed ceiling even though the requested sleep itself is capped.

The scaled fixture uses a 250-millisecond budget but accepts health elapsed below 400 milliseconds and total scenario time below 2000 milliseconds. It therefore does not prove the brief's required invariant that slow-health processing plus sleep stays within the real budget.

Bounded fix: retain an explicit real-time allowance before every sleep, stop when the remaining budget is at or below that allowance, and request only the remainder after subtracting it. Make the scaled test assert measured health elapsed does not exceed its configured budget, while retaining a small internal allowance large enough for expected scheduler jitter; also assert the requested sleep is bounded by the post-allowance remainder.

## Verified round-2 improvements

- Every successfully assigned real native process is held by a Windows Job Object configured for kill-on-close.
- Timeout requests target the Job tree rather than only the direct process.
- Successful termination requires zero active contained processes and a positive direct-process wait.
- A false termination request and a truthy request without zero-active-process confirmation both remain `TerminationConfirmed=false`.
- The initializer checks termination status after metadata, count, reset, start, and health calls and maps unconfirmed status to one stable blocked alert.
- The 1000-millisecond native termination-confirmation allowance is reserved from real health command timeouts.
- Constant, regressing, and no-op injected clocks remain finite through the nonreplaceable Stopwatch and attempt cap.
- All earlier physical-path, injected-stream, exact SQL/token, quoting, environment-equality, confirmation, ordering, and allow-list closures remain intact.

## Fresh sanitized evidence

- Focused original-plus-fix Task 3 matrix: total 25, passed 25, failed 0, skipped 0, elapsed seconds 10.631.
- Full Task 1–3 suite: total 88, passed 88, failed 0, skipped 0, elapsed seconds 70.836.
- Task 3 native-fixture root invocations: 7 per run; contained descendant invocations: 1 per run.
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
- Harmless Task 3 native-fixture root invocations: 14.
- Harmless contained descendant invocations: 2.

The Task 3 fix-round report is not accepted as reset-authorization evidence until process creation/containment is atomic or equivalently fail-safe and the scaled health proof enforces the configured real deadline.
