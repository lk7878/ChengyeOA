# SPEC-005 Administrator Governance Closeout

- Closeout date: 2026-07-21
- Repository head observed: `1341f74cec03c68ba8e4200e0fffebe59de198bc`
- Working mode: existing dirty working tree, in place
- Toolchain: Node.js `22.14.0`, npm `10.9.2`, PostgreSQL `16.14`
- Database: local PostgreSQL container `chengye-oa-postgres`, healthy during acceptance

## Delivered scope

SPEC-005 now provides a code-owned eight-operation governance catalog, immutable request/payload integrity, PRE and POST review state machines, requester idempotency, independent super-admin review, retry/resume with serialized execution, append-only reviews/executions/audits, protected administrator-account mutations, whitelisted master-data corrections, last-super-admin protection, and the one-time second-super-admin recovery CLI.

The web workbench includes role-aware My Requests, Pending Review, and All Records scopes; filters; a safe target/version endpoint; catalog-driven creation; exact CRITICAL confirmation; review/cancel/retry actions; execution history; responsive layouts; and stable error handling. The generic user projection still excludes credential and lock fields.

Operator guidance is in `runbooks/admin-governance-super-admin-review.md`. The restart record remains in `handoffs/2026-07-21-spec-005-shutdown-handoff.md`, and the detailed implementation history is in `reports/spec-005-task-log.md`.

## Migration evidence

The final test reset successfully applied all seven migrations in order:

1. `20260712232134_postgresql_baseline`
2. `20260715120000_system_bootstrap_trust_root`
3. `20260718120000_organization_personnel_expand`
4. `20260718180000_employee_assignment_contract`
5. `20260718210000_authorization_expand`
6. `20260718220000_authorization_contract`
7. `20260721120000_admin_governance_expand`

The canonical Prisma contract now contains 35 models and the migration-owned permission catalog contains 69 entries. Both static baselines were updated and verified.

## Automated acceptance evidence

The final command sequence used the pinned Node/npm toolchain and the guarded `_test` database:

```powershell
npm run db:reset:test
npm run verify
npm run security:audit:prod
npm run security:audit:all
```

Final results:

- Server: 577 tests passed, 0 failed.
- Web: 21 test files, 61 tests passed, 0 failed.
- Dependency/security policy: 34 tests passed, 0 failed.
- Server and web lint: passed; web retained 9 pre-existing `react-hooks/exhaustive-deps` warnings in unrelated legacy pages and introduced no governance Hook warning.
- Server and web type checks: passed.
- Baseline and bootstrap contracts: passed.
- Server and web production builds: passed; Vite transformed 3,113 modules.
- Production audit: server and web each passed with 0 high and 0 critical findings.
- Full audit: server and web each passed with 0 production high and 0 production critical findings.

The assembled PostgreSQL SPEC-005 acceptance suite covers second-seat recovery, two-person system-admin grant/revoke, self-review rejection, PRE inertness, LOW POST review, idempotency, concurrent review, tamper detection, stale targets, rollback, last-seat protection, audit history, and ordinary-user denial. Its five scenarios passed. A cross-boundary mismatch discovered during acceptance was corrected so master-data optimistic-lock failures now expose the governance contract `STALE_TARGET_VERSION` rather than leaking the lower-level `VERSION_CONFLICT`.

The guarded browser fixture passed two tests: it rejects missing credentials and every database not ending in `_test`, and it seeds through the production password hasher plus bootstrap/governance services without printing a password or connection string.

## Browser evidence

Browser acceptance used local Chrome through Playwright at desktop `1440x900` and mobile `390x844`. The following eight PNGs are stored under `reports/artifacts/spec-005/`:

- `desktop-my-requests.png`
- `desktop-pending-review.png`
- `desktop-create-drawer.png`
- `desktop-critical-confirmation.png`
- `desktop-detail-timeline.png`
- `desktop-system-admin-boundary.png`
- `mobile-governance-navigation.png`
- `mobile-navigation-open.png`

The desktop and mobile document/body overflow measurements were zero. Lists, drawer forms, confirmation text, detail history, and mobile navigation had no overlapping controls, blank panels, or inaccessible clipped content. The execution snapshots intentionally use a horizontal table scroller. The system-admin session exposed only My Requests and zero review buttons; the super-admin session exposed the independent review scopes and actions.

The browser fixture password was ephemeral. The final database reset removed all fixture users, grants, operations, and sessions.

## Dependency remediation during closeout

The first full-development audit found a new Web development-only `brace-expansion` high-severity advisory. No exception was added. `npm audit fix` updated only the Web lockfile-compatible development tree, including `brace-expansion` `5.0.7` and `@babel/core` `7.29.7`. The dependency contract now pins those remediation floors. Post-update Web tests/build and both final audits passed.

The full server audit still reports the already approved, exact, time-bounded development exception for `serialize-javascript` (`SEC-2026-001`, expires 2026-08-15) plus moderate findings. Production high and critical counts remain zero. The exception must be removed or independently renewed through the security process before expiry.

## Empty-database proof

After every other acceptance step, the test database was reset again and checked with:

```powershell
npm run db:reset:test
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npm --prefix apps/server run db:assert-empty
```

The command exited 0 with `All application tables are empty.` Permission catalog rows remain migration-owned system metadata and are not fixture application data.

## Residual release gates and warnings

- Remote CI, including its independent dependency-security job, was not executed locally.
- Inno Setup installer compilation remains a separate release gate.
- The production Web build retains the existing chunk-size advisory for the approximately 1.91 MB main chunk (approximately 557 kB gzip).
- Browser console output retains legacy layout/custom-prop and Ant Design deprecation warnings; no uncaught page error or governance functional failure was observed. These should be removed during the relevant component maintenance.
- MFA remains outside SPEC-005 and continues to be a production identity-security prerequisite described by the SPEC-002 boundary.

## Repository integrity statement

No Git or GitHub write operation was performed: no staging, commit, branch creation/switch, merge, reset, push, pull request, issue update, or remote mutation. Existing user changes and the dirty working tree were preserved.

SPEC-005 local implementation and acceptance are complete.
