$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$script:Task3BaseUtc = [datetime]::SpecifyKind([datetime]'2026-07-25T12:00:00', [DateTimeKind]::Utc)

function New-Task3Environment {
    return @{
        DATABASE_URL = 'present'
        JWT_SECRET = 'present'
        APP_KEYS = 'present'
        MFA_ENCRYPTION_KEY_V1 = 'present'
        CORS_ALLOWED_ORIGINS = 'present'
        EVENT_WORKER_ENABLED = 'false'
        NODE_ENV = 'production'
    }
}

function New-Task3Evidence {
    param([datetime]$IssuedAtUtc = $script:Task3BaseUtc.AddMinutes(-1))

    return [pscustomobject]@{
        schemaVersion = 1
        backup = 'VERIFIED'
        isolatedRestorePoint = 'VERIFIED'
        allWorkersDisabled = 'VERIFIED'
        serverWebSameRelease = 'VERIFIED'
        governanceApproval = 'VERIFIED'
        verifiedAtUtc = $IssuedAtUtc
    }
}

function New-Task3Checkpoint {
    param(
        [long]$Sequence,
        [string]$Command,
        [datetime]$IssuedAtUtc = $script:Task3BaseUtc
    )

    return [pscustomobject]@{
        schemaVersion = 1
        sequence = $Sequence
        command = $Command
        issuedAtUtc = $IssuedAtUtc
    }
}

function New-Task3Check {
    param(
        [string]$Status = 'READY',
        [long]$Undispatched = 0,
        [long]$DueBacklog = 0,
        [long]$Manual = 0,
        [long]$Processing = 0,
        [long]$ExpiredProcessing = 0,
        [long]$StaleExpiredProcessing = 0,
        [long]$LeaseLost15m = 0,
        [string[]]$AlertCodes = @()
    )

    return [pscustomobject]@{
        Mode = 'preflight'
        Status = $Status
        Undispatched = $Undispatched
        OldestUndispatchedSeconds = 0
        DueBacklog = $DueBacklog
        OldestDueBacklogSeconds = 0
        Manual = $Manual
        Processing = $Processing
        ExpiredProcessing = $ExpiredProcessing
        StaleExpiredProcessing = $StaleExpiredProcessing
        LeaseLost15m = $LeaseLost15m
        AlertCodes = @($AlertCodes)
        EvaluatedAtUtc = $script:Task3BaseUtc
    }
}

function New-Task3Drain {
    param([string]$Status = 'complete', [long]$Claimed = 0, [string[]]$AlertCodes = @())

    return [pscustomobject]@{
        Dispatched = $Claimed
        Claimed = $Claimed
        Succeeded = $Claimed
        RetryScheduled = 0
        Manual = 0
        LeaseLost = 0
        Status = $Status
        AlertCodes = @($AlertCodes)
    }
}

function Reset-Task3Fakes {
    $global:Task3NowUtc = $script:Task3BaseUtc
    $global:Task3Environment = New-Task3Environment
    $global:Task3EvidenceQueue = @((New-Task3Evidence))
    $global:Task3EvidenceIndex = 0
    $global:Task3CheckpointQueue = @(
        (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
        (New-Task3Checkpoint -Sequence 2 -Command 'SINGLE_WORKER_ENABLED'),
        (New-Task3Checkpoint -Sequence 3 -Command 'CANARY_GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(10))
    )
    $global:Task3CheckpointIndex = 0
    $global:Task3SourceQueue = @((New-Task3Check), (New-Task3Check), (New-Task3Check))
    $global:Task3SourceIndex = 0
    $global:Task3PortableResult = New-Task3Check
    $global:Task3DrainQueue = @((New-Task3Drain -Claimed 2), (New-Task3Drain -Claimed 0))
    $global:Task3DrainIndex = 0
    $global:Task3Statuses = @()
    $global:Task3SourceModes = @()
    $global:Task3SleepCount = 0
    $global:Task3ToolchainCalls = 0
    $global:Task3SleepFailure = $null
    $global:Task3ToolchainResult = [pscustomobject]@{ Status = 'READY'; AlertCodes = @() }
}

function New-Task3Dependencies {
    return @{
        EnvironmentReader = { return $global:Task3Environment }
        UtcClock = { return $global:Task3NowUtc }
        Sleep = {
            $global:Task3SleepCount++
            if ($null -ne $global:Task3SleepFailure) { throw $global:Task3SleepFailure }
        }
        EvidenceReader = {
            if ($global:Task3EvidenceIndex -ge $global:Task3EvidenceQueue.Count) { return $null }
            $value = $global:Task3EvidenceQueue[$global:Task3EvidenceIndex]
            $global:Task3EvidenceIndex++
            return $value
        }
        CheckpointReader = {
            if ($global:Task3CheckpointIndex -ge $global:Task3CheckpointQueue.Count) { return $null }
            $value = $global:Task3CheckpointQueue[$global:Task3CheckpointIndex]
            $global:Task3CheckpointIndex++
            return $value
        }
        SafeStatusSink = { param($Record) $global:Task3Statuses += $Record }
        ToolchainGate = {
            $global:Task3ToolchainCalls++
            return $global:Task3ToolchainResult
        }
        SourceCheck = {
            param($Mode)
            $global:Task3SourceModes += $Mode
            if ($Mode -ceq 'canary') { $global:Task3NowUtc = $global:Task3NowUtc.AddMinutes(15) }
            $value = $global:Task3SourceQueue[$global:Task3SourceIndex]
            $global:Task3SourceIndex++
            return $value
        }
        PortablePreflight = { return $global:Task3PortableResult }
        SourceDrain = {
            $value = $global:Task3DrainQueue[$global:Task3DrainIndex]
            $global:Task3DrainIndex++
            return $value
        }
    }
}

Describe 'Start-EventCenterProductionRollout foreground state machine' {
    BeforeEach { Reset-Task3Fakes }

    It 'preserves the eight reviewed exports and adds only the foreground runner export' {
        $exports = @((Get-Module ProductionRolloutRunner.Core).ExportedFunctions.Keys | Sort-Object)

        $exports.Count | Should Be 9
        $exports | Should Be @(
            'ConvertFrom-EventCheckSummary',
            'ConvertFrom-EventDrainSummary',
            'Invoke-SafeNativeCommand',
            'New-SafeStatusRecord',
            'Start-EventCenterProductionRollout',
            'Test-PinnedToolchain',
            'Test-ProductionEnvironmentGate',
            'Test-ProductionEvidenceReceipt',
            'Write-SafeStatusRecord'
        )
    }

    It 'runs the exact ordered ready path with two drains and a source canary' {
        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 0
        @($global:Task3SourceModes) | Should Be @('preflight', 'preflight', 'canary')
        $global:Task3DrainIndex | Should Be 2
        @($global:Task3Statuses | ForEach-Object { $_.phase }) | Should Be @(
            'ENV_GATE', 'TOOLCHAIN_GATE', 'EVIDENCE_GATE', 'PREFLIGHT_SOURCE', 'PREFLIGHT_PORTABLE',
            'WAITING_GOVERNANCE_ACTION', 'DRAIN_FIRST', 'DRAIN_SECOND', 'PREFLIGHT_AFTER_DRAIN',
            'WAITING_SINGLE_WORKER_ENABLE', 'CANARY_STARTED', 'CANARY', 'CANARY_GOVERNANCE_COMPLETED', 'READY'
        )
        @($global:Task3Statuses | Where-Object { $_.status -cne 'READY' -and $_.status -cne 'WAITING' }).Count | Should Be 0
    }

    It 'blocks an invalid environment before evidence, waits, or project commands' {
        $global:Task3Environment.Remove('JWT_SECRET')

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 2
        $global:Task3EvidenceIndex | Should Be 0
        $global:Task3SleepCount | Should Be 0
        $global:Task3SourceIndex | Should Be 0
        $global:Task3DrainIndex | Should Be 0
        $global:Task3Statuses.Count | Should Be 1
        $global:Task3Statuses[0].phase | Should Be 'ENV_GATE'
        $global:Task3Statuses[0].status | Should Be 'BLOCKED'
    }

    It 'blocks a failed toolchain before evidence, waits, or project commands' {
        $global:Task3ToolchainResult = [pscustomobject]@{ Status = 'BLOCKED'; AlertCodes = @('TOOLCHAIN_VERSION_MISMATCH') }

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 2
        $global:Task3EvidenceIndex | Should Be 0
        $global:Task3SleepCount | Should Be 0
        $global:Task3SourceIndex | Should Be 0
        $global:Task3Statuses[-1].phase | Should Be 'TOOLCHAIN_GATE'
        $global:Task3Statuses[-1].status | Should Be 'BLOCKED'
    }

    It 'waits for valid fresh evidence before the first project command' {
        $global:Task3EvidenceQueue = @($null, (New-Task3Evidence))

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 0
        $global:Task3SleepCount | Should Be 1
        @($global:Task3Statuses | Select-Object -First 4 | ForEach-Object { $_.phase }) | Should Be @('ENV_GATE', 'TOOLCHAIN_GATE', 'WAITING_EVIDENCE', 'EVIDENCE_GATE')
    }

    It 'does not launch a project command while evidence remains absent' {
        $global:Task3EvidenceQueue = @($null)
        $global:Task3SleepFailure = 'TEST_WAIT_STOP'

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 70
        $global:Task3SourceIndex | Should Be 0
        $global:Task3DrainIndex | Should Be 0
        $global:Task3Statuses[-1].phase | Should Be 'WAITING_EVIDENCE'
    }

    It 'requires exact source and portable snapshots and ignores age counters and evaluation UTC' {
        $source = New-Task3Check -Undispatched 2 -DueBacklog 1 -Manual 1 -Processing 2 -ExpiredProcessing 1 -StaleExpiredProcessing 1 -LeaseLost15m 1
        $portable = New-Task3Check -Undispatched 2 -DueBacklog 1 -Manual 1 -Processing 2 -ExpiredProcessing 1 -StaleExpiredProcessing 1 -LeaseLost15m 1
        $source.OldestUndispatchedSeconds = 5
        $portable.OldestUndispatchedSeconds = 30
        $source.OldestDueBacklogSeconds = 4
        $portable.OldestDueBacklogSeconds = 29
        $portable.EvaluatedAtUtc = $script:Task3BaseUtc.AddMinutes(-2)
        $global:Task3SourceQueue[0] = $source
        $global:Task3PortableResult = $portable

        (Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)) | Should Be 0
    }

    It 'writes the snapshot mismatch and follows the manual rollback protocol' {
        $global:Task3PortableResult = New-Task3Check -DueBacklog 1
        $global:Task3CheckpointQueue = @((New-Task3Checkpoint -Sequence 1 -Command 'ROLLBACK_CONFIRMED'))

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 4
        @($global:Task3Statuses | ForEach-Object { $_.phase })[-3..-1] | Should Be @('ROLLBACK_REQUIRED', 'PREFLIGHT_AFTER_ROLLBACK', 'ROLLED_BACK')
        ($global:Task3Statuses | Where-Object { $_.phase -ceq 'PREFLIGHT_SNAPSHOT_MISMATCH' }).status | Should Be 'BLOCKED'
        @($global:Task3SourceModes) | Should Be @('preflight', 'preflight')
    }

    It 'requires a complete first drain and a complete zero-claim second drain' -TestCases @(
        @{ Drains = @((New-Task3Drain -Status 'manual_attention_required' -Claimed 1)); ExpectedDrainCalls = 1 },
        @{ Drains = @((New-Task3Drain -Claimed 1), (New-Task3Drain -Claimed 1)); ExpectedDrainCalls = 2 }
    ) {
        param($Drains, $ExpectedDrainCalls)
        $global:Task3DrainQueue = $Drains
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
            (New-Task3Checkpoint -Sequence 2 -Command 'ROLLBACK_CONFIRMED')
        )

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 4
        $global:Task3DrainIndex | Should Be $ExpectedDrainCalls
        $global:Task3Statuses[-1].phase | Should Be 'ROLLED_BACK'
    }

    It 'blocks when the post-drain source preflight is not ready' {
        $global:Task3SourceQueue[1] = New-Task3Check -Status 'BLOCKED' -AlertCodes @('SAFE_BLOCK')
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
            (New-Task3Checkpoint -Sequence 2 -Command 'ROLLBACK_CONFIRMED')
        )

        (Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)) | Should Be 4

        ($global:Task3Statuses | Where-Object { $_.phase -ceq 'PREFLIGHT_AFTER_DRAIN' }).status | Should Be 'BLOCKED'
        $global:Task3Statuses[-1].phase | Should Be 'ROLLED_BACK'
    }

    It 'rejects stale replayed out-of-order and out-of-window checkpoints before accepting the next sequence' {
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(-31)),
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
            (New-Task3Checkpoint -Sequence 1 -Command 'SINGLE_WORKER_ENABLED'),
            (New-Task3Checkpoint -Sequence 2 -Command 'SINGLE_WORKER_ENABLED'),
            (New-Task3Checkpoint -Sequence 3 -Command 'CANARY_GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(-1)),
            (New-Task3Checkpoint -Sequence 3 -Command 'CANARY_GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(10))
        )

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 0
        $global:Task3SleepCount | Should Be 3
        $global:Task3CheckpointIndex | Should Be 6
    }

    It 'does not start canary while the single-worker checkpoint is unavailable' {
        $global:Task3CheckpointQueue = @((New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'))
        $global:Task3SleepFailure = 'TEST_WAIT_STOP'

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 70
        (@($global:Task3SourceModes) -contains 'canary') | Should Be $false
        $global:Task3Statuses[-1].phase | Should Be 'WAITING_SINGLE_WORKER_ENABLE'
    }

    It 'writes extended observation and exits three for a degraded canary' {
        $global:Task3SourceQueue[2] = New-Task3Check -Status 'DEGRADED' -AlertCodes @('SAFE_DEGRADED')

        $exitCode = Start-EventCenterProductionRollout -Dependencies (New-Task3Dependencies)

        $exitCode | Should Be 3
        $global:Task3Statuses[-1].phase | Should Be 'EXTENDED_OBSERVATION_REQUIRED'
        $global:Task3Statuses[-1].status | Should Be 'DEGRADED'
        (@($global:Task3Statuses | ForEach-Object { $_.phase }) -contains 'ROLLBACK_REQUIRED') | Should Be $false
    }

    It 'waits for only the valid next rollback confirmation and reruns source preflight without performing rollback' {
        $firstCheckpoint = $global:Task3CheckpointQueue[0]
        $secondCheckpoint = $global:Task3CheckpointQueue[1]
        $global:Task3SourceQueue[2] = New-Task3Check -Status 'BLOCKED' -AlertCodes @('SAFE_BLOCK')
        $global:Task3CheckpointQueue = @(
            (New-Task3Checkpoint -Sequence 1 -Command 'GOVERNANCE_COMPLETED'),
            (New-Task3Checkpoint -Sequence 2 -Command 'SINGLE_WORKER_ENABLED'),
            (New-Task3Checkpoint -Sequence 3 -Command 'CANARY_GOVERNANCE_COMPLETED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(10)),
            (New-Task3Checkpoint -Sequence 4 -Command 'SINGLE_WORKER_ENABLED'),
            (New-Task3Checkpoint -Sequence 4 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(15))
        )
        $global:Task3CheckpointQueue = @(
            $firstCheckpoint,
            $secondCheckpoint,
            (New-Task3Checkpoint -Sequence 3 -Command 'ROLLBACK_CONFIRMED' -IssuedAtUtc $script:Task3BaseUtc.AddMinutes(16))
        )
        $global:Task3SourceQueue += New-Task3Check
        $dependencies = New-Task3Dependencies
        $dependencies.SafeStatusSink = {
            param($record)
            $global:Task3Statuses += $record
            if ($record.phase -ceq 'ROLLBACK_REQUIRED') {
                $global:Task3NowUtc = $script:Task3BaseUtc.AddMinutes(17)
            }
        }

        $exitCode = Start-EventCenterProductionRollout -Dependencies $dependencies

        $exitCode | Should Be 4
        $global:Task3SleepCount | Should Be 0
        @($global:Task3SourceModes) | Should Be @('preflight', 'preflight', 'canary', 'preflight')
        @($global:Task3Statuses | ForEach-Object { $_.phase })[-3..-1] | Should Be @('ROLLBACK_REQUIRED', 'PREFLIGHT_AFTER_ROLLBACK', 'ROLLED_BACK')
    }

    It 'maps dependency contract and classified safe failures to fixed exits without leaking errors' -TestCases @(
        @{ Failure = 'missing'; Expected = 2 },
        @{ Failure = 'MIGRATION_OR_DATABASE_UNAVAILABLE'; Expected = 5 },
        @{ Failure = 'UNEXPECTED_TEST_FAILURE'; Expected = 70 }
    ) {
        param($Failure, $Expected)
        $dependencies = New-Task3Dependencies
        if ($Failure -ceq 'missing') {
            $dependencies.Remove('SourceDrain')
        }
        else {
            $dependencies.EnvironmentReader = { throw $global:Task3InjectedFailure }
            $global:Task3InjectedFailure = $Failure
        }

        $exitCode = Start-EventCenterProductionRollout -Dependencies $dependencies

        $exitCode | Should Be $Expected
        (($global:Task3Statuses | Out-String) -match 'UNEXPECTED_TEST_FAILURE') | Should Be $false
    }
}

Describe 'Production runner checkpoint and evidence helpers' {
    BeforeEach {
        $script:Task3HelperDirectory = Join-Path $PSScriptRoot ('task3-helper-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($script:Task3HelperDirectory) | Out-Null
    }

    AfterEach {
        if (Test-Path -LiteralPath $script:Task3HelperDirectory) {
            Remove-Item -LiteralPath $script:Task3HelperDirectory -Recurse -Force
        }
    }

    It 'rejects a copied checkpoint helper before creating its target or temporary artifacts' {
        $sourcePath = Join-Path $PSScriptRoot '..\Set-ProductionRunnerCheckpoint.ps1'
        $helperPath = Join-Path $script:Task3HelperDirectory 'Set-ProductionRunnerCheckpoint.ps1'
        Copy-Item -LiteralPath $sourcePath -Destination $helperPath

        $target = Join-Path $script:Task3HelperDirectory 'production-runner-control.json'
        $failure = $null
        try { & $helperPath -Command 'GOVERNANCE_COMPLETED' -Sequence 1 } catch { $failure = $_.Exception.Message }

        $failure | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $target) | Should Be $false
        @([System.IO.Directory]::GetFiles($script:Task3HelperDirectory) | Where-Object { [System.IO.Path]::GetFileName($_).StartsWith('.') }).Count | Should Be 0
    }

    It 'rejects a non-enumerated checkpoint or non-positive sequence before writing' {
        $sourcePath = Join-Path $PSScriptRoot '..\Set-ProductionRunnerCheckpoint.ps1'
        $helperPath = Join-Path $script:Task3HelperDirectory 'Set-ProductionRunnerCheckpoint.ps1'
        Copy-Item -LiteralPath $sourcePath -Destination $helperPath

        { & $helperPath -Command 'OTHER' -Sequence 1 } | Should Throw
        { & $helperPath -Command 'GOVERNANCE_COMPLETED' -Sequence 0 } | Should Throw

        (Test-Path -LiteralPath (Join-Path $script:Task3HelperDirectory 'production-runner-control.json')) | Should Be $false
    }

    It 'rejects a copied evidence helper before creating its target or temporary artifacts' {
        $sourcePath = Join-Path $PSScriptRoot '..\Set-ProductionRolloutEvidence.ps1'
        $helperPath = Join-Path $script:Task3HelperDirectory 'Set-ProductionRolloutEvidence.ps1'
        Copy-Item -LiteralPath $sourcePath -Destination $helperPath

        $target = Join-Path $script:Task3HelperDirectory 'production-rollout-evidence.json'
        $failure = $null
        try { & $helperPath } catch { $failure = $_.Exception.Message }

        $failure | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $target) | Should Be $false
        @([System.IO.Directory]::GetFiles($script:Task3HelperDirectory) | Where-Object { [System.IO.Path]::GetFileName($_).StartsWith('.') }).Count | Should Be 0
    }
}
