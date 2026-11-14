# Task 1 Brief — Migrated-State Retry

Read this first. It is the Task 1 requirements source for the implementation agent.

## Governing documents

- Approved design: `docs/superpowers/specs/2026-07-27-local-preproduction-migrated-retry-design.md`
- Approved plan: `docs/superpowers/plans/2026-07-27-local-preproduction-migrated-retry.md`
- Original blocked review: `.codex-safe/sdd/local-preproduction-migration-order/task-2-review.md`

## Allowed changes

- Modify only `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`.
- Modify only `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1` for tests.
- Create `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-report.md`.
- Append safe progress to `.codex-safe/sdd/local-preproduction-migrated-retry/progress.md`.

## Required production behavior

1. Add bounded count `migratedRetryStateReady`, initially `0` and at most `1`.
2. A parsed table count of zero retains the existing fresh flow unchanged: one scoped reset, restart, second health, `DATABASE_READY`, `db:deploy` with timeout `600000`, `MIGRATED`, `db:assert-empty` with timeout `120000`, then the existing contract and hidden bootstrap.
3. A parsed table count greater than zero becomes a resume candidate and never authorizes reset.
4. Resume candidate order is exactly: pre-resume `db:assert-empty` (`120000`) → `MIGRATED_RETRY_STATE_READY` → `db:deploy` (`600000`) → `MIGRATED` → post-deploy `db:assert-empty` (`120000`) → `DATABASE_ASSERT_EMPTY` → contract → hidden bootstrap.
5. Failed or unlaunchable pre-resume assertion returns phase `MIGRATED_RETRY_STATE`, code `MIGRATED_RETRY_STATE_UNSAFE`, with reset/deploy/contract/bootstrap calls all `0`.
6. Accepted resume sets `migratedRetryStateReady=1`; its destructive call count remains `0`.
7. Resume deploy failure retains `MIGRATION_FAILED` and stops post-assert/contract/bootstrap.
8. Resume post-assert failure retains `DATABASE_NOT_EMPTY` and stops contract/bootstrap.
9. Malformed/failed catalog count mappings, Compose isolation, native boundaries, assertion script, hidden-input block, safe record schema, and Worker-disabled boundary remain unchanged.

## Required TDD

- Tests must be written and observed RED before production modification.
- Extend the injected fixture with optional shared state containing exactly `TableCount`, `SchemaComplete`, `ApplicationRows`.
- Add exact scenarios: `AssertEmptyFailureWithRows`, `BootstrapFailureWithRows`, `ResumeDeployFailure`, `ResumeDeployException`, `ResumePostAssertFailure`, `ResumePostAssertException`.
- Add exact block `Describe 'Local preproduction migrated-state retry' -Tags 'MigratedRetryTask1'`.
- Stateful successful second-invocation cases: first `AssertEmptyException`, `ContractFailure`, or `BootstrapFailure` after successful migration leaves complete schema and zero rows; second call uses the same state, performs reset `0`, pre-assert `1`, deploy `1`, post-assert `1`, and finishes READY.
- Stateful unsafe second-invocation cases: incomplete schema; existing governed row; `AssertEmptyFailureWithRows`; `BootstrapFailureWithRows`. Each preserves state and performs reset/deploy/contract/bootstrap `0` on the second call.
- Resume failure matrix:
  - `ResumeDeployFailure`, `ResumeDeployException`: assertion `1`, deploy `1`, contract/bootstrap `0`, migrated records `0`.
  - `ResumePostAssertFailure`, `ResumePostAssertException`: assertion `2`, deploy `1`, contract/bootstrap `0`, migrated records `1`.
- Update `CountNonzero` to expect `MIGRATED_RETRY_STATE_UNSAFE`, assertion `1`, and reset/deploy/contract/bootstrap `0`.
- Preserve fresh `MigrationOrderTask1` order tests and Task 4 hidden-bootstrap tests.

## Verification and report contract

- Focused RED counts and expected stable classifications.
- Focused GREEN counts for retry, fresh order, and hidden bootstrap.
- One complete Core+Workflow run with failures `0`, skips `0`.
- AST errors `0`; Compose call sites all use the fixed builder; base-only `0`; scoped destructive sites exactly `1` and fresh-only; resume destructive sites `0`; command/timeout matches exact; redirected bootstrap streams `0`; remote Worker toggles `0`.
- Core, loader, assertion script, Compose override, and hidden bootstrap modifications `0`.
- Live Docker/database/migration/initializer/bootstrap/npm/npx/network/operator input/default volume/Git/GitHub/external mutation counts all `0`.
- Write only safe status, counts, stable codes, UTC, and elapsed duration to the report.
- Return `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`, plus one-line test summary and concerns. Do not return raw test output.

## Absolute prohibitions

- No Git or GitHub commands.
- No live Docker, database, migration, initializer, bootstrap, npm/npx, network, or operator-input operation.
- Do not print URLs, credentials, payloads, raw database errors, stacks, host, PID, worker identity, or lock-owner data.
- Do not delete or rewrite any event history and do not add a remote Worker toggle.
