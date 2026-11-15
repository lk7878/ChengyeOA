# 本机 frpc：把工作台/API/助手/知识库打到云机 loopback，不暴露公网端口。
param(
    [string]$Config = (Join-Path $PSScriptRoot 'frpc.toml'),
    [string]$Frpc = (Join-Path $PSScriptRoot 'bin\frpc.exe')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Frpc)) {
    Write-Host "未找到 $Frpc" -ForegroundColor Yellow
    Write-Host "请从 https://github.com/fatedier/frp/releases 下载 Windows amd64，把 frpc.exe 放到 deploy\bin\" 
    exit 1
}
if (-not (Test-Path $Config)) { throw "缺少 $Config" }

# 清掉代理，否则 frpc 连不上云机 → 公网 502
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:NO_PROXY = '*'
$env:no_proxy = '*'

Write-Host "启动 frpc：$Config"
& $Frpc -c $Config
