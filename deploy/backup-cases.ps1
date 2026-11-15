# 备份案件目录到非系统盘（默认 E:\A\backups）。建议加入每日计划任务。
param(
    # 默认备份公网部署数据；本地可传 -CasesRoot E:\A\cases
    [string]$CasesRoot = 'E:\A_Medical_DATA\cases',
    [string]$BackupRoot = 'E:\A_Medical_DATA\backups\cases',
    [int]$KeepDays = 14
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dest = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null
if (-not (Test-Path $CasesRoot)) { throw "案件目录不存在: $CasesRoot" }
robocopy $CasesRoot $dest /E /R:2 /W:2 /NFL /NDL /NP | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) { throw "robocopy 失败，退出码 $code" }

Get-ChildItem $BackupRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{8}-' } |
    Sort-Object Name |
    Select-Object -SkipLast $KeepDays |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

$weknora = 'E:\A\WeKnora\data'
if (Test-Path $weknora) {
    $wkDest = Join-Path 'E:\A\backups\weknora' $stamp
    New-Item -ItemType Directory -Force -Path $wkDest | Out-Null
    robocopy $weknora $wkDest /E /R:2 /W:2 /NFL /NDL /NP | Out-Null
}

Write-Host "备份完成: $dest"
