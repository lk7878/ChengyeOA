# Identity Security, MFA, and Step-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SPEC-006 with administrator-mandatory TOTP, server-side challenges and sessions, rotating refresh credentials, purpose-bound one-time step-up grants, governed MFA recovery, and an in-memory web authentication flow.

**Architecture:** Keep short-lived access JWTs, but make `AuthSession` the authority for every authenticated request and use opaque hashed refresh credentials. Store TOTP factors encrypted with AES-256-GCM, track replay counters in PostgreSQL transactions, and model temporary authentication work as hashed `AuthChallenge` records. Protect high-risk mutations with a short-lived `StepUpGrant` consumed inside the same transaction as the protected write.

**Tech Stack:** Node.js 22, TypeScript, Egg.js 3, Prisma 5/PostgreSQL, Node `crypto`, bcryptjs, jsonwebtoken, React 19, Zustand 5, Axios 1, Ant Design 6, Vitest, Node test runner, Playwright, `qrcode@1.5.4`, `@types/qrcode@1.5.6`.

## Global Constraints

- `SYSTEM_SUPER_ADMIN` and `SYSTEM_ADMIN` must use TOTP; ordinary users may opt in.
- TOTP is RFC 6238 SHA-1, 6 digits, 30-second periods, with a ±1 period verification window.
- Access tokens expire after 15 minutes; server sessions expire after an absolute 30 days.
- MFA enrollment tokens expire after 10 minutes; verification and password-change challenges expire after 5 minutes.
- An authentication challenge allows at most 5 failures and then imposes a 15-minute cooldown.
- Step-up grants expire after 5 minutes and bind user, session, purpose, and server-canonicalized target digest.
- TOTP secrets use AES-256-GCM and a decoded 32-byte `MFA_ENCRYPTION_KEY_V1`.
- Authentication secrets and temporary credentials never enter logs, URLs, governance snapshots, Zustand persistence, or browser `localStorage`.
- Preserve the dirty worktree and perform no Git/GitHub writes: no stage, commit, branch, merge, push, PR, or remote mutation.
- Follow TDD for every task: add the focused failing test, observe the expected failure, implement the minimum behavior, then run focused and regression tests.

---

## File Structure

### Server files to create

- `apps/server/app/domain/security/base32.ts`: RFC 4648 Base32 encode/decode used by TOTP and enrollment.
- `apps/server/app/domain/security/totp-service.ts`: TOTP generation, verification-window selection, and otpauth URI construction.
- `apps/server/app/domain/security/mfa-secret-crypto.ts`: versioned AES-256-GCM encryption/decryption.
- `apps/server/app/domain/security/opaque-token.ts`: cryptographically random token generation and SHA-256 hashing.
- `apps/server/app/domain/security/step-up-target.ts`: purpose catalog and canonical target digest construction.
- `apps/server/app/application/auth/auth-challenge-service.ts`: hashed challenge lifecycle, failure count, and cooldown.
- `apps/server/app/application/auth/mfa-service.ts`: enrollment, verification, recovery codes, status, disable, and reset primitives.
- `apps/server/app/application/auth/session-service.ts`: session creation, authentication, refresh rotation/reuse response, listing, and revocation.
- `apps/server/app/application/auth/step-up-service.ts`: TOTP re-verification and one-time grant creation/consumption.
- `apps/server/app/middleware/csrf.ts`: trusted-Origin and double-submit CSRF enforcement for cookie-backed auth mutations.
- `apps/server/app/application/system/admin-mfa-recovery-service.ts`: CLI transaction for last-resort administrator MFA reset.
- `apps/server/scripts/system/reset-admin-mfa.ts`: interactive emergency recovery entry point.
- `apps/server/test/security/base32.test.ts`, `totp-service.test.ts`, `mfa-secret-crypto.test.ts`, `opaque-token.test.ts`, `step-up-target.test.ts`.
- `apps/server/test/auth/auth-challenge-service.test.ts`, `mfa-service.test.ts`, `session-service.test.ts`, `step-up-service.test.ts`.
- `apps/server/test/app/mfa-api.test.ts`, `session-api.test.ts`, `step-up-api.test.ts`.
- `apps/server/test/system/admin-mfa-recovery-service.test.ts`.
- `apps/server/test/acceptance/spec-006-acceptance.test.ts`.
- `apps/server/prisma/migrations/20260721230000_identity_security_mfa_step_up/migration.sql`.

### Server files to modify

- `apps/server/prisma/schema.prisma`: add factor, recovery-code, challenge, session, and step-up models and user relations.
- `apps/server/config/env.ts`, `.env.example`, `config/config.default.ts`: validate and expose MFA/session/CSRF settings.
- `apps/server/app/domain/security/token-service.ts`: access-only JWT with `sid`, `amr`, and 15-minute expiry.
- `apps/server/app/domain/security/security-errors.ts`: SPEC-006 error codes.
- `apps/server/app/application/auth/authentication-service.ts`: explicit login state machine and password-change continuation.
- `apps/server/app/application/auth/authentication-factory.ts`: construct focused authentication services with shared dependencies.
- `apps/server/app/middleware/auth.ts`: require active server session and enforce administrator MFA.
- `apps/server/app/controller/auth.ts`, `apps/server/app/router.ts`: publish MFA, session, refresh, logout, and step-up endpoints.
- `apps/server/app/application/admin-governance/governance-command-service.ts`: consume step-up on HIGH/CRITICAL creation.
- `apps/server/app/application/admin-governance/governance-review-service.ts`: consume step-up on HIGH/CRITICAL approval.
- `apps/server/app/application/admin-governance/governance-execution-runner.ts` and governance controller/factory: consume step-up on protected retries.
- `apps/server/app/domain/admin-governance/governance-types.ts`, `operation-catalog.ts`, validators and administrator adapter: add `ADMIN_MFA_RESET`.
- `apps/server/package.json`: add `admin-mfa:reset` and focused SPEC-006 scripts if needed.
- Existing authentication, governance, recovery, build-security, and migration-contract tests: update contracts without weakening old assertions.

### Web files to create

- `apps/web/src/features/auth/types.ts`: discriminated authentication response types and MFA/session views.
- `apps/web/src/features/auth/runtime-session.ts`: module-memory access token, CSRF token, and refresh single-flight.
- `apps/web/src/features/auth/challengeStore.ts`: non-persisted password-change/MFA temporary state.
- `apps/web/src/features/auth/components/MfaEnrollment.tsx`: QR, manual key, confirmation, and recovery-code acknowledgement.
- `apps/web/src/features/auth/components/MfaChallenge.tsx`: TOTP/recovery-code verification.
- `apps/web/src/features/auth/components/StepUpDialog.tsx`: reusable purpose-bound TOTP dialog.
- `apps/web/src/features/auth/useStepUp.ts`: verify then immediately invoke protected mutation.
- `apps/web/src/pages/SecuritySettings/index.tsx`: MFA status, recovery codes, and active sessions.
- Matching Vitest files for each runtime store/component/page.

### Web files to modify

- `apps/web/package.json` and lockfile: add QR generation dependencies.
- `apps/web/src/api/auth.ts`: new state-machine, MFA, sessions, CSRF, and step-up API methods.
- `apps/web/src/api/request.ts`: memory Authorization, credentialed cookies, refresh single-flight, and SPEC-006 error handling.
- `apps/web/src/stores/authStore.ts`: remove token persistence and expose bootstrap/clear state actions.
- `apps/web/src/pages/Login/index.tsx`: password → enrollment/challenge state machine.
- `apps/web/src/pages/PasswordChange/index.tsx`: continue into MFA or authenticated state after password change.
- `apps/web/src/pages/AdminGovernance/index.tsx`: wrap protected create/approve/retry mutations with step-up.
- `apps/web/src/App.tsx` and main layout navigation: session bootstrap and security settings route.
- Existing web auth, login, password-change, request, app, and governance tests.

---

### Task 1: Security Primitives and Fail-Closed Configuration

**Files:**
- Create the five server domain files and five matching tests listed above.
- Modify `apps/server/config/env.ts`, `.env.example`, `config/config.default.ts`, `apps/server/app/domain/security/security-errors.ts`.

**Interfaces:**
- Produces:

```ts
export interface TotpMatch { counter: bigint; drift: -1 | 0 | 1 }
export class TotpService {
  generateSecret(bytes?: number): string;
  buildUri(input: { issuer: string; accountName: string; secret: string }): string;
  verify(secret: string, code: string, now: Date, lastAcceptedCounter?: bigint | null): TotpMatch | null;
}

export interface EncryptedMfaSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: 1;
}
export class MfaSecretCrypto {
  constructor(keys: ReadonlyMap<number, Buffer>);
  encrypt(secret: string): EncryptedMfaSecret;
  decrypt(value: EncryptedMfaSecret): string;
}

export function createOpaqueToken(bytes?: number): string;
export function hashOpaqueToken(token: string): string;

export type StepUpPurpose =
  | 'ADMIN_GOVERNANCE_CREATE' | 'ADMIN_GOVERNANCE_APPROVE' | 'ADMIN_GOVERNANCE_RETRY'
  | 'MFA_DISABLE_SELF' | 'MFA_RECOVERY_CODES_REGENERATE' | 'ADMIN_MFA_RESET'
  | 'SESSION_REVOKE' | 'SESSION_REVOKE_ALL';
export function digestStepUpTarget(purpose: StepUpPurpose, raw: unknown): string;
```

- [x] **Step 1: Write primitive contract tests**

Add RFC 6238 Appendix B SHA-1 vectors, Base32 round trips, a same-counter replay rejection case, AES-GCM tamper rejection, 32-byte opaque-token entropy checks, and stable target-digest field-order tests. Example vector:

```ts
test('matches the RFC 6238 SHA-1 vector at 59 seconds', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));
  assert.deepEqual(new TotpService().verify(secret, '287082', new Date(59_000)), {
    counter: 1n,
    drift: 0,
  });
});
```

- [x] **Step 2: Run the focused tests and observe failure**

Run from `apps/server`:

```powershell
npx tsx --test test/security/base32.test.ts test/security/totp-service.test.ts test/security/mfa-secret-crypto.test.ts test/security/opaque-token.test.ts test/security/step-up-target.test.ts
```

Expected: FAIL because the five new domain modules do not exist.

- [x] **Step 3: Implement the primitives**

Use Node `crypto.createHmac('sha1')` with an 8-byte big-endian counter, dynamic truncation, and constant-time six-digit comparison. Use `randomBytes(20)` for TOTP secrets, `randomBytes(32).toString('base64url')` for opaque credentials, SHA-256 hex hashes, and `createCipheriv('aes-256-gcm', key, randomBytes(12))` for secrets. `digestStepUpTarget` must reject unknown fields and canonicalize only the purpose-specific allowlist.

- [x] **Step 4: Validate environment configuration**

Extend `loadEnvironment` to return `mfaEncryptionKeys: ReadonlyMap<number, Buffer>`, `trustedOrigins: string[]`, and `production: boolean`. Decode `MFA_ENCRYPTION_KEY_V1` from Base64 and require exactly 32 bytes in production. Tests must prove production startup rejects missing/short keys while test/development receives an explicit deterministic test key from the test environment, never a generated process-local key.

- [x] **Step 5: Run focused and existing security tests**

```powershell
npx tsx --test test/security/*.test.ts test/config/*.test.ts
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

### Task 2: Persistence Contract and Migration

**Files:**
- Modify `apps/server/prisma/schema.prisma`.
- Create `apps/server/prisma/migrations/20260721230000_identity_security_mfa_step_up/migration.sql`.
- Create `apps/server/test/db/spec-006-identity-security-migration-contract.test.ts`.

**Interfaces:**
- Produces Prisma models `MfaFactor`, `MfaRecoveryCode`, `AuthChallenge`, `AuthSession`, and `StepUpGrant` with names and relations matching section 6 of the design.

- [x] **Step 1: Write the migration contract test**

Assert that SQL creates all five tables, unique active-factor enforcement, token-hash unique indexes, challenge lookup/cooldown indexes, session user/expiry indexes, step-up session/expiry indexes, and `ON DELETE RESTRICT` relations. Assert no secret or raw token column is named `secret`, `token`, `recoveryCode`, or `refreshToken` without the encrypted/hash qualifier.

- [x] **Step 2: Observe the migration test fail**

```powershell
npx tsx --test test/db/spec-006-identity-security-migration-contract.test.ts
```

Expected: FAIL because the migration directory is absent.

- [x] **Step 3: Add schema models and SQL**

Use `@db.Timestamptz(3)` for security timestamps, `BigInt?` for `lastAcceptedCounter`, `String @unique` for all credential hashes, and nullable `previousRefreshTokenHash` plus `previousRefreshRotatedAt` on `AuthSession` for reuse detection. Add a PostgreSQL partial unique index equivalent to:

```sql
CREATE UNIQUE INDEX "mfa_factor_one_active_per_user"
ON "mfa_factor" ("userId")
WHERE "disabledAt" IS NULL;
```

Add User relations for factors, challenges, sessions, and grants. Store IP prefixes and user-agent digests as optional bounded strings.

- [x] **Step 4: Generate and deploy into the test database**

```powershell
npm run db:generate
npm run db:deploy
```

Expected: Prisma generation succeeds and migration `20260721230000_identity_security_mfa_step_up` applies once.

- [x] **Step 5: Verify schema and regression contracts**

```powershell
npx tsx --test test/db/*.test.ts
npm run typecheck
```

Expected: all DB contract tests PASS and generated Prisma types compile.

### Task 3: Challenges, MFA Enrollment, Verification, and Recovery Codes

**Files:**
- Create `apps/server/app/application/auth/auth-challenge-service.ts`, `mfa-service.ts` and their tests.
- Modify `apps/server/app/application/auth/authentication-service.ts`, `authentication-factory.ts`, security errors, controller, router, and existing auth API tests.

**Interfaces:**
- Produces:

```ts
export type AuthChallengeType = 'PASSWORD_CHANGE' | 'MFA_ENROLLMENT' | 'MFA_VERIFY';
export interface IssuedChallenge { token: string; expiresIn: 300 | 600 }
export class AuthChallengeService {
  issue(userId: string, type: AuthChallengeType): Promise<IssuedChallenge>;
  consume<T>(token: string, type: AuthChallengeType, work: (tx: Prisma.TransactionClient, userId: string) => Promise<T>): Promise<T>;
  fail(token: string, type: AuthChallengeType): Promise<never>;
}

export type MfaCredential = { kind: 'TOTP'; code: string } | { kind: 'RECOVERY_CODE'; code: string };
export interface VerifiedMfaIdentity { userId: string; assuranceLevel: 'MFA'; recoveryCodes?: string[] }
export class MfaService {
  beginEnrollment(challengeToken: string): Promise<{ secret: string; manualKey: string; otpauthUri: string }>;
  confirmEnrollment(challengeToken: string, code: string): Promise<VerifiedMfaIdentity>;
  verifyLogin(challengeToken: string, credential: MfaCredential): Promise<VerifiedMfaIdentity>;
  status(userId: string): Promise<MfaStatusView>;
}
```

- [x] **Step 1: Add failing service tests**

Cover one active challenge per type, hashed token lookup, five failures/cooldown, one pending factor, 15-minute pending replacement, encrypted secret storage, atomic TOTP counter update, ten one-time recovery codes, and no audit secret leakage.

- [x] **Step 2: Run and observe failure**

```powershell
npx tsx --test test/auth/auth-challenge-service.test.ts test/auth/mfa-service.test.ts
```

Expected: FAIL on missing services.

- [x] **Step 3: Implement challenge and MFA services**

Lock challenge and factor rows with `FOR UPDATE`. On a wrong credential, increment the stored counter in its own transaction and return only `MFA_INVALID` or `MFA_RATE_LIMITED`. Generate recovery codes from 16 random bytes formatted as four uppercase Base32 groups; hash each with `BcryptPasswordHasher` and return plaintext only from enrollment confirmation.

- [x] **Step 4: Add password-stage state selection without issuing sessions**

Add an internal `PasswordStageResult` used by the next task:

```ts
export type PasswordStageResult =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'MFA_ENROLLMENT_REQUIRED'; challengeToken: string; expiresIn: 600 }
  | { mode: 'MFA_CHALLENGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'PASSWORD_VERIFIED'; userId: string; assuranceLevel: 'PASSWORD' };
```

Password success must reset password failure counters, but must not write a successful `LoginLog` or `lastLoginAt` before the next task creates a formal session. Forced password change consumes `PASSWORD_CHANGE`, increments `credentialVersion`, and returns the next password-stage result instead of `void`; session revocation is wired in Task 4.

- [x] **Step 5: Add and pass service tests**

Test password-stage selection, generic error responses, TOTP replay, recovery-code reuse, challenge expiry, and concurrent confirmation. Controller routes and final authenticated responses are added after `SessionService` exists in Task 4.

```powershell
npx tsx --test test/auth/auth-challenge-service.test.ts test/auth/mfa-service.test.ts test/app/authentication-service-clock.test.ts
```

Expected: all selected tests PASS.

### Task 4: Server Sessions, Refresh Rotation, Cookies, and CSRF

**Files:**
- Create `apps/server/app/application/auth/session-service.ts`, `apps/server/app/middleware/csrf.ts`, and tests.
- Modify token service, authentication service/factory, auth controller/router, config, middleware, and existing token/auth tests.

**Interfaces:**
- Produces:

```ts
export type AssuranceLevel = 'PASSWORD' | 'MFA';
export interface AuthenticatedResult {
  mode: 'AUTHENTICATED';
  token: string;
  expiresIn: 900;
  csrfToken: string;
  user: AuthenticatedUser;
}
export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: 900;
  sessionId: string;
}
export interface ActiveSessionClaims {
  userId: string;
  sessionId: string;
  credentialVersion: number;
  assuranceLevel: AssuranceLevel;
}
export class SessionService {
  create(userId: string, assuranceLevel: AssuranceLevel, metadata: RequestMetadata): Promise<SessionCredentials>;
  authenticateAccess(token: string): Promise<ActiveSessionClaims>;
  rotateRefresh(rawRefreshToken: string, metadata: RequestMetadata): Promise<SessionCredentials>;
  revokeCurrent(sessionId: string, reason: string): Promise<void>;
  revokeAll(userId: string, reason: string, exceptSessionId?: string): Promise<number>;
  list(userId: string, currentSessionId: string): Promise<SessionView[]>;
}
```

- [x] **Step 1: Write failing session/token tests**

Prove access JWT contains `sid` and `amr`, expires in 900 seconds, rejects non-access token types, and always checks the corresponding active session. Prove refresh rotation replaces the hash under a row lock and a reused predecessor revokes the session.

- [x] **Step 2: Observe failure**

```powershell
npx tsx --test test/security/token-service.test.ts test/auth/session-service.test.ts test/app/session-api.test.ts
```

Expected: FAIL because session APIs and claims are absent.

- [x] **Step 3: Implement access and refresh credentials**

Remove refresh and password-change JWT signing. `JwtTokenService.signAccess` accepts `(userId, sessionId, credentialVersion, assuranceLevel)` and signs for `15m`. Session creation returns the raw refresh token only to the controller, which sets:

```ts
ctx.cookies.set('chengye_refresh', refreshToken, {
  httpOnly: true,
  secure: production,
  sameSite: 'strict',
  overwrite: true,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  signed: false,
});
```

Persist the preceding SHA-256 hash in the Task 2 `previousRefreshTokenHash` fields until the next successful rotation so reuse can be distinguished from an arbitrary invalid token.

- [x] **Step 4: Add CSRF and trusted-Origin enforcement**

Set a non-HttpOnly `chengye_csrf` cookie plus identical response-body token at authentication/refresh. For refresh, logout, logout-all, session deletion, MFA management, and step-up, require the `X-CSRF-Token` header to equal the cookie via constant-time comparison and require `Origin` to be in configured trusted origins. Reject with `CSRF_INVALID` before the controller.

- [x] **Step 5: Replace stateless logout and add session APIs**

Expose enrollment begin/confirm and MFA verify as public challenge-token endpoints, convert `PasswordStageResult` plus `VerifiedMfaIdentity` into the four public `LoginResult` states, and create the formal session only for `AUTHENTICATED`. Read refresh only from the Cookie, clear both cookies on logout/reuse, add `GET /auth/sessions`, `DELETE /auth/sessions/:id`, and `/auth/logout-all`, and ensure password changes/user disable/MFA reset revoke all sessions.

- [x] **Step 6: Run focused and authentication regressions**

```powershell
npx tsx --test test/security/token-service.test.ts test/auth/session-service.test.ts test/app/auth.test.ts test/app/session-api.test.ts test/app/authorization-middleware.test.ts
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

### Task 5: Real-Time Administrator MFA Gate

**Files:**
- Modify `apps/server/app/middleware/auth.ts`, authorization-context middleware/loader, and auth factory.
- Create or extend `apps/server/test/app/administrator-mfa-guard.test.ts`.

**Interfaces:**
- Consumes `SessionService.authenticateAccess` and the existing real-time `AuthorizationContext`.
- Produces one fail-closed guard applied after authorization context is loaded.

- [x] **Step 1: Write failing guard tests**

Cover a super-admin and system-admin with no factor, with a PASSWORD session, with a disabled factor, and with a valid MFA session. Cover a normal user promoted during a PASSWORD session and an administrator role revoked during a session.

- [x] **Step 2: Observe failure**

```powershell
npx tsx --test test/app/administrator-mfa-guard.test.ts
```

Expected: FAIL because current middleware accepts every valid access JWT.

- [x] **Step 3: Implement middleware ordering and gate**

Change middleware order to authenticate the session first, load live authorization second, then enforce administrator MFA before routing. Public and challenge routes bypass only the layers explicitly required by their state. A live administrator without a verified factor returns `MFA_ENROLLMENT_REQUIRED`; one with a factor but non-MFA session returns `MFA_REQUIRED`.

- [x] **Step 4: Run authorization regression tests**

```powershell
npx tsx --test test/app/administrator-mfa-guard.test.ts test/app/authorization-middleware.test.ts test/app/trust-root-guard.test.ts test/authorization/*.test.ts
```

Expected: all selected tests PASS.

### Task 6: Purpose-Bound Step-Up and Governance Integration

**Files:**
- Create step-up service and tests.
- Modify auth controller/router, governance command/review/execution services, their factories/controllers, and governance tests.

**Interfaces:**
- Produces:

```ts
export interface IssueStepUpInput { purpose: StepUpPurpose; target: unknown; code: string }
export class StepUpService {
  issue(claims: ActiveSessionClaims, input: IssueStepUpInput): Promise<{ stepUpToken: string; expiresIn: 300 }>;
  consume(tx: Prisma.TransactionClient, claims: ActiveSessionClaims, purpose: StepUpPurpose, target: unknown, rawToken: string): Promise<void>;
}
```

- [x] **Step 1: Write failing step-up tests**

Cover issue from MFA vs PASSWORD sessions, TOTP replay, expiry, one-time use, cross-user/session/purpose/target rejection, transaction rollback preserving an unconsumed grant, and successful transaction committing `consumedAt` with the business write.

- [x] **Step 2: Observe failure**

```powershell
npx tsx --test test/auth/step-up-service.test.ts test/app/step-up-api.test.ts
```

Expected: FAIL because `StepUpService` is absent.

- [x] **Step 3: Implement issuance and transactional consumption**

Require a current MFA session, verify a fresh TOTP through the same replay-protected factor path, hash the returned random grant, and store the server digest. `consume` locks the grant row, compares every binding, sets `consumedAt`, and writes the audit event using the passed transaction client.

- [x] **Step 4: Integrate governance create/approve/retry**

For HIGH/CRITICAL catalog entries, require `X-Step-Up-Token` and use these canonical targets:

```ts
{ operationType, targetType, targetId, expectedTargetVersion, payloadHash } // create
{ operationId, expectedOperationVersion, decision: 'APPROVE' }             // approve
{ operationId, expectedOperationVersion }                                  // retry
```

Consume the grant inside the existing operation transaction before the protected state transition/write. LOW/MEDIUM behavior and CRITICAL exact confirmation remain unchanged.

- [x] **Step 5: Run governance and acceptance regressions**

```powershell
npx tsx --test test/auth/step-up-service.test.ts test/app/step-up-api.test.ts test/admin-governance/*.test.ts test/app/admin-governance-api.test.ts test/acceptance/spec-005-acceptance.test.ts
```

Expected: all selected tests PASS, including exact-confirmation and no-self-review assertions.

### Task 7: MFA Management, Governed Reset, and Emergency CLI

**Files:**
- Extend MFA/session services and auth API.
- Add `ADMIN_MFA_RESET` to governance types/catalog/validation/adapter and tests.
- Create admin MFA recovery service, CLI script, tests, and update server package scripts.

**Interfaces:**
- Produces service methods:

```ts
disableSelf(claims: ActiveSessionClaims, stepUpToken: string): Promise<void>;
regenerateRecoveryCodes(claims: ActiveSessionClaims, stepUpToken: string): Promise<{ recoveryCodes: string[] }>;
resetAdministratorMfa(tx: Prisma.TransactionClient, targetUserId: string, actorUserId: string, source: 'GOVERNANCE' | 'RECOVERY'): Promise<void>;
```

- [x] **Step 1: Write failing self-management tests**

Prove admins cannot disable MFA, ordinary users need step-up, regenerating codes invalidates all old codes, revoking another session needs a target-bound grant, and logout-all consumes the matching grant while preserving the current session only when explicitly requested.

- [x] **Step 2: Add governed reset tests before catalog code**

Add `ADMIN_MFA_RESET` as CRITICAL, PRE review, super-admin only, non-self-review, target user required. Assert execution disables factors, invalidates codes, increments credentials, revokes sessions, and forces enrollment at next password login.

- [x] **Step 3: Implement API and governance adapter**

Keep reset execution in one transaction with mandatory audit writing. Extend sensitive-key redaction tests so fields matching `totp`, `otp`, `mfa`, `recovery`, `cookie`, `authorization`, `token`, or `secret` never survive governance views or logs.

- [x] **Step 4: Write failing CLI tests**

Cover wrong database confirmation, wrong password, non-super-admin target, missing/disabled target, successful reset, audit failure rollback, and output redaction. Exact confirmation format:

```text
RESET ADMIN MFA <databaseName> <normalizedUsername>
```

- [x] **Step 5: Implement CLI and package entry**

Add `"admin-mfa:reset": "tsx scripts/system/reset-admin-mfa.ts"`. Reuse existing hidden password prompt and redacted database-target helpers from the super-admin recovery scripts. The service re-verifies the password, locks the user, re-checks active `SYSTEM_SUPER_ADMIN`, resets MFA/sessions/credentials, and writes `ADMIN_MFA_RESET_RECOVERY`.

- [x] **Step 6: Run management and recovery regressions**

```powershell
npx tsx --test test/app/mfa-api.test.ts test/app/session-api.test.ts test/system/admin-mfa-recovery-service.test.ts test/system/system-cli.test.ts test/admin-governance/*.test.ts
```

Expected: all selected tests PASS.

### Task 8: Web Runtime Session and Login/MFA State Machine

**Files:**
- Add `qrcode@1.5.4` and `@types/qrcode@1.5.6`.
- Create web auth runtime, types, challenge store, enrollment/challenge components, and tests.
- Modify API request/auth, auth store, Login, PasswordChange, App, and existing tests.

**Interfaces:**
- Produces:

```ts
export type LoginData =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'MFA_ENROLLMENT_REQUIRED'; challengeToken: string; expiresIn: 600 }
  | { mode: 'MFA_CHALLENGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'AUTHENTICATED'; token: string; expiresIn: 900; csrfToken: string; user: LoginUser };

export const runtimeSession: {
  getAccessToken(): string | null;
  setAuthenticated(data: Extract<LoginData, { mode: 'AUTHENTICATED' }>): void;
  clear(): void;
  refreshOnce(): Promise<string>;
};
```

- [x] **Step 1: Write failing runtime/store/request tests**

Assert no access, refresh, challenge, TOTP, recovery, or step-up values are written to `localStorage`; startup removes `law_firm_token`, `law_firm_refresh_token`, and token-bearing legacy `auth-storage`. Assert Axios uses `withCredentials`, injects memory Authorization/CSRF, performs one refresh for concurrent 401s, retries once, and clears state on terminal session errors.

- [x] **Step 2: Observe failure**

```powershell
npx vitest run src/features/auth/runtime-session.test.ts src/stores/authStore.test.ts src/api/request.test.ts
```

Expected: FAIL because the runtime session does not exist and tokens are persisted.

- [x] **Step 3: Implement runtime authentication bootstrap**

Remove Zustand `persist` from authentication secrets; user metadata may remain only in memory. At application mount call refresh once to recover an HttpOnly-cookie session, show a neutral bootstrap spinner, then route to the application or login. Ensure explicit challenge Authorization headers are never overwritten.

- [x] **Step 4: Write failing login/enrollment/challenge tests**

Cover all four login states, local QR canvas/data URL generation, manual-key visibility, six-digit validation, recovery-code option, recovery-code one-time display/acknowledgement, expired challenge return to login, and no sensitive value in URL/storage.

- [x] **Step 5: Implement the UI state machine**

Use `qrcode.toDataURL(otpauthUri, { errorCorrectionLevel: 'M', margin: 1, width: 220 })` locally. Keep challenge and returned recovery codes in non-persisted store/component state. Forced password change calls the revised API and feeds its returned next state through the same dispatcher as login.

- [x] **Step 6: Run focused web tests**

```powershell
npx vitest run src/features/auth src/pages/Login src/pages/PasswordChange src/stores/authStore.test.ts src/api/request.test.ts src/App.test.tsx
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

### Task 9: Web Security Settings, Step-Up Governance UI, and Full Verification

**Files:**
- Create step-up hook/dialog, SecuritySettings page, and tests.
- Modify auth API, App/routes/navigation, AdminGovernance page and tests.
- Create acceptance test and update deployment/runbook documentation.

**Interfaces:**
- Produces:

```ts
export async function withStepUp<T>(input: {
  purpose: StepUpPurpose;
  target: unknown;
  verify: () => Promise<string>;
  mutate: (stepUpToken: string) => Promise<T>;
}): Promise<T>;
```

- [x] **Step 1: Write failing step-up UI tests**

Assert HIGH/CRITICAL create, approve, and retry open the TOTP dialog; LOW/MEDIUM operations do not. Assert the grant is passed only to the immediate mutation, cleared on success/failure, and never cached. Assert CRITICAL exact phrase is collected before TOTP and both values remain distinct.

- [x] **Step 2: Implement reusable step-up flow**

`StepUpDialog` accepts purpose and a human-readable impact summary, returns only a code to `useStepUp`, and clears input on close. `withStepUp` calls `/auth/step-up`, then passes the returned grant as `X-Step-Up-Token` to exactly one protected API call.

- [x] **Step 3: Write and implement settings/session tests**

Test MFA status, recovery-code regeneration acknowledgement, admin disable prohibition, current-session marker, target-bound revoke, and logout-all. Add `/security/account` behind `PrivateRoute` and link it from the account menu without adding a new authorization permission.

- [x] **Step 4: Add SPEC-006 acceptance and leakage tests**

The acceptance test must execute password login → forced enrollment → TOTP login → refresh rotation → HIGH governance step-up → logout/revocation. Add repository scans over built assets and test audit snapshots for known fixture secrets, recovery codes, challenge tokens, refresh tokens, and step-up tokens.

- [x] **Step 5: Update operational documentation**

Document `MFA_ENCRYPTION_KEY_V1` generation/injection, synchronized frontend/backend rollout, forced invalidation of old sessions, two-super-admin enrollment sequence, recovery-code handling, CLI recovery, key-loss consequences, rollback, and backup/restore key injection. Update the migration handoff with exact remaining tasks and verification evidence.

- [x] **Step 6: Run complete verification from clean test data**

From `apps/server`:

```powershell
npm run db:reset:test
npm run test:unit
npm run cov
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

From `apps/web`:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Then from `apps/server`:

```powershell
npm run db:assert-empty
```

Expected: server and web tests PASS, lint/typecheck/build exit 0, production high/critical audit counts are 0, and the test database contains no application data.

### Task 10: Final Security Review Remediation and Operational Rehearsal

- [x] **Step 1: Add failing Step-Up rate-limit and rejection-audit tests**

Cover five atomic failures, a 15-minute session cooldown, concurrent attempts, success reset, redacted rejection audit, and durable consume rejection/expiry audit.

- [x] **Step 2: Implement persistent Step-Up failure accounting and audits**

Persist failure count and cooldown on `AuthSession`, commit expected rejection state before throwing, and keep raw TOTP, token, Cookie, Authorization, and target input out of audit data.

- [x] **Step 3: Add failing ordinary-user enrollment API/UI tests**

Assert an authenticated ordinary user without an active factor can issue an `MFA_ENROLLMENT` challenge and complete the existing enrollment flow; reject administrators, existing active factors, and inactive accounts.

- [x] **Step 4: Implement optional ordinary-user enrollment and MFA failure audits**

Add the authenticated enrollment-start endpoint, security-settings entry point, and redacted TOTP/recovery failure audits while preserving administrator mandatory enrollment.

- [x] **Step 5: Run focused and full verification**

Run affected server/Web tests, migration contracts, the real c8 suite, lint, typecheck, builds, production audits, leakage scan, and final empty-test-database assertion.

- [x] **Step 6: Rehearse emergency CLI and isolated backup/restore**

Use only guarded test/isolated databases, record sanitized evidence and dump hash, clean temporary secrets/data, and update the runbooks, handoff, and closeout report.

---

## Plan Completion Rules

- Update each checkbox only after its command has been run and the stated result observed.
- On any unexpected failure, use `superpowers:systematic-debugging` before changing implementation.
- Before reporting SPEC-006 complete, use `superpowers:verification-before-completion` and record fresh command output in the closeout report.
- Do not perform the commit steps normally prescribed by the planning workflow because the workspace handoff explicitly forbids Git/GitHub writes.
