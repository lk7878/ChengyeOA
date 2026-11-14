> 历史接口说明：当前以 [统一API入口](../../../docs/API_SPEC.md) 及其现行清单/契约为准；下列旧审批、角色或字段说明不覆盖2026-11-06的实现。

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

## System Initialization Boundary

System initialization and first-super-admin recovery are interactive operator CLI workflows. There is no HTTP initialization, reinitialization, or recovery endpoint. From the project root, operators use `npm.cmd run db:deploy`, `npm.cmd run db:assert-empty`, and `npm.cmd run system:bootstrap` as documented in the operator runbook.

Test database rebuilds use `npm.cmd run db:reset:test` only with its required `_test` URL and `ALLOW_TEST_DB_RESET=true` guard.

## Login

`POST /api/v1/auth/login` accepts:

```json
{
  "username": "operator-entered-username",
  "password": "<redacted>"
}
```

A user who must replace a temporary password receives only the password-change result. No access token, refresh token, permissions, or business data is returned:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "mode": "PASSWORD_CHANGE_REQUIRED",
    "passwordChangeToken": "<redacted>",
    "expiresIn": 300
  }
}
```

A user with a completed password change receives the authenticated result:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "mode": "AUTHENTICATED",
    "token": "<redacted>",
    "refreshToken": "<redacted>",
    "expiresIn": 604800,
    "user": {
      "id": "<redacted>",
      "username": "operator-entered-username",
      "name": "operator-entered-username",
      "roles": [],
      "permissions": []
    }
  }
}
```

Invalid credentials, disabled users, locked users, and stale credentials return HTTP `401` with `message: "AUTHENTICATION_FAILED"` without disclosing whether the account exists.

## Forced Initial Password Change

`POST /api/v1/auth/password/forced-change` requires `Authorization: Bearer <password-change-token>`. Access and refresh tokens are not accepted. The request body is:

```json
{
  "password": "<redacted>",
  "confirmation": "<redacted>"
}
```

Success returns HTTP `200` and `{ "code": 200, "message": "success", "data": null }`. It does not issue a normal session; the client must discard the password-change token and require a new login.

Stable errors are:

| HTTP status | `message` | Meaning |
| --- | --- | --- |
| `400` | `PASSWORD_INVALID` | The values do not match or the new password fails policy. |
| `400` | `PASSWORD_REUSED` | The new password matches the temporary password. |
| `401` | `TOKEN_INVALID` | The token is missing, malformed, expired, or otherwise invalid. |
| `401` | `TOKEN_TYPE_INVALID` | The bearer token is not a password-change token. |
| `401` | `AUTHENTICATION_FAILED` | The user or credential version is no longer eligible for forced change. |
