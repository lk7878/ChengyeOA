# Event Center Production Runner Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed PowerShell runner that inherits production configuration from a newly opened operator shell, executes only existing Event Center commands, and coordinates manual production checkpoints through safe local status files.

**Architecture:** A pure safety module validates gates, evidence receipts, command summaries, and status records. A thin runner owns the fixed state machine and invokes only allow-listed source and portable commands. External production actions remain manual checkpoints because the project has no existing global Worker-control or rollback command and this rollout forbids adding one.

**Tech Stack:** Windows PowerShell, Pester 3, Node.js 22.14.0, npm 10.9.2, existing Event Center TypeScript CLIs.

## Global Constraints

- Do not run any Git or GitHub command.
- Do not connect to production from tests or reviews.
- Do not print or persist any production configuration value or business-sensitive content.
- Status output is limited to phase, status, bounded counts, alert codes, UTC, and elapsed seconds.
- Do not delete, skip, rewrite, or replay production event history.
- Do not add a remote Worker toggle, governance-event CLI, or rollback API.
- All automated production commands must use Node.js `22.14.0` and npm `10.9.2`.
- Production start gate requires all six required configuration names to be non-empty, `NODE_ENV` exactly `production`, and `EVENT_WORKER_ENABLED` exactly `false`.
- Source and portable preflight must agree on status and key snapshot counts before the rollout advances.
- Only READY advances. DEGRADED stops with extended-observation status. BLOCKED stops with rollback-required status.
- The second drain must report `claimed=0`.
- Canary uses the complete 15-minute production window and requires an externally confirmed real governance notification closure.

---

## File Structure

- Create `.codex-safe/ProductionRolloutRunner.Core.psm1`: pure gates, strict parsers, safe record writer, and fixed command adapter.
- Create `.codex-safe/Invoke-EventCenterProductionRollout.ps1`: foreground rollout state machine and manual checkpoint waits.
- Create `.codex-safe/Set-ProductionRunnerCheckpoint.ps1`: atomic writer for non-secret checkpoint acknowledgements.
- Create `.codex-safe/Set-ProductionRolloutEvidence.ps1`: atomic writer for the five operator-verified evidence conclusions.
- Create `.codex-safe/tests/ProductionRolloutRunner.Core.Tests.ps1`: unit tests for gates, receipt validation, parsers, and output policy.
- Create `.codex-safe/tests/ProductionRolloutRunner.StateMachine.Tests.ps1`: dependency-injected state-machine tests with no production connection or real wait.
- Modify `.codex-safe/production-rollout-status.md`: append implementation verification status only.

### Task 1: Pure safety gates and safe status writer

**Files:**
- Create: `.codex-safe/ProductionRolloutRunner.Core.psm1`
- Create: `.codex-safe/tests/ProductionRolloutRunner.Core.Tests.ps1`

**Interfaces:**
- Produces: `Test-ProductionEnvironmentGate([hashtable]$Environment) -> PSCustomObject`
- Produces: `Test-ProductionEvidenceReceipt([pscustomobject]$Receipt, [datetime]$NowUtc, [timespan]$MaxAge) -> PSCustomObject`
- Produces: `New-SafeStatusRecord([string]$Phase, [string]$Status, [hashtable]$BoundedCounts, [string[]]$AlertCodes, [datetime]$UtcStart, [datetime]$UtcEnd) -> ordered hashtable`
- Produces: `Write-SafeStatusRecord([string]$Path, [hashtable]$Record) -> void`

- [ ] **Step 1: Write failing environment-gate tests**

Create Pester cases that pass a synthetic hashtable containing only marker strings and assert:

```powershell
$result = Test-ProductionEnvironmentGate @{
  DATABASE_URL='set'; JWT_SECRET='set'; APP_KEYS='set';
  MFA_ENCRYPTION_KEY_V1='set'; CORS_ALLOWED_ORIGINS='set';
  EVENT_WORKER_ENABLED='false'; NODE_ENV='production'
}
$result.Status | Should Be 'READY'
$result.PresentCount | Should Be 6
```

Add one case per missing required name, one exact-case failure for `NODE_ENV`, and failures for absent, uppercase, or truthy Worker values. Assert the returned object never contains any input value.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
Invoke-Pester .\.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1
```

Expected: failure because the module and exported functions do not exist.

- [ ] **Step 3: Implement the environment gate**

Use this exact required-name list:

```powershell
$script:RequiredProductionNames = @(
  'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS',
  'MFA_ENCRYPTION_KEY_V1', 'CORS_ALLOWED_ORIGINS',
  'EVENT_WORKER_ENABLED'
)
```

Return only `Status`, `PresentCount`, `RequiredCount`, `NodeEnvProduction`, `WorkerDisabled`, and `AlertCodes`. Do not return the environment hashtable or any value from it.

- [ ] **Step 4: Write failing evidence and safe-record tests**

The accepted evidence schema is:

```powershell
[pscustomobject]@{
  schemaVersion = 1
  backup = 'VERIFIED'
  isolatedRestorePoint = 'VERIFIED'
  allWorkersDisabled = 'VERIFIED'
  serverWebSameRelease = 'VERIFIED'
  governanceApproval = 'VERIFIED'
  verifiedAtUtc = '2026-07-25T10:00:00.0000000Z'
}
```

Assert exact property names, exact values, valid UTC, non-future time, and maximum age of 30 minutes. Extra, missing, stale, or malformed fields return BLOCKED without echoing the offending value.

Assert `New-SafeStatusRecord` accepts only these top-level keys: `phase`, `status`, `boundedCounts`, `alertCodes`, `utcStart`, `utcEnd`, `elapsedSeconds`. Counts must be non-negative integers, alert codes must match `^[A-Z0-9_]+$`, and all records containing an address-like scheme or any non-allow-listed key are rejected.

- [ ] **Step 5: Implement evidence validation and atomic safe-record writes**

Write status records as compact JSON Lines. Use a temporary file in the same `.codex-safe` directory, append the new line to the existing safe content in memory, then replace only the exact target. Validate the resolved target remains below `.codex-safe`; do not use globs or recursive file operations.

- [ ] **Step 6: Run Task 1 tests and confirm GREEN**

Run the focused Pester file. Expected: all cases pass, zero failures, and no production command is invoked.

### Task 2: Strict Event Center summary parsers and fixed command adapter

**Files:**
- Modify: `.codex-safe/ProductionRolloutRunner.Core.psm1`
- Modify: `.codex-safe/tests/ProductionRolloutRunner.Core.Tests.ps1`

**Interfaces:**
- Produces: `ConvertFrom-EventCheckSummary([string]$Text, [string]$ExpectedMode) -> PSCustomObject`
- Produces: `ConvertFrom-EventDrainSummary([string]$Text) -> PSCustomObject`
- Produces: `Invoke-SafeNativeCommand([string]$CommandKind, [string]$Mode, [string]$WorkspaceRoot) -> PSCustomObject`
- Produces: `Test-PinnedToolchain([string]$WorkspaceRoot) -> PSCustomObject`

- [ ] **Step 1: Write failing parser tests**

Use one synthetic single-line `Event observability:` record with these exact fields: `mode`, `status`, `undispatched`, `oldestUndispatchedSeconds`, `dueBacklog`, `oldestDueBacklogSeconds`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, `leaseLost15m`, `alertCodes`, `evaluatedAt`.

Use one synthetic single-line `Event drain:` record with these exact fields: `dispatched`, `claimed`, `succeeded`, `retryScheduled`, `manual`, `leaseLost`, `status`.

Assert rejection of multiline text, wrong prefix, duplicate fields, extra fields, missing fields, negative/non-integer counts, invalid UTC, unexpected status, unexpected mode, or invalid alert code characters. Assert rejected results contain only stable alert codes.

- [ ] **Step 2: Run the parser tests and confirm RED**

Run the focused Pester file. Expected: the new parser functions are missing.

- [ ] **Step 3: Implement exact parsers**

Parse without evaluating text. For checks, allow statuses `READY`, `DEGRADED`, `BLOCKED` and modes `preflight`, `canary`. For drain, allow statuses `complete`, `manual_attention_required`. Normalize `alertCodes=none` to an empty array. Preserve only parsed allow-listed fields.

- [ ] **Step 4: Write failing command-adapter tests**

Inject a fake process launcher into the module and assert the adapter creates only these fixed command kinds:

- source check with mode `preflight` or `canary` through pinned Node/npm and the existing `events:check` script;
- portable check with the existing executable and mode `preflight`;
- source drain through pinned Node/npm and the existing `events:drain` script.

Assert any other command kind or mode is rejected before process launch. Assert captured standard error is never included in the result. Exit mappings must be exact: check `0/3/4/2/5/70`; drain `0/4/2/5/70`; any other exit code maps to `COMMAND_EXIT_UNRECOGNIZED` and BLOCKED.

Add toolchain tests that feed captured version strings through the same injected launcher. Only exact `v22.14.0` and `10.9.2` returns READY; a launch failure, extra line, or any mismatch returns `TOOLCHAIN_VERSION_MISMATCH` without reporting the observed string.

- [ ] **Step 5: Implement the fixed command adapter**

Capture output internally, require exactly one successful formatter record for parsed command outcomes, and return only parsed safe fields, mapped status, exit code category, UTC, and elapsed seconds. Never forward raw standard output or standard error.

Implement `Test-PinnedToolchain` with the fixed Node and npm invocations and return only `Status`, `NodeVersionOk`, `NpmVersionOk`, and `AlertCodes`.

- [ ] **Step 6: Run Task 2 tests and confirm GREEN**

Expected: all parser and adapter cases pass with zero external process launches outside the injected fakes.

### Task 3: Foreground state machine and manual checkpoint protocol

**Files:**
- Create: `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- Create: `.codex-safe/Set-ProductionRunnerCheckpoint.ps1`
- Create: `.codex-safe/Set-ProductionRolloutEvidence.ps1`
- Create: `.codex-safe/tests/ProductionRolloutRunner.StateMachine.Tests.ps1`
- Modify: `.codex-safe/ProductionRolloutRunner.Core.psm1`

**Interfaces:**
- Produces: `Start-EventCenterProductionRollout([hashtable]$Dependencies) -> int`
- Produces checkpoint schema: `{ schemaVersion, sequence, command, issuedAtUtc }`
- Accepts checkpoint commands: `GOVERNANCE_COMPLETED`, `SINGLE_WORKER_ENABLED`, `CANARY_GOVERNANCE_COMPLETED`, `ROLLBACK_CONFIRMED`

- [ ] **Step 1: Write failing state-machine tests with injected dependencies**

Create fake dependencies for environment, clock, sleep, evidence reader, checkpoint reader, and command invoker. Cover these exact paths:

1. Missing environment stops before evidence and commands.
2. Missing evidence returns `WAITING_EVIDENCE` and invokes no command.
3. Source READY plus portable READY with identical key counts reaches `WAITING_GOVERNANCE_ACTION`.
4. Source/portable status or key-count mismatch stops with `PREFLIGHT_SNAPSHOT_MISMATCH`.
5. First drain non-complete stops; second drain with claimed nonzero stops.
6. Post-drain preflight not READY stops.
7. No Worker checkpoint prevents canary.
8. Canary requires both a full 15-minute result and the canary governance checkpoint.
9. DEGRADED returns `EXTENDED_OBSERVATION_REQUIRED`.
10. BLOCKED returns `ROLLBACK_REQUIRED` and accepts only the rollback checkpoint next.

- [ ] **Step 2: Run the state-machine tests and confirm RED**

Expected: failure because the state-machine function and scripts do not exist.

- [ ] **Step 3: Implement the fixed state machine**

Compare source and portable preflight on `status`, `undispatched`, `dueBacklog`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, and `leaseLost15m`. Do not require the age counters or evaluation timestamps to be identical.

Advance in this exact order:

```text
ENV_GATE -> TOOLCHAIN_GATE -> EVIDENCE_GATE
-> PREFLIGHT_SOURCE -> PREFLIGHT_PORTABLE
-> WAITING_GOVERNANCE_ACTION
-> DRAIN_FIRST -> DRAIN_SECOND -> PREFLIGHT_AFTER_DRAIN
-> WAITING_SINGLE_WORKER_ENABLE
-> CANARY + WAITING_CANARY_GOVERNANCE_ACTION
-> READY
```

At each transition, append one safe status record. Do not persist command output.

- [ ] **Step 4: Implement atomic evidence and checkpoint writers**

Both helper scripts accept only enumerated status/command parameters, validate UTC and sequence, resolve the exact `.codex-safe` target, write a same-directory temporary file, and atomically replace the target. They never accept arbitrary JSON or script text.

- [ ] **Step 5: Implement the foreground runner entry point**

The entry point resolves the workspace from its own location, imports the module, reads the current process environment by fixed names, and starts the state machine. It remains in the foreground while waiting at checkpoints. Its console output is the same safe record written to the status file.

The operator command is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex-safe\Invoke-EventCenterProductionRollout.ps1
```

- [ ] **Step 6: Run Task 3 tests and confirm GREEN**

Expected: all state paths pass using fake dependencies, no real wait, no project command, no database connection, and no remote action.

### Task 4: Dry-run verification and independent review

**Files:**
- Modify: `.codex-safe/production-rollout-status.md`

**Interfaces:**
- Consumes all runner files and tests from Tasks 1–3.
- Produces a verified local handoff command and safe implementation status.

- [ ] **Step 1: Run the full runner test suite**

```powershell
Invoke-Pester .\.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1, .\.codex-safe\tests\ProductionRolloutRunner.StateMachine.Tests.ps1
```

Expected: zero failures.

- [ ] **Step 2: Run a zero-environment dry run**

Start the runner in a child PowerShell with all seven gate names explicitly removed only from that child. Expected: `BLOCKED`, `ENV_REQUIRED_MISSING`, zero command invocations, zero connections, and zero remote mutations.

- [ ] **Step 3: Scan generated files for output-policy violations**

Scan runner source, test fixtures, and safe status artifacts for actual address schemes, hard-coded credentials, non-allow-listed status keys, and forbidden runtime identity fields. Expected: zero findings.

- [ ] **Step 4: Dispatch independent spec and safety review**

The reviewer reads the design, plan, implementation, and fresh test output. It must explicitly verdict both requirement compliance and safety quality. Any Important or Critical finding enters the subagent fix/re-review loop.

- [ ] **Step 5: Append verified implementation status**

Append only test counts, alert codes, UTC, and elapsed seconds to `.codex-safe/production-rollout-status.md`. Do not claim production rollout readiness; the runner must still pass its real environment and evidence gates when the operator launches it.
