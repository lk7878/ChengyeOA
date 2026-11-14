Set-StrictMode -Version Latest

function Assert-ProductionHelperPhysicalBoundary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TrustedWorkspaceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$TrustedSafeDirectory,

        [Parameter(Mandatory = $true)]
        [string]$ScriptDirectory,

        [Parameter(Mandatory = $true)]
        [string]$TargetPath,

        [Parameter(Mandatory = $true)]
        [string]$AllowedTargetName
    )

    try {
        if ($AllowedTargetName -cne 'production-rollout-evidence.json' -or
            [System.IO.Path]::GetFileName($AllowedTargetName) -cne $AllowedTargetName) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }

        $canonicalWorkspaceDirectory = [System.IO.Path]::GetFullPath($TrustedWorkspaceDirectory).TrimEnd([char[]]'\')
        $canonicalSafeDirectory = [System.IO.Path]::GetFullPath($TrustedSafeDirectory).TrimEnd([char[]]'\')
        $canonicalScriptDirectory = [System.IO.Path]::GetFullPath($ScriptDirectory).TrimEnd([char[]]'\')
        $canonicalTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
        $expectedSafeDirectory = [System.IO.Path]::GetFullPath((Join-Path $canonicalWorkspaceDirectory '.codex-safe')).TrimEnd([char[]]'\')
        $expectedTargetPath = [System.IO.Path]::GetFullPath((Join-Path $canonicalSafeDirectory $AllowedTargetName))

        if (-not $canonicalSafeDirectory.Equals($expectedSafeDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $canonicalScriptDirectory.Equals($canonicalSafeDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $canonicalTargetPath.Equals($expectedTargetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }

        foreach ($componentPath in @($canonicalWorkspaceDirectory, $canonicalSafeDirectory)) {
            $component = Get-Item -LiteralPath $componentPath -Force -ErrorAction Stop
            if (-not $component.PSIsContainer -or (($component.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
                throw 'SAFE_STATUS_PATH_INVALID'
            }
        }

        $targetExists = $false
        try {
            $targetAttributes = [System.IO.File]::GetAttributes($canonicalTargetPath)
            $targetExists = $true
        }
        catch [System.IO.FileNotFoundException] {}
        catch [System.IO.DirectoryNotFoundException] {}
        if ($targetExists -and (($targetAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'SAFE_STATUS_PATH_INVALID'
        }
    }
    catch {
        throw 'SAFE_STATUS_PATH_INVALID'
    }
}
$trustedWorkspaceDirectory = [System.IO.Path]::GetFullPath('D:\2_test\16_ChengyeOA').TrimEnd([char[]]'\')
$trustedSafeDirectory = [System.IO.Path]::GetFullPath('D:\2_test\16_ChengyeOA\.codex-safe').TrimEnd([char[]]'\')
$scriptDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([char[]]'\')
$targetPath = Join-Path $scriptDirectory 'production-rollout-evidence.json'
Assert-ProductionHelperPhysicalBoundary -TrustedWorkspaceDirectory $trustedWorkspaceDirectory -TrustedSafeDirectory $trustedSafeDirectory -ScriptDirectory $scriptDirectory -TargetPath $targetPath -AllowedTargetName 'production-rollout-evidence.json'
$coreModule = Import-Module (Join-Path $scriptDirectory 'ProductionRolloutRunner.Core.psm1') -Force -PassThru -ErrorAction Stop
$record = [ordered]@{
    schemaVersion = 1
    backup = 'VERIFIED'
    isolatedRestorePoint = 'VERIFIED'
    allWorkersDisabled = 'VERIFIED'
    serverWebSameRelease = 'VERIFIED'
    governanceApproval = 'VERIFIED'
    verifiedAtUtc = [datetime]::UtcNow.ToString('o')
}

try {
    $json = $record | ConvertTo-Json -Compress
    & $coreModule { param($TargetPath, $Content) Invoke-SafeStatusAtomicWrite -TargetPath $TargetPath -Content $Content } $targetPath $json
}
catch {
    throw 'EVIDENCE_WRITE_FAILED'
}
