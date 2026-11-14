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

function New-Task3ShortCanaryDependencies {
    $global:Task3SourceQueue = @(
        (New-Task3Check),
        (New-Task3Check),
        (New-Task3Check),
        (New-Task3Check)
    )
    $global:Task3CheckpointQueue = @(
        (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
        (New-Task3Checkpoint -Sequence 2 -Command 'SINGLE_WORKER_ENABLED'),
        (New-Task3Checkpoint -Sequence 3 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(14))
    )
    $global:Task3CheckpointIndex = 0
    $dependencies = New-Task3Dependencies
    $dependencies.SourceCheck = {
        param($Mode)
        $global:Task3SourceModes += $Mode
        if ($Mode -ceq 'canary') {
            $global:Task3NowUtc = $global:Task3NowUtc.AddMinutes(14)
        }
        $value = $global:Task3SourceQueue[$global:Task3SourceIndex]
        $global:Task3SourceIndex++
        return $value
    }
    $dependencies.CheckpointReader = {
        if ($global:Task3CheckpointIndex -eq 2 -and -not (@($global:Task3Statuses | ForEach-Object { $_.phase }) -contains 'ROLLBACK_REQUIRED')) {
            throw 'CANARY_GOVERNANCE_WAIT_FORBIDDEN'
        }
        if ($global:Task3CheckpointIndex -ge $global:Task3CheckpointQueue.Count) { return $null }
        $value = $global:Task3CheckpointQueue[$global:Task3CheckpointIndex]
        $global:Task3CheckpointIndex++
        return $value
    }
    return $dependencies
}

function New-Task3InvalidCanaryClockDependencies {
    param([ValidateSet('negative', 'nonUtc')][string]$ClockMode)

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
    $global:Task3CanaryClockMode = $ClockMode
    return $dependencies
}

Describe 'Task 3 fix round 2 Group D C3 canary duration boundary' {
    BeforeEach { Reset-Task3Fakes }

    It 'routes a READY canary shorter than fifteen minutes to rollback without completing canary governance or terminal READY' {
        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3ShortCanaryDependencies)
        $phases = @($global:Task3Statuses | ForEach-Object { $_.phase })
        $canaryTransition = @($global:Task3Statuses | Where-Object { $_.phase -ceq 'CANARY' })

        $exitCode | Should Be 4
        $canaryTransition.Count | Should Be 1
        $canaryTransition[0].status | Should Be 'BLOCKED'
        @($canaryTransition[0].alertCodes) | Should Be @('CANARY_WINDOW_TOO_SHORT')
        ($phases -contains 'CANARY_GOVERNANCE_COMPLETED') | Should Be $false
        ($phases -contains 'READY') | Should Be $false
        $global:Task3CheckpointIndex | Should Be 3
        @($phases[-3..-1]) | Should Be @('ROLLBACK_REQUIRED', 'PREFLIGHT_AFTER_ROLLBACK', 'ROLLED_BACK')
    }

    It 'fails closed with exit seventy before canary governance for a <ClockMode> canary clock' -TestCases @(
        @{ ClockMode = 'negative' },
        @{ ClockMode = 'nonUtc' }
    ) {
        param($ClockMode)

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3InvalidCanaryClockDependencies -ClockMode $ClockMode)
        $phases = @($global:Task3Statuses | ForEach-Object { $_.phase })

        $exitCode | Should Be 70
        ($phases -contains 'CANARY_GOVERNANCE_COMPLETED') | Should Be $false
        ($phases -contains 'READY') | Should Be $false
        $global:Task3CheckpointIndex | Should Be 2
    }
}
