# SPEC-016 审批中心多级审批 — 收尾报告

日期：2026-08-02 ｜ 状态：**本地闭环**（Task 1-4 双渠道 Approved + Task 5 验收闸门全绿）
需求来源：专项设计「审批实例任务与消息回调」§2-4（Definition nodeSchema / Instance 逐节点）+ PRD §4.12 复杂版多级审批 + SPEC-013 closeout follow-up「审批中心深化」
设计：docs/superpowers/specs/2026-08-02-approval-multilevel-design.md ｜ 实施台账：.superpowers/sdd/2026-08-02-approval-multilevel/progress.md

## 1. 交付范围

**多级审批端到端落地**（Definition nodeSchema 多节点链 + Instance currentNode 逐节点流转 + 前端节点显示），沿用单节点向后兼容（5 现有种子零改动）：

- **结构扩展（Task 1）**：`ApprovalDefinition` +`nodeSchema Json?`（可空——缺省=顶层 approverRule 单节点）、`ApprovalInstance` +`currentNode Int @default(0)`（当前活动节点下标）——迁移 `20260802100000_approval_multilevel_expand`（两 ALTER，零新索引）；基线锚点 23→24（后随并行漂移治理对齐 26）。
- **种子升级（Task 2）**：bootstrap `BUSINESS_ROLE_SEEDS` +MANAGER（主管，第 5 个 BUSINESS 角色，复用 approval.read/process 两权限，权限码总数 121 不变）；CONTRACT_CHANGE 升为两节点链（主管初审 MANAGER → 合伙人终审 PARTNER，approverRule 列保留）——迁移 `20260802110000_approval_multilevel_provision`（纯 UPDATE 幂等）；check-bootstrap-contract 角色契约 2→7。
- **服务层多级（Task 3）**：apply 链构建（`nodeSchema ?? [顶层 approverRule]` 单节点兜底）+ 节点[0] Task + APPLY 审计含 currentNode:0；process 推进 vs 定稿分支（APPROVE 非末节点 → 取消当前节点余 PENDING + 下节点审批人解析（**含下节点自审 409，事务回滚**）+ create 下节点 Task + `currentNode++/version+1` + 实例仍 PENDING + 零 completed 事件；末节点 APPROVE → APPROVED 定稿；REJECT 任意节点 → REJECTED + 当前/未来 PENDING CANCELLED）；withdraw 任意 PENDING 阶段（当前/未来 PENDING task CANCELLED）；视图 +`currentNode`（列表/详情统一投影）。
- **前端节点显示（Task 4）**：审批中心页详情弹窗 tasks 按 nodeName 分组 + currentNode 节点进度链（`node-state-<nodeName>`/`node-group-<nodeName>` testid）+ 待办行节点名（单节点 '审批' 弱化文本 / 多级节点名 Tag 突出）；`ApprovalInstanceView` +`currentNode`。
- **运维文档（Task 5，本报告）**：runbook §9.1/§9.2/§9.3/§9.7/§9.8/§9.9 多级节点推进同步 + 本 closeout。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 结构迁移 +nodeSchema/currentNode 2 列 + 基线锚点 23→24 | baseline-contract 11 + schema-contract 11 + spec-008 迁移契约 5 = **27/27** + tsc 0 + migrate diff 零新 diff（仅既有 4 漂移照录） |
| 2 | bootstrap +MANAGER + CONTRACT_CHANGE nodeSchema 升级 + 契约 2→7 | 受影响件全量 **164/164**（计数 25 态独立串行）+ 26 态静态件 **138/138** + check:bootstrap PASS（角色 2→7）+ check:baseline PASS（26/60）+ tsc/eslint 0 |
| 3 | 服务层多级 apply/process/withdraw/视图 | instance **44/44**（34 既有 + 10 多级；39 顶层 + 5 循环）+ policy/catalog **34/34**（21+13）+ tsc/eslint 0 |
| 4 | 前端详情/待办节点显示 | ApprovalCenterPage **11/11**（9 既有 + 2 新增）+ typecheck 0 + lint 0 err（预存 4 warning）+ build 成功（仅预存 chunk-size warning） |
| 5 | 闸门 + runbook/closeout（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 5 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（串行） | 见 §3.1（Task 1-4 全绿） |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1771 tests / 1767 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| 迁移重演 + 空库断言 + 重跑幂等 | db:reset:test（**26 迁移**重放）→ db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0 |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| 前端四闸门 | ApprovalCenterPage **11/11** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning） |

### 3.3 全量合计（Task 5 实测，清净窗）

**实测：1771 tests / 1767 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-015 基线 **1759 tests**。SPEC-016 净增 **12**：Task 3 instance +10（10 个多级用例，34→44）、Task 2 bootstrap/contract 净增 +2（MANAGER 契约 / nodeSchema provision 直查）、Task 1 零净增（锚点计数改期望不改数量）、Task 4 为前端件（不计后端计数）——与实测 **1759 + 12 = 1771 精确对账**。

> **对账**：1759 + 12 = 1771 预期，与实测**精确一致**（逐文件 grep 计数：Task 3 instance 44=34+10 实证；全量无真失败）。**0 真 fail 为权威结论**，计数链终态以实测 1771 为准。

## 4. 迁移与模型

- **迁移总数 23 → 26**（SPEC-016 +2：expand + provision；并行漂移治理 +1：schema_drift_reconcile——跨渠道协调终态）；**model 60 不变**（+2 列：nodeSchema/currentNode）；**权限 121 不变**（MANAGER 角色不增权限码，复用 approval.read/process）；**事件 15 不变**（created/completed 载荷不变，节点推进不产 completed）；**路由不变**。
- **SPEC-016/漂移迁移清单**（26 迁移目录实测）：
  - `20260802100000_approval_multilevel_expand`：两 ALTER——`approval_definition +nodeSchema JSONB` / `approval_instance +currentNode INTEGER NOT NULL DEFAULT 0`（零新索引）。
  - `20260802110000_approval_multilevel_provision`：CONTRACT_CHANGE nodeSchema 两节点链 UPDATE（主管初审 MANAGER → 合伙人终审 PARTNER；approverRule 列保留；纯 UPDATE 幂等）。
  - `20260802120000_schema_drift_reconcile`（**并行通道漂移治理**）：5 处默认值/索引名对齐（permission.updatedAt / user_role validFrom/updatedAt / admin_operation 双索引名），零表/列/权限/事件。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**）。
- 迁移实证：db:reset:test 重放 **26 迁移** → db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等）。
- 基线契约同步点（Task 1/2 已同步）：check-baseline-contract.ts（CANONICAL 26/60）+ baseline-contract.test.ts + spec-008-event-observability-migration-contract.test.ts + schema-contract.test.ts（model 总数两处）。

## 5. 关键裁决记录（Q1-5，设计 §2 决策 + 实施期 ⚠️ 裁决累积）

| # | 决策 | 裁决 |
|---|---|---|
| Q1 | nodeSchema | `ApprovalDefinition.nodeSchema Json?`（可空）——**缺省 = 单节点链（顶层 approverRule 向后兼容，5 现有种子零改动）**；有 = 多节点链 `[{name, approverRule}]` |
| Q2 | currentNode | `ApprovalInstance.currentNode Int @default(0)`（当前活动节点下标） |
| Q3 | apply | 链 = `nodeSchema ?? [顶层 approverRule]`；建 Instance PENDING + 节点[0] 的 Task（N 审批人） |
| Q4 | process | **节点内任一通过、节点间顺序推进**；节点 APPROVE → 非末节点 → `currentNode++` + 生成下节点 Task + 实例仍 PENDING（**下节点自审 409 适用全部节点，事务回滚**）；末节点 → APPROVED 定稿；REJECT 任一节点 → REJECTED + 取消当前/未来 PENDING task |
| Q5 | 种子升级 | **bootstrap +MANAGER 角色**（第 5 BUSINESS 角色，主管初审用）+ **CONTRACT_CHANGE 升为多节点链**（主管初审→PARTNER 终审）——provisioning，使能力真实落地 |

**跨渠道协调事件（计数链终态，协调者裁决 #1/#2）**：并行通道新增 `20260802120000_schema_drift_reconcile` 使迁移计数 24→25（本 SPEC provision）→ **26**（并行漂移治理）；3 件基线锚点被并行通道外部对齐 26。**Task 5 计数链终态 = 26/60**（非计划原文 24/60）。

**实施期裁决（Task 1-4 评审追认，逐条照录）**：

1. **Task 1 ⚠️① 迁移手写 + 列物理序**：迁移 SQL 手写（未走 `migrate dev` 生成），Prisma 不 diff 列序——一致性由 migrate diff 重放闭环坐实（零新 diff 即迁移与 schema 逐字对齐）。
2. **Task 1 ⚠️② NULL nodeSchema=顶层 approverRule 单节点契约**：路由 Task 3 实现（`buildApprovalChain` 合成单节点）。
3. **Task 1 ⚠️③ rehearsal 测试不钉总数**：新 DDL 极简影子重放过，rehearsal 不钉总数照录。
4. **Task 2 ⚠️① 清单外锚点 24→25→26**：本任务 provision 迁移机械后果（check:baseline/baseline-contract/spec-008 必改）+ 并行通道外部对齐 26——必要机械后果，计数链终态 26/60。
5. **Task 2 ⚠️② DB 证据时间窗**：164/164 于 25 态、26 态仅静态——漂移迁移正交（仅默认值/索引名），Task 3+ 在 26 终态跑 DB 自然验证。
6. **Task 2 ⚠️③ "2→7"浓缩表述**：实为 bootstrap 契约 6→7（+MANAGER），"2→7"为「2 SYSTEM → 总 7 角色」浓缩口径照录。
7. **Task 3 ⚠️① 空数组畸形 400 无测试**：`buildApprovalChain` 空数组 → `APPROVAL_ASSIGNEE_INVALID` 400 无直接用例，列 follow-up 补。
8. **Task 3 ⚠️② nodeSchema 非数组对象静默回落单节点**：可辩护未文档化，列 minor 可加固 400。
9. **Task 3 ⚠️③ 多级节点内任一通过无直接用例**：共享路径间接覆盖，列测试加固。
10. **Task 3 ⚠️④ 无 3 节点链用例**：2 节点实证逻辑静态正确，列测试加固。
11. **Task 3 ⚠️⑤ "既有 34 零改动"措辞**：审计断言同步系裁决 #2 契约扩展（APPLY 审计 +currentNode:0），透明披露。
12. **Task 4 ⚠️① 例②呈现层断言不足**：Tag 元素/弱化 rgba 样式未断言——行为层区分已验证，可接受不修。
13. **Task 4 ⚠️② nodeStateMeta 越界不 clamp**：纯防御路径真实数据恒在界内，不崩溃——列 closeout minor 可选 clamp。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011/012/013/014/015 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 5 占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **Task 1 迁移手写 + 列物理序**（信息性）：Prisma 不 diff 列序，全仓 expand 先例实证——migrate diff 零新 diff 闭环坐实（§5-1）。
2. **Task 1 NULL nodeSchema 单节点契约**（路由）：契约由 Task 3 `buildApprovalChain` 实现（§5-2）。
3. **Task 1 rehearsal 不钉总数**（信息性）：新 DDL 极简影子重放过（§5-3）。
4. **Task 2 基线锚点 24→25→26 清单外改动**（必要机械后果）：本任务 provision 迁移 + 并行漂移治理共同决定终态 26（§5-4）。
5. **Task 2 DB 证据时间窗**（信息性）：164/164 于 25 态、26 态仅静态——漂移迁移正交，Task 3+ 在 26 终态 DB 验证（§5-5）。
6. **Task 2 "2→7"浓缩表述**（信息性）：实 6→7，浓缩口径照录（§5-6）。
7. **Task 3 空数组畸形 400 无测试**（minor）：`nodeSchema=[]` → 400 无直接用例，列 follow-up 补（§9）。
8. **Task 3 nodeSchema 非数组对象静默回落单节点**（minor）：可加固 400（§9）。
9. **Task 3 多级节点内任一通过无直接用例**（minor）：共享路径间接覆盖，列测试加固（§9）。
10. **Task 3 无 3 节点链用例**（minor）：2 节点实证逻辑静态正确，列测试加固（§9）。
11. **Task 3 "既有 34 零改动"措辞**（信息性）：审计断言同步系契约扩展，透明披露（§5-11）。
12. **Task 4 例②呈现层断言不足**（cosmetic）：Tag 元素/弱化 rgba 样式未断言——行为层区分已验证（§5-12）。
13. **Task 4 nodeStateMeta 越界不 clamp**（minor）：纯防御路径，可选 clamp（§5-13/§9）。
14. **终态边界**：迁移 **26**（含并行漂移治理）/模型 60/权限 121/事件 15/路由不变；bootstrap 角色 2→7；成员指派归运行期（§9 承接）。
15. **补强闭环（2026-08-02 晚，跨渠道 minor 加固——§7 原 7/8/9/10/13 已落地）**：Task 3 ⚠️①-④ + Task 4 ⚠️② 四项 minor 由并行渠道实现并经本窗口吸收核对：①`buildApprovalChain` 非数组对象 → `APPROVAL_ASSIGNEE_INVALID` 400（防静默单节点回落，service:731-733）+ 空数组 400（:735-737）；②后端测试 +4 例（空数组 400 零副作用 / 非数组对象 400 / 3 节点链逐步推进定稿 / 节点内任一通过取消兄弟 task+推进）——**48/48 全绿**；③前端 `nodeStateMeta` 越界 currentNode clamp 到末分组（ApprovalCenterPage.tsx:111-114）+ 新增 clamp 用例（currentNode=5 两节点链，非恒真）——**12/12 全绿** + typecheck 0 + lint 0。**零结构变更**（迁移 26/模型 60/权限 121/事件 15/路由不变/角色 7）。后端全量基线预期 1771 → **1775**（+4 加固测试），全量实测未在本窗口重跑（并行渠道停歇窗内仅跑受影响件）。
16. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：审批中心深化余项（会签/转交/加签/超时升级/Definition CRUD approval.manage/全组织视图/审批人表达式/节点级事件——设计 §8 明确 OUT）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；SUPPLEMENT 父状态复查；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；**预存漂移 4 项已由并行通道 `20260802120000_schema_drift_reconcile` 闭环**（admin_operation 双索引名 / permission.updatedAt / user_role validFrom/updatedAt 默认值——本 SPEC 见证，非本渠道产物）；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）。

## 8. 对账项

1. **计数对账**：SPEC-015 **1759** + 净增 **12** = **1771 实测精确一致**（§3.3）。
2. **结构终态对账**：迁移 **26**（本 SPEC 23→24 expand / 24→25 provision / 并行漂移治理 25→26）/模型 60（+2 列）/权限 121/事件 15/路由不变——与协调者裁决 #1/#2 逐字对齐（26/60/121/15/路由不变/角色 7）。
3. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012/013/014/015 先例），扫描 exit 0。
4. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）。
5. **闸门计数按实际运行数**：Task 5 全量按实际运行计数（非静态估计），计数链终态以实测为准。

## 9. Follow-up 路由（候选专项）

- **nodeSchema 畸形加固**（本 SPEC minor）：非数组对象静默回落单节点 → 可加固 400（Task 3 ⚠️②）。
- **多级测试加固**（本 SPEC minor）：`nodeSchema=[]` 空数组 400 / 3 节点链 / 多级节点内任一通过直接用例（Task 3 ⚠️①③④）。
- **nodeStateMeta 越界 clamp**（本 SPEC minor）：可选加固（Task 4 ⚠️②）。
- **审批中心深化（本 SPEC 承接，设计 §8 明确 OUT）**：会签（节点内多人）/ 转交/加签 / 超时升级 / Definition CRUD（`approval.manage` 码未建）/ 全组织视图 / 审批人表达式 / 节点级事件。
- **业务角色成员指派**（SPEC-015 承接，紧邻）：5 角色（HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER）已供给，**成员指派归运行期**（role-auth-service/user-grant 经角色管理 API）——指派后五类审批方可产生实际审批人；建议提供成员指派运营指南/种子。
- **terminate 侧硬化**（SPEC-014 MEDIUM 承接）：createPayment 提交后 terminate 在途闸残余窗——terminate 侧在途闸取 Contract FOR UPDATE + 锁后重验在途 PENDING。
- **SUPPLEMENT 父状态复查**：独立 follow-up（设计 §6 OUT）。
- **check-bootstrap-contract 授权语义强化**（SPEC-015 minor）：授权检查字面量 → AST 语义绑定（可选）。
- **测试标题现代化**（SPEC-015 cosmetic）：bootstrap 既有标题随角色断言更新。
- **漂移治理专项**：预存漂移 4 项已由并行通道 26 迁移闭环（本 SPEC 见证）；后续 schema↔DB 漂移持续 shadow diff 治理。
- **前端 flake 治理**：预存负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。

## 10. 双渠道验收链

Task 1-4 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 **Approved / 0 Critical**（Task 1 ⚠️×3 / Task 2 ⚠️×3 / Task 3 ⚠️×5 / Task 4 ⚠️×2 全照录——§5/§7）。Task 5（本任务）为验收与收尾：全量闸门 + 迁移实证 + runbook/closeout 两文档落地；SPEC-016 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑），无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-016 本地闭环（2026-08-02）**：5/5 任务完成；结构扩展（迁移 23→**26**（含并行漂移治理）/模型 **60 不变**（+2 列）/权限 **121 不变**/事件 **15 不变**/路由不变）；bootstrap 角色 **2→7**（+MANAGER，CONTRACT_CHANGE 两节点链）；后端本 SPEC 直接改动面 Task 1 **27/27** + Task 2 **164/164**（25 态）+ **138/138**（26 态静态） + Task 3 instance **44/44** + policy/catalog **34/34**，全量串行 **1771 tests / 1767 pass / 0 fail / 4 skipped**（SPEC-015 1759 + 净增 12 精确对账 §3.3，**0 真 fail 为权威**）；security:test 34/34 零新增；迁移实证 **26 重放** + 空库断言 PASS + 重演幂等零迁移；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；已知非阻断项 §7 共 15 条照录（含既有承接项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
