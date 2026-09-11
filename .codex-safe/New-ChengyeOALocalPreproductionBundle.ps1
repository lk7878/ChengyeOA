$started = [datetime]::UtcNow
$runnerModulePath = Join-Path $PSScriptRoot 'ProductionRolloutRunner.Core.psm1'
$coreModulePath = Join-Path $PSScriptRoot 'LocalPreproduction.Core.psm1'

try {
    Import-Module $runnerModulePath -Force -ErrorAction Stop
}
catch {
    return [ordered]@{
        phase = 'local_preproduction_bundle_create'
        status = 'BLOCKED'
        boundedCounts = @{ created = 0 }
        alertCodes = @('MODULE_IMPORT_FAILED')
        utcStart = $started.ToString('o')
        utcEnd = ([datetime]::UtcNow).ToString('o')
        elapsedSeconds = 0L
    }
}

try {
    Import-Module $coreModulePath -Force -ErrorAction Stop
}
catch {
    return New-SafeStatusRecord `
        -Phase 'local_preproduction_bundle_create' `
        -Status 'BLOCKED' `
        -BoundedCounts @{ created = 0 } `
        -AlertCodes @('MODULE_IMPORT_FAILED') `
        -UtcStart $started `
        -UtcEnd ([datetime]::UtcNow)
}

if ([string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) {
    return New-SafeStatusRecord `
        -Phase 'local_preproduction_bundle_create' `
        -Status 'BLOCKED' `
        -BoundedCounts @{ created = 0 } `
        -AlertCodes @('SECRET_STORAGE_UNAVAILABLE') `
        -UtcStart $started `
        -UtcEnd ([datetime]::UtcNow)
}

try {
    $storageRoot = Join-Path ([string]$env:LOCALAPPDATA) 'ChengyeOA\local-preproduction'
    $bundlePath = Join-Path $storageRoot 'environment.dpapi'
    $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
    Protect-LocalPreproductionBundle -Material $material -LiteralPath $bundlePath -ApprovedRoot $storageRoot
    return New-SafeStatusRecord `
        -Phase 'local_preproduction_bundle_create' `
        -Status 'READY' `
        -BoundedCounts @{ created = 1 } `
        -AlertCodes @() `
        -UtcStart $started `
        -UtcEnd ([datetime]::UtcNow)
}
catch {
    $alertCode = if ([string]$_.Exception.Message -ceq 'SECRET_BUNDLE_ALREADY_EXISTS') {
        'SECRET_BUNDLE_ALREADY_EXISTS'
    }
    elseif ([string]$_.Exception.Message -ceq 'SECRET_STORAGE_PATH_INVALID') {
        'SECRET_STORAGE_PATH_INVALID'
    }
    else {
        'SECRET_BUNDLE_CREATE_FAILED'
    }
    return New-SafeStatusRecord `
        -Phase 'local_preproduction_bundle_create' `
        -Status 'BLOCKED' `
        -BoundedCounts @{ created = 0 } `
        -AlertCodes @($alertCode) `
        -UtcStart $started `
        -UtcEnd ([datetime]::UtcNow)
}
