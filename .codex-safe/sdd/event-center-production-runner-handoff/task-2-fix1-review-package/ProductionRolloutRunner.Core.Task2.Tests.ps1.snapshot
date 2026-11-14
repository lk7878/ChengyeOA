$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$script:CheckText = 'Event observability: mode=preflight;status=READY;undispatched=0;oldestUndispatchedSeconds=0;dueBacklog=0;oldestDueBacklogSeconds=0;manual=0;processing=0;expiredProcessing=0;staleExpiredProcessing=0;leaseLost15m=0;alertCodes=none;evaluatedAt=2026-07-25T12:00:00.0000000Z'
$script:DrainText = 'Event drain: dispatched=2;claimed=2;succeeded=2;retryScheduled=0;manual=0;leaseLost=0;status=complete'
$global:Task2CheckText = $script:CheckText
$global:Task2DrainText = $script:DrainText

function New-Task2ProcessResult {
    param([int]$ExitCode, [string]$StdOut, [string]$StdErr = 'injected failure detail')

    return [pscustomobject]@{ ExitCode = $ExitCode; StdOut = $StdOut; StdErr = $StdErr }
}

function Set-Task2FormatterField {
    param([string]$Text, [string]$Mutation)

    $name = $Mutation.Split('=')[0]
    $parts = $Text.Split(';')
    for ($index = 0; $index -lt $parts.Count; $index++) {
        if ($parts[$index] -clike ($name + '=*')) {
            $parts[$index] = $Mutation
        }
        elseif ($parts[$index] -clike ('* ' + $name + '=*')) {
            $parts[$index] = $parts[$index].Substring(0, $parts[$index].IndexOf($name, [System.StringComparison]::Ordinal)) + $Mutation
        }
    }
    return ($parts -join ';')
}

Describe 'ConvertFrom-EventCheckSummary strict formatter parsing' {
    It 'returns the stable safe summary for the exact formatter record' {
        $result = ConvertFrom-EventCheckSummary -Text $script:CheckText -ExpectedMode 'preflight'

        @($result.PSObject.Properties.Name) | Should Be @('Mode', 'Status', 'Undispatched', 'OldestUndispatchedSeconds', 'DueBacklog', 'OldestDueBacklogSeconds', 'Manual', 'Processing', 'ExpiredProcessing', 'StaleExpiredProcessing', 'LeaseLost15m', 'AlertCodes', 'EvaluatedAtUtc')
        $result.Mode | Should Be 'preflight'
        $result.Status | Should Be 'READY'
        $result.Undispatched | Should Be 0
        @($result.AlertCodes).Count | Should Be 0
        $result.EvaluatedAtUtc.Kind | Should Be ([DateTimeKind]::Utc)
    }

    It 'accepts only safe comma-separated alert codes' {
        $text = $script:CheckText.Replace('alertCodes=none', 'alertCodes=WAITING,LEASE_LOST_15M')

        $result = ConvertFrom-EventCheckSummary -Text $text -ExpectedMode 'preflight'

        @($result.AlertCodes) | Should Be @('WAITING', 'LEASE_LOST_15M')
    }

    It 'accepts exactly one logical check formatter record with one terminal line ending' -TestCases @(
        @{ Text = ($script:CheckText + "`n") },
        @{ Text = ($script:CheckText + "`r`n") }
    ) {
        param($Text)

        (ConvertFrom-EventCheckSummary -Text $Text -ExpectedMode 'preflight').Status | Should Be 'READY'
    }

    It 'rejects every malformed check field shape without echoing it' -TestCases @(
        @{ Mutated = 'mode=other'; ExpectedMode = 'preflight' },
        @{ Mutated = 'status=UNKNOWN'; ExpectedMode = 'preflight' },
        @{ Mutated = 'undispatched=-1'; ExpectedMode = 'preflight' },
        @{ Mutated = 'oldestUndispatchedSeconds=1.5'; ExpectedMode = 'preflight' },
        @{ Mutated = 'dueBacklog=x'; ExpectedMode = 'preflight' },
        @{ Mutated = 'oldestDueBacklogSeconds='; ExpectedMode = 'preflight' },
        @{ Mutated = 'manual=+1'; ExpectedMode = 'preflight' },
        @{ Mutated = 'processing= 1'; ExpectedMode = 'preflight' },
        @{ Mutated = 'expiredProcessing=01'; ExpectedMode = 'preflight' },
        @{ Mutated = 'staleExpiredProcessing=-0'; ExpectedMode = 'preflight' },
        @{ Mutated = 'leaseLost15m=1e2'; ExpectedMode = 'preflight' },
        @{ Mutated = 'alertCodes=not_safe'; ExpectedMode = 'preflight' },
        @{ Mutated = 'evaluatedAt=not-a-time'; ExpectedMode = 'preflight' }
    ) {
        param($Mutated, $ExpectedMode)
        $text = Set-Task2FormatterField -Text $script:CheckText -Mutation $Mutated
        $safeError = $null

        try { ConvertFrom-EventCheckSummary -Text $text -ExpectedMode $ExpectedMode | Out-Null } catch { $safeError = $_.Exception.Message }

        $safeError | Should Be 'EVENT_CHECK_SUMMARY_INVALID'
        $safeError.Contains($Mutated) | Should Be $false
    }

    It 'rejects wrong prefix, multiline, duplicate, missing, and extra check fields' -TestCases @(
        @{ Text = 'Wrong: mode=preflight'; ExpectedMode = 'preflight' },
        @{ Text = "$script:CheckText`nextra"; ExpectedMode = 'preflight' },
        @{ Text = "$script:CheckText;mode=preflight"; ExpectedMode = 'preflight' },
        @{ Text = $script:CheckText.Replace(';manual=0', ''); ExpectedMode = 'preflight' },
        @{ Text = "$script:CheckText;unexpected=0"; ExpectedMode = 'preflight' },
        @{ Text = $script:CheckText; ExpectedMode = 'canary' }
    ) {
        param($Text, $ExpectedMode)
        { ConvertFrom-EventCheckSummary -Text $Text -ExpectedMode $ExpectedMode } | Should Throw 'EVENT_CHECK_SUMMARY_INVALID'
    }
}

Describe 'ConvertFrom-EventDrainSummary strict formatter parsing' {
    It 'returns the stable safe drain summary for the exact formatter record' {
        $result = ConvertFrom-EventDrainSummary -Text $script:DrainText

        @($result.PSObject.Properties.Name) | Should Be @('Dispatched', 'Claimed', 'Succeeded', 'RetryScheduled', 'Manual', 'LeaseLost', 'Status')
        $result.Dispatched | Should Be 2
        $result.Status | Should Be 'complete'
    }

    It 'accepts exactly one logical drain formatter record with one terminal line ending' -TestCases @(
        @{ Text = ($script:DrainText + "`n") },
        @{ Text = ($script:DrainText + "`r`n") }
    ) {
        param($Text)

        (ConvertFrom-EventDrainSummary -Text $Text).Status | Should Be 'complete'
    }

    It 'rejects every malformed drain field shape' -TestCases @(
        @{ Mutated = 'dispatched=-1' },
        @{ Mutated = 'claimed=1.5' },
        @{ Mutated = 'succeeded=x' },
        @{ Mutated = 'retryScheduled=' },
        @{ Mutated = 'manual=+1' },
        @{ Mutated = 'leaseLost= 1' },
        @{ Mutated = 'status=unknown' }
    ) {
        param($Mutated)
        $text = Set-Task2FormatterField -Text $script:DrainText -Mutation $Mutated
        { ConvertFrom-EventDrainSummary -Text $text } | Should Throw 'EVENT_DRAIN_SUMMARY_INVALID'
    }

    It 'rejects wrong prefix, multiline, duplicate, missing, and extra drain fields' -TestCases @(
        @{ Text = 'Wrong: dispatched=0' },
        @{ Text = "$script:DrainText`nextra" },
        @{ Text = "$script:DrainText;status=complete" },
        @{ Text = $script:DrainText.Replace(';manual=0', '') },
        @{ Text = "$script:DrainText;unexpected=0" }
    ) {
        param($Text)
        { ConvertFrom-EventDrainSummary -Text $Text } | Should Throw 'EVENT_DRAIN_SUMMARY_INVALID'
    }
}

Describe 'Invoke-SafeNativeCommand allow-listed adapter' {
    BeforeEach {
        $global:Task2Launches = @()
        $global:Task2CheckText = $script:CheckText
        $global:Task2DrainText = $script:DrainText
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            $global:Task2Launches += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = @($ArgumentList); WorkingDirectory = $WorkingDirectory }
            return [pscustomobject]@{ ExitCode = 0; StdOut = $global:Task2CheckText; StdErr = 'injected failure detail' }
        }
    }

    AfterEach { Remove-Variable -Name Task2Launches -Scope Global -ErrorAction SilentlyContinue }

    It 'constructs the fixed source check command with an injected result' {
        $workspace = 'C:\safe-workspace'
        $global:Task2CheckText = $script:CheckText + "`r`n"

        $result = Invoke-SafeNativeCommand -CommandKind 'source-check' -Mode 'preflight' -WorkspaceRoot $workspace

        $result.Status | Should Be 'READY'
        $global:Task2Launches.Count | Should Be 1
        $global:Task2Launches[0].FilePath | Should Be 'npm.cmd'
        @($global:Task2Launches[0].ArgumentList) | Should Be @('--silent', 'run', 'events:check', '--', '--mode', 'preflight')
        $global:Task2Launches[0].WorkingDirectory | Should Be $workspace
    }

    It 'constructs the fixed portable check command only for preflight' {
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            $global:Task2Launches += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = @($ArgumentList); WorkingDirectory = $WorkingDirectory }
            return [pscustomobject]@{ ExitCode = 0; StdOut = $global:Task2CheckText; StdErr = 'injected failure detail' }
        }

        Invoke-SafeNativeCommand -CommandKind 'portable-check' -Mode 'preflight' -WorkspaceRoot 'C:\safe-workspace' | Out-Null

        $global:Task2Launches[0].FilePath | Should Be 'apps\dist\law-firm-system\law-firm-system.exe'
        @($global:Task2Launches[0].ArgumentList) | Should Be @('events:check', '--mode', 'preflight')
    }

    It 'constructs the fixed source drain command with no mode' {
        $global:Task2DrainText = $script:DrainText + "`n"
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            $global:Task2Launches += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = @($ArgumentList); WorkingDirectory = $WorkingDirectory }
            return [pscustomobject]@{ ExitCode = 0; StdOut = $global:Task2DrainText; StdErr = 'injected failure detail' }
        }

        $result = Invoke-SafeNativeCommand -CommandKind 'source-drain' -Mode '' -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be 'complete'
        $global:Task2Launches[0].FilePath | Should Be 'npm.cmd'
        @($global:Task2Launches[0].ArgumentList) | Should Be @('--silent', 'run', 'events:drain')
    }

    It 'rejects every unrecognized command or mode before launch' -TestCases @(
        @{ CommandKind = 'other'; Mode = 'preflight' },
        @{ CommandKind = 'source-check'; Mode = 'other' },
        @{ CommandKind = 'portable-check'; Mode = 'canary' },
        @{ CommandKind = 'source-drain'; Mode = 'preflight' }
    ) {
        param($CommandKind, $Mode)

        { Invoke-SafeNativeCommand -CommandKind $CommandKind -Mode $Mode -WorkspaceRoot 'C:\safe-workspace' } | Should Throw 'SAFE_COMMAND_INVALID'
        $global:Task2Launches.Count | Should Be 0
    }

    It 'maps every check exit code and blocks an unrecognized exit code' -TestCases @(
        @{ ExitCode = 0; Text = $script:CheckText; Status = 'READY'; AlertCode = $null },
        @{ ExitCode = 3; Text = $script:CheckText.Replace('status=READY', 'status=DEGRADED'); Status = 'DEGRADED'; AlertCode = $null },
        @{ ExitCode = 4; Text = $script:CheckText.Replace('status=READY', 'status=BLOCKED'); Status = 'BLOCKED'; AlertCode = $null },
        @{ ExitCode = 2; Text = $script:CheckText; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID' },
        @{ ExitCode = 5; Text = $script:CheckText; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE' },
        @{ ExitCode = 70; Text = $script:CheckText; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE' },
        @{ ExitCode = 9; Text = $script:CheckText; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED' }
    ) {
        param($ExitCode, $Text, $Status, $AlertCode)
        $global:Task2MockExitCode = $ExitCode
        $global:Task2MockText = $Text
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith { [pscustomobject]@{ ExitCode = $global:Task2MockExitCode; StdOut = $global:Task2MockText; StdErr = 'injected failure detail' } }

        $result = Invoke-SafeNativeCommand -CommandKind 'source-check' -Mode 'preflight' -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be $Status
        if ($null -ne $AlertCode) { ($result.AlertCodes -contains $AlertCode) | Should Be $true } else { @($result.AlertCodes).Count | Should Be 0 }
    }

    It 'maps every drain exit code and blocks an unrecognized exit code' -TestCases @(
        @{ ExitCode = 0; Text = $script:DrainText; Status = 'complete'; AlertCode = $null },
        @{ ExitCode = 4; Text = $script:DrainText.Replace('status=complete', 'status=manual_attention_required'); Status = 'manual_attention_required'; AlertCode = $null },
        @{ ExitCode = 2; Text = $script:DrainText; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID' },
        @{ ExitCode = 5; Text = $script:DrainText; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE' },
        @{ ExitCode = 70; Text = $script:DrainText; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE' },
        @{ ExitCode = 9; Text = $script:DrainText; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED' }
    ) {
        param($ExitCode, $Text, $Status, $AlertCode)
        $global:Task2MockExitCode = $ExitCode
        $global:Task2MockText = $Text
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith { [pscustomobject]@{ ExitCode = $global:Task2MockExitCode; StdOut = $global:Task2MockText; StdErr = 'injected failure detail' } }

        $result = Invoke-SafeNativeCommand -CommandKind 'source-drain' -Mode '' -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be $Status
        if ($null -ne $AlertCode) { ($result.AlertCodes -contains $AlertCode) | Should Be $true } else { @($result.AlertCodes).Count | Should Be 0 }
    }

    It 'does not propagate raw standard error or invalid formatter text' {
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith { [pscustomobject]@{ ExitCode = 0; StdOut = 'invalid formatter record'; StdErr = 'sensitive injected detail' } }

        $result = Invoke-SafeNativeCommand -CommandKind 'source-check' -Mode 'preflight' -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be 'BLOCKED'
        ($result.AlertCodes -contains 'FORMATTER_OUTPUT_INVALID') | Should Be $true
        ($result | Out-String) | Should Not Match 'sensitive injected detail|invalid formatter record'
    }

    It 'maps each non-success exit before formatter parsing and never returns injected output' -TestCases @(
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 3; Status = 'DEGRADED'; AlertCode = $null; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 3; Status = 'DEGRADED'; AlertCode = $null; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 4; Status = 'BLOCKED'; AlertCode = $null; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 4; Status = 'BLOCKED'; AlertCode = $null; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 2; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID'; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 2; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 5; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE'; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 5; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 70; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE'; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 70; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 9; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED'; StdOut = '' },
        @{ CommandKind = 'source-check'; Mode = 'preflight'; ExitCode = 9; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 4; Status = 'manual_attention_required'; AlertCode = $null; StdOut = '' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 4; Status = 'manual_attention_required'; AlertCode = $null; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 2; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID'; StdOut = '' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 2; Status = 'BLOCKED'; AlertCode = 'CONFIG_INVALID'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 5; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE'; StdOut = '' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 5; Status = 'BLOCKED'; AlertCode = 'MIGRATION_OR_DATABASE_UNAVAILABLE'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 70; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE'; StdOut = '' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 70; Status = 'BLOCKED'; AlertCode = 'UNCLASSIFIED_FAILURE'; StdOut = 'malformed injected output' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 9; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED'; StdOut = '' },
        @{ CommandKind = 'source-drain'; Mode = ''; ExitCode = 9; Status = 'BLOCKED'; AlertCode = 'COMMAND_EXIT_UNRECOGNIZED'; StdOut = 'malformed injected output' }
    ) {
        param($CommandKind, $Mode, $ExitCode, $Status, $AlertCode, $StdOut)
        $global:Task2MockExitCode = $ExitCode
        $global:Task2MockText = $StdOut
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith { [pscustomobject]@{ ExitCode = $global:Task2MockExitCode; StdOut = $global:Task2MockText; StdErr = 'sensitive injected detail' } }

        $result = Invoke-SafeNativeCommand -CommandKind $CommandKind -Mode $Mode -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be $Status
        if ($null -ne $AlertCode) { ($result.AlertCodes -contains $AlertCode) | Should Be $true } else { @($result.AlertCodes).Count | Should Be 0 }
        ($result | Out-String) | Should Not Match 'sensitive injected detail|malformed injected output'
    }
}

Describe 'Test-PinnedToolchain safe gate' {
    It 'returns ready only for the exact single-line pinned versions' {
        $global:Task2ToolchainLaunches = @()
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            $global:Task2ToolchainLaunches += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = @($ArgumentList); WorkingDirectory = $WorkingDirectory }
            if ($FilePath -eq 'node.exe') { return [pscustomobject]@{ ExitCode = 0; StdOut = 'v22.14.0'; StdErr = 'injected failure detail' } }
            return [pscustomobject]@{ ExitCode = 0; StdOut = '10.9.2'; StdErr = 'injected failure detail' }
        }

        $result = Test-PinnedToolchain -WorkspaceRoot 'C:\safe-workspace'

        @($result.PSObject.Properties.Name) | Should Be @('Status', 'NodeVersionOk', 'NpmVersionOk', 'AlertCodes')
        $result.Status | Should Be 'READY'
        $result.NodeVersionOk | Should Be $true
        $result.NpmVersionOk | Should Be $true
        @($result.AlertCodes).Count | Should Be 0
        $global:Task2ToolchainLaunches.Count | Should Be 2
        $global:Task2ToolchainLaunches[0].FilePath | Should Be 'node.exe'
        @($global:Task2ToolchainLaunches[0].ArgumentList) | Should Be @('-v')
        $global:Task2ToolchainLaunches[0].WorkingDirectory | Should Be 'C:\safe-workspace'
        $global:Task2ToolchainLaunches[1].FilePath | Should Be 'npm.cmd'
        @($global:Task2ToolchainLaunches[1].ArgumentList) | Should Be @('--version')
        $global:Task2ToolchainLaunches[1].WorkingDirectory | Should Be 'C:\safe-workspace'
    }

    It 'returns only the mismatch code for every version mutation or launch failure' -TestCases @(
        @{ Node = 'v22.14.1'; Npm = '10.9.2' },
        @{ Node = "v22.14.0`nextra"; Npm = '10.9.2' },
        @{ Node = $null; Npm = '10.9.2' },
        @{ Node = 'v22.14.0'; Npm = '10.9.3' },
        @{ Node = 'v22.14.0'; Npm = "10.9.2`nextra" },
        @{ Node = 'v22.14.0'; Npm = $null }
    ) {
        param($Node, $Npm)
        $global:Task2MockNode = $Node
        $global:Task2MockNpm = $Npm
        Mock -CommandName Invoke-RunnerPrivateProcess -ModuleName ProductionRolloutRunner.Core -MockWith {
            param($FilePath)
            $value = if ($FilePath -eq 'node.exe') { $global:Task2MockNode } else { $global:Task2MockNpm }
            if ($null -eq $value) { throw 'sensitive launch detail' }
            return [pscustomobject]@{ ExitCode = 0; StdOut = $value; StdErr = 'injected failure detail' }
        }

        $result = Test-PinnedToolchain -WorkspaceRoot 'C:\safe-workspace'

        $result.Status | Should Be 'BLOCKED'
        @($result.AlertCodes) | Should Be @('TOOLCHAIN_VERSION_MISMATCH')
        ($result | Out-String) | Should Not Match 'v22|10\.9|sensitive'
    }
}
