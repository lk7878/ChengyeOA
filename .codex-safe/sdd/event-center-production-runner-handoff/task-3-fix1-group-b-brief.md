# Task 3 Fix Round 1 — Group B Brief

## Scope

Address only independent-review findings I1, I3, and M1. Do not change helper path/atomicity behavior (Group C), Group A behavior, production configuration, or any runbook command.

All work is offline. Do not connect to production, invoke source/portable/drain/canary project commands, or make remote mutations. Do not use Git or GitHub. Never print configuration values, URLs, credentials, payloads, raw errors, stacks, hosts, PIDs, worker IDs, or lock owners. Test/result reporting is limited to safe statuses, counts, alert codes, UTC, and elapsed time.

## Required TDD sequence

1. Inspect the current Core, wrapper, Task 3 tests, review, design, and plan.
2. Add focused behavior tests only. Before any production-file edit, run them and prove meaningful RED caused by the three missing behaviors. Record only safe counts and confirm production-file changes in this phase are zero.
3. Stop and report RED evidence to the parent. Do not implement until explicitly asked in a follow-up.
4. On follow-up, make the smallest implementation/test-fixture corrections that turn those tests GREEN without weakening existing checks.
5. Run focused plus existing Task 3 tests and PowerShell AST parsing. Report only safe counts.

## I1 — preserve classified safe-result exits

Exercise production-like adapter result objects, not thrown strings. For source, portable, drain, and canary stages where applicable, a safe result classified as configuration/input must exit 2, dependency/database must exit 5, and unclassified/internal must exit 70. A genuine protocol `BLOCKED`/safety result must still enter manual rollback and exit 4; `DEGRADED` canary must remain exit 3. The state machine must not collapse classified adapter failures into rollback exit 4.

Use a stable safe result contract (for example an explicit classification/exit property already supplied by the adapter) and assert behavior, not source text. Do not expose underlying diagnostics.

## I3 — sanitized wrapper bootstrap boundary

The production wrapper must handle any terminating failure that occurs before, during, or after Core invocation with a sanitized safe status record/console line and fixed exit 70. It must emit no raw diagnostic or stack. It must not falsely claim READY. Preserve fixed paths, fixed environment-name reads, foreground execution, and the existing Core success/exit behavior.

## M1 — wrapper behavior coverage

Behavior-test the real wrapper through an isolated harness with controlled dependencies and no production operations. Prove:

- it reads exactly the fixed environment names required by the runner and does not enumerate arbitrary environment state;
- it binds only the fixed source root, portable root, safe status, evidence, and checkpoint paths;
- it calls the state machine synchronously/foreground;
- its console JSON line is exactly equivalent to the safe status record it persists for bootstrap failure;
- bootstrap failure exits 70 and contains only the seven allowed safe-record fields plus approved safe counts/codes.

Tests must execute behavior; no grep/source-text assertions. If testability needs a narrow wrapper seam, it must default fail-closed and cannot introduce a production remote toggle or configurable remote command.

## Files allowed

- `.codex-safe/ProductionRolloutRunner.Core.psm1`
- `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- Task 3 test files under `.codex-safe/tests/` (a new focused Group B test file is preferred)
- Task 3 report/ledger only after verified GREEN

Do not modify the evidence/checkpoint helper scripts in Group B.

## Acceptance

- Meaningful focused RED before production edits.
- Focused GREEN.
- Existing Task 3 baseline plus Group A plus Group B fresh GREEN.
- AST parse errors zero for changed PowerShell files.
- No production connections or remote mutations.
- No prohibited data in output or fixtures.
