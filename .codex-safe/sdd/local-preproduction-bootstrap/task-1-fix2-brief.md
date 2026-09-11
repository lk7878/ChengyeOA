# Task 1 fix round 2/5 brief — deterministic synchronized writer test

Fresh Task 2 full-suite repetitions exposed one intermittent Task 1 test failure. Diagnosis evidence: 5 full runs, 4 clean and 1 failed; isolated bounded runs reproduced the failure category `SYNC_OCCUPIED_COUNT`; winner count remained one, but the loser sometimes entered the generic failure branch before byte-preservation was asserted. Task 2 workflow itself had zero failures across all repetitions.

Scope is the synchronized writer runtime test in `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`. Do not change production code unless a deterministic reproduction proves a production defect.

Use systematic debugging and TDD:

1. Add a two-party readiness barrier so both child workers signal ready before the parent releases the existing start gate. All waits must be bounded and cleanup must remain in `finally`.
2. First make a deterministic stress/reproduction test that exposes the missing readiness synchronization without editing production code. Record only safe counts/category.
3. Apply the minimal test-harness synchronization fix.
4. Require focused repeated success and at least five consecutive full Task 1 + Task 2 suite successes.
5. Preserve exactly-one-create, occupied-loser classification, and winning-byte preservation assertions.

Use `apply_patch`. Do not use Git/GitHub, Docker, database, project npm, network, the real loader, or the real fixed bundle. Write `.codex-safe/sdd/local-preproduction-bootstrap/task-1-fix2-report.md` with safe counts, UTC/elapsed, operation counts, and whether production changes were zero.
