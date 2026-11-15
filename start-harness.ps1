param(
    [int]$Port = 0,
    [switch]$NoOpen,
    [string]$EnvScript = ''
)
if ($EnvScript) {
    . $EnvScript
} else {
    # 本机栈必须强制 E:\A\.dsh。父进程若刚跑过 start-deploy-all，DSH_HOME 会指到
    # A_Medical_DATA，3081 就会列出公网部署案件。
    foreach ($name in @(
        'APP_PROFILE', 'CASES_ROOT', 'DATA_DIR', 'GATEWAY_ENV', 'GATEWAY_ENV_FILE',
        'HARNESS_TOKEN_FILE', 'HARNESS_BOOT_LOG', 'DSH_PUBLIC_GATEWAY',
        'WORK_UI_PORT', 'CASE_SERVICE_PORT', 'CASE_API_PROXY', 'HARNESS_PORT',
        'HARNESS_BASE', 'PORT', 'DSH_HOME'
    )) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    $env:DSH_HOME = Join-Path $PSScriptRoot '.dsh'
    . "$PSScriptRoot\config\local-environment.ps1"
}
if ($Port -le 0) {
    $Port = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3081 }
}
Set-Location -LiteralPath $PSScriptRoot

# Cursor / 沙箱会注入 HTTP(S)_PROXY=127.0.0.1:xxxxx。鉴定助手必须直连 CloseAI 与阿里云 MaaS；
# 走这条本地代理时，代理一断就会变成「本轮运行失败 Connection error」（TRANSPORT）。
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:NO_PROXY = '*'
$env:no_proxy = '*'

function Get-HarnessTrustedHosts {
    param([string]$GatewayEnv = $(
        if ($env:GATEWAY_ENV_FILE) { $env:GATEWAY_ENV_FILE }
        elseif ($env:GATEWAY_ENV) { $env:GATEWAY_ENV }
        elseif ($env:DATA_DIR) { Join-Path $env:DATA_DIR 'gateway.env' }
        else { Join-Path $PSScriptRoot 'data\gateway.env' }
    ))
    if (-not (Test-Path -LiteralPath $GatewayEnv)) { return @() }
    $trusted = [System.Collections.Generic.List[string]]::new()
    Get-Content -LiteralPath $GatewayEnv | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if ($key -eq 'AI_PUBLIC_BASE' -and $val) {
            try {
                $uri = [Uri]$val
                if ($uri.Host -match '^(127\.0\.0\.1|localhost)$') { return }
                $env:DSH_PUBLIC_GATEWAY = '1'
                $trusted.Add($uri.Host)
                $defaultPort = if ($uri.Scheme -eq 'https') { 443 } else { 80 }
                if ($uri.Port -gt 0 -and $uri.Port -ne $defaultPort) {
                    $trusted.Add("{0}:{1}" -f $uri.Host, $uri.Port)
                }
            } catch {}
        }
        if ($key -eq 'HARNESS_TRUSTED_HOSTS' -and $val) {
            foreach ($part in ($val -split '[,\s;]+')) {
                if ($part) { $trusted.Add($part) }
            }
        }
    }
    return $trusted | Select-Object -Unique
}

$launchArgs = @('--profile', 'web', '--port', "$Port")
if ($NoOpen) { $launchArgs += '--no-open' }
foreach ($hostAuthority in Get-HarnessTrustedHosts) {
    $launchArgs += '--trusted-host'
    $launchArgs += $hostAuthority
}
Write-Host "[start-harness] trusted-host: $($launchArgs -join ' ')" -ForegroundColor DarkGray

# ── 捕获 harness launch token ──────────────────────────────────────────────
# dsh.cmd 是批处理，其子 node 进程的 stdout 不经 PowerShell 管道，故用输出重定向到
# 日志文件，再轮询解析 token= 写入 .dsh\harness-launch-token.txt 供 case-service 桥接。
$DshHome   = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $PSScriptRoot '.dsh' }
$TokenFile = Join-Path $DshHome 'harness-launch-token.txt'
$BootLog   = Join-Path $DshHome 'harness-boot.log'
$BootErr   = Join-Path $DshHome 'harness-boot.err'
[System.IO.Directory]::CreateDirectory($DshHome) | Out-Null
foreach ($f in @($TokenFile, $BootLog, $BootErr)) {
    if (Test-Path $f) { Remove-Item $f -Force }
}

# 以 cmd.exe /c 启动 dsh.cmd，stdout/stderr 重定向到日志；子 node 进程继承文件句柄。
# 注意：-ArgumentList 必须分列传递（与已验证的隔离测试一致）；单字符串拼接形式会让
# cmd.exe /c 把整段带空格的命令当成一个带引号的参数，导致 dsh.cmd 无法正确解析参数。
$cmdArgs = @('/c', 'dsh.cmd') + $launchArgs
try {
    $dshProc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList $cmdArgs `
        -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
        -RedirectStandardOutput $BootLog -RedirectStandardError $BootErr -PassThru
} catch {
    Write-Host "[start-harness] Start-Process 失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "[start-harness] dsh pid=$($dshProc.Id)  port=$Port  log=$BootLog" -ForegroundColor DarkGray

# 子进程 stdout 重定向到文件时是块缓冲，token 行经常在几十秒后才刷出来。
# 轮询结束不能停：后面的实时日志里一旦出现 token 也要立刻落盘。
$script:tokenWritten = $false
function Write-LaunchToken([string]$Token) {
    if ($script:tokenWritten -or -not $Token) { return $script:tokenWritten }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($TokenFile, $Token, $utf8)
    $script:tokenWritten = $true
    Write-Host "[start-harness] launch token 已写入 $TokenFile" -ForegroundColor Green
    return $true
}

function Save-LaunchToken {
    if ($script:tokenWritten) { return $true }
    if (-not (Test-Path -LiteralPath $BootLog)) { return $false }
    # 重定向句柄经常不让别的程序读。这里用共享读；失败再退回 Get-Content。
    $content = $null
    try {
        $stream = New-Object System.IO.FileStream(
            $BootLog,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        try {
            $reader = New-Object System.IO.StreamReader($stream)
            $content = $reader.ReadToEnd()
            $reader.Dispose()
        } finally {
            $stream.Dispose()
        }
    } catch {
        try { $content = Get-Content -LiteralPath $BootLog -Raw -ErrorAction SilentlyContinue } catch { return $false }
    }
    if ($content -and $content -match 'token=([A-Za-z0-9_-]+)') {
        return Write-LaunchToken $Matches[1]
    }
    return $false
}

for ($i = 0; $i -lt 150 -and -not $dshProc.HasExited; $i++) {
    if (Save-LaunchToken) { break }
    Start-Sleep -Milliseconds 400
}

if (-not $script:tokenWritten) {
    Write-Host "[start-harness] 启动日志里暂时还没有 token，助手仍在初始化。日志刷出后会自动写入。" -ForegroundColor Yellow
    if (Test-Path $BootErr) {
        $errText = Get-Content $BootErr -TotalCount 8 -ErrorAction SilentlyContinue
        if ($errText) {
            Write-Host "[start-harness] stderr：" -ForegroundColor DarkGray
            $errText | ForEach-Object { Write-Host "  $_" }
        }
    }
}

# 实时透传日志到当前窗口，保持窗口存活。token 若这时才出现，一并写入。
if (Test-Path $BootLog) {
    Write-Host "[start-harness] 实时日志（Ctrl+C 退出，harness 继续运行）：" -ForegroundColor DarkGray
    Get-Content $BootLog -Wait -Tail 30 | ForEach-Object {
        if (-not $script:tokenWritten -and $_ -match 'token=([A-Za-z0-9_-]+)') {
            Write-LaunchToken $Matches[1] | Out-Null
        }
        Write-Host $_
    }
} else {
    $dshProc.WaitForExit()
}
exit $dshProc.ExitCode
