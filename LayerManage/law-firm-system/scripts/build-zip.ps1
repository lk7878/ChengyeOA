param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$sourceDir = Join-Path $projectRoot "apps\dist\law-firm-system"
$outputDir = Join-Path $projectRoot "apps\dist\installer"
$zipFile = Join-Path $outputDir "LawFirmSystem-Portable-1.0.0.zip"

Push-Location $projectRoot
try {
    & npm.cmd run pkg
    if ($LASTEXITCODE -ne 0) {
        throw "npm run pkg failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

& node.exe (Join-Path $PSScriptRoot 'verify-package-output.js') $sourceDir
if ($LASTEXITCODE -ne 0) {
    throw "Package output verification failed with exit code $LASTEXITCODE"
}

# Create output directory
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Remove old zip if exists
if (Test-Path $zipFile) {
    Remove-Item $zipFile -Force
}

Write-Host "Creating ZIP package..." -ForegroundColor Cyan
Write-Host "  Source: $sourceDir"
Write-Host "  Output: $zipFile"

# Compress
Compress-Archive -Path "$sourceDir\*" -DestinationPath $zipFile -CompressionLevel Optimal -Force

if (-not (Test-Path -LiteralPath $zipFile)) {
    throw "ZIP package was not created: $zipFile"
}
$zipItem = Get-Item -LiteralPath $zipFile
if ($zipItem.Length -le 0) {
    throw "ZIP package is empty: $zipFile"
}

$zipSize = [math]::Round($zipItem.Length / 1MB, 1)
Write-Host ""
Write-Host "ZIP package created: $zipFile" -ForegroundColor Green
Write-Host "  Size: ${zipSize}MB"
Write-Host ""
Write-Host "To use on another computer:"
Write-Host "  1. Copy $zipFile to the target computer"
Write-Host "  2. Extract to any folder (e.g., C:\LawFirmSystem)"
Write-Host "  3. Run law-firm-system.exe"
Write-Host "  4. Open http://localhost:7001 in browser"
Write-Host "  5. Configure DATABASE_URL, JWT_SECRET, and APP_KEYS before launch"
