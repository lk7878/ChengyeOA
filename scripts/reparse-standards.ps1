# reparse-standards.ps1
# 在填入百炼密钥并重启 WeKnora Lite 后, 对「标准规范库」内全部文档批量重解析,
# 使向量+关键词索引完成。可选: 先把 KB 的 vector_enabled 改为 true 开启语义检索。
#
# 用法:
#   1) 编辑 E:\A\WeKnora\.env.lite, 把 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY 填入真实百炼密钥
#   2) 重启: powershell -File E:\A\WeKnora\start-lite.ps1
#   3) (可选) 开向量: 见脚本末尾注释的 $EnableVector 开关
#   4) powershell -ExecutionPolicy Bypass -File E:\A\scripts\reparse-standards.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Base = $env:WK_BASE; if (-not $Base) { $Base = 'http://127.0.0.1:8090' }
$KbName = '标准规范库'
$EnableVector = $false   # 想开语义检索改 $true (需有效密钥)

function Wk-Get($path, $token) { return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Get -Headers @{ 'Authorization'="Bearer $token" } -TimeoutSec 60 }
function Wk-Post($path, $token, $body) {
    $json = $body | ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Post -Headers @{ 'Authorization'="Bearer $token"; 'Content-Type'='application/json; charset=utf-8' } -Body $bytes -TimeoutSec 60
}
function Wk-Put($path, $token, $body) {
    $json = $body | ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Put -Headers @{ 'Authorization'="Bearer $token"; 'Content-Type'='application/json; charset=utf-8' } -Body $bytes -TimeoutSec 60
}

$r = Invoke-RestMethod -Uri "$Base/api/v1/auth/auto-setup" -Method Post -ContentType 'application/json'; $tok = $r.token; if (-not $tok) { $tok = $r.data.token }
$list = Wk-Get '/knowledge-bases?page=1&page_size=200' $tok
$arr = $list.data; if (-not $arr) { $arr = $list.data.items }
$kb = $arr | Where-Object { $_.name -eq $KbName } | Select-Object -First 1
if (-not $kb) { throw "未找到知识库 [$KbName], 先跑 setup-standards-kb.ps1" }
$kbId = $kb.id
Write-Host "知识库: $KbName ($kbId)" -ForegroundColor Cyan

if ($EnableVector) {
    Wk-Put "/knowledge-bases/$kbId" $tok @{ name=$KbName; config=@{ indexing_strategy=@{ vector_enabled=$true; keyword_enabled=$true; wiki_enabled=$false; graph_enabled=$false } } } | Out-Null
    Write-Host "  已开启向量索引(vector_enabled=true)" -ForegroundColor Green
}

$klist = Wk-Get "/knowledge-bases/$kbId/knowledge?page=1&page_size=200" $tok
$docs = $klist.data; if (-not $docs) { $docs = $klist.data.data }
Write-Host ("待重解析: " + ($docs | Measure-Object).Count + " 份") -ForegroundColor Cyan
$ids = $docs | ForEach-Object { $_.id }
Wk-Post '/knowledge/batch-reparse' $tok @{ kb_id=$kbId; ids=$ids } | Out-Null
Write-Host "  已提交批量重解析" -ForegroundColor Green

Write-Host "等待解析(最多 300s)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(300); $states = @{}
while ((Get-Date) -lt $deadline) {
    $allDone = $true
    foreach ($d in $docs) {
        if ($states[$d.id] -eq 'completed' -or $states[$d.id] -eq 'failed') { continue }
        try { $info = Wk-Get "/knowledge/$($d.id)" $tok; $states[$d.id] = $info.data.parse_status; if ($info.data.parse_status -ne 'completed' -and $info.data.parse_status -ne 'failed') { $allDone = $false } } catch { $allDone = $false }
    }
    if ($allDone) { break }
    Start-Sleep -Seconds 5
}
Write-Host "==> 结果" -ForegroundColor Cyan
foreach ($d in $docs) {
    $info = Wk-Get "/knowledge/$($d.id)" $tok
    $st = $info.data.parse_status; $cc = $info.data.chunk_count
    $c = if ($st -eq 'completed') { 'Green' } elseif ($st -eq 'failed') { 'Red' } else { 'Yellow' }
    Write-Host ("  {0,-10} chunks={1,-4} {2}" -f $st, $cc, $d.title) -ForegroundColor $c
    if ($st -eq 'failed') { Write-Host ("    err: " + $info.data.error_message) -ForegroundColor Red }
}
Write-Host "完成。控制台: $Base" -ForegroundColor Cyan
