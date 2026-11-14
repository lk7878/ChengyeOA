# ChengyeOA 本机预生产任务移交（Claude Code CLI）

**日期：** 2026-07-27  
**工作区：** `D:\2_test\16_ChengyeOA`  
**项目目录：** `D:\2_test\16_ChengyeOA\LayerManage\law-firm-system`  
**状态：** `READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY`；实时只读分类尚未执行  
**当前唯一断点：** Task 3 / Step 1，在原 operator PowerShell 中先执行零数据库连接门禁

本文是迁移到 Claude Code CLI 后的主 handoff。它取代旧 handoff 的 `Current diagnostic breakpoint`，但不删除或改写旧证据。

## 1. 接手后必须完整读取

1. 本文档。
2. `docs/superpowers/handoffs/2026-07-27-local-preproduction-migration-failure-handoff.md`
3. `docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md`
4. `docs/superpowers/plans/2026-07-27-local-preproduction-read-only-database-state-classifier.md`
5. `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/launch-ready.md`
6. `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-i5-review.md`
7. `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/progress.md`

若存在 `CLAUDE.md` 或作用域内 agent 指令也要读取，但它们不能放宽本文的数据库安全边界。

## 2. 执行摘要

迁移启动链已经通过零数据库连接验证。PostgreSQL 强制只读数据库状态分类器已完成实现、测试、修复和独立复核。不要再修 launch chain，也不要运行 initializer/migration。下一步只能在保存了 16 个进程级环境变量的原 operator PowerShell 中先跑零连接门禁；门禁 READY 且操作者再次明确确认后，只调用一次只读分类器，记录结果对应的下一诊断分支并立即停止。

## 3. 绝对约束

- 禁止任何 Git/GitHub 命令，包括只读命令。
- 禁止重跑 initializer 或 migration；禁止自动重试。
- 禁止 reset、repair、seed、bootstrap、应用空表断言、bootstrap contract 或秘密输入提示。
- 禁止删除、清空、重建、重命名或覆盖数据库、schema、表、volume 或 Event Center 历史。
- 用户曾说“如果方便，可以直接删掉之前数据，然后重建”，但未指定精确目标；这不是删除授权。
- 默认 Compose project/volume 含 87 张用户表，必须保持不可达、不可探测、不可修改。
- Docker Compose 只能使用 Core 固定的隔离 project 和有序 base/override 两文件前缀。
- 不读取业务表行，也不读取 `_prisma_migrations.logs`。
- 不输出 URL、凭据、环境值、payload、数据库/角色/migration 名、原始错误、stack、host、PID、worker 或 lock-owner 信息。
- 证据仅限安全状态、布尔值、有界计数、稳定代码、UTC 和耗时。
- 格式异常、非零退出、异常、超时、终止未确认、环境或哈希漂移均须 fail-stop，不得 retry。
- 任一分类结果都不授权写操作；写操作必须另做设计、独立评审和精确授权。

## 4. Claude Code 的进程环境边界

16 个变量只存在于此前已批准的 operator PowerShell 进程中。新开的 PowerShell、Codex 任务或普通 `claude` 进程不会继承它们。

应从原 operator PowerShell 启动 Claude Code：

```powershell
Set-Location -LiteralPath 'D:\2_test\16_ChengyeOA'
claude
```

不要把变量值复制进聊天、文档或日志，也不要重新猜测/生成它们。若原窗口已关闭，当前授权链失效；只能重新执行既有的已批准环境加载/验证流程，不能绕过 16/16 门禁或直接运行分类器。

## 5. 已完成工作

### 历史 live attempt

- 仅一次已授权 initializer；到达 `DATABASE_READY`，在 `MIGRATION` 以 `MIGRATION_FAILED` 停止。
- migration-ready、迁移后断言、bootstrap contract、秘密提示、管理员 bootstrap、自动重试、破坏性恢复均为 0。
- 隔离数据库保留；默认 87 表 volume 未访问。
- 证据：`.codex-safe/sdd/local-preproduction-migrated-retry/live-report.md`。

### 零连接 launch-chain 分类

- 16/16 环境、Node/npm 精确固定、production true、Worker disabled true。
- direct server deploy help READY。
- root → server → Prisma → help 全链到达，exit code 0。
- 两次完整一致性迭代 READY；migration/initializer executions 0。
- 早期一次 root delegation failure 未复现，保留为历史证据，不能写成“从未发生”。

旧 handoff 的 launch-chain 断点已完成，禁止重来。

### 只读数据库状态分类器

- 实现：`.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`
- 专用测试：`.codex-safe/tests/LocalPreproduction.DatabaseStateClassifier.Tests.ps1`
- Workflow 测试：`.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- baseline 在数据库连接前离线构建，Prisma mapped-model set 与 migration `CREATE TABLE` set 必须精确相等。
- 至多两条 aggregate-only probe；Probe 2 只有在 Probe 1 所有守卫通过后可达。
- session 从启动通过 `PGOPTIONS` 强制 read-only，并带 statement/lock timeout。
- `psql` 固定参数为 `-X -qAt -v ON_ERROR_STOP=1 -w`。
- 只读批准的 catalog/schema 元数据和 `_prisma_migrations` 三个批准字段，不读业务行或 logs。
- 输出恰好一个安全 record；原生执行有界并确认完整进程树终止。

### 独立评审问题均已解决

- I1：模型集合与建表集合精确相等，不能只比数量。
- I2：0 应用表 + 完整 migration set 必须 `INCONSISTENT`。
- I3：三个 migration 状态类别之和必须精确等于 records。
- I4：补齐 mutation-resistant SQL/source/parser/baseline/Compose/exception/termination 覆盖。
- I5：`expectedNameMatchCount + unexpectedNameCount == distinctMigrationNameCount`。
- Workflow timing：已有 3500ms 有界等待后重新采样 descendant lock 状态。

最终 verdict：I1-I5 ADDRESSED，Workflow fix PASS，SPEC/TASK PASS，Critical/Important/Minor 0/0/0，launch readiness READY。

## 6. 最终验证证据

- focused classifier：81/81，failed 0，skipped 0。
- authoritative Core + Workflow + classifier：197/197，failed 0，skipped 0，183.3s。
- AST：6 files / 0 errors；protected hashes 3/3。
- `psql` sites 2；read-only option sites 2；15000ms timeout sites 2；fixed builder sites 2。
- direct writers、migration-log references、probe SQL write/procedural tokens、recursive baseline search：均为 0。
- live classifier、Docker、DB、Prisma、npm、initializer、migration、reset、bootstrap、network、operator input、default volume：均为 0。

不要为了接手重跑完整 197 项套件。只有代码、测试或保护文件变化时才按计划重验和重新独立评审。

## 7. 审定哈希

```text
classifier         57369E6B28AA4CACE93A854A46947A71CB6E611838DC5D8C324D4762014ECB3F
classifierTests    FED97F842684C19D1855ECCB845F5242E75AC3A2FF7733F47BDE3B7577A6028E
workflowTests      D9C9EDEA94787140FCFFB40E854E717296DC0B85AE1C2924677AE33E3AEFCBE6
independentReview  9C87300C769D502A013867775BE22BD2DD6222D8FD582473593B3FBF7D199C6C
design             24A89B00E4A3CBD242B4820C64F956EF242EA599A825D5C3D0047BF870DB0B5F
plan               BC827788E919E11C357B30789DCECB06E54579624C964C3CD43C3B0352F72DFC
```

哈希不匹配时只报告失败类别，不显示内容或秘密，不运行 live classifier。

## 8. 当前精确断点

Task 1、Task 2 已完成。Task 3 尚未真正开始：最终 READY 后的 operator-shell 零连接门禁未运行，live read-only classifier 未运行，本次实时结果未写入 `live-report.md`。

Claude Code 的首个项目动作必须是第 9 节零连接门禁。该门禁自身不得调用 Docker/PostgreSQL。

## 9. 零数据库连接门禁

在工作区根目录运行。只检查环境是否存在、工具版本、模式、READY 文本和文件哈希，不显示环境值。

```powershell
$required = @(
  'POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','POSTGRES_PORT',
  'POSTGRES_TEST_USER','POSTGRES_TEST_PASSWORD','POSTGRES_TEST_DB',
  'DATABASE_URL','JWT_SECRET','APP_KEYS','CORS_ALLOWED_ORIGINS',
  'MFA_ENCRYPTION_KEY_V1','NODE_ENV','EVENT_WORKER_ENABLED','HOST','PORT'
)
$present = @($required | Where-Object {
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_,'Process'))
}).Count
$nodeVersion = [string](& node --version 2>$null); $nodeExit = $LASTEXITCODE
$npmVersion = [string](& npm --version 2>$null); $npmExit = $LASTEXITCODE
$readyPath = '.\.codex-safe\sdd\local-preproduction-read-only-database-state-classifier\launch-ready.md'
$readyText = if (Test-Path -LiteralPath $readyPath) { Get-Content -LiteralPath $readyPath -Raw } else { '' }
$hashes = [ordered]@{
  classifier = if (Test-Path '.\.codex-safe\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1') { (Get-FileHash '.\.codex-safe\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1' -Algorithm SHA256).Hash } else { '' }
  tests = if (Test-Path '.\.codex-safe\tests\LocalPreproduction.DatabaseStateClassifier.Tests.ps1') { (Get-FileHash '.\.codex-safe\tests\LocalPreproduction.DatabaseStateClassifier.Tests.ps1' -Algorithm SHA256).Hash } else { '' }
  workflow = if (Test-Path '.\.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1') { (Get-FileHash '.\.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1' -Algorithm SHA256).Hash } else { '' }
}
$checks = [ordered]@{
  nodePinned = ($nodeExit -eq 0 -and $nodeVersion.Trim() -ceq 'v22.14.0')
  npmPinned = ($npmExit -eq 0 -and $npmVersion.Trim() -ceq '10.9.2')
  productionMode = ([Environment]::GetEnvironmentVariable('NODE_ENV','Process') -ceq 'production')
  workerDisabled = ([Environment]::GetEnvironmentVariable('EVENT_WORKER_ENABLED','Process') -ceq 'false')
  launchReady = ($readyText -match '(?m)^READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY$')
  liveZero = ($readyText -match '(?m)^LIVE_DATABASE_CLASSIFIER_EXECUTED=0$')
  migrationZero = ($readyText -match '(?m)^LIVE_MIGRATION_EXECUTED=0$')
  initializerZero = ($readyText -match '(?m)^LIVE_INITIALIZER_EXECUTED=0$')
  classifierHash = ($hashes.classifier -ceq '57369E6B28AA4CACE93A854A46947A71CB6E611838DC5D8C324D4762014ECB3F')
  testsHash = ($hashes.tests -ceq 'FED97F842684C19D1855ECCB845F5242E75AC3A2FF7733F47BDE3B7577A6028E')
  workflowHash = ($hashes.workflow -ceq 'D9C9EDEA94787140FCFFB40E854E717296DC0B85AE1C2924677AE33E3AEFCBE6')
}
$ok = ($present -eq $required.Count -and @($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0)
[pscustomobject]@{
  status = if ($ok) { 'READY' } else { 'BLOCKED' }
  environmentPresent = $present; environmentRequired = $required.Count
  nodePinned = $checks.nodePinned; npmPinned = $checks.npmPinned
  productionMode = $checks.productionMode; workerDisabled = $checks.workerDisabled
  launchReady = $checks.launchReady; liveClassifierRecordedZero = $checks.liveZero
  migrationRecordedZero = $checks.migrationZero; initializerRecordedZero = $checks.initializerZero
  classifierHashMatched = $checks.classifierHash; classifierTestsHashMatched = $checks.testsHash
  workflowTestsHashMatched = $checks.workflowHash
  databaseConnections = 0; initializerExecutions = 0; migrationExecutions = 0
  alertCodes = if ($ok) { @() } else { @('READ_ONLY_CLASSIFIER_PRELAUNCH_GATE_FAILED') }
}
```

若不是 READY，只调查失败门禁并停止。不得自动修环境、替换哈希或改写 READY 证据。

## 10. 唯一一次 live read-only classification

门禁 READY 后，先展示安全门禁结果，并取得对“运行一次只读数据库状态分类器”的明确确认。确认后只能原样运行：

```powershell
& '.\.codex-safe\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1'
```

不得加 pipe、格式化、展开、重定向、包装或自动 retry。只接受恰好一个 `phase=READ_ONLY_DATABASE_STATE` 的安全 record：READY + 一个批准分类，或 BLOCKED + 一个批准 alert。

随后仅把安全 record、bounded counts、UTC 和 elapsed 写入 `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/live-report.md`，选择下一分支并停止。

## 11. 结果分支（只记录，不执行）

| 单次结果 | 下一诊断方向 |
|---|---|
| `DATABASE_STATE_NO_EFFECT` | 离线调查 pre-schema execution boundary |
| `DATABASE_STATE_METADATA_ONLY` | 离线检查第一条 migration SQL 及前置条件；共享证据不写名称 |
| `DATABASE_STATE_PARTIAL` | 保留现场，另行设计和评审 partial forensic classifier |
| `DATABASE_STATE_COMPLETE` | 不再 migration，调查 native wrapper/exit path |
| `DATABASE_STATE_INCONSISTENT` | 另行设计和评审 forensic plan |
| 任一 `BLOCKED` | 只调查对应 guard |

## 12. 开发过程中踩过的坑与规避

1. **旧断点过期。** launch-chain 已完成；以本文第 8 节为准，不要从旧断点重跑。
2. **新终端丢进程环境。** 从原 operator PowerShell 启动 `claude`，先做 16/16 门禁，不打印值。
3. **PATH 有多个 npm/npx 候选。** “能运行”不等于工具链正确；必须精确匹配 Node `v22.14.0`、npm `10.9.2`。
4. **一次 root delegation failure 被当成稳定根因。** 保留该历史，但以之后精确 trace 和两轮 READY 为可复现结论。
5. **fixture 可构造 SQL 不可能产生的计数组合。** aggregate fixture 必须满足分区恒等式；矛盾组合应回归为 INCONSISTENT。
6. **同数量不等于同集合。** 在 native/DB access 前精确比较 Prisma models 与 migration CREATE TABLE set。
7. **0 应用表 + 完整 migration set 易误判 metadata-only。** INCONSISTENT 结构/算术守卫必须优先。
8. **只用大小关系检查 migration 聚合不充分。** expected/unexpected、状态类别、records/distinct/duplicates 均用精确恒等式。
9. **测试与实现可能共享同一错误。** 使用固定批准源、负向 mutation、same-count substitution、comma rejection、异常和 termination 矩阵。
10. **Windows 进程树状态采样过早。** 3500ms 有界等待后要重新采样；不用无限 sleep，也不放宽生产终止保证。
11. **超时或失败没有命名 failure object。** 历史 timeout、164/165、196/197 等必须保留；最终 197/197 不代表它们从未发生。
12. **raw native/DB 输出可能泄密。** 捕获但不显示，只发稳定 code、布尔值和 bounded counts。
13. **“可以删”不是精确删除授权。** 当前零删除；未来须确认精确目标、证明不是 87 表默认 volume、说明恢复路径并单独授权。
14. **READY 不等于允许 migration。** 它只授权一次只读 classifier；结果后立即停止。

## 13. 不要重复做

- 不重新实现 launch-chain classifier，不重跑 initializer/migration，不为接手重跑 197 项套件。
- 不改写或删除早期 BLOCKED、RED、timeout、flaky evidence。
- 不修改 classifier/tests 后继续沿用旧 launch-ready 哈希。
- 不接触默认 Compose project/87 表 volume，不先连 DB 再验 baseline/环境/哈希。
- 不根据分类自行执行下一次数据库操作，不运行 Git/GitHub。

## 14. Claude Code 续接提示词

```text
继续 ChengyeOA 本机预生产初始化诊断。工作区 D:\2_test\16_ChengyeOA。
先完整读取 docs/superpowers/handoffs/2026-07-27-local-preproduction-read-only-classifier-claude-code-handoff.md 及其第 1 节全部文件。
严格从 Task 3 Step 1 继续；旧 launch-chain breakpoint 已完成，不要重做。
禁止 Git/GitHub、initializer、migration、reset、repair、bootstrap、删除/重建、默认 87 表 volume 访问和自动重试；不打印秘密或 raw 输出。
先在继承原 operator PowerShell 环境的会话执行第 9 节零数据库连接门禁，不调用 Docker/PostgreSQL。BLOCKED 时只调查 guard 并停止。
READY 时先展示安全门禁记录，并请求对一次只读分类器调用的明确确认。确认后只原样运行一次：
& '.\.codex-safe\Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1'
不加 pipe/格式化/包装/retry。写安全 live-report，只记录下一分支，然后停止。任何结果都不授权写操作。
```

实时分类完成后，只能向本文追加单次安全结果、UTC/elapsed、bounded operation counts、所选分支和 `live-report.md` 哈希，不覆盖历史。
