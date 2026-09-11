# Local Preproduction Migrated-State Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with independent review before live retry. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a same-version, non-destructive retry path that resumes only when the fixed isolated database proves a complete governed schema and zero governed application rows.

**Architecture:** Preserve the existing zero-table fresh-reset path. Classify a nonzero public-table state as a migrated resume candidate, run the unchanged Prisma empty-row assertion before any migration or reset, and fail closed unless that proof succeeds. An accepted candidate performs zero destructive calls, runs the unchanged idempotent deploy command, repeats the empty-row assertion after deploy, and then uses the existing contract and hidden bootstrap path.

**Tech Stack:** Windows PowerShell 5.1, Pester 3, Docker Compose, PostgreSQL 16, Prisma, Node 22.14.0, npm 10.9.2.

## Global Constraints

- The fixed isolated Compose project and two-file prefix remain mandatory for all Compose operations.
- The existing default volume containing 87 user tables is never targeted.
- A nonzero public-table state performs zero destructive calls unless a separate future recovery is explicitly authorized.
- The migrated retry branch is same-version only and is not an upgrade path.
- Missing or incomplete schema and any governed application row fail closed with `MIGRATED_RETRY_STATE_UNSAFE` before migration.
- The assertion script remains unchanged and continues to treat missing tables as failure.
- `db:deploy`, `db:assert-empty`, and `check:bootstrap` command tokens and timeouts remain unchanged.
- Core native timeout, Job Object containment, termination handling, environment loading, Compose isolation, and hidden-input behavior remain unchanged.
- No Event Center history change or remote Worker toggle is permitted.
- No Git or GitHub command is permitted.
- Safe evidence contains only status, bounded counts, stable alert codes, UTC, and elapsed duration.
- During Tasks 1–2, live Docker, database, migration, initializer, bootstrap, network, package-manager, and operator-input operation counts remain zero.

---

### Task 1: TDD the Migrated-State Resume Branch

**Files:**

- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- Create: `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-report.md`

**Interfaces:**

- Consumes: strict catalog count, fixed isolated target, existing `Invoke-LocalPreproductionNative`, and the unchanged npm commands.
- Adds bounded count: `migratedRetryStateReady` with values only `0` or `1`.
- Adds READY phase: `MIGRATED_RETRY_STATE_READY`.
- Adds BLOCKED code: `MIGRATED_RETRY_STATE_UNSAFE` with phase `MIGRATED_RETRY_STATE`.
- Preserves the fresh path order: zero-table proof → one scoped reset → restart → second health → `DATABASE_READY` → deploy → post-deploy assertion.
- Produces resume path order: nonzero-table classification → pre-resume assertion → `MIGRATED_RETRY_STATE_READY` → deploy → `MIGRATED` → post-deploy assertion → `DATABASE_ASSERT_EMPTY` → contract → hidden bootstrap.

- [ ] **Step 1: Extend the injected fixture with shared database state**

Add this optional parameter to `Invoke-TestResetScenario`:

```powershell
[hashtable]$DatabaseState
```

When omitted, initialize a per-call state:

```powershell
if ($null -eq $DatabaseState) {
    $DatabaseState = @{
        TableCount = $(if ($Scenario -ceq 'CountNonzero') { 2L } else { 0L })
        SchemaComplete = $false
        ApplicationRows = 0L
    }
}
```

Validate the supplied state before invoking the initializer. It must contain exactly `TableCount`, `SchemaComplete`, and `ApplicationRows`; both numeric values must be nonnegative integers and `SchemaComplete` must be Boolean. Invalid test state must make the test helper throw before invoking production code.

For the injected catalog command, return `DatabaseState.TableCount`. After a successful injected `db:deploy`, set `TableCount` to a positive bounded fixture value and `SchemaComplete` to `$true`. For injected `db:assert-empty`, fail when `SchemaComplete` is false or `ApplicationRows` is nonzero. Keep all existing explicit failure and launch-exception scenarios, and distinguish the first and second assertion calls for resume-specific scenarios.

Add these exact scenario names to the fixture `ValidateSet`:

```text
AssertEmptyFailureWithRows
BootstrapFailureWithRows
ResumeDeployFailure
ResumeDeployException
ResumePostAssertFailure
ResumePostAssertException
```

`AssertEmptyFailureWithRows` sets `ApplicationRows` to `1` immediately before returning the first invocation's post-deploy assertion failure. `BootstrapFailureWithRows` sets `ApplicationRows` to `1` immediately before returning the injected bootstrap failure. `ResumePostAssertFailure` and `ResumePostAssertException` affect only the second assertion call in the resume invocation.

- [ ] **Step 2: Write the meaningful RED state-carrying tests**

Create this exact Pester block:

```powershell
Describe 'Local preproduction migrated-state retry' -Tags 'MigratedRetryTask1' {
    # State-carrying tests from this step and Step 3.
}
```

Add shared-state, two-invocation cases. The contract-failure case must follow this structure:

```powershell
$state = @{ TableCount = 0L; SchemaComplete = $false; ApplicationRows = 0L }
$first = Invoke-TestResetScenario -Scenario ContractFailure -DatabaseState $state
$second = Invoke-TestResetScenario -Scenario Ready -DatabaseState $state

@($first.Records | Where-Object { $_.phase -ceq 'MIGRATED' -and $_.status -ceq 'READY' }).Count | Should Be 1
$state.TableCount | Should BeGreaterThan 0
$state.SchemaComplete | Should Be $true
$state.ApplicationRows | Should Be 0

$secondKinds = @($second.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
@($secondKinds | Where-Object { $_ -ceq 'down' }).Count | Should Be 0
@($secondKinds | Where-Object { $_ -ceq 'assert-empty' }).Count | Should Be 2
@($secondKinds | Where-Object { $_ -ceq 'deploy' }).Count | Should Be 1
@($second.Records | Where-Object { $_.phase -ceq 'MIGRATED_RETRY_STATE_READY' -and $_.status -ceq 'READY' }).Count | Should Be 1
$second.Records[-1].phase | Should Be 'ADMIN_BOOTSTRAPPED'
$second.Records[-1].status | Should Be 'READY'
$second.Records[-1].boundedCounts.destructiveAuthorizationCount | Should Be 0
```

Add the same successful second-invocation proof after `AssertEmptyException`, `ContractFailure`, and `BootstrapFailure` when no governed rows remain.

Add fail-closed cases using shared states:

```powershell
@{ TableCount = 2L; SchemaComplete = $false; ApplicationRows = 0L }
@{ TableCount = 2L; SchemaComplete = $true;  ApplicationRows = 1L }
```

Each must end with `MIGRATED_RETRY_STATE_UNSAFE`, with exactly one pre-resume assertion and zero reset, deploy, contract, and bootstrap calls.

Add two-invocation `AssertEmptyFailureWithRows` and `BootstrapFailureWithRows` cases proving the second invocation blocks at `MIGRATED_RETRY_STATE_UNSAFE` and preserves `ApplicationRows = 1`.

- [ ] **Step 3: Write RED resume fail-stop matrices**

Add this matrix for accepted migrated candidates:

```powershell
@(
    @{ Scenario = 'ResumeDeployFailure'; Expected = 'MIGRATION_FAILED'; AssertCalls = 1; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
    @{ Scenario = 'ResumeDeployException'; Expected = 'MIGRATION_FAILED'; AssertCalls = 1; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
    @{ Scenario = 'ResumePostAssertFailure'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 2; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 },
    @{ Scenario = 'ResumePostAssertException'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 2; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 }
)
```

Every fixture starts with:

```powershell
$state = @{ TableCount = 2L; SchemaComplete = $true; ApplicationRows = 0L }
```

Every fixture must prove reset calls `0`, `MIGRATED_RETRY_STATE_READY` records `1`, and no additional output stream contains the injected sensitive marker.

Update the existing `CountNonzero` expectation from `DATABASE_NOT_EMPTY` to `MIGRATED_RETRY_STATE_UNSAFE`, with one assertion call and zero reset/deploy/contract/bootstrap calls. Do not weaken malformed, multiline, signed, whitespace, or failed count cases.

- [ ] **Step 4: Run RED before changing the initializer**

Run:

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1' -TestName 'Local preproduction migrated-state retry' -PassThru -Quiet
```

Expected: failures with stable test classifications showing the production code still stops on nonzero tables before the pre-resume assertion.

Record only bounded RED totals, pass/fail/skip counts, stable classifications, UTC, and elapsed duration.

- [ ] **Step 5: Implement the minimal branch**

Add this count before any record emission:

```powershell
migratedRetryStateReady = 0
```

After parsing the catalog count, replace the unconditional nonzero return with classification:

```powershell
$resumeCandidate = $tableCount -gt 0
$counts.applicationTableCount = $(if ($resumeCandidate) { 1 } else { 0 })
```

Wrap the existing `ISOLATED_DATABASE_EMPTY`, scoped reset, restart, second-health, and `DATABASE_READY` blocks in:

```powershell
if (-not $resumeCandidate) {
    # Existing fresh zero-table path, moved without changing commands or failure mappings.
}
```

Inside the existing project-root `try` block and immediately before `db:deploy`, add:

```powershell
if ($resumeCandidate) {
    $preResumeAssert = Invoke-LocalPreproductionNative `
        -FilePath 'npm.cmd' `
        -Arguments @('run', 'db:assert-empty') `
        -TimeoutMilliseconds 120000 `
        -TestOperation $nativeTestOperation `
        -TestTerminationState $nativeTerminationState
    if (-not $preResumeAssert.Succeeded) {
        return & $newRecord 'BLOCKED' @('MIGRATED_RETRY_STATE_UNSAFE') 'MIGRATED_RETRY_STATE'
    }
    $counts.migratedRetryStateReady = 1
    & $newRecord 'READY' @() 'MIGRATED_RETRY_STATE_READY'
}
```

Keep the existing deploy, `MIGRATED`, post-deploy assertion, contract, hidden bootstrap, and catch/finally blocks unchanged. Do not factor native commands into a new abstraction in this fix.

- [ ] **Step 6: Run focused GREEN and preserved behavior tests**

Run the new retry block, the existing deploy-before-assert block, and the hidden-bootstrap block in separate fresh Pester invocations. Required evidence:

- state-carrying contract and empty-bootstrap retries resume successfully;
- incomplete schema, governed rows, and partial bootstrap rows block without reset or migration;
- four resume fail-stop fixtures match the exact call counts;
- fresh zero-table success order still contains one scoped reset and deploy before post-deploy assertion;
- hidden bootstrap arguments, inherited streams, and safe output remain unchanged;
- live operation counts remain zero.

- [ ] **Step 7: Run complete regression and static scans**

Run Core and Workflow together in one fresh process:

```powershell
Invoke-Pester -Script @(
    '.codex-safe\tests\LocalPreproduction.Core.Tests.ps1',
    '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
) -PassThru -Quiet
```

Required: failures `0`, skips `0`.

Static requirements:

- AST errors `0` across initializer, Core, loader, and Workflow tests;
- Compose operational call sites equal fixed-prefix builder references;
- base-only operational calls `0`;
- scoped destructive sites exactly `1`, located only inside the fresh branch;
- resume branch destructive sites `0`;
- pre-resume and post-deploy assertion commands each match the unchanged `120000` timeout;
- deploy command matches the unchanged `600000` timeout;
- hidden bootstrap argument lists `2`, redirected bootstrap streams `0`;
- persistent environment setters `0`, remote Worker toggles `0`;
- Core, loader, assertion script, Compose override, and hidden-bootstrap block modifications `0`.

- [ ] **Step 8: Record the Task 1 safe report**

Write `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-report.md` with RED/GREEN/full/static counts, the stateful case matrix, protected-file evidence, zero live operations, UTC, and elapsed duration. Do not run Git.

---

### Task 2: Controller Verification and Independent Re-review

**Files:**

- Read: `docs/superpowers/specs/2026-07-27-local-preproduction-migrated-retry-design.md`
- Read: `docs/superpowers/plans/2026-07-27-local-preproduction-migrated-retry.md`
- Read: `.codex-safe/sdd/local-preproduction-migration-order/task-2-review.md`
- Read: `.codex-safe/sdd/local-preproduction-migrated-retry/task-1-report.md`
- Create: `.codex-safe/sdd/local-preproduction-migrated-retry/task-2-review.md`
- Create: `.codex-safe/sdd/local-preproduction-migrated-retry/launch-ready.md`

**Interfaces:**

- Consumes: Task 1 implementation, tests, and the original Important retry-safety finding.
- Produces: `MIGRATED_RETRY_LAUNCH_READY=1` only when the original finding is addressed, both verdicts pass, and Critical/Important counts are zero.

- [ ] **Step 1: Run one fresh controller regression**

Run the complete Core and Workflow suite once in a new process. Record only total/pass/fail/skip, stable alert codes, UTC, and elapsed duration. Any failure or skip keeps launch readiness blocked and triggers systematic investigation before review.

- [ ] **Step 2: Run controller static verification**

Verify the exact fresh and resume branch orders, fixed Compose prefix, one fresh-only destructive site, zero resume destructive sites, unchanged commands/timeouts, unchanged assertion script, unchanged hidden-input block, and zero forbidden-output patterns.

- [ ] **Step 3: Dispatch a fresh independent reviewer**

The reviewer must not be the implementer or the prior reviewer. It must verify:

- the original Important finding is addressed rather than dismissed;
- a successful migration followed by contract failure can non-destructively resume;
- a successful migration followed by bootstrap failure with no governed rows can non-destructively resume;
- partial schema, governed rows, and partial-bootstrap rows fail closed and remain preserved;
- accepted resume executes pre-assert, deploy, post-assert in that order with reset calls `0`;
- migration and post-assert failures stop all forbidden later calls;
- fresh zero-table behavior and default-volume exclusion remain unchanged;
- hidden input, safe output, Core containment, and Worker-disabled boundaries remain unchanged.

Required report fields:

```text
ORIGINAL_IMPORTANT_FINDING=ADDRESSED
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
LAUNCH_READINESS=READY
```

- [ ] **Step 4: Record launch-ready evidence**

Only after the required verdict, write `.codex-safe/sdd/local-preproduction-migrated-retry/launch-ready.md` with `MIGRATED_RETRY_LAUNCH_READY=1`, safe test/static/review counts, `LIVE_MIGRATION_EXECUTED=0`, and zero prohibited operations.

---

### Task 3: Controlled Live Retry

**Files:**

- Read: `.codex-safe/sdd/local-preproduction-migrated-retry/launch-ready.md`
- Create: `.codex-safe/sdd/local-preproduction-migrated-retry/live-report.md`

**Interfaces:**

- Consumes: launch-ready evidence and the operator PowerShell in which the local-preproduction loader is READY.
- Produces: `ADMIN_BOOTSTRAPPED` or one stable `BLOCKED` result while preserving the isolated database on failure.

- [ ] **Step 1: Reconfirm zero-connection environment gates**

Without printing values, require all production variables present, `NODE_ENV=production`, `EVENT_WORKER_ENABLED=false`, Node `v22.14.0`, and npm `10.9.2`. Any failure stops before Docker or database access.

- [ ] **Step 2: Run the initializer once**

Run only:

```powershell
& '.\.codex-safe\Initialize-ChengyeOALocalPreproduction.ps1' `
    -ConfirmEmptyDatabaseReset
```

The currently preserved schema-less isolated state is expected to take the fresh branch and emit:

```text
ISOLATED_BASELINE_READY
ISOLATED_DATABASE_EMPTY
DATABASE_READY
MIGRATED
DATABASE_ASSERT_EMPTY
BOOTSTRAP_CONTRACT_READY
WAITING_OPERATOR_SECRET_INPUT
ADMIN_BOOTSTRAPPED
```

- [ ] **Step 3: Enter the administrator password only at the hidden console prompt**

Never send the password to chat, pass it as an argument, store it in a new file, or expose it in evidence.

- [ ] **Step 4: Stop on any BLOCKED result**

Do not automatically retry. Preserve the isolated database. Any destructive recovery requires a new explicit authorization.

- [ ] **Step 5: Record safe live evidence**

Write `live-report.md` with phases, statuses, bounded counts, stable alert codes, UTC, and elapsed duration only. Do not record URLs, values, payloads, raw errors, stacks, process identities, or lock-owner details.

---

## Plan Self-Review Checklist

- [ ] Every nonzero table state is non-destructive.
- [ ] Complete and empty same-version state can reach authoritative deploy.
- [ ] Partial schema and any governed row fail before migration.
- [ ] Pre-resume and post-deploy assertions are distinct and both fail closed.
- [ ] Fresh zero-table path still has exactly one scoped reset and second health gate.
- [ ] The original Important finding has a state-carrying two-invocation regression.
- [ ] No implementation or live operation occurs before the plan is approved for execution.
- [ ] No Git/GitHub command is present.
