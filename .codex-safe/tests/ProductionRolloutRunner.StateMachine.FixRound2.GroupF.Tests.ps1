Set-StrictMode -Version Latest

function Get-GroupFHelperValidatorModule {
    param([string]$HelperName)

    $helperPath = Join-Path $PSScriptRoot ('..\' + $HelperName)
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'GROUP_F_HELPER_AST_INVALID' }
    $definition = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -ceq 'Assert-ProductionHelperPhysicalBoundary'
        }, $true)
    if ($null -eq $definition) { throw 'GROUP_F_VALIDATOR_NOT_FOUND' }
    return New-Module -ScriptBlock ([scriptblock]::Create($definition.Extent.Text))
}

function Get-GroupFFailureMessage {
    param([scriptblock]$Action)

    try {
        & $Action
        return ''
    }
    catch {
        return $_.Exception.Message
    }
}

function New-GroupFPhysicalWorkspace {
    param([string]$TargetName)

    $root = Join-Path $TestDrive ('group-f-' + [guid]::NewGuid().ToString('N'))
    $workspace = Join-Path $root 'workspace'
    $safeDirectory = Join-Path $workspace '.codex-safe'
    [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
    return [pscustomobject]@{
        Workspace = $workspace
        SafeDirectory = $safeDirectory
        TargetPath = (Join-Path $safeDirectory $TargetName)
        TargetName = $TargetName
    }
}

function New-GroupFReparseDirectory {
    param([string]$LinkPath, [string]$TargetPath)

    [System.IO.Directory]::CreateDirectory($TargetPath) | Out-Null
    & cmd.exe /c ('mklink /J "' + $LinkPath + '" "' + $TargetPath + '"') 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $item = Get-Item -LiteralPath $LinkPath -Force -ErrorAction SilentlyContinue
    return $null -ne $item -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Invoke-GroupFValidator {
    param([string]$HelperName, [object]$Workspace)

    $validatorModule = Get-GroupFHelperValidatorModule -HelperName $HelperName
    return & $validatorModule {
        param($TrustedWorkspaceDirectory, $TrustedSafeDirectory, $ScriptDirectory, $TargetPath, $AllowedTargetName)
        Assert-ProductionHelperPhysicalBoundary `
            -TrustedWorkspaceDirectory $TrustedWorkspaceDirectory `
            -TrustedSafeDirectory $TrustedSafeDirectory `
            -ScriptDirectory $ScriptDirectory `
            -TargetPath $TargetPath `
            -AllowedTargetName $AllowedTargetName
    } $Workspace.Workspace $Workspace.SafeDirectory $Workspace.SafeDirectory $Workspace.TargetPath $Workspace.TargetName
}

Describe 'Task 3 fix round 2 Group F I4/I5 helper pre-import physical validator' {
    $helperCases = @(
        @{ HelperName = 'Set-ProductionRunnerCheckpoint.ps1'; TargetName = 'production-runner-control.json' },
        @{ HelperName = 'Set-ProductionRolloutEvidence.ps1'; TargetName = 'production-rollout-evidence.json' }
    )

    It 'rejects a trusted workspace reparse through the self-contained validator' -TestCases $helperCases {
        param($HelperName, $TargetName)

        $root = Join-Path $TestDrive ('group-f-workspace-reparse-' + [guid]::NewGuid().ToString('N'))
        $physicalWorkspace = Join-Path $root 'physical-workspace'
        $linkedWorkspace = Join-Path $root 'workspace'
        if (-not (New-GroupFReparseDirectory -LinkPath $linkedWorkspace -TargetPath $physicalWorkspace)) { throw 'SAFE_TEST_REPARSE_CAPABILITY_UNAVAILABLE' }
        $safeDirectory = Join-Path $linkedWorkspace '.codex-safe'
        [System.IO.Directory]::CreateDirectory($safeDirectory) | Out-Null
        $workspace = [pscustomobject]@{ Workspace = $linkedWorkspace; SafeDirectory = $safeDirectory; TargetPath = (Join-Path $safeDirectory $TargetName); TargetName = $TargetName }

        (Get-GroupFFailureMessage -Action { Invoke-GroupFValidator -HelperName $HelperName -Workspace $workspace }) | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $workspace.TargetPath) | Should Be $false
    }

    It 'rejects a safe-directory reparse through the self-contained validator' -TestCases $helperCases {
        param($HelperName, $TargetName)

        $root = Join-Path $TestDrive ('group-f-safe-reparse-' + [guid]::NewGuid().ToString('N'))
        $workspace = Join-Path $root 'workspace'
        [System.IO.Directory]::CreateDirectory($workspace) | Out-Null
        $physicalSafeDirectory = Join-Path $root 'physical-safe'
        $safeDirectory = Join-Path $workspace '.codex-safe'
        if (-not (New-GroupFReparseDirectory -LinkPath $safeDirectory -TargetPath $physicalSafeDirectory)) { throw 'SAFE_TEST_REPARSE_CAPABILITY_UNAVAILABLE' }
        $fixture = [pscustomobject]@{ Workspace = $workspace; SafeDirectory = $safeDirectory; TargetPath = (Join-Path $safeDirectory $TargetName); TargetName = $TargetName }

        (Get-GroupFFailureMessage -Action { Invoke-GroupFValidator -HelperName $HelperName -Workspace $fixture }) | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $fixture.TargetPath) | Should Be $false
    }

    It 'rejects an existing target reparse through the self-contained validator' -TestCases $helperCases {
        param($HelperName, $TargetName)

        $workspace = New-GroupFPhysicalWorkspace -TargetName $TargetName
        $backingDirectory = Join-Path $workspace.SafeDirectory 'target-backing'
        if (-not (New-GroupFReparseDirectory -LinkPath $workspace.TargetPath -TargetPath $backingDirectory)) { throw 'SAFE_TEST_REPARSE_CAPABILITY_UNAVAILABLE' }

        (Get-GroupFFailureMessage -Action { Invoke-GroupFValidator -HelperName $HelperName -Workspace $workspace }) | Should Be 'SAFE_STATUS_PATH_INVALID'
    }

    It 'accepts an ordinary physical controlled tree without creating a target' -TestCases $helperCases {
        param($HelperName, $TargetName)

        $workspace = New-GroupFPhysicalWorkspace -TargetName $TargetName

        (Get-GroupFFailureMessage -Action { Invoke-GroupFValidator -HelperName $HelperName -Workspace $workspace }) | Should Be ''
        (Test-Path -LiteralPath $workspace.TargetPath) | Should Be $false
        @([System.IO.Directory]::GetFiles($workspace.SafeDirectory)).Count | Should Be 0
    }

    It 'rejects a copied helper without importing its adjacent fake Core module' -TestCases $helperCases {
        param($HelperName, $TargetName)

        $directory = Join-Path $TestDrive ('group-f-copy-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        $helperPath = Join-Path $directory $HelperName
        $markerPath = Join-Path $directory 'fake-core-imported.marker'
        $fakeCorePath = Join-Path $directory 'ProductionRolloutRunner.Core.psm1'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('..\' + $HelperName)) -Destination $helperPath
        $escapedMarkerPath = $markerPath.Replace("'", "''")
        [System.IO.File]::WriteAllText($fakeCorePath, "[System.IO.File]::WriteAllText('$escapedMarkerPath', 'IMPORTED')", [System.Text.UTF8Encoding]::new($false))

        (Get-GroupFFailureMessage -Action {
                if ($HelperName -ceq 'Set-ProductionRunnerCheckpoint.ps1') {
                    & $helperPath -Command 'GOVERNANCE_COMPLETED' -Sequence 1
                }
                else {
                    & $helperPath
                }
            }) | Should Be 'SAFE_STATUS_PATH_INVALID'
        (Test-Path -LiteralPath $markerPath) | Should Be $false
        (Test-Path -LiteralPath (Join-Path $directory $TargetName)) | Should Be $false
    }
}
