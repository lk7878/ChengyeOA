# Deployment

Deploy with Node 22, npm, PostgreSQL 16, and an externally managed `DATABASE_URL`.

## Release Sequence

```powershell
npm.cmd run setup
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
npm.cmd run verify
```

`npm.cmd run setup` installs the root, server, and web lockfiles and generates Prisma Client for a clean checkout.

Set runtime secrets and the database URL through the deployment environment, never through committed files. Apply the canonical migrations before starting the application. The empty baseline intentionally creates no organization, user, role, permission, or other business record.

Use the protected `db:reset:test` command only for test databases. Use the backup and restore rehearsal in `../../../docs/superpowers/runbooks/postgresql-backup-restore.md` for recovery validation. Deployment rollback must use PostgreSQL backups and reviewed migration procedures.

## Windows Distribution

`npm.cmd run pkg` is the only portable distribution producer. It builds the web and server applications from fresh output directories and writes the verified runtime tree to `apps/dist/law-firm-system/`. The tree contains `law-firm-system.exe` plus physical `prisma-engine/`, `public/`, and `run/` directories.

Run `npm.cmd run build:zip` to rebuild that tree and create `apps/dist/installer/LawFirmSystem-Portable-1.0.0.zip`. Run `npm.cmd run build:installer` with Inno Setup 6 `iscc` on `PATH` to rebuild the same tree and create the installer. Both distribution commands reject incomplete runtime trees before consuming them.

Configure `DATABASE_URL`, `JWT_SECRET`, and `APP_KEYS` in the launch environment. Start the portable or installed application with `law-firm-system.exe`.
