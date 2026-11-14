$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$script:NowUtc = [datetime]::SpecifyKind([datetime]'2026-07-25T12:00:00', [DateTimeKind]::Utc)

function New-FixRound2Record {
    return New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc
}

function Get-FixRound2Artifacts {
    param([string]$Directory)

    return @([System.IO.Directory]::GetFiles($Directory) | Where-Object { [System.IO.Path]::GetFileName($_).StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak')) })
}

Describe 'Task 1 fix round 2 NB1 schema safety regression' {
    It 'returns stable schema invalid status for a present null schema version' {
        $receipt = [pscustomobject]@{
            schemaVersion = $null
            backup = 'VERIFIED'
            isolatedRestorePoint = 'VERIFIED'
            allWorkersDisabled = 'VERIFIED'
            serverWebSameRelease = 'VERIFIED'
            governanceApproval = 'VERIFIED'
            verifiedAtUtc = $script:NowUtc.AddMinutes(-5)
        }

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge ([timespan]::FromMinutes(30))

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_SCHEMA_INVALID') | Should Be $true
    }
}

Describe 'Task 1 fix round 2 I4 writer-boundary regressions' {
    It 'creates the temporary file in the verified target parent' {
        $path = Join-Path $PSScriptRoot ('verified-parent-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $global:Task1Round2ObservedTemporaryPath = $null
        $global:Task1Round2TargetPath = $path
        $global:Task1Round2Record = New-FixRound2Record

        try {
            InModuleScope ProductionRolloutRunner.Core {
                Mock Write-SafeStatusTemporaryFile {
                    param($TemporaryPath, $Content)
                    $global:Task1Round2ObservedTemporaryPath = $TemporaryPath
                    [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
                }

                Write-SafeStatusRecord -Path $global:Task1Round2TargetPath -Record $global:Task1Round2Record
            }

            [System.IO.Path]::GetDirectoryName($global:Task1Round2ObservedTemporaryPath) | Should Be ([System.IO.Path]::GetDirectoryName($path))
            (Test-Path -LiteralPath $path) | Should Be $true
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
            Remove-Variable -Name Task1Round2ObservedTemporaryPath, Task1Round2TargetPath, Task1Round2Record -Scope Global -ErrorAction SilentlyContinue
        }
    }

    It 'returns the safe write code and cleans artifacts when temporary writing fails' {
        $path = Join-Path $PSScriptRoot ('temporary-write-failure-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $global:Task1Round2TargetPath = $path
        $global:Task1Round2Record = New-FixRound2Record

        try {
            InModuleScope ProductionRolloutRunner.Core {
                Mock Write-SafeStatusTemporaryFile { throw 'SIMULATED_TEST_FAILURE' }

                { Write-SafeStatusRecord -Path $global:Task1Round2TargetPath -Record $global:Task1Round2Record } | Should Throw 'SAFE_STATUS_WRITE_FAILED'
            }

            (Test-Path -LiteralPath $path) | Should Be $false
            (Get-FixRound2Artifacts -Directory $PSScriptRoot).Count | Should Be 0
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
            Remove-Variable -Name Task1Round2TargetPath, Task1Round2Record -Scope Global -ErrorAction SilentlyContinue
        }
    }

    It 'returns the safe write code and cleans artifacts when first-write move fails' {
        $path = Join-Path $PSScriptRoot ('first-move-failure-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $global:Task1Round2TargetPath = $path
        $global:Task1Round2Record = New-FixRound2Record

        try {
            InModuleScope ProductionRolloutRunner.Core {
                Mock Move-SafeStatusFirstWrite { throw 'SIMULATED_TEST_FAILURE' }

                { Write-SafeStatusRecord -Path $global:Task1Round2TargetPath -Record $global:Task1Round2Record } | Should Throw 'SAFE_STATUS_WRITE_FAILED'
            }

            (Test-Path -LiteralPath $path) | Should Be $false
            (Get-FixRound2Artifacts -Directory $PSScriptRoot).Count | Should Be 0
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
            Remove-Variable -Name Task1Round2TargetPath, Task1Round2Record -Scope Global -ErrorAction SilentlyContinue
        }
    }
}
