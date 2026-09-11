Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

function New-GroupIWrapperFunctionModule {
    $wrapperPath = Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1'
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'GROUP_I_WRAPPER_AST_INVALID' }
    $definitions = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] })
    $definitionText = [string]::Join([Environment]::NewLine, @($definitions | ForEach-Object { $_.Extent.Text }))
    return New-Module -ScriptBlock ([scriptblock]::Create($definitionText))
}

$script:GroupIWrapperModule = New-GroupIWrapperFunctionModule

function New-GroupIBootstrapRecord {
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

function New-GroupIHistoryRecord {
    param([string]$Phase)

    return [ordered]@{
        phase = $Phase
        status = 'READY'
        boundedCounts = @{ completed = 1; failed = 0 }
        alertCodes = @('SAFE_TEST')
        utcStart = '2026-07-26T01:00:00.0000000Z'
        utcEnd = '2026-07-26T01:00:01.0000000Z'
        elapsedSeconds = 1
    }
}

function New-GroupIWorkspace {
    $workspaceRoot = Join-Path $TestDrive ('group-i-history-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $workspaceRoot '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    return [pscustomobject]@{
        WorkspaceRoot = $workspaceRoot
        SafeDirectory = $safeDirectory
        TargetPath = (Join-Path $safeDirectory 'production-runner-status.jsonl')
    }
}

function New-GroupIAtomicOperations {
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

function Invoke-GroupIAtomicWrite {
    param(
        [object]$Workspace,
        [hashtable]$Operations
    )

    & $script:GroupIWrapperModule {
        param($InnerWorkspaceRoot, $InnerSafeDirectory, $InnerTargetPath, $InnerRecord, $InnerOperations)
        Invoke-RunnerBootstrapStatusAtomicWrite -TrustedWorkspaceRoot $InnerWorkspaceRoot -SafeDirectory $InnerSafeDirectory -TargetPath $InnerTargetPath -Record $InnerRecord -Operations $InnerOperations
    } $Workspace.WorkspaceRoot $Workspace.SafeDirectory $Workspace.TargetPath (New-GroupIBootstrapRecord) $Operations
}

function Get-GroupIFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function Assert-GroupIRejectedHistoryWithoutTemporaryWrite {
    param([string]$ExistingLine)

    $workspace = New-GroupIWorkspace
    $originalContent = $ExistingLine + [Environment]::NewLine
    [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
    $global:GroupITemporaryWriteAttempted = $false
    $operations = New-GroupIAtomicOperations
    $operations.WriteTemporary = {
        param([string]$TemporaryPath, [string]$Content)
        $global:GroupITemporaryWriteAttempted = $true
        throw 'RAW_GROUP_I_TEMPORARY_WRITE_AFTER_INVALID_HISTORY'
    }

    $failure = Get-GroupIFailureMessage -Action { Invoke-GroupIAtomicWrite -Workspace $workspace -Operations $operations }

    $failure | Should Be 'SAFE_STATUS_WRITE_FAILED'
    $global:GroupITemporaryWriteAttempted | Should Be $false
    [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
    Remove-Variable -Name GroupITemporaryWriteAttempted -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Task 3 fix round 4 Group I strict bootstrap JSON history validation' {
    It 'rejects duplicate top-level JSON keys before temporary writing' {
        Assert-GroupIRejectedHistoryWithoutTemporaryWrite -ExistingLine '{"phase":"PRECHECK","phase":"OVERRIDE","status":"READY","boundedCounts":{"completed":1,"failed":0},"alertCodes":["SAFE_TEST"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'
    }

    It 'rejects duplicate boundedCounts JSON keys before temporary writing' {
        Assert-GroupIRejectedHistoryWithoutTemporaryWrite -ExistingLine '{"phase":"PRECHECK","status":"READY","boundedCounts":{"completed":1,"completed":2},"alertCodes":["SAFE_TEST"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'
    }

    It 'rejects escaped-equivalent duplicate JSON keys before temporary writing' {
        Assert-GroupIRejectedHistoryWithoutTemporaryWrite -ExistingLine '{"phase":"PRECHECK","ph\u0061se":"OVERRIDE","status":"READY","boundedCounts":{"completed":1,"failed":0},"alertCodes":["SAFE_TEST"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'
    }

    It 'accepts a safe JSON string value containing key-like text' {
        $workspace = New-GroupIWorkspace
        $keyLikePhase = 'PRECHECK "phase":"EMBEDDED"'
        $originalLine = (New-GroupIHistoryRecord -Phase $keyLikePhase | ConvertTo-Json -Compress -Depth 4)
        [System.IO.File]::WriteAllText($workspace.TargetPath, $originalLine + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
        $global:GroupITemporaryWriteAttempted = $false
        $operations = New-GroupIAtomicOperations
        $operations.WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            $global:GroupITemporaryWriteAttempted = $true
            [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
        }

        Invoke-GroupIAtomicWrite -Workspace $workspace -Operations $operations

        $persistedLines = @(([System.IO.File]::ReadAllText($workspace.TargetPath) -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $persistedLines.Count | Should Be 2
        ($persistedLines[0] | ConvertFrom-Json).phase | Should Be $keyLikePhase
        $global:GroupITemporaryWriteAttempted | Should Be $true
        Remove-Variable -Name GroupITemporaryWriteAttempted -Scope Global -ErrorAction SilentlyContinue
    }

    It 'rejects a lowercase alert code when creating a Core safe status record' {
        $nowUtc = [datetime]::SpecifyKind([datetime]'2026-07-26T01:02:03', [DateTimeKind]::Utc)

        { New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{} -AlertCodes @('lowercase_only') -UtcStart $nowUtc -UtcEnd $nowUtc } | Should Throw 'SAFE_RECORD_INVALID'
    }

    It 'rejects a lowercase alert code in existing wrapper history before temporary writing' {
        $lowercaseAlertLine = '{"phase":"PRECHECK","status":"READY","boundedCounts":{"completed":1,"failed":0},"alertCodes":["lowercase_only"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'

        Assert-GroupIRejectedHistoryWithoutTemporaryWrite -ExistingLine $lowercaseAlertLine
    }
}
