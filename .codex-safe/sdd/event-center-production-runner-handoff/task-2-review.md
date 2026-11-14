# Task 2 Independent Review

## Verdicts

- SPEC_COMPLIANCE: FAIL
- TASK_QUALITY: FAIL

## Review boundary

This review used only the Task 2 brief, report, review-package manifest, and packaged snapshots. No Git/GitHub, network, database, production command, native project command, or test run was performed. The review report contains no raw process output or operational identifiers.

The packaged module's Task 1 implementation prefix is unchanged from the previously reviewed Task 1 round-4 snapshot, and the package contains the complete 42-case Task 1 regression set. No Task 1 regression finding was identified by static review.

## Findings

### Critical

#### C1 - The source adapters cannot reliably satisfy their own one-record stdout contract

- Locations: `task-2-review-package/ProductionRolloutRunner.Core.psm1.snapshot:296`, `:465-477`, `:485-500`; `task-2-review-package/ProductionRolloutRunner.Core.Task2.Tests.ps1.snapshot:4-5`, `:127-130`, `:162-165`
- The parser rejects any carriage return or line feed, while both source commands are constructed through `npm run` without suppressing npm's normal lifecycle output. The adapter then sends the complete raw stdout string directly to the strict parser. Thus normal command-envelope text, and even an otherwise single formatter record with a terminal line ending, is rejected as `FORMATTER_OUTPUT_INVALID`.
- The tests inject a pristine formatter record with no line terminator, so they do not exercise the stdout shape produced by the fixed source invocation. Both `source-check` and `source-drain` can therefore fail at their primary runtime purpose despite the reported GREEN result.
- Required correction: construct a source invocation that emits only the formatter payload, then accept exactly one logical record (optionally with one terminal line ending) while continuing to reject additional records or surrounding text. Add injected-only tests for the actual command envelope and terminal-line-ending cases; no real process launch is needed.

### Important

#### I1 - Required exit-code mappings are conditional on a valid formatter record

- Locations: `task-2-review-package/ProductionRolloutRunner.Core.psm1.snapshot:491-514`; `task-2-review-package/ProductionRolloutRunner.Core.Task2.Tests.ps1.snapshot:187-223`
- `Invoke-SafeNativeCommand` parses stdout before consulting the exit-code map. If a recognized failure exit has empty or malformed stdout, the function returns `FORMATTER_OUTPUT_INVALID` instead of the contractually assigned stable alert code. This makes the advertised mappings incomplete for configuration, dependency, unclassified, and unrecognized failures.
- The mapping tests conceal this branch-order defect by supplying a valid success-shaped formatter record for every failure exit.
- Required correction: define and implement explicit precedence between safe exit mapping and formatter validation so every listed exit deterministically produces its required mapping. Add injected tests using absent and malformed stdout for every non-success exit and verify that neither stdout nor stderr is propagated.

### Minor

#### M1 - Toolchain tests do not verify the fixed launch specification

- Locations: `task-2-review-package/ProductionRolloutRunner.Core.Task2.Tests.ps1.snapshot:237-277`; implementation at `task-2-review-package/ProductionRolloutRunner.Core.psm1.snapshot:542-555`
- The toolchain tests distinguish calls only by executable name. They do not assert the exact argument lists, working directory, call count, or absence of additional launches. The current implementation appears correct by inspection, but these required safety properties are not regression-protected.
- Required correction: record every injected launcher call and assert exactly two calls with the expected executable, exact arguments, and exact workspace working directory.

## Positive observations

- The check and drain parsers enforce a case-sensitive exact field set, reject duplicates, and return allow-listed safe properties.
- Parser failures use stable codes without echoing rejected text.
- The adapter does not return raw stderr, and malformed stdout is converted to a stable safe result.
- Unsupported command kinds and modes are rejected before the injected launcher boundary.
- The toolchain result is fail-closed and exposes only the four specified properties without observed version strings.
- Packaged test call sites for Task 2 use the private launcher mock; no test in the package directly invokes the real native launcher.

## Finding counts

- Critical: 1
- Important: 1
- Minor: 1
