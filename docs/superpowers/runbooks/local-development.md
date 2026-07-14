# Local Development

Use Node 22 and npm. The following sequence creates a local PostgreSQL 16 baseline and starts the server:

```powershell
Set-Location D:\2_test\16_ChengyeOA\LayerManage\law-firm-system
Copy-Item apps\server\.env.example apps\server\.env
npm.cmd run db:up
npm.cmd run setup
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
npm.cmd run dev:server
```

`Copy-Item` creates the ignored local configuration. Edit only `apps/server/.env`. `db:up` starts the persistent Docker database. `setup` installs locked dependencies and generates Prisma Client. `prisma migrate deploy` applies committed canonical migrations. `db:assert-empty` proves the 22 application models have no rows, then `dev:server` starts the backend.

Do not run seed commands. The empty baseline has no login account. `npm.cmd run db:down` preserves the Docker volume. First organization and administrator creation waits for a separate approved Spec.

For a test reset, set `DATABASE_URL`, `DATABASE_URL_TEST`, and `ALLOW_TEST_DB_RESET=true` for a database whose name ends in `_test`, then run `npm.cmd run db:reset:test` followed by `npm.cmd run db:assert-empty`.
