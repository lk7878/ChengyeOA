# Database Baseline

The application uses PostgreSQL 16. `apps/server/prisma/schema.prisma` and its committed migrations are the sole database definition.

## Configuration

`DATABASE_URL` is an external PostgreSQL connection string. Local development stores it only in the ignored `apps/server/.env`; CI and deployment provide it through their environment.

## Migration and Verification

```powershell
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
```

The assertion counts every one of the 22 Prisma application models. `_prisma_migrations` is migration metadata and is not an application table.

## Test Reset

`npm.cmd run db:reset:test` is allowed only with a PostgreSQL URL whose database name ends in `_test` and `ALLOW_TEST_DB_RESET=true`. Follow every reset with `npm.cmd run db:assert-empty`.

The baseline does not initialize an account or business records. Schema changes require a committed Prisma migration. Data initialization requires a separate approved Spec.
