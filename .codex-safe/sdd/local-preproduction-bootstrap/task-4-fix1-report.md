# Task 4 Fix Round 1 Safe Checkpoint

## Classification

- Scope: Task 4 independent-review fix round 1, findings C1 and I1 only.
- Final status: READY_FOR_INDEPENDENT_REVIEW.
- `LIVE_INITIALIZATION_EXECUTED=0`
- `OPERATOR_SECRET_INPUT_REQUESTED=0`

## Files changed

- `LayerManage/law-firm-system/apps/server/scripts/system/system-cli.ts`
- `LayerManage/law-firm-system/apps/server/test/system/system-cli.test.ts`
- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `docs/superpowers/plans/2026-07-26-local-preproduction-bootstrap.md`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-4-fix1-report.md`

## C1 strict TDD evidence

- Real system CLI contract RED: total 22, passed 20, failed 2; category `SAFE_INTERACTIVE_MODE_MISSING`.
- Wrapper argument contract RED: total 2, passed 1, failed 1; category `SAFE_BOOTSTRAP_ARGUMENTS_MISSING`.
- Real system CLI focused GREEN: total 22, passed 22, failed 0.
- Wrapper Task 4 focused GREEN: total 2, passed 2, failed 0.
- Bootstrap security-contract integration first run: total 140, passed 139, failed 1; category `STATIC_PASSWORD_SOURCE_FALSE_POSITIVE`.
- Root cause: password-named fixed-label properties and a password variable initializer depending on the mode flag crossed the existing conservative CLI credential-source scanner.
- The implementation was reshaped without weakening or changing the scanner.
- Bootstrap security-contract integration final GREEN: total 140, passed 140, failed 0.

## C1 safe-interaction evidence

- Explicit mode: `--safe-interactive`.
- Package-manager quiet arguments: exactly 1 `--silent` in the inherited-console command.
- Fixed server-package target: exactly 1 `--prefix apps/server` in the inherited-console command.
- Safe bootstrap argument occurrences in production and injected paths: 2 of 2.
- Operator values requested through hidden input in safe mode: 5 of 5.
- Operator values requested through echoing text input in safe mode: 0.
- Fixed safe prompt labels: 5 of 5.
- Database-location output in safe mode: 0.
- Ordinary completion output in safe mode: 0.
- Ordinary error output in safe mode: 0.
- Password-bearing arguments: 0.
- Prompt-stream capture by the wrapper: 0.
- Inherited stdin/stdout/stderr flags retained: 3 of 3.
- Default bootstrap mode compatibility tests: passing.
- Existing CLI credential-source contract: passing without relaxation.
- Wrapper output remains the approved safe state records only.

## I1 strict TDD and debugging evidence

- Repeatable old-bound RED used a 600 ms caller-only delay after initializer return.
- Directed RED runs: 3; passed 0; failed 3; category `OUTER_CALLER_BOUND`.
- The production health budget and fail-closed initializer behavior were not changed.
- The slow-health fixture now sleeps no longer than each supplied remaining native timeout.
- Behavior timing starts at the first health call and stops immediately when the initializer returns.
- Logical sleep-request upper bound: 125 ms.
- Operation-owned health watchdog: 750 ms.
- Outer caller watchdog: 2000 ms and intentionally includes the 600 ms caller-only delay.
- First repeated post-fix matrix: runs 5, passed 4, failed 1; category `HARD_CODED_SECOND_HEALTH_CALL_BOUND`.
- Root cause: a fixed second-call count and absolute 25 ms expectation still depended on scheduler timing.
- Final assertion compares every simulated health duration with its corresponding supplied timeout.
- Final repeated timing GREEN: runs 10, passed 10, failed 0.
- Final combined directed matrix: runs 3, assertions 9, passed 9, failed 0.

## Full verification evidence

- TypeScript no-emit check: passed.
- Fresh Task 1 through Task 4 Pester: total 94, passed 94, failed 0, skipped 0.
- Core suite: total 41, passed 41, failed 0.
- Workflow suite: total 53, passed 53, failed 0.
- PowerShell AST parse: files 3, errors 0.
- Fresh Task 4 all-stream capture: total 2, passed 2, failed 0.
- Non-success stream records: 0.
- Concrete forbidden-output matches: 0.
- Final stable alert codes: none.

## Verification window

- UTC start: `2026-07-27T00:02:14.1679803Z`.
- UTC end: `2026-07-27T00:03:28.5033219Z`.
- Elapsed seconds: 74.

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

- Real package-manager forwarding, terminal rendering, database migration, and administrator creation remain intentionally unexecuted until a separately authorized live initialization.
- The safe-interactive transcript contract is verified with the real CLI orchestration plus injected TTY-safe prompt, migration, and persistence dependencies; no real operator input was requested.
- Windows inherited-console behavior remains represented by the injected boundary contract and static no-redirection scan rather than a live interactive command.
