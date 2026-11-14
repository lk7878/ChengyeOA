# Task 3 Fix Round 2 — Group F Brief

## Scope

Fix only I4/I5 from `task-3-fix1-review.md`. Offline only. Do not modify Core state-machine or wrapper. No Git, production connection, real project command, remote mutation, or real production helper execution.

## TDD sequence

1. Add/correct behavior tests first and prove meaningful RED before helper edits.
2. Stop and report safe RED counts.
3. On follow-up, make the smallest helper/test corrections and prove focused + full Task 1–3 GREEN.

## Required behavior

Each helper must perform a self-contained physical-boundary validation using only built-in .NET/PowerShell primitives before `Import-Module`, dot-sourcing, or executing any adjacent file. It must validate:

- actual script directory canonical equality to the fixed trusted `.codex-safe`;
- the fixed trusted workspace component and `.codex-safe` component exist as real directories and are not reparse points;
- the fixed target is exactly the allowed filename below that safe directory;
- an existing target is not a reparse point;
- invalid/missing/unresolvable components reject with `SAFE_STATUS_PATH_INVALID` before any temporary artifact or adjacent code execution.

No path/environment override, remote toggle, arbitrary JSON, or configurable command may be added. After this pre-import validation, the existing private Core atomic primitive may be imported and used normally.

## Honest reparse tests

Replace the false-green copied-location reparse cases with direct behavior tests of the real self-contained validator extracted/invoked in process or an equivalent non-exported, non-redirectable no-write validation seam. Controlled TestDrive fixtures must prove:

- trusted workspace directory reparse rejects;
- `.codex-safe` directory reparse rejects;
- existing target reparse rejects;
- ordinary physical controlled tree passes validation without writing a receipt/checkpoint.

Also create a copied-helper fixture with an adjacent fake Core that would create a marker if imported. Assert the helper rejects copied location and the marker remains absent, proving no adjacent code runs before validation.

Do not execute either real helper path or write real production evidence/control.

## Files allowed

- `.codex-safe/Set-ProductionRunnerCheckpoint.ps1`
- `.codex-safe/Set-ProductionRolloutEvidence.ps1`
- `.codex-safe/tests/ProductionRolloutRunner.StateMachine.FixRound2.GroupF.Tests.ps1`
- existing Group C/baseline tests only for honest fixture replacement/reuse
- report/ledger after GREEN

Do not modify Core or wrapper in Group F.

## Acceptance

- meaningful RED before helper edits;
- focused GREEN and full Task 1–3 GREEN;
- helper AST errors 0, Core exports 9;
- real status/evidence/control changes 0;
- production connections/project commands/remote mutations 0.
