# setup-standards-kb.ps1
# 在 WeKnora Lite 中创建「标准规范库」并导入 e:\A\konwledge-md 下 5 份鉴定标准。
# 单库 + 文件夹按标准归档 + 标签按标准/场景交叉分类；auto 分块 + 父子分块 + 向量+关键词索引。
#
# 用法:
#   1) 先启动 WeKnora Lite: powershell -File E:\A\WeKnora\start-lite.ps1
#   2) powershell -ExecutionPolicy Bypass -File E:\A\scripts\setup-standards-kb.ps1
#
# 注意: 向量索引需百炼 embedding 密钥(.env.lite 的 EMBEDDING_API_KEY)。
#       未填时文档解析完成、向量索引 failed；填入后对文档 reparse 即可。
# 说明: 用 .NET HttpClient multipart 上传, 避免 PS5.1 ConvertTo-Json 对大字符串的 O(n^2) 卡顿。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Net.Http

$Base = $env:WK_BASE; if (-not $Base) { $Base = 'http://127.0.0.1:8090' }
$KbName = '标准规范库'
$KbDesc = '公共空间标准规范库：工伤致残等级、人体损伤致残程度分级、损伤程度鉴定标准、护理依赖程度评定、三期评定规范。按标准文件夹归档，按标准/场景标签交叉分类。'
$MdDir = 'e:\A\konwledge-md'
$EmbeddingModelId = $env:WK_EMBEDDING_MODEL_ID

function Get-Token {
    try {
        $r = Invoke-RestMethod -Uri "$Base/api/v1/auth/auto-setup" -Method Post -ContentType 'application/json' -TimeoutSec 30
        $t = $r.token; if (-not $t) { $t = $r.data.token }
        return $t
    } catch { throw "auto-setup 失败: $($_.Exception.Message)" }
}
function Wk-Json($obj) { return ($obj | ConvertTo-Json -Depth 20 -Compress) }
function Wk-PostJson($path, $token, $body) {
    $json = Wk-Json $body
    $h = @{ 'Authorization' = "Bearer $token"; 'Content-Type' = 'application/json; charset=utf-8' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Post -Headers $h -Body $bytes -TimeoutSec 60
}
function Wk-Get($path, $token) {
    $h = @{ 'Authorization' = "Bearer $token" }
    return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Get -Headers $h -TimeoutSec 60
}
function Wk-PutJson($path, $token, $body) {
    $json = Wk-Json $body
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri "$Base/api/v1$path" -Method Put -Headers @{ 'Authorization'="Bearer $token"; 'Content-Type'='application/json; charset=utf-8' } -Body $bytes -TimeoutSec 60
}
function Upload-Md($kbId, $token, $filePath, $fileName, $title, $tagIdsCsv, $metaObj) {
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(180)
    $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $fs = [System.IO.File]::OpenRead($filePath)
    try {
        $fc = New-Object System.Net.Http.StreamContent($fs)
        $fc.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('text/markdown')
        $form.Add($fc, 'file', $fileName)
        $form.Add((New-Object System.Net.Http.StringContent($tagIdsCsv)), 'tag_ids')
        $form.Add((New-Object System.Net.Http.StringContent((Wk-Json $metaObj))), 'metadata')
        $resp = $client.PostAsync("$Base/api/v1/knowledge-bases/$kbId/knowledge/file", $form).Result
        $stream = $resp.Content.ReadAsStreamAsync().Result
        $sr = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $txt = $sr.ReadToEnd()
        if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $txt" }
        return ($txt | ConvertFrom-Json).data
    } finally { $fs.Dispose(); $client.Dispose() }
}

# 1) token
Write-Host "==> 获取登录凭证" -ForegroundColor Cyan
$token = Get-Token
Write-Host "  成功" -ForegroundColor Green

# 2) 查/建库
Write-Host "==> 查找知识库 [$KbName]" -ForegroundColor Cyan
$kbId = $null
try {
    $list = Wk-Get '/knowledge-bases?page=1&page_size=200' $token
    $arr = $list.data; if (-not $arr) { $arr = $list.data.items }
    $found = $arr | Where-Object { $_.name -eq $KbName } | Select-Object -First 1
    if ($found) { $kbId = $found.id }
} catch { Write-Host "  列表查询失败: $($_.Exception.Message)" -ForegroundColor Yellow }
if ($kbId) {
    Write-Host "  已存在, 复用 id=$kbId" -ForegroundColor Green
} else {
    $kbBody = @{
        name = $KbName; description = $KbDesc; type = 'document'; embedding_model_id = 'builtin-embedding-bailian'
        chunking_config = @{ strategy='legacy'; chunk_size=512; chunk_overlap=80; enable_parent_child=$false }
        indexing_strategy = @{ vector_enabled=$false; keyword_enabled=$true; wiki_enabled=$false; graph_enabled=$false }
    }
    $created = Wk-PostJson '/knowledge-bases' $token $kbBody
    $kbId = $created.data.id
    Write-Host "  已创建 id=$kbId" -ForegroundColor Green
}

# 3) 标签
Write-Host "==> 创建标签" -ForegroundColor Cyan
$tagNames = @('标准:工伤致残','标准:损伤致残','标准:损伤程度','标准:护理依赖','标准:三期评定','场景:劳动工伤','场景:民事侵权','场景:刑事')
$tagId = @{}
function Get-TagMap($kbId, $token) {
    $m = @{}
    try {
        $tlist = Wk-Get "/knowledge-bases/$kbId/tags" $token
        $arr = $tlist.data.data
        if (-not $arr) { $arr = $tlist.data }
        if (-not $arr) { $arr = $tlist.data.items }
        foreach ($t in $arr) { $m[$t.name] = $t.id }
    } catch {}
    return $m
}
$tagId = Get-TagMap $kbId $token
foreach ($n in $tagNames) {
    if ($tagId[$n]) { continue }
    try {
        $r = Wk-PostJson "/knowledge-bases/$kbId/tags" $token @{ name = $n }
        $tagId[$n] = $r.data.id
        Write-Host "  + $n ($($tagId[$n]))" -ForegroundColor Green
    } catch {
        # 可能已存在(1005), 重新拉取映射
        $tagId = Get-TagMap $kbId $token
        if ($tagId[$n]) { Write-Host "  = $n ($($tagId[$n])) 已存在" -ForegroundColor DarkGray }
        else { Write-Host "  ! $n 创建失败: $($_.Exception.Message)" -ForegroundColor Red }
    }
}

# 4) 5 份标准映射
$stds = @(
    @{ file='2014劳动能力鉴定 职工工伤与职业病致残等级.md'; title='劳动能力鉴定 职工工伤与职业病致残等级 (GB/T 16180-2014)';
       folder='工伤致残'; stdTag='标准:工伤致残'; scene=@('场景:劳动工伤');
       meta=@{ '标准编号'='GB/T 16180-2014'; '发布机构'='国家质量监督检验检疫总局/国家标准化管理委员会'; '发布日期'='2014-09-03'; '施行日期'='2015-01-01'; '适用范围'='职工工伤与职业病致残等级鉴定'; '状态'='现行'; '代替'='GB/T 16180-2006' } }
    @{ file='2016人体损伤致残程度分级.md'; title='人体损伤致残程度分级 (2016)';
       folder='损伤致残'; stdTag='标准:损伤致残'; scene=@('场景:民事侵权');
       meta=@{ '标准编号'='五部委联合发布'; '发布机构'='最高人民法院/最高人民检察院/公安部/国家安全部/司法部'; '发布日期'='2016-04-18'; '施行日期'='2017-01-01'; '适用范围'='人身损害致残程度等级鉴定'; '状态'='现行' } }
    @{ file='人体损伤程度鉴定标准.md'; title='人体损伤程度鉴定标准 (2013)';
       folder='损伤程度'; stdTag='标准:损伤程度'; scene=@('场景:刑事');
       meta=@{ '标准编号'='五部委联合发布'; '发布机构'='最高人民法院/最高人民检察院/公安部/国家安全部/司法部'; '发布日期'='2013-08-30'; '施行日期'='2014-01-01'; '适用范围'='刑法及其他法律法规涉及的人体损伤程度鉴定'; '状态'='现行' } }
    @{ file='人身损害护理依赖程度评定.md'; title='人身损害护理依赖程度评定 (GB/T 31147-2014)';
       folder='护理依赖'; stdTag='标准:护理依赖'; scene=@('场景:民事侵权');
       meta=@{ '标准编号'='GB/T 31147-2014'; '发布机构'='国家质量监督检验检疫总局/国家标准化管理委员会'; '发布日期'='2014-09-03'; '施行日期'='2015-01-01'; '适用范围'='人身损害护理依赖程度评定'; '状态'='现行' } }
    @{ file='人身损害误工期、护理期、营养期评定规范.md'; title='人身损害误工期、护理期、营养期评定规范 (GA/T 1193-2014)';
       folder='三期评定'; stdTag='标准:三期评定'; scene=@('场景:民事侵权');
       meta=@{ '标准编号'='GA/T 1193-2014'; '发布机构'='公安部'; '发布日期'='2014-11-26'; '施行日期'='2014-11-26'; '适用范围'='人身损害误工期/护理期/营养期评定'; '状态'='现行' } }
)

# 5) 导入
Write-Host "==> 导入标准文档" -ForegroundColor Cyan
$imported = @()
foreach ($s in $stds) {
    $p = Join-Path $MdDir $s.file
    if (-not (Test-Path $p)) { Write-Host "  缺文件: $($s.file), 跳过" -ForegroundColor Yellow; continue }
    $ids = @($tagId[$s.stdTag]) + ($s.scene | ForEach-Object { $tagId[$_] })
    $csv = $ids -join ','
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $k = Upload-Md $kbId $token $p $s.file $s.title $csv $s.meta
    Write-Host ("  + [{0}ms] {1} -> {2}" -f $sw.ElapsedMilliseconds, $s.title, $k.id) -ForegroundColor Green
    # 文件夹与标题在解析完成后再应用(解析中会被覆盖), 这里只记录
    $imported += [pscustomobject]@{ title=$s.title; id=$k.id; folder=$s.folder }
}

# 6) 轮询解析
Write-Host "==> 等待解析(最多 180s)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(180); $states = @{}
while ((Get-Date) -lt $deadline) {
    $allDone = $true
    foreach ($k in $imported) {
        if ($states[$k.id] -eq 'completed' -or $states[$k.id] -eq 'failed') { continue }
        try { $d = Wk-Get "/knowledge/$($k.id)" $token; $states[$k.id] = $d.data.parse_status; if ($d.data.parse_status -ne 'completed' -and $d.data.parse_status -ne 'failed') { $allDone = $false } } catch { $allDone = $false }
    }
    if ($allDone) { break }
    Start-Sleep -Seconds 5
}
Write-Host "==> 结果" -ForegroundColor Cyan
foreach ($k in $imported) {
    $st = $states[$k.id]; if (-not $st) { $st = '(未查到)' }
    $c = if ($st -eq 'completed') { 'Green' } elseif ($st -eq 'failed') { 'Red' } else { 'Yellow' }
    Write-Host ("  {0,-12} {1}  [{2}]" -f $st, $k.folder, $k.title) -ForegroundColor $c
}

# 7) 解析完成后再应用文件夹与标题(解析中会被覆盖)
Write-Host "==> 应用文件夹与标题" -ForegroundColor Cyan
foreach ($k in $imported) {
    try {
        Wk-PutJson "/knowledge/$($k.id)" $token @{ title = $k.title } | Out-Null
        Wk-PostJson '/knowledge/folder' $token @{ kb_id=$kbId; knowledge_ids=@($k.id); folder_path=$k.folder } | Out-Null
        Write-Host ("  {0} -> {1}" -f $k.folder, $k.title) -ForegroundColor Green
    } catch { Write-Host ("  ! {0}: {1}" -f $k.title, $_.Exception.Message) -ForegroundColor Red }
}
Write-Host "完成。知识库 id=$kbId  控制台: $Base" -ForegroundColor Cyan
Write-Host "提示: 向量 failed 时, 填 .env.lite 的 EMBEDDING_API_KEY, 重启 start-lite.ps1 后对文档 reparse。" -ForegroundColor Yellow
