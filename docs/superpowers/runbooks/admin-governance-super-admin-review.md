# Administrator Governance and Super-Admin Review

This runbook covers SPEC-005 administrator governance after the SPEC-002 trust root and SPEC-004 authorization model are available. It applies to reviewed system-administrator and super-administrator account changes and the explicitly whitelisted master-data corrections. It does not authorize direct database edits, role-table writes, deletion of history, or bypassing independent review.

## Safety and prerequisites

- Use the reviewed release, Node.js `22.14.0`, npm `10.9.2`, PostgreSQL 16, and approved runtime secrets.
- Take and verify a PostgreSQL backup or storage snapshot before migration or emergency recovery. Follow `postgresql-backup-restore.md`.
- Keep `DATABASE_URL`, `JWT_SECRET`, `APP_KEYS`, passwords, tokens, payload hashes, and raw sensitive values out of commands, screenshots, tickets, and shared logs.
- Confirm there are two independent, enabled `SYSTEM_SUPER_ADMIN` users before routine governance begins. The requester and reviewer must be different people.
- Never use `db:reset:test`, the browser fixture, Prisma Studio, direct SQL role updates, or manual audit rows in production.
- Treat `FAILED`, `FLAGGED`, `STALE_TARGET_VERSION`, payload-integrity errors, and last-seat protection as stop-and-investigate outcomes. Do not auto-replay an old request.

Run project commands from `LayerManage/law-firm-system` with the pinned toolchain:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run <script>
```

## Migration deployment

1. Confirm the reviewed release, maintenance window, backup, database target, release owner, reviewer, and rollback owner.
2. Load the approved environment without printing any secret or connection string.
3. Inspect and deploy migrations:

```powershell
Push-Location apps\server
try {
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- prisma migrate status
} finally {
  Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw "Migration status failed" }

npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:deploy
if ($LASTEXITCODE -ne 0) { throw "Migration deployment failed" }
```

4. Start the server and web application. Verify health, login, `/security/admin-governance`, the operation catalog, My Requests, and Pending Review with non-production test records or read-only checks.
5. Confirm direct user and role endpoints still reject protected system-role mutations.

## First system bootstrap and first login

On a genuinely empty application database, follow `system-bootstrap-and-super-admin-recovery.md`. The command sequence is:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:assert-empty
if ($LASTEXITCODE -ne 0) { throw "Target is not empty; stop" }
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run system:bootstrap
if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }
```

The interactive prompts are `Root organization name`, `Super-admin username`, hidden `Temporary password`, hidden confirmation, and `INITIALIZE <database-name>`. Complete the forced password change in the browser before creating the second seat. Never record either password.

## SPEC-002 credential recovery

Use credential recovery only for the first super-admin identified by `SystemInitialization.PRIMARY`; it does not create a second seat or change roles.

```powershell
try {
  $env:ALLOW_SUPER_ADMIN_RECOVERY = 'true'
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run super-admin:recover
  $recoveryExit = $LASTEXITCODE
} finally {
  Remove-Item Env:ALLOW_SUPER_ADMIN_RECOVERY -ErrorAction SilentlyContinue
}
if ($recoveryExit -ne 0) { throw "Credential recovery failed: $recoveryExit" }
```

The CLI prompts for the first-super-admin username, hidden temporary password and confirmation, a 10-to-500-character reason, and `RECOVER <database-name> <normalized-username>`. Verify the environment gate is removed, old sessions fail, forced password change succeeds, and the recovery audit exists.

## Establish the independent second seat

This is a one-time deadlock-recovery exception and works only while exactly one effective super-admin exists. Create the target as an enabled ordinary user first; do not grant it a system role directly.

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run super-admin:add-second
$secondSeatExit = $LASTEXITCODE
if ($secondSeatExit -ne 0) { throw "Second-seat recovery failed: $secondSeatExit" }
```

The prompts are `Current super-admin username`, hidden `Current super-admin password`, `Second super-admin username`, a 10-to-500-character recovery reason, and `ADD SECOND SUPER ADMIN <database-name> <normalized-target-username>`. Exit `7` means the one-seat recovery window is unavailable; stop rather than modifying role rows. Verify two effective seats and the `SUPER_ADMIN_SECOND_SEAT_RECOVERY` audit, then use normal governance for all later grants or revocations.

## Normal administrator grant and revoke

1. Requester A signs in as a super-admin and opens `/security/admin-governance`.
2. Open Create operation and choose `SYSTEM_ADMIN_GRANT` or `SYSTEM_ADMIN_REVOKE`.
3. Select the user from the governance target list. The page obtains the safe current governance version; do not guess or edit it in SQL.
4. Enter a specific operational reason. For a grant, set an expiry only when the approved assignment is temporary. Submit once and record only the operation number.
5. Confirm the target role has not changed while the request is `PENDING_REVIEW`.
6. Reviewer B signs in as a different super-admin, opens Pending Review, inspects target, reason, immutable payload, version, and timeline, then approves, rejects with a comment, or flags with a comment.
7. Verify `SUCCEEDED` before treating the role change as effective. Re-authenticate the target user to confirm the server-side authorization context changed.

The requester cannot self-review. A `SYSTEM_ADMIN` can create allowed master-data requests and see its own requests, but cannot review, retry, see all operations, or mutate system roles directly.

Super-admin grant, revoke, and disable operations are `CRITICAL`. The create form displays the exact confirmation `CONFIRM <database-name> <operation-type> <target-username>`. Type it manually after verifying all four components; never paste a password or token into the confirmation field.

## Master-data corrections

- `MASTER_DATA_STATUS_CORRECTION` is high-risk PRE review: no business mutation occurs before independent approval.
- `MASTER_DATA_METADATA_CORRECTION` is low-risk POST review and accepts exactly one field: Organization `sort`, Position `responsibilities`, or ProfessionalTeam `description`. It executes first, then remains `PENDING_POST_REVIEW` for review.
- Employee status and all other fields are outside this adapter. Use the owning master-data workflow.
- On `STALE_TARGET_VERSION`, reload the target, compare the intervening change, and create a new operation with a new idempotency key only if the intent is still valid.

## Failed operation resume

1. Open the failed detail and record the operation number, stable result code, attempt number, and sanitized timestamps. Do not copy raw snapshots into a ticket.
2. Resolve the external cause without altering the operation, payload hash, target version, review, execution, or audit rows.
3. A super-admin verifies that the operation is retryable and that its target and approved intent remain valid.
4. Use Retry once. The service resumes only an approved operation that has no successful mutation and serializes concurrent attempts.
5. Verify a new execution attempt and final `SUCCEEDED`. If retry returns a version or integrity conflict, stop and create a new reviewed compensating operation instead.

Never retry by resubmitting HTTP traffic, editing status to `APPROVED`, deleting an execution, or reusing an idempotency key with different content.

## Audit lookup

Prefer the governance detail timeline. For incident investigation, use an approved read-only PostgreSQL console and select only stable fields:

```sql
SELECT "operationNo", "operationType", "riskLevel", "reviewMode", "status",
       "requesterUserId", "targetType", "targetId", "version", "createdAt", "updatedAt"
FROM "admin_operation"
WHERE "operationNo" = '<approved-operation-number>';

SELECT "operationId", "reviewerUserId", "decision", "operationVersion", "createdAt"
FROM "admin_operation_review"
WHERE "operationId" = '<operation-id>'
ORDER BY "createdAt";

SELECT "operationId", "attemptNo", "executorType", "status", "resultCode", "startedAt", "finishedAt"
FROM "admin_operation_execution"
WHERE "operationId" = '<operation-id>'
ORDER BY "attemptNo";

SELECT "action", "targetType", "targetId", "userId", "createdAt"
FROM "operation_log"
WHERE "targetId" = '<operation-id>'
ORDER BY "createdAt";
```

Do not select or share payload snapshots, before/after snapshots, error text, credential fields, or connection details unless the incident procedure specifically authorizes a protected review.

## Rollback by explicit compensation

There is no delete or history rewrite. To reverse a successful governance action:

1. Preserve the original operation and audit trail.
2. Re-read the current target and assess downstream effects.
3. Create the inverse operation, such as grant versus revoke, enable versus disable, or a whitelisted metadata correction back to the approved value.
4. Give the compensating request a new reason, current target version, and new idempotency key; reference the original operation number in the approved change record.
5. Complete independent review and verify both timelines. Never directly restore an old database row or snapshot over newer state.

## Emergency stop and incident response

For suspected privilege escalation, payload tampering, audit failure, duplicate execution, wrong target, or trust-root inconsistency:

1. Stop new governance submissions and reviews. If active exploitation is suspected, stop the application write service through the approved service manager or network control; do not stop PostgreSQL before evidence is preserved.
2. Keep recovery gates unset. Do not run bootstrap, reset, fixture, retry, or direct repair commands.
3. Preserve sanitized application logs, operation numbers, timestamps, release identity, and a forensic backup or snapshot.
4. Use read-only checks to verify effective super-admin count, system-admin grants, target versions, reviews, executions, operation logs, and migration state.
5. Revoke compromised access only through an independently reviewed safe path. The last effective super-admin is protected; do not bypass that invariant.
6. Resume service only after a reviewed incident assessment and explicit repair or compensating plan. Record restored invariants and audit evidence.

## Post-change checklist

- Two independent effective super-admin seats remain, including the initialized trust-root user.
- Requester and reviewer differ, and every successful PRE operation has a review before its execution.
- Every POST operation has exactly one business mutation and a visible post-review state.
- No failed execution leaves a partial business change or successful status.
- System administrators lack review, retry, global governance-read, and direct system-role mutation capability.
- Audit and screenshots contain no password, token, connection string, credential version field, or raw sensitive value.
- The operation timeline, effective authorization, and target version agree after the change.
