# SPEC-004 RBAC, Data Scope, and Sensitive Permissions Implementation Plan

> **Execution status (2026-07-19):** All local implementation, migration, test, security, browser, documentation, and empty-database gates are complete. Git commit steps were dispositioned as not applicable under the project owner's standing instruction to perform no Git operations during local development. See `docs/superpowers/reports/spec-004-closeout.md` for exact evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this Plan task-by-task. Use a subagent only when a later review identifies a genuinely independent task whose isolation saves time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary super-admin-only master-data gate with a real-time, explainable authorization platform covering action permissions, data scopes, field security, temporary grants, reporting lines, and the current organization/personnel UI.

**Architecture:** Keep LayerManage as an Egg.js + Prisma modular monolith. Build one authorization context per authenticated request, enforce action permissions at the route boundary, inject structured scope predicates inside application services, and project sensitive fields through a central field-security service. Preserve the SPEC-002 trust root, use PostgreSQL constraints as the second line of defense, and leave administrator review/governance to SPEC-005.

**Tech Stack:** Node.js 22.14.0, npm 10.9.2, TypeScript, Egg.js 3, Prisma 5.22, PostgreSQL 16 with `btree_gist`, React 19, Ant Design 6, Zustand, Node test runner, Vitest, Testing Library, Playwright 1.55.1, Docker Desktop.

## Global Constraints

- Start implementation in a new isolated worktree and local branch `codex/spec-004-rbac-data-scope` based on the commit containing this Plan; do not implement on the completed SPEC-003 branch.
- Do not configure a Git remote, push to GitHub, create a pull request, or record remote CI as passed.
- Run repository commands through `npx.cmd -y -p node@22.14.0 -p npm@10.9.2`.
- Use PostgreSQL 16 at `localhost:55432`; destructive test commands may target only a database whose name ends in `_test` and require `ALLOW_TEST_DB_RESET=true`.
- Never commit `.env`, credentials, tokens, database files, audit exports, generated SBOMs, logs, test-results, Playwright reports, or generated distributions.
- Do not add Casbin, OPA, an external policy service, a permission cache, a background expiry worker, or configurable explicit `DENY` policies.
- Do not implement `SYSTEM_ADMIN`, administrator self-review, high-risk approval, post-review, configuration publishing, data intervention, or rollback; those belong to SPEC-005.
- Do not automatically create business roles, organizations, employees, teams, scopes, demo grants, or reporting lines. Permission catalog rows are system metadata and are the only migration-created authorization records.
- Preserve the SPEC-002 root organization, first-super-admin user ID, `SYSTEM_SUPER_ADMIN` role, initialization singleton, forced password change, recovery, credential invalidation, and trust-root protections.
- `SYSTEM_SUPER_ADMIN` receives all registered actions and `ALL` scope only through the central authorization service; it never bypasses field projection, L4 access-purpose validation, audit, transaction, or version checks.
- Authorization combination is fixed: each grant is `action AND scope AND validity`; valid grants combine by record-set union; account/role state, explicit field `NONE`, special permissions, and L4 purpose/audit are hard gates.
- No authorization or reporting-history record is physically deleted through business APIs.
- Permission codes, resource codes, field codes, scope types, risk levels, and audit actions are stable code-owned values. UI users may configure mappings, not invent runtime API permissions.
- Every write that accepts `version` uses optimistic locking and returns `VERSION_CONFLICT` without partial writes.
- All authorization and reporting-line mutations write sanitized `OperationLog` entries in the same transaction; sensitive reads return no raw value if access-audit writing fails.
- The final Prisma schema has 32 models: the existing 26 plus `DataScope`, `DataScopeTarget`, `RoleDataScope`, `FieldPermission`, `UserPermissionGrant`, and `EmployeeReportingLine`.
- The existing 9 React Hook warnings and Vite chunk warning must not increase. Every modified SPEC-004 page must have no Hook warning.
- Each task ends with focused green tests and one local commit. Local commits are recovery points, not GitHub operations.
- Before each task commit, stage every path listed in that task's **Files** section, run `git diff --cached --check`, inspect `git status --short`, and verify that no unrelated or generated artifact is staged. Commit snippets below show the required message; they do not replace this staging gate.

## Execution Environment

Use this PowerShell preamble for database-backed commands from `LayerManage/law-firm-system`:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa?schema=public'
$env:DATABASE_URL_TEST = 'postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:JWT_SECRET = '01234567890123456789012345678901'
$env:APP_KEYS = 'local_test_application_key_number_one,local_test_application_key_number_two'
$env:ALLOW_TEST_DB_RESET = 'true'
```

Install and verify the isolated worktree before Task 1:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run verify
```

Expected baseline: 430 backend tests, 33 web tests, 34 dependency-security tests, builds and policy checks pass; no new warnings. If the baseline fails, stop and investigate before editing.

## Planned File Structure

```text
apps/server/app/domain/authorization/
  authorization-errors.ts       stable errors
  authorization-types.ts        codes and shared value types
  authorization-validation.ts   strict DTO/value validation
  permission-catalog.ts          immutable permission/resource/field catalog
  data-scope-policy.ts           scope-shape and grant-combination rules
  field-security-policy.ts       classification and masking rules

apps/server/app/application/authorization/
  authorization-context-loader.ts
  authorization-service.ts
  data-scope-service.ts
  field-projection-service.ts
  sensitive-access-service.ts
  role-authorization-service.ts
  user-grant-service.ts
  permission-trace-service.ts
  authorization-audit.ts
  authorization-factory.ts

apps/server/app/application/master-data/
  employee-reporting-line-service.ts

apps/server/app/middleware/
  authorizationContext.ts
  requirePermission.ts

apps/web/src/features/authorization/
  api.ts
  types.ts
  PermissionRoute.tsx
  authorization.css
  components/*

apps/web/src/pages/
  SecurityRole/index.tsx
  SecurityUser/index.tsx
  PermissionTrace/index.tsx
  MyAccess/index.tsx
```

---

### Task 1: Expand the Authorization Schema and Install the Immutable Catalog

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260718210000_authorization_expand/migration.sql`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-types.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/permission-catalog.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-004-expand-migration-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/permission-catalog.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/system/system-bootstrap-service.test.ts`

**Interfaces:**
- Produces: final authorization Prisma models, `PermissionCode`, `ResourceCode`, `FieldCode`, `PERMISSION_CATALOG`, and the expanded migration state.
- Consumed by: every later task.

- [x] **Step 1: Write failing schema, migration, and catalog tests**

Add exact assertions:

```ts
test('adds the six SPEC-004 models and final model count', () => {
  for (const model of ['DataScope', 'DataScopeTarget', 'RoleDataScope', 'FieldPermission', 'UserPermissionGrant', 'EmployeeReportingLine']) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 32);
  assert.match(schema, /version\s+Int\s+@default\(1\)/);
});

test('expand migration installs interval and current-relation constraints', () => {
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS btree_gist/i);
  assert.match(sql, /EXCLUDE USING gist[\s\S]+tstzrange/i);
  assert.match(sql, /employee_reporting_line_one_current_manager/i);
  assert.doesNotMatch(sql, /INSERT INTO "(?:organization|employee|professional_team|data_scope|role)"/i);
});

test('catalog contains unique immutable codes and only approved types', () => {
  assert.equal(new Set(PERMISSION_CATALOG.map(item => item.code)).size, PERMISSION_CATALOG.length);
  assert.ok(PERMISSION_CATALOG.every(item => ['MENU', 'ACTION', 'SPECIAL'].includes(item.type)));
  assert.ok(PERMISSION_CATALOG.some(item => item.code === 'organization.read'));
  assert.ok(PERMISSION_CATALOG.some(item => item.code === 'employee.high_sensitive.read'));
});
```

- [x] **Step 2: Run focused tests and confirm RED**

```powershell
Push-Location apps/server
try {
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/spec-004-expand-migration-contract.test.ts test/authorization/permission-catalog.test.ts
} finally { Pop-Location }
```

Expected: imports/models/migration missing and model count remains 26.

- [x] **Step 3: Define exact authorization value types and catalog**

```ts
export type PermissionType = 'MENU' | 'ACTION' | 'SPECIAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ScopeType = 'ALL' | 'HQ_SCOPE' | 'ORG' | 'BRANCH' | 'TEAM' | 'SELF_AND_SUBORDINATES' | 'SELF' | 'CUSTOM';
export type FieldReadLevel = 'NONE' | 'MASKED' | 'READ';
export type DataClassification = 'L1' | 'L2' | 'L3' | 'L4' | 'FORBIDDEN';

export const PERMISSION_CODES = [
  'menu.organization_personnel', 'menu.organization', 'menu.position', 'menu.employee',
  'menu.professional_team', 'menu.security_my_access', 'menu.security_roles',
  'menu.security_users', 'menu.security_trace',
  'organization.read', 'organization.create', 'organization.update', 'organization.move', 'organization.status.manage',
  'position.read', 'position.create', 'position.update', 'position.status.manage',
  'employee.read', 'employee.create', 'employee.update', 'employee.formalize', 'employee.leave',
  'employee.assignment.read', 'employee.assignment.manage',
  'employee.reporting_line.read', 'employee.reporting_line.manage',
  'employee.account_binding.read', 'employee.account_binding.manage',
  'professional_team.read', 'professional_team.create', 'professional_team.update',
  'professional_team.status.manage', 'professional_team.member.manage', 'professional_team.lead.manage',
  'user.read', 'user.create', 'user.update', 'user.status.manage',
  'role.read', 'role.create', 'role.update', 'role.status.manage', 'role.permission.manage', 'user.role.manage',
  'permission.catalog.read', 'permission.trace.self', 'permission.trace.any', 'temporary_grant.manage',
  'employee.sensitive.read', 'employee.high_sensitive.read', 'employee.sensitive.export',
  'customer.merge', 'contract.void', 'payment.confirm', 'refund.approve', 'matter.intervene',
  'file.sensitive.download', 'data.bulk_export', 'config.publish', 'config.high_risk.change',
] as const;

export type PermissionCode = typeof PERMISSION_CODES[number];
```

Build `PERMISSION_CATALOG` from explicit entries whose IDs are semantic stable strings such as `permission:organization.read`. Define type, resource, action, display name, risk level, and status for every code above. Mark all nine future business codes `SPECIAL`; do not add route mappings for them.

- [x] **Step 4: Add the expanded Prisma models**

Add `version` to Role and Permission, add `resource`, `action`, `riskLevel`, and `updatedAt` to Permission, replace the prototype UserRole shape with the exact history-preserving grant model below, and add the six new models with inverse relations on User, Role, Permission, Organization, Employee, and ProfessionalTeam:

```prisma
model UserRole {
  id              String   @id @default(uuid())
  userId          String
  roleId          String
  source          String   @default("PERMANENT")
  validFrom       DateTime @default(now())
  validUntil      DateTime?
  reason          String?
  grantedByUserId String?
  revokedAt       DateTime?
  revokedByUserId String?
  revokeReason    String?
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User     @relation("AssignedUserRoles", fields: [userId], references: [id], onDelete: Restrict)
  role            Role     @relation(fields: [roleId], references: [id], onDelete: Restrict)
  grantedBy       User?    @relation("RoleGrantedBy", fields: [grantedByUserId], references: [id], onDelete: Restrict)
  revokedBy       User?    @relation("RoleRevokedBy", fields: [revokedByUserId], references: [id], onDelete: Restrict)
  @@index([userId, validFrom, validUntil])
  @@index([roleId, validFrom, validUntil])
  @@map("user_role")
}

model DataScope {
  id                 String   @id @default(uuid())
  name               String
  scopeType          String
  includeDescendants Boolean  @default(false)
  organizationId     String?
  professionalTeamId String?
  status             String   @default("ENABLED")
  version            Int      @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  organization       Organization?     @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  professionalTeam   ProfessionalTeam? @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict)
  targets            DataScopeTarget[]
  roleBindings       RoleDataScope[]
  userGrants         UserPermissionGrant[]
  @@index([scopeType, status])
  @@map("data_scope")
}

model DataScopeTarget {
  id                 String @id @default(uuid())
  dataScopeId        String
  organizationId     String?
  professionalTeamId String?
  employeeId         String?
  dataScope          DataScope         @relation(fields: [dataScopeId], references: [id], onDelete: Restrict)
  organization       Organization?     @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  professionalTeam   ProfessionalTeam? @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict)
  employee           Employee?         @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  @@index([dataScopeId])
  @@map("data_scope_target")
}

model RoleDataScope {
  id          String @id @default(uuid())
  roleId      String
  resource    String
  dataScopeId String
  role        Role      @relation(fields: [roleId], references: [id], onDelete: Restrict)
  dataScope   DataScope @relation(fields: [dataScopeId], references: [id], onDelete: Restrict)
  @@unique([roleId, resource, dataScopeId])
  @@index([roleId, resource])
  @@map("role_data_scope")
}

model FieldPermission {
  id        String  @id @default(uuid())
  roleId    String
  resource  String
  fieldCode String
  readLevel String
  canWrite  Boolean @default(false)
  canExport Boolean @default(false)
  version   Int     @default(1)
  role      Role    @relation(fields: [roleId], references: [id], onDelete: Restrict)
  @@unique([roleId, resource, fieldCode])
  @@map("field_permission")
}

model UserPermissionGrant {
  id              String   @id @default(uuid())
  userId          String
  permissionId    String
  dataScopeId     String
  validFrom       DateTime
  validUntil      DateTime
  reason          String
  grantedByUserId String
  revokedAt       DateTime?
  revokedByUserId String?
  revokeReason    String?
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User       @relation("PermissionGrantUser", fields: [userId], references: [id], onDelete: Restrict)
  permission      Permission @relation(fields: [permissionId], references: [id], onDelete: Restrict)
  dataScope       DataScope  @relation(fields: [dataScopeId], references: [id], onDelete: Restrict)
  grantedBy       User       @relation("PermissionGrantedBy", fields: [grantedByUserId], references: [id], onDelete: Restrict)
  revokedBy       User?      @relation("PermissionRevokedBy", fields: [revokedByUserId], references: [id], onDelete: Restrict)
  @@index([userId, validFrom, validUntil])
  @@map("user_permission_grant")
}

model EmployeeReportingLine {
  id                String   @id @default(uuid())
  employeeId        String
  managerEmployeeId String
  startedAt         DateTime
  endedAt           DateTime?
  version           Int      @default(1)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  employee          Employee @relation("ReportingLineEmployee", fields: [employeeId], references: [id], onDelete: Restrict)
  manager           Employee @relation("ReportingLineManager", fields: [managerEmployeeId], references: [id], onDelete: Restrict)
  @@index([employeeId, endedAt])
  @@index([managerEmployeeId, endedAt])
  @@map("employee_reporting_line")
}
```

- [x] **Step 5: Write the expand SQL**

The migration must:

1. add new nullable/defaulted columns to Role, Permission, and UserRole;
2. backfill existing UserRole rows as `PERMANENT` with `validFrom=createdAt` (add `createdAt` first if absent);
3. map recognized Permission codes and set unknown prototype rows to `resource='legacy'`, `action='disabled'`, `status='DISABLED'`;
4. create the six tables and all foreign keys with `RESTRICT`;
5. create `btree_gist` and exclusion constraints using `[)` timestamp ranges for unrevoked UserRole and UserPermissionGrant rows;
6. create the current-manager partial unique index on EmployeeReportingLine;
7. add check constraints for scope shape, exactly-one custom target, date ordering, and no self-manager;
8. insert every `PERMISSION_CATALOG` entry with semantic ID and `ON CONFLICT (code) DO UPDATE` limited to code-owned metadata;
9. create no RolePermission rows and no business roles/scopes/grants.

- [x] **Step 6: Reset, generate, and verify GREEN**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run typecheck
Push-Location apps/server
try { npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/spec-004-expand-migration-contract.test.ts test/authorization/permission-catalog.test.ts test/system/system-bootstrap-service.test.ts } finally { Pop-Location }
```

Expected: migration applies, model count is 32, catalog is exact, bootstrap still creates only the root, protected role, user, link, initialization, and audit.

- [x] **Step 7: Commit locally** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

```powershell
git add LayerManage/law-firm-system/apps/server/prisma LayerManage/law-firm-system/apps/server/app/domain/authorization LayerManage/law-firm-system/apps/server/test
git commit -m "feat(db): expand SPEC-004 authorization schema"
```

### Task 2: Add Authorization Errors, Validation, Policies, and Sanitized Audit

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-validation.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/data-scope-policy.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/authorization/field-security-policy.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-audit.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/authorization-validation.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/data-scope-policy.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/field-security-policy.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/authorization-audit.test.ts`

**Interfaces:**
- Produces: `AuthorizationError`, strict DTO parsers, scope-shape validation, field catalog/masking, and `writeAuthorizationAudit()`.
- Consumed by: Tasks 3-16.

- [x] **Step 1: Write failing domain tests**

Cover exact codes, 10-500 character grant reasons, 10-200 character L4 purposes, 90-day role limits, 30-day special-grant limits, strict unknown-key rejection, scope target rules, and deterministic masks:

```ts
assert.equal(maskField('employee.phone', '13800001234'), '138****1234');
assert.equal(maskField('employee.email', 'lawyer@example.com'), 'l***@example.com');
assert.equal(maskField('employee.licenseNo', 'LICENSE123456'), 'LIC***3456');
assert.throws(() => parseAccessPurpose('short'), hasCode('ACCESS_PURPOSE_REQUIRED'));
assert.throws(() => validateScope({ scopeType: 'SELF', organizationId: 'org' }), hasCode('AUTHORIZATION_INPUT_INVALID'));
```

- [x] **Step 2: Run tests and confirm RED**

Run the four new test files. Expected: imports fail.

- [x] **Step 3: Implement stable errors and strict validation**

```ts
export class AuthorizationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'AuthorizationError';
  }
}

export const AUTHORIZATION_CODES = {
  input: 'AUTHORIZATION_INPUT_INVALID', permission: 'PERMISSION_DENIED',
  scope: 'DATA_SCOPE_DENIED', field: 'FIELD_PERMISSION_DENIED',
  special: 'SPECIAL_PERMISSION_REQUIRED', escalation: 'PRIVILEGE_ESCALATION_BLOCKED',
  hidden: 'RESOURCE_NOT_FOUND_OR_FORBIDDEN', purpose: 'ACCESS_PURPOSE_REQUIRED',
} as const;
```

Use exact-key parsers. Never pass raw parser values or Prisma errors into the public message.

- [x] **Step 4: Implement scope and field policy**

Define `validateScopeShape()`, `combineGrantRecordSets()` semantics, `FIELD_CATALOG`, and maskers. The catalog must classify every current field from Spec section 8.3 and mark password/security internals `FORBIDDEN`. Unknown employee identity fields default L3; unknown customer/case/contract/file/AI fields default L3 when later registered.

- [x] **Step 5: Implement sanitized audit**

```ts
export async function writeAuthorizationAudit(
  tx: Prisma.TransactionClient,
  input: { actorUserId: string; action: string; targetType: string; targetId: string; changes: Record<string, unknown>; ip?: string },
): Promise<void> {
  await writeAuditLog(tx, {
    userId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    oldValues: null,
    newValues: JSON.stringify(sanitizeAuthorizationChanges(input.changes)),
    ip: input.ip,
  });
}
```

The allowlist contains IDs, codes, state, version, timestamps, scope type, field codes, counts, and explicit grant reason/purpose only. It excludes names and all business field values.

- [x] **Step 6: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run the four tests plus server lint/typecheck. Commit:

```powershell
git commit -m "feat(authz): define authorization policies and audit"
```

Stage newly created files explicitly before the commit.

### Task 3: Build the Real-Time Authorization Context and Action Guard

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-context-loader.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-factory.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/middleware/authorizationContext.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/middleware/requirePermission.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/extend/context.ts`
- Modify generated typings through Egg helper
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/authorization-context-loader.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/authorization-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/authorization-middleware.test.ts`

**Interfaces:**
- Produces: one `AuthorizationContext` per request, `requireAction()`, and route middleware `requirePermission(code)`.
- Consumed by: all protected routes and services.

- [x] **Step 1: Write failing context tests**

Test enabled/disabled account and role, not-started/expired/revoked grants, direct special grants, duplicate permission deduplication, no employee binding, and super-admin implicit grants. Freeze evaluation time at `2026-07-18T12:00:00Z`.

- [x] **Step 2: Write failing middleware tests**

Prove public routes are untouched, missing token remains 401, authenticated users without an action receive `PERMISSION_DENIED`, enabled grants reach the controller, and the request builds the context exactly once.

- [x] **Step 3: Run tests and confirm RED**

Expected: modules and middleware missing.

- [x] **Step 4: Implement bounded context loading**

Load user state, employee binding, active UserRole relations with role permissions/scopes/field rules, and active UserPermissionGrant relations. Filter validity with the injected `evaluatedAt`; do not use cached login permissions. Normalize into:

```ts
export interface EffectiveGrant {
  sourceType: 'SYSTEM_SUPER_ADMIN' | 'ROLE' | 'SPECIAL_GRANT';
  sourceId: string;
  permissionCode: PermissionCode;
  resource: string;
  scopeIds: string[];
  validUntil: Date | null;
}
```

Keep the loader query count bounded by nested Prisma includes, not one query per role.

- [x] **Step 5: Implement action guard and middleware order**

`authorizationContext` runs after `auth` for access-token routes and skips health/login/refresh/forced-change. `requirePermission(code)` reads the existing context and calls `requireAction`; it never trusts request bodies or `auth/me` state.

Change global middleware to:

```ts
config.middleware = ['errorHandler', 'auth', 'authorizationContext', 'masterDataAccess'];
```

Keep `masterDataAccess` until Task 13. Extend Egg state typing for `authorization` and regenerate helper types.

- [x] **Step 6: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run the three new test files, existing auth tests, lint, and typecheck. Commit:

```powershell
git commit -m "feat(authz): load real-time grants and enforce actions"
```

### Task 4: Implement Data-Scope Definitions and Resource Resolvers

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/data-scope-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/resource-scope-resolvers.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/data-scope-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/resource-scope-resolvers.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/authorization/authorization-service.ts`

**Interfaces:**
- Produces: `buildScopeWhere(context, resource, permissionCode)`, `requireRecord()`, and resolvers for current resources.
- Consumed by: Tasks 7-12.

- [x] **Step 1: Write failing tests for all eight scope types**

Create root, HQ centers, two branches, employees, assignments, a cross-office team, reporting relationships, and custom targets. Assert exact allow/deny sets for ALL, HQ_SCOPE, ORG with/without descendants, BRANCH, TEAM, SELF, SELF_AND_SUBORDINATES, and CUSTOM.

- [x] **Step 2: Write list/detail parity and union tests**

Assert a user with Branch A and Team X grants sees the set union without duplicate rows; a record excluded from list also fails `requireRecord`; a permission with no scope yields an empty record set.

- [x] **Step 3: Run and confirm RED**

- [x] **Step 4: Implement structured predicates**

Define resolver interfaces:

```ts
export interface ResourceScopeResolver<TWhere extends object> {
  resource: ResourceCode;
  buildWhere(input: ScopeResolutionInput): TWhere;
  findAuthorizedId(prisma: PrismaClientLike, where: TWhere, id: string): Promise<string | null>;
}
```

Create one typed resolver per Prisma resource using that resource's generated `WhereInput` type. Use Organization path boundary predicates, active assignments, active team membership, User.employeeId, and recursive reporting-line employee IDs. Return Prisma objects only; never interpolate SQL or filter loaded rows in Node.js.

- [x] **Step 5: Verify query bounds and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Assert two grants do not produce per-row queries and run focused tests. Commit:

```powershell
git commit -m "feat(authz): enforce organization team and self scopes"
```

### Task 5: Add Employee Reporting Lines for Subordinate Scope

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-reporting-line-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-types.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/employee-reporting-line-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/employee-service.test.ts`

**Interfaces:**
- Produces: create/replace/end/history/descendant operations and leave-time handover enforcement.
- Consumed by: scopes and API Task 9.

- [x] **Step 1: Write failing lifecycle tests**

Cover create, replace with history, end, stale version, missing/left/disabled references, self-manager, direct/indirect cycle, one concurrent winner, recursive descendants, and audit rollback.

- [x] **Step 2: Write failing leave handover tests**

An employee with current subordinates cannot leave until every subordinate is reassigned or ended. Leaving ends the employee's own subordinate relation in the existing leave transaction.

- [x] **Step 3: Run and confirm RED**

- [x] **Step 4: Implement the service**

Use a transaction and row lock on the subordinate employee. Cycle detection uses one recursive CTE and rejects any path returning to the subordinate. Never infer hierarchy from position names or role codes.

```ts
createOrReplace(employeeId: string, input: { managerEmployeeId: string; startedAt: Date; currentLineVersion?: number }): Promise<ReportingLineView>
end(employeeId: string, lineId: string, input: { endedAt: Date; version: number }): Promise<ReportingLineView>
list(employeeId: string): Promise<ReportingLineView[]>
descendantEmployeeIds(managerEmployeeId: string): Promise<string[]>
```

- [x] **Step 5: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run reporting-line, employee lifecycle, and scope tests. Commit:

```powershell
git commit -m "feat(master-data): add employee reporting lines"
```

### Task 6: Implement Field Projection and Purpose-Bound Sensitive Reads

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/field-projection-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/sensitive-access-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/field-projection-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/sensitive-access-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-projection.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/employee-primary-assignment-projection.test.ts`

**Interfaces:**
- Produces: L1-L4 projections, writable-field checks, and audited L4 employee reads.
- Consumed by: employee API integration and frontend.

- [x] **Step 1: Write failing projection tests**

Test default L2 read, L3 mask, L4 omission, READ override, independent canWrite/canExport, explicit NONE precedence, super-admin L3 audit, and forbidden-field removal.

- [x] **Step 2: Write failing L4 tests**

Test missing/short/long purpose, unauthorized field, unauthorized record, success, and injected audit failure. Verify normal Employee detail never contains raw idCard.

- [x] **Step 3: Run and confirm RED**

- [x] **Step 4: Implement field capabilities**

Build an effective field map only from roles that contribute an action grant. Apply default levels by classification, then explicit rules. `NONE` is a hard gate. Treat write and export as booleans independent of read level.

- [x] **Step 5: Implement sensitive read transaction**

```ts
viewEmployeeFields(input: {
  context: AuthorizationContext;
  employeeId: string;
  fieldCodes: Array<'employee.idCard'>;
  purpose: string;
  ip?: string;
}): Promise<Record<string, string | null>>
```

Authorize action, record scope, and field; write access audit and return values only when the audit transaction succeeds. No GET endpoint returns idCard.

- [x] **Step 6: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run the new tests, employee projection/service tests, and sensitive-value scans. Commit:

```powershell
git commit -m "feat(authz): project sensitive fields and audit L4 access"
```

### Task 7: Replace Role Prototype Logic with RoleAuthorizationService

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/role-authorization-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/role-authorization-service.test.ts`
- Modify later through Task 9: role controller and routes

**Interfaces:**
- Produces: role create/update/enable/disable and versioned replacement of actions, scopes, and fields.
- Consumed by: API and frontend Tasks 9/15.

- [x] **Step 1: Write failing role tests**

Cover immutable stable code, normalized unique code, no system role creation, no governance permission in business roles, invalid resource/scope/field combinations, explicit NONE, atomic replacements, stale version, role in use, sanitized audit, and audit rollback.

- [x] **Step 2: Run and confirm RED**

- [x] **Step 3: Implement role lifecycle**

```ts
create(input: CreateBusinessRoleInput): Promise<RoleAuthorizationView>
update(id: string, input: UpdateBusinessRoleInput & { version: number }): Promise<RoleAuthorizationView>
replacePermissions(id: string, input: { permissionCodes: PermissionCode[]; version: number }): Promise<RoleAuthorizationView>
replaceDataScopes(id: string, input: { bindings: ResourceScopeBindingInput[]; version: number }): Promise<RoleAuthorizationView>
replaceFieldPermissions(id: string, input: { fields: FieldPermissionInput[]; version: number }): Promise<RoleAuthorizationView>
disable(id: string, version: number): Promise<RoleAuthorizationView>
enable(id: string, version: number): Promise<RoleAuthorizationView>
```

Business roles cannot receive role/user authorization management, permission trace-any, temporary-grant management, config governance, or reserved system roles. Every replace operation locks Role, validates the complete replacement, writes rows, increments version once, and audits once.

- [x] **Step 4: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run focused tests and Prisma constraint race tests. Commit:

```powershell
git commit -m "feat(authz): manage versioned business role policies"
```

### Task 8: Implement User Grants and Explainable Permission Trace

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/user-grant-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/authorization/permission-trace-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/user-grant-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/authorization/permission-trace-service.test.ts`

**Interfaces:**
- Produces: permanent/temporary role grants, revocation, temporary SPECIAL grants, and self/any-user trace.
- Consumed by: API and frontend.

- [x] **Step 1: Write failing role-grant tests**

Cover permanent and <=90-day grants, overlap rejection, not-started and expired behavior, revocation history, concurrent overlap, self-modification block, reserved-role block, disabled user/role, and audit rollback.

- [x] **Step 2: Write failing special-grant tests**

Cover SPECIAL-only restriction, mandatory scope/reason, <=30-day period, overlap rejection, governance-code block, revocation, and immediate expiry.

- [x] **Step 3: Write failing trace tests**

Trace must show source type/id, permission, scope type/targets, field capability, validUntil, active/expired/revoked state, and stable refusal reason. `trace.self` cannot inspect another user; `trace.any` can. Do not return SQL predicates or sensitive business values.

- [x] **Step 4: Run and confirm RED**

- [x] **Step 5: Implement grants and trace**

Use database range exclusion constraints for race safety and map constraint errors to `AUTHORIZATION_IN_USE`. Revocation uses optimistic version and never deletes. Build trace from the same context loader and policy functions used by enforcement.

- [x] **Step 6: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run all authorization tests. Commit:

```powershell
git commit -m "feat(authz): grant temporary access and trace permission sources"
```

### Task 9: Expose Thin Authorization APIs and Remove Unsafe Legacy Mutations

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/controller/authorization.ts`
- Rewrite: `LayerManage/law-firm-system/apps/server/app/controller/role.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/user.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/permission.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/controller/employeeReportingLine.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/authorization-api.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/spec-004-router-contract.test.ts`

**Interfaces:**
- Produces: all Spec section 12 routes with strict DTOs and stable responses.
- Consumed by: frontend and E2E.

- [x] **Step 1: Write failing router-contract tests**

Require every new path/method, `requirePermission()` metadata, and absence of:

```text
DELETE /api/v1/roles/:id
POST /api/v1/users/:id/roles
POST /api/v1/roles/:id/permissions
```

- [x] **Step 2: Write failing API tests**

Test 401, action 403, hidden scope 404, strict DTO 400, version 409, success, trust-root protection, no raw errors, and no password/token/idCard in responses.

- [x] **Step 3: Run and confirm RED**

- [x] **Step 4: Implement thin controllers**

Controllers parse exact keys, call application services, and map stable errors. They do not query role/scope/field tables directly. Use `requirePermission('permission.code')` at route registration.

- [x] **Step 5: Regenerate Egg controller/middleware typings**

Run the repository's installed `ets` binary explicitly, then verify generated controllers include authorization and employeeReportingLine and middleware includes authorizationContext/requirePermission:

```powershell
Push-Location LayerManage/law-firm-system/apps/server
try {
  npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- ets
} finally { Pop-Location }
```

- [x] **Step 6: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run API/router tests, all authorization tests, server lint/typecheck. Commit:

```powershell
git commit -m "feat(api): expose protected authorization management endpoints"
```

### Task 10: Apply Formal Authorization to Organizations and Positions

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/organization-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/position-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-factory.ts`
- Modify: organization and position controllers/routes
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/organization-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/master-data/position-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/app/master-data-api.test.ts`

**Interfaces:**
- Produces: action/scope-enforced organization and position APIs.
- Consumed by: current UI and acceptance.

- [x] **Step 1: Write failing cross-branch tests**

For each resource, prove Branch A read/manage grants allow Branch A and descendants, reject Branch B, and return identical list/detail semantics. Test HQ_SCOPE, ORG without descendants, and super-admin.

- [x] **Step 2: Run and confirm RED**

- [x] **Step 3: Inject authorization into services**

List methods merge `buildScopeWhere` into existing filters. Detail/mutation methods resolve the authorized target before reading full fields. Create checks target-parent scope; move requires access to target subtree and new parent; position creation requires scope on owning organization.

- [x] **Step 4: Replace route actions**

Map exact permissions from Spec section 6.2. Keep `masterDataAccess` active globally while these routes also require formal permissions; this intentional double gate is removed only in Task 13.

- [x] **Step 5: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run organization/position service and API tests plus SPEC-003 performance test. Commit:

```powershell
git commit -m "feat(authz): scope organization and position operations"
```

### Task 11: Apply Formal Authorization to Employees, Assignments, Bindings, and Reporting Lines

**Files:**
- Modify: employee, employee-assignment, employee-account-binding, employee-reporting-line services/controllers/routes
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-projection.ts`
- Modify corresponding master-data and API tests

**Interfaces:**
- Produces: scoped employee lifecycle and field-projected employee responses.
- Consumed by: employee UI and E2E.

- [x] **Step 1: Write failing employee scope tests**

Cover employee in primary/secondary organization, TEAM grant, SELF, recursive subordinates, union without duplicates, history not granting access, scope outside mutation, and account binding.

- [x] **Step 2: Write failing field tests at API boundary**

Default employee detail masks phone/email/license and omits idCard; configured READ returns L3 raw and writes request audit; L4 only returns through sensitive-view POST with purpose. Forbidden security internals never appear.

- [x] **Step 3: Run and confirm RED**

- [x] **Step 4: Apply action/scope/field enforcement**

Create/update/formalize/leave/assignment/binding/reporting actions use exact permissions. Employee write DTO parsing calls `requireWritableFields` for every supplied field before the transaction. Project list and detail responses after query scope, never before authorization.

- [x] **Step 5: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run all employee, assignment, binding, reporting, field, API, auth, and trust-root tests. Commit:

```powershell
git commit -m "feat(authz): protect employee lifecycle and sensitive fields"
```

### Task 12: Apply Formal Authorization to Professional Teams and User Reads

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/app/application/master-data/professional-team-service.ts`
- Modify: professional-team controller/routes/tests
- Modify: user controller safe read/update paths and tests
- Modify: resource-scope resolver tests

**Interfaces:**
- Produces: TEAM-aware professional-team and user projections.
- Consumed by: UI and acceptance.

- [x] **Step 1: Write failing team and user scope tests**

Prove home-organization and TEAM grants, cross-office members, ended membership denial, current member SELF access, member/lead action boundaries, bound-user organization scope, and unbound user empty SELF scope.

- [x] **Step 2: Run and confirm RED**

- [x] **Step 3: Apply enforcement**

Team list/detail uses home organization OR active TEAM grant union. Member/lead changes require target team scope and authorized employee references. User list/detail uses bound employee ownership; unbound accounts are governance-only and visible to super-admin.

- [x] **Step 4: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run team/user, scope, API, and trust-root tests. Commit:

```powershell
git commit -m "feat(authz): scope professional teams and user projections"
```

### Task 13: Contract the Migration and Remove the Temporary Super-Admin Gate

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260718220000_authorization_contract/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Delete: `LayerManage/law-firm-system/apps/server/app/middleware/masterDataAccess.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Modify: generated middleware typing
- Modify: `LayerManage/law-firm-system/apps/server/test/app/master-data-access.test.ts` into formal authorization contract tests or delete after equivalent coverage exists
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-004-contract-migration.test.ts`
- Modify: schema/router/bootstrap contract tests

**Interfaces:**
- Produces: final 32-model schema, strict authorization constraints, no legacy gate or physical-delete/overwrite route.

- [x] **Step 1: Write failing final-contract tests**

Assert required columns are non-null where approved, unknown active permission metadata is impossible, catalog entries exist, exclusion/check constraints exist, masterDataAccess is absent, middleware order is `errorHandler/auth/authorizationContext`, every SPEC-003 route has formal permission middleware, and no role/grant physical-delete or overwrite route remains.

- [x] **Step 2: Run and confirm RED**

- [x] **Step 3: Write fail-closed contract SQL**

Before tightening columns, abort when:

```sql
-- examples of mandatory checks
EXISTS active permission with resource/action missing;
EXISTS overlapping unrevoked UserRole interval;
EXISTS invalid DataScope shape or empty CUSTOM scope;
EXISTS overlapping UserPermissionGrant interval;
EXISTS more than one current manager or reporting cycle;
SYSTEM_SUPER_ADMIN trust-root relation is missing or disabled;
```

Then set final nullability, constraints, indexes, and RESTRICT foreign keys. Do not delete unknown historical rows; they remain disabled.

- [x] **Step 4: Remove the temporary gate**

Remove the middleware and configuration only after router-contract tests prove every SPEC-003 route has formal action middleware and service tests prove data scopes. Search for role-name/admin bypasses:

```powershell
rg -n "masterDataAccess|SYSTEM_SUPER_ADMIN_REQUIRED|roles\.includes\('admin'\)|roles\.includes\('SYSTEM_SUPER_ADMIN'\)" apps/server/app apps/web/src
```

Expected after backend contract: only central trust-root/authorization code may mention `SYSTEM_SUPER_ADMIN`; no `admin` bypass remains.

- [x] **Step 5: Reset and run complete backend tests**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run typecheck
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run test:unit
```

- [x] **Step 6: Commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

```powershell
git commit -m "feat(db): contract SPEC-004 authorization model"
```

### Task 14: Replace Frontend Role Checks with Typed Permission Admission

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/authorization/types.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/authorization/api.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/authorization/PermissionRoute.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/authorization/authorization.css`
- Modify: `LayerManage/law-firm-system/apps/web/src/stores/authStore.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/api/auth.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.tsx`
- Delete: `LayerManage/law-firm-system/apps/web/src/features/master-data/SuperAdminRoute.tsx`
- Replace its tests with permission-route/menu tests

**Interfaces:**
- Produces: typed authorization summary, permission-based menu and route admission, `/security/*` route shell.
- Consumed by: Task 15 pages.

- [x] **Step 1: Write failing route/menu/store tests**

Prove menus use MENU codes, organization pages use read permissions, admin pages require the matching menu/action, old `/roles` redirects, no `admin` or role-name bypass exists, and expired summaries are refreshed from `/authorization/me`.

- [x] **Step 2: Run and confirm RED**

- [x] **Step 3: Implement typed auth state**

```ts
interface AuthorizationSummary {
  permissions: PermissionCode[];
  menus: PermissionCode[];
  fieldCapabilities: Record<string, FieldCapability>;
  validUntil: string | null;
  evaluatedAt: string;
}
```

Store the summary for rendering only; API denial remains authoritative. Remove `roles.includes('admin')` and SuperAdminRoute.

- [x] **Step 4: Implement stable menu and routes**

Build menu descriptors with `requiredMenu`. Add `/security/roles`, `/security/users`, `/security/trace`, and `/security/my-access`; redirect `/roles` to `/security/roles`. Keep dimensions stable across permission changes.

- [x] **Step 5: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run App, Layout, authStore, request, and PermissionRoute tests plus web lint/typecheck. Commit:

```powershell
git commit -m "feat(web): drive navigation from formal permissions"
```

### Task 15: Build Role, User Grant, Trace, and My Access Pages

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/pages/SecurityRole/index.tsx`
- Create: corresponding role page tests
- Create: `LayerManage/law-firm-system/apps/web/src/pages/SecurityUser/index.tsx`
- Create: corresponding user page tests
- Create: `LayerManage/law-firm-system/apps/web/src/pages/PermissionTrace/index.tsx`
- Create: corresponding trace page tests
- Create: `LayerManage/law-firm-system/apps/web/src/pages/MyAccess/index.tsx`
- Create: corresponding my-access tests
- Create focused components under `features/authorization/components/`
- Modify: `LayerManage/law-firm-system/apps/web/src/features/master-data/api.ts`
- Modify employee detail components to display projected fields and purpose-bound L4 action

**Interfaces:**
- Produces: usable desktop/mobile authorization center and sensitive-field workflow.

- [x] **Step 1: Write failing role-page tests**

Test create/edit/enable/disable, immutable code, action tree, resource scope editor, field read/write/export controls, invalid scope prevention, version conflict preserving input, and no physical delete.

- [x] **Step 2: Write failing user-grant tests**

Test permanent/temporary segmented control, mandatory dates/reason, <=90-day role and <=30-day special grant UI validation, revocation confirmation, expired display, self-modification disabled, and stable server errors.

- [x] **Step 3: Write failing trace/my-access tests**

Test source, scope targets, field capabilities, validity, refusal reason, self-only view, and no sensitive values. Test L4 employee view requires purpose, clears raw value on drawer close, and never stores it in Zustand/localStorage/URL.

- [x] **Step 4: Run and confirm RED**

- [x] **Step 5: Implement focused controls**

Use tabs for role sections, tree/checkboxes for actions, select/tree-select for scope targets, segmented control for permanence, date-time pickers for validity, switches for write/export, and tags for status/risk. Do not nest cards; use unframed page sections and compact tables.

- [x] **Step 6: Add responsive dimensions**

Desktop uses a stable list/detail split. Below 768 px, details/editors use Drawer and vertical Form. Permission codes wrap; controls and table action columns do not overlap.

- [x] **Step 7: Verify and commit** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Run all new page tests, existing master-data page tests, web lint/typecheck/build. Inspect changed pages for Hook warnings. Commit:

```powershell
git commit -m "feat(web): manage roles grants scopes and permission trace"
```

### Task 16: Rehearse Migration, Run Enterprise Acceptance, and Close Locally

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/db/rehearse-spec-004-migration.ps1`
- Create: `LayerManage/law-firm-system/apps/server/test/acceptance/spec-004-acceptance.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/e2e/prepare-spec-004-e2e.ts`
- Create: `LayerManage/law-firm-system/apps/web/e2e/spec-004-authorization.spec.ts`
- Create: `docs/superpowers/runbooks/rbac-data-scope-sensitive-permissions.md`
- Create: `docs/superpowers/reports/spec-004-closeout.md`
- Modify: SPEC status, this Plan checklist, and `docs/superpowers/README.md`

**Interfaces:**
- Produces: migration, performance, E2E, security, operator, and empty-database evidence.

- [x] **Step 1: Add a disposable historical migration rehearsal**

Use fixed allowlisted database `chengye_oa_spec004_migration_test`. Apply through SPEC-003, seed one trust root plus historical business role/permission/UserRole fixtures, apply expand/contract, and assert:

- 32 models/tables are represented;
- catalog codes exist exactly once;
- trust root is unchanged;
- old UserRole is permanent and active;
- unknown old permission is disabled, not deleted;
- no business roles/scopes/grants/reporting lines were auto-created;
- disposable database is dropped in `finally`.

- [x] **Step 2: Add backend performance and authorization acceptance**

Create 500 organizations, 10,000 employees, 20 roles, 1,000 permission mappings, cross-office teams, and a 1,000-person reporting tree before starting any timer. Warm each measured query once, measure five isolated runs using `performance.now()`, and compare the median so fixture creation and cold Prisma startup are excluded. Assert:

- authorization context <=100 ms with bounded queries;
- organization/employee pagination regression <=20% from SPEC-003 targets;
- recursive subordinate scope and permission trace <=2 seconds;
- no row-level N+1;
- allowed/denied/field/audit behavior matches all 12 Spec acceptance scenarios.

- [x] **Step 3: Run migration rehearsal and backend acceptance**

Expected: both exit 0; disposable DB removed.

- [x] **Step 4: Run real browser E2E**

Use a test-only super-admin token and real API/UI to:

1. create Chongqing and Beijing branches and employees;
2. create a Chongqing branch-manager role with branch scope;
3. grant it to a bound user;
4. prove Chongqing data is visible and Beijing detail is hidden;
5. add a cross-office medical-team grant and prove union access;
6. prove phone masking, audited L3 read, and purpose-bound L4 read;
7. create and expire/revoke a temporary grant and prove immediate denial;
8. inspect permission trace;
9. capture desktop role/trace screenshots and mobile user-grant/L4 screenshots.

Stop all hidden server/browser processes before continuing.

- [x] **Step 5: Run fresh complete verification**

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run verify
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run security:audit:prod
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run security:audit:all
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run security:sbom
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:assert-empty
```

Expected: all tests/builds/contracts pass, no new warnings, production high/critical are zero, full audit passes exact policy, SBOM succeeds, and all application tables are empty.

- [x] **Step 6: Perform inline local review and resolve findings**

Review against every Spec section without unnecessary subagents. Check privilege escalation, list/detail parity, L4 leakage, stale auth state, interval races, trust root, physical deletes, unknown routes, sensitive logs, migrations, UI overflow, and test gaps. Use systematic debugging and rerun affected tests; rerun Step 5 after the final code fix.

- [x] **Step 7: Write operations and closeout records**

The runbook must document role design, scope selection, field classification, temporary grants, revocation, trace interpretation, L4 purpose, migration/backup, trust-root checks, expiry handling, and incident recovery. The closeout must record exact commits, test counts, performance, audits, migration rehearsal, screenshot paths, empty DB proof, warnings, and exactly:

```text
GitHub push, pull request, and remote CI were intentionally not executed. They remain final-delivery gates and are not recorded as passed.
```

Change Spec status to `已实施` only after every local gate is green.

- [x] **Step 8: Commit local closeout** (Git operation intentionally not executed; step disposition completed under the project owner directive.)

Create one implementation-evidence commit and one documentation closeout commit so the report can reference an exact implementation hash:

```powershell
git commit -m "test: add SPEC-004 local authorization acceptance"
git commit -m "docs: close SPEC-004 local acceptance"
git status --short
```

Expected: clean worktree; no push.

## Spec Coverage Matrix

| SPEC-004 area | Implemented by |
| --- | --- |
| Immutable permission catalog and system metadata | Tasks 1, 13 |
| Real-time context and action guard | Tasks 3, 9, 13 |
| Grant tuple semantics and union | Tasks 3, 4, 8 |
| Eight data-scope types | Tasks 4, 5 |
| Resource ownership resolvers | Tasks 4, 10-12 |
| Reporting-line history and subordinate scope | Task 5 |
| L1-L4 classification and field capabilities | Tasks 2, 6, 11 |
| Purpose-bound L4 access and audit | Tasks 6, 11, 15 |
| Versioned business-role management | Tasks 7, 9, 15 |
| Permanent/temporary roles and SPECIAL grants | Tasks 8, 9, 15 |
| Permission trace | Tasks 8, 9, 15 |
| Trust root and anti-escalation | Tasks 3, 7-9, 13 |
| SPEC-003 route migration | Tasks 10-13 |
| Permission-driven frontend | Tasks 14-15 |
| Migration, performance, E2E, security, empty DB | Task 16 |
| Local-only Git workflow | Global Constraints and Task 16 |

## Plan Self-Review Checklist

- [x] Every permission code in the Spec appears in Task 1 catalog requirements.
- [x] Every new model has a migration, schema contract, service owner, and acceptance path.
- [x] Every SPEC-003 resource has action, scope, record, and field enforcement tasks.
- [x] Every legacy role-name/admin bypass and physical-delete/overwrite route has a removal task.
- [x] All L3/L4 raw paths require audit, and L4 requires purpose.
- [x] SPEC-005 governance is not implemented or falsely recorded as complete.
- [x] Final verification includes tests, performance, E2E, audit, SBOM, empty DB, process cleanup, and local-only evidence.

## Local Execution Decision

Use **Inline Execution** with `superpowers:executing-plans`. This follows the project owner's standing instruction to minimize confirmations and avoid unnecessary subagent calls. Execute Tasks 1-16 sequentially in the new SPEC-004 worktree. Pause only for a genuinely destructive operation outside an allowlisted disposable test database, a missing required runtime, or a repeated blocker that cannot be resolved locally. Do not begin implementation until the project owner approves the Spec and this Plan.
