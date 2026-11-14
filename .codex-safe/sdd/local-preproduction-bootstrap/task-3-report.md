# Task 3 Reset-Ready Safe Checkpoint

## Classification

- Scope: local preproduction Task 3 only.
- Final status: READY_FOR_RESET_AUTHORIZATION_ONLY.
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-3-report.md`

## Strict TDD evidence

- Minimal confirmation-gate RED: total 1, passed 0, failed 1; category `MISSING_INITIALIZER`.
- Full Task 3 RED: total 10, passed 0, failed 10; categories `MISSING_INITIALIZER`, `MISSING_COMPOSE_TARGET_RESOLVER`, and `MISSING_SANITIZED_NATIVE_BOUNDARY`.
- First completed focused run: total 10, passed 8, failed 2; category `TEST_CANONICAL_EXPECTATION_UNNORMALIZED`.
- Final focused GREEN: total 10, passed 10, failed 0.
- Fresh Task 1 through Task 3 GREEN: total 73, passed 73, failed 0, skipped 0; elapsed seconds 59.
- Root categories reaching three failed production fixes: 0.

## Safety-contract evidence

- Missing confirmation native calls: 0.
- Invalid path metadata calls: 0.
- Exact metadata calls in an approved target check: 2/2.
- Approved READY invocation destructive calls: exactly 1 scoped `down --volumes`.
- Maximum destructive calls in any injected invocation: 1.
- Total injected destructive calls across READY, reset-failure, start-failure, timeout, and allow-list cases: 5.
- Real destructive calls: 0.
- Additional output streams in the final focused matrix: 0.
- Final safe records per invocation: exactly 1.
- Native stderr and injected raw-error disclosure matches: 0.
- Global prune, container enumeration, broad volume enumeration, and container-identifier calls: 0.
- Health polling upper bound: 120 seconds; injected timeout polls remained bounded.

## Safe verification evidence

- AST parse: files 3, errors 0.
- Fresh focused all-stream run: total 10, passed 10, failed 0.
- Error records in fresh focused all-stream capture: 0.
- Captured-output forbidden matches: 0.
- Final alert codes: none.

## Alert codes exercised

- `DATABASE_RESET_CONFIRMATION_REQUIRED`
- `COMPOSE_TARGET_INVALID`
- `COMPOSE_METADATA_FAILED`
- `SECRET_BUNDLE_MISSING`
- `SECRET_BUNDLE_INVALID`
- `ENVIRONMENT_BUNDLE_MISMATCH`
- `EVENT_WORKER_NOT_DISABLED`
- `DATABASE_NOT_EMPTY`
- `DATABASE_EMPTY_CHECK_FAILED`
- `DATABASE_RESET_FAILED`
- `DATABASE_START_FAILED`
- `DATABASE_HEALTH_TIMEOUT`

## Verification window

- UTC start: `2026-07-26T12:01:41.5653598Z`.
- UTC end: `2026-07-26T12:01:44.6112950Z`.
- Elapsed seconds: 3.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live reset executions: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Network operations: 0.
- Project npm operations: 0.
- Real fixed bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Later-task operations: 0.

## Residual risks

- Real Docker Compose metadata, database count, startup, and health behavior remain intentionally unexecuted until a separate live-reset authorization.
- DPAPI bundle recovery remains tied to the current Windows user and fixed local storage context.
- The narrow test-operation parameter is exercised only by local Pester harnesses; the operator reset remains gated by the explicit confirmation switch and all fixed runtime checks.
- Migration, administrator bootstrap, backup, runtime launch, and source/portable preflight belong to later tasks and remain unimplemented and unexecuted here.
