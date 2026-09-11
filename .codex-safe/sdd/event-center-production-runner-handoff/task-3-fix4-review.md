# Task 3 Fix Round 4 Independent Review

## Verdicts

- `SPEC_COMPLIANCE: FAIL`
- `TASK_QUALITY: FAIL`

Finding counts: Critical 0, Important 2, Minor 0.

This was a full-file, local-only review of the design, implementation plan, all four earlier Task 3 reviews, the Group I brief, current Core/wrapper/helpers, all fifteen current runner test files, and the progress ledger. No Git command, production connection, project command, real wrapper/helper execution, or remote mutation was performed. The supplied fresh evidence of 215/215 tests, nine Core exports, zero runtime targets, and zero production-side activity is treated as supplied evidence. The focused Group I file was independently reproduced at 6/6, and AST parsing was independently reproduced with zero findings across nineteen PowerShell files. Additional review probes loaded only extracted wrapper functions or the Core module and used synthetic in-memory values.

## Important findings

### I6 remains open - the duplicate-key scanner can be bypassed by syntax accepted by the downstream converter

`Invoke-EventCenterProductionRollout.ps1:195-205` throws only when the custom scanner both consumes the complete line and reports a duplicate. If the scanner does not recognize the complete line, it returns without failure. `Invoke-EventCenterProductionRollout.ps1:210-212` then passes that same line to the more permissive Windows PowerShell JSON converter.

Those grammars are not equivalent. A controlled extracted-function probe found three scanner/converter mismatch classes that contain duplicate object keys yet pass `Assert-RunnerBootstrapExistingJsonLine`: single-quoted property syntax, unquoted property syntax, and an otherwise standard object preceded by non-standard whitespace. In each case the converter accepts the line, collapses the duplicate before the seven-field check, and the wrapper can republish the ambiguous original line. The existing Group I tests cover standard quoted keys, a Unicode escape, a nested count key, and key-like string content, but none covers the scanner-failure/converter-success boundary.

Required correction: make scanner failure itself fail closed before conversion. Existing history should be accepted only if the strict scanner consumes exactly one complete standards-conforming JSON value and finds no duplicate in any object scope. Add regressions for all three mismatch classes plus unterminated strings, invalid escapes, incomplete Unicode escapes, trailing separators, nested arrays/objects, and same-named keys in distinct object scopes.

### I8 - live evidence and checkpoint files are validated only after duplicate keys are lost

`Invoke-EventCenterProductionRollout.ps1:445-460` reads both live input files with the permissive JSON converter and performs no duplicate-key or strict-grammar check first. `ProductionRolloutRunner.Core.psm1:116-145` and `ProductionRolloutRunner.Core.psm1:685-721` therefore receive already-collapsed objects and cannot enforce an exact source schema.

A controlled in-memory probe confirmed both affected paths: a receipt with a duplicated verification conclusion whose retained value is valid passes the evidence gate, and a checkpoint with a duplicated command whose retained value is the expected command passes checkpoint validation. This is fail-open for ambiguous operator input even though the post-conversion objects have the expected property count.

Required correction: apply strict, duplicate-aware, complete-value parsing to both files before lossy object conversion, then retain the existing exact-name, type, time-window, sequence, and command validation. Add regressions proving ambiguous or non-standard input stays waiting/fail-closed and cannot advance any command stage.

## Fix-round-4 assessment

| Item | Result | Evidence-based assessment |
|---|---|---|
| I6 duplicate history keys | OPEN | Standard duplicate forms, escaped-equivalent quoted keys, object scope, and string-value separation work, but scanner failure is not rejection; permissive-converter mismatch forms bypass the detector. |
| I7 case-sensitive alert codes | CLOSED | Core uses the case-sensitive operator at `Core:53-56`; wrapper history uses it at `wrapper:241-249`; Group I directly rejects lowercase-only codes on both paths. |
| M3 operation reachability | CLOSED | Group E now starts both affected cases with a valid safe JSONL line. The partial-write case asserts its temporary-write marker, and the replacement case asserts its replacement marker; both retain preservation and cleanup assertions. |

## Prior-finding regression closure

| Prior item | Result | Evidence-based assessment |
|---|---|---|
| C1 rollback confirmation binding | CLOSED | One UTC value is persisted for `ROLLBACK_REQUIRED` and reused as the minimum confirmation time; the advancing-clock regression rejects the between-read case. |
| C2 blocked canary ordering | CLOSED | A non-ready canary enters rollback before any canary-governance wait. |
| C3 complete canary window and abnormal clocks | CLOSED | A short READY canary becomes BLOCKED; abnormal end clocks persist a safe CANARY/BLOCKED result and exit safely. |
| I1 classified command exits | CLOSED | Source, portable, first drain, second drain, post-drain, and canary classification ordering remains correct; second drain is classified before count access. |
| I2 post-rollback state | CLOSED | The final rollback status remains BLOCKED when verification is non-ready. |
| I3a bootstrap persistence | PARTIAL | Physical targeting, atomic publication, append order, failure preservation, and cleanup remain correct; strict prior-line acceptance is still incomplete under I6. |
| I3b bootstrap diagnostic containment | CLOSED | The protected terminating boundary and console-only copied-path behavior remain covered. |
| I4 helper physical boundary | CLOSED | Both helpers retain self-contained physical checks before Core import or artifact creation. |
| I5 safety-test reachability | CLOSED | Reparse tests exercise the extracted real validators, and copied-helper tests prove adjacent Core code is not reached first. |
| M1 wrapper bindings | CLOSED | The isolated harness observes the fixed environment-name set, local file bindings, command kinds/modes, derived workspace, foreground completion, and console/status equivalence. |
| M2 helper/Core atomic failure paths | CLOSED | Partial temporary write, failed first publication, failed replacement, preservation, and cleanup remain behavior-covered. |

## Safety and evidence conclusion

- No new remote Worker control, governance command, rollback API, production connection, project command, or remote mutation path was found.
- The custom scanner terminates and behaves correctly for the standard grammar it recognizes: keys are compared ordinally within each object, Unicode escapes are decoded before comparison, arrays recurse into contained objects, separate object scopes remain independent, and strings are not mistaken for properties. Seven additional boundary checks passed, including nested-array duplication, separate scopes, surrogate/control escape equivalence, malformed input rejection by the complete history validator, and controlled depth-256 termination.
- The defect is the fail-open boundary when that scanner does not recognize a line but the subsequent converter does. The same lossy-conversion risk is independently present on live evidence/checkpoint input.
- The supplied 215/215 result and independently reproduced Group I 6/6 do not close either Important finding because the relevant mismatch and live-input duplicate cases are absent.

## Final conclusion

`REJECTED`: both verdicts remain FAIL with Critical 0, Important 2, Minor 0. I7 and M3 are closed; I6 remains open, and I8 is newly identified. Another fix and independent re-review are required.
