# Controller Fix 1 Safe Report

UTC: 2026-07-27

## Scope

Only the Task 1 injected classifier test file changed. The classifier implementation was not changed because its two probe vectors already conformed.

## TDD evidence

- RED: the new captured-vector test initially failed on its deliberately incorrect final-argument index expectation.
- GREEN: after correcting the test's independently counted vector layout, focused injected classifier tests completed with `Total=50`, `Passed=50`, `Failed=0`, `Skipped=0`.

## Added controller coverage

- Both captured `psql` calls prove the fixed Compose prefix, fixed project identity, read-only `PGOPTIONS`, exact noninteractive psql flags, and a 15000-millisecond timeout.
- Probe 1 is required to be one `WITH` query whose every `FROM` source is in its approved CTE/information-schema allowlist; it rejects migration metadata rows and bare `logs` tokens.
- Probe 2 is required to be one `WITH` aggregate query over migration metadata only; it asserts `migration_name`, `finished_at`, and `rolled_back_at` individually and the exact direct three-column metadata-row projection before aggregation. It rejects bare `logs`, information-schema access, and business-table sources.
- Every checked SQL vector rejects the complete write/procedural token set: INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, TRUNCATE, COPY, CALL, and DO.

## Safe execution statement

The focused suite used injected native operations only. No Docker, database, npm, initializer, migration, reset, bootstrap, network, or operator-input operation was run. No Git command was run.

## SHA-256

- `Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`: `5E7AD8ED78BA32A26C74875F4DADDF4AB014F51315E475D025C8B0F60980B6EC`
- `LocalPreproduction.DatabaseStateClassifier.Tests.ps1`: `4280C86FC31AC3B0A0D2B8A32713CB535D125A885835C7667810F09A786CC0E0`
