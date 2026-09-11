# SPEC-012 终止-计划联动（Terminate–Plan Linkage）设计

日期：2026-08-01 ｜ 状态：用户批准（§1-4 全节）｜ 需求来源：SPEC-010 closeout §9 follow-up「终止-计划联动」+ SPEC-011 closeout §9
设计权威：本文档 ｜ 实施计划：待 writing-plans

## 1. 背景与目标

当前 `terminateContract`（contract-service.ts:486）仅将合同状态翻转至 TERMINATED（经通用 `transitionContract` 骨架），**不触碰付款计划**。缺口：

- EFFECTIVE 合同经 `generatePlansForEffect` 生成付款计划（contract-service.ts:416，仅 EFFECTIVE 时生成——VOID 路径永无计划）。终止后，未清计划（PENDING/PARTIAL 未收部分）仍显示为应收期望，语义误导且无处置政策。
- `createPayment` 已按合同状态门禁（仅 SIGNED/EFFECTIVE 可登记，receivable-service.ts:344），但 **confirmPayment 无 TERMINATED 门禁**——已登记 PENDING 收款在终止后仍可确认（竞速窗口）。

**目标**：定义终止时未清计划的处置政策并落地——取消期望、计划入终结态、逐计划事件、在途互斥与竞速闭环。零新表、零新列、零新权限、零新路由；事件 12→13。

## 2. 核心政策（用户裁决 Q1-5）

| # | 决策 | 值 |
|---|---|---|
| Q1 | 处置政策 | **取消期望**：未清计划（PENDING/PARTIAL 未收部分）→ 终态 `CANCELLED`；期望额作废不可再收；已收金额不动（真实收款保留 contract.receivedAmount），零资金移动 |
| Q2 | 在途退款/减免 | 存在 PENDING/APPROVED RefundRequest → terminate **409 阻止**（`CONTRACT_TERMINATE_CONFLICT`） |
| Q3 | 在途收款 | 存在 PENDING Payment → terminate **409 阻止**（操作者先 confirm/void）；另 confirmPayment 加 TERMINATED 门禁（竞速闭环） |
| Q4 | 词位 | PaymentPlan.status **+CANCELLED 终态**；amount 保原始期望额、receivedAmount 保实际已收 |
| Q5 | 观测 | **逐计划事件** `payment_plan.cancelled` v1 {planId, contractId, status:'CANCELLED'} |

已收计划（RECEIVED）终止时不动，保持 RECEIVED；contract.receivedAmount 不变。

## 3. 数据模型与事件

### 3.1 PaymentPlan.status 扩词位

- 现有 `String` 列 + 注释 `// PENDING|PARTIAL|RECEIVED|OVERDUE` → 更新为含 `CANCELLED`。
- **零结构迁移预期**（词位是既有 String 列值）。唯一变数：若 `prisma migrate diff` 对注释变更产生 diff → 追加一个注释级迁移（21→22）；实现时实证决定。schema-contract 基线 57 模型不变。

### 3.2 第 13 类事件 `payment_plan.cancelled`

| 项 | 值 |
|---|---|
| 常量 | `PAYMENT_PLAN_CANCELLED` = `'payment_plan.cancelled'`（event-types.ts） |
| 载荷 | `PaymentPlanCancelledV1 { planId, contractId, status: 'CANCELLED' }` 恰 3 键 |
| sourceModule | **CONTRACT**（contract-service terminate 产生，同 contract.status_changed 族） |
| objectType | **PAYMENT_PLAN**（event-registry 新 objectType 词位） |
| status 集合 | `['CANCELLED']` 钉死 |
| extractObjectId | planId |
| filterFields | {status, contractId}（载荷扣除 objectId） |
| 注册面测试 | contract-events.test.ts 补该事件（写读闭环 + 拒绝错 status） |

## 4. 架构

### 4.1 `cancelUnsettledPlans` 模块函数（实现方案 B，用户批准）

仿 `sweepBackReceived` 先例（receivable-service.ts 尾部）：

```
export async function cancelUnsettledPlans(
  tx: Prisma.TransactionClient,
  contractId: string,
  outbox: EventOutboxWriter,
  actorUserId: string,
): Promise<{ canceledCount: number }>
```

- 前置：调用方已持 Contract 行 FOR UPDATE 锁（同 sweepBackReceived 文档声明）。
- 行为：`where { contractId, status: { in: ['PENDING','PARTIAL'] } }` 逐计划 → status CANCELLED、version+1、updatedBy=actor；同事务 outbox 逐计划发 `payment_plan.cancelled`；返回 count。
- 无未清计划 → count 0、零事件（vacuous）；RECEIVED 计划不触碰。

### 4.2 transitionContract 挂钩扩展

通用骨架保持可复用，terminate 专属逻辑外置：

- `changes` 增可选 `before?: (tx, contract) => Promise<void>` 与 `after?: (tx, contract) => Promise<Record<string, unknown>>`（after 返回值并入 auditExtras）。
- terminate 传：
  - **before = 在途校验**（fail-fast）：RefundRequest PENDING/APPROVED 存在 → `CONTRACT_TERMINATE_CONFLICT` 409；Payment PENDING 存在 → 同 409。
  - **after = cancelUnsettledPlans** → 返回 {canceledPlanCount} 并入 CONTRACT_TERMINATE 审计。

### 4.3 事务序（terminate 全流程，同事务原子）

Contract 行 FOR UPDATE → 在途校验（fail-fast）→ 状态翻转（updateMany {id,version,status:源} → count=0 幂等/409 既有逻辑）→ cancelUnsettledPlans 批量取消+逐计划事件 → contract.status_changed + N×payment_plan.cancelled 出账 → CONTRACT_TERMINATE 审计（含 canceledPlanCount）。

## 5. 行为细节

### 5.1 竞速闭环

- **confirmPayment TERMINATED 门禁**：持合同锁后 `contract.status === 'TERMINATED'` → `PAYMENT_STATE_INVALID` 409。必要性：terminate 阻止 PENDING 收款，但 confirm 与 terminate 竞速时——terminate 先胜则 confirm 锁后把 PENDING→CONFIRMED 到已终止合同，此门禁兜住。
- **applyToPlan 防御性排除 CANCELLED 计划**（cheap where；有效 confirm 期间计划不可已 CANCELLED——terminate 阻止 PENDING，故纯 defense-in-depth）。

### 5.2 sweepBackReceived 保 CANCELLED

状态重推导（`=0→PENDING、<amount→PARTIAL、=amount→RECEIVED`）当计划已 `CANCELLED` 时恒保 `CANCELLED`（终态恒终态），仅冲减 receivedAmount。终止后整单退款/冲销对 CANCELLED 计划的真实已收照常生效（sweepBackReceived 的 `receivedAmount > 0` 过滤天然含 CANCELLED 计划）。

## 6. 错误处理

| 场景 | 码 | HTTP |
|---|---|---|
| 合同存在在途退款/减免申请（PENDING/APPROVED） | `CONTRACT_TERMINATE_CONFLICT`（新码，contract-errors 四点落位） | 409 |
| 合同存在在途收款（PENDING） | 同上 | 409 |
| confirmPayment 目标合同已 TERMINATED | `PAYMENT_STATE_INVALID`（既有码） | 409 |
| 终止后无未清计划 | 无错，vacuous 成功 | 200 |

## 7. 审计与事件

- CONTRACT_TERMINATE 审计 +canceledPlanCount（after 挂钩动态注入）。
- **不**逐计划 OperationLog（逐计划观测由事件承担——Q5 裁决）。
- 事件出账：contract.status_changed（既有）+ N×payment_plan.cancelled（新增）。

## 8. 权限与范围

- 零新权限：计划取消 rides `contract.terminate`（同一动作副作用），catalog 118 不变。
- 范围：terminate 既有 `contract.terminate` 动作级 scope 不变；计划取消在同一合同锁下，无独立范围面。

## 9. 前端

- 合同详情终止确认弹窗：显示将被取消的未清计划数（PENDING/PARTIAL 计数或明细）。
- 计划内联列表：CANCELLED 词位 + 态样式（灰/禁用视觉）；RECEIVED 正常显示。
- 无新页面/路由/菜单；`/finance/payment-plans` 独立页不属本 SPEC。

## 10. 测试策略

| 层 | 用例 |
|---|---|
| cancelUnsettledPlans 单测 | 混合 PENDING/PARTIAL 批量取消、RECEIVED 不动、count 返回、N 事件、vacuous 零事件 |
| terminateContract 集成 | 在途退款 409、在途收款 409、成功取消+N 事件+审计 count、confirm vs terminate 竞速（持锁钉法） |
| confirmPayment 门禁 | 终止后 confirm → PAYMENT_STATE_INVALID 409 |
| sweepBackReceived | CANCELLED 计划回补后恒保 CANCELLED（终态恒终态） |
| 事件注册 | payment_plan.cancelled 写读闭环 + 错 status 拒绝 + filterFields |
| 前端 | 终止弹窗计数、计划列表 CANCELLED 态 |

闸门纪律沿用 SPEC-011 沉淀：串行 `--test-concurrency=1`、`127.0.0.1:55433` 连接串、pg_stat_activity 探针+残留清理、测试库 `_test` 结尾且 `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 11. 计数影响

事件 **12→13**；权限 118 不变；模型 57 不变；路由 22 不变；迁移 21（或 22 注释级，实证）；页面 4 不变。

## 12. 范围边界（明确 OUT）

SUPPLEMENT 父状态复查、ANALYSIS/CASE 来源向导、appointmentId 归属链、fail-closed 目录级根治、E2E 见证跑、安全专项（SEC-2026-002）、/finance/payment-plans 独立页、refund/waiver 政策变更、VOID 路径（无计划——计划仅 EFFECTIVE 生成实证）。

## 13. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 范围 | terminate-计划联动（用户拒绝合并「合同生命周期补全」，SUPPLEMENT 复查 OUT） |
| D2 | 处置政策 | 取消期望（Q1） |
| D3 | 在途退款/减免 | 阻止终止 409（Q2） |
| D4 | 在途收款 | 阻止终止 409 + confirm TERMINATED 门禁双保险（Q3） |
| D5 | 词位 | +CANCELLED 终态（Q4） |
| D6 | 观测 | 逐计划事件 payment_plan.cancelled（Q5） |
| D7 | 实现方案 | 方案 B：cancelUnsettledPlans 模块函数（用户批准） |
| D8 | 错误码 | 新码 CONTRACT_TERMINATE_CONFLICT 409 + 复用 PAYMENT_STATE_INVALID 409 |
| D9 | 权限 | 零新码，rides contract.terminate |
