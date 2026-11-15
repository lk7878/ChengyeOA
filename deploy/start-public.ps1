# 公网访问：先拉起本机四项服务，再启动 frpc 隧道。
param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Frpc = Join-Path $PSScriptRoot 'bin\frpc.exe'
$Config = Join-Path $PSScriptRoot 'frpc.toml'
$FrpcLog = Join-Path $Root 'data\frpc.log'
$TokenFile = Join-Path 'E:\A_Medical_DATA\.dsh' 'harness-launch-token.txt'
$BootLog = Join-Path 'E:\A_Medical_DATA\.dsh' 'harness-boot.log'

Write-Host '==> 1/3 启动部署栈（数据目录 E:\A_Medical_DATA）' -ForegroundColor Cyan
& (Join-Path $Root 'start-deploy-all.ps1') -NoOpen

Write-Host '==> 2/3 等待部署 harness token' -ForegroundColor Cyan
for ($i = 0; $i -lt 45; $i++) {
    if ((Test-Path $BootLog) -and (Get-Content $BootLog -Raw -ErrorAction SilentlyContinue) -match 'token=([A-Za-z0-9_-]+)') {
        Set-Content -LiteralPath $TokenFile -Value $matches[1] -NoNewline -Encoding UTF8
        break
    }
    Start-Sleep -Seconds 2
}

if (-not (Test-Path $Frpc)) {
    Write-Host "未找到 $Frpc，请先下载 frp 并放到 deploy\bin\" -ForegroundColor Red
    exit 1
}

Write-Host '==> 3/3 启动 frpc 隧道' -ForegroundColor Cyan
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:NO_PROXY = '*'
$env:no_proxy = '*'
Get-Process -Name frpc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
New-Item -ItemType Directory -Force -Path (Split-Path $FrpcLog) | Out-Null
$frpcArgs = "/c set HTTP_PROXY=& set HTTPS_PROXY=& set http_proxy=& set https_proxy=& set ALL_PROXY=& set NO_PROXY=*& `"$Frpc`" -c `"$Config`" >> `"$FrpcLog`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList $frpcArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 4

if (Test-Path $FrpcLog) {
    $tail = Get-Content $FrpcLog -Tail 3 -ErrorAction SilentlyContinue
    if ($tail) { $tail | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
}

Write-Host '----------------------------------------' -ForegroundColor Cyan
Write-Host '公网地址（IP + 端口，见 deploy/Caddyfile.ip）：' -ForegroundColor Cyan
Write-Host '  工作台  https://162.14.78.238:10443' -ForegroundColor White
Write-Host '  AI助手  https://162.14.78.238:11443  （请从案件跳转）' -ForegroundColor White
Write-Host '  知识库  https://162.14.78.238:12443' -ForegroundColor White
Write-Host '本机需保持开机；frpc 日志：data\frpc.log' -ForegroundColor DarkGray

if (-not $NoOpen) {
    Start-Process 'https://162.14.78.238:10443'
}
