# Task 4 Migration and Hidden Administrator Bootstrap Checkpoint

## Classification

- Scope: local preproduction Task 4 only.
- Final status: READY_FOR_SEPARATELY_AUTHORIZED_LIVE_INITIALIZATION.
- `LIVE_INITIALIZATION_EXECUTED=0`
- `OPERATOR_SECRET_INPUT_REQUESTED=0`

## Files changed

- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-4-report.md`

## Strict TDD evidence

- Initial focused RED: total 2, passed 0, failed 2.
- RED categories: `MISSING_INHERITED_CONSOLE_ORCHESTRATION` and `MISSING_FAIL_STOP_PROGRESSION`.
- First focused post-implementation run: total 2, passed 1, failed 1; category `TEST_PROJECT_ROOT_EXPECTATION_INCORRECT`.
- Root cause: the test traversed only two parents from the Compose file and therefore expected the `infra` directory instead of the fixed project root. Correcting the hand-derived test path required no production change.
- Final focused Task 4 GREEN: total 2, passed 2, failed 0.
- Focused Task 3 preservation GREEN: total 13, passed 13, failed 0.
- Fresh Task 1 through Task 4 GREEN: total 94, passed 94, failed 0, skipped 0.
- Root categories reaching three failed production fixes: 0.

## Exact progression and failure evidence

- Successful injected native order: `services`, `volumes`, `count`, `down`, `up`, `health`, `db:assert-empty`, `db:deploy`, `check:bootstrap`, `system:bootstrap`.
- Successful safe state order: `DATABASE_READY`, `MIGRATED`, `BOOTSTRAP_CONTRACT_READY`, `WAITING_OPERATOR_SECRET_INPUT`, `ADMIN_BOOTSTRAPPED`.
- Waiting records on the successful path: exactly 1.
- Administrator READY records before a zero bootstrap exit: 0.
- Fixed Task 4 npm file: `npm.cmd` for all four calls.
- Fixed Task 4 working-directory mismatches: 0.
- Secret or password-bearing command arguments: 0.
- Inherited console flags: stdin 1, stdout 1, stderr 1.
- Direct administrator-bootstrap redirection parameters: 0.
- Failure positions exercised: 4 of 4.
- Nonzero failure fixtures: 4 of 4 stopped at the failing command.
- Launch-exception fixtures: 4 of 4 stopped at the failing command.
- Later Task 4 calls after a failure: 0.
- Noninteractive injected stdout/stderr disclosure matches: 0.
- Interactive injected exception disclosure matches: 0.

## Task 3 preservation evidence

- Missing-confirmation native calls: 0.
- Approved reset sequence remains `services`, `volumes`, `count`, `down`, `up`, `health`.
- Scoped destructive calls per approved injected initialization: exactly 1 `down --volumes`.
- Broad cleanup, container enumeration, container-identifier, or broad volume calls: 0.
- Real destructive calls: 0.

## Safe verification evidence

- AST parse: files 3, errors 0.
- Direct administrator-bootstrap commands found: 1.
- Direct administrator-bootstrap redirect parameters found: 0.
- Task 4 password-named arguments found: 0.
- Task 4 broad-cleanup tokens found: 0.
- Fresh focused all-stream run: total 2, passed 2, failed 0.
- Non-success stream records in the focused capture: 0.
- Concrete forbidden-output matches in the focused capture: 0.
- Safe record schema mismatches: 0.
- Final alert codes: none.

## Stable failure codes exercised

- `DATABASE_NOT_EMPTY`
- `MIGRATION_FAILED`
- `BOOTSTRAP_CONTRACT_FAILED`
- `ADMIN_BOOTSTRAP_FAILED`

## Verification window

- UTC start: `2026-07-26T23:33:14.9177072Z`.
- UTC end: `2026-07-26T23:34:20.2865291Z`.
- Elapsed seconds: 65.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live initialization executions: 0.
- Operator secret-input requests: 0.
- Live reset executions: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Project npm operations: 0.
- Interactive bootstrap operations: 0.
- Network operations: 0.
- Real fixed-bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Later-task operations: 0.

## Residual risks

- Real database assertion, migration, bootstrap-contract validation, and administrator creation remain intentionally unexecuted until a separately authorized live initialization.
- The host console's hidden-prompt interaction and operator cancellation behavior remain unobserved in implementation tests because requesting a real operator secret was prohibited.
- Real pinned-PATH command resolution remains dependent on the already validated Task 2 process environment; Task 4 verifies the fixed executable name, arguments, working directory, and inherited-console boundary through injected operations only.
