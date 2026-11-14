# Task 1 report: Pure safety gates and safe status writer

## TDD evidence

RED command:

```powershell
Invoke-Pester -Script '.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1' -PassThru -Quiet
```

RED result: total `28`; passed `0`; failed `28`; expected failure category `FUNCTIONS_MISSING`.

GREEN command:

```powershell
Invoke-Pester -Script '.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1' -PassThru -Quiet
```

Final GREEN result: total `28`; passed `28`; failed `0`.

Final export verification: exported functions exactly match the required four interfaces.

## Files created

- `D:\2_test\16_ChengyeOA\.codex-safe\ProductionRolloutRunner.Core.psm1`
- `D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.Core.Tests.ps1`
- `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-1-report.md`

## Exported functions

- `Test-ProductionEnvironmentGate`
- `Test-ProductionEvidenceReceipt`
- `New-SafeStatusRecord`
- `Write-SafeStatusRecord`

## Coverage and self-review

- Environment gate tests cover the six required names individually, exact `NODE_ENV` case, and non-exact worker-disabled spellings. Outputs are restricted to the required safe summary fields.
- Evidence receipt tests cover exact field set, schema version, verification markers, malformed/non-UTC/future/stale times, and stable alert codes.
- Safe record tests cover allow-listed top-level fields, negative counts, alert-code format, separated-fragment address-like scheme rejection, root-bound path rejection, and two-line compact JSONL append behavior.
- The writer resolves the parent and target paths beneath the fixed safe root, uses literal-path filesystem calls, writes through a same-directory temporary file, and replaces the exact target. No globbing, recursion, network, database, process launch, or production command is used.
- Test fixtures are synthetic and do not include production configuration values. Console verification was restricted to test counts, safe codes, and exported interface names.

## Compatibility notes and concerns

- `PESTER3_CONTAIN_COMPAT` was resolved by using equivalent boolean collection assertions compatible with the installed Pester version.
- `PS_PATH_PARAMETER_COMPAT` was resolved by using .NET path decomposition instead of an unsupported PowerShell parameter combination.
- `PS_FILE_REPLACE_OVERLOAD_COMPAT` was resolved by performing the same-directory exact target replacement with `Move-Item -LiteralPath -Force` after temporary-file creation.
- No outstanding concerns.

## Fix round 1: review findings C1 and I1-I4

### New TDD evidence

Focused RED command:

```powershell
Invoke-Pester -Script '.codex-safe\tests\ProductionRolloutRunner.Core.FixRound1.Tests.ps1' -PassThru -Quiet
```

Focused RED result: total `8`; passed `2`; failed `6`; failure category `REVIEW_FINDINGS`.

Focused GREEN result: total `8`; passed `8`; failed `0`.

Final full-suite command:

```powershell
Invoke-Pester -Script '.codex-safe\tests' -PassThru -Quiet
```

Final full-suite result: total `36`; passed `36`; failed `0`. Final export verification confirms the required four exported functions exactly match.

### Corrections and focused coverage

- C1: the writer now rejects a reparse-point fixed root, every existing component from that root through the target parent, and any existing reparse-point target before filesystem writes. The verified parent is the only parent used for temporary and destination paths.
- I1: existing targets use the documented .NET `System.IO.File.Replace` primitive from a same-directory temporary file. First writes use same-directory `System.IO.File.Move`. I/O failures return only `SAFE_STATUS_WRITE_FAILED`; temporary and backup artifacts are cleaned in `finally`.
- I2: evidence field-set checks now use case-sensitive membership, with a focused case-variant property test.
- I3: schema version accepts supported integral CLR representations whose numeric value is one and rejects non-integral values.
- I4: `ProductionRolloutRunner.Core.FixRound1.Tests.ps1` adds focused tests for reparse-point ancestors, an existing reparse-point target, replacement-failure preservation, and artifact cleanup.

### Historical evidence note

Minor M1 is left unchanged. No historical RED artifact was fabricated. This section records only the newly observed fix-round RED and GREEN evidence.

### Fix-round concerns

- No outstanding concerns for C1 or I1-I4 after the focused and full-suite verification.

## Fix round 2: remaining I4 and NB1

### New TDD evidence

Focused RED command:

```powershell
Invoke-Pester -Script '.codex-safe\tests\ProductionRolloutRunner.Core.FixRound2.Tests.ps1' -PassThru -Quiet
```

Focused RED result: total `4`; passed `0`; failed `4`; failure category `NB1_I4_REMAINING`.

Focused GREEN result: total `4`; passed `4`; failed `0`.

Final full-suite command:

```powershell
Invoke-Pester -Script '.codex-safe\tests' -PassThru -Quiet
```

Final full-suite result: total `40`; passed `40`; failed `0`. Final export verification confirms the public export set remains exactly the required four functions.

### Corrections and focused coverage

- NB1: a present null schema-version value now returns only the stable `INVALID` status with `RECEIPT_SCHEMA_INVALID`; no runtime type access occurs before the null guard.
- I4: temporary-file writing and first-write moving are private, non-exported filesystem boundaries. The writer still performs real path and reparse validation before these boundaries.
- The focused suite uses Pester module-scope mocks only at those private I/O boundaries. It verifies the temporary file path belongs to the already-verified target parent, and forces both temporary-write failure and first-write-move failure.
- Each forced failure asserts `SAFE_STATUS_WRITE_FAILED`, no target creation/corruption, and no remaining temporary or backup artifacts in the verified parent.

### Fix-round concerns

- No outstanding concerns for NB1 or the remaining I4 scope after focused and full-suite verification. Historical M1 evidence remains unchanged.

## Fix round 4: remaining I4 replacement-failure proof

### Root cause and preserved RED evidence

The round-3 focused suite already provided the required RED observation: total `2`; passed `1`; failed `1`; failure category `PESTER3_PRIVATE_MOCK_SCOPE_LEAK`. On Pester `3.4`, the partial-temporary-write mock installed in the first example remained active for the next example in the same `Describe` scope. It therefore failed the real seed write before the replacement boundary could be reached. The production writer still converted the failure to the stable `SAFE_STATUS_WRITE_FAILED` code, but the replacement assertions never ran.

No new historical RED artifact was fabricated. The round-4 correction changes only focused test structure: the two private-boundary scenarios use separate `Describe` scopes, and the replacement scenario explicitly captures the stable failure code.

### Fresh GREEN evidence

Focused command:

```powershell
Invoke-Pester -Script '.codex-safe\tests\ProductionRolloutRunner.Core.FixRound3.Tests.ps1' -PassThru -Quiet
```

Focused GREEN result: total `2`; passed `2`; failed `0`.

Final full-suite command:

```powershell
Invoke-Pester -Script '.codex-safe\tests' -PassThru -Quiet
```

Final full-suite result: total `42`; passed `42`; failed `0`; skipped `0`. Final export verification confirms the public export set remains exactly the required four functions.

### I4 proof and self-review

- The partial-write scenario creates a real partial same-directory temporary file, forces the private write boundary to fail, observes only `SAFE_STATUS_WRITE_FAILED`, and verifies the target is absent and temporary/backup artifacts are removed.
- The replacement scenario first creates and reads a real existing target without locking it. Its private replacement mock verifies the already-created temporary file exists, returns failure at that exact boundary, and the test explicitly observes `SAFE_STATUS_WRITE_FAILED`.
- After replacement failure, the test verifies the original target content is unchanged and no temporary or backup artifacts remain in the verified parent.
- Production code was not changed in this round. Real root containment, physical-path, and reparse-point checks remain intact and still execute before private filesystem boundaries.
- The four public exports are unchanged. No network, database, process launch, production command, remote operation, or production configuration input was used.

### Fix-round concerns

- No outstanding concern remains in the scoped I4 correction after focused and full-suite verification.
