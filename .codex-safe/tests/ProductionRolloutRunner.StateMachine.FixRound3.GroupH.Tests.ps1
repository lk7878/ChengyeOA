Set-StrictMode -Version Latest

function New-GroupHWrapperFunctionModule {
    $wrapperPath = Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1'
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'GROUP_H_WRAPPER_AST_INVALID' }
    $definitions = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] })
    $definitionText = [string]::Join([Environment]::NewLine, @($definitions | ForEach-Object { $_.Extent.Text }))
    return New-Module -ScriptBlock ([scriptblock]::Create($definitionText))
}

$script:GroupHWrapperModule = New-GroupHWrapperFunctionModule

function New-GroupHBootstrapRecord {
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

function New-GroupHHistoryRecord {
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

function New-GroupHWorkspace {
    $workspaceRoot = Join-Path $TestDrive ('group-h-history-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $workspaceRoot '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    return [pscustomobject]@{
        WorkspaceRoot = $workspaceRoot
        SafeDirectory = $safeDirectory
        TargetPath = (Join-Path $safeDirectory 'production-runner-status.jsonl')
    }
}

function New-GroupHAtomicOperations {
    return @{
        ReadExisting = {
            param([string]$TargetPath)
            return [System.IO.File]::ReadAllText($TargetPath)
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

function Invoke-GroupHAtomicWrite {
    param(
        [object]$Workspace,
        [hashtable]$Operations
    )

    $record = New-GroupHBootstrapRecord
    & $script:GroupHWrapperModule {
        param($InnerWorkspaceRoot, $InnerSafeDirectory, $InnerTargetPath, $InnerRecord, $InnerOperations)
        Invoke-RunnerBootstrapStatusAtomicWrite -TrustedWorkspaceRoot $InnerWorkspaceRoot -SafeDirectory $InnerSafeDirectory -TargetPath $InnerTargetPath -Record $InnerRecord -Operations $InnerOperations
    } $Workspace.WorkspaceRoot $Workspace.SafeDirectory $Workspace.TargetPath $record $Operations
}

function Get-GroupHFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function Get-GroupHArtifacts {
    param([string]$Directory)

    return @(
        [System.IO.Directory]::GetFiles($Directory) |
            Where-Object {
                $name = [System.IO.Path]::GetFileName($_)
                $name.StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak'))
            }
    )
}

Describe 'Task 3 fix round 3 Group H bootstrap JSONL history preservation' {
    It 'retains two valid prior safe JSONL lines byte-for-byte in order and appends bootstrap last' {
        $workspace = New-GroupHWorkspace
        $firstPriorLine = (New-GroupHHistoryRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4
        $secondPriorLine = (New-GroupHHistoryRecord -Phase 'DRAIN' -Status 'DEGRADED' -BoundedCounts @{ claimed = 2; failed = 1 } -AlertCodes @('DRAIN_PENDING') -UtcStart '2026-07-26T01:01:00.0000000Z' -UtcEnd '2026-07-26T01:01:02.0000000Z' -ElapsedSeconds 2) | ConvertTo-Json -Compress -Depth 4
        [System.IO.File]::WriteAllText($workspace.TargetPath, $firstPriorLine + [Environment]::NewLine + $secondPriorLine + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

        Invoke-GroupHAtomicWrite -Workspace $workspace -Operations (New-GroupHAtomicOperations)

        $persistedLines = @(([System.IO.File]::ReadAllText($workspace.TargetPath) -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $persistedLines.Count | Should Be 3
        $persistedLines[0] | Should Be $firstPriorLine
        $persistedLines[1] | Should Be $secondPriorLine
        ($persistedLines[2] | ConvertFrom-Json).phase | Should Be 'BOOTSTRAP_FAILURE'
        @(Get-GroupHArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'rejects an invalid existing JSONL line without writing or changing the target' {
        $workspace = New-GroupHWorkspace
        $validPriorLine = (New-GroupHHistoryRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4
        $originalContent = $validPriorLine + [Environment]::NewLine + '{"phase":"MALFORMED"}' + [Environment]::NewLine
        [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
        $global:GroupHWriteAttempted = $false
        $operations = New-GroupHAtomicOperations
        $operations.WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            $global:GroupHWriteAttempted = $true
            throw 'RAW_GROUP_H_WRITE_AFTER_INVALID_HISTORY'
        }

        $failure = Get-GroupHFailureMessage -Action { Invoke-GroupHAtomicWrite -Workspace $workspace -Operations $operations }

        $failure | Should Be 'SAFE_STATUS_WRITE_FAILED'
        $global:GroupHWriteAttempted | Should Be $false
        [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
        @(Get-GroupHArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }

    It 'converts an existing-target read failure to sanitized persistence failure before any write' {
        $workspace = New-GroupHWorkspace
        $originalContent = ((New-GroupHHistoryRecord -Phase 'PRECHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart '2026-07-26T01:00:00.0000000Z' -UtcEnd '2026-07-26T01:00:01.0000000Z' -ElapsedSeconds 1) | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine
        [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
        $global:GroupHReadAttempted = $false
        $global:GroupHWriteAttempted = $false
        $operations = New-GroupHAtomicOperations
        $operations.ReadExisting = {
            param([string]$TargetPath)
            $global:GroupHReadAttempted = $true
            throw 'RAW_GROUP_H_EXISTING_READ_FAILURE'
        }
        $operations.WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            $global:GroupHWriteAttempted = $true
            throw 'RAW_GROUP_H_WRITE_AFTER_READ_FAILURE'
        }

        $failure = Get-GroupHFailureMessage -Action { Invoke-GroupHAtomicWrite -Workspace $workspace -Operations $operations }

        $failure | Should Be 'SAFE_STATUS_WRITE_FAILED'
        $global:GroupHReadAttempted | Should Be $true
        $global:GroupHWriteAttempted | Should Be $false
        [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
        @(Get-GroupHArtifacts -Directory $workspace.SafeDirectory).Count | Should Be 0
    }
}
