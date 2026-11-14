Set-StrictMode -Version Latest

foreach ($name in @(
    'DATABASE_URL',
    'JWT_SECRET',
    'APP_KEYS',
    'MFA_ENCRYPTION_KEY_V1',
    'CORS_ALLOWED_ORIGINS',
    'EVENT_WORKER_ENABLED',
    'NODE_ENV'
)) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}

$runnerPath = Join-Path $PSScriptRoot '..\Invoke-EventCenterProductionRollout.ps1'
& $runnerPath
exit $LASTEXITCODE
