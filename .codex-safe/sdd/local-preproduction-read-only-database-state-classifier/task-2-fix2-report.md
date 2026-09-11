# Task 2 Fix 2 Safe Report

UTC: 2026-07-27

## RED/GREEN evidence

- RED: focused injected suite completed `Total=51`, `Passed=50`, `Failed=1`, `Skipped=0`. The failure proved I2: zero application tables plus a complete active expected migration set was reported as METADATA_ONLY.
- Controller coverage RED: after the required I4 matrix was added, the focused suite completed `Total=79`, `Passed=78`, `Failed=1`, `Skipped=0`. The one failure was confined to a non-persistent test-fixture counter for the Probe 2 exception case; the classifier emitted the safe output-invalid alert and no sensitive value.
- Final GREEN after independent re-review I4 closure: focused injected suite completed `Total=80`, `Passed=80`, `Failed=0`, `Skipped=0`.
- AST parse errors for the classifier and dedicated test file: `0`.

## Fix evidence

- Production baseline now uses the fixed `apps\server\prisma` migrations/schema paths, requires exactly 45 strictly mapped application models, and requires exact equality with the 45 validated migration CREATE TABLE targets before native access. An injected-only test omits BuildBaseline, proves the actual fixed production baseline reaches 12/45, and then reaches only the injected Compose/probe calls.
- Probe 1 internally carries the validated expected application-table relation and counts only approved expected public tables. The safe record contract and probe output field count remain unchanged.
- Exact complete migration metadata with zero approved application tables now classifies as INCONSISTENT.
- Migration category arithmetic now always requires completed-active plus unresolved-active plus rolled-back to equal records.
- Dedicated vector tests assert expected application VALUES, reject JOIN and quoted sources, reject the complete write/procedural token set, and retain exact fixed Compose, read-only option, flags, and timeout assertions. Per-native-call termination sequences prove unconfirmed containment at Probe 1 and Probe 2 with the expected psql call counts.
- The completed I4 matrix covers invalid service and volume metadata, sensitive Compose/probe exceptions, both probe-specific unconfirmed-termination positions, and the full missing/extra/multiline/leading-zero/signed/negative/decimal/exponent/whitespace/overflow Probe 2 grammar.
- Baseline tests now cover migration and table under-counts and over-counts, duplicate and malformed names, the reserved metadata-table name, invalid collection shapes, null output, extra properties, and null/non-scriptblock/unknown injected operation contracts. Every baseline or operation-contract failure proves zero native calls.
- A pure SQL-source-shape guard rejects comma-separated sources in addition to JOIN and quoted sources. In-memory Probe 1 and Probe 2 comma-source mutants are both required to fail this guard without executing SQL.
- A temporary production-baseline fixture keeps the approved migration/model counts constant while substituting one mapped table name. It must return `BUILD_BASELINE_MISMATCH` with zero native calls, proving the exact Prisma-model/migration-table set-equality guard is mutation-catching.

## Limitation

No Core change was made.

## Safety statement

Only focused injected tests and static parsing were run. No Docker, database, Prisma, npm, initializer, migration, reset, bootstrap, network, operator-input, or Git operation was run.

## SHA-256

- `Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`: `5E8002B85A4A43467B49754E98640380375586C92156EA6CF87F5E0D60C40AB8`
- `LocalPreproduction.DatabaseStateClassifier.Tests.ps1`: `59600D783073CD55034FF6D0630FD4AB21BA5B658D521D2C87CFF83B637706FC`
