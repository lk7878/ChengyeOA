Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$baselinePath = Join-Path $PSScriptRoot 'ProductionRolloutRunner.StateMachine.Tests.ps1'
$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($baselinePath, [ref]$tokens, [ref]$errors)
$clockInitialization = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$script:Task3BaseUtc' }, $true)
if ($null -eq $clockInitialization) { throw 'TASK3_CLOCK_NOT_FOUND' }
. ([scriptblock]::Create($clockInitialization.Extent.Text))
foreach ($name in @('New-Task3Environment', 'New-Task3Evidence', 'New-Task3Checkpoint', 'New-Task3Check', 'New-Task3Drain', 'Reset-Task3Fakes', 'New-Task3Dependencies')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
    if ($null -eq $definition) { throw 'TASK3_HELPER_NOT_FOUND' }
    . ([scriptblock]::Create($definition.Extent.Text))
}

function ConvertFrom-Task3RecordUtc {
    param([string]$Value)

    return [datetime]::ParseExact($Value, 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
}

function New-Task3AdvancingRollbackDependencies {
    $global:Task3SourceQueue = @(
        (New-Task3Check -Status 'BLOCKED'),
        (New-Task3Check)
    )
    $global:Task3AdvancingNowUtc = $script:Task3BaseUtc
    $global:Task3RollbackCheckpointReads = 0

    $dependencies = New-Task3Dependencies
    $dependencies.UtcClock = {
        $value = $global:Task3AdvancingNowUtc
        $global:Task3AdvancingNowUtc = $global:Task3AdvancingNowUtc.AddSeconds(1)
        return $value
    }
    $dependencies.CheckpointReader = {
        $rollbackRecord = @($global:Task3Statuses | Where-Object { $_.phase -ceq 'ROLLBACK_REQUIRED' })
        if ($rollbackRecord.Count -ne 1) { throw 'ROLLBACK_REQUEST_NOT_RECORDED' }
        $recordedRequestUtc = ConvertFrom-Task3RecordUtc -Value $rollbackRecord[0].utcStart
        $global:Task3RollbackCheckpointReads++
        if ($global:Task3RollbackCheckpointReads -eq 1) {
            return New-Task3Checkpoint -Sequence 5 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $recordedRequestUtc.AddMilliseconds(-500)
        }
        if ($global:Task3RollbackCheckpointReads -eq 2) {
            return New-Task3Checkpoint -Sequence 6 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $recordedRequestUtc.AddMilliseconds(500)
        }
        throw 'ROLLBACK_CONFIRMATION_NOT_ACCEPTED'
    }
    return $dependencies
}

function New-Task3SecondDrainClassifiedResult {
    param([int]$ExitCode)

    return [pscustomobject][ordered]@{
        Status = 'complete'
        AlertCodes = @('SAFE_CLASSIFIED_FAILURE')
        ExitCode = $ExitCode
    }
}

function New-Task3InvalidCanaryClockDependencies {
    param([ValidateSet('negative', 'nonUtc')][string]$ClockMode)

    $global:Task3CanaryClockMode = $ClockMode
    $dependencies = New-Task3Dependencies
    $dependencies.SourceCheck = {
        param($Mode)
        $global:Task3SourceModes += $Mode
        if ($Mode -ceq 'canary') {
            if ($global:Task3CanaryClockMode -ceq 'negative') {
                $global:Task3NowUtc = $global:Task3NowUtc.AddMinutes(-1)
            }
            else {
                $global:Task3NowUtc = [datetime]::SpecifyKind($global:Task3NowUtc, [DateTimeKind]::Unspecified)
            }
        }
        $value = $global:Task3SourceQueue[$global:Task3SourceIndex]
        $global:Task3SourceIndex++
        return $value
    }
    return $dependencies
}

Describe 'Task 3 fix round 3 Group G state-machine RED regressions' {
    BeforeEach { Reset-Task3Fakes }

    It 'C1 rejects a confirmation between the former split clock reads before accepting a post-request confirmation' {
        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3AdvancingRollbackDependencies)
        $rollbackRecord = @($global:Task3Statuses | Where-Object { $_.phase -ceq 'ROLLBACK_REQUIRED' })

        $exitCode | Should Be 4
        $rollbackRecord.Count | Should Be 1
        $rollbackRecord[0].utcStart | Should Be $rollbackRecord[0].utcEnd
        $global:Task3RollbackCheckpointReads | Should Be 2
        $global:Task3SleepCount | Should Be 1
    }

    It 'I1 preserves second-drain classified exit <ExpectedExit> before any drain-count access and does not roll back' -TestCases @(
        @{ ExitCode = 2; ExpectedExit = 2 },
        @{ ExitCode = 5; ExpectedExit = 5 },
        @{ ExitCode = 70; ExpectedExit = 70 }
    ) {
        param($ExitCode, $ExpectedExit)

        $global:Task3DrainQueue = @(
            (New-Task3Drain -Claimed 2),
            (New-Task3SecondDrainClassifiedResult -ExitCode $ExitCode)
        )
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED')
        )

        $actualExit = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)
        $rollbackCount = @($global:Task3Statuses | Where-Object { $_.phase -ceq 'ROLLBACK_REQUIRED' }).Count

        $actualExit | Should Be $ExpectedExit
        $global:Task3DrainIndex | Should Be 2
        $rollbackCount | Should Be 0
    }

    It 'C3 persists a final safe CANARY BLOCKED clock alert for a <ClockMode> end clock and exits seventy' -TestCases @(
        @{ ClockMode = 'negative' },
        @{ ClockMode = 'nonUtc' }
    ) {
        param($ClockMode)

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3InvalidCanaryClockDependencies -ClockMode $ClockMode)
        $phases = @($global:Task3Statuses | ForEach-Object { $_.phase })
        $finalRecord = $global:Task3Statuses[-1]
        $safeStartUtc = ConvertFrom-Task3RecordUtc -Value $finalRecord.utcStart
        $safeEndUtc = ConvertFrom-Task3RecordUtc -Value $finalRecord.utcEnd

        $exitCode | Should Be 70
        $finalRecord.phase | Should Be 'CANARY'
        $finalRecord.status | Should Be 'BLOCKED'
        @($finalRecord.alertCodes) | Should Be @('CANARY_CLOCK_INVALID')
        $safeStartUtc.Kind | Should Be ([DateTimeKind]::Utc)
        $safeEndUtc.Kind | Should Be ([DateTimeKind]::Utc)
        ($safeEndUtc -ge $safeStartUtc) | Should Be $true
        ($phases -contains 'CANARY_GOVERNANCE_COMPLETED') | Should Be $false
        ($phases -contains 'READY') | Should Be $false
        $global:Task3CheckpointIndex | Should Be 2
    }
}
