$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force

$script:NowUtc = [datetime]::SpecifyKind([datetime]'2026-07-25T12:00:00', [DateTimeKind]::Utc)

function New-FixRound1Receipt {
    return [pscustomobject]@{
        schemaVersion = 1
        backup = 'VERIFIED'
        isolatedRestorePoint = 'VERIFIED'
        allWorkersDisabled = 'VERIFIED'
        serverWebSameRelease = 'VERIFIED'
        governanceApproval = 'VERIFIED'
        verifiedAtUtc = $script:NowUtc.AddMinutes(-5)
    }
}

function New-FixRound1Record {
    return New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = 1; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc
}

Describe 'Task 1 fix round 1 evidence schema regressions' {
    It 'rejects a case-variant evidence property name' {
        $receipt = [pscustomobject]@{
            SchemaVersion = 1
            backup = 'VERIFIED'
            isolatedRestorePoint = 'VERIFIED'
            allWorkersDisabled = 'VERIFIED'
            serverWebSameRelease = 'VERIFIED'
            governanceApproval = 'VERIFIED'
            verifiedAtUtc = $script:NowUtc.AddMinutes(-5)
        }

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge ([timespan]::FromMinutes(30))

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_FIELDS_INVALID') | Should Be $true
    }

    It 'accepts every integral CLR representation of schema version one' -TestCases @(
        @{ SchemaVersion = [int64]1 },
        @{ SchemaVersion = [uint32]1 },
        @{ SchemaVersion = [uint64]1 }
    ) {
        param($SchemaVersion)
        $receipt = New-FixRound1Receipt
        $receipt.schemaVersion = $SchemaVersion

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge ([timespan]::FromMinutes(30))

        $result.Status | Should Be 'VALID'
    }

    It 'rejects a non-integral schema version' {
        $receipt = New-FixRound1Receipt
        $receipt.schemaVersion = [decimal]1.0

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge ([timespan]::FromMinutes(30))

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_SCHEMA_INVALID') | Should Be $true
    }
}

Describe 'Task 1 fix round 1 physical writer boundary regressions' {
    It 'rejects an in-root reparse-point ancestor before any write' {
        $safeRoot = Join-Path $PSScriptRoot '..'
        $token = [guid]::NewGuid().ToString('N')
        $junctionPath = Join-Path $safeRoot ('junction-' + $token)
        $outsideDirectory = Join-Path (Split-Path $safeRoot -Parent) ('junction-sink-' + $token)
        [System.IO.Directory]::CreateDirectory($outsideDirectory) | Out-Null
        New-Item -ItemType Junction -Path $junctionPath -Value $outsideDirectory | Out-Null

        try {
            $path = Join-Path $junctionPath 'status.jsonl'
            { Write-SafeStatusRecord -Path $path -Record (New-FixRound1Record) } | Should Throw 'SAFE_STATUS_PATH_INVALID'
            (Test-Path -LiteralPath (Join-Path $outsideDirectory 'status.jsonl')) | Should Be $false
        }
        finally {
            if (Test-Path -LiteralPath $junctionPath) {
                Remove-Item -LiteralPath $junctionPath -Force
            }
            $outsideStatusPath = Join-Path $outsideDirectory 'status.jsonl'
            if (Test-Path -LiteralPath $outsideStatusPath) {
                Remove-Item -LiteralPath $outsideStatusPath -Force
            }
            if (Test-Path -LiteralPath $outsideDirectory) {
                [System.IO.Directory]::Delete($outsideDirectory, $false)
            }
        }
    }

    It 'rejects an existing reparse-point target' {
        $safeRoot = Join-Path $PSScriptRoot '..'
        $token = [guid]::NewGuid().ToString('N')
        $targetPath = Join-Path $safeRoot ('reparse-target-' + $token)
        $outsideDirectory = Join-Path (Split-Path $safeRoot -Parent) ('reparse-target-sink-' + $token)
        [System.IO.Directory]::CreateDirectory($outsideDirectory) | Out-Null
        New-Item -ItemType Junction -Path $targetPath -Value $outsideDirectory | Out-Null

        try {
            { Write-SafeStatusRecord -Path $targetPath -Record (New-FixRound1Record) } | Should Throw 'SAFE_STATUS_PATH_INVALID'
        }
        finally {
            if (Test-Path -LiteralPath $targetPath) {
                Remove-Item -LiteralPath $targetPath -Force
            }
            if (Test-Path -LiteralPath $outsideDirectory) {
                [System.IO.Directory]::Delete($outsideDirectory, $false)
            }
        }
    }

    It 'preserves an existing target and cleans temporary artifacts when replacement is forced to fail' {
        $script:ErrorActionPreference = 'Stop'
        $path = Join-Path $PSScriptRoot ('forced-failure-' + [guid]::NewGuid().ToString('N') + '.jsonl')
        $directory = [System.IO.Path]::GetDirectoryName($path)
        $stream = $null

        try {
            Write-SafeStatusRecord -Path $path -Record (New-FixRound1Record)
            $before = [System.IO.File]::ReadAllText($path)
            $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

            { Write-SafeStatusRecord -Path $path -Record (New-FixRound1Record) } | Should Throw 'SAFE_STATUS_WRITE_FAILED'

            $stream.Dispose()
            $stream = $null
            [System.IO.File]::ReadAllText($path) | Should Be $before
            @([System.IO.Directory]::GetFiles($directory) | Where-Object { [System.IO.Path]::GetFileName($_).StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak')) }).Count | Should Be 0
        }
        finally {
            if ($null -ne $stream) {
                $stream.Dispose()
            }
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
        }
    }
}
