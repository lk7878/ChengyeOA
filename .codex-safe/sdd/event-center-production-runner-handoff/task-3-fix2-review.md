# Task 3 Fix Round 2 Independent Review

## Verdicts

- `SPEC_COMPLIANCE: FAIL`
- `TASK_QUALITY: FAIL`

Finding counts: Critical 1, Important 3, Minor 0.

This was a full-file, local-only review of the design, implementation plan, original Task 3 review, fix-round-1 review, Group D/E/F briefs, current Core/wrapper/helpers, all twelve current runner test files, and the progress ledger. No Git command, production connection, project command, helper/wrapper execution, or remote mutation was performed. The supplied fresh evidence of 200/200 tests, zero AST errors across sixteen files, nine Core exports, zero runtime targets, and zero production-side activity is treated as supplied evidence.

## Critical finding

### C1 remains open: rollback acceptance is not bound to the timestamp actually recorded for `ROLLBACK_REQUIRED`

`ProductionRolloutRunner.Core.psm1:757-759` reads the lower-bound clock once, then `Write-RunnerTransition` reads the clock again to create the persisted transition. The checkpoint validator uses the first value, not the UTC written in the `ROLLBACK_REQUIRED` record. A higher-sequence confirmation issued in the gap can therefore satisfy the validator while predating the recorded request. Group A keeps the injected clock unchanged across both reads, so its pre-issued-confirmation regression cannot expose the split timestamp.

Required correction: obtain one UTC value, pass it as both transition timestamps, and use that exact same value as the checkpoint lower bound. Add a clock-advancing regression whose checkpoint lies between the two formerly separate reads.

## Important findings

### I1 regressed for a classified failure on the second drain

At `ProductionRolloutRunner.Core.psm1:851-855`, the state machine reads `secondDrain.Claimed` before calling `Get-RunnerClassifiedExitCode`. A production adapter result for classified exits 2 or 5 intentionally contains no drain counts, so strict-mode property access diverts both to the generic exit 70 instead of preserving their classifications. Group B covers only the first-drain classified result; it has no second-drain case.

Required correction: inspect and return a classified exit before reading `Claimed`, then add second-drain cases for 2, 5, and 70.

### I3a is only partially closed: bootstrap success replaces, rather than appends to, the JSONL history

The wrapper's private bootstrap writer correctly validates the constant seven-field record, exact canonical/physical workspace, `.codex-safe` directory and fixed target; it rejects reparse components, uses a same-directory temporary file, performs atomic first publication or replacement, cleans artifacts on failure, and falls back to one sanitized console record when persistence is unavailable.

However, `Invoke-EventCenterProductionRollout.ps1:81-110` writes only the new bootstrap line into the temporary file and atomically replaces an existing `production-runner-status.jsonl`. It never reads and carries forward existing safe lines. A successful bootstrap failure therefore destroys the prior runner status history, contrary to the design's append-only status rule. Group E's replacement test explicitly expects the original content to disappear, so the 200/200 result codifies rather than detects this defect.

Required correction: after validating the existing target, construct safe existing-content-plus-new-line in memory and atomically replace with the complete JSONL content; validate existing lines before preserving them. Test that two prior safe records remain byte-for-byte represented in order and the bootstrap record is appended.

### C3 abnormal-clock handling exits safely but leaves no persisted BLOCKED outcome

The ordinary short-window branch at `ProductionRolloutRunner.Core.psm1:868-886` correctly changes a READY canary under fifteen minutes to `BLOCKED`, avoids the canary-governance checkpoint, and enters rollback. Exact fifteen minutes remains covered by the baseline ready path.

For a negative or non-UTC end clock, creation of the `CANARY` status record fails at the safe-record time validation and the outer catch returns 70. The last persisted transition is therefore `CANARY_STARTED` with status `READY`; no safe failure transition explains that execution stopped. Group D asserts only exit 70 and absence of later phases, so it does not detect the misleading terminal status file.

Required correction: sanitize clock anomalies into a valid current-UTC `CANARY`/`BLOCKED` transition with a stable alert code before returning 70, without entering canary governance. Add assertions on the final persisted phase and status for both anomaly cases.

## Closure and regression table

| Finding | Result | Evidence-based assessment |
|---|---|---|
| C3 | PARTIAL | Normal `<15m` READY is closed; negative/non-UTC clocks leave `CANARY_STARTED/READY` as the last record. |
| I3a | PARTIAL | Exact physical path, atomic publication, preservation on failure, cleanup, and console-only copied-path behavior are closed; successful replacement discards prior JSONL lines. |
| I3b | CLOSED | Local terminating policy plus explicit terminating import is exercised by the normally non-terminating import fixture; one sanitized console record and no diagnostic passthrough are asserted. |
| I4 | CLOSED | Both helpers run a self-contained built-in validator before Core import and before artifact creation. |
| I5 | CLOSED | Group F extracts the actual validator and reaches workspace, safe-directory, and target reparse branches; copied helpers also prove adjacent Core is not executed first. |
| M1 | CLOSED | The isolated real-wrapper harness observes source preflight/canary, portable preflight, drain mode, and the same derived workspace root. |
| C1 | OPEN | Two different clock reads still separate the accepted lower bound from the recorded rollback request UTC. |
| C2 | CLOSED | BLOCKED canary enters rollback before canary governance. |
| I1 | REGRESSED | Source, portable, first drain, post-drain, and canary classifications are preserved; second-drain 2/5 collapse to 70. |
| I2 | CLOSED | Non-ready post-rollback verification keeps `ROLLED_BACK` blocked. |
| M2 | CLOSED | Core and wrapper atomic seams cover partial write, first publication failure, replacement failure, target preservation, and cleanup. |

## Safety assessment

- No new Worker control, governance command, rollback API, production connection, project command, or remote mutation path was found.
- Core status construction remains limited to the seven allowed fields and safe counts/codes.
- Helper validators are genuinely pre-import and the new reparse tests reach the intended branches.
- The supplied green evidence is internally consistent, but it does not close the four findings above because the affected assertions are absent or encode the wrong persistence behavior.
