# Task 3 Report: Foreground state machine and manual checkpoint protocol

## Test evidence

- Focused RED: 21 total, 1 passed, 20 failed, 0 skipped before the state machine and helper scripts existed.
- Focused GREEN: 21 passed, 0 failed, 0 skipped after the minimal implementation.
- Full Task 1–3 verification: 151 passed, 0 failed, 0 skipped.
- Static verification: all four production PowerShell artifacts parsed with zero AST errors; the Core module exports exactly nine public functions.

The tests used deterministic injected clocks, sleeps, readers, sinks, command summaries, and toolchain results. Helper tests copied the scripts into controlled directories below `.codex-safe\tests`. No real wait, Event Center project command, network request, database access, production connection, remote action, or rollback action was performed.

## Files

- Modified `.codex-safe\ProductionRolloutRunner.Core.psm1`.
- Created `.codex-safe\Invoke-EventCenterProductionRollout.ps1`.
- Created `.codex-safe\Set-ProductionRunnerCheckpoint.ps1`.
- Created `.codex-safe\Set-ProductionRolloutEvidence.ps1`.
- Created `.codex-safe\tests\ProductionRolloutRunner.StateMachine.Tests.ps1`.

## Delivered interface and dependency boundary

- Added `Start-EventCenterProductionRollout([hashtable]$Dependencies) -> int` as the ninth and only new public Core export.
- The fixed dependency contract contains environment reader, UTC clock, sleep, evidence reader, checkpoint reader, safe status sink, toolchain gate, source check, portable preflight, and source drain delegates.
- The production entry point derives the workspace from its own `.codex-safe` location, reads only the seven fixed environment names, binds the three reviewed Core command adapters, and uses only the three fixed local receipt, checkpoint, and status targets.
- The state machine remains foreground through its injected wait delegate. Its production status sink appends the same compact safe JSON record that it writes directly to the console without contaminating the integer return pipeline.

## State paths

- READY: `ENV_GATE -> TOOLCHAIN_GATE -> EVIDENCE_GATE -> PREFLIGHT_SOURCE -> PREFLIGHT_PORTABLE -> WAITING_GOVERNANCE_ACTION -> DRAIN_FIRST -> DRAIN_SECOND -> PREFLIGHT_AFTER_DRAIN -> WAITING_SINGLE_WORKER_ENABLE -> CANARY_STARTED -> CANARY -> CANARY_GOVERNANCE_COMPLETED -> READY`.
- Evidence retry: missing or invalid evidence enters `WAITING_EVIDENCE`, uses only the injected sleep, and performs no project command before a valid fresh receipt is read.
- Initial mismatch: exact source and portable safe snapshot fields disagree, so `PREFLIGHT_SNAPSHOT_MISMATCH` is recorded and the manual rollback protocol begins.
- Drain safety: the first drain must be complete; the second must be complete with zero claims. Either failure begins the manual rollback protocol.
- Post-drain safety: a non-READY source preflight begins the manual rollback protocol.
- Canary observation: source mode `canary` is used; the governance checkpoint must be fresh, strictly increasing, and issued inside the observed canary start/end UTC interval.
- DEGRADED: `EXTENDED_OBSERVATION_REQUIRED` is recorded and the runner exits without rollback execution.
- BLOCKED: `ROLLBACK_REQUIRED` is recorded; only a valid later `ROLLBACK_CONFIRMED` is consumed, source preflight is rerun, `ROLLED_BACK` is recorded, and no external rollback is performed by the runner.

## Checkpoint and evidence protocol

- Checkpoints accept only the exact four case-sensitive fields and four enumerated commands.
- Schema version is integral one; sequence is positive and strictly greater than the last consumed sequence; issuance UTC is neither future nor older than 30 minutes.
- Replayed, stale, wrong-command, and out-of-canary-window checkpoints are ignored without persisting their contents.
- The checkpoint helper uses a ValidateSet command and positive sequence and writes only the exact schema.
- The evidence helper accepts no free-form input and writes only schema version, five exact `VERIFIED` conclusions, and current UTC.
- Both helpers use same-directory temporary files, first-write move, existing-target replacement, and cleanup.

## Exit mappings

- `0`: READY.
- `2`: dependency contract, environment, toolchain, or other classified configuration/input failure.
- `3`: DEGRADED with extended observation required.
- `4`: BLOCKED safety path after the manual rollback confirmation protocol.
- `5`: classified dependency or database unavailability.
- `70`: unclassified safe failure.

## Self-review

- The eight Task 1/2 exports remain present and unchanged; only the requested ninth export was added.
- Snapshot agreement compares only status and the seven required safe counts; age counters and evaluation UTC are intentionally excluded.
- Tests cover ordered READY, zero-call gates, evidence wait, snapshot agreement/mismatch, both drain rules, post-drain safety, checkpoint freshness/replay/order, canary time binding, DEGRADED, BLOCKED rollback confirmation, and fixed exits.
- State records contain only allow-listed phase, status, bounded counts, alert codes, UTC boundaries, and elapsed seconds.
- Rejected receipt/checkpoint content, child output, raw errors, stacks, configuration values, and process or worker identity data are not persisted or returned.
- No remote Worker toggle, governance CLI, rollback API, or external coordination mechanism was added.

## Concerns

### Group A fix-round-1 RED

- Focused state-machine regression suite: total 3, passed 0, failed 3.
- The three failures are the C1 rollback-confirmation issuance boundary, C2 blocked-canary rollback branch, and I2 fail-closed terminal rollback status.
- Production files changed during this RED phase: 0.

### Group A fix-round-1 resolution

- Root-cause resolution: `C2_FIXTURE_PREISSUED_CONFIRMATION`; the baseline fixture now supplies rollback confirmation after the rollback-required transition.
- Focused Group A suite: total 3, passed 3, failed 0.
- Baseline plus focused suites: total 24, passed 24, failed 0.
- Production files changed during this compatibility step: 0.

### Group B fix-round-1 resolution

- Focused RED: total 17, passed 3, failed 14; production-file changes before implementation: 0.
- I1: adapter-originated safe failures now carry an explicit fixed `ExitCode` of `2`, `5`, or `70`; the source, portable, drain, post-drain, and canary state branches return that classification without entering manual rollback. Unclassified protocol `BLOCKED` remains rollback exit `4`, and `DEGRADED` canary remains exit `3`.
- I3/M1: the wrapper now catches bootstrap failures across module import, dependency construction, and state-machine invocation; it appends and emits the same seven-field safe `BOOTSTRAP_FAILURE` JSON record and exits `70`, without propagating diagnostics.
- Focused Group B suite: total 17, passed 17, failed 0.
- Fresh Task 3 baseline plus Group A plus Group B: total 41, passed 41, failed 0.
- AST parse errors for the changed Core, wrapper, and Group B test files: 0.
- Tests used isolated in-memory adapters and a local wrapper harness only; production connections and project commands: 0.

None identified within the reviewed Task 3 scope.
