# System Bootstrap and Super-Admin Recovery

This runbook covers the one-time trust-root bootstrap and emergency recovery of the first super-admin. Both are interactive CLI operations. The application exposes no HTTP initialization, reinitialization, or super-admin recovery endpoint.

## Safety Rules

- Use Node `22.14.0`, PostgreSQL 16, the reviewed release, and an interactive PowerShell terminal.
- Keep `DATABASE_URL`, `JWT_SECRET`, and `APP_KEYS` in the approved runtime secret system. Do not commit them.
- Never put a real password in command arguments, environment variables, redirected input, screenshots, tickets, logs, shell transcripts, or audit notes.
- Do not capture secret-bearing screenshots. Redact tokens, user IDs, hostnames, database names, and connection details from tickets and shared logs.
- Do not use bootstrap or recovery as a seed, migration, startup hook, routine password reset, or data repair mechanism.
- Before a production bootstrap or recovery, take a PostgreSQL backup or storage snapshot and verify the approved restore procedure in `postgresql-backup-restore.md`.

Run all commands from `LayerManage/law-firm-system`. Confirm the working directory with:

```powershell
(Get-Location).Path
node --version
```

## One-Time Bootstrap

1. Load the approved runtime environment without printing it. Do not run commands that echo `DATABASE_URL`.
2. Deploy the reviewed migrations and prove the application tables are empty:

```powershell
npm.cmd run db:deploy
if ($LASTEXITCODE -ne 0) { throw "Migration deployment failed with exit $LASTEXITCODE" }
npm.cmd run db:assert-empty
if ($LASTEXITCODE -ne 0) { throw "Database is not an empty bootstrap target; stop and investigate" }
```

3. Start the interactive bootstrap:

```powershell
npm.cmd run system:bootstrap
$bootstrapExit = $LASTEXITCODE
```

The CLI prints only a redacted target in `host:port/database` form. Verify it against the approved change record before entering any values. It prompts, in order, for `Root organization name`, `Super-admin username`, hidden `Temporary password`, hidden confirmation, and the exact phrase `INITIALIZE <database-name>`.

Do not continue if the redacted target is wrong. Do not paste terminal output containing operational identifiers into a ticket without redaction.

4. Confirm `$bootstrapExit -eq 0`. A second bootstrap must return `3` and must not write data:

```powershell
npm.cmd run system:bootstrap
if ($LASTEXITCODE -ne 3) { throw "Expected already-initialized exit 3; investigate before continuing" }
```

## First Login

1. Start the server and web application in separate terminals that inherit the approved runtime environment.
2. Sign in with the bootstrap username and temporary password.
3. Confirm the application opens only the forced-password-change page and does not expose business pages.
4. Enter a new policy-compliant password through the password fields. The change endpoint returns no access or refresh token.
5. Confirm the application returns to login, then sign in again with the new password.
6. Confirm the temporary password no longer works and the new login opens the authenticated application.

The password-change token is valid for five minutes and belongs only in browser memory. Never place it in storage, a URL, a screenshot, a ticket, or a log.

## Emergency Recovery

Recovery is only for the first super-admin identified by `SystemInitialization.PRIMARY`. It cannot create an account, recover another user, change roles, or repair inconsistent data.

1. Confirm the incident, approved operator, backup or snapshot, redacted database target, first-super-admin username, and a 10-to-500-character recovery reason.
2. Enable the gate only around the interactive command and guarantee immediate cleanup:

```powershell
try {
  $env:ALLOW_SUPER_ADMIN_RECOVERY = 'true'
  npm.cmd run super-admin:recover
  $recoveryExit = $LASTEXITCODE
} finally {
  Remove-Item Env:ALLOW_SUPER_ADMIN_RECOVERY -ErrorAction SilentlyContinue
}
if ($recoveryExit -ne 0) { throw "Recovery failed with exit $recoveryExit; the gate is disabled, investigate before retrying" }
```

The CLI prints the redacted target, then prompts for the super-admin username, hidden temporary password and confirmation, recovery reason, and exact phrase `RECOVER <database-name> <normalized-username>`. Recovery must force another password change, clear the login lock, increment the credential version, invalidate old access and refresh tokens, and write an audit event.

3. Verify `ALLOW_SUPER_ADMIN_RECOVERY` is absent immediately after the command:

```powershell
if (Test-Path Env:ALLOW_SUPER_ADMIN_RECOVERY) { throw "Recovery gate is still enabled" }
```

4. Verify an old token fails. Complete login, forced change, and re-login with the recovered account. Never record either temporary or replacement password.

## Exit Codes

| Exit | Meaning | Operator action |
| --- | --- | --- |
| `0` | Success | Verify audit and continue with first login or incident closure. |
| `2` | Invalid input, non-TTY execution, arguments, or confirmation | Correct the operator input; no data should be written. |
| `3` | System already initialized | Stop. Do not retry as a write or attempt reinitialization. |
| `4` | Inconsistent database state | Stop and follow the investigation procedure below. |
| `5` | Database connection or migration state error | Repair connectivity or migration state before a reviewed retry. |
| `6` | Recovery gate is not exactly `true` | Confirm authorization; do not make the gate persistent. |
| `70` | Unexpected internal error | Preserve the reference ID, redact shared evidence, and investigate before retrying. |

Commands never auto-retry writes. Check `$LASTEXITCODE` after each invocation.

## Audit Verification

Use an approved read-only PostgreSQL console. Do not include connection strings or query output with operational identifiers in tickets. Query each required action separately:

```sql
SELECT "action", "targetType", "targetId", "userId", "createdAt"
FROM "operation_log"
WHERE "action" = 'SYSTEM_BOOTSTRAP'
ORDER BY "createdAt" DESC;

SELECT "action", "targetType", "targetId", "userId", "createdAt"
FROM "operation_log"
WHERE "action" = 'FORCED_PASSWORD_CHANGE'
ORDER BY "createdAt" DESC;

SELECT "action", "targetType", "targetId", "userId", "createdAt"
FROM "operation_log"
WHERE "action" = 'SUPER_ADMIN_RECOVERY'
ORDER BY "createdAt" DESC;
```

Bootstrap and recovery rows have a null `userId`; forced change uses the target user ID. Audit data must not contain passwords, hashes, tokens, environment values, full database URLs, or raw exception stacks.

## Inconsistent-State Investigation

On exit `4`, or when the singleton and application data disagree:

1. Stop bootstrap/recovery attempts and keep the recovery gate disabled.
2. Do not delete, overwrite, seed, force, or manually synthesize `SystemInitialization` or audit rows.
3. Preserve the command reference ID and sanitized output. Take a new forensic backup or snapshot before investigation.
4. Inspect migration state without applying changes; do not use an interactive Prisma reset or migration CLI:

```powershell
Push-Location apps\server
try { npx.cmd prisma migrate status } finally { Pop-Location }
```

5. In an approved read-only PostgreSQL console, inspect the singleton and recent security audits:

```sql
SELECT "id", "version", "rootOrganizationId", "superAdminUserId", "completedAt"
FROM "system_initialization";

SELECT "action", "targetType", "targetId", "userId", "createdAt"
FROM "operation_log"
WHERE "action" IN ('SYSTEM_BOOTSTRAP', 'FORCED_PASSWORD_CHANGE', 'SUPER_ADMIN_RECOVERY')
ORDER BY "createdAt" DESC;
```

6. Compare the database with the approved backup, migration history, deployment record, and application logs. Escalate for a reviewed data-repair plan; there is no `--force`, HTTP repair, or automatic cleanup path.

## Production Boundary

MFA is not implemented by SPEC-002. Bootstrap and recovery may be accepted in local and controlled test environments, but first-super-admin login is not a complete production security capability until the separate identity-security work implements and accepts MFA. Production enablement requires that gate in addition to this runbook.
