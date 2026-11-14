# SPEC-011 财务运营域（FIN-02~05）设计

- 日期：2026-07-31
- 状态：已批准（2026-07-31 用户分节确认，五节全过）
- 需求权威：docs/spec/modules/MOD-006-contract-finance.md §2 FIN-02~05（:35-38）；页面骨架 docs/专项设计/页面与接口清单.md :61-65；对象名录 docs/专项设计/数据库核心表设计草案.md :26
- 承接：SPEC-010 closeout（docs/superpowers/reports/spec-010-closeout.md）§9 路由第一项
- 上游基座：SPEC-010（合同/计划/收款三域服务、编号服务、contract scope 助手、事件/审计纪律）

## 1. 背景与问题

SPEC-010 闭环了谈案→合同→应收→收款确认的正向资金链。经营闭环还缺四块（MOD-006 既定路由）：

- **FIN-02 开票申请**：收款后无开票申请/审核/完成轨迹，税务合规面不可查。
- **FIN-03 退款/减免**：资金逆流无通道。Payment 词位已预留 REFUNDED（schema :963）但无落地机制；FTN-002 词位"已冲销"（VOIDED）同样未落地；refund.approve 权限码已存在于活跃目录（permission-catalog.ts :92，SPECIAL/CRITICAL）但零消费方。
- **FIN-04 成本记录**：渠道/证据收集/办案/人工/办公五类成本无记录面，MOD-012 DASH-24/25 无数据源。
- **FIN-05 异常数据**：已签未收、已收未开票、首签未二签、收款未建案四类经营异常无展示面。

## 2. 目标

1. InvoiceRequest 全生命周期：申请→审核→完成（+拒绝），合同级锚定，额度不变量防超开。
2. RefundRequest 全生命周期：申请→审批→执行（+拒绝），REFUND/WAIVER 双类型一体模型；退款整单、减免计划级。
3. Payment 冲销（VOIDED）直接动作落地，与退款共享回补机制。
4. CostEntry 五类成本记录，类别决定锚点校验矩阵。
5. 四类异常只读端点 + 前端独立页。
6. 全部沿用 SPEC-010 服务模板与闸门组，零新认知成本。

## 3. 非目标

- 通用审批中心（ApprovalDefinition/Instance/nodeSchema）：不存在，退款/减免/开票沿用 SPEC-010 inline 审批端点先例；审批中心 SPEC 落地时迁移为预置类型（审批实例任务与消息回调设计.md :17 已列"退款/减免"）。
- 遗留 `Approval` 原型（schema :1074 + controller/approval.ts + router :206-209，裸 prisma 无权限门）的改造/下线——列已知项路由硬化专项，本 SPEC 不动。
- /finance/payment-plans 页与"调整申请"流（页面清单 :61 无 FIN 编号支撑）→ MOD-006 后续。
- terminate 联动既有计划处置、OVERDUE 扫描/提醒、部分退款、发票抬头/税号管理、电子发票对接。
- MOD-012 dashboard 集成（DASH-21~25 复用本 SPEC anomaly 查询服务，由 dashboard 自己的 SPEC 落地）。

## 4. 模块边界与架构

**方案 A 单域整合（用户批准）**：新建 `app/application/finance/` 应用模块，镜像 `app/application/contract/` 形态：

```
app/
├── domain/finance/
│   ├── finance-types.ts        # 状态词汇常量（INVOICE_STATUS/REFUND_REQUEST_STATUS/COST_CATEGORY 等）
│   ├── finance-policy.ts       # 状态机转移表 + 锚点校验矩阵（纯函数，沿 contract-policy 先例）
│   └── finance-errors.ts       # FinanceError（httpStatus 透传，沿 contract-errors 先例）
├── application/finance/
│   ├── finance-types.ts        # 输入/投影类型（信封联合沿 contract-types 先例）
│   ├── invoice-service.ts      # 开票四环
│   ├── refund-service.ts       # 退款/减免申请审批执行 + 回补核心（本 SPEC 风险最高点）
│   ├── cost-service.ts         # 成本 CRUD + 锚点矩阵
│   ├── anomaly-service.ts      # 四类异常只读查询
│   ├── finance-projection.ts   # 投影（金额 toFixed(2)，沿 contract-projection 先例）
│   └── finance-factory.ts      # 组装（沿 contract-factory 1-28 先例）
├── controller/                 # invoice.ts / refund.ts / cost.ts / anomaly.ts（payment.ts 加 void）
└── router.ts                   # +22 路由，全部 requirePermission
```

服务模板纪律（逐字沿 SPEC-010）：3 参构造 `(prisma, auditActor, authorizationContext)` + 可选 outbox；`requireAction` 首行；EventOutboxWriter 事务内；version 乐观锁（updateMany where {id,version} → VERSION_CONFLICT 409）；404-not-403；审计标识符-only + hasReason 布尔；金额投影 toFixed(2)。

## 5. 数据模型

19 → **21 迁移**（1 结构 + 1 权限供给）、54 → **57 模型**、权限 101 → **118**（17 新码=13 ACTION + 4 MENU；refund.approve 已活跃非新增）。金额一律 `@db.Decimal(18, 2)`（Contract/Payment 同精度），version 默认 1。

### 5.1 InvoiceRequest（新模型）

```prisma
model InvoiceRequest {
  id              String    @id @default(uuid())
  requestNo       String    @unique
  contractId      String
  customerId      String                       // 冗余锚（Payment :958 先例）
  amount          Decimal   @db.Decimal(18, 2)
  reason          String?
  status          String    @default("PENDING") // PENDING|APPROVED|REJECTED|COMPLETED
  approvedBy      String?
  approvedAt      DateTime?
  approvalComment String?                       // 审批意见（沿 Contract :873 命名）
  invoiceNo       String?                       // 完成时登记的发票号
  completedBy     String?
  completedAt     DateTime?
  createdBy       String
  updatedBy       String?
  version         Int       @default(1)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  contract Contract @relation(fields: [contractId], references: [id])
  customer Customer @relation(fields: [customerId], references: [id])

  @@index([contractId])
  @@index([customerId])
  @@index([status])
  @@map("invoice_request")
}
```

**额度不变量**：创建时 `amount ≤ contract.amount − Σ(同合同 status ∈ PENDING/APPROVED/COMPLETED 的 amount)`——在途申请占额度。Contract 行 FOR UPDATE 内校验（并发超开防线），违反 → INVOICE_AMOUNT_EXCEEDED 400；approve 时重验（状态可能已移动）→ 409。amount 必须 > 0。

### 5.2 RefundRequest（新模型，退款/减免一体）

```prisma
model RefundRequest {
  id              String    @id @default(uuid())
  requestNo       String    @unique
  type            String                        // REFUND|WAIVER
  contractId      String
  customerId      String                        // 冗余锚
  paymentId       String?                       // REFUND 必填：目标 CONFIRMED 收款
  planId          String?                       // WAIVER 必填：目标 PENDING/PARTIAL 计划
  amount          Decimal   @db.Decimal(18, 2)
  reason          String                        // 必填
  status          String    @default("PENDING") // PENDING|APPROVED|REJECTED|EXECUTED
  approvedBy      String?
  approvedAt      DateTime?
  approvalComment String?
  executedBy      String?
  executedAt      DateTime?
  createdBy       String
  updatedBy       String?
  version         Int       @default(1)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  contract Contract    @relation(fields: [contractId], references: [id])
  customer Customer    @relation(fields: [customerId], references: [id])
  payment  Payment?    @relation(fields: [paymentId], references: [id])
  plan     PaymentPlan? @relation(fields: [planId], references: [id])

  @@index([contractId])
  @@index([paymentId])
  @@index([planId])
  @@index([status])
  @@map("refund_request")
}
```

**创建校验**：REFUND——paymentId 归属合同须等于 contractId、payment.status=CONFIRMED、`amount = payment.amount`（整单裁决，不等 → REFUND_AMOUNT_MISMATCH 400）、同一 payment 不得有在途（PENDING/APPROVED）REFUND 申请（防双申）；WAIVER——planId 归属合同须等于 contractId、plan.status ∈ (PENDING, PARTIAL)、`0 < amount ≤ plan.amount − plan.receivedAmount`（→ WAIVER_AMOUNT_EXCEEDED 400）。

### 5.3 CostEntry（新模型）

```prisma
model CostEntry {
  id         String    @id @default(uuid())
  category   String                       // CHANNEL|EVIDENCE|CASE_HANDLING|LABOR|OFFICE
  amount     Decimal   @db.Decimal(18, 2)
  occurredAt DateTime
  note       String?
  channelId  String?                      // CATEGORY=CHANNEL 必填，余禁填
  caseId     String?                      // EVIDENCE|CASE_HANDLING 必填，余禁填
  createdBy  String
  updatedBy  String?
  version    Int        @default(1)
  deletedAt  DateTime?                    // 软删（delete 动作落点，审计留痕）
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  channel Channel? @relation(fields: [channelId], references: [id])
  case    Case?    @relation(fields: [caseId], references: [id])

  @@index([category])
  @@index([channelId])
  @@index([caseId])
  @@map("cost_entry")
}
```

**锚点校验矩阵**（创建/更新均强制）：CHANNEL→channelId 必填、caseId 禁填；EVIDENCE/CASE_HANDLING→caseId 必填、channelId 禁填；LABOR/OFFICE→两锚均禁填。违反 → COST_ANCHOR_REQUIRED / COST_ANCHOR_FORBIDDEN 400。amount > 0。

### 5.4 Payment 扩展（既有模型加字段）

```prisma
voidedBy    String?
voidedAt    DateTime?
voidReason  String?
// status 注释扩为 PENDING|CONFIRMED|REFUNDED|VOIDED
```

### 5.5 back-relation 增量

Contract +`invoiceRequests InvoiceRequest[]` +`refundRequests RefundRequest[]`；Customer 同两项；Payment +`refundRequests RefundRequest[]`；PaymentPlan +`refundRequests RefundRequest[]`；Channel +`costEntries CostEntry[]`；Case +`costEntries CostEntry[]`。

## 6. 状态机与数据流

### 6.1 状态机

```
InvoiceRequest:  PENDING →(approve)→ APPROVED →(complete)→ COMPLETED
                 PENDING →(reject)→ REJECTED
RefundRequest:   PENDING →(approve)→ APPROVED →(execute)→ EXECUTED
                 PENDING →(reject)→ REJECTED
Payment(冲销):   CONFIRMED →(void)→ VOIDED        （直接动作，非申请流）
Payment(退款):   CONFIRMED → REFUNDED              （仅经 RefundRequest 执行）
CostEntry:       无状态机（CRUD + 软删）
```

非法流转 → INVOICE_STATE_INVALID / REFUND_STATE_INVALID / PAYMENT_STATE_INVALID 409。转移表入 domain/finance/finance-policy.ts（canTransition 纯函数，沿 contract-policy :82-114 先例）。

### 6.2 资金回补三机制（本 SPEC 风险核心）

三机制共用事务骨架（沿 SPEC-010 confirm 先例）：**Contract 行 FOR UPDATE 先行**（互斥+锁序）→ 状态翻转（count=0 分支处理）→ 计划冲减 → outbox 事务内 → 审计。

**① REFUND execute**：
1. **请求级闸（幂等主闸）**：RefundRequest 翻转 `updateMany where {id, version, status:'APPROVED'} → EXECUTED`；count=0 → 重读：已 EXECUTED → 幂等返回当前投影（双执行安全）；否则 REFUND_STATE_INVALID 409。
2. **收款级翻转**：Payment `updateMany where {id, status:'CONFIRMED'} → REFUNDED`；count=0 → 重读非 CONFIRMED（并发冲销落 VOIDED 等）→ PAYMENT_STATE_INVALID 409 全回滚（请求级翻转同事务回滚）。
3. `contract.receivedAmount −= amount`；下溢守卫（结果 <0 → 409 全回滚）。
4. **反向扫掠**：该合同 receivedAmount>0 的计划按 `dueDate DESC, period DESC` 逐期 `deduct = min(剩余应退, plan.receivedAmount)` 冲减；每期冲减后重推导状态（=0→PENDING；<amount→PARTIAL；=amount→RECEIVED——计划状态词汇沿 receivable-service.ts:280 WritablePlanStatus，永不写 OVERDUE）。
5. 生效前收款（无计划）只冲合同额，自然兼容。

**② VOID（冲销，POST /payments/:id/void，reason 必填）**：翻转 `updateMany where {id, status:'CONFIRMED'} → VOIDED`；count=0 → 重读：已 VOIDED → 幂等返回（沿 confirm 双确认先例）；否则 PAYMENT_STATE_INVALID 409。金额机制与 ① 步骤 3-5 逐字相同——**同一内部函数**（refund-service 内 `sweepBackReceived`，仅事件类型/语义不同：退款=经营退回客户，冲销=纠错视为未发生）。

**③ WAIVER execute**：
1. 合同锁内再取 Plan 行 FOR UPDATE；**执行时重验** `amount ≤ plan.amount − plan.receivedAmount`（审批后 confirm 可能推高 receivedAmount）→ 违反 WAIVER_AMOUNT_EXCEEDED 409。
2. `plan.amount −= amount`；重推导：receivedAmount ≥ 新 amount → RECEIVED（含全额豁免的零元 RECEIVED）；否则维持。
3. `contract.amount` 不动（合同额=签署法律事实；应收合计=Σplans 为经营口径）。

**竞速防线**：双执行 → 状态翻转 count=0 幂等；执行 vs 确认并发 → 合同行锁串行化，败者 EPQ 重评；审批竞速 → request version 乐观锁 VERSION_CONFLICT 409；并发开票超额 → 合同锁 + 额度不变量。

## 7. 错误处理

FinanceError（domain/finance/finance-errors.ts）沿 ContractError 先例，httpStatus 透传，errorHandler.ts 加分支。错误码族：

| 码 | HTTP | 场景 |
|---|---|---|
| INVOICE_AMOUNT_EXCEEDED | 400/409 | 超合同可开额度（创建 400 / 审批重验 409） |
| INVOICE_STATE_INVALID | 409 | 非法流转 |
| REFUND_AMOUNT_MISMATCH | 400 | 退款额 ≠ payment.amount |
| REFUND_STATE_INVALID | 409 | 非法流转 / 重复在途申请 |
| WAIVER_PLAN_STATE_INVALID | 409 | WAIVER 目标 plan 非 PENDING/PARTIAL（执行时重验） |
| PAYMENT_STATE_INVALID | 409 | 冲销/退款执行时目标 payment 非 CONFIRMED（**入 contract-errors.ts**，payment 词汇扩展，void 与 refund-execute 双路径共用一码） |
| WAIVER_AMOUNT_EXCEEDED | 400/409 | 超计划可免额（创建 400 / 执行重验 409） |
| PAYMENT_STATE_INVALID | 409 | 冲销目标非 CONFIRMED |
| COST_ANCHOR_REQUIRED / COST_ANCHOR_FORBIDDEN | 400 | 锚点矩阵违反 |
| VERSION_CONFLICT | 409 | 乐观锁（共享语义） |
| *_NOT_FOUND | 404 | 404-not-403 纪律 |

## 8. 安全

**权限（17 新码 → 118：13 ACTION + 4 MENU）**：

| 码 | 类型/敏感度 | 码 | 类型/敏感度 |
|---|---|---|---|
| invoice.read | ACTION/LOW | cost.read | ACTION/LOW |
| invoice.create | ACTION/MEDIUM | cost.create | ACTION/MEDIUM |
| invoice.approve | ACTION/HIGH | cost.update | ACTION/MEDIUM |
| invoice.complete | ACTION/MEDIUM | cost.delete | ACTION/HIGH |
| refund.read | ACTION/LOW | anomaly.read | ACTION/LOW |
| refund.create | ACTION/MEDIUM | payment.void | ACTION/HIGH |
| refund.execute | ACTION/HIGH | refund.approve | **已活跃** SPECIAL/CRITICAL（:92，本 SPEC 首消费） |

MENU 码 4 个（沿 SPEC-010 menu.contract/menu.payment 先例，path 为前端顶级路由）：menu.invoice '/invoices'、menu.refund '/refunds'、menu.cost '/costs'、menu.anomaly '/anomalies'。前端页面挂顶级路径（App.tsx :121-126 先例 /contracts、/payments），页面清单 /finance/* 表述以前端实际路由为准。

**数据范围（S15 双键教训钉死）**：invoice/refund 读面复用 `buildContractScopeWhere`，resource 形参分别传 `'invoice'`/`'refund'`——**permission-catalog 对应码 resource 字段必须逐字一致**（invoice.*→'invoice'、refund.*→'refund'、refund.approve 已为 'refund' ✓、anomaly.view→'anomaly'），否则 fail-closed 全 404；parity 测试钉死。anomaly 读面同机制传 `'anomaly'`。cost=财务职能数据，**仅权限门控不做行级 scope**（已批准设计决策，同管理面先例）。

**审计**：全写动作落审计，动作码+对象标识+hasReason 布尔，零自由文本（reason/invoiceNo/note 不进载荷）。**事件**（outbox 事务内，dotted 命名沿 event-types.ts :163-169）：`invoice.requested/approved/rejected/completed`、`refund.requested/approved/rejected/executed`、`payment.voided`、`cost.created/updated/deleted`（均 v1 注册 event-registry，无订阅方=设计意图）。**编号**：`nextInvoiceNo`（INV）/`nextRefundNo`（RF）走 `makeBusinessNo` 简例（沿 PP/PY/NE/AE/CA，contract-number-service :75-97）。Step-Up：HIGH/CRITICAL 码处置沿 SPEC-006 既有机制，本 SPEC 不新造。

## 9. 性能

四异常端点均为索引可承查询：#1 走 `@@index([status])`+receivedAmount；#2 合同扫描+发票 groupBy 聚合（合同量级内可接受，分页）；#3/#4 NOT EXISTS 反连接（Case.contractId @unique、合同 @@index([contractType,status]) 支撑）。回补扫掠单合同计划行数级，事务内可忽略。列表端点全部分页（page/pageSize 沿 SPEC-010 形态）。

## 10. 测试策略

- `test/finance/` 新目录（沿 test/contract/ 先例）：四域 API 测试——权限矩阵 401/403/404、状态机非法流转、额度边界（超开/整单不符/超免/锚点矩阵）、scope fail-closed（无授权用户全 404）。
- **竞速测试**（第三方事务 FOR UPDATE 持锁 1s 确定性败者先例）：退款双执行幂等、冲销 vs 确认并发、审批竞速 409、并发开票超额 400。
- **回补正确性**：多计划反向扫掠分布断言、生效前收款退款（无计划只冲合同）、全额豁免零元 RECEIVED、退款后再收款重扫掠、冲销后计划状态回退链。
- **权限供给 parity**：118 逐字段=目录（沿 SPEC-010 形态）；catalog resource 与 scope 调用 parity（S15 钉）。
- **基线契约**：21 迁移/57 模型四处锚点同步（check-baseline-contract.ts:10-11、spec-008 测试 :16、baseline-contract.test.ts 7+1 串+生成器 53→56、schema-contract.test.ts :14/:16/:20）。
- **迁移闸门**：重演 + assert-empty（3 新模型入默认空库清单）+ 重跑。
- 前端 Vitest 沿 SPEC-010 页面测试先例；终态闸门组=后端全量串行/前端四闸门/security:test/docs-leakage/check:baseline/bootstrap。

## 11. 交付与验收门禁

22 路由全部 requirePermission；后端全量 0 fail（SPEC-010 基线 1364 + 新增）；test/finance 全绿；前端四闸门绿；security:test 不新增例外（SEC-2026-002 残留照录）；provisioning 实证 118+2；迁移重演+空库断言+重跑全绿；基线契约 21/57 双计数绿；文档泄漏扫描 exit 0；runbook + closeout 落地。预估 12 任务：①schema+结构迁移 ②权限目录+供给迁移+parity ③finance 领域层 ④编号扩展+事件注册 ⑤invoice 服务 ⑥refund 服务（回补核心）⑦payment void ⑧cost 服务 ⑨anomaly 服务 ⑩controllers+router+errorHandler ⑪前端 ⑫验收收尾。

## 12. 后续 Spec 接口

- anomaly-service 四查询供 MOD-012 dashboard（DASH-21~25）直接复用。
- RefundRequest/InvoiceRequest 状态机与审批元数据字段按审批中心预置类型可迁移形态设计（approvedBy/approvedAt/approvalComment 与 Approval 词位对齐）。
- CostEntry category 词汇即 DASH-24/25 聚合轴。
- 遗留 Approval 原型面处置路由硬化专项。

## 13. 已确认决策摘要

1. **范围**：FIN-02~05 全域一个 SPEC，不混入收尾加固项（用户裁决 2026-07-31）。
2. **退款粒度**：整单退款——REFUND 锚定单笔 CONFIRMED Payment，amount 必须等于该笔全额（用户裁决）。
3. **减免锚点**：计划级——WAIVER 锚定单期 PaymentPlan，plan.amount 冲减，contract.amount 不动（用户裁决）。
4. **开票锚点**：合同级——InvoiceRequest 锚定 Contract，分批可开，在途占额度（用户裁决）。
5. **成本归属**：类别决定锚点——CHANNEL→channelId、EVIDENCE/CASE_HANDLING→caseId、LABOR/OFFICE→无锚（用户裁决）。
6. **异常形态**：/finance/anomalies 独立页（四 Tab）+ 四只读端点，无时间阈值（用户裁决）。
7. **架构**：方案 A 单域整合 app/application/finance/（用户裁决）。
8. **审批形态**：inline 端点（SPEC-010 先例），不接不存在的审批中心；refund.approve 为既有活跃 CRITICAL 码首消费（事实核对修正：非待转正）。
9. **冲销**：直接动作 POST /payments/:id/void（页面清单 :62 既定），payment.void HIGH，reason 必填，与退款共享回补函数。
10. **金额精度 Decimal(18,2)、version 默认 1、dotted 事件命名、makeBusinessNo 编号**——均沿 SPEC-010 先例（事实核对修正：与呈现稿表述差异以此为准）。
11. **前端页面顶级路径挂载**（/invoices、/refunds、/costs、/anomalies）+ 4 个 menu.* 码配套（计划期核对 App.tsx/Layout 先例后修正：页面清单 /finance/* 仅作信息架构参考；权限计数由 13→17 新码、101→**118** 同批修正）。
12. **计划状态词汇 RECEIVED**（非 CONFIRMED——WritablePlanStatus receivable-service.ts:280）；**reject 路由挂 approve 权限码**（router.ts:183 先例）；**更新路由用 PATCH**（router.ts:162 先例）；**读动作码动词 read**（invoice.read/refund.read/cost.read/anomaly.read——contract.read/payment.read 先例，menu 码动词方为 view）。
