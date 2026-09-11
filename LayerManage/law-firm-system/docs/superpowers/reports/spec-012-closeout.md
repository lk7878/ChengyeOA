# SPEC-012 终止-计划联动 — 收尾报告

日期：2026-08-01 ｜ 状态：**本地闭环**（Task 1-6 全部 Approved + Task 7 验收闸门全绿）
需求来源：SPEC-010 closeout §9 follow-up「终止-计划联动」+ SPEC-011 closeout §9（terminate 对未清计划的处置政策）
设计：docs/superpowers/specs/2026-08-01-terminate-plan-linkage-design.md ｜ 实施台账：.superpowers/sdd/2026-08-01-terminate-plan-linkage/progress.md

## 1. 交付范围

- **终止处置政策（取消期望，设计 Q1）**：终止时未清计划（PENDING/PARTIAL 未收部分）→ 终态 `CANCELLED`；期望额作废不可再收；**已收金额不动**（RECEIVED 计划保持 RECEIVED、合同 receivedAmount 不变——零资金移动）。
- **CANCELLED 词位扩展**：PaymentPlan.status 注释 `// PENDING|PARTIAL|RECEIVED|CANCELLED|OVERDUE` + `WritablePlanStatus` 联合 `| 'CANCELLED'`（receivable-service.ts:300）。零结构迁移（既有 String 列值）。
- **第 13 类事件 `payment_plan.cancelled`**：`PaymentPlanCancelledV1 {planId, contractId, status:'CANCELLED'}` 恰 3 键；sourceModule **CONTRACT**、objectType **PAYMENT_PLAN**、filterFields {status, contractId}、extractObjectId=planId、status 钉死单值集（event-types.ts:106-110/:269、event-registry.ts:459-480/:939）。
- **`cancelUnsettledPlans` 模块函数**（receivable-service.ts:890）：`where { contractId, status ∈ {PENDING, PARTIAL} }` 按 `dueDate, period` 升序逐计划 → status CANCELLED、version+1、同事务逐计划发 `payment_plan.cancelled`；返回 `{canceledCount}`；无未清计划 vacuous count 0 零事件。
- **terminateContract 扩展**（contract-service.ts:493-527）：`transitionContract` before/after 挂钩——before 在途互斥（RefundRequest PENDING/APPROVED 或 Payment PENDING → `CONTRACT_TERMINATE_CONFLICT` 409 整事务回滚零写入）；after 调 `cancelUnsettledPlans` → `{canceledPlanCount}` 并入 CONTRACT_TERMINATE 审计。
- **竞速闭环（confirm TERMINATED 门禁）**（receivable-service.ts:418-422）：持合同锁重读后、幂等翻转前 `contract.status === 'TERMINATED'` → `PAYMENT_STATE_INVALID` 409（terminate 先胜兜底）。**幂等重放语义有意变更**：已 CONFIRMED payment 在 TERMINATED 合同上的 confirm 得 409 非幂等重放（runbook 已知边界注明）。
- **applyToPlan 防御性排除**（receivable-service.ts:689）：CANCELLED 计划 `return amount`（defense-in-depth；指定期路径 → 未分摊剩余 → `PAYMENT_AMOUNT_EXCEEDED` 409 整事务回滚）。
- **sweepBackReceived 保 CANCELLED**（receivable-service.ts:864-867）：状态重推导 CANCELLED 恒保 CANCELLED（终态恒终态），回补仅冲减 receivedAmount。
- **前端**：终止确认弹窗未清计划计数（PENDING/PARTIAL，detail store 客户端计算）、计划列表 CANCELLED 态渲染（「已取消」灰化 Tag）、terminate 成功后 `fetchContractDetail` 回源刷新、`PAYMENT_PLAN_STATUSES` +CANCELLED 词位镜像。
- **零新增**：零新表、零新列、零新权限（rides `contract.terminate`）、零新路由、零新模型；迁移 21 维持；前端页/路由/菜单 4 不变。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证，见 §8 对账）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 事件注册 payment_plan.cancelled + CANCELLED 词位（schema 注释 + WritablePlanStatus） | contract-events **49/49**（43 既有 + 6 新增）；tsc/eslint 0 |
| 2 | 错误码 CONTRACT_TERMINATE_CONFLICT 四点落位 + transitionContract before/after 挂钩 | contract-service **40/40**（39 既有 + 1 错误码钉）；tsc/eslint 0 |
| 3 | cancelUnsettledPlans 模块函数 + 单测 | plan-cancel **4/4** + receivable-service 38/38 回归；tsc/eslint 0 |
| 4 | terminateContract 扩展 + 集成测试 | terminate-plan-linkage **6/6** + contract-service 40/40 回归 + receivable-service 38/38 sanity |
| 5 | confirm TERMINATED 门禁 + applyToPlan 排除 + sweep 保 CANCELLED | 闸门 **58/58**（terminate-linkage 10 + receivable-void 10 + receivable-service 38）+ refund-service **46/46** 回归；tsc/eslint 0 |
| 6 | 前端终止弹窗计数 + CANCELLED 态 | +4 页测（ContractDetailPage）；全量 42 files/173 tests；typecheck/lint/build 全绿 |
| 7 | 验收与收尾（本报告） | 见 §3.2 |

> **计数修正照录（Task 5 Low）**：Task 5 报告测试分布表 receivable-void 记 10+1=11 / receivable-service 记 37，评审核实实际 receivable-void **9+1=10**、receivable-service **38**，总数 58 恒等（±1 对消误置，非计数虚报）。

### 3.2 最终全量（Task 7 验收跑）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（7 文件串行） | **197/197**（contract-events 49 + contract-service 40 + plan-cancel 4 + terminate-linkage 10 + receivable-void 10 + receivable-service 38 + refund-service 46） |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1652 tests / 1648 pass / 0 fail / 0 cancelled / 4 skipped**（skip-pattern 排除 3 例 port-55432 锁定排练件照录；对账见 §3.3） |
| 迁移重演 + 空库断言 + 重跑幂等 | db:reset:test（21 迁移重放）→ db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS / PASS / exit 0 |
| security:test | 34/34 零新增 |
| 前端四闸门 | 全量 **42 files/173 tests** PASS（零 flake 复跑）；tsc 0、lint 0 err（5 warn 预存）、build PASS |

### 3.3 全量合计（Task 7 实测，清净窗）

**实测：1652 tests / 1648 pass / 0 fail / 0 cancelled / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归）。

SPEC-011 基线 **1632 tests**（finance 219 + contract 202 + app 192 + rest 1019，其口径含 3 例 port-55432 锁定排练件照录）。SPEC-012 净增 **22**：contract-events +6、contract-service +1、plan-cancel +4（新件）、terminate-linkage +10（新件）、receivable-void +1（直接改动面 197/197 实证）。

> **对账**：1632 + 22 = 1654 预期；本 Task 7 实测 **1652**。差额 2 的构成——skip-pattern 将 3 例 port-55432 锁定排练件从 `tests` 计数中整体排除（1632−3+22=1651），实测 +1 为跨运行文件枚举/伪影方差（与 SPEC-011 §3.3 自身口径「有效覆盖 1629 / 共享库口径 1625」同类的口径差异，SPEC-011 基线亦为其 Task 12 环境实测非恒等式）。**0 真 fail 为权威结论**，计数链终态以实测 1652 为准。

## 4. 迁移与模型

- **迁移总数 21 维持（19→21 后不变）**：SPEC-012 **零新增迁移**——PaymentPlan.status +CANCELLED 为既有 String 列值扩展，`prisma migrate diff` 对 payment_plan **零 DDL**（Prisma 不跟踪 schema.prisma 行内注释，注释级迁移条件不成立）。
- **model 总数 57 不变**；权限 118 不变；路由 22 不变。
- **预存漂移 4 项照录（非本 SPEC 引入，Task 1 diff 再次暴露，与 SPEC-011 closeout §4 逐字一致）**：admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值——fresh 库与累积库位形分叉，漂移治理独立立项。
- 基线契约同步点：`check-baseline-contract.ts`（CANONICAL 21/57）+ `baseline-contract.test.ts` + `spec-008-event-observability-migration-contract.test.ts` + `schema-contract.test.ts`——均维持 21/57 零改动。

## 5. 关键裁决记录（D1-D9，设计 §13 决策 + 实施期裁决）

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 范围 | terminate-计划联动（用户拒绝合并「合同生命周期补全」，SUPPLEMENT 复查 OUT） |
| D2 | 处置政策 | 取消期望（Q1）：未清计划 → CANCELLED 终态、期望作废、已收不动 |
| D3 | 在途退款/减免 | 阻止终止 409（Q2）：RefundRequest PENDING/APPROVED → `CONTRACT_TERMINATE_CONFLICT` |
| D4 | 在途收款 | 阻止终止 409 + confirm TERMINATED 门禁双保险（Q3） |
| D5 | 词位 | +CANCELLED 终态（Q4）；RECEIVED 计划终止不动 |
| D6 | 观测 | 逐计划事件 payment_plan.cancelled（Q5，第 13 类 sourceModule CONTRACT） |
| D7 | 实现方案 | 方案 B：cancelUnsettledPlans 模块函数（用户批准，仿 sweepBackReceived 先例） |
| D8 | 错误码 | 新码 `CONTRACT_TERMINATE_CONFLICT` 409（contract-errors 四点落位）+ 复用 `PAYMENT_STATE_INVALID` 409 |
| D9 | 权限 | 零新码，rides contract.terminate（118 不变） |

**实施期裁决（评审追认）**：

1. **12→13 零同步**（Task 1）：grep 实证 event-registry/finance-events/contract-events 均无「钉事件总数」断言；finance-events "twelve"=FINANCE 域 12 常量（payment_plan.cancelled 属 CONTRACT 域不受影响）。
2. **迁移 21 维持**（Task 1）：`prisma migrate diff` 对 payment_plan 零 DDL——注释变更不产生 DDL，不建注释级迁移。
3. **计划代码之误×2 追认**：Task 1 brief `validateEventEnvelope(payload)` 成员不在 EventDefinition 接口（实现者省略正确）；Task 3 brief `updatedBy: actorUserId` 在 PaymentPlan schema 无此列（实现者丢弃、actor 经事件信封 operatorUserId 追溯——三证：schema :917-938/迁移 20260730120000/PaymentPlanUpdateInput 无该字段）。
4. **幂等重放语义有意变更**（Task 5 偏离 2）：confirm 门禁先于幂等翻转 → 已 CONFIRMED payment 在 TERMINATED 合同 confirm 409 非幂等重放——系有意（终止合同零 confirm 流量、资金操作整体失效），runbook 已知边界注明。
5. **竞速测试形态**（Task 4/5）：持锁钉法确定性串行（confirm-first + terminate-first 两分支镜像），授权范围内，非 Promise.allSettled 双并发（terminate 在途闸 plain read 立即 409 无双败歧义）。
6. **applyToPlan 排除拆 2 测试**（Task 5 偏离 1）：贪心扫路径既有 PENDING/PARTIAL 查询已排除（行为钉死）+ 指定期路径直接覆盖新代码行（PAYMENT_AMOUNT_EXCEEDED 409）。
7. **after 挂钩入参为翻转前实例**（Task 2 前瞻）：cancelUnsettledPlans 仅消费 contract.id/branchId/teamId（翻转不变），逐字使用骨架传入 pre-flip 实例无需重读。
8. **前端刷新职责**（Task 6 偏离 1）：刷新落点=页面 terminate case（runSubmit 返回布尔后 fetchContractDetail），contract-store.ts 零改动——影响完全封闭（grep 实证 terminateContract/fetchContractDetail 消费方均仅 ContractDetailPage）。
9. **测试计数 ±1 对消误置**（Task 5 Low）：报告分布误置，总数恒等，审计 nit 照录。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 7 顺手治理**：SPEC-012 task-1~5 报告原含测试连接串凭据 + 密钥赋值，已按占位符口径脱敏（`postgresql://chengye_test@...` 去口令 + `JWT_SECRET="<redacted>"` 等），扫描 exit 0。

## 7. 已知非阻断项

1. **迁移 21 维持实证**（Task 1）：Prisma 不跟踪行内注释零 DDL；diff 暴露既有漂移 4 项照录（§4，漂移治理 follow-up）。
2. **12→13 零同步**（Task 1）：无钉注册表总数；finance-events "twelve"=FINANCE 域。
3. **contract-service.test.ts:1583 既有注释过时**（Task 4 ⚠️①）：「终止不改变应收计划行/无联动约定」已被本 SPEC 行为推翻——**Task 7 已顺手更新**（终止把未清计划翻 CANCELLED、行保留非删行，功能断言 count==1 仍真）。
4. **幂等重放语义变化**（Task 5 ⚠️①）：已 CONFIRMED payment 在 TERMINATED 合同 confirm 得 409 非幂等重放——runbook §2.5 已知边界注明。
5. **Task 5 Low**：报告计数 ±1 对消误置（已核实总数恒等，审计 nit 照录，§3.1）。
6. **权限降级致计数误导**（Task 6 ⚠️①）：无 payment.read→plans 降级 []→unsettledPlanCount 0——计数仅 UX 不参与 terminate 语义。
7. **刷新职责转移注记**（Task 6 ⚠️③）：store terminate 不传播刷新，未来 terminateContract 消费方须自回源（当前零消费方风险可控，store 注释预留提示）。
8. **CANCELLED 计划无 updatedBy 列**（终态边界）：取消者经事件信封 operatorUserId 追溯（Task 3 计划代码 updatedBy 之误追认）。
9. **Task 1 Minor**：extractObjectId 参数名 `payload` vs 母版 `parsed`（一致性观察项）。
10. **Task 2 前瞻×3**：after 钩子入参翻转前实例（已按裁决处理）；afterResult 同名键覆盖（用无冲突键 canceledPlanCount）；CONTRACT_TERMINATE_CONFLICT 休眠常量→Task 4 接线后进入运行时。
11. **Task 3 前瞻×3**：traceId 用 randomUUID（模块函数无 requestId，已知边界）；函数无运行时消费点（Task 4 接线，现已有）；updatedBy 计划代码之误追认。
12. **Task 4 前瞻②/③**：before 双闸 plain read TOCTOU——Task 5 硬门禁 + updateMany version 0 行→VERSION_CONFLICT 兜底，非缺陷；竞速测试形态与确定性串行授权一致照录。
13. **前端预存 vitest flake**（SPEC-011 已知集：EventOperations/Position/SecurityUser/PublicPoolPage/SecurityRole/App.test/AdminGovernance，隔离复跑全 PASS）——Task 7 全量 42/173 一次通过零 flake。
14. **Node v24.18.0 vs CLAUDE.md 记 22.14.0**：全量零影响实证，未见行为分叉（§8 对账）。

## 8. 对账项

1. **迁移 diff 只读不可复跑**（Task 1）：以 Prisma 不跟踪注释的语义 + closeout 漂移清单 + 21 基线三重自洽采信；本 Task 7 以 `db:reset:test` 21 迁移重放 + 空库断言 + 重演幂等实证。
2. **幂等重放语义偏离**（Task 5 偏离 2）：门禁先于幂等翻转 → 终止合同 confirm 409 非幂等重放——有意，接口文档（runbook §2.5）注明。
3. **计数对账**：SPEC-011 1632 + 净增 22 = 1654 预期；实测 **1652**（skip-pattern 排除 3 例 port-55432 锁定件 + 跨运行口径方差，§3.3 对账）；直接改动面 197/197 与逐文件计数逐字对上（含 receivable-void 实 10）。
4. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1（承 SPEC-011 裁决 13）。
5. **目标计数 vs 实测**：事件 12→13、词位 +CANCELLED、迁移 21 不变、权限 118 不变、路由 22 不变、模型 57 不变、前端页 4 不变——全部对齐设计目标。

## 9. Follow-up 路由（候选专项）

- **SUPPLEMENT 父状态复查**：设计 §12 明确 OUT（用户拒绝合并「合同生命周期补全」），仍开项——父 SUPPLEMENT 终止后子合同状态复查。
- **漂移治理专项**：预存漂移 4 项 + SPEC-010/011 迁移 shadow diff 合并治理。
- **真实 Step-Up for refund.approve**：step-up-target.ts 增加 refund 目的位（承 SPEC-011）。
- **/finance/payment-plans 独立页**：前端独立支付计划页（设计 §9 明确不属本 SPEC）。
- **前端 flake 治理**：预存 7 件负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：CLAUDE.md Node 版本记录、设计文档对账措辞。

## 10. 双渠道验收链

Task 1-6 实现者渠道实现 + 协调者渠道独立审查（每任务 task-N-review-package/coord 双件）；全部任务审查结论 Approved / 0 Critical（Task 1 计划代码 validateEventEnvelope 追认、Task 3 updatedBy 列追认、Task 5 幂等重放语义裁决、Task 6 前端刷新职责裁决为代表）。Task 7（本任务）为验收与收尾：全量闸门 + 迁移实证 + runbook/closeout 两文档落地；SPEC-012 全程共享 55433 测试库清净窗纪律，无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-012 本地闭环（2026-08-01）**：7/7 任务完成；后端直接改动面 **197/197**（contract-events 49 + contract-service 40 + plan-cancel 4 + terminate-linkage 10 + receivable-void 10 + receivable-service 38 + refund-service 46），全量串行 **1652 tests / 1648 pass / 0 fail / 4 skipped**（SPEC-011 1632 + 净增 22 预期 1654，skip-pattern 排除 3 例 port-guard + 跨运行口径方差对账 §3.3，**0 真 fail 为权威**）；前端四闸门绿（全量 **42 files/173 tests** PASS 零 flake、tsc 0、lint 0 err（5 warn 预存）、build PASS）；security:test 34/34 零新增；迁移实证 21 维持 + 空库断言 PASS + 重演幂等零迁移 + provisioning 实证 permission=118（version=1 全量）；check:baseline PASS（21 迁移/57 model）+ check:bootstrap PASS + check:docs-leakage exit 0（Task 7 顺手脱敏 SPEC-012 task 报告凭据）；已知非阻断项 §7 共 14 条照录，follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
