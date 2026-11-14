# Task 2 Independent Review

SPEC_COMPLIANCE=FAIL
TASK_QUALITY=FAIL
Critical=0
Important=4
Minor=0
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=BLOCKED

reviewCompletedUtc=2026-07-27T09:46:15.5392803Z
reviewElapsedSeconds=420

## Safe evidence

- All 12 authoritative SHA-256 values matched the review package before review.
- Approved design and plan were read in full. The classifier and its dedicated tests were read in full; the supporting reports, Compose definitions, and relevant Core/initializer/supporting-test boundaries were inspected.
- Static parse: files=6, errors=0.
- Focused injected-only scenarios=2. Both reproduced the classification findings below. No native process, Docker, database, package-manager, migration, initializer, bootstrap, network, operator-input, or default-volume operation was invoked.
- Both probe construction sites set startup read-only mode plus bounded statement and lock timeouts and use a bounded native timeout (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:178-180`, `196-198`). PostgreSQL receives the read-only option in the session startup parameters, before either SQL statement.
- Both probes pass their tail through the fixed Compose argument builder (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:183-187`, `201-205`). The Core builder reconstructs and validates the fixed ordered two-file prefix and rejects identity options in the command tail (`.codex-safe/LocalPreproduction.Core.psm1:1168-1212`); fixed-target metadata validation is fail-stop (`1215-1286`). This excludes construction of the default project/volume target.
- Baseline evaluation is ordered before Core import, Compose resolution, or database access (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:243-258`). The completeness defect is Finding I1.
- Probe 1 reads only approved catalog/schema metadata and aggregate counts (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:269-287`). Probe 2 projects only the three approved migration-metadata columns and reduces them to aggregate counts (`323-338`). No business-row or migration-log projection was found.
- Probe 2 is dominated by successful Probe 1 native/parse/read-only/target checks plus metadata presence, column completeness, and structural consistency (`289-323`). There is no retry path.
- Native stdout/stderr and injected streams are contained by the Core boundary; the returned Core shape excludes stderr and exceptions (`.codex-safe/LocalPreproduction.Core.psm1:949-977`, `1115-1130`). The classifier maps failures to stable codes and returns only the safe record (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:361-376`).
- Native containment assigns a suspended process before resume, drains both streams, bounds execution, terminates the contained process tree on timeout, and reports termination confirmation (`.codex-safe/LocalPreproduction.Core.psm1:985-1111`). Supporting mutation-oriented containment tests cover direct-child, descendant-tree, pre-resume, timeout, and unconfirmed-termination boundaries (`.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:2970-3171`).

## Required-question disposition

1. Read-only from session start for both probes: YES.
2. Fixed isolated target and ordered two-file prefix mandatory for every native probe call: YES.
3. Default project/volume unreachable from classifier construction: YES.
4. Every approved baseline drift blocks before access: NO; ordering is correct, but the approved application-side baseline is incomplete (I1).
5. Probe 1 limited to approved catalog/schema metadata and no business rows: YES.
6. Probe 2 limited to the three approved metadata columns and aggregate output, with no logs or names emitted: YES.
7. Probe 2 gating, all five classifications, and all seven failures correctly ordered and fail-stop: NO; gating and all code symbols exist, but two state rules are incorrect (I2, I3), and required failure-path mutation coverage is incomplete (I4).
8. Raw/sensitive native output can reach the record or an additional stream: NO.
9. Native containment and termination guarantees preserved: YES.
10. Offline tests mutation-resistant for final vectors and strict SQL source allowlists: NO (I4).
11. Live or prohibited operation occurred: NO.
12. Disclosed transient evidence supports an unqualified readiness claim: NO. It is correctly disclosed and not rewritten as passing; the later authoritative fresh 166/166 run resolves the transient regression concern but does not resolve I1-I4.

## Findings

### Important I1 - Approved application baseline and internal set comparison are missing

The approved design requires 45 mapped Prisma application models and says the expected names are used for internal set comparison (`docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md:56-61`). Production baseline derivation reads only migration directories/files and extracts migration `CREATE TABLE` targets; it never reads or validates the Prisma model mapping (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:127-143`). The validated application-name set is never used in probe SQL. Probe 1 counts all non-metadata public tables (`271-287`), and COMPLETE depends on counts plus migration aggregates (`357`) rather than equality with the approved application table set. Source-model drift or a same-count table-name substitution can therefore pass the pre-access baseline and can contribute to a false COMPLETE classification.

### Important I2 - Complete migration metadata with zero application tables is misclassified

The design limits METADATA_ONLY to aggregate metadata that does not prove the complete expected set (`docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md:143-148`). The implementation assigns METADATA_ONLY for every arithmetically accepted Probe 2 result whenever the application-table count is zero (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:354`), including an otherwise exact completed expected migration set. A focused injected-only scenario reproduced `READY` with `DATABASE_STATE_METADATA_ONLY` for this contradictory state. It must not be reported as the approved metadata-only state.

### Important I3 - Contradictory migration record arithmetic is accepted

The three emitted status categories are mutually exclusive and exhaustive for every migration record, so their sum must equal the record count. The implementation permits a smaller category sum whenever either unexpected-name or duplicate-name count is nonzero (`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1:212-217`). The dedicated test suite affirmatively expects PARTIAL for a fixture whose record count exceeds its category total (`.codex-safe/tests/LocalPreproduction.DatabaseStateClassifier.Tests.ps1:155-161`), despite the plan requiring category-total contradictions to be INCONSISTENT (`docs/superpowers/plans/2026-07-27-local-preproduction-read-only-database-state-classifier.md:200`) and the design assigning contradictory arithmetic to INCONSISTENT (`docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md:183`). A focused injected-only scenario confirmed that this contradiction is accepted.

### Important I4 - Dedicated offline tests are not mutation-resistant at required boundaries

The SQL source checks enumerate only `FROM` tokens (`.codex-safe/tests/LocalPreproduction.DatabaseStateClassifier.Tests.ps1:115-128`); they do not inspect `JOIN` sources or quoted source forms. A read-only business-table JOIN mutation can therefore evade the claimed strict source allowlist. The required guard/parser matrix is also incomplete: the malformed Probe 2 cases cover only a subset of the mandated grammar mutations (`185-200`), native cases cover nonzero exits and a termination-state failure that stops in Compose metadata but not thrown sensitive exceptions or probe-specific unconfirmed termination (`202-210`), and baseline cases omit several mandated over-count/malformed variants (`213-224`). There is no dedicated classifier assertion for `COMPOSE_TARGET_INVALID`. These gaps violate the approved mutation-resistant offline test design and leave safety/classification regressions able to pass the focused suite.

## Transient-evidence disposition

- The implementer combined regression timeout remains a timeout without totals and is not treated as passing.
- The earlier single regression failure was not reproduced in the stated focused combinations or the next full combination.
- The controller hardening added one focused test, and the final authoritative fresh combination completed 166/166 with zero failures and skips.
- This disclosure is adequate for the transient itself; it neither creates an additional finding nor supplies evidence against the independent I1-I4 findings. Launch readiness remains BLOCKED.

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

