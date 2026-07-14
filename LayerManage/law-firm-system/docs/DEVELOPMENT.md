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
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
npm.cmd run dev:server
```

Configure the external `DATABASE_URL` only in `apps/server/.env`. `apps/server/prisma` is the canonical schema and migration directory. The baseline creates schema only; it has no login account.

## Test Database

Use a PostgreSQL URL ending in `_test` and set `ALLOW_TEST_DB_RESET=true` before running:

```powershell
npm.cmd run db:reset:test
npm.cmd run db:assert-empty
npm.cmd run verify
```

The reset is intentionally guarded. It recreates only the configured test database and applies canonical migrations. Do not create business records as part of baseline setup. First organization and administrator initialization requires a separate approved Spec.
