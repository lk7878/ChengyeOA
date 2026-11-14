param(
    [switch]$ConfirmEmptyDatabaseReset,
    [hashtable]$TestOperations
)

& {
    param(
        [bool]$ResetConfirmed,
        [hashtable]$InjectedOperations
    )

    $phase = 'local_preproduction_database_reset'
    $started = [datetime]::UtcNow
    $counts = @{
        confirmationAuthorized = $(if ($ResetConfirmed) { 1 } else { 0 })
        bundleValid = 0
        environmentMatched = 0
        composeTargetValid = 0
        applicationTableCount = 0
        destructiveAuthorizationCount = 0
        databaseStarted = 0
        databaseHealthy = 0
        databaseEmptyAsserted = 0
        migrationApplied = 0
        migratedRetryStateReady = 0
        bootstrapContractReady = 0
        administratorBootstrapped = 0
    }
    $newRecord = {
        param([string]$Status, [string[]]$AlertCodes, [string]$RecordPhase = $phase)

        return New-SafeStatusRecord `
            -Phase $RecordPhase `
            -Status $Status `
            -BoundedCounts $counts `
            -AlertCodes @($AlertCodes) `
            -UtcStart $started `
            -UtcEnd ([datetime]::UtcNow)
    }.GetNewClosure()

    try {
        Import-Module (Join-Path $PSScriptRoot 'ProductionRolloutRunner.Core.psm1') -Force -ErrorAction Stop
        Import-Module (Join-Path $PSScriptRoot 'LocalPreproduction.Core.psm1') -Force -ErrorAction Stop
    }
    catch {
        return [ordered]@{
            phase = $phase
            status = 'BLOCKED'
            boundedCounts = $counts
            alertCodes = @('MODULE_IMPORT_FAILED')
            utcStart = $started.ToString('o')
            utcEnd = ([datetime]::UtcNow).ToString('o')
            elapsedSeconds = 0
        }
    }

    if (-not $ResetConfirmed) {
        return & $newRecord 'BLOCKED' @('DATABASE_RESET_CONFIRMATION_REQUIRED')
    }

    $nativeTestOperation = $null
    $nativeTerminationState = $null
    $inheritedConsoleTestOperation = $null
    $utcNow = { return [datetime]::UtcNow }
    $sleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
    $sleepMilliseconds = { param([int]$Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    $healthBudgetMilliseconds = 120000
    if ($null -ne $InjectedOperations) {
        foreach ($name in $InjectedOperations.Keys) {
            if ([string]$name -ceq 'HealthBudgetMilliseconds') {
                if ($InjectedOperations[$name] -isnot [int] -or
                    [int]$InjectedOperations[$name] -lt 1 -or
                    [int]$InjectedOperations[$name] -gt 120000) {
                    return & $newRecord 'BLOCKED' @('TEST_OVERRIDE_INVALID')
                }
            }
            elseif ([string]$name -cnotin @('Native', 'TerminationState', 'InheritedConsole', 'UtcNow', 'Sleep', 'SleepMilliseconds') -or
                $InjectedOperations[$name] -isnot [scriptblock]) {
                return & $newRecord 'BLOCKED' @('TEST_OVERRIDE_INVALID')
            }
        }
        if ($InjectedOperations.ContainsKey('Native')) { $nativeTestOperation = $InjectedOperations['Native'] }
        if ($InjectedOperations.ContainsKey('TerminationState')) { $nativeTerminationState = $InjectedOperations['TerminationState'] }
        if ($InjectedOperations.ContainsKey('InheritedConsole')) {
            $inheritedConsoleTestOperation = $InjectedOperations['InheritedConsole']
        }
        if ($InjectedOperations.ContainsKey('UtcNow')) { $utcNow = $InjectedOperations['UtcNow'] }
        if ($InjectedOperations.ContainsKey('SleepMilliseconds')) {
            $sleepMilliseconds = $InjectedOperations['SleepMilliseconds']
        }
        elseif ($InjectedOperations.ContainsKey('Sleep')) {
            $sleep = $InjectedOperations['Sleep']
            $sleepMilliseconds = {
                param([int]$Milliseconds)
                & $sleep ([int][math]::Ceiling($Milliseconds / 1000.0))
            }.GetNewClosure()
        }
        if ($InjectedOperations.ContainsKey('HealthBudgetMilliseconds')) {
            $healthBudgetMilliseconds = [int]$InjectedOperations['HealthBudgetMilliseconds']
        }
    }

    $allowed = @(
        'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
        'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
        'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
        'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
    )
    $bundlePath = $null
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $bundlePath = Join-Path $env:LOCALAPPDATA 'ChengyeOA\local-preproduction\environment.dpapi'
    }
    if ($null -eq $bundlePath -or -not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
        return & $newRecord 'BLOCKED' @('SECRET_BUNDLE_MISSING')
    }
    try {
        $bundle = Unprotect-LocalPreproductionBundle -LiteralPath $bundlePath
    }
    catch {
        return & $newRecord 'BLOCKED' @('SECRET_BUNDLE_INVALID')
    }

    $bundleGate = Test-LocalPreproductionEnvironment -Environment $bundle
    if ($bundleGate.status -cne 'READY') {
        return & $newRecord 'BLOCKED' @($bundleGate.alertCodes)
    }
    $counts.bundleValid = 1

    $current = @{}
    foreach ($name in $allowed) {
        $current[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    foreach ($name in $allowed) {
        if ([string]$current[$name] -cne [string]$bundle[$name]) {
            return & $newRecord 'BLOCKED' @('ENVIRONMENT_BUNDLE_MISMATCH')
        }
    }
    $currentGate = Test-LocalPreproductionEnvironment -Environment $current
    if ($currentGate.status -cne 'READY') {
        return & $newRecord 'BLOCKED' @($currentGate.alertCodes)
    }
    if ([string]$current['NODE_ENV'] -cne 'production') {
        return & $newRecord 'BLOCKED' @('NODE_ENV_NOT_PRODUCTION')
    }
    if ([string]$current['EVENT_WORKER_ENABLED'] -cne 'false') {
        return & $newRecord 'BLOCKED' @('EVENT_WORKER_NOT_DISABLED')
    }
    $counts.environmentMatched = 1

    $composePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\LayerManage\law-firm-system\infra\postgres\compose.yml'))
    try {
        $target = Get-LocalPreproductionComposeTarget `
            -ComposePath $composePath `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
    }
    catch {
        $alert = if ([string]$_.Exception.Message -ceq 'NATIVE_TERMINATION_UNCONFIRMED') {
            'NATIVE_TERMINATION_UNCONFIRMED'
        }
        elseif ([string]$_.Exception.Message -ceq 'COMPOSE_METADATA_FAILED') {
            'COMPOSE_METADATA_FAILED'
        }
        else {
            'COMPOSE_TARGET_INVALID'
        }
        return & $newRecord 'BLOCKED' @($alert)
    }
    $counts.composeTargetValid = 1

    $waitForDatabaseHealth = {
        $healthStarted = [datetime](& $utcNow)
        $healthDeadline = $healthStarted.AddMilliseconds($healthBudgetMilliseconds)
        $healthWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $healthAttempt = 0
        $databaseHealthy = $false
        $sleepReserveMilliseconds = 25
        while ($healthAttempt -lt 5 -and $healthWatch.ElapsedMilliseconds -lt $healthBudgetMilliseconds) {
            $logicalNow = [datetime](& $utcNow)
            if ($logicalNow -ge $healthDeadline) {
                break
            }
            $realRemaining = $healthBudgetMilliseconds - [int]$healthWatch.ElapsedMilliseconds
            $terminationReserve = if ($null -eq $nativeTestOperation) { 1000 } else { 0 }
            if ($realRemaining -le $terminationReserve) {
                break
            }
            $logicalRemaining = [math]::Max(1, [int][math]::Ceiling(($healthDeadline - $logicalNow).TotalMilliseconds))
            $healthTimeout = [math]::Min(($realRemaining - $terminationReserve), $logicalRemaining)
            $healthAttempt++
            $health = Invoke-LocalPreproductionNative `
                -FilePath 'docker' `
                -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('exec', '-T', 'postgres', 'pg_isready', '-q')) `
                -TimeoutMilliseconds $healthTimeout `
                -TestOperation $nativeTestOperation `
                -TestTerminationState $nativeTerminationState
            if (-not $health.TerminationConfirmed) {
                $healthWatch.Stop()
                return 'NATIVE_TERMINATION_UNCONFIRMED'
            }
            if ($health.Succeeded) {
                $healthWatch.Stop()
                $counts.databaseHealthy = 1
                $databaseHealthy = $true
                break
            }
            if ($healthAttempt -ge 5 -or $healthWatch.ElapsedMilliseconds -ge $healthBudgetMilliseconds) {
                break
            }
            $logicalNow = [datetime](& $utcNow)
            if ($logicalNow -ge $healthDeadline) {
                break
            }
            $realRemaining = $healthBudgetMilliseconds - [int]$healthWatch.ElapsedMilliseconds
            if ($realRemaining -le $sleepReserveMilliseconds) {
                break
            }
            $logicalRemaining = [int][math]::Ceiling(($healthDeadline - $logicalNow).TotalMilliseconds)
            $postReserveRealRemaining = $realRemaining - $sleepReserveMilliseconds
            $sleepDuration = [math]::Min(30000, [math]::Min($postReserveRealRemaining, $logicalRemaining))
            if ($sleepDuration -le 0) {
                break
            }
            & $sleepMilliseconds ([int]$sleepDuration)
        }
        $healthWatch.Stop()
        if (-not $databaseHealthy) {
            return 'DATABASE_HEALTH_TIMEOUT'
        }
        return ''
    }.GetNewClosure()

    $baselineUp = Invoke-LocalPreproductionNative `
        -FilePath 'docker' `
        -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('up', '-d')) `
        -TestOperation $nativeTestOperation `
        -TestTerminationState $nativeTerminationState
    if (-not $baselineUp.TerminationConfirmed) {
        return & $newRecord 'BLOCKED' @('NATIVE_TERMINATION_UNCONFIRMED')
    }
    if (-not $baselineUp.Succeeded) {
        return & $newRecord 'BLOCKED' @('DATABASE_START_FAILED')
    }
    $counts.databaseStarted = 1

    $baselineHealthAlert = [string](& $waitForDatabaseHealth)
    if (-not [string]::IsNullOrEmpty($baselineHealthAlert)) {
        return & $newRecord 'BLOCKED' @($baselineHealthAlert)
    }
    & $newRecord 'READY' @() 'ISOLATED_BASELINE_READY'

    $countSql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
    $countResult = Invoke-LocalPreproductionNative `
        -FilePath 'docker' `
        -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @(
            'exec', '-T', 'postgres',
            'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c', $countSql
        )) `
        -TestOperation $nativeTestOperation `
        -TestTerminationState $nativeTerminationState
    if (-not $countResult.TerminationConfirmed) {
        return & $newRecord 'BLOCKED' @('NATIVE_TERMINATION_UNCONFIRMED')
    }
    if (-not $countResult.Succeeded -or $countResult.Lines.Count -ne 1) {
        return & $newRecord 'BLOCKED' @('DATABASE_EMPTY_CHECK_FAILED')
    }
    $tableCount = 0L
    $countText = [string]$countResult.Lines[0]
    if ($countText -cnotmatch '^(0|[1-9][0-9]*)$' -or
        -not [long]::TryParse($countText, [ref]$tableCount)) {
        return & $newRecord 'BLOCKED' @('DATABASE_EMPTY_CHECK_FAILED')
    }
    $resumeCandidate = $tableCount -gt 0
    $counts.applicationTableCount = $(if ($resumeCandidate) { 1 } else { 0 })
    if (-not $resumeCandidate) {
        & $newRecord 'READY' @() 'ISOLATED_DATABASE_EMPTY'

        $downResult = Invoke-LocalPreproductionNative `
            -FilePath 'docker' `
            -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('down', '--volumes')) `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
        $counts.destructiveAuthorizationCount = 1
        if (-not $downResult.TerminationConfirmed) {
            return & $newRecord 'BLOCKED' @('NATIVE_TERMINATION_UNCONFIRMED')
        }
        if (-not $downResult.Succeeded) {
            return & $newRecord 'BLOCKED' @('DATABASE_RESET_FAILED')
        }

        $upResult = Invoke-LocalPreproductionNative `
            -FilePath 'docker' `
            -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('up', '-d')) `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
        if (-not $upResult.TerminationConfirmed) {
            return & $newRecord 'BLOCKED' @('NATIVE_TERMINATION_UNCONFIRMED')
        }
        if (-not $upResult.Succeeded) {
            return & $newRecord 'BLOCKED' @('DATABASE_START_FAILED')
        }
        $counts.databaseStarted = 1

        $postResetHealthAlert = [string](& $waitForDatabaseHealth)
        if (-not [string]::IsNullOrEmpty($postResetHealthAlert)) {
            return & $newRecord 'BLOCKED' @($postResetHealthAlert)
        }

        & $newRecord 'READY' @() 'DATABASE_READY'
    }

    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\LayerManage\law-firm-system'))
    $originalLocation = Get-Location
    try {
        Set-Location -LiteralPath $projectRoot -ErrorAction Stop

        if ($resumeCandidate) {
            $preResumeAssert = Invoke-LocalPreproductionNative `
                -FilePath 'npm.cmd' `
                -Arguments @('run', 'db:assert-empty') `
                -TimeoutMilliseconds 120000 `
                -TestOperation $nativeTestOperation `
                -TestTerminationState $nativeTerminationState
            if (-not $preResumeAssert.Succeeded) {
                return & $newRecord 'BLOCKED' @('MIGRATED_RETRY_STATE_UNSAFE') 'MIGRATED_RETRY_STATE'
            }
            $counts.migratedRetryStateReady = 1
            & $newRecord 'READY' @() 'MIGRATED_RETRY_STATE_READY'
        }

        $migration = Invoke-LocalPreproductionNative `
            -FilePath 'npm.cmd' `
            -Arguments @('run', 'db:deploy') `
            -TimeoutMilliseconds 600000 `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
        if (-not $migration.Succeeded) {
            return & $newRecord 'BLOCKED' @('MIGRATION_FAILED') 'MIGRATION'
        }
        $counts.migrationApplied = 1
        & $newRecord 'READY' @() 'MIGRATED'

        $assertEmpty = Invoke-LocalPreproductionNative `
            -FilePath 'npm.cmd' `
            -Arguments @('run', 'db:assert-empty') `
            -TimeoutMilliseconds 120000 `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
        if (-not $assertEmpty.Succeeded) {
            return & $newRecord 'BLOCKED' @('DATABASE_NOT_EMPTY') 'DATABASE_ASSERT_EMPTY'
        }
        $counts.databaseEmptyAsserted = 1
        & $newRecord 'READY' @() 'DATABASE_ASSERT_EMPTY'

        $bootstrapContract = Invoke-LocalPreproductionNative `
            -FilePath 'npm.cmd' `
            -Arguments @('run', 'check:bootstrap') `
            -TimeoutMilliseconds 120000 `
            -TestOperation $nativeTestOperation `
            -TestTerminationState $nativeTerminationState
        if (-not $bootstrapContract.Succeeded) {
            return & $newRecord 'BLOCKED' @('BOOTSTRAP_CONTRACT_FAILED') 'BOOTSTRAP_CONTRACT'
        }
        $counts.bootstrapContractReady = 1
        & $newRecord 'READY' @() 'BOOTSTRAP_CONTRACT_READY'

        & $newRecord 'WAITING' @() 'WAITING_OPERATOR_SECRET_INPUT'
        $waitingRecordEmitted = $true

        $bootstrapExitCode = 70
        if ($null -ne $inheritedConsoleTestOperation) {
            try {
                $consoleResult = @(& $inheritedConsoleTestOperation `
                    -FilePath 'npm.cmd' `
                    -Arguments ([string[]]@('--silent', '--prefix', 'apps/server', 'run', 'system:bootstrap', '--', '--safe-interactive')) `
                    -WorkingDirectory $projectRoot `
                    -InheritStandardInput $true `
                    -InheritStandardOutput $true `
                    -InheritStandardError $true `
                    -WaitingRecordEmitted $waitingRecordEmitted *>&1)
                if ($consoleResult.Count -eq 1 -and $consoleResult[0] -is [int]) {
                    $bootstrapExitCode = [int]$consoleResult[0]
                }
            }
            catch {
                $bootstrapExitCode = 70
            }
        }
        else {
            try {
                $bootstrapProcess = Start-Process `
                    -FilePath 'npm.cmd' `
                    -ArgumentList @('--silent', '--prefix', 'apps/server', 'run', 'system:bootstrap', '--', '--safe-interactive') `
                    -WorkingDirectory $projectRoot `
                    -NoNewWindow `
                    -Wait `
                    -PassThru `
                    -ErrorAction Stop
                $bootstrapExitCode = [int]$bootstrapProcess.ExitCode
            }
            catch {
                $bootstrapExitCode = 70
            }
        }
        if ($bootstrapExitCode -ne 0) {
            return & $newRecord 'BLOCKED' @('ADMIN_BOOTSTRAP_FAILED') 'ADMIN_BOOTSTRAP'
        }
        $counts.administratorBootstrapped = 1
        return & $newRecord 'READY' @() 'ADMIN_BOOTSTRAPPED'
    }
    catch {
        return & $newRecord 'BLOCKED' @('MIGRATION_FAILED') 'MIGRATION'
    }
    finally {
        Set-Location -LiteralPath $originalLocation.ProviderPath
    }
} $ConfirmEmptyDatabaseReset.IsPresent $TestOperations
