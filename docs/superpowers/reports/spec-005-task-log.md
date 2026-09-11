# SPEC-005 Task Log

## Task 1 — Governance Persistence, Permissions, and Reserved System-Admin Role

- Date: 2026-07-21
- Prisma schema model count: 35
- Migration contract tests: 2 passed
- Bootstrap service tests: 8 passed
- Focused Task 1 suite: 23 passed, 0 failed
- Test database reset: passed; migration `20260721120000_admin_governance_expand` applied successfully
- Reset command: `npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test`
- Prisma validation and client generation: passed
- Git checkpoint: local working tree only; no files staged or committed

## Task 2 — Code-Owned Governance Kernel

- Date: 2026-07-21
- Governed operation types: 8 immutable catalog entries
- Governance kernel tests: 10 passed, 0 failed
- TDD RED: 10 assertions failed because all six kernel modules were absent
- TDD GREEN: canonical JSON/SHA-256, stable errors, strict parsers, operation catalog, and state guards passed
- Resume compatibility: retained the two planned required parameters and added optional `retryable=false` so FAILED operations require catalog approval
- Type check: `npm run typecheck` passed
- Focused lint: new governance domain and test files passed
- Focused command: `npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-force-exit test/admin-governance/governance-kernel.test.ts`
- Git checkpoint: local working tree only; no files staged or committed

## Task 3 — Fail-Closed SYSTEM_ADMIN Authorization

- Date: 2026-07-21
- SYSTEM_ADMIN allowlist: 9 immutable permission codes
- TDD RED: 27 passed and 10 expected feature assertions failed in serialized mode
- TDD GREEN: 37 passed, 0 failed
- Coverage: active, future, expired, revoked, disabled-role, disabled-user, mixed reserved roles, and newly registered permission exclusion
- Legacy user mutation protection: active SYSTEM_ADMIN and SYSTEM_SUPER_ADMIN update/delete requests return 409
- Authorization summary: `/authorization/me` exposes `isSystemAdmin`
- Type check: `npm run typecheck` passed
- Focused lint: all Task 3 production and test files passed
- Focused command: `npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/authorization/authorization-context-loader.test.ts test/admin-governance/system-admin-permissions.test.ts test/app/trust-root-guard.test.ts`
- Plan command note: `--test-concurrency=1` is required because both database suites truncate and reseed the same test database
- Git checkpoint: local working tree only; no files staged or committed

## Task 4 — Append-Only Governance Store and Sanitized Queries

- Date: 2026-07-21
- TDD RED: 8 expected assertions failed because the governance store and query service modules were absent
- TDD GREEN: 8 passed, 0 failed after a clean test-database reset
- Store coverage: opaque operation numbers, requester idempotency, append-only review/execution timelines, and status-plus-version optimistic transitions
- Query coverage: self/reviewable/all scopes, reviewer conflict exclusion, stable pagination, role-filtered catalog projection, detail visibility, recursive snapshot redaction, and mandatory detail access audit
- Test database reset: passed; all seven migrations applied successfully
- Type check: `npm run typecheck` passed
- Focused lint: all Task 4 production and test files passed
- Focused command: `npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/admin-governance/governance-store.test.ts test/admin-governance/governance-query-service.test.ts`
- Git checkpoint: local working tree only; no files staged or committed

## Task 5 — Administrator Account and System-Role Commands

- Date: 2026-07-21
- TDD RED: 9 expected assertions failed because the administrator-account adapter module was absent
- TDD GREEN: 10 adapter tests passed, including a separate RED→GREEN regression for excluding currently locked accounts from the effective super-admin count
- Supported commands: system-admin and super-admin grant, revoke, and account disable
- Coverage: strict payloads, permanent and temporary grants, duplicate prevention, disabled targets and roles, reviewer-target conflict, target version checks, append-only revocation history, credential invalidation, sanitized snapshots, last-super-admin protection, and outer transaction rollback
- Authentication regression: 16 passed; combined Task 5 command passed 26 tests, 0 failed
- Expected failure-injection output: authentication audit rollback tests intentionally emit two Prisma/HTTP error logs while passing
- Test database reset: passed; all seven migrations applied successfully
- Type check: `npm run typecheck` passed
- Focused lint: adapter contract, implementation, and test passed
- Focused command: `npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd exec -- tsx --test --test-concurrency=1 --test-force-exit test/admin-governance/administrator-account-adapter.test.ts test/app/auth.test.ts`
- Git checkpoint: local working tree only; no files staged or committed

## Task 6 — Transactional Master-Data Commands and Governance Adapter

- Date: 2026-07-21
- TDD RED: 6 expected adapter tests failed because `master-data-adapter.ts` was absent
- TDD GREEN: 37 passed, 0 failed across organization, position, professional-team, and governance-adapter suites
- Shared commands: organization sort/status, position responsibilities/status, and professional-team description/status
- Governance coverage: exact one-field metadata whitelist, exact status payload, target-field matching, Employee rejection, optimistic versions, root/dependency/member protections, normalized safe snapshots, request-linked audit actors, and transaction rollback on audit failure
- Characterization coverage: existing organization, position, and professional-team behavior and audit output remain unchanged after extraction
- Test database reset: passed; all seven migrations applied successfully
- Type check: `npm run typecheck` passed
- Server lint: `npm run lint -- --no-fix` passed
- Focused command: `tsx --test --test-concurrency=1 --test-force-exit test/master-data/organization-service.test.ts test/master-data/position-service.test.ts test/master-data/professional-team-service.test.ts test/admin-governance/master-data-adapter.test.ts`
- Git checkpoint: local working tree only; no files staged or committed

## Task 7 — Governance Request, Review, Execution, Cancel, and Resume Services

- Date: 2026-07-21
- TDD RED: service suite failed because the governance factory, event sink, command, review, and execution modules were absent
- TDD GREEN: 12 focused service/concurrency tests passed; full admin-governance regression passed 48 tests, 0 failed
- Creation coverage: code-owned risk/review policy, requester roles, strict adapter payloads, CRITICAL confirmation, requester idempotency, PRE inertness, and LOW immediate execution
- Review coverage: independent reviewer, self-review and target-reviewer rejection, required rejection/flag comments, PRE approval execution, POST confirmation/flag semantics, and append-only reviews
- Execution coverage: payload-hash checks, row/version claims, sanitized success/failure attempts, audit linkage, no partial business commit, retryable FAILED recovery, and APPROVED process-interruption resume
- Concurrency coverage: exactly one concurrent review and one concurrent resume can execute the business mutation
- Events: stable payload contains only event type, operation identity/type, risk, status, result code, and request ID
- Test database reset: passed; all seven migrations applied successfully
- Type check: `npm run typecheck` passed
- Server lint: `npm run lint -- --no-fix` passed
- Git checkpoint: local working tree only; no files staged or committed

## Task 8 — Second-Super-Admin Recovery CLI

- Date: 2026-07-21
- TDD RED: service tests failed because `second-super-admin-service.ts` was absent; CLI tests failed because `secondSuperAdminMain` was absent
- TDD GREEN: Task 8 service, CLI, SPEC-002 recovery, and bootstrap-contract regression passed 150 tests, 0 failed
- Recovery gate: requires initialized trust root, exactly one effective unlocked super-admin, password re-verification, enabled distinct target, bounded reason, and exact database/target confirmation phrase
- Concurrency: serializable transaction plus PostgreSQL advisory lock permits exactly one second-seat grant and one audit row
- Grant/audit: creates `UserRole.source='RECOVERY'` and `SUPER_ADMIN_SECOND_SEAT_RECOVERY`; password and confirmation are neither persisted nor echoed
- CLI: root/server `super-admin:add-second` commands require a TTY, hidden current password input, migration readiness, and stable redacted output
- Build contract: compiled `dist/scripts/system/add-second-super-admin.js` exists; no `.env`, credential, secret, key, or certificate artifacts are present in `dist`
- Type check, server lint, bootstrap checker, server build, and diff check: passed
- Git checkpoint: local working tree only; no files staged or committed

## Task 9 — Thin Governance HTTP APIs

- Date: 2026-07-21
- TDD RED: router/API tests failed because no governance routes or controller were registered
- TDD GREEN: governance API, router contract, and authorization middleware suites passed 8 tests, 0 failed
- Routes: catalog, create, list, detail, review, cancel, and retry under `/api/v1/admin-governance`
- Authorization: catalog/create/review/retry use explicit permission middleware; list/detail/cancel use service-level self/all/owner checks; every route remains JWT-authenticated
- Controller boundary: authorization context, request DTO/query, request ID, IP, service delegation, and standard response envelope only
- Input semantics: client-controlled risk, review mode, reviewer, or status fields return stable `TARGET_NOT_ELIGIBLE` with HTTP 400; adapter target eligibility remains HTTP 422
- Event integration: Egg factory parses the configured PostgreSQL database name and maps safe structured events to the request logger
- Type check, server lint, and diff check: passed
- Git checkpoint: local working tree only; no files staged or committed

## Task 10 — Frontend Governance Contracts, Authorization, Route, and Menu

- Date: 2026-07-21
- TDD RED: missing governance API module, dropped `isSystemAdmin`, absent menu item, and absent route produced the expected failures
- TDD GREEN: governance API, App route, Layout menu, auth store, and authorization normalization passed 18 tests, 0 failed
- Contracts: backend operation/risk/review/status unions, catalog, summaries, detail timelines, page/query, create/review/versioned action DTOs; no `any`
- Client: catalog, list, detail, create, review, cancel, and retry endpoints plus Chinese labels for all 12 stable governance errors; unknown codes remain visible
- Authorization: `isSystemAdmin` and all governance/menu permission codes survive backend normalization and persisted state
- Navigation: `/security/admin-governance` requires `governance.catalog.read`; menu entry requires `menu.admin_governance`; breadcrumb is “管理员治理”
- Type check and diff check: passed
- Frontend lint: passed with 0 errors and 9 pre-existing hook warnings in unrelated legacy pages; no new warning in governance files
- Git checkpoint: local working tree only; no files staged or committed

## Task 11 — Governance Workbench UI

- Date: 2026-07-21
- Resume date: 2026-07-21
- TDD RED captured: 4 workbench tests failed against the prior placeholder page, as expected
- TDD GREEN: workbench/API suite passed 8 tests, 0 failed
- Implementation: role-aware tabs, compact filters/table, catalog-driven create drawer, exact master-data metadata fields, CRITICAL confirmation, review rules, cancel/retry/resume confirmations, detail history, and responsive styling
- Review regression fixed: rejection/flag comment validation reads the current form decision at validation time, eliminating a fast-submit stale-render gap
- Safe target version: governance-only `/api/v1/admin-governance/targets/users` returns aliased `governanceVersion`; generic `SAFE_USER_SELECT` still excludes `credentialVersion` and the endpoint response excludes all credential fields
- Governance target API/router tests: 6 passed, 0 failed
- Web typecheck and production build: passed
- Web lint: 0 errors and 9 unchanged warnings in unrelated legacy pages
- Server typecheck and lint: passed
- Resume document: `docs/superpowers/handoffs/2026-07-21-spec-005-shutdown-handoff.md`
- Git checkpoint: local working tree only; no files staged or committed

## Task 12 — Acceptance, Runbook, Browser Evidence, and Closeout

- Date: 2026-07-21
- PostgreSQL acceptance: 5 passed, 0 failed; covered second-seat recovery, independent grant/revoke, PRE/POST semantics, idempotency, concurrent review, tamper/stale rollback, last-seat protection, audit history, and ordinary-user denial
- Boundary correction: master-data `VERSION_CONFLICT` is translated to governance `STALE_TARGET_VERSION`; focused acceptance/adapter regression passed 11 tests
- Browser fixture: guarded `_test` URL and required ephemeral password; production hasher plus bootstrap/governance services; 2 passed, 0 failed
- Operator runbook: `docs/superpowers/runbooks/admin-governance-super-admin-review.md`
- Browser acceptance: Chrome/Playwright at 1440x900 and 390x844; 8 screenshots stored in `docs/superpowers/reports/artifacts/spec-005/`
- Authorization evidence: system-admin showed only My Requests and zero review buttons; super-admin review/all scopes were available; desktop and mobile document overflow were zero
- Final verification: server 577/577, web 61/61 across 21 files, security 34/34; lint/typecheck/build/baseline/bootstrap/policy passed
- Security audits: production and full audits passed for server and web with zero production high/critical findings; new Web development advisory remediated through lockfile-compatible upgrades without an exception
- Final database proof: all seven migrations reapplied; `db:assert-empty` exited 0 with all application tables empty
- Closeout: `docs/superpowers/reports/spec-005-closeout.md`
- Git checkpoint: no Git or GitHub write operation was performed; no files staged or committed
