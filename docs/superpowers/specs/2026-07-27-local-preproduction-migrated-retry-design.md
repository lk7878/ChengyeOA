# Local Preproduction Migrated-State Retry Design

**Date:** 2026-07-27

**Status:** Recommended design approved and self-reviewed; pending user review

## Context

The migration-order implementation correctly deploys the schema after the isolated zero-table reset and before the application-row assertion. Independent review found one retry-safety gap: after a successful migration followed by a later failure, a second initializer invocation sees nonzero public tables and stops before it can reach the authoritative deploy command.

The retry design must preserve the isolated database for investigation, must never automatically delete a migrated state, and must not weaken the existing missing-schema or nonempty-application-data checks.

## Decision

Add a same-version, non-destructive migrated-state resume branch. A nonzero public-table count is never treated as authorization to reset. It is only a candidate for resume.

The candidate is accepted only when the existing `db:assert-empty` command proves both of the following through the current Prisma model delegates:

1. the application schema required by this exact build is complete enough for every governed model query to succeed;
2. every governed application model contains zero rows.

If either condition is not proven, the initializer stops with the stable code `MIGRATED_RETRY_STATE_UNSAFE`. It preserves the isolated database and performs zero destructive calls, zero migration calls, zero contract calls, and zero bootstrap calls.

## State Classification

After fixed-target metadata validation, baseline startup, health, and the strict public-table count:

### Fresh empty state

When the public-table count is exactly zero, preserve the existing flow unchanged:

1. emit `ISOLATED_DATABASE_EMPTY`;
2. perform the single already-authorized scoped `down --volumes` operation;
3. recreate the isolated database and pass the second health gate;
4. emit `DATABASE_READY`;
5. run `db:deploy`, emit `MIGRATED`, run `db:assert-empty`, and continue only on success.

### Migrated resume candidate

When the public-table count is greater than zero:

1. do not emit `ISOLATED_DATABASE_EMPTY`;
2. do not execute `down --volumes` or any other reset;
3. run `db:assert-empty` as a pre-resume proof against the healthy fixed isolated target;
4. on failure, emit one `BLOCKED` record with `MIGRATED_RETRY_STATE_UNSAFE` and stop;
5. on success, emit `MIGRATED_RETRY_STATE_READY`;
6. run the same authoritative, idempotent `db:deploy` command with the unchanged timeout;
7. emit `MIGRATED` only on successful deployment;
8. run `db:assert-empty` again as the post-deploy application-row gate;
9. continue to the existing bootstrap contract and hidden administrator bootstrap only when the post-deploy assertion succeeds.

The resume branch is valid only for retrying the same source and portable build version. It is not an upgrade path. If a newer build requires schema objects absent from the current state, the pre-resume assertion fails closed and requires investigation plus separately authorized recovery.

## Failure Handling

- Malformed or failed table-count output retains `DATABASE_EMPTY_CHECK_FAILED`.
- Fresh-state reset failures retain their existing stable codes.
- Resume pre-assert failure returns `MIGRATED_RETRY_STATE_UNSAFE` and preserves the database.
- Resume deployment failure returns `MIGRATION_FAILED`; later assertion, contract, and bootstrap calls remain zero.
- Post-deploy assertion failure returns `DATABASE_NOT_EMPTY`; contract and bootstrap calls remain zero.
- Contract and administrator-bootstrap failures retain their existing stable codes.
- No failure path automatically retries or resets.

## Safety Properties

- The fixed isolated Compose project and two-file prefix remain mandatory for every Compose call.
- The default volume containing 87 user tables remains unreachable.
- Destructive call count is exactly one only in the proven zero-table fresh branch and exactly zero in the migrated resume branch.
- A partial migration cannot resume because the pre-resume Prisma assertion cannot prove the complete governed schema.
- A partial administrator bootstrap that left any governed application row cannot resume because the pre-resume assertion fails.
- A contract or bootstrap failure that left the governed application tables empty may resume without data loss.
- The assertion script is unchanged and continues to treat missing tables as failure.
- Core native containment, timeouts, environment loading, hidden-input behavior, and safe output remain unchanged.
- No remote Worker toggle, event-history mutation, URL, credential, payload, raw database error, stack, host, PID, worker identity, or lock-owner data is added to evidence.

## Alternatives Considered

### Automatically reset every nonzero isolated state

Rejected. It could erase diagnostic state or rows created by a partially completed administrator bootstrap, and it would turn a retry into an implicit destructive authorization.

### Persist a local resume marker after migration

Rejected. A marker can become stale or detached from the actual database state and would require a new durable identity-binding mechanism. The database must prove its own safe resume state.

### Require manual reset after every post-migration failure

Safe but not selected. It avoids implementation work but prevents non-destructive recovery from contract or bootstrap failures that leave the migrated application tables empty.

## Offline Test Design

Add state-carrying injected two-invocation fixtures without Docker, database, migration, network, package-manager, or operator-input operations.

Required cases:

1. zero-table first invocation, successful migration, later contract failure, then a nonzero-table/empty-schema second invocation that pre-asserts, performs zero reset calls, deploys once, post-asserts once, and continues;
2. zero-table first invocation, successful migration, later bootstrap failure with no governed rows, then the same successful non-destructive resume;
3. nonzero tables with an incomplete schema: pre-assert fails, reset and migration calls remain zero;
4. nonzero tables with any governed application row: pre-assert fails, reset and migration calls remain zero;
5. resume migration nonzero and launch failures: post-assert, contract, and bootstrap calls remain zero;
6. resume post-deploy assertion nonzero and launch failures: contract and bootstrap calls remain zero;
7. fresh zero-table path retains exactly one scoped reset and the established deploy-before-assert order;
8. hidden bootstrap arguments and inherited streams remain unchanged.

The full Core and Workflow regression must pass in a fresh process. A fresh independent reviewer must verify both spec compliance and task quality before any live retry.

## Live Continuation

The currently preserved isolated database stopped before the migration stage and previously proved zero public tables, so the next controlled retry is expected to take the fresh empty branch. The migrated resume branch is nevertheless required before launch so any later contract or bootstrap failure remains safely recoverable without automatic data loss.

Any live `BLOCKED` result stops execution. Investigation preserves the isolated database, and any destructive recovery requires separate explicit authorization.
