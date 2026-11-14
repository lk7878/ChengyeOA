$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$script:NowUtc = [datetime]::SpecifyKind([datetime]'2026-07-25T12:00:00', [DateTimeKind]::Utc)

function New-FixRound3Record {
    return New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc
}

function Get-FixRound3Artifacts {
    param([string]$Directory)

    return @([System.IO.Directory]::GetFiles($Directory) | Where-Object { [System.IO.Path]::GetFileName($_).StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak')) })
}

Describe 'Task 1 fix round 3 I4 partial-write regression' {
    It 'cleans a partial temporary artifact after temporary writing fails' {
        $path = Join-Path $PSScriptRoot ('partial-temporary-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $global:Task1Round3TargetPath = $path
        $global:Task1Round3Record = New-FixRound3Record

        try {
            Mock -CommandName Write-SafeStatusTemporaryFile -ModuleName ProductionRolloutRunner.Core -MockWith {
                param($TemporaryPath, $Content)
                [System.IO.File]::WriteAllText($TemporaryPath, 'PARTIAL', [System.Text.UTF8Encoding]::new($false))
                throw 'SIMULATED_TEST_FAILURE'
            }

            { Write-SafeStatusRecord -Path $global:Task1Round3TargetPath -Record $global:Task1Round3Record } | Should Throw 'SAFE_STATUS_WRITE_FAILED'

            (Test-Path -LiteralPath $path) | Should Be $false
            (Get-FixRound3Artifacts -Directory $PSScriptRoot).Count | Should Be 0
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
            Remove-Variable -Name Task1Round3TargetPath, Task1Round3Record -Scope Global -ErrorAction SilentlyContinue
        }
    }
}

Describe 'Task 1 fix round 3 I4 replacement regression' {
    It 'preserves an existing target and cleans artifacts when replacement fails after a real temporary write' {
        $path = Join-Path $PSScriptRoot ('replacement-failure-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $global:Task1Round3TargetPath = $path
        $global:Task1Round3Record = New-FixRound3Record
        $global:Task1Round3ReplacementSawTemporary = $false
        $replacementFailureCode = $null

        try {
            Write-SafeStatusRecord -Path $path -Record $global:Task1Round3Record
            $before = [System.IO.File]::ReadAllText($path)

            Mock -CommandName Replace-SafeStatusExistingTarget -ModuleName ProductionRolloutRunner.Core -MockWith {
                param($TemporaryPath, $TargetPath, $BackupPath)
                $global:Task1Round3ReplacementSawTemporary = [System.IO.File]::Exists($TemporaryPath)
                return $false
            }

            try {
                Write-SafeStatusRecord -Path $global:Task1Round3TargetPath -Record $global:Task1Round3Record
            }
            catch {
                $replacementFailureCode = $_.Exception.Message
            }

            $replacementFailureCode | Should Be 'SAFE_STATUS_WRITE_FAILED'
            $global:Task1Round3ReplacementSawTemporary | Should Be $true
            [System.IO.File]::ReadAllText($path) | Should Be $before
            (Get-FixRound3Artifacts -Directory $PSScriptRoot).Count | Should Be 0
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
            Remove-Variable -Name Task1Round3TargetPath, Task1Round3Record, Task1Round3ReplacementSawTemporary -Scope Global -ErrorAction SilentlyContinue
        }
    }
}
