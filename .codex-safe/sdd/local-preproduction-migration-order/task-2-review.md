# Local Preproduction Migration Order Task 2 Independent Review

SPEC_COMPLIANCE=FAIL
TASK_QUALITY=FAIL
Critical=0
Important=1
Minor=0
LAUNCH_READINESS=BLOCKED

## Review boundary

- Review mode: offline and read-only, except for this report.
- Live Docker operations: 0.
- Live database operations: 0.
- Live migration operations: 0.
- Live initializer operations: 0.
- Live bootstrap operations: 0.
- Network operations: 0.
- Operator-input operations: 0.
- Default-volume access: 0.
- Git operations: 0.
- GitHub operations: 0.
- Product-file modifications: 0.
- Test-file modifications: 0.

## Safety evidence

- Independent static parse: files 4, errors 0.
- Required safety order found: 1. Migration is reachable only after the isolated zero-table proof, the single scoped reset, restart, the second health gate, and the database-ready state.
- Required post-ready order found: 1. Migration precedes the application-row assertion, contract gate, and hidden administrator bootstrap.
- Migration failure fixtures: 2. Later assertion calls: 0; later contract calls: 0; later bootstrap calls: 0.
- Assertion failure fixtures: 2. Successful migration calls before assertion: 1 per fixture; assertion calls: 1 per fixture; later contract calls: 0; later bootstrap calls: 0; migrated-ready records before assertion: 1 per fixture.
- Scoped destructive sites: 1. Broad destructive sites: 0.
- Compose operational call sites: 7. Fixed-prefix references: 7. Base-only operational calls: 0.
- Migration timeout matches: 1. Assertion timeout matches: 1. Contract timeout matches: 1.
- Hidden bootstrap argument lists: 2. Redirected bootstrap streams: 0. Secret arguments observed in covered fixtures: 0. Waiting-state records before hidden input: 1 per successful or bootstrap-failure fixture.
- Forbidden output writers: 0. Persistent environment setters: 0. Remote Worker toggles: 0.
- The application-row assertion remains fail-closed for a missing or incomplete schema; no missing-table-as-empty behavior was found.
- Native containment and timeout behavior remains covered by the preserved Core tests and the accepted isolation review; no migration-order change to those boundaries was found.

## Regression evidence disposition

- Complete regression run 1: total 112, passed 111, failed 1, skipped 0; stable classification `TRANSIENT_TEST_FAILURE_NOT_REPRODUCED`.
- Complete regression runs 2 and 3: total 112 each, passed 112 each, failed 0, skipped 0.
- Focused timing verification: runs 9, total 18, passed 18, failed 0, skipped 0.
- The first 111/112 result remains part of the launch evidence and is not rewritten or dismissed. The two consecutive 112/112 results and the 18/18 focused result show non-recurrence, but do not establish a root cause for the first failure.
- No additional full regression was run because the controller supplied three complete runs and the review package prohibited unnecessary repetition.

## Findings

### Critical

None.

### Important

1. The existing migrated state cannot reach the authoritative migration stage on a subsequent initializer run.

   After one migration succeeds, any later assertion, contract, or administrator-bootstrap failure leaves application schema tables present. On the next invocation, the strict zero-table gate runs before the scoped reset. A nonzero table count returns `DATABASE_NOT_EMPTY`, with reset calls 0 and migration calls 0. The invocation therefore cannot exercise the documented retry-safe deploy behavior without a separate out-of-band reset and new authorization.

   This conflicts with the design requirement that an already migrated state remain retry-safe through the authoritative deploy stage. The current workflow tests start each scenario with a zero-table fixture and contain no state-carrying two-invocation case, so they cannot detect this gap.

   Required closure: define and implement a reviewed, isolated already-migrated retry control flow that preserves fixed-target isolation and fail-stop guarantees while reaching the authoritative deploy stage, then add an offline stateful fixture covering a successful migration followed by each later failure and a controlled subsequent invocation. If the intended policy is instead a separately authorized destructive reset after investigation, the design and controlled-live plan must be revised and independently reviewed before launch.

### Minor

None.

## Final assessment

- Isolation and default-volume exclusion: PASS.
- Exact migration order: PASS.
- Migration and assertion fail-stop behavior: PASS.
- Hidden-input preservation: PASS.
- Assertion, containment, timeout, and safe-output preservation: PASS.
- Retry safety: FAIL.
- Historical transient evidence handling: SUFFICIENTLY DISCLOSED, NOT ROOT-CAUSED.
- Launch blocker count: 1.

MIGRATION_ORDER_LAUNCH_READY=0
LIVE_MIGRATION_EXECUTED=0
