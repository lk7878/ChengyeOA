# SPEC-020 审批加签 — 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1-3 双渠道 Approved + Task 3 验收闸门全绿）
需求来源：SPEC-016/017/018/019 closeout §9「审批中心深化余项——加签（添加额外审批人，非替换 assigneeId）」+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-approval-add-signer-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-approval-add-signer/

## 1. 交付范围

**审批加签（Add Signer）端到端**，**零结构变更**（复用 ApprovalTask 既有字段——同节点追加审批人=创建新 PENDING task，无 schema/迁移/权限/事件变更；仅 approval 域路由 10→**11** +1 条 add-signers，非结构变更）：

- **addSigners 服务层（D1-D8 + D4.1）**：`approval-instance-service.ts` +`addSigners(taskId, input)` + `normalizeAddSignerUserIds`——复用 **`approval.process`** 权限码（D1，不新增权限码，权限 122 不变）；仅当前节点 **PENDING task 且 assigneeId=actor** 可加签（D2，非我 404；**任一当前节点审批人都可加签**——非仅申请人）；`addSignerUserIds` 必填非空数组 1-10 人、每人 normalizeRequiredText 1-100、去重（D3，非法 → 400 `VALIDATION_FAILED`）；**目标 ≠ 自己 → 400 `APPROVAL_ASSIGNEE_INVALID`**（加签给自己无意义）；**目标 ≠ 申请人 → 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`**（禁止自审不变量，沿 forward 同款守卫）；**同节点新 PENDING task**（nodeName=task.nodeName、assigneeId=目标、status PENDING，D4）——task.status 仍 PENDING、实例 currentNode/status/version **不变**；审计 `APPROVAL_TASK_ADD_SIGNER`（targetType APPROVAL_TASK，newValues {taskId, addedUserIds, hasReason}，remark 自由文本不落审计，D7）；**不产 outbox 事件、不建 callbackAction**（D6/D8）。
- **D4.1 并发锁点**：事务内首把锁 = **实例行 FOR UPDATE**（沿 processTask 锁点）→ **锁后重验** task 仍 PENDING 且 `nodeName === chain[currentNode].name`（仍当前节点）——否则 409 `APPROVAL_STATE_INVALID`（防加签与推进竞速孤儿 task）。
- **add-signers API（D10）**：`POST /api/v1/approvals/:id/add-signers`（approval.process，`:id`=taskId）——`controller/approval.ts` +`addSigners` + `ADD_SIGNERS_BODY_KEYS` 白名单 + `router.ts` +1（approval 域 10→11）。错误码透传：非我 404 / task·实例非 PENDING 409 / 目标含自己 400 / 目标含申请人 409 / addSignerUserIds 非法 400 / 未知键 400 / 锁后重验失败 409。
- **前端加签（D9）**：ApprovalCenterPage 待办行 PENDING task 操作区 + 详情任务表（仅当前用户 PENDING 行）「加签」按钮（`approval.process` 门控，与转交同区）→ Modal 目标 userIds 逗号分隔 Input（required+whitespace 校验 + `parseCsv` 拆分去空白 + 空数组拦截）→ `approvalApi.addSigners(taskId, {addSignerUserIds})` → 成功 `message.success('加签成功')` + 刷新 TODO 列表；提交期间 `confirmLoading` 防连点。`api/approval.ts` +`AddSignersInput` + `addSigners`。详情任务表操作列用 React Fragment 包裹（转交+加签并排；AntD Space 对 rc-table 单元格测量开销放大——见 §7/§5 Task 2 ⚠️①）。
- **零结构变更（D11）**：迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 10→**11**（+POST /:id/add-signers，非结构变更）。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证沿 SPEC-017/018/019）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 服务层 addSigners（含 D4.1 并发锁点）+ add-signers API + 路由 +1 | approval-instance-service **73/73**（63 既有 + 10 新）+ approval-api **23/23**（21 既有 + 2 新）+ approval 域零回归 **51/51**（definition 17 + policy/catalog 34）+ approval-events **15/15** + tsc/eslint 0 |
| 2 | 前端加签（待办行 + 详情弹窗 + api） | ApprovalCenterPage **26/26**（23 既有 + 3 新）+ 前端全量 **45 files / 208 tests 零回归** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功 |
| 3 | 闸门 + 文档（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 3 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令 + `--test-skip-pattern`） | **1830 tests / 1826 pass / 0 真 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；首次全量 1 例瞬态 teardown 失败——lead-api `permission.createMany` DDL 竞态——隔离复跑 19/19 绿不计失败，对账见 §3.3/§7） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| 前端四闸门 | ApprovalCenterPage **26/26** + 前端全量 **45 files / 208 tests** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning） |
| server typecheck | `npx tsc --noEmit` 0（Task 1 已验，Task 3 复跑 0） |

### 3.3 全量合计（Task 3 实测，清净窗）

**实测：1830 tests / 1826 pass / 0 真 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归；首次全量 1 例瞬态 teardown 失败——lead-api `permission.createMany` 报「permission 表不存在」DDL 竞态（跨进程 TRUNCATE/迁移重置窗口）——隔离复跑 **19/19 绿**，按既有闸门纪律「撞车签名不计失败、不改测试助手/配置」，0 真 fail 成立）。

SPEC-020 净增（后端）：Task 1 approval-instance-service **+10** + approval-api **+2** = **+12**（前端 Task 2 为前端件，不计后端计数）。

> **对账**：同闸门口径 SPEC-019 终态 = **1816 / 1812 pass / 0 fail / 4 skipped**；本 SPEC 净增 +12 → 预期 **1828**；**实测 1830**（1816+14）——**余 +2 为外部并行渠道基线漂移**（Task 1 已实证 approval-instance-service 既有 **63** 非 brief 所述 62；外部渠道对既有测试的增改——含 SPEC-018 ALL 并发用例重构——使全量基线较 SPEC-019 收官记录小幅上移）。**0 真 fail 为权威结论**，计数链终态以实测为准（§3.2）。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 权限 122 不变 / 事件 15 不变 / 路由 approval 域 10→11**——SPEC-020 **零结构变更**（复用 ApprovalTask 既有字段——同节点追加审批人=创建新 PENDING task，无 schema/迁移/权限/事件变更；仅 +1 条 add-signers 路由，非结构变更）。
- **迁移实证（Task 3 复验）**：`npm run db:reset:test` 重放 **26** 迁移 → `npm run db:assert-empty` **PASS**（assert-empty 排除 ApprovalDefinition/Permission/EventSubscription/ContractTemplate 供给目录，与既有同型）→ `npx prisma migrate deploy` 二次跑 **零迁移幂等**（0 待应用）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——2 SYSTEM + 5 BUSINESS，SPEC-020 未动角色）。
- **路由终态**（approval 域 **11 条**）：既有 6 条（GET /definitions approval.apply、GET /approvals、GET /approvals/:id、POST /approvals、POST /:id/withdraw、POST /:id/process）+ SPEC-017 3 条（POST /definitions、GET /definitions/manage、PATCH /definitions/:code，全 approval.manage）+ SPEC-019 1 条（POST /:id/forward，approval.process，:id=taskId）+ **SPEC-020 1 条（POST /:id/add-signers，approval.process，:id=taskId，字面量 register 于 forward 之后）**——**非结构变更**（路由表条目 +1，Schema/模型/权限/事件零变更）。

## 5. 关键裁决记录（D1-D11 + D4.1 + 实施期 ⚠️ 裁决累积）

设计 §2/§3 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 权限 | 复用 **`approval.process`**（处理任务码）——加签是任务处置动作，不新增权限码（权限 122 不变） |
| D2 | 主体 | 仅当前节点 **PENDING task 的 assigneeId=actor** 可加签（沿 processTask task 探查语义：非我 404）——**任一当前节点审批人都可加签**（非仅申请人） |
| D3 | 目标 | `addSignerUserIds` 必填非空数组（1-10 人），每人 normalizeRequiredText 1-100——**校验目标 ≠ 自己**（400 `APPROVAL_ASSIGNEE_INVALID`，加签给自己无意义）；**目标 ≠ 申请人**（409 `APPROVAL_SELF_REVIEW_FORBIDDEN`，禁止自审不变量）；目标去重 |
| D4 | 语义 | 加签创建**同节点新 PENDING task**（nodeName=当前节点名，assigneeId=目标），实例 currentNode/status/version 不变；不产 completed 事件；不建 callbackAction；审计 `APPROVAL_TASK_ADD_SIGNER` |
| D5 | 节点推进 | 加签后该节点 PENDING task 数增加——**任一通过（ANY）**：任一审批人 APPROVE 即推进（新 task 并入节点，首个 APPROVE 取消该节点余 PENDING）；**会签（ALL）**：全部（含新增）APPROVED 才推进（remainingPending 判定天然含新 task）——**与既有 processTask 语义自动兼容（零 processTask 逻辑改动）** |
| D6 | 幂等 | 加签不建 callbackAction；重复 POST 会重复创建（**不做去重**——前端防连点 + 幂等 key 可选；低风险接受，列 follow-up） |
| D7 | 审计 | operation_log action `APPROVAL_TASK_ADD_SIGNER`（targetType APPROVAL_TASK，newValues 含 taskId/addedUserIds/hasReason；remark 自由文本不落审计） |
| D8 | 事件 | **不产 outbox 事件**（非定稿/推进，observability 经视图 tasks 增加承载） |
| D9 | 前端 | 待办行/详情弹窗 PENDING task 增「加签」操作（approval.process 门控）——Modal 输入目标 userIds（可多个，逗号分隔）→ 提交加签 |
| D10 | 路由 | `POST /api/v1/approvals/:id/add-signers`（approval.process，`:id`=taskId）——沿 process 路由形态 |
| D11 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（路由 approval 域 10→11 +1 条，非结构变更） |
| D4.1 | 并发锁点 | 加签在事务内首把锁 = **实例行 FOR UPDATE**（沿 processTask 锁点）+ **锁后重验 task 仍 PENDING 且 `nodeName===chain[currentNode].name`**（仍当前节点）——否则 409 `APPROVAL_STATE_INVALID`（防加签与推进竞速孤儿 task；推进先锁则 currentNode 已变 → 加签 409） |

**实施期裁决（Task 1-3 评审追认，逐条照录）**：

1. **Task 1 ⚠️ Minor①（M1）目标已持 PENDING task 重复建**：目标 userId 若已持同节点 PENDING task，加签会再建一条同节点 PENDING task（D6 明确不做去重）——低风险接受（多 PENDING 均按节点语义并入 remainingPending），列 follow-up（幂等 key / 目标重复 PENDING 去重）。
2. **Task 1 ⚠️ Minor②（M2）raw 1-10 先于去重口径微歧义**：`normalizeAddSignerUserIds` 先校验 raw 数组长度 1-10，再去重——去重后实际人数可少于 raw 数；实现取严格 raw 口径（可接受），文档钉死。
3. **Task 1 ⚠️ 外部改测试事件（协调者核实合法修正）**：服务测试运行期间，`approval-instance-service.test.ts` 中既有 SPEC-018 ALL 并发用例断言被**外部进程**重构——`stored.version === 1`（消息 "instance version unchanged (task-only flips + single advance bump)"）改为 `stored.version === 2` 且改以 DB `stored` 为终态。协调者核实系**合法修正**（ALL 节点末个 APPROVE 推进 bump 一次 version = 2，旧断言自相矛盾系既有缺陷；与实现语义一致，非本任务回归）；最终文件态全量重跑 73/73 绿。
4. **Task 2 ⚠️ I×1 详情弹窗 stale 快照**：加签成功后仅刷新 TODO 列表，详情弹窗 activeRecord 不刷新（按钮残留语义正确——沿既有详情不回源形态，非功能缺陷）——列 follow-up。
5. **Task 2 ⚠️ C×3 照录**：①刷新恒 TODO（`fetchInstances('TODO', 1)`——沿 forward/process 既有形态，无 Tab 错位）；②`myPendingTask` fallback 预存；③主表操作列仍 Space（jsdom 未触 rc-table 时延，非本次文件）。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` **exit 0**，双 workspace 生产审计 passed（server `production_high=0`/`production_critical=0`；web `production_high=0`/`production_critical=0`）——实测终态较 SPEC-017 记录（2 production_high）**已收敛**（安装版本 react-router **8.3.0**/brace-expansion **5.0.8** 均已覆盖既有 advisory，SEC-2026-002 对应漏洞不再命中；现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断）。**本 SPEC 零新增例外**。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **目标重复 PENDING task 重复建**（minor，Task 1 M1）：D6 不防重复 POST；前端防连点 + 低风险接受，幂等 key 列 follow-up。
2. **raw 1-10 先于去重口径**（信息性，Task 1 M2）：实现取严格 raw 口径，去重后实际人数可少；文档钉死。
3. **外部改测试事件**（信息性，Task 1 ⚠️）：SPEC-018 ALL 并发用例 version 1→2 系并行渠道合法修正，语义正确非本任务回归。
4. **详情弹窗 stale 快照**（minor，Task 2 I×1）：加签成功不刷新 activeRecord；按钮残留语义正确，列 follow-up。
5. **刷新恒 TODO**（信息性，Task 2 C×1）：加签刷新恒 TODO 视图，无 Tab 错位。
6. **`myPendingTask` fallback / 主表操作列 Space**（信息性，Task 2 C×2/3）：预存形态，jsdom 未触时延。
7. **全量首次跑瞬态 teardown 失败（环境性，Task 3）**：lead-api.test.ts 的 `clearTestApplicationData`（test-database.ts:23 `permission.createMany`）报「permission 表不存在」——跨进程 TRUNCATE/迁移重置窗口的 **DDL 竞态**（撞车签名，与 §8「撞车不计失败」同纪律）；DB 前探清净窗起跑，失败后其余全部 test 文件（复用同一 helper）零影响；**隔离复跑 19/19 绿**。非代码缺陷、非 SPEC-020 回归；不计失败、未改测试助手/配置。
8. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：SPEC-019 转交目标存在性校验（D3 OUT）+ 转交「死按钮」观察；SPEC-018 缺 ALL 并发用例 / nodeName 唯一性 / 投影取当前定义非版本快照；SPEC-017 M2 乐观版本锁 + PATCH 同体非单事务；审批中心深化余项（超时升级/全组织视图/审批人表达式/节点级事件）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **计数对账**：SPEC-019 终态 **1816** + 本 SPEC 净增 **+12**（instance +10 + api +2）= **1828 预期**；**实测 1830 tests / 1826 pass / 0 真 fail / 4 skipped**——余 **+2 为外部并行渠道基线漂移**（instance 既有 63 非 brief 62 + 外部测试增改，Task 1 实证），以实测为权威；0 真 fail 成立（1 例瞬态 teardown DDL 竞态隔离复跑 19/19 绿不计，§7.7）。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 10→**11**（+POST /:id/add-signers，非结构变更）——与设计 §7/§8 逐字对齐（D11 零结构变更，仅路由条目 +1）。
3. **错误码对账**：无新增错误码；加签场景复用既有码——非我 404 `APPROVAL_TASK_NOT_FOUND`、task/实例非 PENDING 409 `APPROVAL_STATE_INVALID`、锁后重验失败 409 `APPROVAL_STATE_INVALID`、目标含申请人 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`、目标含自己 400 `APPROVAL_ASSIGNEE_INVALID`、addSignerUserIds 非法 400 `VALIDATION_FAILED`。
4. **事件对账**：事件 **15** 不变；加签零事件（observability 经视图 tasks 增加承载）。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **audit:prod 实测对账**：SPEC-020 Task 3 实测 `security:audit:prod` **exit 0**（server/web 均 passed，0 production_high），较 SPEC-017 收官记录（exit 1、2 production_high）**已收敛**（与 SPEC-018/019 Task 3 同口径）；现存 server 1 production moderate（uuid）report 不阻断。以实测终态为权威（§6）。

## 9. Follow-up 路由（候选专项）

- **加签目标可见性限制**（设计 §8 OUT）：目标 userId 是否须为实例可见审批人/组织成员——现不强制（协同语义），如需限制另立。
- **加签幂等 key**（D6/D4.1 OUT）：现无 callbackKey，重复 POST 重复创建；前端防连点兜底，如需服务端幂等加 callbackKey。
- **加签通知 outbox**（D8 OUT）：加签不产 outbox 事件，目标人无消息/提醒——如需新事件类型另立。
- **目标重复 PENDING task 去重**（Task 1 M1）：目标已持同节点 PENDING task 时不重复建（或合并）。
- **详情 stale 快照**（Task 2 I×1）：加签/转交成功刷新 activeRecord 或关闭详情弹窗。
- **刷新恒 TODO**（信息性）：审批中心刷新语义统一评估。
- **批量转交 / 转交历史查询**：多任务一次转交 + operation_log `APPROVAL_TASK_FORWARD` 查询面。
- **超时升级 / 全组织视图**：PENDING 滞留自动升级 + 全量视图——审批中心深化余项。
- **加签给自己独立错误码**（可选）：现 400 `APPROVAL_ASSIGNEE_INVALID` 语义贴近但非专属，如需独立码低风险改。
- **SPEC-018 minor 承接**：ALL 并发用例补测 / nodeName 唯一性校验 / nodeSchema 投影版本快照 / nodeSchemaModeAt nodeName 交叉校验。
- **SPEC-017 承接**：M2 乐观版本锁 + PATCH 同体真原子性。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）+ uuid moderate 观察（GHSA-w5hq-g745-h8pq）。

## 10. 双渠道验收链

Task 1-3 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 **Approved / 0 Critical**（Task 1 ⚠️ Minor×2 照录 + 外部改测试事件核实；Task 2 ⚠️ I×1+C×3 照录——§5/§7）。Task 1 评审确认：addSigners 全 9 子项（requireAction/normalizeAddSignerUserIds 1-10 去重/task 探查非我 404/非 PENDING 409/目标含自己 400 含申请人 409/实例行 FOR UPDATE/锁后重验/创建 N 同节点 PENDING task/审计 ADD_SIGNER）+ 状态语义（实例零触碰/零事件/零 callbackAction）+ D4.1 并发正确性（加签/推进/转交/撤回竞速均无孤儿）+ 节点推进兼容（ANY/ALL 零 processTask 改动）+ 测试真实性 10+2 例非恒真 + 零回归 73=63+10、23=21+2、51/15 + tsc/eslint 0。Task 2 评审确认：加签按钮门控 + Modal 参数钉死（parseCsv 拆分去空白 + 空数组拦截）+ 成功刷新 + 详情任务表 isMyPending 行「加签」+ 防连点 + 26=23+3 零回归 + 前端全量 45/208 + 四闸门。Task 3（本任务）为验收与收尾：后端全量 + 前端四闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout 两文档落地；SPEC-020 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑），无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-020 本地闭环（2026-08-03）**：3/3 任务完成；审批加签（addSigners 服务层 + `POST /:id/add-signers` API + 前端待办行/详情弹窗加签 UI + **D4.1 并发锁点**——实例行 FOR UPDATE + 锁后重验防孤儿 task）落地；**零结构变更**（迁移 **26**/模型 **60**/权限 **122**/事件 **15** 全不变；路由 approval 域 10→**11** +1 条非结构变更）；后端本 SPEC 净增 **+12**（instance +10 + api +2），全量串行 **1830 tests / 1826 pass / 0 真 fail / 4 skipped**（**0 真 fail 为权威**；首次全量 1 例瞬态 teardown DDL 竞态——lead-api——隔离复跑 19/19 绿不计失败；+14 较预期 +12 含外部渠道基线漂移 +2，见 §3.3）；security:test **34/34** 零新增；`security:audit:prod` **exit 0**（双 workspace 0 production_high，较 SPEC-017 记录收敛）；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；前端四闸门 ApprovalCenterPage **26/26** + 前端全量 **45 files / 208 tests** + typecheck 0 + lint 0 err（预存 4 warning）+ build 成功；迁移实证 **26 迁移重放 + assert-empty PASS + migrate deploy 二次零迁移幂等**；已知非阻断项 §7 照录（含承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
