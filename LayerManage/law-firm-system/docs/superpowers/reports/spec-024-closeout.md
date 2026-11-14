# SPEC-024 Definition 并发加固（乐观版本锁 + 组合方法原子性）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-017 closeout §7/§9「M2 乐观版本锁（update/setStatus 无 version 条件）+ PATCH 同体非单事务」+ SPEC-018/019/020/021/022/023 承接 ｜ 无人值守 subagent-driven（协调者 + 实现者子代理 + 任务评审 + 终审 opus）

## 1. 交付范围

修复 `approval-definition-service` 两个 SPEC-017 评审遗留的并发正确性缺陷 + 并发测试确定性化（M3 修复），**零结构变更**：

1. **M2 无乐观版本锁**：`updateDefinition`/`setDefinitionStatus` 在事务外 `findUnique` 读 version、事务内 `update({where:{code}})` 无 version 条件——并发双写时后写覆盖前写、审计 `fromVersion` 失真。→ 改 `updateMany({code, version: existing.version}, data)` 乐观锁，count=0 → 409 `APPROVAL_STATE_INVALID`。
2. **PATCH 同体非单事务**：controller `updateDefinition` 同体（update+status）走两次独立 service 调用两事务——极端进程中断半应用风险。→ 新增组合方法 `updateDefinitionWithStatus` 单事务 + controller 三分支。
3. **M3 并发测试确定性化修复**：同体并发 409 用例由 `Promise.allSettled` 双调时序竞争改为 **version 前置条件确定性构造**（服务层可选 `version` 参数 + controller 透传 + 测试「先推进 version、客户端持旧 version 调用 → 409」），全程无时序依赖（历程见 §5）。

**变更文件（共 5 件，零结构变更）**：`approval-definition-service.ts` / `approval-types.ts` / `controller/approval.ts` / `test/approval/approval-definition-service.test.ts` / `test/app/approval-api.test.ts`。未触碰：迁移/模型/权限/事件/路由。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）。运行时 Node v24.18.0（沿 SPEC-017-023 实证零影响）。

## 3. 测试计数链

### 3.1 任务计数（协调者 + 实现者独立复跑实证）

| 检查 | 结果 |
|---|---|
| `approval-definition-service.test.ts`（17 既有 + 7 新） | **24/24 pass**，fail 0 |
| `test/app/approval-api.test.ts`（23 既有 + 3 新） | **26/26 pass**，fail 0 |
| `approval-instance-service.test.ts`（73 既有） | 73 全绿（隔离；既有 forwardTask concurrent 时序 flake 偶发，非本任务回归） |
| approval-policy / permission-catalog-approval / approval-events | **49/49 pass**，fail 0 |
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint`（修改文件） | **exit 0** |

**Task 2 并行落地说明**：controller PATCH 三分支 + api 同体 PATCH 用例由**并行会话顺手落地**（评审 M1 披露：controller mtime 23:48:40 / api test 23:49:31 晚于 Task 1，无独立 task-2-report/评审）——协调者复核代码正确但发现并发用例为时序 flake（api 26/25/1 fail），**接管 M3 修复**（version 前置条件确定性构造）后实现者独立清净窗复跑实证（approval-api 26/26 + definition 24/24 + policy/catalog/events 49/49 + tsc/eslint 0）。本闸门（全量/security/baseline/bootstrap/docs-leakage/runbook/closeout）为收口终态。

### 3.2 最终全量（后端全量串行，清净窗，2026-08-04）

`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（spec-008 排练 3 例 port-55432 锁定件照录排除）：

- **实测：1860 tests / 1854 pass / 2 fail / 4 skipped**（duration ~30min，TAP 终态）。
- **fail 分类**：2 例均为 SPEC-022 已知外部漂移（trust-root-guard×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）——**0 真 fail 为权威结论**（本 SPEC 净增 +10 全绿：approval-definition-service +7 与 approval-api +3 全绿，approval 域零回归）。
- **skip 分类**：spec-008 排练 3 例 port-55432 锁定件经 `--test-skip-pattern` 照录排除 + 1 例既有显式 skip（沿 SPEC-023 终态 4 skipped 口径）。

### 3.3 其他闸门

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass** |
| `check:bootstrap`（角色 2→7） | **pass** |
| `check:docs-leakage` | **pass**（exit 0） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124**（设计口径）/ 事件 **15** / 路由 **11** 全不变）。无新权限码、无新事件、无新路由。`approval_definition.version Int @default(1)` 既有列即乐观锁载体。

**迁移实证（闸门重放，清净窗 2026-08-04）**：`npm run db:reset:test` 重放全部 **26** 迁移（Prisma migrate reset --force --skip-seed，终态 `20260802120000_schema_drift_reconcile`）→ `npm run db:assert-empty` **PASS**（"All application tables are empty"，assert-empty 排除 Permission/EventSubscription/ContractTemplate/ApprovalDefinition 迁移供给目录）→ `npx prisma migrate deploy` 重跑两次均 **"No pending migrations to apply"**（幂等，0 待应用）。迁移目录实测计数 26。

## 5. 关键裁决记录（D1-D8）

| # | 决策 | 值 |
|---|---|---|
| D1 | 乐观锁 | `updateDefinition`/`setDefinitionStatus` `update` → `updateMany({code, version: existing.version}, data)`；count=0 → **409 `APPROVAL_STATE_INVALID`**（'approval definition state changed concurrently'，沿 SPEC-019 forward 守卫先例） |
| D2 | fromVersion 审计 | 审计 `fromVersion` 用锁前读 `existing.version`；count=0 时审计不落（抛 409 前） |
| D3 | 组合方法 | 新增 `updateDefinitionWithStatus(code, input)`：单 `$transaction` 内白名单解析 + 校验 + update 段（乐观锁）+ status 段（基于 update 后 version 乐观锁）+ 审计两段合并单条 → 返回视图；version 语义 update+status 各 +1 = +2；任一段进程中断全回滚 |
| D4 | controller 三分支 | 同体（update+status）→ 组合方法；仅 update → `updateDefinition`；仅 status → `assertDefinitionStatus` + `setDefinitionStatus`——移除原同体两事务路径 |
| D5 | 幂等 | 组合方法内 updateMany 各带 version 守卫；任一段失败同事务回滚全或无；重复调用（同 version 已变更）→ 409 |
| D6 | 兼容 | `updateDefinition`/`setDefinitionStatus` 签名不变（组合方法为新增）；无 version 时 guardVersion 回落锁前读 fresh——旧客户端向后兼容 |
| D7 | 零结构变更 | 无迁移/模型/权限/事件/路由变更 |
| D8 | version 前置条件（派生） | PATCH body 可选 `version?: number`（`normalizeVersion` 正整数校验）——同体路径 `guardVersion = versionPrecondition ?? existing.version`；与当前不符 → 第一段 count=0 → 409（**确定性并发竞争语义**，评审 M3 测试构造）；仅 update 分支剥除 version（updateDefinition 无该参数） |

**评审 M3 修复历程**：并发测试原为 `Promise.allSettled` 双调时序竞争（loser 读落 winner 提交后 → 双 200 flake）。曾尝试「prisma 事务持行锁 + poll `pg_stat_activity` 观测 `wait_event_type='Lock'`」确定性构造——**本测试环境不可靠**：非超级用户 `chengye_test` 看不到其他会话的 `pg_stat_activity.query`（ILIKE 匹配失败 → 观测不到阻塞）+ 交互事务 5s 超时。**回退到评审 M3 原建议的 version 前置条件构造**（服务层可选 version 参数 + controller 透传 + 测试「先异动 version、再以旧 version 调用」），全程无时序依赖。

**实施期 ⚠️（评审/协调者累积照录，全部接受/闭环）**：

1. **Task 1 评审 M×3（0C/0I/3M）**：
   - **M1 Task 2 代码被并行会话落地**：controller 三分支 + api 同体 PATCH 用例由并行通道顺手落地（无独立报告/评审）——协调者复核代码正确但并发用例为时序 flake，接管修复（见 M3）。
   - **M2 instance 计数口径**：Task 1 报告「instance 76/77」实为文件 **73 条 test()**（approval-instance-service.test.ts 73 例，未被本任务触碰；唯一失败为既有 forwardTask concurrent 时序 flake 隔离重跑过）。
   - **M3 并发测试时序 flake → version 前置条件确定性修复**：见上「评审 M3 修复历程」——协调者诊断实证（锁竞争方案 poll `pg_stat_activity` 观测不到 Lock 等待、非超级用户看不到其他会话 query、5s 交互事务超时）后回退到 version 前置条件构造，全程无时序依赖。
2. **version 前置条件新增（D8）**：PATCH body 可选 `version?: number`（`normalizeVersion` 正整数校验）——同体路径 `guardVersion = versionPrecondition ?? existing.version`；与当前不符 → 第一段 count=0 → 409。仅 update 分支剥除 version（updateDefinition 无该参数，version 对仅 update 冗余）。可选增强，缺省行为不变（向后兼容）。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（闸门实测 exit 0）——server 依赖树地板、CORS 插件、audit 例外精确匹配等零新增例外。零新增权限/零新增路由（复用既有 `approval.manage` 与 `APPROVAL_STATE_INVALID`）。
- `audit:prod` 沿 SPEC-018-023 收敛口径（react-router 8.3.0 覆盖既有 advisory，SEC-2026-002 保留观察）——本 SPEC 零依赖变更（仅服务/控制器/测试逻辑改动，无 package.json/lockfile 改动）；audit 工具链本环境无法重跑（metadata 含 `git rev-parse`，本任务禁 git），非本 SPEC 闸门，沿用实测终态 + 零依赖变更推证。
- `check:docs-leakage` **exit 0**（含本 closeout 与 runbook §9.13 的终态）——**占位符口径**：持久化文档不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令，沿 SPEC-012 起先例）；本 closeout 与 runbook §9.13 均不含 env 块真实值。

## 7. 已知非阻断项（评审累积逐条照录）

1. **Task 1 评审 M×3 照录（§5 实施期 ⚠️）**：M1 Task 2 并行会话落地（协调者复核接管）/ M2 instance 计数口径 73 / M3 并发测试时序 flake → version 前置条件确定性修复（已闭环）。
2. **既有并发用例时序 flake（评审 M3 允许留观察）**：instance `forwardTask concurrent`、service 层 update/setStatus/组合方法**非 version 前置**并发用例仍为 `Promise.allSettled` 时序竞争模式，偶发 flake 隔离重跑通过——本次全量跑 forwardTask concurrent 与组合方法并发用例均绿（未触发）；确定性构造推广列 follow-up（§9）。
3. **version 前置为可选新增 API 面**：同体 PATCH 客户端可携带 `version` 显式并发控制；缺省行为不变。仅 update/仅 status 分支剥除 version（无该参数）。旧客户端不传仍按锁前读 fresh 语义（向后兼容）。
4. **SPEC-022 外部漂移（照录不计，全量 2 fail 分类）**：trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`——外部并行渠道在制漂移，非本 SPEC 回归（本 SPEC 未触碰权限/授权域）。
5. **测试进程残留干扰**：本机连续跑批时前一批 node 子进程未完全退出会与下一批 `clearTestApplicationData` 竞争（`permission.createMany` unique `id` 冲突）——CI 单进程全量跑不适用；共享 DB 撞车纪律沿 runbook §8（本次全量初跑 0 撞车失败，清净窗一次通过）。
6. **承接既有已知项**：SPEC-018 缺 ALL 并发用例 / nodeName 唯一性 / 投影取当前定义非版本快照；SPEC-019 转交目标存在性校验；SPEC-020 加签幂等 key / 通知 outbox；SPEC-021 dedup UTC 天边界；Definition 导入导出；terminate 侧硬化（SPEC-014 MEDIUM 承接）；前端预存 vitest flake；SEC-2026-002 观察。

## 8. 对账项

- **零结构变更**：迁移 **26** / 模型 **60** / 权限 **124**（设计口径）/ 事件 **15** / 路由 **11** 全不变——本 SPEC 纯服务/控制器逻辑加固（§4 迁移实证闭环）。
- **测试计数**：approval-api 23→26（+3：确定性 stale-version 409 / 非法 status 400 / 空体 400；既有同体 PATCH 测试补合并审计断言）、definition 17→24（+7）。approval 域净增 **+10**（相对 SPEC-023 的 approval 域）。
- **全量对账**：SPEC-023 终态 **1850** + 本 SPEC 净增 **+10** = **1860 预期**；实测 **1860 tests / 1854 pass / 2 fail / 4 skipped**——fail 2 例均为 SPEC-022 已知外部漂移（trust-root-guard×2，照录不计），**0 真 fail 为权威结论**（本 SPEC 净增 +10 全绿）。
- **错误码对账**：无新增错误码——乐观锁复用既有 `APPROVAL_STATE_INVALID` 409；组合方法空 input / 非法 status 复用 `VALIDATION_FAILED` 400。
- **docs-leakage 占位符口径**：runbook/closeout 不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **Definition 导入导出 / 复制**（定义管理加固余项）——另行。
- **并发测试确定性化推广**：把 version 前置条件确定性构造推广到既有 `Promise.allSettled` 时序竞争并发用例（instance forwardTask concurrent / service 层 update/setStatus/组合方法并发用例），消除偶发 flake（评审 M3 允许留观察，本 SPEC 已验证确定性构造可行）。
- **版本快照投影**：组合方法 `version` 前置的配套——`getDefinition` 视图已含 version 列，客户端可直接持版本做乐观锁（前端「定义管理」编辑 Modal 可用现有 version 列）。
- createDefinition 乐观锁——**不需要**（新建无并发版本问题）。
- **审批中心深化余项（承接 SPEC-021/023 §9）**：超时自动升级动作 / 多级升级 / 审批人维度超时统计驾驶舱 / 前端超时 Tag；全量筛选/搜索、全组织动作、导出/报表/统计。
- **SEC-2026-002（react-router v8 迁移专项）**：2026-08-29 到期。

## 10. 双渠道验收链

- **Task 1**（服务层乐观锁 + 组合方法）：实现者（sonnet）DONE（definition 24/24 + api 26/26 + policy/catalog/events 49/49 + tsc/eslint 0）→ 评审（sonnet）Approved **0C/0I/3M**（M1 Task 2 并行落地 / M2 instance 计数口径 73 / M3 并发 flake → version 前置条件修复指引）。
- **Task 2（并行会话落地 + 协调者接管）**：controller 三分支 + api 同体 PATCH 用例由**并行会话顺手落地**（无独立报告；协调者复核代码正确但并发用例为时序 flake，api 26/25/1 fail）→ **协调者接管 M3 修复**（锁竞争方案诊断实证不可靠 → version 前置条件确定性构造：controller body keys +'version'、api 测试改写）→ **实现者复跑实证**（approval-api 26/26 + definition 24/24 + policy/catalog/events 49/49 + tsc/eslint 0，清净窗）。
- **闸门收口（本报告，2026-08-04）**：后端全量串行 **1860/1854/2/4**（0 真 fail，SPEC-022 外部漂移照录）+ security:test **34/34** + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0 + 迁移实证（reset 26 → assert-empty PASS → deploy 幂等）+ runbook §9.13 加固说明。
- 台账 `2026-08-03-approval-definition-hardening/progress.md` 全程逐条记录（协调者接管修复、诊断实证、version 方案闭环）。

## 11. 收官状态

**SPEC-024 本地闭环（2026-08-04）**：2/2 任务完成（Task 1 服务层乐观锁 + 组合方法；Task 2 controller 三分支 + version 前置条件 + 并发测试确定性化 M3 修复）。定义并发正确性加固落地——**零结构变更**（迁移 **26**/模型 **60**/权限 **124**（设计口径）/事件 **15**/路由 **11** 全不变，迁移实证 reset 26 → assert-empty PASS → deploy 幂等闭环）；后端本 SPEC 净增 **+10**，全量串行（清净窗终态）**1860 tests / 1854 pass / 2 fail / 4 skipped**（**0 真 fail 为权威**——2 fail 均为 SPEC-022 已知外部漂移 trust-root-guard×2 照录不计）；security:test **34/34** 零新增；check:baseline PASS（26 迁移/60 model）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）；Task 1 评审 M×3 全部接受/闭环（M1 并行落地复核 / M2 计数口径 / M3 version 前置确定性修复）；已知非阻断项 §7 照录（含 SPEC-022 外部漂移、既有并发用例时序 flake、测试进程残留干扰、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
