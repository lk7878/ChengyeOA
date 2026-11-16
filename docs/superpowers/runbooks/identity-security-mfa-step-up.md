# Identity Security, MFA, Session, and Recovery Runbook

This runbook is the production operating contract for SPEC-006. It covers the MFA encryption key, synchronized rollout, administrator enrollment, recovery codes, governed and emergency MFA reset, backup/restore, rollback, and key-loss response.

## Current interaction policy (2026-11-16)

Login is password-only for all accounts, including administrators and accounts with an existing TOTP factor. First-login / administrator-reset password changes remain mandatory. The legacy `LOCAL_PASSWORD_LOGIN` setting does not control this policy or bypass high-risk checks.

The account menu retains Appearance and adds an in-page Change Password dialog. Changing a personal password verifies the current password, rotates the current device's credentials atomically, invalidates old credentials and outstanding proofs, and logs out all other devices. Device logout is owner-scoped and CSRF-protected; it does not require a factor. Passwords are per account, never shared by role. No periodic password change is imposed.

Ordinary approvals, individual recoverable worksheet record deletion/undo, and moving a directory into the recycle bin do not require TOTP. The existing record batch-delete endpoint is limited to 100 recoverable rows with per-row access checks and undo history. Permanent worksheet destruction, purging a data-bearing directory, permanent attachment deletion and case attachment removal continue to require an effective administrator and a fresh action proof. Empty folder removal and navigation-only menu changes remain excluded. No database-wipe or restore endpoint is added.

The following operations no longer request or consume an authenticator proof:

- Permission administration: role creation, updates, deletion, enable/disable; permission, data-scope, field, worksheet and application authorization; user role and special grants/revocations.
- Personnel administration: account/employee binding, department manager changes, and resetting another account's login password.
- Administrator governance: system administrator grant/revoke/account disable; super-administrator grant/revoke/account disable; administrator MFA reset.
- Business governance: SOP template publication/disable and master-data status correction.
- Operations: manual retry of a failed event delivery.
- Personal factor maintenance: disabling one's own existing factor and regenerating recovery codes.

The existing administrator-only gates and specific permission checks remain. All governed exemptions cover submission, approval and failed-execution retry; their catalog risk, independent review, exact CRITICAL confirmation, target/version checks and audit remain unchanged. Manual event retry remains super-admin-only with the retry permission, current delivery version, quarantine restriction and transactional audit. Existing MFA is still required to maintain that factor. A currently serving administrator still cannot directly disable their own factor. Disabling an ordinary user's factor revokes sessions and recovery codes; regeneration invalidates the old codes. The account-security page retains consequence confirmations, with no authenticator dialog for these maintenance operations.

Exempt governance operation types are explicit, so future HIGH/CRITICAL types remain protected unless deliberately added. Permanent deletion exemptions are not implied by the permission-administration exemptions.

High-risk HTTP proofs bind method, path, and a digest of the body/query; any non-exempt governance proofs continue to bind their operation and version. A proof lasts five minutes and is single use. Validation never substitutes for the original permission, data-scope, review-identity, version, and audit checks. Password-only sessions can verify a concrete action. Administrators can enroll within the pending action dialog and continue without navigating away; a fresh TOTP period is needed after enrollment because replay protection remains enabled.

Personal files currently have no deletion endpoint. Do not label any existing hard-delete operation as recoverable or add destructive maintenance entry points to implement this policy. Ordinary users receive a contact-administrator message for administrator-only actions. Keep the governed and emergency reset restrictions below; after reset, login remains password-only and the next protected high-risk action requires re-enrollment.

## Required Secrets

Production requires `DATABASE_URL`, `JWT_SECRET`, at least two comma-separated `APP_KEYS`, `CORS_ALLOWED_ORIGINS`, and `MFA_ENCRYPTION_KEY_V1`. Generate the MFA key on an approved administrative host without printing or committing the raw bytes:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$mfaKey = [Convert]::ToBase64String($bytes)
# Store $mfaKey directly in the approved secret manager as MFA_ENCRYPTION_KEY_V1.
[Array]::Clear($bytes, 0, $bytes.Length)
$mfaKey = $null
```

`MFA_ENCRYPTION_KEY_V1` must be canonical Base64 decoding to exactly 32 bytes. It is not interchangeable with `JWT_SECRET` or `APP_KEYS`. The application fails closed when the key is missing, malformed, or a production placeholder.

## Synchronized Rollout

1. Take and verify a PostgreSQL backup or storage restore point.
2. Inject the new MFA key into every server instance before starting the reviewed release. Do not log or echo it.
3. Stop old web/server instances so an old frontend cannot continue issuing legacy token requests.
4. Apply the identity-security migration once with `npm.cmd run db:deploy` from `apps/server`.
5. Deploy the server and web artifacts from the same reviewed release.
6. Invalidate all sessions created by the previous release. The new release accepts only server-authoritative sessions with 15-minute access tokens and opaque rotating refresh cookies.
7. Start servers, verify health, then verify login, MFA enrollment, refresh, Step-Up, and logout with controlled accounts.

Do not run old and new authentication contracts side by side. Refresh credentials are HttpOnly, use a strict SameSite cookie, rotate on every refresh, and have a 30-day absolute session lifetime.

## Two-Super-Admin Enrollment Sequence

Keep at least two independently controlled effective `SYSTEM_SUPER_ADMIN` accounts.

1. The first super-admin signs in, completes any forced password change, binds TOTP, saves the ten one-time recovery codes offline, and verifies a fresh login.
2. Use the reviewed second-seat procedure in `system-bootstrap-and-super-admin-recovery.md` if a second effective super-admin does not yet exist.
3. The second super-admin independently signs in, binds a different authenticator, saves a different recovery-code set, and verifies a fresh login.
4. Confirm both can access the administrator-governance catalog. Do not store both authenticators or both recovery-code sets with the same custodian.

An administrator cannot disable their own MFA. Resetting administrator MFA is a CRITICAL governance action requiring another eligible super-admin, exact confirmation, non-self-review, and an audit trail.

## Recovery-Code Handling

- Recovery codes are shown only after enrollment or regeneration and only once.
- Store them offline in the approved credential vault; never put them in tickets, chat, screenshots, URLs, source files, logs, or browser storage.
- Each code is one-time. Regeneration immediately invalidates every prior code.
- Treat a viewed, copied, or potentially exposed code set as compromised and regenerate it from **账号安全** after confirming that the old codes will be invalidated.

## Governed Administrator MFA Reset

Use `ADMIN_MFA_RESET` for normal recovery when another effective super-admin is available. No authenticator code is required to submit, approve or retry this governed reset; the existing independent-review and confirmation requirements still apply. The target must be a different administrator. Approval disables the target factor, invalidates recovery codes, increments credential version, revokes all sessions, and requires re-enrollment before the next high-risk action.

Verify the immutable governance record and the `ADMIN_MFA_RESET` audit before closing the incident. Never include TOTP, MFA, recovery, cookie, authorization, token, or secret fields in the request reason or evidence.

## Emergency CLI Reset

The CLI exists only for the narrow case where exactly one effective super-admin remains and that same operator still knows the account password but has lost all MFA credentials.

```powershell
Set-Location D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\apps\server
npm.cmd run admin-mfa:reset
$resetExit = $LASTEXITCODE
if ($resetExit -ne 0) { throw "Administrator MFA reset failed with exit $resetExit" }
```

The command uses hidden password input and requires the exact phrase:

```text
RESET ADMIN MFA <databaseName> <normalizedUsername>
```

It fails closed when zero or multiple effective super-admins exist, the target is missing/disabled/locked, the password is wrong, the database confirmation is wrong, or audit persistence fails. Success revokes every session; the next high-risk action requires fresh MFA enrollment. Record only the sanitized command reference and audit identity.

For an isolated non-production rehearsal of the same CLI orchestration and real recovery service path, use only the fixed local `chengye_oa_test` target:

```powershell
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:DATABASE_URL=$env:DATABASE_URL_TEST
$env:ALLOW_TEST_DB_RESET='true'
npm.cmd --prefix apps/server run rehearse:admin-mfa-reset
```

The rehearsal creates a disposable sole super-admin, runs `adminMfaResetMain`, verifies factor/recovery/session/credential/audit postconditions, checks transcript redaction, and truncates application data in `finally`.

## Backup and Restore

Database backups do **not** contain `MFA_ENCRYPTION_KEY_V1`. Back up the database and the versioned secret-manager entry as separate controlled assets. A restore cannot validate high-risk TOTP actions until the exact key version that encrypted its factors is injected into the restored environment.

For every restore rehearsal:

1. Restore PostgreSQL into the approved isolated target.
2. Inject the matching MFA key from the secret manager before application startup.
3. Deploy the same or a backward-compatible application release.
4. Verify a controlled factor can decrypt and validate TOTP without exposing its secret.
5. Rotate test sessions and remove the isolated secret injection after the rehearsal.

The controlled-factor helper `npm.cmd --prefix apps/server run rehearse:backup-factor -- prepare|verify|cleanup` is guarded by `ALLOW_BACKUP_REHEARSAL=true`, fixed local database names, and the matching `MFA_ENCRYPTION_KEY_V1`. Use it only as part of the PostgreSQL runbook to prove that a restored encrypted factor decrypts and validates a TOTP code before cleaning the source fixture and dropping the isolated restore database.

## Key Loss

Loss of `MFA_ENCRYPTION_KEY_V1` makes existing encrypted TOTP factors unrecoverable. Do not generate a replacement under the same version and do not attempt database edits to fabricate factors.

1. Stop authentication writes and preserve a forensic database backup.
2. Recover the exact key from the approved secret-manager backup.
3. If the exact key cannot be recovered, declare all existing factors unusable, revoke all sessions, and execute a reviewed mass re-enrollment plan using governed resets or the narrow CLI recovery path for the sole super-admin.
4. Record the incident without factor secrets, recovery codes, tokens, or connection strings.

## Rollback

Rollback is a coordinated application-and-database recovery, not a frontend-only downgrade. Stop traffic, restore the pre-release PostgreSQL restore point, restore the corresponding application release and secret versions, and revoke credentials issued during the failed rollout. Never run the legacy authentication frontend against the SPEC-006 database schema. If migration rollback cannot preserve factor/session integrity, keep the service stopped and escalate for a reviewed restore.
