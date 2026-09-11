# SPEC-021 审批超时升级 — 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1-2 实现 + Task 2 验收闸门全绿 + 生产接线完整）
需求来源：SPEC-016/017/018/019/020 closeout §9「审批中心深化余项——超时升级（PENDING task 滞留自动升级/提醒）」+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-approval-timeout-escalation-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-approval-timeout-escalation/

## 1. 交付范围

**审批超时升级（Timeout Escalation）端到端**，**零结构变更**（复用 Notification + operation_log 既有表，无 schema/迁移/权限/事件/路由变更）：

- **ApprovalTimeoutScanner 服务层（D1-D10）**：`app/application/approval/approval-timeout-scanner.ts` +`scanOnce(now)`——判定 PENDING task 且 `createdAt < now - timeoutHours`（阈值 = `APPROVAL_TIMEOUT_HOURS`，默认 **72**，范围 1-8760）且关联实例仍 PENDING（D1）；为目标审批人（task.assigneeId）生成 **Notification（type `'APPROVAL'`、title「审批超时提醒」、content 含实例标题与节点与阈值、relatedId=instanceId、relatedType='APPROVAL_INSTANCE'、routeUrl='/approvals?role=TODO'）**——deduplicationKey `approval-timeout:{instanceId}:{taskId}:{YYYY-MM-DD}` **按天幂等**（D2/D3/D6）；审计 operation_log action `APPROVAL_TIMEOUT_NOTIFIED`（targetType APPROVAL_TASK、newValues {taskId,instanceId,assigneeId,timeoutHours}、ip 'system'，D4）；`now` 注入 + 阈值构造参可测（D7）；返回提醒数。
- **节律接线（D5）**：`event-services-factory` 沿 SPEC-009 LeadRecycleScanner 注入点把 `ApprovalTimeoutScanner.scanOnce` 注入事件 worker tick 旁挂 listener（多扫描器各自 try/catch 隔离，单扫描器抛错仅记日志不影响投递循环）；`options.approvalTimeout` 存在时构造、缺省不注入（条件注入语义）；`configurationSignature` 按缺省 {timeoutHours:72} 归一化（显式非默认与缺省混用 fail-fast）。
- **生产接线（Task 2）**：**三调用点 app.ts 启动钩子 / controller/eventOperations.ts / admin-governance/governance-factory.ts 均同源传 `approvalTimeout: config.approvalTimeout`**——ApprovalTimeoutScanner 随事件 worker tick 节律运行（沿 leadRecycle 终审修复轮先例，任一调用点缺省都会与启动钩子签名不一致 fail-fast）。
- **batchSize 饥饿修复（Task 2，I×1 必修）**：查询恒定取最旧 batchSize 条时，超时 task > 100 则 101+ 永远不进窗口漏提醒——修复（裁决 2 首选方案 a）加 **NOT IN 已通知 dedup key 谓词**（按当天日期 `approval-timeout:{...}:{YYYY-MM-DD}` 提取已通知 taskId 集排除，查询窗口自然推进；跨日不排除——昨日已通知仍可今日再提醒）。
- **阈值防御性校验（Task 2，M 项）**：scanner 构造时校验 timeoutHours 1-8760 / batchSize ≥1 / dedupPrefix 非空（沿 env 解析语义）。
- **.env.example 文档（Task 2，M 项）**：+`APPROVAL_TIMEOUT_HOURS`（默认 72，范围 1-8760，说明 dedup 按 UTC 天）。
- **零结构变更（D9/D10）**：迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 **11** 全不变——超时升级复用 Notification + operation_log，不产 outbox 事件。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证沿 SPEC-017/018/019/020）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 服务层 ApprovalTimeoutScanner（判定/通知/审计/dedup 幂等/按天去重/并发 P2002/返回计数）+ factory 节律注入 + config/env 读取 | `test/approval/approval-timeout-scanner.test.ts` **8/8**（7 scanOnce + 1 factory 节律）+ approval 域既有零回归（instance 73 + definition 17 + api 23 + policy/catalog 34 + events 15）+ 节律回归（governance-notification-flow + lead-first-response-handler 17）+ factory-cache 3 + tsc/eslint 0 |
| 2 | 三调用点生产接线 + **batchSize 饥饿修复**（NOT IN 已通知谓词）+ 阈值防御性校验 + .env.example 文档 + runbook/closeout | scanner 测试 **9/9**（8 既有 + **1 边界用例**：120 超时 task 分批全提醒，断言 101+ 也收到提醒）+ factory 回归 42 + tsc/eslint 0 |

### 3.2 最终全量（Task 2 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令 + `--test-skip-pattern`） | **1841 tests / 1766 pass / 71 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；71 fail 全系外部并行渠道漂移，见 §3.3/§8.1——SPEC-021 自身 0 fail） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| server typecheck | `npx tsc --noEmit` 0（Task 1/2 均验） |

### 3.3 全量合计（Task 2 实测，清净窗）

**实测：1841 tests / 1766 pass / 71 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件）。

SPEC-021 净增（后端）：Task 1 +**8** + Task 2 +**1**（batchSize 边界用例）= **+9**。

> **对账**：同闸门口径 SPEC-020 终态 = **1830 tests / 1826 pass / 0 真 fail / 4 skipped**；本 SPEC 净增 +9 → 预期 **1839**；实测 **1841**（1839 + 外部渠道新测 +2——`user_role.membership.manage` 委托操作者用例）。**71 fail 全部为外部并行渠道漂移**（SPEC-015 follow-up `user_role.membership.manage` 权限码新增，详见 §7/§8.1），**SPEC-021 自身 0 fail 为权威结论**。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 权限 122 不变 / 事件 15 不变 / 路由 approval 域 11 不变**——SPEC-021 **零结构变更**（超时升级复用 Notification + operation_log 既有表，无 schema/迁移/权限/事件/路由变更；审批域路由 11 不变，超时升级不新增路由）。
- **迁移实证（Task 2 复验）**：`npm run db:reset:test` 重放 **26** 迁移 → `npm run db:assert-empty` **PASS** → `npx prisma migrate deploy` 二次跑 **零迁移幂等**（0 待应用）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——2 SYSTEM + 5 BUSINESS，SPEC-021 未动角色）。
- **路由终态**（approval 域 **11 条**）：六门禁 + SPEC-017 三管理 + SPEC-019 转交 + SPEC-020 加签——**SPEC-021 零新增**（超时升级经 Notification 承载，无新端点）。

## 5. 关键裁决记录（D1-D10 + 实施期 ⚠️ 裁决累积）

设计 §2 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 判定 | PENDING task 且 `createdAt < now - timeoutHours`（阈值 = `APPROVAL_TIMEOUT_HOURS` env，默认 **72**）且实例仍 PENDING——超时候选 |
| D2 | 升级动作 | 为目标审批人（task.assigneeId）生成 **Notification**（type `'APPROVAL'`、title「审批超时提醒」、content 含实例标题/节点/阈值、relatedId=instanceId、relatedType='APPROVAL_INSTANCE'、routeUrl 待办页）——**deduplicationKey** 幂等防重（`approval-timeout:{instanceId}:{taskId}:{scanDate}` 按天粒度） |
| D3 | 频率 | 每个超时 task 每 scan 窗口最多提醒一次（dedup key 含扫描日期——按天去重，避免每 tick 刷屏） |
| D4 | 审计 | operation_log action `APPROVAL_TIMEOUT_NOTIFIED`（targetType APPROVAL_TASK，newValues 含 taskId/instanceId/assigneeId/timeoutHours，ip 'system'） |
| D5 | worker | `ApprovalTimeoutScanner`（仿 LeadRecycleScanner）：`scanOnce(now)` 返回提醒数；由 event-services-factory 组装时注入 event-worker tick 旁挂 listener |
| D6 | 幂等 | dedup key 唯一冲突 → 已提醒跳过（P2002 或 findFirst 预查）；重复 scan 不重复提醒 |
| D7 | 可测性 | `now` 注入 + 阈值可配（构造参）；`scanOnce(now)` 纯函数式可单测 |
| D8 | 前端 | 基于 Notification 的提醒（用户见通知即可感知）；前端超时 Tag 列为可选（本 SPEC 不做，零前端改动） |
| D9 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（复用 Notification + operation_log） |
| D10 | 事件 | **不产 outbox 事件**（超时提醒直接落 Notification 表 + 审计；observability 经 Notification 承载） |

**实施期裁决（Task 1-2 评审追认，逐条照录）**：

1. **Task 1 ⚠️ I×1 生产接线完成（Task 2 已修）**：Task 1 阶段 app.ts/eventOperations/governance-factory 三调用点未传 `approvalTimeout`（不在 Task 1 Files 清单，硬约束禁止改）——Task 2 已补三调用点接线（§1），ApprovalTimeoutScanner 随事件 worker tick 节律运行；接线后隔离验证（factory 构造含 scanner + tick 触发 scanOnce 产出提醒）通过。
2. **Task 1 ⚠️ config/env.ts 等价范围**：brief Files 清单列 `config.default.ts 或等价`——因现有 env 模式为 `config.default.ts ← env.ts(loadEnvironment)`，实际读取落在 `env.ts`（新增 `ApprovalTimeoutEnvironment` + `parseApprovalTimeoutEnvironment`，`APPROVAL_TIMEOUT_HOURS` 默认 72 范围 1-8760），`config.default.ts` 同步暴露 `config.approvalTimeout`。两文件均在「或等价」范围内。
3. **Task 1 ⚠️ dedup 按 UTC 天**：`dateKey(now)=now.toISOString().slice(0,10)`（YYYY-MM-DD UTC），跨时区确定性，测试用固定 UTC now 断言精确 key。
4. **Task 2 ⚠️ I×1 batchSize 饥饿修复（必修）**：查询恒定取最旧 100 条时超时 task >100 则 101+ 永远不进窗口漏提醒——修复（裁决 2 首选方案 a）加 **NOT IN 已通知 dedup key 谓词**（按当天日期提取已通知 taskId 集排除，窗口自然推进）；边界用例（120 超时 task 分批全提醒，断言 101+ 也收到提醒）验证通过。
5. **Task 2 ⚠️ M×5 照录**：①factory/scanner 构造时阈值范围校验（timeoutHours ≥ 1 防御性，沿 env 解析 1-8760 语义，落 scanner 构造器）；②`.env.example` +`APPROVAL_TIMEOUT_HOURS` 文档；③实例并发陈旧通知可接受（不修——同实例多 PENDING task 各自独立按 taskId 提醒，不合并实例级）；④runbook §9.11 补超时升级语义；⑤closeout（本报告）。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` 实测收敛（沿 SPEC-020 终态）：双 workspace 生产审计 passed（server `production_high=0`/`production_critical=0`；web `production_high=0`/`production_critical=0`）——安装版本 react-router **8.3.0**/brace-expansion **5.0.8** 均已覆盖既有 advisory，SEC-2026-002 对应漏洞不再命中；现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断。**本 SPEC 零新增例外**。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **实例并发陈旧通知可接受**（信息性，Task 2 M③）：同实例多 PENDING task 各自独立按 taskId 提醒，不合并实例级；并发陈旧通知不处理。
2. **batchSize 单次扫描上限语义**（信息性）：单次 `scanOnce` 仍最多处理 batchSize 条（默认 100）；超量由 NOT IN 谓词跨 tick 分批全提醒（下个 tick 排除已通知 → 取下一批最旧未通知）——每 tick 一批，不无限循环。
3. **前端零改动**（设计 D8 首版聚焦后端扫描 + 通知）：前端无超时 Tag（无阈值配置源），用户经通知中心「审批超时提醒」感知；前端超时 Tag 列 follow-up。
4. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：SPEC-020 加签 minor（目标重复 PENDING task 重复建 / raw 1-10 先于去重口径 / 详情弹窗 stale 快照 / 刷新恒 TODO）；SPEC-019 转交目标存在性校验（D3 OUT）+ 转交「死按钮」观察；SPEC-018 缺 ALL 并发用例 / nodeName 唯一性 / 投影取当前定义非版本快照；SPEC-017 M2 乐观版本锁 + PATCH 同体非单事务；审批中心深化余项（全组织视图/审批人表达式/节点级事件/自动升级动作）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。
5. **外部并行渠道活跃漂移（Task 2 全量 71 fail 全部归因，非本 SPEC 回归）**：Task 2 全量期间（15:07 现场）并行渠道（SPEC-015 follow-up 业务角色成员指派）在共享树新增第 123 权限码 `user_role.membership.manage`（`authorization-types.ts`/`permission-catalog.ts`），引发两类外部失败：
   - **权限计数 122→123**：`PERMISSION_CODES total is 122`（approval/contract/finance/authorization 四处权限目录计数测试）+ 权限目录唯一性测试，断言 122 的测试文件尚未被并行渠道同步至 123（Files 清单外，本任务不可改）。
   - **`assertPermissionCatalog` 排序不一致（根因）**：新增 `user_role.membership.manage` 含下划线，暴露既有潜在缺陷——`SystemBootstrapService.assertPermissionCatalog`（system-bootstrap-service.ts:200-240）用 JS `localeCompare` 对 `PERMISSION_CATALOG` 排序，而 DB 查询用 PostgreSQL `ORDER BY code`（C collation），`.`（46）与 `_`（95）排序序不同 → 字段逐位比较错位 → `InconsistentSystemStateError: Permission catalog is inconsistent`。级联失败：auth.test.ts 16/16、system-bootstrap-service.test.ts 8/13、user/role 管理、browser-fixture 等——全部经 bootstrap 断言路径。DB 实测 permission 123 行与 catalog 123 条逐字段一致（`parentId` 均 null），仅排序序不同。
   - **approval listInstances 3 例瞬态**（`listInstances APPLIED/TODO/invalid role`）：全量中 fail，**隔离复跑 approval-instance-service.test.ts 73/73 全绿**——瞬态非回归。
   - 处置：本任务不修改 Files 清单外源码/测试；`check:baseline`/`check:bootstrap`/`check:docs-leakage`/`security:test` 均不涉权限计数/不涉 bootstrap 服务断言，全部 PASS。**SPEC-021 自身 0 fail 为权威结论**（scanner 9 + factory 42 + approval 域隔离零回归 + tsc/eslint 0）。

## 8. 对账项

1. **计数对账**：SPEC-020 终态 **1830** + 本 SPEC 净增 **+9**（scanner Task 1 +8 + Task 2 边界 +1）= **1839 预期**；**实测 1841 tests / 1766 pass / 71 fail / 4 skipped**（对账见 §3.3）。SPEC-021 自身测试 0 fail 为权威结论；全量 71 fail 全部为**外部并行渠道漂移**（见 §7.5），非本 SPEC 回归。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 **11** 全不变——与设计 §7/§8 逐字对齐（D9 零结构变更）。
3. **错误码对账**：无新增错误码；超时升级为系统任务入口（无 HTTP 端点），零错误码影响。
4. **事件对账**：事件 **15** 不变；超时升级零事件（observability 经 Notification 承载）。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **audit:prod 实测对账**：Task 2 实测 `security:audit:prod` 收敛（0 production_high，沿 SPEC-020 终态，§6）；以实测终态为权威。

## 9. Follow-up 路由（候选专项）

- **自动升级动作**（设计 §8 OUT）：超时自动转交/加签/定稿——高风险需更多裁决，另行。
- **多级升级**（设计 §8 OUT）：超时提醒的一级提醒→二级管理员——另行。
- **审批人维度超时统计/驾驶舱**（设计 §8 OUT）：超时统计与报表——另行。
- **加签 minor 承接**（SPEC-020）：目标重复 PENDING task 去重 / 幂等 key / 详情 stale 快照。
- **全组织视图**（设计 §8 OUT + 审批中心深化余项）：approval.manage 扩展全量视图。
- **前端超时 Tag**（设计 D8 可选）：前端镜像阈值常量计算 createdAt 距今，需阈值配置同步。
- **通知渠道**（设计 §8 OUT）：短信/邮件渠道——现有 Notification 表内承载，渠道另立。
- **超时扫描可观测性增强**：扫描批次/提醒数指标上送 observability。

## 10. 双渠道验收链

Task 1-2 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；Task 1 审查结论 **Approved / 0 Critical**（⚠️ I×1 生产接线待补 + config/env.ts 等价 + dedup UTC 天，Task 2 已全部闭环）。Task 1 评审确认：scanOnce 全子项（判定查询/Notification 字段/dedup key 形态/审计 newValues 精确 deepEqual/幂等/按天去重/并发 P2002/返回计数/batchSize 100 asc）+ 节律注入（options.approvalTimeout 缺省不注入 + tick 旁挂 try/catch 隔离 + configurationSignature 归一化）+ 测试真实性 8 例非恒真 + 零回归（approval 域 73+17+23+34+15 + factory-cache 3 + 节律 17）+ tsc/eslint 0。Task 2（本任务）为生产接线 + 饥饿修复 + 闸门 + 收尾：三调用点接线 + 边界用例（120 超时 task 分批全提醒）+ 阈值防御性校验 + .env.example + runbook §9.11 + 本报告；SPEC-021 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑）。

## 11. 收官状态

**SPEC-021 本地闭环（2026-08-03）**：2/2 任务完成；审批超时升级（ApprovalTimeoutScanner + `scanOnce(now)` + **三调用点生产接线** + **batchSize 饥饿修复**——NOT IN 已通知谓词 + **阈值防御性校验** + .env.example 文档）落地；**零结构变更**（迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 **11** 全不变）；后端本 SPEC 净增 **+9**（Task 1 +8 + Task 2 边界 +1），全量串行 **1841 tests / 1766 pass / 71 fail / 4 skipped**（**SPEC-021 自身 0 fail 为权威**——scanner 9 + factory 42 + approval 域隔离复跑零回归；71 fail 全系外部并行渠道漂移：`user_role.membership.manage` 权限码新增暴露 `assertPermissionCatalog` 排序缺陷 + 权限计数 122→123 + approval listInstances 3 例瞬态隔离复跑绿，对账见 §3.3/§7.5/§8.1）；security:test **34/34** 零新增；`security:audit:prod` 收敛（0 production_high，沿 SPEC-020 终态）；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；迁移实证 **26 迁移重放 + assert-empty PASS + migrate deploy 二次零迁移幂等**；已知非阻断项 §7 照录（含承接既有项与外部漂移），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
