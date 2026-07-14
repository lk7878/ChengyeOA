# Server API Baseline

## Runtime Contract

The server runs on Node 22 and uses PostgreSQL 16 through an external `DATABASE_URL`. Prisma schema and migrations are canonical under `apps/server/prisma`.

## Health Endpoint

`GET /api/health` reports the server and database availability without exposing connection details. A healthy response is:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "status": "healthy",
    "database": "available"
  }
}
```

When the database cannot be reached, the endpoint returns status 503 with `service unavailable` and no database internals.

## Baseline Initialization

Operators apply canonical migrations explicitly, then run `npm.cmd run db:assert-empty`. The empty baseline has no account for login. First organization and administrator initialization is outside this API baseline and requires a separate approved Spec.

Test database rebuilds use `npm.cmd run db:reset:test` only with its required `_test` URL and `ALLOW_TEST_DB_RESET=true` guard.
