# Task 4 Independent Review

## Verdict

- SPEC_COMPLIANCE: FAIL
- TASK_QUALITY: FAIL
- Final classification: FAIL
- Critical: 1
- Important: 1
- Minor: 0
- LIVE_INITIALIZATION_EXECUTED=0
- OPERATOR_SECRET_INPUT_REQUESTED=0

## Critical findings

### C1 — The real inherited-console bootstrap path violates the global safe-output contract

The initializer correctly invokes the administrator bootstrap with the current console, no secret-bearing argument, and no standard-stream redirection at `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:324` and `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:348`. However, that required inheritance also forwards output from the authoritative command. Its bootstrap path writes prohibited connection-location metadata before requesting operator input at `LayerManage/law-firm-system/apps/server/scripts/system/system-cli.ts:86`, and also writes ordinary non-schema completion text at line 104. This conflicts with the plan's global requirement that output contain only safe phase/status fields, bounded counts, alert codes, UTC timestamps, and elapsed time.

The Task 4 workflow fixture is silent at `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:753`, so the passing injected test at line 1694 proves inherited-stream flags and argument shape but cannot detect the real command's prohibited output. Because Task 4 simultaneously forbids redirecting the interactive standard streams, this is a design-level live gate rather than a wrapper-only test omission. Do not execute live initialization until the authoritative interactive command or the approved plan is changed so hidden input is preserved without emitting prohibited metadata or non-schema output.

## Important findings

### I1 — The retained real-time test remains observably flaky

The one-time 93/94 result is reproducible as a test-quality problem. The focused Task 3 timing pair produced one failure in the first of three runs and then two passes; an immediate isolated run failed again. Both failures were the outer caller wall-clock assertion at `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:2262`. The preceding operation-owned health interval assertion at line 2261 was not the failed assertion. This matches the previously documented scheduler-jitter category and does not indicate a Task 4 ordering defect, but it makes the full verification gate nondeterministic.

Use the operation-owned measurement as the behavioral assertion and keep any outer caller bound as a substantially looser harness watchdog, without changing the production health budget or Task 3 fail-closed behavior.

## Confirmed Task 4 behavior

- Exact successful state sequence: `DATABASE_READY`, `MIGRATED`, `BOOTSTRAP_CONTRACT_READY`, `WAITING_OPERATOR_SECRET_INPUT`, `ADMIN_BOOTSTRAPPED`.
- Exact Task 4 command sequence: empty assertion, migration deployment, bootstrap-contract check, then administrator bootstrap.
- Stable failure codes present and exercised: `DATABASE_NOT_EMPTY`, `MIGRATION_FAILED`, `BOOTSTRAP_CONTRACT_FAILED`, `ADMIN_BOOTSTRAP_FAILED`.
- Failure and launch-exception fixtures stop later Task 4 calls at all 8 exercised positions.
- Waiting records on the successful fixture: 1.
- Administrator READY records before zero exit: 0.
- Direct bootstrap command occurrences: 1.
- Direct bootstrap redirection parameters: 0.
- Secret-bearing bootstrap arguments: 0.
- Inherited console inputs/outputs/errors asserted by the injected seam: 3 of 3.
- Task 3 reset confirmation, exact target, exact zero-table query, scoped reset, health, containment, termination-confirmation, and environment-equality gates remain present.

## Safe verification evidence

- Fresh focused Task 4 suite: total 2, passed 2, failed 0, skipped 0.
- Fresh full Task 1–4 suite: total 94, passed 94, failed 0, skipped 0.
- Directed timing reproduction, first matrix: runs 3, total assertions 15, passed 14, failed 1.
- Directed timing reproduction, isolated retry: attempts 1, failures 1, category `OUTER_CALLER_BOUND`.
- PowerShell AST parse: files 3, errors 0.
- Bootstrap-path prohibited connection-location writes: 1.
- Bootstrap-path ordinary non-schema writes: 2.
- Real initializer invocations: 0.
- Real reset operations: 0.
- Docker operations: 0.
- Database operations: 0.
- Project package-manager operations: 0.
- Interactive bootstrap operations: 0.
- Network operations: 0.
- Operator secret-input requests: 0.

## Gate decision

`BLOCKED`: implementation tests verify Task 4 ordering and fail-stop mechanics, but C1 prevents separately authorized live initialization. I1 should also be corrected before treating a single 94-item run as a deterministic completion gate.
