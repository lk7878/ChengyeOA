# Local Preproduction Migrated Retry Task 2 Review Package

status: READY_FOR_INDEPENDENT_REVIEW
utcPrepared: 2026-07-27T07:16:25.4815280Z

## Inputs

- Approved design: `docs/superpowers/specs/2026-07-27-local-preproduction-migrated-retry-design.md`
- Approved plan: `docs/superpowers/plans/2026-07-27-local-preproduction-migrated-retry.md`
- Original blocked review: `.codex-safe/sdd/local-preproduction-migration-order/task-2-review.md`
- Task brief: `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-brief.md`
- Implementer report: `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-report.md`
- Initializer: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Workflow tests: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- Core tests: `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`
- Accepted isolation review: `.codex-safe/sdd/local-preproduction-compose-isolation/task-3-fix1-review.md`

## Controller verification

- hostPolicyBlockedRuns: 1
- commandWrapperParseFailures: 1
- authoritativeFreshFullRuns: 1
- authoritativeFreshFullTotal: 116
- authoritativeFreshFullPassed: 116
- authoritativeFreshFullFailed: 0
- authoritativeFreshFullSkipped: 0
- controllerStaticStatus: READY
- astFiles: 4
- astErrors: 0
- resumeOrder: 1
- composeCallSites: 7
- fixedBuilderReferences: 7
- baseOnlyCalls: 0
- scopedDestructiveSites: 1
- freshScopedDestructiveSites: 1
- resumeDestructiveSites: 0
- assertCommands: 2
- assertTimeoutMatches: 2
- deployCommands: 1
- deployTimeoutMatches: 1
- contractCommands: 1
- contractTimeoutMatches: 1
- hiddenArgumentLists: 2
- redirectedStreams: 0
- forbiddenOutputWriters: 0
- persistentEnvironmentSetters: 0
- remoteWorkerToggles: 0
- retryCountInitializers: 1
- retryCountSets: 1
- unsafeMappings: 1

## Historical transient evidence

- implementerFullRun1Total: 116
- implementerFullRun1Passed: 115
- implementerFullRun1Failed: 1
- implementerFullRun1Skipped: 0
- classification: TRANSIENT_TEST_FAILURE_NOT_REPRODUCED
- rootCauseEstablished: 0
- implementerSubsequentFreshFull: 116/116
- controllerFreshFull: 116/116

The transient failure remains disclosed and must not be rewritten as a passing run.

## Review requirements

- Determine whether `ORIGINAL_IMPORTANT_FINDING=ADDRESSED`.
- Verify accepted resume performs pre-assert → ready state → deploy → migrated state → post-assert, with destructive calls `0`.
- Verify state-carrying second invocations after assertion launch failure, contract failure, and empty bootstrap failure can resume.
- Verify incomplete schema, governed rows, assertion failure with rows, and bootstrap failure with rows block before migration and preserve state.
- Verify resume deploy and post-assert fail-stop call counts.
- Verify fresh zero-table path still performs exactly one scoped reset and a second health gate.
- Verify default volume exclusion, safe output, hidden input, native containment, exact toolchain assumptions, production mode, and Worker-disabled boundary remain intact.
- Review the disclosed transient evidence explicitly.
- Do not rerun the full suite; the controller supplied a fresh 116/116 run. Focused offline tests are permitted only if needed for an unresolved review question.

## Prohibitions

- No Git/GitHub commands.
- No live Docker, database, migration, initializer, bootstrap, package-manager, network, or operator-input operations.
- Do not modify product or test files.
- Do not output URLs, credentials, payloads, raw database errors, stacks, host, PID, worker identity, or lock-owner details.

## Required report

Write `.codex-safe/sdd/local-preproduction-migrated-retry/task-2-review.md` with:

```text
ORIGINAL_IMPORTANT_FINDING=ADDRESSED|NOT_ADDRESSED
SPEC_COMPLIANCE=PASS|FAIL
TASK_QUALITY=PASS|FAIL
Critical=<count>
Important=<count>
Minor=<count>
LAUNCH_READINESS=READY|BLOCKED
```

Include safe evidence, findings, transient-evidence disposition, UTC, elapsed duration, and prohibited-operation counts.

