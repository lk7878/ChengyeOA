param([hashtable]$TestOperations)

& {
    param([hashtable]$InjectedOperations)

    $started = [datetime]::UtcNow
    $phase = 'local_preproduction_environment_load'
    $runnerModulePath = Join-Path $PSScriptRoot 'ProductionRolloutRunner.Core.psm1'
    $coreModulePath = Join-Path $PSScriptRoot 'LocalPreproduction.Core.psm1'
    $projectRoot = Join-Path $PSScriptRoot '..\LayerManage\law-firm-system'
    $allowed = @(
        'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
        'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
        'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
        'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
    )

    function New-LoaderFallbackRecord {
        param(
            [string]$AlertCode,
            [int]$ToolchainReady = 0
        )

        return [ordered]@{
            phase = $phase
            status = 'BLOCKED'
            boundedCounts = @{ environmentImported = 0; toolchainReady = $ToolchainReady }
            alertCodes = @($AlertCode)
            utcStart = $started.ToString('o')
            utcEnd = ([datetime]::UtcNow).ToString('o')
            elapsedSeconds = 0L
        }
    }

    try {
        Import-Module $runnerModulePath -Force -ErrorAction Stop | Out-Null
        Import-Module $coreModulePath -Force -ErrorAction Stop | Out-Null
    }
    catch {
        return New-LoaderFallbackRecord -AlertCode 'MODULE_IMPORT_FAILED'
    }

    $operations = @{
        GetProcessValue = {
            param([string]$Name)
            return [Environment]::GetEnvironmentVariable($Name, 'Process')
        }
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)
            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        }
        ValidateEnvironment = {
            param([System.Collections.IDictionary]$Environment)
            return Test-LocalPreproductionEnvironment -Environment $Environment
        }
        NewStatusRecord = {
            param(
                [string]$Status,
                [string[]]$AlertCodes,
                [int]$EnvironmentImported,
                [int]$ToolchainReady,
                [datetime]$UtcStart
            )
            return New-SafeStatusRecord `
                -Phase 'local_preproduction_environment_load' `
                -Status $Status `
                -BoundedCounts @{
                    environmentImported = $EnvironmentImported
                    toolchainReady = $ToolchainReady
                } `
                -AlertCodes $AlertCodes `
                -UtcStart $UtcStart `
                -UtcEnd ([datetime]::UtcNow)
        }
    }
    if ($null -ne $InjectedOperations) {
        foreach ($name in @('GetProcessValue', 'SetProcessValue', 'ValidateEnvironment', 'NewStatusRecord')) {
            if ($InjectedOperations.ContainsKey($name) -and $InjectedOperations[$name] -is [scriptblock]) {
                $operations[$name] = $InjectedOperations[$name]
            }
        }
    }

    function New-LoaderRecord {
        param(
            [string]$Status,
            [string[]]$AlertCodes,
            [int]$EnvironmentImported,
            [int]$ToolchainReady
        )

        return & $operations.NewStatusRecord $Status $AlertCodes $EnvironmentImported $ToolchainReady $started
    }

    function Invoke-LoaderCapturedCommand {
        param(
            [string]$FilePath,
            [string[]]$ArgumentList,
            [string]$WorkingDirectory
        )

        $previousLocation = Get-Location
        try {
            Set-Location -LiteralPath $WorkingDirectory -ErrorAction Stop
            $output = @(& $FilePath @ArgumentList 2>$null)
            $exitCode = $LASTEXITCODE
            return [pscustomobject]@{
                ExitCode = if ($null -eq $exitCode) { -1 } else { [int]$exitCode }
                StdOut = [string]::Join([Environment]::NewLine, @($output | ForEach-Object { [string]$_ }))
            }
        }
        catch {
            return [pscustomobject]@{ ExitCode = -1; StdOut = '' }
        }
        finally {
            Set-Location -LiteralPath $previousLocation.Path
        }
    }

    function Get-LoaderFirstCommandPath {
        param(
            [string]$PathValue,
            [string]$LeafName
        )

        foreach ($pathPart in @($PathValue.Split([System.IO.Path]::PathSeparator))) {
            if ([string]::IsNullOrWhiteSpace($pathPart) -or
                $pathPart.Contains('"') -or
                -not [System.IO.Path]::IsPathRooted($pathPart)) {
                continue
            }
            try {
                $candidate = [System.IO.Path]::GetFullPath((Join-Path $pathPart $LeafName))
            }
            catch {
                continue
            }
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return $candidate
            }
        }
        return $null
    }

    function Restore-LoaderSnapshot {
        param([hashtable]$Snapshot)

        $attempts = 0
        $operationFailures = 0
        foreach ($name in $allowed) {
            $attempts++
            try {
                [void](& $operations.SetProcessValue $name $Snapshot.Values[$name])
            }
            catch {
                $operationFailures++
            }
        }
        $attempts++
        try {
            [void](& $operations.SetProcessValue 'PATH' $Snapshot.Path)
        }
        catch {
            $operationFailures++
        }

        $mismatches = 0
        foreach ($name in $allowed) {
            try {
                if ([string](& $operations.GetProcessValue $name) -cne [string]$Snapshot.Values[$name]) {
                    $mismatches++
                }
            }
            catch {
                $mismatches++
            }
        }
        try {
            if ([string](& $operations.GetProcessValue 'PATH') -cne [string]$Snapshot.Path) {
                $mismatches++
            }
        }
        catch {
            $mismatches++
        }

        return [pscustomobject]@{
            Restored = $operationFailures -eq 0 -and $mismatches -eq 0
            Attempts = $attempts
        }
    }

    $snapshot = @{ Path = $null; Values = @{} }
    try {
        $snapshot.Path = & $operations.GetProcessValue 'PATH'
        foreach ($name in $allowed) {
            $snapshot.Values[$name] = & $operations.GetProcessValue $name
        }
    }
    catch {
        return New-LoaderFallbackRecord -AlertCode 'ENVIRONMENT_TRANSACTION_FAILED'
    }
    $originalPath = if ($null -eq $snapshot.Path) { '' } else { [string]$snapshot.Path }

    try {
        if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        $npxPaths = New-Object System.Collections.Generic.List[string]
        foreach ($command in @(Get-Command 'npx.cmd' -All -CommandType Application -ErrorAction SilentlyContinue)) {
            $candidatePath = [string]$command.Source
            if (-not [string]::IsNullOrWhiteSpace($candidatePath) -and
                -not @($npxPaths | Where-Object { $_ -ieq $candidatePath }).Count) {
                $npxPaths.Add($candidatePath)
            }
        }
        if ($npxPaths.Count -ne 1) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        $resolverScript = 'const x={};x.execPath=process.execPath;x.path=process.env.PATH;process.stdout.write(JSON.stringify(x))'
        $resolverResult = Invoke-LoaderCapturedCommand `
            -FilePath $npxPaths[0] `
            -ArgumentList @(
                '--yes', '--package', 'node@22.14.0',
                '--package', 'npm@10.9.2', '--', 'node', '-e', $resolverScript
            ) `
            -WorkingDirectory $projectRoot
        if ($resolverResult.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($resolverResult.StdOut)) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        try {
            $resolver = $resolverResult.StdOut | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $resolverProperties = @($resolver.PSObject.Properties)
        $resolverPropertyNames = @($resolverProperties | ForEach-Object { [string]$_.Name } | Sort-Object)
        if ($resolver -is [System.Array] -or
            $resolverProperties.Count -ne 2 -or
            ($resolverPropertyNames -join ',') -cne 'execPath,path' -or
            $resolver.execPath -isnot [string] -or
            $resolver.path -isnot [string]) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        $nodeExecutable = [string]$resolver.execPath
        $childPath = [string]$resolver.path
        if ([string]::IsNullOrWhiteSpace($nodeExecutable) -or
            [string]::IsNullOrWhiteSpace($childPath) -or
            -not [System.IO.Path]::IsPathRooted($nodeExecutable) -or
            -not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $nodeExecutable = [System.IO.Path]::GetFullPath($nodeExecutable)
        if ([System.IO.Path]::GetFileName($nodeExecutable) -cne 'node.exe') {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $nodeDirectory = [System.IO.Path]::GetDirectoryName($nodeExecutable)
        $nodeProbe = Invoke-LoaderCapturedCommand -FilePath $nodeExecutable -ArgumentList @('-v') -WorkingDirectory $projectRoot
        if ($nodeProbe.ExitCode -ne 0 -or $nodeProbe.StdOut -cne 'v22.14.0') {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        $matchingNpmPaths = New-Object System.Collections.Generic.List[string]
        $seenDirectories = New-Object System.Collections.Generic.List[string]
        $childPathParts = @($childPath.Split([System.IO.Path]::PathSeparator))
        if ($childPathParts.Count -eq 0) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        foreach ($pathPart in $childPathParts) {
            if ([string]::IsNullOrWhiteSpace($pathPart) -or
                $pathPart -cne $pathPart.Trim() -or
                $pathPart.Contains('"') -or
                -not [System.IO.Path]::IsPathRooted($pathPart)) {
                throw 'TOOLCHAIN_VERSION_MISMATCH'
            }
            try {
                $canonicalDirectory = [System.IO.Path]::GetFullPath($pathPart).TrimEnd([char[]]'\/')
            }
            catch {
                throw 'TOOLCHAIN_VERSION_MISMATCH'
            }
            if (@($seenDirectories | Where-Object { $_ -ieq $canonicalDirectory }).Count -ne 0) {
                throw 'TOOLCHAIN_VERSION_MISMATCH'
            }
            $seenDirectories.Add($canonicalDirectory)
            if (-not (Test-Path -LiteralPath $canonicalDirectory)) {
                continue
            }
            if (-not (Test-Path -LiteralPath $canonicalDirectory -PathType Container)) {
                throw 'TOOLCHAIN_VERSION_MISMATCH'
            }
            $npmPath = [System.IO.Path]::GetFullPath((Join-Path $canonicalDirectory 'npm.cmd'))
            if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
                continue
            }
            $npmProbe = Invoke-LoaderCapturedCommand -FilePath $npmPath -ArgumentList @('--version') -WorkingDirectory $projectRoot
            if ($npmProbe.ExitCode -eq 0 -and $npmProbe.StdOut -ceq '10.9.2') {
                $matchingNpmPaths.Add($npmPath)
            }
        }
        if ($matchingNpmPaths.Count -ne 1) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $selectedNpmExecutable = [System.IO.Path]::GetFullPath($matchingNpmPaths[0])
        $npmDirectory = [System.IO.Path]::GetDirectoryName($selectedNpmExecutable)

        $nodeDirectoryNpm = [System.IO.Path]::GetFullPath((Join-Path $nodeDirectory 'npm.cmd'))
        if ((Test-Path -LiteralPath $nodeDirectoryNpm -PathType Leaf) -and $nodeDirectoryNpm -ine $selectedNpmExecutable) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $npmDirectoryNode = [System.IO.Path]::GetFullPath((Join-Path $npmDirectory 'node.exe'))
        if ((Test-Path -LiteralPath $npmDirectoryNode -PathType Leaf) -and $npmDirectoryNode -ine $nodeExecutable) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        $pathPrefixes = New-Object System.Collections.Generic.List[string]
        foreach ($directory in @($nodeDirectory, $npmDirectory)) {
            if (-not @($pathPrefixes | Where-Object { $_ -ieq $directory }).Count) {
                $pathPrefixes.Add($directory)
            }
        }
        $prospectivePath = [string]::Join([System.IO.Path]::PathSeparator, @($pathPrefixes))
        if (-not [string]::IsNullOrEmpty($originalPath)) {
            $prospectivePath += [System.IO.Path]::PathSeparator + $originalPath
        }
        $resolvedNodePath = Get-LoaderFirstCommandPath -PathValue $prospectivePath -LeafName 'node.exe'
        $resolvedNpmPath = Get-LoaderFirstCommandPath -PathValue $prospectivePath -LeafName 'npm.cmd'
        if ([string]::IsNullOrWhiteSpace($resolvedNodePath) -or
            [string]::IsNullOrWhiteSpace($resolvedNpmPath) -or
            [System.IO.Path]::GetFullPath($resolvedNodePath) -ine $nodeExecutable -or
            [System.IO.Path]::GetFullPath($resolvedNpmPath) -ine $selectedNpmExecutable) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
    }
    catch {
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('TOOLCHAIN_VERSION_MISMATCH') -EnvironmentImported 0 -ToolchainReady 0
    }

    if ([string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) {
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('SECRET_BUNDLE_MISSING') -EnvironmentImported 0 -ToolchainReady 1
    }
    $bundlePath = Join-Path ([string]$env:LOCALAPPDATA) 'ChengyeOA\local-preproduction\environment.dpapi'
    if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('SECRET_BUNDLE_MISSING') -EnvironmentImported 0 -ToolchainReady 1
    }
    try {
        $bundle = Unprotect-LocalPreproductionBundle -LiteralPath $bundlePath
    }
    catch {
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('SECRET_BUNDLE_INVALID') -EnvironmentImported 0 -ToolchainReady 1
    }

    try {
        $validation = & $operations.ValidateEnvironment $bundle
    }
    catch {
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('ENVIRONMENT_VALIDATION_FAILED') -EnvironmentImported 0 -ToolchainReady 1
    }
    if ($null -eq $validation -or [string]$validation.status -cne 'READY') {
        $validationAlerts = if ($null -ne $validation) { @($validation.alertCodes) } else { @('ENV_REQUIRED_MISSING') }
        return New-LoaderRecord -Status 'BLOCKED' -AlertCodes $validationAlerts -EnvironmentImported 0 -ToolchainReady 1
    }

    try {
        $readyRecord = New-LoaderRecord -Status 'READY' -AlertCodes @() -EnvironmentImported $allowed.Count -ToolchainReady 1
        $importFailureRecord = New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('ENVIRONMENT_IMPORT_FAILED') -EnvironmentImported 0 -ToolchainReady 1
        $toolchainFailureRecord = New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('TOOLCHAIN_VERSION_MISMATCH') -EnvironmentImported 0 -ToolchainReady 0
        $rollbackFailureRecord = New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('ENVIRONMENT_ROLLBACK_FAILED') -EnvironmentImported 0 -ToolchainReady 1
        $toolchainRollbackFailureRecord = New-LoaderRecord -Status 'BLOCKED' -AlertCodes @('ENVIRONMENT_ROLLBACK_FAILED') -EnvironmentImported 0 -ToolchainReady 0
    }
    catch {
        return New-LoaderFallbackRecord -AlertCode 'SAFE_RECORD_FAILED' -ToolchainReady 1
    }

    try {
        [void](& $operations.SetProcessValue 'PATH' $prospectivePath)
        foreach ($name in $allowed) {
            [void](& $operations.SetProcessValue $name ([string]$bundle[$name]))
        }
        [void](& $operations.SetProcessValue 'EVENT_WORKER_ENABLED' 'false')

        $committedNodeCommands = @(Get-Command 'node.exe' -All -CommandType Application -ErrorAction SilentlyContinue)
        $committedNpmCommands = @(Get-Command 'npm.cmd' -All -CommandType Application -ErrorAction SilentlyContinue)
        if ($committedNodeCommands.Count -eq 0 -or $committedNpmCommands.Count -eq 0) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $committedNodePath = [System.IO.Path]::GetFullPath([string]$committedNodeCommands[0].Source)
        $committedNpmPath = [System.IO.Path]::GetFullPath([string]$committedNpmCommands[0].Source)
        if ($committedNodePath -ine $nodeExecutable -or $committedNpmPath -ine $selectedNpmExecutable) {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }
        $committedNodeProbe = Invoke-LoaderCapturedCommand -FilePath 'node.exe' -ArgumentList @('-v') -WorkingDirectory $projectRoot
        $committedNpmProbe = Invoke-LoaderCapturedCommand -FilePath 'npm.cmd' -ArgumentList @('--version') -WorkingDirectory $projectRoot
        if ($committedNodeProbe.ExitCode -ne 0 -or $committedNodeProbe.StdOut -cne 'v22.14.0' -or
            $committedNpmProbe.ExitCode -ne 0 -or $committedNpmProbe.StdOut -cne '10.9.2') {
            throw 'TOOLCHAIN_VERSION_MISMATCH'
        }

        if ([string](& $operations.GetProcessValue 'PATH') -cne $prospectivePath) {
            throw 'ENVIRONMENT_IMPORT_FAILED'
        }
        foreach ($name in $allowed) {
            $expectedValue = if ($name -ceq 'EVENT_WORKER_ENABLED') { 'false' } else { [string]$bundle[$name] }
            if ([string](& $operations.GetProcessValue $name) -cne $expectedValue) {
                throw 'ENVIRONMENT_IMPORT_FAILED'
            }
        }
    }
    catch {
        $toolchainFailureOrigin = [string]$_.Exception.Message -ceq 'TOOLCHAIN_VERSION_MISMATCH'
        $commitFailureRecord = if ($toolchainFailureOrigin) {
            $toolchainFailureRecord
        }
        else {
            $importFailureRecord
        }
        $rollback = Restore-LoaderSnapshot -Snapshot $snapshot
        if ($rollback.Restored) {
            return $commitFailureRecord
        }
        if ($toolchainFailureOrigin) {
            return $toolchainRollbackFailureRecord
        }
        return $rollbackFailureRecord
    }

    return $readyRecord
} $TestOperations
