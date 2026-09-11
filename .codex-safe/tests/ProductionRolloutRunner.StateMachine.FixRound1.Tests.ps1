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

Describe 'Task 3 fix round 1 Group A state-machine regressions' {
    BeforeEach { Reset-Task3Fakes }

    It 'C1 rejects a pre-issued rollback confirmation even when its sequence is newer' {
        $global:Task3SourceQueue = @(
            (New-Task3Check -Status 'BLOCKED'),
            (New-Task3Check)
        )
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 5 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(-1)),
            (New-Task3Checkpoint -Sequence 6 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(1))
        )
        $dependencies = New-Task3Dependencies
        $dependencies.SafeStatusSink = {
            param($record)
            $global:Task3Statuses += $record
            if ($record.phase -ceq 'ROLLBACK_REQUIRED') {
                $global:Task3NowUtc = $script:Task3BaseUtc.AddMinutes(2)
            }
        }

        (Start-EventCenterProductionRollout -Dependencies $dependencies) | Should Be 4
        $global:Task3CheckpointIndex | Should Be 2
        $global:Task3SleepCount | Should Be 1
    }

    It 'C2 sends a blocked canary straight to rollback without a canary governance checkpoint' {
        $global:Task3SourceQueue[2] = New-Task3Check -Status 'BLOCKED'
        $global:Task3SourceQueue += New-Task3Check
        $global:Task3CheckpointQueue = @(
            $global:Task3CheckpointQueue[0],
            $global:Task3CheckpointQueue[1],
            (New-Task3Checkpoint -Sequence 3 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(16))
        )
        $global:Task3SleepFailure = 'UNEXPECTED_CANARY_GOVERNANCE_REQUEST'
        $dependencies = New-Task3Dependencies
        $dependencies.SafeStatusSink = {
            param($record)
            $global:Task3Statuses += $record
            if ($record.phase -ceq 'ROLLBACK_REQUIRED') {
                $global:Task3NowUtc = $script:Task3BaseUtc.AddMinutes(17)
            }
        }

        (Start-EventCenterProductionRollout -Dependencies $dependencies) | Should Be 4
        $global:Task3CheckpointIndex | Should Be 3
        @($global:Task3Statuses | Where-Object { $_.phase -ceq 'CANARY_GOVERNANCE_COMPLETED' }).Count | Should Be 0
    }

    It 'I2 keeps the terminal rollback record blocked when post-rollback preflight is not ready' {
        $global:Task3SourceQueue = @(
            (New-Task3Check -Status 'BLOCKED'),
            (New-Task3Check -Status 'BLOCKED')
        )
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'ROLLBACK_CONFIRMED')
        )

        (Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)) | Should Be 4
        ($global:Task3Statuses | Where-Object { $_.phase -ceq 'ROLLED_BACK' }).status | Should Be 'BLOCKED'
    }
}
