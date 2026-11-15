# 巡检本机四项服务 + 隧道。任一端口未监听则写告警文件（可接计划任务弹窗/邮件）。
param(
    [int]$IntervalSec = 30,
    [string]$AlertFile = 'E:\A\data\tunnel-alert.txt'
)

$ErrorActionPreference = 'Continue'
# 巡检公网部署栈端口（本地调试栈 5180/3081 不在此列）
$ports = @(
    @{ Name = 'deploy-work_ui'; Port = 6180 },
    @{ Name = 'deploy-case-service'; Port = 6181 },
    @{ Name = 'deploy-harness'; Port = 4081 },
    @{ Name = 'weknora'; Port = 8090 }
)

function Test-Listen([int]$Port) {
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

Write-Host "开始巡检，间隔 ${IntervalSec}s。本机关机或断网则云上全部 502。"
while ($true) {
    $down = @()
    foreach ($p in $ports) {
        if (-not (Test-Listen $p.Port)) { $down += "$($p.Name):$($p.Port)" }
    }
    $frpc = Get-Process -Name frpc -ErrorAction SilentlyContinue
    if (-not $frpc) { $down += 'frpc' }

    if ($down.Count -gt 0) {
        $msg = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 离线: $($down -join ', ')"
        New-Item -ItemType Directory -Force -Path (Split-Path $AlertFile) | Out-Null
        Set-Content -Path $AlertFile -Value $msg -Encoding UTF8
        Write-Host $msg -ForegroundColor Red
    } else {
        if (Test-Path $AlertFile) { Remove-Item $AlertFile -Force }
        Write-Host "$(Get-Date -Format 'HH:mm:ss') ok" -ForegroundColor DarkGray
    }
    Start-Sleep -Seconds $IntervalSec
}
