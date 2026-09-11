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

function New-TestProductionBaselineProject {
    param([Parameter(Mandatory)][string]$Root)
    $baseline = New-TestDatabaseStateBaseline
    $prismaRoot = Join-Path $Root 'apps\server\prisma'
    $migrationRoot = Join-Path $prismaRoot 'migrations'
    New-Item -ItemType Directory -Path $migrationRoot -Force | Out-Null
    for ($index = 0; $index -lt $baseline.MigrationNames.Count; $index++) {
        $directory = Join-Path $migrationRoot $baseline.MigrationNames[$index]
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $sql = if ($index -eq 0) {
            @($baseline.ApplicationTableNames | ForEach-Object { 'CREATE TABLE "' + $_ + '" ();' }) -join "`r`n"
        }
        else { '-- bounded fixture' }
        [System.IO.File]::WriteAllText((Join-Path $directory 'migration.sql'), $sql, [System.Text.Encoding]::UTF8)
    }
    $schema = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $baseline.ApplicationTableNames.Count; $index++) {
        [void]$schema.AppendLine(('model Model{0:D2} {{' -f ($index + 1)))
        [void]$schema.AppendLine('  id String @id')
        [void]$schema.AppendLine(('  @@map("{0}")' -f $baseline.ApplicationTableNames[$index]))
        [void]$schema.AppendLine('}')
    }
    [System.IO.File]::WriteAllText((Join-Path $prismaRoot 'schema.prisma'), $schema.ToString(), [System.Text.Encoding]::UTF8)
    return $Root
}

function Test-ApprovedSqlSourceShape {
    param(
        [Parameter(Mandatory)][string]$Sql,
        [Parameter(Mandatory)][string[]]$ApprovedSources,
        [Parameter(Mandatory)][int]$ExpectedSourceCount
    )
    if ($Sql -match '(?i)\bjoin\s+' -or
        $Sql -match '(?i)\b(from|join)\s+"' -or
        $Sql -match '(?im)\b(from|join)\s+[a-z_\.]+(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,') { return $false }
    $sources = @([regex]::Matches($Sql, '(?im)\bfrom\s+([a-z_\.]+)') | ForEach-Object { [string]$_.Groups[1].Value })
    if ($sources.Count -ne $ExpectedSourceCount) { return $false }
    return @($sources | Where-Object { $ApprovedSources -notcontains $_ }).Count -eq 0
}

function Invoke-TestDatabaseStateScenario {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Probe1,
        [string]$Probe2 = '',
        [int]$Probe1ExitCode = 0,
        [int]$Probe2ExitCode = 0,
        [bool]$TerminationConfirmed = $true,
        [bool[]]$TerminationStates,
        [scriptblock]$BuildBaseline,
        [scriptblock]$NativeOverride,
        [hashtable]$AdditionalOperations,
        [switch]$UseProductionBaseline
    )

    $calls = New-Object System.Collections.Generic.List[object]
    $selectedNative = if ($null -ne $NativeOverride) { $NativeOverride } else {
        {
            param($FilePath, $Arguments, $TimeoutMilliseconds)
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
    }
    $native = {
        param($FilePath, $Arguments, $TimeoutMilliseconds)
        $calls.Add([pscustomobject]@{
            FilePath = [string]$FilePath
            Arguments = [string[]]$Arguments
            TimeoutMilliseconds = [int]$TimeoutMilliseconds
        })
        & $selectedNative -FilePath $FilePath -Arguments $Arguments -TimeoutMilliseconds $TimeoutMilliseconds
    }.GetNewClosure()

    $baselineValue = New-TestDatabaseStateBaseline
    $baselineOperation = if ($null -ne $BuildBaseline) { $BuildBaseline } else { { return $baselineValue }.GetNewClosure() }
    $terminationOperation = if ($null -ne $TerminationStates) {
        $terminationQueue = New-Object System.Collections.Generic.List[bool]
        foreach ($state in $TerminationStates) { $terminationQueue.Add($state) }
        {
            if ($terminationQueue.Count -eq 0) { return $false }
            $value = $terminationQueue[0]
            $terminationQueue.RemoveAt(0)
            return $value
        }.GetNewClosure()
    } else { { return $TerminationConfirmed }.GetNewClosure() }
    $operations = @{
        Native = $native
        TerminationState = $terminationOperation
        UtcClock = { [datetime]'2026-07-27T10:00:00Z' }
    }
    if (-not $UseProductionBaseline) { $operations.BuildBaseline = $baselineOperation }
    if ($null -ne $AdditionalOperations) {
        foreach ($key in $AdditionalOperations.Keys) { $operations[$key] = $AdditionalOperations[$key] }
    }
    $records = @(& $classifierPath -TestOperations $operations *>&1)
    return [pscustomobject]@{ Records = $records; Calls = $calls.ToArray() }
}

function Assert-SafeBlockedRecord {
    param([object]$Result, [string]$Alert)
    $Result.Records.Count | Should Be 1
    $record = $Result.Records[0]
    $record.status | Should Be 'BLOCKED'
    $record.classificationCode | Should Be ''
    @($record.alertCodes) | Should Be @($Alert)
    (@($Result.Records | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] })).Count | Should Be 0
    (($Result.Records | Out-String) -match 'SENSITIVE_MARKER') | Should Be $false
}

Describe 'Local preproduction read-only database-state classifier' -Tags 'ReadOnlyDatabaseStateTask1' {
    It 'emits the exact safe record contract with no extra stream output' {
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f'
        $result.Records.Count | Should Be 1
        $record = $result.Records[0]
        @($record.PSObject.Properties.Name | Sort-Object) | Should Be @('alertCodes','boundedCounts','checks','classificationCode','elapsedSeconds','phase','status','utcEnd','utcStart')
        @($record.checks.PSObject.Properties.Name | Sort-Object) | Should Be @('composeTargetValid','databaseIdentityMatched','migrationMetadataColumnsComplete','migrationMetadataPresent','postgres16','readOnlyConfirmed','roleIdentityMatched')
        @($record.boundedCounts.PSObject.Properties.Name | Sort-Object) | Should Be @('applicationBaseTableCount','bootstrapExecutions','businessRowQueries','completedActiveMigrationCount','databaseConnections','defaultVolumeAccess','distinctMigrationNameCount','duplicateNameCount','expectedApplicationTableCount','expectedMigrationCount','expectedNameMatchCount','initializerExecutions','migrationExecutions','migrationRecordCount','missingExpectedNameCount','probeAttempts','publicBaseTableCount','resetExecutions','rolledBackMigrationCount','unexpectedNameCount','unresolvedActiveMigrationCount')
    }

    It 'derives the fixed production baseline before injected compose and probe calls' {
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -UseProductionBaseline
        $record = $result.Records[0]
        $record.status | Should Be 'READY'
        $record.boundedCounts.expectedMigrationCount | Should Be 12
        $record.boundedCounts.expectedApplicationTableCount | Should Be 45
        $result.Calls.Count | Should Be 3
    }

    It 'blocks a same-count Prisma mapping substitution in production baseline derivation before native calls' {
        $projectRoot = New-TestProductionBaselineProject -Root (Join-Path $TestDrive 'baseline-set-mismatch')
        $schemaPath = Join-Path $projectRoot 'apps\server\prisma\schema.prisma'
        $schema = [System.IO.File]::ReadAllText($schemaPath).Replace('@@map("table_45")', '@@map("table_substitution")')
        [System.IO.File]::WriteAllText($schemaPath, $schema, [System.Text.Encoding]::UTF8)
        $baselineOperation = { Get-ProductionBaseline -ProjectRoot $projectRoot }.GetNewClosure()
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -BuildBaseline $baselineOperation
        Assert-SafeBlockedRecord -Result $result -Alert 'BUILD_BASELINE_MISMATCH'
        $result.Calls.Count | Should Be 0
    }

    It 'constructs both probes with the fixed read-only compose and psql vectors only' {
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|46|45|t|t' -Probe2 '12|12|12|0|0|12|0|0|0'
        $psqlCalls = @($result.Calls | Where-Object { $_.Arguments -contains 'psql' })
        $psqlCalls.Count | Should Be 2
        $composePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\LayerManage\law-firm-system\infra\postgres\compose.yml'))
        $overridePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\local-preproduction.compose.override.yml'))
        $composePrefix = [string[]]@('compose', '-p', 'chengyeoa-local-preproduction', '-f', $composePath, '-f', $overridePath)
        $readOnlyOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'
        $psqlPrefix = [string[]]@('exec', '-T', '-e', $readOnlyOptions, 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c')
        foreach ($call in $psqlCalls) {
            $call.FilePath | Should Be 'docker'
            $call.TimeoutMilliseconds | Should Be 15000
            [string[]]@($call.Arguments[0..6]) | Should Be $composePrefix
            [string[]]@($call.Arguments[7..22]) | Should Be $psqlPrefix
            $call.Arguments.Count | Should Be 24
            ($call.Arguments[23] -match '(?i)\b(insert|update|delete|merge|create|alter|drop|truncate|copy|call|do)\b') | Should Be $false
        }

        $probe1 = [string]$psqlCalls[0].Arguments[23]
        $probe2 = [string]$psqlCalls[1].Arguments[23]
        $probe1 | Should Match '(?is)^\s*WITH\b'
        $probe1 | Should Match 'information_schema\.tables'
        $probe1 | Should Match 'information_schema\.columns'
        $probe1 | Should Match 'current_setting'
        $probe1 | Should Match 'current_database'
        $probe1 | Should Match 'current_user'
        $probe1 | Should Match 'to_regclass'
        $probe1 | Should Not Match '(?i)\bfrom\s+_prisma_migrations\b'
        $probe1 | Should Not Match '(?i)\blogs\b'
        $probe1 | Should Not Match '(?i)\bjoin\s+'
        $probe1 | Should Not Match '(?i)\b(from|join)\s+"'
        $probe1Sources = @([regex]::Matches($probe1, '(?im)\bfrom\s+([a-z_\.]+)') | ForEach-Object { [string]$_.Groups[1].Value })
        $probe1Sources.Count | Should Be 7
        $approvedProbe1Sources = @('information_schema.tables', 'information_schema.columns', 'expected_application_tables', 'public_tables', 'application_tables', 'metadata_columns')
        foreach ($source in $probe1Sources) { ($approvedProbe1Sources -contains $source) | Should Be $true }
        (Test-ApprovedSqlSourceShape -Sql $probe1 -ApprovedSources $approvedProbe1Sources -ExpectedSourceCount 7) | Should Be $true
        $probe1CommaMutant = $probe1.Replace('FROM information_schema.tables', 'FROM information_schema.tables, synthetic_source')
        (Test-ApprovedSqlSourceShape -Sql $probe1CommaMutant -ApprovedSources $approvedProbe1Sources -ExpectedSourceCount 7) | Should Be $false
        $baseline = New-TestDatabaseStateBaseline
        foreach ($name in $baseline.ApplicationTableNames) { $probe1 | Should Match ([regex]::Escape("('$name')")) }

        $probe2 | Should Match '(?is)^\s*WITH\b'
        $probe2 | Should Match '(?i)\bfrom\s+_prisma_migrations\b'
        $probe2 | Should Match '(?i)\bmigration_name\b'
        $probe2 | Should Match '(?i)\bfinished_at\b'
        $probe2 | Should Match '(?i)\brolled_back_at\b'
        $probe2 | Should Match '(?is)\bmigration_rows\s+AS\s*\(\s*SELECT\s+migration_name\s*,\s*finished_at\s*,\s*rolled_back_at\s+FROM\s+_prisma_migrations\s*\)'
        $probe2 | Should Not Match '(?i)\blogs\b'
        $probe2 | Should Not Match '(?i)\binformation_schema\.'
        $probe2 | Should Not Match '(?i)\bjoin\s+'
        $probe2 | Should Not Match '(?i)\b(from|join)\s+"'
        $probe2 | Should Not Match '(?i)\bfrom\s+(?!_prisma_migrations\b|migration_rows\b|expected_migrations\b|aggregate\b)[a-z][a-z0-9_]*'
        $approvedProbe2Sources = @('_prisma_migrations', 'migration_rows', 'expected_migrations', 'aggregate')
        (Test-ApprovedSqlSourceShape -Sql $probe2 -ApprovedSources $approvedProbe2Sources -ExpectedSourceCount 5) | Should Be $true
        $probe2CommaMutant = $probe2.Replace('FROM _prisma_migrations', 'FROM _prisma_migrations, synthetic_source')
        (Test-ApprovedSqlSourceShape -Sql $probe2CommaMutant -ApprovedSources $approvedProbe2Sources -ExpectedSourceCount 5) | Should Be $false
    }

    It 'classifies the approved fixture matrix' -TestCases @(
        @{ Probe1 = 't|t|t|t|0|0|f|f'; Probe2 = ''; Expected = 'DATABASE_STATE_NO_EFFECT'; ProbeCalls = 1 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '0|0|0|0|0|0|0|12|0'; Expected = 'DATABASE_STATE_METADATA_ONLY'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1|1|0|1|0|0|1|12|0'; Expected = 'DATABASE_STATE_METADATA_ONLY'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '12|12|12|0|0|12|0|0|0'; Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|2|1|t|t'; Probe2 = '1|1|0|1|0|0|1|12|0'; Expected = 'DATABASE_STATE_PARTIAL'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|45|44|t|t'; Probe2 = '12|12|11|1|0|11|1|1|0'; Expected = 'DATABASE_STATE_PARTIAL'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '12|12|11|1|0|11|1|1|0'; Expected = 'DATABASE_STATE_PARTIAL'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '12|12|12|0|0|12|0|0|0'; Expected = 'DATABASE_STATE_COMPLETE'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|1|1|f|f'; Probe2 = ''; Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 1 },
        @{ Probe1 = 't|t|t|t|47|46|t|t'; Probe2 = '12|12|12|0|0|12|0|0|0'; Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|f'; Probe2 = ''; Expected = 'DATABASE_STATE_INCONSISTENT'; ProbeCalls = 1 }
    ) {
        param($Probe1, $Probe2, $Expected, $ProbeCalls)
        $result = Invoke-TestDatabaseStateScenario -Probe1 $Probe1 -Probe2 $Probe2
        $record = $result.Records[0]
        $record.status | Should Be 'READY'
        $record.classificationCode | Should Be $Expected
        @($record.alertCodes).Count | Should Be 0
        $record.boundedCounts.businessRowQueries | Should Be 0
        @('initializerExecutions','migrationExecutions','resetExecutions','bootstrapExecutions','defaultVolumeAccess') | ForEach-Object { $record.boundedCounts.$_ | Should Be 0 }
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be $ProbeCalls
        $result.Calls.Count | Should Be ($ProbeCalls + 2)
    }

    It 'classifies independently varied migration aggregate defects as partial' -TestCases @(
        @{ Probe2 = '12|12|11|0|1|12|0|0|0' }, @{ Probe2 = '12|12|12|0|0|11|1|1|0' },
        @{ Probe2 = '13|13|13|0|0|12|1|0|0' }, @{ Probe2 = '13|12|13|0|0|12|0|0|1' },
        @{ Probe2 = '12|12|11|1|0|12|0|0|0' }
    ) {
        param($Probe2)
        (Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|46|45|t|t' -Probe2 $Probe2).Records[0].classificationCode | Should Be 'DATABASE_STATE_PARTIAL'
    }

    It 'classifies contradictory metadata counts as inconsistent' -TestCases @(
        @{ Probe1 = 't|t|t|t|45|45|f|f'; Probe2 = '' },
        @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '1|2|1|0|0|1|0|11|0' },
        @{ Probe1 = 't|t|t|t|46|45|t|t'; Probe2 = '2|2|1|0|0|2|0|10|0' },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1|1|0|1|0|0|0|12|0' }
    ) {
        param($Probe1, $Probe2)
        (Invoke-TestDatabaseStateScenario -Probe1 $Probe1 -Probe2 $Probe2).Records[0].classificationCode | Should Be 'DATABASE_STATE_INCONSISTENT'
    }

    It 'blocks guard and target mismatches before probe two' -TestCases @(
        @{ Probe1 = 'f|t|t|t|0|0|f|f'; Alert = 'READ_ONLY_GUARD_FAILED' },
        @{ Probe1 = 't|f|t|t|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' },
        @{ Probe1 = 't|t|f|t|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' },
        @{ Probe1 = 't|t|t|f|0|0|f|f'; Alert = 'DATABASE_TARGET_MISMATCH' }
    ) {
        param($Probe1, $Alert)
        $result = Invoke-TestDatabaseStateScenario -Probe1 $Probe1
        Assert-SafeBlockedRecord -Result $result -Alert $Alert
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be 1
    }

    It 'blocks malformed probe output without sensitive leakage' -TestCases @(
        @{ Probe1 = ''; Probe2 = ''; Which = 1 }, @{ Probe1 = 't|t|t|t|0|0|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = 't|t|t|t|0|0|f|f|x'; Probe2 = ''; Which = 1 }, @{ Probe1 = "t|t|t|t|0|0|f|f`nextra"; Probe2 = ''; Which = 1 },
        @{ Probe1 = 'true|t|t|t|0|0|f|f'; Probe2 = ''; Which = 1 }, @{ Probe1 = 'T|t|t|t|0|0|f|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = ' t|t|t|t|0|0|f|f'; Probe2 = ''; Which = 1 }, @{ Probe1 = 't|t|t|t|01|0|f|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = 't|t|t|t|+1|0|f|f'; Probe2 = ''; Which = 1 }, @{ Probe1 = 't|t|t|t|-1|0|f|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = 't|t|t|t|1.0|0|f|f'; Probe2 = ''; Which = 1 }, @{ Probe1 = 't|t|t|t|1e1|0|f|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = 't|t|t|t|1001|0|f|f'; Probe2 = ''; Which = 1 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = ''; Which = 2 }, @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1|1|0|0|0|0|0|12'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1|1|0|0|0|0|0|12|0|x'; Which = 2 }, @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '01|1|0|0|0|0|0|12|0'; Which = 2 }
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = "1|1|0|0|0|0|0|12|0`nextra"; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '+1|1|0|0|0|0|0|12|0'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '-1|1|0|0|0|0|0|12|0'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1.0|1|0|0|0|0|0|12|0'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1e1|1|0|0|0|0|0|12|0'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = ' 1|1|0|0|0|0|0|12|0'; Which = 2 },
        @{ Probe1 = 't|t|t|t|1|0|t|t'; Probe2 = '1001|1|0|0|0|0|0|12|0'; Which = 2 }
    ) {
        param($Probe1, $Probe2, $Which)
        $result = Invoke-TestDatabaseStateScenario -Probe1 $Probe1 -Probe2 $Probe2
        Assert-SafeBlockedRecord -Result $result -Alert 'DATABASE_STATE_OUTPUT_INVALID'
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be $Which
    }

    It 'blocks native and termination failures without later probes' -TestCases @(
        @{ Probe1ExitCode = 1; Probe2ExitCode = 0; TerminationConfirmed = $true; Alert = 'READ_ONLY_DATABASE_STATE_FAILED'; ProbeCalls = 1 },
        @{ Probe1ExitCode = 0; Probe2ExitCode = 1; TerminationConfirmed = $true; Alert = 'READ_ONLY_DATABASE_STATE_FAILED'; ProbeCalls = 2 },
        @{ Probe1ExitCode = 0; Probe2ExitCode = 0; TerminationConfirmed = $false; Alert = 'NATIVE_TERMINATION_UNCONFIRMED'; ProbeCalls = 0 }
    ) {
        param($Probe1ExitCode, $Probe2ExitCode, $TerminationConfirmed, $Alert, $ProbeCalls)
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|1|0|t|t' -Probe2 '0|0|0|0|0|0|0|12|0' -Probe1ExitCode $Probe1ExitCode -Probe2ExitCode $Probe2ExitCode -TerminationConfirmed $TerminationConfirmed
        Assert-SafeBlockedRecord -Result $result -Alert $Alert
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be $ProbeCalls
    }

    It 'blocks unconfirmed termination at the specific probe call' -TestCases @(
        @{ States = [bool[]]@($true, $true, $false); ProbeCalls = 1 },
        @{ States = [bool[]]@($true, $true, $true, $false); ProbeCalls = 2 }
    ) {
        param($States, $ProbeCalls)
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|1|0|t|t' -Probe2 '0|0|0|0|0|0|0|12|0' -TerminationStates $States
        Assert-SafeBlockedRecord -Result $result -Alert 'NATIVE_TERMINATION_UNCONFIRMED'
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be $ProbeCalls
    }

    It 'maps invalid compose metadata and sensitive compose exceptions to one safe alert' -TestCases @(
        @{ Mode = 'service'; ExpectedCalls = 1 },
        @{ Mode = 'volume'; ExpectedCalls = 2 },
        @{ Mode = 'throw'; ExpectedCalls = 1 }
    ) {
        param($Mode, $ExpectedCalls)
        $native = {
            param($FilePath, $Arguments, $TimeoutMilliseconds)
            $joined = @($Arguments) -join '|'
            if ($Mode -ceq 'throw') { throw 'SENSITIVE_MARKER' }
            if ($joined -match 'config\|--services$') {
                $value = if ($Mode -ceq 'service') { 'invalid' } else { 'postgres' }
                return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@($value); StdErr = [string[]]@() }
            }
            $value = if ($Mode -ceq 'volume') { 'invalid' } else { 'chengye_postgres_data' }
            return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@($value); StdErr = [string[]]@() }
        }.GetNewClosure()
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -NativeOverride $native
        Assert-SafeBlockedRecord -Result $result -Alert 'COMPOSE_TARGET_INVALID'
        $result.Calls.Count | Should Be $ExpectedCalls
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be 0
    }

    It 'contains sensitive exceptions thrown at either probe boundary' -TestCases @(
        @{ Mode = 'probe1'; ProbeCalls = 1 },
        @{ Mode = 'probe2'; ProbeCalls = 2 }
    ) {
        param($Mode, $ProbeCalls)
        $seenProbe = [pscustomobject]@{ Value = 0 }
        $native = {
            param($FilePath, $Arguments, $TimeoutMilliseconds)
            $joined = @($Arguments) -join '|'
            if ($joined -match 'config\|--services$') { return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@('postgres'); StdErr = [string[]]@() } }
            if ($joined -match 'config\|--volumes$') { return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@('chengye_postgres_data'); StdErr = [string[]]@() } }
            $seenProbe.Value++
            if (($Mode -ceq 'probe1' -and $seenProbe.Value -eq 1) -or ($Mode -ceq 'probe2' -and $seenProbe.Value -eq 2)) { throw 'SENSITIVE_MARKER' }
            return [pscustomobject]@{ ExitCode = 0; StdOut = [string[]]@('t|t|t|t|1|0|t|t'); StdErr = [string[]]@() }
        }.GetNewClosure()
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|1|0|t|t' -Probe2 '0|0|0|0|0|0|0|12|0' -NativeOverride $native
        Assert-SafeBlockedRecord -Result $result -Alert 'READ_ONLY_DATABASE_STATE_FAILED'
        @($result.Calls | Where-Object { $_.Arguments -contains 'psql' }).Count | Should Be $ProbeCalls
    }

    It 'blocks invalid build baselines before native calls' -TestCases @(
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.MigrationNames = $b.MigrationNames[0..10]; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames = $b.ApplicationTableNames[0..43]; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.MigrationNames += '20260727000013_migration_13'; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames += 'table_46'; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.MigrationNames[1] = $b.MigrationNames[0]; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames[1] = $b.ApplicationTableNames[0]; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.MigrationNames[0] = 'INVALID'; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames[0] = 'Invalid-Table'; $b } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames[0] = '_prisma_migrations'; $b } },
        @{ BuildBaseline = { [pscustomobject]@{ MigrationNames = 'bad'; ApplicationTableNames = [string[]]@('x') } } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b.ApplicationTableNames = 'bad'; $b } },
        @{ BuildBaseline = { $null } },
        @{ BuildBaseline = { $b = New-TestDatabaseStateBaseline; $b | Add-Member -NotePropertyName Extra -NotePropertyValue 'x'; $b } }
    ) {
        param($BuildBaseline)
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -BuildBaseline $BuildBaseline
        Assert-SafeBlockedRecord -Result $result -Alert 'BUILD_BASELINE_MISMATCH'
        $result.Calls.Count | Should Be 0
    }

    It 'rejects unknown injected operations before native calls' {
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -AdditionalOperations @{ Unexpected = { } }
        Assert-SafeBlockedRecord -Result $result -Alert 'READ_ONLY_DATABASE_STATE_FAILED'
        $result.Calls.Count | Should Be 0
    }

    It 'rejects null and non-scriptblock injected operation values before native calls' -TestCases @(
        @{ Operations = @{ BuildBaseline = $null } },
        @{ Operations = @{ BuildBaseline = 'invalid' } },
        @{ Operations = @{ Native = $null } },
        @{ Operations = @{ TerminationState = 'invalid' } },
        @{ Operations = @{ UtcClock = $null } }
    ) {
        param($Operations)
        $result = Invoke-TestDatabaseStateScenario -Probe1 't|t|t|t|0|0|f|f' -AdditionalOperations $Operations
        Assert-SafeBlockedRecord -Result $result -Alert 'READ_ONLY_DATABASE_STATE_FAILED'
        $result.Calls.Count | Should Be 0
    }
}
