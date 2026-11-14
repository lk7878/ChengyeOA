Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$sourcePath = Join-Path $PSScriptRoot 'ProductionRolloutRunner.StateMachine.Tests.ps1'
$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$errors)
$clockInitialization = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$script:Task3BaseUtc' }, $true)
if ($null -eq $clockInitialization) { throw 'TASK3_CLOCK_NOT_FOUND' }
. ([scriptblock]::Create($clockInitialization.Extent.Text))
foreach ($name in @('New-Task3Environment', 'New-Task3Evidence', 'New-Task3Checkpoint', 'New-Task3Check', 'New-Task3Drain', 'Reset-Task3Fakes', 'New-Task3Dependencies')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
    if ($null -eq $definition) { throw 'TASK3_HELPER_NOT_FOUND' }
    . ([scriptblock]::Create($definition.Extent.Text))
}

function New-Task3ClassifiedSafeResult {
    param([int]$ExitCode)

    return [pscustomobject]@{
        Status = 'BLOCKED'
        AlertCodes = @('SAFE_CLASSIFIED_FAILURE')
        ExitCode = $ExitCode
    }
}

function Set-Task3ClassifiedStage {
    param([string]$Stage, [object]$Result)

    switch ($Stage) {
        'source' {
            $global:Task3SourceQueue = @($Result, (New-Task3Check))
            $global:Task3CheckpointQueue = @((New-Task3Checkpoint -Sequence 1 -Command 'ROLLBACK_CONFIRMED'))
        }
        'portable' {
            $global:Task3PortableResult = $Result
            $global:Task3CheckpointQueue = @((New-Task3Checkpoint -Sequence 1 -Command 'ROLLBACK_CONFIRMED'))
        }
        'drain' {
            $global:Task3DrainQueue = @($Result)
            $global:Task3CheckpointQueue = @(
                (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
                (New-Task3Checkpoint -Sequence 2 -Command 'ROLLBACK_CONFIRMED')
            )
        }
        'canary' {
            $global:Task3SourceQueue[2] = $Result
            $global:Task3SourceQueue += New-Task3Check
            $global:Task3CheckpointQueue = @(
                (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
                (New-Task3Checkpoint -Sequence 2 -Command 'SINGLE_WORKER_ENABLED'),
                (New-Task3Checkpoint -Sequence 3 -Command 'CANARY_GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(15)),
                (New-Task3Checkpoint -Sequence 4 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(16))
            )
        }
        default { throw 'TASK3_UNKNOWN_STAGE' }
    }
}

function New-Task3ClassificationDependencies {
    $dependencies = New-Task3Dependencies
    $dependencies.SafeStatusSink = {
        param($record)
        $global:Task3Statuses += $record
        if ($record.phase -ceq 'ROLLBACK_REQUIRED') {
            $global:Task3NowUtc = $script:Task3BaseUtc.AddMinutes(17)
        }
    }
    return $dependencies
}

Describe 'Task 3 fix round 1 Group B I1 classified adapter exits' {
    BeforeEach { Reset-Task3Fakes }

    It '<Stage> preserves safe adapter exit <ExpectedExit>' -TestCases @(
        @{ Stage = 'source'; ExitCode = 2; ExpectedExit = 2 },
        @{ Stage = 'source'; ExitCode = 5; ExpectedExit = 5 },
        @{ Stage = 'source'; ExitCode = 70; ExpectedExit = 70 },
        @{ Stage = 'portable'; ExitCode = 2; ExpectedExit = 2 },
        @{ Stage = 'portable'; ExitCode = 5; ExpectedExit = 5 },
        @{ Stage = 'portable'; ExitCode = 70; ExpectedExit = 70 },
        @{ Stage = 'drain'; ExitCode = 2; ExpectedExit = 2 },
        @{ Stage = 'drain'; ExitCode = 5; ExpectedExit = 5 },
        @{ Stage = 'drain'; ExitCode = 70; ExpectedExit = 70 },
        @{ Stage = 'canary'; ExitCode = 2; ExpectedExit = 2 },
        @{ Stage = 'canary'; ExitCode = 5; ExpectedExit = 5 },
        @{ Stage = 'canary'; ExitCode = 70; ExpectedExit = 70 }
    ) {
        param($Stage, $ExitCode, $ExpectedExit)

        Set-Task3ClassifiedStage -Stage $Stage -Result (New-Task3ClassifiedSafeResult -ExitCode $ExitCode)

        (Start-EventCenterProductionRollout -Dependencies (New-Task3ClassificationDependencies)) | Should Be $ExpectedExit
    }

    It 'keeps an unclassified protocol BLOCKED result on the manual rollback exit' {
        $global:Task3SourceQueue = @(
            (New-Task3Check -Status 'BLOCKED' -AlertCodes @('SAFE_PROTOCOL_BLOCKED')),
            (New-Task3Check)
        )
        $global:Task3CheckpointQueue = @((New-Task3Checkpoint -Sequence 1 -Command 'ROLLBACK_CONFIRMED'))

        (Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)) | Should Be 4
        @($global:Task3Statuses | Where-Object { $_.phase -ceq 'ROLLBACK_REQUIRED' }).Count | Should Be 1
    }

    It 'keeps a DEGRADED canary on the extended-observation exit' {
        $global:Task3SourceQueue[2] = New-Task3Check -Status 'DEGRADED' -AlertCodes @('SAFE_DEGRADED')

        (Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)) | Should Be 3
        $global:Task3Statuses[-1].phase | Should Be 'EXTENDED_OBSERVATION_REQUIRED'
    }
}

function New-Task3WrapperHarness {
    param([ValidateSet('success', 'importFailure', 'runnerFailure')][string]$Mode)

    $root = Join-Path $TestDrive ('task3-wrapper-' + [guid]::NewGuid().ToString('N'))
    $safeDirectory = Join-Path $root '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1') -Destination (Join-Path $safeDirectory 'Invoke-EventCenterProductionRollout.ps1')

    $observationPath = Join-Path $root 'observation.json'
    $modulePath = Join-Path $safeDirectory 'ProductionRolloutRunner.Core.psm1'
    if ($Mode -ceq 'importFailure') {
        Set-Content -LiteralPath $modulePath -Value "throw 'SAFE_TEST_BOOTSTRAP_FAILURE'" -NoNewline
    }
    elseif ($Mode -ceq 'runnerFailure') {
        Set-Content -LiteralPath $modulePath -Value @'
function Write-SafeStatusRecord {
    param([string]$Path, [object]$Record)
    [System.IO.File]::WriteAllText($Path, ($Record | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine)
}
function Start-EventCenterProductionRollout {
    param([hashtable]$Dependencies)
    throw 'SAFE_TEST_BOOTSTRAP_FAILURE'
}
Export-ModuleMember -Function Write-SafeStatusRecord, Start-EventCenterProductionRollout
'@ -NoNewline
    }
else {
        Set-Content -LiteralPath $modulePath -Value @'
$script:HarnessAdapterCalls = @()
function Add-HarnessObservation {
    param([hashtable]$Value)
    [System.IO.File]::WriteAllText($env:TASK3_WRAPPER_OBSERVATION_PATH, ($Value | ConvertTo-Json -Compress -Depth 5))
}
function Test-PinnedToolchain {
    param([string]$WorkspaceRoot)
    return [pscustomobject]@{ Status = 'READY'; AlertCodes = @() }
}
function Invoke-SafeNativeCommand {
    param([string]$CommandKind, [string]$Mode, [string]$WorkspaceRoot)
    $script:HarnessAdapterCalls += [pscustomobject][ordered]@{ commandKind = $CommandKind; mode = $Mode; workspaceRoot = $WorkspaceRoot }
    return [pscustomobject]@{ Status = 'READY'; AlertCodes = @() }
}
function Write-SafeStatusRecord {
    param([string]$Path, [object]$Record)
    [System.IO.File]::WriteAllText($Path, ($Record | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine)
}
function Start-EventCenterProductionRollout {
    param([hashtable]$Dependencies)
    $environment = & $Dependencies.EnvironmentReader
    $evidence = & $Dependencies.EvidenceReader
    $checkpoint = & $Dependencies.CheckpointReader
    [void](& $Dependencies.ToolchainGate)
    [void](& $Dependencies.SourceCheck 'preflight')
    [void](& $Dependencies.PortablePreflight)
    [void](& $Dependencies.SourceDrain)
    [void](& $Dependencies.SourceCheck 'canary')
    [System.Threading.Thread]::Sleep(200)
    $record = [ordered]@{ phase = 'HARNESS'; status = 'READY'; boundedCounts = @{}; alertCodes = @(); utcStart = '2026-07-25T12:00:00.0000000Z'; utcEnd = '2026-07-25T12:00:00.0000000Z'; elapsedSeconds = 0 }
    & $Dependencies.SafeStatusSink $record
    Add-HarnessObservation -Value @{ environmentNames = @($environment.Keys | Sort-Object); evidenceMarker = [string]$evidence.marker; checkpointMarker = [string]$checkpoint.marker; adapterCalls = @($script:HarnessAdapterCalls); foregroundCompleted = $true }
    return 0
}
Export-ModuleMember -Function Test-PinnedToolchain, Invoke-SafeNativeCommand, Write-SafeStatusRecord, Start-EventCenterProductionRollout
'@ -NoNewline
        Set-Content -LiteralPath (Join-Path $safeDirectory 'production-rollout-evidence.json') -Value '{"marker":"EVIDENCE_FIXED_PATH"}' -NoNewline
        Set-Content -LiteralPath (Join-Path $safeDirectory 'production-runner-control.json') -Value '{"marker":"CHECKPOINT_FIXED_PATH"}' -NoNewline
    }

    return [pscustomobject]@{ Root = $root; SafeDirectory = $safeDirectory; ScriptPath = (Join-Path $safeDirectory 'Invoke-EventCenterProductionRollout.ps1'); ObservationPath = $observationPath; StatusPath = (Join-Path $safeDirectory 'production-runner-status.jsonl') }
}

function Invoke-Task3WrapperHarness {
    param([object]$Harness)

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = (Get-Command powershell.exe).Source
    $process.StartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Harness.ScriptPath + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $previousObservationPath = [Environment]::GetEnvironmentVariable('TASK3_WRAPPER_OBSERVATION_PATH', 'Process')
    [Environment]::SetEnvironmentVariable('TASK3_WRAPPER_OBSERVATION_PATH', $Harness.ObservationPath, 'Process')
    try {
        [void]$process.Start()
        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $standardOutput; StdErr = $standardError; ElapsedMilliseconds = $process.TotalProcessorTime.TotalMilliseconds }
    }
    finally {
        [Environment]::SetEnvironmentVariable('TASK3_WRAPPER_OBSERVATION_PATH', $previousObservationPath, 'Process')
    }
}

function Test-Task3SafeBootstrapOutcome {
    param([object]$Result, [object]$Harness)

    if ($Result.ExitCode -ne 70 -or -not [string]::IsNullOrEmpty($Result.StdErr) -or (Test-Path -LiteralPath $Harness.StatusPath)) { return $false }
    $consoleLines = @($Result.StdOut -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($consoleLines.Count -ne 1) { return $false }
    try { $record = $consoleLines[0] | ConvertFrom-Json } catch { return $false }
    $expectedFields = @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
    $actualFields = @($record.PSObject.Properties.Name)
    return $actualFields.Count -eq 7 -and @($actualFields | Where-Object { $_ -cnotin $expectedFields }).Count -eq 0 -and @($expectedFields | Where-Object { $_ -cnotin $actualFields }).Count -eq 0 -and [string]$record.status -ceq 'BLOCKED' -and @($record.alertCodes).Count -gt 0
}

Describe 'Task 3 fix round 1 Group B I3 and M1 wrapper behavior' {
    It 'M1 binds only the fixed environment names and local files, then waits foreground for the real wrapper call' {
        $harness = New-Task3WrapperHarness -Mode success
        $result = Invoke-Task3WrapperHarness -Harness $harness
        $observation = [System.IO.File]::ReadAllText($harness.ObservationPath) | ConvertFrom-Json
        $expectedNames = @('APP_KEYS', 'CORS_ALLOWED_ORIGINS', 'DATABASE_URL', 'EVENT_WORKER_ENABLED', 'JWT_SECRET', 'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV')
        $expectedWorkspaceRoot = [System.IO.Path]::GetFullPath($harness.Root).TrimEnd([char[]]'\\/')
        $expectedAdapterCalls = @(
            ('source-check|preflight|' + $expectedWorkspaceRoot),
            ('portable-check|preflight|' + $expectedWorkspaceRoot),
            ('source-drain||' + $expectedWorkspaceRoot),
            ('source-check|canary|' + $expectedWorkspaceRoot)
        )
        $actualAdapterCalls = @($observation.adapterCalls | ForEach-Object { [string]$_.commandKind + '|' + [string]$_.mode + '|' + [System.IO.Path]::GetFullPath([string]$_.workspaceRoot).TrimEnd([char[]]'\\/') })
        $actualAdapterCallText = [string]::Join(',', $actualAdapterCalls)
        $expectedAdapterCallText = [string]::Join(',', $expectedAdapterCalls)
        $expectedStatusLine = [System.IO.File]::ReadAllText($harness.StatusPath).Trim()

        $checks = [ordered]@{
            exit = $result.ExitCode -eq 0
            stderr = [string]::IsNullOrEmpty($result.StdErr)
            environmentCount = @($observation.environmentNames).Count -eq 7
            environmentOnly = @($observation.environmentNames | Where-Object { $_ -cnotin $expectedNames }).Count -eq 0
            environmentComplete = @($expectedNames | Where-Object { $_ -cnotin @($observation.environmentNames) }).Count -eq 0
            evidence = [string]$observation.evidenceMarker -ceq 'EVIDENCE_FIXED_PATH'
            checkpoint = [string]$observation.checkpointMarker -ceq 'CHECKPOINT_FIXED_PATH'
            commandBindings = $actualAdapterCallText -ceq $expectedAdapterCallText
            foreground = [bool]$observation.foregroundCompleted
            consoleEquivalent = $result.StdOut.Trim() -ceq $expectedStatusLine
        }
        $actualAdapterCallText | Should Be $expectedAdapterCallText
        ([string]::Join(',', @($checks.Values | ForEach-Object { [string]$_ }))) | Should Be 'True,True,True,True,True,True,True,True,True,True'
    }

    It 'I3 converts a copied <Mode> bootstrap failure to one console-only safe exit-70 record' -TestCases @(
        @{ Mode = 'importFailure' },
        @{ Mode = 'runnerFailure' }
    ) {
        param($Mode)
        $harness = New-Task3WrapperHarness -Mode $Mode
        $result = Invoke-Task3WrapperHarness -Harness $harness

        (Test-Task3SafeBootstrapOutcome -Result $result -Harness $harness) | Should Be $true
    }
}
