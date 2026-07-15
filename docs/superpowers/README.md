# Superpowers Engineering Records

This directory holds the approved engineering decisions and operator records for Chengye OA.

| Area | Authoritative record |
| --- | --- |
| Implemented baseline | `specs/2026-07-12-engineering-baseline-postgresql-migration-design.md` |
| Business design under review | `specs/2026-07-15-system-bootstrap-super-admin-trust-root-design.md` |
| Completed implementation plan | `plans/2026-07-14-empty-postgresql-baseline-implementation.md` |
| Closeout evidence | `reports/spec-001-closeout.md` |
| Repository boundary | `adr/0001-project-repository-boundary.md` |
| Database boundary | `adr/0002-postgresql-and-canonical-prisma.md` |
| Local setup | `runbooks/local-development.md` |
| Backup and restore | `runbooks/postgresql-backup-restore.md` |
| Historical source audit | `runbooks/sqlite-to-postgresql-migration.md` |

SPEC-001 local implementation is complete. Remote CI execution, dependency-security triage, and Inno Setup installer compilation remain release gates and are not recorded as passed. SPEC-002 now defines the first organization and super-administrator trust root and is awaiting written review; it has not entered implementation.

Never commit local environment files, database artifacts, backup files, audit exports, logs, or generated distributions.
