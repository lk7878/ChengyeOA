Set-StrictMode -Version Latest

function Test-AddressLikeScheme {
    param([string]$Value)

    return $Value -match '(?i)\b[a-z][a-z0-9+.-]*:'
}

function Assert-SafeRecordText {
    param([object]$Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value) -or (Test-AddressLikeScheme -Value ([string]$Value))) {
        throw 'SAFE_RECORD_INVALID'
    }
}

function Assert-SafeStatusRecord {
    param([System.Collections.IDictionary]$Record)

    $allowedKeys = @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
    if ($null -eq $Record -or $Record.Count -ne $allowedKeys.Count) {
        throw 'SAFE_RECORD_INVALID'
    }

    foreach ($key in $allowedKeys) {
        if (-not $Record.Contains($key)) {
            throw 'SAFE_RECORD_INVALID'
        }
    }

    Assert-SafeRecordText -Value $Record['phase']
    Assert-SafeRecordText -Value $Record['status']

    $counts = $Record['boundedCounts']
    if ($counts -isnot [System.Collections.IDictionary]) {
        throw 'SAFE_RECORD_INVALID'
    }
    foreach ($countKey in $counts.Keys) {
        Assert-SafeRecordText -Value $countKey
        $countValue = $counts[$countKey]
        if (($countValue -isnot [int]) -and ($countValue -isnot [long]) -and ($countValue -isnot [uint32]) -and ($countValue -isnot [uint64])) {
            throw 'SAFE_RECORD_INVALID'
        }
        if ([decimal]$countValue -lt 0) {
            throw 'SAFE_RECORD_INVALID'
        }
    }

    $alerts = $Record['alertCodes']
    if ($alerts -is [string] -or $null -eq $alerts) {
        throw 'SAFE_RECORD_INVALID'
    }
    foreach ($alertCode in $alerts) {
        if ([string]$alertCode -cnotmatch '^[A-Z0-9_]+$') {
            throw 'SAFE_RECORD_INVALID'
        }
    }

    foreach ($timeKey in @('utcStart', 'utcEnd')) {
        $parsedTime = [datetime]::MinValue
        if (-not [datetime]::TryParse([string]$Record[$timeKey], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedTime) -or $parsedTime.Kind -ne [DateTimeKind]::Utc) {
            throw 'SAFE_RECORD_INVALID'
        }
    }

    $elapsedSeconds = $Record['elapsedSeconds']
    if (($elapsedSeconds -isnot [int]) -and ($elapsedSeconds -isnot [long]) -and ($elapsedSeconds -isnot [uint32]) -and ($elapsedSeconds -isnot [uint64])) {
        throw 'SAFE_RECORD_INVALID'
    }
    if ([decimal]$elapsedSeconds -lt 0) {
        throw 'SAFE_RECORD_INVALID'
    }
}

function Test-ProductionEnvironmentGate {
    param([hashtable]$Environment)

    $requiredNames = @('DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'MFA_ENCRYPTION_KEY_V1', 'CORS_ALLOWED_ORIGINS', 'EVENT_WORKER_ENABLED')
    $presentCount = 0
    foreach ($name in $requiredNames) {
        if ($Environment.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$Environment[$name])) {
            $presentCount++
        }
    }

    $nodeEnvProduction = $Environment.ContainsKey('NODE_ENV') -and ([string]$Environment['NODE_ENV'] -ceq 'production')
    $workerDisabled = $Environment.ContainsKey('EVENT_WORKER_ENABLED') -and ([string]$Environment['EVENT_WORKER_ENABLED'] -ceq 'false')
    $alertCodes = @()
    if ($presentCount -ne $requiredNames.Count) {
        $alertCodes += 'ENV_REQUIRED_MISSING'
    }
    if (-not $nodeEnvProduction) {
        $alertCodes += 'NODE_ENV_NOT_PRODUCTION'
    }
    if (-not $workerDisabled) {
        $alertCodes += 'EVENT_WORKER_NOT_DISABLED'
    }

    return [pscustomobject][ordered]@{
        Status = if ($alertCodes.Count -eq 0) { 'READY' } else { 'NOT_READY' }
        PresentCount = $presentCount
        RequiredCount = $requiredNames.Count
        NodeEnvProduction = $nodeEnvProduction
        WorkerDisabled = $workerDisabled
        AlertCodes = $alertCodes
    }
}

function Test-ProductionEvidenceReceipt {
    param(
        [pscustomobject]$Receipt,
        [datetime]$NowUtc,
        [timespan]$MaxAge
    )

    $requiredNames = @('schemaVersion', 'backup', 'isolatedRestorePoint', 'allWorkersDisabled', 'serverWebSameRelease', 'governanceApproval', 'verifiedAtUtc')
    $actualNames = @($Receipt.PSObject.Properties.Name)
    if ($actualNames.Count -ne $requiredNames.Count -or @($actualNames | Where-Object { $_ -cnotin $requiredNames }).Count -ne 0 -or @($requiredNames | Where-Object { $_ -cnotin $actualNames }).Count -ne 0) {
        return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_FIELDS_INVALID') }
    }
    $schemaVersion = $Receipt.schemaVersion
    $integralSchemaTypes = @([sbyte], [byte], [int16], [uint16], [int32], [uint32], [int64], [uint64])
    if ($null -eq $schemaVersion -or ($integralSchemaTypes -notcontains $schemaVersion.GetType()) -or ([decimal]$schemaVersion -ne 1)) {
        return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_SCHEMA_INVALID') }
    }
    foreach ($field in @('backup', 'isolatedRestorePoint', 'allWorkersDisabled', 'serverWebSameRelease', 'governanceApproval')) {
        if ([string]$Receipt.$field -cne 'VERIFIED') {
            return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_VERIFICATION_INVALID') }
        }
    }
    if (($Receipt.verifiedAtUtc -isnot [datetime]) -or $Receipt.verifiedAtUtc.Kind -ne [DateTimeKind]::Utc) {
        return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_TIME_INVALID') }
    }
    if ($Receipt.verifiedAtUtc -gt $NowUtc) {
        return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_TIME_FUTURE') }
    }

    $effectiveMaxAge = [timespan]::FromMinutes(30)
    if ($MaxAge -lt $effectiveMaxAge) {
        $effectiveMaxAge = $MaxAge
    }
    if (($NowUtc - $Receipt.verifiedAtUtc) -gt $effectiveMaxAge) {
        return [pscustomobject][ordered]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_EXPIRED') }
    }
    return [pscustomobject][ordered]@{ Status = 'VALID'; AlertCodes = @() }
}

function Assert-SafePhysicalPath {
    param(
        [string]$SafeRoot,
        [string]$ParentPath,
        [string]$TargetPath
    )

    $canonicalSafeRoot = [System.IO.Path]::GetFullPath($SafeRoot).TrimEnd([char[]]'\')
    $canonicalParentPath = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd([char[]]'\')
    $canonicalTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
    $rootPrefix = $canonicalSafeRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($canonicalParentPath -cne $canonicalSafeRoot -and -not $canonicalParentPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }

    $rootItem = Get-Item -LiteralPath $canonicalSafeRoot -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }

    $relativeParent = $canonicalParentPath.Substring($canonicalSafeRoot.Length).TrimStart([char[]]'\\/')
    $currentPath = $canonicalSafeRoot
    foreach ($component in $relativeParent.Split([char[]]'\\/', [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $currentPath = [System.IO.Path]::Combine($currentPath, $component)
        $componentItem = Get-Item -LiteralPath $currentPath -Force
        if (($componentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }
    }

    $targetItem = Get-Item -LiteralPath $canonicalTargetPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $targetItem -and (($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }
}

function Write-SafeStatusTemporaryFile {
    param(
        [string]$TemporaryPath,
        [string]$Content
    )

    [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Move-SafeStatusFirstWrite {
    param(
        [string]$TemporaryPath,
        [string]$TargetPath
    )

    [System.IO.File]::Move($TemporaryPath, $TargetPath)
}

function Replace-SafeStatusExistingTarget {
    param(
        [string]$TemporaryPath,
        [string]$TargetPath,
        [string]$BackupPath
    )

    try {
        [System.IO.File]::Replace($TemporaryPath, $TargetPath, $BackupPath)
        return $true
    }
    catch {
        return $false
    }
}

function Assert-SafeStatusAtomicTargetPath {
    param([string]$TargetPath)

    $canonicalTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
    $parentPath = [System.IO.Path]::GetDirectoryName($canonicalTargetPath)
    if ([string]::IsNullOrEmpty($parentPath) -or -not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }

    $currentPath = $parentPath
    while (-not [string]::IsNullOrEmpty($currentPath)) {
        $item = Get-Item -LiteralPath $currentPath -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }
        $nextPath = [System.IO.Directory]::GetParent($currentPath)
        if ($null -eq $nextPath -or $nextPath.FullName -ceq $currentPath) { break }
        $currentPath = $nextPath.FullName
    }

    $targetItem = Get-Item -LiteralPath $canonicalTargetPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $targetItem -and (($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }
}

function Invoke-SafeStatusAtomicWrite {
    param(
        [string]$TargetPath,
        [string]$Content,
        [hashtable]$Operations
    )

    $canonicalTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
    Assert-SafeStatusAtomicTargetPath -TargetPath $canonicalTargetPath
    $parentPath = [System.IO.Path]::GetDirectoryName($canonicalTargetPath)
    $temporaryPath = Join-Path $parentPath ('.' + [System.IO.Path]::GetRandomFileName() + '.tmp')
    $backupPath = Join-Path $parentPath ('.' + [System.IO.Path]::GetRandomFileName() + '.bak')
    if ($null -eq $Operations) {
        $Operations = @{
            WriteTemporary = { param($TemporaryPath, $InnerContent) Write-SafeStatusTemporaryFile -TemporaryPath $TemporaryPath -Content $InnerContent }
            MoveFirst = { param($TemporaryPath, $InnerTargetPath) Move-SafeStatusFirstWrite -TemporaryPath $TemporaryPath -TargetPath $InnerTargetPath }
            ReplaceExisting = {
                param($TemporaryPath, $InnerTargetPath, $InnerBackupPath)
                if (-not (Replace-SafeStatusExistingTarget -TemporaryPath $TemporaryPath -TargetPath $InnerTargetPath -BackupPath $InnerBackupPath)) {
                    throw 'SAFE_STATUS_WRITE_FAILED'
                }
            }
        }
    }

    try {
        & $Operations.WriteTemporary $temporaryPath $Content
        if ([System.IO.File]::Exists($canonicalTargetPath)) {
            & $Operations.ReplaceExisting $temporaryPath $canonicalTargetPath $backupPath
        }
        else {
            & $Operations.MoveFirst $temporaryPath $canonicalTargetPath
        }
    }
    catch {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
    finally {
        foreach ($artifactPath in @($temporaryPath, $backupPath)) {
            try {
                if ([System.IO.File]::Exists($artifactPath)) {
                    [System.IO.File]::Delete($artifactPath)
                }
            }
            catch {
            }
        }
    }
}

function New-SafeStatusRecord {
    param(
        [string]$Phase,
        [string]$Status,
        [hashtable]$BoundedCounts,
        [string[]]$AlertCodes,
        [datetime]$UtcStart,
        [datetime]$UtcEnd
    )

    if ($UtcStart.Kind -ne [DateTimeKind]::Utc -or $UtcEnd.Kind -ne [DateTimeKind]::Utc -or $UtcEnd -lt $UtcStart) {
        throw 'SAFE_RECORD_INVALID'
    }
    $record = [ordered]@{
        phase = $Phase
        status = $Status
        boundedCounts = $BoundedCounts
        alertCodes = @($AlertCodes)
        utcStart = $UtcStart.ToString('o')
        utcEnd = $UtcEnd.ToString('o')
        elapsedSeconds = [long][math]::Floor(($UtcEnd - $UtcStart).TotalSeconds)
    }
    Assert-SafeStatusRecord -Record $record
    return $record
}

function Write-SafeStatusRecord {
    param(
        [string]$Path,
        [hashtable]$Record
    )

    Assert-SafeStatusRecord -Record $Record
    $safeRoot = [System.IO.Path]::GetFullPath('D:\2_test\16_ChengyeOA\.codex-safe').TrimEnd('\')
    $targetPath = [System.IO.Path]::GetFullPath($Path)
    $rootPrefix = $safeRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $targetPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }
    $parentPath = [System.IO.Path]::GetDirectoryName($targetPath)
    if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        throw 'SAFE_STATUS_PATH_INVALID'
    }
    Assert-SafePhysicalPath -SafeRoot $safeRoot -ParentPath $parentPath -TargetPath $targetPath

    $targetExists = Test-Path -LiteralPath $targetPath -PathType Leaf
    $jsonLine = $Record | ConvertTo-Json -Compress -Depth 4
    try {
        $existingContent = if ($targetExists) { [System.IO.File]::ReadAllText($targetPath) } else { '' }
        $newContent = if ([string]::IsNullOrEmpty($existingContent)) { $jsonLine + [Environment]::NewLine } else { $existingContent.TrimEnd("`r", "`n") + [Environment]::NewLine + $jsonLine + [Environment]::NewLine }
        Invoke-SafeStatusAtomicWrite -TargetPath $targetPath -Content $newContent
    }
    catch {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
}

function ConvertFrom-StrictEventFields {
    param(
        [string]$Text,
        [string]$Prefix,
        [string[]]$RequiredFields,
        [string]$FailureCode
    )

    if ([string]::IsNullOrEmpty($Text)) {
        throw $FailureCode
    }

    $logicalText = $Text
    if ($logicalText.EndsWith("`r`n", [System.StringComparison]::Ordinal)) {
        $logicalText = $logicalText.Substring(0, $logicalText.Length - 2)
    }
    elseif ($logicalText.EndsWith("`n", [System.StringComparison]::Ordinal)) {
        $logicalText = $logicalText.Substring(0, $logicalText.Length - 1)
    }
    if ([string]::IsNullOrEmpty($logicalText) -or $logicalText.IndexOfAny([char[]]"`r`n") -ge 0 -or -not $logicalText.StartsWith($Prefix + ' ', [System.StringComparison]::Ordinal)) {
        throw $FailureCode
    }

    $body = $logicalText.Substring($Prefix.Length + 1)
    if ([string]::IsNullOrEmpty($body)) {
        throw $FailureCode
    }

    $fields = [System.Collections.Generic.Dictionary[string,string]]::new([System.StringComparer]::Ordinal)
    foreach ($part in $body.Split(';')) {
        $match = [regex]::Match($part, '\A([^=;]+)=([^=;]+)\z')
        if (-not $match.Success) {
            throw $FailureCode
        }
        $name = $match.Groups[1].Value
        if ($fields.ContainsKey($name)) {
            throw $FailureCode
        }
        $fields.Add($name, $match.Groups[2].Value)
    }

    if ($fields.Count -ne $RequiredFields.Count) {
        throw $FailureCode
    }
    foreach ($requiredField in $RequiredFields) {
        if (-not $fields.ContainsKey($requiredField)) {
            throw $FailureCode
        }
    }
    return $fields
}

function ConvertTo-NonNegativeEventInteger {
    param([string]$Value, [string]$FailureCode)

    if ($Value -notmatch '\A(0|[1-9][0-9]*)\z') {
        throw $FailureCode
    }
    $parsed = [long]0
    if (-not [long]::TryParse($Value, [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        throw $FailureCode
    }
    return $parsed
}

function ConvertFrom-EventCheckSummary {
    param([string]$Text, [string]$ExpectedMode)

    $failureCode = 'EVENT_CHECK_SUMMARY_INVALID'
    $requiredFields = @('mode', 'status', 'undispatched', 'oldestUndispatchedSeconds', 'dueBacklog', 'oldestDueBacklogSeconds', 'manual', 'processing', 'expiredProcessing', 'staleExpiredProcessing', 'leaseLost15m', 'alertCodes', 'evaluatedAt')
    $fields = ConvertFrom-StrictEventFields -Text $Text -Prefix 'Event observability:' -RequiredFields $requiredFields -FailureCode $failureCode
    if ($ExpectedMode -cnotin @('preflight', 'canary') -or $fields['mode'] -cne $ExpectedMode -or $fields['status'] -cnotin @('READY', 'DEGRADED', 'BLOCKED')) {
        throw $failureCode
    }

    $counts = @{}
    foreach ($name in @('undispatched', 'oldestUndispatchedSeconds', 'dueBacklog', 'oldestDueBacklogSeconds', 'manual', 'processing', 'expiredProcessing', 'staleExpiredProcessing', 'leaseLost15m')) {
        $counts[$name] = ConvertTo-NonNegativeEventInteger -Value $fields[$name] -FailureCode $failureCode
    }

    $alertCodes = @()
    if ($fields['alertCodes'] -cne 'none') {
        foreach ($code in $fields['alertCodes'].Split(',')) {
            if ($code -cnotmatch '\A[A-Z0-9_]+\z') {
                throw $failureCode
            }
            $alertCodes += $code
        }
    }

    $evaluatedAtUtc = [datetime]::MinValue
    if (-not [datetime]::TryParse($fields['evaluatedAt'], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$evaluatedAtUtc) -or $evaluatedAtUtc.Kind -ne [DateTimeKind]::Utc) {
        throw $failureCode
    }

    return [pscustomobject][ordered]@{
        Mode = $fields['mode']
        Status = $fields['status']
        Undispatched = $counts['undispatched']
        OldestUndispatchedSeconds = $counts['oldestUndispatchedSeconds']
        DueBacklog = $counts['dueBacklog']
        OldestDueBacklogSeconds = $counts['oldestDueBacklogSeconds']
        Manual = $counts['manual']
        Processing = $counts['processing']
        ExpiredProcessing = $counts['expiredProcessing']
        StaleExpiredProcessing = $counts['staleExpiredProcessing']
        LeaseLost15m = $counts['leaseLost15m']
        AlertCodes = @($alertCodes)
        EvaluatedAtUtc = $evaluatedAtUtc
    }
}

function ConvertFrom-EventDrainSummary {
    param([string]$Text)

    $failureCode = 'EVENT_DRAIN_SUMMARY_INVALID'
    $requiredFields = @('dispatched', 'claimed', 'succeeded', 'retryScheduled', 'manual', 'leaseLost', 'status')
    $fields = ConvertFrom-StrictEventFields -Text $Text -Prefix 'Event drain:' -RequiredFields $requiredFields -FailureCode $failureCode
    if ($fields['status'] -cnotin @('complete', 'manual_attention_required')) {
        throw $failureCode
    }

    $counts = @{}
    foreach ($name in @('dispatched', 'claimed', 'succeeded', 'retryScheduled', 'manual', 'leaseLost')) {
        $counts[$name] = ConvertTo-NonNegativeEventInteger -Value $fields[$name] -FailureCode $failureCode
    }

    return [pscustomobject][ordered]@{
        Dispatched = $counts['dispatched']
        Claimed = $counts['claimed']
        Succeeded = $counts['succeeded']
        RetryScheduled = $counts['retryScheduled']
        Manual = $counts['manual']
        LeaseLost = $counts['leaseLost']
        Status = $fields['status']
    }
}

function Invoke-RunnerPrivateProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = [string]::Join(' ', $ArgumentList)
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $standardOutput; StdErr = $standardError }
}

function Get-SafeRunnerResult {
    param([string]$AlertCode, [string]$Status = 'BLOCKED', [object]$ExitCode)

    $result = [ordered]@{ Status = $Status; AlertCodes = if ([string]::IsNullOrEmpty($AlertCode)) { @() } else { @($AlertCode) } }
    if ($null -ne $ExitCode -and [int]$ExitCode -in @(2, 5, 70)) {
        $result.ExitCode = [int]$ExitCode
    }
    return [pscustomobject]$result
}

function Get-EventExitOutcome {
    param([int]$ExitCode, [bool]$IsDrain)

    if ($ExitCode -eq 0) { return $null }
    if ($IsDrain -and $ExitCode -eq 4) {
        return Get-SafeRunnerResult -AlertCode $null -Status 'manual_attention_required'
    }
    if (-not $IsDrain -and $ExitCode -eq 3) {
        return Get-SafeRunnerResult -AlertCode $null -Status 'DEGRADED'
    }
    if (-not $IsDrain -and $ExitCode -eq 4) {
        return Get-SafeRunnerResult -AlertCode $null -Status 'BLOCKED'
    }
    switch ($ExitCode) {
        2 { return Get-SafeRunnerResult -AlertCode 'CONFIG_INVALID' -ExitCode 2 }
        5 { return Get-SafeRunnerResult -AlertCode 'MIGRATION_OR_DATABASE_UNAVAILABLE' -ExitCode 5 }
        70 { return Get-SafeRunnerResult -AlertCode 'UNCLASSIFIED_FAILURE' -ExitCode 70 }
        default { return Get-SafeRunnerResult -AlertCode 'COMMAND_EXIT_UNRECOGNIZED' -ExitCode 70 }
    }
}

function Invoke-SafeNativeCommand {
    param([string]$CommandKind, [string]$Mode, [string]$WorkspaceRoot)

    $isDrain = $false
    switch ($CommandKind) {
        'source-check' {
            if ($Mode -cnotin @('preflight', 'canary')) { throw 'SAFE_COMMAND_INVALID' }
            $filePath = 'npm.cmd'
            $argumentList = @('--silent', 'run', 'events:check', '--', '--mode', $Mode)
        }
        'portable-check' {
            if ($Mode -cne 'preflight') { throw 'SAFE_COMMAND_INVALID' }
            $filePath = 'apps\dist\law-firm-system\law-firm-system.exe'
            $argumentList = @('events:check', '--mode', 'preflight')
        }
        'source-drain' {
            if (-not [string]::IsNullOrEmpty($Mode)) { throw 'SAFE_COMMAND_INVALID' }
            $isDrain = $true
            $filePath = 'npm.cmd'
            $argumentList = @('--silent', 'run', 'events:drain')
        }
        default { throw 'SAFE_COMMAND_INVALID' }
    }

    try {
        $processResult = Invoke-RunnerPrivateProcess -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $WorkspaceRoot
        $exitCode = [int]$processResult.ExitCode
        $standardOutput = [string]$processResult.StdOut
    }
    catch {
        return Get-SafeRunnerResult -AlertCode 'COMMAND_LAUNCH_FAILED' -ExitCode 70
    }

    $exitOutcome = Get-EventExitOutcome -ExitCode $exitCode -IsDrain $isDrain
    if ($null -ne $exitOutcome) {
        return $exitOutcome
    }

    try {
        if ($isDrain) {
            $summary = ConvertFrom-EventDrainSummary -Text $standardOutput
        }
        else {
            $summary = ConvertFrom-EventCheckSummary -Text $standardOutput -ExpectedMode $Mode
        }
    }
    catch {
        return Get-SafeRunnerResult -AlertCode 'FORMATTER_OUTPUT_INVALID' -ExitCode 70
    }

    $expectedStatus = if ($isDrain) { 'complete' } else { 'READY' }
    if ($summary.Status -cne $expectedStatus) {
        return Get-SafeRunnerResult -AlertCode 'FORMATTER_STATUS_MISMATCH' -ExitCode 70
    }
    if ($isDrain) {
        $summary | Add-Member -NotePropertyName AlertCodes -NotePropertyValue @()
    }
    return $summary
}

function Test-ExactToolchainVersion {
    param([object]$Result, [string]$ExpectedVersion)

    try {
        return ([int]$Result.ExitCode -eq 0) -and ([string]$Result.StdOut -cmatch ('\A' + [regex]::Escape($ExpectedVersion) + '(?:\r?\n)?\z'))
    }
    catch {
        return $false
    }
}

function Test-PinnedToolchain {
    param([string]$WorkspaceRoot)

    $nodeResult = $null
    $npmResult = $null
    try { $nodeResult = Invoke-RunnerPrivateProcess -FilePath 'node.exe' -ArgumentList @('-v') -WorkingDirectory $WorkspaceRoot } catch { }
    try { $npmResult = Invoke-RunnerPrivateProcess -FilePath 'npm.cmd' -ArgumentList @('--version') -WorkingDirectory $WorkspaceRoot } catch { }
    $nodeVersionOk = Test-ExactToolchainVersion -Result $nodeResult -ExpectedVersion 'v22.14.0'
    $npmVersionOk = Test-ExactToolchainVersion -Result $npmResult -ExpectedVersion '10.9.2'
    return [pscustomobject][ordered]@{
        Status = if ($nodeVersionOk -and $npmVersionOk) { 'READY' } else { 'BLOCKED' }
        NodeVersionOk = $nodeVersionOk
        NpmVersionOk = $npmVersionOk
        AlertCodes = if ($nodeVersionOk -and $npmVersionOk) { @() } else { @('TOOLCHAIN_VERSION_MISMATCH') }
    }
}

function Get-RunnerSafeAlertCodes {
    param([object]$Value)

    $safeCodes = @()
    if ($null -ne $Value -and $Value.PSObject.Properties.Name -contains 'AlertCodes') {
        foreach ($code in @($Value.AlertCodes)) {
            if ([string]$code -cmatch '\A[A-Z0-9_]+\z') {
                $safeCodes += [string]$code
            }
        }
    }
    return @($safeCodes)
}

function Get-RunnerBoundedCounts {
    param([object]$Value, [string[]]$Names)

    $counts = @{}
    foreach ($name in $Names) {
        if ($null -ne $Value -and $Value.PSObject.Properties.Name -contains $name) {
            $candidate = $Value.$name
            if (($candidate -is [int]) -or ($candidate -is [long]) -or ($candidate -is [uint32]) -or ($candidate -is [uint64])) {
                if ([decimal]$candidate -ge 0) {
                    $counts[$name.Substring(0, 1).ToLowerInvariant() + $name.Substring(1)] = [long]$candidate
                }
            }
        }
    }
    return $counts
}

function Write-RunnerTransition {
    param(
        [hashtable]$Dependencies,
        [string]$Phase,
        [string]$Status,
        [hashtable]$BoundedCounts = @{},
        [string[]]$AlertCodes = @(),
        [object]$UtcStart,
        [object]$UtcEnd
    )

    $start = if ($null -ne $UtcStart) { [datetime]$UtcStart } else { & $Dependencies.UtcClock }
    $end = if ($null -ne $UtcEnd) { [datetime]$UtcEnd } else { $start }
    if ($null -eq $AlertCodes) {
        $record = New-SafeStatusRecord -Phase $Phase -Status $Status -BoundedCounts $BoundedCounts -AlertCodes @() -UtcStart $start -UtcEnd $end
    }
    else {
        $record = New-SafeStatusRecord -Phase $Phase -Status $Status -BoundedCounts $BoundedCounts -AlertCodes $AlertCodes -UtcStart $start -UtcEnd $end
    }
    [void](& $Dependencies.SafeStatusSink $record)
}

function Test-ProductionRunnerCheckpoint {
    param(
        [pscustomobject]$Checkpoint,
        [datetime]$NowUtc,
        [long]$LastSequence,
        [string]$ExpectedCommand,
        [object]$MinimumIssuedAtUtc,
        [object]$MaximumIssuedAtUtc
    )

    if ($null -eq $Checkpoint) { return $false }
    $requiredNames = @('schemaVersion', 'sequence', 'command', 'issuedAtUtc')
    $actualNames = @($Checkpoint.PSObject.Properties.Name)
    if ($actualNames.Count -ne $requiredNames.Count -or @($actualNames | Where-Object { $_ -cnotin $requiredNames }).Count -ne 0 -or @($requiredNames | Where-Object { $_ -cnotin $actualNames }).Count -ne 0) {
        return $false
    }

    $integralTypes = @([sbyte], [byte], [int16], [uint16], [int32], [uint32], [int64], [uint64])
    if ($null -eq $Checkpoint.schemaVersion -or $integralTypes -notcontains $Checkpoint.schemaVersion.GetType() -or [decimal]$Checkpoint.schemaVersion -ne 1) {
        return $false
    }
    if ($null -eq $Checkpoint.sequence -or $integralTypes -notcontains $Checkpoint.sequence.GetType() -or [decimal]$Checkpoint.sequence -le [decimal]$LastSequence -or [decimal]$Checkpoint.sequence -gt [decimal][long]::MaxValue) {
        return $false
    }
    if ([string]$Checkpoint.command -cnotin @('GOVERNANCE_COMPLETED', 'SINGLE_WORKER_ENABLED', 'CANARY_GOVERNANCE_COMPLETED', 'ROLLBACK_CONFIRMED') -or [string]$Checkpoint.command -cne $ExpectedCommand) {
        return $false
    }
    if (($Checkpoint.issuedAtUtc -isnot [datetime]) -or $Checkpoint.issuedAtUtc.Kind -ne [DateTimeKind]::Utc -or $Checkpoint.issuedAtUtc -gt $NowUtc -or ($NowUtc - $Checkpoint.issuedAtUtc) -gt [timespan]::FromMinutes(30)) {
        return $false
    }
    if ($null -ne $MinimumIssuedAtUtc -and $Checkpoint.issuedAtUtc -lt [datetime]$MinimumIssuedAtUtc) {
        return $false
    }
    if ($null -ne $MaximumIssuedAtUtc -and $Checkpoint.issuedAtUtc -gt [datetime]$MaximumIssuedAtUtc) {
        return $false
    }
    return $true
}

function Wait-ProductionRunnerCheckpoint {
    param(
        [hashtable]$Dependencies,
        [long]$LastSequence,
        [string]$ExpectedCommand,
        [object]$MinimumIssuedAtUtc,
        [object]$MaximumIssuedAtUtc
    )

    while ($true) {
        $checkpoint = & $Dependencies.CheckpointReader
        $nowUtc = & $Dependencies.UtcClock
        if (Test-ProductionRunnerCheckpoint -Checkpoint $checkpoint -NowUtc $nowUtc -LastSequence $LastSequence -ExpectedCommand $ExpectedCommand -MinimumIssuedAtUtc $MinimumIssuedAtUtc -MaximumIssuedAtUtc $MaximumIssuedAtUtc) {
            return [long]$checkpoint.sequence
        }
        & $Dependencies.Sleep
    }
}

function Test-RunnerSnapshotAgreement {
    param([object]$Source, [object]$Portable)

    foreach ($name in @('Status', 'Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) {
        if ($null -eq $Source -or $null -eq $Portable -or $Source.PSObject.Properties.Name -cnotcontains $name -or $Portable.PSObject.Properties.Name -cnotcontains $name -or $Source.$name -cne $Portable.$name) {
            return $false
        }
    }
    return ([string]$Source.Status -ceq 'READY')
}

function Complete-RunnerRollback {
    param([hashtable]$Dependencies, [long]$LastSequence)

    $rollbackRequiredUtc = & $Dependencies.UtcClock
    Write-RunnerTransition -Dependencies $Dependencies -Phase 'ROLLBACK_REQUIRED' -Status 'WAITING' -AlertCodes @('ROLLBACK_REQUIRED') -UtcStart $rollbackRequiredUtc -UtcEnd $rollbackRequiredUtc
    [void](Wait-ProductionRunnerCheckpoint -Dependencies $Dependencies -LastSequence $LastSequence -ExpectedCommand 'ROLLBACK_CONFIRMED' -MinimumIssuedAtUtc $rollbackRequiredUtc)
    $rollbackPreflight = & $Dependencies.SourceCheck 'preflight'
    $rollbackStatus = if ($null -ne $rollbackPreflight -and [string]$rollbackPreflight.Status -ceq 'READY') { 'READY' } else { 'BLOCKED' }
    Write-RunnerTransition -Dependencies $Dependencies -Phase 'PREFLIGHT_AFTER_ROLLBACK' -Status $rollbackStatus -BoundedCounts (Get-RunnerBoundedCounts -Value $rollbackPreflight -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $rollbackPreflight)
    Write-RunnerTransition -Dependencies $Dependencies -Phase 'ROLLED_BACK' -Status $rollbackStatus
    return 4
}

function Get-RunnerFailureExitCode {
    param([string]$FailureCode)

    switch -CaseSensitive ($FailureCode) {
        'CONFIG_INVALID' { return 2 }
        'MIGRATION_OR_DATABASE_UNAVAILABLE' { return 5 }
        default { return 70 }
    }
}

function Get-RunnerClassifiedExitCode {
    param([object]$Result)

    if ($null -eq $Result -or $Result.PSObject.Properties.Name -cnotcontains 'ExitCode') { return $null }
    $value = $Result.ExitCode
    if ($value -isnot [sbyte] -and $value -isnot [byte] -and $value -isnot [int16] -and $value -isnot [uint16] -and $value -isnot [int32] -and $value -isnot [uint32] -and $value -isnot [int64] -and $value -isnot [uint64]) { return $null }
    if ([int64]$value -in @(2, 5, 70)) { return [int]$value }
    return $null
}

function Start-EventCenterProductionRollout {
    param([hashtable]$Dependencies)

    $requiredDependencies = @('EnvironmentReader', 'UtcClock', 'Sleep', 'EvidenceReader', 'CheckpointReader', 'SafeStatusSink', 'ToolchainGate', 'SourceCheck', 'PortablePreflight', 'SourceDrain')
    if ($null -eq $Dependencies -or $Dependencies.Count -ne $requiredDependencies.Count -or @($requiredDependencies | Where-Object { -not $Dependencies.ContainsKey($_) -or $Dependencies[$_] -isnot [scriptblock] }).Count -ne 0) {
        return 2
    }

    try {
        $environmentResult = Test-ProductionEnvironmentGate -Environment (& $Dependencies.EnvironmentReader)
        if ([string]$environmentResult.Status -cne 'READY') {
            Write-RunnerTransition -Dependencies $Dependencies -Phase 'ENV_GATE' -Status 'BLOCKED' -BoundedCounts @{ presentCount = [long]$environmentResult.PresentCount; requiredCount = [long]$environmentResult.RequiredCount } -AlertCodes (Get-RunnerSafeAlertCodes -Value $environmentResult)
            return 2
        }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'ENV_GATE' -Status 'READY' -BoundedCounts @{ presentCount = [long]$environmentResult.PresentCount; requiredCount = [long]$environmentResult.RequiredCount }

        $toolchainResult = & $Dependencies.ToolchainGate
        if ($null -eq $toolchainResult -or [string]$toolchainResult.Status -cne 'READY') {
            Write-RunnerTransition -Dependencies $Dependencies -Phase 'TOOLCHAIN_GATE' -Status 'BLOCKED' -AlertCodes (Get-RunnerSafeAlertCodes -Value $toolchainResult)
            return 2
        }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'TOOLCHAIN_GATE' -Status 'READY'

        $evidenceWaiting = $false
        while ($true) {
            $nowUtc = & $Dependencies.UtcClock
            $receipt = & $Dependencies.EvidenceReader
            $receiptResult = if ($null -eq $receipt) { [pscustomobject]@{ Status = 'INVALID'; AlertCodes = @('RECEIPT_MISSING') } } else { Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $nowUtc -MaxAge ([timespan]::FromMinutes(30)) }
            if ([string]$receiptResult.Status -ceq 'VALID') { break }
            if (-not $evidenceWaiting) {
                Write-RunnerTransition -Dependencies $Dependencies -Phase 'WAITING_EVIDENCE' -Status 'WAITING' -AlertCodes (Get-RunnerSafeAlertCodes -Value $receiptResult)
                $evidenceWaiting = $true
            }
            & $Dependencies.Sleep
        }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'EVIDENCE_GATE' -Status 'READY'

        $source = & $Dependencies.SourceCheck 'preflight'
        $sourceStatus = if ($null -ne $source) { [string]$source.Status } else { 'BLOCKED' }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'PREFLIGHT_SOURCE' -Status $sourceStatus -BoundedCounts (Get-RunnerBoundedCounts -Value $source -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $source)
        $sourceExitCode = Get-RunnerClassifiedExitCode -Result $source
        if ($null -ne $sourceExitCode) { return $sourceExitCode }
        if ($sourceStatus -cne 'READY') { return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence 0 }

        $portable = & $Dependencies.PortablePreflight
        $portableStatus = if ($null -ne $portable) { [string]$portable.Status } else { 'BLOCKED' }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'PREFLIGHT_PORTABLE' -Status $portableStatus -BoundedCounts (Get-RunnerBoundedCounts -Value $portable -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $portable)
        $portableExitCode = Get-RunnerClassifiedExitCode -Result $portable
        if ($null -ne $portableExitCode) { return $portableExitCode }
        if (-not (Test-RunnerSnapshotAgreement -Source $source -Portable $portable)) {
            Write-RunnerTransition -Dependencies $Dependencies -Phase 'PREFLIGHT_SNAPSHOT_MISMATCH' -Status 'BLOCKED' -AlertCodes @('PREFLIGHT_SNAPSHOT_MISMATCH')
            return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence 0
        }

        Write-RunnerTransition -Dependencies $Dependencies -Phase 'WAITING_GOVERNANCE_ACTION' -Status 'WAITING'
        $lastSequence = Wait-ProductionRunnerCheckpoint -Dependencies $Dependencies -LastSequence 0 -ExpectedCommand 'GOVERNANCE_COMPLETED'

        $firstDrain = & $Dependencies.SourceDrain
        $firstDrainReady = $null -ne $firstDrain -and [string]$firstDrain.Status -ceq 'complete'
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'DRAIN_FIRST' -Status $(if ($firstDrainReady) { 'READY' } else { 'BLOCKED' }) -BoundedCounts (Get-RunnerBoundedCounts -Value $firstDrain -Names @('Dispatched', 'Claimed', 'Succeeded', 'RetryScheduled', 'Manual', 'LeaseLost')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $firstDrain)
        $firstDrainExitCode = Get-RunnerClassifiedExitCode -Result $firstDrain
        if ($null -ne $firstDrainExitCode) { return $firstDrainExitCode }
        if (-not $firstDrainReady) { return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence $lastSequence }

        $secondDrain = & $Dependencies.SourceDrain
        $secondDrainExitCode = Get-RunnerClassifiedExitCode -Result $secondDrain
        if ($null -ne $secondDrainExitCode) { return $secondDrainExitCode }
        $secondDrainReady = $null -ne $secondDrain -and [string]$secondDrain.Status -ceq 'complete' -and [long]$secondDrain.Claimed -eq 0
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'DRAIN_SECOND' -Status $(if ($secondDrainReady) { 'READY' } else { 'BLOCKED' }) -BoundedCounts (Get-RunnerBoundedCounts -Value $secondDrain -Names @('Dispatched', 'Claimed', 'Succeeded', 'RetryScheduled', 'Manual', 'LeaseLost')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $secondDrain)
        if (-not $secondDrainReady) { return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence $lastSequence }

        $postDrain = & $Dependencies.SourceCheck 'preflight'
        $postDrainReady = $null -ne $postDrain -and [string]$postDrain.Status -ceq 'READY'
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'PREFLIGHT_AFTER_DRAIN' -Status $(if ($postDrainReady) { 'READY' } else { 'BLOCKED' }) -BoundedCounts (Get-RunnerBoundedCounts -Value $postDrain -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes (Get-RunnerSafeAlertCodes -Value $postDrain)
        $postDrainExitCode = Get-RunnerClassifiedExitCode -Result $postDrain
        if ($null -ne $postDrainExitCode) { return $postDrainExitCode }
        if (-not $postDrainReady) { return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence $lastSequence }

        Write-RunnerTransition -Dependencies $Dependencies -Phase 'WAITING_SINGLE_WORKER_ENABLE' -Status 'WAITING'
        $lastSequence = Wait-ProductionRunnerCheckpoint -Dependencies $Dependencies -LastSequence $lastSequence -ExpectedCommand 'SINGLE_WORKER_ENABLED'

        $canaryStartUtc = & $Dependencies.UtcClock
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'CANARY_STARTED' -Status 'READY' -UtcStart $canaryStartUtc -UtcEnd $canaryStartUtc
        $canary = & $Dependencies.SourceCheck 'canary'
        $canaryEndUtc = & $Dependencies.UtcClock
        if (($canaryEndUtc -isnot [datetime]) -or $canaryEndUtc.Kind -ne [DateTimeKind]::Utc -or $canaryEndUtc -lt $canaryStartUtc) {
            Write-RunnerTransition -Dependencies $Dependencies -Phase 'CANARY' -Status 'BLOCKED' -BoundedCounts (Get-RunnerBoundedCounts -Value $canary -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes @('CANARY_CLOCK_INVALID') -UtcStart $canaryStartUtc -UtcEnd $canaryStartUtc
            return 70
        }
        $canaryStatus = if ($null -ne $canary -and [string]$canary.Status -cin @('READY', 'DEGRADED', 'BLOCKED')) { [string]$canary.Status } else { 'BLOCKED' }
        $canaryAlertCodes = Get-RunnerSafeAlertCodes -Value $canary
        if ($canaryStatus -ceq 'READY' -and ($canaryEndUtc - $canaryStartUtc) -lt [timespan]::FromMinutes(15)) {
            $canaryStatus = 'BLOCKED'
            $canaryAlertCodes = @('CANARY_WINDOW_TOO_SHORT')
        }
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'CANARY' -Status $canaryStatus -BoundedCounts (Get-RunnerBoundedCounts -Value $canary -Names @('Undispatched', 'DueBacklog', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m')) -AlertCodes $canaryAlertCodes -UtcStart $canaryStartUtc -UtcEnd $canaryEndUtc
        $canaryExitCode = Get-RunnerClassifiedExitCode -Result $canary
        if ($null -ne $canaryExitCode) { return $canaryExitCode }
        if ($canaryStatus -ceq 'DEGRADED') {
            Write-RunnerTransition -Dependencies $Dependencies -Phase 'EXTENDED_OBSERVATION_REQUIRED' -Status 'DEGRADED' -AlertCodes @('EXTENDED_OBSERVATION_REQUIRED')
            return 3
        }
        if ($canaryStatus -cne 'READY') {
            return Complete-RunnerRollback -Dependencies $Dependencies -LastSequence $lastSequence
        }

        $lastSequence = Wait-ProductionRunnerCheckpoint -Dependencies $Dependencies -LastSequence $lastSequence -ExpectedCommand 'CANARY_GOVERNANCE_COMPLETED' -MinimumIssuedAtUtc $canaryStartUtc -MaximumIssuedAtUtc $canaryEndUtc
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'CANARY_GOVERNANCE_COMPLETED' -Status 'READY'
        Write-RunnerTransition -Dependencies $Dependencies -Phase 'READY' -Status 'READY'
        return 0
    }
    catch {
        return Get-RunnerFailureExitCode -FailureCode $_.Exception.Message
    }
}

Export-ModuleMember -Function Test-ProductionEnvironmentGate, Test-ProductionEvidenceReceipt, New-SafeStatusRecord, Write-SafeStatusRecord, ConvertFrom-EventCheckSummary, ConvertFrom-EventDrainSummary, Invoke-SafeNativeCommand, Test-PinnedToolchain, Start-EventCenterProductionRollout
