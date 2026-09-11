### Task 1: TDD the Read-Only Database-State Classifier

**Files:**

- Create: `.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`
- Create: `.codex-safe/tests/LocalPreproduction.DatabaseStateClassifier.Tests.ps1`
- Create: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-1-report.md`

**Interfaces:**

- Consumes: `Get-LocalPreproductionComposeTarget`, `New-LocalPreproductionComposeArguments`, and `Invoke-LocalPreproductionNative` from `.codex-safe/LocalPreproduction.Core.psm1`.
- Script parameter: `param([hashtable]$TestOperations)`.
- Allowed injected operation keys: `Native`, `TerminationState`, `BuildBaseline`, and `UtcClock`; reject every other key before Compose or database calls.
- `BuildBaseline` returns exactly `MigrationNames` and `ApplicationTableNames`, each a string array. The controller validates uniqueness, grammar, and exact counts 12 and 45 regardless of whether the result is injected.
- Produces exactly one record with keys `phase`, `status`, `classificationCode`, `checks`, `boundedCounts`, `alertCodes`, `utcStart`, `utcEnd`, and `elapsedSeconds`.
- `phase` is always `READ_ONLY_DATABASE_STATE`.
- A successful classification has `status=READY`, one of the five `DATABASE_STATE_*` classification codes, and empty `alertCodes`.
- A guard/native/parse failure has `status=BLOCKED`, an empty classification code, and exactly one stable alert code.

- [ ] **Step 1: Create the injected fixture and exact record contract tests**

In the new test file, define the current paths and a baseline factory:

```powershell
$classifierPath = Join-Path $PSScriptRoot '..\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1'
$corePath = Join-Path $PSScriptRoot '..\LocalPreproduction.Core.psm1'

function New-TestDatabaseStateBaseline {
    return [pscustomobject]@{
        MigrationNames = [string[]]@(1..12 | ForEach-Object {
            '202607270000{0:D2}_migration_{0:D2}' -f $_
        })
        ApplicationTableNames = [string[]]@(1..45 | ForEach-Object {
            'table_{0:D2}' -f $_
        })
    }
}
```

Define a fixture that records every native call and returns the exact Core injection shape:

```powershell
function Invoke-TestDatabaseStateScenario {
    param(
        [Parameter(Mandatory)][string]$Probe1,
        [string]$Probe2 = '',
        [int]$Probe1ExitCode = 0,
        [int]$Probe2ExitCode = 0,
        [bool]$TerminationConfirmed = $true,
        [scriptblock]$BuildBaseline
    )

    $calls = New-Object System.Collections.Generic.List[object]
    $native = {
        param($FilePath, $Arguments, $TimeoutMilliseconds)
        $calls.Add([pscustomobject]@{
            FilePath = [string]$FilePath
            Arguments = [string[]]$Arguments
            TimeoutMilliseconds = [int]$TimeoutMilliseconds
        })
        $joined = @($Arguments) -join '|'
        if ($joined -match 'config\|--services$') {
            return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@('postgres'); StdErr = [string[]]@() }
        }
        if ($joined -match 'config\|--volumes$') {
            return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@('chengye_postgres_data'); StdErr = [string[]]@() }
        }
        if ($joined -match 'information_schema\.tables') {
            return [pscustomobject]@{ ExitCode = $Probe1ExitCode; StdOut = [string[]]@($Probe1); StdErr = [string[]]@('SENSITIVE_MARKER') }
        }
        return [pscustomobject]@{ ExitCode = $Probe2ExitCode; StdOut = [string[]]@($Probe2); StdErr = [string[]]@('SENSITIVE_MARKER') }
    }.GetNewClosure()

    $baselineOperation = if ($null -ne $BuildBaseline) {
        $BuildBaseline
    } else {
        { New-TestDatabaseStateBaseline }
    }

    $records = @(& $classifierPath -TestOperations @{
        Native = $native
        TerminationState = { return $TerminationConfirmed }.GetNewClosure()
        BuildBaseline = $baselineOperation
        UtcClock = { [datetime]'2026-07-27T10:00:00Z' }
    } *>&1)

    return [pscustomobject]@{ Records = $records; Calls = @($calls) }
}
```

Add a contract test requiring one record, the exact nine top-level keys, no extra streams, and exact `checks`/`boundedCounts` key sets. The expected `checks` keys are:

```text
composeTargetValid
readOnlyConfirmed
databaseIdentityMatched
roleIdentityMatched
postgres16
migrationMetadataPresent
migrationMetadataColumnsComplete
```

The expected bounded-count keys are:

```text
expectedMigrationCount
expectedApplicationTableCount
publicBaseTableCount
applicationBaseTableCount
migrationRecordCount
distinctMigrationNameCount
completedActiveMigrationCount
unresolvedActiveMigrationCount
rolledBackMigrationCount
expectedNameMatchCount
unexpectedNameCount
missingExpectedNameCount
duplicateNameCount
probeAttempts
databaseConnections
businessRowQueries
initializerExecutions
migrationExecutions
resetExecutions
bootstrapExecutions
defaultVolumeAccess
```

- [ ] **Step 2: Write RED classification tests**

Create this exact Pester block:

```powershell
Describe 'Local preproduction read-only database-state classifier' -Tags 'ReadOnlyDatabaseStateTask1' {
    # All Task 1 cases live in this block.
}
```

Use the Probe 1 grammar:

```text
readOnly|databaseMatched|roleMatched|postgres16|publicTables|applicationTables|metadataPresent|metadataColumnsComplete
```

Use exact `t`/`f` tokens and canonical decimal integers. Use the Probe 2 grammar:

```text
records|distinctNames|completedActive|unresolvedActive|rolledBack|expectedMatches|unexpected|missingExpected|duplicateNames
```

Add these required classification fixtures:

```powershell
@(
    @{ Probe1 = 't|t|t|t|0|0|f|f'; Probe2 = '';                 Expected = 'DATABASE_STATE_NO_EFFECT';     ProbeCalls = 1 },
    @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '0|0|0|0|0|0|0|12|0'; Expected = 'DATABASE_STATE_METADATA_ONLY'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1|1|0|1|0|0|0|12|0'; Expected = 'DATABASE_STATE_METADATA_ONLY'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|2|1|t|t'; Probe2 = '1|1|0|1|0|0|0|12|0'; Expected = 'DATABASE_STATE_PARTIAL';     ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|45|44|t|t'; Probe2 = '12|12|11|1|0|11|0|1|0'; Expected = 'DATABASE_STATE_PARTIAL'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '12|12|11|1|0|11|0|1|0'; Expected = 'DATABASE_STATE_PARTIAL'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '12|12|12|0|0|12|0|0|0'; Expected = 'DATABASE_STATE_COMPLETE'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|1|1|f|f'; Probe2 = '';                 Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 1 },
    @{ Probe1 = 't|t|t|t|47|46|t|t'; Probe2 = '12|12|12|0|0|12|0|0|0'; Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 2 },
    @{ Probe1 = 't|t|t|t|1|0|t|f'; Probe2 = '';                 Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 1 }
)
```

For every fixture require `status=READY`, empty `alertCodes`, `businessRowQueries=0`, and zero initializer/migration/reset/bootstrap/default-volume counts. Require the number of `psql` calls to equal `ProbeCalls` and the total native calls to equal `ProbeCalls + 2` for the two Compose metadata checks.

Add partial fixtures for each independently varied migration aggregate: rolled back, missing expected, unexpected, duplicate name, and completed-count mismatch. Add inconsistent fixtures for `publicTables - applicationTables` not equal to the metadata-presence indicator and for impossible arithmetic such as `distinctNames > records` or category totals not equal to records.

- [ ] **Step 3: Write RED guard, parser, and leakage matrices**

Add guard fixtures:

```powershell
@(
    @{ Probe1 = 'f|t|t|t|0|0|f|f'; Alert = 'READ_ONLY_GUARD_FAILED' },
    @{ Probe1 = 't|f|t|t|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' },
    @{ Probe1 = 't|t|f|t|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' },
    @{ Probe1 = 't|t|t|f|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' }
)
```

Each must return `BLOCKED`, an empty classification code, exactly one alert, and zero Probe 2 calls.

Add malformed Probe 1 and Probe 2 values covering empty, missing field, extra field, multiple lines, `true`/`false`, uppercase booleans, leading/trailing whitespace, signed integers, negative integers, decimal, exponent, leading zero, and a value above 1000. Every case returns `DATABASE_STATE_OUTPUT_INVALID` and emits no sensitive marker.

Add native failure cases for Probe 1 and Probe 2 nonzero exits, thrown exceptions containing `SENSITIVE_MARKER`, and `TerminationConfirmed=$false`. Require `READ_ONLY_DATABASE_STATE_FAILED` or `NATIVE_TERMINATION_UNCONFIRMED` as appropriate and prove no later probe call.

Add baseline failures for 11 or 13 migrations, 44 or 46 tables, duplicates, malformed names, extra result keys, and non-array fields. Require `BUILD_BASELINE_MISMATCH` and native call count 0.

Add a `TestOperations` extra-key case requiring `READ_ONLY_DATABASE_STATE_FAILED` before native calls.

- [ ] **Step 4: Run RED before creating the classifier**

Run in a fresh PowerShell process:

```powershell
powershell.exe -NoProfile -Command "Import-Module Pester -ErrorAction Stop; Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.DatabaseStateClassifier.Tests.ps1' -Tag 'ReadOnlyDatabaseStateTask1' -PassThru -Quiet | Select-Object TotalCount,PassedCount,FailedCount,SkippedCount"
```

Expected: meaningful failures because the classifier file and functions do not exist. Record only totals, stable failure classifications, UTC, and elapsed duration. Real operation counts remain zero.

- [ ] **Step 5: Implement strict baseline derivation and record construction**

Create the script with strict mode and the allowed injection contract:

```powershell
[CmdletBinding()]
param([hashtable]$TestOperations)

Set-StrictMode -Version Latest
$started = [datetime]::UtcNow
$phase = 'READ_ONLY_DATABASE_STATE'
$allowedOperationKeys = @('Native', 'TerminationState', 'BuildBaseline', 'UtcClock')
```

Reject null/non-scriptblock injected values and any extra key. Production baseline derivation must:

1. enumerate exactly 12 direct migration directories containing `migration.sql`;
2. validate each directory name with `^[0-9]{14}_[a-z0-9_]+$`;
3. read exactly 12 SQL files locally;
4. extract quoted `CREATE TABLE` targets case-sensitively;
5. validate each table name with `^[a-z][a-z0-9_]*$`;
6. exclude and reject `_prisma_migrations` from the application set;
7. require exactly 45 unique application table names.

The safe record builder must always emit the exact interface keys. Initialize every count to `0`, every check to `$false`, classification to an empty string, and prohibited-operation counts to `0` before any native call.

- [ ] **Step 6: Implement exact probe construction**

Resolve the fixed Compose target through:

```powershell
$composePath = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\LayerManage\law-firm-system\infra\postgres\compose.yml')
)
$target = Get-LocalPreproductionComposeTarget `
    -ComposePath $composePath `
    -TestOperation $operations.Native `
    -TestTerminationState $operations.TerminationState
```

Both probe tails must contain this exact environment entry and command prefix:

```powershell
$readOnlyOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'
@(
    'exec', '-T', '-e', $readOnlyOptions, 'postgres',
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w',
    '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c', $sql
)
```

Every probe uses `Invoke-LocalPreproductionNative -FilePath 'docker'`, the fixed Compose argument builder, a `15000` millisecond native timeout, and the injected termination operation. Increment `probeAttempts` and `databaseConnections` immediately before each probe invocation.

Probe 1 SQL must be one `WITH ... SELECT` statement. It may read only `information_schema.tables`, `information_schema.columns`, `current_setting`, `current_database`, `current_user`, and `to_regclass`. It returns the eight pipe-delimited fields in the approved grammar. It must not select a table name, database name, role name, or row from an application table.

Generate the expected migration `VALUES` relation only from names that passed the baseline grammar, using single-quote escaping even though the grammar excludes quotes. Probe 2 SQL must be one `WITH ... SELECT` statement that reads only `_prisma_migrations` columns `migration_name`, `finished_at`, and `rolled_back_at`. It returns the nine approved aggregate counts and never selects names or `logs`.

- [ ] **Step 7: Implement strict parsing, guard precedence, and classifications**

Add private parsers that accept exactly one stdout line. Split on `|` without trimming. Accept booleans only when exactly `t` or `f`. Accept counts only when they match `^(0|[1-9][0-9]{0,3})$`, successfully parse as `long`, and are at most `1000`.

Apply this precedence:

1. build baseline and Compose target failures;
2. native termination and exit failures;
3. Probe 1 grammar;
4. read-only guard;
5. database/role/PostgreSQL target checks;
6. structural state checks;
7. Probe 2 native and grammar checks when authorized;
8. aggregate arithmetic checks;
9. one of the five state classifications.

Map fixed-target resolution or Compose metadata validation failure only to `COMPOSE_TARGET_INVALID`; never expose the underlying native or path detail.

For a successful classification return `READY`, the exact classification code, and no alerts. For a failure return `BLOCKED`, an empty classification code, and one stable alert. Never place a native result or exception string in a record.

- [ ] **Step 8: Run focused GREEN and adversarial tests**

Run the Task 1 tag in a fresh process with all streams captured. Required: failures 0, skips 0. Run the malformed-output and leakage contexts separately to prove they pass independently. Record only safe totals, stable codes, UTC, and elapsed duration.

- [ ] **Step 9: Run regression and static safety verification**

Run in one fresh process:

```powershell
powershell.exe -NoProfile -Command "Import-Module Pester -ErrorAction Stop; Invoke-Pester -Script @('.codex-safe\tests\LocalPreproduction.Core.Tests.ps1','.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1','.codex-safe\tests\LocalPreproduction.DatabaseStateClassifier.Tests.ps1') -PassThru -Quiet | Select-Object TotalCount,PassedCount,FailedCount,SkippedCount"
```

Required: failures 0 and skips 0.

Static gates:

- PowerShell AST parse errors 0 for Core, initializer, classifier, and all three test files;
- classifier Docker operational sites equal fixed Compose builder references;
- base-only Compose calls 0;
- destructive command tokens 0;
- initializer, migration, assertion, contract, bootstrap, and operator-input command tokens 0;
- `psql` probe sites exactly 2;
- exact read-only `PGOPTIONS` occurrences exactly 2 in constructed operational paths or one shared constant referenced by both sites, with tests proving both final argument vectors;
- 15000 millisecond probe timeout matches exactly 2;
- business table names in SQL 0;
- `_prisma_migrations.logs` references 0;
- DDL/DML/procedural/`COPY` statements in SQL 0;
- direct output writers 0;
- product runtime, Core, initializer, migration SQL, Compose files, Event Center files, and Worker configuration modifications 0;
- live Docker/database/Prisma/npm/initializer/migration/reset/bootstrap/network/operator-input operations 0.

- [ ] **Step 10: Record the Task 1 safe report**

Write `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-1-report.md` with RED, focused GREEN, full regression, static-gate, protected-file, safe-output, and zero-live-operation evidence. Include SHA-256 values for the new classifier and test file and for each protected file checked, but do not include paths outside the workspace or any forbidden runtime value. Do not run Git.

---

