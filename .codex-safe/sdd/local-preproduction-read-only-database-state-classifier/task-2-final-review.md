# Task 2 Final Independent Review

ORIGINAL_I1=ADDRESSED
ORIGINAL_I2=ADDRESSED
ORIGINAL_I3=ADDRESSED
ORIGINAL_I4=ADDRESSED
WORKFLOW_TIMING_TEST_FIX=PASS

SPEC_COMPLIANCE=FAIL
TASK_QUALITY=FAIL
Critical=0
Important=1
Minor=0
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=BLOCKED

reviewCompletedUtc=2026-07-27T10:49:03.9794240Z
reviewEvidenceWindowStartUtc=2026-07-27T10:47:07.5609592Z
reviewEvidenceWindowElapsedSeconds=116.418
focusedClassifierElapsedSeconds=12.116

## Safe evidence

- The review package was read first and all 16 listed SHA-256 values were recomputed from the current workspace. All 16 matched exactly.
- The original blocked review, first re-review, I1-I4 fix report, Workflow timing-test fix report, approved design and plan, current classifier, dedicated tests, changed Workflow test boundary, Task 1/controller reports, relevant Core containment/fixed-target code and tests, and both Compose definitions were inspected.
- A fresh focused injected-only classifier run completed `Total=80`, `Passed=80`, `Failed=0`, `Skipped=0`, elapsed 12.116 seconds. The full suite, Workflow termination group, and authoritative regression were not rerun.
- The recorded final Workflow termination group is `6/6`, and the recorded final authoritative Core/Workflow/classifier combination is `196/196`, zero failed and skipped, elapsed 279.2 seconds. Their source hashes match the review package.
- Both probes establish `default_transaction_read_only=on`, `statement_timeout=5000`, and `lock_timeout=1000` through session-start `PGOPTIONS`, use the exact noninteractive `psql` flags, and have a 15000-millisecond native bound.
- Both probes route through the immutable fixed Compose target and exact ordered base/override prefix. Core rejects project/file identity overrides and validates the single approved service and volume. The default project/volume cannot be constructed by the classifier.
- Production baseline derivation precedes Core import, Compose resolution, and native access. It requires 12 direct migrations, 45 strict Prisma mappings, and exact sorted model/migration table-set equality. The dedicated same-count substitution test requires `BUILD_BASELINE_MISMATCH` with zero native calls.
- Probe 1 embeds the 45 validated application names in an internal `VALUES` relation, counts only approved matches, and combines that count with total public tables and metadata presence. A same-count unexpected-table substitution cannot satisfy COMPLETE.
- The strict SQL-source helper rejects JOIN, immediately quoted sources, and comma-separated sources. In-memory Probe 1 and Probe 2 comma-source mutants are both required to fail. Final argument-vector assertions cover the fixed Compose prefix, read-only startup controls, exact psql flags, native timeout, approved sources, three-column migration projection, and write/procedural token rejection.
- Probe 2 remains dominated by successful Probe 1 native, parser, read-only, target/version, metadata-presence, column-completeness, and structural checks. It reads only `migration_name`, `finished_at`, and `rolled_back_at`, and emits aggregate counts without names or logs.
- The original I2 state now maps zero approved application tables plus the exact completed migration set to `DATABASE_STATE_INCONSISTENT`. The original I3 category arithmetic now unconditionally requires completed-active plus unresolved-active plus rolled-back to equal records.
- The dedicated matrix covers the five states; seven guard alerts; malformed Probe 1/Probe 2 grammar categories; baseline under/over-count, duplicate, malformed, reserved-name, shape, null, and operation-contract cases; invalid Compose service/volume metadata; sensitive exceptions at Compose and each probe; and unconfirmed termination at each probe position.
- Core captures all native streams, assigns a suspended process to containment before resume, bounds execution, terminates the contained tree on timeout, confirms termination, and returns no stderr or exception content. The classifier emits only its safe record and stable codes.
- The Workflow timing change is confined to re-sampling both resource-lock checks after the pre-existing bounded 3500-millisecond convergence wait. The assertions that Core reports unsuccessful timeout, confirmed termination, both sentinels present, and the complete tree stopped are unchanged; no Core expectation was weakened.

## Original finding disposition

### I1 - ADDRESSED

Production Prisma mappings and migration CREATE TABLE targets are compared as exact 45-name sets before native access; Probe 1 performs internal approved-table matching; and a same-count mapping substitution is mutation-tested with zero native calls.

### I2 - ADDRESSED

Zero application tables with an otherwise exact completed expected migration set is classified INCONSISTENT before the general METADATA_ONLY branch.

### I3 - ADDRESSED

The originally reported status-category contradiction is closed: completed-active plus unresolved-active plus rolled-back must equal the total record count.

### I4 - ADDRESSED

The original and re-review gaps are covered: strict source-shape checks include comma sources and Probe 1/Probe 2 comma mutants; production exact-set equality has a same-count substitution test; and the parser, baseline, Compose, exception, and per-probe termination boundaries are represented.

## Finding

### Important I5 - A contradictory expected/unexpected-name partition is accepted as METADATA_ONLY

`expectedNameMatchCount` and `unexpectedNameCount` are disjoint and exhaustive over `distinctMigrationNameCount` in the fixed Probe 2 SQL. Therefore their sum must equal the distinct-name count. `Test-MigrationAggregateArithmetic` rejects only a sum greater than the distinct count, allowing a smaller sum.

The dedicated approved fixture itself contains `records=1`, `distinct=1`, `expected=0`, `unexpected=0` and expects METADATA_ONLY. A focused injected-only check freshly confirmed that this contradictory aggregate returns `status=READY` with `DATABASE_STATE_METADATA_ONLY`. No native process, Docker, or database operation was used.

This violates the design requirement that METADATA_ONLY aggregates be internally consistent and that contradictory aggregate arithmetic classify as INCONSISTENT. It also means the claimed aggregate boundary matrix is not mutation-resistant for this partition. Launch readiness must remain BLOCKED until equality is enforced and the contradictory fixture is replaced with an internally consistent unresolved expected-name or unexpected-name case.

## Required-question disposition

1. Read-only mode effective from session start for both probes: YES.
2. Fixed isolated target and ordered two-file prefix mandatory for every native probe call: YES.
3. Default project and volume unreachable from classifier construction: YES.
4. Baseline drift blocks before Compose or database access: YES.
5. Probe 1 limited to approved catalog/schema metadata with no business rows: YES.
6. Probe 2 limited to the three approved migration-metadata columns and aggregate output: YES.
7. Probe 2 gating and the original I2/I3 rules are corrected, but all state arithmetic is fail-stop: NO, due to I5.
8. Raw or sensitive native output can reach the record or an additional stream: NO.
9. Native containment and termination guarantees preserved: YES.
10. Offline tests mutation-resistant at the requested vector, source, baseline, parser, Compose, exception, and termination boundaries: NO overall, due to the accepted I5 aggregate contradiction.
11. Any live or prohibited operation occurred: NO.
12. Disclosed transient evidence permits an unqualified readiness claim: NO; it is accurately disclosed, while I5 independently blocks readiness.

## Transient-evidence disposition

- The implementer combined regression that exceeded its 120-second bound remains a timeout without totals and is not treated as passing.
- The first controller full combination remains disclosed as 165 total, 164 passed, 1 failed, 0 skipped. The failure was not reproduced in the recorded 90/90 Core-plus-classifier, 124/124 Workflow-plus-classifier, or next 165/165 combination.
- Controller hardening's recorded fresh combination remains 166/166. The I1-I4 repair evidence remains 79/79 focused and 195/195 authoritative before the final I4 additions.
- The first re-review's remaining I4 gap remains disclosed. After comma mutants and the same-count substitution test, the focused suite reached 80/80; this review freshly reproduced 80/80.
- Two later 196-item combinations remain disclosed with the same pre-existing descendant-tree timing-test failure. The Workflow fix report records RED 5/6, GREEN 6/6, and the final authoritative 196/196 after resampling following the existing bounded wait.
- None of the earlier timeout or failing evidence is rewritten as passing. The recorded and fresh passing evidence does not compensate for I5.

## Prohibited-operation counts

- liveDatabaseClassifierExecutions=0
- liveDockerOperations=0
- liveDatabaseConnections=0
- livePrismaOperations=0
- livePackageManagerOperations=0
- initializerExecutions=0
- migrationExecutions=0
- resetExecutions=0
- bootstrapExecutions=0
- networkOperations=0
- operatorInputOperations=0
- defaultVolumeAccess=0
- gitOrGitHubCommands=0

