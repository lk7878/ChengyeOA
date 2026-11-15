# 公网部署栈：数据在 E:\A_Medical_DATA，端口与本地错开。
# 本地 start-all.ps1 仍用 E:\A + 5180/5181/3081；本脚本用 6180/6181/4081。
# frpc 应指向本脚本端口，这样公网看不到本地案件。
param([switch]$NoOpen, [switch]$Stop)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
. (Join-Path $Root 'scripts\init-medical-data.ps1')
. (Join-Path $Root 'config\deploy-environment.ps1')

$services = @(
    @{
        Name = 'Deploy Harness'
        Port = [int]$env:HARNESS_PORT
        Dir  = $Root
        File = 'powershell.exe'
        Args = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File',
            (Join-Path $Root 'start-harness.ps1'),
            '-Port', $env:HARNESS_PORT, '-NoOpen',
            '-EnvScript', (Join-Path $Root 'config\deploy-environment.ps1')
        )
    }
    @{
        Name = 'Deploy case-service'
        Port = [int]$env:CASE_SERVICE_PORT
        Dir  = Join-Path $Root 'case-service'
        File = 'cmd.exe'
        Args = @(
            '/k',
            "set PORT=$($env:CASE_SERVICE_PORT)&& set CASES_ROOT=$($env:CASES_ROOT)&& set DATA_DIR=$($env:DATA_DIR)&& set DSH_HOME=$($env:DSH_HOME)&& set GATEWAY_ENV=$($env:GATEWAY_ENV)&& set HARNESS_BASE=$($env:HARNESS_BASE)&& set HARNESS_TOKEN_FILE=$($env:HARNESS_TOKEN_FILE)&& set HARNESS_BOOT_LOG=$($env:HARNESS_BOOT_LOG)&& set WEKNORA_BASE=$($env:WEKNORA_BASE)&& npm start"
        )
    }
    @{
        Name = 'Deploy work_ui'
        Port = [int]$env:WORK_UI_PORT
        Dir  = Join-Path $Root 'work_ui'
        File = 'cmd.exe'
        Args = @(
            '/k',
            "set WORK_UI_PORT=$($env:WORK_UI_PORT)&& set CASE_API_PROXY=$($env:CASE_API_PROXY)&& pnpm dev"
        )
    }
)

function Test-Port([int]$Port) {
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Stop-Port([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
        }
    } catch {}
}

if ($Stop) {
    Write-Host '==> Stopping deploy stack' -ForegroundColor Yellow
    foreach ($s in $services) {
        if (Test-Port $s.Port) {
            Stop-Port $s.Port
            Write-Host ("  stopped " + $s.Name + " : " + $s.Port) -ForegroundColor Green
        } else {
            Write-Host ("  not running " + $s.Name) -ForegroundColor DarkGray
        }
    }
    exit 0
}

# 本地 WeKnora 需已在 8090（知识库共享）；未启动则顺带拉起本地 WeKnora
if (-not (Test-Port 8090)) {
    Write-Host '[starting] shared WeKnora Lite on 8090 ...' -ForegroundColor Cyan
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File',
        (Join-Path $Root 'WeKnora\start-lite.ps1')
    ) -WorkingDirectory (Join-Path $Root 'WeKnora') -WindowStyle Hidden | Out-Null
}

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Deploy stack -> E:\A_Medical_DATA' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

foreach ($s in $services) {
    if (Test-Port $s.Port) {
        Write-Host ("[running] " + $s.Name + "  :" + $s.Port) -ForegroundColor DarkYellow
        continue
    }
    Write-Host ("[starting] " + $s.Name + " ...") -ForegroundColor Cyan
    Start-Process -FilePath $s.File -ArgumentList $s.Args -WorkingDirectory $s.Dir -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 4
    if (Test-Port $s.Port) {
        Write-Host ("  [OK] port " + $s.Port) -ForegroundColor Green
    } else {
        Write-Host ("  [wait] still starting port " + $s.Port) -ForegroundColor Yellow
    }
}

# 拉起 frpc：必须清掉 HTTP(S)_PROXY，否则会走本机坏代理 → 云端 502
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:NO_PROXY = '*'
$env:no_proxy = '*'

$Frpc = Join-Path $Root 'deploy\bin\frpc.exe'
$FrpcConfig = Join-Path $Root 'deploy\frpc.toml'
$FrpcLog = Join-Path $Root 'data\frpc.log'
if (Test-Path -LiteralPath $Frpc) {
    Get-Process -Name frpc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    New-Item -ItemType Directory -Force -Path (Split-Path $FrpcLog) | Out-Null
    # cmd 内再清一遍代理，避免继承沙箱/系统代理
    $frpcArgs = "/c set HTTP_PROXY=& set HTTPS_PROXY=& set http_proxy=& set https_proxy=& set ALL_PROXY=& set NO_PROXY=*& `"$Frpc`" -c `"$FrpcConfig`" >> `"$FrpcLog`" 2>&1"
    Start-Process -FilePath 'cmd.exe' -ArgumentList $frpcArgs -WorkingDirectory (Join-Path $Root 'deploy') -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 4
    if (Get-Process -Name frpc -ErrorAction SilentlyContinue) {
        Write-Host '[OK] frpc tunnel started' -ForegroundColor Green
    } else {
        Write-Host '[warn] frpc exited early — see data\frpc.log' -ForegroundColor Yellow
        if (Test-Path $FrpcLog) { Get-Content $FrpcLog -Tail 8 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
    }
} else {
    Write-Host "[warn] missing $Frpc — public URL will not work until frpc is installed" -ForegroundColor Yellow
}

$PublicWorkbench = 'https://162.14.78.238:10443'
$PublicAi = 'https://162.14.78.238:11443'
$PublicKb = 'https://162.14.78.238:12443'

Start-Sleep -Seconds 1
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PUBLIC URLs (open these):' -ForegroundColor Green
Write-Host "  workbench : $PublicWorkbench" -ForegroundColor White
Write-Host "  AI        : $PublicAi  (open from a case)" -ForegroundColor White
Write-Host "  knowledge : $PublicKb" -ForegroundColor White
Write-Host '----------------------------------------' -ForegroundColor Cyan
Write-Host '  Local loopback (frpc source only, not for users):' -ForegroundColor DarkGray
Write-Host "    127.0.0.1:$($env:WORK_UI_PORT) / $($env:CASE_SERVICE_PORT) / $($env:HARNESS_PORT)" -ForegroundColor DarkGray
Write-Host '  Data root : E:\A_Medical_DATA' -ForegroundColor White
Write-Host '  Local data: E:\A\cases (untouched by public)' -ForegroundColor DarkGray

if (-not $NoOpen) {
    Start-Process $PublicWorkbench
    Write-Host "Opened browser: $PublicWorkbench" -ForegroundColor Green
}
