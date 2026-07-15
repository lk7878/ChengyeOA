# SPEC-002 System Bootstrap and Super-Admin Trust Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PostgreSQL 16 空库上提供一次性、可审计的根律所与首位超级管理员初始化，完成强制改密、凭证版本失效、登录锁定和受控离线恢复。

**Architecture:** 使用领域/应用服务承载密码、令牌、初始化、恢复和认证规则，Egg controller、中间件及交互式 CLI 仅作为适配层。所有信任根写入与审计在 Prisma 事务中完成，初始化使用 PostgreSQL advisory transaction lock 保证并发唯一性；Web 只承担登录与强制改密，不暴露初始化或恢复入口。

**Tech Stack:** Node.js 22.14、TypeScript 5/6、Egg.js 3、Prisma 5.22、PostgreSQL 16、bcryptjs、jsonwebtoken、React 19、React Router 7、Zustand 5、Ant Design 6、Node test runner、Vitest/Testing Library。

## Global Constraints

- 唯一主工程为 `LayerManage/law-firm-system`，唯一 Prisma 来源为 `apps/server/prisma`。
- 只支持 PostgreSQL 16；不导入 SQLite，不恢复 seed，不创建演示账号或默认密码。
- Node 版本固定为 `22.14.0`，支持 Windows PowerShell 和现有 Linux CI。
- 初始化只能通过 `npm run system:bootstrap`；恢复只能通过 `npm run super-admin:recover`。
- 初始化、恢复和密码变更不得输出或记录密码、Hash、令牌、完整数据库 URL 或环境变量值。
- 密码长度 `12–128`，四类字符至少满足三类，不含用户名、控制字符、首尾空白或弱密码清单值；bcrypt production cost 固定为 `12`。
- 改密令牌有效期固定 `300` 秒；现有访问令牌 `7d`、刷新令牌 `30d` 保持不变。
- 连续失败 `5` 次锁定 `15` 分钟；认证失败统一使用 `AUTHENTICATION_FAILED`。
- `SystemInitialization` 固定主键为 `PRIMARY`，存在后不得由应用修改、删除或重建。
- 离线恢复开关必须精确为 `ALLOW_SUPER_ADMIN_RECOVERY=true`，恢复对象只能是初始化记录指向的首位超级管理员。
- 不实现 MFA、SSO、第二位超级管理员、完整 RBAC、组织树或业务模块；MFA 仍是生产上线门槛。
- 采用 TDD；每项任务先观察目标测试失败，再做最小实现并提交。

## Manual Prerequisites

执行代码计划前只需要以下人工准备，不在本计划阶段操作：

1. 保持 Docker Desktop 已启动。
2. `LayerManage/law-firm-system/apps/server/.env` 中保留有效的 `DATABASE_URL`、`DATABASE_URL_TEST`、`JWT_SECRET` 和 `APP_KEYS`；测试数据库名必须以 `_test` 结尾。
3. 仅在执行测试库重建的当前 PowerShell 会话设置 `$env:ALLOW_TEST_DB_RESET='true'`。
4. 不需要配置 FAL、DashScope 或其他 AI Key。
5. 开始实施时先使用 `superpowers:using-git-worktrees` 创建隔离 worktree，建议分支 `codex/spec-002-system-bootstrap`。

## Target File Map

| Responsibility | Files |
| --- | --- |
| Database contract | `apps/server/prisma/schema.prisma`, new migration, `test/db/schema-contract.test.ts` |
| Security primitives | `app/domain/security/*`, `test/security/*` |
| Initialization and recovery | `app/application/system/*`, `test/system/*` |
| Interactive commands | `scripts/system/*`, `test/system/*-cli.test.ts` |
| Authentication | `app/application/auth/authentication-service.ts`, `app/controller/auth.ts`, `app/middleware/auth.ts`, `test/app/auth.test.ts` |
| Trust-root write protection | `app/application/system/trust-root-guard.ts`, user/role controllers and tests |
| Forced-change UI | `apps/web/src/api/auth.ts`, stores, routes, login page, new password-change page and tests |
| Release evidence | CI contract, API/development/deployment docs, new runbook and `docs/superpowers/README.md` |

---

### Task 1: Add the Trust-Root Database Contract

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260715120000_system_bootstrap_trust_root/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/db/reset-test-db.ts`
- Create: `LayerManage/law-firm-system/apps/server/config/config.unittest.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/config/unittest-database.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/helpers/test-database.ts`

**Interfaces:**
- Produces Prisma models/fields used by every later task: `SystemInitialization`, `Role.code`, `User.mustChangePassword`, `User.credentialVersion`, `User.passwordChangedAt`, `User.failedLoginCount`, `User.lockedUntil`, and extended `LoginLog`.
- Produces `createTestPrisma()` and `clearTestApplicationData(prisma)` guarded by a `_test` database-name assertion.

- [ ] **Step 1: Write failing schema-contract tests**

Change the model count and add exact contract assertions:

```ts
test('adds the SPEC-002 trust-root schema', () => {
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 23);
  assert.match(schema, /model SystemInitialization[\s\S]*id\s+String\s+@id/);
  assert.match(schema, /rootOrganizationId\s+String\s+@unique/);
  assert.match(schema, /superAdminUserId\s+String\s+@unique/);
  assert.match(schema, /code\s+String\s+@unique/);
  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /credentialVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /failedLoginCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /userId\s+String\?[\s\S]*onDelete: SetNull/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run from the repository root:

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/db/schema-contract.test.ts
Pop-Location
```

Expected: FAIL because the schema still has 22 models and none of the trust-root fields.

- [ ] **Step 3: Implement the Prisma schema**

Add these relations and fields, preserving all existing model fields:

```prisma
model SystemInitialization {
  id                     String   @id
  version                Int      @default(1)
  rootOrganizationId     String   @unique
  superAdminUserId       String   @unique
  completedAt            DateTime
  rootOrganization       Organization @relation("RootOrganization", fields: [rootOrganizationId], references: [id], onDelete: Restrict)
  superAdminUser         User @relation("FirstSuperAdmin", fields: [superAdminUserId], references: [id], onDelete: Restrict)

  @@map("system_initialization")
}
```

Add `systemInitialization SystemInitialization? @relation("RootOrganization")` to `Organization`; add `systemInitialization SystemInitialization? @relation("FirstSuperAdmin")` to `User`; add the following fields to their existing models:

```prisma
// Role
code String @unique

// User
mustChangePassword Boolean   @default(false)
credentialVersion  Int       @default(1)
passwordChangedAt  DateTime?
failedLoginCount   Int       @default(0)
lockedUntil        DateTime?

// LoginLog
userId           String?
usernameSnapshot String
outcome          String
reasonCode       String?
user             User? @relation(fields: [userId], references: [id], onDelete: SetNull)
```

The migration SQL must explicitly add the columns, recreate `login_log_userId_fkey` with `ON DELETE SET NULL`, create `system_initialization`, add unique indexes for `role.code` and both trust-root foreign keys, and add `ON DELETE RESTRICT` foreign keys. Do not edit the baseline migration.

Use this migration body:

```sql
ALTER TABLE "login_log" DROP CONSTRAINT "login_log_userId_fkey";

ALTER TABLE "role" ADD COLUMN "code" TEXT NOT NULL;

ALTER TABLE "user"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "login_log"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "usernameSnapshot" TEXT NOT NULL,
  ADD COLUMN "outcome" TEXT NOT NULL,
  ADD COLUMN "reasonCode" TEXT;

CREATE TABLE "system_initialization" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "rootOrganizationId" TEXT NOT NULL,
  "superAdminUserId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_initialization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_code_key" ON "role"("code");
CREATE UNIQUE INDEX "system_initialization_rootOrganizationId_key" ON "system_initialization"("rootOrganizationId");
CREATE UNIQUE INDEX "system_initialization_superAdminUserId_key" ON "system_initialization"("superAdminUserId");

ALTER TABLE "login_log" ADD CONSTRAINT "login_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_initialization" ADD CONSTRAINT "system_initialization_rootOrganizationId_fkey"
  FOREIGN KEY ("rootOrganizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "system_initialization" ADD CONSTRAINT "system_initialization_superAdminUserId_fkey"
  FOREIGN KEY ("superAdminUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Add a guarded PostgreSQL test helper**

At the top of `reset-test-db.ts`, load the local server env with `import 'dotenv/config';`. Implement `test/helpers/test-database.ts` with this public surface:

```ts
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

export function assertTestDatabaseUrl(rawUrl = process.env.DATABASE_URL_TEST ?? ''): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' || !url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Integration tests require a PostgreSQL database ending in _test');
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl().toString() } } });
}

export async function clearTestApplicationData(prisma: PrismaClient): Promise<void> {
  assertTestDatabaseUrl();
  const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
  const quoted = tables.map(table => `"${table.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}
```

Create `config.unittest.ts` so every Egg test process fails closed unless it can switch Prisma to `DATABASE_URL_TEST`:

```ts
import 'dotenv/config';
import { EggAppConfig, PowerPartial } from 'egg';

export function selectTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DATABASE_URL_TEST ?? '';
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' || !url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Egg unit tests require DATABASE_URL_TEST ending in _test');
  }
  return url.toString();
}

export default () => {
  process.env.DATABASE_URL = selectTestDatabaseUrl();
  return {} as PowerPartial<EggAppConfig>;
};
```

`unittest-database.test.ts` must prove PostgreSQL `_test` is accepted and development/non-PostgreSQL URLs are rejected.

- [ ] **Step 5: Generate, validate, migrate and verify GREEN**

```powershell
$env:ALLOW_TEST_DB_RESET='true'
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd prisma validate
npx.cmd prisma generate
npm.cmd run db:reset:test
npx.cmd tsx --test --test-force-exit test/db/schema-contract.test.ts test/db/empty-application-tables.test.ts test/config/unittest-database.test.ts
Pop-Location
```

Expected: Prisma validation succeeds, the new migration applies to both configured databases, and both test files PASS.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/prisma LayerManage/law-firm-system/apps/server/config/config.unittest.ts LayerManage/law-firm-system/apps/server/test/db LayerManage/law-firm-system/apps/server/test/config/unittest-database.test.ts LayerManage/law-firm-system/apps/server/test/helpers LayerManage/law-firm-system/apps/server/scripts/db/reset-test-db.ts
git commit -m "feat(db): add SPEC-002 trust-root schema"
```

---

### Task 2: Build Shared Password and Token Primitives

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/domain/security/security-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/security/weak-passwords.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/security/password-policy.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/security/password-hasher.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/domain/security/token-service.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/extend/helper.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/security/password-policy.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/security/token-service.test.ts`

**Interfaces:**
- Produces `normalizeUsername`, `validateUsername`, `validatePassword`, `PasswordHasher`, `BcryptPasswordHasher`, `AuthTokenClaims`, `TokenType`, and `JwtTokenService`.
- `JwtTokenService.verify(token, allowedTypes)` is the only JWT verification entry point used later.

- [ ] **Step 1: Write failing password-policy and token tests**

Cover exact boundaries and claims:

```ts
test('normalizes and validates the bootstrap username', () => {
  assert.equal(normalizeUsername('  Root.Admin  '), 'root.admin');
  assert.throws(() => validateUsername('中文管理员'), /USERNAME_INVALID/);
});

test('enforces the approved password policy', () => {
  assert.doesNotThrow(() => validatePassword('Correct-Horse-92', 'root.admin'));
  for (const value of ['short9A!', 'root.admin-92A!', ' password-92A!', 'password123']) {
    assert.throws(() => validatePassword(value, 'root.admin'));
  }
});

test('binds each token to type, user and credential version', () => {
  const tokens = new JwtTokenService('01234567890123456789012345678901');
  const token = tokens.signPasswordChange('user-1', 3);
  const claims = tokens.verify(token, ['password_change']);
  assert.equal(claims.userId, 'user-1');
  assert.equal(claims.credentialVersion, 3);
  assert.equal(claims.tokenType, 'password_change');
  assert.throws(() => tokens.verify(token, ['access']), /TOKEN_TYPE_INVALID/);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/security/password-policy.test.ts test/security/token-service.test.ts
Pop-Location
```

Expected: FAIL because the security modules do not exist.

- [ ] **Step 3: Implement exact security interfaces**

Use these stable contracts:

```ts
export type SecurityErrorCode =
  | 'USERNAME_INVALID' | 'PASSWORD_INVALID' | 'PASSWORD_REUSED'
  | 'TOKEN_INVALID' | 'TOKEN_TYPE_INVALID' | 'AUTHENTICATION_FAILED';

export class SecurityError extends Error {
  constructor(public readonly code: SecurityErrorCode, public readonly httpStatus = 400) {
    super(code);
  }
}

export interface PasswordHasher {
  hash(value: string): Promise<string>;
  compare(value: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 12) {}
  hash(value: string): Promise<string> { return bcrypt.hash(value, this.rounds); }
  compare(value: string, hash: string): Promise<boolean> { return bcrypt.compare(value, hash); }
}

export type TokenType = 'access' | 'refresh' | 'password_change';
export interface AuthTokenClaims extends jwt.JwtPayload {
  userId: string;
  tokenType: TokenType;
  credentialVersion: number;
}
```

`weak-passwords.ts` must export a lower-case immutable set containing at least `password123`, `admin123456`, `qwerty123456`, `123456789012`, `chengye123456`, and `chengyeoa123`. `validatePassword` must implement every Global Constraint and throw only `SecurityError('PASSWORD_INVALID')` to callers.

`JwtTokenService` must sign access for `7d`, refresh for `30d`, password change for `5m`, verify signature and required claims, and reject a token whose type is not in `allowedTypes`.

Remove the duplicate bcrypt import and `hashPassword`/`comparePassword` methods from `app/extend/helper.ts`. Add `refreshExpiresIn: '30d'` to the typed JWT config; do not add another JWT library.

- [ ] **Step 4: Run tests, lint and typecheck**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/security/password-policy.test.ts test/security/token-service.test.ts
npm.cmd run lint
npm.cmd run typecheck
Pop-Location
```

Expected: both test files PASS; lint and typecheck exit `0`.

- [ ] **Step 5: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/domain LayerManage/law-firm-system/apps/server/app/extend/helper.ts LayerManage/law-firm-system/apps/server/config/config.default.ts LayerManage/law-firm-system/apps/server/test/security
git commit -m "feat(auth): add shared credential security primitives"
```

---

### Task 3: Implement Atomic System Bootstrap

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/system-command-errors.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/audit-writer.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/system-bootstrap-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/system/system-bootstrap-service.test.ts`

**Interfaces:**
- Consumes: `PasswordHasher`, `validateUsername`, `validatePassword`, Prisma trust-root schema, `assertEmptyApplicationTables`.
- Produces: `SystemBootstrapService.execute(input): Promise<BootstrapResult>` and stable error classes mapped by CLI in Task 5.

- [ ] **Step 1: Write failing real-PostgreSQL integration tests**

Use `createTestPrisma` and clear only the guarded `_test` database in `beforeEach`. Test success, second run, dirty database, audit rollback and `Promise.allSettled` concurrency:

```ts
const input = { organizationName: '承业律师事务所', username: 'root.admin', password: 'Correct-Horse-92' };

test('creates exactly one atomic trust root without employee or permissions', async () => {
  await service.execute(input);
  assert.equal(await prisma.organization.count(), 1);
  assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_SUPER_ADMIN' } }), 1);
  assert.equal(await prisma.user.count({ where: { employeeId: null, mustChangePassword: true } }), 1);
  assert.equal(await prisma.userRole.count(), 1);
  assert.equal(await prisma.systemInitialization.count({ where: { id: 'PRIMARY' } }), 1);
  assert.equal(await prisma.operationLog.count({ where: { action: 'SYSTEM_BOOTSTRAP' } }), 1);
  assert.equal(await prisma.employee.count(), 0);
  assert.equal(await prisma.permission.count(), 0);
});
```

For rollback, inject an `AuditWriter` that throws and assert every application table remains empty. For concurrency, instantiate two services over separate Prisma clients and assert one fulfilled and one rejected with `AlreadyInitializedError`.

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/system-bootstrap-service.test.ts
Pop-Location
```

Expected: FAIL because `SystemBootstrapService` is missing.

- [ ] **Step 3: Implement errors, audit writer and service**

Use these exact public types:

```ts
export class ValidationCommandError extends Error { readonly exitCode = 2; }
export class AlreadyInitializedError extends Error { readonly exitCode = 3; }
export class InconsistentSystemStateError extends Error { readonly exitCode = 4; }
export class DatabaseStateError extends Error { readonly exitCode = 5; }
export class RecoveryDisabledError extends Error { readonly exitCode = 6; }

export interface BootstrapInput {
  organizationName: string;
  username: string;
  password: string;
}

export interface BootstrapResult {
  organizationName: string;
  username: string;
}

export interface SystemCommandMetadata {
  databaseName: string;
  hostname: string;
}

export type AuditWriter = (tx: Prisma.TransactionClient, input: Prisma.OperationLogCreateInput) => Promise<void>;

export declare class SystemBootstrapService {
  constructor(
    prisma: PrismaClient,
    hasher: PasswordHasher,
    metadata: SystemCommandMetadata,
    auditWriter?: AuditWriter,
  );
  execute(input: BootstrapInput): Promise<BootstrapResult>;
}
```

`SystemBootstrapService.execute` must normalize inputs before entering the transaction, hash once, then execute a Prisma interactive transaction with `Serializable` isolation. Inside the transaction:

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(${2036071502})`;
const initialized = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' } });
if (initialized) throw new AlreadyInitializedError('System is already initialized');
const counts = await applicationTableCounts(tx);
if (counts.some(item => item.count !== 0)) throw new InconsistentSystemStateError('Application data exists without initialization');
```

Then create `FIRM`, `SYSTEM_SUPER_ADMIN`, user with `employeeId: null` and `mustChangePassword: true`, `UserRole`, `SystemInitialization { id: 'PRIMARY', version: 1 }`, and a `SYSTEM_BOOTSTRAP` operation log. Audit JSON contains only IDs, version, database name and hostname. Do not catch and retry write errors.

- [ ] **Step 4: Run integration tests and database assertions**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/system-bootstrap-service.test.ts
npm.cmd run typecheck
Pop-Location
```

Expected: success, duplicate, dirty-state, rollback and concurrency cases all PASS.

- [ ] **Step 5: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/application/system LayerManage/law-firm-system/apps/server/test/system/system-bootstrap-service.test.ts
git commit -m "feat(system): add atomic one-time bootstrap service"
```

---

### Task 4: Implement Guarded Super-Admin Recovery

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/super-admin-recovery-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/system/super-admin-recovery-service.test.ts`

**Interfaces:**
- Consumes: initialized trust root from Task 3, shared password primitives and `AuditWriter`.
- Produces: `SuperAdminRecoveryService.execute(input): Promise<RecoveryResult>`.

- [ ] **Step 1: Write failing recovery integration tests**

Use a fresh bootstrap in each case and cover gate disabled, wrong username, missing protected role, short reason, reused password, success and audit rollback:

```ts
test('recovers only the initialized super-admin and invalidates sessions', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  await recovery.execute({
    enabled: true,
    username: 'root.admin',
    temporaryPassword: 'Different-Horse-93',
    reason: '管理员遗忘密码，执行现场离线恢复',
  });
  const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.mustChangePassword, true);
  assert.equal(after.credentialVersion, before.credentialVersion + 1);
  assert.equal(after.failedLoginCount, 0);
  assert.equal(after.lockedUntil, null);
  assert.ok(after.passwordChangedAt);
  assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 1);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/super-admin-recovery-service.test.ts
Pop-Location
```

Expected: FAIL because the recovery service is missing.

- [ ] **Step 3: Implement the recovery transaction**

Use this contract:

```ts
export interface RecoveryInput {
  enabled: boolean;
  username: string;
  temporaryPassword: string;
  reason: string;
}

export interface RecoveryResult { username: string; }

export declare class SuperAdminRecoveryService {
  constructor(
    prisma: PrismaClient,
    hasher: PasswordHasher,
    metadata: SystemCommandMetadata,
    auditWriter?: AuditWriter,
  );
  execute(input: RecoveryInput): Promise<RecoveryResult>;
}
```

The service must reject `enabled !== true`, load `SystemInitialization.PRIMARY`, load only its `superAdminUserId` with roles, require `SYSTEM_SUPER_ADMIN`, require normalized username equality and reason length `10–500`, validate and compare the temporary password, then transactionally update:

```ts
{
  password: await hasher.hash(input.temporaryPassword),
  mustChangePassword: true,
  passwordChangedAt: new Date(),
  failedLoginCount: 0,
  lockedUntil: null,
  credentialVersion: { increment: 1 },
}
```

Write `SUPER_ADMIN_RECOVERY` with target user ID, reason and hostname in the same transaction. Never mutate roles, employee relation or initialization.

- [ ] **Step 4: Run tests and typecheck**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/super-admin-recovery-service.test.ts
npm.cmd run typecheck
Pop-Location
```

Expected: all recovery boundary and rollback tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/application/system/super-admin-recovery-service.ts LayerManage/law-firm-system/apps/server/test/system/super-admin-recovery-service.test.ts
git commit -m "feat(system): add guarded super-admin recovery"
```

---

### Task 5: Add Thin Interactive Bootstrap and Recovery CLIs

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/terminal-prompts.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/migration-status.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/system-cli.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/bootstrap-system.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/system/recover-super-admin.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/system/system-cli.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/.env.example`

**Interfaces:**
- Consumes: Task 3 and Task 4 services.
- Produces root commands `npm run system:bootstrap` and `npm run super-admin:recover` with exit codes `0,2,3,4,5,6,70`.

- [ ] **Step 1: Write failing CLI tests using injected IO**

Define fake prompt/service/migration dependencies; never send a real password through process arguments. Cover non-TTY, unexpected arguments, redacted target, exact phrases, recovery gate short-circuit, error mapping and safe unknown errors:

```ts
test('does not connect when recovery is disabled', async () => {
  let connected = false;
  const code = await recoveryMain([], { ALLOW_SUPER_ADMIN_RECOVERY: 'false' }, fakeDependencies({
    createPrisma: () => { connected = true; throw new Error('must not run'); },
  }));
  assert.equal(code, 6);
  assert.equal(connected, false);
});

function fakeDependencies(overrides: Partial<SystemCliDependencies>): SystemCliDependencies {
  const sink = { write: () => true };
  return {
    isTty: true,
    prompts: { text: async () => '', secret: async () => '', close: () => undefined },
    stdout: sink,
    stderr: sink,
    assertMigrationsReady: async () => undefined,
    createPrisma: () => { throw new Error('unexpected database connection'); },
    hostname: () => 'test-host',
    randomUUID: () => 'test-reference',
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/system-cli.test.ts
Pop-Location
```

Expected: FAIL because CLI modules do not exist.

- [ ] **Step 3: Implement TTY prompts and migration check**

`TerminalPrompts` exposes only:

```ts
export interface Prompts {
  text(label: string): Promise<string>;
  secret(label: string): Promise<string>;
  close(): void;
}
```

Implement `secret` with Node `readline` and a muted `Writable`; write the prompt before muting and write one newline after input. Require `process.stdin.isTTY && process.stdout.isTTY`. Do not accept `--password`, stdin redirection or password environment variables.

`assertMigrationsReady(databaseUrl)` must invoke the local Prisma CLI through `process.execPath` and `require.resolve('prisma/build/index.js')` with `migrate status`, capture output, and convert any non-zero status to `DatabaseStateError` without relaying Prisma output or the URL.

- [ ] **Step 4: Implement both thin mains and scripts**

Use dependency-injected mains:

```ts
export interface SystemCliDependencies {
  isTty: boolean;
  prompts: Prompts;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  assertMigrationsReady(databaseUrl: string): Promise<void>;
  createPrisma(databaseUrl: string): PrismaClient;
  hostname(): string;
  randomUUID(): string;
}

export declare const productionSystemCliDependencies: SystemCliDependencies;

export declare function bootstrapMain(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: SystemCliDependencies = productionSystemCliDependencies,
): Promise<number>;

export declare function recoveryMain(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: SystemCliDependencies = productionSystemCliDependencies,
): Promise<number>;
```

Reject all arguments. Parse the database target with `new URL`, display only host, explicit/default port and decoded database name. Both commands call `assertMigrationsReady` before constructing their service. Bootstrap prompts for organization, username, two passwords and exact `INITIALIZE <dbName>`. Recovery first checks `env.ALLOW_SUPER_ADMIN_RECOVERY === 'true'`, then prompts for username, two passwords, reason and exact `RECOVER <dbName> <normalizedUsername>`.

Map known service errors to their stable exit codes. Map Prisma initialization, connectivity and query errors to exit `5` with a generic database-state message; do not print `error.message`. Unknown exceptions write `System command failed. Reference: <randomUUID>` and return `70`. Always close prompts and disconnect Prisma in `finally`; print no input secrets.

Add scripts:

```json
// server package.json
"system:bootstrap": "tsx scripts/system/bootstrap-system.ts",
"super-admin:recover": "tsx scripts/system/recover-super-admin.ts"

// root package.json
"system:bootstrap": "npm --prefix apps/server run system:bootstrap",
"super-admin:recover": "npm --prefix apps/server run super-admin:recover"
```

Add `ALLOW_SUPER_ADMIN_RECOVERY=false` to `.env.example`; never add a password example.

- [ ] **Step 5: Run CLI tests and static checks**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/system/system-cli.test.ts
npm.cmd run lint
npm.cmd run typecheck
Pop-Location
```

Expected: CLI test cases PASS; lint and typecheck exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/package.json LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/.env.example LayerManage/law-firm-system/apps/server/scripts/system LayerManage/law-firm-system/apps/server/test/system/system-cli.test.ts
git commit -m "feat(cli): add bootstrap and recovery commands"
```

---

### Task 6: Replace Controller-Heavy Authentication with a Tested Service

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/auth/authentication-service.ts`
- Create: `LayerManage/law-firm-system/apps/server/app/application/auth/authentication-factory.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/auth.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/middleware/auth.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/router.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/middleware/errorHandler.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/auth.test.ts`

**Interfaces:**
- Consumes: `JwtTokenService`, `PasswordHasher`, password policy and new Prisma fields.
- Produces `login`, `refresh`, `authenticate`, and `forcePasswordChange`; controller and middleware contain no bcrypt/JWT calls.

- [ ] **Step 1: Write failing endpoint tests**

Bootstrap a fresh test trust root before each endpoint group. Assert:

```ts
test('initial login returns only a password-change token', async () => {
  const response = await app.httpRequest().post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: 'Correct-Horse-92' }).expect(200);
  assert.equal(response.body.data.mode, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(response.body.data.expiresIn, 300);
  assert.ok(response.body.data.passwordChangeToken);
  assert.equal('token' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
});
```

Also test: password-change token rejected by `/auth/me` and `/auth/refresh`; forced change rejects reused/weak password; forced change increments version and requires re-login; old token rejected after version change; five failures lock for 15 minutes; unknown user, bad password, disabled user and locked account all return HTTP `401` with message `AUTHENTICATION_FAILED`.

- [ ] **Step 2: Run the focused endpoint test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/app/auth.test.ts
Pop-Location
```

Expected: FAIL because current login returns ordinary tokens and no forced-change route exists.

- [ ] **Step 3: Implement `AuthenticationService`**

Use these public results:

```ts
export type LoginResult =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; passwordChangeToken: string; expiresIn: 300 }
  | { mode: 'AUTHENTICATED'; token: string; refreshToken: string; expiresIn: 604800; user: AuthenticatedUser };

export interface RequestMetadata { ip?: string; userAgent?: string; }

export class AuthenticationService {
  login(username: string, password: string, metadata: RequestMetadata): Promise<LoginResult>;
  refresh(refreshToken: string): Promise<{ token: string; expiresIn: 604800 }>;
  authenticate(token: string, allowedTypes: TokenType[]): Promise<AuthTokenClaims>;
  forcePasswordChange(token: string, password: string, confirmation: string): Promise<void>;
}
```

For a missing user, compare against one module-level bcrypt dummy Hash before writing a nullable-user failure log. For an existing wrong password, atomically increment the counter and set `lockedUntil` when the returned count reaches 5. Use one transaction for counter/lock/log and one transaction for successful login time/reset/log. If persistence fails, issue no token.

`authenticate` and `refresh` must reload the user and reject disabled, locked, mismatched-version, wrong-token-type and `mustChangePassword` business access. `forcePasswordChange` must validate the `password_change` token, reject reuse, update password/version/timestamp/flag and write `FORCED_PASSWORD_CHANGE` in one transaction, then return no token.

- [ ] **Step 4: Wire thin Egg adapters**

`authentication-factory.ts` creates the service from `ctx.prisma` and `app.config.jwt`. Replace direct bcrypt/JWT logic in `auth.ts` with service calls. Add:

```ts
router.post('/api/v1/auth/password/forced-change', controller.auth.forcePasswordChange);
```

Middleware route policy must be exact:

```ts
const allowedTokenTypes = path === '/api/v1/auth/password/forced-change'
  ? ['password_change'] as const
  : path === '/api/v1/auth/logout'
    ? ['access', 'password_change'] as const
    : ['access'] as const;
```

Only health, login and refresh remain public. Update `errorHandler` so `SecurityError` returns its stable public code/message without logging credentials or decoded token content; unexpected errors remain generic `500` outside development.

- [ ] **Step 5: Run endpoint tests, lint and typecheck**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/app/auth.test.ts
npm.cmd run lint
npm.cmd run typecheck
Pop-Location
```

Expected: all login, token, lockout and forced-change tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/application/auth LayerManage/law-firm-system/apps/server/app/controller/auth.ts LayerManage/law-firm-system/apps/server/app/middleware LayerManage/law-firm-system/apps/server/app/router.ts LayerManage/law-firm-system/apps/server/test/app/auth.test.ts
git commit -m "feat(auth): enforce forced password change and session invalidation"
```

---

### Task 7: Protect the Trust Root from Existing Mutation APIs

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/application/system/trust-root-guard.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/user.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/role.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/organization.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/extend/helper.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/trust-root-guard.test.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/types/index.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/Role/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Role/index.test.tsx`

**Interfaces:**
- Consumes: `SystemInitialization.PRIMARY`, `SYSTEM_SUPER_ADMIN`, shared password policy and hasher.
- Produces `assertMutableUser(prisma, userId)`, `assertMutableRole(prisma, roleId)` and `assertDeletableOrganization(prisma, organizationId)`; protected objects return conflict code `TRUST_ROOT_PROTECTED`.

- [ ] **Step 1: Write failing API protection tests**

Using an authenticated access token, prove the existing endpoints cannot disable/delete the first super-admin, replace its roles, rename/disable/delete the protected role, assign permissions to it, or delete the root organization. Also assert user responses never contain `password`.

```ts
for (const request of protectedMutations) {
  const response = await request().expect(409);
  assert.equal(response.body.message, 'TRUST_ROOT_PROTECTED');
}
const list = await app.httpRequest().get('/api/v1/users').set('Authorization', bearer).expect(200);
assert.ok(list.body.data.list.every((user: object) => !('password' in user)));
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/app/trust-root-guard.test.ts
Pop-Location
```

Expected: FAIL because existing controllers can mutate and expose trust-root records.

- [ ] **Step 3: Implement guards and safe controller projections**

`assertMutableUser` compares the requested ID with `SystemInitialization.PRIMARY.superAdminUserId`. `assertMutableRole` loads role code and rejects `SYSTEM_SUPER_ADMIN`. `assertDeletableOrganization` compares the requested ID with `rootOrganizationId`. Call guards before user update/delete/role replacement, role update/delete/permission replacement, and organization deletion. Root organization name updates remain allowed; deletion is not.

Update user list/detail/create projections to explicitly omit `password`. User creation must normalize username, apply shared password policy, hash at cost 12, set `mustChangePassword: true`, and return a safe projection. Role creation must require an immutable normalized code matching `^[A-Z][A-Z0-9_]{2,63}$`, reject `SYSTEM_SUPER_ADMIN`, and create only `type: 'BUSINESS'` in this Spec.

Remove any remaining direct bcrypt usage from controllers. Add `code: string` to the frontend `Role` type. Update the existing role creation form to require an uppercase role code and send it to the API; add a page test that submits `BUSINESS_LAWYER` and proves the payload contains that exact immutable code.

- [ ] **Step 4: Run protection tests and static checks**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/app/trust-root-guard.test.ts
npm.cmd run lint
npm.cmd run typecheck
Pop-Location
npm.cmd --prefix LayerManage/law-firm-system/apps/web run typecheck
npm.cmd --prefix LayerManage/law-firm-system/apps/web run test -- src/pages/Role/index.test.tsx
```

Expected: protected mutations return `409`, password fields are absent, and static checks pass.

- [ ] **Step 5: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/application/system/trust-root-guard.ts LayerManage/law-firm-system/apps/server/app/controller/user.ts LayerManage/law-firm-system/apps/server/app/controller/role.ts LayerManage/law-firm-system/apps/server/app/controller/organization.ts LayerManage/law-firm-system/apps/server/test/app/trust-root-guard.test.ts LayerManage/law-firm-system/apps/web/src/types/index.ts LayerManage/law-firm-system/apps/web/src/pages/Role
git commit -m "fix(auth): protect initialized super-admin trust root"
```

---

### Task 8: Add the In-Memory Forced-Password-Change Web Flow

**Files:**
- Modify: `LayerManage/law-firm-system/apps/web/src/api/auth.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/stores/authStore.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/stores/passwordChangeStore.ts`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/Login/index.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/pages/Login/index.test.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/PasswordChange/index.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/PasswordChange/index.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: discriminated `LoginResult` and forced-change endpoint from Task 6.
- Produces `/password-change` route; temporary token exists only in non-persisted Zustand memory.

- [ ] **Step 1: Write failing Login, route and PasswordChange tests**

Add tests for all routing and storage boundaries:

```ts
test('routes a forced-change login without persisting a normal session', async () => {
  loginMock.mockResolvedValue({ code: 200, data: {
    mode: 'PASSWORD_CHANGE_REQUIRED', passwordChangeToken: 'change-token', expiresIn: 300,
  }});
  // submit form
  expect(window.localStorage.getItem('law_firm_token')).toBeNull();
  expect(window.localStorage.getItem('law_firm_refresh_token')).toBeNull();
  expect(window.localStorage.getItem('password_change_token')).toBeNull();
  expect(screen.getByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
});
```

Test direct `/password-change` without memory token redirects to `/login`; successful change clears memory and redirects to login; weak/reused errors show stable Chinese UI text without server internals; authenticated users cannot use the password-change route.

- [ ] **Step 2: Run web tests and confirm RED**

```powershell
npm.cmd --prefix LayerManage/law-firm-system/apps/web run test -- src/pages/Login/index.test.tsx src/pages/PasswordChange/index.test.tsx src/App.test.tsx
```

Expected: FAIL because result types, store, route and page are missing.

- [ ] **Step 3: Implement discriminated API types and memory store**

Use exact API types:

```ts
export type LoginData =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; passwordChangeToken: string; expiresIn: 300 }
  | { mode: 'AUTHENTICATED'; token: string; refreshToken: string; expiresIn: number; user: LoginUser };

forcePasswordChange: (token: string, password: string, confirmation: string) =>
  request.post<ApiResponse<null>>('/v1/auth/password/forced-change',
    { password, confirmation },
    { headers: { Authorization: `Bearer ${token}` } }),
```

Create a plain Zustand store without `persist`:

```ts
interface PasswordChangeState {
  token: string | null;
  expiresAt: number | null;
  begin(token: string, expiresIn: number): void;
  clear(): void;
}
```

Add `clearSession(): void` to `authStore`; it removes normal access/refresh storage and clears auth state without navigating. Keep `logout()` as the user-command wrapper that calls `clearSession()` and then navigates. No password-change token key, token value or store state may be written to local/session storage, cookies or URL parameters.

- [ ] **Step 4: Implement routing and page behavior**

Login branches on `res.data.mode`: authenticated behavior remains existing; password-change behavior calls `clearSession()`, calls `begin`, and navigates to `/password-change` without triggering the logout redirect.

The new page uses Ant Design `Form`, two `Input.Password` fields, a primary submit button and a logout/back-to-login command. It checks token presence and expiration before rendering; on success it calls `clear`, displays `密码已更新，请重新登录`, and navigates to `/login`. It does not explain internal token behavior or expose password rules beyond validation messages.

Add a `PasswordChangeRoute` in `App.tsx` that requires an unexpired in-memory change token and requires `isAuthenticated === false`.

- [ ] **Step 5: Run tests, lint, typecheck and build**

```powershell
npm.cmd --prefix LayerManage/law-firm-system/apps/web run test
npm.cmd --prefix LayerManage/law-firm-system/apps/web run lint
npm.cmd --prefix LayerManage/law-firm-system/apps/web run typecheck
npm.cmd --prefix LayerManage/law-firm-system/apps/web run build
```

Expected: all web tests PASS and production build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/apps/web/src
git commit -m "feat(web): add forced initial password change flow"
```

---

### Task 9: Add CI Contracts, Operator Runbook and End-to-End Acceptance

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/ci/check-bootstrap-contract.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/bootstrap-contract.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `LayerManage/law-firm-system/apps/server/docs/api-spec.md`
- Modify: `LayerManage/law-firm-system/docs/DEVELOPMENT.md`
- Modify: `LayerManage/law-firm-system/docs/DEPLOY.md`
- Create: `docs/superpowers/runbooks/system-bootstrap-and-super-admin-recovery.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces a continuous repository contract and exact operator procedure; leaves test PostgreSQL empty after acceptance.

- [ ] **Step 1: Write the failing bootstrap repository contract**

`check-bootstrap-contract.ts` must return issues when any invariant fails. Implement this exact first version and extend it only through failing fixture tests:

```ts
import fs from 'node:fs';
import path from 'node:path';

function read(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function manifest(filePath: string): { scripts?: Record<string, string> } {
  return JSON.parse(read(filePath)) as { scripts?: Record<string, string> };
}

export function checkBootstrapContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  const rootScripts = manifest(path.join(projectRoot, 'package.json')).scripts ?? {};
  const serverScripts = manifest(path.join(serverRoot, 'package.json')).scripts ?? {};
  const schema = read(path.join(serverRoot, 'prisma', 'schema.prisma'));
  const router = read(path.join(serverRoot, 'app', 'router.ts'));
  const envExample = read(path.join(serverRoot, '.env.example'));
  const startup = [
    read(path.join(serverRoot, 'app.ts')),
    read(path.join(serverRoot, 'server-entry.js')),
    read(path.join(serverRoot, 'config', 'config.default.ts')),
  ].join('\n');
  const cli = [
    read(path.join(serverRoot, 'scripts', 'system', 'bootstrap-system.ts')),
    read(path.join(serverRoot, 'scripts', 'system', 'recover-super-admin.ts')),
    read(path.join(serverRoot, 'scripts', 'system', 'system-cli.ts')),
  ].join('\n');

  if (rootScripts['system:bootstrap'] !== 'npm --prefix apps/server run system:bootstrap') issues.push('root bootstrap command is missing or changed');
  if (rootScripts['super-admin:recover'] !== 'npm --prefix apps/server run super-admin:recover') issues.push('root recovery command is missing or changed');
  if (!serverScripts['system:bootstrap']?.includes('scripts/system/bootstrap-system.ts')) issues.push('server bootstrap command is missing');
  if (!serverScripts['super-admin:recover']?.includes('scripts/system/recover-super-admin.ts')) issues.push('server recovery command is missing');
  if (!/model\s+SystemInitialization\s+\{/.test(schema)) issues.push('SystemInitialization model is missing');
  if (!/ALLOW_SUPER_ADMIN_RECOVERY=false/.test(envExample)) issues.push('recovery gate example must default to false');
  if (!/auth\/password\/forced-change/.test(router)) issues.push('forced password change route is missing');
  if (/router\.(?:get|post|put|patch|delete)\([^\n]*(?:bootstrap|recover)/i.test(router)) issues.push('HTTP bootstrap or recovery route exists');
  if (/SystemBootstrapService|SuperAdminRecoveryService|system:bootstrap|super-admin:recover/.test(startup)) issues.push('startup invokes system commands');
  if (/--password|--temporary-password|(?:PASSWORD|PASSWD|PWD)_?=/i.test(cli)) issues.push('CLI accepts a password argument or environment variable');
  if (/admin\s*[/:]\s*123456/i.test(cli)) issues.push('CLI contains default credentials');
  return issues;
}
```

Fixture tests must prove each required and forbidden pattern independently. Add `check:bootstrap` scripts at server and root level.

- [ ] **Step 2: Run the contract test and confirm RED**

```powershell
Push-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test --test-force-exit test/ci/bootstrap-contract.test.ts
Pop-Location
```

Expected: FAIL until the checker and package command exist.

- [ ] **Step 3: Implement the checker and wire CI**

Add `npm run check:bootstrap` to the root `verify` chain after `check:baseline`. In CI, retain the order: migrate empty database, assert empty, run verify, reset test database, reassert empty, reject generated drift. Do not invoke either interactive CLI in non-TTY CI; integration tests exercise their injected mains and domain services.

Extend `workflow-contract.test.ts` to assert `npm run verify` remains present and no workflow step exports `ALLOW_SUPER_ADMIN_RECOVERY=true`.

- [ ] **Step 4: Write exact operator documentation**

Update API docs with the discriminated login response and forced-change endpoint. Update development/deployment docs to replace “no login account” with this sequence:

```powershell
npm.cmd run db:deploy
npm.cmd run db:assert-empty
npm.cmd run system:bootstrap
```

The new runbook must include prerequisites, redacted target verification, initialization prompts, expected exit codes, first login/change/re-login, recovery gate enable/run/disable, audit queries by action, inconsistent-state investigation, backup-before-production instructions, and the statement that there is no HTTP initialization/recovery endpoint. It must explicitly say never paste a real password into command arguments, screenshots, tickets or logs.

- [ ] **Step 5: Run automated acceptance from a clean test database**

```powershell
$env:ALLOW_TEST_DB_RESET='true'
$env:DATABASE_URL='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:DATABASE_URL_TEST=$env:DATABASE_URL
Push-Location LayerManage\law-firm-system
npm.cmd run db:reset:test
npm.cmd run verify
npm.cmd run db:reset:test
npm.cmd run db:assert-empty
Pop-Location
git diff --check
git status --short
```

Expected: `verify` exits `0`; the final guarded reset succeeds; every application table is empty; `git diff --check` is silent; only intended source and documentation files are modified.

- [ ] **Step 6: Perform the manual TTY smoke test against the test database**

In a PowerShell terminal, set only the local test database target and run the interactive bootstrap:

```powershell
$env:DATABASE_URL='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:DATABASE_URL_TEST=$env:DATABASE_URL
npm.cmd --prefix LayerManage/law-firm-system run system:bootstrap
npm.cmd --prefix LayerManage/law-firm-system run system:bootstrap
```

Enter non-production temporary credentials through hidden prompts; verify the first exit is `0` and the second is `3`. Start `npm.cmd --prefix LayerManage/law-firm-system run dev:server` and `npm.cmd --prefix LayerManage/law-firm-system run dev:web` in separate terminals inheriting the same test `DATABASE_URL`, then complete login → forced change → re-login.

In the CLI terminal, enable recovery only for the command, verify old tokens fail afterward, and immediately clear the gate:

```powershell
$env:ALLOW_SUPER_ADMIN_RECOVERY='true'
npm.cmd --prefix LayerManage/law-firm-system run super-admin:recover
Remove-Item Env:ALLOW_SUPER_ADMIN_RECOVERY
$env:ALLOW_TEST_DB_RESET='true'
npm.cmd --prefix LayerManage/law-firm-system run db:reset:test
```

Do not perform this step against the development or production database. Do not automate passwords through command arguments or redirected stdin.

- [ ] **Step 7: Commit documentation and release contracts**

```powershell
git add .github/workflows/ci.yml LayerManage/law-firm-system/apps/server/scripts/ci/check-bootstrap-contract.ts LayerManage/law-firm-system/apps/server/test/ci LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/apps/server/docs/api-spec.md LayerManage/law-firm-system/docs docs/superpowers
git commit -m "docs: add SPEC-002 operations and acceptance gates"
```

- [ ] **Step 8: Request final code review before branch integration**

Invoke `superpowers:requesting-code-review`. Resolve findings with `superpowers:receiving-code-review`, rerun the complete Step 5 verification, then use `superpowers:finishing-a-development-branch` to offer merge/PR/keep/discard options. Do not mark SPEC-002 implemented until the fresh verification output is green and the manual TTY smoke test is recorded.

---

## Requirement-to-Task Traceability

| Spec requirement | Implemented by |
| --- | --- |
| Permanent singleton initialization and database protection | Tasks 1, 3, 7 |
| Root firm + first standalone super-admin | Tasks 1, 3 |
| Atomic transaction, audit rollback, dirty-state refusal, concurrency lock | Task 3 |
| Exact interactive bootstrap and recovery commands | Task 5 |
| Password policy and bcrypt cost 12 | Tasks 2, 7 |
| Token type and credential-version invalidation | Tasks 2, 6 |
| Five-failure lock and generic authentication error | Task 6 |
| Forced initial password change | Tasks 6, 8 |
| Recovery gate and target restriction | Tasks 4, 5 |
| Immutable application audit trail | Tasks 3, 4, 6, 7 |
| No HTTP bootstrap/recovery or implicit startup writes | Tasks 5, 9 |
| Real PostgreSQL tests and CI verification | Tasks 1, 3, 4, 6, 9 |
| Operator runbook and production MFA boundary | Task 9 |
