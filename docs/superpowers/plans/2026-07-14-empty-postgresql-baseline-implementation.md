# Empty PostgreSQL Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SPEC-001 with PostgreSQL 16 as the only runtime database, retain only read-only SQLite audit commands, and prove that schema initialization leaves all 22 application tables empty.

**Architecture:** The canonical Prisma schema and migrations remain under `apps/server/prisma`. SQLite inventory/diff stays isolated as read-only audit tooling; importer, migration validator, seed, bundled SQLite startup, and default administrator creation are removed. A Prisma-model-driven assertion checks exact application row counts after every baseline initialization, while CI runs against real PostgreSQL 16.

**Tech Stack:** Node.js 22 LTS, npm, TypeScript, Egg.js 3, React 19, Vite 8, Prisma 5.22, PostgreSQL 16, Docker Compose, Node test runner, Egg Mock, Vitest, React Testing Library, GitHub Actions.

**Approved Spec:** `docs/superpowers/specs/2026-07-12-engineering-baseline-postgresql-migration-design.md`

**Supersedes:** Tasks 10-14 in `docs/superpowers/plans/2026-07-12-engineering-baseline-postgresql-migration-implementation.md`. Tasks 1-9 in that file remain the historical execution record.

## Global Constraints

- Use Node 22 LTS and npm; do not convert the repository to npm workspaces.
- Keep React, Egg.js, Prisma, and all other major dependencies at their current major versions.
- PostgreSQL 16 is the only application database; tests use real PostgreSQL, never an in-memory SQLite substitute.
- Preserve the schema meaning of the current 22 Prisma models, including `Decimal @db.Decimal(18, 2)` and the current string JSON fields.
- Import no SQLite UUIDs, password hashes, organizations, users, roles, permissions, channels, or business records.
- Retain only `migration:inventory` and `migration:diff`; remove `migration:import`, `migration:validate`, and `db:seed` from the active command surface.
- After baseline initialization, every application table contains zero rows; `_prisma_migrations` is the only permitted metadata exception.
- Treat both SQLite files as unchanged, untracked, read-only historical evidence; they are not runtime fallback databases.
- Never commit `.env`, secrets, SQLite files, backups, audit exports, logs, generated distributions, or real client data.
- Destructive test reset requires both a database name ending in `_test` and `ALLOW_TEST_DB_RESET=true`.
- Commands and scripts work in Windows PowerShell and CI without Bash-only composition.
- Do not execute any database reset unless the user has explicitly confirmed the local Docker service is available.
- Do not remove the development Docker volume unless the user separately approves discarding its current contents immediately before the command.

## File Map

| Area | Files | Responsibility |
|---|---|---|
| SQLite audit | `apps/server/scripts/migration/cli.ts`, `report-writer.ts`, retained source/diff modules | Inventory and diff only; immutable, desensitized audit artifacts |
| Removed migration writes | `import-postgres.ts`, `validate.ts`, `normalize.ts` and their tests | Deleted because SQLite data is not imported |
| Empty baseline | `apps/server/scripts/db/assert-empty-application-tables.ts`, `apps/server/test/db/empty-application-tables.test.ts` | Enumerate all Prisma models and reject any application row |
| Removed seed | `apps/server/prisma/seed.ts`, seed tests, package scripts | Ensure setup, migration, startup, and CI create no records |
| Runtime boundary | root `prisma/`, root Prisma dependencies, packaging scripts | One Prisma source and no bundled SQLite/default administrator |
| Backend quality | health controller/helper and backend tests | PostgreSQL availability without requiring a login account |
| Frontend quality | Vitest setup and login/route tests | Basic startup behavior while the database has no administrator |
| Automation | root/package scripts, schema-source check, `.github/workflows/ci.yml` | One local/CI verification path with an empty PostgreSQL gate |
| Operations | ADRs, local-development and backup/restore runbooks, existing docs | Reproducible setup and recovery with no seed instructions |

---

### Task 10: Remove duplicate Prisma and implicit SQLite packaging paths

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/test/db/single-prisma-source.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/config/launcher-contract.test.ts`
- Delete: `LayerManage/law-firm-system/prisma/schema.prisma`
- Delete: `LayerManage/law-firm-system/prisma/migrations/20260425081823_init/migration.sql`
- Delete: `LayerManage/law-firm-system/prisma/migrations/migration_lock.toml`
- Delete: `LayerManage/law-firm-system/apps/server/scripts/build-dist.js`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/build-package.js`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/package-lock.json`

**Interfaces:**
- Consumes: Validated external `DATABASE_URL` from `config/env.ts` and committed migrations under `apps/server/prisma/migrations`.
- Produces: One runtime Prisma source and a portable package that never creates SQLite or initial users.

- [ ] **Step 1: Write failing source and launcher contracts**

Create `test/db/single-prisma-source.test.ts`:

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

Extend `test/config/launcher-contract.test.ts` with:

```ts
test('packaging cannot create SQLite or implicit bootstrap data', () => {
  const packageSource = fs.readFileSync(path.resolve('scripts/build-package.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(fs.existsSync(path.resolve('scripts/build-dist.js')), false);
  assert.equal(packageJson.scripts['build-dist'], undefined);
  assert.doesNotMatch(packageSource, /ensureDatabase|\$executeRawUnsafe|law_firm\.db|file:|admin\s*\/\s*123456/i);
  assert.doesNotMatch(packageSource, /organization\.create|user\.create|role\.create|Run seed|种子数据/i);
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test test/db/single-prisma-source.test.ts test/config/launcher-contract.test.ts
```

Expected: FAIL because root Prisma and `build-dist.js` still exist and `build-package.js` still embeds seed creation.

- [ ] **Step 3: Remove duplicate Prisma runtime files and dependencies**

Delete the tracked root schema and migration tree. From the project root package, remove Prisma dependencies because all Prisma commands run through `apps/server`:

```powershell
Set-Location LayerManage\law-firm-system
npm.cmd uninstall prisma @prisma/client
```

Do not delete either ignored `law_firm.db` file. Recheck both source hashes against the runbook after file cleanup.

- [ ] **Step 4: Remove the obsolete distribution builder**

Delete `apps/server/scripts/build-dist.js` and remove the `build-dist` package script. It hard-codes SQLite, creates `admin/123456`, and cannot satisfy the external PostgreSQL contract.

- [ ] **Step 5: Make the retained package launcher data-neutral**

In `scripts/build-package.js`, delete the generated `ensureDatabase` function and every generated line that imports `bcryptjs`, executes migration SQL with `$executeRawUnsafe`, creates organizations/users/roles, or prints default credentials. Keep `loadEnvironment(process.env)` as the only database/secret bootstrap. Replace the package summary credential line with:

```js
  console.log('║  Database: external PostgreSQL            ║');
```

The package may copy canonical schema/migrations for operator inspection, but it must not apply them. Deployment applies migrations explicitly with `npm run db:deploy` before application startup.

- [ ] **Step 6: Verify source, package, and hash boundaries**

Run:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test test/db/single-prisma-source.test.ts test/config/launcher-contract.test.ts test/config/env.test.ts
npx.cmd prisma validate
npx.cmd tsc --noEmit
Set-Location ..\..\..
Get-FileHash 'LayerManage\law-firm-system\apps\server\prisma\law_firm.db','LayerManage\law-firm-system\prisma\law_firm.db' -Algorithm SHA256
```

Expected: tests, Prisma validation, and TypeScript pass. SQLite hashes remain `B61917FFA7823F15CA9F9A20EB95463B28F0A7AB161108338FFBE068CAD48E11` and `9A8F3EED9B429190643CE1A55F11F61A2B3DD4329C28DA3E4F6182F93A8C629C`.

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline
git add LayerManage/law-firm-system/prisma LayerManage/law-firm-system/apps/server/scripts/build-dist.js LayerManage/law-firm-system/apps/server/scripts/build-package.js LayerManage/law-firm-system/apps/server/test/config/launcher-contract.test.ts LayerManage/law-firm-system/apps/server/test/db/single-prisma-source.test.ts LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "refactor: remove SQLite runtime bootstrap paths"
```

---

### Task 11: Add PostgreSQL health, frontend smoke tests, and unified verification

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/app/lib/database-health.ts`
- Modify: `LayerManage/law-firm-system/apps/server/app/controller/home.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/database-health.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/health.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/scripts/test/run-node-tests.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Create: `LayerManage/law-firm-system/apps/web/src/test/setup.ts`
- Create: `LayerManage/law-firm-system/apps/web/src/App.test.tsx`
- Create: `LayerManage/law-firm-system/apps/web/src/pages/Login/index.test.tsx`
- Modify: `LayerManage/law-firm-system/apps/web/vite.config.ts`
- Modify: `LayerManage/law-firm-system/apps/web/tsconfig.app.json`
- Modify: `LayerManage/law-firm-system/apps/web/package.json`
- Modify: `LayerManage/law-firm-system/apps/web/package-lock.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/package-lock.json`

**Interfaces:**
- Produces: `databaseAvailability(client): Promise<'available' | 'unavailable'>`, `databaseHealthResponse(database)`, and `/api/health` response `{ code, message, data: { status, database } }`.
- Produces: Root commands `lint`, `typecheck`, `test`, `build`, and `verify`.

- [ ] **Step 1: Write failing database-health tests**

Create `test/app/database-health.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseAvailability, databaseHealthResponse } from '../../app/lib/database-health';

test('reports PostgreSQL as available after a successful probe', async () => {
  assert.equal(await databaseAvailability({ async $queryRaw() { return [{ '?column?': 1 }]; } }), 'available');
});

test('reports PostgreSQL as unavailable without exposing the error', async () => {
  assert.equal(await databaseAvailability({ async $queryRaw() { throw new Error('private connection details'); } }), 'unavailable');
});

test('maps an unavailable database to a sanitized 503 response', () => {
  assert.deepEqual(databaseHealthResponse('unavailable'), {
    statusCode: 503,
    body: {
      code: 503,
      message: 'service unavailable',
      data: { status: 'degraded', database: 'unavailable' },
    },
  });
});
```

Create `test/app/health.test.ts` using Egg Mock:

```ts
import assert from 'node:assert/strict';
import mm from 'egg-mock';
import test from 'node:test';

const app = mm.app();

test.before(async () => { await app.ready(); });
test.after(async () => { await app.close(); });

test('GET /api/health confirms the PostgreSQL connection', async () => {
  const response = await app.httpRequest().get('/api/health').expect(200);
  assert.deepEqual(response.body, {
    code: 200,
    message: 'success',
    data: { status: 'healthy', database: 'available' },
  });
});
```

- [ ] **Step 2: Run backend tests and verify red**

Run: `npx.cmd tsx --test test/app/database-health.test.ts test/app/health.test.ts`

Expected: FAIL because the helper does not exist and the health endpoint does not probe PostgreSQL.

- [ ] **Step 3: Implement health without requiring seeded users**

Create `app/lib/database-health.ts`:

```ts
export interface HealthQueryable {
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

export async function databaseAvailability(client: HealthQueryable): Promise<'available' | 'unavailable'> {
  try {
    await client.$queryRaw`SELECT 1`;
    return 'available';
  } catch {
    return 'unavailable';
  }
}

export function databaseHealthResponse(database: 'available' | 'unavailable') {
  if (database === 'available') {
    return {
      statusCode: 200,
      body: { code: 200, message: 'success', data: { status: 'healthy', database } },
    };
  }
  return {
    statusCode: 503,
    body: { code: 503, message: 'service unavailable', data: { status: 'degraded', database } },
  };
}
```

Replace `HomeController.index` with calls to `databaseAvailability(ctx.prisma)` and `databaseHealthResponse(database)`, then assign `ctx.status = result.statusCode` and `ctx.body = result.body`. Do not include URLs, database names, versions, SQL, or stack traces.

- [ ] **Step 4: Add frontend smoke tests**

Install test dependencies:

```powershell
Set-Location LayerManage\law-firm-system\apps\web
npm.cmd install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
```

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
  value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
```

Create `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import { useAuthStore } from './stores/authStore';

beforeEach(() => {
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  window.history.pushState({}, '', '/');
});

test('redirects an unauthenticated visit to login', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});
```

Create `src/pages/Login/index.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import Login from './index';

test('renders explicit username and password inputs', () => {
  render(<MemoryRouter><Login /></MemoryRouter>);
  expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
});
```

Use `defineConfig` from `vitest/config` in `vite.config.ts` and add:

```ts
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: './src/test/setup.ts',
  css: true,
},
```

Add `"vitest/globals"` to `compilerOptions.types`. Add web scripts `"lint": "eslint ."`, `"typecheck": "tsc -b --pretty false"`, and `"test": "vitest run"`.

- [ ] **Step 5: Add unified package commands**

Install `egg-mock` in the server:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npm.cmd install --save-dev egg-mock
```

Create `scripts/test/run-node-tests.ts` so Windows and CI execute the same recursively discovered test set:

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function testFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(candidate);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [candidate] : [];
  });
}

const files = testFiles(path.resolve('test')).sort();
if (files.length === 0) throw new Error('No backend test files found');
const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', ...files], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
```

Add server scripts `"typecheck": "tsc --noEmit"` and `"test:unit": "tsx scripts/test/run-node-tests.ts"`.

Add these project scripts:

```json
"setup": "npm ci && npm --prefix apps/server ci && npm --prefix apps/web ci && npm --prefix apps/server run db:generate",
"lint": "npm --prefix apps/server run lint && npm --prefix apps/web run lint",
"typecheck": "npm --prefix apps/server run typecheck && npm --prefix apps/web run typecheck",
"test": "npm --prefix apps/server run test:unit && npm --prefix apps/web run test",
"build": "npm run build:server && npm run build:web",
"verify": "npm run lint && npm run typecheck && npm run test && npm run build"
```

- [ ] **Step 6: Verify against the explicitly confirmed PostgreSQL test database**

Run:

```powershell
Set-Location LayerManage\law-firm-system
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:JWT_SECRET='01234567890123456789012345678901'
$env:APP_KEYS='first-32-character-application-key,second-32-character-app-key'
Set-Location apps\server
npx.cmd tsx --test test/app/database-health.test.ts test/app/health.test.ts
Set-Location ..\web
npm.cmd run test
Set-Location ..\..
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Expected: focused backend and frontend tests, lint, typecheck, and both builds pass. The full database suite is deferred until Task 13 removes seed and establishes the empty baseline.

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline
git add LayerManage/law-firm-system/apps/server/app LayerManage/law-firm-system/apps/server/scripts/test LayerManage/law-firm-system/apps/server/test/app LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/apps/web LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "test: verify empty PostgreSQL application baseline"
```

---

### Task 12: Reduce migration tooling to read-only SQLite audit

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/scripts/migration/cli.ts`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/migration/report-writer.ts`
- Delete: `LayerManage/law-firm-system/apps/server/scripts/migration/import-postgres.ts`
- Delete: `LayerManage/law-firm-system/apps/server/scripts/migration/validate.ts`
- Delete: `LayerManage/law-firm-system/apps/server/scripts/migration/normalize.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/migration/cli.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/migration/report-writer.test.ts`
- Delete: `LayerManage/law-firm-system/apps/server/test/migration/import-postgres.test.ts`
- Delete: `LayerManage/law-firm-system/apps/server/test/migration/validate.test.ts`
- Delete: `LayerManage/law-firm-system/apps/server/test/migration/normalize.test.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/package-lock.json`

**Interfaces:**
- Consumes: Existing `snapshotSqlite(path): SourceSnapshot`, `inventoryFromSnapshot(snapshot): SourceInventory`, and `diffSnapshots(primary, secondary): DiffReport`.
- Produces: `parseArgs(argv): InventoryArgs | DiffArgs` and `executeCommand(args, dependencies): Promise<void>` with no PostgreSQL write dependency.

- [ ] **Step 1: Add a failing read-only command contract test**

Replace the import/validate argument tests in `test/migration/cli.test.ts` with this contract while retaining existing inventory/diff execution, sidecar, immutable-publication, and safe-error tests:

```ts
test('exposes only read-only inventory and diff commands', () => {
  assert.equal(parseArgs(['inventory', '--source', 'a.db', '--run-id', 'r1']).command, 'inventory');
  assert.equal(parseArgs(['diff', '--primary', 'a.db', '--secondary', 'b.db', '--run-id', 'r2']).command, 'diff');
  assert.throws(() => parseArgs(['import', '--source', 'a.db', '--run-id', 'r3']), /command/i);
  assert.throws(() => parseArgs(['validate', '--source', 'a.db', '--run-id', 'r4']), /command/i);
});
```

Add this report boundary test to `test/migration/report-writer.test.ts`:

```ts
test('accepts only source, inventory, and diff report kinds', () => {
  assert.throws(
    () => parseMigrationReport('import-report.json' as never, {}),
    /Unknown migration report/,
  );
  assert.throws(
    () => parseMigrationReport('validation-report.json' as never, {}),
    /Unknown migration report/,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test test/migration/cli.test.ts test/migration/report-writer.test.ts
```

Expected: FAIL because `parseArgs` still accepts `import`/`validate` and `parseMigrationReport` still recognizes their report kinds.

- [ ] **Step 3: Remove write-capable CLI branches**

In `scripts/migration/cli.ts`, remove `node:crypto`, `node:path`, `pg`, importer, validator, and import-report imports. Replace the command and dependency declarations with:

```ts
type CommandName = 'inventory' | 'diff';

interface BaseArgs {
  command: CommandName;
  runId: string;
}

export interface InventoryArgs extends BaseArgs {
  command: 'inventory';
  source: string;
}

export interface DiffArgs extends BaseArgs {
  command: 'diff';
  primary: string;
  secondary: string;
}

export type ParsedArgs = InventoryArgs | DiffArgs;

export interface CliDependencies {
  outputRoot?: string;
  readSnapshot?: (sourcePath: string) => SourceSnapshot;
}
```

Use exactly these command checks and dispatch rules:

```ts
export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] as CommandName | undefined;
  if (!command || !['inventory', 'diff'].includes(command)) {
    throw new Error('A read-only migration command is required');
  }
  const options = parseOptions(argv.slice(1));
  assertAllowedOptions(command, options);
  if (command === 'inventory') {
    return { command, source: required(options, '--source'), runId: requiredRunId(options) };
  }
  return {
    command,
    primary: required(options, '--primary'),
    secondary: required(options, '--secondary'),
    runId: requiredRunId(options),
  };
}

export async function executeCommand(args: ParsedArgs, dependencies: CliDependencies = {}): Promise<void> {
  const outputRoot = dependencies.outputRoot ?? MIGRATION_OUTPUT_ROOT;
  if (args.command === 'inventory') return runInventory(args, dependencies, outputRoot);
  return runDiff(args, dependencies, outputRoot);
}
```

Keep `runInventory`, `runDiff`, `main`, safe single-line errors, and report/export publication. Delete every import/validate pool, confirmation, reservation, and recovery class/function.

- [ ] **Step 4: Reduce report types to audit artifacts**

In `report-writer.ts`, remove importer/validator type imports and all import reservation machinery. Define the public report map as:

```ts
export type ReportFileName =
  | 'source-manifest.json'
  | 'inventory.json'
  | 'diff-report.json';

export interface ReportPayloadMap {
  'source-manifest.json': SourceManifest | SourceManifestPair;
  'inventory.json': SourceInventory;
  'diff-report.json': DiffReport;
}

export function parseMigrationReport<K extends ReportFileName>(fileName: K, payload: unknown): ReportPayloadMap[K] {
  if (fileName === 'source-manifest.json') return sourceManifestReport(payload) as ReportPayloadMap[K];
  if (fileName === 'inventory.json') return inventoryReport(payload) as ReportPayloadMap[K];
  if (fileName === 'diff-report.json') return diffReport(payload) as ReportPayloadMap[K];
  throw new Error('Unknown migration report');
}
```

Keep anchored exclusive publication, readiness markers, `readPublishedArtifact`, `writeMigrationReport`, `writeSnapshotExport`, and `sha256File`. Remove `IMPORT_REPORT_PENDING_FILE`, `ImportReportReservation`, import/validation validators, `writeAnchoredMarker`, `removeAnchoredFile`, and reservation functions. Remove corresponding import-only test cases while retaining path containment, immutable write, readiness, race, desensitization, and inventory/diff schema tests.

- [ ] **Step 5: Delete obsolete modules and command entries**

Delete the six importer/validator/normalizer implementation and test files listed above. Remove `migration:import` and `migration:validate` from both package files, then remove dependencies used only by those modules:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npm.cmd uninstall pg decimal.js
npm.cmd uninstall --save-dev @types/pg
Set-Location ..\..
```

Retain `better-sqlite3`, `@types/better-sqlite3`, `ordering.ts`, and their tests because inventory/diff still use them.

- [ ] **Step 6: Verify the audit-only boundary**

Run:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test test/migration/cli.test.ts test/migration/diff.test.ts test/migration/ordering.test.ts test/migration/report-writer.test.ts test/migration/sqlite-source.test.ts
npx.cmd tsc --noEmit
Set-Location ..\..
rg -n "migration:import|migration:validate|import-postgres|validateMigration|ImportReportReservation" package.json apps/server/package.json apps/server/scripts apps/server/test
```

Expected: all retained migration tests and TypeScript checks pass; final `rg` exits 1 with no matches.

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline
git add LayerManage/law-firm-system/apps/server/scripts/migration LayerManage/law-firm-system/apps/server/test/migration LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "refactor: retain read-only SQLite audit tools"
```

---

### Task 13: Enforce a zero-row PostgreSQL baseline and remove seed

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/db/assert-empty-application-tables.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/db/empty-application-tables.test.ts`
- Delete: `LayerManage/law-firm-system/apps/server/prisma/seed.ts`
- Delete: `LayerManage/law-firm-system/apps/server/test/db/seed-idempotency.test.ts`
- Delete: `LayerManage/law-firm-system/apps/server/test/db/seed-test-database-url.ts`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `LayerManage/law-firm-system/package-lock.json`

**Interfaces:**
- Produces: `applicationTableCounts(client, modelNames?): Promise<ApplicationTableCount[]>` and `assertEmptyApplicationTables(client, modelNames?): Promise<void>`.
- Consumes: Prisma 5.22 DMMF model names and each generated model delegate's `count()` method.

- [ ] **Step 1: Write the failing empty-table unit tests**

Create `test/db/empty-application-tables.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationTableCounts,
  assertEmptyApplicationTables,
} from '../../scripts/db/assert-empty-application-tables';

test('counts every supplied Prisma model delegate', async () => {
  const client = {
    organization: { async count() { return 0; } },
    userRole: { async count() { return 0; } },
  };
  assert.deepEqual(await applicationTableCounts(client, ['Organization', 'UserRole']), [
    { model: 'Organization', count: 0 },
    { model: 'UserRole', count: 0 },
  ]);
});

test('rejects any application row and names the non-empty models', async () => {
  const client = {
    organization: { async count() { return 1; } },
    user: { async count() { return 2; } },
  };
  await assert.rejects(
    () => assertEmptyApplicationTables(client, ['Organization', 'User']),
    /Organization=1, User=2/,
  );
});
```

- [ ] **Step 2: Run the test and verify red**

Run: `npx.cmd tsx --test test/db/empty-application-tables.test.ts`

Expected: FAIL because `assert-empty-application-tables.ts` does not exist.

- [ ] **Step 3: Implement the exact model-count assertion**

Create `scripts/db/assert-empty-application-tables.ts`:

```ts
import { Prisma, PrismaClient } from '@prisma/client';

interface CountDelegate {
  count(): Promise<number>;
}

export interface ApplicationTableCount {
  model: string;
  count: number;
}

function delegateName(modelName: string): string {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
}

export async function applicationTableCounts(
  client: object,
  modelNames: readonly string[] = Prisma.dmmf.datamodel.models.map(model => model.name),
): Promise<ApplicationTableCount[]> {
  const delegates = client as Record<string, unknown>;
  const counts: ApplicationTableCount[] = [];
  for (const model of modelNames) {
    const delegate = delegates[delegateName(model)] as CountDelegate | undefined;
    if (!delegate || typeof delegate.count !== 'function') {
      throw new Error(`Missing Prisma delegate for ${model}`);
    }
    counts.push({ model, count: await delegate.count() });
  }
  return counts;
}

export async function assertEmptyApplicationTables(
  client: object,
  modelNames?: readonly string[],
): Promise<void> {
  const counts = await applicationTableCounts(client, modelNames);
  const nonEmpty = counts.filter(item => item.count !== 0);
  if (nonEmpty.length > 0) {
    throw new Error(`Application tables are not empty: ${nonEmpty.map(item => `${item.model}=${item.count}`).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await assertEmptyApplicationTables(prisma);
    process.stdout.write('All application tables are empty.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Empty database assertion failed'}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Remove all active seed paths**

Delete the seed implementation and two seed test/helper files. In `apps/server/package.json`, remove the top-level `prisma.seed` block and scripts named `seed` and `db:seed`; add:

```json
"db:assert-empty": "tsx scripts/db/assert-empty-application-tables.ts"
```

In the project package, add:

```json
"db:assert-empty": "npm --prefix apps/server run db:assert-empty"
```

Do not change `reset-test-db.ts`: its existing `migrate reset --force --skip-seed` arguments are the required behavior.

- [ ] **Step 5: Verify unit behavior and static seed removal**

Run:

```powershell
Set-Location LayerManage\law-firm-system\apps\server
npx.cmd tsx --test test/db/reset-test-db.test.ts test/db/schema-contract.test.ts test/db/empty-application-tables.test.ts
npx.cmd tsc --noEmit
Set-Location ..\..
rg -n '"seed"|"db:seed"|prisma/seed|seed-idempotency' package.json apps/server/package.json apps/server/prisma apps/server/test/db
```

Expected: tests and TypeScript pass; final `rg` exits 1 with no matches.

- [ ] **Step 6: Rebuild development and test PostgreSQL as empty baselines after explicit approval**

Run only after the user confirms Docker is available and separately approves deleting the current `chengye_postgres_data` development volume:

```powershell
Set-Location LayerManage\law-firm-system
docker compose -f infra/postgres/compose.yml down -v
npm.cmd run db:up
$env:DATABASE_URL='postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa?schema=public'
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:ALLOW_TEST_DB_RESET='true'
npm.cmd run db:reset:test
$env:DATABASE_URL=$env:DATABASE_URL_TEST
npm.cmd run db:assert-empty
npm.cmd run verify
```

Expected: Prisma applies the committed baseline migration independently to development and test databases; both assertions print `All application tables are empty.` The complete verification suite passes, and no organization, user, role, permission, channel, or business row exists.

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline
git add LayerManage/law-firm-system/apps/server/scripts/db LayerManage/law-firm-system/apps/server/test/db LayerManage/law-firm-system/apps/server/prisma/seed.ts LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/package.json LayerManage/law-firm-system/package-lock.json
git commit -m "refactor: enforce empty PostgreSQL baseline"
```

---

### Task 14: Add CI, operator documentation, and recovery evidence

**Files:**
- Create: `LayerManage/law-firm-system/apps/server/scripts/ci/check-baseline-contract.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/ci/baseline-contract.test.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/superpowers/adr/0001-project-repository-boundary.md`
- Create: `docs/superpowers/adr/0002-postgresql-and-canonical-prisma.md`
- Create: `docs/superpowers/runbooks/local-development.md`
- Create: `docs/superpowers/runbooks/postgresql-backup-restore.md`
- Modify: `docs/superpowers/runbooks/sqlite-to-postgresql-migration.md`
- Modify: `docs/superpowers/README.md`
- Modify: `LayerManage/law-firm-system/docs/DEVELOPMENT.md`
- Modify: `LayerManage/law-firm-system/docs/DEPLOY.md`
- Modify: `LayerManage/law-firm-system/docs/DATABASE.md`
- Modify: `LayerManage/law-firm-system/apps/server/docs/api-spec.md`
- Modify: `docs/superpowers/specs/2026-07-12-engineering-baseline-postgresql-migration-design.md`
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`

**Interfaces:**
- Produces: `checkBaselineContract(projectRoot): string[]`, returning an empty array only when the canonical/empty database boundary is intact.
- Produces: CI evidence that migrations create the schema, all application tables are empty, and the complete verification suite passes.

- [ ] **Step 1: Write the failing baseline-contract test**

Create `test/ci/baseline-contract.test.ts`:

```ts
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { checkBaselineContract } from '../../scripts/ci/check-baseline-contract';

test('repository exposes one Prisma source and no write bootstrap commands', () => {
  const projectRoot = path.resolve(__dirname, '../../../..');
  assert.deepEqual(checkBaselineContract(projectRoot), []);
});
```

- [ ] **Step 2: Run the contract test and verify red**

Run: `npx.cmd tsx --test test/ci/baseline-contract.test.ts`

Expected: FAIL because `check-baseline-contract.ts` does not exist.

- [ ] **Step 3: Implement the static repository gate**

Create `scripts/ci/check-baseline-contract.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

function packageScripts(filePath: string): Record<string, string> {
  return (JSON.parse(fs.readFileSync(filePath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
}

export function checkBaselineContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  if (fs.existsSync(path.join(projectRoot, 'prisma', 'schema.prisma'))) issues.push('duplicate root Prisma schema exists');
  if (!fs.existsSync(path.join(serverRoot, 'prisma', 'schema.prisma'))) issues.push('canonical Prisma schema is missing');
  if (fs.existsSync(path.join(serverRoot, 'prisma', 'seed.ts'))) issues.push('Prisma seed exists');
  if (fs.existsSync(path.join(serverRoot, 'scripts', 'build-dist.js'))) issues.push('SQLite distribution builder exists');

  const rootScripts = packageScripts(path.join(projectRoot, 'package.json'));
  const serverScripts = packageScripts(path.join(serverRoot, 'package.json'));
  for (const name of ['migration:import', 'migration:validate', 'db:seed']) {
    if (rootScripts[name] || serverScripts[name]) issues.push(`${name} command exists`);
  }

  const startupSources = [
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'scripts', 'build-package.js'),
  ].map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');
  for (const pattern of [/file:/i, /law_firm\.db/i, /admin\s*\/\s*123456/i, /organization\.create/i, /Run seed/i, /种子数据/i]) {
    if (pattern.test(startupSources)) issues.push(`forbidden startup pattern: ${pattern.source}`);
  }
  return issues;
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, '../../../..');
  const issues = checkBaselineContract(projectRoot);
  if (issues.length > 0) {
    process.stderr.write(`${issues.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Baseline contract is valid.\n');
  }
}
```

Add server script:

```json
"check:baseline": "tsx scripts/ci/check-baseline-contract.ts"
```

Add `npm --prefix apps/server run check:baseline` before build in the project `verify` command.

- [ ] **Step 4: Create the PostgreSQL-only CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: chengye_oa_test
          POSTGRES_USER: chengye_test
          POSTGRES_PASSWORD: chengye_test_local_only
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U chengye_test -d chengye_oa_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public
      DATABASE_URL_TEST: postgresql://chengye_test:chengye_test_local_only@localhost:5432/chengye_oa_test?schema=public
      ALLOW_TEST_DB_RESET: 'true'
      JWT_SECRET: 01234567890123456789012345678901
      APP_KEYS: first-32-character-application-key,second-32-character-app-key
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.12.0'
          cache: npm
          cache-dependency-path: |
            LayerManage/law-firm-system/package-lock.json
            LayerManage/law-firm-system/apps/server/package-lock.json
            LayerManage/law-firm-system/apps/web/package-lock.json
      - name: Install dependencies
        working-directory: LayerManage/law-firm-system
        run: npm run setup
      - name: Apply canonical migrations
        working-directory: LayerManage/law-firm-system/apps/server
        run: npx prisma migrate deploy
      - name: Assert empty application tables
        working-directory: LayerManage/law-firm-system
        run: npm run db:assert-empty
      - name: Verify
        working-directory: LayerManage/law-firm-system
        run: npm run verify
      - name: Rebuild empty test database
        working-directory: LayerManage/law-firm-system
        run: npm run db:reset:test
      - name: Reassert rebuilt database is empty
        working-directory: LayerManage/law-firm-system
        run: npm run db:assert-empty
      - name: Reject generated drift
        run: git diff --exit-code
```

- [ ] **Step 5: Write ADRs and the local-development runbook**

Write ADR-0001 with headings `Status`, `Context`, `Decision`, `Consequences`, and `Supersedes`; record the workspace-root repository boundary and ignored LawLink/LexNebulis reference repositories. Write ADR-0002 with the same headings; record PostgreSQL 16, Docker for development/test, `apps/server/prisma` as canonical, no SQLite runtime fallback, no baseline seed, and future first-administrator initialization through a separate Spec.

Write `local-development.md` with this exact operator sequence and explanations for each command:

```powershell
Set-Location D:\2_test\16_ChengyeOA\LayerManage\law-firm-system
Copy-Item apps\server\.env.example apps\server\.env
npm.cmd run db:up
npm.cmd run setup
Set-Location apps\server
npx.cmd prisma migrate deploy
Set-Location ..\..
npm.cmd run db:assert-empty
npm.cmd run dev:server
```

State explicitly: edit only `apps/server/.env`; do not run seed; the empty baseline has no login account; `db:down` preserves the Docker volume; first organization/administrator creation waits for a separate approved Spec.

- [ ] **Step 6: Write and execute the PostgreSQL backup/restore rehearsal**

Write `postgresql-backup-restore.md` using a Git-ignored `var/backup` directory and these commands:

```powershell
Set-Location D:\2_test\16_ChengyeOA\LayerManage\law-firm-system
New-Item -ItemType Directory -Force var\backup | Out-Null
docker compose -f infra/postgres/compose.yml exec -T postgres pg_dump -U chengye_app -d chengye_oa -Fc -f /tmp/chengye_oa.dump
docker cp chengye-oa-postgres:/tmp/chengye_oa.dump var\backup\chengye_oa.dump
docker compose -f infra/postgres/compose.yml exec -T postgres dropdb -U chengye_app --if-exists chengye_oa_restore_test
docker compose -f infra/postgres/compose.yml exec -T postgres createdb -U chengye_app chengye_oa_restore_test
docker cp var\backup\chengye_oa.dump chengye-oa-postgres:/tmp/chengye_oa-restore.dump
docker compose -f infra/postgres/compose.yml exec -T postgres pg_restore -U chengye_app -d chengye_oa_restore_test --no-owner --no-privileges /tmp/chengye_oa-restore.dump
$env:DATABASE_URL='postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa_restore_test?schema=public'
npm.cmd run db:assert-empty
```

Record start/end timestamps, dump SHA-256, restore result, 22-model empty assertion, and elapsed time. Do not commit the dump. Stop on any `pg_dump`, `docker cp`, `createdb`, `pg_restore`, or empty-assertion failure; do not repair the database automatically.

- [ ] **Step 7: Reconcile all operator and API documentation**

Update `DEVELOPMENT.md`, `DEPLOY.md`, `DATABASE.md`, and `apps/server/docs/api-spec.md` to use Node 22, npm, PostgreSQL 16, external `DATABASE_URL`, canonical migrations, protected test reset, and explicit empty assertion. Remove every instruction for SQLite, `law_firm.db`, `db:seed`, default `admin/123456`, multiple package managers, or automatic first-run database creation. Update the Superpowers index and SQLite runbook to point to this revised Plan and the final verification evidence.

- [ ] **Step 8: Run final verification with fresh evidence**

Run only with confirmed Docker availability:

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline\LayerManage\law-firm-system
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:DATABASE_URL_TEST=$env:DATABASE_URL
$env:ALLOW_TEST_DB_RESET='true'
$env:JWT_SECRET='01234567890123456789012345678901'
$env:APP_KEYS='first-32-character-application-key,second-32-character-app-key'
npm.cmd run db:reset:test
npm.cmd run db:assert-empty
npm.cmd run verify
Set-Location apps\server
npx.cmd prisma validate
npx.cmd prisma migrate status
Set-Location ..\..\..
git diff --check
git status --short
```

Expected: reset, empty assertion, complete verification, Prisma validation, and migration status pass. `git diff --check` is clean and status contains only intended documentation/CI changes.

- [ ] **Step 9: Request code review and close SPEC-001**

Invoke `superpowers:requesting-code-review` against SPEC-001 Sections 8-14. Resolve every correctness, hidden-write, SQLite-runtime, secret, missing-test, and recovery finding. Then invoke `superpowers:verification-before-completion` and rerun the commands it requires before claiming success.

After review passes, change SPEC-001 status from `已批准` to `已实施`, add the completion date, final commit, CI result, backup/restore rehearsal timestamp, and explicit statement that first administrator initialization remains outside this Spec.

- [ ] **Step 10: Commit**

```powershell
Set-Location D:\2_test\16_ChengyeOA\.worktrees\spec-001-postgresql-baseline
git add .github docs LayerManage/law-firm-system/apps/server/scripts/ci LayerManage/law-firm-system/apps/server/test/ci LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/docs LayerManage/law-firm-system/apps/server/docs
git commit -m "ci: enforce empty PostgreSQL engineering baseline"
git status --short
```

Expected: commit succeeds and the worktree is clean.

## Execution Checkpoints

1. **After Task 10:** review removal of duplicate Prisma and SQLite packaging paths before changing test infrastructure.
2. **After Task 11:** review health and frontend smoke coverage; do not claim an empty baseline yet.
3. **After Task 12:** review that retained SQLite code is read-only and contains no PostgreSQL client.
4. **After Task 13:** review real PostgreSQL reset evidence and the zero-row assertion before adding CI/documentation.
5. **After Task 14:** require code review plus fresh final verification before marking SPEC-001 implemented.

## Spec Coverage Matrix

| SPEC-001 requirement | Implemented by |
|---|---|
| One canonical Prisma schema/migration source | Task 10 |
| No bundled SQLite or implicit administrator | Task 10 |
| PostgreSQL health and baseline frontend tests | Task 11 |
| SQLite inventory/diff only | Task 12 |
| No import/validate command or PostgreSQL write tooling | Task 12 |
| No seed command or seed implementation | Task 13 |
| All 22 application models remain at zero rows | Tasks 13-14 |
| Real PostgreSQL 16 CI and unified verification | Task 14 |
| ADRs, local setup, backup/restore, and stale-doc removal | Task 14 |
| SQLite evidence unchanged and not used as fallback | Tasks 10, 12, 14 |
