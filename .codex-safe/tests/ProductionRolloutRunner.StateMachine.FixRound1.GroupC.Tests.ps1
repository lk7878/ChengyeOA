Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
$script:GroupCCoreModule = Import-Module $modulePath -Force -PassThru

function Get-GroupCFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function Get-GroupCAtomicArtifacts {
    param([string]$Directory)

    return @(
        [System.IO.Directory]::GetFiles($Directory) |
            Where-Object {
                $name = [System.IO.Path]::GetFileName($_)
                $name.StartsWith('.') -and ([System.IO.Path]::GetExtension($_) -in @('.tmp', '.bak'))
            }
    )
}

function New-GroupCAtomicOperations {
    return @{
        WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            [System.IO.File]::WriteAllText($TemporaryPath, $Content, [System.Text.UTF8Encoding]::new($false))
        }
        MoveFirst = {
            param([string]$TemporaryPath, [string]$TargetPath)
            [System.IO.File]::Move($TemporaryPath, $TargetPath)
        }
        ReplaceExisting = {
            param([string]$TemporaryPath, [string]$TargetPath, [string]$BackupPath)
            [System.IO.File]::Replace($TemporaryPath, $TargetPath, $BackupPath)
        }
    }
}

function Invoke-GroupCAtomicWrite {
    param(
        [string]$TargetPath,
        [string]$Content,
        [hashtable]$Operations
    )

    & $script:GroupCCoreModule {
        param($InnerTargetPath, $InnerContent, $InnerOperations)
        Invoke-SafeStatusAtomicWrite -TargetPath $InnerTargetPath -Content $InnerContent -Operations $InnerOperations
    } $TargetPath $Content $Operations
}

Describe 'Task 3 fix round 1 Group C I4 helper physical boundary' {
    It 'rejects a copied checkpoint helper before creating its target' {
        $directory = Join-Path $TestDrive ('checkpoint-copy-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        $helperPath = Join-Path $directory 'Set-ProductionRunnerCheckpoint.ps1'
        $targetPath = Join-Path $directory 'production-runner-control.json'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Set-ProductionRunnerCheckpoint.ps1') -Destination $helperPath

        (Get-GroupCFailureMessage -Action { & $helperPath -Command 'GOVERNANCE_COMPLETED' -Sequence 1 }) | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $targetPath) | Should Be $false
        @(Get-GroupCAtomicArtifacts -Directory $directory).Count | Should Be 0
    }

    It 'rejects a copied evidence helper before creating its target' {
        $directory = Join-Path $TestDrive ('evidence-copy-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        $helperPath = Join-Path $directory 'Set-ProductionRolloutEvidence.ps1'
        $targetPath = Join-Path $directory 'production-rollout-evidence.json'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Set-ProductionRolloutEvidence.ps1') -Destination $helperPath

        (Get-GroupCFailureMessage -Action { & $helperPath }) | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $targetPath) | Should Be $false
        @(Get-GroupCAtomicArtifacts -Directory $directory).Count | Should Be 0
    }

}

Describe 'Task 3 fix round 1 Group C M2 injectable atomic writer' {
    It 'cleans a partial temporary write while preserving the existing controlled target' {
        $targetPath = Join-Path $TestDrive ('partial-' + [guid]::NewGuid().ToString('N') + '.json')
        [System.IO.File]::WriteAllText($targetPath, 'OLD', [System.Text.UTF8Encoding]::new($false))
        $operations = New-GroupCAtomicOperations
        $operations.WriteTemporary = {
            param([string]$TemporaryPath, [string]$Content)
            [System.IO.File]::WriteAllText($TemporaryPath, 'PARTIAL', [System.Text.UTF8Encoding]::new($false))
            throw 'SIMULATED_TEMPORARY_WRITE_FAILURE'
        }

        (Get-GroupCFailureMessage -Action { Invoke-GroupCAtomicWrite -TargetPath $targetPath -Content 'NEW' -Operations $operations }) | Should Be 'SAFE_STATUS_WRITE_FAILED'
        [System.IO.File]::ReadAllText($targetPath) | Should Be 'OLD'
        @(Get-GroupCAtomicArtifacts -Directory $TestDrive).Count | Should Be 0
    }

    It 'cleans artifacts and leaves no target when the controlled first move fails' {
        $targetPath = Join-Path $TestDrive ('first-move-' + [guid]::NewGuid().ToString('N') + '.json')
        $operations = New-GroupCAtomicOperations
        $operations.MoveFirst = {
            param([string]$TemporaryPath, [string]$TargetPath)
            throw 'SIMULATED_FIRST_MOVE_FAILURE'
        }

        (Get-GroupCFailureMessage -Action { Invoke-GroupCAtomicWrite -TargetPath $targetPath -Content 'NEW' -Operations $operations }) | Should Be 'SAFE_STATUS_WRITE_FAILED'
        (Test-Path -LiteralPath $targetPath) | Should Be $false
        @(Get-GroupCAtomicArtifacts -Directory $TestDrive).Count | Should Be 0
    }

    It 'preserves the existing controlled target when controlled replacement fails' {
        $targetPath = Join-Path $TestDrive ('replacement-' + [guid]::NewGuid().ToString('N') + '.json')
        [System.IO.File]::WriteAllText($targetPath, 'OLD', [System.Text.UTF8Encoding]::new($false))
        $operations = New-GroupCAtomicOperations
        $operations.ReplaceExisting = {
            param([string]$TemporaryPath, [string]$TargetPath, [string]$BackupPath)
            throw 'SIMULATED_REPLACEMENT_FAILURE'
        }

        (Get-GroupCFailureMessage -Action { Invoke-GroupCAtomicWrite -TargetPath $targetPath -Content 'NEW' -Operations $operations }) | Should Be 'SAFE_STATUS_WRITE_FAILED'
        [System.IO.File]::ReadAllText($targetPath) | Should Be 'OLD'
        @(Get-GroupCAtomicArtifacts -Directory $TestDrive).Count | Should Be 0
    }

    It 'publishes complete content through a controlled first move' {
        $targetPath = Join-Path $TestDrive ('first-success-' + [guid]::NewGuid().ToString('N') + '.json')

        Invoke-GroupCAtomicWrite -TargetPath $targetPath -Content 'NEW' -Operations (New-GroupCAtomicOperations)

        [System.IO.File]::ReadAllText($targetPath) | Should Be 'NEW'
        @(Get-GroupCAtomicArtifacts -Directory $TestDrive).Count | Should Be 0
    }

    It 'publishes complete content through a controlled replacement' {
        $targetPath = Join-Path $TestDrive ('replacement-success-' + [guid]::NewGuid().ToString('N') + '.json')
        [System.IO.File]::WriteAllText($targetPath, 'OLD', [System.Text.UTF8Encoding]::new($false))

        Invoke-GroupCAtomicWrite -TargetPath $targetPath -Content 'NEW' -Operations (New-GroupCAtomicOperations)

        [System.IO.File]::ReadAllText($targetPath) | Should Be 'NEW'
        @(Get-GroupCAtomicArtifacts -Directory $TestDrive).Count | Should Be 0
    }
}
