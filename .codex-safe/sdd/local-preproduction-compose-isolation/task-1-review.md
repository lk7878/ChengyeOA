# Task 1 Independent Safe Review

## Verdict

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=FAIL`
- `Critical=0`
- `Important=1`
- `Minor=0`
- `FINAL_CLASSIFICATION=FAIL`

Task 2 must not begin until the Important finding is fixed and independently re-reviewed.

## Important finding

### I1 - Compact short identity options bypass the command-tail guard

Locations:

- `.codex-safe/LocalPreproduction.Core.psm1:1193`
- `.codex-safe/LocalPreproduction.Core.psm1:1194`
- `.codex-safe/LocalPreproduction.Core.psm1:1195`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1638`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1643`

The prefix builder rejects split short options and both supported long-option forms, but it accepts compact short options. A directed in-memory probe exercised four compact forms; accepted 4, rejected 0, live operations 0.

Short flag parsers consume a value joined to the short option, with or without `=`. Therefore a command tail can supply a later project option or append another file while still passing the current exact-token checks. This violates the fixed-project and exactly-two-files contract and means the safety boundary is not fail closed against every supported spelling.

The complete rejection matrix must cover:

- `-p VALUE`
- `-pVALUE`
- `-p=VALUE`
- `--project-name VALUE`
- `--project-name=VALUE`
- `-f VALUE`
- `-fVALUE`
- `-f=VALUE`
- `--file VALUE`
- `--file=VALUE`

Add mutation-resistant tests for all ten forms and make every form return only the stable invalid-target classification. Re-run focused and full verification after the bounded fix.

## Confirmed contract evidence

- Fixed target identity: project count 1, ordered file count 2, service count 1, logical-volume count 1.
- The current override is minimal: lines 3, duplicated configuration keys 0.
- Missing fixed file, noncanonical file, and reparse traversal cases fail before metadata in the reviewed tests.
- Native Compose call sites: 6; routed through the centralized prefix: 6; missing prefix: 0.
- Metadata call sites: 2; initializer operational call sites: 4.
- Caller-controlled identity parameters on the initializer: 0.
- Broad destructive patterns: 0.
- Task 2 orchestration order changed early: 0.
- With the checked-in files and fixed call tails, base-only/default-project operational calls: 0; the existing 87-table volume is not selected by the current initializer path.
- Safe-record exposure findings: 0.

## Test evidence

- Focused Task 1: total 6, passed 6, failed 0, skipped 0.
- Fresh full Core and Workflow: total 103, passed 103, failed 0, skipped 0.
- PowerShell AST: files 3, errors 0.
- Directed compact-option probe: forms 4, accepted 4, rejected 0.

### Prior single combined failure

The earlier combined run recorded total 103, passed 102, failed 1 without an assertion label. It was followed, without production or test changes, by two implementation-agent runs at 103/103, one root fresh run at 103/103, and this independent fresh run at 103/103. The focused Task 1 run is also 6/6.

Classification for that historical event: `NOT_REPRODUCED`. It does not create a separate finding because four consecutive full runs now provide fresh zero-failure evidence and no active Task 1 behavior is implicated. The missing compact-option coverage is independently reproducible and is the sole review finding.

## Prohibited-operation counts

- `LIVE_DOCKER=0`
- `LIVE_DATABASE=0`
- `LIVE_INITIALIZER=0`
- `LIVE_BOOTSTRAP=0`
- `PACKAGE_RESOLUTION=0`
- `NETWORK=0`
- `OPERATOR_INPUT=0`
- `GIT=0`
- `GITHUB=0`
- `EXTERNAL_MUTATION=0`

## Safe completion record

- `utcCompleted=2026-07-27T02:25:11.9362197Z`
- `alertCodes={COMPOSE_TAIL_IDENTITY_GUARD_INCOMPLETE}`
- `LIVE_RESOURCE_CHANGES=0`
