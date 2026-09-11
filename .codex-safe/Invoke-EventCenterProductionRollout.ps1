Set-StrictMode -Version Latest

$trustedWorkspaceRoot = [System.IO.Path]::GetFullPath('D:\2_test\16_ChengyeOA').TrimEnd([char[]]'\/')
$safeDirectory = $PSScriptRoot
$workspaceRoot = Split-Path $safeDirectory -Parent
$modulePath = Join-Path $safeDirectory 'ProductionRolloutRunner.Core.psm1'
$evidencePath = Join-Path $safeDirectory 'production-rollout-evidence.json'
$checkpointPath = Join-Path $safeDirectory 'production-runner-control.json'
$statusPath = Join-Path $safeDirectory 'production-runner-status.jsonl'

function Assert-RunnerBootstrapSafeText {
    param([object]$Value)

    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)\b[a-z][a-z0-9+.-]*:') {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
}

function Assert-RunnerBootstrapNonNegativeInteger {
    param([object]$Value)

    if (($Value -isnot [int]) -and ($Value -isnot [long]) -and ($Value -isnot [uint32]) -and ($Value -isnot [uint64])) {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
    if ([decimal]$Value -lt 0) {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
}

function Skip-RunnerBootstrapJsonWhitespace {
    param([string]$Text, [ref]$Index)

    while ($Index.Value -lt $Text.Length -and $Text[$Index.Value] -in @([char]' ', [char]"`t", [char]"`r", [char]"`n")) {
        $Index.Value++
    }
}

function Try-ReadRunnerBootstrapJsonString {
    param([string]$Text, [ref]$Index, [ref]$Value)

    if ($Index.Value -ge $Text.Length -or $Text[$Index.Value] -ne [char]'"') {
        return $false
    }

    $builder = [System.Text.StringBuilder]::new()
    $position = $Index.Value + 1
    while ($position -lt $Text.Length) {
        $character = $Text[$position]
        if ($character -eq [char]'"') {
            $Index.Value = $position + 1
            $Value.Value = $builder.ToString()
            return $true
        }
        if ($character -lt [char]0x20) {
            return $false
        }
        if ($character -ne [char]'\') {
            [void]$builder.Append($character)
            $position++
            continue
        }

        $position++
        if ($position -ge $Text.Length) {
            return $false
        }
        $escape = $Text[$position]
        switch ($escape) {
            '"' { [void]$builder.Append([char]'"') }
            '\' { [void]$builder.Append([char]'\') }
            '/' { [void]$builder.Append([char]'/') }
            'b' { [void]$builder.Append([char]0x08) }
            'f' { [void]$builder.Append([char]0x0c) }
            'n' { [void]$builder.Append([char]"`n") }
            'r' { [void]$builder.Append([char]"`r") }
            't' { [void]$builder.Append([char]"`t") }
            'u' {
                if ($position + 4 -ge $Text.Length) {
                    return $false
                }
                $codeUnit = 0
                $hex = $Text.Substring($position + 1, 4)
                if (-not [int]::TryParse($hex, [System.Globalization.NumberStyles]::AllowHexSpecifier, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$codeUnit)) {
                    return $false
                }
                [void]$builder.Append([char]$codeUnit)
                $position += 4
            }
            default { return $false }
        }
        $position++
    }

    return $false
}

function Test-RunnerBootstrapJsonValue {
    param([string]$Text, [ref]$Index, [ref]$HasDuplicateKey)

    Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
    if ($Index.Value -ge $Text.Length) {
        return $false
    }

    switch ($Text[$Index.Value]) {
        '{' { return Test-RunnerBootstrapJsonObject -Text $Text -Index $Index -HasDuplicateKey $HasDuplicateKey }
        '[' { return Test-RunnerBootstrapJsonArray -Text $Text -Index $Index -HasDuplicateKey $HasDuplicateKey }
        '"' {
            $stringValue = $null
            return Try-ReadRunnerBootstrapJsonString -Text $Text -Index $Index -Value ([ref]$stringValue)
        }
        default {
            $remaining = $Text.Substring($Index.Value)
            foreach ($literal in @('true', 'false', 'null')) {
                if ($remaining.StartsWith($literal, [System.StringComparison]::Ordinal)) {
                    $Index.Value += $literal.Length
                    return $true
                }
            }
            $numberMatch = [System.Text.RegularExpressions.Regex]::Match(
                $remaining,
                '^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
            )
            if (-not $numberMatch.Success) {
                return $false
            }
            $Index.Value += $numberMatch.Length
            return $true
        }
    }
}

function Test-RunnerBootstrapJsonObject {
    param([string]$Text, [ref]$Index, [ref]$HasDuplicateKey)

    if ($Text[$Index.Value] -ne [char]'{') {
        return $false
    }
    $Index.Value++
    Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    if ($Index.Value -lt $Text.Length -and $Text[$Index.Value] -eq [char]'}') {
        $Index.Value++
        return $true
    }

    while ($true) {
        $key = $null
        if (-not (Try-ReadRunnerBootstrapJsonString -Text $Text -Index $Index -Value ([ref]$key))) {
            return $false
        }
        if (-not $keys.Add($key)) {
            $HasDuplicateKey.Value = $true
        }
        Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
        if ($Index.Value -ge $Text.Length -or $Text[$Index.Value] -ne [char]':') {
            return $false
        }
        $Index.Value++
        if (-not (Test-RunnerBootstrapJsonValue -Text $Text -Index $Index -HasDuplicateKey $HasDuplicateKey)) {
            return $false
        }
        Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
        if ($Index.Value -lt $Text.Length -and $Text[$Index.Value] -eq [char]'}') {
            $Index.Value++
            return $true
        }
        if ($Index.Value -ge $Text.Length -or $Text[$Index.Value] -ne [char]',') {
            return $false
        }
        $Index.Value++
        Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
    }
}

function Test-RunnerBootstrapJsonArray {
    param([string]$Text, [ref]$Index, [ref]$HasDuplicateKey)

    if ($Text[$Index.Value] -ne [char]'[') {
        return $false
    }
    $Index.Value++
    Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
    if ($Index.Value -lt $Text.Length -and $Text[$Index.Value] -eq [char]']') {
        $Index.Value++
        return $true
    }

    while ($true) {
        if (-not (Test-RunnerBootstrapJsonValue -Text $Text -Index $Index -HasDuplicateKey $HasDuplicateKey)) {
            return $false
        }
        Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
        if ($Index.Value -lt $Text.Length -and $Text[$Index.Value] -eq [char]']') {
            $Index.Value++
            return $true
        }
        if ($Index.Value -ge $Text.Length -or $Text[$Index.Value] -ne [char]',') {
            return $false
        }
        $Index.Value++
        Skip-RunnerBootstrapJsonWhitespace -Text $Text -Index $Index
    }
}

function Assert-RunnerBootstrapNoDuplicateJsonObjectKeys {
    param([string]$Line)

    $index = 0
    $hasDuplicateKey = $false
    $parsed = Test-RunnerBootstrapJsonValue -Text $Line -Index ([ref]$index) -HasDuplicateKey ([ref]$hasDuplicateKey)
    Skip-RunnerBootstrapJsonWhitespace -Text $Line -Index ([ref]$index)
    if (-not $parsed -or $index -ne $Line.Length -or $hasDuplicateKey) {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
}

function Assert-RunnerBootstrapExistingJsonLine {
    param([string]$Line)

    try {
        Assert-RunnerBootstrapNoDuplicateJsonObjectKeys -Line $Line
        $record = $Line | ConvertFrom-Json -ErrorAction Stop
        $expectedFields = @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
        $actualFields = @($record.PSObject.Properties.Name)
        if ($null -eq $record -or $actualFields.Count -ne $expectedFields.Count -or
            @($actualFields | Where-Object { $_ -cnotin $expectedFields }).Count -ne 0 -or
            @($expectedFields | Where-Object { $_ -cnotin $actualFields }).Count -ne 0) {
            throw 'SAFE_STATUS_WRITE_FAILED'
        }

        Assert-RunnerBootstrapSafeText -Value $record.phase
        Assert-RunnerBootstrapSafeText -Value $record.status

        $counts = $record.boundedCounts
        if ($counts -isnot [System.Collections.IDictionary] -and $counts -isnot [pscustomobject]) {
            throw 'SAFE_STATUS_WRITE_FAILED'
        }
        if ($counts -is [System.Collections.IDictionary]) {
            foreach ($countKey in $counts.Keys) {
                Assert-RunnerBootstrapSafeText -Value $countKey
                Assert-RunnerBootstrapNonNegativeInteger -Value $counts[$countKey]
            }
        }
        else {
            foreach ($countProperty in @($counts.PSObject.Properties)) {
                Assert-RunnerBootstrapSafeText -Value $countProperty.Name
                Assert-RunnerBootstrapNonNegativeInteger -Value $countProperty.Value
            }
        }

        $alertCodes = $record.alertCodes
        if ($null -eq $alertCodes -or $alertCodes -is [string] -or $alertCodes -isnot [System.Collections.IEnumerable]) {
            throw 'SAFE_STATUS_WRITE_FAILED'
        }
        foreach ($alertCode in $alertCodes) {
            if ($alertCode -isnot [string] -or $alertCode -cnotmatch '^[A-Z0-9_]+$') {
                throw 'SAFE_STATUS_WRITE_FAILED'
            }
        }

        foreach ($utcField in @('utcStart', 'utcEnd')) {
            if ($record.$utcField -isnot [string]) {
                throw 'SAFE_STATUS_WRITE_FAILED'
            }
            $parsedUtc = [datetime]::MinValue
            if (-not [datetime]::TryParse($record.$utcField, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedUtc) -or
                $parsedUtc.Kind -ne [DateTimeKind]::Utc) {
                throw 'SAFE_STATUS_WRITE_FAILED'
            }
        }
        Assert-RunnerBootstrapNonNegativeInteger -Value $record.elapsedSeconds
    }
    catch {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }
}

function Invoke-RunnerBootstrapStatusAtomicWrite {
    param(
        [string]$TrustedWorkspaceRoot,
        [string]$SafeDirectory,
        [string]$TargetPath,
        [object]$Record,
        [hashtable]$Operations
    )

    try {
        if ($Record -isnot [System.Collections.IDictionary]) {
            throw 'SAFE_BOOTSTRAP_RECORD_INVALID'
        }
        $expectedFields = @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
        $actualFields = @($Record.Keys)
        if ($actualFields.Count -ne $expectedFields.Count -or
            @($actualFields | Where-Object { [string]$_ -cnotin $expectedFields }).Count -ne 0 -or
            @($expectedFields | Where-Object { $_ -cnotin $actualFields }).Count -ne 0) {
            throw 'SAFE_BOOTSTRAP_RECORD_INVALID'
        }
        if ($Record.phase -isnot [string] -or $Record.phase -cne 'BOOTSTRAP_FAILURE' -or
            $Record.status -isnot [string] -or $Record.status -cne 'BLOCKED' -or
            $Record.boundedCounts -isnot [System.Collections.IDictionary] -or $Record.boundedCounts.Count -ne 0 -or
            @($Record.alertCodes).Count -ne 1 -or $Record.alertCodes[0] -isnot [string] -or $Record.alertCodes[0] -cne 'BOOTSTRAP_FAILURE' -or
            $Record.utcStart -isnot [string] -or $Record.utcEnd -isnot [string] -or
            $Record.elapsedSeconds -isnot [int] -or $Record.elapsedSeconds -ne 0) {
            throw 'SAFE_BOOTSTRAP_RECORD_INVALID'
        }
        $parsedStartUtc = [datetime]::MinValue
        $parsedEndUtc = [datetime]::MinValue
        if (-not [datetime]::TryParse($Record.utcStart, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedStartUtc) -or
            -not [datetime]::TryParse($Record.utcEnd, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedEndUtc) -or
            $parsedStartUtc.Kind -ne [DateTimeKind]::Utc -or $parsedEndUtc.Kind -ne [DateTimeKind]::Utc -or
            $parsedStartUtc -ne $parsedEndUtc) {
            throw 'SAFE_BOOTSTRAP_RECORD_INVALID'
        }
        $jsonLine = $Record | ConvertTo-Json -Compress -Depth 4 -ErrorAction Stop
    }
    catch {
        throw 'SAFE_BOOTSTRAP_RECORD_INVALID'
    }

    try {
        $canonicalWorkspaceRoot = [System.IO.Path]::GetFullPath($TrustedWorkspaceRoot).TrimEnd([char[]]'\/')
        $canonicalSafeDirectory = [System.IO.Path]::GetFullPath($SafeDirectory).TrimEnd([char[]]'\/')
        $canonicalTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
        $expectedSafeDirectory = [System.IO.Path]::GetFullPath((Join-Path $canonicalWorkspaceRoot '.codex-safe')).TrimEnd([char[]]'\/')
        $expectedTargetPath = [System.IO.Path]::GetFullPath((Join-Path $expectedSafeDirectory 'production-runner-status.jsonl'))
        if (-not $canonicalSafeDirectory.Equals($expectedSafeDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $canonicalTargetPath.Equals($expectedTargetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }

        foreach ($physicalDirectory in @($canonicalWorkspaceRoot, $canonicalSafeDirectory)) {
            $directoryItem = Get-Item -LiteralPath $physicalDirectory -Force -ErrorAction Stop
            if (-not $directoryItem.PSIsContainer -or ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'SAFE_STATUS_PATH_INVALID'
            }
        }
        $targetExists = Test-Path -LiteralPath $canonicalTargetPath -ErrorAction Stop
        if ($targetExists) {
            $targetItem = Get-Item -LiteralPath $canonicalTargetPath -Force -ErrorAction Stop
            if ($targetItem.PSIsContainer -or ($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'SAFE_STATUS_PATH_INVALID'
            }
        }
    }
    catch {
        throw 'SAFE_STATUS_PATH_INVALID'
    }

    $temporaryPath = Join-Path $canonicalSafeDirectory ('.' + [System.IO.Path]::GetRandomFileName() + '.tmp')
    $backupPath = Join-Path $canonicalSafeDirectory ('.' + [System.IO.Path]::GetRandomFileName() + '.bak')
    if ($null -eq $Operations) {
        $Operations = @{
            ReadExisting = {
                param($InnerTargetPath)
                [System.IO.File]::ReadAllText($InnerTargetPath)
            }
            WriteTemporary = {
                param($TemporaryPath, $Content)
                [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
            }
            MoveFirst = {
                param($TemporaryPath, $InnerTargetPath)
                [System.IO.File]::Move($TemporaryPath, $InnerTargetPath)
            }
            ReplaceExisting = {
                param($TemporaryPath, $InnerTargetPath, $InnerBackupPath)
                [System.IO.File]::Replace($TemporaryPath, $InnerTargetPath, $InnerBackupPath)
            }
        }
    }

    try {
        $expectedOperationKeys = @('ReadExisting', 'WriteTemporary', 'MoveFirst', 'ReplaceExisting')
        $actualOperationKeys = @($Operations.Keys)
        if ($actualOperationKeys.Count -ne $expectedOperationKeys.Count -or
            @($actualOperationKeys | Where-Object { $_ -cnotin $expectedOperationKeys }).Count -ne 0 -or
            @($expectedOperationKeys | Where-Object { $_ -cnotin $actualOperationKeys }).Count -ne 0) {
            throw 'SAFE_STATUS_WRITE_FAILED'
        }

        $content = $jsonLine + [Environment]::NewLine
        if ($targetExists) {
            $existingContent = & $Operations.ReadExisting $canonicalTargetPath
            if ($existingContent -isnot [string]) {
                throw 'SAFE_STATUS_WRITE_FAILED'
            }
            foreach ($existingLine in ($existingContent -split "`r?`n")) {
                if ([string]::IsNullOrEmpty($existingLine)) { continue }
                Assert-RunnerBootstrapExistingJsonLine -Line $existingLine
            }
            $content = $existingContent
            if (-not $content.EndsWith("`n")) {
                $content += [Environment]::NewLine
            }
            $content += $jsonLine + [Environment]::NewLine
        }
    }
    catch {
        throw 'SAFE_STATUS_WRITE_FAILED'
    }

    try {
        & $Operations.WriteTemporary $temporaryPath $content
        if ($targetExists) {
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

function Write-RunnerBootstrapFailure {
    $nowUtc = [datetime]::UtcNow
    $record = [ordered]@{
        phase = 'BOOTSTRAP_FAILURE'
        status = 'BLOCKED'
        boundedCounts = @{}
        alertCodes = @('BOOTSTRAP_FAILURE')
        utcStart = $nowUtc.ToString('o')
        utcEnd = $nowUtc.ToString('o')
        elapsedSeconds = 0
    }
    $jsonLine = $record | ConvertTo-Json -Compress -Depth 4
    try {
        Invoke-RunnerBootstrapStatusAtomicWrite -TrustedWorkspaceRoot $trustedWorkspaceRoot -SafeDirectory $safeDirectory -TargetPath $statusPath -Record $record -Operations $null
    }
    catch {
    }
    try {
        [Console]::Out.WriteLine($jsonLine)
    }
    catch {
    }
}

try {
    $ErrorActionPreference = 'Stop'
    Import-Module $modulePath -Force -ErrorAction Stop

    function Read-RunnerJsonFile {
        param([string]$Path, [string]$UtcProperty)

        if (-not [System.IO.File]::Exists($Path)) { return $null }
        try {
            $jsonText = [System.IO.File]::ReadAllText($Path)
            Assert-RunnerBootstrapNoDuplicateJsonObjectKeys -Line $jsonText
            $value = $jsonText | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $value -and $value.PSObject.Properties.Name -ccontains $UtcProperty) {
                $parsedUtc = [datetime]::MinValue
                if ([datetime]::TryParse([string]$value.$UtcProperty, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedUtc) -and $parsedUtc.Kind -eq [DateTimeKind]::Utc) {
                    $value.$UtcProperty = $parsedUtc
                }
            }
            return $value
        }
        catch {
            return $null
        }
    }

    $dependencies = @{
        EnvironmentReader = {
            return @{
                DATABASE_URL = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
                JWT_SECRET = [Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
                APP_KEYS = [Environment]::GetEnvironmentVariable('APP_KEYS', 'Process')
                MFA_ENCRYPTION_KEY_V1 = [Environment]::GetEnvironmentVariable('MFA_ENCRYPTION_KEY_V1', 'Process')
                CORS_ALLOWED_ORIGINS = [Environment]::GetEnvironmentVariable('CORS_ALLOWED_ORIGINS', 'Process')
                EVENT_WORKER_ENABLED = [Environment]::GetEnvironmentVariable('EVENT_WORKER_ENABLED', 'Process')
                NODE_ENV = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
            }
        }
        UtcClock = { return [datetime]::UtcNow }
        Sleep = { Start-Sleep -Seconds 5 }
        EvidenceReader = { return Read-RunnerJsonFile -Path $evidencePath -UtcProperty 'verifiedAtUtc' }
        CheckpointReader = { return Read-RunnerJsonFile -Path $checkpointPath -UtcProperty 'issuedAtUtc' }
        SafeStatusSink = {
            param($Record)
            Write-SafeStatusRecord -Path $statusPath -Record $Record
            [Console]::Out.WriteLine(($Record | ConvertTo-Json -Compress -Depth 4))
        }
        ToolchainGate = { return Test-PinnedToolchain -WorkspaceRoot $workspaceRoot }
        SourceCheck = { param($Mode) return Invoke-SafeNativeCommand -CommandKind 'source-check' -Mode $Mode -WorkspaceRoot $workspaceRoot }
        PortablePreflight = { return Invoke-SafeNativeCommand -CommandKind 'portable-check' -Mode 'preflight' -WorkspaceRoot $workspaceRoot }
        SourceDrain = { return Invoke-SafeNativeCommand -CommandKind 'source-drain' -Mode '' -WorkspaceRoot $workspaceRoot }
    }

    $exitCode = Start-EventCenterProductionRollout -Dependencies $dependencies
    exit $exitCode
}
catch {
    Write-RunnerBootstrapFailure
    exit 70
}
