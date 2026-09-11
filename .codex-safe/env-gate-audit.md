# Event Center production zero-connection gate audit

Scope: local static review of the server environment loader, package scripts, and deployment runbook. No production command, network, database, preflight, drain, or canary action was run. This record deliberately contains only variable names and presence/equality conditions.

## Result

The zero-connection production Boolean gate has **2 items**. Evaluate both before any production command is started:

1. `NODE_ENV` must be present and exactly equal to `production`.
2. `EVENT_WORKER_ENABLED` must be present and exactly equal to `false` during the non-activating rollout phase. The loader accepts only exact `true` or `false`; it rejects an absent or other value in production. Change it to exactly `true` only for the separately authorized, controlled single-worker canary start.

The gate should fail closed. In particular, it must not infer the Worker state from an omitted value, a truthy value, or `EGG_SERVER_ENV`.

Current rollout disposition: **BLOCKED**. The coordinating gate reports zero established variables in scope; no values are recorded here. Do not begin any production command until every required gate condition is independently established.

## Related production configuration presence checks

These are not Boolean-gate items, but the local production environment loader requires them before application configuration can load:

- `DATABASE_URL`: present.
- `JWT_SECRET`: present.
- `APP_KEYS`: present.
- `MFA_ENCRYPTION_KEY_V1`: present.
- `CORS_ALLOWED_ORIGINS`: present for production configuration.

`EGG_SERVER_ENV` is not a production Boolean-gate input. The event-observability threshold variables are optional configuration inputs with loader defaults, rather than required Boolean-gate inputs.

## Fixed runtime verification (no output, no connection)

Run this before a production command. It checks only local executable version strings, emits no values, and exits nonzero on any mismatch:

```powershell
$nodeVersion = (& node --version 2>$null).Trim()
$npmVersion = (& npm --version 2>$null).Trim()
if ($nodeVersion -cne 'v22.14.0' -or $npmVersion -cne '10.9.2') { exit 1 }
```

## Evidence summary

- The package declares the Node 22 major line; the requested exact Node and npm versions therefore need the explicit local gate above.
- The deployment runbook starts an Event Center release with the Worker disabled, then enables one Worker for the controlled canary.
- No dedicated zero-connection package script was found. Use the Boolean gate and runtime gate as a hard prerequisite outside any command that could initialize application or database access.
