# Local Preproduction Compose Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task requires an implementation agent, fresh root verification, and an independent reviewer before live operations.

**Goal:** Move ChengyeOA local preproduction onto a fixed, isolated Compose project and physical volume while preserving the existing default volume and its 87 user tables.

**Architecture:** Reuse the authoritative PostgreSQL Compose definition with a minimal fixed override and a fixed Compose project name. Centralize the Compose argument prefix, non-destructively start the isolated project before proving it empty, and permit the existing scoped volume reset only after the isolated database returns an exact zero-table count.

**Tech Stack:** Windows PowerShell 5.1, Pester 3, Docker Compose, PostgreSQL 16, DPAPI `CurrentUser`, Node 22.14.0, npm 10.9.2.

## Global Constraints

- Never target, stop, reset, remove, rename, or mount the existing default project volume containing 87 user tables.
- Never expose URLs, credentials, command payloads, raw database or Docker errors, stack traces, host data, process identifiers, Worker ownership data, resolved resource names, or executable/secret paths.
- Runtime evidence is limited to safe status, bounded counts, stable alert codes, UTC timestamps, and elapsed duration.
- `NODE_ENV` must equal `production`; `EVENT_WORKER_ENABLED` must equal `false`.
- Node must equal 22.14.0 and npm must equal 10.9.2 at the live gate.
- No Git or GitHub command is permitted.
- No remote Worker toggle or Event Center history modification is permitted.
- During Tasks 1-3, live Docker, database, initializer, bootstrap, network-resolution, and operator-input counts must remain zero.
- The fixed Compose project name is `chengyeoa-local-preproduction`.
- The fixed override path is `.codex-safe/local-preproduction.compose.override.yml`.
- The existing base Compose path remains authoritative.

---

### Task 1: Fixed Isolated Compose Target Contract

**Files:**
- Create: `.codex-safe/local-preproduction.compose.override.yml`
- Modify: `.codex-safe/LocalPreproduction.Core.psm1`
- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-1-brief.md`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-1-report.md`

**Interfaces:**
- Consumes: the canonical workspace and safe native-process boundary already used by `Get-LocalPreproductionComposeTarget`.
- Produces: a target object with fixed `ProjectName`, ordered `ComposeFiles`, `ServiceCount`, and `VolumeCount` fields.
- Produces: `New-LocalPreproductionComposeArguments -Target <object> -CommandArguments <string[]> -> string[]`.
- The initializer may not accept a project name, override path, service name, or volume name from command-line parameters.

- [ ] **Step 1: Write the fixed override**

Create the minimal override with no duplicated environment, port, image, health, or volume configuration:

```yaml
services:
  postgres:
    container_name: chengye-oa-local-preproduction-postgres
```

- [ ] **Step 2: Add RED target-identity tests**

Add Pester cases that use the injected native operation and assert:

```powershell
$target.ProjectName | Should Be 'chengyeoa-local-preproduction'
@($target.ComposeFiles).Count | Should Be 2
$target.ServiceCount | Should Be 1
$target.VolumeCount | Should Be 1
```

The metadata call must have this exact structural prefix before `config --services` or `config --volumes`:

```powershell
@(
  'compose', '-p', 'chengyeoa-local-preproduction',
  '-f', '<canonical-base>',
  '-f', '<canonical-override>'
)
```

Add negative cases for a missing override, a reparse escape, the wrong override, an altered fixed project, extra services, and extra logical volumes. Expected status is `BLOCKED`; stable classification is `COMPOSE_TARGET_INVALID` or the existing physical-boundary alert.

- [ ] **Step 3: Run focused tests and verify RED**

Run the Task 1 target tests only with injected native operations.

Expected: at least one meaningful failure because the current target has no fixed project or override. Expected live operation counts are all zero.

- [ ] **Step 4: Implement the target and centralized prefix**

The target resolver must:

```powershell
$fixedProjectName = 'chengyeoa-local-preproduction'
$fixedOverridePath = Join-Path $PSScriptRoot 'local-preproduction.compose.override.yml'
```

It must canonicalize and physically validate both files, run metadata commands through the fixed prefix, require exactly service `postgres` and logical volume `chengye_postgres_data`, and return no resolved values in safe records.

The prefix builder must return:

```powershell
@(
  'compose', '-p', $Target.ProjectName,
  '-f', $Target.ComposeFiles[0],
  '-f', $Target.ComposeFiles[1]
) + @($CommandArguments)
```

It must reject a null target, a project value other than the fixed constant, a file count other than two, or a command tail containing another `-p`, `--project-name`, or `-f` option.

- [ ] **Step 5: Replace every initializer Compose argument array**

Metadata, baseline start, health, empty-table check, reset, restart, and post-reset health must all use `New-LocalPreproductionComposeArguments`. No base-only Compose call may remain.

- [ ] **Step 6: Run focused GREEN and static scans**

Required evidence:

- focused target tests pass;
- PowerShell AST errors are zero;
- base-only operational Compose calls are zero;
- caller-supplied project/override parameters are zero;
- live Docker/database/initializer/bootstrap/input operations are zero.

- [ ] **Step 7: Independent Task 1 review**

A reviewer who did not implement Task 1 must read the design, plan, override, resolver, initializer call sites, and focused tests. Critical and Important findings must be zero before Task 2 begins.

- [ ] **Step 8: Record the safe checkpoint**

Write only test counts, findings, safe codes, UTC, elapsed duration, and zero live-operation counts. Do not run Git.

---

### Task 2: Baseline Start, Empty Proof, and Scoped Reset

**Files:**
- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-2-brief.md`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-2-report.md`

**Interfaces:**
- Consumes: the fixed target and prefix builder from Task 1.
- Produces this exact operational order on the successful injected fixture:

```text
metadata-services
metadata-volumes
baseline-up
baseline-health
empty-table-count
isolated-down-volumes
isolated-up
post-reset-health
db-assert-empty
db-deploy
bootstrap-contract
hidden-bootstrap
```

- [ ] **Step 1: Add RED sequence tests**

The success fixture must assert the exact call order above. The current implementation is expected to fail because it counts tables before the first start.

Add fail-stop cases at baseline start, baseline health, empty-table command, reset, restart, and post-reset health. Each failure must prove all later calls are zero.

- [ ] **Step 2: Add destructive-guard RED tests**

Add cases with these outcomes:

```powershell
@{ CountOutput = '1'; Expected = 'DATABASE_NOT_EMPTY'; DestructiveCalls = 0 }
@{ CountOutput = ''; Expected = 'DATABASE_EMPTY_CHECK_FAILED'; DestructiveCalls = 0 }
@{ CountOutput = 'not-an-integer'; Expected = 'DATABASE_EMPTY_CHECK_FAILED'; DestructiveCalls = 0 }
@{ CountOutput = '0'; Expected = $null; DestructiveCalls = 1 }
```

Every destructive call must be exactly one `down --volumes` call built from the fixed Task 1 prefix.

- [ ] **Step 3: Run focused tests and verify RED**

Expected: meaningful ordering and baseline-start failures; live-operation counts remain zero.

- [ ] **Step 4: Implement baseline start and first bounded health gate**

After metadata validation and before the table count:

```powershell
$baselineUp = Invoke-LocalPreproductionNative `
  -FilePath 'docker' `
  -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('up', '-d'))
```

Return `DATABASE_START_FAILED` on a non-success result. Use the existing Job Object, monotonic timeout, termination-confirmation, retry, and sleep-budget machinery for the first health gate. Do not introduce a second timeout implementation.

- [ ] **Step 5: Keep the empty proof before deletion**

Run the fixed SQL count only after baseline health. Accept exactly one unsigned integer line. `0` authorizes the single isolated reset; any other result blocks before deletion.

- [ ] **Step 6: Reset and repeat health**

Run exactly one scoped `down --volumes`, then one scoped `up -d`, then the same bounded health helper. Only the second successful health gate emits the existing `DATABASE_READY` state consumed by Task 4.

- [ ] **Step 7: Run focused GREEN and repeated timing tests**

Required evidence:

- success order matches all 12 calls;
- all fail-stop positions pass;
- destructive authorization count is 1 only for zero tables;
- nonzero/malformed cases have destructive count 0;
- baseline and post-reset health timing tests pass repeatedly;
- no fixture process remains;
- live operations remain zero.

- [ ] **Step 8: Independent Task 2 review**

The reviewer must specifically prove that no base-only or default-project destructive command exists and that the existing 87-table default volume is not reachable through any initializer parameter or computed fallback.

- [ ] **Step 9: Record the safe checkpoint**

Write safe counts and verdicts only. Do not run Git.

---

### Task 3: Full Regression and Launch Readiness

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-local-preproduction-bootstrap.md`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-3-report.md`
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-3-review.md`

**Interfaces:**
- Consumes: Tasks 1 and 2 implementation and review evidence.
- Produces: `ISOLATED_INITIALIZER_READY` only when all code, test, toolchain, and zero-live-operation gates pass.

- [ ] **Step 1: Add a non-destructive plan addendum**

Append a dated addendum to the original bootstrap plan. Do not rewrite earlier history. Record that the default project was discovered nonempty, deletion was blocked, and subsequent local-preproduction work uses the fixed isolated Compose project.

- [ ] **Step 2: Run the complete local-preproduction suite**

Run all Task 1 through Task 4 Core and Workflow tests. Expected failures and skips are zero.

- [ ] **Step 3: Run static safety verification**

Required counts:

- PowerShell AST errors: 0;
- Compose operational calls missing the fixed prefix: 0;
- global prune/direct volume-remove calls: 0;
- user/machine environment setters: 0;
- remote Worker toggles: 0;
- forbidden output matches: 0.

- [ ] **Step 4: Re-run the fixed loader gate without Docker**

Verify exact Node/npm, production mode, Worker disabled, required environment presence, one safe record, and zero extra streams. Do not start the initializer.

- [ ] **Step 5: Final independent launch-readiness review**

The reviewer must return:

```text
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
LAUNCH_READINESS=READY
LIVE_ISOLATED_RESOURCES_CREATED=0
```

- [ ] **Step 6: Record the safe checkpoint**

Write `ISOLATED_INITIALIZER_READY` with counts, UTC, and elapsed duration only. Do not run Git.

---

### Task 4: Controlled Live Isolated Initialization

**Files:**
- Create: `.codex-safe/sdd/local-preproduction-compose-isolation/task-4-live-report.md`

**Interfaces:**
- Consumes: Task 3 `ISOLATED_INITIALIZER_READY` evidence.
- Produces: an isolated migrated database and administrator bootstrap result, or a stable `BLOCKED` status with the existing default volume preserved.

- [ ] **Step 1: Reconfirm the operator-shell gates**

In the operator PowerShell, load the DPAPI bundle and require exact production mode, Worker disabled, Node 22.14.0, npm 10.9.2, and loader `READY`. Do not print values.

- [ ] **Step 2: Run the revised initializer once**

Invoke the existing confirmed-reset entry point. Expected safe progression:

```text
ISOLATED_BASELINE_READY
ISOLATED_DATABASE_EMPTY
post-reset DATABASE_READY
MIGRATED
BOOTSTRAP_CONTRACT_READY
WAITING_OPERATOR_SECRET_INPUT
ADMIN_BOOTSTRAPPED
```

The operator enters the administrator password only in the hidden console prompt. It is never passed as an argument or sent to chat.

- [ ] **Step 3: Apply fail-closed handling**

- `READY`: continue to the already approved backup task.
- `BLOCKED`: stop immediately; do not retry or delete any additional volume.
- Any evidence that the default project was targeted: stop immediately and treat as a Critical safety incident.

- [ ] **Step 4: Record live evidence**

Record safe status, bounded counts, alert codes, UTC, and elapsed duration only. Explicitly record that the existing 87-table default volume was not deleted.

---

## Plan Self-Review Checklist

- [ ] Every design requirement maps to a task and test.
- [ ] No placeholder text remains.
- [ ] Target object fields and helper names are consistent across tasks.
- [ ] Only the dedicated isolated project can reach `down --volumes`.
- [ ] No live operation occurs before independent launch-readiness approval.
- [ ] Git/GitHub commands are absent.
