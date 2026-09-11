# SPEC-006 Identity Security, MFA, Server Sessions, and Step-Up Closeout

> Status: complete. Plan Task 10 remediation, full verification, and operational rehearsals passed.

- Closeout date: 2026-07-22
- Workspace: `D:\2_test\16_ChengyeOA`
- Working mode: existing dirty working tree, in place
- Toolchain: Node.js `22.14.0`, npm `10.9.2`, PostgreSQL 16
- Git policy: no stage, commit, branch, merge, push, PR, or other Git/GitHub write was performed

## Delivered scope

SPEC-006 replaces sessionless authentication with revocable server sessions. Access tokens expire after 15 minutes; sessions have a 30-day absolute lifetime; refresh credentials are opaque, stored only as hashes, rotated on use, and delivered through HttpOnly cookies. CSRF protection binds state-changing cookie-authenticated requests to a readable CSRF cookie and matching header.

The authentication state machine now supports forced password change, mandatory administrator TOTP enrollment, ordinary-user optional MFA, TOTP or recovery-code verification, recovery-code regeneration, MFA disable rules, session listing/revocation, logout-all, and startup refresh recovery without persisting credentials in browser storage.

HIGH and CRITICAL governance create/approve/retry operations require a one-time Step-Up grant bound to user, server session, purpose, and a canonical target digest. Grants are transactionally consumed and are never cached by the Web client. `ADMIN_MFA_RESET` provides two-person governed administrator recovery; a guarded interactive CLI covers sole-super-admin emergencies.

Operational guidance is in `docs/superpowers/runbooks/identity-security-mfa-step-up.md`. Deployment, PostgreSQL backup/restore, bootstrap, and super-admin recovery documentation now covers MFA encryption-key injection, synchronized rollout, session invalidation, recovery codes, rollback, and key-loss consequences.

## Persistence and migration evidence

The guarded test reset applied all nine migrations in order, ending with `20260722010000_step_up_rate_limit`. The canonical Prisma schema contains 40 models. The SPEC-006 migrations add `MfaFactor`, `MfaRecoveryCode`, `AuthChallenge`, `AuthSession`, and `StepUpGrant`, plus persistent per-session Step-Up failure/cooldown state and its database constraint.

The final `db:assert-empty` command reported that every application table was empty.

## Automated verification evidence

All commands used the pinned Node/npm wrapper and the guarded PostgreSQL database whose name ends in `_test`.

- Final real c8 suite: 664 passed, 0 failed.
- Coverage: statements/lines 83.59% (14,374/17,195), branches 83.83% (4,122/4,917), functions 91.18% (1,758/1,928).
- Server lint, typecheck, and production build: passed.
- Server production audit (`--omit=dev --audit-level=high`): exit 0; 0 high, 0 critical, 4 moderate findings in Egg transitive dependencies.
- Web tests: 28 files, 76 passed, 0 failed.
- Web lint: 0 errors; 9 pre-existing `react-hooks/exhaustive-deps` warnings in legacy pages.
- Web typecheck and production build: passed; Vite transformed 3,147 modules.
- Web production audit: 0 vulnerabilities.
- Built-artifact credential leakage scan: passed for server and Web output.
- Final database cleanliness assertion: passed.

The acceptance scenario covers password login → forced password change → TOTP enrollment → TOTP login → refresh rotation → HIGH governance Step-Up → logout/revocation, including audit checks for known temporary credentials.

## Final security-review remediation

- Step-Up now persists five failed attempts per session, enforces a 15-minute cooldown under a row lock, serializes concurrent failures, requires a successful verification to reset the counter, and writes durable redacted rejection/expiry audits.
- Authenticated ordinary users can opt into MFA from account security. Administrators, inactive/locked/forced-change users, invalid sessions, and users with an existing active factor are rejected. Successful enrollment revokes the old password-only session before returning the new MFA session.
- MFA enrollment, TOTP, recovery-code, challenge-expiry, and rate-limit failures write independent redacted audit records without raw codes, factor secrets, challenge tokens, cookies, or authorization values.
- The final independent code review reported no Critical code issue and confirmed the three implementation findings were closed. Its evidence-only objection was resolved by the recorded rehearsals below.

## Operational rehearsal evidence

The emergency CLI rehearsal ran against the fixed local `chengye_oa_test` database with `ALLOW_TEST_DB_RESET=true`. It executed the real `adminMfaResetMain` and `AdminMfaRecoveryService` path, then verified credential version increment, factor disable, recovery-code invalidation, session revocation, `ADMIN_MFA_RESET_RECOVERY` audit persistence, transcript/audit redaction, and final cleanup. Result: PASS.

The PostgreSQL controlled-factor backup/restore rehearsal ran from `2026-07-22T02:21:46.2549017+08:00` to `2026-07-22T02:21:57.0898463+08:00` (10.835 seconds). Dump SHA-256: `8576f9ac986c5812a7281db49a1fdd7c1ef65139dd64842f84b371c44ab56cd0`. The dump restored into the fixed isolated `chengye_oa_restore_test` database; the matching MFA key decrypted the restored controlled factor and validated TOTP. The source fixture was removed, the source database all-table empty assertion passed, and the isolated restore database was dropped. The ignored dump remains under `var/backup` and must not be committed.

## Verification defects corrected during closeout

Closeout exposed and corrected several verification defects rather than suppressing them:

1. Legacy test fixtures were migrated from sessionless JWTs to real `AuthSession` records and verified administrator MFA factors.
2. The production token service no longer exposes legacy refresh, password-change, or sessionless access signers.
3. Repository contracts were updated for 40 Prisma models, CSRF/MFA middleware, and the legitimate authenticated recovery-code route.
4. Strict coverage compilation now type-checks current authorization, governance, CLI, and Prisma test fixtures.
5. `npm run cov` previously reported Mocha `0 passing` because the suite uses `node:test`; it now runs c8 over the real serial test runner.
6. The MFA encryption implementation module was renamed to `mfa-factor-crypto` so conservative secret-file packaging guards remain intact.
7. The leakage scanner distinguishes standalone fixture credentials from protocol names such as `x-csrf-token` and excludes only its own compiled signature list.

## Known non-blocking follow-up

- Web still has 9 legacy Hook dependency warnings outside the SPEC-006 pages.
- Vite reports the main JavaScript chunk at about 1.62 MB before gzip (about 488 kB gzip); future route-level code splitting can reduce it.
- A full development-dependency audit still contains existing non-production advisories. The required production audit has no high or critical findings; do not run forced breaking dependency remediation without a separate reviewed task.

SPEC-006 is closed. No Git/GitHub write was performed.
