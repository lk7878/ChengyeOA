# Engineering Baseline and PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible engineering baseline and migrate the existing LayerManage runtime and verified SQLite data to a single PostgreSQL 16 database without changing the business meaning of the current 22 Prisma models.

**Architecture:** `D:/2_test/16_ChengyeOA` becomes the project Git repository while LawLink and LexNebulis remain ignored reference repositories. `LayerManage/law-firm-system/apps/server/prisma` becomes the only Prisma source; Docker Compose provides PostgreSQL 16; read-only SQLite tooling produces inventory, difference, import, and validation reports before any connection cutover.

**Tech Stack:** Node.js 22 LTS, npm, TypeScript, Egg.js 3, React 19, Vite 8, Prisma 5.22, PostgreSQL 16, Docker Compose, Node test runner, Egg Mock, Vitest, React Testing Library, GitHub Actions.

**Approved Spec:** `docs/superpowers/specs/2026-07-12-engineering-baseline-postgresql-migration-design.md`

## Global Constraints

- Use Node 22 LTS and npm; do not convert the repository to npm workspaces.
- Keep React, Egg.js, Prisma, and all other major dependencies at their current major versions.
- PostgreSQL 16 is the only application database after cutover; tests must use real PostgreSQL, not an in-memory SQLite substitute.
- Preserve all existing UUIDs, password hashes, status strings, relationships, and the business meaning of the current 22 models.
- Keep `tags`, `paymentTerms`, `teamIds`, and `kpiData` as strings in this migration; validate JSON syntax but do not convert them to JSONB.
- Store money as `Decimal @db.Decimal(18, 2)` and business timestamps as UTC.
- Treat both SQLite files as read-only evidence. No deletion or cutover is allowed before the difference report is reviewed.
- Never commit `.env`, secrets, SQLite files, database backups, migration exports, logs, or real client data.
- All destructive test-database commands must require both a database name ending in `_test` and `ALLOW_TEST_DB_RESET=true`.
- Commands and scripts must work in Windows PowerShell and CI; do not depend on Bash-only command composition.
- Execute Task 1 in the existing workspace. After the first commit, use `superpowers:using-git-worktrees` and execute Tasks 2-14 in an isolated worktree.

## File Map

| Area | Files | Responsibility |
|---|---|---|
| Repository | `.gitignore`, `.gitattributes`, `.nvmrc` | Version boundary, generated-file policy, Node baseline |
| PostgreSQL | `LayerManage/law-firm-system/infra/postgres/compose.yml`, `infra/postgres/init/01-create-test-database.sql` | Reproducible development and test databases |
| Environment | `apps/server/.env.example`, `apps/server/config/env.ts`, `apps/server/config/config.default.ts` | Validate configuration and reject unsafe production defaults |
| Database safety | `apps/server/scripts/db/reset-test-db.ts`, `apps/server/test/db/reset-test-db.test.ts` | Prevent accidental reset of a non-test database |
| Prisma | `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/*`, `apps/server/prisma/seed.ts` | Canonical PostgreSQL schema, migrations, and idempotent seed |
| Migration library | `apps/server/scripts/migration/types.ts`, `table-plan.ts`, `sqlite-source.ts`, `diff.ts`, `import-postgres.ts`, `validate.ts`, `cli.ts` | Read-only source analysis, deterministic import, verification reports |
| Migration tests | `apps/server/test/migration/*.test.ts`, `apps/server/test/fixtures/sqlite/*` | Difference, precision, ordering, idempotency, failure behavior |
| Backend tests | `apps/server/test/app/health.test.ts`, `apps/server/test/app/postgresql-smoke.test.ts` | Database health and current core-model regression checks |
| Frontend tests | `apps/web/src/test/setup.ts`, `apps/web/src/App.test.tsx`, `apps/web/src/pages/Login/index.test.tsx` | Startup, route protection, login failure behavior |
| Automation | `.github/workflows/ci.yml`, root and app `package.json` files | Clean install, PostgreSQL test service, unified verification |
| Decisions/runbooks | `docs/superpowers/adr/*.md`, `docs/superpowers/runbooks/*.md`, existing development/deployment docs | Long-lived rationale and operator instructions |

---

### Task 1: Establish the project Git baseline

**Files:**
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `.nvmrc`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Consumes: Approved SPEC-001 and the current unversioned workspace.
- Produces: A `main` branch whose tracked boundary includes project docs and LayerManage, and excludes LawLink/LexNebulis and generated or sensitive data.

- [ ] **Step 1: Create the root ignore policy**

Create `.gitignore` with this exact content:

```gitignore
/LawLink/
/LexNebulis/
/.worktrees/

**/node_modules/
**/dist/
**/coverage/
**/.cache/
**/.tmp/
**/.hermes/
**/run/
**/logs/
**/*.log

**/.env
**/.env.*
!**/.env.example

**/*.db
**/*.db-journal
**/*.sqlite
**/*.sqlite3
**/var/migration/
**/backups/

/LayerManage/law-firm-system/apps/server/public/
**/*.exe
**/*.zip
**/*.7z
**/*.msi
```

- [ ] **Step 2: Normalize text and runtime versions**

Create `.gitattributes`:

```gitattributes
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.json text eol=lf
*.md text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.ps1 text eol=crlf
*.bat text eol=crlf
*.db binary
*.docx binary
```

Create `.nvmrc`:

```text
22
```

- [ ] **Step 3: Initialize and inspect the repository boundary**

Run from `D:\2_test\16_ChengyeOA`:

```powershell
git init -b main
git status --short --ignored
git check-ignore -v LawLink LexNebulis LayerManage/law-firm-system/apps/server/prisma/law_firm.db
```

Expected: LawLink, LexNebulis, and both SQLite files are ignored; `律所闭环管理系统需求开发文档.md`, `docs/`, and LayerManage source files are available to track.

- [ ] **Step 4: Reject secret or generated files before staging**

Run:

```powershell
$forbidden = git ls-files --others --exclude-standard | Select-String -Pattern '(^|/)(\.env($|\.)|node_modules|dist|coverage|run|var/migration|backups)(/|$)|\.(db|sqlite3?|log|exe|zip)$'
if ($forbidden) { $forbidden; throw 'Forbidden untracked files are not ignored.' }
```

Expected: exit 0 with no matching path.

- [ ] **Step 5: Create the baseline commit**

```powershell
git add .gitignore .gitattributes .nvmrc docs LayerManage 律所闭环管理系统需求开发文档.md 律所管理系统PRD.docx 承业律师事务所整体发展框架设计方案.docx
git status --short
git commit -m "chore: establish ChengyeOA project baseline"
git status --short
```

Expected: commit succeeds and the final status is clean. If either DOCX is absent, omit only that absent path; do not substitute another document.

- [ ] **Step 6: Create the isolated implementation worktree**

Invoke `superpowers:using-git-worktrees`, then create branch `spec/spec-001-postgresql-baseline` under `.worktrees/spec-001-postgresql-baseline`.

Expected: `git branch --show-current` in the worktree prints `spec/spec-001-postgresql-baseline` and `git status --short` is empty.

---

### Task 2: Add PostgreSQL 16 and validated environment configuration

**Files:**
- Create: `LayerManage/law-firm-system/infra/postgres/compose.yml`
- Create: `LayerManage/law-firm-system/infra/postgres/init/01-create-test-database.sql`
- Create: `LayerManage/law-firm-system/apps/server/config/env.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/config/env.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/.env.example`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: `loadEnvironment(env: NodeJS.ProcessEnv): AppEnvironment`, Compose service `postgres`, and root commands `db:up`, `db:down`, `db:logs`.

- [ ] **Step 1: Write failing environment tests**

Create `apps/server/test/config/env.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '../../config/env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://chengye_app:local@localhost:5432/chengye_oa?schema=public',
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
};

test('accepts a PostgreSQL development environment', () => {
  assert.equal(loadEnvironment(valid).databaseUrl, valid.DATABASE_URL);
});

test('rejects SQLite URLs', () => {
  assert.throws(() => loadEnvironment({ ...valid, DATABASE_URL: 'file:./law_firm.db' }), /PostgreSQL/);
});

test('rejects sample secrets in production', () => {
  assert.throws(
    () => loadEnvironment({ ...valid, NODE_ENV: 'production', JWT_SECRET: 'replace_with_at_least_32_random_characters' }),
    /JWT_SECRET/,
  );
});
```

- [ ] **Step 2: Run the test and verify red**

Run from `LayerManage/law-firm-system/apps/server`:

```powershell
npm install
npm install --save-dev tsx
npx tsx --test test/config/env.test.ts
```

Expected: FAIL because `config/env.ts` does not exist.

- [ ] **Step 3: Implement strict environment loading**

Create `apps/server/config/env.ts`:

```ts
export interface AppEnvironment {
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  appKeys: string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const databaseUrl = required(env, 'DATABASE_URL');
  const jwtSecret = required(env, 'JWT_SECRET');
  const appKeys = required(env, 'APP_KEYS').split(',').map(value => value.trim()).filter(Boolean);

  if (!databaseUrl.startsWith('postgresql://')) throw new Error('DATABASE_URL must use PostgreSQL');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if (appKeys.length < 2 || appKeys.some(key => key.length < 24)) {
    throw new Error('APP_KEYS must contain at least two comma-separated keys of 24 characters');
  }
  if (nodeEnv === 'production' && /replace_with|change_me|local_only/i.test(`${databaseUrl}|${jwtSecret}|${appKeys.join(',')}`)) {
    throw new Error('Production environment contains sample DATABASE_URL, JWT_SECRET, or APP_KEYS values');
  }
  return { nodeEnv, databaseUrl, jwtSecret, appKeys };
}
```

In `config.default.ts`, call `const env = loadEnvironment(process.env)`, set `config.keys = env.appKeys.join(',')`, and set JWT `secret: env.jwtSecret`. Remove both hard-coded secret fallbacks.

- [ ] **Step 4: Add Compose configuration**

Create `infra/postgres/compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: chengye-oa-postgres
    environment:
      POSTGRES_DB: chengye_oa
      POSTGRES_USER: chengye_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-chengye_local_only}
      TZ: Asia/Shanghai
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - chengye_postgres_data:/var/lib/postgresql/data
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chengye_app -d chengye_oa"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

volumes:
  chengye_postgres_data:
```

Create `infra/postgres/init/01-create-test-database.sql`:

```sql
CREATE ROLE chengye_test LOGIN PASSWORD 'chengye_test_local_only';
CREATE DATABASE chengye_oa_test OWNER chengye_test ENCODING 'UTF8';
```

Replace `apps/server/.env.example` with:

```env
NODE_ENV=development
PORT=7001
DATABASE_URL="postgresql://chengye_app:chengye_local_only@localhost:5432/chengye_oa?schema=public"
DATABASE_URL_TEST="postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public"
JWT_SECRET="replace_with_at_least_32_random_characters"
APP_KEYS="replace_with_first_application_key,replace_with_second_application_key"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_EXPIRES_IN="30d"
LOG_LEVEL=info
LOG_DIR=./logs
```

- [ ] **Step 5: Add exact package scripts and engines**

Run from `LayerManage/law-firm-system`:

```powershell
npm pkg set "engines.node=>=22.12.0 <23"
npm pkg set "scripts.db:up=docker compose -f infra/postgres/compose.yml up -d postgres"
npm pkg set "scripts.db:down=docker compose -f infra/postgres/compose.yml down"
npm pkg set "scripts.db:logs=docker compose -f infra/postgres/compose.yml logs -f postgres"
Set-Location apps/server
npm pkg set "engines.node=>=22.12.0 <23"
npm install --save-dev tsx
```

- [ ] **Step 6: Verify green and database health**

```powershell
npx tsx --test test/config/env.test.ts
Set-Location ../..
npm run db:up
docker compose -f infra/postgres/compose.yml ps
docker compose -f infra/postgres/compose.yml exec -T postgres pg_isready -U chengye_app -d chengye_oa
```

Expected: 3 tests pass and `pg_isready` reports `accepting connections`.

- [ ] **Step 7: Commit**

```powershell
git add LayerManage/law-firm-system/infra LayerManage/law-firm-system/apps/server/.env.example LayerManage/law-firm-system/apps/server/config LayerManage/law-firm-system/apps/server/test/config LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "chore: add PostgreSQL development baseline"
```

---

### Task 3: Protect test database reset operations

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/db/reset-test-db.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/reset-test-db.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: `assertSafeTestDatabaseUrl(rawUrl: string, confirmation: string | undefined): URL` and root command `db:reset:test`.

- [ ] **Step 1: Write reset safety tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeTestDatabaseUrl } from '../../scripts/db/reset-test-db';

test('allows an explicitly confirmed test database', () => {
  const url = assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa_test', 'true');
  assert.equal(url.pathname, '/chengye_oa_test');
});

test('rejects a database without the test suffix', () => {
  assert.throws(() => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa', 'true'), /_test/);
});

test('rejects a reset without explicit confirmation', () => {
  assert.throws(() => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa_test', undefined), /ALLOW_TEST_DB_RESET/);
});
```

- [ ] **Step 2: Verify red**

Run: `npx tsx --test test/db/reset-test-db.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the protected reset**

Create `scripts/db/reset-test-db.ts`:

```ts
import { execFileSync } from 'node:child_process';

export function assertSafeTestDatabaseUrl(rawUrl: string, confirmation: string | undefined): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:') throw new Error('Test reset requires PostgreSQL');
  if (!url.pathname.slice(1).endsWith('_test')) throw new Error('Test database name must end with _test');
  if (confirmation !== 'true') throw new Error('ALLOW_TEST_DB_RESET=true is required');
  return url;
}

export function resetTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const rawUrl = env.DATABASE_URL_TEST || '';
  assertSafeTestDatabaseUrl(rawUrl, env.ALLOW_TEST_DB_RESET);
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(executable, ['prisma', 'migrate', 'reset', '--force', '--skip-seed'], {
    cwd: process.cwd(),
    env: { ...env, DATABASE_URL: rawUrl },
    stdio: 'inherit',
  });
}

if (require.main === module) resetTestDatabase();
```

- [ ] **Step 4: Add scripts and verify green**

```powershell
npm pkg set "scripts.db:reset:test=tsx scripts/db/reset-test-db.ts"
npx tsx --test test/db/reset-test-db.test.ts
Set-Location ../..
npm pkg set "scripts.db:reset:test=cd apps/server && npm run db:reset:test"
```

Expected: 3 tests pass. Do not execute the actual reset until Task 4 has created the PostgreSQL migration.

- [ ] **Step 5: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/scripts/db LayerManage/law-firm-system/apps/server/test/db LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "test: guard PostgreSQL test database resets"
```

---

### Task 4: Create the canonical PostgreSQL Prisma baseline

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- Replace: `LayerManage/law-firm-system/apps/server/prisma/migrations/*`
- Create: `docs/legacy/sqlite-migrations/server/20260426030733_init/migration.sql`
- Create: `docs/legacy/sqlite-migrations/server/migration_lock.toml`
- Create: `docs/legacy/sqlite-migrations/root/20260425081823_init/migration.sql`
- Create: `docs/legacy/sqlite-migrations/root/migration_lock.toml`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`

**Interfaces:**
- Produces: The sole PostgreSQL schema and a baseline migration that creates exactly the existing 22 models.

- [ ] **Step 1: Archive SQLite migration evidence**

Use PowerShell `Copy-Item` to copy both current migration directories and lock files to the exact `docs/legacy/sqlite-migrations/{server,root}` paths above. Then verify the copied SHA-256 values equal the originals with `Get-FileHash`.

Expected: every original/copy hash pair is identical.

- [ ] **Step 2: Add a failing schema contract test**

Create `apps/server/test/db/schema-contract.test.ts`:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const schema = fs.readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');

test('uses PostgreSQL and retains exactly 22 current models', () => {
  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 22);
});

test('maps every current money field to numeric 18,2', () => {
  const moneyLines = schema.split('\n').filter(line => /\b(cost|amount|paidAmount|receivedAmount|fee|score|bonus)\b/.test(line));
  assert.ok(moneyLines.length > 0);
  assert.ok(moneyLines.every(line => line.includes('@db.Decimal(18, 2)')));
});

test('keeps legacy JSON-like fields as strings', () => {
  for (const field of ['tags', 'paymentTerms', 'teamIds', 'kpiData']) {
    assert.match(schema, new RegExp(`\\b${field}\\s+String\\??`));
  }
});
```

- [ ] **Step 3: Verify red**

Run: `npx tsx --test test/db/schema-contract.test.ts`

Expected: FAIL because provider is SQLite and Decimal fields lack native PostgreSQL types.

- [ ] **Step 4: Convert the canonical schema without business expansion**

In `apps/server/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Add `@db.Decimal(18, 2)` to the existing Decimal fields only. Do not add models, rename fields, change IDs, convert string fields to `Json`, or change relations.

- [ ] **Step 5: Generate the PostgreSQL baseline migration**

Remove only `apps/server/prisma/migrations/` after the archive hashes pass. Run with the development URL loaded:

```powershell
$env:DATABASE_URL='postgresql://chengye_app:chengye_local_only@localhost:5432/chengye_oa?schema=public'
npx prisma format
npx prisma validate
npx prisma migrate dev --name postgresql_baseline
npx prisma generate
```

Expected: Prisma creates one PostgreSQL baseline migration and reports that the database is in sync.

- [ ] **Step 6: Verify schema and test reset**

```powershell
npx tsx --test test/db/schema-contract.test.ts test/db/reset-test-db.test.ts
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public'
$env:ALLOW_TEST_DB_RESET='true'
npm run db:reset:test
```

Expected: schema tests pass and the test database is reset using the committed PostgreSQL migration.

- [ ] **Step 7: Commit**

```powershell
git add docs/legacy/sqlite-migrations LayerManage/law-firm-system/apps/server/prisma/schema.prisma LayerManage/law-firm-system/apps/server/prisma/migrations LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts
git commit -m "feat: establish canonical PostgreSQL Prisma schema"
```

---

### Task 5: Consolidate an idempotent system seed

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/seed.ts`
- Delete: `LayerManage/law-firm-system/apps/server/scripts/seed.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/seed-idempotency.test.ts`

**Interfaces:**
- Produces: `seed(prisma: PrismaClient, adminPassword: string): Promise<void>`; creates only deterministic organization, position, employee, admin user, roles, permissions, and join records.

- [ ] **Step 1: Write the failing idempotency test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { seed } from '../../prisma/seed';

test('seed is idempotent', async () => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });
  try {
    await seed(prisma, 'test-admin-password');
    const first = { users: await prisma.user.count(), roles: await prisma.role.count(), permissions: await prisma.permission.count() };
    await seed(prisma, 'test-admin-password');
    const second = { users: await prisma.user.count(), roles: await prisma.role.count(), permissions: await prisma.permission.count() };
    assert.deepEqual(second, first);
  } finally {
    await prisma.$disconnect();
  }
});
```

- [ ] **Step 2: Verify red against the current non-exported seed**

Run with `DATABASE_URL_TEST` set: `npx tsx --test test/db/seed-idempotency.test.ts`

Expected: FAIL because `seed` is not exported or because duplicate records are created.

- [ ] **Step 3: Implement one deterministic seed**

Refactor `prisma/seed.ts` to export `seed`. Use stable IDs (`firm-001`, `dept-001`, `pos-001`), `upsert` by existing unique keys, and `userRole`/`rolePermission` compound unique keys. Seed exactly these permission codes: `system`, `user:manage`, `user:create`, `user:read`, `user:update`, `user:delete`, `role:manage`, `role:create`, `role:read`, `role:update`, `role:delete`. Do not seed channels, leads, customers, contracts, cases, payments, or other sample business records.

The executable footer must be:

```ts
if (require.main === module) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required');
  const prisma = new PrismaClient();
  seed(prisma, password)
    .finally(async () => prisma.$disconnect());
}
```

- [ ] **Step 4: Verify idempotency twice**

```powershell
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public'
npx tsx --test test/db/seed-idempotency.test.ts
$env:DATABASE_URL=$env:DATABASE_URL_TEST
$env:SEED_ADMIN_PASSWORD='test-admin-password'
npm run db:seed
npm run db:seed
```

Expected: test passes; both seed commands succeed; user/role/permission counts do not increase on the second run.

- [ ] **Step 5: Remove the duplicate seed and commit**

```powershell
Remove-Item -LiteralPath 'scripts\seed.ts'
git add apps/server/prisma/seed.ts apps/server/test/db/seed-idempotency.test.ts apps/server/scripts/seed.ts
git commit -m "refactor: consolidate idempotent system seed"
```

---

### Task 6: Build read-only SQLite inventory and difference reports

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/types.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/table-plan.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/sqlite-source.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/diff.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/sqlite-source.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/diff.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/fixtures/sqlite/create-fixtures.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`

**Interfaces:**
- Consumes: The source paths and `TABLE_ORDER`/`BUSINESS_KEYS` declared in this task.
- Produces: `inventorySqlite(sourcePath): SourceInventory`, `snapshotSqlite(sourcePath): SourceSnapshot`, and `diffSnapshots(primary, secondary): DiffReport`.
- Data types: `ConflictKind = 'PRIMARY_ONLY' | 'SECONDARY_ONLY' | 'CONTENT_MISMATCH' | 'BUSINESS_KEY_COLLISION'`.

- [ ] **Step 1: Define migration contracts**

Create `types.ts` with serializable interfaces for `SourceManifest`, `TableInventory`, `SourceInventory`, `SourceSnapshot`, `RecordConflict`, and `DiffReport`. Every report includes `runId`, `generatedAt`, source SHA-256, table counts, and conflicts; row details expose IDs and field-name lists, not full sensitive values.

Create `table-plan.ts` exporting the exact foreign-key order:

```ts
export const TABLE_ORDER = [
  'Organization', 'Position', 'Employee', 'User', 'Role', 'Permission',
  'UserRole', 'RolePermission', 'LoginLog', 'Channel', 'Lead', 'LeadFollow',
  'Customer', 'Contract', 'Payment', 'Case', 'CaseTask', 'Communication',
  'Performance', 'Approval', 'Notification', 'OperationLog',
] as const;

export const BUSINESS_KEYS: Partial<Record<(typeof TABLE_ORDER)[number], string[]>> = {
  Employee: ['employeeNo'], User: ['username'], Permission: ['code'],
  Contract: ['contractNo'], Case: ['caseNo'],
};
```

- [ ] **Step 2: Write fixture-driven failing tests**

Tests must create two temporary SQLite fixtures: one shared record, one secondary-only record, one same-ID content mismatch, and one business-key collision. Assertions:

```ts
assert.equal(inventory.tables.Organization.rowCount, 2);
assert.equal(report.counts.SECONDARY_ONLY, 1);
assert.equal(report.counts.CONTENT_MISMATCH, 1);
assert.equal(report.counts.BUSINESS_KEY_COLLISION, 1);
assert.ok(report.conflicts.every(conflict => !JSON.stringify(conflict).includes('13800138000')));
```

- [ ] **Step 3: Verify red**

```powershell
npm install --save-dev better-sqlite3 @types/better-sqlite3
npx tsx --test test/migration/sqlite-source.test.ts test/migration/diff.test.ts
```

Expected: FAIL because inventory and diff functions are absent.

- [ ] **Step 4: Implement read-only source handling**

Open SQLite with `{ readonly: true, fileMustExist: true }`. Read tables only from `TABLE_ORDER`, use `PRAGMA table_info`, compute SHA-256 with `createHash('sha256')`, canonicalize each row by sorted keys, normalize Buffer values to hex, and replace values for fields matching `/password|phone|email|idCard/i` with SHA-256 before placing them in reports. Never execute INSERT, UPDATE, DELETE, VACUUM, or schema statements against a source file.

- [ ] **Step 5: Implement deterministic diffing**

Compare records by `id`, then compare configured business keys among records with different IDs. Sort tables, IDs, changed-field names, and conflicts before JSON serialization so repeated runs produce identical content except `generatedAt` and `runId`.

- [ ] **Step 6: Verify green and read-only behavior**

```powershell
npx tsx --test test/migration/sqlite-source.test.ts test/migration/diff.test.ts
```

Expected: all fixture tests pass, sensitive fixture values are absent from serialized reports, and fixture source hashes remain unchanged.

- [ ] **Step 7: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/scripts/migration LayerManage/law-firm-system/apps/server/test/migration LayerManage/law-firm-system/apps/server/test/fixtures LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json
git commit -m "feat: add read-only SQLite inventory and diff tooling"
```

---

### Task 7: Implement deterministic PostgreSQL import

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/normalize.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/import-postgres.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/normalize.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/import-postgres.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`

**Interfaces:**
- Consumes: `TABLE_ORDER`, a primary `SourceSnapshot`, and `DATABASE_URL`.
- Produces: `normalizeRow(table, row): Record<string, unknown>` and `importSnapshot(client, snapshot): Promise<ImportReport>`.

- [ ] **Step 1: Write normalization tests**

Cover these exact rules:

```ts
assert.equal(normalizeRow('Contract', { amount: 30000 }).amount, '30000.00');
assert.equal(normalizeRow('Payment', { receivedAmount: 0.1 + 0.2 }).receivedAmount, '0.30');
assert.equal(normalizeRow('Contract', { signDate: '2026-04-01 08:00:00' }).signDate, '2026-04-01T00:00:00.000Z');
assert.equal(normalizeRow('Lead', { tags: '["重点"]' }).tags, '["重点"]');
assert.throws(() => normalizeRow('Lead', { tags: '[invalid' }), /invalid JSON/);
```

Document in the test name that legacy SQLite timestamps are interpreted as `Asia/Shanghai` before conversion to UTC.

- [ ] **Step 2: Write a failing import idempotency test**

Reset the PostgreSQL test database, import a fixture snapshot twice, then assert the second report contains zero inserts, only matching updates/skips, and unchanged table counts. Include a forced invalid foreign key and assert the transaction rolls back the entire import.

- [ ] **Step 3: Verify red and add PostgreSQL driver**

```powershell
npm install --save-dev pg @types/pg decimal.js
npx tsx --test test/migration/normalize.test.ts test/migration/import-postgres.test.ts
```

Expected: FAIL because normalize/import modules do not exist.

- [ ] **Step 4: Implement normalization**

Use `decimal.js` for money, `Intl.DateTimeFormat`-compatible conversion through an explicit `+08:00` suffix for legacy naive timestamps, preserve UUID strings, and parse/re-stringify the four JSON-like string fields only to validate syntax. Return ISO UTC strings for DateTime fields and fixed two-decimal strings for money.

- [ ] **Step 5: Implement parameterized upsert import**

Use `pg.Pool`. Permit table and column identifiers only when present in the schema-derived allowlist; quote identifiers with double quotes; pass all values as `$1...$n` parameters. Import in `TABLE_ORDER` inside one transaction. Use `ON CONFLICT ("id") DO UPDATE` while preserving `id`; increment inserted/updated/skipped/failed counters in `ImportReport`. Roll back and write the failing table/id/error code when any row fails.

- [ ] **Step 6: Verify green and idempotency**

Run:

```powershell
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public'
$env:ALLOW_TEST_DB_RESET='true'
npm run db:reset:test
npx tsx --test test/migration/normalize.test.ts test/migration/import-postgres.test.ts
```

Expected: normalization, repeat import, and rollback tests all pass.

- [ ] **Step 7: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/scripts/migration LayerManage/law-firm-system/apps/server/test/migration LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json
git commit -m "feat: add idempotent PostgreSQL migration importer"
```

---

### Task 8: Add migration validation and a single CLI

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/validate.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/report-writer.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/migration/cli.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/validate.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/migration/cli.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Consumes: Source snapshots and import reports produced by Tasks 6 and 7.
- Produces CLI commands `inventory`, `diff`, `import`, `validate`; `validateMigration(pool, snapshot): Promise<ValidationReport>`; output root `var/migration/<run-id>/`.

- [ ] **Step 1: Write failing validation tests**

Create fixture cases for row-count mismatch, orphaned foreign key, duplicate business key, amount-total mismatch, shifted timestamp, unchanged password hash, and valid import. Each result item has `check`, `table`, `status: 'PASS' | 'FAIL'`, `expected`, and `actual`.

- [ ] **Step 2: Write failing CLI safety tests**

Assert that:

```ts
assert.throws(() => parseArgs(['import']), /--source/);
assert.throws(() => parseArgs(['import', '--source', 'a.db']), /--confirm-diff/);
assert.deepEqual(parseArgs(['diff', '--primary', 'a.db', '--secondary', 'b.db', '--run-id', 'r1']).command, 'diff');
```

Import must require `--confirm-diff <sha256-of-diff-report>`; a stale or mismatched report hash aborts before connecting to PostgreSQL.

- [ ] **Step 3: Verify red**

Run: `npx tsx --test test/migration/validate.test.ts test/migration/cli.test.ts`

Expected: FAIL because validation and CLI modules do not exist.

- [ ] **Step 4: Implement validation checks**

For all 22 tables compare counts and primary IDs. Add explicit relationship queries for User-Employee, Position-Organization, Lead-Channel/Employee, Customer-Lead, Contract-Customer, Payment-Contract/Customer, Case-Customer/Contract/Employee, and task/communication parent relationships. Compare Decimal totals as strings using `decimal.js`; compare timestamp samples after UTC normalization; compare password hashes byte-for-byte.

- [ ] **Step 5: Implement report writing and CLI**

Write JSON via a temporary file followed by atomic rename. Reject run IDs outside `/^[a-zA-Z0-9_-]+$/`. The CLI must never place raw rows in `inventory.json`, `diff-report.json`, or `validation-report.json`; full normalized exports remain under ignored `export/` only.

Add scripts:

```json
{
  "migration:inventory": "tsx scripts/migration/cli.ts inventory",
  "migration:diff": "tsx scripts/migration/cli.ts diff",
  "migration:import": "tsx scripts/migration/cli.ts import",
  "migration:validate": "tsx scripts/migration/cli.ts validate"
}
```

Expose equivalent root scripts by prefixing `cd apps/server && npm run`.

- [ ] **Step 6: Verify green**

```powershell
npx tsx --test test/migration/validate.test.ts test/migration/cli.test.ts
npx tsx --test test/migration/*.test.ts
```

Expected: all migration tests pass, including stale-diff rejection and rollback behavior.

- [ ] **Step 7: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/scripts/migration LayerManage/law-firm-system/apps/server/test/migration LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "feat: add migration validation and guarded CLI"
```

---

### Task 9: Generate and review the real dual-SQLite difference report

**Files:**
- Runtime only, ignored: `LayerManage/law-firm-system/var/migration/<run-id>/*`
- Modify after decision: `docs/superpowers/runbooks/sqlite-to-postgresql-migration.md`

**Interfaces:**
- Consumes: Both real SQLite files in read-only mode.
- Produces: Source manifests, inventories, and a reviewed difference decision. This task is an explicit human gate.

- [ ] **Step 1: Record source hashes before any operation**

```powershell
Get-FileHash 'LayerManage\law-firm-system\apps\server\prisma\law_firm.db','LayerManage\law-firm-system\prisma\law_firm.db' -Algorithm SHA256
```

Expected current hashes:

```text
apps/server/prisma/law_firm.db  B61917FFA7823F15CA9F9A20EB95463B28F0A7AB161108338FFBE068CAD48E11
prisma/law_firm.db              9A8F3EED9B429190643CE1A55F11F61A2B3DD4329C28DA3E4F6182F93A8C629C
```

If either hash differs, stop and report the new values; do not infer that the old candidate source is still valid.

- [ ] **Step 2: Create read-only copies and run inventory/diff**

Use run ID `spec001-real-audit-YYYYMMDD-HHmmss`, copy both files into that ignored run directory, mark copies read-only, then run:

```powershell
npm run migration:inventory -- --source <primary-copy> --run-id <run-id>-primary
npm run migration:inventory -- --source <secondary-copy> --run-id <run-id>-secondary
npm run migration:diff -- --primary <primary-copy> --secondary <secondary-copy> --run-id <run-id>
```

Expected: all reports are generated; the original two file hashes remain unchanged.

- [ ] **Step 3: Apply the human difference gate**

Present a compact table containing per-table counts and every `SECONDARY_ONLY`, `CONTENT_MISMATCH`, and `BUSINESS_KEY_COLLISION` item by table and internal ID. Do not display full phone numbers, passwords, email addresses, or row payloads.

Gate outcomes:

1. `APPROVE_PRIMARY`: continue using `apps/server/prisma/law_firm.db` as the sole import source.
2. `APPROVE_MERGE_RULES`: add explicit, ID-level merge decisions to the runbook and a fixture test for every rule before continuing.
3. `REJECT_AND_INVESTIGATE`: stop this Plan at Task 9; do not import or remove either source.

- [ ] **Step 4: Commit only the non-sensitive decision record**

Record source hashes, aggregate counts, conflict classifications, selected gate outcome, reviewer, and review date in the migration runbook. Do not commit generated reports or row data.

```powershell
git add docs/superpowers/runbooks/sqlite-to-postgresql-migration.md
git commit -m "docs: record SQLite source audit decision"
```

---

### Task 10: Rehearse import, validate, and remove duplicate Prisma runtime paths

**Files:**
- Delete after successful gate: `LayerManage/law-firm-system/prisma/schema.prisma`
- Delete after successful gate: `LayerManage/law-firm-system/prisma/migrations/*`
- Delete from runtime path after successful gate: both tracked references to duplicate root Prisma tooling; SQLite files remain ignored archives outside Git
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/package-lock.json`
- Create: `LayerManage/law-firm-system/apps/server/test/db/single-prisma-source.test.ts`

**Interfaces:**
- Consumes: An approved Task 9 difference decision and its report hash.
- Produces: A validated PostgreSQL rehearsal and one runtime Prisma source.

- [ ] **Step 1: Write a failing single-source test**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('only apps/server contains a runtime Prisma schema', () => {
  const projectRoot = path.resolve(__dirname, '../../../..');
  assert.equal(fs.existsSync(path.join(projectRoot, 'prisma/schema.prisma')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'apps/server/prisma/schema.prisma')), true);
});
```

- [ ] **Step 2: Verify red**

Run: `npx tsx --test test/db/single-prisma-source.test.ts`

Expected: FAIL because the root Prisma schema still exists.

- [ ] **Step 3: Reset the development database and import approved data**

Take a PostgreSQL volume snapshot or `pg_dump` before import. Apply migrations, then run import with the approved diff-report SHA-256. Run validation twice and compare report results.

Expected: all required validation checks pass; the second import creates no duplicate rows; original SQLite hashes remain unchanged.

- [ ] **Step 4: Remove duplicate runtime Prisma files and dependencies**

Delete `LayerManage/law-firm-system/prisma/schema.prisma` and its migration tree only after Step 3 passes. Remove root `prisma` and `@prisma/client` dependencies:

```powershell
Set-Location LayerManage\law-firm-system
npm uninstall prisma @prisma/client
```

Keep the two ignored SQLite files in a documented read-only archive until final migration acceptance.

- [ ] **Step 5: Verify single source and clean installs**

```powershell
Set-Location apps\server
npx tsx --test test/db/single-prisma-source.test.ts test/db/schema-contract.test.ts
npx prisma validate
Set-Location ../..
npm install
```

Expected: tests and Prisma validation pass; root install does not install Prisma.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/prisma LayerManage/law-firm-system/apps/server/test/db/single-prisma-source.test.ts LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "refactor: remove duplicate Prisma runtime source"
```

---

### Task 11: Add backend PostgreSQL health and core regression tests

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/home.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/health.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/postgresql-smoke.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`

**Interfaces:**
- Produces: `/api/health` with `{ code, message, data: { status, database } }`; backend test command covering PostgreSQL and current core object relationships.

- [ ] **Step 1: Write a failing health test**

Using `egg-mock`, start the app with `DATABASE_URL_TEST` mapped to `DATABASE_URL` and assert:

```ts
await app.httpRequest()
  .get('/api/health')
  .expect(200)
  .expect({ code: 200, message: 'success', data: { status: 'ok', database: 'ok' } });
```

Also stop PostgreSQL for one test or stub `$queryRaw` to throw and assert HTTP 503 with `{ status: 'degraded', database: 'unavailable' }`. The response must not contain a connection URL, database name, table name, version, or stack trace.

- [ ] **Step 2: Write a failing PostgreSQL smoke test**

Create and remove, in reverse dependency order, records for Organization, Position, Employee, Channel, Lead, Customer, Contract, Payment, Case, and CaseTask. Assert Decimal round-trip equals `30000.00`, relations resolve, and DateTime values round-trip as UTC.

- [ ] **Step 3: Verify red and install Egg test support**

```powershell
npm install --save-dev egg-mock
npx tsx --test test/app/health.test.ts test/app/postgresql-smoke.test.ts
```

Expected: health payload mismatch and/or missing test setup causes failure.

- [ ] **Step 4: Implement database-aware health**

In `HomeController.index`, execute `await ctx.prisma.$queryRaw\`SELECT 1\``. Return the exact success payload above. Catch connection failures, set `ctx.status = 503`, and return only:

```ts
{ code: 503, message: 'service unavailable', data: { status: 'degraded', database: 'unavailable' } }
```

- [ ] **Step 5: Verify green**

```powershell
$env:DATABASE_URL='postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public'
npx tsx --test test/app/health.test.ts test/app/postgresql-smoke.test.ts
npm run lint
npm run build
```

Expected: both tests pass; lint and server build exit 0.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/apps/server/app/controller/home.ts LayerManage/law-firm-system/apps/server/test/app LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json
git commit -m "test: cover PostgreSQL health and core data flow"
```

---

### Task 12: Add frontend tests and unified verification commands

**Files:**
- Create: `LayerManage/law-firm-system/apps/web/src/test/setup.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/App.test.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Login/index.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/vite.config.ts`
- Modify: `LayerManage/law-firm-system/apps/web/tsconfig.app.json`
- Modify: `LayerManage/law-firm-system/apps/web/package.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: web commands `lint`, `typecheck`, `test`; project commands `setup`, `lint`, `typecheck`, `test`, `build`, `verify`.

- [ ] **Step 1: Write route and login failure tests**

Create `App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { useAuthStore } from './stores/authStore';

describe('application routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
    window.history.pushState({}, '', '/');
  });

  it('redirects an unauthenticated user to login', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: '律所管理系统' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });
});
```

Create `Login/index.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/api/auth';
import Login from './index';

vi.mock('@/api/auth', () => ({ authApi: { login: vi.fn() } }));

describe('Login', () => {
  beforeEach(() => vi.mocked(authApi.login).mockReset());

  it('restores the form after a rejected login', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new Error('unauthorized'));
    const user = userEvent.setup();
    render(<MemoryRouter><Login /></MemoryRouter>);
    await user.type(screen.getByPlaceholderText('用户名'), 'admin');
    await user.type(screen.getByPlaceholderText('密码'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登 录' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '登 录' })).toBeEnabled());
    expect(screen.getByPlaceholderText('用户名')).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify red and install test tools**

```powershell
Set-Location LayerManage\law-firm-system\apps\web
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npx vitest run
```

Expected: FAIL until test configuration and browser API setup exist.

- [ ] **Step 3: Configure the test environment**

Add `test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', clearMocks: true }` to `vite.config.ts`. Add `"vitest/globals"` and `"@testing-library/jest-dom"` to `compilerOptions.types`.

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
});
```

- [ ] **Step 4: Add app and root scripts**

Web scripts: `lint=eslint .`, `typecheck=tsc -b`, `test=vitest run`.

Server scripts: `typecheck=tsc --noEmit`, `test:unit=tsx --test test/**/*.test.ts`; update `test` to execute non-destructive unit tests and require explicit database setup for integration tests.

Root scripts:

```json
{
  "setup": "npm install && cd apps/server && npm ci && npm run db:generate && cd ../web && npm ci",
  "lint": "cd apps/server && npm run lint && cd ../web && npm run lint",
  "typecheck": "cd apps/server && npm run typecheck && cd ../web && npm run typecheck",
  "test": "cd apps/server && npm run test && cd ../web && npm run test",
  "build": "npm run build:server && npm run build:web",
  "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
}
```

- [ ] **Step 5: Verify green**

```powershell
Set-Location LayerManage\law-firm-system\apps\web
npm run test
npm run lint
npm run typecheck
Set-Location ../..
npm run verify
```

Expected: web tests pass and project verification exits 0. An existing lint failure is a review checkpoint: record the exact file, line, rule, and output, then amend this Plan with the narrowly scoped correction before continuing.

- [ ] **Step 6: Commit**

```powershell
git add LayerManage/law-firm-system/apps/web LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "test: add frontend and unified verification baseline"
```

---

### Task 13: Add CI and secret/schema drift gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `LayerManage/law-firm-system/apps/server/scripts/ci/check-schema-source.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/check-schema-source.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: CI that installs from lockfiles, starts PostgreSQL 16, applies migrations/seed, runs `verify`, detects schema duplication and generated drift, and scans secrets.

- [ ] **Step 1: Write a failing schema-source gate test**

Test a temporary directory containing two `schema.prisma` files and assert `findRuntimeSchemas(root)` throws with both paths. Test the real project and expect exactly `apps/server/prisma/schema.prisma`.

- [ ] **Step 2: Implement schema-source detection**

Traverse the project while skipping `node_modules`, `docs`, `var`, `.git`, and `.worktrees`. Export `findRuntimeSchemas(root): string[]`; CLI exits 1 unless the result exactly equals `apps/server/prisma/schema.prisma` after slash normalization.

- [ ] **Step 3: Verify locally**

```powershell
npx tsx --test test/ci/check-schema-source.test.ts
npx tsx scripts/ci/check-schema-source.ts
```

Expected: tests and real-project check exit 0.

- [ ] **Step 4: Create CI workflow**

The workflow must use `actions/checkout@v4`, `actions/setup-node@v4` with Node `22` and npm cache paths for all three lockfiles, and a `postgres:16-alpine` service with health checks. Set test-only environment values, run `npm ci` in root/server/web, apply migrations, seed twice, run `npm run verify`, reset a second empty test database, run schema-source detection, then run `git diff --exit-code`.

Add a separate `gitleaks/gitleaks-action@v2` job. Grant only `contents: read` permission.

- [ ] **Step 5: Validate workflow syntax and commands**

Run the workflow's install, migration, seed, verify, schema check, and `git diff --exit-code` commands locally in the same order.

Expected: all commands exit 0 and the worktree remains clean.

- [ ] **Step 6: Commit**

```powershell
git add .github/workflows/ci.yml LayerManage/law-firm-system/apps/server/scripts/ci LayerManage/law-firm-system/apps/server/test/ci LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "ci: enforce PostgreSQL engineering baseline"
```

---

### Task 14: Complete ADRs, runbooks, recovery rehearsal, and final verification

**Files:**
- Create: `docs/superpowers/adr/0001-project-repository-boundary.md`
- Create: `docs/superpowers/adr/0002-postgresql-and-canonical-prisma.md`
- Create: `docs/superpowers/runbooks/local-development.md`
- Complete: `docs/superpowers/runbooks/sqlite-to-postgresql-migration.md`
- Create: `docs/superpowers/runbooks/postgresql-backup-restore.md`
- Modify: `LayerManage/law-firm-system/docs/DEVELOPMENT.md`
- Modify: `LayerManage/law-firm-system/docs/DEPLOY.md`
- Modify: `LayerManage/law-firm-system/docs/DATABASE.md`
- Modify: `docs/superpowers/README.md`
- Modify after acceptance: `docs/superpowers/specs/2026-07-12-engineering-baseline-postgresql-migration-design.md`

**Interfaces:**
- Consumes: Actual commands, reports, and outcomes from Tasks 1-13.
- Produces: Operator-ready documentation and final SPEC-001 acceptance evidence.

- [ ] **Step 1: Write the two ADRs**

Each ADR must contain `Status`, `Context`, `Decision`, `Consequences`, and `Supersedes`. ADR-0001 records the root repository boundary and ignored reference repositories. ADR-0002 records PostgreSQL 16, Docker for development/test, and `apps/server/prisma` as the canonical source.

- [ ] **Step 2: Write the local development runbook**

Include exact Windows PowerShell commands for Node 22 selection, three lockfile installs, `.env` creation from `.env.example`, `db:up`, migration deploy, seed, server/web startup, `verify`, database stop, and non-destructive troubleshooting. State that `db:down` preserves the volume.

- [ ] **Step 3: Complete migration and rollback runbooks**

Document source hashes, inventory/diff commands, approved conflict decision, report-hash confirmation, import, validation, switch, failure thresholds, SQLite rollback, and PostgreSQL incremental export. Include the rule that PostgreSQL writes after cutover are exported before any rollback.

- [ ] **Step 4: Write and execute backup/restore rehearsal**

Use `pg_dump -Fc` through the Compose container, restore into a newly created `chengye_oa_restore_test` database, then compare all 22 table counts and Decimal totals. Record command output summaries and elapsed time without credentials or client data.

Expected: restore database passes the same validation checks; measured recovery time is recorded against the PRD RTO target of 4 hours.

- [ ] **Step 5: Replace stale SQLite/Node 18 documentation**

Update DEVELOPMENT, DEPLOY, and DATABASE so all setup paths use Node 22, npm, PostgreSQL 16, canonical Prisma commands, environment validation, backups, and the protected test reset. Remove instructions that connect directly to SQLite or advise multiple package managers.

- [ ] **Step 6: Run the complete acceptance suite**

From the project root:

```powershell
git status --short
Set-Location LayerManage\law-firm-system
npm run db:up
npm run setup
npm run verify
Set-Location apps\server
npx prisma validate
npx prisma migrate status
npx tsx scripts/ci/check-schema-source.ts
Set-Location ..\..\..
git check-ignore -v LawLink LexNebulis LayerManage/law-firm-system/apps/server/prisma/law_firm.db
git diff --check
git status --short
```

Expected: verification passes, Prisma reports database schema up to date, only the canonical schema is found, ignored boundaries are correct, `git diff --check` is clean, and status contains only intentional documentation changes.

- [ ] **Step 7: Request code review before marking complete**

Invoke `superpowers:requesting-code-review`. Review against every acceptance item in SPEC-001 Section 13 and resolve all correctness, data-loss, security, and missing-test findings.

- [ ] **Step 8: Mark documentation implemented and commit**

After review and acceptance, change SPEC-001 and its index entry from `已批准` to `已实施`, add the implementation completion date and the final validation report run ID, then commit:

```powershell
git add docs LayerManage/law-firm-system/docs
git commit -m "docs: complete PostgreSQL migration runbooks"
git status --short
```

Expected: commit succeeds and worktree is clean.

## Execution Checkpoints

1. **After Task 1:** repository boundary is reviewed before creating the worktree.
2. **After Task 4:** PostgreSQL schema is reviewed before any real data tooling runs.
3. **After Task 8:** migration tool code receives a focused review before reading real SQLite files.
4. **At Task 9:** execution stops for the human difference decision; no agent may infer approval.
5. **After Task 10:** rehearsal validation is reviewed before application cutover.
6. **After Task 13:** CI and full verification must pass before documentation can claim implementation.

## Spec Coverage Matrix

| SPEC-001 area | Implemented by |
|---|---|
| Repository boundary and worktrees | Tasks 1, 14 |
| Node/npm and environment baseline | Tasks 2, 12, 13 |
| PostgreSQL 16 development/test runtime | Tasks 2, 3, 13 |
| Canonical Prisma schema/migrations/seed | Tasks 4, 5, 10 |
| Dual SQLite inventory and conflicts | Tasks 6, 8, 9 |
| Idempotent import and validation | Tasks 7, 8, 10 |
| Backend and frontend regression tests | Tasks 11, 12 |
| Unified verification and CI | Tasks 12, 13 |
| Cutover, rollback, backup, recovery | Tasks 9, 10, 14 |
| ADRs and operator documentation | Task 14 |
