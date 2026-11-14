# Local Preproduction Read-Only Database-State Classifier Design

**Date:** 2026-07-27

**Status:** Written and self-reviewed; pending user written-spec review and implementation plan

## Context

The isolated local-preproduction database was freshly reset, passed its second health gate, and then stopped at `MIGRATION_FAILED`. The initializer performed no post-migration assertion, bootstrap-contract check, secret prompt, or administrator bootstrap. The isolated database remains preserved, and the default volume containing 87 user tables remains unreachable and untouched.

The zero-database-connection migration launch-chain classifier is now stable:

- required process variables: 16/16;
- Node 22.14.0: READY;
- npm 10.9.2: READY;
- production mode: READY;
- Worker disabled: READY;
- Prisma version launch: 2/2;
- Prisma migration-deploy help: 2/2;
- direct server deploy help: 2/2;
- root-to-server deploy help: 2/2;
- migration executions: 0;
- initializer executions: 0.

One earlier root-delegation help result was false and was not reproduced by the later stage trace or two complete consistency iterations. It remains disclosed as unresolved transient evidence and is not treated as the migration failure's root cause.

The next diagnostic action must determine the preserved database's schema and migration-metadata state without reading business rows or permitting a write.

## Decision

Add a separately tested and independently reviewed database-state classifier that uses `psql` inside the fixed isolated Compose target. Every database session starts with PostgreSQL-enforced read-only mode and bounded timeouts. The classifier reads only catalog, schema, and `_prisma_migrations` metadata, captures all native output, and emits only safe booleans, bounded counts, status, and stable classification codes.

The classifier is diagnostic only. No result authorizes migration, initializer, reset, bootstrap, data repair, or any other write.

## Absolute Constraints

- No Git or GitHub commands.
- Do not rerun the initializer or migration.
- Do not reset, delete, rewrite, seed, repair, or bootstrap the preserved database.
- Do not delete, skip, or rewrite Event Center history.
- Do not add a remote Worker toggle.
- The fixed isolated Compose project and ordered two-file prefix are mandatory for every Docker Compose command.
- The default Compose project and its volume containing 87 user tables remain unreachable.
- Do not print URLs, credentials, payloads, database or role names, migration names, raw database errors, stacks, host, PID, worker identity, or lock-owner details.
- Evidence is limited to safe status, bounded counts, booleans, stable alert/classification codes, UTC, and elapsed duration.
- The classifier reads no business-table rows and no `_prisma_migrations.logs` values.
- Any malformed, incomplete, multi-line, unexpected, or failed result blocks classification.
- There is no automatic retry of database connections or follow-on operations.

## Approved Build Baseline

The classifier derives the expected migration and application-table sets from the current source before any database connection and then requires the approved same-version counts:

- migration directories containing `migration.sql`: 12;
- migration SQL files: 12;
- Prisma models with mapped application tables: 45;
- distinct `CREATE TABLE` targets across migration SQL: 45.

Directory names and mapped table names must pass strict local validation before they can be used internally. If the derived sets are duplicated, malformed, empty, or do not match the approved counts, classification stops with `BUILD_BASELINE_MISMATCH` before database access.

The expected names are used only for internal set comparison. They never appear in safe output or persisted evidence.

## Architecture

### Offline controller

The PowerShell entry point imports the existing local-preproduction Core module and reuses `Get-LocalPreproductionComposeTarget`, `New-LocalPreproductionComposeArguments`, and `Invoke-LocalPreproductionNative`.

Before database access it:

1. validates the fixed Compose target and ordered two-file prefix;
2. confirms the 12-migration/45-application-table build baseline;
3. constructs strict aggregate-only SQL from the validated expected migration set;
4. initializes every published field to a safe bounded value;
5. records that initializer, migration, reset, bootstrap, and default-volume operations are zero.

### Read-only database probes

Each probe uses the fixed Compose target to execute `psql` inside the isolated `postgres` service. It uses:

- `psql -X -qAt -v ON_ERROR_STOP=1`;
- non-interactive execution;
- process output capture for every stream;
- `PGOPTIONS` that sets `default_transaction_read_only=on` before the first SQL statement;
- a 5-second statement timeout;
- a 1-second lock timeout;
- the approved fixed local-preproduction database and role identities already used by the initializer.

The controller never uses or prints `DATABASE_URL` for these probes.

Probe 1 reads only `pg_catalog` and `information_schema`. It returns one strict record containing:

- read-only mode confirmed;
- database identity matched;
- role identity matched;
- PostgreSQL major version 16 confirmed;
- public base-table count;
- application base-table count excluding `_prisma_migrations`;
- migration metadata table present;
- required migration metadata columns present.

If read-only mode, target identity, server version, output shape, or native containment is not proven, the controller stops before Probe 2.

Probe 2 is launched only when Probe 1 proves that `_prisma_migrations` exists with the required columns. It starts a new independently read-only session and returns aggregate counts only:

- total migration records;
- distinct migration-name count;
- completed active migrations;
- unresolved active migrations;
- rolled-back migrations;
- expected-name matches;
- unexpected-name count;
- missing-expected-name count;
- duplicate-name count.

Probe 2 never selects migration names or logs into output. The expected-name `VALUES` relation is generated from the locally validated set and reduced to counts inside SQL.

### Strict parser and safe recorder

Each probe must return exactly one line with an exact field count. Boolean tokens are accepted only in the approved exact form, and counts must be canonical nonnegative decimal integers within configured upper bounds. Whitespace pollution, signs, decimals, exponents, overflow, missing fields, extra fields, or multiple lines are rejected.

Native stdout, stderr, and exceptions never flow to the console or report. The final record contains only:

- status;
- stable classification or alert codes;
- safe booleans;
- bounded counts;
- UTC start/end and elapsed duration;
- prohibited-operation counts fixed at zero.

## State Classification

Classification uses the following precedence. Any guard, target, native, or parse failure wins before database-state interpretation.

### `DATABASE_STATE_NO_EFFECT`

- public base-table count is 0;
- application base-table count is 0;
- `_prisma_migrations` is absent.

This proves that no migration schema state is visible. It does not by itself identify whether the earlier failure occurred before connection, during migration setup, or in another pre-schema boundary.

### `DATABASE_STATE_METADATA_ONLY`

- `_prisma_migrations` exists with the required columns;
- application base-table count is 0;
- public base-table count is 1;
- aggregate migration counts are internally consistent but do not prove the complete expected set.

This proves that Prisma migration metadata exists while no application table was created.

### `DATABASE_STATE_PARTIAL`

- structural guards remain valid;
- application base-table count is between 1 and 44, inclusive; or
- the database has at most the expected application-table count but migration aggregates show an unresolved, rolled-back, missing, duplicate, or unexpected migration state; or
- 45 application tables exist but the exact completed migration set is not proven.

The database remains preserved. No retry, repair, reset, or migration is authorized.

### `DATABASE_STATE_COMPLETE`

All of the following must be true:

- public base-table count is 46;
- application base-table count is 45;
- `_prisma_migrations` exists with all required columns;
- completed active migration count is 12;
- expected-name match count is 12;
- missing, unexpected, unresolved, rolled-back, and duplicate counts are all 0;
- record-count arithmetic is internally consistent.

This proves that the approved schema and migration set are present despite the earlier command failure. It does not authorize bootstrap or another migration attempt.

### `DATABASE_STATE_INCONSISTENT`

This classification covers structurally contradictory states, including:

- application tables without `_prisma_migrations`;
- more than 45 application tables;
- a public-table count inconsistent with the application-table count plus migration metadata;
- `_prisma_migrations` without its required columns;
- negative, impossible, or contradictory aggregate arithmetic;
- any state that satisfies neither a defined safe classification nor a guard failure.

The database remains preserved for a separately reviewed forensic plan.

## Failure Codes

- `BUILD_BASELINE_MISMATCH`: current source does not prove the approved 12-migration/45-table same-version baseline.
- `COMPOSE_TARGET_INVALID`: the fixed isolated Compose identity or two-file prefix is not proven.
- `READ_ONLY_GUARD_FAILED`: PostgreSQL does not prove the session is read-only.
- `DATABASE_TARGET_MISMATCH`: database identity, role identity, or PostgreSQL 16 does not match the approved fixed target.
- `DATABASE_STATE_OUTPUT_INVALID`: a probe result violates the exact single-record grammar or bounded-count rules.
- `NATIVE_TERMINATION_UNCONFIRMED`: the native process is not proven terminated inside existing containment.
- `READ_ONLY_DATABASE_STATE_FAILED`: a connection, timeout, nonzero exit, or other native failure occurs without exposing raw details.

Every failure returns `BLOCKED`, keeps all prohibited-operation counts at zero, and stops without retry.

## Offline Test Design

Tests inject native operations; they do not invoke Docker, PostgreSQL, Prisma, npm, the initializer, migration, bootstrap, network, or operator input.

Required cases include:

1. exact `DATABASE_STATE_NO_EFFECT`;
2. exact `DATABASE_STATE_METADATA_ONLY` with both zero and unresolved metadata records;
3. partial application-table counts from 1 through the bounded representative cases, including 44;
4. 45 application tables with incomplete migration metadata;
5. exact `DATABASE_STATE_COMPLETE`;
6. application tables without metadata;
7. more than 45 application tables;
8. missing metadata columns;
9. missing, unexpected, duplicate, unresolved, and rolled-back migration aggregates;
10. contradictory aggregate arithmetic;
11. read-only guard false;
12. database, role, and server-version mismatches;
13. native nonzero exits, launch exceptions, timeouts, and unconfirmed termination;
14. missing, extra, multiline, signed, negative, decimal, exponent, whitespace-polluted, and overflowing fields;
15. sensitive markers in every captured stream and exception, proving zero leakage;
16. Probe 2 call count 0 whenever Probe 1 does not safely authorize it;
17. initializer, migration, reset, bootstrap, default-volume, network, and operator-input call counts 0 in every case.

Static verification must prove:

- every Docker operation uses the fixed Compose target builder;
- exactly two allowed read-only `psql` probe sites exist;
- both sites contain the exact read-only and timeout controls;
- query text contains only catalog/schema `SELECT` operations and no DDL, DML, procedural calls, `COPY`, or business-row access;
- the second probe is dominated by the validated metadata-presence branch;
- no direct output writers or raw native results reach evidence;
- no `DATABASE_URL`, credential, migration-name, business-row, host, PID, Worker identity, lock-owner, or default-volume value is emitted;
- no product runtime, initializer, migration SQL, Compose definition, Event Center history, or Worker toggle is modified.

## Independent Review Gate

Implementation and review are separate roles. Before any real database connection, a fresh reviewer must inspect the approved design and plan, implementation, offline tests, static evidence, and safe report.

Required verdict:

```text
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY
```

The reviewer performs no real database, Docker, migration, initializer, bootstrap, network, operator-input, Git, or GitHub operation.

## Controlled Live Use

Only after the independent verdict is READY may the classifier be invoked once in the existing operator PowerShell that holds the approved process environment.

The single live classifier invocation may connect only to the preserved fixed isolated database through the two approved read-only probes. It records one safe result and stops. It never invokes migration, initializer, reset, assertion, contract, secret input, bootstrap, or default-volume operations.

The resulting state selects a new diagnostic branch that must be separately reasoned and, where it could lead to a write, separately designed, reviewed, and explicitly authorized.

## Non-Goals

- Fixing or retrying the failed migration.
- Reading business-table contents or row counts.
- Identifying or printing a migration name.
- Displaying raw Prisma or PostgreSQL diagnostics.
- Automatically choosing or performing recovery.
- Treating a complete schema as authorization to bootstrap.
- Changing the existing initializer, migration SQL, Compose isolation, Event Center behavior, or Worker configuration.

## Approval Record

The user approved:

1. migration/schema metadata only, with no business-row reads;
2. fixed isolated Compose plus PostgreSQL-enforced read-only `psql` as the execution approach;
3. the architecture and two-probe data flow;
4. the five state classifications and fail-stop codes;
5. offline testing, independent review, and one controlled live invocation only after review readiness.
