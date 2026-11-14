$loaderPath = Join-Path $PSScriptRoot '..\Load-ChengyeOALocalPreproduction.ps1'
$runnerPath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
$corePath = Join-Path $PSScriptRoot '..\LocalPreproduction.Core.psm1'
$initializerPath = Join-Path $PSScriptRoot '..\Initialize-ChengyeOALocalPreproduction.ps1'

function Get-TestLoaderAllowedNames {
    return @(
        'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
        'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
        'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
        'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
    )
}

function Get-TestPinnedNodeStub {
    $stubPath = Join-Path $TestDrive 'pinned-node-stub.exe'
    if (-not (Test-Path -LiteralPath $stubPath -PathType Leaf)) {
        $source = @'
using System;
using System.IO;

public static class PinnedNodeStub
{
    public static int Main(string[] args)
    {
        if (args.Length != 1 || args[0] != "-v") return 8;
        string versionPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node-version.txt");
        if (!File.Exists(versionPath)) return 9;
        Console.WriteLine(File.ReadAllText(versionPath).Trim());
        return 0;
    }
}
'@
        Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $stubPath -OutputType ConsoleApplication
    }
    return $stubPath
}

function New-TestLoaderSandbox {
    param(
        [string]$Root,
        [ValidateSet(
            'Ready', 'VersionMismatch', 'AmbiguousNpm', 'ResolverLaunchFailure', 'MissingNpx',
            'ExtraResolverField', 'MissingResolverField', 'WrongResolverType', 'MalformedResolver', 'MultilineResolver',
            'RelativeChildPath', 'QuotedChildPath', 'EmptyChildPathSegment', 'UnrelatedNodeLeaf', 'MissingNodeLeaf',
            'MultipleNpx', 'AmbientFallback', 'ShadowNpmInNodeDirectory', 'MissingInheritedDirectory',
            'ExistingFileChildPath', 'DuplicateMissingInheritedDirectory'
        )]
        [string]$ToolchainMode = 'Ready'
    )

    $scriptRoot = Join-Path $Root '.codex-safe'
    $projectRoot = Join-Path $Root 'LayerManage\law-firm-system'
    $fakeNodeRoot = Join-Path $Root 'node-bin'
    $fakeNpmRoot = Join-Path $Root 'npm-bin'
    $fakeNpxRoot = Join-Path $Root 'npx-bin'
    $initialPathParts = @($fakeNpxRoot)
    $localAppData = Join-Path $Root 'local-app-data'
    foreach ($directory in @(
        $scriptRoot,
        $projectRoot,
        $fakeNodeRoot,
        $fakeNpmRoot,
        $fakeNpxRoot,
        $localAppData
    )) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $scriptRoot 'ProductionRolloutRunner.Core.psm1')
    Copy-Item -LiteralPath $corePath -Destination (Join-Path $scriptRoot 'LocalPreproduction.Core.psm1')
    if (Test-Path -LiteralPath $loaderPath -PathType Leaf) {
        Copy-Item -LiteralPath $loaderPath -Destination (Join-Path $scriptRoot 'Load-ChengyeOALocalPreproduction.ps1')
    }

    $nodeVersion = if ($ToolchainMode -ceq 'VersionMismatch') { 'v22.14.1' } else { 'v22.14.0' }
    $npmCommand = "@echo off`r`nif not `"%~1`"==`"--version`" exit /b 8`r`necho 10.9.2`r`n"
    Copy-Item -LiteralPath (Get-TestPinnedNodeStub) -Destination (Join-Path $fakeNodeRoot 'node.exe')
    [System.IO.File]::WriteAllText((Join-Path $fakeNodeRoot 'node-version.txt'), $nodeVersion, [System.Text.Encoding]::ASCII)
    [System.IO.File]::WriteAllText((Join-Path $fakeNpmRoot 'npm.cmd'), $npmCommand, [System.Text.Encoding]::ASCII)
    $resolverPathParts = @($fakeNpmRoot, $fakeNodeRoot)
    if ($ToolchainMode -ceq 'MissingInheritedDirectory') {
        $resolverPathParts += (Join-Path $Root 'inherited-directory-not-present')
    }
    if ($ToolchainMode -ceq 'ExistingFileChildPath') {
        $existingFilePath = Join-Path $Root 'inherited-path-file'
        [System.IO.File]::WriteAllText($existingFilePath, 'not-a-directory', [System.Text.Encoding]::ASCII)
        $resolverPathParts += $existingFilePath
    }
    if ($ToolchainMode -ceq 'DuplicateMissingInheritedDirectory') {
        $missingPath = Join-Path $Root 'duplicate-inherited-directory-not-present'
        $resolverPathParts += @($missingPath, $missingPath)
    }
    if ($ToolchainMode -ceq 'AmbiguousNpm') {
        $alternateNpmRoot = Join-Path $Root 'alternate-npm-bin'
        New-Item -ItemType Directory -Path $alternateNpmRoot -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $alternateNpmRoot 'npm.cmd'), $npmCommand, [System.Text.Encoding]::ASCII)
        $resolverPathParts = @($fakeNpmRoot, $alternateNpmRoot, $fakeNodeRoot)
    }
    $resolverObject = [ordered]@{
        execPath = (Join-Path $fakeNodeRoot 'node.exe')
        path = ($resolverPathParts -join ';')
    }
    if ($ToolchainMode -ceq 'ExtraResolverField') {
        $resolverObject['extra'] = 'resolver-extra-marker'
    }
    if ($ToolchainMode -ceq 'MissingResolverField') {
        $resolverObject.Remove('path')
    }
    if ($ToolchainMode -ceq 'WrongResolverType') {
        $resolverObject['path'] = @($fakeNpmRoot, $fakeNodeRoot)
    }
    if ($ToolchainMode -ceq 'RelativeChildPath') {
        $resolverObject['path'] = 'relative-child-path'
    }
    if ($ToolchainMode -ceq 'QuotedChildPath') {
        $resolverObject['path'] = "`"$fakeNpmRoot`";$fakeNodeRoot"
    }
    if ($ToolchainMode -ceq 'EmptyChildPathSegment') {
        $resolverObject['path'] = "$fakeNpmRoot;;$fakeNodeRoot"
    }
    if ($ToolchainMode -ceq 'UnrelatedNodeLeaf') {
        Copy-Item -LiteralPath (Join-Path $fakeNodeRoot 'node.exe') -Destination (Join-Path $fakeNodeRoot 'other.exe')
        $resolverObject['execPath'] = Join-Path $fakeNodeRoot 'other.exe'
    }
    if ($ToolchainMode -ceq 'MissingNodeLeaf') {
        $resolverObject['execPath'] = Join-Path $fakeNodeRoot 'missing-node.exe'
    }
    if ($ToolchainMode -ceq 'AmbientFallback') {
        $unrelatedRoot = Join-Path $Root 'unrelated-bin'
        $ambientRoot = Join-Path $Root 'ambient-bin'
        New-Item -ItemType Directory -Path $unrelatedRoot, $ambientRoot -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $fakeNodeRoot 'node.exe') -Destination (Join-Path $unrelatedRoot 'other.exe')
        Copy-Item -LiteralPath (Join-Path $fakeNodeRoot 'node.exe') -Destination (Join-Path $ambientRoot 'node.exe')
        Copy-Item -LiteralPath (Join-Path $fakeNodeRoot 'node-version.txt') -Destination (Join-Path $ambientRoot 'node-version.txt')
        $resolverObject['execPath'] = Join-Path $unrelatedRoot 'other.exe'
        $resolverObject['path'] = $fakeNpmRoot
        $initialPathParts += $ambientRoot
    }
    if ($ToolchainMode -ceq 'ShadowNpmInNodeDirectory') {
        [System.IO.File]::WriteAllText((Join-Path $fakeNodeRoot 'npm.cmd'), $npmCommand, [System.Text.Encoding]::ASCII)
        $resolverObject['path'] = $fakeNpmRoot
    }
    $resolver = $resolverObject | ConvertTo-Json -Compress
    if ($ToolchainMode -ceq 'MalformedResolver') {
        $resolver = '{'
    }
    if ($ToolchainMode -ceq 'MultilineResolver') {
        $resolver = $resolver + [Environment]::NewLine + $resolver
    }
    [System.IO.File]::WriteAllText((Join-Path $fakeNpxRoot 'resolver.json'), $resolver, [System.Text.Encoding]::UTF8)
    if ($ToolchainMode -cne 'MissingNpx') {
        $npxCommand = if ($ToolchainMode -ceq 'ResolverLaunchFailure') {
            "@echo off`r`necho resolver-failure-marker 1>&2`r`nexit /b 9`r`n"
        }
        else {
            @"
@echo off
if not "%~1"=="--yes" exit /b 8
if not "%~2"=="--package" exit /b 8
if not "%~3"=="node@22.14.0" exit /b 8
if not "%~4"=="--package" exit /b 8
if not "%~5"=="npm@10.9.2" exit /b 8
if not "%~6"=="--" exit /b 8
if not "%~7"=="node" exit /b 8
if not "%~8"=="-e" exit /b 8
if "%~9"=="" exit /b 8
type "%~dp0resolver.json"
"@
        }
        [System.IO.File]::WriteAllText((Join-Path $fakeNpxRoot 'npx.cmd'), $npxCommand, [System.Text.Encoding]::ASCII)
    }
    if ($ToolchainMode -ceq 'MultipleNpx') {
        $alternateNpxRoot = Join-Path $Root 'alternate-npx-bin'
        New-Item -ItemType Directory -Path $alternateNpxRoot -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $fakeNpxRoot 'npx.cmd') -Destination (Join-Path $alternateNpxRoot 'npx.cmd')
        Copy-Item -LiteralPath (Join-Path $fakeNpxRoot 'resolver.json') -Destination (Join-Path $alternateNpxRoot 'resolver.json')
        $initialPathParts += $alternateNpxRoot
    }

    return [pscustomobject]@{
        ScriptRoot = $scriptRoot
        LoaderPath = (Join-Path $scriptRoot 'Load-ChengyeOALocalPreproduction.ps1')
        FakeNpxRoot = $fakeNpxRoot
        LocalAppData = $localAppData
        FakeNodeRoot = $fakeNodeRoot
        FakeNpmRoot = $fakeNpmRoot
        InitialPath = ($initialPathParts -join ';')
        ProjectRoot = $projectRoot
    }
}

function New-TestLoaderBundle {
    param(
        [pscustomobject]$Sandbox,
        [ValidateSet('Valid', 'InvalidCiphertext', 'InvalidEnvironment')]
        [string]$Mode = 'Valid'
    )

    $storageRoot = Join-Path $Sandbox.LocalAppData 'ChengyeOA\local-preproduction'
    New-Item -ItemType Directory -Path $storageRoot -Force | Out-Null
    $bundlePath = Join-Path $storageRoot 'environment.dpapi'
    if ($Mode -ceq 'InvalidCiphertext') {
        [System.IO.File]::WriteAllText($bundlePath, 'invalid-ciphertext-marker', [System.Text.Encoding]::ASCII)
        return $null
    }

    Import-Module $corePath -Force -ErrorAction Stop
    $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
    if ($Mode -ceq 'InvalidEnvironment') {
        $material.NODE_ENV = 'Production'
    }
    Protect-LocalPreproductionBundle -Material $material -LiteralPath $bundlePath -ApprovedRoot $storageRoot
    return $material
}

function Invoke-TestLoaderChild {
    param(
        [pscustomobject]$Sandbox,
        [ValidateSet(
            'None', 'ValidationException', 'CommitFailure', 'RollbackFailure', 'RecordFailure', 'WorkerConflict',
            'CommitBoundaryFailure', 'PostCommitNodeReplacement', 'PostCommitNodeMismatch',
            'PostCommitNpmMismatch', 'PostCommitNpmLaunchFailure',
            'PostCommitNpmMismatchRollbackFailure'
        )]
        [string]$InjectionMode = 'None',
        [int]$FailureIndex = 0,
        [int]$RollbackFailureIndex = 0,
        [scriptblock]$TestProcessFactory
    )

    $harnessPath = Join-Path $Sandbox.ScriptRoot 'invoke-loader-test.ps1'
    $harness = @'
param(
    [string]$LoaderPath,
    [string]$LocalAppData,
    [string]$InitialPath,
    [string]$FakeNpxRoot,
    [string]$InjectionMode,
    [int]$FailureIndex,
    [int]$RollbackFailureIndex
)

$allowed = @(
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
    'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
    'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
    'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
)
$env:LOCALAPPDATA = $LocalAppData
$env:PATH = "$InitialPath;$env:SystemRoot\System32;$env:SystemRoot"
$pathBefore = $env:PATH
$before = @{}
$userBefore = @{}
$machineBefore = @{}
foreach ($name in $allowed) {
    $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    $userBefore[$name] = [Environment]::GetEnvironmentVariable($name, 'User')
    $machineBefore[$name] = [Environment]::GetEnvironmentVariable($name, 'Machine')
}

$expected = $null
try {
    Import-Module (Join-Path (Split-Path -Parent $LoaderPath) 'LocalPreproduction.Core.psm1') -Force -ErrorAction Stop
    $expected = Unprotect-LocalPreproductionBundle -LiteralPath (Join-Path $LocalAppData 'ChengyeOA\local-preproduction\environment.dpapi')
}
catch {
}

$operationState = @{
    ValidationInjected = $false
    CommitFailureInjected = $false
    RollbackFailureInjected = $false
    RecordFailureInjected = $false
    WorkerConflictInjected = $false
    AssignmentCalls = 0
    RollbackCalls = 0
    WorkerSetCalls = 0
    CommitCalls = 0
    PostProbeMutationInjected = $false
}
$testOperations = $null
if ($InjectionMode -ceq 'ValidationException') {
    $testOperations = @{
        ValidateEnvironment = {
            param([System.Collections.IDictionary]$Environment)
            $operationState.ValidationInjected = $true
            throw 'INJECTED_VALIDATION_FAILURE'
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -in @('CommitFailure', 'RollbackFailure')) {
    $testOperations = @{
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)

            if (-not $operationState.CommitFailureInjected) {
                if ($Name -cne 'PATH') {
                    $operationState.AssignmentCalls++
                    if ($operationState.AssignmentCalls -eq $FailureIndex) {
                        $operationState.CommitFailureInjected = $true
                        throw 'INJECTED_COMMIT_FAILURE'
                    }
                }
            }
            else {
                $operationState.RollbackCalls++
                if ($InjectionMode -ceq 'RollbackFailure' -and
                    -not $operationState.RollbackFailureInjected -and
                    $operationState.RollbackCalls -eq $RollbackFailureIndex) {
                    $operationState.RollbackFailureInjected = $true
                    throw 'INJECTED_ROLLBACK_FAILURE'
                }
            }
            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -ceq 'RecordFailure') {
    $testOperations = @{
        NewStatusRecord = {
            param(
                [string]$Status,
                [string[]]$AlertCodes,
                [int]$EnvironmentImported,
                [int]$ToolchainReady,
                [datetime]$UtcStart
            )
            $operationState.RecordFailureInjected = $true
            throw 'INJECTED_RECORD_FAILURE'
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -ceq 'WorkerConflict') {
    $testOperations = @{
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)

            if ($Name -ceq 'EVENT_WORKER_ENABLED') {
                $operationState.WorkerSetCalls++
                if ($operationState.WorkerSetCalls -eq 1) {
                    $operationState.WorkerConflictInjected = $true
                    [Environment]::SetEnvironmentVariable($Name, 'true', 'Process')
                    return
                }
            }
            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -ceq 'CommitBoundaryFailure') {
    $testOperations = @{
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)

            if (-not $operationState.CommitFailureInjected) {
                $operationState.CommitCalls++
                if ($operationState.CommitCalls -eq $FailureIndex) {
                    $operationState.CommitFailureInjected = $true
                    throw 'INJECTED_COMMIT_BOUNDARY_FAILURE'
                }
            }
            else {
                $operationState.RollbackCalls++
            }
            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -in @(
    'PostCommitNodeReplacement', 'PostCommitNodeMismatch',
    'PostCommitNpmMismatch', 'PostCommitNpmLaunchFailure'
)) {
    $testOperations = @{
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)

            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
            if ($Name -cne 'PATH' -or $operationState.PostProbeMutationInjected) {
                return
            }
            $operationState.PostProbeMutationInjected = $true
            $resolverFixture = Get-Content -LiteralPath (Join-Path $FakeNpxRoot 'resolver.json') -Raw | ConvertFrom-Json
            $nodePath = [string]$resolverFixture.execPath
            $nodeDirectory = Split-Path -Parent $nodePath
            $npmPath = $null
            foreach ($pathPart in ([string]$resolverFixture.path).Split(';')) {
                $candidate = Join-Path $pathPart 'npm.cmd'
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    $npmPath = $candidate
                    break
                }
            }
            if ($InjectionMode -ceq 'PostCommitNodeReplacement') {
                $replacementDirectory = Split-Path -Parent $npmPath
                Copy-Item -LiteralPath $nodePath -Destination (Join-Path $replacementDirectory 'node.exe')
                Copy-Item -LiteralPath (Join-Path $nodeDirectory 'node-version.txt') -Destination (Join-Path $replacementDirectory 'node-version.txt')
                [System.IO.File]::Delete($nodePath)
            }
            elseif ($InjectionMode -ceq 'PostCommitNodeMismatch') {
                [System.IO.File]::WriteAllText((Join-Path $nodeDirectory 'node-version.txt'), 'v22.14.1', [System.Text.Encoding]::ASCII)
            }
            elseif ($InjectionMode -ceq 'PostCommitNpmMismatch') {
                [System.IO.File]::WriteAllText($npmPath, "@echo off`r`necho 10.9.3`r`n", [System.Text.Encoding]::ASCII)
            }
            elseif ($InjectionMode -ceq 'PostCommitNpmLaunchFailure') {
                [System.IO.File]::WriteAllText($npmPath, "@echo off`r`necho post-commit-npm-failure-marker 1>&2`r`nexit /b 9`r`n", [System.Text.Encoding]::ASCII)
            }
        }.GetNewClosure()
    }
}
elseif ($InjectionMode -ceq 'PostCommitNpmMismatchRollbackFailure') {
    $testOperations = @{
        SetProcessValue = {
            param([string]$Name, [AllowNull()][string]$Value)

            if ($operationState.CommitCalls -lt 18) {
                $operationState.CommitCalls++
                [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
                if ($operationState.CommitCalls -eq 1) {
                    $resolverFixture = Get-Content -LiteralPath (Join-Path $FakeNpxRoot 'resolver.json') -Raw | ConvertFrom-Json
                    foreach ($pathPart in ([string]$resolverFixture.path).Split(';')) {
                        $candidate = Join-Path $pathPart 'npm.cmd'
                        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                            [System.IO.File]::WriteAllText($candidate, "@echo off`r`necho 10.9.3`r`n", [System.Text.Encoding]::ASCII)
                            $operationState.PostProbeMutationInjected = $true
                            break
                        }
                    }
                }
                return
            }

            $operationState.RollbackCalls++
            if (-not $operationState.RollbackFailureInjected -and
                $operationState.RollbackCalls -eq $RollbackFailureIndex) {
                $operationState.RollbackFailureInjected = $true
                throw 'INJECTED_COMBINED_ROLLBACK_FAILURE'
            }
            [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        }.GetNewClosure()
    }
}

$invocationFailed = $false
try {
    if ($null -eq $testOperations) {
        $captured = @(& { . $LoaderPath } *>&1)
    }
    else {
        $captured = @(& { . $LoaderPath -TestOperations $testOperations } *>&1)
    }
}
catch {
    $captured = @()
    $invocationFailed = $true
}
$records = @($captured | Where-Object {
    $_ -is [System.Collections.IDictionary] -and $_.Contains('phase')
})
$additionalStreamCount = $captured.Count - $records.Count
$unchanged = $env:PATH -ceq $pathBefore
$scopeUnchanged = $true
foreach ($name in $allowed) {
    if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $before[$name]) {
        $unchanged = $false
    }
    if ([Environment]::GetEnvironmentVariable($name, 'User') -cne $userBefore[$name] -or
        [Environment]::GetEnvironmentVariable($name, 'Machine') -cne $machineBefore[$name]) {
        $scopeUnchanged = $false
    }
}
$allMatched = $null -ne $expected -and $expected.Count -eq 16
if ($allMatched) {
    foreach ($name in $allowed) {
        if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne [string]$expected[$name]) {
            $allMatched = $false
        }
    }
}
$resolver = $null
try {
    $resolver = Get-Content -LiteralPath (Join-Path $FakeNpxRoot 'resolver.json') -Raw | ConvertFrom-Json -ErrorAction Stop
}
catch {
}
$pathPinned = $false
try {
    if ($null -ne $resolver -and
        $resolver.PSObject.Properties.Name -contains 'path' -and
        $resolver.PSObject.Properties.Name -contains 'execPath' -and
        $resolver.path -is [string] -and
        $resolver.execPath -is [string]) {
        $npmDirectory = @(([string]$resolver.path).Split(';') | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_) -and
            [System.IO.Path]::IsPathRooted($_) -and
            (Test-Path -LiteralPath (Join-Path $_ 'npm.cmd') -PathType Leaf -ErrorAction Stop)
        })
        if ($npmDirectory.Count -eq 1) {
            $expectedPrefix = "$(Split-Path -Parent ([string]$resolver.execPath));$($npmDirectory[0]);"
            $pathPinned = $env:PATH.StartsWith($expectedPrefix, [System.StringComparison]::Ordinal)
        }
    }
}
catch {
    $pathPinned = $false
}
$privateCapturedText = [string]::Join([Environment]::NewLine, @($captured | ForEach-Object {
    if ($_ -is [System.Collections.IDictionary]) {
        $_ | ConvertTo-Json -Depth 8 -Compress
    }
    else {
        [string]$_
    }
}))
$forbiddenMatchCount = 0
foreach ($marker in @(
    'invalid-ciphertext-marker', 'resolver-failure-marker', 'resolver-extra-marker',
    'post-commit-npm-failure-marker',
    $LoaderPath, $LocalAppData, $FakeNpxRoot
)) {
    if (-not [string]::IsNullOrEmpty([string]$marker) -and $privateCapturedText.Contains([string]$marker)) {
        $forbiddenMatchCount++
    }
}
if ($null -ne $expected) {
    foreach ($name in @(
        'POSTGRES_PASSWORD', 'POSTGRES_TEST_PASSWORD', 'DATABASE_URL',
        'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS', 'MFA_ENCRYPTION_KEY_V1'
    )) {
        if ($privateCapturedText.Contains([string]$expected[$name])) {
            $forbiddenMatchCount++
        }
    }
}
if ($privateCapturedText -match '(?i)postgres(?:ql)?://|stack|exception|(?:host|process|container|worker|lock)(?:id|identifier|owner)') {
    $forbiddenMatchCount++
}

[ordered]@{
    outputCount = $records.Count
    record = if ($records.Count -eq 1) { $records[0] } else { $null }
    unchanged = $unchanged
    scopeUnchanged = $scopeUnchanged
    allMatched = $allMatched
    workerDisabled = [Environment]::GetEnvironmentVariable('EVENT_WORKER_ENABLED', 'Process') -ceq 'false'
    pathPinned = $pathPinned
    invocationFailed = $invocationFailed
    additionalStreamCount = $additionalStreamCount
    forbiddenMatchCount = $forbiddenMatchCount
    validationInjected = $operationState.ValidationInjected
    commitFailureInjected = $operationState.CommitFailureInjected
    rollbackFailureInjected = $operationState.RollbackFailureInjected
    recordFailureInjected = $operationState.RecordFailureInjected
    workerConflictInjected = $operationState.WorkerConflictInjected
    assignmentCalls = $operationState.AssignmentCalls
    rollbackCalls = $operationState.RollbackCalls
    workerSetCalls = $operationState.WorkerSetCalls
    commitCalls = $operationState.CommitCalls
    postProbeMutationInjected = $operationState.PostProbeMutationInjected
} | ConvertTo-Json -Depth 8 -Compress
'@
    [System.IO.File]::WriteAllText($harnessPath, $harness, [System.Text.Encoding]::UTF8)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command powershell.exe -CommandType Application).Source
    $startInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$harnessPath`" -LoaderPath `"$($Sandbox.LoaderPath)`" -LocalAppData `"$($Sandbox.LocalAppData)`" -InitialPath `"$($Sandbox.InitialPath)`" -FakeNpxRoot `"$($Sandbox.FakeNpxRoot)`" -InjectionMode `"$InjectionMode`" -FailureIndex $FailureIndex -RollbackFailureIndex $RollbackFailureIndex"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = $null
    $standardOutput = ''
    $standardError = ''
    $childExitCode = $null
    try {
        $process = if ($null -ne $TestProcessFactory) {
            & $TestProcessFactory
        }
        else {
            New-Object System.Diagnostics.Process
        }
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $standardOutput = [string]$process.StandardOutput.ReadToEnd()
        $standardError = [string]$process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $childExitCode = [int]$process.ExitCode
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
    $outputLines = @($standardOutput.Split([char[]]"`r`n", [System.StringSplitOptions]::RemoveEmptyEntries))
    if ($childExitCode -ne 0 -or $outputLines.Count -ne 1) {
        return [pscustomobject]@{
            childExitCode = $childExitCode
            childStdOutLineCount = $outputLines.Count
            childStdErrPresent = -not [string]::IsNullOrWhiteSpace($standardError)
            invocationFailed = $true
            outputCount = 0
        }
    }
    $result = $outputLines[0] | ConvertFrom-Json
    $result | Add-Member -NotePropertyName childExitCode -NotePropertyValue $childExitCode
    $result | Add-Member -NotePropertyName childStdOutLineCount -NotePropertyValue $outputLines.Count
    $result | Add-Member -NotePropertyName childStdErrPresent -NotePropertyValue (-not [string]::IsNullOrWhiteSpace($standardError))
    return $result
}

function New-TestLoaderProcessProbe {
    param(
        [int]$ExitCode = 0,
        [string]$StandardOutput = '{}',
        [string]$StandardError = '',
        [switch]$ThrowOnWait
    )

    $state = [pscustomobject]@{
        DisposeCount = 0
    }
    $stdoutReader = [pscustomobject]@{ Text = $StandardOutput }
    $stdoutReader | Add-Member -MemberType ScriptMethod -Name ReadToEnd -Value { return [string]$this.Text }
    $stderrReader = [pscustomobject]@{ Text = $StandardError }
    $stderrReader | Add-Member -MemberType ScriptMethod -Name ReadToEnd -Value { return [string]$this.Text }
    $process = [pscustomobject]@{
        StartInfo = $null
        StandardOutput = $stdoutReader
        StandardError = $stderrReader
        ExitCode = $ExitCode
        ThrowOnWait = [bool]$ThrowOnWait
        State = $state
    }
    $process | Add-Member -MemberType ScriptMethod -Name Start -Value { return $true }
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
        if ($this.ThrowOnWait) { throw 'loader-process-probe-wait-failure' }
    }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value {
        $this.State.DisposeCount++
    }
    return [pscustomobject]@{
        Process = $process
        State = $state
    }
}

function Test-TestLoaderEnvelope {
    param([object]$Result)

    return $null -ne $Result -and
        $Result.outputCount -eq 1 -and
        -not $Result.invocationFailed -and
        $Result.additionalStreamCount -eq 0 -and
        $Result.forbiddenMatchCount -eq 0 -and
        $Result.childExitCode -eq 0 -and
        $Result.childStdOutLineCount -eq 1 -and
        -not $Result.childStdErrPresent
}

function Get-TestResetCanonicalComposePath {
    $normalizedCorePath = [System.IO.Path]::GetFullPath($corePath)
    $repositoryRoot = Split-Path -Parent (Split-Path -Parent $normalizedCorePath)
    return [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'LayerManage\law-firm-system\infra\postgres\compose.yml'))
}

function Get-TestResetCanonicalOverridePath {
    return [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $corePath) 'local-preproduction.compose.override.yml'))
}

function Get-TestWorkflowFailureCode {
    param([Parameter(Mandatory)][scriptblock]$Action)

    try {
        & $Action
        return 'NO_FAILURE'
    }
    catch {
        return [string]$_.Exception.Message
    }
}

function Test-TestResetExactComposePrefix {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$ComposePath,
        [Parameter(Mandatory)][string]$OverridePath
    )

    $expectedPrefix = @(
        'compose', '-p', 'chengyeoa-local-preproduction',
        '-f', $ComposePath,
        '-f', $OverridePath
    )
    if ($Arguments.Count -lt $expectedPrefix.Count) { return $false }
    for ($index = 0; $index -lt $expectedPrefix.Count; $index++) {
        if ([string]$Arguments[$index] -cne [string]$expectedPrefix[$index]) { return $false }
    }
    return $true
}

function Invoke-TestResetScenario {
    param(
        [ValidateSet(
            'Ready', 'BundleMissing', 'BundleInvalid', 'EnvironmentMismatch', 'WorkerEnabled',
            'ServicesFailure', 'ServicesMissing', 'ServicesExtra', 'ServicesIncorrect',
            'VolumesFailure', 'VolumesMissing', 'VolumesExtra', 'VolumesIncorrect',
            'BaselineStartFailure', 'BaselineHealthTimeout',
            'CountNonzero', 'CountEmpty', 'CountMalformed', 'CountMultiline', 'CountSigned', 'CountWhitespace',
            'CountFailure', 'DownFailure', 'UpFailure',
            'HealthTimeout', 'HealthConstantClock', 'HealthRegressingClock', 'HealthNoOpSleep', 'HealthSlowFailure',
            'NativeException', 'NativeWarning', 'NativeError', 'NativeVerbose', 'NativeDebug',
            'NativeInformation', 'NativeMalformed', 'NativeTerminationUnconfirmed',
            'AssertEmptyFailure', 'AssertEmptyException', 'AssertEmptyFailureWithRows',
            'DeployFailure', 'DeployException', 'ResumeDeployFailure', 'ResumeDeployException',
            'ResumePostAssertFailure', 'ResumePostAssertException',
            'ContractFailure', 'ContractException', 'BootstrapFailure', 'BootstrapException',
            'BootstrapFailureWithRows'
        )]
        [string]$Scenario = 'Ready',
        [string]$MismatchName = 'JWT_SECRET',
        [switch]$WithoutConfirmation,
        [ValidateRange(0, 2000)][int]$CallerDelayMilliseconds = 0,
        [hashtable]$DatabaseState
    )

    if ($null -eq $DatabaseState) {
        $DatabaseState = @{
            TableCount = $(if ($Scenario -ceq 'CountNonzero') { 2L } else { 0L })
            SchemaComplete = $false
            ApplicationRows = 0L
        }
    }
    $stateKeys = @($DatabaseState.Keys | ForEach-Object { [string]$_ })
    $requiredStateKeys = @('TableCount', 'SchemaComplete', 'ApplicationRows')
    $stateKeysValid = $stateKeys.Count -eq $requiredStateKeys.Count
    foreach ($requiredStateKey in $requiredStateKeys) {
        if ($stateKeys -cnotcontains $requiredStateKey) { $stateKeysValid = $false }
    }
    $tableCountTypeValid = $DatabaseState.TableCount -is [byte] -or
        $DatabaseState.TableCount -is [sbyte] -or
        $DatabaseState.TableCount -is [int16] -or
        $DatabaseState.TableCount -is [uint16] -or
        $DatabaseState.TableCount -is [int32] -or
        $DatabaseState.TableCount -is [uint32] -or
        $DatabaseState.TableCount -is [int64] -or
        $DatabaseState.TableCount -is [uint64]
    $applicationRowsTypeValid = $DatabaseState.ApplicationRows -is [byte] -or
        $DatabaseState.ApplicationRows -is [sbyte] -or
        $DatabaseState.ApplicationRows -is [int16] -or
        $DatabaseState.ApplicationRows -is [uint16] -or
        $DatabaseState.ApplicationRows -is [int32] -or
        $DatabaseState.ApplicationRows -is [uint32] -or
        $DatabaseState.ApplicationRows -is [int64] -or
        $DatabaseState.ApplicationRows -is [uint64]
    if (-not $stateKeysValid -or
        -not $tableCountTypeValid -or
        -not $applicationRowsTypeValid -or
        $DatabaseState.TableCount -lt 0 -or
        $DatabaseState.ApplicationRows -lt 0 -or
        $DatabaseState.SchemaComplete -isnot [bool]) {
        throw 'TEST_DATABASE_STATE_INVALID'
    }

    Import-Module $corePath -Force -ErrorAction Stop
    $allowedNames = Get-TestLoaderAllowedNames
    $savedLocalAppData = $env:LOCALAPPDATA
    $savedValues = @{}
    foreach ($name in $allowedNames) {
        $savedValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }

    $root = Join-Path $TestDrive ('reset-' + $Scenario + '-' + [guid]::NewGuid().ToString('N'))
    $localAppData = Join-Path $root 'local-app-data'
    $storageRoot = Join-Path $localAppData 'ChengyeOA\local-preproduction'
    New-Item -ItemType Directory -Path $storageRoot -Force | Out-Null
    $bundlePath = Join-Path $storageRoot 'environment.dpapi'
    $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
    if ($Scenario -ceq 'BundleInvalid') {
        [System.IO.File]::WriteAllText($bundlePath, 'reset-invalid-marker', [System.Text.Encoding]::ASCII)
    }
    elseif ($Scenario -cne 'BundleMissing') {
        Protect-LocalPreproductionBundle -Material $material -LiteralPath $bundlePath -ApprovedRoot $storageRoot
    }

    $calls = New-Object System.Collections.ArrayList
    $sleepRequests = New-Object System.Collections.ArrayList
    $slowHealthSleepRequests = New-Object System.Collections.ArrayList
    $healthTiming = @{ Watch = $null; ElapsedMilliseconds = -1 }
    $countContractRejected = 0
    $clock = @{
        Value = [datetime]'2026-07-26T00:00:00Z'
        Calls = 0
        Fuse = $false
    }
    $expectedCountArguments = @(Get-TestResetExpectedCountArguments -ComposePath (Get-TestResetCanonicalComposePath))
    $nativeOperation = {
        param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)

        [void]$calls.Add([pscustomobject]@{
            FilePath = $FilePath
            Arguments = @($Arguments)
            TimeoutMilliseconds = $TimeoutMilliseconds
            WorkingDirectory = (Get-Location).ProviderPath
        })
        $shape = @($Arguments)
        if ($Scenario -ceq 'NativeException') {
            throw 'reset-native-sensitive-marker'
        }
        if ($Scenario -ceq 'NativeWarning') { Write-Warning 'reset-native-sensitive-marker' }
        if ($Scenario -ceq 'NativeError') { Write-Error 'reset-native-sensitive-marker' }
        if ($Scenario -ceq 'NativeVerbose') { Write-Verbose 'reset-native-sensitive-marker' -Verbose }
        if ($Scenario -ceq 'NativeDebug') { Write-Debug 'reset-native-sensitive-marker' -Debug }
        if ($Scenario -ceq 'NativeInformation') { Write-Information 'reset-native-sensitive-marker' -InformationAction Continue }
        if ($Scenario -ceq 'NativeMalformed') {
            return [pscustomobject]@{ ExitCode = 0; StdOut = @() }
        }
        if ($shape.Count -ge 5 -and $shape[-2] -ceq 'config' -and $shape[-1] -ceq '--services') {
            if ($Scenario -ceq 'ServicesFailure') {
                return [pscustomobject]@{ ExitCode = 8; StdOut = @(); StdErr = @('reset-metadata-sensitive-marker') }
            }
            if ($Scenario -ceq 'ServicesMissing') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @() }
            }
            if ($Scenario -ceq 'ServicesExtra') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('postgres', 'extra'); StdErr = @() }
            }
            if ($Scenario -ceq 'ServicesIncorrect') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('other'); StdErr = @() }
            }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @('postgres'); StdErr = @() }
        }
        if ($shape.Count -ge 5 -and $shape[-2] -ceq 'config' -and $shape[-1] -ceq '--volumes') {
            if ($Scenario -ceq 'VolumesFailure') {
                return [pscustomobject]@{ ExitCode = 8; StdOut = @(); StdErr = @('reset-metadata-sensitive-marker') }
            }
            if ($Scenario -ceq 'VolumesMissing') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @() }
            }
            if ($Scenario -ceq 'VolumesExtra') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('chengye_postgres_data', 'extra'); StdErr = @() }
            }
            if ($Scenario -ceq 'VolumesIncorrect') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('other'); StdErr = @() }
            }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @('chengye_postgres_data'); StdErr = @() }
        }
        if ($shape -contains 'psql') {
            $countShapeMatches = $shape.Count -eq $expectedCountArguments.Count
            if ($countShapeMatches) {
                for ($tokenIndex = 0; $tokenIndex -lt $expectedCountArguments.Count; $tokenIndex++) {
                    if ([string]$shape[$tokenIndex] -cne [string]$expectedCountArguments[$tokenIndex]) {
                        $countShapeMatches = $false
                        break
                    }
                }
            }
            if (-not $countShapeMatches) {
                $countContractRejected++
                return [pscustomobject]@{ ExitCode = 98; StdOut = @(); StdErr = @('reset-count-sensitive-marker') }
            }
            if ($Scenario -ceq 'CountFailure') {
                return [pscustomobject]@{ ExitCode = 9; StdOut = @(); StdErr = @('reset-count-sensitive-marker') }
            }
            if ($Scenario -ceq 'CountEmpty') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @() }
            }
            if ($Scenario -ceq 'CountMalformed') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('not-an-integer'); StdErr = @() }
            }
            if ($Scenario -ceq 'CountMultiline') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('0', '0'); StdErr = @() }
            }
            if ($Scenario -ceq 'CountSigned') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('+0'); StdErr = @() }
            }
            if ($Scenario -ceq 'CountWhitespace') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @(' 0'); StdErr = @() }
            }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @([string]$DatabaseState.TableCount); StdErr = @() }
        }
        if ($shape.Count -ge 2 -and $shape[-2] -ceq 'down' -and $shape[-1] -ceq '--volumes') {
            $downExitCode = $(if ($Scenario -ceq 'DownFailure') { 8 } else { 0 })
            if ($downExitCode -eq 0) {
                $DatabaseState.TableCount = 0L
                $DatabaseState.SchemaComplete = $false
                $DatabaseState.ApplicationRows = 0L
            }
            return [pscustomobject]@{
                ExitCode = $downExitCode
                StdOut = @()
                StdErr = @('reset-down-sensitive-marker')
            }
        }
        if ($shape.Count -ge 2 -and $shape[-2] -ceq 'up' -and $shape[-1] -ceq '-d') {
            $upCallCount = @($calls | Where-Object {
                $_.Arguments.Count -ge 2 -and $_.Arguments[-2] -ceq 'up' -and $_.Arguments[-1] -ceq '-d'
            }).Count
            return [pscustomobject]@{
                ExitCode = $(if (($Scenario -ceq 'BaselineStartFailure' -and $upCallCount -eq 1) -or
                    ($Scenario -ceq 'UpFailure' -and $upCallCount -eq 2)) { 7 } else { 0 })
                StdOut = @()
                StdErr = @('reset-up-sensitive-marker')
            }
        }
        if ($shape -contains 'pg_isready') {
            if ($Scenario -ceq 'HealthSlowFailure') {
                if ($null -eq $healthTiming.Watch) { $healthTiming.Watch = [System.Diagnostics.Stopwatch]::StartNew() }
                $slowHealthSleep = [math]::Min(100, [math]::Max(1, $TimeoutMilliseconds))
                [void]$slowHealthSleepRequests.Add($slowHealthSleep)
                Start-Sleep -Milliseconds $slowHealthSleep
            }
            $healthCallCount = @($calls | Where-Object { $_.Arguments -contains 'pg_isready' }).Count
            if ($Scenario -in @('HealthConstantClock', 'HealthRegressingClock', 'HealthNoOpSleep') -and $healthCallCount -ge 20) {
                $clock.Fuse = $true
            }
            $resetIssued = @($calls | Where-Object {
                $_.Arguments.Count -ge 2 -and $_.Arguments[-2] -ceq 'down' -and $_.Arguments[-1] -ceq '--volumes'
            }).Count -gt 0
            $healthFails = $Scenario -in @(
                'HealthTimeout', 'HealthConstantClock', 'HealthRegressingClock', 'HealthNoOpSleep', 'HealthSlowFailure'
            )
            if ($Scenario -ceq 'BaselineHealthTimeout') { $healthFails = -not $resetIssued }
            if ($Scenario -in @('HealthTimeout', 'HealthSlowFailure')) { $healthFails = $resetIssued }
            return [pscustomobject]@{
                ExitCode = $(if ($healthFails) { 1 } else { 0 })
                StdOut = @()
                StdErr = @('reset-health-sensitive-marker')
            }
        }
        if ($FilePath -ceq 'npm.cmd' -and ($shape -join '|') -ceq 'run|db:assert-empty') {
            $assertCallCount = @($calls | Where-Object {
                $_.FilePath -ceq 'npm.cmd' -and (@($_.Arguments) -join '|') -ceq 'run|db:assert-empty'
            }).Count
            if ($Scenario -ceq 'AssertEmptyException') { throw 'initialization-sensitive-marker' }
            if ($Scenario -ceq 'ResumePostAssertException' -and $assertCallCount -eq 2) {
                throw 'initialization-sensitive-marker'
            }
            if ($Scenario -ceq 'AssertEmptyFailureWithRows') {
                $DatabaseState.ApplicationRows = 1L
            }
            $assertFailed = $Scenario -in @('AssertEmptyFailure', 'AssertEmptyFailureWithRows') -or
                ($Scenario -ceq 'ResumePostAssertFailure' -and $assertCallCount -eq 2) -or
                -not $DatabaseState.SchemaComplete -or
                $DatabaseState.ApplicationRows -ne 0
            return [pscustomobject]@{
                ExitCode = $(if ($assertFailed) { 11 } else { 0 })
                StdOut = @('initialization-sensitive-marker')
                StdErr = @('initialization-sensitive-marker')
            }
        }
        if ($FilePath -ceq 'npm.cmd' -and ($shape -join '|') -ceq 'run|db:deploy') {
            if ($Scenario -in @('DeployException', 'ResumeDeployException')) { throw 'initialization-sensitive-marker' }
            $deployFailed = $Scenario -in @('DeployFailure', 'ResumeDeployFailure')
            if (-not $deployFailed) {
                $DatabaseState.TableCount = 2L
                $DatabaseState.SchemaComplete = $true
            }
            return [pscustomobject]@{
                ExitCode = $(if ($deployFailed) { 12 } else { 0 })
                StdOut = @('initialization-sensitive-marker')
                StdErr = @('initialization-sensitive-marker')
            }
        }
        if ($FilePath -ceq 'npm.cmd' -and ($shape -join '|') -ceq 'run|check:bootstrap') {
            if ($Scenario -ceq 'ContractException') { throw 'initialization-sensitive-marker' }
            return [pscustomobject]@{
                ExitCode = $(if ($Scenario -ceq 'ContractFailure') { 13 } else { 0 })
                StdOut = @('initialization-sensitive-marker')
                StdErr = @('initialization-sensitive-marker')
            }
        }
        return [pscustomobject]@{ ExitCode = 99; StdOut = @(); StdErr = @('reset-unexpected-sensitive-marker') }
    }.GetNewClosure()
    $inheritedConsoleOperation = {
        param(
            [string]$FilePath,
            [string[]]$Arguments,
            [string]$WorkingDirectory,
            [bool]$InheritStandardInput,
            [bool]$InheritStandardOutput,
            [bool]$InheritStandardError,
            [bool]$WaitingRecordEmitted
        )

        [void]$calls.Add([pscustomobject]@{
            FilePath = $FilePath
            Arguments = @($Arguments)
            WorkingDirectory = $WorkingDirectory
            InheritStandardInput = $InheritStandardInput
            InheritStandardOutput = $InheritStandardOutput
            InheritStandardError = $InheritStandardError
            WaitingRecordEmitted = $WaitingRecordEmitted
        })
        if ($Scenario -ceq 'BootstrapException') { throw 'initialization-sensitive-marker' }
        if ($Scenario -ceq 'BootstrapFailureWithRows') {
            $DatabaseState.ApplicationRows = 1L
        }
        return [int]$(if ($Scenario -in @('BootstrapFailure', 'BootstrapFailureWithRows')) { 14 } else { 0 })
    }.GetNewClosure()
    $operations = @{
        Native = $nativeOperation
        InheritedConsole = $inheritedConsoleOperation
        UtcNow = {
            $clock.Calls++
            if ($clock.Fuse) { return $clock.Value.AddSeconds(121) }
            if ($Scenario -ceq 'HealthRegressingClock') { return $clock.Value.AddSeconds(-1 * $clock.Calls) }
            if ($Scenario -ceq 'HealthNoOpSleep') { return $clock.Value.AddSeconds($clock.Calls) }
            return $clock.Value
        }.GetNewClosure()
        Sleep = {
            param([int]$Seconds)
            if ($Scenario -notin @('HealthConstantClock', 'HealthRegressingClock', 'HealthNoOpSleep')) {
                $clock.Value = $clock.Value.AddSeconds($Seconds)
            }
        }.GetNewClosure()
    }
    if ($Scenario -ceq 'NativeTerminationUnconfirmed') {
        $operations['TerminationState'] = { return $false }
    }
    if ($Scenario -ceq 'HealthSlowFailure') {
        $operations.Remove('Sleep')
        $operations['HealthBudgetMilliseconds'] = 250
        $operations['SleepMilliseconds'] = {
            param([int]$Milliseconds)
            [void]$sleepRequests.Add($Milliseconds)
            Start-Sleep -Milliseconds $Milliseconds
            $clock.Value = $clock.Value.AddMilliseconds($Milliseconds)
        }.GetNewClosure()
    }

    try {
        $env:LOCALAPPDATA = $localAppData
        foreach ($name in $allowedNames) {
            [Environment]::SetEnvironmentVariable($name, [string]$material[$name], 'Process')
        }
        if ($Scenario -ceq 'EnvironmentMismatch') {
            [Environment]::SetEnvironmentVariable($MismatchName, ('mismatch-' + $MismatchName), 'Process')
        }
        if ($Scenario -ceq 'WorkerEnabled') {
            [Environment]::SetEnvironmentVariable('EVENT_WORKER_ENABLED', 'true', 'Process')
        }

        if ($WithoutConfirmation) {
            $captured = @(& $initializerPath -TestOperations $operations *>&1)
        }
        else {
            $captured = @(& $initializerPath -ConfirmEmptyDatabaseReset -TestOperations $operations *>&1)
        }
        if ($null -ne $healthTiming.Watch -and $healthTiming.Watch.IsRunning) {
            $healthTiming.Watch.Stop()
            $healthTiming.ElapsedMilliseconds = [int]$healthTiming.Watch.ElapsedMilliseconds
        }
    }
    finally {
        $env:LOCALAPPDATA = $savedLocalAppData
        foreach ($name in $allowedNames) {
            [Environment]::SetEnvironmentVariable($name, $savedValues[$name], 'Process')
        }
    }

    if ($CallerDelayMilliseconds -gt 0) {
        Start-Sleep -Milliseconds $CallerDelayMilliseconds
    }

    $records = @($captured | Where-Object {
        $_ -is [System.Collections.IDictionary] -and $_.Contains('phase')
    })
    return [pscustomobject]@{
        Records = $records
        Captured = @($captured)
        Calls = @($calls)
        AdditionalStreamCount = $captured.Count - $records.Count
        Material = $material
        CanonicalComposePath = Get-TestResetCanonicalComposePath
        CountContractRejected = $countContractRejected
        SleepRequests = @($sleepRequests)
        SlowHealthSleepRequests = @($slowHealthSleepRequests)
        HealthElapsedMilliseconds = $healthTiming.ElapsedMilliseconds
    }
}

function Get-TestResetCallKind {
    param([object]$Call)

    $arguments = @($Call.Arguments)
    if ($arguments.Count -ge 2 -and $arguments[-2] -ceq 'config' -and $arguments[-1] -ceq '--services') { return 'services' }
    if ($arguments.Count -ge 2 -and $arguments[-2] -ceq 'config' -and $arguments[-1] -ceq '--volumes') { return 'volumes' }
    if ($arguments -contains 'psql') { return 'count' }
    if ($arguments.Count -ge 2 -and $arguments[-2] -ceq 'down' -and $arguments[-1] -ceq '--volumes') { return 'down' }
    if ($arguments.Count -ge 2 -and $arguments[-2] -ceq 'up' -and $arguments[-1] -ceq '-d') { return 'up' }
    if ($arguments -contains 'pg_isready') { return 'health' }
    if ($Call.FilePath -ceq 'npm.cmd' -and ($arguments -join '|') -ceq 'run|db:assert-empty') { return 'assert-empty' }
    if ($Call.FilePath -ceq 'npm.cmd' -and ($arguments -join '|') -ceq 'run|db:deploy') { return 'deploy' }
    if ($Call.FilePath -ceq 'npm.cmd' -and ($arguments -join '|') -ceq 'run|check:bootstrap') { return 'contract' }
    if ($Call.FilePath -ceq 'npm.cmd' -and $arguments -contains 'system:bootstrap') { return 'bootstrap' }
    return 'unexpected'
}

function Get-TestResetNativeFixture {
    $fixturePath = Join-Path $TestDrive ("local-preproduction-native-fixture-$PID.exe")
    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
        $source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

public static class LocalPreproductionNativeFixture
{
    public static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "hold")
        {
            using (FileStream stream = new FileStream(args[1], FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            {
                stream.WriteByte(1);
                stream.Flush(true);
                Thread.Sleep(30000);
            }
            return 0;
        }
        if (args.Length == 2 && args[0] == "hold-short")
        {
            using (FileStream stream = new FileStream(args[1], FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            {
                stream.WriteByte(1);
                stream.Flush(true);
                Thread.Sleep(3000);
            }
            return 0;
        }
        if (args.Length == 3 && args[0] == "tree")
        {
            using (FileStream stream = new FileStream(args[1], FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            {
                stream.WriteByte(1);
                stream.Flush(true);
                ProcessStartInfo child = new ProcessStartInfo();
                child.FileName = Process.GetCurrentProcess().MainModule.FileName;
                child.Arguments = "hold-short \"" + args[2].Replace("\"", "\\\"") + "\"";
                child.UseShellExecute = false;
                child.CreateNoWindow = true;
                Process.Start(child);
                Thread.Sleep(30000);
            }
            return 0;
        }
        if (args.Length == 1 && args[0] == "hang")
        {
            Thread.Sleep(30000);
            return 0;
        }
        if (args.Length == 1 && (args[0] == "fill" || args[0] == "fill-delayed"))
        {
            if (args[0] == "fill-delayed") Thread.Sleep(3000);
            string block = new string('x', 8192);
            for (int i = 0; i < 1024; i++) Console.Out.Write(block);
            for (int i = 0; i < 1024; i++) Console.Error.Write(block);
            return 0;
        }
        if (args.Length > 0 && args[0] == "echo")
        {
            for (int i = 1; i < args.Length; i++)
            {
                Console.WriteLine("ARG:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(args[i])));
            }
            return 0;
        }
        return 9;
    }
}
'@
        Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $fixturePath -OutputType ConsoleApplication
    }
    return $fixturePath
}

function Get-TestResetExpectedCountArguments {
    param([Parameter(Mandatory)][string]$ComposePath)

    return @(
        'compose', '-p', 'chengyeoa-local-preproduction',
        '-f', $ComposePath,
        '-f', (Get-TestResetCanonicalOverridePath),
        'exec', '-T', 'postgres',
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-d', 'chengyeoa_preprod', '-U', 'chengyeoa_preprod', '-c',
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
    )
}

function Test-TestResetExactCountArguments {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$ComposePath
    )

    $expected = @(Get-TestResetExpectedCountArguments -ComposePath $ComposePath)
    if ($Arguments.Count -ne $expected.Count) { return $false }
    for ($index = 0; $index -lt $expected.Count; $index++) {
        if ([string]$Arguments[$index] -cne [string]$expected[$index]) { return $false }
    }
    return $true
}

function Test-TestResetFileUnlocked {
    param([Parameter(Mandatory)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) { return $false }
    try {
        $stream = [System.IO.File]::Open(
            $LiteralPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $stream.Dispose()
        return $true
    }
    catch {
        return $false
    }
}

function Test-TestResetFileNotHeld {
    param([Parameter(Mandatory)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) { return $true }
    return Test-TestResetFileUnlocked -LiteralPath $LiteralPath
}

function Stop-TestResetNativeFixtureProcesses {
    param([Parameter(Mandatory)][string]$LiteralPath)

    $expectedPath = [System.IO.Path]::GetFullPath($LiteralPath)
    $fixtureProcessName = [System.IO.Path]::GetFileNameWithoutExtension($expectedPath)
    foreach ($candidate in @(Get-Process -Name $fixtureProcessName -ErrorAction SilentlyContinue)) {
        try {
            if ($candidate.Id -ne $PID -and
                ($null -eq $candidate.Path -or [string]$candidate.Path -ceq $expectedPath)) {
                $candidate | Stop-Process -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
            continue
        }
    }
    $deadline = [System.Diagnostics.Stopwatch]::StartNew()
    while ($deadline.ElapsedMilliseconds -lt 2000 -and -not (Test-TestResetFileUnlocked -LiteralPath $expectedPath)) {
        Start-Sleep -Milliseconds 10
    }
    $deadline.Stop()
}

Describe 'Local preproduction process-scoped loader' {
    # Mutation caught: any normal, nonzero, or exceptional child path omits or repeats disposal.
    It 'disposes each loader child process exactly once across all completion paths' {
        $sandbox = [pscustomobject]@{
            ScriptRoot = $TestDrive
            LoaderPath = (Join-Path $TestDrive 'unused-loader.ps1')
            LocalAppData = $TestDrive
            InitialPath = $TestDrive
            FakeNpxRoot = $TestDrive
        }
        $scenarios = @(
            [pscustomobject]@{ ExitCode = 0; StandardOutput = '{}'; ThrowOnWait = $false; ExpectThrow = $false },
            [pscustomobject]@{ ExitCode = 9; StandardOutput = ''; ThrowOnWait = $false; ExpectThrow = $false },
            [pscustomobject]@{ ExitCode = 0; StandardOutput = '{}'; ThrowOnWait = $true; ExpectThrow = $true }
        )
        $verified = 0

        foreach ($scenario in $scenarios) {
            $probe = New-TestLoaderProcessProbe `
                -ExitCode $scenario.ExitCode `
                -StandardOutput $scenario.StandardOutput `
                -ThrowOnWait:$scenario.ThrowOnWait
            $factory = { $probe.Process }.GetNewClosure()
            $threw = $false
            try {
                Invoke-TestLoaderChild -Sandbox $sandbox -TestProcessFactory $factory | Out-Null
            }
            catch {
                $threw = $true
            }
            if ($threw -eq $scenario.ExpectThrow -and $probe.State.DisposeCount -eq 1) {
                $verified++
            }
        }

        $verified | Should Be $scenarios.Count
    }

    # Mutation caught: rollback failure supersedes a failed committed toolchain recheck with readiness one.
    It 'reports toolchain not ready when post-commit mismatch rollback also fails' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'combined-toolchain-rollback-failure')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox `
            -InjectionMode PostCommitNpmMismatchRollbackFailure `
            -RollbackFailureIndex 2

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.postProbeMutationInjected | Should Be $true
        $result.rollbackFailureInjected | Should Be $true
        $result.rollbackCalls | Should Be 17
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'ENVIRONMENT_ROLLBACK_FAILED') | Should Be $true
        $result.record.boundedCounts.toolchainReady | Should Be 0
        $result.unchanged | Should Be $false
    }

    # Mutation caught: pre-probed commands are replaced, fail, or change output after PATH commit without a runtime recheck.
    It 'rolls back post-commit tool replacement launch and version failures' {
        $modes = @(
            'PostCommitNodeReplacement', 'PostCommitNodeMismatch',
            'PostCommitNpmMismatch', 'PostCommitNpmLaunchFailure'
        )
        $blockedCount = 0
        foreach ($mode in $modes) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive $mode)
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode $mode
            if ((Test-TestLoaderEnvelope -Result $result) -and
                $result.postProbeMutationInjected -and
                $result.record.status -ceq 'BLOCKED' -and
                $result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH' -and
                $result.unchanged) {
                $blockedCount++
            }
        }

        $blockedCount | Should Be $modes.Count
    }

    # Characterization: the PATH-first and explicit Worker-force commits both route through complete rollback.
    It 'rolls back failures at the first and final commit mutation positions' {
        $passedPositions = 0
        foreach ($position in @(1, 18)) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive ('commit-boundary-' + $position))
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode CommitBoundaryFailure -FailureIndex $position
            if ((Test-TestLoaderEnvelope -Result $result) -and
                $result.commitFailureInjected -and
                $result.commitCalls -eq $position -and
                $result.rollbackCalls -eq 17 -and
                $result.record.status -ceq 'BLOCKED' -and
                $result.record.alertCodes -contains 'ENVIRONMENT_IMPORT_FAILED' -and
                $result.unchanged) {
                $passedPositions++
            }
        }

        $passedPositions | Should Be 2
    }

    # Mutation caught: an exception from Task 1 validation escapes after PATH staging or produces no safe record.
    It 'maps an injected validation exception before any process mutation' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'injected-validation')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode ValidationException

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.validationInjected | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'ENVIRONMENT_VALIDATION_FAILED') | Should Be $true
        $result.unchanged | Should Be $true
    }

    # Mutation caught: a failed allow-listed assignment leaves earlier values or PATH committed.
    It 'rolls back the full snapshot after an injected commit failure' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'injected-commit')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode CommitFailure -FailureIndex 8

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.commitFailureInjected | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'ENVIRONMENT_IMPORT_FAILED') | Should Be $true
        $result.rollbackCalls | Should Be 17
        $result.unchanged | Should Be $true
    }

    # Mutation caught: one rollback exception short-circuits restoration of later variables and PATH.
    It 'continues every rollback attempt and classifies an injected persistent rollback failure' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'injected-rollback')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode RollbackFailure -FailureIndex 3 -RollbackFailureIndex 2

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.commitFailureInjected | Should Be $true
        $result.rollbackFailureInjected | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'ENVIRONMENT_ROLLBACK_FAILED') | Should Be $true
        $result.record.boundedCounts.toolchainReady | Should Be 1
        $result.rollbackCalls | Should Be 17
        $result.unchanged | Should Be $false
    }

    # Characterization: every allow-listed commit position enters the same complete rollback transaction.
    It 'restores the snapshot for an injected failure at every assignment position' {
        $passedPositions = 0
        foreach ($position in 1..16) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive ('assignment-' + $position))
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode CommitFailure -FailureIndex $position
            if ((Test-TestLoaderEnvelope -Result $result) -and
                $result.commitFailureInjected -and
                $result.assignmentCalls -eq $position -and
                $result.rollbackCalls -eq 17 -and
                $result.record.status -ceq 'BLOCKED' -and
                $result.record.alertCodes -contains 'ENVIRONMENT_IMPORT_FAILED' -and
                $result.unchanged) {
                $passedPositions++
            }
        }

        $passedPositions | Should Be 16
    }

    # Characterization: a persistent PATH restoration failure is classified after all rollback attempts.
    It 'classifies an injected PATH rollback persistence failure' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'path-rollback-failure')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode RollbackFailure -FailureIndex 3 -RollbackFailureIndex 17

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.rollbackFailureInjected | Should Be $true
        $result.rollbackCalls | Should Be 17
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'ENVIRONMENT_ROLLBACK_FAILED') | Should Be $true
        $result.unchanged | Should Be $false
    }

    # Characterization: record staging failure occurs before mutation and falls back to one safe result.
    It 'maps an injected staged record failure before commit' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'record-failure')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode RecordFailure

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.recordFailureInjected | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'SAFE_RECORD_FAILED') | Should Be $true
        $result.unchanged | Should Be $true
    }

    # Characterization: either required module absence is contained by the same exact safe envelope.
    It 'maps both module import failures without mutation or extra streams' {
        $safeFailures = 0
        foreach ($moduleLeaf in @('ProductionRolloutRunner.Core.psm1', 'LocalPreproduction.Core.psm1')) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive ('missing-' + $moduleLeaf.Replace('.', '-')))
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            Remove-Item -LiteralPath (Join-Path $sandbox.ScriptRoot $moduleLeaf) -Force
            $result = Invoke-TestLoaderChild -Sandbox $sandbox
            if ((Test-TestLoaderEnvelope -Result $result) -and
                $result.record.status -ceq 'BLOCKED' -and
                $result.record.alertCodes -contains 'MODULE_IMPORT_FAILED' -and
                $result.unchanged) {
                $safeFailures++
            }
        }

        $safeFailures | Should Be 2
    }

    # Characterization: the first Worker assignment is corrupted, so only the explicit final force can restore false.
    It 'forces Worker false after an observable conflicting assignment' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'worker-force')
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox -InjectionMode WorkerConflict

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.workerConflictInjected | Should Be $true
        $result.workerSetCalls | Should Be 2
        $result.record.status | Should Be 'READY'
        @($result.record.alertCodes).Count | Should Be 0
        $result.workerDisabled | Should Be $true
        $result.allMatched | Should Be $true
    }

    # Mutation caught: permissive resolver parsing or an unrelated reported leaf can borrow name-based pinned tools.
    It 'blocks non-exact resolver schema and unrelated reported Node leaves' {
        $allBlocked = $true
        foreach ($mode in @('ExtraResolverField', 'UnrelatedNodeLeaf')) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive $mode) -ToolchainMode $mode
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            $result = Invoke-TestLoaderChild -Sandbox $sandbox
            if ($result.record.status -cne 'BLOCKED' -or
                $result.record.alertCodes -notcontains 'TOOLCHAIN_VERSION_MISMATCH' -or
                -not $result.unchanged -or
                -not (Test-TestLoaderEnvelope -Result $result)) {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: malformed provenance, ambiguous npx, unsafe PATH syntax, fallback, or shadowing reaches READY.
    It 'fails closed across the resolver and executable provenance matrix' {
        $modes = @(
            'MissingResolverField', 'WrongResolverType', 'MalformedResolver', 'MultilineResolver',
            'RelativeChildPath', 'QuotedChildPath', 'EmptyChildPathSegment', 'MissingNodeLeaf',
            'MultipleNpx', 'AmbientFallback', 'ShadowNpmInNodeDirectory'
        )
        $blockedCount = 0
        foreach ($mode in $modes) {
            $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive ('provenance-' + $mode)) -ToolchainMode $mode
            New-TestLoaderBundle -Sandbox $sandbox | Out-Null
            $result = Invoke-TestLoaderChild -Sandbox $sandbox
            if ($result.record.status -ceq 'BLOCKED' -and
                $result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH' -and
                $result.unchanged -and
                (Test-TestLoaderEnvelope -Result $result)) {
                $blockedCount++
            }
        }

        $blockedCount | Should Be $modes.Count
    }

    # Mutation caught: a missing fixed bundle reaches import or exposes a raw filesystem failure.
    It 'blocks a missing bundle without mutating process state' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'missing-bundle')

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        ($null -ne $result) | Should Be $true
        $result.outputCount | Should Be 1
        $result.record.phase | Should Be 'local_preproduction_environment_load'
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'SECRET_BUNDLE_MISSING') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: unprotection detail or invalid storage text escapes instead of the stable loader alert.
    It 'blocks invalid ciphertext without mutation or unsafe output' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'invalid-ciphertext')
        New-TestLoaderBundle -Sandbox $sandbox -Mode InvalidCiphertext

        $result = Invoke-TestLoaderChild -Sandbox $sandbox
        $serialized = $result | ConvertTo-Json -Depth 10 -Compress

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.outputCount | Should Be 1
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'SECRET_BUNDLE_INVALID') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
        $serialized.Contains('invalid-ciphertext-marker') | Should Be $false
        ($serialized -match '(?i)stack|exception') | Should Be $false
    }

    # Mutation caught: any allow-listed value is skipped, assigned outside Process scope, or PATH is built from ambient tools.
    It 'imports all sixteen values only in the child and pins only resolved directories' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'valid-load')
        $material = New-TestLoaderBundle -Sandbox $sandbox
        $parentPathBefore = $env:PATH
        $parentValuesBefore = @{}
        foreach ($name in (Get-TestLoaderAllowedNames)) {
            $parentValuesBefore[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        }

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $parentUnchanged = $env:PATH -ceq $parentPathBefore
        foreach ($name in (Get-TestLoaderAllowedNames)) {
            if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $parentValuesBefore[$name]) {
                $parentUnchanged = $false
            }
        }
        $result.outputCount | Should Be 1
        $result.record.status | Should Be 'READY'
        @($result.record.alertCodes).Count | Should Be 0
        $result.record.boundedCounts.environmentImported | Should Be 16
        $result.record.boundedCounts.toolchainReady | Should Be 1
        $result.allMatched | Should Be $true
        $result.workerDisabled | Should Be $true
        $result.pathPinned | Should Be $true
        $result.scopeUnchanged | Should Be $true
        $parentUnchanged | Should Be $true
    }

    # Mutation caught: an unrelated nonexistent inherited PATH entry blocks an otherwise unique exact toolchain.
    It 'ignores nonexistent inherited child PATH entries when exact pinned tools remain unique' {
        $sandbox = New-TestLoaderSandbox `
            -Root (Join-Path $TestDrive 'missing-inherited-directory') `
            -ToolchainMode MissingInheritedDirectory
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'READY'
        @($result.record.alertCodes).Count | Should Be 0
        $result.record.boundedCounts.environmentImported | Should Be 16
        $result.record.boundedCounts.toolchainReady | Should Be 1
        $result.allMatched | Should Be $true
        $result.workerDisabled | Should Be $true
        $result.pathPinned | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: an existing non-directory PATH entry is treated like a harmless nonexistent entry.
    It 'blocks an existing file in the child PATH without partial mutation' {
        $sandbox = New-TestLoaderSandbox `
            -Root (Join-Path $TestDrive 'existing-file-child-path') `
            -ToolchainMode ExistingFileChildPath
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Characterization: duplicate canonical entries remain ambiguous even when the target does not exist.
    It 'blocks duplicate nonexistent absolute child PATH entries' {
        $sandbox = New-TestLoaderSandbox `
            -Root (Join-Path $TestDrive 'duplicate-missing-child-path') `
            -ToolchainMode DuplicateMissingInheritedDirectory
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: a different Node or npm version is accepted or PATH/environment mutates before the exact recheck.
    It 'blocks an exact version mismatch without partial mutation' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'version-mismatch') -ToolchainMode VersionMismatch
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: choosing the first npm.cmd silently accepts an ambiguous child PATH.
    It 'blocks more than one npm location without partial mutation' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'ambiguous-npm') -ToolchainMode AmbiguousNpm
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: resolver launch errors or stderr cross the loader boundary.
    It 'maps resolver launch failure to the stable toolchain alert without leakage' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'resolver-failure') -ToolchainMode ResolverLaunchFailure
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox
        $serialized = $result | ConvertTo-Json -Depth 10 -Compress

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
        $serialized.Contains('resolver-failure-marker') | Should Be $false
    }

    # Mutation caught: absence falls back to an ambient Node/npm pair rather than failing closed.
    It 'does not fall back when npx is absent' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'missing-npx') -ToolchainMode MissingNpx
        New-TestLoaderBundle -Sandbox $sandbox | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'TOOLCHAIN_VERSION_MISMATCH') | Should Be $true
        $result.unchanged | Should Be $true
    }

    # Mutation caught: values are imported before exact Task 1 validation succeeds.
    It 'blocks validation failure without partial mutation' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'validation-failure')
        New-TestLoaderBundle -Sandbox $sandbox -Mode InvalidEnvironment | Out-Null

        $result = Invoke-TestLoaderChild -Sandbox $sandbox

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.record.status | Should Be 'BLOCKED'
        ($result.record.alertCodes -contains 'NODE_ENV_NOT_PRODUCTION') | Should Be $true
        $result.unchanged | Should Be $true
        $result.scopeUnchanged | Should Be $true
    }

    # Mutation caught: success adds unsafe record fields or serializes a value, executable/storage path, raw version, address, or identifier.
    It 'emits exactly one safe record without path value or identifier leakage' {
        $sandbox = New-TestLoaderSandbox -Root (Join-Path $TestDrive 'safe-output')
        $material = New-TestLoaderBundle -Sandbox $sandbox

        $result = Invoke-TestLoaderChild -Sandbox $sandbox
        $recordJson = $result.record | ConvertTo-Json -Depth 10 -Compress
        $keys = @($result.record.PSObject.Properties.Name | Sort-Object)
        $recordTextValues = @(
            [string]$result.record.phase,
            [string]$result.record.status,
            [string]$result.record.utcStart,
            [string]$result.record.utcEnd
        ) + @($result.record.alertCodes | ForEach-Object { [string]$_ })
        $containsExactValue = $false
        foreach ($value in $material.Values) {
            if (-not [string]::IsNullOrEmpty([string]$value) -and $recordTextValues -ccontains [string]$value) {
                $containsExactValue = $true
            }
        }
        $containsSensitiveValue = $false
        foreach ($name in @(
            'POSTGRES_PASSWORD', 'POSTGRES_TEST_PASSWORD', 'DATABASE_URL',
            'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS', 'MFA_ENCRYPTION_KEY_V1'
        )) {
            if ($recordJson.Contains([string]$material[$name])) {
                $containsSensitiveValue = $true
            }
        }

        (Test-TestLoaderEnvelope -Result $result) | Should Be $true
        $result.outputCount | Should Be 1
        ($keys -join ',') | Should Be 'alertCodes,boundedCounts,elapsedSeconds,phase,status,utcEnd,utcStart'
        $containsExactValue | Should Be $false
        $containsSensitiveValue | Should Be $false
        $recordJson.Contains($sandbox.ScriptRoot) | Should Be $false
        $recordJson.Contains($sandbox.LocalAppData) | Should Be $false
        $recordJson.Contains($sandbox.FakeNodeRoot) | Should Be $false
        $recordJson.Contains($sandbox.FakeNpmRoot) | Should Be $false
        ($recordJson -match '(?i)postgres(?:ql)?://|stack|exception|v22\.14\.0|10\.9\.2|(?:host|process|container|worker|lock)(?:id|identifier|owner)') | Should Be $false
    }
}

Describe 'Task 1 fixed isolated Compose target contract' -Tags 'ComposeIsolationTask1' {
    # Mutation caught: omitting the project or either fixed file lets metadata resolve the default Compose target.
    It 'resolves the fixed identity and uses its exact prefix for both metadata calls' {
        Import-Module $corePath -Force -ErrorAction Stop
        $composePath = Get-TestResetCanonicalComposePath
        $overridePath = Get-TestResetCanonicalOverridePath
        $calls = New-Object System.Collections.ArrayList
        $native = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            [void]$calls.Add(@($Arguments))
            $output = if ($Arguments[-1] -ceq '--services') { @('postgres') } else { @('chengye_postgres_data') }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @($output); StdErr = @() }
        }.GetNewClosure()

        $target = Get-LocalPreproductionComposeTarget -ComposePath $composePath -TestOperation $native
        $expectedServices = @(
            'compose', '-p', 'chengyeoa-local-preproduction',
            '-f', $composePath, '-f', $overridePath,
            'config', '--services'
        )
        $expectedVolumes = @(
            'compose', '-p', 'chengyeoa-local-preproduction',
            '-f', $composePath, '-f', $overridePath,
            'config', '--volumes'
        )

        $target.ProjectName | Should Be 'chengyeoa-local-preproduction'
        @($target.ComposeFiles).Count | Should Be 2
        ([string]$target.ComposeFiles[0]).Equals($composePath, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
        ([string]$target.ComposeFiles[1]).Equals($overridePath, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
        $target.ServiceCount | Should Be 1
        $target.VolumeCount | Should Be 1
        $calls.Count | Should Be 2
        (@($calls[0]) -join '|') | Should Be ($expectedServices -join '|')
        (@($calls[1]) -join '|') | Should Be ($expectedVolumes -join '|')
    }

    # Mutation caught: a caller rewrites the validated project or file list after metadata and before an operation.
    It 'returns a target whose fixed identity cannot be mutated by a caller' {
        Import-Module $corePath -Force -ErrorAction Stop
        $composePath = Get-TestResetCanonicalComposePath
        $native = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            $output = if ($Arguments[-1] -ceq '--services') { @('postgres') } else { @('chengye_postgres_data') }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @($output); StdErr = @() }
        }
        $target = Get-LocalPreproductionComposeTarget -ComposePath $composePath -TestOperation $native

        $projectWrite = Get-TestWorkflowFailureCode { $target.ProjectName = 'altered-project' }.GetNewClosure()
        $filesWrite = Get-TestWorkflowFailureCode { $target.ComposeFiles = @($composePath) }.GetNewClosure()
        $returnedFiles = @($target.ComposeFiles)
        $returnedFiles[0] = 'altered-file'

        ($projectWrite -cne 'NO_FAILURE') | Should Be $true
        ($filesWrite -cne 'NO_FAILURE') | Should Be $true
        $target.ProjectName | Should Be 'chengyeoa-local-preproduction'
        ([string]$target.ComposeFiles[0]).Equals($composePath, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
    }

    # Mutation caught: caller-controlled identity or a second identity option can escape the fixed target prefix.
    It 'builds one fixed prefix rejects altered targets and preserves ordinary tail values' {
        Import-Module $corePath -Force -ErrorAction Stop
        $composePath = Get-TestResetCanonicalComposePath
        $overridePath = Get-TestResetCanonicalOverridePath
        $target = [pscustomobject][ordered]@{
            ProjectName = 'chengyeoa-local-preproduction'
            ComposeFiles = @($composePath, $overridePath)
            ServiceCount = 1
            VolumeCount = 1
        }
        $arguments = New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('up', '-d')
        $expected = @(
            'compose', '-p', 'chengyeoa-local-preproduction',
            '-f', $composePath, '-f', $overridePath,
            'up', '-d'
        )
        $invalidTargets = @(
            $null,
            ([pscustomobject]@{ ProjectName = 'altered-project'; ComposeFiles = @($composePath, $overridePath) }),
            ([pscustomobject]@{ ProjectName = 'chengyeoa-local-preproduction'; ComposeFiles = @($composePath) }),
            ([pscustomobject]@{ ProjectName = 'chengyeoa-local-preproduction'; ComposeFiles = @($composePath, $composePath) })
        )
        $invalidTargetCodes = @(for ($targetIndex = 0; $targetIndex -lt $invalidTargets.Count; $targetIndex++) {
            $candidate = $invalidTargets[$targetIndex]
            Get-TestWorkflowFailureCode {
                New-LocalPreproductionComposeArguments -Target $candidate -CommandArguments @('up', '-d') | Out-Null
            }.GetNewClosure()
        })
        $ordinaryTail = [string[]]@(
            'exec', '-T', 'postgres', 'tool',
            'ordinary-pvalue', 'ordinary-fvalue',
            'ordinary--project-name=value', 'ordinary--file=value'
        )
        $ordinaryArguments = New-LocalPreproductionComposeArguments -Target $target -CommandArguments $ordinaryTail
        $expectedOrdinaryArguments = @(
            'compose', '-p', 'chengyeoa-local-preproduction',
            '-f', $composePath, '-f', $overridePath
        ) + $ordinaryTail

        ($arguments -join '|') | Should Be ($expected -join '|')
        $invalidTargetCodes.Count | Should Be $invalidTargets.Count
        @($invalidTargetCodes | Where-Object { $_ -cne 'COMPOSE_TARGET_INVALID' }).Count | Should Be 0
        ($ordinaryArguments -join '|') | Should Be ($expectedOrdinaryArguments -join '|')
    }

    # Mutation caught: compact or differently cased identity options bypass the fixed-prefix tail guard.
    It 'rejects all ten project and file option spellings with ordinal case-insensitive comparison' {
        Import-Module $corePath -Force -ErrorAction Stop
        $composePath = Get-TestResetCanonicalComposePath
        $overridePath = Get-TestResetCanonicalOverridePath
        $target = [pscustomobject][ordered]@{
            ProjectName = 'chengyeoa-local-preproduction'
            ComposeFiles = @($composePath, $overridePath)
            ServiceCount = 1
            VolumeCount = 1
        }
        $tailFixtures = @(
            [pscustomobject]@{ Arguments = [string[]]@('-p', 'altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-paltered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-p=altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--project-name', 'altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--project-name=altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-f', $composePath, 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-f' + $composePath, 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-f=' + $composePath, 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--file', $composePath, 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--file=' + $composePath, 'up') }
        )
        $tailCodes = @($tailFixtures | ForEach-Object {
            $tail = [string[]]$_.Arguments
            Get-TestWorkflowFailureCode {
                New-LocalPreproductionComposeArguments -Target $target -CommandArguments $tail | Out-Null
            }.GetNewClosure()
        })
        $caseInsensitiveFixtures = @(
            [pscustomobject]@{ Arguments = [string[]]@('-P', 'altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-PALTERED-PROJECT', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--PROJECT-NAME=altered-project', 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('-F=' + $composePath, 'up') },
            [pscustomobject]@{ Arguments = [string[]]@('--FILE', $composePath, 'up') }
        )
        $caseInsensitiveCodes = @($caseInsensitiveFixtures | ForEach-Object {
            $tail = [string[]]$_.Arguments
            Get-TestWorkflowFailureCode {
                New-LocalPreproductionComposeArguments -Target $target -CommandArguments $tail | Out-Null
            }.GetNewClosure()
        })

        $tailCodes.Count | Should Be 10
        @($tailCodes | Where-Object { $_ -cne 'COMPOSE_TARGET_INVALID' }).Count | Should Be 0
        $caseInsensitiveCodes.Count | Should Be $caseInsensitiveFixtures.Count
        @($caseInsensitiveCodes | Where-Object { $_ -cne 'COMPOSE_TARGET_INVALID' }).Count | Should Be 0
    }

    # Mutation caught: target resolution continues to metadata when the fixed override is absent.
    It 'rejects a missing fixed override before metadata' {
        $repositoryRoot = Join-Path $TestDrive 'missing-override-repository'
        $scriptRoot = Join-Path $repositoryRoot '.codex-safe'
        $composeDirectory = Join-Path $repositoryRoot 'LayerManage\law-firm-system\infra\postgres'
        New-Item -ItemType Directory -Path $scriptRoot, $composeDirectory -Force | Out-Null
        Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $scriptRoot 'ProductionRolloutRunner.Core.psm1')
        Copy-Item -LiteralPath $corePath -Destination (Join-Path $scriptRoot 'LocalPreproduction.Core.psm1')
        $composePath = Join-Path $composeDirectory 'compose.yml'
        [System.IO.File]::WriteAllText($composePath, 'services: {}', [System.Text.Encoding]::UTF8)
        $metadataCalls = 0
        $native = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            $metadataCalls++
            $output = if ($Arguments[-1] -ceq '--services') { @('postgres') } else { @('chengye_postgres_data') }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @($output); StdErr = @() }
        }.GetNewClosure()
        $module = Import-Module (Join-Path $scriptRoot 'LocalPreproduction.Core.psm1') -Force -PassThru

        $code = Get-TestWorkflowFailureCode {
            & $module {
                param([string]$ComposePath, [scriptblock]$Native)
                Get-LocalPreproductionComposeTarget -ComposePath $ComposePath -TestOperation $Native | Out-Null
            } $composePath $native
        }.GetNewClosure()
        Import-Module $corePath -Force -ErrorAction Stop

        $code | Should Be 'COMPOSE_TARGET_INVALID'
        $metadataCalls | Should Be 0
    }

    # Mutation caught: a reparse target at the fixed override location is trusted as an ordinary file.
    It 'rejects a reparse override target before metadata' {
        $repositoryRoot = Join-Path $TestDrive 'reparse-override-repository'
        $scriptRoot = Join-Path $repositoryRoot '.codex-safe'
        $composeDirectory = Join-Path $repositoryRoot 'LayerManage\law-firm-system\infra\postgres'
        $outsideOverride = Join-Path $TestDrive 'reparse-override-outside'
        New-Item -ItemType Directory -Path $scriptRoot, $composeDirectory, $outsideOverride -Force | Out-Null
        Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $scriptRoot 'ProductionRolloutRunner.Core.psm1')
        Copy-Item -LiteralPath $corePath -Destination (Join-Path $scriptRoot 'LocalPreproduction.Core.psm1')
        New-Item -ItemType Junction -Path (Join-Path $scriptRoot 'local-preproduction.compose.override.yml') -Target $outsideOverride | Out-Null
        $composePath = Join-Path $composeDirectory 'compose.yml'
        [System.IO.File]::WriteAllText($composePath, 'services: {}', [System.Text.Encoding]::UTF8)
        $metadataCalls = 0
        $native = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            $metadataCalls++
            $output = if ($Arguments[-1] -ceq '--services') { @('postgres') } else { @('chengye_postgres_data') }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @($output); StdErr = @() }
        }.GetNewClosure()
        $module = Import-Module (Join-Path $scriptRoot 'LocalPreproduction.Core.psm1') -Force -PassThru

        $code = Get-TestWorkflowFailureCode {
            & $module {
                param([string]$ComposePath, [scriptblock]$Native)
                Get-LocalPreproductionComposeTarget -ComposePath $ComposePath -TestOperation $Native | Out-Null
            } $composePath $native
        }.GetNewClosure()
        Import-Module $corePath -Force -ErrorAction Stop

        $code | Should Be 'COMPOSE_TARGET_INVALID'
        $metadataCalls | Should Be 0
    }

    # Mutation caught: one initializer call falls back to a base-only or default-project Compose invocation.
    It 'routes every initializer Compose call through the fixed isolated prefix' {
        $result = Invoke-TestResetScenario
        $overridePath = Get-TestResetCanonicalOverridePath
        $composeCalls = @($result.Calls | Where-Object { $_.FilePath -ceq 'docker' })
        $prefixedCalls = @($composeCalls | Where-Object {
            Test-TestResetExactComposePrefix `
                -Arguments ([string[]]$_.Arguments) `
                -ComposePath $result.CanonicalComposePath `
                -OverridePath $overridePath
        })

        ($composeCalls.Count -gt 0) | Should Be $true
        $prefixedCalls.Count | Should Be $composeCalls.Count
    }
}

Describe 'Task 2 isolated baseline empty proof and scoped reset' -Tags 'ComposeIsolationTask2' {
    # Mutation caught: first metadata execution or semantic failure still invokes the second metadata operation.
    It 'stops after exactly one services metadata call for every execution and semantic failure' {
        $fixtures = @(
            @{ Scenario = 'ServicesFailure'; Alert = 'COMPOSE_METADATA_FAILED' },
            @{ Scenario = 'ServicesMissing'; Alert = 'COMPOSE_TARGET_INVALID' },
            @{ Scenario = 'ServicesExtra'; Alert = 'COMPOSE_TARGET_INVALID' },
            @{ Scenario = 'ServicesIncorrect'; Alert = 'COMPOSE_TARGET_INVALID' }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            if ($result.Records.Count -eq 1 -and
                $result.Records[0].status -ceq 'BLOCKED' -and
                $result.Records[0].alertCodes.Count -eq 1 -and
                $result.Records[0].alertCodes[0] -ceq $fixture.Alert -and
                $result.AdditionalStreamCount -eq 0 -and
                $result.Calls.Count -eq 1 -and
                ($kinds -join ',') -ceq 'services') {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }

    # Mutation caught: second metadata execution or semantic failure reaches the baseline start.
    It 'stops after services and volumes metadata for every second-boundary failure' {
        $fixtures = @(
            @{ Scenario = 'VolumesFailure'; Alert = 'COMPOSE_METADATA_FAILED' },
            @{ Scenario = 'VolumesMissing'; Alert = 'COMPOSE_TARGET_INVALID' },
            @{ Scenario = 'VolumesExtra'; Alert = 'COMPOSE_TARGET_INVALID' },
            @{ Scenario = 'VolumesIncorrect'; Alert = 'COMPOSE_TARGET_INVALID' }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            if ($result.Records.Count -eq 1 -and
                $result.Records[0].status -ceq 'BLOCKED' -and
                $result.Records[0].alertCodes.Count -eq 1 -and
                $result.Records[0].alertCodes[0] -ceq $fixture.Alert -and
                $result.AdditionalStreamCount -eq 0 -and
                $result.Calls.Count -eq 2 -and
                ($kinds -join ',') -ceq 'services,volumes' -and
                @($kinds | Where-Object { $_ -in @('up', 'health', 'count', 'down', 'assert-empty', 'deploy', 'contract', 'bootstrap') }).Count -eq 0) {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }

    # Mutation caught: the table count or reset runs before the isolated baseline has started and passed health.
    It 'runs the successful fixture in the exact twelve-call order with three ordered readiness gates' {
        $result = Invoke-TestResetScenario
        $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
        $phases = @($result.Records | ForEach-Object { $_.phase })

        ($kinds -join ',') | Should Be 'services,volumes,up,health,count,down,up,health,deploy,assert-empty,contract,bootstrap'
        ($phases -join ',') | Should Be 'ISOLATED_BASELINE_READY,ISOLATED_DATABASE_EMPTY,DATABASE_READY,MIGRATED,DATABASE_ASSERT_EMPTY,BOOTSTRAP_CONTRACT_READY,WAITING_OPERATOR_SECRET_INPUT,ADMIN_BOOTSTRAPPED'
        $result.Records[0].status | Should Be 'READY'
        $result.Records[1].status | Should Be 'READY'
        $result.Records[2].status | Should Be 'READY'
    }

    # Mutation caught: a failed orchestration boundary is ignored and a later count, reset, restart, migration, or bootstrap call executes.
    It 'fails stop at baseline start health count reset restart and post-reset health boundaries' {
        $fixtures = @(
            @{ Scenario = 'BaselineStartFailure'; Alert = 'DATABASE_START_FAILED'; RequiredLast = 'up'; Forbidden = @('health', 'count', 'down', 'assert-empty', 'deploy', 'contract', 'bootstrap') },
            @{ Scenario = 'BaselineHealthTimeout'; Alert = 'DATABASE_HEALTH_TIMEOUT'; RequiredLast = 'health'; Forbidden = @('count', 'down', 'assert-empty', 'deploy', 'contract', 'bootstrap') },
            @{ Scenario = 'CountFailure'; Alert = 'DATABASE_EMPTY_CHECK_FAILED'; RequiredLast = 'count'; Forbidden = @('down', 'assert-empty', 'deploy', 'contract', 'bootstrap') },
            @{ Scenario = 'DownFailure'; Alert = 'DATABASE_RESET_FAILED'; RequiredLast = 'down'; Forbidden = @('assert-empty', 'deploy', 'contract', 'bootstrap') },
            @{ Scenario = 'UpFailure'; Alert = 'DATABASE_START_FAILED'; RequiredLast = 'up'; Forbidden = @('assert-empty', 'deploy', 'contract', 'bootstrap') },
            @{ Scenario = 'HealthTimeout'; Alert = 'DATABASE_HEALTH_TIMEOUT'; RequiredLast = 'health'; Forbidden = @('assert-empty', 'deploy', 'contract', 'bootstrap') }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $laterCalls = @($kinds | Where-Object { $_ -in $fixture.Forbidden }).Count
            if ($result.Records[-1].status -ceq 'BLOCKED' -and
                $result.Records[-1].alertCodes.Count -eq 1 -and
                $result.Records[-1].alertCodes[0] -ceq $fixture.Alert -and
                $kinds[-1] -ceq $fixture.RequiredLast -and
                $laterCalls -eq 0) {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }

    # Mutation caught: missing, multiline, signed, whitespace-polluted, noninteger, or nonzero count output authorizes deletion.
    It 'authorizes exactly one fixed-prefix down only for one exact unsigned zero line' {
        $blockedFixtures = @(
            'CountNonzero', 'CountEmpty', 'CountMalformed', 'CountMultiline',
            'CountSigned', 'CountWhitespace', 'CountFailure'
        )
        $blockedWithoutDestruction = 0
        foreach ($scenario in $blockedFixtures) {
            $result = Invoke-TestResetScenario -Scenario $scenario
            $downCalls = @($result.Calls | Where-Object { (Get-TestResetCallKind -Call $_) -ceq 'down' })
            if ($result.Records[-1].status -ceq 'BLOCKED' -and
                $downCalls.Count -eq 0 -and
                @($result.Records | Where-Object { $_.phase -ceq 'ISOLATED_DATABASE_EMPTY' }).Count -eq 0) {
                $blockedWithoutDestruction++
            }
        }
        $ready = Invoke-TestResetScenario
        $readyDown = @($ready.Calls | Where-Object { (Get-TestResetCallKind -Call $_) -ceq 'down' })
        $downExact = $readyDown.Count -eq 1 -and
            (Test-TestResetExactComposePrefix `
                -Arguments ([string[]]$readyDown[0].Arguments) `
                -ComposePath $ready.CanonicalComposePath `
                -OverridePath (Get-TestResetCanonicalOverridePath)) -and
            (@($readyDown[0].Arguments | Select-Object -Last 2) -join '|') -ceq 'down|--volumes'

        $blockedWithoutDestruction | Should Be $blockedFixtures.Count
        $downExact | Should Be $true
        @($ready.Records | Where-Object { $_.phase -ceq 'ISOLATED_DATABASE_EMPTY' }).Count | Should Be 1
    }
}

Describe 'Guarded empty PostgreSQL reinitialization' {
    # Mutation caught: native work, especially the destructive reset, runs before explicit confirmation.
    It 'blocks missing confirmation before every native operation' {
        $result = Invoke-TestResetScenario -WithoutConfirmation

        $result.Records.Count | Should Be 1
        $result.Records[0].status | Should Be 'BLOCKED'
        ($result.Records[0].alertCodes -contains 'DATABASE_RESET_CONFIRMATION_REQUIRED') | Should Be $true
        $result.Calls.Count | Should Be 0
    }

    # Mutations caught: lexical comparison accepts alternate/provider/relative targets, or a trusted segment can redirect physically.
    It 'rejects every noncanonical or physically redirected Compose target before metadata' {
        Import-Module $corePath -Force -ErrorAction Stop
        Get-Command Get-LocalPreproductionComposeTarget -CommandType Function -ErrorAction Stop | Out-Null
        $canonical = Get-TestResetCanonicalComposePath
        $outside = Join-Path $TestDrive 'alternate-compose.yml'
        [System.IO.File]::WriteAllText($outside, 'services: {}', [System.Text.Encoding]::UTF8)
        $metadataCalls = 0
        $native = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            $metadataCalls++
            return [pscustomobject]@{ ExitCode = 0; StdOut = @('postgres'); StdErr = @() }
        }.GetNewClosure()
        $rejected = 0
        foreach ($candidate in @(
            $outside,
            '.\LayerManage\law-firm-system\infra\postgres\compose.yml',
            ('FileSystem::' + $canonical),
            ($canonical + '.missing')
        )) {
            try {
                Get-LocalPreproductionComposeTarget -ComposePath $candidate -TestOperation $native | Out-Null
            }
            catch {
                $rejected++
            }
        }

        $sandboxRoot = Join-Path $TestDrive 'reparse-sandbox'
        $sandboxScriptRoot = Join-Path $sandboxRoot '.codex-safe'
        $outsideProject = Join-Path $TestDrive 'redirected-project'
        $outsideComposeDirectory = Join-Path $outsideProject 'infra\postgres'
        New-Item -ItemType Directory -Path $sandboxScriptRoot, $outsideComposeDirectory -Force | Out-Null
        Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $sandboxScriptRoot 'ProductionRolloutRunner.Core.psm1')
        Copy-Item -LiteralPath $corePath -Destination (Join-Path $sandboxScriptRoot 'LocalPreproduction.Core.psm1')
        [System.IO.File]::WriteAllText((Join-Path $outsideComposeDirectory 'compose.yml'), 'services: {}', [System.Text.Encoding]::UTF8)
        $layerRoot = Join-Path $sandboxRoot 'LayerManage'
        New-Item -ItemType Directory -Path $layerRoot -Force | Out-Null
        $junctionPath = Join-Path $layerRoot 'law-firm-system'
        New-Item -ItemType Junction -Path $junctionPath -Target $outsideProject | Out-Null
        $sandboxModule = Import-Module (Join-Path $sandboxScriptRoot 'LocalPreproduction.Core.psm1') -Force -PassThru
        $physicalRejected = $false
        try {
            & $sandboxModule {
                param([string]$ComposePath, [scriptblock]$Native)
                Get-LocalPreproductionComposeTarget -ComposePath $ComposePath -TestOperation $Native | Out-Null
            } (Join-Path $junctionPath 'infra\postgres\compose.yml') $native
        }
        catch {
            $physicalRejected = $true
        }
        finally {
            Import-Module $corePath -Force -ErrorAction Stop
        }

        $rejected | Should Be 4
        $physicalRejected | Should Be $true
        $metadataCalls | Should Be 0
    }

    # Mutations caught: loose parsing accepts extra/missing service or volume lines, or metadata uses any other command.
    It 'requires exact service and volume metadata using only the two config calls' {
        Import-Module $corePath -Force -ErrorAction Stop
        $canonical = Get-TestResetCanonicalComposePath
        $validCalls = New-Object System.Collections.ArrayList
        $validNative = {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            [void]$validCalls.Add(@($Arguments))
            if ($Arguments[-1] -ceq '--services') {
                return [pscustomobject]@{ ExitCode = 0; StdOut = @('postgres'); StdErr = @() }
            }
            return [pscustomobject]@{ ExitCode = 0; StdOut = @('chengye_postgres_data'); StdErr = @() }
        }.GetNewClosure()
        $target = Get-LocalPreproductionComposeTarget -ComposePath $canonical -TestOperation $validNative
        $override = Get-TestResetCanonicalOverridePath
        $validShape = $validCalls.Count -eq 2 -and
            (@($validCalls[0]) -join '|') -ceq ('compose|-p|chengyeoa-local-preproduction|-f|' + $canonical + '|-f|' + $override + '|config|--services') -and
            (@($validCalls[1]) -join '|') -ceq ('compose|-p|chengyeoa-local-preproduction|-f|' + $canonical + '|-f|' + $override + '|config|--volumes')

        $invalidFixtures = @(
            @{ Services = @('postgres', 'extra'); Volumes = @('chengye_postgres_data') },
            @{ Services = @('postgres'); Volumes = @('chengye_postgres_data', 'extra') },
            @{ Services = @('other'); Volumes = @('chengye_postgres_data') },
            @{ Services = @('postgres'); Volumes = @('other') },
            @{ Services = @(); Volumes = @('chengye_postgres_data') },
            @{ Services = @('postgres'); Volumes = @() }
        )
        $invalidRejected = 0
        foreach ($fixture in $invalidFixtures) {
            $fixtureCalls = 0
            $fixtureNative = {
                param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
                $fixtureCalls++
                $output = if ($Arguments[-1] -ceq '--services') { $fixture.Services } else { $fixture.Volumes }
                return [pscustomobject]@{ ExitCode = 0; StdOut = @($output); StdErr = @() }
            }.GetNewClosure()
            try {
                Get-LocalPreproductionComposeTarget -ComposePath $canonical -TestOperation $fixtureNative | Out-Null
            }
            catch {
                if ($fixtureCalls -le 2) { $invalidRejected++ }
            }
        }

        $target.ServiceCount | Should Be 1
        $target.VolumeCount | Should Be 1
        $validShape | Should Be $true
        $invalidRejected | Should Be $invalidFixtures.Count
    }

    # Mutations caught: the fixed bundle may be skipped, stale environment accepted, or Worker enabled during reset.
    It 'blocks missing invalid or nonmatching bundle state and enabled Worker before native work' {
        $fixtures = @(
            @{ Scenario = 'BundleMissing'; Alert = 'SECRET_BUNDLE_MISSING' },
            @{ Scenario = 'BundleInvalid'; Alert = 'SECRET_BUNDLE_INVALID' },
            @{ Scenario = 'EnvironmentMismatch'; Alert = 'ENVIRONMENT_BUNDLE_MISMATCH' },
            @{ Scenario = 'WorkerEnabled'; Alert = 'ENVIRONMENT_BUNDLE_MISMATCH' }
        )
        $blocked = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            if ($result.Records.Count -eq 1 -and
                $result.Records[-1].status -ceq 'BLOCKED' -and
                $result.Records[-1].alertCodes -contains $fixture.Alert -and
                $result.Calls.Count -eq 0) {
                $blocked++
            }
        }

        $blocked | Should Be $fixtures.Count
    }

    # Mutations caught: nonzero, malformed, or failed fixed SQL output can authorize reset.
    It 'distinguishes nonempty from malformed or failed table-count checks without destructive calls' {
        $fixtures = @(
            @{ Scenario = 'CountNonzero'; Alert = 'MIGRATED_RETRY_STATE_UNSAFE'; AssertCalls = 1 },
            @{ Scenario = 'CountEmpty'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' },
            @{ Scenario = 'CountMalformed'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' },
            @{ Scenario = 'CountMultiline'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' },
            @{ Scenario = 'CountSigned'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' },
            @{ Scenario = 'CountWhitespace'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' },
            @{ Scenario = 'CountFailure'; Alert = 'DATABASE_EMPTY_CHECK_FAILED' }
        )
        $blocked = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $expectedAssertCalls = $(if ($fixture.ContainsKey('AssertCalls')) { $fixture.AssertCalls } else { 0 })
            if ($result.Records.Count -eq 2 -and
                $result.Records[-1].status -ceq 'BLOCKED' -and
                $result.Records[-1].alertCodes -contains $fixture.Alert -and
                @($kinds | Where-Object { $_ -ceq 'assert-empty' }).Count -eq $expectedAssertCalls -and
                @($kinds | Where-Object { $_ -ceq 'down' }).Count -eq 0 -and
                @($kinds | Where-Object { $_ -in @('deploy', 'contract', 'bootstrap') }).Count -eq 0 -and
                @($kinds | Where-Object { $_ -ceq 'up' }).Count -eq 1) {
                $blocked++
            }
        }

        $blocked | Should Be $fixtures.Count
    }

    # Mutations caught: approved zero takes a different order, repeats down, or adds an unapproved native call.
    It 'runs the exact approved zero-table reset and health sequence once' {
        $result = Invoke-TestResetScenario
        $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
        $destructiveCount = @($kinds | Where-Object { $_ -ceq 'down' }).Count

        $result.Records.Count | Should Be 8
        $result.Records[0].phase | Should Be 'ISOLATED_BASELINE_READY'
        $result.Records[0].status | Should Be 'READY'
        (@($kinds | Select-Object -First 8) -join ',') | Should Be 'services,volumes,up,health,count,down,up,health'
        $destructiveCount | Should Be 1
    }

    # Mutations caught: reset continues after down/up failure or maps raw native detail instead of a stable code.
    It 'stops with stable codes on down and up failures' {
        $down = Invoke-TestResetScenario -Scenario DownFailure
        $up = Invoke-TestResetScenario -Scenario UpFailure
        $downKinds = @($down.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
        $upKinds = @($up.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })

        $down.Records.Count | Should Be 3
        ($down.Records[-1].alertCodes -contains 'DATABASE_RESET_FAILED') | Should Be $true
        ($downKinds -join ',') | Should Be 'services,volumes,up,health,count,down'
        $up.Records.Count | Should Be 3
        ($up.Records[-1].alertCodes -contains 'DATABASE_START_FAILED') | Should Be $true
        ($upKinds -join ',') | Should Be 'services,volumes,up,health,count,down,up'
    }

    # Mutations caught: health failure loops without the injected clock boundary or reports READY after timeout.
    It 'bounds failed health polling to no more than 120 seconds' {
        $result = Invoke-TestResetScenario -Scenario HealthTimeout
        $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
        $healthCalls = @($kinds | Where-Object { $_ -ceq 'health' }).Count

        $result.Records.Count | Should Be 3
        $result.Records[-1].status | Should Be 'BLOCKED'
        ($result.Records[-1].alertCodes -contains 'DATABASE_HEALTH_TIMEOUT') | Should Be $true
        ($healthCalls -ge 1 -and $healthCalls -le 5) | Should Be $true
        @($kinds | Where-Object { $_ -ceq 'down' }).Count | Should Be 1
    }

    # Mutations caught: stderr, thrown text, paths, arguments, or raw native output crosses the native boundary.
    It 'suppresses stderr and raw exceptions from native and initializer results' {
        Import-Module $corePath -Force -ErrorAction Stop
        $native = Invoke-LocalPreproductionNative -FilePath 'injected-native.exe' -Arguments @('safe') -TestOperation {
            param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
            throw 'reset-native-sensitive-marker'
        }
        $initializer = Invoke-TestResetScenario -Scenario NativeException
        $serialized = @($native, $initializer.Records) | ConvertTo-Json -Depth 10 -Compress

        $native.Succeeded | Should Be $false
        $initializer.Records.Count | Should Be 1
        $initializer.Records[0].status | Should Be 'BLOCKED'
        ($initializer.Records[0].alertCodes -contains 'COMPOSE_METADATA_FAILED') | Should Be $true
        $serialized.Contains('reset-native-sensitive-marker') | Should Be $false
        ($serialized -match '(?i)stack|exception') | Should Be $false
    }

    # Mutations caught: output gains an unsafe field/stream or a command enumerates global/container state or repeats destruction.
    It 'emits one safe bounded record and keeps every native call on the allow-list' {
        $result = Invoke-TestResetScenario
        $recordJson = $result.Records | ConvertTo-Json -Depth 10 -Compress
        $safeRecordCount = @($result.Records | Where-Object {
            (@($_.Keys | Sort-Object) -join ',') -ceq 'alertCodes,boundedCounts,elapsedSeconds,phase,status,utcEnd,utcStart'
        }).Count
        $allowed = $true
        foreach ($call in @($result.Calls | Where-Object { $_.FilePath -ceq 'docker' })) {
            $arguments = @($call.Arguments)
            $kind = Get-TestResetCallKind -Call $call
            if ($call.FilePath -cne 'docker' -or
                -not (Test-TestResetExactComposePrefix `
                    -Arguments ([string[]]$arguments) `
                    -ComposePath $result.CanonicalComposePath `
                    -OverridePath (Get-TestResetCanonicalOverridePath)) -or
                $kind -ceq 'unexpected' -or
                ($arguments -join ' ') -match '(?i)\b(prune|ps|container|inspect|volume\s+(?:ls|rm|prune))\b') {
                $allowed = $false
            }
        }
        $sensitiveMatch = $recordJson -match '(?i)postgres(?:ql)?://|reset-.+-sensitive-marker|stack|exception|[A-Za-z]:\\|(?:host|process|container|worker|lock)(?:id|identifier|owner)|(?:service|volume|path|port)'

        $result.Records.Count | Should Be 8
        $result.AdditionalStreamCount | Should Be 0
        $safeRecordCount | Should Be $result.Records.Count
        $allowed | Should Be $true
        $sensitiveMatch | Should Be $false
        @($result.Calls | Where-Object { (Get-TestResetCallKind -Call $_) -ceq 'down' }).Count | Should Be 1
    }
}

Describe 'Task 1 deploy-before-assert migration order' -Tags 'MigrationOrderTask1' {
    # Mutation caught: application-row assertion runs before schema deployment or its READY state is omitted.
    It 'runs the complete successful command and state order after the isolated reset' {
        $result = Invoke-TestResetScenario
        $kindLabels = @{
            services = 'metadata-services'
            volumes = 'metadata-volumes'
            up = 'database-up'
            health = 'database-health'
            count = 'empty-table-count'
            down = 'isolated-down-volumes'
            deploy = 'db-deploy'
            'assert-empty' = 'db-assert-empty'
            contract = 'bootstrap-contract'
            bootstrap = 'hidden-bootstrap'
        }
        $observed = New-Object System.Collections.ArrayList
        $upCount = 0
        $healthCount = 0
        foreach ($call in $result.Calls) {
            $kind = Get-TestResetCallKind -Call $call
            if ($kind -ceq 'up') {
                $upCount++
                [void]$observed.Add($(if ($upCount -eq 1) { 'baseline-up' } else { 'isolated-up' }))
            }
            elseif ($kind -ceq 'health') {
                $healthCount++
                [void]$observed.Add($(if ($healthCount -eq 1) { 'baseline-health' } else { 'post-reset-health' }))
            }
            else {
                [void]$observed.Add([string]$kindLabels[$kind])
            }
        }
        $phases = @($result.Records | ForEach-Object { $_.phase })

        ($observed -join ',') | Should Be 'metadata-services,metadata-volumes,baseline-up,baseline-health,empty-table-count,isolated-down-volumes,isolated-up,post-reset-health,db-deploy,db-assert-empty,bootstrap-contract,hidden-bootstrap'
        ($phases -join ',') | Should Be 'ISOLATED_BASELINE_READY,ISOLATED_DATABASE_EMPTY,DATABASE_READY,MIGRATED,DATABASE_ASSERT_EMPTY,BOOTSTRAP_CONTRACT_READY,WAITING_OPERATOR_SECRET_INPUT,ADMIN_BOOTSTRAPPED'
        $result.AdditionalStreamCount | Should Be 0
    }

    # Mutations caught: either migration failure reaches assertion, or assertion failure reaches either bootstrap boundary.
    It 'fails stop at all four migration and assertion failure modes' {
        $fixtures = @(
            @{ Failure = 'migration-nonzero'; Scenario = 'DeployFailure'; Expected = 'MIGRATION_FAILED'; AssertCalls = 0; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
            @{ Failure = 'migration-launch'; Scenario = 'DeployException'; Expected = 'MIGRATION_FAILED'; AssertCalls = 0; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
            @{ Failure = 'assert-nonzero'; Scenario = 'AssertEmptyFailure'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 },
            @{ Failure = 'assert-launch'; Scenario = 'AssertEmptyException'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $initializationKinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ } |
                Where-Object { $_ -in @('deploy', 'assert-empty', 'contract', 'bootstrap') })
            $migrationCalls = @($initializationKinds | Where-Object { $_ -ceq 'deploy' }).Count
            $assertCalls = @($initializationKinds | Where-Object { $_ -ceq 'assert-empty' }).Count
            $contractCalls = @($initializationKinds | Where-Object { $_ -ceq 'contract' }).Count
            $bootstrapCalls = @($initializationKinds | Where-Object { $_ -ceq 'bootstrap' }).Count
            $migratedRecords = @($result.Records | Where-Object { $_.phase -ceq 'MIGRATED' -and $_.status -ceq 'READY' }).Count
            $final = $result.Records[-1]
            $assertAfterMigration = $fixture.AssertCalls -eq 0 -or
                (($initializationKinds -join ',') -ceq 'deploy,assert-empty' -and
                    $migratedRecords -eq 1 -and
                    $final.phase -ceq 'DATABASE_ASSERT_EMPTY')
            if ($migrationCalls -eq 1 -and
                $assertCalls -eq $fixture.AssertCalls -and
                $contractCalls -eq $fixture.ContractCalls -and
                $bootstrapCalls -eq $fixture.BootstrapCalls -and
                $migratedRecords -eq $fixture.MigratedRecords -and
                $assertAfterMigration -and
                $result.AdditionalStreamCount -eq 0 -and
                $final.status -ceq 'BLOCKED' -and
                $final.alertCodes.Count -eq 1 -and
                $final.alertCodes[0] -ceq $fixture.Expected) {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }
}

Describe 'Local preproduction migrated-state retry' -Tags 'MigratedRetryTask1' {
    # Mutation caught: a complete empty schema left by a later-stage failure cannot reach deploy on a second invocation.
    It 'resumes three empty migrated states without a destructive reset' {
        $scenarios = @('AssertEmptyException', 'ContractFailure', 'BootstrapFailure')
        $verified = 0
        foreach ($scenario in $scenarios) {
            $state = @{ TableCount = 0L; SchemaComplete = $false; ApplicationRows = 0L }
            $first = Invoke-TestResetScenario -Scenario $scenario -DatabaseState $state
            $second = Invoke-TestResetScenario -Scenario Ready -DatabaseState $state
            $secondKinds = @($second.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $firstMigrated = @($first.Records | Where-Object {
                $_.phase -ceq 'MIGRATED' -and $_.status -ceq 'READY'
            }).Count
            $resumeReady = @($second.Records | Where-Object {
                $_.phase -ceq 'MIGRATED_RETRY_STATE_READY' -and $_.status -ceq 'READY'
            }).Count
            if ($firstMigrated -eq 1 -and
                $state.TableCount -gt 0 -and
                $state.SchemaComplete -eq $true -and
                $state.ApplicationRows -eq 0 -and
                @($secondKinds | Where-Object { $_ -ceq 'down' }).Count -eq 0 -and
                @($secondKinds | Where-Object { $_ -ceq 'assert-empty' }).Count -eq 2 -and
                @($secondKinds | Where-Object { $_ -ceq 'deploy' }).Count -eq 1 -and
                $resumeReady -eq 1 -and
                $second.Records[-1].phase -ceq 'ADMIN_BOOTSTRAPPED' -and
                $second.Records[-1].status -ceq 'READY' -and
                $second.Records[-1].boundedCounts.destructiveAuthorizationCount -eq 0 -and
                $second.Records[-1].boundedCounts.migratedRetryStateReady -eq 1 -and
                $second.AdditionalStreamCount -eq 0) {
                $verified++
            }
        }

        $verified | Should Be $scenarios.Count
    }

    # Mutations caught: incomplete schema or governed rows are reset, migrated, or allowed into either bootstrap boundary.
    It 'preserves every unsafe migrated state and blocks before deploy' {
        $directStates = @(
            @{ TableCount = 2L; SchemaComplete = $false; ApplicationRows = 0L },
            @{ TableCount = 2L; SchemaComplete = $true; ApplicationRows = 1L }
        )
        $verified = 0
        foreach ($state in $directStates) {
            $before = @($state.TableCount, $state.SchemaComplete, $state.ApplicationRows)
            $result = Invoke-TestResetScenario -Scenario Ready -DatabaseState $state
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $final = $result.Records[-1]
            if ($final.phase -ceq 'MIGRATED_RETRY_STATE' -and
                $final.status -ceq 'BLOCKED' -and
                $final.alertCodes.Count -eq 1 -and
                $final.alertCodes[0] -ceq 'MIGRATED_RETRY_STATE_UNSAFE' -and
                @($kinds | Where-Object { $_ -ceq 'assert-empty' }).Count -eq 1 -and
                @($kinds | Where-Object { $_ -in @('down', 'deploy', 'contract', 'bootstrap') }).Count -eq 0 -and
                (@($state.TableCount, $state.SchemaComplete, $state.ApplicationRows) -join '|') -ceq ($before -join '|') -and
                $result.AdditionalStreamCount -eq 0) {
                $verified++
            }
        }

        foreach ($scenario in @('AssertEmptyFailureWithRows', 'BootstrapFailureWithRows')) {
            $state = @{ TableCount = 0L; SchemaComplete = $false; ApplicationRows = 0L }
            $first = Invoke-TestResetScenario -Scenario $scenario -DatabaseState $state
            $second = Invoke-TestResetScenario -Scenario Ready -DatabaseState $state
            $secondKinds = @($second.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $final = $second.Records[-1]
            if (@($first.Records | Where-Object { $_.phase -ceq 'MIGRATED' -and $_.status -ceq 'READY' }).Count -eq 1 -and
                $state.SchemaComplete -eq $true -and
                $state.ApplicationRows -eq 1 -and
                $final.phase -ceq 'MIGRATED_RETRY_STATE' -and
                $final.status -ceq 'BLOCKED' -and
                $final.alertCodes.Count -eq 1 -and
                $final.alertCodes[0] -ceq 'MIGRATED_RETRY_STATE_UNSAFE' -and
                @($secondKinds | Where-Object { $_ -ceq 'assert-empty' }).Count -eq 1 -and
                @($secondKinds | Where-Object { $_ -in @('down', 'deploy', 'contract', 'bootstrap') }).Count -eq 0 -and
                $second.AdditionalStreamCount -eq 0) {
                $verified++
            }
        }

        $verified | Should Be 4
    }

    # Mutations caught: accepted resume ignores migration/post-assert failures or reaches a forbidden later boundary.
    It 'fails stop at all four accepted-resume failure modes' {
        $fixtures = @(
            @{ Scenario = 'ResumeDeployFailure'; Expected = 'MIGRATION_FAILED'; AssertCalls = 1; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
            @{ Scenario = 'ResumeDeployException'; Expected = 'MIGRATION_FAILED'; AssertCalls = 1; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 0 },
            @{ Scenario = 'ResumePostAssertFailure'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 2; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 },
            @{ Scenario = 'ResumePostAssertException'; Expected = 'DATABASE_NOT_EMPTY'; AssertCalls = 2; DeployCalls = 1; ContractCalls = 0; BootstrapCalls = 0; MigratedRecords = 1 }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $state = @{ TableCount = 2L; SchemaComplete = $true; ApplicationRows = 0L }
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario -DatabaseState $state
            $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
            $final = $result.Records[-1]
            $resumeReady = @($result.Records | Where-Object {
                $_.phase -ceq 'MIGRATED_RETRY_STATE_READY' -and $_.status -ceq 'READY'
            }).Count
            $migratedRecords = @($result.Records | Where-Object {
                $_.phase -ceq 'MIGRATED' -and $_.status -ceq 'READY'
            }).Count
            $serialized = $result.Records | ConvertTo-Json -Depth 8 -Compress
            if (@($kinds | Where-Object { $_ -ceq 'down' }).Count -eq 0 -and
                @($kinds | Where-Object { $_ -ceq 'assert-empty' }).Count -eq $fixture.AssertCalls -and
                @($kinds | Where-Object { $_ -ceq 'deploy' }).Count -eq $fixture.DeployCalls -and
                @($kinds | Where-Object { $_ -ceq 'contract' }).Count -eq $fixture.ContractCalls -and
                @($kinds | Where-Object { $_ -ceq 'bootstrap' }).Count -eq $fixture.BootstrapCalls -and
                $resumeReady -eq 1 -and
                $migratedRecords -eq $fixture.MigratedRecords -and
                $final.status -ceq 'BLOCKED' -and
                $final.alertCodes.Count -eq 1 -and
                $final.alertCodes[0] -ceq $fixture.Expected -and
                $result.AdditionalStreamCount -eq 0 -and
                -not $serialized.Contains('initialization-sensitive-marker')) {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }

    # Mutation caught: shared state accepts missing, extra, mis-cased, fractional, or negative fields.
    It 'rejects every invalid shared database-state shape before production invocation' {
        $invalidStates = @(
            @{ TableCount = 0L; SchemaComplete = $false },
            @{ TableCount = 0L; SchemaComplete = $false; ApplicationRows = 0L; Extra = 0 },
            @{ tablecount = 0L; SchemaComplete = $false; ApplicationRows = 0L },
            @{ TableCount = -1L; SchemaComplete = $false; ApplicationRows = 0L },
            @{ TableCount = 0.5; SchemaComplete = $false; ApplicationRows = 0L },
            @{ TableCount = 0L; SchemaComplete = 'false'; ApplicationRows = 0L }
        )
        $codes = @($invalidStates | ForEach-Object {
            $invalidState = $_
            try {
                Invoke-TestResetScenario -Scenario Ready -DatabaseState $invalidState | Out-Null
                'NO_FAILURE'
            }
            catch {
                [string]$_.Exception.Message
            }
        })

        $codes.Count | Should Be $invalidStates.Count
        @($codes | Where-Object { $_ -cne 'TEST_DATABASE_STATE_INVALID' }).Count | Should Be 0
    }
}

Describe 'Task 4 migration and hidden administrator bootstrap' {
    # Mutations caught: an npm stage is skipped/reordered, a command runs outside the fixed root,
    # or the administrator secret crosses an argument or redirected-stream boundary.
    It 'runs the exact state and command order with one inherited-console waiting boundary' {
        $result = Invoke-TestResetScenario
        $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })
        $projectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $result.CanonicalComposePath))
        $npmCalls = @($result.Calls | Where-Object { $_.FilePath -ceq 'npm.cmd' })
        $bootstrapCall = @($result.Calls | Where-Object { (Get-TestResetCallKind -Call $_) -ceq 'bootstrap' })
        $phases = @($result.Records | ForEach-Object { $_.phase })
        $safeShapeCount = @($result.Records | Where-Object {
            (@($_.Keys | Sort-Object) -join ',') -ceq 'alertCodes,boundedCounts,elapsedSeconds,phase,status,utcEnd,utcStart'
        }).Count
        $containsSecretArgument = @($npmCalls | Where-Object {
            $joined = @($_.Arguments) -join '|'
            @($result.Material.Keys | Where-Object {
                -not [string]::IsNullOrEmpty([string]$result.Material[$_]) -and
                $joined.Contains([string]$result.Material[$_])
            }).Count -ne 0 -or $joined -match '(?i)pass(?:word)?|secret|credential|token'
        }).Count -ne 0
        $serialized = @($result.Records, $result.Calls) | ConvertTo-Json -Depth 10 -Compress

        ($kinds -join ',') | Should Be 'services,volumes,up,health,count,down,up,health,deploy,assert-empty,contract,bootstrap'
        ($phases -join ',') | Should Be 'ISOLATED_BASELINE_READY,ISOLATED_DATABASE_EMPTY,DATABASE_READY,MIGRATED,DATABASE_ASSERT_EMPTY,BOOTSTRAP_CONTRACT_READY,WAITING_OPERATOR_SECRET_INPUT,ADMIN_BOOTSTRAPPED'
        @($result.Records | Where-Object { $_.phase -ceq 'WAITING_OPERATOR_SECRET_INPUT' }).Count | Should Be 1
        $result.Records[-1].status | Should Be 'READY'
        $safeShapeCount | Should Be $result.Records.Count
        @($npmCalls | Where-Object { $_.WorkingDirectory -cne $projectRoot }).Count | Should Be 0
        $bootstrapCall.Count | Should Be 1
        $bootstrapCall[0].InheritStandardInput | Should Be $true
        $bootstrapCall[0].InheritStandardOutput | Should Be $true
        $bootstrapCall[0].InheritStandardError | Should Be $true
        $bootstrapCall[0].WaitingRecordEmitted | Should Be $true
        (@($bootstrapCall[0].Arguments) -join '|') | Should Be '--silent|--prefix|apps/server|run|system:bootstrap|--|--safe-interactive'
        $containsSecretArgument | Should Be $false
        $result.AdditionalStreamCount | Should Be 0
        $serialized.Contains('initialization-sensitive-marker') | Should Be $false
    }

    # Mutations caught: a nonzero or launch exception is ignored, mapped to an unstable code,
    # or any command after the failing position is still invoked.
    It 'stops at every command failure position with only its stable alert' {
        $fixtures = @(
            @{ Scenario = 'AssertEmptyFailure'; Expected = 'deploy,assert-empty'; Alert = 'DATABASE_NOT_EMPTY'; Waiting = 0 },
            @{ Scenario = 'AssertEmptyException'; Expected = 'deploy,assert-empty'; Alert = 'DATABASE_NOT_EMPTY'; Waiting = 0 },
            @{ Scenario = 'DeployFailure'; Expected = 'deploy'; Alert = 'MIGRATION_FAILED'; Waiting = 0 },
            @{ Scenario = 'DeployException'; Expected = 'deploy'; Alert = 'MIGRATION_FAILED'; Waiting = 0 },
            @{ Scenario = 'ContractFailure'; Expected = 'deploy,assert-empty,contract'; Alert = 'BOOTSTRAP_CONTRACT_FAILED'; Waiting = 0 },
            @{ Scenario = 'ContractException'; Expected = 'deploy,assert-empty,contract'; Alert = 'BOOTSTRAP_CONTRACT_FAILED'; Waiting = 0 },
            @{ Scenario = 'BootstrapFailure'; Expected = 'deploy,assert-empty,contract,bootstrap'; Alert = 'ADMIN_BOOTSTRAP_FAILED'; Waiting = 1 },
            @{ Scenario = 'BootstrapException'; Expected = 'deploy,assert-empty,contract,bootstrap'; Alert = 'ADMIN_BOOTSTRAP_FAILED'; Waiting = 1 }
        )
        $verified = 0
        foreach ($fixture in $fixtures) {
            $result = Invoke-TestResetScenario -Scenario $fixture.Scenario
            $initializationKinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ } |
                Where-Object { $_ -in @('assert-empty', 'deploy', 'contract', 'bootstrap') })
            $waitingCount = @($result.Records | Where-Object { $_.phase -ceq 'WAITING_OPERATOR_SECRET_INPUT' }).Count
            $final = $result.Records[-1]
            $serialized = @($result.Records, $result.Calls) | ConvertTo-Json -Depth 10 -Compress
            if (($initializationKinds -join ',') -ceq $fixture.Expected -and
                $waitingCount -eq $fixture.Waiting -and
                $final.status -ceq 'BLOCKED' -and
                $final.alertCodes.Count -eq 1 -and
                $final.alertCodes[0] -ceq $fixture.Alert -and
                @($result.Records | Where-Object { $_.phase -ceq 'ADMIN_BOOTSTRAPPED' -and $_.status -ceq 'READY' }).Count -eq 0 -and
                -not $serialized.Contains('initialization-sensitive-marker')) {
                $verified++
            }
        }

        $verified | Should Be $fixtures.Count
    }
}

Describe 'Task 3 fix round 1 native boundary' {
    # Mutation caught: a child that never exits can outlive the caller's native deadline.
    It 'times out and terminates a hanging local child within a short real bound' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $module = Get-Module LocalPreproduction.Core | Select-Object -First 1
        & $module {
            $containment = New-LocalNativeContainment
            $containment.Dispose()
        }
        $watch = [System.Diagnostics.Stopwatch]::StartNew()

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('hang') `
            -TimeoutMilliseconds 250
        $watch.Stop()
        $keys = @($result.PSObject.Properties.Name | Sort-Object)

        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $true
        # The native timeout remains 250 ms with two fixed 1000 ms cleanup confirmations;
        # this outer allowance also covers host scheduling after the native call returns.
        ($watch.ElapsedMilliseconds -lt 5000) | Should Be $true
        ($keys -join ',') | Should Be 'ExitCode,Lines,Succeeded,TerminationConfirmed,TimedOut'
    }

    # Mutation caught: sequential stream reads deadlock while the local child fills both redirected pipes.
    It 'drains both native pipes concurrently without exposing stderr' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $callerDelayMilliseconds = 2100
        $watch = [System.Diagnostics.Stopwatch]::StartNew()

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('fill-delayed') `
            -TimeoutMilliseconds 5000
        Start-Sleep -Milliseconds $callerDelayMilliseconds
        $watch.Stop()
        $serialized = $result | ConvertTo-Json -Depth 6 -Compress

        $result.Succeeded | Should Be $true
        $result.TimedOut | Should Be $false
        # Keep the native 5000 ms contract independent from bounded caller scheduling and cleanup.
        ($watch.ElapsedMilliseconds -lt 8000) | Should Be $true
        $result.Lines.Count | Should Be 1
        $serialized.Contains((New-Object string('x', 128))) | Should Be $true
        ($result.PSObject.Properties.Name -contains 'StdErr') | Should Be $false
    }

    # Mutation caught: noisy PowerShell streams or a permissive result shape can cross the injected boundary.
    It 'isolates every injected stream and rejects noisy or inexact result schemas' {
        Import-Module $corePath -Force -ErrorAction Stop
        $modes = @(
            'Warning', 'Error', 'Verbose', 'Debug', 'Information',
            'ExtraField', 'MissingField', 'MultipleResults',
            'WrongExitCodeType', 'WrongStdOutType', 'WrongStdErrType'
        )
        $blocked = 0
        $escapedStreams = 0
        foreach ($mode in $modes) {
            $captured = @(
                Invoke-LocalPreproductionNative -FilePath 'injected-native.exe' -Arguments @('safe') -TimeoutMilliseconds 1000 -TestOperation {
                    param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
                    if ($mode -ceq 'Warning') { Write-Warning 'fix1-warning-marker' }
                    if ($mode -ceq 'Error') { Write-Error 'fix1-error-marker' }
                    if ($mode -ceq 'Verbose') { Write-Verbose 'fix1-verbose-marker' -Verbose }
                    if ($mode -ceq 'Debug') { Write-Debug 'fix1-debug-marker' -Debug }
                    if ($mode -ceq 'Information') { Write-Information 'fix1-information-marker' -InformationAction Continue }
                    if ($mode -ceq 'MissingField') { return [pscustomobject]@{ ExitCode = 0; StdOut = @() } }
                    if ($mode -ceq 'ExtraField') { return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @(); Extra = 1 } }
                    if ($mode -ceq 'WrongExitCodeType') { return [pscustomobject]@{ ExitCode = '0'; StdOut = @(); StdErr = @() } }
                    if ($mode -ceq 'WrongStdOutType') { return [pscustomobject]@{ ExitCode = 0; StdOut = @{ value = 'safe' }; StdErr = @() } }
                    if ($mode -ceq 'WrongStdErrType') { return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @{ value = 'safe' } } }
                    if ($mode -ceq 'MultipleResults') {
                        [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @() }
                    }
                    return [pscustomobject]@{ ExitCode = 0; StdOut = @(); StdErr = @() }
                }.GetNewClosure() *>&1
            )
            $records = @($captured | Where-Object { $_.PSObject.Properties.Name -contains 'Succeeded' })
            $escapedStreams += $captured.Count - $records.Count
            if ($records.Count -eq 1 -and -not $records[0].Succeeded) { $blocked++ }
        }

        $blocked | Should Be $modes.Count
        $escapedStreams | Should Be 0
    }

    # Mutation caught: the Windows quoting routine changes empty, whitespace, quote, or terminal-backslash operands.
    It 'quotes Windows operands exactly and preserves them through a local echo child' {
        Import-Module $corePath -Force -ErrorAction Stop
        $module = Get-Module LocalPreproduction.Core | Select-Object -First 1
        $operands = @('', 'two words', 'a"b', 'C:\two words\')
        $expectedQuoted = @('""', '"two words"', '"a\"b"', '"C:\two words\\"')
        $quoted = @($operands | ForEach-Object {
            & $module { param([AllowEmptyString()][string]$Value) ConvertTo-LocalNativeArgument -Value $Value } $_
        })
        $fixture = Get-TestResetNativeFixture
        $echo = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments (@('echo') + $operands) `
            -TimeoutMilliseconds 3000
        $decoded = @($echo.Lines | ForEach-Object {
            [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([string]$_).Substring(4)))
        })

        ($quoted -join '|') | Should Be ($expectedQuoted -join '|')
        $echo.Succeeded | Should Be $true
        $echo.TimedOut | Should Be $false
        ($decoded -join '|') | Should Be ($operands -join '|')
    }
}

Describe 'Task 3 fix round 1 physical Compose boundary' {
    # Mutations caught: the repository-root entry or an ancestor junction is trusted without inspection.
    It 'rejects repository-root and ancestor reparse traversal before metadata' {
        $fixtures = New-Object System.Collections.ArrayList

        $physicalRoot = Join-Path $TestDrive 'root-reparse-physical'
        $rootLink = Join-Path $TestDrive 'root-reparse-link'
        [void]$fixtures.Add([pscustomobject]@{
            PhysicalRepository = $physicalRoot
            ModuleRepository = $rootLink
            LinkPath = $rootLink
            LinkTarget = $physicalRoot
        })

        $physicalAncestor = Join-Path $TestDrive 'ancestor-reparse-physical'
        $physicalRepository = Join-Path $physicalAncestor 'repository'
        $ancestorLink = Join-Path $TestDrive 'ancestor-reparse-link'
        [void]$fixtures.Add([pscustomobject]@{
            PhysicalRepository = $physicalRepository
            ModuleRepository = (Join-Path $ancestorLink 'repository')
            LinkPath = $ancestorLink
            LinkTarget = $physicalAncestor
        })

        $rejected = 0
        $metadataCalls = 0
        $unsafeWalkerAcceptances = 0
        foreach ($fixture in $fixtures) {
            $physicalScriptRoot = Join-Path $fixture.PhysicalRepository '.codex-safe'
            $physicalComposeDirectory = Join-Path $fixture.PhysicalRepository 'LayerManage\law-firm-system\infra\postgres'
            New-Item -ItemType Directory -Path $physicalScriptRoot, $physicalComposeDirectory -Force | Out-Null
            Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $physicalScriptRoot 'ProductionRolloutRunner.Core.psm1')
            Copy-Item -LiteralPath $corePath -Destination (Join-Path $physicalScriptRoot 'LocalPreproduction.Core.psm1')
            [System.IO.File]::WriteAllText((Join-Path $physicalComposeDirectory 'compose.yml'), 'services: {}', [System.Text.Encoding]::UTF8)
            New-Item -ItemType Junction -Path $fixture.LinkPath -Target $fixture.LinkTarget | Out-Null

            $modulePath = Join-Path $fixture.ModuleRepository '.codex-safe\LocalPreproduction.Core.psm1'
            $composePath = Join-Path $fixture.ModuleRepository 'LayerManage\law-firm-system\infra\postgres\compose.yml'
            $module = Import-Module $modulePath -Force -PassThru
            $walkerAccepted = & $module {
                param([string]$RepositoryPath, [string]$ComposePath)
                Test-LocalPathWithoutReparsePoint -RootPath $RepositoryPath -LeafPath $ComposePath
            } $fixture.ModuleRepository $composePath
            if ($walkerAccepted) {
                $unsafeWalkerAcceptances++
            }
            $native = {
                param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds)
                $metadataCalls++
                $output = if ($Arguments[-1] -ceq '--services') { @('postgres') } else { @('chengye_postgres_data') }
                return [pscustomobject]@{ ExitCode = 0; StdOut = $output; StdErr = @() }
            }.GetNewClosure()
            try {
                & $module {
                    param([string]$ComposePath, [scriptblock]$Native)
                    Get-LocalPreproductionComposeTarget -ComposePath $ComposePath -TestOperation $Native | Out-Null
                } $composePath $native
            }
            catch {
                $rejected++
            }
        }
        Import-Module $corePath -Force -ErrorAction Stop

        $rejected | Should Be 2
        $metadataCalls | Should Be 0
        $unsafeWalkerAcceptances | Should Be 0
    }
}

Describe 'Task 3 fix round 1 health termination' {
    # Mutations caught: replaceable time/sleep can stall or regress forever, and health calls ignore their remaining budget.
    It 'terminates constant regressing and no-op time fixtures with finite budgeted attempts' {
        $scenarios = @('HealthConstantClock', 'HealthRegressingClock', 'HealthNoOpSleep')
        $bounded = 0
        foreach ($scenario in $scenarios) {
            $watch = [System.Diagnostics.Stopwatch]::StartNew()
            $result = Invoke-TestResetScenario -Scenario $scenario
            $watch.Stop()
            $healthCalls = @($result.Calls | Where-Object { $_.Arguments -contains 'pg_isready' })
            $budgeted = @($healthCalls | Where-Object {
                $_.TimeoutMilliseconds -gt 0 -and $_.TimeoutMilliseconds -le 120000
            }).Count -eq $healthCalls.Count
            if ($result.Records.Count -eq 1 -and
                $result.Records[0].status -ceq 'BLOCKED' -and
                $result.Records[0].alertCodes -contains 'DATABASE_HEALTH_TIMEOUT' -and
                $healthCalls.Count -ge 1 -and
                $healthCalls.Count -le 5 -and
                $budgeted -and
                $watch.ElapsedMilliseconds -lt 3000) {
                $bounded++
            }
        }

        $bounded | Should Be $scenarios.Count
    }
}

Describe 'Task 3 fix round 1 initializer isolation and destructive contract' {
    # Mutation caught: an injected non-success stream or malformed result escapes instead of one stable blocked record.
    It 'contains noisy and malformed injected native results inside one safe initializer record' {
        $scenarios = @('NativeWarning', 'NativeError', 'NativeVerbose', 'NativeDebug', 'NativeInformation', 'NativeMalformed')
        $contained = 0
        foreach ($scenario in $scenarios) {
            $result = Invoke-TestResetScenario -Scenario $scenario
            $serialized = $result.Records | ConvertTo-Json -Depth 8 -Compress
            if ($result.Records.Count -eq 1 -and
                $result.AdditionalStreamCount -eq 0 -and
                $result.Records[0].status -ceq 'BLOCKED' -and
                $result.Records[0].alertCodes -contains 'COMPOSE_METADATA_FAILED' -and
                -not $serialized.Contains('reset-native-sensitive-marker')) {
                $contained++
            }
        }

        $contained | Should Be $scenarios.Count
    }

    # Mutations caught: any fixed database-count token is removed, added, reordered, or substituted before authorization.
    It 'pins the complete count command and rejects every token-array mutation' {
        $ready = Invoke-TestResetScenario
        $countCalls = @($ready.Calls | Where-Object { $_.Arguments -contains 'psql' })
        $expected = @(Get-TestResetExpectedCountArguments -ComposePath $ready.CanonicalComposePath)
        $exactProductionCall = $countCalls.Count -eq 1 -and
            (Test-TestResetExactCountArguments -Arguments $countCalls[0].Arguments -ComposePath $ready.CanonicalComposePath)

        $removed = @($expected[0..($expected.Count - 2)])
        $added = @($expected + 'extra-token')
        $reordered = @($expected.Clone())
        $swap = $reordered[7]
        $reordered[7] = $reordered[8]
        $reordered[8] = $swap
        $substituted = @($expected.Clone())
        $substituted[$substituted.Count - 1] = 'SELECT 0;'
        $mutations = @($removed, $added, $reordered, $substituted)
        $rejected = @($mutations | Where-Object {
            -not (Test-TestResetExactCountArguments -Arguments $_ -ComposePath $ready.CanonicalComposePath)
        }).Count

        $exactProductionCall | Should Be $true
        $rejected | Should Be $mutations.Count
        $ready.CountContractRejected | Should Be 0
        (@($ready.Records[0].alertCodes) -join ',') | Should Be ''
        $ready.Records[0].status | Should Be 'READY'
    }
}

Describe 'Task 3 fix round 1 environment equality matrix' {
    # Mutation caught: comparison of any one of the sixteen fixed Process names is skipped or classified differently.
    It 'blocks every independently mismatched environment name before metadata with one mismatch alert' {
        $names = Get-TestLoaderAllowedNames
        $blocked = 0
        foreach ($name in $names) {
            $result = Invoke-TestResetScenario -Scenario EnvironmentMismatch -MismatchName $name
            if ($result.Records.Count -eq 1 -and
                $result.Records[0].status -ceq 'BLOCKED' -and
                $result.Records[0].alertCodes.Count -eq 1 -and
                $result.Records[0].alertCodes -contains 'ENVIRONMENT_BUNDLE_MISMATCH' -and
                $result.Calls.Count -eq 0) {
                $blocked++
            }
        }

        $blocked | Should Be 16
    }
}

Describe 'Task 3 fix round 2 confirmed native termination' {
    # Mutation caught: direct-child timeout is reported before bounded exit confirmation.
    It 'confirms the timed-out direct child has stopped before returning' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $sentinel = Join-Path $TestDrive 'direct-child.lock'

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('hold', $sentinel) `
            -TimeoutMilliseconds 3000
        $keys = @($result.PSObject.Properties.Name | Sort-Object)

        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $true
        $result.TerminationConfirmed | Should Be $true
        (Test-Path -LiteralPath $sentinel -PathType Leaf) | Should Be $true
        (Test-TestResetFileUnlocked -LiteralPath $sentinel) | Should Be $true
        ($keys -join ',') | Should Be 'ExitCode,Lines,Succeeded,TerminationConfirmed,TimedOut'
    }

    # Mutation caught: child-only termination leaves a spawned descendant holding its resource.
    It 'terminates and confirms the complete contained descendant tree' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $parentSentinel = Join-Path $TestDrive 'tree-parent.lock'
        $childSentinel = Join-Path $TestDrive 'tree-child.lock'

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('tree', $parentSentinel, $childSentinel) `
            -TimeoutMilliseconds 800

        $treeStopped = (Test-TestResetFileUnlocked -LiteralPath $parentSentinel) -and
            (Test-TestResetFileUnlocked -LiteralPath $childSentinel)
        if (-not $treeStopped) {
            Start-Sleep -Milliseconds 3500
            $treeStopped = (Test-TestResetFileUnlocked -LiteralPath $parentSentinel) -and
                (Test-TestResetFileUnlocked -LiteralPath $childSentinel)
        }

        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $true
        $result.TerminationConfirmed | Should Be $true
        (Test-Path -LiteralPath $parentSentinel -PathType Leaf) | Should Be $true
        (Test-Path -LiteralPath $childSentinel -PathType Leaf) | Should Be $true
        $treeStopped | Should Be $true
    }

    # Mutation caught: containment assignment fails after the direct child has already begun executing.
    It 'keeps the direct child suspended and confirms its exit when containment assignment fails' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $sentinel = Join-Path $TestDrive 'assignment-failure.lock'

        $captured = @(Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('hold', $sentinel) `
            -TimeoutMilliseconds 1000 `
            -TestAssignmentOperation { return $false } *>&1)
        $result = $captured[0]

        $captured.Count | Should Be 1
        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $false
        $result.TerminationConfirmed | Should Be $true
        $result.Lines.Count | Should Be 0
        (Test-TestResetFileNotHeld -LiteralPath $sentinel) | Should Be $true
    }

    # Mutation caught: a failed termination request is collapsed into an ordinary confirmed timeout.
    It 'classifies injected termination failure and still closes containment' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $sentinel = Join-Path $TestDrive 'termination-failure.lock'

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('hold', $sentinel) `
            -TimeoutMilliseconds 500 `
            -TestTerminationOperation { return $false }

        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $true
        $result.TerminationConfirmed | Should Be $false
        (Test-Path -LiteralPath $sentinel -PathType Leaf) | Should Be $true
        (Test-TestResetFileUnlocked -LiteralPath $sentinel) | Should Be $true
    }

    # Mutation caught: a truthy termination request is trusted while the bounded post-kill confirmation still fails.
    It 'classifies ignored post-termination wait and still closes containment' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $sentinel = Join-Path $TestDrive 'termination-wait.lock'

        $result = Invoke-LocalPreproductionNative `
            -FilePath $fixture `
            -Arguments @('hold', $sentinel) `
            -TimeoutMilliseconds 500 `
            -TestTerminationOperation { return $true }

        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $true
        $result.TerminationConfirmed | Should Be $false
        (Test-Path -LiteralPath $sentinel -PathType Leaf) | Should Be $true
        (Test-TestResetFileUnlocked -LiteralPath $sentinel) | Should Be $true
    }

    # Mutation caught: an unconfirmed native termination is collapsed into metadata failure or allowed to continue.
    It 'blocks the initializer distinctly on unconfirmed native termination' {
        $result = Invoke-TestResetScenario -Scenario NativeTerminationUnconfirmed
        $kinds = @($result.Calls | ForEach-Object { Get-TestResetCallKind -Call $_ })

        $result.Records.Count | Should Be 1
        $result.AdditionalStreamCount | Should Be 0
        $result.Records[0].status | Should Be 'BLOCKED'
        ($result.Records[0].alertCodes -contains 'NATIVE_TERMINATION_UNCONFIRMED') | Should Be $true
        @($kinds | Where-Object { $_ -in @('count', 'down', 'up', 'health') }).Count | Should Be 0
    }
}

Describe 'Task 3 fix round 4 pre-resume exception cleanup' {
    # Mutation caught: a reader/setup exception after CreateProcess discards direct-child termination proof.
    It 'terminates and confirms the suspended child when post-create setup throws' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $captured = @()
        $fixtureUnlocked = $false

        try {
            $captured = @(Invoke-LocalPreproductionNative `
                -FilePath $fixture `
                -Arguments @('hang') `
                -TimeoutMilliseconds 1000 `
                -TestProcessSetupOperation { throw 'fix4-setup-marker' } *>&1)
            $fixtureUnlocked = Test-TestResetFileUnlocked -LiteralPath $fixture
        }
        finally {
            if (-not $fixtureUnlocked) { Stop-TestResetNativeFixtureProcesses -LiteralPath $fixture }
        }
        $result = $captured[0]

        $captured.Count | Should Be 1
        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $false
        $result.TerminationConfirmed | Should Be $true
        $result.Lines.Count | Should Be 0
        $fixtureUnlocked | Should Be $true
    }

    # Mutation caught: a terminating assignment-hook exception bypasses the pre-resume cleanup guard.
    It 'terminates and confirms the suspended child when the assignment hook throws' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $captured = @()
        $fixtureUnlocked = $false

        try {
            $captured = @(Invoke-LocalPreproductionNative `
                -FilePath $fixture `
                -Arguments @('hang') `
                -TimeoutMilliseconds 1000 `
                -TestAssignmentOperation { throw 'fix4-assignment-marker' } *>&1)
            $fixtureUnlocked = Test-TestResetFileUnlocked -LiteralPath $fixture
        }
        finally {
            if (-not $fixtureUnlocked) { Stop-TestResetNativeFixtureProcesses -LiteralPath $fixture }
        }
        $result = $captured[0]

        $captured.Count | Should Be 1
        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $false
        $result.TerminationConfirmed | Should Be $true
        $result.Lines.Count | Should Be 0
        $fixtureUnlocked | Should Be $true
    }

    # Mutation caught: a failed positive confirmation falls back to the function's initial true value.
    It 'classifies forced pre-resume confirmation failure as unconfirmed after safe cleanup' {
        Import-Module $corePath -Force -ErrorAction Stop
        $fixture = Get-TestResetNativeFixture
        $captured = @()
        $fixtureUnlocked = $false

        try {
            $captured = @(Invoke-LocalPreproductionNative `
                -FilePath $fixture `
                -Arguments @('hang') `
                -TimeoutMilliseconds 1000 `
                -TestProcessSetupOperation { throw 'fix4-setup-unconfirmed-marker' } `
                -TestTerminationState { return $false } *>&1)
            $fixtureUnlocked = Test-TestResetFileUnlocked -LiteralPath $fixture
        }
        finally {
            if (-not $fixtureUnlocked) { Stop-TestResetNativeFixtureProcesses -LiteralPath $fixture }
        }
        $result = $captured[0]

        $captured.Count | Should Be 1
        $result.Succeeded | Should Be $false
        $result.TimedOut | Should Be $false
        $result.TerminationConfirmed | Should Be $false
        $result.Lines.Count | Should Be 0
        $fixtureUnlocked | Should Be $true
    }
}

Describe 'Task 3 fix round 2 real health sleep budget' {
    # Mutation caught: a slow failed health call is followed by a full logical polling sleep past the real deadline.
    It 'caps the requested sleep by the remaining nonreplaceable Stopwatch budget' {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $result = Invoke-TestResetScenario -Scenario HealthSlowFailure -CallerDelayMilliseconds 600
        $watch.Stop()

        $result.Records.Count | Should Be 3
        $result.Records[-1].status | Should Be 'BLOCKED'
        ($result.Records[-1].alertCodes -contains 'DATABASE_HEALTH_TIMEOUT') | Should Be $true
        $result.SleepRequests.Count | Should Be 1
        ($result.SleepRequests[0] -gt 0 -and $result.SleepRequests[0] -le 125) | Should Be $true
        $healthCalls = @($result.Calls | Where-Object { $_.Arguments -contains 'pg_isready' })
        $slowFixtureRespectedTimeout = $healthCalls.Count -eq $result.SlowHealthSleepRequests.Count -and
            $healthCalls.Count -ge 1
        for ($index = 0; $index -lt $healthCalls.Count -and $slowFixtureRespectedTimeout; $index++) {
            $slowFixtureRespectedTimeout = $result.SlowHealthSleepRequests[$index] -gt 0 -and
                $result.SlowHealthSleepRequests[$index] -le $healthCalls[$index].TimeoutMilliseconds
        }
        $slowFixtureRespectedTimeout | Should Be $true
        ($result.HealthElapsedMilliseconds -gt 0 -and $result.HealthElapsedMilliseconds -le 750) | Should Be $true
        ($watch.ElapsedMilliseconds -le 2000) | Should Be $true
    }
}
