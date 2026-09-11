# Development

## Requirements

- Node 22
- npm
- Docker with PostgreSQL 16

## Local Baseline

```powershell
Copy-Item apps\server\.env.example apps\server\.env
npm.cmd run db:up
npm.cmd run setup
npm.cmd run db:deploy
npm.cmd run db:assert-empty
npm.cmd run system:bootstrap
npm.cmd run dev:server
```

Configure the external `DATABASE_URL` only in `apps/server/.env`. `apps/server/prisma` is the canonical schema and migration directory. On a new empty database, deploy migrations, prove all application tables are empty, and run the interactive bootstrap exactly once. Enter the temporary password only through the hidden terminal prompts. Follow the first-login forced-change flow in `../../../docs/superpowers/runbooks/system-bootstrap-and-super-admin-recovery.md`.

For local development without authenticator enrollment, set `LOCAL_PASSWORD_LOGIN=true`
in `apps/server/.env` and restart the backend. This requires `NODE_ENV=development`
and a loopback PostgreSQL host. Password validation, forced password changes, login
lockouts, sessions and role permissions still apply. It skips MFA during login and
the administrator MFA guard; sensitive operations with step-up verification still
require MFA. The default is `false`, and enabling it outside local development
causes startup to fail. Restore `false` and restart to require MFA again.

## Test Database

Use a PostgreSQL URL ending in `_test` and set `ALLOW_TEST_DB_RESET=true` before running:

```powershell
npm.cmd run db:reset:test
npm.cmd run db:assert-empty
npm.cmd run verify
```

The reset is intentionally guarded. It recreates only the configured test database and applies canonical migrations. Do not create business records as part of baseline setup. Run interactive bootstrap only when a test scenario explicitly needs an initialized trust root, and reset the test database afterward.
