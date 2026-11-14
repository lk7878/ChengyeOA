# Chengye OA 跨电脑迁移 Handoff

## 16. 2026-07-22 SPEC-007 可靠事件中心状态

SPEC-007 的 Tasks 1–10、Node 22.14.0 最终全量验证和独立只读终审均已完成。最终 re-review 为 `Ready to close: Yes`，当前无开放 Critical、Important 或 Minor。

当前能力包括 PostgreSQL Outbox、并发安全 Dispatcher、租约 Worker、有序阻塞、固定重试/MANUAL、治理审核通知幂等闭环、Egg 生命周期、`events:drain`、事件运维 API/Web 页面及目标绑定 Step-Up 人工重试。运维手册位于 `docs/superpowers/runbooks/reliable-event-center-outbox.md`，closeout 位于 `docs/superpowers/reports/spec-007-closeout.md`。

Task 10 验收与终审整改聚焦测试已通过。Dispatcher 现在先校验完整 registry/envelope，未知或损坏事件保持未分发并创建唯一持久化 MANUAL 隔离证据；Summary 合并持久化 Dispatcher 与 Worker 数据库健康，Web 显示 degraded 与内部只读隔离订阅。主演练只接受字面相同且解析为 `localhost:55432/chengye_oa_test` 的两个 URL。持久化 SDD reports/closeout/handoffs 已脱敏并由文档泄漏扫描保护。真实 rehearsal 首轮处理 1 个事件并产生 1 条唯一通知，重跑为空，finally 后所有应用表为空。11 迁移隔离恢复只使用本地 `chengye_oa_test` → `chengye_oa_restore_test`，恢复后显式 drain 没有重复既有成功通知；恢复库已删除、源 fixture 已清理、源测试库已为空。权威 dump 为 `spec-007-event-center-20260722T115912123Z.dump`，SHA-256 为 `05d99194dba95d8e937651d1c284edea717f67c6994646159a1d1427e8055474`；报告不包含凭据、MFA 密钥或业务 secrets。

最终权威门禁：Server 129 个测试文件中排除唯一会内部执行 Git 的 contract，以 128 文件串行运行 823 tests / 821 passed / 0 failed / 2 skipped；coverage statements/lines 85.04%、branches 83.96%、functions 91.85%。Server lint/typecheck/build、构建产物与持久化文档 leakage 均全绿；Web 32 files / 102 tests 全绿、typecheck/build 通过、lint 0 errors/9 个既有 warnings；Server full/production audit 均 0 high/critical，Web audit 0 vulnerabilities，安全测试 38/38。当前迁移数 11、Prisma models 44，最终所有应用表为空且恢复库数量 0。新 development-only `serialize-javascript` high 已通过 `7.0.7` override 消除而未扩大例外。早期一次广泛测试内部调用过一次只读 `git ls-files --stage`，无 Git 写入、无工作区变化；发现后已排除，最终验证采用显式 no-Git 清单。完整记录位于 `.superpowers/sdd/task-10-report.md`。

复审后的备份清理已完成：失败恢复尝试的非权威 dump 与被取代的历史 10 迁移 dump 均已删除。备份目录只保留 SPEC-006 权威 `chengye_oa.dump` 和 SPEC-007 权威 `spec-007-event-center-20260722T115912123Z.dump`；两者均不得作为临时文件删除。

继续工作的硬约束：不得执行任何 Git/GitHub 命令（包括只读命令）；全量 Server 测试必须串行。`test/ci/distribution-config-contract.test.ts` 内部实际调用 Git，因此不得运行；必须使用排除此单文件的无 Git 等价清单，并在报告中透明记录。不得删除或改写 EventLog、Delivery、HandlerLog 或人工重试审计。

> 日期：2026-07-21  
> 用途：将承业 OA 的后续开发从当前 Windows 电脑迁移到另一台 Windows 电脑，并继续使用 ChatGPT 桌面端 Codex 进行开发  
> 当前源工作区：`D:\2_test\16_ChengyeOA\.worktrees\spec-004-rbac-data-scope`  
> 当前分支标识：`codex/spec-004-rbac-data-scope`  
> 当前基准提交：`1341f74cec03c68ba8e4200e0fffebe59de198bc`  
> 重要状态：活动工作树包含大量已完成但未提交的 SPEC-004 文件，以及已批准的 SPEC-005 Spec 和实施 Plan；不能只重新克隆 `main`

## 1. 项目目标

承业 OA 是覆盖律所经营全链路的综合管理系统，以 LayerManage 为经营 OA 基座，逐步融合 LawLink 的案件交付能力，并参考 LexNebulis 的安全、审计、客户门户和企业级集成设计。

系统目标是串联：

```text
品牌与流量获客
  -> 线索与客服邀约
  -> 谈案与两类合同
  -> 收款与经营统计
  -> 案件办理与交付
  -> 客户复购与转介绍
```

同时覆盖总所、地区分所、前瞻研究部、律师培训部、品牌宣传部和后续预留团队分类。

## 2. 当前技术基线

| 项目 | 已确认基线 |
| --- | --- |
| 操作系统 | Windows + PowerShell |
| Node.js | `22.14.0` |
| npm | `10.9.2` |
| 服务端 | Egg.js 3 + TypeScript |
| 前端 | React 19 + Ant Design 6 + Zustand |
| ORM | Prisma 5.22 |
| 数据库 | PostgreSQL 16，Docker，本地端口 `55432` |
| 测试 | Node test runner、Vitest、Testing Library、Playwright 1.55.1 |
| Python | 当前 SPEC-005 开发不需要；无需为了迁移提前安装 |

Python 仅在以后出现独立 Python 脚本、数据分析或本地文档处理需求时再安装。当前 OA 的安装、数据库迁移、开发、测试和构建全部由 Node.js、npm、Docker 和项目脚本完成。

## 3. 已完成工作

1. SPEC-001：工程基线与 PostgreSQL 单库收敛。
2. SPEC-002：系统初始化、首位超级管理员信任根和凭据恢复。
3. SEC-SPEC-001：依赖和供应链安全治理。
4. SPEC-003：组织、岗位、员工、任职、汇报关系、专业团队和账号绑定。
5. SPEC-004：RBAC、数据范围、敏感字段权限、授权追踪和前端权限中心，已完成本地实施与验收。
6. SPEC-005：系统管理员治理、超级管理员审核和受控数据干预，业务 Spec 已批准，实施 Plan 已完成并自审。

SPEC-005 尚未开始编码。下一步是执行实施 Plan 的 Task 1。

## 4. 权威文档

迁移后先检查以下文件是否存在：

```text
docs/superpowers/specs/2026-07-21-admin-governance-super-admin-review-design.md
docs/superpowers/plans/2026-07-21-admin-governance-super-admin-review-implementation.md
docs/superpowers/reports/spec-004-closeout.md
docs/superpowers/runbooks/rbac-data-scope-sensitive-permissions.md
docs/superpowers/handoffs/2026-07-21-cross-device-migration-handoff.md
LayerManage/law-firm-system/package.json
LayerManage/law-firm-system/apps/server/prisma/schema.prisma
LayerManage/law-firm-system/infra/postgres/compose.yml
```

原始需求资料也要单独携带：

```text
律所闭环管理系统需求开发文档.md
律所管理系统PRD.docx
承业律师事务所整体发展框架设计方案.docx
```

## 5. 为什么不能只在新电脑重新克隆

当前活动工作树相对基准提交包含大量修改、删除和未跟踪文件。它们包括 SPEC-004 的正式实现、数据库迁移、测试、前端页面、验收证据以及 SPEC-005 文档。

`main` 当前不是完整开发成果来源。仅执行普通克隆或仅复制 `LayerManage` 根目录会产生以下问题：

1. 丢失未提交实现和新增文件。
2. 丢失已删除的 SQLite 迁移代码状态。
3. 丢失 SPEC-004 测试、前端权限中心和迁移文件。
4. 丢失 SPEC-005 Spec、Plan 和本 handoff。
5. 复制原 worktree 的 `.git` 指针文件后，可能因旧电脑绝对路径失效。

因此推荐使用“活动工作树文件快照 + Git 历史 bundle”组合迁移。

## 6. 推荐迁移包

在旧电脑准备一个外部目录，例如：

```text
D:\ChengyeOA-transfer-20260721\
  chengye-oa-working-snapshot.zip
  chengye-oa-history.bundle
  SHA256SUMS.txt
  reference-documents\
    律所闭环管理系统需求开发文档.md
    律所管理系统PRD.docx
    承业律师事务所整体发展框架设计方案.docx
```

### 6.1 工作树快照

快照来源必须是：

```text
D:\2_test\16_ChengyeOA\.worktrees\spec-004-rbac-data-scope
```

快照包括源码、Prisma 迁移、测试、前端、Spec、Plan、runbook、handoff 和验收报告。

以下内容不进入快照，因为可以重新生成或包含本机敏感信息：

```text
.git
node_modules
dist
logs
run
var
test-results
playwright-report
.env
.env.local
.env.production
.env.test
```

PowerShell 示例：

```powershell
$source = 'D:\2_test\16_ChengyeOA\.worktrees\spec-004-rbac-data-scope'
$transfer = 'D:\ChengyeOA-transfer-20260721'
New-Item -ItemType Directory -Force -Path $transfer | Out-Null

tar.exe -a -c -f "$transfer\chengye-oa-working-snapshot.zip" `
  --exclude='.git' `
  --exclude='*/node_modules' `
  --exclude='*/dist' `
  --exclude='*/logs' `
  --exclude='*/run' `
  --exclude='*/var' `
  --exclude='*/test-results' `
  --exclude='*/playwright-report' `
  --exclude='.env' `
  --exclude='*/.env' `
  --exclude='*/.env.local' `
  --exclude='*/.env.production' `
  --exclude='*/.env.test' `
  -C $source .
```

### 6.2 Git 历史包

Git bundle 只保存历史和分支，不包含未提交文件；因此必须与工作树快照同时使用。

```powershell
$repository = 'D:\2_test\16_ChengyeOA'
$transfer = 'D:\ChengyeOA-transfer-20260721'
git -C $repository bundle create "$transfer\chengye-oa-history.bundle" --all
git -C $repository bundle verify "$transfer\chengye-oa-history.bundle"
```

这不会提交、合并或推送代码，也不会修改当前开发历史。

### 6.3 原始需求资料

```powershell
$repository = 'D:\2_test\16_ChengyeOA'
$reference = 'D:\ChengyeOA-transfer-20260721\reference-documents'
New-Item -ItemType Directory -Force -Path $reference | Out-Null
Copy-Item -LiteralPath "$repository\律所闭环管理系统需求开发文档.md" -Destination $reference
Copy-Item -LiteralPath "$repository\律所管理系统PRD.docx" -Destination $reference
Copy-Item -LiteralPath "$repository\承业律师事务所整体发展框架设计方案.docx" -Destination $reference
```

### 6.4 校验文件

```powershell
$transfer = 'D:\ChengyeOA-transfer-20260721'
Get-FileHash -Algorithm SHA256 `
  "$transfer\chengye-oa-working-snapshot.zip", `
  "$transfer\chengye-oa-history.bundle" |
  ForEach-Object { "$($_.Hash)  $([IO.Path]::GetFileName($_.Path))" } |
  Set-Content -LiteralPath "$transfer\SHA256SUMS.txt" -Encoding ascii
```

把整个 `D:\ChengyeOA-transfer-20260721` 复制到移动硬盘、局域网共享目录或其他受控介质。不要通过公开网盘传输真实 `.env` 或 API Key。

## 7. 环境变量处理

不要把旧电脑真实 `.env` 放入普通源码压缩包。

新电脑优先根据以下文件重新创建：

```text
LayerManage/law-firm-system/apps/server/.env.example
```

当前本地开发至少需要：

```text
DATABASE_URL
DATABASE_URL_TEST
JWT_SECRET
APP_KEYS
```

未来音频转写和 AI 提取可能使用：

```text
FAL_AI_API_KEY
DASHSCOPE_API_KEY
对应供应商 BASE_URL
```

SPEC-005 不依赖 FAL 或 DashScope，可以等对应 AI Spec 开发时再配置。新电脑应生成新的本地 `JWT_SECRET` 和 `APP_KEYS`，无需沿用旧电脑值。确需保留的第三方 API Key 通过密码管理器或加密介质单独迁移。

## 8. 数据库迁移策略

当前没有需要保留的经营数据，PostgreSQL 也可以保持空数据库。因此：

1. 不复制 Docker volume。
2. 不导出或迁移 SQLite。
3. 不复制本地数据库备份、日志或测试数据。
4. 新电脑通过 Docker Compose 创建 PostgreSQL 16。
5. 使用 Prisma 正式迁移重新建立结构。
6. 测试库始终以 `_test` 结尾。

## 9. 新电脑恢复步骤

以下示例把最终工作区恢复到：

```text
D:\2_test\16_ChengyeOA
```

路径可以更换；不要直接复制旧 worktree 的 `.git` 指针文件。

### 9.1 校验迁移包

```powershell
$transfer = 'E:\ChengyeOA-transfer-20260721'
Get-Content -LiteralPath "$transfer\SHA256SUMS.txt"
Get-FileHash -Algorithm SHA256 `
  "$transfer\chengye-oa-working-snapshot.zip", `
  "$transfer\chengye-oa-history.bundle"
```

人工确认两个 Hash 与 `SHA256SUMS.txt` 一致。

### 9.2 恢复可移植 Git 元数据

```powershell
$transfer = 'E:\ChengyeOA-transfer-20260721'
$metadata = 'D:\2_test\chengye-oa-metadata-temp'
$workspace = 'D:\2_test\16_ChengyeOA'

git clone --branch codex/spec-004-rbac-data-scope `
  "$transfer\chengye-oa-history.bundle" `
  $metadata

New-Item -ItemType Directory -Force -Path $workspace | Out-Null
Expand-Archive -LiteralPath "$transfer\chengye-oa-working-snapshot.zip" -DestinationPath $workspace
Copy-Item -LiteralPath "$metadata\.git" -Destination "$workspace\.git" -Recurse -Force
```

完成后，`D:\2_test\16_ChengyeOA` 是普通独立仓库，不再依赖旧电脑 `.worktrees` 的绝对路径。

确认目标目录是新建空目录后再执行 `Expand-Archive`。如果目标已存在，不要覆盖，先选择另一个新目录。

### 9.3 核对恢复状态

```powershell
git -C 'D:\2_test\16_ChengyeOA' branch --show-current
git -C 'D:\2_test\16_ChengyeOA' rev-parse HEAD
git -C 'D:\2_test\16_ChengyeOA' status --short
```

预期：

```text
branch = codex/spec-004-rbac-data-scope
HEAD   = 1341f74cec03c68ba8e4200e0fffebe59de198bc
status = 包含大量修改、删除和未跟踪文件
```

长 `status` 是当前快照被正确恢复的表现，不要执行 `git reset --hard`、`git clean` 或 checkout 覆盖。

### 9.4 检查工具版本

```powershell
git --version
node --version
npm --version
docker --version
docker compose version
```

如果全局 Node 不是 `22.14.0`，无需卸载现有 Node，也无需安装 Python。后续项目命令统一使用：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd <项目命令>
```

### 9.5 安装依赖

从新工作区的 `LayerManage\law-firm-system` 执行：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/web ci
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
```

不要复制旧电脑 `node_modules`。重新安装通常比迁移依赖目录更快、更可靠。

### 9.6 启动 PostgreSQL

确认 Docker Desktop 已启动，然后：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:up
docker compose -f infra/postgres/compose.yml ps
```

开发库和测试库连接信息根据 `.env.example` 配置。当前约定端口是 `55432`。

### 9.7 第一次验证

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = '<redacted local development URL>'
$env:DATABASE_URL_TEST = '<redacted local test URL>'
$env:JWT_SECRET = '<generate a local value of at least 32 characters>'
$env:APP_KEYS = '<generate two local application keys separated by a comma>'
$env:ALLOW_TEST_DB_RESET = 'true'

npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:reset:test
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run verify
```

预期：完整验证退出码为 0。记录实际测试数量；不要直接沿用旧电脑历史报告中的数量。

## 10. ChatGPT 桌面端与 Codex 续接

新电脑已经安装 ChatGPT 桌面端即可。即使同一账号能够看到历史任务，也不要只依赖聊天历史，因为本地路径、Docker 状态、环境变量和未提交文件需要重新确认。

在 ChatGPT 桌面端中：

1. 把工作空间设置为新电脑的 `D:\2_test\16_ChengyeOA`。
2. 打开或新建 Codex 任务。
3. 发送下面的启动指令。

```text
请先扫描 docs/superpowers/handoffs/2026-07-21-cross-device-migration-handoff.md，
再扫描 docs/superpowers/specs/2026-07-21-admin-governance-super-admin-review-design.md
和 docs/superpowers/plans/2026-07-21-admin-governance-super-admin-review-implementation.md。
先核对当前工作区、Node 22.14.0、npm 10.9.2、Docker PostgreSQL 和基线测试；
不要执行任何 Git 或 GitHub 操作；确认基线后使用 executing-plans 从 SPEC-005 Task 1 开始编码，
减少不必要的 subagent 调用，并持续提示剩余时间。
```

## 11. 下一项开发任务

执行：

```text
docs/superpowers/plans/2026-07-21-admin-governance-super-admin-review-implementation.md
```

起点：

```text
Task 1: Add Governance Persistence, Permissions, and the Reserved System-Admin Role
```

执行方式：

```text
superpowers:executing-plans
```

默认不使用 subagent。只有最终独立代码审查或视觉验收确实可以并行时，才使用一个受限 subagent。

## 12. 已知注意事项和踩坑

1. 本机全局 Node 曾为 24，而项目基线是 Node `22.14.0`；最终验证必须使用固定工具链。
2. Egg 应用测试通常同时需要 `DATABASE_URL` 和 `DATABASE_URL_TEST`。
3. 测试数据库名必须以 `_test` 结尾，且重置需要 `ALLOW_TEST_DB_RESET=true`。
4. PostgreSQL 由 `infra/postgres/compose.yml` 管理，当前约定主机端口 `55432`。
5. 当前工作成果主要是未提交文件；长 `git status` 不是异常。
6. 不要执行 `git reset --hard`、`git clean`、`git checkout --` 或其他清理命令。
7. 不要恢复 SQLite 迁移代码；原 SQLite 没有有价值的经营数据，项目已收敛到 PostgreSQL。
8. 不要把旧 `node_modules`、构建目录、测试报告缓存或 Docker volume 带到新电脑。
9. 不要把 `.env`、API Key、JWT 密钥和应用密钥放入普通迁移压缩包或 Codex 对话。
10. SPEC-005 文档已完成，尚未编码；不要重复需求讨论或重新生成另一份 Spec/Plan。
11. 当前项目不依赖 Python，缺少 Python 不构成迁移或开发阻塞。

## 13. 迁移验收清单

- [ ] 工作树快照和 Git bundle 的 SHA-256 一致。
- [ ] 三份原始需求资料已单独复制。
- [ ] 新电脑最终工作区是普通目录，不依赖旧 `.worktrees` 路径。
- [ ] 当前分支和基准提交与本 handoff 一致。
- [ ] `git status --short` 显示现有修改、删除和未跟踪成果。
- [ ] SPEC-004 closeout、SPEC-005 Spec、SPEC-005 Plan 和本 handoff 均存在。
- [ ] `.env` 已在新电脑重新创建，真实密钥未进入源码包。
- [ ] Node 22.14.0 和 npm 10.9.2 可用。
- [ ] Docker Desktop 和 PostgreSQL 16 正常。
- [ ] 三层 npm 依赖重新安装完成。
- [ ] Prisma Client 重新生成。
- [ ] 测试数据库重置保护有效。
- [ ] 完整 `npm run verify` 通过。
- [ ] Codex 已读取本 handoff，并从 SPEC-005 Task 1 继续。

## 14. 迁移完成后的清理

只有新电脑完成第 13 节全部验收并确认源码、文档和测试无缺失后，才考虑清理：

1. 新电脑的临时 `chengye-oa-metadata-temp`。
2. 旧电脑的迁移中间目录。
3. 移动介质上的未加密临时副本。

在新电脑验收完成前，不删除旧电脑工作区，不清理旧 worktree，不清理迁移包。

## 15. 2026-07-21 新电脑续开发状态（当前权威增量）

本节覆盖前文“SPEC-005 尚未编码”的历史描述。迁移已在 `D:\2_test\16_ChengyeOA` 恢复，SPEC-005 已完成。SPEC-006 及最终安全审阅整改 Task 10 已全部完成。

已完成：

1. TOTP/Base32、AES-256-GCM 因子密钥、opaque token、Step-Up 目标摘要和生产环境 fail-closed 配置。
2. `MfaFactor`、`MfaRecoveryCode`、`AuthChallenge`、`AuthSession`、`StepUpGrant` 正式迁移。
3. 四态登录、强制改密衔接、管理员强制 MFA、恢复码、15 分钟访问令牌、30 天绝对会话、刷新凭据轮换/重用响应和 CSRF。
4. purpose/user/session/target 绑定且一次性消费的 Step-Up；HIGH/CRITICAL 治理 create/approve/retry 已接入。
5. 普通用户 MFA 管理、会话撤销、`ADMIN_MFA_RESET` 治理动作和 sole-super-admin `admin-mfa:reset` CLI。
6. Web 凭据只在模块内存；启动 refresh-once；登录/MFA UI；账号安全页；治理 Step-Up 对话框。
7. 运维 runbook：`docs/superpowers/runbooks/identity-security-mfa-step-up.md`。

最终验证证据：

- 干净测试库重置成功，9 个迁移按顺序应用，Prisma 模型数为 40。
- Server 最终 c8 套件：664/664，失败 0。
- Server 覆盖率：statements/lines 83.59%，branches 83.83%，functions 91.18%。`cov` 使用 c8 包裹真实串行 `node:test` 运行器。
- Server lint、typecheck、build 全部通过；生产依赖审计为 0 high、0 critical（仅 4 moderate Egg 传递依赖）。
- Web：28 个测试文件、76/76；typecheck 与 build 通过；lint 为 0 error、9 个既有 hooks warning；生产依赖审计 0 漏洞。
- SPEC-006 构建产物泄漏扫描通过；测试数据库最终所有 application tables 为空。
- Closeout：`docs/superpowers/reports/spec-006-closeout.md`。

Task 10 已完成：Step-Up 并发限流和脱敏拒绝审计、普通用户可选 MFA、MFA 失败/过期审计、真实紧急 CLI 演练，以及带受控加密因子和匹配密钥验证的隔离备份恢复演练均已通过。演练 dump SHA-256 为 `8576f9ac986c5812a7281db49a1fdd7c1ef65139dd64842f84b371c44ab56cd0`，恢复库已删除，源库与测试库均已清空。Vite 单个主 chunk 警告与 9 个旧页面 Hook 依赖 warning 仍是非阻断后续优化项。

继续保持以下硬约束：工作树属于用户且包含未提交成果；不得 stage、commit、branch、merge、push、PR 或执行任何 Git/GitHub 写操作；不得清理或覆盖无关改动。

## 16. 2026-07-24 SPEC-008 生产 Canary 可观测性增量

本节是对第 15 节的追加，不覆盖此前 SPEC-005/006/007 的迁移与 closeout 历史。SPEC-008 Task 1–8 已交付持久化 Worker runtime、rollout policy、只读 API/CLI/Web 可观测性、portable command 和受保护 authority rehearsal；Task 9 技术验证与独立整改复审均已完成，Critical 0、Important 0、Minor 2（已接受），`Ready to close SPEC-008: Yes`。

Task 8 最终 authority：

- 总命令 UTC：`2026-07-24T09:49:01.0624458Z` 至 `2026-07-24T10:04:13.3618885Z`，exit 0，elapsed 912 秒。
- canary UTC：`2026-07-24T09:49:08.272Z` 至 `2026-07-24T10:04:09.135Z`，连续 READY 900 秒、16 次检查。
- 记录窗口内创建并完成一个真实治理事件的 production Worker 通知闭环；availability、lease recovery、未知版本 quarantine、DISABLED rollback 与全表 history preservation 均通过。
- authority 后应用表为空；Task 8 second remediation review 为 Critical 0、Important 0、Minor 0，`Ready for Task 9: Yes`。

Task 9 新鲜验证：

- 固定工具链 Node 22.14.0、npm 10.9.2；最终权威命令全部通过计划规定的 pinned `npx` wrapper 复跑。
- Server 发现 141 个测试文件，只排除一次真实 Git distribution contract，显式串行执行 140 个文件；普通清单 915 tests、911 passed、0 failed、4 skipped，exit 0，elapsed 610.3 秒；最终 c8 为 statements/lines 85.46%、branches 84.27%、functions 91.62%，exit 0，elapsed 592.3 秒。
- Task 9 以 TDD 修复 `events:check` 冷启动静态加载 runtime graph 造成的覆盖 profile 污染；未降低 coverage gates，未扩大 exclusions。
- Server lint、typecheck、clean build、Prisma 5.22.0 generate、post-build、built leakage、baseline 与 package 全部通过。
- 7 个 build/package 文件共 21 tests 全绿，包含 4 条真实 Windows portable executable smoke，0 skip。
- Web lint 0 errors/9 个既有 warnings，typecheck 通过，32 files/109 tests 全绿，3,150 modules build 通过。
- Server security 10 files/40 tests 全绿；Server production/full audit 的 high/critical 均为 0，moderate 分别为 4/7；Web production/full audit 均为 0 vulnerabilities。
- 当前权威为 12 migrations、45 Prisma models、全部应用表为空、孤立 restore/rehearsal 数据库计数 0；没有创建 dump。
- 早期 ambient-runtime 文档扫描虽 exit 0，但不作为固定工具链 authority；全部结果纠正后，Node 22.14.0/npm 10.9.2 wrapper 的 post-write 文档扫描 exit 0；记录本句后再执行同一 pinned final-state scan。

仍保留的非阻塞技术债：9 个既有 Web Hook warnings、jsdom pseudo-element 能力提示、Vite 大 chunk 提示、3 条 Prisma generator package warnings，以及 Server moderate advisories。

独立终审还必须裁定两项执行 concern：两次遗漏 `--test-force-exit` 的诊断运行超时后，implementer 定向终止了遗留测试子进程；另有只读静态检查把仓库测试 fixture 字面量显示到 transient tool output。两者均未进入持久化文档，且不改变上述技术结果，但不能由 implementer 自行豁免 brief 的 no-process-kill/no-sensitive-output 约束。

续接顺序：

1. 读取 `.superpowers/sdd/spec-008-task-9-report.md` 和 `docs/superpowers/reports/spec-008-closeout.md`。
2. 由 controller 编写独立 `.superpowers/sdd/spec-008-task-9-review.md`，明确处理上述 concern，并确保 Critical 0、Important 0。
3. 对任何 finding 做最小整改和 affected re-verification；随后重跑持久化文档 leakage 与 final-state verification-before-completion。
4. 终审已明确 `Ready to close SPEC-008: Yes`，controller 已更新 Task 9 plan checkboxes 与 progress ledger。
5. 下一项建议不是新增功能，而是在单独生产授权下按 `docs/superpowers/runbooks/reliable-event-center-outbox.md` 执行 preflight/canary；继续禁止远程 Worker toggle 与事件历史清理入口。
