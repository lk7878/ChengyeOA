Set-StrictMode -Version Latest

function New-GroupJWrapperFunctionModule {
    $wrapperPath = Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1'
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'GROUP_J_WRAPPER_AST_INVALID' }
    $definitions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
    $definitionText = [string]::Join([Environment]::NewLine, @($definitions | ForEach-Object { $_.Extent.Text }))
    return New-Module -ScriptBlock ([scriptblock]::Create($definitionText))
}

$script:GroupJWrapperModule = New-GroupJWrapperFunctionModule

function New-GroupJBootstrapRecord {
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

function New-GroupJWorkspace {
    $workspaceRoot = Join-Path $TestDrive ('group-j-history-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $workspaceRoot '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    return [pscustomobject]@{
        WorkspaceRoot = $workspaceRoot
        SafeDirectory = $safeDirectory
        TargetPath = (Join-Path $safeDirectory 'production-runner-status.jsonl')
    }
}

function New-GroupJAtomicOperations {
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

function Invoke-GroupJAtomicWrite {
    param([object]$Workspace, [hashtable]$Operations)

    & $script:GroupJWrapperModule {
        param($InnerWorkspaceRoot, $InnerSafeDirectory, $InnerTargetPath, $InnerRecord, $InnerOperations)
        Invoke-RunnerBootstrapStatusAtomicWrite -TrustedWorkspaceRoot $InnerWorkspaceRoot -SafeDirectory $InnerSafeDirectory -TargetPath $InnerTargetPath -Record $InnerRecord -Operations $InnerOperations
    } $Workspace.WorkspaceRoot $Workspace.SafeDirectory $Workspace.TargetPath (New-GroupJBootstrapRecord) $Operations
}

function Get-GroupJFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function Assert-GroupJRejectedHistoryWithoutTemporaryWrite {
    param([string]$ExistingLine)

    $workspace = New-GroupJWorkspace
    $originalContent = $ExistingLine + [Environment]::NewLine
    [System.IO.File]::WriteAllText($workspace.TargetPath, $originalContent, [System.Text.UTF8Encoding]::new($false))
    $global:GroupJTemporaryWriteAttempted = $false
    $operations = New-GroupJAtomicOperations
    $operations.WriteTemporary = {
        param([string]$TemporaryPath, [string]$Content)
        $global:GroupJTemporaryWriteAttempted = $true
        throw 'RAW_GROUP_J_TEMPORARY_WRITE_AFTER_INVALID_HISTORY'
    }

    $failure = Get-GroupJFailureMessage -Action { Invoke-GroupJAtomicWrite -Workspace $workspace -Operations $operations }

    $failure | Should Be 'SAFE_STATUS_WRITE_FAILED'
    $global:GroupJTemporaryWriteAttempted | Should Be $false
    [System.IO.File]::ReadAllText($workspace.TargetPath) | Should Be $originalContent
    Remove-Variable -Name GroupJTemporaryWriteAttempted -Scope Global -ErrorAction SilentlyContinue
}

function Invoke-GroupJStrictJsonValidation {
    param([string]$Text)

    & $script:GroupJWrapperModule {
        param($InnerText)
        Assert-RunnerBootstrapNoDuplicateJsonObjectKeys -Line $InnerText
    } $Text
}

function Assert-GroupJAcceptedHistoryWithTemporaryWrite {
    param([string]$ExistingLine)

    $workspace = New-GroupJWorkspace
    [System.IO.File]::WriteAllText($workspace.TargetPath, $ExistingLine + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    $global:GroupJTemporaryWriteAttempted = $false
    $operations = New-GroupJAtomicOperations
    $operations.WriteTemporary = {
        param([string]$TemporaryPath, [string]$Content)
        $global:GroupJTemporaryWriteAttempted = $true
        [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
    }

    Invoke-GroupJAtomicWrite -Workspace $workspace -Operations $operations

    $persistedLines = @(([System.IO.File]::ReadAllText($workspace.TargetPath) -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $persistedLines.Count | Should Be 2
    $global:GroupJTemporaryWriteAttempted | Should Be $true
    Remove-Variable -Name GroupJTemporaryWriteAttempted -Scope Global -ErrorAction SilentlyContinue
}

function New-GroupJWrapperHarness {
    param([string]$EvidenceJson, [string]$CheckpointJson)

    $root = Join-Path $TestDrive ('group-j-wrapper-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $root '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    $scriptPath = Join-Path $safeDirectory 'Invoke-EventCenterProductionRollout.ps1'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1') -Destination $scriptPath
    $observationPath = Join-Path $root 'observation.json'
    $modulePath = Join-Path $safeDirectory 'ProductionRolloutRunner.Core.psm1'
    Set-Content -LiteralPath $modulePath -Value @'
$script:GroupJAdapterCalls = @()
function Write-GroupJObservation {
    param([hashtable]$Value)
    [System.IO.File]::WriteAllText($env:GROUP_J_OBSERVATION_PATH, ($Value | ConvertTo-Json -Compress -Depth 5))
}
function Test-PinnedToolchain {
    param([string]$WorkspaceRoot)
    $script:GroupJAdapterCalls += 'toolchain'
    return [pscustomobject]@{ Status = 'READY'; AlertCodes = @() }
}
function Invoke-SafeNativeCommand {
    param([string]$CommandKind, [string]$Mode, [string]$WorkspaceRoot)
    $script:GroupJAdapterCalls += ($CommandKind + '|' + $Mode)
    return [pscustomobject]@{ Status = 'READY'; AlertCodes = @() }
}
function Start-EventCenterProductionRollout {
    param([hashtable]$Dependencies)
    $expectedSequence = 1
    $expectedCommand = 'GOVERNANCE_COMPLETED'
    $evidence = & $Dependencies.EvidenceReader
    $checkpoint = $null
    if ($null -ne $evidence) {
        $checkpoint = & $Dependencies.CheckpointReader
        if ($null -ne $checkpoint) {
            $expectedSequence = 2
            $expectedCommand = 'SINGLE_WORKER_ENABLED'
            [void](& $Dependencies.SourceCheck 'next')
        }
    }
    Write-GroupJObservation -Value @{
        evidenceIsNull = ($null -eq $evidence)
        checkpointIsNull = ($null -eq $checkpoint)
        adapterCallCount = @($script:GroupJAdapterCalls).Count
        expectedSequence = $expectedSequence
        expectedCommand = $expectedCommand
    }
    return 0
}
Export-ModuleMember -Function Test-PinnedToolchain, Invoke-SafeNativeCommand, Start-EventCenterProductionRollout
'@ -NoNewline
    [System.IO.File]::WriteAllText((Join-Path $safeDirectory 'production-rollout-evidence.json'), $EvidenceJson, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $safeDirectory 'production-runner-control.json'), $CheckpointJson, [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ ScriptPath = $scriptPath; ObservationPath = $observationPath }
}

function Invoke-GroupJWrapperHarness {
    param([object]$Harness)

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = (Get-Command powershell.exe).Source
    $process.StartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Harness.ScriptPath + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $previousObservationPath = [Environment]::GetEnvironmentVariable('GROUP_J_OBSERVATION_PATH', 'Process')
    [Environment]::SetEnvironmentVariable('GROUP_J_OBSERVATION_PATH', $Harness.ObservationPath, 'Process')
    try {
        [void]$process.Start()
        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $observation = [System.IO.File]::ReadAllText($Harness.ObservationPath) | ConvertFrom-Json
        return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $standardOutput; StdErr = $standardError; Observation = $observation }
    }
    finally {
        [Environment]::SetEnvironmentVariable('GROUP_J_OBSERVATION_PATH', $previousObservationPath, 'Process')
    }
}

$script:GroupJValidEvidence = '{"verificationConclusion":"READY","verifiedAtUtc":"2026-07-26T01:00:00.0000000Z"}'
$script:GroupJValidCheckpoint = '{"sequence":1,"command":"GOVERNANCE_COMPLETED","issuedAtUtc":"2026-07-26T01:01:00.0000000Z"}'

Describe 'Task 3 fix round 5 Group J I6 strict history mismatch rejection' {
    It 'rejects duplicate single-quoted history keys before temporary writing' {
        Assert-GroupJRejectedHistoryWithoutTemporaryWrite -ExistingLine @'
{'phase':'PRECHECK','phase':'OVERRIDE','status':'READY','boundedCounts':{'completed':1},'alertCodes':['SAFE_TEST'],'utcStart':'2026-07-26T01:00:00.0000000Z','utcEnd':'2026-07-26T01:00:01.0000000Z','elapsedSeconds':1}
'@
    }

    It 'rejects duplicate unquoted history keys before temporary writing' {
        Assert-GroupJRejectedHistoryWithoutTemporaryWrite -ExistingLine '{phase:"PRECHECK",phase:"OVERRIDE",status:"READY",boundedCounts:{completed:1},alertCodes:["SAFE_TEST"],utcStart:"2026-07-26T01:00:00.0000000Z",utcEnd:"2026-07-26T01:00:01.0000000Z",elapsedSeconds:1}'
    }

    It 'rejects duplicate history keys after non-standard leading whitespace before temporary writing' {
        $nonStandardWhitespaceLine = ([string][char]0x00a0) + '{"phase":"PRECHECK","phase":"OVERRIDE","status":"READY","boundedCounts":{"completed":1},"alertCodes":["SAFE_TEST"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'

        Assert-GroupJRejectedHistoryWithoutTemporaryWrite -ExistingLine $nonStandardWhitespaceLine
    }
}

Describe 'Task 3 fix round 5 Group J complete strict JSON grammar' {
    It 'rejects <Case> as an incomplete or non-standard JSON value' -TestCases @(
        @{ Case = 'single-quoted string'; Text = "'value'" },
        @{ Case = 'unquoted string'; Text = 'bare' },
        @{ Case = 'non-standard whitespace'; Text = (([string][char]0x00a0) + '{"ok":1}') },
        @{ Case = 'unterminated string'; Text = '"unterminated' },
        @{ Case = 'invalid string escape'; Text = '"bad\q"' },
        @{ Case = 'incomplete Unicode escape'; Text = '"bad\u12"' },
        @{ Case = 'trailing comma'; Text = '[1,]' },
        @{ Case = 'trailing data'; Text = 'true false' },
        @{ Case = 'leading-zero number'; Text = '01' },
        @{ Case = 'missing fraction digits'; Text = '1.' },
        @{ Case = 'missing exponent digits'; Text = '1e' },
        @{ Case = 'leading-plus number'; Text = '+1' },
        @{ Case = 'missing integer digits'; Text = '-.1' },
        @{ Case = 'non-JSON number token'; Text = 'NaN' }
    ) {
        param($Case, $Text)

        { Invoke-GroupJStrictJsonValidation -Text $Text } | Should Throw 'SAFE_STATUS_WRITE_FAILED'
    }

    It 'accepts <Case> as one complete standards-conforming JSON value' -TestCases @(
        @{ Case = 'string'; Text = '"value"' },
        @{ Case = 'true'; Text = 'true' },
        @{ Case = 'false'; Text = 'false' },
        @{ Case = 'null'; Text = 'null' },
        @{ Case = 'zero'; Text = '0' },
        @{ Case = 'fraction and exponent number'; Text = '-12.5e+2' },
        @{ Case = 'nested array and object'; Text = '[1,{"ok":true},null]' },
        @{ Case = 'standard surrounding whitespace'; Text = " `t`r`n{`"ok`":1} `t`r`n" }
    ) {
        param($Case, $Text)

        { Invoke-GroupJStrictJsonValidation -Text $Text } | Should Not Throw
    }

    It 'rejects duplicate decoded keys inside objects nested through arrays' {
        { Invoke-GroupJStrictJsonValidation -Text '[[{"same":1,"same":2}]]' } | Should Throw 'SAFE_STATUS_WRITE_FAILED'
    }

    It 'accepts the same decoded key in separate history object scopes' {
        $separateScopeLine = '{"phase":"PRECHECK","status":"READY","boundedCounts":{"phase":1},"alertCodes":["SAFE_TEST"],"utcStart":"2026-07-26T01:00:00.0000000Z","utcEnd":"2026-07-26T01:00:01.0000000Z","elapsedSeconds":1}'

        Assert-GroupJAcceptedHistoryWithTemporaryWrite -ExistingLine $separateScopeLine
    }
}

Describe 'Task 3 fix round 5 Group J I8 strict live JSON file rejection' {
    It '<Case> evidence returns null and invokes zero project delegates' -TestCases @(
        @{ Case = 'duplicate'; EvidenceJson = '{"verificationConclusion":"BLOCKED","verificationConclusion":"READY","verifiedAtUtc":"2026-07-26T01:00:00.0000000Z"}' },
        @{ Case = 'non-standard'; EvidenceJson = (([string][char]0x00a0) + '{"verificationConclusion":"READY","verifiedAtUtc":"2026-07-26T01:00:00.0000000Z"}') }
    ) {
        param($Case, $EvidenceJson)
        $harness = New-GroupJWrapperHarness -EvidenceJson $EvidenceJson -CheckpointJson $script:GroupJValidCheckpoint

        $result = Invoke-GroupJWrapperHarness -Harness $harness

        $result.ExitCode | Should Be 0
        $result.StdErr | Should Be ''
        $result.Observation.evidenceIsNull | Should Be $true
        $result.Observation.adapterCallCount | Should Be 0
    }

    It 'duplicate checkpoint returns null without advancing or starting the next command' {
        $duplicateCheckpoint = '{"sequence":999,"sequence":1,"command":"WRONG","command":"GOVERNANCE_COMPLETED","issuedAtUtc":"2026-07-26T01:01:00.0000000Z"}'
        $harness = New-GroupJWrapperHarness -EvidenceJson $script:GroupJValidEvidence -CheckpointJson $duplicateCheckpoint

        $result = Invoke-GroupJWrapperHarness -Harness $harness

        $result.ExitCode | Should Be 0
        $result.StdErr | Should Be ''
        $result.Observation.evidenceIsNull | Should Be $false
        $result.Observation.checkpointIsNull | Should Be $true
        $result.Observation.adapterCallCount | Should Be 0
        $result.Observation.expectedSequence | Should Be 1
        $result.Observation.expectedCommand | Should Be 'GOVERNANCE_COMPLETED'
    }
}
