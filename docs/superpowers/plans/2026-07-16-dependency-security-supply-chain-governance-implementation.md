# Dependency Security and Supply Chain Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SEC-SPEC-001 so production dependency critical/high findings are zero, development critical findings are zero, any remaining development high finding has a precise exception of at most 30 days, and CI produces sanitized audit summaries plus separate CycloneDX SBOMs.

**Architecture:** Add a zero-third-party-dependency Node.js security layer at the application root. It validates policy files offline, normalizes npm audit v2 JSON, compares production and full scans to classify development-only findings, fails closed, and emits sanitized artifacts. Remediate web and server dependencies in isolated commits, harden credentialed CORS, remove unused `egg-jwt`, then connect the commands to a separate CI job.

**Tech Stack:** Node.js `22.14.0`, npm `10.9.2`, ECMAScript modules, `node:test`, npm audit v2 JSON, npm CycloneDX SBOM, Egg 3, React 19, Vitest, GitHub Actions, PostgreSQL 16.

## Global Constraints

- Keep Node.js exactly `22.14.0`; all three manifests retain `>=22.14.0 <23` and all three lockfiles retain lockfile v3.
- Do not use `npm audit fix --force`, automatic dependency repair, automatic merging, or unrelated framework refactors.
- Server and web production dependencies must each finish at `critical=0` and `high=0`; production exceptions cannot satisfy first acceptance.
- Server and web complete dependency trees must each finish at `critical=0`.
- A development high exception must identify one workspace, one exact package, and exact advisory IDs; it expires no later than 30 days after creation and cannot auto-renew.
- Online audit commands stay outside local `npm run verify`; offline policy validation and deterministic security tests are included in `verify`.
- Use npm's built-in `sbom --sbom-format=cyclonedx`; do not add an SBOM package.
- Generated raw audit data, summaries, SBOMs, local paths, environment values, tokens, database URLs, and business data are not committed.
- Dependency changes are grouped by risk chain and each group gets lint, typecheck, tests, build, audit, and lockfile review before the next group.
- PostgreSQL verification uses the existing guarded test database workflow and ends with empty application tables.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `LayerManage/law-firm-system/security/dependency-policy.json` | Supported workspaces, thresholds, exception lifetime, and output directory |
| `LayerManage/law-firm-system/security/dependency-exceptions.json` | Exact, time-bound development high exceptions |
| `LayerManage/law-firm-system/scripts/security/policy.mjs` | Strict schema and semantic validation |
| `LayerManage/law-firm-system/scripts/security/audit-gate.mjs` | npm audit v2 parsing, normalization, scope classification, and gate evaluation |
| `LayerManage/law-firm-system/scripts/security/process-runner.mjs` | Cross-platform `npm`/`git` execution with bounded output and fail-closed semantics |
| `LayerManage/law-firm-system/scripts/security/artifacts.mjs` | Sanitized audit summaries and traceable CycloneDX output |
| `LayerManage/law-firm-system/scripts/security/cli.mjs` | `policy`, `audit-prod`, `audit-all`, and `sbom` commands |
| `LayerManage/law-firm-system/scripts/security/fixtures/*.json` | Fixed npm audit fixtures; never live registry output |
| `LayerManage/law-firm-system/scripts/security/*.test.mjs` | Deterministic policy, audit, runner, artifact, and dependency contract tests |
| `LayerManage/law-firm-system/apps/server/config/cors.ts` | Allowed-origin parsing and request-origin resolution |
| `LayerManage/law-firm-system/apps/server/test/config/cors.test.ts` | CORS unit contract |
| `LayerManage/law-firm-system/apps/server/test/app/cors.test.ts` | Credentialed preflight and response integration contract |
| `.github/workflows/ci.yml` | Independent online dependency-security job and artifact upload |
| `docs/superpowers/runbooks/dependency-security.md` | Operator commands, exception workflow, and failure handling |
| `docs/superpowers/reports/sec-spec-001-closeout.md` | Before/after evidence and residual exceptions |

### Task 1: Offline Policy and Exception Contract

**Files:**
- Create: `LayerManage/law-firm-system/security/dependency-policy.json`
- Create: `LayerManage/law-firm-system/security/dependency-exceptions.json`
- Create: `LayerManage/law-firm-system/scripts/security/policy.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/policy.test.mjs`
- Modify: `LayerManage/law-firm-system/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `loadSecurityConfiguration(projectRoot, now = new Date()) -> { policy, exceptions }`
- Produces: `validatePolicy(value) -> policy`
- Produces: `validateExceptions(value, policy, now) -> exceptions[]`

- [ ] **Step 1: Add policy fixtures and failing contract tests**

Create policy JSON with `schemaVersion: 1`, workspaces `{server: apps/server, web: apps/web}`, production blocks for critical/high, development blocks for critical and requires exception for high, `maxDevelopmentExceptionDays: 30`, and `outputDirectory: var/security`. Create exceptions JSON as `{ "schemaVersion": 1, "exceptions": [] }`.

The tests must assert: valid empty configuration passes; unknown fields, duplicate workspaces, unsupported workspace names, wildcard package/advisory values, production scope, owner equal to approver, invalid ISO dates, expired records, and lifetimes over 30 days fail.

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExceptions, validatePolicy } from './policy.mjs';

const policy = validatePolicy({
  schemaVersion: 1,
  workspaces: [
    { name: 'server', path: 'apps/server' },
    { name: 'web', path: 'apps/web' },
  ],
  gates: {
    production: { critical: 'block', high: 'block', moderate: 'report', low: 'report' },
    development: { critical: 'block', high: 'exception', moderate: 'report', low: 'report' },
  },
  maxDevelopmentExceptionDays: 30,
  outputDirectory: 'var/security',
});

test('rejects an expired or overlong development exception', () => {
  const base = {
    id: 'SEC-2026-001', workspace: 'server', package: 'serialize-javascript',
    advisories: ['GHSA-5c6j-r48x-rmvq'], scope: 'development',
    reason: 'No compatible upstream release is available.', mitigation: 'CI packaging is isolated.',
    owner: 'platform-engineering', approvedBy: 'system-super-admin',
    createdAt: '2026-07-16', trackingRef: 'SEC-SPEC-001/serialize-javascript',
  };
  assert.throws(() => validateExceptions(
    { schemaVersion: 1, exceptions: [{ ...base, expiresAt: '2026-08-16' }] },
    policy,
    new Date('2026-07-16T00:00:00Z'),
  ), /30 days/);
  assert.throws(() => validateExceptions(
    { schemaVersion: 1, exceptions: [{ ...base, expiresAt: '2026-07-15' }] },
    policy,
    new Date('2026-07-16T00:00:00Z'),
  ), /expired/);
});
```

- [ ] **Step 2: Run the policy test and verify the missing module failure**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/policy.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/security/policy.mjs`.

- [ ] **Step 3: Implement strict policy validation**

Implement exact-key validation before semantic checks. Dates are `YYYY-MM-DD`, compared as UTC midnight; advisory IDs match `GHSA-[0-9a-z-]+` or `npm:[0-9]+`; `package` and `advisories` reject `*` and empty values; `owner !== approvedBy`; workspace paths are relative and cannot contain `..`.

```js
export function loadSecurityConfiguration(projectRoot, now = new Date()) {
  const read = name => JSON.parse(readFileSync(resolve(projectRoot, 'security', name), 'utf8'));
  const policy = validatePolicy(read('dependency-policy.json'));
  return {
    policy,
    exceptions: validateExceptions(read('dependency-exceptions.json'), policy, now),
  };
}
```

- [ ] **Step 4: Add deterministic root scripts and ignore generated artifacts**

Add scripts:

```json
"security:test": "node --test scripts/security/policy.test.mjs",
"security:policy:validate": "node scripts/security/cli.mjs policy",
"security:audit:prod": "node scripts/security/cli.mjs audit-prod",
"security:audit:all": "node scripts/security/cli.mjs audit-all",
"security:sbom": "node scripts/security/cli.mjs sbom"
```

Append `/LayerManage/law-firm-system/var/security/` to `.gitignore`. Do not change shared ignore rules for local `.superpowers` data.

- [ ] **Step 5: Run tests and offline validation**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/policy.test.mjs && npm run security:policy:validate`

Expected: both commands exit 0 and print no environment values.

- [ ] **Step 6: Commit the policy contract**

```powershell
git add .gitignore LayerManage/law-firm-system/package.json LayerManage/law-firm-system/security LayerManage/law-firm-system/scripts/security/policy.mjs LayerManage/law-firm-system/scripts/security/policy.test.mjs
git commit -m "feat(security): add dependency policy contract"
```

### Task 2: Audit Parser, Scope Classifier, and Gate

**Files:**
- Create: `LayerManage/law-firm-system/scripts/security/audit-gate.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/audit-gate.test.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/fixtures/clean.json`
- Create: `LayerManage/law-firm-system/scripts/security/fixtures/production-high.json`
- Create: `LayerManage/law-firm-system/scripts/security/fixtures/development-high.json`
- Create: `LayerManage/law-firm-system/scripts/security/fixtures/truncated.json`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Consumes: validated policy and exceptions from Task 1
- Produces: `parseAuditJson(source) -> NpmAuditReport`
- Produces: `normalizeFindings(report) -> Array<{ package, advisory, severity }>`
- Produces: `evaluateWorkspace({ workspace, productionReport, fullReport, policy, exceptions }) -> SecuritySummary`

- [ ] **Step 1: Write failing fixture-driven tests**

Cover clean pass, production high block, development critical block, exact development high exception pass, missing/expired/wrong-advisory exception block, malformed/truncated JSON block, unsupported audit schema block, empty output block, and deduplication of parent `via: ["child"]` chains.

```js
test('does not let an exception hide a different advisory for the same package', () => {
  const result = evaluateWorkspace({
    workspace: 'web', productionReport: clean, fullReport: developmentHigh,
    policy, exceptions: [{ ...validException, package: 'vite', advisories: ['GHSA-not-the-finding'] }],
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers.map(item => item.advisory), ['GHSA-fx2h-pf6j-xcff']);
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/audit-gate.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `audit-gate.mjs`.

- [ ] **Step 3: Implement npm audit v2 normalization**

Accept only an object with `auditReportVersion: 2`, `metadata.vulnerabilities`, and `vulnerabilities`. Extract advisory IDs from GitHub advisory URLs or npm `source` numbers. Resolve string-valued `via` references recursively, break cycles, deduplicate by `package|advisory|severity`, and fail when metadata reports critical/high but no concrete advisory can be normalized.

```js
export function evaluateWorkspace(input) {
  const production = normalizeFindings(input.productionReport)
    .map(finding => ({ ...finding, scope: 'production' }));
  const productionKeys = new Set(production.map(findingKey));
  const development = normalizeFindings(input.fullReport)
    .filter(finding => !productionKeys.has(findingKey(finding)))
    .map(finding => ({ ...finding, scope: 'development' }));
  const findings = [...production, ...development];
  const blockers = findings.filter(finding => shouldBlock(finding, input.exceptions));
  return { workspace: input.workspace, passed: blockers.length === 0, findings, blockers };
}
```

- [ ] **Step 4: Run focused and combined security tests**

Extend `security:test` to run `policy.test.mjs` and `audit-gate.test.mjs` explicitly.

Run: `cd LayerManage/law-firm-system && node --test scripts/security/policy.test.mjs scripts/security/audit-gate.test.mjs`

Expected: all policy and audit-gate tests pass.

- [ ] **Step 5: Commit the deterministic gate**

```powershell
git add LayerManage/law-firm-system/scripts/security
git commit -m "feat(security): evaluate npm audit findings"
```

### Task 3: Cross-Platform Runner and Sanitized Artifacts

**Files:**
- Create: `LayerManage/law-firm-system/scripts/security/process-runner.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/process-runner.test.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/artifacts.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/artifacts.test.mjs`
- Create: `LayerManage/law-firm-system/scripts/security/cli.mjs`

**Interfaces:**
- Consumes: Task 1 configuration and Task 2 evaluator
- Produces: `runCommand(command, args, options) -> { status, stdout, stderr }`
- Produces: `writeAuditSummary(outputDir, summaries, metadata) -> string`
- Produces: `writeSbom(outputDir, workspace, sbom, metadata) -> string`
- Produces CLI commands: `policy`, `audit-prod`, `audit-all`, `sbom`
- Produces optional audit filter: `--workspace server|web`; omission always scans both configured workspaces

- [ ] **Step 1: Write failing runner and artifact tests**

Inject a fake spawn function. Assert Windows uses `npm.cmd`, Linux uses `npm`, nonzero status with valid audit JSON remains parseable, missing output/network failure fails closed, stderr is bounded, summaries contain only workspace/package/advisory/severity/scope/counts/commit/Node/npm/time, and SBOM metadata gains Chengye traceability properties without environment values or absolute paths.

- [ ] **Step 2: Verify the runner tests fail**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/process-runner.test.mjs scripts/security/artifacts.test.mjs`

Expected: FAIL with missing `process-runner.mjs` and `artifacts.mjs` modules.

- [ ] **Step 3: Implement fail-closed process execution and artifact writing**

Use `spawnSync` with `shell: false`, UTF-8, a 20 MiB output limit, and no inherited environment logging. For audit commands, accept status 0 or 1 only when stdout parses as supported npm audit JSON; all other cases throw. Write JSON atomically through a sibling `.tmp` file followed by rename.

```js
const npmExecutable = platform => platform === 'win32' ? 'npm.cmd' : 'npm';

export function runNpm(args, options = {}) {
  return runCommand(npmExecutable(options.platform ?? process.platform), args, {
    cwd: options.cwd,
    spawn: options.spawn,
  });
}
```

- [ ] **Step 4: Implement CLI orchestration**

`audit-prod` runs `npm audit --json --omit=dev` once per selected workspace. `audit-all` runs both production and full audit for each selected workspace, then applies development exceptions. `--workspace server|web` narrows an interactive remediation check; CI and final acceptance omit it so both configured workspaces are mandatory. Each command writes sanitized summaries before setting `process.exitCode = 1` on blockers. `sbom` runs `npm sbom --sbom-format=cyclonedx --package-lock-only`, writes separate `server.cdx.json` and `web.cdx.json`, and adds `chengye.commit`, `chengye.workspace`, `chengye.node`, `chengye.npm`, and `chengye.generatedAt` metadata properties.

Extend `security:test` to explicitly include `process-runner.test.mjs` and `artifacts.test.mjs` after the Task 2 test files.

- [ ] **Step 5: Run offline tests and policy validation**

Run: `cd LayerManage/law-firm-system && npm run security:test && npm run security:policy:validate`

Expected: all deterministic tests pass; policy validation exits 0 without registry access.

- [ ] **Step 6: Commit the executable security layer**

```powershell
git add LayerManage/law-firm-system/scripts/security LayerManage/law-firm-system/package.json
git commit -m "feat(security): add audit and sbom commands"
```

### Task 4: Frontend Production Dependency Remediation

**Files:**
- Modify: `LayerManage/law-firm-system/apps/web/package.json`
- Modify: `LayerManage/law-firm-system/apps/web/package-lock.json`
- Create: `LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs`
- Test: `LayerManage/law-firm-system/apps/web/src/api/request.test.ts`
- Test: `LayerManage/law-firm-system/apps/web/src/App.test.tsx`
- Test: `LayerManage/law-firm-system/apps/web/src/pages/Login/index.test.tsx`
- Test: `LayerManage/law-firm-system/apps/web/src/pages/PasswordChange/index.test.tsx`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: web lock tree with `axios >= 1.18.1` and `react-router-dom/react-router >= 7.18.1`
- Preserves: request interceptors, login, forced-password-change, protected-route, and navigation behavior

- [ ] **Step 1: Add a failing lockfile security contract**

Add a numeric version comparator and assert the web lock resolves axios and both router packages at or above the accepted floors. Also assert all three lockfiles use version 3.

Extend `security:test` to explicitly include `dependency-contract.test.mjs`.

```js
test('web production dependency floors stay above remediated versions', () => {
  const lock = readLock('apps/web/package-lock.json');
  assertVersionAtLeast(lock.packages['node_modules/axios'].version, '1.18.1');
  assertVersionAtLeast(lock.packages['node_modules/react-router-dom'].version, '7.18.1');
  assertVersionAtLeast(lock.packages['node_modules/react-router'].version, '7.18.1');
});
```

- [ ] **Step 2: Verify the current lockfile fails the new floor**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/dependency-contract.test.mjs`

Expected: FAIL because axios is `1.15.2` and react-router-dom is `7.14.2`.

- [ ] **Step 3: Upgrade only the two production dependency chains**

Run: `cd LayerManage/law-firm-system/apps/web && npm install axios@1.18.1 react-router-dom@7.18.1`

Expected: only the web manifest and lockfile change; no `--force` and no unrelated direct dependency upgrade.

- [ ] **Step 4: Run web regression and production audit**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/dependency-contract.test.mjs && npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test && npm --prefix apps/web run build && npm run security:audit:prod -- --workspace web`

Expected: all web checks pass; web production summary has `critical=0` and `high=0`.

- [ ] **Step 5: Review the web lockfile delta and commit**

Run: `git diff --stat -- LayerManage/law-firm-system/apps/web && git diff --check`

```powershell
git add LayerManage/law-firm-system/package.json LayerManage/law-firm-system/apps/web/package.json LayerManage/law-firm-system/apps/web/package-lock.json LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs
git commit -m "fix(web): remediate production dependency risks"
```

### Task 5: Remove Unused JWT Plugin and Harden Credentialed CORS

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/apps/server/config/plugin.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/env.ts`
- Modify: `LayerManage/law-firm-system/apps/server/config/config.default.ts`
- Create: `LayerManage/law-firm-system/apps/server/config/cors.ts`
- Modify: `LayerManage/law-firm-system/apps/server/typings/config/plugin.d.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/config/env.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/config/cors.test.ts`
- Create: `LayerManage/law-firm-system/apps/server/test/app/cors.test.ts`
- Modify: `LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs`

**Interfaces:**
- Produces: `parseCorsAllowedOrigins(raw, nodeEnv) -> string[]`
- Produces: `resolveCorsOrigin(requestOrigin, allowedOrigins) -> string`
- Extends: `AppEnvironment.corsAllowedOrigins: string[]`
- Preserves: domain `JwtTokenService` based on direct `jsonwebtoken`; no Egg JWT plugin remains

- [ ] **Step 1: Write failing CORS and plugin-removal tests**

Assert development defaults to `http://localhost:3000`; production requires `CORS_ALLOWED_ORIGINS`; wildcard, credentials embedded in URLs, paths, duplicate origins, and non-http(s) schemes fail. Assert allowed origin is reflected, denied origin returns empty string, preflight includes credentials only for allowed origins, and manifests/plugin typings contain no `egg-jwt`.

```ts
test('credentialed CORS reflects only an explicitly allowed origin', () => {
  assert.equal(resolveCorsOrigin('https://oa.chengye.example', ['https://oa.chengye.example']), 'https://oa.chengye.example');
  assert.equal(resolveCorsOrigin('https://attacker.example', ['https://oa.chengye.example']), '');
});
```

- [ ] **Step 2: Verify failures against the wildcard configuration**

Run: `cd LayerManage/law-firm-system/apps/server && npx tsx --test test/config/cors.test.ts test/config/env.test.ts`

Expected: FAIL because `config/cors.ts` and `corsAllowedOrigins` do not exist.

- [ ] **Step 3: Implement explicit-origin CORS and remove plugin wiring**

`parseCorsAllowedOrigins` accepts a comma-separated list, normalizes URL origins, and uses only `http://localhost:3000` outside production when omitted. `config.default.ts` sets `credentials: true` and `origin: ctx => resolveCorsOrigin(ctx.get('origin'), env.corsAllowedOrigins)`. Remove the `jwt` plugin stanza and generated typing entries, but retain `config.jwt.secret` because application authentication consumes it directly.

- [ ] **Step 4: Remove `egg-jwt` and upgrade CORS plugin**

Run: `cd LayerManage/law-firm-system/apps/server && npm uninstall egg-jwt && npm install egg-cors@3.0.1`

Expected: `egg-jwt`, `koa-jwt2`, and `lodash.set` leave the lock tree; `egg-cors` resolves to 3.0.1 and `@koa/cors` to 5.x.

- [ ] **Step 5: Run CORS, authentication, and package regressions**

Run: `cd LayerManage/law-firm-system/apps/server && npx tsx --test --test-force-exit test/config/cors.test.ts test/config/env.test.ts test/app/cors.test.ts test/security/token-service.test.ts test/app/auth.test.ts && npm run lint && npm run typecheck && npm run build`

Expected: tests, lint, typecheck, and build pass; allowed preflight reflects the request origin with credentials, denied origin has no access-control-allow-origin header.

- [ ] **Step 6: Commit the server security boundary**

```powershell
git add LayerManage/law-firm-system/apps/server LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs
git commit -m "fix(server): harden cors and remove unused jwt plugin"
```

### Task 6: Refresh Server Runtime Chain and Verify Production Zero

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/package.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs`

**Interfaces:**
- Produces: server direct floors `egg 3.34.0`, `egg-scripts 3.1.0`, `jsonwebtoken 9.0.3`
- Produces: remediated compatible transitive releases including `undici >= 6.27.0` and `form-data >= 4.0.6`

- [ ] **Step 1: Extend the failing lockfile contract**

Assert the exact server direct floors and transitive safe floors, and assert no key contains `/node_modules/egg-jwt`, `/node_modules/koa-jwt2`, or `/node_modules/lodash.set`.

- [ ] **Step 2: Verify the current runtime tree fails the floors**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/dependency-contract.test.mjs`

Expected: FAIL on stale `egg-scripts`, `undici`, or `form-data` resolutions.

- [ ] **Step 3: Refresh only compatible runtime ranges**

Run: `cd LayerManage/law-firm-system/apps/server && npm install egg@3.34.0 egg-scripts@3.1.0 jsonwebtoken@9.0.3`

Do not add an override unless the command leaves a production critical/high advisory. If that occurs, stop this task with evidence rather than forcing a framework-incompatible major; revise SEC-SPEC-001 before proceeding.

- [ ] **Step 4: Run complete server verification and production gate**

Run: `cd LayerManage/law-firm-system && node --test scripts/security/dependency-contract.test.mjs && npm --prefix apps/server run lint && npm --prefix apps/server run typecheck && npm --prefix apps/server run test:unit && npm --prefix apps/server run build && npm run security:audit:prod`

Expected: all checks pass; both server and web production summaries report no critical/high finding.

- [ ] **Step 5: Commit runtime remediation**

```powershell
git add LayerManage/law-firm-system/apps/server/package.json LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs
git commit -m "fix(server): remediate runtime dependency risks"
```

### Task 7: Development Toolchain and Time-Bound Exception

**Files:**
- Modify: `LayerManage/law-firm-system/apps/web/package.json`
- Modify: `LayerManage/law-firm-system/apps/web/package-lock.json`
- Modify: `LayerManage/law-firm-system/apps/server/package-lock.json`
- Modify: `LayerManage/law-firm-system/security/dependency-exceptions.json`
- Modify: `LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs`

**Interfaces:**
- Produces: Vite `>= 8.1.4`
- Produces: no development critical finding
- Produces: at most one documented server development high exception for `serialize-javascript` / `GHSA-5c6j-r48x-rmvq`, valid through `2026-08-15`

- [ ] **Step 1: Add the Vite floor and exact exception contract test**

Assert Vite resolves at or above 8.1.4. Assert the only allowed initial exception, when still required by the refreshed audit, is:

```json
{
  "id": "SEC-2026-001",
  "workspace": "server",
  "package": "serialize-javascript",
  "advisories": ["GHSA-5c6j-r48x-rmvq"],
  "scope": "development",
  "reason": "The current Egg test toolchain has no compatible upstream release that removes this advisory without a framework downgrade.",
  "mitigation": "The package is restricted to local and CI test/build execution; production audit and runtime artifacts omit development dependencies.",
  "owner": "platform-engineering",
  "approvedBy": "system-super-admin",
  "createdAt": "2026-07-16",
  "expiresAt": "2026-08-15",
  "trackingRef": "SEC-SPEC-001/serialize-javascript"
}
```

- [ ] **Step 2: Upgrade the web development chain**

Run: `cd LayerManage/law-firm-system/apps/web && npm install --save-dev vite@8.1.4`

Expected: Vite high advisory is removed; web tests and build remain compatible.

- [ ] **Step 3: Refresh server development transitive ranges without downgrading Egg tooling**

Run: `cd LayerManage/law-firm-system/apps/server && npm update --include=dev`

Expected: compatible patch/minor transitive updates apply. Reject npm's suggested `egg-bin@4.20.0` or `egg-mock@5.9.1` downgrade because it conflicts with the current tested toolchain direction.

- [ ] **Step 4: Run the full audit and record only a still-present exact exception**

Run: `cd LayerManage/law-firm-system && npm run security:audit:all`

If `GHSA-5c6j-r48x-rmvq` remains as a server development-only high, add the exact record above and rerun. If it no longer exists, keep `exceptions` empty. Any other development high or any development critical blocks the task and requires its own reviewed remediation or Spec amendment.

- [ ] **Step 5: Run toolchain regressions and gate**

Run: `cd LayerManage/law-firm-system && npm run security:policy:validate && npm run security:test && npm --prefix apps/server run test:unit && npm --prefix apps/server run pkg && npm --prefix apps/web run test && npm --prefix apps/web run build && npm run security:audit:prod && npm run security:audit:all`

Expected: production gate passes with zero critical/high; complete trees have zero critical; full gate passes with zero unapproved development high.

- [ ] **Step 6: Commit development-chain governance**

```powershell
git add LayerManage/law-firm-system/apps/server/package-lock.json LayerManage/law-firm-system/apps/web/package.json LayerManage/law-firm-system/apps/web/package-lock.json LayerManage/law-firm-system/security/dependency-exceptions.json LayerManage/law-firm-system/scripts/security/dependency-contract.test.mjs
git commit -m "fix(security): govern development dependency risks"
```

### Task 8: Independent CI Gate and SBOM Artifacts

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/ci/workflow-contract.ts`
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/workflow-contract.test.ts`
- Modify: `LayerManage/law-firm-system/package.json`

**Interfaces:**
- Produces: GitHub Actions job `dependency-security`
- Produces: artifact `dependency-security-${{ github.sha }}` retained for 14 days
- Preserves: existing `verify` and `windows-package` job contracts

- [ ] **Step 1: Add failing workflow contract tests**

Parse YAML and assert the independent job pins Node 22.14.0, runs three clean installs, offline policy validation, production audit, full audit, SBOM generation, and always uploads `var/security` with 14-day retention. Assert it contains no `npm audit fix`, `--force`, bootstrap, recovery, or database credentials.

- [ ] **Step 2: Verify the current workflow fails the new contract**

Run: `cd LayerManage/law-firm-system/apps/server && npx tsx --test --test-force-exit test/ci/workflow-contract.test.ts`

Expected: FAIL because `dependency-security` is absent.

- [ ] **Step 3: Add the independent CI job**

Use this exact command order in `dependency-security`: checkout; setup Node 22.14.0 with all three cache paths; `npm ci` at root, server, and web; `npm run security:policy:validate`; `npm run security:audit:prod`; `npm run security:audit:all` with `if: always()`; `npm run security:sbom` with `if: always()`; upload `LayerManage/law-firm-system/var/security` with `if: always()` and `retention-days: 14`.

- [ ] **Step 4: Include deterministic security checks in local verification**

Change root `test` and `test:all` to run `security:test` after server and web tests. Append `security:policy:validate` to `verify`; do not append either online audit command or SBOM generation.

- [ ] **Step 5: Run CI contract and local offline verification**

Run: `cd LayerManage/law-firm-system && npm --prefix apps/server run test:focused -- test/ci/workflow-contract.test.ts && npm run security:test && npm run security:policy:validate && npm run verify`

Expected: workflow contract, security tests, policy validation, and repository verification pass; no registry audit runs as part of `verify`.

- [ ] **Step 6: Generate and inspect SBOMs locally**

Run: `cd LayerManage/law-firm-system && npm run security:sbom`

Expected: `var/security/sbom/server.cdx.json` and `web.cdx.json` parse as CycloneDX 1.5 JSON, have Chengye traceability properties, and contain no `.env`, database URL, token, password, or local absolute path.

- [ ] **Step 7: Commit CI integration**

```powershell
git add .github/workflows/ci.yml LayerManage/law-firm-system/package.json LayerManage/law-firm-system/apps/server/scripts/ci/workflow-contract.ts LayerManage/law-firm-system/apps/server/test/ci/workflow-contract.test.ts
git commit -m "ci: enforce dependency security gates"
```

### Task 9: Runbook, Closeout Evidence, and Final Acceptance

**Files:**
- Create: `docs/superpowers/runbooks/dependency-security.md`
- Create: `docs/superpowers/reports/sec-spec-001-closeout.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Produces: operator workflow for audits, exceptions, expiry, SBOM inspection, and failures
- Produces: SEC-SPEC-001 acceptance record tied to commit SHA and measured summaries

- [ ] **Step 1: Write the operator runbook**

Document prerequisites, the four root commands, artifact paths, why online audits are not in `verify`, how to add/remove an exact exception, 30-day maximum, required two-role review, fail-closed network behavior, and the rule forbidding `npm audit fix --force`. Include PowerShell commands using `npm.cmd` only where direct invocation is required; root npm scripts remain portable.

- [ ] **Step 2: Run clean-install acceptance**

Run from `LayerManage/law-firm-system`:

```powershell
npm ci
npm --prefix apps/server ci
npm --prefix apps/web ci
npm --prefix apps/server run db:generate
npm run security:policy:validate
npm run security:test
npm run security:audit:prod
npm run security:audit:all
npm run security:sbom
npm run verify
```

Expected: every command exits 0; production critical/high are zero; full critical is zero; any development high is covered by the one exact unexpired exception allowed in Task 7.

- [ ] **Step 3: Run PostgreSQL and empty-database acceptance**

Run: `cd LayerManage/law-firm-system && npm run db:reset:test && npm run db:assert-empty && npm run test && npm run db:reset:test && npm run db:assert-empty`

Expected: tests pass and application tables are empty before and after. If Docker is unavailable, record this as an unpassed local gate and ask only for Docker Desktop startup; do not attempt host repair.

- [ ] **Step 4: Write the closeout report from committed sanitized summaries**

Record the 2026-07-16 baseline counts from SEC-SPEC-001, final required values (`server prod critical/high 0/0`, `web prod 0/0`, both full critical 0), changed direct packages, removed `egg-jwt`, CORS evidence, residual exception or explicit `none`, commands and exit codes, commit SHA, Node/npm versions, SBOM filenames, and the status of remote CI. Do not copy raw audit JSON into Git.

- [ ] **Step 5: Update the engineering index**

Add the runbook and closeout report to `docs/superpowers/README.md`; change SEC-SPEC-001 wording to implemented only after all local acceptance commands pass. Keep remote CI listed as pending until a real GitHub Actions run succeeds.

- [ ] **Step 6: Final drift and secret review**

Run: `git diff --check && git status --short && git diff --stat && rg -n "npm audit fix --force|DATABASE_URL=|JWT_SECRET=|APP_KEYS=|FAL_AI_API_KEY|DASHSCOPE_API_KEY" LayerManage/law-firm-system/var/security docs/superpowers/reports/sec-spec-001-closeout.md`

Expected: diff check passes; only planned source/docs files are tracked; generated `var/security` is ignored; the sensitive-value scan returns no matches.

- [ ] **Step 7: Commit the closeout records**

```powershell
git add docs/superpowers/README.md docs/superpowers/runbooks/dependency-security.md docs/superpowers/reports/sec-spec-001-closeout.md
git commit -m "docs: close dependency security baseline"
```

## Implementation Checkpoints

1. After Task 3: review fail-closed semantics and sanitized output before any dependency change.
2. After Task 4: require web production critical/high zero before server remediation continues.
3. After Task 6: require both production workspaces critical/high zero before development exceptions are considered.
4. After Task 8: review workflow contract and generated SBOM content before final acceptance.
5. After Task 9: run `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`; do not merge while remote CI remains unobserved.

## Efficiency Rule

Execute inline in this worktree with `superpowers:executing-plans`. Do not dispatch a subagent per task. Use a subagent only for one final independent code review if the implementation changes more files than this plan lists or a framework compatibility issue forces a Spec amendment. Stop for user confirmation only when a production high cannot be removed without an unplanned major framework change, a destructive database action becomes necessary, or credentials/external service access are required.
