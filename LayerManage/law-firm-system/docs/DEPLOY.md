# Deployment

Deploy with Node 22, npm, PostgreSQL 16, and an externally managed `DATABASE_URL`.

## Release Sequence

```powershell
npm.cmd run setup
npm.cmd run db:deploy
npm.cmd run verify
```

For the first deployment to a new database, take and verify a production backup or restore point before initialization, then run:

```powershell
npm.cmd run db:deploy
npm.cmd run db:assert-empty
npm.cmd run system:bootstrap
```

`npm.cmd run setup` installs the root, server, and web lockfiles and generates Prisma Client for a clean checkout.

Set runtime secrets and the database URL through the deployment environment, never through committed files. Apply canonical migrations before starting the application. `db:assert-empty` is a first-initialization safety check and must not be run as an emptiness expectation after the system has been initialized. Enter the temporary password only through hidden interactive prompts and complete the first-login forced-change procedure in `../../../docs/superpowers/runbooks/system-bootstrap-and-super-admin-recovery.md`.

Use the protected `db:reset:test` command only for test databases. Use the backup and restore rehearsal in `../../../docs/superpowers/runbooks/postgresql-backup-restore.md` for recovery validation. Deployment rollback must use PostgreSQL backups and reviewed migration procedures.

## Windows Distribution

`npm.cmd run pkg` is the only portable distribution producer. It builds the web and server applications from fresh output directories and writes the verified runtime tree to `apps/dist/law-firm-system/`. The tree contains `law-firm-system.exe` plus physical `prisma-engine/`, `public/`, and `run/` directories.

Run `npm.cmd run build:zip` to rebuild that tree and create `apps/dist/installer/LawFirmSystem-Portable-1.0.0.zip`. Run `npm.cmd run build:installer` with Inno Setup 6 `iscc` on `PATH` to rebuild the same tree and create the installer. Both distribution commands reject incomplete runtime trees before consuming them.

Configure `DATABASE_URL`, `JWT_SECRET`, and `APP_KEYS` in the launch environment. Start the portable or installed application with `law-firm-system.exe`.
