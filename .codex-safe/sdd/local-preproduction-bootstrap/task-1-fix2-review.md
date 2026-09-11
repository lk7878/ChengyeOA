# Task 1 Fix Round 2 Independent Review

## Verdicts

- `SPEC_COMPLIANCE`: `PASS`
- `TASK_QUALITY`: `PASS_WITH_MINOR`

## Safe verification evidence

- Fresh consecutive combined runs: 5/5 passed.
- Fresh combined tests: total 250, passed 250, failed 0, skipped 0.
- Fresh Task 1 tests: total 205, passed 205, failed 0, skipped 0.
- Fresh Task 2 tests: total 45, passed 45, failed 0, skipped 0.
- Reported consecutive combined runs reviewed: 6/6 passed, 300/300 tests.
- Docker operations: 0.
- Database operations: 0.
- Project command operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Network operations: 0.
- Real loader operations: 0.
- Real fixed bundle creations: 0.

## Severity counts

- Critical: 0.
- Important: 0.
- Minor: 1.

## Confirmed behavior

- `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:301` uses a bounded two-party readiness barrier before releasing the start gate, preserves exactly one creator and one occupied loser, verifies the winning bytes, and disposes all synchronization objects in `finally`.
- `.codex-safe/LocalPreproduction.Core.psm1:174` derives a session-local named mutex from a normalized path digest without exposing the path in the name or output.
- `.codex-safe/LocalPreproduction.Core.psm1:218` acquires the mutex with a bounded wait, treats an abandoned mutex as owned, rechecks occupation under the lock, and maps acquisition or setup failures to stable safe codes.
- `.codex-safe/LocalPreproduction.Core.psm1:229` repeats containment and reparse validation under the lock, after parent creation, and immediately before atomic create-new.
- `.codex-safe/LocalPreproduction.Core.psm1:271` releases owned mutexes and disposes the mutex in `finally` across success and failure paths.
- `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:420` proves that a prepared same-path writer remains blocked while the matching mutex is held and succeeds after release.
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:370` confirms safe output omits storage paths and forbidden identifiers in the workflow boundary.

## Critical findings

None.

## Important findings

None.

## Minor findings

1. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:420` — The mutex runtime coverage proves blocking and normal release, but it does not directly execute the bounded timeout branch or the abandoned-owner branch. It therefore does not mutation-protect the timeout value, stable timeout mapping, abandoned ownership assignment, exceptional cleanup, or output safety for those two branches. Bounded fix: add isolated runtime cases that hold the matching mutex through the bounded wait and abandon it from a child context; assert the stable safe result, successful subsequent acquisition, cleanup, and absence of mutex or path detail using only safe booleans and counts.

## Review conclusion

Fix round 2 resolves the intermittent synchronized-writer failure and the confirmed pre-create ACL race through path-scoped serialization. Five fresh combined runs provide clean independent flake evidence. The implementation meets the scoped production requirements; only direct mutation-resistant coverage of the rare timeout and abandoned-owner branches remains.
