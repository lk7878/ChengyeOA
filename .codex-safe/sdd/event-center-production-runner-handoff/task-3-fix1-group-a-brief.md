# Task 3 Fix Round 1 — Group A Brief

Scope is only review findings C1, C2, and I2. Do not address any other finding in this subtask.

## Files

- Modify `D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.StateMachine.FixRound1.Tests.ps1`
- Modify `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- Append report evidence to `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-3-report.md`

## Required behavior tests

Replace the unconditional scaffold with concrete Pester tests using the existing dependency-injected state-machine test patterns.

1. `C1`: pre-issued `ROLLBACK_CONFIRMED` must not be accepted. Arrange a rollback-required path where checkpoint sequence is greater but issued UTC is before the `ROLLBACK_REQUIRED` record. The reader then supplies a second confirmation issued after the request. Assert the state machine waits past the pre-issued confirmation and consumes only the post-request confirmation.
2. `C2`: a canary safe result with status BLOCKED must write `ROLLBACK_REQUIRED` and enter rollback confirmation without requesting `CANARY_GOVERNANCE_COMPLETED`. Make any governance-checkpoint request fail the test.
3. `I2`: after valid rollback confirmation, if the post-rollback source preflight is not READY, the terminal `ROLLED_BACK` record remains fail-closed and is not READY.

## Minimal implementation requirements

- Capture the UTC of the `ROLLBACK_REQUIRED` transition and pass it as the minimum issuance time when waiting for rollback confirmation, in addition to sequence monotonicity.
- Immediately branch on canary BLOCKED or DEGRADED after recording canary result. BLOCKED enters rollback protocol; DEGRADED records extended observation and returns 3. Only READY waits for a time-bound canary governance checkpoint.
- Derive the terminal rollback status from the post-rollback preflight. A non-ready verification must never emit terminal READY.

## TDD and safety

- First run the focused file against unchanged production code and record meaningful RED counts.
- Then make minimal production changes and obtain focused GREEN.
- Run the baseline state-machine test plus focused file; do not run real project commands or wait.
- Preserve exactly 9 public exports.
- No Git/GitHub, network, database, production connection, remote operation, actual URL, configuration value, credential, business-sensitive content, raw error, stack, host, PID, workerId, or lockedBy.
- Use apply_patch.

Final response: `DONE|BLOCKED`, RED total/pass/fail, GREEN total/pass/fail, changed production file count, report path.
