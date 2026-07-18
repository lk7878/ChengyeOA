# SPEC-003 Organization and Personnel Master Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved SPEC-003 administrative organization tree, positions, employee assignments, cross-office professional teams, protected account binding, and usable administration UI without implementing SPEC-004 RBAC or SPEC-005 administrator review.

**Architecture:** Keep LayerManage as an Egg.js + Prisma modular monolith. Put invariants and transactions in focused application services, keep controllers as HTTP adapters, use PostgreSQL constraints as the second line of defense, and protect every SPEC-003 route with a database-backed `SYSTEM_SUPER_ADMIN` middleware until SPEC-004 replaces it. Apply the employee model through ordered expand and contract migrations so every local commit has an explainable database state.

**Tech Stack:** Node.js 22.14.0, npm 10.9.2, TypeScript, Egg.js 3, Prisma 5.22, PostgreSQL 16, React 19, Ant Design 6, Zustand, Vitest, Testing Library, Node test runner, Docker Desktop, Playwright CLI.

## Global Constraints

- Work only in `D:\2_test\16_ChengyeOA\.worktrees\spec-003-organization-personnel` on `codex/spec-003-organization-personnel`.
- Do not configure a Git remote, push to GitHub, create a pull request, or record remote CI as passed.
- Run Node commands through `npx.cmd -y -p node@22.14.0 -p npm@10.9.2`.
- Use PostgreSQL 16 at `localhost:55432`; integration tests may target only a database whose name ends in `_test`.
- Never commit `.env`, credentials, database artifacts, logs, audit exports, generated distributions, or `var/security` evidence.
- Preserve the SPEC-002 root organization, first-super-admin user ID, `SYSTEM_SUPER_ADMIN` role, initialization record, forced password change, recovery, and trust-root protections.
- Do not create seed data or automatically create departments, offices, employees, positions, or professional teams.
- Do not implement full RBAC, data scopes, field permissions, special permissions, administrator review, events, approvals, or automation.
- Every SPEC-003 API is denied unless the current database state grants the caller an enabled `SYSTEM_SUPER_ADMIN` role.
- Master data is never physically deleted through business APIs.
- Audit summaries may contain stable IDs, codes, states, versions, and timestamps; they must not contain names, phone numbers, email, ID cards, license numbers, passwords, tokens, or free-text bodies.
- Every mutation requiring `version` uses optimistic locking and returns `VERSION_CONFLICT` without partial writes.
- The final schema has 26 Prisma models and removes `Employee.orgId` and `Employee.positionId`.
- Existing React Hook and Vite bundle warnings must not increase; every modified SPEC-003 page must have no Hook warning.
- Use local commits at the end of each task. A commit is a recovery point, not a GitHub operation.

## Execution Environment

Use this PowerShell preamble for database-backed server commands:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa?schema=public'
$env:DATABASE_URL_TEST = 'postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:JWT_SECRET = '01234567890123456789012345678901'
$env:APP_KEYS = 'local_test_application_key_number_one,local_test_application_key_number_two'
$env:ALLOW_TEST_DB_RESET = 'true'
```

Focused backend test command, run from `LayerManage/law-firm-system/apps/server`:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/master-data/organization-service.test.ts
```

Focused frontend test command, run from `LayerManage/law-firm-system/apps/web`:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- vitest run src/pages/Organization/index.test.tsx
```

---

### Task 1: Install the Worktree and Add the Expand Migration

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260718120000_organization_personnel_expand/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/system/system-bootstrap-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/position.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/system/system-bootstrap-service.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-003-expand-migration-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/bootstrap-contract.test.ts`

**Interfaces:**
- Consumes: SPEC-002 schema and `SystemBootstrapService.execute()`.
- Produces: Expanded Organization, Position, Employee, EmployeeAssignment, ProfessionalTeam, and ProfessionalTeamMember Prisma models while temporarily retaining legacy Employee organization fields.

- [x] **Step 1: Install exact lockfile dependencies and generate Prisma Client**

Run from `LayerManage/law-firm-system`:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
```

Expected: all commands exit 0; no lockfile changes.

- [x] **Step 2: Write failing schema and migration contract tests**

Add exact assertions for the expanded state:

```ts
test('adds the SPEC-003 expand schema without dropping legacy employee ownership yet', () => {
  assert.match(schema, /model EmployeeAssignment \{/);
  assert.match(schema, /model ProfessionalTeam \{/);
  assert.match(schema, /model ProfessionalTeamMember \{/);
  assert.match(schema, /code\s+String\s+@unique/);
  assert.match(schema, /path\s+String\s+@unique/);
  assert.match(schema, /version\s+Int\s+@default\(1\)/);
  assert.match(schema, /orgId\s+String/);
  assert.match(schema, /positionId\s+String/);
});

test('expand migration backfills root identity and adds partial unique indexes', () => {
  assert.match(sql, /UPDATE "organization"[\s\S]+"code" = 'ROOT'/);
  assert.match(sql, /employee_assignment_one_active_primary/);
  assert.match(sql, /professional_team_member_one_active_member/);
  assert.match(sql, /professional_team_member_one_active_lead/);
  assert.doesNotMatch(sql, /INSERT INTO "(?:organization|position|employee|professional_team)"/i);
});
```

- [x] **Step 3: Run the new tests and confirm RED**

Run:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/spec-003-expand-migration-contract.test.ts test/system/system-bootstrap-service.test.ts
```

Expected: fail because the three models, fields, migration, and root path creation do not exist.

- [x] **Step 4: Add the expanded Prisma models**

Implement these final field contracts in `schema.prisma`; keep legacy `Employee.orgId`, `Employee.positionId`, `organization`, and `position` only until Task 9:

```prisma
model EmployeeAssignment {
  id             String   @id @default(uuid())
  employeeId     String
  organizationId String
  positionId     String
  assignmentType String
  startedAt      DateTime
  endedAt        DateTime?
  version        Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  employee       Employee     @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  position       Position     @relation(fields: [positionId], references: [id], onDelete: Restrict)
  @@index([employeeId, endedAt])
  @@index([organizationId, endedAt])
  @@index([positionId, endedAt])
  @@map("employee_assignment")
}

model ProfessionalTeam {
  id                 String   @id @default(uuid())
  code               String   @unique
  name               String
  categoryCode       String
  homeOrganizationId String
  description        String?
  status             String   @default("ENABLED")
  version            Int      @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  homeOrganization   Organization @relation(fields: [homeOrganizationId], references: [id], onDelete: Restrict)
  members            ProfessionalTeamMember[]
  @@index([homeOrganizationId, status])
  @@index([categoryCode, status])
  @@map("professional_team")
}

model ProfessionalTeamMember {
  id                 String   @id @default(uuid())
  professionalTeamId String
  employeeId         String
  memberRole         String
  startedAt          DateTime
  endedAt            DateTime?
  version            Int      @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  professionalTeam   ProfessionalTeam @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict)
  employee           Employee         @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  @@index([professionalTeamId, endedAt])
  @@index([employeeId, endedAt])
  @@map("professional_team_member")
}
```

Add Organization `code`, `path`, `level`, `version`; Position `code`, `categoryCode`, `version`; Employee `licenseNo`, `professionalDirections String[] @default([])`, `formalDate`, `version`, and relation arrays. Add inverse relation arrays to Organization and Position. Rename the Prisma Position field to `organizationId String @map("orgId")` so the approved API vocabulary is used without a physical column rename; update the temporary legacy Position controller and affected test fixtures in the same task so typecheck remains green.

- [x] **Step 5: Write the expand SQL**

The SQL must perform this order in one migration:

```sql
ALTER TABLE "organization" ADD COLUMN "code" TEXT;
ALTER TABLE "organization" ADD COLUMN "path" TEXT;
ALTER TABLE "organization" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organization" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "organization" AS o
SET "code" = 'ROOT', "path" = '/' || o."id", "level" = 0
FROM "system_initialization" AS s
WHERE s."id" = 'PRIMARY' AND s."rootOrganizationId" = o."id";

WITH RECURSIVE tree AS (
  SELECT o."id", o."parentId", o."path", o."level" FROM "organization" o WHERE o."path" IS NOT NULL
  UNION ALL
  SELECT c."id", c."parentId", tree."path" || '/' || c."id", tree."level" + 1
  FROM "organization" c JOIN tree ON c."parentId" = tree."id"
)
UPDATE "organization" o SET "path" = tree."path", "level" = tree."level"
FROM tree WHERE o."id" = tree."id";

UPDATE "organization"
SET "code" = 'LEGACY_' || upper(replace("id", '-', ''))
WHERE "code" IS NULL;
```

After backfill, fail if any organization path remains null, set columns `NOT NULL`, add unique indexes and check constraints. Create the three new tables, copy every legacy Employee `orgId/positionId` into an active `PRIMARY` assignment, and create these partial unique indexes:

```sql
CREATE UNIQUE INDEX "employee_assignment_one_active_primary"
ON "employee_assignment" ("employeeId")
WHERE "assignmentType" = 'PRIMARY' AND "endedAt" IS NULL;

CREATE UNIQUE INDEX "employee_assignment_one_active_tuple"
ON "employee_assignment" ("employeeId", "organizationId", "positionId")
WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX "professional_team_member_one_active_member"
ON "professional_team_member" ("professionalTeamId", "employeeId")
WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX "professional_team_member_one_active_lead"
ON "professional_team_member" ("professionalTeamId")
WHERE "memberRole" = 'LEAD' AND "endedAt" IS NULL;
```

- [x] **Step 6: Make bootstrap create a valid expanded root**

Generate the root ID before the create call and write stable derived values:

```ts
const rootOrganizationId = randomUUID();
const rootOrganization = await tx.organization.create({
  data: {
    id: rootOrganizationId,
    code: 'ROOT',
    name: input.organizationName,
    type: 'FIRM',
    path: `/${rootOrganizationId}`,
    level: 0,
  },
});
```

Extend bootstrap tests to assert `ROOT`, the exact `/${rootOrganization.id}` path, level 0, version 1, and no business master data.

- [x] **Step 7: Reset the test database and verify GREEN**

Run from `LayerManage/law-firm-system` with the environment preamble:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run typecheck
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run test:unit
```

Expected: migration applies, server typecheck passes, all backend tests pass.

- [x] **Step 8: Commit locally**

```powershell
git add LayerManage/law-firm-system/apps/server/prisma LayerManage/law-firm-system/apps/server/app/application/system/system-bootstrap-service.ts LayerManage/law-firm-system/apps/server/test
git commit -m "feat(db): expand organization and personnel master data"
```

### Task 2: Add Master-Data Errors, Validation, Audit, and Interim Authorization

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/master-data/master-data-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/master-data/master-data-validation.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-types.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-audit.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/middleware/masterDataAccess.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/master-data-validation.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/master-data-audit.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/test-helpers.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/master-data-access.test.ts`

**Interfaces:**
- Produces: `MasterDataError`, strict normalization functions, `writeMasterDataAudit()`, and route-prefix middleware.
- Consumed by: Tasks 3-9.

- [x] **Step 1: Write failing validation, audit, and access tests**

Use these exact contracts:

```ts
assert.equal(normalizeStableCode(' branch_01 '), 'BRANCH_01');
assert.throws(() => normalizeStableCode('1-branch'), hasCode('VALIDATION_FAILED'));
assert.equal(normalizeEmployeeNo(' emp-001 '), 'EMP-001');
assert.deepEqual(sanitizeChange({ name: 'Alice', status: 'FORMAL', version: 2 }), { status: 'FORMAL', version: 2 });
assert.equal(isMasterDataPath('/api/v1/employees/1'), true);
assert.equal(isMasterDataPath('/api/v1/employees-report'), false);
```

API tests must prove no token returns 401, an enabled business role returns 403 `SYSTEM_SUPER_ADMIN_REQUIRED`, a disabled system role returns 403, and an enabled system super-admin reaches the controller.

Define the shared assertion helper instead of repeating error-shape logic:

```ts
export function hasCode(code: string): (error: unknown) => boolean {
  return error => error instanceof MasterDataError && error.code === code;
}
```

- [x] **Step 2: Run tests and confirm RED**

Run the three new test files. Expected: imports fail because the modules do not exist.

- [x] **Step 3: Implement stable errors and validators**

```ts
export class MasterDataError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'MasterDataError';
  }
}

const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
export function normalizeStableCode(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!STABLE_CODE.test(normalized)) throw new MasterDataError('VALIDATION_FAILED', 400);
  return normalized;
}
```

Add strict functions for names, employee numbers, bounded text, ISO dates, non-negative integers, versions, string arrays, and allowed string literals. Reject unknown DTO keys with `assertExactKeys()`.

Define the cross-task type vocabulary once in `master-data-types.ts`:

```ts
export type MasterDataStatus = 'ENABLED' | 'DISABLED';
export type OrganizationType = 'FIRM' | 'HQ_CENTER' | 'DEPARTMENT' | 'BRANCH' | 'GROUP';
export type AssignmentType = 'PRIMARY' | 'SECONDARY' | 'ACTING';
export type TeamMemberRole = 'LEAD' | 'EXPERT' | 'LAWYER' | 'ASSISTANT' | 'OPERATIONS' | 'OTHER';
export type EmployeeStatus = 'PROBATION' | 'FORMAL' | 'LEAVED';
export interface AuditActor { actorUserId: string; ip?: string }
export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }
export interface Paginated<T> { list: T[]; pagination: Pagination }
export interface OrganizationView { id: string; code: string; name: string; type: OrganizationType; parentId: string | null; path: string; level: number; sort: number; status: MasterDataStatus; version: number }
export interface OrganizationNode extends OrganizationView { children: OrganizationNode[] }
export interface OrganizationDetail extends OrganizationView { parent: OrganizationView | null; children: OrganizationView[]; counts: { positions: number; activeAssignments: number } }
export interface PositionView { id: string; organizationId: string; code: string; name: string; categoryCode: string; level: number; responsibilities: string | null; status: MasterDataStatus; version: number; activeAssignmentCount: number }
export interface EmployeeAssignmentView { id: string; employeeId: string; organizationId: string; positionId: string; assignmentType: AssignmentType; startedAt: Date; endedAt: Date | null; version: number }
export interface EmployeeListItem { id: string; employeeNo: string; name: string; employeeType: string; status: EmployeeStatus; version: number; primaryAssignment: EmployeeAssignmentView | null }
export interface EmployeeDetail extends EmployeeListItem { phone: string; email: string | null; idCard: string | null; licenseNo: string | null; assignments: EmployeeAssignmentView[]; professionalTeams: ProfessionalTeamMemberView[]; account: { id: string; username: string; status: string } | null }
export interface ProfessionalTeamMemberView { id: string; professionalTeamId: string; employeeId: string; memberRole: TeamMemberRole; startedAt: Date; endedAt: Date | null; version: number }
export interface ProfessionalTeamListItem { id: string; code: string; name: string; categoryCode: string; homeOrganizationId: string; status: MasterDataStatus; version: number; activeMemberCount: number }
export interface ProfessionalTeamDetail extends ProfessionalTeamListItem { description: string | null; members: ProfessionalTeamMemberView[] }
```

- [x] **Step 4: Implement sanitized same-transaction audit**

```ts
const SAFE_KEYS = new Set([
  'code', 'status', 'version', 'type', 'categoryCode', 'organizationId',
  'positionId', 'employeeId', 'professionalTeamId', 'assignmentType',
  'memberRole', 'startedAt', 'endedAt', 'formalDate', 'leaveDate',
]);

export function sanitizeChange(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => SAFE_KEYS.has(key)));
}

export async function writeMasterDataAudit(
  tx: Prisma.TransactionClient,
  input: MasterDataAuditInput,
): Promise<void> {
  await tx.operationLog.create({ data: {
    userId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    oldValues: input.before ? JSON.stringify(sanitizeChange(input.before)) : undefined,
    newValues: input.after ? JSON.stringify(sanitizeChange(input.after)) : undefined,
    ip: input.ip,
  } });
}
```

Define its input adjacent to the writer:

```ts
export interface MasterDataAuditInput extends AuditActor {
  action: string;
  targetType: 'ORGANIZATION' | 'POSITION' | 'EMPLOYEE' | 'EMPLOYEE_ASSIGNMENT' | 'PROFESSIONAL_TEAM' | 'PROFESSIONAL_TEAM_MEMBER' | 'USER';
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}
```

- [x] **Step 5: Implement the database-backed middleware**

Export `isMasterDataPath(path: string)` and middleware that queries the current user role on every matching request:

```ts
const MASTER_DATA_ROOTS = ['/api/v1/organizations', '/api/v1/positions', '/api/v1/employees', '/api/v1/professional-teams'];

const allowed = await ctx.prisma.userRole.findFirst({
  where: {
    userId: ctx.state.user.userId,
    role: { code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM', status: 'ENABLED' },
  },
  select: { id: true },
});
if (!allowed) throw new MasterDataError('SYSTEM_SUPER_ADMIN_REQUIRED', 403);
```

Register it after `auth`: `['errorHandler', 'auth', 'masterDataAccess']`.

- [x] **Step 6: Verify and commit locally**

Run focused tests, server lint, and server typecheck; then:

```powershell
git add LayerManage/law-firm-system/apps/server/app LayerManage/law-firm-system/apps/server/config LayerManage/law-firm-system/apps/server/test
git commit -m "feat(server): secure master data foundations"
```

### Task 3: Implement Organization Hierarchy Service and Thin Controller

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/master-data/organization-policy.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/organization-service.ts`
- Replace: `LayerManage/law-firm-system/apps/server/app/controller/organization.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/organization-policy.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/organization-service.test.ts`

**Interfaces:**
- Produces: `OrganizationService.create/update/move/disable/enable/tree/detail`.
- Uses: Task 2 errors, validators, and audit writer.

- [x] **Step 1: Write failing hierarchy policy tests**

```ts
assert.equal(canParent('FIRM', 'BRANCH'), true);
assert.equal(canParent('BRANCH', 'DEPARTMENT'), true);
assert.equal(canParent('BRANCH', 'BRANCH'), false);
assert.equal(canParent('GROUP', 'DEPARTMENT'), false);
assert.equal(isDescendantPath('/root/branch/department', '/root/branch'), true);
assert.equal(rebasePath('/root/a', '/root/a/b/c', '/root/x'), '/root/x/b/c');
```

- [x] **Step 2: Run policy tests and confirm RED**

Expected: module not found.

- [x] **Step 3: Implement the complete hierarchy policy**

```ts
const ALLOWED_PARENTS: Record<OrganizationType, ReadonlySet<OrganizationType>> = {
  FIRM: new Set(),
  HQ_CENTER: new Set(['FIRM']),
  BRANCH: new Set(['FIRM']),
  DEPARTMENT: new Set(['FIRM', 'HQ_CENTER', 'BRANCH']),
  GROUP: new Set(['DEPARTMENT', 'BRANCH']),
};
export const canParent = (parent: OrganizationType, child: OrganizationType) => ALLOWED_PARENTS[child].has(parent);
export const isDescendantPath = (candidate: string, ancestor: string) => candidate.startsWith(`${ancestor}/`);
export const rebasePath = (oldRoot: string, descendant: string, newRoot: string) => `${newRoot}${descendant.slice(oldRoot.length)}`;
```

- [x] **Step 4: Write failing PostgreSQL service tests**

Cover create department/branch, duplicate code race, second FIRM rejection, invalid parent type, move subtree path/level updates, cycle rejection, root move/disable rejection, disabled ancestor enable rejection, active child/position/assignment disable rejection, version conflict, deterministic tree ordering, and audit rollback injection.

- [x] **Step 5: Implement OrganizationService transactions**

Use explicit input and result types:

```ts
export interface MoveOrganizationInput { parentId: string; version: number }
export interface CreateOrganizationInput { code: string; name: string; type: Exclude<OrganizationType, 'FIRM'>; parentId: string; sort?: number }
export interface UpdateOrganizationInput { name?: string; sort?: number; version: number }
export class OrganizationService {
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor) {}
  create(input: CreateOrganizationInput): Promise<OrganizationView>;
  update(id: string, input: UpdateOrganizationInput): Promise<OrganizationView>;
  move(id: string, input: MoveOrganizationInput): Promise<OrganizationView>;
  disable(id: string, version: number): Promise<OrganizationView>;
  enable(id: string, version: number): Promise<OrganizationView>;
  tree(status?: 'ENABLED' | 'DISABLED'): Promise<OrganizationNode[]>;
  detail(id: string): Promise<OrganizationDetail>;
}
```

Create IDs in the service, derive `path` and `level`, lock moved rows using `SELECT ... FOR UPDATE`, update descendants with version increments, and use `updateMany({ where: { id, version } })` for optimistic actions. Map every unique organization code race to `MASTER_DATA_CODE_CONFLICT`.

- [x] **Step 6: Replace controller and routes**

Controller methods only parse, call, and map the standard response. Register exactly:

```ts
router.get('/api/v1/organizations/tree', controller.organization.tree);
router.get('/api/v1/organizations/:id', controller.organization.show);
router.post('/api/v1/organizations', controller.organization.create);
router.patch('/api/v1/organizations/:id', controller.organization.update);
router.post('/api/v1/organizations/:id/move', controller.organization.move);
router.post('/api/v1/organizations/:id/disable', controller.organization.disable);
router.post('/api/v1/organizations/:id/enable', controller.organization.enable);
```

Remove the organization physical delete route.

- [x] **Step 7: Verify and commit locally**

Run the two new tests plus trust-root guard tests, lint, and typecheck. Commit:

```powershell
git add LayerManage/law-firm-system/apps/server/app LayerManage/law-firm-system/apps/server/test
git commit -m "feat(server): enforce organization hierarchy"
```

### Task 4: Implement Position Service

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/position-service.ts`
- Replace: `LayerManage/law-firm-system/apps/server/app/controller/position.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/position-service.test.ts`

**Interfaces:**
- Produces: `PositionService.create/update/disable/enable/list/detail`.
- Consumes: enabled Organization records, Task 2 validation/audit.

- [x] **Step 1: Write failing service tests**

Assert organization-scoped unique codes, disabled organization rejection, immutable organization/code, active assignment stop, version conflict, deterministic list ordering, and audit rollback.

```ts
await assert.rejects(
  service.create({ organizationId: disabledOrg.id, code: 'LAWYER', name: '律师', categoryCode: 'LAWYER', level: 1 }),
  hasCode('MASTER_DATA_IN_USE'),
);
```

- [x] **Step 2: Run tests and confirm RED**

Expected: `position-service` module not found.

- [x] **Step 3: Implement PositionService**

Use these signatures:

```ts
export interface CreatePositionInput { organizationId: string; code: string; name: string; categoryCode: string; level: number; responsibilities?: string | null }
export interface UpdatePositionInput { name?: string; categoryCode?: string; level?: number; responsibilities?: string | null; version: number }
export type PositionDetail = PositionView;
create(input: CreatePositionInput): Promise<PositionView>;
update(id: string, input: UpdatePositionInput): Promise<PositionView>;
disable(id: string, version: number): Promise<PositionView>;
enable(id: string, version: number): Promise<PositionView>;
list(query: { organizationId?: string; status?: MasterDataStatus; keyword?: string }): Promise<PositionView[]>;
detail(id: string): Promise<PositionDetail>;
```

Never accept `organizationId` or `code` in update DTOs. Disable checks active `EmployeeAssignment` rows. Every write and audit entry shares a transaction.

- [x] **Step 4: Replace controller/routes and remove physical delete**

Register GET list/detail, POST create, PATCH update, POST disable, POST enable. Preserve no `DELETE /positions/:id` route.

- [x] **Step 5: Verify and commit locally**

Run focused tests, lint, typecheck, then commit `feat(server): add organization-scoped positions`.

### Task 5: Implement Employee Assignment and Lifecycle Services

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-assignment-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-projection.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/employee-assignment-service.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/employee-service.test.ts`

**Interfaces:**
- Produces: normalized employee views and atomic primary/secondary/acting assignment operations.
- Consumed by: HTTP adapters and downstream projections.

- [x] **Step 1: Write failing assignment tests**

Cover one active primary, active tuple uniqueness, position organization match, disabled reference rejection, transfer history, concurrent transfer with one winner, ending only non-primary assignments, invalid intervals, and audit rollback.

```ts
const transferred = await service.transferPrimary(employee.id, {
  organizationId: branch.id,
  positionId: branchPosition.id,
  employeeVersion: 1,
});
assert.equal(transferred.primary.organizationId, branch.id);
assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: employee.id, assignmentType: 'PRIMARY', endedAt: null } }), 1);
assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: employee.id, assignmentType: 'PRIMARY', endedAt: { not: null } } }), 1);
```

- [x] **Step 2: Write failing employee lifecycle tests**

Cover atomic employee + primary creation, duplicate employee number race, normalized email and employee number, invalid ID/license uniqueness, probation to formal, invalid transition, update version conflict, leave handover requirement, active legacy lead/case blocking, ending all assignments, and protected first-super-admin leave rejection.

- [x] **Step 3: Run tests and confirm RED**

Expected: service modules not found.

- [x] **Step 4: Implement employee projection**

```ts
export const EMPLOYEE_DETAIL_INCLUDE = Prisma.validator<Prisma.EmployeeInclude>()({
  assignments: {
    include: { organization: true, position: true },
    orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
  },
  professionalTeams: {
    include: { professionalTeam: true },
    orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
  },
  user: { select: SAFE_USER_SELECT },
});
```

Add `primaryAssignment(view)` that fails closed with `PRIMARY_ASSIGNMENT_CONFLICT` when an active employee does not have exactly one active primary.

- [x] **Step 5: Implement EmployeeAssignmentService**

Use row locking and exact signatures:

```ts
export interface TransferPrimaryInput { organizationId: string; positionId: string; employeeVersion: number }
export interface AddAssignmentInput { organizationId: string; positionId: string; assignmentType: 'SECONDARY' | 'ACTING' }
transferPrimary(employeeId: string, input: TransferPrimaryInput): Promise<EmployeeDetail>;
add(employeeId: string, input: AddAssignmentInput & { assignmentType: 'SECONDARY' | 'ACTING' }): Promise<EmployeeDetail>;
end(employeeId: string, assignmentId: string, input: { version: number }): Promise<EmployeeDetail>;
```

For transfer: lock employee, verify `employee.version`, validate enabled organization and position, end the active primary at one transaction timestamp, create the replacement, increment employee version, write one sanitized audit record, return the refreshed employee.

- [x] **Step 6: Implement EmployeeService**

```ts
export interface CreateEmployeeInput { employeeNo: string; name: string; phone: string; email?: string | null; idCard?: string | null; licenseNo?: string | null; employeeType: string; professionalDirections?: string[]; entryDate: string }
export interface UpdateEmployeeInput { name?: string; phone?: string; email?: string | null; idCard?: string | null; licenseNo?: string | null; employeeType?: string; professionalDirections?: string[] }
export interface EmployeeListQuery { page: number; pageSize: number; keyword?: string; status?: string; organizationId?: string; teamId?: string }
create(input: CreateEmployeeInput & { primaryOrganizationId: string; primaryPositionId: string }): Promise<EmployeeDetail>;
update(id: string, input: UpdateEmployeeInput & { version: number }): Promise<EmployeeDetail>;
formalize(id: string, input: { formalDate: string; version: number }): Promise<EmployeeDetail>;
leave(id: string, input: { leaveDate: string; handoverConfirmed: true; version: number }): Promise<EmployeeDetail>;
list(query: EmployeeListQuery): Promise<Paginated<EmployeeListItem>>;
detail(id: string): Promise<EmployeeDetail>;
```

Creation writes Employee and active PRIMARY assignment in one transaction. Leave locks Employee, refuses the initialized super-admin while bound, verifies no unfinished Lead or Case ownership, ends all assignments and team memberships at one timestamp, marks `LEAVED`, and disables a bound ordinary user in the same transaction.

Map concurrent duplicate `employeeNo`, `idCard`, or `licenseNo` constraints to `EMPLOYEE_IDENTITY_CONFLICT`. Never return the conflicting stored value.

- [x] **Step 7: Verify and commit locally**

Run the two focused suites, server lint/typecheck, then commit `feat(server): add employee assignments and lifecycle`.

### Task 6: Implement Cross-Office Professional Teams

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/professional-team-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/professional-team-service.test.ts`

**Interfaces:**
- Produces: team CRUD state actions, member join/end, and atomic lead replacement.
- Consumes: active Employees and enabled home Organization.

- [x] **Step 1: Write failing team tests**

Test open category codes, cross-office members, disabled employee/team rejection, duplicate active membership, one active lead, atomic lead replacement, member history, active member disable rejection, version conflicts, unique race mapping, and audit rollback.

- [x] **Step 2: Run and confirm RED**

Expected: module not found.

- [x] **Step 3: Implement ProfessionalTeamService**

```ts
export interface CreateProfessionalTeamInput { code: string; name: string; categoryCode: string; homeOrganizationId: string; description?: string | null }
export interface UpdateProfessionalTeamInput { name?: string; categoryCode?: string; homeOrganizationId?: string; description?: string | null }
export interface TeamListQuery { page: number; pageSize: number; keyword?: string; categoryCode?: string; homeOrganizationId?: string; status?: MasterDataStatus }
create(input: CreateProfessionalTeamInput): Promise<ProfessionalTeamDetail>;
update(id: string, input: UpdateProfessionalTeamInput & { version: number }): Promise<ProfessionalTeamDetail>;
disable(id: string, version: number): Promise<ProfessionalTeamDetail>;
enable(id: string, version: number): Promise<ProfessionalTeamDetail>;
addMember(id: string, input: { employeeId: string; memberRole: TeamMemberRole }): Promise<ProfessionalTeamDetail>;
endMember(id: string, memberId: string, version: number): Promise<ProfessionalTeamDetail>;
replaceLead(id: string, input: { employeeId: string; teamVersion: number }): Promise<ProfessionalTeamDetail>;
list(query: TeamListQuery): Promise<Paginated<ProfessionalTeamListItem>>;
detail(id: string): Promise<ProfessionalTeamDetail>;
```

Use a team row lock for lead changes. If the new lead already has an active membership, update its role after ending the old lead; otherwise create the new membership. Preserve every ended membership.

Map duplicate team codes to `MASTER_DATA_CODE_CONFLICT`; map partial-index member and lead races to `TEAM_LEAD_CONFLICT` or the active-member conflict response without exposing index names.

- [x] **Step 4: Verify and commit locally**

Run focused tests, lint/typecheck, then commit `feat(server): add cross-office professional teams`.

### Task 7: Implement Protected Employee Account Binding

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/employee-account-binding-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/application/system/trust-root-guard.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/app/trust-root-guard.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/master-data/employee-account-binding-service.test.ts`

**Interfaces:**
- Produces: dedicated bind/unbind path that may bind the initialized super-admin without weakening generic user guards.

- [ ] **Step 1: Write failing binding tests**

Prove ordinary bind/unbind, duplicate user binding, duplicate employee binding, absent objects, super-admin binding without changing role/credential/initialization, and audit rollback. Retain the existing test that generic `PUT /users/:id` cannot mutate the first super-admin.

- [ ] **Step 2: Run and confirm RED**

Expected: binding service module not found.

- [ ] **Step 3: Implement dedicated service**

```ts
bind(employeeId: string, input: { userId: string; employeeVersion: number }): Promise<EmployeeDetail>;
unbind(employeeId: string, input: { employeeVersion: number }): Promise<EmployeeDetail>;
```

Lock Employee and User, check both one-to-one sides, update only `User.employeeId`, increment Employee version, write `BIND_ACCOUNT` or `UNBIND_ACCOUNT`, and return the safe employee detail. Do not call `assertMutableUser()` because this dedicated operation is the approved SPEC-002 extension; do not change or loosen `assertMutableUser()` itself.

- [ ] **Step 4: Verify and commit locally**

Run binding and trust-root tests, lint/typecheck, then commit `feat(server): bind employee identities without weakening trust root`.

### Task 8: Replace HTTP Adapters and Update Downstream Employee Projections

**Files:**
- Replace: `LayerManage/law-firm-system/apps/server/app/controller/employee.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/controller/employeeAssignment.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/controller/employeeAccountBinding.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/controller/professionalTeam.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-factory.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/auth.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/user.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/lead.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/case.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/performance.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/organization.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Modify: `LayerManage/law-firm-system/apps/server/typings/app/controller/index.d.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/master-data-api.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/spec-003-router-contract.test.ts`

**Interfaces:**
- Produces: the complete SPEC-003 HTTP surface and assignment-based employee response shape.

- [ ] **Step 1: Write failing API and router contract tests**

Cover every route and old route absence. API flow:

```ts
const branch = await api.post('/api/v1/organizations').send({ code: 'SH_BRANCH', name: '上海分所', type: 'BRANCH', parentId: rootId });
const position = await api.post('/api/v1/positions').send({ organizationId: branch.id, code: 'LAWYER', name: '律师', categoryCode: 'LAWYER', level: 1 });
const employee = await api.post('/api/v1/employees').send({ employeeNo: 'EMP-001', name: '测试律师', phone: '13800000000', employeeType: 'LAWYER', entryDate: '2026-07-18', primaryOrganizationId: branch.id, primaryPositionId: position.id });
assert.equal(employee.body.data.primaryAssignment.organizationId, branch.id);
```

Also assert ordinary-user 403 for every resource prefix, stable 400/404/409 responses, no password fields, no sensitive audit snapshots, and no physical delete routes.

- [ ] **Step 2: Run and confirm RED**

Expected: new routes/controllers do not exist and old response shape differs.

- [ ] **Step 3: Implement strict DTO parsing and thin controllers**

Each method follows one pattern:

```ts
async transfer() {
  const { ctx } = this;
  const input = parseTransferPrimary(ctx.request.body);
  const data = await employeeAssignmentService(ctx).transferPrimary(ctx.params.id, input);
  ctx.body = { code: 200, message: 'success', data };
}
```

The factory constructs every service with one consistent actor:

```ts
export function auditActor(ctx: Context): AuditActor {
  return { actorUserId: ctx.state.user.userId, ip: ctx.ip };
}
export const employeeAssignmentService = (ctx: Context) => new EmployeeAssignmentService(ctx.prisma, auditActor(ctx));
export const employeeService = (ctx: Context) => new EmployeeService(ctx.prisma, auditActor(ctx));
export const professionalTeamService = (ctx: Context) => new ProfessionalTeamService(ctx.prisma, auditActor(ctx));
export const employeeAccountBindingService = (ctx: Context) => new EmployeeAccountBindingService(ctx.prisma, auditActor(ctx));
```

No Prisma query, password operation, hierarchy rule, transaction, or audit serialization remains in these controllers.

- [ ] **Step 4: Register the exact approved routes**

Add all Employee, Assignment, Account Binding, and Professional Team paths from SPEC-003 Section 9. Keep `DELETE /employees/:id/account-binding`; remove physical DELETE for organization, position, and employee.

- [ ] **Step 5: Replace downstream direct organization/position includes**

Use a shared assignment projection in Auth, User, Lead, Case, Performance, and Organization responses:

```ts
assignments: {
  where: { assignmentType: 'PRIMARY', endedAt: null },
  take: 1,
  include: { organization: true, position: true },
}
```

Do not manufacture stale `orgId` or `positionId` fields. Consumers receive `primaryAssignment` through the projection mapper.

- [ ] **Step 6: Regenerate Egg controller typings**

Run the repository's Egg TypeScript helper or update the generated declarations deterministically so the four controllers appear in `typings/app/controller/index.d.ts`.

- [ ] **Step 7: Verify and commit locally**

Run API, router contract, auth, trust-root, server lint, and typecheck. Commit `feat(api): expose protected organization and personnel endpoints`.

### Task 9: Apply the Employee Assignment Contract Migration

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260718180000_employee_assignment_contract/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/spec-003-contract-migration.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/baseline-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/ci/check-baseline-contract.ts`

**Interfaces:**
- Consumes: all reads and writes switched to EmployeeAssignment in Task 8.
- Produces: final 26-model SPEC-003 schema with no direct Employee organization ownership.

- [ ] **Step 1: Write failing final-contract tests**

```ts
assert.equal(modelNames.length, 26);
assert.doesNotMatch(employeeBlock, /\borgId\b/);
assert.doesNotMatch(employeeBlock, /\bpositionId\b/);
assert.match(contractSql, /ALTER TABLE "employee" DROP COLUMN "orgId"/);
assert.match(contractSql, /ALTER TABLE "employee" DROP COLUMN "positionId"/);
assert.match(contractSql, /RAISE EXCEPTION[\s\S]+active primary/i);
```

- [ ] **Step 2: Run and confirm RED**

Expected: legacy fields still exist and migration file is absent.

- [ ] **Step 3: Write the contract migration with fail-closed validation**

Before dropping columns, execute a PostgreSQL block that raises when any non-left employee lacks exactly one active PRIMARY assignment or any assignment position belongs to a different organization:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT e."id" FROM "employee" e
    LEFT JOIN "employee_assignment" a
      ON a."employeeId" = e."id" AND a."assignmentType" = 'PRIMARY' AND a."endedAt" IS NULL
    WHERE e."status" <> 'LEAVED'
    GROUP BY e."id" HAVING count(a."id") <> 1
  ) THEN
    RAISE EXCEPTION 'SPEC-003 contract requires exactly one active primary assignment';
  END IF;
END $$;

ALTER TABLE "employee" DROP CONSTRAINT "employee_orgId_fkey";
ALTER TABLE "employee" DROP CONSTRAINT "employee_positionId_fkey";
ALTER TABLE "employee" DROP COLUMN "orgId";
ALTER TABLE "employee" DROP COLUMN "positionId";
```

- [ ] **Step 4: Remove legacy Prisma fields and update model count contracts**

Remove direct fields and relations from Employee and inverse direct Employee arrays from Organization/Position. Retain only assignments. Update the canonical model count from 23 to 26 without weakening other baseline checks.

- [ ] **Step 5: Reset, generate, and run complete backend tests**

Expected: both migrations apply in order, Prisma generation succeeds, server typecheck passes, and all backend tests pass.

- [ ] **Step 6: Commit locally**

Commit `feat(db): make employee assignments canonical`.

### Task 10: Add Frontend Types, APIs, Routes, and Super-Admin Navigation Guard

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/types.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/api.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/SuperAdminRoute.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/SuperAdminRoute.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/components/Layout/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/stores/authStore.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/types/index.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/api/organization.ts`

**Interfaces:**
- Produces: typed SPEC-003 API client and role-gated route shell.
- Consumed by: Tasks 11-12 pages.

- [ ] **Step 1: Write failing route and navigation tests**

Assert a user whose roles contain `SYSTEM_SUPER_ADMIN` can render protected content; a normal user receives an access-denied result and sees no organization navigation group.

```tsx
useAuthStore.setState({ userInfo: { id: '1', username: 'root', name: 'Root', roles: ['SYSTEM_SUPER_ADMIN'], permissions: [] } });
render(<MemoryRouter><SuperAdminRoute><div>allowed</div></SuperAdminRoute></MemoryRouter>);
expect(screen.getByText('allowed')).toBeInTheDocument();
```

- [ ] **Step 2: Run and confirm RED**

Expected: feature modules do not exist.

- [ ] **Step 3: Define final frontend contracts**

Define discriminated types matching API values, including `OrganizationNode`, `Position`, `EmployeeListItem`, `EmployeeDetail`, `EmployeeAssignment`, `ProfessionalTeam`, `ProfessionalTeamMember`, and `VersionedMutation`.

```ts
export interface EmployeeDetail extends EmployeeListItem {
  phone: string;
  email?: string | null;
  idCard?: string | null;
  licenseNo?: string | null;
  assignments: EmployeeAssignment[];
  professionalTeams: ProfessionalTeamMember[];
  account?: { id: string; username: string; status: string } | null;
}
```

- [ ] **Step 4: Implement the typed API module**

Create one method for every approved endpoint. Use `patch` for metadata updates, `post` for state actions, `put/delete` only for account binding, and no physical delete method.

- [ ] **Step 5: Implement route and menu guard**

`SuperAdminRoute` checks the current persisted `userInfo.roles`. Add `/org/tree`, `/org/positions`, `/org/employees`, `/org/professional-teams`; make old `/organizations` and `/employees` routes `Navigate` redirects. Show one grouped organization navigation section only to the super-admin.

- [ ] **Step 6: Verify and commit locally**

Run focused frontend test, web lint/typecheck, then commit `feat(web): add protected master data shell`.

### Task 11: Build Organization and Position Management UI

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/OrganizationTree.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/OrganizationForm.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/OrganizationMoveDialog.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/PositionTable.tsx`
- Replace: `LayerManage/law-firm-system/apps/web/src/pages/Organization/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Position/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Organization/index.test.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Position/index.test.tsx`

**Interfaces:**
- Produces: usable `/org/tree` and `/org/positions` pages.

- [ ] **Step 1: Write failing page tests**

Organization tests cover arbitrary-depth recursion, create under selected parent, root action restrictions, explicit move dialog, disable conflict, refresh after mutation, and preserved input after version conflict. Position tests cover organization filter, linked position options, create/update, active-assignment disable conflict, empty state, and retry.

- [ ] **Step 2: Run and confirm RED**

Expected: new components/page do not exist or old page cannot satisfy nested behavior.

- [ ] **Step 3: Implement Organization page**

Use a responsive CSS grid with a stable tree track and detail track, not nested cards. Render recursively through `OrganizationTree`; use Ant Design icons/tooltips for actions. Movement must require a dialog and explicit confirmation. Keep root actions absent.

- [ ] **Step 4: Implement Position page**

Use a compact table with code, name, category, level, active assignments, and status. Use Select, InputNumber, Switch/confirmation controls, and a Drawer or Modal for create/edit. Position choices always come from the selected organization.

- [ ] **Step 5: Add stable responsive styles**

Create component-local CSS with fixed icon-button dimensions, `minmax(0, 1fr)` tracks, text wrapping, mobile single-column layout, and no viewport-scaled font sizes or negative letter spacing.

- [ ] **Step 6: Verify and commit locally**

Run both focused tests, web lint/typecheck, then commit `feat(web): manage organization hierarchy and positions`.

### Task 12: Build Employee Assignment and Professional Team UI

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/EmployeeForm.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/EmployeeDetailDrawer.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/AssignmentDialog.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/AccountBindingPanel.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/ProfessionalTeamForm.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/features/master-data/components/TeamMemberDialog.tsx`
- Replace: `LayerManage/law-firm-system/apps/web/src/pages/Employee/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/ProfessionalTeam/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Employee/index.test.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/ProfessionalTeam/index.test.tsx`

**Interfaces:**
- Produces: usable `/org/employees` and `/org/professional-teams` pages.

- [ ] **Step 1: Write failing employee page tests**

Cover pagination/filtering, create with organization-driven position options, profile update, formalize, transfer primary, add/end secondary, protected leave, account bind/unbind, sensitive values absent from URL/errors, 403 state, and version conflict input preservation.

- [ ] **Step 2: Write failing professional team tests**

Cover open category input, cross-office member selection, member role, unique lead action, member history, active-member disable conflict, empty/retry state, and version conflict.

- [ ] **Step 3: Run and confirm RED**

Expected: new components/page do not exist.

- [ ] **Step 4: Implement Employee page and detail drawer**

Use a scanning-oriented table for employee number, name, status, primary organization/position, teams, and entry date. Detail Drawer tabs are `基础档案`, `任职关系`, `专业团队`, `账号绑定`. Organization selection must fetch positions and clear an invalid previous position. Transfer and leave are explicit command dialogs, not ordinary field edits.

- [ ] **Step 5: Implement Professional Team page**

Use a compact list/detail layout. The member dialog filters enabled employees across all offices. Lead replacement is a separate command with confirmation. Ended members remain visible in history and cannot be reactivated; rejoining creates a new relation through the API.

- [ ] **Step 6: Verify layout and code quality**

Run focused tests, web lint/typecheck, and inspect both pages at desktop and mobile viewport widths. Confirm no text overlap, nested cards, unstable toolbar dimensions, or new Hook warnings.

- [ ] **Step 7: Commit locally**

Commit `feat(web): manage employee assignments and professional teams`.

### Task 13: Rehearse Migration, Run End-to-End Acceptance, and Close Locally

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/db/rehearse-spec-003-migration.ps1`
- Create: `LayerManage/law-firm-system/apps/server/test/acceptance/spec-003-acceptance.test.ts`
- Create: `LayerManage/law-firm-system/apps/web/e2e/spec-003-master-data.spec.ts`
- Create: `docs/superpowers/runbooks/organization-personnel-master-data.md`
- Create: `docs/superpowers/reports/spec-003-closeout.md`
- Modify: `docs/superpowers/specs/2026-07-18-organization-personnel-master-data-design.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Produces: local acceptance evidence, operator instructions, and an empty test database after verification.

- [ ] **Step 1: Add a disposable historical migration rehearsal**

The PowerShell script must use `docker exec chengye-oa-postgres psql`, create only `chengye_oa_spec003_migration_test`, apply the first two migrations, insert one initialized root/branch/position/employee fixture without secrets, apply expand and contract SQL, assert paths and one active primary, then drop the disposable database in `finally`.

Use a fixed allowlist check before create/drop:

```powershell
$Database = 'chengye_oa_spec003_migration_test'
if ($Database -ne 'chengye_oa_spec003_migration_test') { throw 'Unsafe rehearsal database name' }
try {
  # create, migrate, verify
} finally {
  docker exec chengye-oa-postgres psql -U chengye_app -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $Database WITH (FORCE);"
}
```

- [ ] **Step 2: Add backend acceptance and query-count tests**

Create two offices, three head-office departments, nested groups, positions, employees, cross-office teams, transfer history, account binding, and forbidden ordinary-user access. Assert no N+1 query growth for a 500-node tree fixture and deterministic pagination for employees with equal created times. Record timings and require both target queries to complete within 2 seconds in the controlled local environment.

- [ ] **Step 3: Run migration rehearsal and backend acceptance**

Expected: rehearsal exits 0 and always drops the disposable database; backend acceptance passes.

- [ ] **Step 4: Start local servers and execute browser acceptance**

Start server on 7001 and web on the first free port at or above 3000 using hidden/background process handling. Run the Playwright scenario:

```ts
test('super-admin completes the SPEC-003 master-data flow', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await createBranchAndPosition(page, '上海分所', '律师');
  await createEmployee(page, 'EMP-001', '测试律师');
  await transferEmployee(page, '北京分所');
  await addEmployeeToTeam(page, '医疗纠纷团队');
  await expect(page.getByText('北京分所')).toBeVisible();
  await expect(page.getByText('医疗纠纷团队')).toBeVisible();
});
```

Capture desktop and mobile screenshots and inspect them for blank states, clipping, overlap, and broken controls. Stop both server processes before continuing.

- [ ] **Step 5: Run fresh full verification**

From `LayerManage/law-firm-system`, with the environment preamble:

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

Expected: lint has no errors and no new warnings, all server/web/security tests pass, builds pass, production high/critical audit counts are zero, allowed development exception remains exact, SBOM generation succeeds, and every test table is empty afterward.

- [ ] **Step 6: Request local code review and resolve findings**

Invoke `superpowers:requesting-code-review` against the approved Spec and this Plan. Handle feedback with `superpowers:receiving-code-review`; use `superpowers:systematic-debugging` for failures. Rerun the affected focused test after each fix and rerun Step 5 after the final fix.

- [ ] **Step 7: Write operator and closeout records**

The runbook must document organization setup order, safe disable/move rules, employee transfer/leave, team lead replacement, account binding, version conflicts, migration commands, backup prerequisite, and recovery checks. The closeout report must record exact local commit, test counts, audit result, migration rehearsal, screenshot paths, empty database proof, known warnings, and this statement:

```text
GitHub push, pull request, and remote CI were intentionally not executed. They remain final-delivery gates and are not recorded as passed.
```

Change SPEC status to `已实施` only after fresh verification and review are green.

- [ ] **Step 8: Commit the local closeout**

```powershell
git add docs/superpowers LayerManage/law-firm-system/apps/server/scripts/db LayerManage/law-firm-system/apps/server/test/acceptance LayerManage/law-firm-system/apps/web/e2e
git commit -m "docs: close SPEC-003 local acceptance"
git status --short
```

Expected: clean worktree. Do not push.

## Plan Self-Review Matrix

| SPEC-003 area | Implemented by |
| --- | --- |
| Administrative hierarchy and materialized paths | Tasks 1, 3, 13 |
| Position ownership and lifecycle | Tasks 1, 4, 11 |
| Employee identity and canonical assignments | Tasks 1, 5, 8, 9, 12 |
| Cross-office professional teams | Tasks 1, 6, 8, 12 |
| First-super-admin employee binding | Tasks 7, 8, 12 |
| Interim database-backed super-admin gate | Tasks 2, 8, 10 |
| No physical master-data deletion | Tasks 3, 4, 5, 6, 8 |
| Optimistic locking and database constraints | Tasks 1, 3-9 |
| Same-transaction sanitized audit | Tasks 2-8 |
| Migration from SPEC-002 and historical prototype rows | Tasks 1, 9, 13 |
| Usable desktop/mobile UI | Tasks 10-13 |
| Performance, security, regression, and empty DB | Task 13 |
| Local-only Git workflow | Global Constraints and Task 13 |

## Local Execution Decision

Use **Inline Execution** with `superpowers:executing-plans`. This follows the project owner's standing instruction to avoid unnecessary subagent calls and minimize confirmation pauses. Execute Tasks 1-13 sequentially in this worktree, pause only for a genuine destructive action outside the disposable test database, missing credentials, or a repeated blocker that cannot be resolved locally.
