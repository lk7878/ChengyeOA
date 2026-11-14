# Task 1 Safe Report

UTC: 2026-07-27

## Offline evidence

- RED: injected Task 1 suite completed with `Total=49`, `Passed=0`, `Failed=49`, `Skipped=0` before the classifier existed. Failures were limited to the intended missing classifier contract.
- Focused GREEN: injected Task 1 suite completed with `Total=49`, `Passed=49`, `Failed=0`, `Skipped=0`.
- Malformed-output and leakage cases are included in the focused injected suite and passed with the same safe result; the installed Pester version returned zero selected tests for its name-filter attempt, so no separate filtered total is claimed.
- Full prescribed three-file regression was started in a fresh process and bounded at 120 seconds. It timed out before producing totals; this is a verification concern, not a passing result.

## Static and safety evidence

- PowerShell AST parse errors for Core, classifier, and the three prescribed test files: `0`.
- Classifier `psql` operational sites: `2`; 15000-millisecond timeout occurrences: `2`; exact read-only option occurrences: `2`.
- Direct output writers: `0`; DDL/DML/procedural/COPY tokens in classifier SQL: `0`.
- Protected-file changes were not made. Product runtime, Core, initializer, migration SQL, Compose, Event Center, Worker, and default-volume content were not modified.
- No live Docker, database, Prisma, npm, initializer, migration, reset, bootstrap, network, or operator-input operation was run. Native activity in the passing tests was injected-only.
- Safe records retain only approved bounded data and stable classifications/alerts; captured native output and exceptions are not emitted.

## SHA-256

- `Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`: `5E7AD8ED78BA32A26C74875F4DADDF4AB014F51315E475D025C8B0F60980B6EC`
- `LocalPreproduction.DatabaseStateClassifier.Tests.ps1`: `7AF35E9B56F021772C3675FEFF110B5DA0CC8875632323F1BD5DE042E4D5AB30`
- `LocalPreproduction.Core.psm1`: `0C28DD37192D842DF7E4BC158148552CF300A7CC3CFAAA4BD474EAF28A52C541`
- `local-preproduction.compose.override.yml`: `51B43B3DF081E3C0A5E05785C11621DAB73B38E8A067B8F5277036AB517BE31A`
- `compose.yml`: `370BF292030A25A6F89B4CCC3A59E6269C4739F1935F383F628F3111F51EA0BC`

## Concern

The required combined Core/Workflow/classifier regression did not return a result within its 120-second bound. Task 1 focused injected tests and static checks are complete; no live operation was attempted.
