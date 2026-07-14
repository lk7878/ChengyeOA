# Superpowers Engineering Records

This directory holds the approved engineering decisions and operator records for Chengye OA.

| Area | Authoritative record |
| --- | --- |
| Approved baseline | `specs/2026-07-12-engineering-baseline-postgresql-migration-design.md` |
| Active implementation | `plans/2026-07-14-empty-postgresql-baseline-implementation.md` |
| Repository boundary | `adr/0001-project-repository-boundary.md` |
| Database boundary | `adr/0002-postgresql-and-canonical-prisma.md` |
| Local setup | `runbooks/local-development.md` |
| Backup and restore | `runbooks/postgresql-backup-restore.md` |
| Historical source audit | `runbooks/sqlite-to-postgresql-migration.md` |

SPEC-001 remains approved until the controller completes the required Task 14 review and verification closeout. Task 14 local verification and recovery evidence is recorded in `.superpowers/sdd/task-14-report.md`.

Never commit local environment files, database artifacts, backup files, audit exports, logs, or generated distributions.
