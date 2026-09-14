# 财务运营 运维手册（SPEC-011 + SPEC-012 终止-计划联动）

适用范围：开票申请（InvoiceRequest，FIN-02）全生命周期，退款/减免（RefundRequest，FIN-03）申请与资金回补，成本台账（CostEntry，FIN-04）CRUD，收款冲销（Payment.void），异常数据四口径只读（FIN-05），收款状态词位扩展（Payment.status +VOIDED），以及**终止-计划联动**（SPEC-012：终止时未清计划取消 + PaymentPlan.status +CANCELLED + 在途互斥 + 竞速门禁）。
后端实现：`apps/server/app/application/finance/`（invoice-service / refund-service / cost-service / anomaly-service / finance-factory / finance-projection）+ `apps/server/app/application/contract/receivable-service.ts`（voidPayment、sweepBackReceived、cancelUnsettledPlans、confirmPayment TERMINATED 门禁）+ `apps/server/app/application/contract/contract-service.ts`（terminateContract before/after 挂钩）；领域纯函数 `app/domain/finance/`（finance-policy / finance-errors / finance-types）+ `app/domain/contract/contract-errors.ts`（PAYMENT_STATE_INVALID、CONTRACT_TERMINATE_CONFLICT）+ `app/domain/events/`（event-registry / event-types：payment_plan.cancelled 第 13 类）；路由 `app/router.ts:196-217`（`/api/v1/invoices*`、`/api/v1/refunds*`、`/api/v1/costs*`、`/api/v1/payments/:id/void`、`/api/v1/finance/anomalies/*`，恰 22 条，SPEC-012 零新增路由）。

---

## 1. 配置项

本模块**不新增任何环境变量**。运行依赖既有基建：PostgreSQL 数据源（`DATABASE_URL`）、事件 outbox（SPEC-007）、授权上下文（SPEC-004/SPEC-010）。无特性开关、无阈值参数。`refund.approve` 为既有 SPECIAL/CRITICAL 预存权限码（SPEC-011 首个消费方），无新增特殊配置。

## 2. 状态机（`app/domain/finance/finance-policy.ts`）

### 2.1 开票申请（InvoiceRequest）

状态词汇：`PENDING / APPROVED / REJECTED / COMPLETED`。动作词汇（3 个）：`approve / reject / complete`。

```
PENDING ──approve──▶ APPROVED
PENDING ──reject──▶ REJECTED
APPROVED ──complete──▶ COMPLETED
```

- **判定次序钉死**：终态防线（REJECTED/COMPLETED）先于流转表；终态任何动作返回 null → `INVOICE_STATE_INVALID` 409。
- 全部翻转经 version 乐观锁（`updateMany {id, version, status:源态}`）；count=0 → 重读：已在目标态 → 返回现状投影（幂等重放，零事件零审计）；其他态 → `INVOICE_STATE_INVALID` 409。
- **额度不变量**：占用 = 同合同 status ∈ PENDING/APPROVED/COMPLETED 的 Σamount（REJECTED 释放）。create：事务内 Contract 行 FOR UPDATE + 占用+新额 ≤ contract.amount，否则 `INVOICE_AMOUNT_EXCEEDED` 400；approve 重验聚合口径同 create 且已含本单（不再加任何新额），超标 → `INVOICE_AMOUNT_EXCEEDED` 409 整事务回滚（状态保持 PENDING，零事件零审计）。
- reject 挂 `invoice.approve` 权限码（catalog 无 invoice.reject 码，router.ts:183 先例）；驳回元数据落 approvedBy/approvedAt/approvalComment 三列。

### 2.2 退款/减免申请（RefundRequest）

状态词汇：`PENDING / APPROVED / REJECTED / EXECUTED`。动作词汇（3 个）：`approve / reject / execute`。类型词汇：`REFUND`（退款）/ `WAIVER`（减免）。

```
PENDING ──approve──▶ APPROVED
PENDING ──reject──▶ REJECTED
APPROVED ──execute──▶ EXECUTED
```

- 终态防线（REJECTED/EXECUTED）先于流转表；approve/reject 骨架同 invoice；reject 挂 `refund.approve` 权限码（SPECIAL/CRITICAL）。
- **类型分流（交叉锚点禁填 400）**：
  - `REFUND`（锚 paymentId）：payment 存在且属该合同 → status CONFIRMED（否则 `PAYMENT_STATE_INVALID` 409）→ amount === payment.amount（否则 `REFUND_AMOUNT_MISMATCH` 400）→ 同 payment 无在途（PENDING/APPROVED）REFUND 申请（否则 `REFUND_STATE_INVALID` 409）。
  - `WAIVER`（锚 planId）：plan 存在且属该合同 → status ∈ PENDING/PARTIAL（否则 `WAIVER_PLAN_STATE_INVALID` 409）→ `0 < amount ≤ plan.amount − plan.receivedAmount`（否则 `WAIVER_AMOUNT_EXCEEDED` 400）。WAIVER 无在途排他。
- approve **无**额度重验（与 invoice 不同，设计裁决 1）。

### 2.3 成本台账（CostEntry，FIN-04）

无状态机（创建即终态，仅 CRUD + 软删）。**锚点矩阵**（`assertCostAnchorShape` 唯一裁决者，仅 create 强制）：

| category | channelId | caseId |
|---|---|---|
| CHANNEL | 必填 | 禁填 |
| EVIDENCE / CASE_HANDLING | 禁填 | 必填 |
| LABOR / OFFICE | 禁填 | 禁填 |

- 锚点字段创建后不可变；update 白名单仅 `amount/occurredAt/note` + `version` 必填（注入锚点字段 → `VALIDATION_FAILED` 400）。
- 乐观锁：update 事务内探查（deletedAt null，`COST_NOT_FOUND` 404）→ `updateMany {id, version}` → count=0 → 先存在性后版本（存在且未软删 → `VERSION_CONFLICT` 409；不存在/已软删 → 404）。
- 软删：delete 翻转 `deletedAt=now, version+1`；count=0 → 404（含二次 delete）；软删后 get 404、list 不见。

### 2.4 收款状态扩展（Payment.status，本 SPEC 词汇扩展）

词汇由 `PENDING / CONFIRMED`（SPEC-010）扩展为 **`PENDING / CONFIRMED / REFUNDED / VOIDED`**（REFUNDED 词位 schema 预存、VOIDED 落地）。冲销为直接动作（非申请流）：`CONFIRMED →(void)→ VOIDED`；退款经 RefundRequest 执行 `CONFIRMED → REFUNDED`。状态词位扩展零扰动机理：旧套件对 REFUNDED/VOIDED 零引用，词汇数组字面扩展不破坏既有消费。

### 2.5 终止-计划联动（PaymentPlan.status，SPEC-012 词汇扩展）

词汇由 `PENDING / PARTIAL / RECEIVED / OVERDUE` 扩展为 **`PENDING / PARTIAL / RECEIVED / CANCELLED / OVERDUE`**（OVERDUE 查询时推导永不落库，见 negotiation-contract-payment.md §5.4；**CANCELLED 落地终态**）。终止（contract.terminate）时对未清计划执行**取消期望**处置政策（设计 Q1 裁决）：

- **处置政策**：未清计划（PENDING/PARTIAL 未收部分）→ 终态 `CANCELLED`；期望额作废不可再收；**已收金额不动**（RECEIVED 计划保持 RECEIVED；计划 receivedAmount 与合同 receivedAmount 均不变——零资金移动）。
- **在途互斥（fail-fast，CONTRACT_TERMINATE_CONFLICT 409）**：终止前 `transitionContract.before` 钩子校验——存在 `RefundRequest.status ∈ {PENDING, APPROVED}` 或 `Payment.status = PENDING AND deletedAt = null`（同合同）→ 409 整事务回滚零写入（操作者先 confirm/void 收款或驳回/执行退款再终止）。已决态（REJECTED/EXECUTED 退款、CONFIRMED/REFUNDED/VOIDED 收款）不阻。
- **计划取消实现**：`cancelUnsettledPlans(tx, contract, outbox, actorUserId)` 模块函数（receivable-service.ts:890；调用方须已持 Contract 行 FOR UPDATE 锁）——`where { contractId, status ∈ {PENDING, PARTIAL} }` 按 `dueDate, period` 升序逐计划 → status CANCELLED、version+1、同事务逐计划发 `payment_plan.cancelled`；返回 `{canceledCount}` 并入 CONTRACT_TERMINATE 审计 `canceledPlanCount`。无未清计划 → count 0 零事件（vacuous）。
- **竞速门禁（双保险，PAYMENT_STATE_INVALID 409）**：`confirmPayment` 持合同锁重读后、幂等翻转前——`contract.status === 'TERMINATED'` → 409。必要性：terminate 阻止 PENDING 收款，但 confirm 与 terminate 竞速时若 terminate 先胜，锁后确认到已终止合同由本门禁兜住。
  - **幂等重放语义（有意边界，接口文档必须注明）**：门禁先于幂等翻转分支 → 已 `CONFIRMED` payment 在 TERMINATED 合同上的重复 confirm **得 409 而非幂等重放返回现状**。系有意（终止合同零 confirm 流量、合同关停后资金操作整体失效）；与既有幂等重放测试（全部在非 TERMINATED 合同）无冲突。
- **createPayment 竞速闭环（SPEC-014 补强，CONTRACT_STATE_TRANSITION_INVALID 409）**：`createWithPaymentNoRetry` INSERT 事务内首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment 锁点）+ 持锁重读合同 + 重验 `status ∈ SIGNED/EFFECTIVE`（否则 409，整事务回滚零行零事件零审计）——**确定性关闭「terminate 先胜」前向竞速**（createPayment 事务外预读通过后 terminate 先胜 → 锁后重验 TERMINATED → 409，该方向 PENDING 不再固化到已终止合同）。**双闸形态**：事务外预读（快路径短路） + 事务内 FOR UPDATE 重验（竞速兜底）；锁序 Contract→Payment 与 confirmPayment/void/refund 全写路径同序，无交叉持锁路径。P2002 重试语义不变（非唯一冲突直接重抛；仅 paymentNo 碰撞重试且每轮重开事务重走锁+重验）。**已关闭（2026-08-02 terminate 侧硬化 follow-up）：反向竞速残余窗**——此前 createPayment 先提交后 terminate 在途闸（plain read 无合同锁）可翻转 TERMINATED 致 PENDING 滞留；现 terminate 在途闸（terminateContract before 钩子）首把锁 = Contract 行 FOR UPDATE + 锁后重读合同（scope 感知）+ 重验在途 PENDING payment / PENDING-APPROVED refund（锁下执行——createPayment 在锁下 INSERT PENDING 提交后，terminate 锁后重读必见该 PENDING → CONTRACT_TERMINATE_CONFLICT 409 整事务回滚，合同保持 EFFECTIVE、PENDING 保留可处置）。锁序 Contract→Payment 恒与全写路径同序，无死锁。
- **CANCELLED 终态恒终态**：`sweepBackReceived` 状态重推导当计划已 CANCELLED 时恒保 CANCELLED（仅冲减 receivedAmount，状态不回 PENDING）。终止后整单退款/冲销对 CANCELLED 计划的真实已收照常生效（sweepBackReceived 的 `receivedAmount > 0` 过滤天然含 CANCELLED 计划）。
- **applyToPlan 防御性排除**：`applyToPlan` 对 CANCELLED 计划直接 `return amount`（defense-in-depth——有效 confirm 期间计划不可已 CANCELLED；指定期路径触发 → 未分摊剩余 → `PAYMENT_AMOUNT_EXCEEDED` 409 整事务回滚；贪心扫路径既有 PENDING/PARTIAL 查询已排除）。
- **取消者追溯**：PaymentPlan 行无 `updatedBy` 列（schema 建表仅 createdBy/createdAt/updatedAt）——取消操作者经事件信封 `operatorUserId` 追溯（operatorUserId = 终止操作者 actorUserId），不落计划行。

## 3. 编号规则（`contract-number-service.ts` 扩展）

本模块业务编号全部为 **makeBusinessNo 随机码薄封装**（非序列，P2002 碰撞重试上限 2 在调用方，同 lead/receivable `BUSINESS_NO_RETRY_LIMIT` 纪律）：

| 封装 | 前缀 | 用途 |
|---|---|---|
| `nextInvoiceNo()` | **INV** | 开票申请 requestNo |
| `nextRefundNo()` | **RF** | 退款/减免申请 requestNo |

与既有 PP（计划）/PY（收款）/NE（谈案）/AE（分析委托）/CA（案件）无冲突。`invoiceNo`（开票完成时业务员填写）为业务字段（≤100 文本），不参与编号生成，文本不落审计。

## 4. 回补机制（FIN-03 核心：资金逆流与纠错）

**统一资金回补函数 `sweepBackReceived`**（`receivable-service.ts` 导出，refund-service 与 voidPayment 共用同一内部实现，仅事件类型/语义不同——退款=经营退回客户，冲销=纠错视为未发生）：

1. **首锁 = Contract 行 FOR UPDATE**——锁序恒 Contract→RefundRequest/Payment→PaymentPlan，与 confirmPayment/invoice 全写路径同序，无交叉持锁路径。
2. **反向扫掠**：该合同 receivedAmount>0 的计划按 `dueDate DESC, period DESC` 逐期 `deduct = min(剩余应退, plan.receivedAmount)` 冲减；每期冲减后重推导状态（`=0→PENDING；<amount→PARTIAL；=amount→RECEIVED`；计划已 **CANCELLED 恒保 CANCELLED**——SPEC-012 终态恒终态，见 §2.5）——计划状态词汇沿 WritablePlanStatus，**永不写 OVERDUE**。
3. **Vacuous 守卫**：扫到剩额 > 0 或无计划行（SIGNED 未生效）时 vacuous 结束——合同级 receivedAmount 已同步为退后真实值，冲抵语义不变。
4. `Contract.receivedAmount -= amount`（互斥保护下 plain update）。

**execute（RefundRequest，步骤序钉死）**：Contract 首锁 → 请求级闸翻转 APPROVED→EXECUTED（count=0 → 已 EXECUTED 幂等返回现状，零事件零审计零回补；否则 `REFUND_STATE_INVALID` 409）→ REFUND：payment 翻转 `{status:'CONFIRMED'}→REFUNDED`（count=0 → `PAYMENT_STATE_INVALID` 409 **整事务回滚**，含并发 void/refund 败者）→ sweepBackReceived；WAIVER：plan 行重读重验 `amount ≤ plan.amount − plan.receivedAmount`（失败 → `WAIVER_AMOUNT_EXCEEDED` 409 全回滚）→ `plan.amount −= amount` 状态重推导（含全额豁免 PENDING 计划 amount=0 的零元 RECEIVED）。

**void（冲销，`POST /payments/:id/void`，reason 必填 1-500）**：payment 探查（deletedAt+scope 404）→ Contract 首锁 → 翻转 `updateMany {id, version, status:'CONFIRMED'}→VOIDED` → count=0 → 重读：已 VOIDED → 幂等返回现状（零事件零审计零回补）；否则 `PAYMENT_STATE_INVALID` 409 → 仅胜者 sweepBackReceived → 恰 3 键事件 `payment.voided` + OperationLog `PAYMENT_VOID`（标识符 + hasReason:true，reason 自由文本落 voidReason 业务列不落审计）。

**执行 vs 确认竞速序无关不变式**：`receivedAmount` 终值 = 确认额 − 冲销/退款额，无论锁序（一胜一 `PAYMENT_STATE_INVALID` 409 双向钉死，使用真实 RefundService 实例非 mock）。

## 5. 事件清单（SPEC-007 outbox，全部同事务写入，v1 载荷键集钉死）

| eventType | sourceModule | 载荷键集 | 触发 |
|---|---|---|---|
| `invoice.requested` | FINANCE | `{invoiceRequestId, requestNo, contractId, customerId, status}` | 开票申请创建 |
| `invoice.approved` | FINANCE | `{invoiceRequestId, contractId, status}` | 开票审核通过 |
| `invoice.rejected` | FINANCE | `{invoiceRequestId, contractId, status}` | 开票驳回 |
| `invoice.completed` | FINANCE | `{invoiceRequestId, contractId, status}` | 开票完成 |
| `refund.requested` | FINANCE | `{refundRequestId, requestNo, type, contractId, customerId, status}` | 退款/减免申请创建 |
| `refund.approved` | FINANCE | `{refundRequestId, contractId, status}` | 退款/减免审核通过 |
| `refund.rejected` | FINANCE | `{refundRequestId, contractId, status}` | 退款/减免驳回 |
| `refund.executed` | FINANCE | `{refundRequestId, contractId, paymentId, planId, status}`（paymentId/planId 一实一空） | 退款/减免执行 |
| `payment.voided` | **CONTRACT**（随产生模块族，receivable-service） | `{paymentId, contractId, status}` | 收款冲销 |
| `cost.created` | FINANCE | `{costEntryId, category, channelId, caseId}` | 成本创建 |
| `cost.updated` | FINANCE | `{costEntryId, category}` | 成本更新 |
| `cost.deleted` | FINANCE | `{costEntryId, category}` | 成本删除 |
| `payment_plan.cancelled` | **CONTRACT**（contract-service terminate 产生，随 contract.status_changed 族） | `{planId, contractId, status}`（status 钉死 `CANCELLED`；objectType **PAYMENT_PLAN**、objectId=planId） | 终止时逐未清计划取消（第 13 类，SPEC-012） |

事件信封 objectType：INVOICE_REQUEST / REFUND_REQUEST / COST_ENTRY / **PAYMENT_PLAN**；organizationId 恒 null、branchId/teamId 锚合同自身组织列（cost 三事件三锚恒 null——CostEntry 无组织列；payment_plan.cancelled 锚合同 branch/team 列）。事件投递运维（重放/隔离/健康/worker）见 SPEC-007/008 既有 runbook；本模块不新增订阅、不新增投递面。

## 6. 权限与数据范围

- **全局目录 118 码**（`app/domain/authorization/permission-catalog.ts`）；SPEC-011 新增 **17 码**（finance 17 = 4 菜单 + 13 动作），`refund.approve` 为既有 SPECIAL/CRITICAL 码零变更：

| 码 | type | riskLevel | 说明 |
|---|---|---|---|
| `menu.invoice` / `menu.refund` / `menu.cost` / `menu.anomaly` | MENU | LOW | 前端菜单（/invoices /refunds /costs /anomalies） |
| `invoice.read` / `invoice.create` / `invoice.approve` / `invoice.complete` | ACTION | LOW/MEDIUM/HIGH/MEDIUM | 开票 |
| `refund.read` / `refund.create` / `refund.execute` | ACTION | LOW/MEDIUM/HIGH | 退款减免 |
| `payment.void` | ACTION | HIGH | 收款冲销（catalog :103，占位升级正式启用） |
| `cost.read` / `cost.create` / `cost.update` / `cost.delete` | ACTION | LOW/MEDIUM/MEDIUM/HIGH | 成本台账 |
| `anomaly.read` | ACTION | LOW | 异常数据四口径 |
| `refund.approve` | SPECIAL | CRITICAL | 审批退款（既有码，SPEC-011 首个消费方，前端 Step-Up 语义为 HIGH/CRITICAL 敏感 Modal——真实 Step-Up 目标位留后续） |

- **数据范围**：invoice/refund/payment.void 查询锚定合同列，`buildContractScopeWhere`（SELF→contract.createdBy 链、TEAM/BRANCH/ORG→contract.branch/team 列，`resource='invoice'/'refund'/'payment'`——与 permission-catalog resource 逐字一致，错传则 ('contract', 码) 恒空集 fail-closed 全 404）。CostEntry **不做行级 scope**（财务职能数据，仅权限门控，无组织列）；anomaly 走 Contract 级 scope（`resource='anomaly'`）。不可见统一 404 不泄露存在性。
- 金额字段不脱敏（设计 §8 决策，以数据范围+动作权限控制）；审计只落编号/类型/id/状态/金额与布尔存在性，**reason/comment/note/invoiceNo 自由文本落行不落审计**。
- 角色授予走角色管理 API（`PUT /api/v1/roles/:id/permissions`）；无业务角色 seed。

## 7. 错误码表（HTTP 语义稳定码；FinanceError 按实例 httpStatus 透传，双态码由抛出方覆盖）

| code | status | 场景 |
|---|---|---|
| `INVOICE_NOT_FOUND` | 404 | 开票申请不存在或不可见 |
| `REFUND_NOT_FOUND` | 404 | 退款/减免申请不存在或不可见 |
| `COST_NOT_FOUND` | 404 | 成本不存在、不可见或已软删 |
| `INVOICE_STATE_INVALID` | 409 | 开票非法状态流转 / 终态再动 |
| `REFUND_STATE_INVALID` | 409 | 退款/减免非法流转 / 在途 REFUND 双申 |
| `WAIVER_PLAN_STATE_INVALID` | 409 | WAIVER 目标计划非 PENDING/PARTIAL |
| `INVOICE_AMOUNT_EXCEEDED` | **400 create / 409 approve** | 开票额度超限（双态码，抛出方显式覆盖） |
| `WAIVER_AMOUNT_EXCEEDED` | **400 create / 409 execute** | WAIVER 金额超计划余额（双态码） |
| `REFUND_AMOUNT_MISMATCH` | 400 | REFUND 金额 ≠ payment.amount（整单裁决） |
| `COST_ANCHOR_REQUIRED` | 400 | 成本锚点矩阵必填缺失 / 未知类别 |
| `COST_ANCHOR_FORBIDDEN` | 400 | 成本锚点矩阵禁填冲突 |
| `CONTRACT_TERMINATE_CONFLICT` | 409 | 终止时存在在途退款/减免（RefundRequest PENDING/APPROVED）或在途收款（Payment PENDING）——SPEC-012 新码，contract-errors 定义 |

复用既有码（本模块不重复定义）：`VALIDATION_FAILED`（MasterDataError，400——入参校验/探针/注入锚点字段）、`VERSION_CONFLICT`（409）、`PAYMENT_STATE_INVALID`（contract-errors，409——退款执行/冲销时目标 payment 非 CONFIRMED；**终止合同 confirm 门禁**）、`CONTRACT_TERMINATE_CONFLICT`（contract-errors，409——终止在途互斥，见 §2.5）、`CONTRACT_STATE_TRANSITION_INVALID`（contract-errors，409——createPayment 事务外预读 + 事务内 FOR UPDATE 持锁重验门禁，双闸形态，见 §2.5）、`CONTRACT_NOT_FOUND`/`PAYMENT_NOT_FOUND`（合同/收款探查）、`SPECIAL_PERMISSION_REQUIRED`（refund.approve SPECIAL 码行为，authorization-service 先例 :35）。

## 8. 运维注意

- **权限 provisioning 纪律（必须复述）**：权限表供给**只 INSERT + 幂等 UPDATE**——新码经迁移 `INSERT ... ON CONFLICT ("code") DO NOTHING`（先例 `20260731210000_finance_permission_provision`：17 新码）；占位升级经显式幂等 `UPDATE ... SET type/riskLevel WHERE code IN (...)`。**role_permission 永不由 provisioning 迁移触碰**；refund.approve 保持 SPECIAL/CRITICAL 零改动。新增权限码时必须同步 provisioning 迁移，否则 fresh 库 FK 阻断/引用 400（无 seed 通道，迁移即真相）。
- **目录排序一致性（SPEC-022）**：bootstrap 一致性校验 `assertPermissionCatalog`/`assertEventSubscriptionCatalog`（`apps/server/app/application/system/system-bootstrap-service.ts`）对全局目录排序用显式 **C collation 字节序比较器 `compareByCodeC`**（模块级私有，纯字典序 `<`/`>` 比较）——对齐 PostgreSQL `ORDER BY code` 默认语义（ASCII 字节序：`.`(46) < 大写字母 < `_`(95) < 小写字母）。**为什么**：JS `localeCompare`（默认 locale）与 PG C 序在**含下划线码**（`user_role.membership.manage`、`menu.organization_personnel`、`employee.account_binding.manage` 等）处相对次序不同（localeCompare 会把含 `_` 码前移）→ 逐位比对错位 → `InconsistentSystemStateError: Permission catalog is inconsistent`（SPEC-021 全量 71 fail 根因，SPEC-022 修复，零结构变更）。**运维含义**：新增权限码**无需**改动排序逻辑（目录内容变更零影响排序）；若 catalog 断言路径再报 `Permission catalog is inconsistent`，先核对新增码是否含 `_` 及其在 `ORDER BY code` 下的字节序位置——修复后 catalog 侧与 DB 侧应完全一致。
- **测试串行纪律（全项目硬约束）**：数据库测试必须 `--test-concurrency=1`；测试库 55433 `_test` 库，**生产 55432 禁触**；重置需 `ALLOW_TEST_DB_RESET=true`；Egg 测试需同时设 `DATABASE_URL` + `DATABASE_URL_TEST`。连接串一律用 **127.0.0.1**（本机 `localhost:55433` 间歇 IPv6 `::1` 解析到 wslrelay 而非 Postgres → 偶发 "Can't reach database server"）。
- **共享 DB 协调纪律（双渠道）**：并行渠道共用一棵树与测试库。任何 DB 闸门前先探 `pg_stat_activity`（`scripts/db/tmp-probe-quiet.ts`，等 ACTIVE=0）；**撞车期间禁跑（SPEC-026 提示）**：探得外来 ACTIVE 连接即**不起跑**任何 DB 闸门——共享 test DB TRUNCATE 竞态活跃，遇外来进程**静候清净窗**（轮询 `pg_stat_activity` 至 ACTIVE=0）再起跑；撞车签名=`permission.createMany Unique constraint failed on (id)` 或 <10ms 快败——判为跨进程 TRUNCATE 竞态，撞车失败**不计**，**杀闸门等静默窗重跑、不改测试助手/配置**。
- **并发测试确定性纪律（SPEC-026）**：并发用例**禁用 `Promise.allSettled` 双调/多调时序竞争**制造「恰一胜一败」（loser 初始读与 winner 提交竞速 → 偶发 flake：loser 读落提交后 → 双成功或 404-vs-409 误判）。确定性构造二选一：①**version 前置条件**（适用于**有 client version 参数**的服务——`replacePermissions`/`updateDefinitionWithStatus` 等：先推进 version 提交、客户端持旧 version 调用 → 确定性 409，SPEC-024 先例）；②**宽容断言**（适用于**无 version 参数**的服务——`forwardTask` 等：loser 按读落提交前后接受 409 或 404 皆可，SPEC-026 先例 :2128）。新增并发用例必须走确定性构造，禁止新引入时序竞争模式；既有已确定性用例（callbackKey 唯一约束一胜一败 / 会签 ALL 双成功 / 已宽容竞速）保持零改动。并发改造用例须**清净窗隔离多次连跑确认零 flake**（SPEC-026 实证：instance 77/77 ×3 + Task 2 独立 ×2 佐证），并跑前按上条「撞车期间禁跑」纪律确认共享 test DB 清净（ACTIVE=0）再起跑。
- **并发用例确定性分类（SPEC-027 全项目评估，A-F 框架）**：项目全部 `Promise.allSettled` 并发用例按六分类评估——**A 唯一约束竞争**（create 重复 code/identity → P2002 → 冲突码，串行化也一胜一败，已确定性）；**B client version 参数**（服务接受 `version`/`expectedOperationVersion`/`employeeVersion` 等 + `updateMany {id, version}` 守卫 → 双调同 version 一胜一败，已确定性）；**C lockHolder FOR UPDATE**（prisma 事务持行锁 + 固定延时制造受控竞速 → 锁下串行一胜一败/双成功幂等重放，已确定性）；**D 宽容断言**（断言接受多结果 + 终态钉死，不 flake）；**F 非并发/清理**（`Promise.allSettled([p])` 单元素包装 / `$disconnect`，非测试）。**SPEC-027 实证：非 approval 域无 E 类真 flake**（唯一真 flake 即 SPEC-026 已修 :2128）——**新增并发用例必须落入 A/B/C/D 确定性框架，禁止裸时序竞争**；评估疑似 flake 时按此框架定位缺口（无唯一约束/无 client version/无锁控/固定断言 → E 类需修补）。
- **其余域并发用例评估结论（SPEC-027 Task 1 终稿，11 处全已确定性零改动）**：合同/财务/授权/审批/验收域 11 处 `Promise.allSettled` 并发用例逐一评估**全部已确定性、零真 flake、零代码改动**——机制清单：**①FOR UPDATE 行锁钉法 6 处**（contract-service :908/:1516、negotiation :661、receivable :1130、receivable-void :509/:585——事务持合同行锁 + 固定延时受控竞速，败者锁后重评 `updateMany {id, ...}` where → count=0 → VERSION_CONFLICT 409 / 幂等重放双成功 / 序无关不变式）；**②服务内版本守卫 4 处**（governance-concurrency :50/:73、spec-005-acceptance :177——`lockOperation` 事务内 `admin_operation` 行 FOR UPDATE + version 守卫败者锁后读失配 409；step-up :221——`lockSession` `auth_session` FOR UPDATE 串行化失败计数 1→5 确定 + 排序后宽容断言序）；**③唯一+EXCLUDE 约束 1 处**（user-grant :50——`user_role_no_overlapping_active_grants` EXCLUDE 约束 P2004/P2002 → `AUTHORIZATION_IN_USE` 409 一胜一败）。**非 approval 域无 E 类真 flake**（唯一真 flake 仍为 SPEC-026 已修 :2128）——评估疑似 flake 时按上条 A-F 框架定位缺口；后续并发用例新增仍须落 A/B/C/D 确定性框架。
- **闸门命令**（`apps/server` 下，全套 env 块）：
  - 目录级：`npx tsx --test --test-concurrency=1 --test-force-exit test/finance/*.test.ts`（finance 219）、`test/contract/*.test.ts`（**224**——SPEC-012 +22：contract-events 49/contract-service 40/plan-cancel 4/terminate-linkage 10/receivable-void 10/receivable-service 38 等）、`test/app/*.test.ts`（baseline+32 API）。
  - 全量：glob 展开避免 argv 超限（Windows 命令行长度限制下 run-node-tests-serial.ts 枚举 177 文件会报"参数太多"）——`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（含全量计数；spec-008 排练 3 例 port-55432 guard fail-fast 照录非回归）。
  - 迁移：`npm run db:reset:test` → `npm run db:assert-empty` → 重演幂等（`npx prisma migrate deploy` 二次跑零迁移）。
  - 基线：`npm run check:baseline`（21 迁移/57 model）+ `npm run check:bootstrap`。
  - 供给实证：reset 后零种子直查 `permission` = 118 逐字段 = 目录（17 新码 version=1）。
  - 前端：`npx tsc -b` / `npm run lint` / `npm run build` / 四页隔离 Vitest（33 例）。
  - 安全：`npm run security:test`（47 基线——SPEC-034 增 moderate gate + 基线用例、SPEC-036 增例外生命周期 + 报告用例）+ `npm run security:policy:validate` + `npm run security:exceptions` + `npm run check:docs-leakage`（exit 0）。
- **迁移/模型计数期望同步点**：新迁移/新模型落地需同步 `check-baseline-contract.ts`（CANONICAL）+ `baseline-contract.test.ts`（fixture 消息 + 模型生成器 parity）+ `spec-008-event-observability-migration-contract.test.ts` + `schema-contract.test.ts`（model 总数两处）。SPEC-011 终态 **21 迁移 / 57 model**；SPEC-012 实证 **21 迁移维持**（PaymentPlan.status +CANCELLED 为既有 String 列值扩展，Prisma 不跟踪行内注释零 DDL，不建注释级迁移）、57 model 不变。
- **测试环境指纹（承 SPEC-009/010）**：并行负载/内存压力下 Egg boot 偶发 `APP_KEYS is required`（密钥注入竞态）——静默窗口重试即绿；前端 Vitest 全量存在**预存负载 flake**（EventOperations/Position/SecurityUser/PublicPoolPage/SecurityRole/App.test/AdminGovernance，隔离复跑全 PASS，非回归）——新件套件全绿即为 Task 闸门。
- **安全审计现状（2026-08-04，SPEC-028 收口 + SPEC-031 dev 清零）**：`security:audit:prod` **server + web 双 passed=true**，production **high=0 / moderate=0 / critical=0 / total=0 / findings=0**（`var/security/audit/production-summary.json`；SEC-2026-002 项 react-router 8.3.0 + brace-expansion 5.0.8 已随既有锁版本清零，**v8 迁移专项已闭环（2026-08-05 主动收尾：react-router 8.3.0 无 react-router-dom、web audit 0 漏洞、契约 floor ≥8.3.0 在 `dependency-contract.test.mjs`）**）。SPEC-028 overrides 清零链路（`apps/server/package.json`，零业务代码）：`brace-expansion@<1.1.18: 1.1.18`（multimatch/mz-modules 链 GHSA-rgw5-rvv9-x895）、`uuid@<11.1.1: 11.1.1`（mochawesome-with-mocha/koa-session 链 GHSA-w5hq-g745-h8pq，uuid 8→11 CJS 兼容已验证不回退）、undici **`6.28.0`**（urllib@3.27.3/urllib-next 链）+ **`7.29.0`**（urllib4@npm:urllib@4.9.0 链，GHSA-4cwx/8xcm/m8rv/jr45/v3r7）。**契约下限（SPEC-028 Task 2 锁死）**：`scripts/security/dependency-contract.test.mjs` `assertUndiciVersionSafe` 钉死 undici 6.x ≥ **6.28.0** / 7.x ≥ **7.29.0**（锁死修复版本，防未来回退静默放行）；react-router ≥8.3.0 / brace-expansion ≥5.0.7（web dev 工具链）契约不变。**dev 作用域清零（SPEC-031，2026-08-04）**：server dev +override `brace-expansion@^2.0.0: 2.1.4`（glob/mocha→minimatch 5.1.9 链 GHSA-rgw5-rvv9-x895 high，审计实测 2.x 同命中 high 必要增补）+ 既有 `@^5.0.5: 5.0.8→5.0.9`（GHSA-mh99-v99m-4gvg high）+ `tar@<7.5.21: 7.5.21`（GHSA-r292-9mhp-454m moderate）；web dev +overrides `brace-expansion@^5.0.5: 5.0.9` / `undici@<7.29.0: 7.29.0` / `postcss@<8.5.23: 8.5.23`——`security:audit:all` **server + web 双 passed=true（production + development 全 zero，high=0/moderate=0/findings=0，`var/security/audit/full-summary.json`，2026-08-04 实测）**。
- **moderate 纳入 gate + 基线断言（SPEC-034，2026-08-05）**：`security:audit:prod` production **moderate 从 'report' 改 'block'**（>0 → fail，与 high/critical 同待遇）；新增 **`scripts/security/expected-baseline.json`** 固化基线（server/web × production/development 各 severity 全 0）——audit 实测任一 severity **超基线 → fail**（防静默回归）。运维含义：**未来新增依赖若带来任何 severity advisory，必须先加例外或更新基线**（policy EXCEPTION 机制 `advisories` 字段，development scope 例外有效；production low 也会被基线硬阻断——D2 全 severity 冻结为 0 的预期行为，见 spec-034 closeout §7）。`loadSecurityConfiguration`/`evaluateWorkspace` 均校验基线文件（缺失/非法 JSON → fail-closed）。`security:test` 42/42。
- **例外审批闭环（SPEC-036，2026-08-05）**：例外（`security/dependency-exceptions.json`）增加生命周期 `status`：`pending_review` | `approved`（缺省 `approved`，legacy 无 status 向后兼容）——**仅 `approved` 生效**（`pending_review` 不豁免 → advisory 仍 block，fail-closed）。新增 **`npm run security:exceptions`** 治理报告（approved/pending_review/expired/invalid 分类 + 到期 ≤14 天 `expiring_soon` 预警；exit 0 信息命令）。运维含义：**新增例外先以 `pending_review` 落盘（不生效），审批通过后改 `approved`**；`security:exceptions` 随时查看待审/到期。`security:test` 42→**47**。
- **SEC-2026-001 例外退役（SPEC-038，2026-08-05）**：serialize-javascript 例外（GHSA-5c6j-r48x-rmvq）已随 7.0.7 升级修复、audit 实测 **0 漏洞**——残留例外移除（`security/dependency-exceptions.json` → 空）。**契约下限锁死**：`dependency-contract.test.mjs` 钉死 serialize-javascript **≥7.0.7**（防无例外静默回退）。`security:exceptions` 现报 approved(0)。
- **例外审批命令（SPEC-040，2026-08-05）**：`npm run security:exceptions -- approve <id> --reviewed-by <name>`（pending_review→approved，落盘 approvedBy/reviewedAt/reviewedBy，幂等，reviewer≠owner 拒）/ `reject <id>`（移除条目）——**替代人工编辑 JSON**，原子写回（temp+rename）。运维含义：审批例外用命令而非手改文件，评审元数据留痕；reject 可清理过期条目（宽松读）。`security:test` 49→**57**。
- 数据库：PostgreSQL（生产 55432；测试 55433 `_test` 库）。SPEC-011 新增迁移 2：`20260731210000_finance_operations_expand`（InvoiceRequest/RefundRequest/CostEntry + Payment.void 三列可空，4 新表/扩展）、`20260731213000_finance_permission_provision`（17 权限行，ON CONFLICT DO NOTHING，无 UPDATE 段——refund.approve 零改动）；**SPEC-012 零新增迁移**（21 维持，§2.5）。
- **已知边界**（closeout §7 明细照录，运维处置口径）：Cost 编辑态锚点可改但 PATCH 不携带（UX 打磨候选）；received-uninvoiced 的 total=候选池 count 非过滤后全量（前端分页条按此语义渲染）；refund.approve 真实 Step-Up 延迟（step-up-target 无 refund 目的位，敏感 Modal 已落实）；预存漂移 4 项（admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值）留漂移治理专项；**终止合同 confirm 幂等重放语义**（已 CONFIRMED payment 在 TERMINATED 合同 confirm 得 409 非幂等重放——系有意，§2.5）；**CANCELLED 计划无 updatedBy 列**（取消者经事件信封 operatorUserId 追溯，§2.5）。

---

## 9. 审批中心（SPEC-013）

适用范围：行政/HR 类审批流——Definition/Instance/Task/CallbackAction 四模型生命周期 + 前端审批中心页（我的申请/待办/已办）+ refund.approve 真实 Step-Up（SPEC-011 follow-up 落地）+ **多级审批（SPEC-016：Definition nodeSchema 多节点链 / Instance currentNode 逐节点流转 / 节点推进不产 completed 事件）** + **定义管理（SPEC-017：Definition CRUD，`approval.manage` 码——权限 121→122）** + **会签（SPEC-018：nodeSchema 节点 mode `'ALL'`=节点内全部通过才放行；缺省 `'ANY'`=任一通过向后兼容；零结构变更）** + **转交（SPEC-019：PENDING task assigneeId 变更给目标审批人——`POST /:id/forward`，approval.process，纯 assigneeId 变更，零结构变更）** + **加签（SPEC-020：PENDING task 审批人向同节点追加额外审批人——`POST /:id/add-signers`，approval.process，同节点新 PENDING task，实例 currentNode/status/version 不变，零结构变更）** + **审批超时升级（SPEC-021：PENDING task 滞留超时按天提醒——`ApprovalTimeoutScanner` 随事件 worker tick 节律运行，`APPROVAL_TIMEOUT_HOURS` 阈值默认 72，Notification type APPROVAL 幂等防重，零结构变更）** + **全组织视图（SPEC-023：listInstances role='ALL' 无 actor 过滤——approval.manage 门控；getInstance manage 放行任意实例；前端「全部审批」Tab，动作不扩大；零结构变更）**。领域审批（refund/invoice/合同）保持直连不回填。
后端实现：`apps/server/app/application/approval/`（approval-instance-service / approval-definition-service / approval-factory / **approval-timeout-scanner——超时升级扫描器，SPEC-021**）+ `app/domain/approval/`（approval-policy / approval-errors / approval-types）+ `app/controller/approval.ts` + `app/router.ts:234-244`（十一路由：六门禁 + 三管理 + **一转交 forward（SPEC-019）** + **一加签 add-signers（SPEC-020）**；**SPEC-021 零新增路由**）+ `app/middleware/errorHandler.ts`（ApprovalError 分支）。

### 9.1 Definition 种子五类（业务角色码约定）

provisioning 迁移 `20260801120000_approval_provision` 落 5 行 `approval_definition`（ON CONFLICT (code) DO NOTHING 幂等）。**SPEC-016（多级审批）** 起 Definition 增 `nodeSchema Json?` 列（`20260802100000_approval_multilevel_expand`）——**nodeSchema 权威**（有=多节点链 `[{name, approverRule, mode?}]`；NULL=顶层 approverRule 单节点向后兼容，5 现有种子零改动），运行期 apply 按 `nodeSchema ?? [顶层 approverRule]` 构建审批链。**SPEC-018（会签）** 节点结构再扩 `mode ∈ 'ANY'|'ALL'`，**缺省 `'ANY'`**（任一通过，既有行为）；`mode:'ALL'`=该节点内全部 APPROVE 才推进/定稿——纯 Json 配置数据扩展，零结构变更：

| code | name | businessType | approverRule（roleCodes，顶层） | nodeSchema（SPEC-016 多级） | mode（nodeSchema 节点，SPEC-018） |
|---|---|---|---|---|---|
| LEAVE | 请假申请 | LEAVE | ROLE → HR | NULL（缺省=顶层 approverRule 单节点） | —（单节点，缺省 ANY） |
| SEAL | 用印申请 | SEAL | ROLE → SEAL_ADMIN | NULL（缺省=顶层 approverRule 单节点） | —（单节点，缺省 ANY） |
| EXPENSE | 费用报销 | EXPENSE | ROLE → FINANCE | NULL（缺省=顶层 approverRule 单节点） | —（单节点，缺省 ANY） |
| CONTRACT_CHANGE | 合同变更 | CONTRACT_CHANGE | ROLE → PARTNER | **主管初审 MANAGER → 合伙人终审 PARTNER**（两节点链，`20260802110000_approval_multilevel_provision` UPDATE，approverRule 列保留不动） | 缺省 ANY（任一审过即推进；如需会签可运营改 nodeSchema 节点加 `"mode":"ALL"`） |
| TRANSFER | 转所申请 | TRANSFER | ROLE → HR | NULL（缺省=顶层 approverRule 单节点） | —（单节点，缺省 ANY） |

**mode 语义（SPEC-018）**：节点 `mode` 若存在必须 ∈ `{'ANY','ALL'}`，否则 `APPROVAL_ASSIGNEE_INVALID` 400（buildApprovalChain 运行期 + assertNodeSchemaValid 定义 CRUD 双点校验，畸形配置防静默）。`'ANY'`（含缺省）=节点内首个 APPROVE 即推进/定稿（余 PENDING CANCELLED）；`'ALL'`=节点内全部 APPROVE 才推进/定稿（首签/中签停留当前节点，零推进零 completed）。运营改会签定义：`createDefinition/updateDefinition` 的 nodeSchema 文本中节点对象加 `"mode": "ALL"`（沿 §9.10 定义管理 JSON 文本编辑形态）。

**角色供给边界（SPEC-015/016 更新）**：`HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER` 为审批中心约定业务角色码（审批人由角色确定——专项设计 §2-4）。SPEC-015 起 bootstrap 已种子供给 **4 个 BUSINESS 角色**（HR 人事管理 / SEAL_ADMIN 印章管理员 / FINANCE 财务 / PARTNER 合伙人），**SPEC-016 再 +MANAGER（主管）→ 共 5 个**（system-bootstrap-service `BUSINESS_ROLE_SEEDS`，各 `type:'BUSINESS'`/`status:'ENABLED'`，fresh init 即存在，幂等守卫沿既有 `AlreadyInitializedError` 写前拒）并授予各角色 **approval.read + approval.process** 两权限（`APPROVAL_REVIEWER_PERMISSION_CODES` 按 code 查 permission id 落 role_permission；**approval.apply 不授**——申请人为一般员工非角色）。`approverRule` 为 `approval_definition.approverRule` JSONB 配置（非 FK），迁移/直查不受影响；运行期 apply 按 roleCodes 解析成员（role.status ENABLED + user_role 活跃过滤 revokedAt null/validFrom≤now/validUntil 窗口），角色存在但**成员为空仍 `APPROVAL_ASSIGNEE_INVALID` 400** 优雅兜底。**成员指派归运行期**（role-auth-service/user-grant 经角色管理 API 指派后，五类审批方可产生实际审批人）。

### 9.2 状态机（`app/domain/approval/approval-policy.ts`）

Instance 词汇 `PENDING / APPROVED / REJECTED / WITHDRAWN`；Task 词汇 `PENDING / APPROVED / REJECTED / CANCELLED`。动作（5 个）：`apply / process / withdraw / forward / addSigners`。**SPEC-016 多级节点推进（currentNode）**：Instance 增 `currentNode Int @default(0)`（当前活动节点下标，0 基）；单节点链与多级链共用同状态机，实例级状态翻转仅发生在末节点定稿/REJECT/withdraw，**节点推进不改变实例状态（仍 PENDING）**。**SPEC-018 会签（节点内 ALL 全签）**：nodeSchema 节点可带 `mode:'ALL'`（缺省 `'ANY'`=任一通过向后兼容）——`'ALL'` 节点首个/中间 APPROVE 仅翻转该 task，**实例停留当前节点（currentNode 不变、仍 PENDING）**，末签才推进/定稿。**SPEC-019 转交（forward）**：PENDING task 的 assigneeId=actor 可将任务转交其他审批人——**纯 assigneeId 变更**，task.status 仍 PENDING、nodeName/实例 currentNode/status/version 不变、task version+1；**不产 outbox 事件、不建 callbackAction**。**SPEC-020 加签（addSigners）**：PENDING task 的 assigneeId=actor 可向**同一节点**追加额外审批人（1-10 人）——创建同节点新 PENDING task（nodeName=当前节点名，assigneeId=目标），task.status 仍 PENDING、实例 currentNode/status/version 不变；**不产 outbox 事件、不建 callbackAction**。

```
PENDING ──apply──▶ PENDING（链构建 nodeSchema ?? [顶层 approverRule] + 节点[0] Task）
PENDING ──process──▶ PENDING（APPROVE 非末节点：currentNode++ + 下节点 Task，仍 PENDING）
PENDING ──process──▶ PENDING（mode ALL 节点首签/中签：仅翻转 task，currentNode 不变停留，仍 PENDING——SPEC-018）
PENDING ──process──▶ APPROVED | REJECTED（末节点 APPROVE / 任一节点 REJECT 定稿）
PENDING ──withdraw──▶ WITHDRAWN（本人撤回，任意节点阶段）
PENDING ──forward──▶ PENDING（assigneeId 变更给目标审批人，task 仍 PENDING，实例 currentNode/status/version 不变——SPEC-019）
PENDING ──addSigners──▶ PENDING（同节点追加 N 审批人——新 PENDING task 同 nodeName，实例 currentNode/status/version 不变——SPEC-020）
```

- **节点内任一通过、节点间顺序推进（D8 + SPEC-016 修正）**：process 决策决定——task APPROVED → **若非末节点：currentNode++ + 生成下节点 Task + 实例仍 PENDING（零 completed 事件）**；若末节点 → instance APPROVED 定稿。task REJECTED（任意节点）→ instance REJECTED。当前节点余 PENDING task 在节点推进时 CANCELLED；定稿时当前+未来 PENDING task 全 CANCELLED。
- **会签（节点内 ALL 全签，SPEC-018 D3/D6）**：task APPROVED 后、进入推进/定稿分支前——当前节点 `mode==='ALL'` 且该节点**仍余 PENDING task**（`remainingPending>0`，即非最后一签）→ **仅翻转自身**（兄弟 PENDING 保留，不取消），实例 currentNode/version **不变**、零推进、**零 completed 事件**、不建下节点 Task；PROCESS 审计 `toStatus:'PENDING'` + `mode:'ALL'`；callbackKey result `{status:'PENDING', currentNode}`。**最后一签（remainingPending===0）** 落既有推进/定稿分支——非末节点 → currentNode++ + 下节点 Task（实例仍 PENDING）；末节点 → APPROVED 定稿（`completed` 恰 1）。节点内并行 APPROVE 由实例行 FOR UPDATE 串行化，每次翻转后重查 remainingPending 判定一致。**REJECT 任意节点任意 mode 一票否决不变**（REJECTED 定稿，当前+未来 PENDING 全 CANCELLED）。mode 缺省/'ANY' 节点不进入会签分支（`node.mode === 'ALL'` 短路），既有 ANY 语义逐字不变。
- **禁止自审（适用全部节点）**：申请人 ∈ 任一节点审批人集（apply 节点[0] + process 推进时下节点）→ `APPROVAL_SELF_REVIEW_FORBIDDEN` 409。下节点自审 409 在事务内抛出 → 整事务回滚（当前 task 翻转撤销 / currentNode 不推进 / 无下节点 Task 残留）。
- **节点推进不产 completed 事件**：observability 经视图 `currentNode` + tasks 节点进度承载（created/completed 事件载荷不变，多级推进仅 PROCESS 审计）。
- **转交（SPEC-019，纯 assigneeId 变更）**：PENDING task 的 `assigneeId=actor` 可将任务转交其他审批人（`POST /approvals/:id/forward`，approval.process，`:id`=taskId）——task.status 仍 PENDING、nodeName/实例 currentNode/status/version **不变**、task version+1；**不产 outbox 事件、不建 callbackAction**（observability 经视图 assigneeId 变更承载）。守卫链：非我 404 → 非 PENDING 409 `APPROVAL_STATE_INVALID` → 转交给自己 400 `APPROVAL_ASSIGNEE_INVALID` → **转交目标=申请人 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`（自审守卫，防「转交→申请人→自批」绕过）** → 并发竞争（updateMany version 条件 count=0）409 `APPROVAL_STATE_INVALID`。审计 `APPROVAL_TASK_FORWARD`（targetType APPROVAL_TASK，newValues {taskId, fromUserId, toUserId, hasReason}；remark 自由文本不落审计）。
- **加签（SPEC-020，同节点追加审批人）**：PENDING task 的 `assigneeId=actor` 可向**同一节点**追加额外审批人（`POST /approvals/:id/add-signers`，approval.process，`:id`=taskId）——创建 N 个同节点新 PENDING task（nodeName=当前节点名，assigneeId=目标，1-10 人去重），task.status 仍 PENDING、实例 currentNode/status/version **不变**；**不产 outbox 事件、不建 callbackAction**（observability 经视图 tasks 增加承载）。守卫链：非我 404 → task/实例非 PENDING 409 `APPROVAL_STATE_INVALID` → 目标含自己 400 `APPROVAL_ASSIGNEE_INVALID` → **目标含申请人 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`（自审不变量，防「加签→申请人→自批」绕过）** → **D4.1 并发锁点：事务内实例行 FOR UPDATE + 锁后重验 task 仍 PENDING 且 `nodeName===chain[currentNode].name`（防加签与推进竞速孤儿 task，否则 409 `APPROVAL_STATE_INVALID`）**。审计 `APPROVAL_TASK_ADD_SIGNER`（targetType APPROVAL_TASK，newValues {taskId, addedUserIds, hasReason}；remark 自由文本不落审计）。
- **终态防线**：终态（APPROVED/REJECTED/WITHDRAWN）任何再动 → `APPROVAL_STATE_INVALID` 409；CANCELLED task 处理 → 409。
- **幂等重放**：已处理 task（APPROVED/REJECTED）重复 process → 返回现状零事件零审计；已 WITHDRAWN 重复 withdraw → 幂等重放返回现状；推进路径 callbackKey 重放 → 返回推进后状态（下节点 Task 不重复）。

### 9.3 流程（apply / process / withdraw / forward / addSigners）

- **apply（approval.apply，POST /approvals）**：definition ACTIVE 探查（缺/禁 404）→ content 按 formSchema.fields 必填校验（400）→ **链构建 `nodeSchema ?? [顶层 approverRule]` 单节点兜底**（NULL nodeSchema → 合成单节点 `[{name:'审批', approverRule: 顶层}]`；nodeSchema 空数组畸形 → `APPROVAL_ASSIGNEE_INVALID` 400）→ 节点[0] 审批人解析（USER userIds 原序 / ROLE roleCodes→成员；空集 400）→ 自审 409 → 单事务 Instance PENDING（currentNode=0）+ **节点[0] Task（nodeName=节点[0].name，N 审批人）** + `approval.instance.created`（恰 5 键）+ APPROVAL_APPLY 审计（含 `currentNode:0`）。`idempotencyKey` 仅作接口位校验（无业务唯一键，不落库）。
- **process（approval.process，POST /approvals/:id/process，`:id`=taskId）**：task 探查（id + assigneeId=actor，非我 404）→ **CallbackAction 幂等**（callbackKey=idempotencyKey 命中且同实例 → 重读首结果零事件零审计；异实例占用 → `CALLBACK_KEY_CONFLICT` 409，见 §9.4）→ 实例行 FOR UPDATE 串行化并发决策 → task 重读（已处理幂等重放；CANCELLED 409）→ task {id,version,status:PENDING} 翻转（version+1，更新失败 → 并发竞争 409）→ **多级分支（SPEC-018：先判会签停留，再走既有推进/定稿）**：
  - **会签停留（mode='ALL' 非最后一签，SPEC-018 D3/D6）**：task 翻转后、推进判定前——`target==='APPROVED'` 且当前节点 `mode==='ALL'` → `approvalTask.count({instanceId, nodeName, status:'PENDING'})` 计余 PENDING。`remainingPending>0` → **仅翻转自身**（兄弟 PENDING 保留、不取消），实例 currentNode/version **不变**、零推进、**零 completed 事件**、不建下节点 Task；PROCESS 审计 `toStatus:'PENDING'` + `mode:'ALL'` + `hasReason`；callbackKey result `{status:'PENDING', currentNode}`；返回实例视图。`remainingPending===0`（最后一签）→ **落穿既有推进/定稿分支**（下述）。缺省/'ANY' 节点短路（`node.mode === 'ALL'` 为 false，既有 ANY 语义零回归）。
  - **推进（APPROVE 非末节点；ALL 最后一签落此）**：取消当前节点余 PENDING task（CANCELLED）→ 下节点审批人解析（**含下节点自审 409——禁止自审适用全部节点**，事务回滚）→ create 下节点 Task（nodeName=下节点.name）→ `currentNode++/version+1`，**实例仍 PENDING，零 completed 事件** → APPROVAL_PROCESS 审计（`toStatus:'PENDING'` + currentNode）+ callbackAction result `{status:'PENDING', currentNode}`。
  - **定稿（REJECT 任意节点 / 末节点 APPROVE）**：实例 PENDING→APPROVED/REJECTED（decidedBy/At、version+1）+ 当前+未来 PENDING task 全 CANCELLED → `approval.instance.completed`（恰 3 键）+ APPROVAL_PROCESS 审计（`toStatus` 终态）。写 `callback_action` 行（callbackKey unique、status RESPONDED、result=首结果快照）。
- **forward（approval.process，POST /approvals/:id/forward，`:id`=taskId，SPEC-019）**：task 探查（`findFirst {id, assigneeId: actor}`，非我/随机 UUID 统一 404）→ `task.status !== 'PENDING'` → 409 `APPROVAL_STATE_INVALID` → `forwardToUserId` 必填（normalizeRequiredText 1-100，缺/空/空白 → 400 `VALIDATION_FAILED`）→ 转交给自己（`forwardToUserId === actor`）→ 400 `APPROVAL_ASSIGNEE_INVALID` → **自审守卫：转交目标 = 申请人（`instance.applicantId`）→ 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`**（防「转交→申请人→自批」绕过，沿 apply/process 同一不变量）→ 事务内 `approvalTask.updateMany({id, version, status:'PENDING'}, {assigneeId, version+1})`（count=0 → 并发竞争 409 `APPROVAL_STATE_INVALID`）+ 同事务 `operation_log` 审计 `APPROVAL_TASK_FORWARD`（targetType APPROVAL_TASK，newValues {taskId, fromUserId, toUserId, hasReason}；remark 自由文本不落审计）→ `loadInstanceView(tx, instanceId)` 返回实例视图。**纯 assigneeId 变更**：task.status 仍 PENDING、nodeName/实例 currentNode/status/version 不变、task version+1；**不产 outbox 事件、不建 callbackAction**（observability 经视图 assigneeId 变更承载）。目标是否须为实例可见审批人——**不强制**（职责移交，目标人接任后按既有 assignee 语义处理；可见性限制列 follow-up）。
- **addSigners（approval.process，POST /approvals/:id/add-signers，`:id`=taskId，SPEC-020）**：task 探查（`findFirst {id, assigneeId: actor}`，非我/随机 UUID 统一 404 `APPROVAL_TASK_NOT_FOUND`）→ `task.status !== 'PENDING'` → 409 `APPROVAL_STATE_INVALID` → 实例非 PENDING → 409 `APPROVAL_STATE_INVALID` → 目标校验（`addSignerUserIds` 必填非空数组 1-10 人、每人 normalizeRequiredText 1-100、去重——缺/空/超限 → 400 `VALIDATION_FAILED`；**目标含自己 → 400 `APPROVAL_ASSIGNEE_INVALID`**（加签给自己无意义）；**目标含申请人 → 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`**（禁止自审不变量，沿 forward 同款守卫））→ **事务内 D4.1 首把锁 = 实例行 FOR UPDATE**（沿 processTask 锁点，与推进/转交/撤回互斥）→ **锁后重验**：task 仍 PENDING 且 `nodeName === chain[currentNode].name`（仍当前节点）——否则 409 `APPROVAL_STATE_INVALID`（防加签与推进竞速孤儿 task）→ 创建 N 个**同节点新 PENDING task**（nodeName=task.nodeName，assigneeId=目标）→ 同事务 `operation_log` 审计 `APPROVAL_TASK_ADD_SIGNER`（targetType APPROVAL_TASK，newValues {taskId, addedUserIds, hasReason}；remark 自由文本不落审计）→ `loadInstanceView(tx, instanceId)` 返回实例视图。**状态语义**：实例 currentNode/status/version 不变、task.status 仍 PENDING、新 task 并入该节点 remainingPending（ANY 节点首 APPROVE 取消含新增；ALL 节点全签含新增——与 processTask 自动兼容，零 processTask 逻辑改动）；**不产 outbox 事件、不建 callbackAction**。幂等：加签不建 callbackKey，重复 POST 会重复创建（前端防连点；幂等 key 列 follow-up）。
- **withdraw（approval.apply，POST /approvals/:id/withdraw，`:id`=instanceId）**：instance {id, applicantId=actor} 探查（非本人/缺统一 404）→ 非 PENDING 409 → 翻转 WITHDRAWN + 当前/未来 PENDING task 全 CANCELLED（**任意节点阶段**，节点[0] APPROVED 保留）→ `completed(WITHDRAWN)` + APPROVAL_WITHDRAW 审计。
- **list/get**：`role` 必填四值（APPLIED=applicantId=actor；TODO=task.assigneeId=actor AND PENDING；DONE=task.assigneeId=actor AND !=PENDING；**ALL=无 actor 过滤全组织——approval.manage 门控，SPEC-023**）；分页 page 1/pageSize 20 上限 100/createdAt DESC id ASC；getInstance 申请人或任一审批人可见，其余 404 fail-closed，**approval.manage 用户可见任意实例（SPEC-023 D6）**。
- **审批无组织锚**：事件信封 branchId/teamId 恒 null；服务层无数据范围过滤（动作权限三码即全部门禁，列表天然按 actor 作用域 fail-closed）。

### 9.4 幂等（CallbackAction callbackKey）

process 幂等双层：①外部 callbackKey（`callback_action.callbackKey` UNIQUE）；②任务状态自幂等（已 APPROVED/REJECTED → 返回现状零事件）。**跨实例语义（SPEC-014 补强）**——幂等查找限定实例域，调用方违规同一 idempotencyKey 用于两个不同逻辑操作时不再静默错误：

- **同实例命中** → 幂等重放首结果（零事件零审计）。
- **异实例占用（顺序）** → `CALLBACK_KEY_CONFLICT` 409，消息钉死 `'idempotency key already used for another approval'` 不泄露异实例 id——两段 `findFirst({callbackKey, instanceId})`：同实例命中重放 / 异实例占用 409。
- **跨实例并发同 key** → callbackKey 唯一索引恰一胜；败者事务外 catch P2002 → 新查询重读归属：同实例重放 / 异实例 409，**杜绝 500**（PG P2002 中止当前事务，重读必须在事务外）。

### 9.5 Step-Up（REFUND_APPROVE + x-step-up-token）

refund.approve 真实 MFA 重验（Q6，SPEC-011 follow-up 落地）：

- **目的位**：`STEP_UP_PURPOSES +REFUND_APPROVE`；normalizeTarget `exactRecord(['refundRequestId','expectedVersion'])` → `{refundRequestId requiredString, expectedVersion positiveInteger}`（digest 绑定 exactRecord）。
- **后端接线**：controller 提取 `x-step-up-token` 头 + `ctx.state.user` claims（沿 adminGovernance.stepUpAuthorization 形态）→ 服务层 `consumeGovernanceStepUp`（purpose=REFUND_APPROVE、target={refundRequestId, expectedVersion}）**同事务消费**（probe 后、lockContract 前——锁序 Contract→RefundRequest 不变）→ 校验通过才翻转 APPROVED。
- **expectedVersion 语义**：客户端所见版本（前端列表行 version）。缺失/非法 → 400 VALIDATION_FAILED（目标无法绑定）；与服务重读版本不符 → 409 REFUND_STATE_INVALID（陈旧客户端，**先于 grant 消费**）；无证/claims 不匹配/digest 不匹配 → 403 STEP_UP_REQUIRED / STEP_UP_TARGET_MISMATCH。
- **最小影响**：RefundService 构造第 5 参 `stepUp?` 可选——不注入时 approve 走旧路径（既有 46 例零改动）；生产 finance-factory 注入强制。reject/execute 不挂 Step-Up。
- **前端**：RefundListPage 审批按钮 → `useStepUp(REFUND_APPROVE, {refundRequestId, expectedVersion})` → StepUpDialog 真实 MFA 挑战 → 持证调用 approve API。

### 9.6 事件清单（SPEC-007 outbox，sourceModule APPROVAL / objectType APPROVAL_INSTANCE）

| eventType | 载荷键集 | 触发 |
|---|---|---|
| `approval.instance.created` | 恰 5 键 `{instanceId, businessType, title, applicantId, status:'PENDING'}` | apply 提交 |
| `approval.instance.completed` | 恰 3 键 `{instanceId, businessType, status: APPROVED\|REJECTED\|WITHDRAWN}` | 定稿/撤回 |

事件信封：objectType APPROVAL_INSTANCE、organizationId/branchId/teamId 恒 null（审批无组织锚）、traceId actor.requestId ?? randomUUID、operatorUserId=actor。事件投递运维（重放/隔离/健康/worker）见 SPEC-007/008 既有 runbook；本模块**不新增订阅、不新增投递面**（事件订阅目录 4 项固定）。**SPEC-019 转交不产任何 outbox 事件**（非定稿/推进，observability 经视图 assigneeId 变更承载——沿「节点推进不产 completed」语义）；**SPEC-020 加签不产任何 outbox 事件**（observability 经视图 tasks 增加承载）。

### 9.7 权限与数据范围（approval 域路由 4→6→9→10→11→13）

全局目录 **122 码**（+3：`approval.read` 查看审批中心 LOW / `approval.apply` 发起申请+撤回 MEDIUM / `approval.process` 处理任务 HIGH；**SPEC-017 +`approval.manage` 定义管理 LOW**；**SPEC-019/020 零新增权限码**——转交/加签均复用 `approval.process`）。六门禁路由（router.ts:232-237；Task 1 退役旧 4 无权限路由）+ **SPEC-017 三管理路由（全 `approval.manage`）** + **SPEC-019 +1 转交路由（approval.process）** + **SPEC-020 +1 加签路由（approval.process）** + **SPEC-025 +2 导入导出路由（全 approval.manage，非结构变更）**：

```
GET  /api/v1/approvals/definitions  approval.apply   （字面量先于 /:id，anomaly 先例）
GET  /api/v1/approvals              approval.read
GET  /api/v1/approvals/:id          approval.read
POST /api/v1/approvals              approval.apply
POST /api/v1/approvals/:id/withdraw approval.apply    （:id=instanceId）
POST /api/v1/approvals/:id/process  approval.process  （:id=taskId）
POST /api/v1/approvals/:id/forward  approval.process  （:id=taskId，SPEC-019 转交）
POST /api/v1/approvals/:id/add-signers approval.process  （:id=taskId，SPEC-020 加签）
POST /api/v1/approvals/definitions        approval.manage  （createDefinition，字面量先于 /:code）
GET  /api/v1/approvals/definitions/manage approval.manage  （listAll 含 DISABLED——管理页专用，字面量先于 /:code）
PATCH /api/v1/approvals/definitions/:code approval.manage  （updateDefinition + status 双职责）
GET  /api/v1/approvals/definitions/export approval.manage  （exportDefinitions——全量快照，字面量先于 /:code，SPEC-025）
POST /api/v1/approvals/definitions/import approval.manage  （importDefinitions——批量 upsert，字面量先于 /:code，SPEC-025）
```

- **语义钉死**：process `:id`=taskId、withdraw `:id`=instanceId（Task 5 签名逐字对齐）；`role` 必填透传（四值 APPLIED/TODO/DONE/**ALL——ALL 全组织视图 approval.manage 门控，SPEC-023**；缺 → 400）；分页默认 page=1/pageSize=20（上限 100）。
- **definitions 挂 approval.apply**（无 definition.read 码——定义即"可申请的菜单"）；前端新建 Modal 按钮 apply 门控 + definitions 懒加载（read 用户永不发 GET definitions 避免 403 噪音）。
- **数据范围**：审批无组织锚、无行级 scope——动作权限三码即全部门禁；列表/详情按 actor 作用域 fail-closed，不可见统一 404 不泄露存在性。
- 角色授予走角色管理 API；5 个审批业务角色（HR/SEAL_ADMIN/FINANCE/PARTNER/**MANAGER**——SPEC-016 +MANAGER）已由 bootstrap 供给（§9.1），成员指派归运行期（role-auth-service/user-grant）。

### 9.8 错误码表（ApprovalError 按实例 httpStatus 透传）

| code | status | 场景 |
|---|---|---|
| `APPROVAL_DEFINITION_NOT_FOUND` | 404 | definition 缺/禁 |
| `APPROVAL_INSTANCE_NOT_FOUND` | 404 | instance 缺/不可见 |
| `APPROVAL_TASK_NOT_FOUND` | 404 | task 缺/非我（含转交 task 探查非我——SPEC-019） |
| `APPROVAL_STATE_INVALID` | 409 | 非 PENDING 处理/撤回/终态再动/CANCELLED task / **转交非 PENDING task（SPEC-019）** / **转交并发竞争（version 条件 updateMany count=0，SPEC-019）** / **加签 task 或实例非 PENDING（SPEC-020）** / **加签锁后重验失败——task 状态变化或非当前节点（D4.1 并发，SPEC-020）** |
| `APPROVAL_SELF_REVIEW_FORBIDDEN` | 409 | 申请人 ∈ 审批人集 / **转交目标=申请人（SPEC-019 自审守卫，防「转交→申请人→自批」绕过）** / **加签目标=申请人（SPEC-020 自审不变量）** |
| `APPROVAL_ASSIGNEE_INVALID` | 400 | 审批人空集/rule 畸形/nodeSchema 空数组畸形（SPEC-016 链构建）/ **转交给自己（target==actor，SPEC-019）** / **加签目标含自己（SPEC-020，加签给自己无意义）** |
| `CALLBACK_KEY_CONFLICT` | 409 | 异实例 callbackKey 占用（顺序两段 findFirst / 并发 P2002 事务外重读兜底；同实例幂等优先重读，不触发） |

复用既有码：`VALIDATION_FAILED`（MasterDataError 400——content 必填校验/入参校验/**转交目标缺/空/空白（SPEC-019）**/**加签 addSignerUserIds 非法——缺/空/超 10 人/单项超 100（SPEC-020）**）、`REFUND_STATE_INVALID`（Step-Up expectedVersion 409）。

### 9.9 运维注意

- **迁移终态 26 总**（SPEC-013 +2 至 23 / SPEC-015 零 / SPEC-016 +2 至 25 / 并行漂移治理 +1 至 26 / SPEC-017 零新增迁移 / **SPEC-018 零新增迁移** / **SPEC-019 零新增迁移** / **SPEC-020 零新增迁移** / **SPEC-021 零新增迁移**）：`20260801100000_approval_center_expand`（DROP approval + 4 表 + 索引 + 2 FK）+ `20260801120000_approval_provision`（3 权限行 + 5 Definition 种子，ON CONFLICT DO NOTHING）+ `20260802100000_approval_multilevel_expand`（ApprovalDefinition +`nodeSchema Json?` / ApprovalInstance +`currentNode Int NOT NULL DEFAULT 0`）+ `20260802110000_approval_multilevel_provision`（CONTRACT_CHANGE nodeSchema 两节点链 UPDATE，approverRule 保留）+ `20260802120000_schema_drift_reconcile`（漂移治理：仅对齐默认值/索引名，零表/列/权限/事件）。模型 57→60（SPEC-016 **60 不变**，+2 列；SPEC-017/018/019/020/021 **60 不变**）；权限 118→121→**122**（SPEC-016 121 不变——MANAGER 角色不增权限码；**SPEC-017 +`approval.manage`**，见 §9.10；SPEC-018/019/020/021 **122 不变**——转交/加签复用 `approval.process`、超时升级零权限变更）；事件 13→15（SPEC-016/017/018/019/020/021 **15 不变**）；approval 域路由 4→6→**9→10→11→13**（含 definitions 目录路由——design 修正补入；SPEC-016 路由不变；**SPEC-017 +3 管理路由** POST /definitions、GET /definitions/manage、PATCH /definitions/:code，全 `approval.manage`；SPEC-018 9 不变；**SPEC-019 +1 转交路由** POST /:id/forward，approval.process，非结构变更；**SPEC-020 +1 加签路由** POST /:id/add-signers，approval.process，非结构变更；**SPEC-021 11 不变**——超时升级零路由变更；**SPEC-025 +2 导入导出路由** GET /definitions/export + POST /definitions/import，全 `approval.manage`，非结构变更）。
- **assert-empty 排除 ApprovalDefinition**（与 Permission/EventSubscription/ContractTemplate 同型——迁移供给目录），否则 fresh bootstrap 报"Application data exists without initialization"。
- **计数同步点**：check-baseline-contract.ts（CANONICAL **60/26**）+ baseline-contract.test.ts + spec-008-event-observability-migration-contract.test.ts + schema-contract.test.ts（model 总数两处）——Task 1/2 已同步。
- **前端**：审批中心页（/approvals → ApprovalCenterPage 多 Tab：APPLIED/TODO/DONE 三 role + **ALL 全部审批（approval.manage 门控，SPEC-023）** + **定义管理（approval.manage 门控，SPEC-017）**）+ api/approval.ts + approval-store；旧 SPEC-001 原型页（pages/Approval/）+ api/organization.ts approval 段 + types/index.ts Approval 接口退休；App.tsx /approvals 路由 → AuthorizedPage approval.read；Layout 菜单「审批管理」沿用。process=taskId/withdraw=instanceId/add-signers=taskId 前端显式区分（待办行取 myPendingTask(record).id）。**SPEC-019 转交 UI**：待办行 PENDING task 操作区 + 详情任务表（仅当前用户 PENDING 行）「转交」按钮（`approval.process` 门控）→ Modal 输入目标人 userId（必填+whitespace 校验）→ `approvalApi.forwardTask(taskId, {forwardToUserId})`（POST /v1/approvals/:id/forward）→ 成功 message.success + 刷新 TODO 列表（`fetchInstances('TODO', 1)`）；提交期间 OK 按钮 `confirmLoading` 防连点。**SPEC-020 加签 UI**：待办行 PENDING task 操作区 + 详情任务表（仅当前用户 PENDING 行）「加签」按钮（`approval.process` 门控，与转交同区）→ Modal 目标 userIds 逗号分隔 Input（required+whitespace 校验，`parseCsv` 拆分去空白 + 空数组拦截）→ `approvalApi.addSigners(taskId, {addSignerUserIds})`（POST /v1/approvals/:id/add-signers）→ 成功 message.success + 刷新 TODO 列表（`fetchInstances('TODO', 1)`）；提交期间 OK 按钮 `confirmLoading` 防连点；详情任务表操作列用 React Fragment 包裹（AntD Space 对 rc-table 单元格测量开销放大，见 SPEC-020 closeout）。
- **业务角色供给（SPEC-015/016，数据供给）**：bootstrap 已种子供给 **5 个 BUSINESS 审批角色**（HR/SEAL_ADMIN/FINANCE/PARTNER + **MANAGER**——SPEC-016 主管，CONTRACT_CHANGE 多级初审用）+ 各授 approval.read/approval.process 两权限（approval.apply 不授）；check-bootstrap-contract 角色契约 **2→7**（2 SYSTEM + 5 BUSINESS，AST 源码级）。**成员指派归运行期**（role-auth-service/user-grant 经角色管理 API），成员为空仍 `APPROVAL_ASSIGNEE_INVALID` 400（§9.1）。
- **测试串行纪律**：承 §8 全量纪律（127.0.0.1:55433、`--test-concurrency=1`、pg_stat_activity 探针、55432 禁触）。

### 9.10 定义管理（approval.manage，SPEC-017）

Definition 由只读（种子 5 类）升级为自服务 CRUD——运营可新增/更新/禁用定义，**权限 121→122**（+`approval.manage`，ACTION/LOW，目录第 122 码）。**零迁移/零模型变更**（复用 ApprovalDefinition 全部既有字段 code/name/businessType/formSchema/approverRule/nodeSchema/version/status；事件 15/订阅不变）。

**管理路由 3 条（全部 `approval.manage`，approval 域 6→9）**：

| 方法 | 路径 | 语义 |
|---|---|---|
| POST | `/api/v1/approvals/definitions` | createDefinition——code 唯一（冲突 `APPROVAL_DEFINITION_CODE_CONFLICT` 400）+ nodeSchema/formSchema/approverRule 三校验（畸形 400）+ version=1/status ACTIVE + 审计 `APPROVAL_DEFINITION_CREATE` |
| GET | `/api/v1/approvals/definitions/manage` | listAllDefinitions——**全量含 DISABLED**（管理页专用），code 升序，无分页 |
| PATCH | `/api/v1/approvals/definitions/:code` | updateDefinition（name/formSchema/approverRule/nodeSchema，version+1，code/businessType/status 不可改）+ **status 双职责**（仅含 status → setDefinitionStatus ACTIVE↔DISABLED，version+1；同体先 update 后 status，status 枚举与 update 字段校验均先于落库） |

**路由顺序**：`GET /definitions/manage` 字面量注册于 `PATCH /definitions/:code` 之前，防 `manage` 被 `:code` 吞并（Egg 精确匹配）。

**语义钉死**：
- **软禁**：DISABLED 定义 `apply` → 既有 `getActiveDefinition`（status:'ACTIVE' 过滤）→ `APPROVAL_DEFINITION_NOT_FOUND` 404（零改动复用）；`manage` 列表仍见 DISABLED 行。**无物理删**（防实例追溯断裂）。
- **code 命名惯例**：`^[A-Z][A-Z0-9_]{0,99}$`（大写字母开头，仅 A-Z/0-9/下划线，总长 1-100）；create 后不可改，businessType 变更应新建定义。
- **版本**：update/status 切换均 version+1；既有实例 `definitionVersion` 快照不变（实例按快照定义继续流转，不追溯）。
- **审计**：create/update/status 落 operation_log（targetType APPROVAL_DEFINITION，action `APPROVAL_DEFINITION_CREATE/UPDATE/STATUS`）。
- **错误码**：新增 `APPROVAL_DEFINITION_CODE_CONFLICT`（400，code 唯一冲突）；复用 `APPROVAL_DEFINITION_NOT_FOUND`（404）、`APPROVAL_ASSIGNEE_INVALID`（400，nodeSchema/approverRule 畸形——**SPEC-018：nodeSchema 节点 mode 若存在且 ∉ {'ANY','ALL'} 亦 400**）、`VALIDATION_FAILED`（400，code 格式/businessType 白名单/formSchema 畸形）。
- **会签定义（SPEC-018）**：运营经新建/编辑 Modal 的 nodeSchema JSON 文本给节点对象加 `"mode": "ALL"` 即建会签节点（缺省 `'ANY'`）；`assertNodeSchemaValid` 在 create/update 时即校验 mode 合法性（畸形 400，create 零写入/update version 不变），畸形配置防静默。既有 5 种子零改动（全部缺省 ANY，行为不变）。

**权限供给（部署提示）**：`approval.manage` 为新增权限码，既有部署的 `permission` 表无此行——需**重跑 `npm run system:bootstrap`**（或 provisioning 迁移 `INSERT ... ON CONFLICT ("code") DO NOTHING`）供给，否则角色授予/前端门控落空 404。**不授** bootstrap 业务角色（管理权限归系统/管理员，非审批角色）；角色授予走角色管理 API（`PUT /api/v1/roles/:id/permissions`）。

**前端**：审批中心页（/approvals → ApprovalCenterPage）第 4 Tab「定义管理」`approval.manage` 门控——无码用户不见 Tab；管理列表（code/name/businessType/status Tag **ACTIVE 蓝 / DISABLED 灰**/version/updatedAt/操作）；新建/编辑共用 Modal（code/businessType 仅新建可改；formSchema/nodeSchema 简化 JSON 文本；编辑展示 version）；禁用/启用 Popconfirm → PATCH status。`api/approval.ts` +createDefinition/listDefinitionsManage/updateDefinition 三方法。

### 9.11 审批超时升级（SPEC-021，ApprovalTimeoutScanner）

适用范围：PENDING task 滞留超时提醒——目标审批人滞留 PENDING task 超过阈值（`APPROVAL_TIMEOUT_HOURS`，默认 **72** 小时，范围 1-8760）且实例仍 PENDING → 为 assignee 生成 **Notification（type `'APPROVAL'`，title「审批超时提醒」）** + 审计。**零结构变更**（复用 Notification/operation_log 既有表，无迁移/模型/权限/事件/路由变更——事件 15 不变，不产 outbox 事件）。实现：`apps/server/app/application/approval/approval-timeout-scanner.ts`。

- **判定（D1）**：`approvalTask.findMany` where `status:'PENDING'` + `createdAt < now - timeoutHours` + 关联 `instance.status:'PENDING'`；`include instance {id,title,applicantId}`；按 `createdAt asc` 取 `batchSize`（默认 100）。
- **升级动作（D2/D3）**：Notification type `'APPROVAL'`、title「审批超时提醒」、content 含实例标题与节点与阈值、relatedId=instanceId、relatedType='APPROVAL_INSTANCE'、routeUrl='/approvals?role=TODO'、deduplicationKey=`approval-timeout:{instanceId}:{taskId}:{YYYY-MM-DD}`（UTC **按天去重**，同日重复 scan 不重复、跨日再提醒）。
- **审计（D4）**：operation_log action `APPROVAL_TIMEOUT_NOTIFIED`（targetType APPROVAL_TASK、targetId=taskId、newValues JSON {taskId,instanceId,assigneeId,timeoutHours}、userId=assigneeId、ip='system'）。
- **幂等（D6）**：findUnique 预查 dedup key 命中跳过 + 并发 P2002 跳过（同一 dedup key 唯一冲突视为已提醒）；重复 scan 同日不重复提醒。
- **batchSize 饥饿修复（Task 2，I×1 必修）**：查询恒定取最旧 batchSize 条时，超时 task > batchSize 则 101+ 永远不进窗口漏提醒——修复加 **NOT IN 已通知 dedup key 谓词**（按当天日期 `approval-timeout:{...}:{YYYY-MM-DD}` 提取已通知 taskId 集排除，查询窗口自然推进；跨日不排除——昨日已通知仍可今日再提醒）。超时 task >100 分批全提醒。
- **节律接线（D5）**：`event-services-factory` 组装时沿 SPEC-009 LeadRecycleScanner 注入点把 `ApprovalTimeoutScanner.scanOnce` 注入事件 worker tick 旁挂 listener——`options.approvalTimeout` 存在时构造 scanner（timeoutHours/dedupPrefix/batchSize），其 scanOnce（绑定后丢弃计数）加入 tickListener（多扫描器各自 try/catch 隔离，单扫描器抛错仅记日志不影响投递循环与其余扫描器）；缺省不注入（条件注入语义）。**三生产调用点（app.ts 启动钩子 / controller/eventOperations.ts / admin-governance/governance-factory.ts）均同源传 `approvalTimeout: config.approvalTimeout`**（Task 2 接线完成，沿 leadRecycle 终审修复轮先例——任一调用点缺省都会与启动钩子签名不一致 fail-fast）；`configurationSignature` 按缺省 {timeoutHours:72} 归一化（显式非默认值与缺省调用混用 fail-fast）。
- **配置（§4）**：`APPROVAL_TIMEOUT_HOURS` env（默认 72，范围 1-8760，`config/env.ts parseApprovalTimeoutEnvironment` → `config.approvalTimeout`）；scanner 构造防御性校验（timeoutHours 1-8760 / batchSize ≥1 / dedupPrefix 非空，Task 2 M 项）。
- **实例并发陈旧通知可接受（Task 2 M 项）**：同实例多 PENDING task 各自独立按 taskId 提醒（不合并实例级），实例并发场景不额外处理。
- **零事件（D10）**：不产 outbox 事件（observability 经 Notification 承载）；审批域事件 15 不变。
- **计数**：SPEC-021 后端测试净增 **+9**（Task 1 scanner 7 + factory 节律 1 + **Task 2 边界用例 1**）——`test/approval/approval-timeout-scanner.test.ts` 9 例全绿 + approval 域既有全绿零回归。

### 9.12 全组织视图（approval.manage，SPEC-023）

适用范围：**approval.manage** 用户纵览**全组织审批实例**——突破 applicantId/assigneeId actor 作用域（运维/合规无需逐人查询）。**零结构变更**（role 枚举扩展 + 动态门控，无 schema/迁移/权限/事件/路由变更——approval.manage 已存在）。实现：`apps/server/app/application/approval/approval-instance-service.ts`（listInstances role='ALL' + getInstance manage 放行）。

- **role='ALL'（D2/D4）**：`listInstances` role 四值（`APPROVAL_ROLE_FILTERS` = APPLIED/TODO/DONE/ALL）——`role='ALL'` → **where 空（无 actor 过滤，仅分页 createdAt DESC id ASC 全量）**；其余三 role 语义不变。
- **动态门控（D3）**：`role='ALL'` → `requireAction(approval.manage)`；其余三 role 仍 `requireAction(approval.read)`——manage 用户**无需 read** 即可全组织视图（同路由按 role 值区分门控）。
- **详情放行（D6）**：`getInstance` 权限扩展——探查实例后按 `isApplicant / isAssignee / hasManagePermission`（try/catch `requireAction(approval.manage)` 探测，AuthorizationService 无 hasAction）三判定；三者全 false → `APPROVAL_INSTANCE_NOT_FOUND` 404 fail-closed（存在性不泄露）；approval.manage 用户可见任意实例详情。
- **动作不扩大（D7）**：process/forward/addSigners/withdraw 门控与 task 探查（`assigneeId=actor` / `applicantId=actor`）**零改动**——approval.manage 不授予处理他人任务权（管理员仅可处理自身 task）。
- **前端**：审批中心页（/approvals → ApprovalCenterPage）「全部审批」Tab（key='ALL'，approval.manage 门控——无码用户不见；与定义管理 Tab 同门控先例）；与既有三 Tab **复用列表/详情/操作**（操作仍 actor 语义——ALL 列表行 `pendingTask` 恒 null，管理员对非自身 task 无操作按钮）；**详情弹窗以列表行数据渲染（M3 兜底：列表行已含 content/tasks 全数据，不额外 getInstance——manage-only 无 read 用户不受详情 403 影响）**。`api/approval.ts` `ApprovalRoleFilter` 四值（APPLIED/TODO/DONE/ALL，本地独立类型镜像后端）。
- **测试**：`test/approval/approval-instance-service.test.ts` **+4**（①role='ALL' 无 manage → 403 PERMISSION_DENIED；②manage-only（无 read）→ 全组织列表含非本人实例+分页 createdAt DESC；③getInstance manage 可见任意实例详情；④有 read 无 manage 非申请人非审批人 → 404 保持）；前端 `ApprovalCenterPage.test.tsx` **+2**（无 manage 隐藏全部审批 Tab + 不发 role=ALL 请求 / manage 可见 Tab + 列表渲染含非本人实例 title + role=ALL 透传 + 详情兜底不 getInstance）。
- **明确 OUT**（scope 边界）：全量筛选/搜索（按申请人/类型/状态）、全组织动作（管理员代处理他人任务）、导出/报表/统计、审批人维度驾驶舱——另行专项（SPEC-023 closeout §9 follow-up）。
- **运维注意**：超时提醒为系统任务入口（无动作权限/数据范围校验，影响面由查询条件 PENDING + 超时 + 实例 PENDING 天然收敛）；审批人收到 APPROVAL 通知即感知滞留（前端待办「审批超时提醒」通知条目），自动升级动作（转交/加签/定稿）与多级升级为范围外 follow-up。

### 9.13 Definition 并发加固（SPEC-024：乐观版本锁 + 组合方法原子性）

适用范围：定义管理（§9.10）的并发正确性补强——`updateDefinition`/`setDefinitionStatus` **乐观版本锁** + 组合方法 `updateDefinitionWithStatus` 单事务 + controller PATCH **三分支**。**零结构变更**（迁移 26/模型 60/权限 124/事件 15/路由 11 全不变——纯服务/控制器逻辑加固）。实现：`apps/server/app/application/approval/approval-definition-service.ts` + `app/controller/approval.ts`。

- **乐观版本锁（沿 SPEC-019 forward updateMany version 守卫先例）**：`updateDefinition`/`setDefinitionStatus` 事务内 `updateMany({code, version: existing.version}, data)`（data 含 `version {increment:1}`）——并发双写时后写 `count=0` → **409 `APPROVAL_STATE_INVALID`**（'approval definition state changed concurrently'）；`count>0` → 事务内 `findUniqueOrThrow` 重读返回 + 审计（`fromVersion: existing.version` 锁前读、`toVersion: row.version`）。审计不落于 count=0（抛 409 前）。
- **组合方法 `updateDefinitionWithStatus(code, input)`**（controller PATCH 同体调用，真原子）：单 `$transaction` 内——白名单（name/formSchema/approverRule/nodeSchema/status/version，至少一项 → 空 input 400）→ **全部校验在事务前**（非法 status/畸形 nodeSchema 零写入即 400）→ update 段（乐观锁 version+1）→ 若 status status 段（基于 update 后 `row.version` 乐观锁 version+1）→ 审计两段合并单条（含 update 字段 → `APPROVAL_DEFINITION_UPDATE` + fromStatus/toStatus 段；仅 status → `APPROVAL_DEFINITION_STATUS`）。version 语义：update+status 各 +1 = **+2**（同 PATCH 同体既有行为）；**任一段进程中断 → 单事务回滚全或无**。
- **controller PATCH 三分支**（`PATCH /approvals/definitions/:code`）：同体（update 字段 + status）→ `updateDefinitionWithStatus` 单事务（原两次独立 service 调用两事务——半应用风险消除）；仅 update 字段 → `updateDefinition`；仅 status → `assertDefinitionStatus` 预检 + `setDefinitionStatus`。
- **可选 version 前置条件（D8 派生，评审 M3 确定性构造）**：PATCH body 可带 `version`（客户端持已知版本，正整数）——同体路径经 `guardVersion = versionPrecondition ?? existing.version` 守卫，与当前不符 → 第一段 count=0 → 409（**确定性并发竞争语义**，测试不经时序竞争即可触发）；仅 update 分支剥除 version（updateDefinition 无该参数，version 对仅 update 冗余）。`UpdateDefinitionWithStatusInput.version?: number`（`normalizeVersion` 正整数校验）。
- **测试**：`test/approval/approval-definition-service.test.ts` **+7**（update/setStatus 并发竞争 409、update 审计 fromVersion 锁前读、组合方法单事务 version+2+合并审计、仅 update/仅 status/空 input 400/无码 403、组合方法并发竞争 409、既有零回归）；`test/app/approval-api.test.ts` **+3**（同体 **stale version → 409 确定性构造**——先 prisma 推进 version 1→2 提交、客户端持旧 version=1 发同体 PATCH → 409 零写入；非法 status → 400 零写入；空体 → 400）。既有同体 PATCH 测试补**合并审计断言**（单条合并 UPDATE = 组合方法单事务确定性信号）。
- **运维注意**：并发更新同一定义会得到 **409**（客户端应重读定义视图后重试——前端「定义管理」编辑 Modal 保存失败提示）；`version` 前置条件为可选增强，旧客户端不传仍按锁前读 fresh 语义（向后兼容）。
- **闸门实证（2026-08-04 清净窗，SPEC-024 收尾）**：后端全量串行 **1860 tests / 1854 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail**——本 SPEC 净增 +10 全绿）；`security:test` **34/34**；check:baseline（**26 迁移/60 model**）+ check:bootstrap（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；迁移实证 `db:reset:test` 重放 **26** → `assert-empty` PASS → `migrate deploy` 重跑幂等（0 待应用）。计数链终态：迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **11** 全不变。

### 9.14 定义导入导出（approval.manage，SPEC-025）

适用范围：Definition **配置迁移/批量初始化**——管理员导出全量审批定义 JSON 快照（含 DISABLED、code 升序），导入批量 upsert（按 code，幂等）。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 全不变；approval 域路由 11→**13**——+2 export/import 非结构变更）。实现：`apps/server/app/application/approval/approval-definition-service.ts`（exportDefinitions/importDefinitions）+ `app/controller/approval.ts`（+2 方法）+ `app/router.ts`（+2 条，字面量先于 `PATCH /definitions/:code`）+ 前端 `api/approval.ts`/`ApprovalCenterPage.tsx`。

- **导出（GET /api/v1/approvals/definitions/export，approval.manage）**：返回**全量含 DISABLED、code 升序**的 ApprovalDefinitionView 数组（每项含 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）——配置迁移的完整快照。导出为**读操作不落审计**（D9）。
- **导入（POST /api/v1/approvals/definitions/import，approval.manage，body `{definitions:[...]}`）**：
  - **上限 100 条**——超限 → 400 `VALIDATION_FAILED`。
  - **单事务全或无**——任一定义校验失败/version 冲突 → 整事务回滚零写入（含审计不落）。
  - **按 code upsert 幂等**：已存在 → update（`version` 可选前置条件：提供且 !== 当前 → 409 `APPROVAL_STATE_INVALID`；缺省沿用当前 version+1）；不存在 → create（version 1/status ACTIVE 或 payload status）。重复导入同 payload 不重复（同 code 第二次走 update）。
  - **逐定义复用 create/update 校验**（code 命名惯例 `^[A-Z][A-Z0-9_]{0,99}$`/formSchema/approverRule/nodeSchema mode）——单条畸形 → 400 整事务回滚。
  - **审计**：`APPROVAL_DEFINITION_IMPORT`（targetType APPROVAL_DEFINITION，targetId 哨兵 `'IMPORT'`，newValues 含 imported/updated/count/summary）。
  - **返回** `{ imported, updated }`（imported=新建条数；updated=更新条数）。
- **I×1 round-trip 修复（Task 3 评审 Important，必做）**：前端导入上传前**剥离视图字段** `id/createdAt/updatedAt`（仅保留 import 白名单 8 键 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）——保证「导出下载 → 原样上传」round-trip 可用（否则后端 `assertExactKeys` 对多余键 400）。导入兼容两种 JSON 形态：导出下载的**裸数组** 或 `{definitions:[...]}` 包络。
- **前端（定义管理 Tab，approval.manage 门控）**：**导出**按钮 → `exportDefinitions()` → Blob + `URL.createObjectURL` + `a.download`（文件名 `approval-definitions-{date}.json`）；**导入**按钮 → 隐藏 file input（`accept=".json"`）→ 读取解析 → 剥离视图字段 → `importDefinitions({definitions})` → 成功 message（imported/updated）+ 刷新列表；失败 `message.error`（业务码）。
- **测试**：服务 +9（export×2 + import×7，Task 1——`approval-definition-service.test.ts` 33/33）；路由 +5（export/import 门禁 + 字面量优先，Task 2——`approval-api.test.ts` 31/31）；前端 +2（导出调用+下载触发 / 导入参数剥离视图字段断言，Task 3——`ApprovalCenterPage.test.tsx` 30/30）。既有零回归。
- **运维注意**：导入为**全或无批量写**——大 payload 前先本地导出核对快照；`version` 前置条件可做并发安全导入（客户端持已知版本，陈旧 → 409 重读重试）；**格式版本/跨版本兼容、增量/选择性导出（按 code/businessType 筛选）、导入时关联角色/权限供给**均为范围外 follow-up（SPEC-025 closeout §9）。
- **闸门实证（2026-08-04 清净窗，SPEC-025 收尾）**：前端四闸门全绿（隔离测试 30/30 + typecheck 0 + lint 0 err + build）；后端全量串行 **1874 tests / 1868 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail**——本 SPEC 净增 +14 全绿）；`security:test` **34/34** 零新增；check:baseline（**26 迁移/60 model**）+ check:bootstrap（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）。计数链终态：迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **13**（+2 export/import）。

**SPEC-029 增强（2026-08-04）**：
- **导出包络**：`GET /definitions/export` 返回 **{schemaVersion: 1, definitions}** 包络（原裸数组已弃）——增量导出可选 `codes`（逗号分隔 ≤100）/`businessType`（枚举）筛选，缺省全量（向后兼容）。前端导出下载保存包络 JSON（round-trip 原样上传）。
- **导入格式版本**：`POST /definitions/import` body 可带 **schemaVersion**（undefined/1 兼容；**!==1 → 400**——未来格式拒绝，无字段转换迁移）。前端导入解析包络保留 schemaVersion + 剥离视图字段，兼容裸数组/旧包络。
- **关联角色供给校验**：导入逐定义收集全部 roleCodes（顶层 approverRule + nodeSchema 节点）→ 校验 role 存在（status ENABLED）；**缺失 → 400 `IMPORTED_ROLE_NOT_FOUND`**（提示先跑 bootstrap 供给 HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER）；**不自动建角色**。运维：导入引用业务角色前确认目标环境已 bootstrap（否则 400）。
- **零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变。测试：definition 37/37（+4）、approval-api 35/35（+2）、前端 33/33（+1）。**闸门**：security 34/34 + check:baseline 26/60 + check:bootstrap 角色 2→7 + docs-leakage exit 0（2026-08-04 实测）；后端全量终态预期 **1886**（1880 + 净增 6，0 真 fail——2 例 SPEC-022 外部漂移照录；全量实测受并行通道 dependency-security 全量碰撞，变更文件清净窗全绿为权威）。

### 9.15 全组织视图筛选/搜索/导出（approval.manage，SPEC-028）

适用范围：全组织审批视图（§9.12 role='ALL'）增强——**筛选**（businessType/status/applicantId）+ **关键词搜索**（title）+ **CSV 导出**。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 不变；approval 域路由 13→**14**——+/approvals/export 字面量先于 :id）。实现：`apps/server/app/application/approval/approval-instance-service.ts`（listInstances where 扩展 + exportInstances）+ `app/controller/approval.ts`（+exportInstances + parseExportQuery）+ `app/router.ts`（+1 条）+ 前端 `api/approval.ts`/`stores/approval-store.ts`/`ApprovalCenterPage.tsx`。

- **筛选/搜索（listInstances，仅 role='ALL' 生效）**：query 扩展 `businessType`（枚举白名单 EXPENSE/CONTRACT_CHANGE/SEAL/LEAVE/TRANSFER）/`status`（INSTANCE_STATUSES PENDING/APPROVED/REJECTED/WITHDRAWN）/`applicantId`（1-100）/`keyword`（title ILIKE contains，1-100）——**AND 组合** + 分页 + createdAt DESC id ASC 不变；**其余 role 传筛选参数 → 400 `VALIDATION_FAILED`**（语义防混用）。非法枚举/长度 → 400。
- **导出（GET /api/v1/approvals/export，approval.manage）**：筛选/搜索参数同 role='ALL' 语义（无 actor 过滤）→ createdAt DESC id ASC → **maxRows 截断**（默认 5000/上限 10000 → 400）→ **RFC 4180 CSV**（UTF-8 BOM + CRLF；含逗号/引号/换行字段双引号包裹 + 内部引号翻倍）——表头 instanceId/businessType/title/status/applicantId/currentNode/createdAt/updatedAt。导出为读操作不落审计。响应为包络 `{code, data: csvString}`（前端 Blob 下载）。
- **前端（全部审批 Tab，approval.manage 门控）**：筛选区（类型/状态 Select + 申请人 ID/关键词 Input + 查询/重置按钮）——查询 → `listInstances(role=ALL + 筛选)`；**导出 CSV** 按钮 → `exportApprovalsCsv(筛选)` → Blob + `URL.createObjectURL` + `a.download`（文件名 `approval-instances-{date}.csv`，type `text/csv;charset=utf-8`）。筛选参数仅 role='ALL' 透传（store fetchInstances 4 参）。
- **测试**：服务 +5（businessType/status 筛选、applicantId/keyword AND、非法枚举/非 ALL 传筛选 400、CSV 转义+maxRows、权限 403——`approval-instance-service.test.ts` 81/81）；路由 +2（导出门禁 + 筛选透传 + 字面量不被 :id 吞并——`approval-api.test.ts` 31→33）；前端 +2（筛选透传+重置 / 导出下载+BOM 字节——`ApprovalCenterPage.test.tsx` 32/32）。既有零回归。
- **运维注意**：导出为全组织 CSV——大库先筛选再导出（maxRows 10000 上限）；筛选/搜索仅全组织视图可用（其余 role 传 → 400）；keyword 为 title ILIKE 模糊匹配（Postgres 大小写不敏感）。
- **闸门实证（2026-08-04 清净窗，SPEC-028 收尾）**：前端四闸门全绿（隔离测试 32/32 + typecheck 0 + lint 0 err + build + 全量 vitest 45 文件 216 tests）；后端全量串行 **1880 tests / 1874 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail**——本 SPEC 净增 +6 全绿）；`security:test` **34/34** 零新增；check:baseline（**26 迁移/60 model**）+ check:bootstrap（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）。计数链终态：迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **14**（+1 export）。

**SPEC-030 统计驾驶舱（2026-08-04）**：
- **统计接口**：`GET /approvals/stats`（approval.manage，字面量先于 :id，approval 域路由 14→**15**）——返回 `{ total, pendingCount, decidedCount, byBusinessType, byStatus, avgDecisionHours }`（筛选/搜索参数同 role='ALL' 语义，复用 SPEC-028 筛选；avgDecisionHours=已决实例 decidedAt-createdAt 小时均值，无已决 → null）。只读不落审计。
- **前端**：「全部审批」Tab 顶部统计卡片（总量/在途/已决/平均决策时效，AntD Statistic）——切 Tab/筛选变化时与列表同筛选刷新。
- **零结构变更**：迁移 26/模型 60/权限 124/事件 15 不变；路由 14→15。测试：instance 83/83（+2）、approval-api 37/37（+2）、前端 34/34（+1）。**闸门**：security 34/34 + check:baseline 26/60 + check:bootstrap 角色 2→7 + docs-leakage exit 0（2026-08-04 实测）；后端全量终态预期 **1890**（1886 + 净增 4，0 真 fail——2 例 SPEC-022 外部漂移照录；全量实测受并行通道 dev-dependency-cleanup 全量碰撞，变更文件清净窗全绿为权威）。

### 9.16 表达式审批人（直属上级 SUPERVISOR，SPEC-041）

适用范围：approverRule 扩展 **`SUPERVISOR`** 规则——按申请人报告线自动路由到直属上级（支持 `levels` 多级上溯）。**零结构变更**（approverRule JSON 配置扩展，迁移/模型/权限/事件/路由全不变）。**编号重定**：原 SPEC-040，外部渠道 exception-review-cli 占用 040（closed）→ 本 **SPEC-041**。

- **规则形态**：`approverRule = { type: 'SUPERVISOR', levels?: number }`（levels 缺省 1=直属上级，2=上级的上级）。`ApproverRule` 联合扩展（USER/ROLE/SUPERVISOR 三型）。
- **解析**（`approval-instance-service.resolveApproverIds` +`resolveSupervisorApprovers`）：applicant userId → `User.employeeId`（无 → 400 `APPROVAL_ASSIGNEE_INVALID`）→ 报告线步行 `levels` 级（`employee_reporting_line` where employeeId=当前 + endedAt null → managerEmployeeId；任一级无 → 400）→ 上级 employee 绑定账号（无 → 400）→ approverIds。`applicantId` 由 apply（actor）/节点推进（instance.applicantId）传入。
- **定义校验**：`assertApproverRuleValid`（definition-service）+SUPERVISOR（levels 可选整数 ≥1）；nodeSchema 节点规则经同一校验。
- **纯函数边界**：`resolveApproverRule`（approval-policy）对 SUPERVISOR 返回空集（需 DB 报告线，纯函数不可解析）——服务层 `resolveSupervisorApprovers` 处理。
- **前端**：定义编辑器审批人类型 +「直属上级」（无需取值 CSV）；`openManageEdit` 回填 SUPERVISOR 时取值留空。
- **运维注意**：SUPERVISOR 依赖申请人「用户→员工绑定」+ 活跃报告线 + 上级账号绑定——三链任一缺失 400；报告线变更实时生效（无缓存）；部门主管/维度表达式（除直属上级外）归 follow-up。

**闸门（2026-08-05，清净窗纪律 §8）**：SUPERVISOR 服务 6/6 + API 3/3 + 前端 ApprovalCenterPage 35/35（+1）+ 全量 vitest + `security:test` 57/57（含外部 SPEC-040 +8）+ `security:audit:all` 双绿 + check:baseline（29/60）+ check:bootstrap + docs-leakage + web build 实测结果以 `spec-041-closeout.md` 为权威（计数链终态：迁移 **29**/模型 60/权限 **132**/事件 15/路由 **28** 不变）。

---

## 10. 案件办理域（SPEC-033）

**2026-09-14变更**：以下为历史实施记录，其中“案件不可删/删除按钮移除”现由用户批准的 [SPEC-CASE-CRUD-20260914](../../../../../docs/superpowers/specs/2026-09-14-case-management-crud.md) 替代：支持完整字段展示、编辑及带`case.delete`权限的删除；已结案/归档、有财务合同或成本关联的案件仍不可删除。删除需版本校验及审计，见[最新验收](../../../../../docs/superpowers/plans/2026-09-14-case-management-crud.md)。

适用范围：业务链「案件办理与交付」核心——**结构性变更**（迁移 26→**27**/模型 60 不变/权限 **129** 含 case 六码/事件 15 不变/路由 15→**22**，案件域新增 8 条路由——设计写「+7」为净计数口径）。新增 **case 权限码六枚**（`case.read`/`case.create`/`case.update`/`case.close`/`case.task.manage`/`case.communication.create`）+ **provisioning 迁移** `20260805100000_case_permission_provision`（6 行 `permission` INSERT `ON CONFLICT ("code") DO NOTHING`，沿审批先例——`role_permission` 永不由迁移触碰）+ **正规服务层**（替代 SPEC-001 遗留原型直连 ctx.prisma）→ controller 薄重构 + 路由门禁 + API 测试。实现：`apps/server/app/application/case/`（case-service / case-task-service / case-communication-service / case-factory / case-types）+ `app/domain/case/case-errors.ts` + `app/controller/case.ts`（薄控制器，移除 destroy——案件业务不可删，归档替代）+ `app/router.ts:224-232`（八条案件路由全 requirePermission）+ `app/middleware/errorHandler.ts`（**CaseError 分支**——SPEC-033 Task 3 补，仿 ApprovalError 先例）+ 前端 `pages/Case/index.tsx` 最小列表/详情（`src/api/business.ts` caseApi 对齐 PagedResult/去 delete/close 白名单）。

- **Case 状态机**（`case-types.ts` CASE_STATUSES）：`PENDING（待受理）→ ACCEPTED（已受理）→ PROCESSING（办理中）→ CLOSED（已结案）→ ARCHIVED（归档）`——create=PENDING；close=`PENDING/ACCEPTED/PROCESSING → CLOSED`（closedAt+result+satisfaction 可填）；**终态 CLOSED/ARCHIVED 动作拒**（update/close/createTask/createCommunication → `CASE_STATE_INVALID` 409）。优先级 `LOW/NORMAL/HIGH/URGENT`。案件为业务资源（可转介绍 `isReferrable`），**仅权限门控（case.* 码）不做行级 scope**。**乐观锁（SPEC-035）**：Case 已 +`version Int @default(1)` 列（迁移 27→**28**）——updateCase **必填 `version`**，`updateMany {id, version, status notIn 终态}` count=0 → 404 CASE_NOT_FOUND（不存在）/ 409 CASE_STATE_INVALID（终态）/ **409 VERSION_CONFLICT**（stale version，消息与成本域对齐）；成功 version+1；close 保持终态守卫不强制 version（设计 D2 仅要求 update 乐观锁）。
- **CaseTask 状态机**：`PENDING → IN_PROGRESS → COMPLETED`（`OVERDUE` 查询时推导不落库）。更新含状态翻转守卫（非法翻转 `PENDING→COMPLETED` 等 → `CASE_TASK_STATE_INVALID` 409）；`COMPLETED` 置 completedAt。nodeType 枚举八值（立案准备/材料收集/立案提交/开庭/文书提交/裁判反馈/执行/结案）。
- **Communication**：`type` 枚举 PHONE/MEETING/WECHAT/EMAIL/OTHER + content 必填（1-2000）+ isKey + createdBy=actor；要求案件存在且非终态。
- **编号规则**：caseNo=makeBusinessNo('CA') 随机码（自增业务号，非用户填写）。
- **审计**：写操作（create/update/close/task/communication）同事务落 `operation_log`（action `CASE_CREATE`/`CASE_UPDATE`/`CASE_CLOSE`/`CASE_TASK_CREATE`/`CASE_TASK_UPDATE`/`CASE_COMMUNICATION_CREATE`，targetType `CASE`/`CASE_TASK`/`CASE_COMMUNICATION`）；读不落。事件零新增（Case 域不产 outbox 事件）。
- **错误码表**（CaseError 按实例 httpStatus 透传——errorHandler CaseError 分支）：`CASE_NOT_FOUND` 404 / `CASE_TASK_NOT_FOUND` 404（findFirst `{id, caseId}` 双参数作用域，跨案件任务 ID → 404）/ `CASE_STATE_INVALID` 409（终态动作/重复结案）/ `CASE_TASK_STATE_INVALID` 409（非法翻转）；校验 `VALIDATION_FAILED` 400（MasterDataError，入参白名单/枚举/存在性探针 customerId/lawyerId/contractId）。
- **权限与路由**（全部经 requirePermission，仿 SPEC-009/010/013 先例）：`GET /cases`+`GET /cases/:id`（case.read）/`POST /cases`（case.create）/`PUT /cases/:id`（case.update）/`POST /cases/:id/close`（case.close）/`POST /cases/:id/tasks`+`PATCH /cases/:id/tasks/:taskId`（case.task.manage）/`POST /cases/:id/communications`（case.communication.create）。无字面量-vs-:id 冲突（子资源均挂 `/:id/` 前缀）；`DELETE /cases/:id` 已随 destroy 根除（API 测试锁 401 路径）。
- **前端（SPEC-033 最小 + SPEC-035 任务/沟通交互 + SPEC-042 文件区）**：列表（关键词/状态筛选 + 分页，读 `PagedResult` `res.data.list/total`）+ 详情抽屉（打开时 `GET /cases/:id` 拉全量 tasks/communications + 文件列表）+ 新建（客户下拉 customerApi/主办律师下拉 employeeApi + title/caseType 必填 + priority/fee/description）+ 结案（result/satisfaction）+ **SPEC-035 任务交互**（详情抽屉「新建任务」Modal：name/nodeType/dueDate/remark；任务行状态翻转按钮——PENDING「开始办理」→IN_PROGRESS「完成」→COMPLETED，`case.task.manage` 门控）+ **沟通交互**（「新增沟通」Modal：type/content/isKey，`case.communication.create` 门控）+ **SPEC-042 文件/证据区**（列表 + base64 上传 + 下载 + 删除，`case.file.read/manage` 门控）。**删除按钮已移除**（后端 destroy 根除）。`useAuthStore.hasPermission` 门控各动作按钮。
- **文件/证据（SPEC-042）**：`CaseFile` 模型（迁移 29→**31**/模型 60→**61**）——base64 上传落盘 `var/storage/case-files/<uuid>`（UUID 文件名防路径穿越，fileName 仅存元数据；大小上限 10MB）+ 权限 +2 `case.file.read`（列表/下载）/ `case.file.manage`（上传/删除）+ 路由 +4（GET/POST `/cases/:id/files`、GET `/files/:id/download`、DELETE `/files/:id`）→ 路由 28→**32**。案件级联删（case 删 → case_file 记录删；磁盘文件由 remove 显式清理）。
- **权限计数核对**：catalog `PERMISSION_CODES` 当前 **134**（含 case 六码 + performance 三码 + case.file 二码）——`permission-catalog.test.ts`/`unittest-database.test.ts` 断言 **134** 与现状一致（计数断言以 catalog 为准）。
- **运维注意**：新增 case 权限码未来若改 catalog 需同步 provisioning 迁移（沿 §8 权限 provisioning 纪律）；CaseError 已入 errorHandler（404/409 原样落地），若再报 500 先核对是否引入新域错误类未加分支；案件列表分页 `pageSize` 上限 100；**文件存储**本地盘 `var/storage/case-files/`（备份需纳入该目录；外部存储 S3/OSS 归 follow-up）。

**闸门（2026-08-05，清净窗纪律 §8）**：case 域测试（`test/case/case-service.test.ts` + `test/app/case-api.test.ts`：权限 403/状态机/审计透传/错误码/参数作用域/乐观锁）+ 前端 Case 页 9/9 + 全量 vitest 47 files 229 + security/check/docs-leakage + web build 实测结果以 `spec-033-closeout.md`（SPEC-033）+ `spec-035-closeout.md`（SPEC-035）为权威（计数链终态：迁移 **28**/模型 60/权限 **129**/事件 15/路由 **22**）。

---

## 11. 绩效模块（SPEC-037）

适用范围：绩效模块正规化——**结构性变更**（迁移 28→**29**/模型 60/权限 129→**132**/事件 15/路由 22→**26**，+4 requirePermission）。替代 SPEC-001 遗留原型（直连 ctx.prisma、无权限门禁/校验/审计/测试）。**编号重定**：原 SPEC-036，外部渠道 audit-exception 占用 036（closed）→ 本专项 **SPEC-037**。实现：`apps/server/app/application/performance/`（performance-service / performance-types / performance-factory）+ `app/domain/performance/performance-errors.ts` + `app/controller/performance.ts`（薄控制器）+ `app/middleware/errorHandler.ts`（PerformanceError 分支）+ `app/router.ts:266-269`（+requirePermission）+ 前端 `pages/Performance/index.tsx` 最小列表/详情/录入/确认。

- **状态机（SPEC-043 扩展）**：create=PENDING；考核流程 `PENDING（待考核）→ SELF_REVIEWED（已自评）→ MANAGER_REVIEWED（已主管评）→ CONFIRMED（已确认，终态）`；confirm 兼容任意非终态 → CONFIRMED（重复确认 409 `PERFORMANCE_STATE_INVALID`）；setGoal 仅 PENDING、selfReview PENDING→SELF_REVIEWED、managerReview SELF_REVIEWED→MANAGER_REVIEWED（非法翻转 409）。
- **唯一约束**：`@@unique([employeeId, period, type])`——重复录入 → 409 `PERFORMANCE_DUPLICATE`（服务层探针先查，非 P2002 500）。
- **校验**：employeeId 存在（Employee）探针；period `^\d{4}-\d{2}$`（如 "2026-04"）；type 枚举 `MONTHLY|QUARTERLY|YEARLY`（**非** ANNUAL/PROJECT——前端遗留漂移已对齐）；kpiData 合法 JSON（≤2000，缺省 '{}'）；score/bonus 非负 Decimal；remark ≤500；考核评分（selfScore/managerScore）整数 0-100。
- **权限**：+4 码 `performance.read`（列表/详情）/ `performance.create`（录入）/ `performance.update`（目标/自评，SPEC-043）/ `performance.confirm`（主管评/确认）——provisioning 迁移 `20260805120000_performance_provision` + `20260805140010_performance_update_provision`；`RESOURCE_CODES` +'performance'。
- **审计**：写操作（create/confirm/set-goal/self-review/manager-review）同事务落 `operation_log`（`PERFORMANCE_CREATE`/`PERFORMANCE_CONFIRM`/`PERFORMANCE_GOAL_SET`/`PERFORMANCE_SELF_REVIEW`/`PERFORMANCE_MANAGER_REVIEW`，targetType `PERFORMANCE`）；读不落。
- **错误码表**（PerformanceError 按实例 httpStatus 透传）：404 `PERFORMANCE_NOT_FOUND` / 409 `PERFORMANCE_STATE_INVALID` / 409 `PERFORMANCE_DUPLICATE`；校验 400 `VALIDATION_FAILED`（MasterDataError）。
- **业务指标 + 自动计分（SPEC-044/045，只读聚合）**：`GET /performances/:id/metrics`（performance.read）——该员工考核周期（period "YYYY-MM" → 月份边界）**案件办结数**（case.count CLOSED + closedAt ∈ 周期 + lawyerId=员工）+ **回款额**（payment.aggregate CONFIRMED + confirmedAt ∈ 周期 + contract.case.lawyerId=员工）+ **自动计分**（`autoScore = clamp(round(办结数×10 + 回款额÷10000), 0, 100)`——每办结 1 案 +10 分、每回款 1 万 +1 分，上限 100）。零结构变更（路由 28→**29**；autoScore 为纯计算字段）。
- **运维注意**：新权限码未来改 catalog 需同步 provisioning 迁移（沿 §8）；PerformanceError 已入 errorHandler；绩效审批联动、绩效与案件/财务**自动计分**（办结数/回款驱动绩效分）、驾驶舱归 follow-up（设计 §6/§7 OUT——考核流程 + 业务指标已建）。

**闸门（2026-08-05，清净窗纪律 §8）**：performance 服务 11/11（原 4 + 考核 4 + 指标 3）+ API 9/9（原 4 + 考核 3 + 指标 2）+ 前端 Performance 页 6/6 + 全量 vitest + `security:test` 57/57 + `security:audit:all` 双绿 + check:baseline（**33/61**）+ check:bootstrap + docs-leakage + web build 实测结果以 `spec-037-closeout.md` + `spec-043-closeout.md` + `spec-044-closeout.md` 为权威（计数链终态：迁移 **33**/模型 61/权限 **135**/事件 15/路由 **29**）。

---

## 12. 客户复购与转介绍（SPEC-039）

适用范围：业务链最后一步「客户复购与转介绍」的转介绍业务流程——客户详情登记转介绍（REFERRAL 线索）+ 客户转介绍线索列表。**零结构变更**（迁移 29/模型 60/权限 132/事件 15 全不变；路由 26→**28** +2）。复购为派生指标（合同数>1），沿用 SPEC-032 分析。**编号重定**：原 SPEC-038，外部渠道 sec-2026-001-retirement 占用 038（closed）→ 本专项 **SPEC-039**。实现：`lead-service.createReferralLead`（委托 createLead 强制 REFERRAL 语义）+ `listReferrals` + `controller/customer.ts` + `app/router.ts`（+2 条 `/api/v1/customers/:id/referrals`）+ 前端客户详情转介绍区。

- **转介绍登记**（`POST /customers/:id/referrals`，`lead.create`）：校验客户存在（404 `CUSTOMER_NOT_FOUND`）+ **强制** `sourceType=REFERRAL` + `referralCustomerId=customerId`（防伪造）→ 委托 createLead（去重信号/幂等/事件/公海记录复用）；返回 `CreateLeadResult` `{ lead, duplicates }`（与 POST /leads 一致）。
- **客户转介绍列表**（`GET /customers/:id/referrals`，`lead.read`）：校验客户存在（404）+ 过滤 `referralCustomerId` + `sourceType REFERRAL` + `deletedAt null` + 分页 `PagedResult<LeadView>`。
- **前端**：客户详情「转介绍」区（`pages/customers/CustomerDetailPage.tsx`）——登记转介绍 Modal（姓名/电话/微信/意向度 1-5）+ 转介绍线索列表（编号/姓名/电话/状态/意向），`lead.create`/`lead.read` 门控；经营分析卡转介绍数（SPEC-032）衔接。
- **错误码**：`CUSTOMER_NOT_FOUND` 404（新码，CrmError）；校验 400 `VALIDATION_FAILED`（MasterDataError）；去重信号复用 lead-policy `findDuplicateSignals`。
- **运维注意**：转介绍登记走 lead 事件（LEAD_CREATED）与公海记录（POST /leads 语义）；转介绍激励/佣金核算归 follow-up（设计 §6 OUT）。

**闸门（2026-08-05，清净窗纪律 §8）**：referral 服务 2/2 + API 4/4 + 前端 CustomerDetailPage 5/5（+3 转介绍用例）+ 全量 vitest + `security:test` 49/49 + `security:audit:all` 双绿 + check:baseline（29/60）+ check:bootstrap + docs-leakage + web build 实测结果以 `spec-039-closeout.md` 为权威（计数链终态：迁移 **29**/模型 60/权限 **132**/事件 15/路由 **28**）。
