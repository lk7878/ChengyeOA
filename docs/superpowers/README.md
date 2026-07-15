# Superpowers Engineering Records

This directory holds the approved engineering decisions and operator records for Chengye OA.

| Area | Authoritative record |
| --- | --- |
| Implemented baseline | `specs/2026-07-12-engineering-baseline-postgresql-migration-design.md` |
| Approved SPEC-002 design | `specs/2026-07-15-system-bootstrap-super-admin-trust-root-design.md` |
| SPEC-002 implementation plan | `plans/2026-07-15-system-bootstrap-super-admin-trust-root-implementation.md` |
| Completed implementation plan | `plans/2026-07-14-empty-postgresql-baseline-implementation.md` |
| Closeout evidence | `reports/spec-001-closeout.md` |
| Repository boundary | `adr/0001-project-repository-boundary.md` |
| Database boundary | `adr/0002-postgresql-and-canonical-prisma.md` |
| Local setup | `runbooks/local-development.md` |
| Backup and restore | `runbooks/postgresql-backup-restore.md` |
| System bootstrap and super-admin recovery | `runbooks/system-bootstrap-and-super-admin-recovery.md` |
| Historical source audit | `runbooks/sqlite-to-postgresql-migration.md` |

SPEC-001 local implementation is complete. Remote CI execution, dependency-security triage, and Inno Setup installer compilation remain release gates and are not recorded as passed. SPEC-002 implementation is under acceptance; it is not complete until automated verification and the manual interactive-TTY smoke test are both recorded.

Never commit local environment files, database artifacts, backup files, audit exports, logs, or generated distributions.
