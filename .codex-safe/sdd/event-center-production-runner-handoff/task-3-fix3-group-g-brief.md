# Task 3 Fix Round 3 — Group G Brief

## Scope

Fix only Core findings C1, I1 second-drain regression, and C3 abnormal-clock persistence from `task-3-fix2-review.md`. Offline only; no Git, production connection, project command, helper/wrapper execution, remote mutation, or runtime file write.

## TDD sequence

1. Add focused behavior tests and prove meaningful RED before Core edits.
2. Stop/report safe RED counts.
3. On follow-up, minimal Core fix; run focused + full tests, AST 0, exports 9.

## Required behavior

- C1: obtain one rollback request UTC; pass it as both `ROLLBACK_REQUIRED` transition start/end and the exact `ROLLBACK_CONFIRMED` minimum issuance time. Test with an injected advancing clock and a confirmation timestamp between the formerly separate reads; it must be rejected before a later confirmation is accepted.
- I1: on the second drain, call the classified-exit check immediately after receiving the result and before any `Claimed` or other count property access. Add second-drain safe adapter results for exits 2, 5, 70 and assert exact exits without rollback.
- C3: negative or non-UTC canary end clocks must create a valid safe `CANARY/BLOCKED` final transition with stable clock alert code and return 70 without canary governance or READY. Use a sanitized valid UTC transition timestamp independent of the anomalous result; never pass invalid/non-UTC ordering into `New-SafeStatusRecord`.

## Files allowed

- `.codex-safe/ProductionRolloutRunner.Core.psm1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound3.GroupG.Tests.ps1`
- Group A/B/D tests only for minimal fixture reuse/correction

Do not modify wrapper/helpers.
