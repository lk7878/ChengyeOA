$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'

if (Test-Path -LiteralPath $modulePath) {
    Import-Module $modulePath -Force
}

$script:NowUtc = [datetime]::SpecifyKind([datetime]'2026-07-25T12:00:00', [DateTimeKind]::Utc)
$script:MaxReceiptAge = [timespan]::FromMinutes(30)

function New-ValidEnvironmentFixture {
    return @{
        DATABASE_URL = 'set'
        JWT_SECRET = 'set'
        APP_KEYS = 'set'
        MFA_ENCRYPTION_KEY_V1 = 'set'
        CORS_ALLOWED_ORIGINS = 'set'
        EVENT_WORKER_ENABLED = 'false'
        NODE_ENV = 'production'
    }
}

function New-ValidReceiptFixture {
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

function New-ValidStatusRecordFixture {
    return New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = 2; failed = 0 } -AlertCodes @('SAFE_TEST') -UtcStart $script:NowUtc.AddSeconds(-2) -UtcEnd $script:NowUtc
}

Describe 'Test-ProductionEnvironmentGate' {
    It 'returns only the safe ready summary for the exact valid environment' {
        $result = Test-ProductionEnvironmentGate -Environment (New-ValidEnvironmentFixture)

        @($result.PSObject.Properties.Name) | Should Be @('Status', 'PresentCount', 'RequiredCount', 'NodeEnvProduction', 'WorkerDisabled', 'AlertCodes')
        $result.Status | Should Be 'READY'
        $result.PresentCount | Should Be 6
        $result.RequiredCount | Should Be 6
        $result.NodeEnvProduction | Should Be $true
        $result.WorkerDisabled | Should Be $true
        @($result.AlertCodes).Count | Should Be 0
    }

    It 'rejects every required name when it is missing' -TestCases @(
        @{ MissingName = 'DATABASE_URL' },
        @{ MissingName = 'JWT_SECRET' },
        @{ MissingName = 'APP_KEYS' },
        @{ MissingName = 'MFA_ENCRYPTION_KEY_V1' },
        @{ MissingName = 'CORS_ALLOWED_ORIGINS' },
        @{ MissingName = 'EVENT_WORKER_ENABLED' }
    ) {
        param($MissingName)
        $environment = New-ValidEnvironmentFixture
        $environment.Remove($MissingName)

        $result = Test-ProductionEnvironmentGate -Environment $environment

        $result.Status | Should Be 'NOT_READY'
        $result.PresentCount | Should Be 5
        $result.RequiredCount | Should Be 6
        ($result.AlertCodes -contains 'ENV_REQUIRED_MISSING') | Should Be $true
    }

    It 'rejects NODE_ENV unless its case is exactly production' {
        $environment = New-ValidEnvironmentFixture
        $environment.NODE_ENV = 'Production'

        $result = Test-ProductionEnvironmentGate -Environment $environment

        $result.Status | Should Be 'NOT_READY'
        $result.NodeEnvProduction | Should Be $false
        ($result.AlertCodes -contains 'NODE_ENV_NOT_PRODUCTION') | Should Be $true
    }

    It 'rejects every non-exact worker-disabled spelling' -TestCases @(
        @{ WorkerSetting = 'False' },
        @{ WorkerSetting = 'FALSE' },
        @{ WorkerSetting = '0' },
        @{ WorkerSetting = 'no' }
    ) {
        param($WorkerSetting)
        $environment = New-ValidEnvironmentFixture
        $environment.EVENT_WORKER_ENABLED = $WorkerSetting

        $result = Test-ProductionEnvironmentGate -Environment $environment

        $result.Status | Should Be 'NOT_READY'
        $result.WorkerDisabled | Should Be $false
        ($result.AlertCodes -contains 'EVENT_WORKER_NOT_DISABLED') | Should Be $true
    }
}

Describe 'Test-ProductionEvidenceReceipt' {
    It 'returns only a valid status and alert codes for the complete current receipt' {
        $result = Test-ProductionEvidenceReceipt -Receipt (New-ValidReceiptFixture) -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        @($result.PSObject.Properties.Name) | Should Be @('Status', 'AlertCodes')
        $result.Status | Should Be 'VALID'
        @($result.AlertCodes).Count | Should Be 0
    }

    It 'rejects a receipt with a missing required field' {
        $receipt = New-ValidReceiptFixture
        $receipt.PSObject.Properties.Remove('backup')

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_FIELDS_INVALID') | Should Be $true
    }

    It 'rejects a receipt with an extra field' {
        $receipt = New-ValidReceiptFixture
        $receipt | Add-Member -NotePropertyName unexpected -NotePropertyValue 'x'

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_FIELDS_INVALID') | Should Be $true
    }

    It 'rejects an unsupported schema version' {
        $receipt = New-ValidReceiptFixture
        $receipt.schemaVersion = 2

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_SCHEMA_INVALID') | Should Be $true
    }

    It 'rejects an unverified evidence field' {
        $receipt = New-ValidReceiptFixture
        $receipt.backup = 'PENDING'

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_VERIFICATION_INVALID') | Should Be $true
    }

    It 'rejects malformed and non-UTC verification times' -TestCases @(
        @{ TimeValue = 'not-a-time' },
        @{ TimeValue = [datetime]::SpecifyKind([datetime]'2026-07-25T11:55:00', [DateTimeKind]::Local) }
    ) {
        param($TimeValue)
        $receipt = New-ValidReceiptFixture
        $receipt.verifiedAtUtc = $TimeValue

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_TIME_INVALID') | Should Be $true
    }

    It 'rejects a future verification time' {
        $receipt = New-ValidReceiptFixture
        $receipt.verifiedAtUtc = $script:NowUtc.AddMinutes(1)

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_TIME_FUTURE') | Should Be $true
    }

    It 'rejects evidence older than thirty minutes' {
        $receipt = New-ValidReceiptFixture
        $receipt.verifiedAtUtc = $script:NowUtc.AddMinutes(-31)

        $result = Test-ProductionEvidenceReceipt -Receipt $receipt -NowUtc $script:NowUtc -MaxAge $script:MaxReceiptAge

        $result.Status | Should Be 'INVALID'
        ($result.AlertCodes -contains 'RECEIPT_EXPIRED') | Should Be $true
    }
}

Describe 'New-SafeStatusRecord and Write-SafeStatusRecord' {
    It 'creates only the allow-listed safe output keys' {
        $record = New-ValidStatusRecordFixture

        @($record.Keys) | Should Be @('phase', 'status', 'boundedCounts', 'alertCodes', 'utcStart', 'utcEnd', 'elapsedSeconds')
        $record.elapsedSeconds | Should Be 2
    }

    It 'rejects non-allow-listed output keys before writing' {
        $record = New-ValidStatusRecordFixture
        $record['unexpected'] = 'x'
        $path = Join-Path $PSScriptRoot 'safe-status-output.jsonl'

        { Write-SafeStatusRecord -Path $path -Record $record } | Should Throw 'SAFE_RECORD_INVALID'
    }

    It 'rejects negative bounded counts' {
        { New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = -1 } -AlertCodes @() -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc } | Should Throw 'SAFE_RECORD_INVALID'
    }

    It 'rejects alert codes outside the safe format' {
        { New-SafeStatusRecord -Phase 'CHECK' -Status 'READY' -BoundedCounts @{ completed = 1 } -AlertCodes @('not-safe') -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc } | Should Throw 'SAFE_RECORD_INVALID'
    }

    It 'rejects address-like schemes assembled from separate fragments' {
        $schemeToken = ('ht' + 'tp' + ':')

        { New-SafeStatusRecord -Phase ($schemeToken + 'unsafe') -Status 'READY' -BoundedCounts @{ completed = 1 } -AlertCodes @() -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc } | Should Throw 'SAFE_RECORD_INVALID'
    }

    It 'rejects a target outside the safe directory' {
        $record = New-ValidStatusRecordFixture
        $outsidePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\outside-status.jsonl'))

        { Write-SafeStatusRecord -Path $outsidePath -Record $record } | Should Throw 'SAFE_STATUS_PATH_INVALID'
    }

    It 'appends compact JSON lines through the safe target path' {
        $path = Join-Path $PSScriptRoot 'safe-status-output.jsonl'
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }

        try {
            Write-SafeStatusRecord -Path $path -Record (New-ValidStatusRecordFixture)
            $second = New-SafeStatusRecord -Phase 'FINISH' -Status 'READY' -BoundedCounts @{ completed = 3; failed = 0 } -AlertCodes @() -UtcStart $script:NowUtc.AddSeconds(-1) -UtcEnd $script:NowUtc
            Write-SafeStatusRecord -Path $path -Record $second

            $lines = @(Get-Content -LiteralPath $path)
            $lines.Count | Should Be 2
            ($lines[0] | ConvertFrom-Json).phase | Should Be 'CHECK'
            ($lines[1] | ConvertFrom-Json).phase | Should Be 'FINISH'
        }
        finally {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
            }
        }
    }
}
