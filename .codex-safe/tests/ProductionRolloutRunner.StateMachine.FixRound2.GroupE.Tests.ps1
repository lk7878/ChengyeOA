Set-StrictMode -Version Latest

function New-GroupEWrapperImportHarness {
    $root = Join-Path $TestDrive ('task3-group-e-wrapper-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $root '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    $scriptPath = Join-Path $safeDirectory 'Invoke-EventCenterProductionRollout.ps1'
    $statusPath = Join-Path $safeDirectory 'production-runner-status.jsonl'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1') -Destination $scriptPath
    Set-Content -LiteralPath (Join-Path $safeDirectory 'ProductionRolloutRunner.Core.psm1') -Value @'
Write-Error 'RAW_GROUP_E_NON_TERMINATING_IMPORT_FIXTURE'
function Start-EventCenterProductionRollout {
    param([hashtable]$Dependencies)
    return 0
}
Export-ModuleMember -Function Start-EventCenterProductionRollout
'@ -NoNewline

    return [pscustomobject]@{ ScriptPath = $scriptPath; StatusPath = $statusPath }
}

function Invoke-GroupEWrapperChildProcess {
    param([object]$Harness)

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = (Get-Command powershell.exe).Source
    $process.StartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Harness.ScriptPath + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    [void]$process.Start()
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $standardOutput; StdErr = $standardError }
}

function Test-GroupESingleSafeConsoleRecord {
    param([string]$Text)

    $lines = @($Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -ne 1) { return $false }
    try { $record = $lines[0] | ConvertFrom-Json } catch { return $false }
    $expectedFields = @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
    $actualFields = @($record.PSObject.Properties.Name)
    return $actualFields.Count -eq 7 -and
        @($actualFields | Where-Object { $_ -cnotin $expectedFields }).Count -eq 0 -and
        @($expectedFields | Where-Object { $_ -cnotin $actualFields }).Count -eq 0 -and
        [string]$record.phase -ceq 'BOOTSTRAP_FAILURE' -and
        [string]$record.status -ceq 'BLOCKED' -and
        @($record.alertCodes).Count -eq 1 -and
        [string]$record.alertCodes[0] -ceq 'BOOTSTRAP_FAILURE'
}

function New-GroupEWrapperFunctionModule {
    $wrapperPath = Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1'
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'GROUP_E_WRAPPER_AST_INVALID' }
    $definitions = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] })
    $definitionText = [string]::Join([Environment]::NewLine, @($definitions | ForEach-Object { $_.Extent.Text }))
    return New-Module -ScriptBlock ([scriptblock]::Create($definitionText))
}

$script:GroupEWrapperModule = New-GroupEWrapperFunctionModule

function Test-GroupEAtomicFunctionAvailable {
    return & $script:GroupEWrapperModule {
        return $null -ne (Get-Command Invoke-RunnerBootstrapStatusAtomicWrite -CommandType Function -ErrorAction SilentlyContinue)
    }
}

function New-GroupESafeRecord {
    return [ordered]@{
        phase = 'BOOTSTRAP_FAILURE'
        status = 'BLOCKED'
        boundedCounts = @{}
        alertCodes = @('BOOTSTRAP_FAILURE')
        utcStart = '2026-07-26T01:02:03.0000000Z'
        utcEnd = '2026-07-26T01:02:03.0000000Z'
        elapsedSeconds = 0
    }
}

function New-GroupEHistorySafeRecord {
    param(
        [string]$Phase,
        [string]$Status,
        [hashtable]$BoundedCounts,
        [string[]]$AlertCodes,
        [string]$UtcStart,
        [string]$UtcEnd,
        [int]$ElapsedSeconds
    )

    return [ordered]@{
        phase = $Phase
        status = $Status
        boundedCounts = $BoundedCounts
        alertCodes = $AlertCodes
        utcStart = $UtcStart
        utcEnd = $UtcEnd
        elapsedSeconds = $ElapsedSeconds
    }
}

function New-GroupEAtomicWorkspace {
    $workspaceRoot = Join-Path $TestDrive ('group-e-atomic-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $workspaceRoot '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    return [pscustomobject]@{
        WorkspaceRoot = $workspaceRoot
        SafeDirectory = $safeDirectory
        TargetPath = (Join-Path $safeDirectory 'production-runner-status.jsonl')
    }
}

function New-GroupEAtomicOperations {
    return @{
        ReadExisting = {
            param([string]$TargetPath)
            [System.IO.File]::ReadAllText($TargetPath)
        }
        WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
        }
        MoveFirst = {
            param([string]$TemporaryPath, [string]$TargetPath)
            [System.IO.File]::Move($TemporaryPath, $TargetPath)
        }
        ReplaceExisting = {
            param([string]$TemporaryPath, [string]$TargetPath, [string]$BackupPath)
            [System.IO.File]::Replace($TemporaryPath, $TargetPath, $BackupPath)
        }
    }
}

function Invoke-GroupEAtomicWrite {
    param(
        [object]$Workspace,
        [object]$Record,
        [hashtable]$Operations
    )

    & $script:GroupEWrapperModule {
        param($InnerWorkspaceRoot, $InnerSafeDirectory, $InnerTargetPath, $InnerRecord, $InnerOperations)
        Invoke-RunnerBootstrapStatusAtomicWrite -TrustedWorkspaceRoot $InnerWorkspaceRoot -SafeDirectory $InnerSafeDirectory -TargetPath $InnerTargetPath -Record $InnerRecord -Operations $InnerOperations
    } $Workspace.WorkspaceRoot $Workspace.SafeDirectory $Workspace.TargetPath $Record $Operations
}

function Get-GroupEFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function Get-GroupEAtomicArtifacts {
    param([string]$Directory)

    return @(
        [System.IO.Directory]::GetFiles($Directory) |
            Where-Object {
                $name = [System.IO.Path]::GetFileName($_)
                $name.StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak'))
            }
    )
}

function New-GroupEReparseDirectory {
    param([string]$LinkPath, [string]$TargetPath)

    [System.IO.Directory]::CreateDirectory($TargetPath) | Out-Null
    & cmd.exe /c ('mklink /J "' + $LinkPath + '" "' + $TargetPath + '"') 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $item = Get-Item -LiteralPath $LinkPath -Force -ErrorAction SilentlyContinue
    return $null -ne $item -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

Describe 'Task 3 fix round 2 Group E I3b terminating bootstrap boundary' {
    It 'captures normally non-terminating module import errors as one console-only safe exit-70 record' {
        $harness = New-GroupEWrapperImportHarness
        $result = Invoke-GroupEWrapperChildProcess -Harness $harness

        $checks = [ordered]@{
            exit = $result.ExitCode -eq 70
            stderr = [string]::IsNullOrEmpty($result.StdErr)
            rawDiagnosticAbsent = ($result.StdOut + $result.StdErr) -cnotmatch 'RAW_GROUP_E_NON_TERMINATING_IMPORT_FIXTURE'
            singleSafeConsoleRecord = Test-GroupESingleSafeConsoleRecord -Text $result.StdOut
            copiedStatusAbsent = -not (Test-Path -LiteralPath $harness.StatusPath)
        }
        ([string]::Join(',', @($checks.Values | ForEach-Object { [string]$_ }))) | Should Be 'True,True,True,True,True'
    }
}

Describe 'Task 3 fix round 2 Group E I3a bootstrap atomic persistence' {
    It 'publishes one complete seven-field record through a same-directory first move' {
        $workspace = New-GroupEAtomicWorkspace
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations (New-GroupEAtomicOperations)

        $persisted = [System.IO.File]::ReadAllText($workspace.TargetPath).Trim() | ConvertFrom-Json
        @($persisted.PSObject.Properties.Name).Count | Should Be 7
        [string]$persisted.phase | Should Be 'BOOTSTRAP_FAILURE'
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'retains two valid existing JSONL records in order and appends the bootstrap record' {
        $workspace = New-GroupEAtomicWorkspace
        $firstPriorLine = (New-GroupEHistorySafeRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4
        $secondPriorLine = (New-GroupEHistorySafeRecord -Phase 'DRAIN' -Status 'DEGRADED' -BoundedCounts @{ claimed = 2; failed = 1 } -AlertCodes @('DRAIN_PENDING') -UtcStart '2026-07-26T01:01:00.0000000Z' -UtcEnd '2026-07-26T01:01:02.0000000Z' -ElapsedSeconds 2) | ConvertTo-Json -Compress -Depth 4
        [System.IO.File]::WriteAllText($workspace.TargetPath, $firstPriorLine + [Environment]::NewLine + $secondPriorLine + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations (New-GroupEAtomicOperations)

        $persistedLines = @(([System.IO.File]::ReadAllText($workspace.TargetPath) -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $persistedLines.Count | Should Be 3
        $persistedLines[0] | Should Be $firstPriorLine
        $persistedLines[1] | Should Be $secondPriorLine
        ($persistedLines[2] | ConvertFrom-Json).status | Should Be 'BLOCKED'
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'preserves the original target and cleans a partially written temporary artifact' {
        $workspace = New-GroupEAtomicWorkspace
        $originalContent = ((New-GroupEHistorySafeRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine
        [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
        $global:GroupEPartialWriteOperationCalled = $false
        $operations = New-GroupEAtomicOperations
        $operations.WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            $global:GroupEPartialWriteOperationCalled = $true
            [System.IO.File]::WriteAllText($TemporaryPath, 'PARTIAL', [System.Text.UTF8Encoding]::new($false))
            throw 'RAW_GROUP_E_PARTIAL_WRITE_FAILURE'
        }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations $operations }

        $failure | Should Not Be ''
        $failure | Should Not Match 'RAW_GROUP_E_PARTIAL_WRITE_FAILURE'
        $global:GroupEPartialWriteOperationCalled | Should Be $true
        [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
        Remove-Variable -Name GroupEPartialWriteOperationCalled -Scope Global -ErrorAction SilentlyContinue
    }

    It 'leaves no target and cleans the temporary artifact when first move fails' {
        $workspace = New-GroupEAtomicWorkspace
        $operations = New-GroupEAtomicOperations
        $operations.MoveFirst = {
            param([string]$TemporaryPath, [string]$TargetPath)
            throw 'RAW_GROUP_E_FIRST_MOVE_FAILURE'
        }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations $operations }

        $failure | Should Not Be ''
        $failure | Should Not Match 'RAW_GROUP_E_FIRST_MOVE_FAILURE'
        (Test-Path -LiteralPath $workspace.TargetPath) | Should Be $false
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'preserves the original target and cleans artifacts when replacement fails' {
        $workspace = New-GroupEAtomicWorkspace
        $originalContent = ((New-GroupEHistorySafeRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine
        [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
        $global:GroupEReplaceOperationCalled = $false
        $operations = New-GroupEAtomicOperations
        $operations.ReplaceExisting = {
            param([string]$TemporaryPath, [string]$TargetPath, [string]$BackupPath)
            $global:GroupEReplaceOperationCalled = $true
            throw 'RAW_GROUP_E_REPLACEMENT_FAILURE'
        }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations $operations }

        $failure | Should Not Be ''
        $failure | Should Not Match 'RAW_GROUP_E_REPLACEMENT_FAILURE'
        $global:GroupEReplaceOperationCalled | Should Be $true
        [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
        Remove-Variable -Name GroupEReplaceOperationCalled -Scope Global -ErrorAction SilentlyContinue
    }

    It 'rejects a reparse workspace ancestor before invoking any write operation' {
        $root = Join-Path $TestDrive ('group-e-reparse-ancestor-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($root) | Out-Null
        $physicalWorkspace = Join-Path $root 'physical-workspace'
        $linkedWorkspace = Join-Path $root 'linked-workspace'
        if (-not (New-GroupEReparseDirectory -LinkPath $linkedWorkspace -TargetPath $physicalWorkspace)) { throw 'SAFE_TEST_REPARSE_CAPABILITY_UNAVAILABLE' }
        $safeDirectory = Join-Path $linkedWorkspace '.codex-safe'
        [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
        $workspace = [pscustomobject]@{ WorkspaceRoot = $linkedWorkspace; SafeDirectory = $safeDirectory; TargetPath = (Join-Path $safeDirectory 'production-runner-status.jsonl') }
        $global:GroupEWriteOperationCalled = $false
        $operations = New-GroupEAtomicOperations
        $operations.WriteTemporary = { param([string]$TemporaryPath, [string]$Content) $global:GroupEWriteOperationCalled = $true }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations $operations }

        $failure | Should Not Be ''
        $global:GroupEWriteOperationCalled | Should Be $false
        (Test-Path -LiteralPath $workspace.TargetPath) | Should Be $false
        @(Get-GroupEAtomicArtifacts -Directory $safeDirectory).Count | Should Be 0
    }

    It 'rejects a reparse status target before invoking any write operation' {
        $workspace = New-GroupEAtomicWorkspace
        $backingDirectory = Join-Path $workspace.SafeDirectory 'status-backing'
        if (-not (New-GroupEReparseDirectory -LinkPath $workspace.TargetPath -TargetPath $backingDirectory)) { throw 'SAFE_TEST_REPARSE_CAPABILITY_UNAVAILABLE' }
        $global:GroupEWriteOperationCalled = $false
        $operations = New-GroupEAtomicOperations
        $operations.WriteTemporary = { param([string]$TemporaryPath, [string]$Content) $global:GroupEWriteOperationCalled = $true }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record (New-GroupESafeRecord) -Operations $operations }

        $failure | Should Not Be ''
        $global:GroupEWriteOperationCalled | Should Be $false
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'rejects a record outside the fixed seven-field safe schema before temporary creation' {
        $workspace = New-GroupEAtomicWorkspace
        $record = New-GroupESafeRecord
        $record['rawDiagnostic'] = 'RAW_GROUP_E_RECORD_FIELD'
        $global:GroupEWriteOperationCalled = $false
        $operations = New-GroupEAtomicOperations
        $operations.WriteTemporary = { param([string]$TemporaryPath, [string]$Content) $global:GroupEWriteOperationCalled = $true }
        (Test-GroupEAtomicFunctionAvailable) | Should Be $true

        $failure = Get-GroupEFailureMessage -Action { Invoke-GroupEAtomicWrite -Workspace $workspace -Record $record -Operations $operations }

        $failure | Should Not Be ''
        $failure | Should Not Match 'RAW_GROUP_E_RECORD_FIELD'
        $global:GroupEWriteOperationCalled | Should Be $false
        (Test-Path -LiteralPath $workspace.TargetPath) | Should Be $false
        @(Get-GroupEAtomicArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }
}
