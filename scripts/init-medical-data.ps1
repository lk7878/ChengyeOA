# Initialize E:\A_Medical_DATA (dirs + config copy; no case/session/user data)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\config\deploy-environment.ps1"

$LocalDsh = 'E:\A\.dsh'
$DeployDsh = $env:DSH_HOME

foreach ($name in @('settings.yaml', '.env', '.credentials.yaml')) {
    $src = Join-Path $LocalDsh $name
    $dst = Join-Path $DeployDsh $name
    if ((Test-Path -LiteralPath $src) -and -not (Test-Path -LiteralPath $dst)) {
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Host "copied $name -> deploy .dsh" -ForegroundColor DarkGray
    }
}

$ws = Join-Path $DeployDsh 'storages\workspace.json'
$wsBody = (@'
{
  "unit": { "name": "workspace", "version": 2 },
  "global": { "initialized": true, "workspaceIds": [], "archivedSessionIds": [] },
  "tables": { "workspaces": {} }
}
'@).Trim() + "`n"
# PowerShell Set-Content -Encoding UTF8 writes BOM; dsh JSON parser rejects it.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$needsWrite = $true
if (Test-Path -LiteralPath $ws) {
    try {
        $null = (Get-Content -LiteralPath $ws -Raw -Encoding UTF8) | ConvertFrom-Json
        $bytes = [System.IO.File]::ReadAllBytes($ws)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            $needsWrite = $true
        } else {
            $needsWrite = $false
        }
    } catch {
        $needsWrite = $true
    }
}
if ($needsWrite) {
    [System.IO.File]::WriteAllText($ws, $wsBody, $utf8NoBom)
    Write-Host 'wrote workspace.json (UTF-8 no BOM)' -ForegroundColor DarkGray
}

$gwExample = 'E:\A\deploy\gateway.env.example'
$gw = $env:GATEWAY_ENV
if ((Test-Path -LiteralPath $gwExample) -and -not (Test-Path -LiteralPath $gw)) {
    Copy-Item -LiteralPath $gwExample -Destination $gw -Force
    Write-Host "copied gateway.env.example -> $gw" -ForegroundColor Yellow
    Write-Host 'Edit COOKIE_DOMAIN / AI_PUBLIC_BASE for public domain.' -ForegroundColor Yellow
}

# 同步 agent 预设挂载：本地 cordis.patch.yml 挂 E:/A/package；部署侧须同样挂载，
# 并把 outputRoots 改到 A_Medical_DATA（否则公网助手只有标准/PTC/极简/创造，没有鉴定包）。
$srcPatch = Join-Path $LocalDsh 'profiles\web\cordis.patch.yml'
$dstPatchDir = Join-Path $DeployDsh 'profiles\web'
$dstPatch = Join-Path $dstPatchDir 'cordis.patch.yml'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
if (Test-Path -LiteralPath $srcPatch) {
    [System.IO.Directory]::CreateDirectory($dstPatchDir) | Out-Null
    $patchText = Get-Content -LiteralPath $srcPatch -Raw -Encoding UTF8
    $patchText = $patchText `
        -replace 'E:/A/cases', 'E:/A_Medical_DATA/cases' `
        -replace 'E:/A/data', 'E:/A_Medical_DATA/data' `
        -replace 'E:/A/reports', 'E:/A_Medical_DATA/reports'
    [System.IO.File]::WriteAllText($dstPatch, $patchText, $utf8NoBom)
    Write-Host 'synced profiles/web/cordis.patch.yml (package presets + deploy outputRoots)' -ForegroundColor DarkGray
}

# 同步 web profile 插件（dsh-file-convert 等）。缺这些时 medical-review 的
# restrict-tools 会因 inspect_file/convert_file 未知而无法切换。
$srcPkg = Join-Path $LocalDsh 'profiles\web\package.json'
$dstPkg = Join-Path $dstPatchDir 'package.json'
$srcWs = Join-Path $LocalDsh 'profiles\web\pnpm-workspace.yaml'
$dstWs = Join-Path $dstPatchDir 'pnpm-workspace.yaml'
$needInstall = $false
if (Test-Path -LiteralPath $srcPkg) {
    [System.IO.Directory]::CreateDirectory($dstPatchDir) | Out-Null
    $srcText = Get-Content -LiteralPath $srcPkg -Raw -Encoding UTF8
    $dstText = if (Test-Path -LiteralPath $dstPkg) { Get-Content -LiteralPath $dstPkg -Raw -Encoding UTF8 } else { '' }
    if ($srcText -ne $dstText) {
        [System.IO.File]::WriteAllText($dstPkg, $srcText, $utf8NoBom)
        $needInstall = $true
        Write-Host 'synced profiles/web/package.json (plugin bundles)' -ForegroundColor DarkGray
    }
}
if ((Test-Path -LiteralPath $srcWs) -and -not (Test-Path -LiteralPath $dstWs)) {
    Copy-Item -LiteralPath $srcWs -Destination $dstWs -Force
    $needInstall = $true
}
$fcLink = Join-Path $dstPatchDir 'node_modules\dsh-file-convert'
$nm = Join-Path $dstPatchDir 'node_modules'
$localNm = Join-Path $LocalDsh 'profiles\web\node_modules'
if (-not (Test-Path -LiteralPath $fcLink)) { $needInstall = $true }
if ($needInstall) {
    # 优先 junction 本地已装好的 profile node_modules（离线、免 registry）
    if ((Test-Path -LiteralPath $localNm) -and (Test-Path -LiteralPath (Join-Path $localNm 'dsh-file-convert'))) {
        if (Test-Path -LiteralPath $nm) {
            $item = Get-Item -LiteralPath $nm -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                cmd /c "rmdir `"$nm`"" | Out-Null
            } else {
                Remove-Item -LiteralPath $nm -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        cmd /c "mklink /J `"$nm`" `"$localNm`"" | Out-Null
        if (Test-Path -LiteralPath $fcLink) {
            Write-Host 'deploy web profile plugins: junction -> local node_modules' -ForegroundColor Green
            $needInstall = $false
        }
    }
}
if ($needInstall -and (Test-Path -LiteralPath $dstPkg)) {
    $pnpm = Join-Path 'E:\A\runtime\pnpm' 'pnpm.cmd'
    if (-not (Test-Path -LiteralPath $pnpm)) { $pnpm = 'pnpm' }
    Write-Host 'pnpm install deploy web profile plugins ...' -ForegroundColor Cyan
    Push-Location -LiteralPath $dstPatchDir
    try {
        foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy')) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        }
        & $pnpm install --prefer-offline
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed: $LASTEXITCODE" }
        Write-Host 'deploy web profile plugins ready' -ForegroundColor Green
    } finally {
        Pop-Location
    }
}
[System.IO.Directory]::CreateDirectory('E:\A_Medical_DATA\reports') | Out-Null

Write-Host "Deploy data root ready: E:\A_Medical_DATA" -ForegroundColor Green
Write-Host "  cases : $($env:CASES_ROOT)"
Write-Host "  data  : $($env:DATA_DIR)"
Write-Host "  dsh   : $DeployDsh"
