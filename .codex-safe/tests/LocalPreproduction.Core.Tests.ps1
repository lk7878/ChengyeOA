$modulePath = Join-Path $PSScriptRoot '..\LocalPreproduction.Core.psm1'
$wrapperPath = Join-Path $PSScriptRoot '..\New-ChengyeOALocalPreproductionBundle.ps1'
$runnerPath = Join-Path $PSScriptRoot '..\ProductionRolloutRunner.Core.psm1'
Import-Module $modulePath -Force -ErrorAction SilentlyContinue

function Copy-TestDictionary {
    param([System.Collections.IDictionary]$Source)

    $copy = @{}
    foreach ($key in $Source.Keys) {
        $copy[[string]$key] = $Source[$key]
    }
    return $copy
}

function Get-TestFailureCode {
    param([scriptblock]$Action)

    try {
        & $Action
        return 'NO_FAILURE'
    }
    catch {
        return [string]$_.Exception.Message
    }
}

function New-TestSnapshot {
    param(
        [string]$Status = 'READY',
        [int]$Undispatched = 1,
        [int]$DueBacklog = 2,
        [int]$Manual = 3,
        [int]$Processing = 4,
        [int]$ExpiredProcessing = 5,
        [int]$StaleExpiredProcessing = 6,
        [int]$LeaseLost15m = 7
    )

    return [pscustomobject][ordered]@{
        status = $Status
        undispatched = $Undispatched
        dueBacklog = $DueBacklog
        manual = $Manual
        processing = $Processing
        expiredProcessing = $ExpiredProcessing
        staleExpiredProcessing = $StaleExpiredProcessing
        leaseLost15m = $LeaseLost15m
    }
}

function Get-DocumentedBundleKeys {
    return @(
        'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
        'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
        'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
        'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
    )
}

function Write-TestProtectedText {
    param(
        [string]$Text,
        [string]$LiteralPath
    )

    $entropy = [System.Text.Encoding]::UTF8.GetBytes('ChengyeOA.LocalPreproduction.v1')
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
        $plainBytes,
        $entropy,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [System.IO.File]::WriteAllText(
        $LiteralPath,
        [Convert]::ToBase64String($protectedBytes),
        [System.Text.Encoding]::ASCII
    )
}

function Test-ExactSafeRecordSchema {
    param([object]$Record)

    if ($Record -isnot [System.Collections.IDictionary]) {
        return $false
    }
    $actualKeys = @($Record.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    $expectedKeys = @('alertCodes', 'boundedCounts', 'elapsedSeconds', 'phase', 'status', 'utcEnd', 'utcStart')
    return $actualKeys.Count -eq 7 -and ($actualKeys -join ',') -ceq ($expectedKeys -join ',')
}

function Get-TestStorageMutexName {
    param([string]$LiteralPath)

    $canonical = [System.IO.Path]::GetFullPath($LiteralPath).ToLowerInvariant()
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $algorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
        return 'Local\ChengyeOA.LocalPreproduction.' + ([BitConverter]::ToString($digest).Replace('-', ''))
    }
    finally {
        $algorithm.Dispose()
    }
}

Describe 'Local preproduction material' {
    # Mutation caught: removing either port boundary permits privileged or invalid listener ports.
    It 'rejects ports outside the documented range' {
        (Get-Command New-LocalPreproductionMaterial -ErrorAction SilentlyContinue) -ne $null | Should Be $true
        (Get-TestFailureCode { New-LocalPreproductionMaterial -ApplicationPort 1023 -DatabasePort 55432 }) -eq 'NO_FAILURE' | Should Be $false
        (Get-TestFailureCode { New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 65536 }) -eq 'NO_FAILURE' | Should Be $false
    }

    # Mutation caught: replacing the cryptographic generator with fixed material makes consecutive bundles identical.
    It 'generates fresh cryptographic material' {
        $first = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        $second = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432

        ([string]$first.JWT_SECRET -cne [string]$second.JWT_SECRET) | Should Be $true
        ([string]$first.POSTGRES_PASSWORD -cne [string]$second.POSTGRES_PASSWORD) | Should Be $true
    }

    # Mutation caught: changing a fixed local value, port projection, or cryptographic size breaks the production contract.
    It 'produces the fixed local contract and required cryptographic sizes' {
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        $appKeys = @(([string]$material.APP_KEYS).Split(','))

        $material.POSTGRES_USER | Should Be 'chengyeoa_preprod'
        $material.POSTGRES_DB | Should Be 'chengyeoa_preprod'
        $material.POSTGRES_PORT | Should Be '55432'
        $material.POSTGRES_TEST_USER | Should Be 'chengyeoa_preprod_test'
        $material.POSTGRES_TEST_DB | Should Be 'chengyeoa_preprod_test'
        $material.NODE_ENV | Should Be 'production'
        $material.EVENT_WORKER_ENABLED | Should Be 'false'
        $material.HOST | Should Be '127.0.0.1'
        $material.PORT | Should Be '7001'
        ([Convert]::FromBase64String([string]$material.JWT_SECRET)).Length | Should Be 48
        $appKeys.Count | Should Be 2
        ([Convert]::FromBase64String($appKeys[0])).Length | Should Be 32
        ([Convert]::FromBase64String($appKeys[1])).Length | Should Be 32
        ([Convert]::FromBase64String([string]$material.MFA_ENCRYPTION_KEY_V1)).Length | Should Be 32
    }
}

Describe 'Local preproduction protected bundle' {
    # Mutation caught: lexical path handling accepts relative, provider-qualified, or alternate-root storage targets.
    It 'rejects targets outside an absolute approved filesystem parent' {
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        $approvedRoot = Join-Path $TestDrive 'approved-root'
        $alternateRoot = Join-Path $TestDrive 'alternate-root'
        New-Item -ItemType Directory -Path $approvedRoot | Out-Null
        New-Item -ItemType Directory -Path $alternateRoot | Out-Null
        Push-Location $TestDrive
        try {
            $relativeCode = Get-TestFailureCode {
                Protect-LocalPreproductionBundle -Material $material -LiteralPath 'relative-root\environment.dpapi'
            }
        }
        finally {
            Pop-Location
        }
        $providerPath = 'FileSystem::' + (Join-Path $TestDrive 'provider-root\environment.dpapi')
        $providerCode = Get-TestFailureCode {
            Protect-LocalPreproductionBundle -Material $material -LiteralPath $providerPath
        }
        $alternateCode = Get-TestFailureCode {
            Protect-LocalPreproductionBundle -Material $material -LiteralPath (Join-Path $alternateRoot 'environment.dpapi') -ApprovedRoot $approvedRoot
        }

        $relativeCode | Should Be 'SECRET_STORAGE_PATH_INVALID'
        $providerCode | Should Be 'SECRET_STORAGE_PATH_INVALID'
        $alternateCode | Should Be 'SECRET_STORAGE_PATH_INVALID'
    }

    # Mutation caught: an existing reparse point redirects ACL mutation or ciphertext creation outside the approved physical parent.
    It 'rejects a reparse point at the target or in an existing ancestor' {
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        $physicalRoot = Join-Path $TestDrive 'physical-root'
        $ancestorLink = Join-Path $TestDrive 'ancestor-link'
        $targetLink = Join-Path $TestDrive 'target-link.dpapi'
        New-Item -ItemType Directory -Path $physicalRoot | Out-Null
        New-Item -ItemType Junction -Path $ancestorLink -Target $physicalRoot | Out-Null
        New-Item -ItemType Junction -Path $targetLink -Target $physicalRoot | Out-Null

        $ancestorCode = Get-TestFailureCode {
            Protect-LocalPreproductionBundle -Material $material -LiteralPath (Join-Path $ancestorLink 'environment.dpapi') -ApprovedRoot $ancestorLink
        }
        $targetCode = Get-TestFailureCode {
            Protect-LocalPreproductionBundle -Material $material -LiteralPath $targetLink -ApprovedRoot (Split-Path -Parent $targetLink)
        }

        $ancestorCode | Should Be 'SECRET_STORAGE_PATH_INVALID'
        $targetCode | Should Be 'SECRET_STORAGE_PATH_INVALID'
    }

    # Mutation caught: writing JSON or reversible plaintext instead of DPAPI ciphertext exposes protected fields on disk.
    It 'stores ciphertext and round-trips every field for the current user' {
        $path = Join-Path $TestDrive 'roundtrip\environment.dpapi'
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        Protect-LocalPreproductionBundle -Material $material -LiteralPath $path
        $raw = Get-Content -LiteralPath $path -Raw
        $restored = Unprotect-LocalPreproductionBundle -LiteralPath $path
        $allEqual = $true
        foreach ($key in $material.Keys) {
            if (-not $restored.ContainsKey([string]$key) -or [string]$restored[[string]$key] -cne [string]$material[$key]) {
                $allEqual = $false
            }
        }

        $raw.Contains([string]$material.JWT_SECRET) | Should Be $false
        $raw.Contains([string]$material.POSTGRES_PASSWORD) | Should Be $false
        $restored.Count | Should Be 16
        $allEqual | Should Be $true
    }

    # Mutation caught: changing DPAPI scope or entropy prevents independent recovery with the required settings.
    It 'decrypts independently with the required DPAPI scope and entropy' {
        $path = Join-Path $TestDrive 'independent-protection\environment.dpapi'
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        Protect-LocalPreproductionBundle -Material $material -LiteralPath $path
        $protectedBytes = [Convert]::FromBase64String([System.IO.File]::ReadAllText($path))
        $requiredEntropy = [System.Text.Encoding]::UTF8.GetBytes('ChengyeOA.LocalPreproduction.v1')
        $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $requiredEntropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $decoded = ([System.Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json)
        $requiredSettingsWork = [string]$decoded.JWT_SECRET -ceq [string]$material.JWT_SECRET

        $requiredSettingsWork | Should Be $true
    }

    # Mutation caught: ignoring the fixed entropy allows a different label to decrypt the protected bytes.
    It 'rejects independent DPAPI recovery with alternate entropy' {
        $path = Join-Path $TestDrive 'alternate-entropy\environment.dpapi'
        Protect-LocalPreproductionBundle -Material (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432) -LiteralPath $path
        $protectedBytes = [Convert]::FromBase64String([System.IO.File]::ReadAllText($path))
        $alternateEntropy = [System.Text.Encoding]::UTF8.GetBytes('ChengyeOA.LocalPreproduction.alternate')
        $alternateEntropyRejected = (Get-TestFailureCode {
            [void][System.Security.Cryptography.ProtectedData]::Unprotect(
                $protectedBytes,
                $alternateEntropy,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser
            )
        }) -ne 'NO_FAILURE'

        $alternateEntropyRejected | Should Be $true
    }

    # Mutation caught: changing CurrentUser protection to machine scope remains invisible to managed unprotection in the same account.
    It 'records user scope rather than machine scope in the protected blob' {
        $path = Join-Path $TestDrive 'alternate-scope\environment.dpapi'
        Protect-LocalPreproductionBundle -Material (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432) -LiteralPath $path
        $protectedBytes = [Convert]::FromBase64String([System.IO.File]::ReadAllText($path))
        $requiredEntropy = [System.Text.Encoding]::UTF8.GetBytes('ChengyeOA.LocalPreproduction.v1')
        $controlPlaintext = [System.Text.Encoding]::UTF8.GetBytes('{"control":true}')
        $machineScopeControl = [System.Security.Cryptography.ProtectedData]::Protect(
            $controlPlaintext,
            $requiredEntropy,
            [System.Security.Cryptography.DataProtectionScope]::LocalMachine
        )
        $localMachineFlag = [uint32]4
        $userFlags = [BitConverter]::ToUInt32($protectedBytes, 40)
        $machineFlags = [BitConverter]::ToUInt32($machineScopeControl, 40)

        (($userFlags -band $localMachineFlag) -eq 0) | Should Be $true
        (($machineFlags -band $localMachineFlag) -eq $localMachineFlag) | Should Be $true
    }

    # Mutation caught: interpolating raw credential bytes into the generated address prevents parser-safe recovery of the original value.
    It 'round-trips the generated credential component through address parsing' {
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        $address = [Uri]$material.DATABASE_URL
        $userInfoParts = @($address.UserInfo.Split([char[]]':', 2))
        $decodedCredential = if ($userInfoParts.Count -eq 2) {
            [Uri]::UnescapeDataString($userInfoParts[1])
        }
        else {
            ''
        }

        $address.IsAbsoluteUri | Should Be $true
        $userInfoParts.Count | Should Be 2
        ($decodedCredential -ceq [string]$material.POSTGRES_PASSWORD) | Should Be $true
    }

    # Mutation caught: using create-or-replace semantics destroys an occupied ciphertext bundle.
    It 'refuses to overwrite an occupied target and preserves its bytes' {
        $path = Join-Path $TestDrive 'occupied\environment.dpapi'
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) | Out-Null
        [System.IO.File]::WriteAllText($path, 'existing-ciphertext')
        $code = Get-TestFailureCode {
            Protect-LocalPreproductionBundle -Material (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432) -LiteralPath $path
        }

        $code | Should Be 'SECRET_BUNDLE_ALREADY_EXISTS'
        (Get-Content -LiteralPath $path -Raw) | Should Be 'existing-ciphertext'
    }

    # Mutation caught: replacing atomic create-new with a check-then-write lets two synchronized writers both succeed or alter the winner's bytes.
    It 'allows exactly one synchronized writer and preserves the winning bytes' {
        $path = Join-Path $TestDrive 'two-writer\environment.dpapi'
        $parent = Split-Path -Parent $path
        New-Item -ItemType Directory -Path $parent | Out-Null
        $materials = @(
            (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432),
            (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        )
        $gate = New-Object System.Threading.ManualResetEventSlim($false)
        $arrivalGate = New-Object System.Threading.ManualResetEventSlim($false)
        $readiness = New-Object System.Threading.CountdownEvent(2)
        $pool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, 2)
        $invocations = @()
        $writer = {
            param($ModulePath, $TargetPath, $Material, $ArrivalGate, $Readiness, $StartGate)

            Import-Module $ModulePath -Force -ErrorAction Stop
            if (-not $ArrivalGate.Wait(10000)) {
                return [pscustomobject]@{ outcome = 'BARRIER_TIMEOUT'; hash = '' }
            }
            [void]$Readiness.Signal()
            if (-not $StartGate.Wait(10000)) {
                return [pscustomobject]@{ outcome = 'BARRIER_TIMEOUT'; hash = '' }
            }
            try {
                Protect-LocalPreproductionBundle -Material $Material -LiteralPath $TargetPath
                $algorithm = [System.Security.Cryptography.SHA256]::Create()
                try {
                    $hash = [Convert]::ToBase64String($algorithm.ComputeHash([System.IO.File]::ReadAllBytes($TargetPath)))
                }
                finally {
                    $algorithm.Dispose()
                }
                return [pscustomobject]@{ outcome = 'CREATED'; hash = $hash }
            }
            catch {
                $failureCode = [string]$_.Exception.Message
                $outcome = if ($failureCode -ceq 'SECRET_BUNDLE_ALREADY_EXISTS') {
                    'OCCUPIED'
                }
                elseif ($failureCode -ceq 'SECRET_BUNDLE_WRITE_FAILED') {
                    'WRITE_FAILED'
                }
                elseif ($failureCode -ceq 'SECRET_STORAGE_PATH_INVALID') {
                    'PATH_INVALID'
                }
                else {
                    'OTHER_FAILURE'
                }
                return [pscustomobject]@{ outcome = $outcome; hash = '' }
            }
        }
        try {
            $pool.Open()
            foreach ($material in $materials) {
                $powerShell = [PowerShell]::Create()
                $powerShell.RunspacePool = $pool
                [void]$powerShell.AddScript($writer.ToString()).AddArgument($modulePath).AddArgument($path).AddArgument($material).AddArgument($arrivalGate).AddArgument($readiness).AddArgument($gate)
                $invocations += [pscustomobject]@{ PowerShell = $powerShell; Handle = $powerShell.BeginInvoke() }
            }
            $arrivalGate.Set()
            $allReadyAtRelease = $readiness.Wait(10000)
            $gate.Set()
            $results = @()
            foreach ($invocation in $invocations) {
                $results += @($invocation.PowerShell.EndInvoke($invocation.Handle))
            }
            $winner = @($results | Where-Object { $_.outcome -ceq 'CREATED' })
            $occupied = @($results | Where-Object { $_.outcome -ceq 'OCCUPIED' })
            $algorithm = [System.Security.Cryptography.SHA256]::Create()
            try {
                $storedHash = [Convert]::ToBase64String($algorithm.ComputeHash([System.IO.File]::ReadAllBytes($path)))
            }
            finally {
                $algorithm.Dispose()
            }
            $winnerBytesPreserved = $winner.Count -eq 1 -and $storedHash -ceq [string]$winner[0].hash
            $invariantCode = if (-not $allReadyAtRelease) {
                'SYNC_READINESS_TIMEOUT'
            }
            elseif ($winner.Count -ne 1) {
                'SYNC_WINNER_COUNT'
            }
            elseif ($occupied.Count -ne 1) {
                if (@($results | Where-Object { $_.outcome -ceq 'WRITE_FAILED' }).Count -gt 0) {
                    'SYNC_SETUP_WRITE_FAILURE'
                }
                elseif (@($results | Where-Object { $_.outcome -ceq 'PATH_INVALID' }).Count -gt 0) {
                    'SYNC_PATH_FAILURE'
                }
                else {
                    'SYNC_OCCUPIED_COUNT'
                }
            }
            elseif (-not $winnerBytesPreserved) {
                'SYNC_BYTE_PRESERVATION'
            }
            else {
                'SYNC_READY'
            }

            $invariantCode | Should Be 'SYNC_READY'
            $winner.Count | Should Be 1
            $occupied.Count | Should Be 1
            $winnerBytesPreserved | Should Be $true
            $allReadyAtRelease | Should Be $true
        }
        finally {
            foreach ($invocation in $invocations) {
                $invocation.PowerShell.Dispose()
            }
            $pool.Dispose()
            $readiness.Dispose()
            $arrivalGate.Dispose()
            $gate.Dispose()
        }
    }

    # Mutation caught: setup and atomic creation run without path-scoped cross-process serialization.
    It 'blocks a prepared writer while the path serialization mutex is held' {
        $path = Join-Path $TestDrive 'mutex-serialization\environment.dpapi'
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) | Out-Null
        $mutex = New-Object System.Threading.Mutex($false, (Get-TestStorageMutexName -LiteralPath $path))
        $readiness = New-Object System.Threading.ManualResetEventSlim($false)
        $powerShell = [PowerShell]::Create()
        $handle = $null
        $ownsMutex = $false
        $readyInTime = $false
        $completedBeforeRelease = $true
        $results = @()
        $writer = {
            param($ModulePath, $TargetPath, $Readiness)

            Import-Module $ModulePath -Force -ErrorAction Stop
            $Readiness.Set()
            try {
                Protect-LocalPreproductionBundle -Material (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432) -LiteralPath $TargetPath
                return [pscustomobject]@{ outcome = 'CREATED' }
            }
            catch {
                return [pscustomobject]@{ outcome = 'FAILED' }
            }
        }
        try {
            $ownsMutex = $mutex.WaitOne(0)
            [void]$powerShell.AddScript($writer.ToString()).AddArgument($modulePath).AddArgument($path).AddArgument($readiness)
            $handle = $powerShell.BeginInvoke()
            $readyInTime = $readiness.Wait(10000)
            $completedBeforeRelease = $handle.AsyncWaitHandle.WaitOne(1000)
            if ($ownsMutex) {
                $mutex.ReleaseMutex()
                $ownsMutex = $false
            }
            $results = @($powerShell.EndInvoke($handle))
        }
        finally {
            if ($ownsMutex) {
                $mutex.ReleaseMutex()
            }
            $powerShell.Dispose()
            $readiness.Dispose()
            $mutex.Dispose()
        }

        $readyInTime | Should Be $true
        $completedBeforeRelease | Should Be $false
        $results.Count | Should Be 1
        $results[0].outcome | Should Be 'CREATED'
    }

    # Mutation caught: accepting damaged Base64 or non-DPAPI bytes allows corrupt storage to cross the trust boundary.
    It 'rejects malformed and invalid ciphertext with one stable failure code' {
        $malformedPath = Join-Path $TestDrive 'malformed.dpapi'
        $invalidPath = Join-Path $TestDrive 'invalid.dpapi'
        [System.IO.File]::WriteAllText($malformedPath, 'not-base64')
        [System.IO.File]::WriteAllText($invalidPath, [Convert]::ToBase64String([byte[]](1, 2, 3, 4)))

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $malformedPath }) | Should Be 'SECRET_BUNDLE_INVALID'
        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $invalidPath }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: protected bytes that decrypt successfully bypass JSON syntax validation.
    It 'rejects protected malformed JSON with the stable failure code' {
        $path = Join-Path $TestDrive 'protected-malformed-json.dpapi'
        Write-TestProtectedText -Text '{' -LiteralPath $path

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $path }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: a protected scalar value is accepted as a bundle object.
    It 'rejects a protected non-object value with the stable failure code' {
        $path = Join-Path $TestDrive 'protected-scalar.dpapi'
        Write-TestProtectedText -Text '"value"' -LiteralPath $path

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $path }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: a protected empty object crosses the bundle boundary without any fields.
    It 'rejects a protected empty object with the stable failure code' {
        $path = Join-Path $TestDrive 'protected-empty-object.dpapi'
        Write-TestProtectedText -Text '{}' -LiteralPath $path

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $path }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: non-canonical encoded text is normalized before verification and accepted.
    It 'rejects non-canonical encoded ciphertext text with the stable failure code' {
        $path = Join-Path $TestDrive 'noncanonical-text.dpapi'
        Write-TestProtectedText -Text '{"marker":true}' -LiteralPath $path
        $canonical = [System.IO.File]::ReadAllText($path)
        [System.IO.File]::WriteAllText($path, $canonical + [Environment]::NewLine, [System.Text.Encoding]::ASCII)

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $path }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: forwarding a filesystem exception leaks rejected storage details.
    It 'maps a missing protected bundle to one stable failure code' {
        $path = Join-Path $TestDrive 'absent.dpapi'

        (Get-TestFailureCode { Unprotect-LocalPreproductionBundle -LiteralPath $path }) | Should Be 'SECRET_BUNDLE_INVALID'
    }

    # Mutation caught: inherited or broad access rules expose the protected bundle directory to additional identities.
    It 'restricts the storage directory ACL to the current user and local system' {
        $path = Join-Path $TestDrive 'restricted\environment.dpapi'
        $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
        Protect-LocalPreproductionBundle -Material $material -LiteralPath $path
        $acl = Get-Acl -LiteralPath (Split-Path -Parent $path)
        $directoryRules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        $actualSids = @($directoryRules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        $expectedSids = @(
            [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
            ([System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)).Value
        ) | Sort-Object -Unique
        $expectedInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        $directoryRulesValid = @($directoryRules | Where-Object {
            $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and
            $_.InheritanceFlags -eq $expectedInheritance -and
            $_.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None -and
            -not $_.IsInherited
        }).Count -eq 2
        $fileAcl = Get-Acl -LiteralPath $path
        $fileRules = @($fileAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        $fileSids = @($fileRules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        $fileRulesValid = @($fileRules | Where-Object {
            $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and
            $_.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None -and
            $_.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None -and
            $_.IsInherited
        }).Count -eq 2

        $acl.AreAccessRulesProtected | Should Be $true
        $directoryRules.Count | Should Be 2
        ($actualSids -join ',') | Should Be ($expectedSids -join ',')
        $directoryRulesValid | Should Be $true
        $fileAcl.AreAccessRulesProtected | Should Be $false
        $fileRules.Count | Should Be 2
        ($fileSids -join ',') | Should Be ($expectedSids -join ',')
        $fileRulesValid | Should Be $true
    }
}

Describe 'Local preproduction environment validation' {
    # Mutation caught: material generation omits or adds a key while individual value assertions continue to pass.
    It 'generates exactly the documented sixteen-key set' {
        $actualKeys = @((New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432).Keys | ForEach-Object { [string]$_ } | Sort-Object)
        $expectedKeys = @(Get-DocumentedBundleKeys | Sort-Object)

        $actualKeys.Count | Should Be 16
        ($actualKeys -join ',') | Should Be ($expectedKeys -join ',')
    }

    # Mutation caught: a valid generated bundle is blocked by an over-strict or incomplete validator.
    It 'accepts generated material without alerts' {
        $record = Test-LocalPreproductionEnvironment -Environment (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)

        $record.status | Should Be 'READY'
        @($record.alertCodes).Count | Should Be 0
    }

    # Mutation caught: any one documented key can be omitted without the exact-key gate failing closed.
    It 'fails closed for every documented key omission' {
        $allBlocked = $true
        foreach ($missingKey in (Get-DocumentedBundleKeys)) {
            $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
            $environment.Remove($missingKey)
            $record = Test-LocalPreproductionEnvironment -Environment $environment
            if ($record.status -cne 'BLOCKED' -or $record.alertCodes -notcontains 'ENV_REQUIRED_MISSING') {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: case-insensitive dictionary lookup accepts a differently cased key as the documented exact key.
    It 'fails closed for every documented key casing substitution' {
        $allBlocked = $true
        foreach ($documentedKey in (Get-DocumentedBundleKeys)) {
            $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
            $value = $environment[$documentedKey]
            $environment.Remove($documentedKey)
            $environment[$documentedKey.ToLowerInvariant()] = $value
            $record = Test-LocalPreproductionEnvironment -Environment $environment
            if ($record.status -cne 'BLOCKED' -or
                $record.alertCodes -notcontains 'ENV_REQUIRED_MISSING' -or
                $record.alertCodes -notcontains 'ENV_UNEXPECTED_KEY') {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: an unrecognized key silently crosses the environment allow-list boundary.
    It 'fails closed on an extraneous key' {
        $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        $environment['UNEXPECTED_SETTING'] = 'rejected-marker'
        $record = Test-LocalPreproductionEnvironment -Environment $environment

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'ENV_UNEXPECTED_KEY') | Should Be $true
        (($record | ConvertTo-Json -Depth 6 -Compress).Contains('rejected-marker')) | Should Be $false
    }

    # Mutation caught: case-insensitive production-mode checking accepts a non-exact runtime mode.
    It 'requires exact production mode' {
        $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        $environment.NODE_ENV = 'Production'
        $record = Test-LocalPreproductionEnvironment -Environment $environment

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'NODE_ENV_NOT_PRODUCTION') | Should Be $true
    }

    # Mutation caught: a truthy, differently cased, or absent disabled value enables background work during preflight.
    It 'requires the exact disabled runtime value' {
        $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        $environment.EVENT_WORKER_ENABLED = 'False'
        $record = Test-LocalPreproductionEnvironment -Environment $environment

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'EVENT_WORKER_NOT_DISABLED') | Should Be $true
    }

    # Mutation caught: one, three, or short application keys pass the signing-key gate.
    It 'requires exactly two sufficiently long application keys' {
        $invalidValues = @(
            'aaaaaaaaaaaaaaaaaaaaaaaa',
            'short,bbbbbbbbbbbbbbbbbbbbbbbb',
            'aaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbb,cccccccccccccccccccccccc'
        )
        $allBlocked = $true
        foreach ($invalidValue in $invalidValues) {
            $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
            $environment.APP_KEYS = $invalidValue
            $record = Test-LocalPreproductionEnvironment -Environment $environment
            if ($record.status -cne 'BLOCKED' -or $record.alertCodes -notcontains 'APP_KEYS_INVALID') {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: malformed, wrong-length, or non-canonical MFA key material passes validation.
    It 'requires canonical Base64 containing exactly 32 MFA bytes' {
        $invalidValues = @('not-base64', [Convert]::ToBase64String((New-Object byte[] 31)), ('A' * 42 + 'B='))
        $allBlocked = $true
        foreach ($invalidValue in $invalidValues) {
            $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
            $environment.MFA_ENCRYPTION_KEY_V1 = $invalidValue
            $record = Test-LocalPreproductionEnvironment -Environment $environment
            if ($record.status -cne 'BLOCKED' -or $record.alertCodes -notcontains 'MFA_KEY_INVALID') {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: a non-loopback or malformed origin is accepted for the local-only runtime.
    It 'requires one canonical loopback origin' {
        $invalidValues = @('https://example.invalid:7001', 'not-an-origin', 'http://127.0.0.1:7001/path')
        $allBlocked = $true
        foreach ($invalidValue in $invalidValues) {
            $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
            $environment.CORS_ALLOWED_ORIGINS = $invalidValue
            $record = Test-LocalPreproductionEnvironment -Environment $environment
            if ($record.status -cne 'BLOCKED' -or $record.alertCodes -notcontains 'CORS_ORIGIN_INVALID') {
                $allBlocked = $false
            }
        }

        $allBlocked | Should Be $true
    }

    # Mutation caught: recognizable example material is treated as a deployable credential.
    It 'rejects known sample markers' {
        $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        $environment.JWT_SECRET = 'replace-me-with-a-production-value'
        $record = Test-LocalPreproductionEnvironment -Environment $environment

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'ENV_SAMPLE_VALUE') | Should Be $true
    }

    # Mutation caught: rejected values, connection strings, or exception detail are attached to validation output.
    It 'returns only the safe status schema for hostile rejected input' {
        $environment = Copy-TestDictionary (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432)
        $environment.DATABASE_URL = 'postgresql://rejected-marker'
        $environment.JWT_SECRET = 'sample-rejected-marker'
        $record = Test-LocalPreproductionEnvironment -Environment $environment
        $serialized = $record | ConvertTo-Json -Depth 6 -Compress
        $keys = @($record.Keys | Sort-Object)

        ($keys -join ',') | Should Be 'alertCodes,boundedCounts,elapsedSeconds,phase,status,utcEnd,utcStart'
        $serialized.Contains('rejected-marker') | Should Be $false
        ($serialized -match '(?i)postgres(?:ql)?://|stack|filesystem') | Should Be $false
    }
}

Describe 'Event preflight snapshot comparison' {
    # Mutation caught: comparison records add unsafe fields, omit the bounded count, or report a value other than the eight durable fields.
    It 'returns the exact safe schema and eight-field count for ready and blocked results' {
        $readyRecord = Compare-EventPreflightSnapshot -Source (New-TestSnapshot) -Portable (New-TestSnapshot)
        $blockedRecord = Compare-EventPreflightSnapshot -Source (New-TestSnapshot) -Portable (New-TestSnapshot -Manual 99)

        (Test-ExactSafeRecordSchema -Record $readyRecord) | Should Be $true
        (Test-ExactSafeRecordSchema -Record $blockedRecord) | Should Be $true
        $readyRecord.boundedCounts.durableFieldsCompared | Should Be 8
        $blockedRecord.boundedCounts.durableFieldsCompared | Should Be 8
    }

    # Mutation caught: equal durable fields or READY status are ignored, preventing an agreed preflight from proceeding.
    It 'returns ready when all eight durable fields agree and both sides are ready' {
        $record = Compare-EventPreflightSnapshot -Source (New-TestSnapshot) -Portable (New-TestSnapshot)

        $record.status | Should Be 'READY'
        @($record.alertCodes).Count | Should Be 0
    }

    # Mutation caught: comparison expands to transient extra fields and blocks otherwise identical durable snapshots.
    It 'ignores fields outside the eight-field durable snapshot' {
        $source = New-TestSnapshot
        $portable = New-TestSnapshot
        $source | Add-Member -NotePropertyName transientA -NotePropertyValue 'one'
        $portable | Add-Member -NotePropertyName transientA -NotePropertyValue 'two'
        $record = Compare-EventPreflightSnapshot -Source $source -Portable $portable

        $record.status | Should Be 'READY'
    }

    # Mutation caught: one of the seven count comparisons is omitted or missing data is treated as zero.
    It 'blocks every durable count mismatch and a missing durable field' {
        $fieldNames = @('undispatched', 'dueBacklog', 'manual', 'processing', 'expiredProcessing', 'staleExpiredProcessing', 'leaseLost15m')
        $allBlocked = $true
        foreach ($fieldName in $fieldNames) {
            $source = New-TestSnapshot
            $portable = New-TestSnapshot
            $portable.$fieldName = [int]$portable.$fieldName + 1
            $record = Compare-EventPreflightSnapshot -Source $source -Portable $portable
            if ($record.status -cne 'BLOCKED' -or $record.alertCodes -notcontains 'PREFLIGHT_SNAPSHOT_MISMATCH') {
                $allBlocked = $false
            }
        }
        $missing = New-TestSnapshot
        $missing.PSObject.Properties.Remove('manual')
        $missingRecord = Compare-EventPreflightSnapshot -Source (New-TestSnapshot) -Portable $missing

        $allBlocked | Should Be $true
        $missingRecord.status | Should Be 'BLOCKED'
        ($missingRecord.alertCodes -contains 'PREFLIGHT_SNAPSHOT_MISMATCH') | Should Be $true
    }

    # Mutation caught: matching counts override a non-ready summary status.
    It 'blocks when either summary is not ready' {
        $record = Compare-EventPreflightSnapshot -Source (New-TestSnapshot -Status 'BLOCKED') -Portable (New-TestSnapshot)

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'PREFLIGHT_SNAPSHOT_MISMATCH') | Should Be $true
    }
}

Describe 'One-time bundle creation command' {
    # Mutation caught: the fixed entry point reports success after its storage root is redirected through a reparse point.
    It 'maps redirected fixed storage to one safe blocked alert' {
        $originalLocalAppData = $env:LOCALAPPDATA
        $physicalRoot = Join-Path $TestDrive 'redirected-physical-root'
        $redirectedRoot = Join-Path $TestDrive 'redirected-local-root'
        New-Item -ItemType Directory -Path $physicalRoot | Out-Null
        New-Item -ItemType Junction -Path $redirectedRoot -Target $physicalRoot | Out-Null
        try {
            $env:LOCALAPPDATA = $redirectedRoot
            $record = & $wrapperPath

            $record.status | Should Be 'BLOCKED'
            ($record.alertCodes -contains 'SECRET_STORAGE_PATH_INVALID') | Should Be $true
            (($record | ConvertTo-Json -Depth 6 -Compress) -match '(?i)\\|/|stack|exception') | Should Be $false
        }
        finally {
            $env:LOCALAPPDATA = $originalLocalAppData
        }
    }

    # Mutation caught: the entry point overwrites its fixed occupied target or reports a non-safe failure.
    It 'creates once under the fixed temporary root and blocks the second invocation' {
        $originalLocalAppData = $env:LOCALAPPDATA
        try {
            $env:LOCALAPPDATA = Join-Path $TestDrive 'local-app-data'
            $first = & $wrapperPath
            $second = & $wrapperPath

            $first.status | Should Be 'READY'
            $second.status | Should Be 'BLOCKED'
            ($second.alertCodes -contains 'SECRET_BUNDLE_ALREADY_EXISTS') | Should Be $true
            (($second | ConvertTo-Json -Depth 6 -Compress) -match '(?i)\\|/|postgres(?:ql)?://|stack') | Should Be $false
        }
        finally {
            $env:LOCALAPPDATA = $originalLocalAppData
        }
    }

    # Mutation caught: a core-module import failure escapes as raw PowerShell error instead of a safe BLOCKED record.
    It 'maps a missing core module to a safe blocked record' {
        $isolatedRoot = Join-Path $TestDrive 'isolated-wrapper'
        New-Item -ItemType Directory -Path $isolatedRoot | Out-Null
        Copy-Item -LiteralPath $wrapperPath -Destination (Join-Path $isolatedRoot 'New-ChengyeOALocalPreproductionBundle.ps1')
        Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $isolatedRoot 'ProductionRolloutRunner.Core.psm1')
        $record = & (Join-Path $isolatedRoot 'New-ChengyeOALocalPreproductionBundle.ps1')

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'MODULE_IMPORT_FAILED') | Should Be $true
        (Test-ExactSafeRecordSchema -Record $record) | Should Be $true
        (($record | ConvertTo-Json -Depth 6 -Compress) -match '(?i)\\|/|stack|exception') | Should Be $false
    }

    # Mutation caught: a missing shared dependency escapes before the wrapper can build the exact safe failure record.
    It 'maps a missing shared dependency to the exact safe blocked schema' {
        $isolatedRoot = Join-Path $TestDrive 'isolated-dependency-wrapper'
        New-Item -ItemType Directory -Path $isolatedRoot | Out-Null
        Copy-Item -LiteralPath $wrapperPath -Destination (Join-Path $isolatedRoot 'New-ChengyeOALocalPreproductionBundle.ps1')
        $record = & (Join-Path $isolatedRoot 'New-ChengyeOALocalPreproductionBundle.ps1')

        $record.status | Should Be 'BLOCKED'
        ($record.alertCodes -contains 'MODULE_IMPORT_FAILED') | Should Be $true
        (Test-ExactSafeRecordSchema -Record $record) | Should Be $true
        (($record | ConvertTo-Json -Depth 6 -Compress) -match '(?i)\\|/|stack|exception') | Should Be $false
    }
}
