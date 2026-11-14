# ADR 0002: PostgreSQL and Canonical Prisma

## Status

Accepted on 2026-07-14.

## Context

The engineering baseline requires one reproducible schema source, one runtime database contract, and no implicit business-data writes.

## Decision

Development and test use PostgreSQL 16 through Docker. `apps/server/prisma` is the sole Prisma schema and migration source. Runtime configuration supplies an external `DATABASE_URL`. The baseline has no fallback database and applies no seed data.

## Consequences

Migrations are applied explicitly. The test reset is protected by its test-database and environment guards, then every application table is asserted empty. First organization and administrator initialization require a separate approved Spec.

## Supersedes

No prior database-runtime decision.
