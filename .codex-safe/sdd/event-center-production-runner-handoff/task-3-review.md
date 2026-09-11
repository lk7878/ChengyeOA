# Task 3 Independent Review

## Verdicts

- `SPEC_COMPLIANCE: FAIL`
- `TASK_QUALITY: FAIL`

Finding counts: Critical 2, Important 5, Minor 2.

This review is limited to the Task 3 brief, report, manifest, and all ten packaged snapshots. Per review constraints, tests were not rerun; reported test counts are therefore treated as supplied evidence, not independently reproduced evidence.

## Critical findings

### C1 — rollback confirmation is not bound to the rollback request

`ProductionRolloutRunner.Core.psm1.snapshot:687-692` records `ROLLBACK_REQUIRED` and then waits using only the last consumed sequence. Although the validator supports a minimum issuance time at `648-650`, the rollback call does not provide one. Consequently, a fresh, higher-sequence `ROLLBACK_CONFIRMED` already present before the safety failure can be consumed immediately. This bypasses the required manual confirmation after rollback is requested, including initial-preflight failures where the last sequence is zero. The tests pre-seed rollback confirmations rather than proving post-request issuance (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:256-260`, `268-279`, `338-349`).

Required correction: bind rollback confirmation to the UTC of the recorded `ROLLBACK_REQUIRED` transition as well as to a strictly greater sequence, and add a regression test that rejects a pre-issued confirmation.

### C2 — a BLOCKED canary can wait indefinitely for the governance checkpoint before requesting rollback

`ProductionRolloutRunner.Core.psm1.snapshot:784-794` waits for `CANARY_GOVERNANCE_COMPLETED` for every canary result, and evaluates the BLOCKED branch only afterward. The fail-closed requirement says any BLOCKED/safety failure must record `ROLLBACK_REQUIRED` and enter the rollback-confirmation protocol. A correct operator may not issue a governance-completed checkpoint for a blocked canary, leaving the runner stuck before the safety transition. The blocked-canary test supplies that checkpoint and therefore codifies the unsafe order (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:338-354`).

Required correction: branch on BLOCKED immediately after recording the canary result; reserve the time-bound governance checkpoint for states whose protocol explicitly requires it.

## Important findings

### I1 — production adapter exit classifications are collapsed into rollback exit 4

The adapter converts classified command exits into safe result objects at `ProductionRolloutRunner.Core.psm1.snapshot:456-474`. The state machine then examines only `Status` and sends non-ready source, portable, drain, and canary results into `Complete-RunnerRollback` (`746-775`, `784-795`), which returns 4. Thus configuration/input, dependency/database, and unclassified command outcomes do not preserve the specified exits 2, 5, and 70 on the production adapter path. `Get-RunnerFailureExitCode` at `699-706` is reached only for thrown exception messages, not those normal safe adapter results.

The exit test injects exceptions through the environment delegate (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:357-375`) and does not cover the production-like safe adapter return shape. The report’s exit-mapping claim is therefore broader than the implementation and tests support.

### I2 — rollback verification can be BLOCKED while the terminal record says READY

`ProductionRolloutRunner.Core.psm1.snapshot:692-696` computes and records the post-confirmation source preflight result, but then unconditionally writes `ROLLED_BACK` with status `READY`. If the preflight remains blocked or unavailable, the final status contradicts the immediately preceding safety result and can mislead operators even though the process exits 4.

Required correction: keep the terminal status fail-closed and explicitly test a non-ready post-rollback preflight.

### I3 — the production wrapper has no safe bootstrap failure boundary

`Invoke-EventCenterProductionRollout.ps1.snapshot:9` imports the module and `30-58` constructs dependencies, invokes the runner, and exits without a top-level terminating-error boundary. Bootstrap failures can therefore emit ordinary PowerShell diagnostics rather than the required safe JSON/status record and can leave the intended fixed exit mapping undefined. The Core catch cannot protect failures that occur before `Start-EventCenterProductionRollout` is invoked.

Required correction: add a sanitized top-level failure boundary with a fixed non-success exit and no raw diagnostic output.

### I4 — helper target boundaries are lexical, not physically verified

Both helper snapshots construct targets directly from `PSScriptRoot` and immediately write (`Set-ProductionRunnerCheckpoint.ps1.snapshot:12-29`; `Set-ProductionRolloutEvidence.ps1.snapshot:2-22`). They do not verify that the physical directory is the intended `.codex-safe` directory or reject reparse-point ancestors/targets. The helper tests copy each script to another directory and confirm it writes beside the copy (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:391-440`), so the implementation is location-relative rather than enforcing the stated exact production boundary.

Required correction: verify the resolved physical safe directory and target before creating temporary artifacts, while retaining same-directory atomic replacement.

### I5 — safety-critical tests use fixtures that conceal the protocol defects

Rollback confirmations are queued before the runner records `ROLLBACK_REQUIRED`, and the blocked-canary test queues governance completion before rollback (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:256-279`, `338-349`). This arrangement cannot detect C1 or C2. The exit tests similarly use thrown strings rather than adapter result objects (`357-375`), so they cannot detect I1. The reported green count therefore does not establish the production protocol claimed in the report.

## Minor findings

### M1 — production wrapper bindings and console/status equivalence are not behavior-tested

The packaged state-machine tests call the Core function directly. No packaged test executes or statically inspects `Invoke-EventCenterProductionRollout.ps1.snapshot` to prove the fixed environment-reader set, fixed local paths, foreground invocation, or exact console/status equivalence. These properties are visible in the snapshot but are not protected against regression.

### M2 — helper atomic-failure behavior is not tested

The helper tests cover successful first write, successful replacement, schema, and successful cleanup (`ProductionRolloutRunner.StateMachine.Tests.ps1.snapshot:391-441`). They do not simulate partial temporary writes, failed replacement, failed first move, preservation of an existing target, or reparse-point rejection. Those omissions are material to the helper atomicity and boundary claims, although the happy-path same-directory write pattern itself is present.

## Focus-area assessment

- Environment and toolchain gates occur before evidence waiting and before project commands in the state machine.
- Evidence is required before source/portable/drain/canary commands, and invalid evidence content is not persisted.
- Checkpoint schema, case-sensitive command matching, freshness, non-future time, and replay prevention are implemented; rollback temporal binding is missing.
- Initial source/portable comparison uses only the required status/count fields and excludes age/evaluation fields.
- The two-drain rule and source canary mode are implemented.
- No new worker-toggle, governance, or rollback execution API appears in the runner snapshots.
- Status construction is restricted to the seven declared record fields and selected safe counts/codes; bootstrap diagnostics remain outside that protection.
- The state-machine tests use injected delegates and helper tests use unique controlled directories; no production command path is invoked by the Task 3 tests shown. The tests are isolated from production operations, but their fixtures do not adequately exercise the safety protocol defects above.
