[CmdletBinding()]
param([hashtable]$TestOperations)

Set-StrictMode -Version Latest

$phase = 'READ_ONLY_DATABASE_STATE'
$script:allowedOperationKeys = @('Native', 'TerminationState', 'BuildBaseline', 'UtcClock')
$script:record = $null

function New-DatabaseStateRecord {
    param([datetime]$UtcStart)

    return [pscustomobject][ordered]@{
        phase = $phase
        status = 'BLOCKED'
        classificationCode = ''
        checks = [pscustomobject][ordered]@{
            composeTargetValid = $false
            readOnlyConfirmed = $false
            databaseIdentityMatched = $false
            roleIdentityMatched = $false
            postgres16 = $false
            migrationMetadataPresent = $false
            migrationMetadataColumnsComplete = $false
        }
        boundedCounts = [pscustomobject][ordered]@{
            expectedMigrationCount = 0
            expectedApplicationTableCount = 0
            publicBaseTableCount = 0
            applicationBaseTableCount = 0
            migrationRecordCount = 0
            distinctMigrationNameCount = 0
            completedActiveMigrationCount = 0
            unresolvedActiveMigrationCount = 0
            rolledBackMigrationCount = 0
            expectedNameMatchCount = 0
            unexpectedNameCount = 0
            missingExpectedNameCount = 0
            duplicateNameCount = 0
            probeAttempts = 0
            databaseConnections = 0
            businessRowQueries = 0
            initializerExecutions = 0
            migrationExecutions = 0
            resetExecutions = 0
            bootstrapExecutions = 0
            defaultVolumeAccess = 0
        }
        alertCodes = [string[]]@()
        utcStart = $UtcStart
        utcEnd = $UtcStart
        elapsedSeconds = 0
    }
}

function Complete-DatabaseStateRecord {
    param(
        [Parameter(Mandatory)][object]$Record,
        [Parameter(Mandatory)][datetime]$UtcEnd
    )

    $Record.utcEnd = $UtcEnd
    $elapsed = ($UtcEnd.ToUniversalTime() - $Record.utcStart.ToUniversalTime()).TotalSeconds
    $Record.elapsedSeconds = [math]::Max(0, [math]::Round($elapsed, 3))
    return $Record
}

function Set-DatabaseStateFailure {
    param([Parameter(Mandatory)][string]$AlertCode)
    $script:record.status = 'BLOCKED'
    $script:record.classificationCode = ''
    $script:record.alertCodes = [string[]]@($AlertCode)
}

function Test-ExactOperationContract {
    param([hashtable]$Operations)
    if ($null -eq $Operations) { return $true }
    foreach ($key in $Operations.Keys) {
        if ([string]$key -cnotin $script:allowedOperationKeys -or $null -eq $Operations[$key] -or $Operations[$key] -isnot [scriptblock]) {
            return $false
        }
    }
    return $true
}

function Get-InjectedUtcNow {
    param([hashtable]$Operations)
    if ($null -eq $Operations -or -not $Operations.ContainsKey('UtcClock')) {
        return [datetime]::UtcNow
    }
    try {
        $values = @(& $Operations.UtcClock *>&1)
        if ($values.Count -ne 1 -or $values[0] -isnot [datetime]) { throw 'INVALID' }
        return ([datetime]$values[0]).ToUniversalTime()
    }
    catch {
        throw 'INVALID_CLOCK'
    }
}

function Test-StringArray {
    param([object]$Value)
    if ($Value -isnot [System.Array]) { return $false }
    return @($Value | Where-Object { $_ -isnot [string] }).Count -eq 0
}

function Test-ApprovedBaseline {
    param([object]$Baseline)
    try {
        if ($null -eq $Baseline) { return $false }
        $names = @($Baseline.PSObject.Properties.Name | Sort-Object)
        if (($names -join ',') -cne 'ApplicationTableNames,MigrationNames' -or
            -not (Test-StringArray -Value $Baseline.MigrationNames) -or
            -not (Test-StringArray -Value $Baseline.ApplicationTableNames)) { return $false }
        $migrations = [string[]]@($Baseline.MigrationNames)
        $tables = [string[]]@($Baseline.ApplicationTableNames)
        if ($migrations.Count -ne 12 -or $tables.Count -ne 45 -or
            @($migrations | Select-Object -Unique).Count -ne 12 -or
            @($tables | Select-Object -Unique).Count -ne 45) { return $false }
        if (@($migrations | Where-Object { $_ -cnotmatch '^[0-9]{14}_[a-z0-9_]+$' }).Count -ne 0 -or
            @($tables | Where-Object { $_ -cnotmatch '^[a-z][a-z0-9_]*$' -or $_ -ceq '_prisma_migrations' }).Count -ne 0) { return $false }
        return $true
    }
    catch { return $false }
}

function Get-ProductionBaseline {
    param([string]$ProjectRoot)
    if ([string]::IsNullOrEmpty($ProjectRoot)) {
        $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
        $ProjectRoot = Join-Path $repositoryRoot 'LayerManage\law-firm-system'
    }
    else {
        $ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
    }
    $migrationRoot = Join-Path $ProjectRoot 'apps\server\prisma\migrations'
    $directories = @(Get-ChildItem -LiteralPath $migrationRoot -Directory -ErrorAction Stop | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'migration.sql') -PathType Leaf })
    if ($directories.Count -ne 12) { throw 'INVALID' }
    $migrationNames = [string[]]@($directories | ForEach-Object { [string]$_.Name })
    $tables = New-Object System.Collections.Generic.List[string]
    foreach ($directory in $directories) {
        $sqlPath = Join-Path $directory.FullName 'migration.sql'
        $sqlText = [System.IO.File]::ReadAllText($sqlPath)
        foreach ($match in [regex]::Matches($sqlText, '(?m)CREATE\s+TABLE\s+"([a-z][a-z0-9_]*)"', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)) {
            [void]$tables.Add([string]$match.Groups[1].Value)
        }
    }
    $schemaPath = Join-Path $ProjectRoot 'apps\server\prisma\schema.prisma'
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw 'INVALID' }
    $models = New-Object System.Collections.Generic.List[string]
    foreach ($model in [regex]::Matches([System.IO.File]::ReadAllText($schemaPath), '(?ms)^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{(.*?)^\s*\}')) {
        $mapping = [regex]::Match($model.Groups[2].Value, '(?m)^\s*@@map\("([a-z][a-z0-9_]*)"\)\s*$')
        if (-not $mapping.Success) { throw 'INVALID' }
        [void]$models.Add([string]$mapping.Groups[1].Value)
    }
    if ($models.Count -ne 45 -or @($models | Select-Object -Unique).Count -ne 45 -or
        @($models | Where-Object { $_ -ceq '_prisma_migrations' }).Count -ne 0 -or
        (@($models | Sort-Object) -join ',') -cne (@($tables | Sort-Object) -join ',')) { throw 'INVALID' }
    return [pscustomobject]@{ MigrationNames = $migrationNames; ApplicationTableNames = [string[]]@($models) }
}

function ConvertFrom-DatabaseStateProbe {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Lines,
        [Parameter(Mandatory)][int]$FieldCount,
        [Parameter(Mandatory)][AllowEmptyCollection()][int[]]$BooleanPositions
    )
    if ($Lines.Count -ne 1) { return $null }
    $parts = @($Lines[0].Split([char]'|'))
    if ($parts.Count -ne $FieldCount) { return $null }
    $values = New-Object System.Collections.Generic.List[object]
    for ($index = 0; $index -lt $parts.Count; $index++) {
        if ($BooleanPositions -contains $index) {
            if ($parts[$index] -ceq 't') { [void]$values.Add($true) }
            elseif ($parts[$index] -ceq 'f') { [void]$values.Add($false) }
            else { return $null }
        }
        else {
            if ($parts[$index] -cnotmatch '^(0|[1-9][0-9]{0,3})$') { return $null }
            [long]$number = 0
            if (-not [long]::TryParse($parts[$index], [ref]$number) -or $number -gt 1000) { return $null }
            [void]$values.Add($number)
        }
    }
    return [object[]]$values.ToArray()
}

function Invoke-DatabaseStateProbe1 {
    param(
        [Parameter(Mandatory)][object]$Target,
        [Parameter(Mandatory)][string]$Sql,
        [Parameter(Mandatory)][hashtable]$Operations
    )
    $readOnlyOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'
    $timeoutMilliseconds = 15000
    $tail = @('exec', '-T', '-e', $readOnlyOptions, 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c', $Sql)
    $script:record.boundedCounts.probeAttempts++
    $script:record.boundedCounts.databaseConnections++
    $arguments = New-LocalPreproductionComposeArguments -Target $Target -CommandArguments $tail
    if ($null -ne $Operations -and $Operations.ContainsKey('Native')) {
        return Invoke-LocalPreproductionNative -FilePath 'docker' -Arguments $arguments -TimeoutMilliseconds $timeoutMilliseconds -TestOperation $Operations.Native -TestTerminationState $operations.TerminationState
    }
    return Invoke-LocalPreproductionNative -FilePath 'docker' -Arguments $arguments -TimeoutMilliseconds $timeoutMilliseconds
}

function Invoke-DatabaseStateProbe2 {
    param(
        [Parameter(Mandatory)][object]$Target,
        [Parameter(Mandatory)][string]$Sql,
        [Parameter(Mandatory)][hashtable]$Operations
    )
    $readOnlyOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'
    $timeoutMilliseconds = 15000
    $tail = @('exec', '-T', '-e', $readOnlyOptions, 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c', $Sql)
    $script:record.boundedCounts.probeAttempts++
    $script:record.boundedCounts.databaseConnections++
    $arguments = New-LocalPreproductionComposeArguments -Target $Target -CommandArguments $tail
    if ($null -ne $Operations -and $Operations.ContainsKey('Native')) {
        return Invoke-LocalPreproductionNative -FilePath 'docker' -Arguments $arguments -TimeoutMilliseconds $timeoutMilliseconds -TestOperation $Operations.Native -TestTerminationState $operations.TerminationState
    }
    return Invoke-LocalPreproductionNative -FilePath 'docker' -Arguments $arguments -TimeoutMilliseconds $timeoutMilliseconds
}

function Test-MigrationAggregateArithmetic {
    param([long[]]$Counts)
    $records = $Counts[0]; $distinct = $Counts[1]; $completed = $Counts[2]; $unresolved = $Counts[3]
    $rolledBack = $Counts[4]; $matches = $Counts[5]; $unexpected = $Counts[6]; $missing = $Counts[7]; $duplicates = $Counts[8]
    if ($distinct -gt $records -or $matches -gt 12 -or $missing -gt 12 -or $matches + $missing -ne 12 -or
        $matches + $unexpected -ne $distinct -or $duplicates -ne ($records - $distinct)) { return $false }
    $categoryTotal = $completed + $unresolved + $rolledBack
    if ($categoryTotal -gt $records) { return $false }
    if ($categoryTotal -ne $records) { return $false }
    return $true
}

$operations = @{}
if ($null -ne $TestOperations) {
    foreach ($key in $TestOperations.Keys) { $operations[[string]$key] = $TestOperations[$key] }
}
$started = [datetime]::UtcNow
$script:record = New-DatabaseStateRecord -UtcStart $started
try {
    $invalidOperationContract = $false
    if ($null -ne $TestOperations) {
        foreach ($key in @($TestOperations.Keys)) {
            $name = [string]$key
            if (-not ($script:allowedOperationKeys -contains $name) -or
                $null -eq $TestOperations[$key] -or
                $TestOperations[$key] -isnot [scriptblock]) {
                $invalidOperationContract = $true
            }
        }
    }
    if ($invalidOperationContract) { throw 'OPERATION_CONTRACT' }
    $started = Get-InjectedUtcNow -Operations $TestOperations
    $script:record.utcStart = $started
    $script:record.utcEnd = $started

    try {
        if ($operations.ContainsKey('BuildBaseline')) {
            $baselineOperation = $operations['BuildBaseline']
            $baseline = @(& $baselineOperation *>&1)
        }
        else {
            $baseline = @(Get-ProductionBaseline)
        }
    }
    catch { throw 'BASELINE' }
    if ($baseline.Count -ne 1 -or -not (Test-ApprovedBaseline -Baseline $baseline[0])) { throw 'BASELINE' }
    $baseline = $baseline[0]
    $script:record.boundedCounts.expectedMigrationCount = 12
    $script:record.boundedCounts.expectedApplicationTableCount = 45

    Import-Module (Join-Path $PSScriptRoot 'LocalPreproduction.Core.psm1') -ErrorAction Stop | Out-Null
    $composePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\LayerManage\law-firm-system\infra\postgres\compose.yml'))
    try {
        $target = Get-LocalPreproductionComposeTarget -ComposePath $composePath -TestOperation $operations.Native -TestTerminationState $operations.TerminationState
        $script:record.checks.composeTargetValid = $true
    }
    catch {
        if ([string]$_.Exception.Message -ceq 'NATIVE_TERMINATION_UNCONFIRMED') { throw 'TERMINATION' }
        throw 'COMPOSE'
    }

    $expectedApplicationValues = @($baseline.ApplicationTableNames | ForEach-Object { "('" + $_.Replace("'", "''") + "')" }) -join ', '
    $probe1Sql = @"
WITH expected_application_tables(table_name) AS (VALUES $expectedApplicationValues), public_tables AS (
    SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
), application_tables AS (
    SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name IN (SELECT table_name FROM expected_application_tables)
), metadata_columns AS (
    SELECT count(*) AS count FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
      AND column_name IN ('migration_name', 'finished_at', 'rolled_back_at')
)
SELECT CASE WHEN current_setting('transaction_read_only') = 'on' THEN 't' ELSE 'f' END || '|' ||
       CASE WHEN current_database() = 'chengyeoa_preprod' THEN 't' ELSE 'f' END || '|' ||
       CASE WHEN current_user = 'chengyeoa_preprod' THEN 't' ELSE 'f' END || '|' ||
       CASE WHEN substring(current_setting('server_version_num') FROM 1 FOR 2) = '16' THEN 't' ELSE 'f' END || '|' ||
       (SELECT count FROM public_tables) || '|' || (SELECT count FROM application_tables) || '|' ||
       CASE WHEN to_regclass('_prisma_migrations') IS NOT NULL THEN 't' ELSE 'f' END || '|' ||
       CASE WHEN (SELECT count FROM metadata_columns) = 3 THEN 't' ELSE 'f' END
"@
    $native1 = Invoke-DatabaseStateProbe1 -Target $target -Sql $probe1Sql -Operations $operations
    if (-not $native1.TerminationConfirmed) { throw 'TERMINATION' }
    if (-not $native1.Succeeded) { throw 'NATIVE' }
    try {
        if (@($native1.Lines).Count -eq 0) { throw 'INVALID' }
        $probe1 = ConvertFrom-DatabaseStateProbe -Lines $native1.Lines -FieldCount 8 -BooleanPositions @(0, 1, 2, 3, 6, 7)
    }
    catch { throw 'OUTPUT' }
    if ($null -eq $probe1) { throw 'OUTPUT' }
    $script:record.checks.readOnlyConfirmed = [bool]$probe1[0]
    $script:record.checks.databaseIdentityMatched = [bool]$probe1[1]
    $script:record.checks.roleIdentityMatched = [bool]$probe1[2]
    $script:record.checks.postgres16 = [bool]$probe1[3]
    $script:record.boundedCounts.publicBaseTableCount = [long]$probe1[4]
    $script:record.boundedCounts.applicationBaseTableCount = [long]$probe1[5]
    $script:record.checks.migrationMetadataPresent = [bool]$probe1[6]
    $script:record.checks.migrationMetadataColumnsComplete = [bool]$probe1[7]
    if (-not $probe1[0]) { throw 'READ_ONLY' }
    if (-not $probe1[1] -or -not $probe1[2] -or -not $probe1[3]) { throw 'TARGET' }

    $publicCount = [long]$probe1[4]; $applicationCount = [long]$probe1[5]
    $metadataPresent = [bool]$probe1[6]; $columnsComplete = [bool]$probe1[7]
    if (-not $metadataPresent) {
        if ($publicCount -eq 0 -and $applicationCount -eq 0) {
            $script:record.status = 'READY'; $script:record.classificationCode = 'DATABASE_STATE_NO_EFFECT'; $script:record.alertCodes = [string[]]@()
        }
        else { $script:record.status = 'READY'; $script:record.classificationCode = 'DATABASE_STATE_INCONSISTENT'; $script:record.alertCodes = [string[]]@() }
        throw 'CLASSIFIED'
    }
    if (-not $columnsComplete -or $publicCount -ne ($applicationCount + 1)) {
        $script:record.status = 'READY'; $script:record.classificationCode = 'DATABASE_STATE_INCONSISTENT'; $script:record.alertCodes = [string[]]@()
        throw 'CLASSIFIED'
    }

    $expectedValues = @($baseline.MigrationNames | ForEach-Object { "('" + $_.Replace("'", "''") + "')" }) -join ', '
    $probe2Sql = @"
WITH expected_migrations(migration_name) AS (VALUES $expectedValues), migration_rows AS (
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
), aggregate AS (
    SELECT count(*)::bigint AS records, count(DISTINCT migration_name)::bigint AS distinct_names,
           count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS completed_active,
           count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::bigint AS unresolved_active,
           count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::bigint AS rolled_back,
           count(DISTINCT migration_name) FILTER (WHERE migration_name IN (SELECT migration_name FROM expected_migrations))::bigint AS expected_matches,
           count(DISTINCT migration_name) FILTER (WHERE migration_name NOT IN (SELECT migration_name FROM expected_migrations))::bigint AS unexpected,
           count(*)::bigint - count(DISTINCT migration_name)::bigint AS duplicate_names
    FROM migration_rows
)
SELECT records || '|' || distinct_names || '|' || completed_active || '|' || unresolved_active || '|' || rolled_back || '|' || expected_matches || '|' || unexpected || '|' || (12 - expected_matches) || '|' || duplicate_names FROM aggregate
"@
    $native2 = Invoke-DatabaseStateProbe2 -Target $target -Sql $probe2Sql -Operations $operations
    if (-not $native2.TerminationConfirmed) { throw 'TERMINATION' }
    if (-not $native2.Succeeded) { throw 'NATIVE' }
    try {
        if (@($native2.Lines).Count -eq 0) { throw 'INVALID' }
        $probe2 = ConvertFrom-DatabaseStateProbe -Lines $native2.Lines -FieldCount 9 -BooleanPositions @()
    }
    catch { throw 'OUTPUT' }
    if ($null -eq $probe2) { throw 'OUTPUT' }
    $countProperties = @('migrationRecordCount','distinctMigrationNameCount','completedActiveMigrationCount','unresolvedActiveMigrationCount','rolledBackMigrationCount','expectedNameMatchCount','unexpectedNameCount','missingExpectedNameCount','duplicateNameCount')
    for ($index = 0; $index -lt $countProperties.Count; $index++) { $script:record.boundedCounts.($countProperties[$index]) = [long]$probe2[$index] }
    if (-not (Test-MigrationAggregateArithmetic -Counts ([long[]]$probe2))) {
        $script:record.status = 'READY'; $script:record.classificationCode = 'DATABASE_STATE_INCONSISTENT'; $script:record.alertCodes = [string[]]@()
        throw 'CLASSIFIED'
    }
    if ($applicationCount -eq 0 -and $probe2[2] -eq 12 -and $probe2[5] -eq 12 -and $probe2[3] -eq 0 -and $probe2[4] -eq 0 -and $probe2[6] -eq 0 -and $probe2[7] -eq 0 -and $probe2[8] -eq 0) { $classification = 'DATABASE_STATE_INCONSISTENT' }
    elseif ($applicationCount -eq 0) { $classification = 'DATABASE_STATE_METADATA_ONLY' }
    elseif ($applicationCount -gt 45) { $classification = 'DATABASE_STATE_INCONSISTENT' }
    elseif ($applicationCount -lt 45) { $classification = 'DATABASE_STATE_PARTIAL' }
    elseif ($publicCount -eq 46 -and $probe2[2] -eq 12 -and $probe2[5] -eq 12 -and $probe2[3] -eq 0 -and $probe2[4] -eq 0 -and $probe2[6] -eq 0 -and $probe2[7] -eq 0 -and $probe2[8] -eq 0) { $classification = 'DATABASE_STATE_COMPLETE' }
    else { $classification = 'DATABASE_STATE_PARTIAL' }
    $script:record.status = 'READY'; $script:record.classificationCode = $classification; $script:record.alertCodes = [string[]]@()
}
catch {
    $reason = [string]$_.Exception.Message
    if ($reason -cne 'CLASSIFIED') {
        switch ($reason) {
            'BASELINE' { Set-DatabaseStateFailure -AlertCode 'BUILD_BASELINE_MISMATCH' }
            'COMPOSE' { Set-DatabaseStateFailure -AlertCode 'COMPOSE_TARGET_INVALID' }
            'READ_ONLY' { Set-DatabaseStateFailure -AlertCode 'READ_ONLY_GUARD_FAILED' }
            'TARGET' { Set-DatabaseStateFailure -AlertCode 'DATABASE_TARGET_MISMATCH' }
            'OUTPUT' { Set-DatabaseStateFailure -AlertCode 'DATABASE_STATE_OUTPUT_INVALID' }
            'TERMINATION' { Set-DatabaseStateFailure -AlertCode 'NATIVE_TERMINATION_UNCONFIRMED' }
            default { Set-DatabaseStateFailure -AlertCode 'READ_ONLY_DATABASE_STATE_FAILED' }
        }
    }
}
$ended = try { Get-InjectedUtcNow -Operations $TestOperations } catch { [datetime]::UtcNow }
Complete-DatabaseStateRecord -Record $script:record -UtcEnd $ended
