# Task 3 Fix Round 2 — Group E Brief

## Scope

Fix only I3a and I3b from `task-3-fix1-review.md`. Offline only. Do not modify Core state-machine behavior or helpers. No Git, production connection, real project command, remote mutation, or real production status write.

## TDD sequence

1. Add behavior tests first and prove meaningful RED before wrapper edits.
2. Stop and report safe RED counts.
3. On follow-up, make the smallest wrapper/test corrections and prove focused + full Task 3 GREEN.

## I3a — bootstrap-safe persistence

The wrapper must define an independent bootstrap fallback writer that does not require Core import. It must:

- accept only the constant seven-field sanitized record constructed by the wrapper;
- in production be called only with the hard-coded trusted workspace, exact `.codex-safe`, and fixed status target derived from the wrapper location;
- validate canonical equality plus every physical component from trusted workspace through `.codex-safe`, and reject reparse ancestors/target before creating a temp artifact;
- publish by same-directory temp + atomic first move or atomic replacement; never `AppendAllText`, direct overwrite, copy fallback, or a redirected path;
- preserve the existing status file on partial temp write / failed move / failed replacement and clean temp/backup artifacts;
- if physical validation or persistence fails, emit the single sanitized console record and exit 70 without raw diagnostic; persistence may be absent.

Provide a private in-process injectable operation seam only for behavior tests. It must not be exported or influenced by environment/CLI/production input. Tests must exercise the real wrapper function behavior in controlled TestDrive paths without writing the real production status target.

Correct the old copied-wrapper tests: copied bootstrap failure must not persist beside the copy. It must emit exactly one safe console record, no stderr, exit 70. Controlled unit behavior tests separately establish atomic success/failure and reparse rejection.

## I3b — terminating bootstrap boundary

Within the protected `try`, force `Import-Module` and other bootstrap cmdlet failures to terminate (`-ErrorAction Stop` or a narrowly scoped stop policy) before diagnostics can escape. Add a real child-process fixture whose fake module uses a normally non-terminating `Write-Error` during import. Assert empty stderr, exactly one safe console JSON record, no raw fixture message, and exit 70.

## Files allowed

- `.codex-safe/Invoke-EventCenterProductionRollout.ps1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound2.GroupE.Tests.ps1`
- existing Group B wrapper harness only for fixture corrections/reuse
- report/ledger after GREEN

Do not modify Core or either helper in Group E.

## Acceptance

- meaningful RED before wrapper edits;
- focused GREEN and full Task 3 GREEN;
- wrapper AST errors 0;
- real production status/evidence/control changes 0;
- production connections/project commands/remote mutations 0.
