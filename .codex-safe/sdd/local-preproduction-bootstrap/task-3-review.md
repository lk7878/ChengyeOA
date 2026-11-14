# Task 3 Independent Review

## Verdicts

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=NEEDS_FIXES`
- Critical findings: 2
- Important findings: 3
- Minor findings: 1
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

Task 3 must not receive live reset authorization. The current tests are green, but the implementation does not enforce the required physical-target and real elapsed-time boundaries.

## Critical findings

### C1 — The health deadline cannot bound a hanging native command

Locations: `.codex-safe/LocalPreproduction.Core.psm1:545`, `.codex-safe/LocalPreproduction.Core.psm1:556`, `.codex-safe/LocalPreproduction.Core.psm1:558`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:173`.

The native boundary performs sequential blocking stream reads followed by an unbounded process wait. It has no timeout, cancellation, or bounded termination path. A command that never exits can therefore prevent any safe record indefinitely. Sequentially draining stdout and stderr also permits a full-pipe deadlock before the wait is reached. The initializer checks its 120-second deadline only between native calls, so one health call can exceed that deadline without limit; metadata, count, reset, and start calls are unbounded as well.

Bounded fix: make the native boundary concurrently drain redirected streams, use a monotonic real-time deadline, bound every wait, terminate a timed-out child safely, and return only a sanitized timeout result. Pass the remaining health budget into every health command and prove elapsed real time stays bounded when the child never exits and when either redirected pipe fills.

### C2 — The physical Compose boundary omits the repository root and its ancestors

Locations: `.codex-safe/LocalPreproduction.Core.psm1:588`, `.codex-safe/LocalPreproduction.Core.psm1:593`, `.codex-safe/LocalPreproduction.Core.psm1:595`, `.codex-safe/LocalPreproduction.Core.psm1:619`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1207`.

The path walk starts with the repository root already trusted and inspects only descendants appended after it. It never inspects the repository-root entry or any existing ancestor between the filesystem root and that entry. A root or ancestor reparse point can therefore redirect the lexically canonical target outside the trusted physical tree before metadata and destructive authorization. The current junction test redirects a project descendant, so it cannot catch this omission.

Bounded fix: validate every existing component from the filesystem root through the repository root and canonical leaf, including the root entry itself, or compare handle-resolved final physical paths within a separately trusted physical root. Add independent root-reparse and ancestor-reparse fixtures and require zero metadata calls for both.

## Important findings

### I1 — A nonadvancing injected clock can make health polling infinite

Locations: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:57`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:66`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:175`, `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:189`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:632`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:687`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1353`.

Both deadline progress and sleep are replaceable. If the injected clock does not advance and injected sleep returns, the loop has no independent real-time or iteration guard. The sole timeout fixture advances the same clock from its sleep stub, so it is structurally unable to reveal the defect.

Bounded fix: retain a nonreplaceable monotonic elapsed-time guard and a finite attempt cap in addition to any deterministic test clock. Add fixtures for constant time, regressing time, and no-op sleep; each must return one timeout record within a short real elapsed bound.

### I2 — Injected warning and error streams escape the sanitized native boundary

Locations: `.codex-safe/LocalPreproduction.Core.psm1:535`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1365`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1405`.

The injected operation is invoked without suppressing or privately capturing non-success PowerShell streams. A bounded review probe injected one warning and one nonterminating error: the function still returned a successful sanitized result while two additional stream records escaped. Existing tests use only clean success output or a terminating exception, so their single-record assertion does not exercise this boundary.

Bounded fix: isolate the injected operation, discard all non-success streams, require exactly one result object with the exact internal schema, and map every malformed or noisy result to failure. Add warning, nonterminating-error, verbose, debug, and information-stream fixtures and require exactly one final safe record.

### I3 — Destructive authorization tests do not pin the exact SQL or native serialization contract

Locations: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:650`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:739`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1325`, `.codex-safe/LocalPreproduction.Core.psm1:513`.

The count stub recognizes any argument list containing the database client token and returns the chosen count. It does not require the fixed query text, fixed database/client options, fixed service selection, or exact token order. The injected native path receives the original argument array and bypasses Windows argument serialization entirely. Consequently, mutations to the table-selection semantics, fixed command operands, or quoting routine can leave all Task 3 tests green. The current implementation text is exact, but the required mutation-resistant evidence is absent at the destructive authorization boundary.

Bounded fix: assert the complete count-call array and exact fixed query as one immutable fixture; reject every missing, added, reordered, or substituted token. Test the private Windows quoting routine with empty, spaced, quoted, and trailing-backslash operands, plus a harmless local argument-echo fixture with no external dependency.

## Minor finding

### M1 — Environment equality is implemented for all names but tested with only one mismatch

Locations: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:699`, `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1280`.

The initializer loops over all sixteen allow-listed names, but the Task 3 mismatch fixture changes only one. Skipping comparison for another name would not be caught by the current workflow suite.

Bounded fix: mutate each allow-listed name independently and require the same blocked alert with zero metadata and destructive calls.

## Boundaries reviewed without a finding

- Exact successful metadata call count and result cardinality are enforced for the two fixed metadata forms.
- Current bundle/process comparison, production mode, and disabled background-work gate are ordered before metadata and destructive work.
- Canonical integer parsing distinguishes zero, nonzero, malformed, and failed results in the implementation.
- Confirmation precedes all native work; the approved path contains one reset call followed by one start call.
- No prune, global state enumeration, container enumeration, caller-selected service/volume, or Event Center history operation appears in the Task 3 path.
- Cleanly returned failures map to stable alert codes, and ordinary injected scenarios emit one bounded record.

## Fresh sanitized verification

- Focused Task 3: total 10, passed 10, failed 0, skipped 0, elapsed seconds 2.896.
- Full Task 1–3: total 73, passed 73, failed 0, skipped 0, elapsed seconds 55.930.
- Bounded injected all-stream probe: sanitized result objects 1, escaped additional streams 2.
- No test or probe output reproduced a credential, connection value, raw database error, stack, filesystem target, or operational identifier.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live reset executions: 0.
- Real native operations: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Network operations: 0.
- Project npm operations: 0.
- Fixed bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- External mutations: 0.

The report supplied with Task 3 is not accepted as reset-authorization evidence until both Critical findings and all Important findings are remediated and independently re-reviewed.
