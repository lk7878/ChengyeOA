# Local Preproduction Migration and Empty-Row Gate Design

**Date:** 2026-07-27

**Status:** Design option A approved; pending written-spec review

## Context

The isolated database successfully passed baseline health, exact zero-table proof, scoped volume reset, and post-reset health. The next `db:assert-empty` command failed with the stable classification `SCHEMA_NOT_DEPLOYED` because its Prisma model delegates query application tables that do not exist until migrations are applied. The initializer currently maps every assertion failure to `DATABASE_NOT_EMPTY`, which is incorrect for this state.

## Goal

Apply migrations to the already proven-empty isolated database, then verify that all application-model tables contain zero rows before allowing the bootstrap contract or administrator bootstrap.

## Preconditions

- The fixed isolated Compose target passed all metadata gates.
- The isolated baseline database was healthy and had exactly zero public base tables.
- The isolated project completed its single scoped volume reset.
- The recreated isolated database passed the second health gate and emitted `DATABASE_READY`.
- The existing default volume containing 87 user tables remains unreachable.

## Revised Sequence

After `DATABASE_READY`, the initializer executes:

1. `db:deploy`.
2. Emit `MIGRATED` only when deployment succeeds.
3. `db:assert-empty` against the migrated schema.
4. Emit `DATABASE_ASSERT_EMPTY` as `READY` only when every included application model has zero rows.
5. `check:bootstrap`.
6. Emit `BOOTSTRAP_CONTRACT_READY`.
7. Emit `WAITING_OPERATOR_SECRET_INPUT` and run the existing inherited-console safe bootstrap.
8. Emit `ADMIN_BOOTSTRAPPED` only on exit code zero.

## Failure Handling

- Migration nonzero or launch failure: `MIGRATION_FAILED`; assertion and bootstrap calls remain zero.
- Empty-row assertion nonzero after migration: `DATABASE_NOT_EMPTY`; bootstrap-contract and administrator-bootstrap calls remain zero.
- Bootstrap contract or administrator bootstrap failures retain their existing stable codes.
- Raw package-manager, Prisma, database, or bootstrap output remains suppressed or handled by the existing safe interactive contract.

## Safety Rationale

Migration is allowed only after the isolated volume has been recreated and the fixed SQL catalog check proved zero tables. Therefore migration cannot overwrite an existing application schema or reach the default 87-table volume. Keeping `db:assert-empty` after migration preserves a second independent guarantee: migrations may create schema and approved baseline rows, but no application data may exist before administrator bootstrap.

The assertion script itself is not changed to treat missing tables as empty, because doing so could hide a partial or incorrect schema. The assertion is not removed.

## Testing

- Meaningful RED proves the old order calls assertion before migration.
- GREEN proves exact order: deploy, `MIGRATED`, assert-empty, assertion-ready, bootstrap contract, hidden bootstrap.
- Migration failure stops assertion and every bootstrap call.
- Assertion failure after successful migration stops both bootstrap calls.
- Existing strict isolation, fixed-prefix, timeout, hidden-input, and fail-stop tests remain green.
- During implementation and review, live Docker, database, migration, initializer, bootstrap, network, and operator-input counts remain zero.

## Live Continuation

After implementation, full regression, root verification, and independent review pass, the operator reruns the initializer once in the existing approved PowerShell boundary. The already migrated state must remain retry-safe through the authoritative deploy command. No default-volume operation is permitted.
