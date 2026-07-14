# Historical Source Audit and PostgreSQL Baseline

## Status

The audited historical source files are not migration input. The approved replacement is the clean PostgreSQL baseline described by `../plans/2026-07-14-empty-postgresql-baseline-implementation.md`.

## Audit Boundary

The two historical database files remain untracked and read-only. Their inventory and diff capabilities are retained only for investigation. They are not application runtime fallback, recovery input, or a source for business records.

No importer, validation command, or seed command is part of the active baseline. A later discovery of real operating data requires a new Spec, read-only source copies, hashes, audit evidence, and an explicit approval before any write capability can be considered.

## Empty Baseline Evidence

Canonical migrations create the 22 application models under `apps/server/prisma`. After migration or protected test reset, `npm.cmd run db:assert-empty` must report zero rows in every application table. Recovery evidence and final local verification are recorded in `.superpowers/sdd/task-14-report.md`; controller review still determines the SPEC-001 closeout.
