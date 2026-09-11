# Task 3 Fix Round 2 — Group D Brief

## Scope

Fix only review findings C3 and M1. Offline only: no Git, production connection, real project command, remote mutation, or real helper execution. Do not modify helper scripts.

## TDD sequence

1. Add behavior tests first and prove meaningful RED before production-file edits.
2. Stop and report safe RED counts.
3. On parent follow-up, make the smallest implementation/fixture changes and prove focused plus all Task 3 tests GREEN.

## C3 — enforce full canary window

After `CANARY_STARTED`, measure with injected UTC clock. A READY canary may advance to `CANARY_GOVERNANCE_COMPLETED` and terminal READY only when `canaryEndUtc - canaryStartUtc >= 15 minutes`. A shorter READY result is fail-closed, must not request/consume the successful canary-governance checkpoint, and must not reach terminal READY. Record only a safe BLOCKED transition/code and enter the existing manual rollback protocol; exit remains 4 after rollback confirmation. Negative/non-UTC clock behavior remains caught/fail-closed with fixed safe exit.

Add a dependency-injected regression where the canary returns READY immediately/under 15 minutes and prove it cannot reach READY or consume `CANARY_GOVERNANCE_COMPLETED`.

## M1 — observe fixed command bindings

Extend the isolated real-wrapper success harness to behavior-record and assert each call supplied by the wrapper:

- source check: command kind `source-check`, modes `preflight` and the wrapper-capable `canary`, workspace root derived from the wrapper's parent;
- portable preflight: command kind `portable-check`, mode `preflight`, same fixed workspace root;
- drain: command kind `source-drain`, empty mode, same fixed workspace root.

Do not grep wrapper source. Do not actually invoke the command adapter or any executable. Keep fixed environment/evidence/checkpoint/foreground/console assertions.

## Files allowed

- `.codex-safe/ProductionRolloutRunner.Core.psm1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound2.GroupD.Tests.ps1`
- existing Group B test only for the smallest harness observation extension
- report/ledger after GREEN

Do not modify the production wrapper unless a behavior test proves a real binding defect; the current finding is missing coverage, not known wrong binding.

## Acceptance

- meaningful RED before production edits;
- focused GREEN and full Task 3 GREEN;
- AST errors 0, exports 9;
- production connections/project commands/remote mutations 0.
