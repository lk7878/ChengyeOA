# Task 3 Fix Round 1 — Group C Brief

## Scope

Address only independent-review findings I4, I5 (helper-fixture portion), and M2. Preserve Group A and Group B behavior. Do not change rollout commands, state-machine ordering, remote controls, or production configuration.

All work is offline. Do not connect to production, invoke project commands, or make remote mutations. Do not use Git/GitHub. Do not create a false production evidence receipt or checkpoint during tests. Never print paths beyond the already-known workspace paths, configuration values, URLs, credentials, payloads, raw errors, stacks, hosts, PIDs, worker IDs, or lock owners. Report safe counts/statuses only.

## Required TDD sequence

1. Read the Task 3 review I4/I5/M2, current helpers, Core safe-write functions, baseline tests, Group A/B tests, design, and plan.
2. Add focused Group C behavior tests only. Before editing Core/helpers, prove meaningful RED caused by missing physical-boundary and atomic-failure behavior. Record production-file changes=0.
3. Stop and report RED evidence. Do not implement until parent follow-up.
4. On follow-up, implement the smallest fail-closed correction and repair old fixtures that incorrectly treat copied helpers in arbitrary directories as success.
5. Run focused + all existing Task 3 tests and AST parsing. No real production receipt/checkpoint may remain or be altered by tests.

## I4 — exact physical boundary

Both helper entry points must accept execution only when their physically resolved script directory is exactly:

`D:\2_test\16_ChengyeOA\.codex-safe`

Comparison is canonical and case-insensitive on Windows. Reject before any temporary artifact is created when:

- the helper is copied to any other directory;
- the helper directory itself or any ancestor below the trusted workspace boundary is a reparse point;
- the target already exists as a reparse point;
- canonical resolution does not equal the trusted safe directory.

The two only allowed target names remain `production-runner-control.json` and `production-rollout-evidence.json` in that exact physical directory. Do not add a path parameter, environment override, remote toggle, arbitrary JSON input, or configurable command.

Tests must not write a fake VERIFIED receipt or checkpoint into the real `.codex-safe`. If exact-location entry behavior needs a seam, use a narrow in-process/mockable file-operation seam or a no-write validation mode that cannot redirect the production target and defaults to real fail-closed behavior. Do not weaken the helper public input constraints.

## M2 — atomic failure behavior

Behavior-test the shared/internal atomic-write primitive with controlled same-directory temporary targets (not the production receipt/checkpoint paths):

- partial/failed temporary write leaves an existing target unchanged and cleans artifacts;
- failed first move leaves no target and cleans artifacts;
- failed replacement preserves the original target and cleans temporary/backup artifacts;
- successful first write and successful replacement publish the complete new content;
- target reparse point and reparse ancestor are rejected before write.

First publication must be a same-directory atomic move. Replacement must be same-directory atomic replacement; do not fall back to a non-atomic overwrite/copy. All caught failures expose only stable helper alert codes.

## I5 — honest fixtures

Remove or correct the baseline tests that copy helpers to arbitrary directories and expect successful writes. A copied helper must be rejected. New tests must fail against the old implementation for the intended security reason, not because of syntax, missing setup, or sandbox permissions.

## Files allowed

- `.codex-safe/ProductionRolloutRunner.Core.psm1` only if a shared/private physical-validation or atomic-write primitive is needed
- `.codex-safe/Set-ProductionRunnerCheckpoint.ps1`
- `.codex-safe/Set-ProductionRolloutEvidence.ps1`
- Task 3 tests under `.codex-safe/tests/` (new focused Group C file preferred)
- Task 3 report/ledger only after verified GREEN

Do not modify the production wrapper in Group C.

## Acceptance

- Meaningful focused RED before production edits.
- Focused GREEN.
- Existing Task 1–3 tests including Groups A/B/C fresh GREEN.
- AST errors zero and exported Core function count remains exactly nine unless an independently justified private seam is used without expanding the public API.
- No real production evidence/checkpoint created, replaced, or deleted by tests.
- Production connections 0; project commands 0; remote mutations 0.
