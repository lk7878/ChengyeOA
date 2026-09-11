# SPEC-019 审批转交 — 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1-3 双渠道 Approved + Task 3 验收闸门全绿）
需求来源：SPEC-016/017/018 closeout §9「审批中心深化余项——转交」+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-approval-forward-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-approval-forward/

## 1. 交付范围

**审批转交（Forward）端到端**，**零结构变更**（Task.assigneeId 既有字段可变——转交为纯 assigneeId 变更，无 schema/迁移/权限/事件变更；仅 approval 域路由 9→**10** +1 条 forward，非结构变更）：

- **forwardTask 服务层（D1-D8）**：`approval-instance-service.ts` +`forwardTask(taskId, input)`——复用 **`approval.process`** 权限码（D1，不新增权限码，权限 122 不变）；仅 **PENDING task 且 assigneeId=actor** 可转交（D2，非我 404）；`forwardToUserId` 必填（normalizeRequiredText 1-100，D3）；**纯 assigneeId 变更**——task.status 仍 PENDING、nodeName/实例 currentNode/status/version 不变、task version+1（D4/D5）；审计 `APPROVAL_TASK_FORWARD`（targetType APPROVAL_TASK，newValues {taskId, fromUserId, toUserId, hasReason}，remark 自由文本不落审计，D6）；**不产 outbox 事件、不建 callbackAction**（D7/D8）。
- **自审守卫（评审 Important 修复）**：转交目标 = 申请人（`instance.applicantId`）→ 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`（复用 domain `assertNotSelfReview(applicantId, [forwardToUserId])`，防「转交→申请人→自批」绕过）。语义区分：target==actor → 400 `APPROVAL_ASSIGNEE_INVALID`（转交给自己无意义）；target==applicant → 409（自审绕过）。
- **forward API（D10）**：`POST /api/v1/approvals/:id/forward`（approval.process，`:id`=taskId）——`controller/approval.ts` +`forward` 方法 + `FORWARD_BODY_KEYS` + `router.ts` +1（approval 域 9→10）。错误码透传：非 assignee 404 / 转交→申请人 409 / 自转交 400 / 空目标 400 / 未知键 400 / 定稿后 409。
- **前端转交（D9）**：ApprovalCenterPage 待办行 PENDING task 操作区 + 详情任务表（仅当前用户 PENDING 行）「转交」按钮（approval.process 门控）→ Modal 输入目标人 userId（必填+whitespace 校验）→ `approvalApi.forwardTask(taskId, {forwardToUserId})` → 成功 `message.success('任务已转交')` + 刷新 TODO 列表；提交期间 `confirmLoading` 防连点。`api/approval.ts` +`ForwardTaskInput` + `forwardTask`。
- **零结构变更（D11）**：迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 9→**10**（+POST /:id/forward，非结构变更）。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证沿 SPEC-017/018）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 服务层 forwardTask（含自审守卫）+ forward API + 路由 +1 | approval-instance-service **62/62**（55 既有 + 7 新）+ approval-api **21/21**（18 既有 + 3 新）+ approval 域零回归 **51/51**（definition 17 + policy/catalog 34）+ tsc/eslint 0 |
| 2 | 前端转交（待办行 + 详情弹窗 + api） | ApprovalCenterPage **23/23**（20 既有 + 3 新）+ 前端全量 **45 files / 205 tests 零回归** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功 |
| 3 | 闸门 + 文档（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 3 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令 + `--test-skip-pattern`） | **1816 tests / 1812 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| 前端四闸门 | ApprovalCenterPage **23/23** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning） |
| server typecheck | `npx tsc --noEmit` 0（Task 1 已验，Task 3 零 server 改动） |

### 3.3 全量合计（Task 3 实测，清净窗）

**实测：1816 tests / 1812 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-019 净增（后端）：Task 1 approval-instance-service **+7** + approval-api **+3** = **+10**（前端 Task 2 为前端件，不计后端计数）。

> **对账**：同闸门口径 SPEC-018 基线 = **1806 / 1802 pass / 0 fail / 4 skipped**；本 SPEC 净增 +10 → **1816 / 1812 pass / 0 fail / 4 skipped**（1806+10=1816、1802+10=1812，4 skipped 不变）。**0 真 fail 为权威结论**，计数链终态以实测为准（§3.2）。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 权限 122 不变 / 事件 15 不变 / 路由 approval 域 9→10**——SPEC-019 **零结构变更**（Task.assigneeId 既有字段可变，无 schema/迁移/权限/事件变更；仅 +1 条 forward 路由，非结构变更）。
- **迁移实证（Task 3 复验）**：`npm run db:reset:test` 重放 **26** 迁移 → `npm run db:assert-empty` **PASS**（assert-empty 排除 ApprovalDefinition/Permission/EventSubscription/ContractTemplate 供给目录，与既有同型）→ `npx prisma migrate deploy` 二次跑 **零迁移幂等**（0 待应用）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——2 SYSTEM + 5 BUSINESS，SPEC-019 未动角色）。
- **路由终态**（approval 域 **10 条**）：既有 6 条（GET /definitions approval.apply、GET /approvals、GET /approvals/:id、POST /approvals、POST /:id/withdraw、POST /:id/process）+ SPEC-017 3 条（POST /definitions、GET /definitions/manage、PATCH /definitions/:code，全 approval.manage）+ **SPEC-019 +1 条（POST /:id/forward，approval.process，:id=taskId，字面量 register 于 process 之后）**——**非结构变更**（路由表条目 +1，Schema/模型/权限/事件零变更）。

## 5. 关键裁决记录（D1-D11 + 实施期 ⚠️ 裁决累积）

设计 §2 D1-D11 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 权限 | 复用 **`approval.process`**（处理任务码）——转交是任务处置动作之一，不新增权限码（权限 122 不变） |
| D2 | 主体 | 仅 PENDING task 的 **assigneeId=actor** 可转交（沿 processTask 的 task 探查语义：非我 404） |
| D3 | 目标 | 转交给任意 userId（`forwardToUserId` 必填，normalizeRequiredText 1-100）——**校验目标 ≠ 自己**（400）；目标是否须为实例可见审批人——**不强制**（职责移交，目标人接任后按既有 assignee 语义处理；可见性限制列 follow-up） |
| D4 | 状态 | 转交不改变 task.status（仍 PENDING）、nodeName、instance.currentNode、实例 status——纯 assigneeId 变更 |
| D5 | 版本 | task version+1（沿既有 version 语义）；实例 version 不变（节点未推进） |
| D6 | 审计 | operation_log action `APPROVAL_TASK_FORWARD`（targetType APPROVAL_TASK，newValues 含 taskId/fromUserId/toUserId/hasReason；remark 自由文本不落审计） |
| D7 | 事件 | **不产 outbox 事件**（非定稿/推进，observability 经视图 assigneeId 变更承载） |
| D8 | 幂等 | 转交不建 callbackAction（非 process 决策）；task 已非 PENDING → 409 `APPROVAL_STATE_INVALID` |
| D9 | 前端 | 待办行/详情弹窗 PENDING task 增「转交」操作（approval.process 门控）——Modal 输入目标人 userId → 提交转交 |
| D10 | 路由 | `POST /api/v1/approvals/:id/forward`（approval.process，`:id`=taskId）——沿 process 路由形态 |
| D11 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（路由 approval 域 9→10 +1 条，非结构变更） |

**实施期裁决（Task 1-3 评审追认，逐条照录）**：

1. **Task 1 ⚠️①（Important）转交目标≠申请人自审守卫修复**：原实现仅拦 `target==actor`，未拦 `target==instance.applicantId`——申请人若持 approval.process 可经转交自批，绕过「禁止自审」核心不变量。评审 Important 修复已落地：task 探查 `include instance.applicantId`，复用 domain `assertNotSelfReview(applicantId, [forwardToUserId])`，命中即 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`。语义区分：target==actor → 400 `APPROVAL_ASSIGNEE_INVALID`（转交给自己无意义）；target==applicant → 409（自审绕过）。测试已钉死（服务 + API 双断言）。
2. **Task 1 ⚠️② 错误码选择**：转交给自己采用 `APPROVAL_ASSIGNEE_INVALID`（400）——设计仅定「400」未定码，取域内语义最贴近的「目标审批人非法」；测试已钉死该码，后续裁决如需独立码可低风险改。
3. **Task 1 ⚠️③ 并发测试可靠性**：依赖 PostgreSQL 行级锁——两个 `updateMany` 的 WHERE（version）在同一行上串行化，败者重估后 count=0 抛 409；与既有 processTask 并发用例同机制（经多次运行稳定）。
4. **Task 1 ⚠️④ 审计 targetType**：`APPROVAL_TASK`（新 targetType 值，operation_log.targetType 为自由 String 列，非枚举，零 schema 变更——符合 D11）。
5. **Task 1 ⚠️⑤ 事件零产出**：forwardTask 不触碰 outbox/eventLog/callbackAction；observability 经视图 assigneeId 变更承载（D7/D8）。
6. **Task 2 ⚠️① AntD Modal aria-labelledby 环境异常（测试侧）**：本环境 jsdom 中 AntD 生成重复 `id="test-id"`（分页 Select 与 Modal 标题同 id），`getByRole('dialog', { name: '转交任务' })` 无法按可访问名定位弹窗。测试改用内容定位：`getAllByRole('dialog').find(d => within(d).queryByRole('textbox', { name: '目标审批人 ID' }))`——非产品缺陷，仅测试查询策略。
7. **Task 2 ⚠️② 刷新语义 `fetchInstances('TODO', 1)`**（brief 裁决 2 原文）：转交成功后刷新 TODO 列表。详情弹窗内的转交按钮仅出现在当前用户自身 PENDING 任务上，而该任务必属 TODO 视图（申请人禁自审，不产生 APPLIED 视图的本人 PENDING 任务），故 `fetchInstances('TODO', 1)` 与实际 activeTab 恒一致，无「非 TODO Tab 显示 TODO 数据」错位。
8. **Task 2 ⚠️③ 详情弹窗转交后不关闭详情**（activeRecord 保持）：仅关转交 Modal 并清 activeTask，详情弹窗保留——用户可即时查看；再次打开详情为最新数据。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` **exit 0**，双 workspace 生产审计 passed（server `production_high=0`/`production_critical=0`；web `production_high=0`/`production_critical=0`）——实测终态较 SPEC-017 记录（2 production_high）**已收敛**（安装版本 react-router **8.3.0**/brace-expansion **5.0.8** 均已覆盖既有 advisory，SEC-2026-002 对应漏洞不再命中；现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断）。**本 SPEC 零新增例外**。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **错误码选择**（minor，Task 1 ⚠️②）：转交给自己采用 `APPROVAL_ASSIGNEE_INVALID`（400）——设计未定码，取语义最贴近者；测试已钉死。
2. **并发测试可靠性**（信息性，Task 1 ⚠️③）：依赖 PG 行级锁，与既有 processTask 并发用例同机制，多次运行稳定。
3. **审计 targetType APPROVAL_TASK**（信息性，Task 1 ⚠️④）：operation_log.targetType 自由 String 列非枚举，零 schema 变更。
4. **AntD Modal aria-labelledby 环境异常（测试侧）**（minor，Task 2 ⚠️①）：jsdom 重复 id，测试改内容定位；非产品缺陷。
5. **刷新语义 fetchInstances('TODO', 1)**（信息性，Task 2 ⚠️②）：转交刷新恒 TODO 视图，无 Tab 错位。
6. **详情弹窗转交后不关闭**（信息性，Task 2 ⚠️③）：activeRecord 保持，用户可即时查看。
7. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：SPEC-018 缺 ALL 并发用例 / remainingPending 依赖 nodeName 唯一 / nodeSchema 投影取当前定义非版本快照 / nodeSchemaModeAt nodeName 交叉校验（I×1）；SPEC-017 M2 乐观版本锁（update/setStatus 无 version 条件）+ PATCH 同体非单事务 + code 命名惯例 + 部署提示 approval.manage 需重跑 `npm run system:bootstrap`；审批中心深化余项（加签/超时升级/全组织视图/审批人表达式/节点级事件——本 SPEC 设计 §8 明确 OUT）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；SUPPLEMENT 父状态复查；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；预存漂移已由 `20260802120000_schema_drift_reconcile` 闭环；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **计数对账**：SPEC-018 基线 **1806** + 净增 **+10**（instance +7 + api +3）= **1816 实测**（1812 pass / 0 fail / 4 skipped）——同闸门口径，0 真 fail 为权威。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 9→**10**（+POST /:id/forward，非结构变更）——与设计 §7/§8 逐字对齐（D11 零结构变更，仅路由条目 +1）。
3. **错误码对账**：无新增错误码；转交场景复用既有码——非我 404 `APPROVAL_TASK_NOT_FOUND`、非 PENDING/并发 409 `APPROVAL_STATE_INVALID`、转交→申请人 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`、转交给自己 400 `APPROVAL_ASSIGNEE_INVALID`、空目标 400 `VALIDATION_FAILED`。
4. **事件对账**：事件 **15** 不变；转交零事件（`approval.instance.created/completed` 载荷不变，observability 经视图 assigneeId 变更承载）。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **audit:prod 实测对账**：SPEC-019 Task 3 实测 `security:audit:prod` **exit 0**（server/web 均 passed，0 production_high），较 SPEC-017 收官记录（exit 1、2 production_high）**已收敛**（与 SPEC-018 Task 3 同口径）；现存 server 1 production moderate（uuid）report 不阻断。以实测终态为权威（§6）。

## 9. Follow-up 路由（候选专项）

- **转交目标存在性校验**（D3 明确 OUT）：转交目标 userId 是否须为实例可见审批人/组织成员——现不强制（职责移交语义），如需限制可见性另立。
- **加签**（添加额外审批人，非替换 assigneeId）——本 SPEC 设计 §8 明确 OUT，另行立项。
- **批量转交**：多任务一次转交（现单任务 `POST /:id/forward`）。
- **转交历史查询**：operation_log `APPROVAL_TASK_FORWARD` 已落审计，如需查询面/视图另立。
- **超时升级**：PENDING task 滞留超时自动升级/提醒——审批中心深化余项，另行立项。
- **全组织视图**（approval.manage 仅定义管理，视图全量归另行）。
- **转交给自己独立错误码**（可选）：现 400 `APPROVAL_ASSIGNEE_INVALID` 语义贴近但非专属，如需独立码低风险改。
- **SPEC-018 minor 承接**：ALL 并发用例补测 / nodeName 唯一性校验 / nodeSchema 投影版本快照 / nodeSchemaModeAt nodeName 交叉校验。
- **SPEC-017 承接**：M2 乐观版本锁 + PATCH 同体真原子性。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）+ uuid moderate 观察（GHSA-w5hq-g745-h8pq）。

## 10. 双渠道验收链

Task 1-3 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 **Approved / 0 Critical**（Task 1 ⚠️① Important 自审守卫修复 + ⚠️②-⑤ minor 照录；Task 2 ⚠️①-③ minor 照录——§5/§7）。Task 1 评审确认：转交→申请人 409 自审守卫系评审 Important 修复（服务 + API 双断言钉死）、转交用例断言非恒真（红阶段天然绿，正断言 + 反过度实现双保障）、零回归 62/21/51。Task 2 评审确认：转交按钮门控 + Modal 参数钉死 + 成功刷新、23=20+3 零回归、前端全量 45/205。Task 3（本任务）为验收与收尾：后端全量 + 前端四闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout 两文档落地；SPEC-019 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑），无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-019 本地闭环（2026-08-03）**：3/3 任务完成；审批转交（forwardTask 服务层 + `POST /:id/forward` API + 前端待办行/详情弹窗转交 UI + **转交→申请人 409 自审守卫**）落地；**零结构变更**（迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 9→**10** +1 条非结构变更）；后端本 SPEC 净增 **+10**（instance +7 + api +3），全量串行 **1816 tests / 1812 pass / 0 fail / 4 skipped**（**0 真 fail 为权威**）；security:test **34/34** 零新增；`security:audit:prod` **exit 0**（双 workspace 0 production_high，较 SPEC-017 记录收敛）；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；前端四闸门 ApprovalCenterPage **23/23** + typecheck 0 + lint 0 err（预存 4 warning）+ build 成功；已知非阻断项 §7 照录（含承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
