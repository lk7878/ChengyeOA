# Task 2 Report: Strict CLI parsers and fixed command adapter

## Test evidence

- RED: 62 focused Task 2 tests, 0 passed and 62 failed before implementation because the four required public interfaces and injectable launcher boundary were absent.
- GREEN: 62 focused Task 2 tests passed after the minimal implementation.
- Full verification: 104 passed, 0 failed, 0 skipped. This includes the preserved 42 Task 1 tests and 62 Task 2 tests.

All tests used injected process-result objects. No project command, network, database, production connection, or remote operation was executed.

## Files changed

- `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- `D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.Core.Task2.Tests.ps1`

## Delivered interfaces

- `ConvertFrom-EventCheckSummary`
- `ConvertFrom-EventDrainSummary`
- `Invoke-SafeNativeCommand`
- `Test-PinnedToolchain`

The existing four Task 1 exports remain exported unchanged.

## Command allow list

- `source-check`: fixed source check adapter for `preflight` or `canary` only.
- `portable-check`: fixed portable check adapter for `preflight` only.
- `source-drain`: fixed source drain adapter with no mode only.

Every other command kind or mode is rejected before the injectable process boundary. The adapter captures child output internally and returns only stable safe fields and alert codes; standard error and formatter text are never returned.

## Exit mappings

Check: `0` maps to `READY`; `3` to `DEGRADED`; `4` to `BLOCKED`; `2` to `CONFIG_INVALID`; `5` to `MIGRATION_OR_DATABASE_UNAVAILABLE`; `70` to `UNCLASSIFIED_FAILURE`; any other exit maps to `COMMAND_EXIT_UNRECOGNIZED` and `BLOCKED`.

Drain: `0` maps to `complete`; `4` to `manual_attention_required`; `2` to `CONFIG_INVALID`; `5` to `MIGRATION_OR_DATABASE_UNAVAILABLE`; `70` to `UNCLASSIFIED_FAILURE`; any other exit maps to `COMMAND_EXIT_UNRECOGNIZED` and `BLOCKED`.

## Self-review

- Strict parsers reject multiline, prefix, duplicate, extra, missing, number, mode, status, UTC, and alert-code mutations.
- Tests cover every required field shape, all exit mappings, unrecognized commands and modes, formatter-record validation, raw-error non-propagation, and exact toolchain-version line handling.
- Toolchain gate returns only `Status`, `NodeVersionOk`, `NpmVersionOk`, and `AlertCodes`; observed tool output is not returned.
- Focused and full Pester runs passed without running an actual native project command.

## Concerns

None identified within Task 2 scope.

## Fix round 1/5 evidence: C1, I1, M1

### TDD evidence

- Targeted RED: 88 focused Task 2 tests, 60 passed and 28 failed before the fix. The failures covered terminal line endings, source-command envelope suppression, and deterministic handling of non-success exits before formatter validation.
- Targeted GREEN: 88 focused Task 2 tests passed after the minimal corrections.
- Full verification: 130 passed, 0 failed, 0 skipped. This includes the preserved 42 Task 1 tests and 88 Task 2 tests.

All tests continued to use injected process results only. No native project command, network, database, production connection, or remote operation was launched.

### C1 correction

- Source check and drain adapters now use the fixed silent npm invocation, so the command construction suppresses lifecycle-envelope output.
- Both strict parsers accept exactly one formatter record with either no ending, one terminal LF, or one terminal CRLF.
- Internal line endings, multiple records, and surrounding text remain rejected by the same strict record validation.

### I1 correction

- Every non-success exit is converted to its safe status and alert-code result before stdout parsing.
- Empty and malformed injected stdout for each mapped non-success and unrecognized exit is regression-tested for both check and drain adapters.
- Successful exit zero still requires exact formatter parsing. No injected stdout or stderr is returned in safe results.

### M1 correction

- Toolchain tests now record the injected launcher calls and assert exactly two launches, their fixed executable names, exact argument lists, and the supplied working directory, with no extras.
