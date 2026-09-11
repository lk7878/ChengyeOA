# Task 2 Brief: Baseline Start, Empty Proof, and Scoped Reset

## Authority

Implement Task 2 only from the approved isolation design and `docs/superpowers/plans/2026-07-27-local-preproduction-compose-isolation.md`.

## Required successful fixture order

1. metadata services
2. metadata volumes
3. isolated baseline `up -d`
4. baseline bounded health
5. fixed empty-table count
6. isolated `down --volumes`
7. isolated `up -d`
8. post-reset bounded health
9. `db:assert-empty`
10. `db:deploy`
11. `check:bootstrap`
12. inherited-console hidden bootstrap

Emit `ISOLATED_BASELINE_READY` only after the first health gate, `ISOLATED_DATABASE_EMPTY` only after an exact zero count, and the existing `DATABASE_READY` only after the second health gate.

## Fail-stop requirements

- Baseline start, either health gate, count execution, reset, restart, and every Task 4 step must stop all later calls on failure.
- Nonzero, missing, multiline, signed, whitespace-polluted, or non-integer count output must produce zero destructive calls.
- Exactly one proven-zero fixture may issue exactly one fixed-prefix `down --volumes`.
- Reuse the existing Job Object, native termination confirmation, monotonic timeout, health retry, and sleep-budget implementation; do not create a weaker duplicate.
- All Compose calls must retain the Task 1 fixed project and two-file prefix.

## TDD and verification

- Establish meaningful RED for ordering and the first start/health gate.
- Implement the minimum orchestration change.
- Run Task 2 focused GREEN, repeated bounded health/timing cases, and the complete suite from the 104-test baseline.
- Run AST, fixed-prefix, base-only, destructive-call, fixture-leak, and forbidden-output scans.

## Prohibited operations

- No Git/GitHub.
- No live Docker, database, initializer, bootstrap, npm/npx/network, or operator-input operation.
- Do not touch or inspect the existing default volume.
- Do not modify Task 4 command contracts except for their new position after the second health gate.

## Completion artifact

Write `.codex-safe/sdd/local-preproduction-compose-isolation/task-2-report.md` with safe counts only. Completion requires focused and full GREEN, zero prohibited operations, and no Critical/Important self-findings.
