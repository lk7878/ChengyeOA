# Local Preproduction Migration Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with independent review before live retry.

**Goal:** Deploy the schema on the proven-empty isolated database before running the Prisma application-row emptiness assertion.

**Architecture:** Preserve all isolation, reset, health, timeout, safe-output, and hidden-bootstrap boundaries. Change only the post-`DATABASE_READY` order to deploy, emit `MIGRATED`, assert application rows empty, emit assertion-ready, then continue the existing bootstrap contract and inherited-console bootstrap.

**Tech Stack:** Windows PowerShell 5.1, Pester 3, Docker Compose, PostgreSQL 16, Prisma, Node 22.14.0, npm 10.9.2.

## Global Constraints

- The existing default volume containing 87 user tables is never targeted.
- No Git or GitHub command is permitted.
- No Event Center history change or remote Worker toggle is permitted.
- Safe evidence contains only status, bounded counts, stable alert codes, UTC, and elapsed duration.
- During Tasks 1-2, live Docker, database, migration, initializer, bootstrap, network, and operator-input counts remain zero.
- Do not change the Prisma assertion script to treat missing tables as empty.
- Do not remove the assertion.
- Do not change Core native timeout, Job Object, termination, Compose isolation, or hidden-input behavior.

---

### Task 1: Reorder Migration and Application-Row Assertion

**Files:**
- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- Create: `.codex-safe/sdd/local-preproduction-migration-order/task-1-report.md`

**Interfaces:**
- Consumes: post-reset `DATABASE_READY` from the isolated initializer.
- Produces this exact remaining command order:

```text
db:deploy
MIGRATED
db:assert-empty
DATABASE_ASSERT_EMPTY
check:bootstrap
BOOTSTRAP_CONTRACT_READY
hidden bootstrap
ADMIN_BOOTSTRAPPED
```

- [ ] **Step 1: Write the meaningful RED order test**

Update the successful injected fixture to require the complete command order:

```text
metadata-services
metadata-volumes
baseline-up
baseline-health
empty-table-count
isolated-down-volumes
isolated-up
post-reset-health
db-deploy
db-assert-empty
bootstrap-contract
hidden-bootstrap
```

Run it before production modification. Expected: FAIL because current implementation calls `db-assert-empty` before `db-deploy`.

- [ ] **Step 2: Add RED fail-stop tests**

Add injected cases proving:

```powershell
@{ Failure = 'migration-nonzero'; Expected = 'MIGRATION_FAILED'; AssertCalls = 0; ContractCalls = 0; BootstrapCalls = 0 }
@{ Failure = 'migration-launch';  Expected = 'MIGRATION_FAILED'; AssertCalls = 0; ContractCalls = 0; BootstrapCalls = 0 }
@{ Failure = 'assert-nonzero';    Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 1; ContractCalls = 0; BootstrapCalls = 0 }
@{ Failure = 'assert-launch';     Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 1; ContractCalls = 0; BootstrapCalls = 0 }
```

The assertion-failure cases must prove migration call count is exactly one and `MIGRATED` was emitted before the assertion attempt.

- [ ] **Step 3: Implement the minimal reorder**

Move the existing migration block before the existing application-row assertion block. Preserve each command, timeout, native boundary, stable code, and count update unchanged.

The implementation order must be:

```powershell
$migration = Invoke-LocalPreproductionNative ... @('run', 'db:deploy')
if (-not $migration.Succeeded) {
    return & $newRecord 'BLOCKED' @('MIGRATION_FAILED') 'MIGRATION'
}
$counts.migrationApplied = 1
& $newRecord 'READY' @() 'MIGRATED'

$assertEmpty = Invoke-LocalPreproductionNative ... @('run', 'db:assert-empty')
if (-not $assertEmpty.Succeeded) {
    return & $newRecord 'BLOCKED' @('DATABASE_NOT_EMPTY') 'DATABASE_ASSERT_EMPTY'
}
$counts.databaseEmptyAsserted = 1
& $newRecord 'READY' @() 'DATABASE_ASSERT_EMPTY'
```

Then continue the existing bootstrap-contract block.

- [ ] **Step 4: Run focused GREEN**

Required evidence:

- exact success order passes;
- four new failure cases pass;
- Task 4 hidden-bootstrap focused tests pass;
- migration failure produces zero assertion/contract/bootstrap calls;
- assertion failure produces zero contract/bootstrap calls;
- live operations remain zero.

- [ ] **Step 5: Run complete regression and static scans**

Run the LocalPreproduction Core+Workflow suite from the 110-test baseline. Expected failures/skips: zero.

Static requirements:

- AST errors: 0;
- fixed Compose prefix missing: 0;
- base-only operational calls: 0;
- deploy-before-assert source order: true;
- scoped destructive sites: exactly 1;
- Core/loader/assertion-script modifications: 0.

- [ ] **Step 6: Record safe report**

Write RED/GREEN/full/static counts and zero live operations. Do not run Git.

---

### Task 2: Root Verification and Independent Review

**Files:**
- Create: `.codex-safe/sdd/local-preproduction-migration-order/task-2-review.md`
- Create: `.codex-safe/sdd/local-preproduction-migration-order/launch-ready.md`

**Interfaces:**
- Consumes: Task 1 report and changed initializer/tests.
- Produces: `MIGRATION_ORDER_LAUNCH_READY` only with zero Critical and Important findings.

- [ ] **Step 1: Run fresh root full regression**

Run Core+Workflow once in a fresh process. Record safe counts only.

- [ ] **Step 2: Run root static verification**

Verify exact order, unchanged timeouts, unchanged commands, one scoped destructive site, zero base-only calls, and zero forbidden-output patterns.

- [ ] **Step 3: Independent review**

The reviewer must verify design compliance, fail-stop coverage, retry safety, hidden-input preservation, and that migration is reachable only after the isolated zero-table reset and second health gate.

Required verdict:

```text
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
LAUNCH_READINESS=READY
```

- [ ] **Step 4: Record launch-ready evidence**

Write `MIGRATION_ORDER_LAUNCH_READY` with safe counts and `LIVE_MIGRATION_EXECUTED=0`.

---

### Task 3: Controlled Live Retry

**Files:**
- Create: `.codex-safe/sdd/local-preproduction-migration-order/live-report.md`

**Interfaces:**
- Consumes: Task 2 launch-ready evidence and the existing operator PowerShell with the loader gate ready.
- Produces: `ADMIN_BOOTSTRAPPED` or a stable `BLOCKED` result.

- [ ] **Step 1: Reconfirm loader and environment gates**

Require exact Node/npm, production mode, Worker disabled, and all required variables without printing values.

- [ ] **Step 2: Run the initializer once**

The isolated project may repeat its already approved scoped reset. Expected post-reset progression:

```text
DATABASE_READY
MIGRATED
DATABASE_ASSERT_EMPTY
BOOTSTRAP_CONTRACT_READY
WAITING_OPERATOR_SECRET_INPUT
ADMIN_BOOTSTRAPPED
```

- [ ] **Step 3: Enter the administrator password only in the hidden console prompt**

Never pass it as an argument, save it to a file, or send it to chat.

- [ ] **Step 4: Stop on any BLOCKED result**

Do not automatically retry. Preserve the isolated database for safe investigation and leave the existing default volume untouched.

- [ ] **Step 5: Record live evidence**

Record only safe states, counts, alert codes, UTC, and elapsed duration.

---

## Plan Self-Review Checklist

- [ ] The revised order matches the approved design.
- [ ] Migration failures stop all later calls.
- [ ] Assertion failures stop both bootstrap calls.
- [ ] The assertion script remains unchanged.
- [ ] No live operation occurs before independent review.
- [ ] No Git/GitHub command is present.
