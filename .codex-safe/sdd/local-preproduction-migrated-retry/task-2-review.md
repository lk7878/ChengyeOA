# Local Preproduction Migrated-State Retry Task 2 Independent Review

ORIGINAL_IMPORTANT_FINDING=ADDRESSED
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
Minor=0
LAUNCH_READINESS=READY

## Review boundary

- Review mode: independent, offline, and read-only except for this report.
- Review inputs: approved design and plan, original Important review, task brief, implementer report, current initializer and workflow/core tests, accepted isolation review, and controller package.
- Full regression reruns by reviewer: 0. The controller supplied one fresh authoritative run with total 116, passed 116, failed 0, skipped 0.
- Focused offline test runs by reviewer: 0. Static source/test evidence and the supplied fresh run answered all required review questions.

## Original Important finding

The original Important finding is addressed rather than dismissed. A nonzero-table state is now a non-destructive resume candidate. It must pass the unchanged governed-model empty-state assertion before it can reach the authoritative deploy command. An accepted candidate records one bounded migrated-retry-ready state and performs zero destructive calls.

The reviewed accepted-resume order is:

1. pre-resume assertion;
2. migrated-retry ready state;
3. authoritative deploy;
4. migrated state;
5. post-deploy assertion;
6. database-empty ready state;
7. contract gate;
8. hidden administrator bootstrap.

The implementation contains no reset operation in this branch. The only scoped destructive site remains inside the fresh zero-table branch.

## Required behavior evidence

- State-carrying successful second invocations: 3. The covered first-invocation endings are assertion launch failure, contract failure, and empty bootstrap failure. Each second invocation preserves the migrated state, performs reset calls 0, pre-assert calls 1, deploy calls 1, post-assert calls 1, and reaches READY.
- Unsafe migrated states: 4. Incomplete schema, an existing governed row, assertion failure with rows, and bootstrap failure with rows each perform one pre-assert, preserve state, and stop with reset/deploy/contract/bootstrap calls all 0.
- Resume deploy fail-stop cases: 2. Each performs assertions 1, deploys 1, post-assert/contract/bootstrap calls 0, and migrated-ready records 0.
- Resume post-assert fail-stop cases: 2. Each performs assertions 2, deploys 1, contract/bootstrap calls 0, and migrated-ready records 1.
- Fresh zero-table behavior remains ordered as zero proof, exactly one scoped reset, restart, second health gate, database ready, deploy, and post-deploy assertion.
- Malformed, failed, multiline, signed, and whitespace-polluted catalog-count results remain fail-closed and authorize no destructive call.

## Preserved safety boundaries

- PowerShell static parse: files 4, errors 0.
- Compose operational call sites: 7; fixed two-file builder references: 7; base-only calls: 0.
- Scoped destructive sites: 1; fresh-only destructive sites: 1; resume destructive sites: 0.
- Assertion command/timeout matches: 2 at 120000 milliseconds.
- Deploy command/timeout matches: 1 at 600000 milliseconds.
- Contract command/timeout matches: 1 at 120000 milliseconds.
- Retry count initializers: 1; retry count sets: 1; bounded accepted value: 1.
- Fixed isolated project identity and the ordered two-file prefix remain mandatory for metadata and operational Compose calls. The default project volume remains unreachable; reviewer default-volume access: 0.
- The assertion continues to query every governed model delegate. Missing/incomplete schema or any governed row fails closed; no missing-schema-as-empty behavior was found.
- Hidden bootstrap argument lists: 2; redirected standard streams: 0. The secret is not passed as an argument, and the waiting record precedes inherited-console input.
- Forbidden direct output writers in reviewed runtime files: 0. Native output and exceptions remain reduced to stable status records.
- Native containment still creates the child suspended, assigns it to kill-on-close containment before resume, drains both output streams concurrently, applies bounded timeouts, and requires confirmed termination.
- Exact Node 22.14.0 and npm 10.9.2 checks remain in the process-scoped loader. The initializer independently requires production mode and the Worker-disabled value before native work.
- Persistent User/Machine environment setters: 0; remote Worker-enable toggles: 0.

## Controller evidence disposition

- Controller host-policy-blocked runs: 1.
- Controller command-wrapper parse failures: 1.
- Controller authoritative fresh full runs: 1.
- Controller authoritative result: 116/116 passed, failures 0, skips 0.
- Controller static status: READY; AST errors: 0.

## Transient-evidence disposition

`TRANSIENT_EVIDENCE=DISCLOSED_NOT_ROOT_CAUSED`

The first implementer full run remains recorded as total 116, passed 115, failed 1, skipped 0. It is not rewritten as a passing run. Root cause remains unestablished. The failure was not reproduced in the subsequent fresh implementer 116/116 run or the independent controller fresh 116/116 run. Those two fresh passing runs support readiness while retaining the unresolved historical uncertainty. No additional full regression was run because the review package prohibited unnecessary repetition.

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Prohibited-operation counts

- liveDocker: 0
- liveDatabase: 0
- liveMigration: 0
- liveInitializer: 0
- liveBootstrap: 0
- livePackageManager: 0
- liveNpm: 0
- liveNpx: 0
- network: 0
- operatorInput: 0
- defaultVolumeAccess: 0
- git: 0
- github: 0
- productFileModifications: 0
- testFileModifications: 0
- externalMutation: 0

## Timing

- utcStart: 2026-07-27T07:16:25.4815280Z
- utcEnd: 2026-07-27T07:23:16.0008303Z
- elapsedSeconds: 410.519

## Final assessment

- Original retry-safety finding: ADDRESSED.
- Same-version non-destructive resume: PASS.
- Unsafe-state preservation and fail-stop behavior: PASS.
- Fresh-state reset and second-health behavior: PASS.
- Isolation, default-volume exclusion, hidden input, safe output, native containment, exact toolchain, production mode, and Worker-disabled boundary: PASS.
- Historical transient handling: SUFFICIENTLY DISCLOSED, NOT ROOT-CAUSED.
- Launch blockers: 0.

MIGRATED_RETRY_LAUNCH_READY=1
LIVE_MIGRATION_EXECUTED=0
