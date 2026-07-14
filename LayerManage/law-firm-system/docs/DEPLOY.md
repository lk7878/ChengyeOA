# Deployment

Deploy with Node 22, npm, PostgreSQL 16, and an externally managed `DATABASE_URL`.

## Release Sequence

```powershell
npm.cmd ci
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
npm.cmd run verify
```

Set runtime secrets and the database URL through the deployment environment, never through committed files. Apply the canonical migrations before starting the application. The empty baseline intentionally creates no organization, user, role, permission, or other business record.

Use the protected `db:reset:test` command only for test databases. Use the backup and restore rehearsal in `../../docs/superpowers/runbooks/postgresql-backup-restore.md` for recovery validation. Deployment rollback must use PostgreSQL backups and reviewed migration procedures.
