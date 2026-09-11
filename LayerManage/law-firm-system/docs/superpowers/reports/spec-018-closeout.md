# SPEC-018 审批会签 — 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1-3 双渠道 Approved + Task 3 验收闸门全绿）
需求来源：SPEC-016/017 closeout §9「审批中心深化余项——会签（节点内多人并行）」+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-approval-counter-sign-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-approval-counter-sign/progress.md

## 1. 交付范围

**会签（节点内全部通过）端到端**，**零结构变更**（nodeSchema Json 配置数据扩展，mode 字段随配置数据走，无 schema/迁移/权限/事件/路由变更）：

- **节点结构扩展 mode（D1/D2）**：`ApprovalChainNode` + `mode?: 'ANY' | 'ALL'`（**缺省 `'ANY'`**=任一通过向后兼容）；`buildApprovalChain` 运行期逐节点校验 + `assertNodeSchemaValid` 定义 CRUD 本地镜像——mode 存在且 ∉ `{'ANY','ALL'}` → `APPROVAL_ASSIGNEE_INVALID` 400（畸形配置防静默，D7）。
- **ALL 停留 processTask（D3/D6）**：`approval-instance-service.ts` processTask 既有推进/定稿分支前插入 ALL 判定（:299-345）——task 翻转后 `target==='APPROVED'` 且当前节点 `mode==='ALL'` → `approvalTask.count({instanceId, nodeName, status:'PENDING'})` 计余 PENDING：
  - `remainingPending > 0`（首签/中签）→ **仅翻转自身**（兄弟 PENDING 保留、不取消），实例 currentNode/version **不变**、零推进、**零 completed 事件**、不建下节点 Task；PROCESS 审计 `toStatus:'PENDING'` + `mode:'ALL'` + `hasReason`；callbackKey result `{status:'PENDING', currentNode}`。
  - `remainingPending === 0`（最后一签）→ **落既有推进/定稿分支**（非末节点 → currentNode++ + 下节点 Task；末节点 → APPROVED 定稿 `completed` 恰 1）。
  - **REJECT 任意节点任意 mode 一票否决不变（D4）**；缺省/'ANY' 短路（`node.mode === 'ALL'` 为 false，既有 ANY 语义逐字零回归）。**有意偏差**：ALL 停留对任意节点生效（含末节点首签停留），非 brief 字面 `!isFinalNode`——按设计 D3/D6 语义（否则末节点会签退化为 ANY），评审追认必要且正确。
- **视图 nodeSchema（Task 2 数据源）**：`ApprovalInstanceView` + `nodeSchema: Prisma.JsonValue | null`（approval-types :93/:152）+ `loadInstanceView`/`listInstances`/`getInstance` 查询 `include` 增 `definition: { select: { nodeSchema: true } }`；`projectApprovalInstance` 形参扩展 `definition?` 缺省 null，既有调用零回归。
- **前端会签 Tag（D10）**：`ApprovalCenterPage` `renderTaskGroups` 节点进度链——`nodeSchemaModeAt(record, index)` 数组判 + 下标取 mode，`mode==='ALL'` 节点名旁补 `<Tag color="purple" data-testid={node-countersign-{nodeName}}>会签</Tag>`；ANY/缺省/null 无 Tag（既有 17 例零回归）。`api/approval.ts` `ApprovalInstanceView` + `nodeSchema: Record<string, unknown> | null` 镜像后端。
- **零结构变更（D11）**：迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 **9**（approval 域）全不变。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证沿 SPEC-017）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 服务层会签（processTask ALL 分支 + mode 校验 + 视图 nodeSchema） | approval-instance-service **55/55**（48 既有 + 7 新）+ approval-definition-service **17/17**（16 既有 + 1 新）+ approval 域零回归 **67/67**（policy/catalog/api/events）+ tsc/eslint 0 |
| 2 | 前端会签标注 | ApprovalCenterPage **20/20**（17 既有 + 3 新）+ 前端全量 **45 files / 202 tests 零回归** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功 |
| 3 | 闸门 + 文档（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 3 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令 + `--test-skip-pattern`） | **1806 tests / 1802 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| 前端四闸门 | ApprovalCenterPage **20/20** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning） |
| server typecheck | `npx tsc --noEmit` 0（Task 1 已验，Task 3 零 server 改动） |

### 3.3 全量合计（Task 3 实测，清净窗）

**实测：1806 tests / 1802 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-018 净增（后端）：Task 1 approval-instance-service **+7** + approval-definition-service **+1** = **+8**（前端 Task 2 为前端件，不计后端计数）。

> **对账**：同闸门口径 SPEC-017 基线 = **1798 / 1794 pass / 0 fail / 4 skipped**；本 SPEC 净增 +8 → **1806 / 1802 pass / 0 fail / 4 skipped**（1798+8=1806、1794+8=1802，4 skipped 不变）。**0 真 fail 为权威结论**，计数链终态以实测为准（§3.2）。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 权限 122 不变 / 事件 15 不变 / 路由 approval 域 9 不变**——SPEC-018 **零结构变更**（nodeSchema 为 Json 列，mode 字段随配置数据走，无 schema/迁移/权限/事件/路由变更）。
- **迁移实证（Task 3 复验）**：`npm run db:reset:test` 重放 **26** 迁移 → `npm run db:assert-empty` **PASS**（assert-empty 排除 ApprovalDefinition/Permission/EventSubscription/ContractTemplate 供给目录，与既有同型）→ `npx prisma migrate deploy` 二次跑 **零迁移幂等**（0 待应用）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——2 SYSTEM + 5 BUSINESS，SPEC-018 未动角色）。
- **路由终态**（approval 域 9 条）：既有 6 条（GET /definitions approval.apply、GET /approvals、GET /approvals/:id、POST /approvals、POST /:id/withdraw、POST /:id/process）+ SPEC-017 3 条（POST /definitions、GET /definitions/manage、PATCH /definitions/:code，全 approval.manage）——**SPEC-018 零路由变更**。

## 5. 关键裁决记录（D1-D11 + 实施期 ⚠️ 裁决累积）

设计 §2 D1-D11 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | mode 字段 | 节点结构 `{name, approverRule, mode?}`——`mode ∈ 'ANY'\|'ALL'`，**缺省 `'ANY'`**（既有 5 种子 + 既有自定义 nodeSchema 零行为变化，向后兼容） |
| D2 | ANY 语义保持 | mode 缺省/'ANY' → 现有行为：首个 APPROVE 定稿/推进，余 PENDING CANCELLED（零改动） |
| D3 | ALL 语义 | mode='ALL' → 首个（及后续非最后）APPROVE **仅翻转该 task**，实例停留当前节点（currentNode 不变、零推进、零 completed 事件、不创建下节点 Task）；**最后一个** PENDING task APPROVE → 推进/定稿（同 ANY 的推进/定稿路径） |
| D4 | REJECT 语义 | 任意节点、任意 mode REJECT → 仍定稿 REJECTED（当前+未来 PENDING CANCELLED）——REJECT 一票否决，不变 |
| D5 | 自审校验 | 不变：申请人 ∈ 节点审批人集 → 409（apply 节点[0] + 推进时下节点） |
| D6 | 推进判定 | processTask 翻转后：若当前节点 mode==='ALL' **且** 该节点仍有 PENDING task（即非最后一个）→ 停留当前节点，实例仍 PENDING，无推进无 completed；否则走既有推进/定稿分支 |
| D7 | 校验 | buildApprovalChain/definition-service 校验：mode 若存在必须 ∈ {'ANY','ALL'}，否则 `APPROVAL_ASSIGNEE_INVALID` 400（畸形配置防静默） |
| D8 | 版本语义 | 每个 APPROVE 都 version+1（task 翻转 + 实例在推进/定稿时 version+1；ALL 中途 APPROVE 仅 task version+1，实例 version 不变） |
| D9 | 幂等 | 不变：已处理 task 重放返回现状零事件；推进 callbackKey 重放返回推进后状态 |
| D10 | 前端 | 详情弹窗节点进度 + 节点内 task 表已逐条显示状态（PENDING/APPROVED/REJECTED/CANCELLED）——ALL 部分已签部分待签自然呈现；节点 tag 语义补「会签（全部通过）」标注 |
| D11 | 零结构变更 | nodeSchema Json 配置数据，无 schema/迁移/权限/事件/路由变更 |

**实施期裁决（Task 1-3 评审追认，逐条照录）**：

1. **Task 1 ⚠️① 缺 ALL 并发用例**：无同节点双 APPROVE 并发测试——FOR UPDATE 串行化分析成立（每次翻转后重查 remainingPending），现网并发面仅跨实例 callbackKey；**列 follow-up 可补**（§9）。
2. **Task 1 ⚠️② remainingPending 依赖 nodeName 节点内唯一**：`approvalTask.count({instanceId, nodeName, status:'PENDING'})` 跨节点同名会误计——既有数据假设（nodeSchema 节点名唯一），**列 follow-up 定义校验补节点名唯一性**（§9）。
3. **Task 1 ⚠️③ mode 校验分工不对称**：definition-service `assertNodeSchemaValid` 完整形态闸门（create/update 即拒）vs buildApprovalChain 运行期兜底——既有分工照录（双点均 400，无路径缺口）。
4. **Task 2 ⚠️① 下标对齐依赖后端 createdAt asc 不变式**：`nodeSchemaModeAt` 按下标取 mode，与 `groupTasksByNode` 分组下标同序（tasks createdAt asc id asc + 首现序 = 链序，用例实证）——可接受。
5. **Task 2 ⚠️② nodeSchema 投影取当前定义非版本快照**：在飞实例飞行改定义 → 会签 Tag 错位风险——**既有设计特性**（实例按 definitionVersion 快照流转，视图投影当前定义），如需强一致另立后续项（§9）。
6. **Task 2 ⚠️③ 负断言非恒真**：用例 2/3 红阶段天然绿（特性未实现时「无 Tag」成立），非恒真由「实现过度即失败」+ 正断言驱动双保障成立。
7. **Task 2 I×1 nodeSchemaModeAt 可加 nodeName 交叉校验**：防御性加固（非必需），照录不落地。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` **exit 0**，双 workspace 生产审计 passed（server `production_high=0`/`production_critical=0`；web `production_high=0`/`production_critical=0`）——**实测终态较 SPEC-017 记录（2 production_high）已收敛**（2026-08-03 实测：安装版本 react-router **8.3.0**/brace-expansion **5.0.8** 均已覆盖既有 advisory，SEC-2026-002 对应漏洞不再命中；现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断）。**本 SPEC 零新增例外**。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **缺 ALL 并发用例**（minor，Task 1 ⚠️①）：无同节点双 APPROVE 并发测试——FOR UPDATE 串行化分析成立；列 follow-up（§9）。
2. **remainingPending 依赖 nodeName 唯一**（minor，Task 1 ⚠️②）：nodeSchema 跨节点同名误计风险——既有数据假设；列 follow-up 定义校验补唯一性（§9）。
3. **mode 校验分工不对称**（信息性，Task 1 ⚠️③）：definition-service 定义 CRUD 闸门 + buildApprovalChain 运行期兜底双点均 400，无路径缺口。
4. **下标对齐依赖 createdAt asc 不变式**（信息性，Task 2 ⚠️①）：节点 mode 与分组下标同序依赖既有排序不变式，已实证可接受。
5. **nodeSchema 投影取当前定义非版本快照**（信息性，Task 2 ⚠️②）：飞行改定义会签 Tag 错位风险——既有设计特性，如需强一致另立后续项。
6. **负断言非恒真**（信息性，Task 2 ⚠️③）：由正断言 + 反过度实现双保障成立。
7. **nodeSchemaModeAt nodeName 交叉校验**（信息性，Task 2 I×1）：防御性可加（非必需），照录不落地。
8. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：M2 乐观版本锁（approval-definition-service update/setStatus 无 version 条件，SPEC-017 §7-1）；PATCH 同体非单事务（update/status 各独立事务，SPEC-017 §7-2）；code 命名惯例 `^[A-Z][A-Z0-9_]{0,99}$`（SPEC-017 §7-3）；部署提示 approval.manage 需重跑 `npm run system:bootstrap` 落 permission 表（SPEC-017 §7-4）；审批中心深化余项（转交/加签/超时升级/全组织视图/审批人表达式/节点级事件——设计 §8 明确 OUT）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；SUPPLEMENT 父状态复查；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；预存漂移已由 `20260802120000_schema_drift_reconcile` 闭环；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **计数对账**：1798 + 净增 **+8**（instance +7 + definition +1）= **1806 实测**（1802 pass / 0 fail / 4 skipped）——同闸门口径，0 真 fail 为权威。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 approval **9** 全不变——与设计 §7/§8 逐字对齐（D11 零结构变更）。
3. **错误码对账**：无新增错误码；mode 畸形复用 `APPROVAL_ASSIGNEE_INVALID`（400，buildApprovalChain 运行期 + assertNodeSchemaValid 定义 CRUD 双点）。
4. **事件对账**：事件 15 不变；会签中途停留零 completed（`approval.instance.completed` 仅末节点全签定稿/REJECT/withdraw 恰 1），created 载荷不变。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **audit:prod 实测对账**：SPEC-018 Task 3 实测 `security:audit:prod` **exit 0**（server/web 均 passed，0 production_high），较 SPEC-017 收官记录（exit 1、2 production_high）**已收敛**——安装版本 react-router 8.3.0 / brace-expansion 5.0.8 覆盖既有 advisory（SEC-2026-002 不再命中）；现存 server 1 production moderate（uuid）report 不阻断。以实测终态为权威（§6）。

## 9. Follow-up 路由（候选专项）

- **ALL 并发用例补测**（Task 1 ⚠️①）：同节点双 APPROVE 并发用例（FOR UPDATE 分析成立，现网仅跨实例 callbackKey 并发——补测试钉死）。
- **nodeName 唯一性校验**（Task 1 ⚠️②）：definition-service `assertNodeSchemaValid`/buildApprovalChain 补节点名唯一性校验（remainingPending 依赖 nodeName 节点内唯一）。
- **nodeSchema 投影版本快照**（Task 2 ⚠️②）：在飞实例飞行改定义 → 会签 Tag 错位风险——如需强一致另立（视图投影定义版本快照）。
- **nodeSchemaModeAt nodeName 交叉校验**（Task 2 I×1）：防御性加固（非必需）。
- **审批中心深化（承接既有，设计 §8 OUT）**：转交 / 加签 / 超时升级 / 全组织视图（approval.manage 仅定义管理，视图全量归另行）/ 审批人表达式 / 上级规则 / 节点级事件。
- **Definition 加固（SPEC-017 承接）**：M2 乐观版本锁（update/setStatus version 条件）+ PATCH 同体真原子性（service 组合方法）。
- **成员指派运营指南（SPEC-015 承接）**：5 个 BUSINESS 审批角色（HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER）成员归运行期指派，指派后五类审批方可产生实际审批人。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。

## 10. 双渠道验收链

Task 1-3 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 **Approved / 0 Critical**（Task 1 ⚠️×3 / Task 2 ⚠️×3 + I×1 全照录——§5/§7）。Task 1 评审确认：ALL 停留语义末节点首签停留系**必要且正确**（brief 字面 `!isFinalNode` 偏差追认）、7+1 用例断言非恒真、零回归 55/17/67。Task 2 评审确认：nodeSchemaModeAt 下标与分组同序实证、20=17+3 零回归、前端全量 45/202。Task 3（本任务）为验收与收尾：后端全量 + 前端四闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout 两文档落地；SPEC-018 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑），无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-018 本地闭环（2026-08-03）**：3/3 任务完成；会签 mode 扩展（nodeSchema 节点 mode `'ANY'|'ALL'`，缺省 ANY）+ ALL 停留 processTask（remainingPending 判定、零推进零 completed、末签落穿推进/定稿）+ 视图 nodeSchema 透传 + 前端「会签」Tag（node-countersign-{nodeName}）；**零结构变更**（迁移 **26**/模型 **60**/权限 **122**/事件 **15**/路由 approval **9** 全不变）；后端本 SPEC 净增 **+8**（instance +7 + definition +1），全量串行 **1806 tests / 1802 pass / 0 fail / 4 skipped**（**0 真 fail 为权威**）；security:test **34/34** 零新增；`security:audit:prod` **exit 0**（双 workspace 0 production_high，较 SPEC-017 记录收敛）；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；前端四闸门 ApprovalCenterPage **20/20** + typecheck 0 + lint 0 err（预存 4 warning）+ build 成功；已知非阻断项 §7 共 8 条照录（含承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
