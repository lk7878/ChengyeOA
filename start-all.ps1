# start-all.ps1 - 本地调试栈（数据在 E:\A）
#   WeKnora Lite   http://127.0.0.1:8090
#   Harness Web    http://127.0.0.1:3081
#   case-service   http://127.0.0.1:5181
#   work_ui        http://127.0.0.1:5180
#
# 公网部署请用 start-deploy-all.ps1（数据在 E:\A_Medical_DATA，端口 6180/6181/4081）。
# Double-click: 桌面「一键启动鉴定助手.bat」或 start-all.bat
# Stop all:     start-all.bat -Stop

param([switch]$NoOpen, [switch]$Stop)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

$services = @(
    @{
        Name = 'WeKnora Lite'
        Port = 8090
        Dir  = Join-Path $Root 'WeKnora'
        File = 'powershell.exe'
        Args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', (Join-Path $Root 'WeKnora\start-lite.ps1'))
    }
    @{
        Name = 'Harness Web'
        Port = 3081
        Dir  = $Root
        File = 'powershell.exe'
        Args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', (Join-Path $Root 'start-harness.ps1'), '-NoOpen')
    }
    @{
        Name = 'case-service'
        Port = 5181
        Dir  = Join-Path $Root 'case-service'
        File = 'cmd.exe'
        Args = @('/k', 'npm start')
    }
    @{
        Name = 'work_ui'
        Port = 5180
        Dir  = Join-Path $Root 'work_ui'
        File = 'cmd.exe'
        Args = @('/k', 'pnpm dev')
    }
)

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(200)) { return $false }
        $client.EndConnect($wait)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
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
    Write-Host '==> Stopping all services' -ForegroundColor Yellow
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

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Baiyou Zhiye - start all' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

foreach ($s in $services) {
    if (Test-Port $s.Port) {
        Write-Host ("[running] " + $s.Name + "  http://127.0.0.1:" + $s.Port) -ForegroundColor DarkYellow
        continue
    }

    Write-Host ("[starting] " + $s.Name + " ...") -ForegroundColor Cyan
    Start-Process -FilePath $s.File -ArgumentList $s.Args -WorkingDirectory $s.Dir -WindowStyle Hidden | Out-Null
}

function Get-HarnessUrl {
    $tokenFile = Join-Path $Root '.dsh\harness-launch-token.txt'
    $bootLog = Join-Path $Root '.dsh\harness-boot.log'
    for ($i = 0; $i -lt 40; $i++) {
        if (Test-Path -LiteralPath $tokenFile) {
            $token = (Get-Content -LiteralPath $tokenFile -Raw -ErrorAction SilentlyContinue).Trim()
            if ($token) { return "http://127.0.0.1:3081/?token=$token" }
        }
        if (Test-Path -LiteralPath $bootLog) {
            $content = Get-Content -LiteralPath $bootLog -Raw -ErrorAction SilentlyContinue
            if ($content -match 'token=([A-Za-z0-9_-]+)') {
                return "http://127.0.0.1:3081/?token=$($matches[1])"
            }
            if ($content -match 'https?://127\.0\.0\.1:3081/\?token=[A-Za-z0-9_-]+') {
                return $matches[0]
            }
        }
        Start-Sleep -Milliseconds 250
    }
    return 'http://127.0.0.1:3081/'
}

if (-not $NoOpen) {
    Start-Process 'http://127.0.0.1:5180'
    Write-Host '已打开浏览器: http://127.0.0.1:5180 (work_ui)' -ForegroundColor Green
}

$harnessUrl = Get-HarnessUrl
Write-Host '----------------------------------------' -ForegroundColor Cyan
Write-Host 'URLs:' -ForegroundColor Cyan
Write-Host "  harness   : $harnessUrl" -ForegroundColor White
Write-Host '  workbench : http://127.0.0.1:5180' -ForegroundColor White
Write-Host '  case-api  : http://127.0.0.1:5181' -ForegroundColor White
Write-Host '  weknora   : http://127.0.0.1:8090' -ForegroundColor White
Write-Host 'Stop all: start-all.bat -Stop' -ForegroundColor DarkGray
if ($harnessUrl -notmatch 'token=') {
    Write-Host '助手仍在启动。工作台已打开，进案件若提示缺少凭证，等十几秒再点一次。' -ForegroundColor Yellow
}
