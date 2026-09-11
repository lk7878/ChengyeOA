# Local Preproduction Read-Only Database-State Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with independent review before the single live classifier invocation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, independently review, and run once a PostgreSQL-enforced read-only classifier that identifies the preserved isolated database's migration/schema state without reading business rows or authorizing a write.

**Architecture:** A PowerShell controller reuses the existing fixed Compose target and native containment helpers. It derives the approved 12-migration/45-table baseline offline, runs at most two aggregate-only `psql` probes whose sessions start read-only through `PGOPTIONS`, strictly parses one-line bounded results, and emits one safe state record.

**Tech Stack:** Windows PowerShell 5.1, Pester 3, Docker Compose, PostgreSQL 16 `psql`, existing `.codex-safe/LocalPreproduction.Core.psm1` containment.

## Global Constraints

- No Git or GitHub commands, including read-only commands and commits.
- Do not rerun the initializer or migration.
- Do not reset, delete, rewrite, seed, repair, assert application emptiness, run the bootstrap contract, prompt for secrets, or bootstrap the preserved database.
- Do not delete, skip, or rewrite Event Center history.
- Do not add a remote Worker toggle.
- The fixed isolated Compose project and ordered two-file prefix are mandatory for every Docker Compose command.
- The default Compose project and its volume containing 87 user tables remain unreachable.
- Do not print URLs, credentials, payloads, database or role names, migration names, raw database errors, stacks, host, PID, worker identity, or lock-owner details.
- Evidence is limited to safe status, bounded counts, booleans, stable alert/classification codes, UTC, and elapsed duration.
- Read only `pg_catalog`, `information_schema`, and `_prisma_migrations` metadata. Never read business-table rows or `_prisma_migrations.logs`.
- Every database session must start with `default_transaction_read_only=on`, `statement_timeout=5000`, and `lock_timeout=1000` through `PGOPTIONS`.
- Every real probe uses `psql -X -qAt -v ON_ERROR_STOP=1 -w` and the existing fixed local-preproduction database/role identity.
- Any malformed, incomplete, multi-line, unexpected, failed, timed-out, or unconfirmed native result blocks without retry.
- Before independent launch readiness, live Docker, PostgreSQL, Prisma, npm, initializer, migration, reset, bootstrap, network, and operator-input operation counts remain zero.
- The single live database-state classifier invocation is allowed only after independent review returns READY.

---

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

### Task 2: Controller Verification and Independent Review

**Files:**

- Read: `docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md`
- Read: `docs/superpowers/plans/2026-07-27-local-preproduction-read-only-database-state-classifier.md`
- Read: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-1-report.md`
- Create: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-review-package.md`
- Create: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-review.md`
- Create: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/launch-ready.md`

**Interfaces:**

- Consumes: the Task 1 implementation, tests, hashes, and safe reports.
- Produces `READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY` only when controller verification passes, both independent verdicts pass, and Critical/Important counts are zero.

- [ ] **Step 1: Run one authoritative fresh controller regression**

Run Core, Workflow, and classifier tests together once in a new PowerShell process. Require failures 0 and skips 0. Record only totals, stable alert codes, UTC, elapsed duration, and live-operation counts fixed at zero.

- [ ] **Step 2: Run controller static verification**

Repeat the Task 1 static gates independently. Additionally prove:

- build-baseline access precedes Compose/database access;
- Probe 2 is unreachable unless Probe 1 proves read-only, target match, PostgreSQL 16, metadata presence, and required columns;
- every classification is mutually exclusive under the implemented precedence;
- every failure is fail-stop with one alert and no raw result propagation;
- the exact five state codes and seven failure codes match the approved design;
- the source and test hashes match Task 1 evidence;
- no protected file hash changed.

- [ ] **Step 3: Build a no-Git review package**

Write `task-2-review-package.md` containing only:

- paths to the approved design, plan, classifier, tests, and Task 1 report;
- their workspace-relative SHA-256 values;
- controller test/static totals;
- exact global constraints;
- prohibited-operation counts;
- the required reviewer questions.

Do not include raw command output, a Git diff, URLs, credentials, paths outside the workspace, database/role/migration names, or native errors.

- [ ] **Step 4: Dispatch a fresh independent reviewer**

The reviewer must not be the implementer. It reads the review package first and verifies:

- PostgreSQL read-only mode is effective from session start for both probes;
- the fixed isolated Compose target and two-file prefix are mandatory;
- the default project/volume cannot be reached;
- baseline drift blocks before database access;
- Probe 1 reads catalog/schema metadata only;
- Probe 2 reads only the three approved `_prisma_migrations` columns and aggregate counts;
- no business-table row or migration log can be read;
- all five state classifications and all guard failures are correctly ordered;
- raw/sensitive output cannot reach any record or additional stream;
- native containment and termination guarantees are preserved;
- offline tests are mutation-resistant rather than self-fulfilling;
- no live or prohibited operation occurred.

Required report fields:

```text
SPEC_COMPLIANCE=PASS
TASK_QUALITY=PASS
Critical=0
Important=0
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY
```

- [ ] **Step 5: Resolve review findings before readiness**

Any Critical or Important finding blocks launch readiness. The implementer fixes one finding set at a time, reruns the covering offline tests, appends a safe fix report, and returns the files to a fresh scoped re-review. Do not connect to Docker or PostgreSQL during a fix round. Do not run Git.

- [ ] **Step 6: Record launch-ready evidence**

Only after the required verdict, write `launch-ready.md` with:

```text
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY
LIVE_DATABASE_CLASSIFIER_EXECUTED=0
LIVE_MIGRATION_EXECUTED=0
LIVE_INITIALIZER_EXECUTED=0
```

Include safe controller/review totals, hashes, UTC, elapsed duration, and zero prohibited-operation counts.

---

### Task 3: Single Controlled Live Read-Only Classification

**Files:**

- Read: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/launch-ready.md`
- Create: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/live-report.md`

**Interfaces:**

- Consumes: independent launch readiness and the existing operator PowerShell with the approved process environment.
- Produces exactly one safe `READ_ONLY_DATABASE_STATE` result and stops.

- [ ] **Step 1: Reconfirm zero-connection operator-shell gates**

Without printing values, require:

- process variables 16/16;
- Node exactly `v22.14.0`;
- npm exactly `10.9.2`;
- `NODE_ENV` exactly `production`;
- `EVENT_WORKER_ENABLED` exactly `false`;
- launch-ready verdict exactly READY;
- classifier and test hashes equal the reviewed hashes.

Any mismatch stops before Docker or PostgreSQL access.

- [ ] **Step 2: Invoke the classifier once**

Run only:

```powershell
& '.\.codex-safe\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1'
```

Do not pipe, expand, format, or inspect captured native fields. Do not invoke the command a second time automatically.

- [ ] **Step 3: Stop on the single result**

Accept only one record with phase `READ_ONLY_DATABASE_STATE` and either:

- `READY` plus exactly one approved `DATABASE_STATE_*` classification; or
- `BLOCKED` plus exactly one approved alert.

Do not run migration, initializer, reset, assertion, contract, bootstrap, secret input, or any other database command after the result.

- [ ] **Step 4: Record safe live evidence**

Write `live-report.md` with the single safe record, bounded operation counts, UTC, and elapsed duration. Do not record raw output, database/role/migration names, URLs, credentials, payloads, host, PID, Worker identity, lock-owner details, or default-volume values.

- [ ] **Step 5: Select the next diagnostic branch without executing it**

Document only the selected branch:

- `DATABASE_STATE_NO_EFFECT`: investigate the pre-schema database execution boundary offline;
- `DATABASE_STATE_METADATA_ONLY`: inspect the first migration's SQL and prerequisites offline without naming it in shared evidence;
- `DATABASE_STATE_PARTIAL`: preserve state and design a separately reviewed partial-migration forensic classifier;
- `DATABASE_STATE_COMPLETE`: investigate the native wrapper/exit path without another migration;
- `DATABASE_STATE_INCONSISTENT`: design a separately reviewed forensic plan;
- any BLOCKED alert: investigate that guard only.

Stop after recording the branch. Any write-capable next action requires a new design, independent review, and explicit user authorization.

---

## Plan Self-Review Checklist

- [ ] Every spec requirement maps to a Task 1 implementation/test step, Task 2 review gate, or Task 3 live boundary.
- [ ] The same interface keys, classification codes, failure codes, counts, and probe grammars are used across all tasks.
- [ ] Probe 2 is unreachable unless Probe 1 proves all prerequisites.
- [ ] Both live sessions start read-only before SQL and have bounded statement, lock, and native timeouts.
- [ ] Business-row and migration-log reads are absent.
- [ ] The default volume is unreachable.
- [ ] No Git/GitHub or automatic retry step exists.
- [ ] No initializer, migration, reset, assertion, contract, bootstrap, or secret-input action occurs.
- [ ] Live database access occurs only once, after independent readiness, and stops after classification.
