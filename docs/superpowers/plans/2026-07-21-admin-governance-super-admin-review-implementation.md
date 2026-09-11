# SPEC-005 Administrator Governance and Super-Admin Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a PostgreSQL-backed administrator-governance workflow that creates `SYSTEM_ADMIN`, separates request and review duties, executes only code-owned operations, supports pre-review and post-review, protects the last super-admin, and provides an auditable management UI and second-seat recovery CLI.

**Architecture:** Keep the Egg.js + Prisma modular monolith. A code-owned operation catalog feeds one governance state machine and transaction runner; focused adapters call shared transactional master-data commands or administrator-account commands. Existing `Approval` remains untouched, while `OperationLog` remains the system-wide audit index and three new governance models hold workflow state.

**Tech Stack:** Node.js 22.14.0, npm 10.9.2, TypeScript, Egg.js 3, Prisma 5.22, PostgreSQL 16, React 19, Ant Design 6, Zustand, Node test runner, Vitest, Testing Library, Playwright 1.55.1, Docker Desktop.

## Global Constraints

- Continue in `D:/2_test/16_ChengyeOA/.worktrees/spec-004-rbac-data-scope`; do not create, switch, stage, commit, merge, push, or otherwise operate on Git. The project owner will handle Git after local development is complete.
- Run repository commands through `npx.cmd -y -p node@22.14.0 -p npm@10.9.2`.
- Use PostgreSQL 16 through Docker. Destructive commands may target only a database whose name ends in `_test` and require `ALLOW_TEST_DB_RESET=true`.
- Do not add a generic approval engine, background workflow engine, message callback system, dynamic configuration center, arbitrary data editor, SQL console, queue, cache, Casbin, or OPA.
- Do not reuse the legacy `Approval` model or `/api/v1/approvals` routes for governance.
- Preserve the existing SPEC-002 trust root, forced-password-change flow, credential invalidation, recovery command, and `SYSTEM_SUPER_ADMIN` implicit authorization semantics.
- Preserve SPEC-004 action, scope, field, special-permission, L4-purpose, and audit hard gates.
- `SYSTEM_ADMIN` uses a fail-closed code allowlist; new permission codes never become system-admin permissions automatically.
- Every high or critical operation is inert before independent review. Every low operation executes only through a white-listed adapter and enters post-review.
- The requester cannot review an operation, and a reviewer cannot review an operation targeting the reviewer's own account or system-role grant.
- Business mutation, successful execution record, final operation state, and `OperationLog` entry commit in one PostgreSQL transaction.
- Never return or persist passwords, password hashes, tokens, API keys, database credentials, confirmation phrases, or L4 raw values in governance snapshots.
- Existing public domain services and governance adapters share transactional command functions; do not duplicate master-data invariants in controllers or adapters.
- Existing API response envelope remains `{ code, message, data }`; domain errors expose stable codes through the current error middleware.
- Use TDD for each task. A task is complete only after its focused tests pass and the local checkpoint records the command and result; Git commit steps are intentionally omitted.
- Final local acceptance uses Node.js 22.14.0, npm 10.9.2, PostgreSQL 16, complete `npm run verify`, browser screenshots, and an empty `_test` database assertion.

## Execution Environment

Run from `LayerManage/law-firm-system` with this PowerShell preamble:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa?schema=public'
$env:DATABASE_URL_TEST = 'postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:JWT_SECRET = '01234567890123456789012345678901'
$env:APP_KEYS = 'local_test_application_key_number_one,local_test_application_key_number_two'
$env:ALLOW_TEST_DB_RESET = 'true'
```

Before Task 1:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 node --version
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --version
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:up
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run verify
```

Expected: Node `v22.14.0`, npm `10.9.2`, Docker reports PostgreSQL healthy, the reset refuses any non-`_test` target, and the existing verification suite exits 0. Record actual test counts rather than copying historical counts.

## Planned File Structure

```text
apps/server/app/domain/admin-governance/
  governance-types.ts
  governance-errors.ts
  governance-validation.ts
  canonical-json.ts
  operation-catalog.ts
  governance-state-machine.ts

apps/server/app/application/admin-governance/
  governance-store.ts
  governance-query-service.ts
  governance-command-service.ts
  governance-review-service.ts
  governance-execution-runner.ts
  governance-factory.ts
  adapters/governance-adapter.ts
  adapters/administrator-account-adapter.ts
  adapters/master-data-adapter.ts

apps/server/app/application/master-data/
  transactional-master-data-commands.ts

apps/server/app/application/system/
  second-super-admin-service.ts

apps/server/app/controller/
  adminGovernance.ts

apps/server/scripts/system/
  add-second-super-admin.ts

apps/web/src/features/admin-governance/
  types.ts
  api.ts
  governance.css
  components/OperationCreateDrawer.tsx
  components/OperationDetailDrawer.tsx
  components/ReviewDialog.tsx

apps/web/src/pages/AdminGovernance/
  index.tsx
  index.test.tsx
```

---

### Task 1: Add Governance Persistence, Permissions, and the Reserved System-Admin Role

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260721120000_admin_governance_expand/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-types.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/domain/authorization/permission-catalog.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/system/system-bootstrap-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-005-governance-migration-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/authorization/permission-catalog.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/system/system-bootstrap-service.test.ts`

**Interfaces:**
- Produces: Prisma delegates `adminOperation`, `adminOperationReview`, `adminOperationExecution`; eight governance permission codes; reserved `SYSTEM_ADMIN` creation in bootstrap and conditional migration backfill.
- Consumed by: Tasks 2-12.

- [ ] **Step 1: Write failing schema and migration contract tests**

Assert all three models, JSON fields, unique idempotency constraint, review/execution foreign keys, positive versions, constrained statuses, and the expanded `user_role_source_check`:

```ts
test('SPEC-005 schema has immutable governance aggregates', () => {
  for (const model of ['AdminOperation', 'AdminOperationReview', 'AdminOperationExecution']) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(schema, /@@unique\(\[requesterUserId, idempotencyKey\]\)/);
  assert.match(migration, /admin_operation_status_check/);
  assert.match(migration, /user_role_source_check[\s\S]*RECOVERY/);
  assert.doesNotMatch(migration, /DROP TABLE "approval"/i);
});
```

- [ ] **Step 2: Run the tests and verify RED**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/spec-005-governance-migration-contract.test.ts } finally { Pop-Location }
```

Expected: FAIL because the models and migration do not exist.

- [ ] **Step 3: Add the Prisma models and relations**

Use these stable fields and relation names:

```prisma
model AdminOperation {
  id                    String   @id @default(uuid())
  operationNo           String   @unique
  operationType         String
  riskLevel             String
  reviewMode            String
  status                String
  requesterUserId       String
  targetType            String
  targetId              String
  reason                String
  payloadSnapshot       Json
  payloadHash           String
  expectedTargetVersion Int
  idempotencyKey        String
  secondConfirmationAt  DateTime? @db.Timestamptz(3)
  relatedOperationId    String?
  version               Int      @default(1)
  createdAt             DateTime @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)
  requester              User     @relation("AdminOperationRequester", fields: [requesterUserId], references: [id], onDelete: Restrict)
  relatedOperation       AdminOperation? @relation("RelatedAdminOperation", fields: [relatedOperationId], references: [id], onDelete: Restrict)
  relatedOperations      AdminOperation[] @relation("RelatedAdminOperation")
  reviews                AdminOperationReview[]
  executions             AdminOperationExecution[]
  @@unique([requesterUserId, idempotencyKey])
  @@index([requesterUserId, createdAt])
  @@index([status, createdAt])
  @@index([operationType, createdAt])
  @@index([targetType, targetId])
  @@map("admin_operation")
}

model AdminOperationReview {
  id               String   @id @default(uuid())
  operationId      String
  reviewerUserId   String
  decision         String
  comment          String?
  operationVersion Int
  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  operation AdminOperation @relation(fields: [operationId], references: [id], onDelete: Restrict)
  reviewer  User @relation("AdminOperationReviewer", fields: [reviewerUserId], references: [id], onDelete: Restrict)
  @@index([operationId, createdAt])
  @@index([reviewerUserId, createdAt])
  @@map("admin_operation_review")
}

model AdminOperationExecution {
  id             String    @id @default(uuid())
  operationId    String
  attemptNo      Int
  executorType   String
  status         String
  beforeSnapshot Json?
  afterSnapshot  Json?
  resultCode     String?
  errorMessage   String?
  startedAt      DateTime  @default(now()) @db.Timestamptz(3)
  finishedAt     DateTime? @db.Timestamptz(3)
  operation AdminOperation @relation(fields: [operationId], references: [id], onDelete: Restrict)
  @@unique([operationId, attemptNo])
  @@index([status, startedAt])
  @@map("admin_operation_execution")
}
```

Add named requester/reviewer relations to `User`. Do not add cascade deletes.

- [ ] **Step 4: Write the additive PostgreSQL migration**

Create the three tables, indexes, foreign keys, and CHECK constraints. Replace the existing `user_role_source_check` and validity constraint so `RECOVERY` is accepted only with `validUntil IS NULL`. Insert the eight governance permissions with `ON CONFLICT ("code") DO NOTHING`. Conditionally insert `SYSTEM_ADMIN` only when `system_initialization` already contains `PRIMARY`, so a fresh pre-bootstrap database remains application-empty.

```sql
INSERT INTO "role" ("id", "name", "code", "type", "status", "version", "createdAt", "updatedAt")
SELECT 'role:system-admin', '系统管理员', 'SYSTEM_ADMIN', 'SYSTEM', 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "system_initialization" WHERE "id" = 'PRIMARY')
ON CONFLICT ("code") DO NOTHING;
```

- [ ] **Step 5: Register governance permissions and bootstrap both system roles**

Add resource `governance` and these exact codes to both backend authorization files:

```ts
'menu.admin_governance',
'governance.catalog.read',
'governance.operation.create',
'governance.operation.read_self',
'governance.operation.read_all',
'governance.review',
'governance.retry',
'governance.audit.read',
```

In `SystemBootstrapService`, create `SYSTEM_ADMIN` with stable ID `role:system-admin` after the empty-table assertion and before creating the first user. Keep the first user assigned only to `SYSTEM_SUPER_ADMIN`.

- [ ] **Step 6: Run migration, catalog, and bootstrap tests**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
Push-Location apps/server
try {
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:generate
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/spec-005-governance-migration-contract.test.ts test/authorization/permission-catalog.test.ts test/system/system-bootstrap-service.test.ts
} finally { Pop-Location }
```

Expected: PASS; bootstrap creates exactly two system roles and grants only the super-admin role.

- [ ] **Step 7: Record local checkpoint**

Record schema model count, migration test count, bootstrap test count, and the successful reset command in the task log. Do not stage or commit files.

---

### Task 2: Build the Code-Owned Governance Kernel

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/governance-types.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/governance-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/governance-validation.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/canonical-json.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/operation-catalog.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/governance-state-machine.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-kernel.test.ts`

**Interfaces:**
- Produces: `GovernedOperationType`, `GovernanceStatus`, `GovernanceDecision`, `GOVERNED_OPERATION_CATALOG`, `canonicalJson`, `hashPayload`, strict create/review parsers, and transition guards.
- Consumed by: Tasks 4-11.

- [ ] **Step 1: Write failing catalog, canonicalization, and transition tests**

```ts
test('canonical JSON ignores object key order but not array order', () => {
  assert.equal(hashPayload({ b: 2, a: [1, 2] }), hashPayload({ a: [1, 2], b: 2 }));
  assert.notEqual(hashPayload({ a: [1, 2] }), hashPayload({ a: [2, 1] }));
});

test('pre-review cannot execute before approval', () => {
  assert.throws(() => assertGovernanceTransition('PENDING_REVIEW', 'EXECUTING'));
  assert.doesNotThrow(() => assertGovernanceTransition('PENDING_REVIEW', 'APPROVED'));
});
```

- [ ] **Step 2: Define exact stable types**

```ts
export const GOVERNED_OPERATION_TYPES = [
  'SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE',
  'MASTER_DATA_STATUS_CORRECTION', 'MASTER_DATA_METADATA_CORRECTION',
] as const;
export type GovernedOperationType = typeof GOVERNED_OPERATION_TYPES[number];
export type GovernanceRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type GovernanceReviewMode = 'PRE' | 'POST';
export type GovernanceStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'PENDING_POST_REVIEW' | 'CONFIRMED' | 'FLAGGED';
export type GovernanceDecision = 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG';
export type GovernanceRequesterRole = 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN';
```

- [ ] **Step 3: Implement stable errors and strict parsers**

`GovernanceError` must expose `code` and numeric `status`. Create exact-key parsers for create, cancel, review, and retry inputs. Enforce reason length 10-500, integer versions greater than zero, non-empty IDs, and reject client fields `riskLevel`, `reviewMode`, `requesterUserId`, `reviewerUserId`, and `status`.

Use this exact stable code set:

```ts
export const GOVERNANCE_CODES = {
  notAllowed: 'GOVERNANCE_OPERATION_NOT_ALLOWED',
  selfReview: 'GOVERNANCE_SELF_REVIEW_FORBIDDEN',
  reviewTarget: 'GOVERNANCE_REVIEW_TARGET_CONFLICT',
  processed: 'OPERATION_ALREADY_PROCESSED',
  idempotency: 'IDEMPOTENCY_KEY_REUSED',
  staleTarget: 'STALE_TARGET_VERSION',
  payloadHash: 'PAYLOAD_HASH_MISMATCH',
  lastSuperAdmin: 'LAST_SUPER_ADMIN_PROTECTED',
  recoveryUnavailable: 'RECOVERY_WINDOW_NOT_AVAILABLE',
  notRetryable: 'OPERATION_NOT_RETRYABLE',
  targetIneligible: 'TARGET_NOT_ELIGIBLE',
  hidden: 'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
} as const;
```

- [ ] **Step 4: Implement deterministic canonical JSON and SHA-256**

Use `node:crypto`; recursively sort object keys, preserve array order, reject `undefined`, functions, symbols, non-finite numbers, and cyclic input. Export:

```ts
export function canonicalJson(value: unknown): string;
export function hashPayload(value: unknown): string;
```

- [ ] **Step 5: Implement the immutable operation catalog**

Each entry contains `riskLevel`, `reviewMode`, `requesterRoles`, `adapterKey`, `retryable`, and optional `confirmationTemplate`. Freeze the object and validate at module load that all eight types appear exactly once and every CRITICAL entry has a confirmation template.

- [ ] **Step 6: Implement state and decision guards**

Export:

```ts
export function assertGovernanceTransition(from: GovernanceStatus, to: GovernanceStatus): void;
export function decisionTarget(status: GovernanceStatus, decision: GovernanceDecision): GovernanceStatus;
export function mayResumeExecution(status: GovernanceStatus, successfulAttempts: number): boolean;
```

`mayResumeExecution` returns true only for `APPROVED` with zero successful attempts or `FAILED` whose catalog entry is retryable.

- [ ] **Step 7: Run focused tests and record checkpoint**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/admin-governance/governance-kernel.test.ts } finally { Pop-Location }
```

Expected: PASS with no database dependency.

---

### Task 3: Add Fail-Closed SYSTEM_ADMIN Authorization

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/admin-governance/system-admin-permissions.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-context-loader.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/authorization.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/system/trust-root-guard.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/user.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/authorization/authorization-context-loader.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/app/trust-root-guard.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/system-admin-permissions.test.ts`

**Interfaces:**
- Produces: `SYSTEM_ADMIN_PERMISSION_CODES`, `AuthorizationContext.isSystemAdmin`, grant source `SYSTEM_ADMIN`, and direct-user-mutation protection for active administrators.
- Consumed by: governance API and frontend authorization state.

- [ ] **Step 1: Write failing system-admin context tests**

Cover active, future, expired, revoked, disabled-role, disabled-user, mixed system roles, and newly registered permission exclusion. Assert system-admin grants use `scopeIds: ['ALL']`, while prohibited governance permissions are absent.

- [ ] **Step 2: Define the initial allowlist**

```ts
export const SYSTEM_ADMIN_PERMISSION_CODES = Object.freeze([
  'menu.admin_governance',
  'governance.catalog.read',
  'governance.operation.create',
  'governance.operation.read_self',
  'governance.audit.read',
  'organization.read',
  'position.read',
  'professional_team.read',
  'permission.trace.self',
] satisfies readonly PermissionCode[]);
```

Add a test asserting the list excludes `governance.review`, `governance.retry`, `governance.operation.read_all`, `user.role.manage`, and `role.permission.manage`.

- [ ] **Step 3: Extend the authorization context**

Add `isSystemAdmin: boolean` and grant source `SYSTEM_ADMIN`. In the loader, keep super-admin precedence; otherwise synthesize only allowlisted grants for an active `SYSTEM_ADMIN` assignment and combine them with ordinary business-role grants. Use the system-role grant's `validUntil`.

- [ ] **Step 4: Protect administrator targets from legacy user mutation routes**

Add `assertNonAdministratorUserMutable(prisma, userId)` that rejects users with a currently effective `SYSTEM_ADMIN` or `SYSTEM_SUPER_ADMIN` role. Call it from `UserController.update` and `destroy` in addition to existing trust-root protection. This prevents account disable or physical delete from bypassing governance.

- [ ] **Step 5: Expose `isSystemAdmin` in `/authorization/me` and run tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/authorization/authorization-context-loader.test.ts test/admin-governance/system-admin-permissions.test.ts test/app/trust-root-guard.test.ts } finally { Pop-Location }
```

Expected: PASS; ordinary mutation routes reject both administrator classes.

---

### Task 4: Implement the Governance Store and Read Model

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-store.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-query-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-views.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-store.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-query-service.test.ts`

**Interfaces:**
- Produces: append-only persistence helpers and sanitized `AdminOperationView`, `AdminOperationDetailView`, and `GovernancePage<T>`.
- Consumed by: Tasks 7, 9, 11.

- [ ] **Step 1: Write failing persistence and visibility tests**

Test unique requester/idempotency behavior, stable pagination, self-only visibility, super-admin all visibility, detail timeline ordering, and snapshot redaction.

- [ ] **Step 2: Define store methods**

```ts
export type GovernanceDb = PrismaClient | Prisma.TransactionClient;

export class GovernanceStore {
  constructor(private readonly db: GovernanceDb) {}
  create(input: CreateStoredOperation): Promise<AdminOperation>;
  findByRequesterIdempotency(requesterUserId: string, idempotencyKey: string): Promise<AdminOperation | null>;
  getDetail(id: string): Promise<AdminOperationWithTimeline | null>;
  appendReview(input: AppendReviewInput): Promise<AdminOperationReview>;
  appendExecution(input: AppendExecutionInput): Promise<AdminOperationExecution>;
  transition(id: string, expectedStatus: GovernanceStatus, expectedVersion: number, nextStatus: GovernanceStatus): Promise<AdminOperation>;
}
```

Use `updateMany` for optimistic transitions and throw `OPERATION_ALREADY_PROCESSED` when count is not one.

Generate `operationNo` as `GOV-${randomUUID().toUpperCase()}`. It is an opaque human-visible identifier; ordering continues to use `createdAt, id` rather than parsing the number.

- [ ] **Step 3: Implement query filters and projections**

`list(context, query)` accepts `scope=mine|reviewable|all`, status, operation type, requester ID, date range, page, and pageSize capped at 100. `reviewable` excludes `requesterUserId=context.userId` and administrator-account operations whose `targetId=context.userId`. `all` requires super-admin. List results omit payload and snapshots; detail includes sanitized snapshots only. `catalog(context)` filters requester roles and expands CRITICAL `confirmationTemplate` with the database name while leaving a `{targetUsername}` token for the form. Authorized detail reads append `VIEW_ADMIN_GOVERNANCE_DETAIL` to `OperationLog` with caller, request IP, and target operation ID; audit failure makes the detail request fail.

- [ ] **Step 4: Run database-backed tests**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/admin-governance/governance-store.test.ts test/admin-governance/governance-query-service.test.ts } finally { Pop-Location }
```

Expected: PASS; no update/delete method exists for review or execution history.

---

### Task 5: Implement Administrator Account and System-Role Commands

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/adapters/governance-adapter.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/adapters/administrator-account-adapter.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/administrator-account-adapter.test.ts`

**Interfaces:**
- Produces: `GovernedOperationAdapter`, `GovernanceExecutionOutcome`, and the six administrator-account operation implementations.
- Consumed by: Task 7.

- [ ] **Step 1: Write failing adapter contract tests**

Cover grant, duplicate grant, revoke, disable, last-super-admin protection, reviewer-target conflict, temporary validity, role disabled, user disabled, credential invalidation, before/after snapshots, and transaction rollback.

- [ ] **Step 2: Define the adapter contract**

```ts
export interface GovernanceExecutionRequest {
  operationId: string;
  operationType: GovernedOperationType;
  targetType: string;
  targetId: string;
  expectedTargetVersion: number;
  payload: Prisma.JsonValue;
  requesterUserId: string;
  reviewerUserId: string | null;
}

export interface GovernanceExecutionOutcome {
  beforeSnapshot: Prisma.InputJsonValue;
  afterSnapshot: Prisma.InputJsonValue;
  resultCode: string;
}

export interface GovernedOperationAdapter {
  readonly key: string;
  supports(operationType: GovernedOperationType): boolean;
  validatePayload(operationType: GovernedOperationType, payload: unknown): Prisma.InputJsonValue;
  execute(tx: Prisma.TransactionClient, request: GovernanceExecutionRequest): Promise<GovernanceExecutionOutcome>;
}
```

- [ ] **Step 3: Implement system-role grants and revocations**

Lock target user and applicable role/grant rows. For grant, create one `UserRole` with source, validity, reason, and `grantedByUserId=reviewerUserId`. For revoke, set revocation fields and increment version. Never delete role history.

- [ ] **Step 4: Implement administrator account disable**

Require target credential version to match `expectedTargetVersion`, set `status='DISABLED'`, increment `credentialVersion`, clear lock state, and ensure subsequent access/refresh tokens fail existing authentication checks.

- [ ] **Step 5: Implement last-super-admin protection**

Use `SELECT ... FOR UPDATE` on active super-admin grants and target user. Recalculate effective super-admins inside the execution transaction; reject any result below one with `LAST_SUPER_ADMIN_PROTECTED`.

- [ ] **Step 6: Run adapter tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/admin-governance/administrator-account-adapter.test.ts test/app/auth.test.ts } finally { Pop-Location }
```

Expected: PASS; failed commands leave no partial grant, revocation, or account state.

---

### Task 6: Share Transactional Master-Data Commands and Add the White-Listed Adapter

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/transactional-master-data-commands.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/organization-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/position-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/professional-team-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/adapters/master-data-adapter.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/master-data-adapter.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/organization-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/position-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/professional-team-service.test.ts`

**Interfaces:**
- Produces: transaction-aware organization/position/team update and status commands shared by ordinary services and governance.
- Consumed by: Task 7.

- [ ] **Step 1: Add characterization tests before refactoring**

Lock current root-organization protection, dependency checks, version conflicts, status transitions, allowed metadata normalization, and audit output for all three services.

- [ ] **Step 2: Extract transactional command functions**

Export exact functions that accept `Prisma.TransactionClient`, target ID, normalized input, and `AuditActor`:

```ts
export function updateOrganizationTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, input: { sort: number; version: number }): Promise<OrganizationView>;
export function setOrganizationStatusTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, status: MasterDataStatus, version: number): Promise<OrganizationView>;
export function updatePositionTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, input: { responsibilities: string | null; version: number }): Promise<PositionView>;
export function setPositionStatusTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, status: MasterDataStatus, version: number): Promise<PositionView>;
export function updateProfessionalTeamTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, input: { description: string | null; version: number }): Promise<ProfessionalTeamDetail>;
export function setProfessionalTeamStatusTx(tx: Prisma.TransactionClient, actor: AuditActor, id: string, status: MasterDataStatus, version: number): Promise<ProfessionalTeamDetail>;
```

Existing services keep authorization and input parsing, then call these functions inside their current transaction.

- [ ] **Step 3: Implement strict governance payloads**

`MASTER_DATA_METADATA_CORRECTION` accepts exactly one of Organization `sort`, Position `responsibilities`, or ProfessionalTeam `description`. `MASTER_DATA_STATUS_CORRECTION` accepts Organization, Position, or ProfessionalTeam and target status `ENABLED|DISABLED`. Reject Employee and every unknown field.

- [ ] **Step 4: Implement adapter execution through shared functions**

The adapter constructs `AuditActor` from the requester and governance request ID, invokes the matching shared transaction function, and returns only stable non-sensitive before/after fields.

- [ ] **Step 5: Run regression and adapter tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/master-data/organization-service.test.ts test/master-data/position-service.test.ts test/master-data/professional-team-service.test.ts test/admin-governance/master-data-adapter.test.ts } finally { Pop-Location }
```

Expected: PASS; ordinary API behavior remains unchanged and governance cannot address any field outside the white list.

---

### Task 7: Implement Request, Review, Execution, Cancel, and Resume Services

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-execution-runner.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-command-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-review-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-event-sink.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-factory.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-command-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-review-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/governance-concurrency.test.ts`

**Interfaces:**
- Produces: complete governance application API used by HTTP and CLI-adjacent tests.
- Consumed by: Tasks 9-12.

- [ ] **Step 1: Write failing end-to-end service tests**

Cover HIGH inert before review, LOW immediate execution and post-review, self-review rejection, target-reviewer conflict, rejection comments, flag comments, cancel, idempotent create, payload-hash check, target version check, concurrent reviewers, execution failure, and APPROVED resume.

- [ ] **Step 2: Implement operation creation**

```ts
export class GovernanceCommandService {
  create(context: AuthorizationContext, raw: unknown): Promise<AdminOperationDetailView>;
  cancel(context: AuthorizationContext, id: string, raw: unknown): Promise<AdminOperationDetailView>;
}
```

Resolve risk and review mode only from the catalog. Validate requester role, adapter payload, expected target version, idempotency, and CRITICAL confirmation phrase. The factory injects a database name parsed from the configured PostgreSQL URL; the service computes the exact phrase from that value, operation type, and current target username. PRE creates `PENDING_REVIEW`. LOW executes in one transaction and ends `PENDING_POST_REVIEW`; if execution rolls back, persist a separate FAILED record with no business change.

- [ ] **Step 3: Implement independent review decisions**

```ts
export class GovernanceReviewService {
  review(context: AuthorizationContext, id: string, raw: unknown): Promise<AdminOperationDetailView>;
  resume(context: AuthorizationContext, id: string, raw: unknown): Promise<AdminOperationDetailView>;
}
```

Require current super-admin, reject requester/reviewer equality and reviewer-target conflicts, validate expected operation version, append exactly one review record, and enforce valid decision for the current state.

- [ ] **Step 4: Implement the execution runner**

Lock the operation, recheck payload hash, load the code-owned adapter, compare target version, allocate `attemptNo`, execute the adapter, append success execution, transition final status, and write `OperationLog` in one transaction. On failure, use a separate transaction to append a sanitized failed execution and set `FAILED` only if no business transaction committed.

- [ ] **Step 5: Implement resume semantics**

`resume` permits `APPROVED` only when no execution attempt succeeded, or `FAILED` only when the catalog and failure are retryable. Concurrent resume calls use row/version locking so one executes and the other receives `OPERATION_ALREADY_PROCESSED`.

- [ ] **Step 6: Emit stable structured governance events**

Define an injectable `GovernanceEventSink` whose payload contains only `eventType`, `operationId`, `operationType`, `riskLevel`, `status`, `resultCode`, and `requestId`. Emit on create, review, execution success/failure, resume rejection, self-review rejection, last-admin protection, and post-review flag. The Egg factory maps the sink to `ctx.logger.info`; tests use an in-memory collector. Never include payload snapshots or reasons.

- [ ] **Step 7: Run serial database tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/admin-governance/governance-command-service.test.ts test/admin-governance/governance-review-service.test.ts test/admin-governance/governance-concurrency.test.ts } finally { Pop-Location }
```

Expected: PASS; concurrency tests prove exactly one review and one successful mutation.

---

### Task 8: Add the Second-Super-Admin Recovery CLI

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/second-super-admin-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/system/system-cli.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/add-second-super-admin.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Create: `LayerManage/law-firm-system/apps/server/test/system/second-super-admin-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/system/system-cli.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/bootstrap-contract.test.ts`

**Interfaces:**
- Produces: root command `npm run super-admin:add-second` and audit action `SUPER_ADMIN_SECOND_SEAT_RECOVERY`.
- Consumed by: operations documentation and acceptance.

- [ ] **Step 1: Write failing service and CLI tests**

Cover no initialization, zero admins, exactly one admin, two admins, wrong actor password, disabled actor, missing target, disabled target, existing target grant, reason length, exact confirmation, concurrent invocation, and audit redaction.

- [ ] **Step 2: Implement credential re-verification and locked count check**

The service accepts:

```ts
export interface AddSecondSuperAdminInput {
  actorUsername: string;
  actorPassword: string;
  targetUsername: string;
  reason: string;
  confirmation: string;
}
```

Verify the actor is the sole active super-admin using `PasswordHasher.compare`, then enter a serializable transaction, take an advisory lock, reload the actor, and verify that status, password hash, credential version, and sole-admin grant are unchanged. Recalculate the active count, create a `UserRole` with `source='RECOVERY'`, and append one audit row. Never persist or echo actor password or confirmation.

- [ ] **Step 3: Implement the interactive CLI**

Prompt database target, actor username, hidden actor password, target username, reason, and exact `ADD SECOND SUPER ADMIN <database> <target>` confirmation. Reject piped missing input and print only a stable success/failure summary.

- [ ] **Step 4: Register scripts and package inputs**

Add `super-admin:add-second` at server and root. Extend package/build contract tests so the compiled script is present without bundling `.env`.

- [ ] **Step 5: Run CLI and regression tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/system/second-super-admin-service.test.ts test/system/system-cli.test.ts test/system/super-admin-recovery-service.test.ts test/ci/bootstrap-contract.test.ts } finally { Pop-Location }
```

Expected: PASS; SPEC-002 recovery remains distinct and green.

---

### Task 9: Expose Thin Governance HTTP APIs

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/controller/adminGovernance.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/admin-governance-api.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/spec-005-router-contract.test.ts`

**Interfaces:**
- Produces: the seven approved `/api/v1/admin-governance` endpoints with standard response envelopes.
- Consumed by: frontend and acceptance tests.

- [ ] **Step 1: Write failing router and API tests**

Assert every route declares its permission, ordinary users receive 403, system admins see only self scope, super-admins see reviewable/all scopes, client-supplied risk/reviewer/status fields return 400, and stable governance errors are returned without stacks.

- [ ] **Step 2: Add exact routes**

```ts
router.get('/api/v1/admin-governance/catalog', requirePermission('governance.catalog.read'), controller.adminGovernance.catalog);
router.post('/api/v1/admin-governance/operations', requirePermission('governance.operation.create'), controller.adminGovernance.create);
router.get('/api/v1/admin-governance/operations', controller.adminGovernance.index);
router.get('/api/v1/admin-governance/operations/:id', controller.adminGovernance.show);
router.post('/api/v1/admin-governance/operations/:id/review', requirePermission('governance.review'), controller.adminGovernance.review);
router.post('/api/v1/admin-governance/operations/:id/cancel', controller.adminGovernance.cancel);
router.post('/api/v1/admin-governance/operations/:id/retry', requirePermission('governance.retry'), controller.adminGovernance.retry);
```

Index/show/cancel perform service-level self/all authorization because one static route permission cannot express both views.

- [ ] **Step 3: Implement the thin controller**

Each method obtains `ctx.state.authorization`, delegates to one factory-created service, and returns `{ code: 200, message: 'success', data }`. No Prisma query, risk decision, state transition, snapshot manipulation, or adapter selection belongs in the controller.

- [ ] **Step 4: Run API tests**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/app/admin-governance-api.test.ts test/ci/spec-005-router-contract.test.ts test/app/authorization-middleware.test.ts } finally { Pop-Location }
```

Expected: PASS; no governance route is reachable without JWT authentication.

---

### Task 10: Add Frontend Governance Contracts, Authorization State, Route, and Menu

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/types.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/api.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/api.test.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/features/authorization/types.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/features/authorization/api.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/stores/authStore.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.test.tsx`

**Interfaces:**
- Produces: typed governance client, error labels, `isSystemAdmin`, `/security/admin-governance`, and permission-filtered navigation.
- Consumed by: Task 11.

- [ ] **Step 1: Write failing normalization, client, route, and menu tests**

Assert `isSystemAdmin` survives normalization, governance permission codes are accepted, menu appears only with `menu.admin_governance`, route requires `governance.catalog.read`, and API errors map to concise Chinese messages.

- [ ] **Step 2: Define frontend governance types**

Mirror backend string unions and define `GovernanceCatalogEntry`, `AdminOperationSummary`, `AdminOperationDetail`, `AdminOperationReview`, `AdminOperationExecution`, `GovernancePage<T>`, `CreateGovernanceOperationInput`, and `ReviewGovernanceOperationInput`. Do not use `any`.

- [ ] **Step 3: Implement the API client**

Expose `catalog`, `list`, `detail`, `create`, `review`, `cancel`, and `retry`. Add labels for every error in Spec section 17; unknown server codes remain visible for support diagnosis.

- [ ] **Step 4: Extend authorization types and state**

Add the eight permission codes and `isSystemAdmin` to raw/normalized summaries. Keep authorization expiry derived from grant validity.

- [ ] **Step 5: Register route and menu**

Import `AdminGovernancePage`, add `/security/admin-governance` through `AuthorizedPage permission="governance.catalog.read"`, add `SafetyCertificateOutlined` navigation under the security group, and add the breadcrumb name “管理员治理”.

- [ ] **Step 6: Run frontend contract tests**

```powershell
Push-Location apps/web
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- vitest run src/features/admin-governance/api.test.ts src/App.test.tsx src/components/Layout/index.test.tsx src/stores/authStore.test.ts } finally { Pop-Location }
```

Expected: PASS with no new React Hook warning.

---

### Task 11: Build the Administrator Governance Workbench

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/components/OperationCreateDrawer.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/components/OperationDetailDrawer.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/components/ReviewDialog.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/admin-governance/governance.css`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/AdminGovernance/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/AdminGovernance/index.test.tsx`

**Interfaces:**
- Produces: usable My Requests, Pending Review, and All Records workflows.
- Consumed by: Task 12 browser acceptance.

- [ ] **Step 1: Write failing user-flow tests**

Test system-admin tabs, super-admin tabs, catalog-driven forms, exact white-list fields, CRITICAL confirmation, self-review absence, required rejection/flag comments, cancel, retry/resume visibility, detail timeline, loading, empty, and API-error states.

- [ ] **Step 2: Build the compact workbench page**

Use Ant Design `Tabs`, `Table`, `Select`, `DatePicker`, `Tag`, and icon buttons. Keep filters in one toolbar; tables use stable widths and horizontal scroll below 900px. Do not add nested cards or feature-explanation text.

- [ ] **Step 3: Build the catalog-driven create drawer**

Render operation-specific forms with target selectors from existing user/organization/position/team read APIs. Render only Organization `sort`, Position `responsibilities`, and ProfessionalTeam `description` for LOW metadata. Compute a UUID idempotency key once when the drawer opens and preserve it across failed submissions.

- [ ] **Step 4: Build detail and review interactions**

Display immutable request metadata, before/after descriptions, reviews, executions, and timeline. Use icon buttons with tooltips for refresh, cancel, review, and retry. CRITICAL confirmation displays database label, operation, target username, and exact phrase without placing secrets in state persistence.

- [ ] **Step 5: Add responsive styling**

Use a full-width work area, no card nesting, 8px-or-less radii, fixed action-column widths, wrapped long operation numbers, and mobile drawer width `100%`. Keep letter spacing zero and avoid viewport-scaled fonts.

- [ ] **Step 6: Run component tests, typecheck, and build**

```powershell
Push-Location apps/web
try {
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- vitest run src/pages/AdminGovernance/index.test.tsx src/features/admin-governance/api.test.ts
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run typecheck
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run build
} finally { Pop-Location }
```

Expected: PASS; no overflow or Hook warning introduced by SPEC-005 files.

---

### Task 12: Close the Acceptance Loop, Runbook, and Local Evidence

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/test/acceptance/spec-005-acceptance.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/test/seed-spec-005-browser.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/admin-governance/browser-fixture.test.ts`
- Create: `docs/superpowers/runbooks/admin-governance-super-admin-review.md`
- Create: `docs/superpowers/reports/spec-005-closeout.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Produces: executable acceptance evidence, operator instructions, visual artifacts, and a restart-safe local closeout.

- [ ] **Step 1: Write the failing acceptance suite**

Create one serial PostgreSQL suite covering: second-seat CLI service; two-person system-admin grant/revoke; self-review rejection; high-risk inertness; low-risk post-review; concurrent review; stale target; last-super-admin protection; duplicate idempotency; payload tamper rejection; failed transaction rollback; audit timeline; and ordinary-user denial.

- [ ] **Step 2: Run acceptance RED, then correct failures in the owning boundary**

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/acceptance/spec-005-acceptance.test.ts } finally { Pop-Location }
```

Expected first run: FAIL only where assembled boundaries disagree. Route/envelope failures belong to Task 9 files; state/idempotency/concurrency failures belong to Task 7 files; role/account failures belong to Task 5 files; master-data failures belong to Task 6 files; persistence failures belong to Task 1 or Task 4 files. After each correction, rerun that task's focused test command and then this acceptance command until PASS.

- [ ] **Step 3: Write the operator runbook**

Document prerequisites, migration deployment, first system bootstrap, SPEC-002 credential recovery, second-seat recovery, normal administrator grant/revoke, failed-operation resume, audit lookup, rollback-by-explicit-compensation, and emergency stop. Include exact PowerShell commands and expected prompts; never include real secrets.

- [ ] **Step 4: Run complete automated verification**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run verify
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run security:audit:prod
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run security:audit:all
```

Expected: all commands exit 0. Record exact backend, frontend, security, and acceptance test counts plus any unchanged baseline warnings.

- [ ] **Step 5: Add a guarded browser fixture and test it**

The fixture must call `assertTestDatabaseUrl`, require `SPEC005_BROWSER_PASSWORD` from the process environment, hash it with the production password hasher, and use bootstrap/governance application services to seed two super-admins, one system-admin, three master-data targets, and representative PRE/POST governance records. Direct Prisma writes are allowed only for deterministic prerequisite users and target master data that have no public fixture service. It must print usernames and operation IDs but never print the password or connection string. The fixture refuses every database not ending in `_test`.

```powershell
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/admin-governance/browser-fixture.test.ts } finally { Pop-Location }
```

Expected: PASS for `_test`; explicit rejection for a non-test URL.

- [ ] **Step 6: Perform browser acceptance**

Reset the test database, set an ephemeral `SPEC005_BROWSER_PASSWORD`, run the guarded fixture, start the server with `DATABASE_URL=$env:DATABASE_URL_TEST`, and start the web app. Open `http://localhost:3000/security/admin-governance`, then use Playwright at desktop `1440x900` and mobile `390x844`. Capture My Requests, Pending Review, create drawer, detail timeline, CRITICAL confirmation, and mobile navigation. Verify no overlap, clipped text, blank panels, or unauthorized action buttons.

Save screenshots under:

```text
docs/superpowers/reports/artifacts/spec-005/
```

- [ ] **Step 7: Reset and prove the test database is empty**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:assert-empty
```

Expected: all application tables are empty. Restore the development `DATABASE_URL` in the terminal before any later command.

- [ ] **Step 8: Write closeout evidence and update the index**

Record environment versions, migration status, exact test counts, browser viewport evidence, empty-database result, known residual risks, and the explicit statement that no Git or GitHub operation was performed. Mark SPEC-005 complete in `docs/superpowers/README.md` only after every prior step passes.

## Final Review Checklist

- [ ] Every requirement in the approved SPEC-005 maps to a task and automated or browser acceptance.
- [ ] `Approval` schema, controller, routes, client, and page remain behaviorally unchanged.
- [ ] `SYSTEM_ADMIN` cannot review, retry, see all operations, mutate system roles directly, or inherit future permissions.
- [ ] Direct user update/delete routes cannot mutate active system administrators or super-admins.
- [ ] All eight operation types have a code-owned catalog entry and adapter.
- [ ] Employee status is not accepted by the generic master-data adapter.
- [ ] PRE operations do not mutate before approval; POST operations enter `PENDING_POST_REVIEW` only after commit.
- [ ] `APPROVED` operations with no attempt can resume after interruption without duplicate mutation.
- [ ] Last-super-admin count is recalculated under transaction lock.
- [ ] Failed execution never claims success and never leaves partial business data.
- [ ] Snapshot, error, audit, UI, and screenshot artifacts contain no secret or L4 raw value.
- [ ] Complete verification and empty `_test` database gates pass under Node 22.14.0 and PostgreSQL 16.
- [ ] No Git or GitHub operation was performed.

## Local Execution Strategy

Default to `superpowers:executing-plans` in the current task because Tasks 1-9 share one evolving schema and service contract. Do not dispatch a subagent for ordinary implementation. A subagent is justified only for an independent final review or visual acceptance after the shared implementation is stable.
