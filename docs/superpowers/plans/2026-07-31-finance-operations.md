# SPEC-011 财务运营域（FIN-02~05）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SPEC-010 合同/计划/收款基座上落地 FIN-02 开票申请、FIN-03 退款/减免（含冲销）、FIN-04 成本记录、FIN-05 异常数据，完成律所财务运营闭环。

**Architecture:** 方案 A 单域整合——新建 `app/application/finance/` 应用模块（invoice/refund/cost/anomaly 四服务 + 共享 types/errors/policy/projection/factory），逐字镜像 SPEC-010 `app/application/contract/` 形态；资金回补三机制（退款/冲销/减免）共处一域，冲销落在既有 ReceivableService（Payment 主人家），共享 `sweepBackReceived` 内部函数。

**Tech Stack:** Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（测试容器 55433）/ React 19 + AntD 6 + Zustand / Node test runner（后端）+ Vitest（前端）

**需求与设计权威：** `docs/superpowers/specs/2026-07-31-finance-operations-design.md`（2026-07-31 用户批准，含 §13 决策 12 条）；MOD-006 §2 FIN-02~05。

## Global Constraints

每任务隐含遵守，逐字有效：

1. **禁止一切 git 命令**（commit/push/status/diff 等全部禁止；项目硬约束）。任务完成以"变更文件清单+测试输出"为交付物。
2. **数据库测试必须串行**：`npx tsx --test --test-concurrency=1 --test-force-exit <枚举文件>`（tsx 不接受目录参数）；工作目录 `LayerManage/law-firm-system/apps/server`。
3. **测试环境块**（跑任何后端测试前设置）：
   ```
   NODE_ENV=test
   DATABASE_URL=postgresql://chengye_test:chengye_test_local_only@localhost:55433/chengye_oa_test?schema=public
   DATABASE_URL_TEST=同上
   ALLOW_TEST_DB_RESET=true
   CORS_ALLOWED_ORIGINS=http://localhost:3000
   JWT_SECRET=01234567890123456789012345678901
   APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210
   MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
   ```
4. **55432 生产/预生产容器禁止触碰**；只允许 55433 测试库。重置类操作前用 pg_stat_activity 探针确认无他连接（排除自身）。
5. **服务模板纪律**（逐字沿 SPEC-010 receivable-service.ts）：3 参构造 `(prisma, actor, authorizationContext)` + 可选 outbox；`requireAction` 每公开方法第一行；`assertExactKeys` 输入白名单；事件 EventOutboxWriter 事务内 append；审计 OperationLog 同事务、标识符+hasReason only、零自由文本；404-not-403；金额投影 `formatAmount`（toFixed(2)）；分页 page 默认 1、pageSize 默认 20 上限 100、orderBy createdAt DESC id ASC。
6. **S15 双键教训**：跨资源 scope 调用必须传与 permission-catalog resource 逐字一致的 resource 形参（invoice/refund/anomaly 服务传 `'invoice'`/`'refund'`/`'anomaly'`）。
7. **计划状态词汇** PENDING/PARTIAL/RECEIVED（WritablePlanStatus），**OVERDUE 永不落库**（查询时推导）。
8. **迁移为手写 SQL**（沿 20260730120000 expand 惯式：TEXT id PK 无默认值、TIMESTAMP(3)、DECIMAL(18,2)、独立 CREATE INDEX、FK 默认 RESTRICT）；schema.prisma 与迁移 SQL 必须等价，以"重演+全量测试"为事实对账。
9. **最小影响纪律**：不回填不重测 SPEC-001~010 既有成果；不改 `.env`、不动遗留 Approval 原型面。
10. **错误码归属**：Payment 词汇错误入 contract-errors.ts；Invoice/Refund/Cost 词汇错误入新建 finance-errors.ts；VALIDATION_FAILED/VERSION_CONFLICT 复用 MasterDataError。

---

### Task 1: Schema 三新模型 + Payment 扩展 + 结构迁移

**Files:**
- Modify: `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`（Payment :953-983 加三字段+注释扩词位；Contract :895-902、Customer、Payment、PaymentPlan、Channel :600-601、Case 模型各加 back-relation；文件尾部追加三新模型）
- Create: `LayerManage/law-firm-system/apps/server/prisma/migrations/20260731210000_finance_operations_expand/migration.sql`
- Modify: `LayerManage/law-firm-system/apps/server/scripts/ci/check-baseline-contract.ts:10-11`（54→57、19→20）
- Modify: `LayerManage/law-firm-system/apps/server/test/ci/baseline-contract.test.ts`（7×'expected 19'→'expected 20'、:62 'expected 54'→'expected 57'、:28 生成器 `Array.from({length: 53})`→56）
- Modify: `LayerManage/law-firm-system/apps/server/test/db/spec-008-event-observability-migration-contract.test.ts:16`（19→20）
- Modify: `LayerManage/law-firm-system/apps/server/test/db/schema-contract.test.ts:14/:16/:20`（54→57、19→20 计数）
- Test: 上述四处锚点自身即测试

**Interfaces:**
- Consumes: 既有 Contract/Payment/PaymentPlan/Customer/Channel/Case 模型。
- Produces: Prisma Client 新类型 `InvoiceRequest`/`RefundRequest`/`CostEntry` + Payment 的 `voidedBy/voidedAt/voidReason` 字段；后续所有任务依赖。

- [ ] **Step 1: schema.prisma — Payment 扩展**

在 `model Payment`（:953-983）`confirmedAt` 行后追加三字段，并更新 status 行注释：

```prisma
  confirmedBy   String?
  confirmedAt   DateTime?
  voidedBy      String?
  voidedAt      DateTime?
  voidReason    String?
  remark        String?
```

status 行改为：`status        String    @default("PENDING") // PENDING|CONFIRMED|REFUNDED|VOIDED`

Payment 关系块追加：`refundRequests RefundRequest[]`

- [ ] **Step 2: schema.prisma — back-relation 增量**

- Contract 关系块（:899-902 `paymentPlans/payments/case/analysisEngagement` 区域）追加：
  ```prisma
  invoiceRequests  InvoiceRequest[]
  refundRequests   RefundRequest[]
  ```
- Customer 模型关系块追加同样两行（找到其 `contracts Contract[]` 附近）。
- PaymentPlan 关系块追加：`refundRequests RefundRequest[]`
- Channel 模型关系块（:600-601 `leads/campaigns` 后）追加：`costEntries CostEntry[]`
- Case 模型关系块追加：`costEntries CostEntry[]`

- [ ] **Step 3: schema.prisma — 三新模型（追加到 Payment 模型之后）**

逐字按设计 §5.1/§5.2/§5.3（此处重复全文，实现者不必翻设计）：

```prisma
// ==================== 财务运营模块（SPEC-011 FIN-02~04） ====================

model InvoiceRequest {
  id              String    @id @default(uuid())
  requestNo       String    @unique
  contractId      String
  customerId      String
  amount          Decimal   @db.Decimal(18, 2)
  reason          String?
  status          String    @default("PENDING") // PENDING|APPROVED|REJECTED|COMPLETED
  approvedBy      String?
  approvedAt      DateTime?
  approvalComment String?
  invoiceNo       String?
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

model RefundRequest {
  id              String    @id @default(uuid())
  requestNo       String    @unique
  type            String // REFUND|WAIVER
  contractId      String
  customerId      String
  paymentId       String?
  planId          String?
  amount          Decimal   @db.Decimal(18, 2)
  reason          String
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

  contract Contract     @relation(fields: [contractId], references: [id])
  customer Customer     @relation(fields: [customerId], references: [id])
  payment  Payment?     @relation(fields: [paymentId], references: [id])
  plan     PaymentPlan? @relation(fields: [planId], references: [id])

  @@index([contractId])
  @@index([paymentId])
  @@index([planId])
  @@index([status])
  @@map("refund_request")
}

model CostEntry {
  id         String    @id @default(uuid())
  category   String // CHANNEL|EVIDENCE|CASE_HANDLING|LABOR|OFFICE
  amount     Decimal   @db.Decimal(18, 2)
  occurredAt DateTime
  note       String?
  channelId  String?
  caseId     String?
  createdBy  String
  updatedBy  String?
  version    Int       @default(1)
  deletedAt  DateTime?
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

- [ ] **Step 4: 结构迁移 SQL**

新建 `prisma/migrations/20260731210000_finance_operations_expand/migration.sql`，惯式逐字沿 `20260730120000_negotiation_contract_payment_expand/migration.sql`（TEXT id PK 无默认、TIMESTAMP(3)、DECIMAL(18,2)、独立 CREATE INDEX、ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE RESTRICT ON UPDATE CASCADE）：

```sql
-- SPEC-011 finance operations expand: InvoiceRequest / RefundRequest / CostEntry +
-- Payment void columns. DDL idiom mirrors 20260730120000_negotiation_contract_payment_expand.

-- AlterTable
ALTER TABLE "payment" ADD COLUMN "voidedBy" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT;

-- CreateTable
CREATE TABLE "invoice_request" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalComment" TEXT,
    "invoiceNo" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_request" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "planId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalComment" TEXT,
    "executedBy" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_entry" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "channelId" TEXT,
    "caseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_request_requestNo_key" ON "invoice_request"("requestNo");
CREATE INDEX "invoice_request_contractId_idx" ON "invoice_request"("contractId");
CREATE INDEX "invoice_request_customerId_idx" ON "invoice_request"("customerId");
CREATE INDEX "invoice_request_status_idx" ON "invoice_request"("status");
CREATE UNIQUE INDEX "refund_request_requestNo_key" ON "refund_request"("requestNo");
CREATE INDEX "refund_request_contractId_idx" ON "refund_request"("contractId");
CREATE INDEX "refund_request_paymentId_idx" ON "refund_request"("paymentId");
CREATE INDEX "refund_request_planId_idx" ON "refund_request"("planId");
CREATE INDEX "refund_request_status_idx" ON "refund_request"("status");
CREATE INDEX "cost_entry_category_idx" ON "cost_entry"("category");
CREATE INDEX "cost_entry_channelId_idx" ON "cost_entry"("channelId");
CREATE INDEX "cost_entry_caseId_idx" ON "cost_entry"("caseId");

-- AddForeignKey（FK 命名惯式：<table>_<column>_fkey，RESTRICT 与 expand 迁移先例一致）
ALTER TABLE "invoice_request" ADD CONSTRAINT "invoice_request_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_request" ADD CONSTRAINT "invoice_request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_planId_fkey" FOREIGN KEY ("planId") REFERENCES "payment_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**验证点**：FK 命名/删除策略与 expand 迁移中既有 FK 逐字对比（`grep -A 2 'ADD CONSTRAINT' migrations/20260730120000_*/migration.sql | head -20`），不一致以先例为准修正。

- [ ] **Step 5: 基线锚点同步（19→20、54→57）**

- `scripts/ci/check-baseline-contract.ts:10-11`：EXPECTED_MODEL_COUNT 54→57、EXPECTED_MIGRATION_COUNT 19→20（常量名以文件实际为准）。
- `test/ci/baseline-contract.test.ts`：7 处 `'expected 19'`→`'expected 20'`、:62 `'expected 54'`→`'expected 57'`、:28 `Array.from({ length: 53 })`→`Array.from({ length: 56 })`。
- `test/db/spec-008-event-observability-migration-contract.test.ts:16`：19→20。
- `test/db/schema-contract.test.ts:14/:16/:20`：54→57、19→20（含义以行注释为准）。
- 全仓 grep 兜底：`'expected 19'|'expected 54'|length: 53|, 19,`（test/ 与 scripts/ 范围），除本任务已改与注释性算式外零残留。

- [ ] **Step 6: 生成 Client + 迁移重演验证**

```powershell
cd LayerManage/law-firm-system/apps/server
npm run db:generate
# 测试库重演（先探 pg_stat_activity 无他连接）
npx prisma migrate deploy
npm run check:baseline
```

预期：generate 无错；migrate deploy 应用 1 个新迁移；check:baseline 输出 57/20 双计数 PASS。

- [ ] **Step 7: 空库断言兼容性验证**

```powershell
npm run db:reset:test   # 重置（ALLOW_TEST_DB_RESET=true 已在环境块）
npx tsx scripts/db/assert-empty-application-tables.ts
```

预期 PASS。若脚本对应用表有硬编码枚举而非动态发现，将 invoice_request/refund_request/cost_entry 补入其默认清单（形态沿该文件既有清单），并重跑至 PASS。同时跑 `npx tsx --test --test-concurrency=1 --test-force-exit test/db/empty-application-tables.test.ts test/db/schema-contract.test.ts test/ci/baseline-contract.test.ts` 三件全绿。

- [ ] **Step 8: 回归抽查 + 交付清单**

跑 `npx tsc --noEmit`（0 错）+ `npx eslint app prisma scripts test`（0 错）。报告中列出：变更文件清单（路径+改动摘要）、migrate deploy 输出、check:baseline 输出、空库断言输出、tsc/eslint 结果。

---

### Task 2: 权限目录 +17 码 + 供给迁移 + parity 测试

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`（RESOURCE_CODES :16-45 加 `'invoice'`、`'cost'`、`'anomaly'`——`'refund'` 已在 :40；PERMISSION_CODES 列表 :136-166 尾部追加 17 码）
- Modify: `apps/server/app/domain/authorization/permission-catalog.ts`（payment.confirm :91 之后追加 17 条）
- Create: `apps/server/prisma/migrations/20260731213000_finance_permission_provision/migration.sql`
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（20→21）+ `test/ci/baseline-contract.test.ts`（7×20→21）+ `test/db/spec-008-event-observability-migration-contract.test.ts:16`（20→21）+ `test/db/schema-contract.test.ts`（20→21）
- Create: `apps/server/test/finance/permission-catalog-finance.test.ts`
- Modify: `apps/web/src/features/authorization/types.ts`（PERMISSION_CODES 尾部追加 17 码——`'refund.approve'` 已在 :19 不重复）

**Interfaces:**
- Consumes: Task 1 迁移闸。
- Produces: 17 个权限码（Task 5-10 requireAction/router 消费；Task 11 前端菜单/按钮消费）；`ResourceCode` 新值 `'invoice'|'cost'|'anomaly'`（Task 5/6/9 scope 调用使用）。

**17 新码（类型/resource/action/敏感度逐字段钉死——catalog 与迁移与测试三处一致）：**

| code | name | type | resource | action | riskLevel |
|---|---|---|---|---|---|
| menu.invoice | 开票管理 | MENU | menu | view | LOW（path '/invoices'） |
| menu.refund | 退款减免 | MENU | menu | view | LOW（path '/refunds'） |
| menu.cost | 成本管理 | MENU | menu | view | LOW（path '/costs'） |
| menu.anomaly | 异常数据 | MENU | menu | view | LOW（path '/anomalies'） |
| invoice.read | 查看开票 | ACTION | invoice | read | LOW |
| invoice.create | 创建开票申请 | ACTION | invoice | create | MEDIUM |
| invoice.approve | 审核开票 | ACTION | invoice | approve | HIGH |
| invoice.complete | 完成开票 | ACTION | invoice | complete | MEDIUM |
| refund.read | 查看退款减免 | ACTION | refund | read | LOW |
| refund.create | 创建退款减免申请 | ACTION | refund | create | MEDIUM |
| refund.execute | 执行退款减免 | ACTION | refund | execute | HIGH |
| payment.void | 冲销收款 | ACTION | payment | void | HIGH |
| cost.read | 查看成本 | ACTION | cost | read | LOW |
| cost.create | 记录成本 | ACTION | cost | create | MEDIUM |
| cost.update | 修改成本 | ACTION | cost | update | MEDIUM |
| cost.delete | 删除成本 | ACTION | cost | delete | HIGH |
| anomaly.read | 查看异常数据 | ACTION | anomaly | read | LOW |

refund.approve 已活跃（permission-catalog.ts:92 SPECIAL/CRITICAL），**保持原状不晋升不动**（SPECIAL 类型/CRITICAL 敏感度为既定治理语义，requirePermission 不区分类型——零行为变更）。

- [ ] **Step 1: authorization-types.ts 双列表**

RESOURCE_CODES 在 `'payment',` 与 `'refund',` 之间保持字母序插入 `'invoice',`，在 `'refund',` 后插 `'cost',`、`'anomaly',`（实际顺序按文件既有排序习惯：参照 :36-44 段，invoice 插 negotiation 后/payment 前区域即可——以编译通过+parity 测试为准）。PERMISSION_CODES 尾部（:166 附近 SPEC-010 追加段之后）按上表顺序追加 17 码（4 menu 在前，13 ACTION 在后，与 SPEC-010 追加段形态一致）。

- [ ] **Step 2: permission-catalog.ts 追加 17 条**

在 :91（payment.confirm 行）后追加（`permission()` helper 签名：code/name/type/resource/action/riskLevel[/path]——MENU 码带第 7 参 path，参照 :98 menu.admin_governance）：

```ts
  permission('menu.invoice', '开票管理', 'MENU', 'menu', 'view', 'LOW', '/invoices'),
  permission('menu.refund', '退款减免', 'MENU', 'menu', 'view', 'LOW', '/refunds'),
  permission('menu.cost', '成本管理', 'MENU', 'menu', 'view', 'LOW', '/costs'),
  permission('menu.anomaly', '异常数据', 'MENU', 'menu', 'view', 'LOW', '/anomalies'),
  permission('invoice.read', '查看开票', 'ACTION', 'invoice', 'read', 'LOW'),
  permission('invoice.create', '创建开票申请', 'ACTION', 'invoice', 'create', 'MEDIUM'),
  permission('invoice.approve', '审核开票', 'ACTION', 'invoice', 'approve', 'HIGH'),
  permission('invoice.complete', '完成开票', 'ACTION', 'invoice', 'complete', 'MEDIUM'),
  permission('refund.read', '查看退款减免', 'ACTION', 'refund', 'read', 'LOW'),
  permission('refund.create', '创建退款减免申请', 'ACTION', 'refund', 'create', 'MEDIUM'),
  permission('refund.execute', '执行退款减免', 'ACTION', 'refund', 'execute', 'HIGH'),
  permission('payment.void', '冲销收款', 'ACTION', 'payment', 'void', 'HIGH'),
  permission('cost.read', '查看成本', 'ACTION', 'cost', 'read', 'LOW'),
  permission('cost.create', '记录成本', 'ACTION', 'cost', 'create', 'MEDIUM'),
  permission('cost.update', '修改成本', 'ACTION', 'cost', 'update', 'MEDIUM'),
  permission('cost.delete', '删除成本', 'ACTION', 'cost', 'delete', 'HIGH'),
  permission('anomaly.read', '查看异常数据', 'ACTION', 'anomaly', 'read', 'LOW'),
```

- [ ] **Step 3: 供给迁移 SQL（逐字段=目录）**

新建 `20260731213000_finance_permission_provision/migration.sql`，逐字沿 `20260730150000_contract_permission_provision/migration.sql` 形态：17 行 INSERT（id='permission:<code>'、parentId NULL、path 仅 MENU 码有值、sort 0、status ENABLED、version 1、双 CURRENT_TIMESTAMP）+ `ON CONFLICT ("code") DO NOTHING`；无 UPDATE 段（无晋升码）。

- [ ] **Step 4: 基线锚点 20→21 四处同步**（文件同 Task 1 Step 5 清单，仅迁移计数）

- [ ] **Step 5: parity 测试（新建 test/finance/permission-catalog-finance.test.ts）**

形态沿 `test/contract/permission-catalog-contract.test.ts`（先读该文件照抄骨架），断言：
1. 17 码逐一存在且 type/resource/action/riskLevel/name 逐字段=上表（含 MENU 码 path 字段）；
2. **S15 双键 parity**（本计划最高权重断言）：`invoice.*`→resource==='invoice'、`refund.*`（含既有 refund.approve）→'refund'、`cost.*`→'cost'`、`anomaly.read`→'anomaly'`、`payment.void`→'payment'——与服务层 buildContractScopeWhere 调用 resource 形参（Task 5/6/9）逐字一致；
3. `'refund'` 已存在于 RESOURCE_CODES（Task 2 前即在）；'invoice'/'cost'/'anomaly' 现已存在；
4. refund.approve 条目 type/riskLevel 保持 SPECIAL/CRITICAL 零变更。

- [ ] **Step 6: 前端 types.ts 追加**

`apps/web/src/features/authorization/types.ts` PERMISSION_CODES 尾部按 SPEC-010 注释形态追加（`// SPEC-011 Task 2 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段，仅追加不改动既有行；refund.approve 已于 SPEC-004 预置不重复——合计 +17 码）` + 17 码，顺序同服务端）。

- [ ] **Step 7: 闸门**

`npm run db:generate`（ResourceCode/PermissionCode 类型再生）→ `npx prisma migrate deploy`（供给迁移入）→ `npm run check:baseline`（21/57 PASS）→ 串行跑 `test/finance/permission-catalog-finance.test.ts` + `test/contract/permission-catalog-contract.test.ts` + `test/ci/baseline-contract.test.ts` 全绿 → `npx tsc --noEmit` + `npx eslint app test` 0 错 → 前端 `npx tsc --noEmit`（apps/web）0 错。**供给实证**：`npx tsx scripts/db/` 下 bootstrap 相关校验或直接 SQL `SELECT count(*) FROM permission;` 应得 118。

---

### Task 3: finance 领域层（types / errors / policy）

**Files:**
- Create: `apps/server/app/domain/finance/finance-types.ts`
- Create: `apps/server/app/domain/finance/finance-errors.ts`
- Create: `apps/server/app/domain/finance/finance-policy.ts`
- Modify: `apps/server/app/domain/contract/contract-errors.ts`（+PAYMENT_STATE_INVALID）
- Test: `apps/server/test/finance/finance-policy.test.ts`

**Interfaces:**
- Produces（Task 5-9 消费）：
  - `INVOICE_STATUSES`/`InvoiceStatus`（'PENDING'|'APPROVED'|'REJECTED'|'COMPLETED'）
  - `REFUND_REQUEST_TYPES`/`RefundRequestType`（'REFUND'|'WAIVER'）
  - `REFUND_REQUEST_STATUSES`/`RefundRequestStatus`（'PENDING'|'APPROVED'|'REJECTED'|'EXECUTED'）
  - `COST_CATEGORIES`/`CostCategory`（'CHANNEL'|'EVIDENCE'|'CASE_HANDLING'|'LABOR'|'OFFICE'）
  - `FinanceError` + `FINANCE_ERROR_CODES`（11 码）
  - `canTransitionInvoice(from, action)` / `canTransitionRefundRequest(from, action)`
  - `assertCostAnchorShape(category, channelId, caseId)`（抛 FinanceError）
  - contract-errors 新增 `PAYMENT_STATE_INVALID`（Task 6/7 消费）

- [ ] **Step 1: finance-types.ts（纯词汇常量，仿 event-types.ts :63-72 形态）**

```ts
// SPEC-011 Task 3: finance 域词汇常量（纯领域层，零依赖）。

export const INVOICE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const REFUND_REQUEST_TYPES = ['REFUND', 'WAIVER'] as const;
export type RefundRequestType = (typeof REFUND_REQUEST_TYPES)[number];

export const REFUND_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

export const COST_CATEGORIES = ['CHANNEL', 'EVIDENCE', 'CASE_HANDLING', 'LABOR', 'OFFICE'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
```

- [ ] **Step 2: finance-errors.ts（逐字仿 contract-errors.ts 全件形态）**

```ts
// SPEC-011 Task 3: invoice/refund/cost 域稳定错误码与错误载体。
// 形态逐字仿 domain/contract/contract-errors.ts：个体常量 + 联合类型 + 聚合对象 + Error 子类。
// VALIDATION_FAILED/VERSION_CONFLICT 复用 MasterDataError，不在本文件重复定义。

export const INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND';
export const REFUND_NOT_FOUND = 'REFUND_NOT_FOUND';
export const COST_NOT_FOUND = 'COST_NOT_FOUND';
export const INVOICE_STATE_INVALID = 'INVOICE_STATE_INVALID';
export const REFUND_STATE_INVALID = 'REFUND_STATE_INVALID';
export const WAIVER_PLAN_STATE_INVALID = 'WAIVER_PLAN_STATE_INVALID';
export const INVOICE_AMOUNT_EXCEEDED = 'INVOICE_AMOUNT_EXCEEDED';
export const WAIVER_AMOUNT_EXCEEDED = 'WAIVER_AMOUNT_EXCEEDED';
export const REFUND_AMOUNT_MISMATCH = 'REFUND_AMOUNT_MISMATCH';
export const COST_ANCHOR_REQUIRED = 'COST_ANCHOR_REQUIRED';
export const COST_ANCHOR_FORBIDDEN = 'COST_ANCHOR_FORBIDDEN';

export type FinanceErrorCode =
  | typeof INVOICE_NOT_FOUND
  | typeof REFUND_NOT_FOUND
  | typeof COST_NOT_FOUND
  | typeof INVOICE_STATE_INVALID
  | typeof REFUND_STATE_INVALID
  | typeof WAIVER_PLAN_STATE_INVALID
  | typeof INVOICE_AMOUNT_EXCEEDED
  | typeof WAIVER_AMOUNT_EXCEEDED
  | typeof REFUND_AMOUNT_MISMATCH
  | typeof COST_ANCHOR_REQUIRED
  | typeof COST_ANCHOR_FORBIDDEN;

export const FINANCE_ERROR_CODES = {
  INVOICE_NOT_FOUND,
  REFUND_NOT_FOUND,
  COST_NOT_FOUND,
  INVOICE_STATE_INVALID,
  REFUND_STATE_INVALID,
  WAIVER_PLAN_STATE_INVALID,
  INVOICE_AMOUNT_EXCEEDED,
  WAIVER_AMOUNT_EXCEEDED,
  REFUND_AMOUNT_MISMATCH,
  COST_ANCHOR_REQUIRED,
  COST_ANCHOR_FORBIDDEN,
} as const;

/** 每个稳定码钉死的默认 HTTP 状态码；双态码（EXCEEDED 创建 400/执行 409）由抛出方显式覆盖。 */
export const FINANCE_ERROR_HTTP_STATUS: Readonly<Record<FinanceErrorCode, number>> = {
  [INVOICE_NOT_FOUND]: 404,
  [REFUND_NOT_FOUND]: 404,
  [COST_NOT_FOUND]: 404,
  [INVOICE_STATE_INVALID]: 409,
  [REFUND_STATE_INVALID]: 409,
  [WAIVER_PLAN_STATE_INVALID]: 409,
  [INVOICE_AMOUNT_EXCEEDED]: 400,
  [WAIVER_AMOUNT_EXCEEDED]: 400,
  [REFUND_AMOUNT_MISMATCH]: 400,
  [COST_ANCHOR_REQUIRED]: 400,
  [COST_ANCHOR_FORBIDDEN]: 400,
};

export class FinanceError extends Error {
  constructor(
    public readonly code: FinanceErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}
```

- [ ] **Step 3: contract-errors.ts 追加 PAYMENT_STATE_INVALID**

个体常量 `export const PAYMENT_STATE_INVALID = 'PAYMENT_STATE_INVALID';` + 联合类型成员 + `CONTRACT_ERROR_CODES` 聚合成员 + `CONTRACT_ERROR_HTTP_STATUS[PAYMENT_STATE_INVALID] = 409`。

- [ ] **Step 4: finance-policy.ts（纯函数，仿 contract-policy.ts 全件形态）**

```ts
// SPEC-011 Task 3: finance-policy 领域纯函数。不依赖 Prisma、不依赖 Egg、不连数据库。
// 状态机（设计 §6.1）：
//   InvoiceRequest: approve PENDING→APPROVED；reject PENDING→REJECTED；complete APPROVED→COMPLETED
//   RefundRequest:  approve PENDING→APPROVED；reject PENDING→REJECTED；execute APPROVED→EXECUTED
// 终态防线先于流转表。成本锚点矩阵（设计 §5.3）：CHANNEL→channelId 必填、caseId 禁填；
// EVIDENCE/CASE_HANDLING→caseId 必填、channelId 禁填；LABOR/OFFICE→两锚均禁填。

import {
  COST_CATEGORIES,
  CostCategory,
  InvoiceStatus,
  RefundRequestStatus,
} from './finance-types';
import { COST_ANCHOR_FORBIDDEN, COST_ANCHOR_REQUIRED, FinanceError } from './finance-errors';

export type InvoiceAction = 'approve' | 'reject' | 'complete';
export type RefundRequestAction = 'approve' | 'reject' | 'execute';

const INVOICE_TERMINAL: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['REJECTED', 'COMPLETED']);
const REFUND_TERMINAL: ReadonlySet<RefundRequestStatus> = new Set<RefundRequestStatus>(['REJECTED', 'EXECUTED']);

export function canTransitionInvoice(from: InvoiceStatus, action: InvoiceAction): InvoiceStatus | null {
  if (INVOICE_TERMINAL.has(from)) return null;
  switch (action) {
    case 'approve': return from === 'PENDING' ? 'APPROVED' : null;
    case 'reject': return from === 'PENDING' ? 'REJECTED' : null;
    case 'complete': return from === 'APPROVED' ? 'COMPLETED' : null;
    default: return null;
  }
}

export function canTransitionRefundRequest(
  from: RefundRequestStatus,
  action: RefundRequestAction,
): RefundRequestStatus | null {
  if (REFUND_TERMINAL.has(from)) return null;
  switch (action) {
    case 'approve': return from === 'PENDING' ? 'APPROVED' : null;
    case 'reject': return from === 'PENDING' ? 'REJECTED' : null;
    case 'execute': return from === 'APPROVED' ? 'EXECUTED' : null;
    default: return null;
  }
}

/** 成本锚点矩阵校验：违反抛 FinanceError（REQUIRED/FORBIDDEN 400）。channelId/caseId 传 null 表未提供。 */
export function assertCostAnchorShape(
  category: CostCategory,
  channelId: string | null,
  caseId: string | null,
): void {
  if (!COST_CATEGORIES.includes(category)) {
    throw new FinanceError(COST_ANCHOR_REQUIRED, 400, `unknown cost category ${String(category)}`);
  }
  if (category === 'CHANNEL') {
    if (channelId === null) throw new FinanceError(COST_ANCHOR_REQUIRED, 400, 'CHANNEL cost requires channelId');
    if (caseId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, 'CHANNEL cost forbids caseId');
    return;
  }
  if (category === 'EVIDENCE' || category === 'CASE_HANDLING') {
    if (caseId === null) throw new FinanceError(COST_ANCHOR_REQUIRED, 400, `${category} cost requires caseId`);
    if (channelId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids channelId`);
    return;
  }
  // LABOR / OFFICE：两锚均禁填。
  if (channelId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids channelId`);
  if (caseId !== null) throw new FinanceError(COST_ANCHOR_FORBIDDEN, 400, `${category} cost forbids caseId`);
}
```

- [ ] **Step 5: finance-policy.test.ts（纯函数单测，无 DB）**

覆盖：①两状态机全部合法边（approve/reject/complete/execute 各合法源态→目标态断言）；②全部非法边（终态×3 动作、跨级跳转如 PENDING→complete、APPROVED→approve 重放→null）；③锚点矩阵 5 类别×{双null/双填/正确填/交叉填} 全组合（CHANNEL 缺 channelId→REQUIRED、CHANNEL 带 caseId→FORBIDDEN、LABOR 带任一锚→FORBIDDEN、未知类别→REQUIRED 等）；④错误实例 httpStatus=400。

- [ ] **Step 6: 闸门**

串行跑 `test/finance/finance-policy.test.ts` + `test/contract/contract-policy.test.ts`（contract-errors 改动零回归）全绿；`npx tsc --noEmit`、`npx eslint app/domain test/finance` 0 错。

---

### Task 4: 编号扩展 + 事件注册 + PAYMENT_STATUS 扩词位

**Files:**
- Modify: `apps/server/app/application/contract/contract-number-service.ts`（:97 后追加两 wrapper）
- Modify: `apps/server/app/domain/events/event-types.ts`（PAYMENT_STATUS :71 + 'VOIDED'；:169 后追加 12 事件常量；追加 12 载荷接口）
- Modify: `apps/server/app/domain/events/event-registry.ts`（注册 12 事件 definition）
- Modify: `apps/server/test/contract/contract-number-service.test.ts`（+INV/RF 断言）
- Create: `apps/server/test/finance/finance-events.test.ts`

**Interfaces:**
- Produces（Task 5-8 消费）：
  - `nextInvoiceNo(): string`（INV 前缀）、`nextRefundNo(): string`（RF 前缀）
  - 事件常量 `INVOICE_REQUESTED/APPROVED/REJECTED/COMPLETED`、`REFUND_REQUESTED/APPROVED/REJECTED/EXECUTED`、`PAYMENT_VOIDED`、`COST_CREATED/UPDATED/DELETED`（dotted 值）
  - 载荷接口 `InvoiceRequestedV1`/`InvoiceApprovedV1`/`InvoiceRejectedV1`/`InvoiceCompletedV1`/`RefundRequestedV1`/`RefundApprovedV1`/`RefundRejectedV1`/`RefundExecutedV1`/`PaymentVoidedV1`/`CostCreatedV1`/`CostUpdatedV1`/`CostDeletedV1`
  - `PAYMENT_STATUS` 含 'VOIDED'（投影/测试词汇同步）

**载荷键集（逐字钉死——registry parsePayload 按此 assertExactKeys）：**

| 事件 | 值 | 载荷键 |
|---|---|---|
| invoice.requested | INVOICE_REQUESTED | { invoiceRequestId, requestNo, contractId, customerId, status:'PENDING' }（恰 5 键） |
| invoice.approved | INVOICE_APPROVED | { invoiceRequestId, contractId, status:'APPROVED' }（恰 3 键） |
| invoice.rejected | INVOICE_REJECTED | { invoiceRequestId, contractId, status:'REJECTED' }（恰 3 键） |
| invoice.completed | INVOICE_COMPLETED | { invoiceRequestId, contractId, status:'COMPLETED' }（恰 3 键） |
| refund.requested | REFUND_REQUESTED | { refundRequestId, requestNo, type, contractId, customerId, status:'PENDING' }（恰 6 键） |
| refund.approved | REFUND_APPROVED | { refundRequestId, contractId, status:'APPROVED' }（恰 3 键） |
| refund.rejected | REFUND_REJECTED | { refundRequestId, contractId, status:'REJECTED' }（恰 3 键） |
| refund.executed | REFUND_EXECUTED | { refundRequestId, contractId, paymentId, planId, status:'EXECUTED' }（恰 5 键；paymentId/planId 一实一空） |
| payment.voided | PAYMENT_VOIDED | { paymentId, contractId, status:'VOIDED' }（恰 3 键） |
| cost.created | COST_CREATED | { costEntryId, category, channelId, caseId }（恰 4 键；锚点一空一实或均空） |
| cost.updated | COST_UPDATED | { costEntryId, category }（恰 2 键） |
| cost.deleted | COST_DELETED | { costEntryId, category }（恰 2 键） |

- [ ] **Step 1: contract-number-service.ts 追加**

```ts
/** 开票申请编号（前缀 INV）。 */
export function nextInvoiceNo(now?: Date): string {
  return makeBusinessNo('INV', now);
}

/** 退款/减免申请编号（前缀 RF）。 */
export function nextRefundNo(now?: Date): string {
  return makeBusinessNo('RF', now);
}
```

- [ ] **Step 2: event-types.ts**

- `PAYMENT_STATUS` 改为 `['PENDING', 'CONFIRMED', 'REFUNDED', 'VOIDED'] as const;`
- 常量段（:169 后）追加上表 12 个常量（dotted 值）。
- 载荷接口段追加 12 个接口（形态沿 PaymentCreatedV1/PaymentConfirmedV1；uuid 字段 string、status 字段用对应词汇类型、可空锚点 `string | null`）。

- [ ] **Step 3: event-registry.ts 注册 12 条**

沿 payment.confirmed definition（:495-515）形态逐条注册：status 集合钉死（如 INVOICE_REQUESTED_STATUSES=['PENDING']）、uuid 校验走 requireUuid、string 走 requireString、可空锚点允许 null、extractObjectId 取主键字段。sourceModule（大写词汇，沿 :88-492 既有 'ADMIN_GOVERNANCE'/'CRM'/'CONTRACT' 形态）：invoice.*/refund.*/cost.* 十一事件用 `'FINANCE'`；**payment.voided 用 `'CONTRACT'`**（由 receivable-service.voidPayment 产生，与 payment.created/confirmed 同族同模块）。objectType 分别 'INVOICE_REQUEST'/'REFUND_REQUEST'/'PAYMENT'/'COST_ENTRY'。filterFields 集合沿既有事件同构。

- [ ] **Step 4: 编号测试追加**

`test/contract/contract-number-service.test.ts` 追加：nextInvoiceNo/nextRefundNo 前缀与形态断言（正则沿既有 PP/PY 用例的同构 pattern——`/^INV\d{6}-[A-Z0-9]{6}$/`、`/^RF\d{6}-[A-Z0-9]{6}$/`，以既有用例实际正则为准照抄形态）。

- [ ] **Step 5: finance-events.test.ts（registry 解析测试，沿 contract-events.test.ts 骨架）**

12 事件逐一：合法载荷 parse 通过且 extractObjectId 正确；缺键/多键/错 status/错 uuid 形态→TypeError。payment.voided 额外断言 PAYMENT_STATUS 含 VOIDED。

- [ ] **Step 6: 闸门**

串行跑 `test/finance/finance-events.test.ts` + `test/contract/contract-number-service.test.ts` + `test/contract/contract-events.test.ts` 全绿；`npx tsc --noEmit`、`npx eslint app test` 0 错。

---

### Task 5: invoice-service（FIN-02 核心）

**Files:**
- Create: `apps/server/app/application/finance/finance-types.ts`（DTO + PagedResult re-export）
- Create: `apps/server/app/application/finance/finance-projection.ts`
- Create: `apps/server/app/application/finance/invoice-service.ts`
- Test: `apps/server/test/finance/invoice-service.test.ts`

**Interfaces:**
- Consumes: Task 3 领域层、Task 4 编号/事件、`buildContractScopeWhere`（contract-scope.ts:87，resource 形参传 `'invoice'`）、`formatAmount`（contract-projection.ts）、ReceivableService 服务模板（receivable-service.ts:282-294 构造、:319-325 scope 探查、:632-640 buildScopeWhere 委托、:642-660 envelope）。
- Produces（Task 10/11 消费）：
  - `InvoiceService`：`createInvoice(input)`/`listInvoices(query)`/`getInvoice(id)`/`approveInvoice(id, input)`/`rejectInvoice(id, input)`/`completeInvoice(id, input)`
  - `InvoiceRequestView`（全字段投影，amount toFixed(2)，无 deletedAt——模型本无该列）
  - DTO：`CreateInvoiceInput { contractId, amount, reason?, idempotencyKey? }`、`InvoiceActionInput { comment?, idempotencyKey? }`、`CompleteInvoiceInput { invoiceNo?, idempotencyKey? }`、`ListInvoicesQuery { page?, pageSize?, status?, contractId?, customerId? }`

**业务规则（设计 §5.1/§6.1/§6.2，逐条钉死）：**
- create：requireAction('invoice.create') → 合同探查（invoice.create 动作级 scope + deletedAt null，不可见 CONTRACT_NOT_FOUND 404——复用 ContractError 该码）→ 金额规范化（>0、scale≤2、≤9999999999999999.99，同 normalizePaymentAmount 纪律）→ **额度不变量**：事务内 Contract 行 FOR UPDATE + `aggregate._sum.amount`（同合同 status ∈ PENDING/APPROVED/COMPLETED）+ 新额 ≤ contract.amount，否则 INVOICE_AMOUNT_EXCEEDED 400 → requestNo=nextInvoiceNo() P2002 碰撞重试上限 2（沿 PAYMENT_NO_RETRY_LIMIT 纪律）→ customerId 抄自合同 → invoice.requested（恰 5 键）+ OperationLog INVOICE_CREATE（requestNo/contractId/amount toFixed(2)）。
- approve：requireAction('invoice.approve') → 探查（scope 包裹，INVOICE_NOT_FOUND 404）→ 事务内 Contract 行 FOR UPDATE → **翻转** updateMany {id, version, status:'PENDING'}→APPROVED（approvedBy/At、approvalComment=comment、version+1）；count=0 → 重读：已 APPROVED → 幂等返回现状（零事件零审计）；否则 INVOICE_STATE_INVALID 409 → **审批时额度重验**（同 create 聚合口径，占用含本单）超标 → INVOICE_AMOUNT_EXCEEDED 409 全回滚 → invoice.approved（恰 3 键）+ OperationLog INVOICE_APPROVE（requestNo/contractId/fromStatus/toStatus）。
- reject：同 approve 骨架，目标 REJECTED；幂等重放=已 REJECTED；事件 invoice.rejected + INVOICE_REJECT。
- complete：requireAction('invoice.complete') → 翻转 {id, version, status:'APPROVED'}→COMPLETED（invoiceNo=规范化可空 ≤100、completedBy/At、version+1）；幂等重放=已 COMPLETED；事件 invoice.completed + INVOICE_COMPLETE（含 hasInvoiceNo 布尔，invoiceNo 文本不落审计）。
- list/get：requireAction('invoice.read')；list 过滤 status/contractId/customerId + 分页（形态沿 listPayments :486-518）；get 探查 404。scope 经 { contract: … } 包裹（InvoiceRequest 查询 `where: { AND: [{ contract: scopeWhere }, …] }`，同 Payment :387/:493 包裹形态）。

- [ ] **Step 1: finance-types.ts（应用层 DTO）**

```ts
// SPEC-011 Task 5: finance 模块 DTO（PagedResult 复用 lead-types 同构形态，不重定义）。
import type { InvoiceStatus, RefundRequestStatus, RefundRequestType, CostCategory } from '../../domain/finance/finance-types';

export type { PagedResult } from '../crm/lead-types';

export interface CreateInvoiceInput {
  contractId: string;
  amount: string | number;
  reason?: string;
  idempotencyKey?: string;
}

export interface InvoiceActionInput {
  comment?: string;
  idempotencyKey?: string;
}

export interface CompleteInvoiceInput {
  invoiceNo?: string;
  idempotencyKey?: string;
}

export interface ListInvoicesQuery {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  contractId?: string;
  customerId?: string;
}

export interface CreateRefundRequestInput {
  type: RefundRequestType;
  contractId: string;
  paymentId?: string;
  planId?: string;
  amount: string | number;
  reason: string;
  idempotencyKey?: string;
}

export interface RefundActionInput {
  comment?: string;
  idempotencyKey?: string;
}

export interface ListRefundRequestsQuery {
  page?: number;
  pageSize?: number;
  status?: RefundRequestStatus;
  type?: RefundRequestType;
  contractId?: string;
  customerId?: string;
}

export interface CreateCostEntryInput {
  category: CostCategory;
  amount: string | number;
  occurredAt: string;
  note?: string;
  channelId?: string;
  caseId?: string;
}

export interface UpdateCostEntryInput {
  amount?: string | number;
  occurredAt?: string;
  note?: string;
  version: number;
}

export interface ListCostEntriesQuery {
  page?: number;
  pageSize?: number;
  category?: CostCategory;
  channelId?: string;
  caseId?: string;
}

export interface AnomalyListQuery {
  page?: number;
  pageSize?: number;
}
```

- [ ] **Step 2: finance-projection.ts**

仿 payment-projection.ts 全件：`InvoiceRequestView`/`RefundRequestView`/`CostEntryView` 三视图（全字段、金额 formatAmount、日期保持 Date）+ `projectInvoiceRequest`/`projectRefundRequest`/`projectCostEntry` 三函数。CostEntryView 不含 deletedAt。

- [ ] **Step 3: invoice-service.ts 骨架（构造/buildScopeWhere/envelope 逐段镜像 receivable-service.ts:282-294/:632-660）**

差异仅三处：scope 委托 resource 传 `'invoice'`；envelope objectType `'INVOICE_REQUEST'`；金额规范化复用本地 normalizeInvoiceAmount（照抄 receivable-service normalizePaymentAmount 形态，错误码仍 MasterDataError VALIDATION_FAILED）。

- [ ] **Step 4: createInvoice 实现（规则如上）+ 失败测试先行**

TDD：先写 invoice-service.test.ts create 段（无权限 403→此处服务层直抛 AuthorizationError 形态沿 receivable-service 测试先例；合同不可见 404；金额 0/负数/scale 3 → 400；额度恰满通过/超 0.01 → INVOICE_AMOUNT_EXCEEDED 400；成功件 5 键事件+审计字段断言），跑红后实现至绿。

- [ ] **Step 5: approve/reject/complete 实现 + 测试**

测试矩阵：合法流转各 1；非法流转（approve 已 REJECTED、complete 未 approve、approve 已 COMPLETED）→ INVOICE_STATE_INVALID 409；approve 双调用幂等（第二次零事件零审计——断言事件/审计行数不增）；approve 时另一在途申请推高占用致超额 → INVOICE_AMOUNT_EXCEEDED 409 且状态仍 PENDING（回滚断言）；complete 带/不带 invoiceNo；**竞速**（FOR UPDATE 持锁钉法沿 receivable-service.test.ts:1119-1134）：双 approve 一胜一幂等。

- [ ] **Step 6: list/get + scope fail-closed 测试**

无范围授权用户（仅 invoice.read 动作无 scope 目标）list 返回空、get 404；有 BRANCH 范围用户只见本分支（夹具沿 receivable-service.test.ts 范围夹具形态）。

- [ ] **Step 7: 闸门**

串行跑 `test/finance/invoice-service.test.ts` 全绿 + `test/finance/` 目录全绿 + `npx tsc --noEmit` + `npx eslint app test` 0 错。

---

### Task 6: refund-service（FIN-03 回补核心——本 SPEC 风险最高点）

**Files:**
- Create: `apps/server/app/application/finance/refund-service.ts`
- Modify: `apps/server/app/application/contract/receivable-service.ts`（尾部追加 exported `sweepBackReceived` 函数）
- Test: `apps/server/test/finance/refund-service.test.ts`

**Interfaces:**
- Consumes: 全部前序；scope resource 传 `'refund'`。
- Produces：
  - `RefundService`：`createRefundRequest(input)`/`listRefundRequests(query)`/`getRefundRequest(id)`/`approveRefundRequest(id, input)`/`rejectRefundRequest(id, input)`/`executeRefundRequest(id, input)`
  - `sweepBackReceived(tx, contractId, amount, actorUserId): Promise<void>`（Task 7 void 消费）

**sweepBackReceived（逐字规格——退款/冲销共享唯一实现）：**

```ts
/**
 * 资金回补（退款/冲销共享，SPEC-011 Task 6）：调用方须已持 Contract 行 FOR UPDATE 锁
 * （confirmPayment 互斥依据声明同原则——串行保护下 plain update 读到即最新）。
 * 步骤：合同 receivedAmount 下溢守卫 → 有 receivedAmount 的计划按 dueDate DESC, period DESC
 * 逐期冲减（deduct=min(剩余, plan.receivedAmount)）→ 每期重推导状态
 * （=0→PENDING、<amount→PARTIAL、=amount→RECEIVED；永不写 OVERDUE）→ 合同 receivedAmount −= amount。
 * 无计划行（SIGNED 未生效收款）计划冲减 vacuous，仅合同级冲减。
 */
export async function sweepBackReceived(
  tx: Prisma.TransactionClient,
  contractId: string,
  amount: Prisma.Decimal,
  actorUserId: string,
): Promise<void> {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  const next = contract.receivedAmount.minus(amount);
  if (next.isNegative()) {
    throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID, 409, 'sweep-back exceeds contract receivedAmount');
  }
  let remaining = amount;
  const plans = await tx.paymentPlan.findMany({
    where: { contractId, receivedAmount: { gt: 0 } },
    orderBy: [{ dueDate: 'desc' }, { period: 'desc' }],
  });
  for (const plan of plans) {
    if (remaining.isZero()) break;
    const deduct = Prisma.Decimal.min(remaining, plan.receivedAmount);
    const received = plan.receivedAmount.minus(deduct);
    const status = received.isZero() ? 'PENDING' : (received.lessThan(plan.amount) ? 'PARTIAL' : 'RECEIVED');
    await tx.paymentPlan.update({
      where: { id: plan.id },
      data: { receivedAmount: received, status, version: { increment: 1 } },
    });
    remaining = remaining.minus(deduct);
  }
  await tx.contract.update({
    where: { id: contractId },
    data: { receivedAmount: next, updatedBy: actorUserId, version: { increment: 1 } },
  });
}
```

**createRefundRequest 校验（设计 §5.2）：** requireAction('refund.create') → 合同探查（refund.create scope，CONTRACT_NOT_FOUND 404）→ type 白名单（normalizeAllowedValue）→ reason 必填（normalizeRequiredText 1-500）→ 金额规范化 → 类型分流：
- REFUND：paymentId 必填（缺 → VALIDATION_FAILED 400）→ payment 探查（须存在且 payment.contractId===contractId，否则 VALIDATION_FAILED 400）→ payment.status==='CONFIRMED'（否则 PAYMENT_STATE_INVALID 409——contract-errors 码）→ `amount.equals(payment.amount)`（否则 REFUND_AMOUNT_MISMATCH 400）→ 同 payment 无在途 REFUND 申请（invoiceRequest 无此约束；查 refundRequest where { paymentId, type:'REFUND', status: { in: ['PENDING','APPROVED'] } } 存在 → REFUND_STATE_INVALID 409）。
- WAIVER：planId 必填 → plan 探查（属该合同否则 VALIDATION_FAILED 400）→ plan.status ∈ PENDING/PARTIAL（否则 WAIVER_PLAN_STATE_INVALID 409）→ `0 < amount ≤ plan.amount − plan.receivedAmount`（否则 WAIVER_AMOUNT_EXCEEDED 400）。
→ requestNo=nextRefundNo() P2002 重试上限 2 → customerId 抄自合同 → refund.requested（恰 6 键）+ OperationLog REFUND_CREATE（requestNo/type/contractId/amount/hasReason:true）。

**approve/reject：** 同 Task 5 骨架（requireAction('refund.approve')，翻转 PENDING→目标，幂等重放，REFUND_STATE_INVALID 409，事件+审计 REFUND_APPROVE/REFUND_REJECT）。无额度重验。

**executeRefundRequest（设计 §6.2 步骤钉死）：** requireAction('refund.execute') → 探查（scope 包裹，REFUND_NOT_FOUND 404）→ 事务：
1. Contract 行 FOR UPDATE（首把锁）；
2. **请求级闸**：updateMany {id, version, status:'APPROVED'}→EXECUTED（executedBy/At、version+1）；count=0 → 重读：已 EXECUTED → 幂等返回现状（零事件零审计零回补）；否则 REFUND_STATE_INVALID 409；
3. 类型分流：
   - REFUND：重读 payment → updateMany {id, status:'CONFIRMED'}→REFUNDED（version+1）；count=0 → PAYMENT_STATE_INVALID 409 全回滚 → `sweepBackReceived(tx, contractId, request.amount, actor)`；
   - WAIVER：plan 行重读（tx 内 findUniqueOrThrow）→ 重验 `amount ≤ plan.amount − plan.receivedAmount`（否则 WAIVER_AMOUNT_EXCEEDED 409 全回滚）→ plan.update amount−=amount、状态重推导（receivedAmount ≥ 新 amount → 'RECEIVED'；receivedAmount>0 → 'PARTIAL'；=0 → 'PENDING'）、version+1；
4. refund.executed（恰 5 键，paymentId/planId 一实一空）+ OperationLog REFUND_EXECUTE（requestNo/type/contractId/paymentId 或 planId/fromStatus/toStatus/hasReason:true）。

- [ ] **Step 1: sweepBackReceived 追加 + 单测先行**

测试先行（refund-service.test.ts 内嵌或直接构造 tx 调用）：三期计划（5k/3k/2k 全 RECEIVED）回补 4k → 第三期 2k→PENDING、第二期 3k 冲 2k→PARTIAL(1k)、第一期不动；回补超合同累计 → PAYMENT_STATE_INVALID 409；无计划合同只冲 receivedAmount。跑红后实现至绿。

- [ ] **Step 2: refund-service.ts 骨架 + createRefundRequest**

骨架同 Task 5（resource `'refund'`、objectType 'REFUND_REQUEST'）。测试矩阵：REFUND——payment 不存在/属他合同 400、PENDING 态 payment → PAYMENT_STATE_INVALID 409、amount≠payment.amount → REFUND_AMOUNT_MISMATCH 400、在途重复 → REFUND_STATE_INVALID 409、成功件 6 键事件+审计 hasReason；WAIVER——plan 属他合同 400、plan RECEIVED → WAIVER_PLAN_STATE_INVALID 409、amount>余额 → WAIVER_AMOUNT_EXCEEDED 400、amount=余额恰满通过；reason 缺/空 → 400。

- [ ] **Step 3: approve/reject + 测试**（矩阵同 Task 5 Step 5 减额度重验）

- [ ] **Step 4: executeRefundRequest + 回补正确性测试**

- REFUND 执行：EFFECTIVE 合同三期计划部分收款（造 5k/3k/2k，confirm 8k 使一期 RECEIVED 二期 PARTIAL）→ 执行退款 8k 单笔 → payment REFUNDED、合同 receivedAmount 回 0、计划回 PENDING/PENDING/（未触及）PENDING 断言逐行；
- 生效前收款退款：SIGNED 合同无计划 → 仅合同额冲减；
- 双执行幂等：第二次零事件零审计零再冲（计划/合同行 version 不增）；
- **竞速**：FOR UPDATE 持锁钉法——execute vs confirmPayment 并发（败者按串行后状态走：若 confirm 先胜则退款执行按新 receivedAmount 回补正确）；execute vs voidPayment（Task 7 交付后补跨服务竞速用例于 Task 7 测试文件）；
- WAIVER 执行：PARTIAL 计划减免至 receivedAmount=新 amount → 状态 RECEIVED；全额豁免 PENDING 计划 → amount=0、RECEIVED；执行时 receivedAmount 已被并发 confirm 推高（第三方事务先 confirm 再执行）→ 重验失败 WAIVER_AMOUNT_EXCEEDED 409 全回滚。

- [ ] **Step 5: list/get + scope 测试**（同 Task 5 Step 6 形态）

- [ ] **Step 6: 闸门**

`test/finance/refund-service.test.ts` 全绿 + `test/finance/` 目录全绿 + `test/contract/receivable-service.test.ts`（sweepBack 追加零回归）全绿 + tsc + eslint 0 错。

---

### Task 7: payment 冲销（ReceivableService.voidPayment）

**Files:**
- Modify: `apps/server/app/application/contract/receivable-service.ts`（追加 voidPayment 方法 + VoidPaymentInput 入 contract-types.ts）
- Modify: `apps/server/app/application/contract/contract-types.ts`（+VoidPaymentInput）
- Modify: `apps/server/app/application/contract/payment-projection.ts`（PaymentView + voidedBy/voidedAt/voidReason 三字段投影）
- Test: `apps/server/test/contract/receivable-void.test.ts`

**Interfaces:**
- Consumes: `sweepBackReceived`（Task 6）、PAYMENT_STATE_INVALID（Task 3）、PAYMENT_VOIDED 事件（Task 4）。
- Produces（Task 10/11 消费）：`ReceivableService.voidPayment(id, input): Promise<PaymentView>`；`VoidPaymentInput { reason: string; idempotencyKey?: string }`；PaymentView 增三字段。

**规则（设计 §6.2②）：** requireAction('payment.void') → reason 必填（normalizeRequiredText 1-500）→ payment 探查（payment.void scope 经 contract 包裹 + deletedAt null，PAYMENT_NOT_FOUND 404）→ 事务：Contract 行 FOR UPDATE → 翻转 updateMany {id, version, status:'CONFIRMED'}→VOIDED（voidedBy/voidedAt/voidReason、updatedBy、version+1）；count=0 → 重读：已 VOIDED → 幂等返回现状（零事件零审计零回补）；否则 PAYMENT_STATE_INVALID 409 → `sweepBackReceived(tx, payment.contractId, payment.amount, actor)` → payment.voided（恰 3 键）+ OperationLog PAYMENT_VOID（paymentNo/contractId/fromStatus:'CONFIRMED'/toStatus:'VOIDED'/hasReason:true——reason 文本不落审计）。

- [ ] **Step 1: contract-types.ts + projection 三字段 + voidPayment 实现**

- [ ] **Step 2: receivable-void.test.ts 测试矩阵**

成功冲销（CONFIRMED→VOIDED、计划/合同回补逐行断言、3 键事件+审计 hasReason:true、reason 文本 grep 审计负载零命中）；PENDING payment 冲销 → PAYMENT_STATE_INVALID 409；REFUNDED payment 冲销 → 409；双冲销幂等（第二次零事件零审计零回补）；**竞速**：void vs confirmPayment 并发（FOR UPDATE 持锁钉法：合同锁串行，若 void 先胜 confirm 侧计划回补后 confirm 按新态扫掠——两调用均成功且总额不变式断言：receivedAmount = confirm.amount − void.amount）；void vs executeRefundRequest 同 payment 并发（一胜一 PAYMENT_STATE_INVALID 409）；reason 缺/空 → 400；scope fail-closed 404。

- [ ] **Step 3: 闸门**

`test/contract/receivable-void.test.ts` + `test/contract/` 目录 + `test/finance/` 目录全绿 + tsc + eslint 0 错。

---

### Task 8: cost-service（FIN-04）

**Files:**
- Create: `apps/server/app/application/finance/cost-service.ts`
- Test: `apps/server/test/finance/cost-service.test.ts`

**Interfaces:**
- Consumes: Task 3 锚点矩阵、Task 4 COST_* 事件。
- Produces（Task 10/11 消费）：`CostService`：`createCostEntry(input)`/`listCostEntries(query)`/`getCostEntry(id)`/`updateCostEntry(id, input)`/`deleteCostEntry(id): Promise<{ id: string }>`。

**规则（设计 §5.3/§8）：仅权限门控无行级 scope（已批准决策）；锚点矩阵 assertCostAnchorShape 创建/更新均强制；category/channelId/caseId 创建后不可变（update 白名单仅 amount/occurredAt/note + version 必填乐观锁）。**
- create：requireAction('cost.create') → 金额规范化 → occurredAt parseIsoDate → 锚点矩阵 → channelId 存在性探针（提供时 findFirst，不存在 VALIDATION_FAILED 400；caseId 同）→ cost.created（恰 4 键）+ OperationLog COST_CREATE（costEntryId/category/amount/hasNote 布尔）。
- update：requireAction('cost.update') → 探查（deletedAt null，COST_NOT_FOUND 404）→ version 必填（normalizeNonNegativeInteger）→ updateMany {id, version}（仅提供字段 + version+1）；count=0 → VERSION_CONFLICT 409 → cost.updated（恰 2 键）+ COST_UPDATE 审计。
- delete：requireAction('cost.delete') → 翻转 deletedAt（updateMany {id, deletedAt:null} → deletedAt=now、version+1；count=0 → COST_NOT_FOUND 404）→ cost.deleted（恰 2 键）+ COST_DELETE 审计。软删后 get/list 不可见。
- list/get：requireAction('cost.read')；过滤 category/channelId/caseId + deletedAt null + 分页。

- [ ] **Step 1: cost-service.ts + 测试矩阵**

锚点矩阵全组合（Task 3 单测已覆盖纯函数层，此处经 API 面抽核 5 类各一正一反）；channelId/caseId 伪造存在性 400；update 部分字段/version 缺失 400/VERSION_CONFLICT 409/类别字段注入被拒（assertExactKeys）；delete 软删后 get 404 list 不见、二次 delete 404；无 cost.* 权限 403；事件键集+审计 hasNote 布尔断言。

- [ ] **Step 2: 闸门**

`test/finance/cost-service.test.ts` 全绿 + `test/finance/` 目录全绿 + tsc + eslint 0 错。

---

### Task 9: anomaly-service（FIN-05 四口径）

**Files:**
- Create: `apps/server/app/application/finance/anomaly-service.ts`
- Test: `apps/server/test/finance/anomaly-service.test.ts`

**Interfaces:**
- Consumes: `buildContractScopeWhere`（resource `'anomaly'`）、Contract/Case/InvoiceRequest 模型。
- Produces（Task 10/11 消费）：
  - `AnomalyService`：`listSignedUnpaid(query)`/`listReceivedUninvoiced(query)`/`listFirstSignNoFormal(query)`/`listPaidNoCase(query)`，均返回 `PagedResult<AnomalyContractView>`
  - `AnomalyContractView { contractId, contractNo, contractType, customerId, amount, receivedAmount, status, signDate, effectiveDate, gapAmount: string | null }`（金额 toFixed(2)；gapAmount 仅 received-uninvoiced 口径非空 = receivedAmount − 已开累计）

**四口径（设计 §5 节呈现稿/FTN，查询逐字钉死；全部 anomaly.read + contract scope + deletedAt null + 分页 page 默认 1/pageSize 默认 20 上限 100 + orderBy createdAt DESC id ASC）：**
1. **signed-unpaid**：`{ status: { in: ['SIGNED', 'EFFECTIVE'] }, receivedAmount: 0 }`，gapAmount null。
2. **received-uninvoiced**：`{ receivedAmount: { gt: 0 } }` 且按合同聚合 COMPLETED 发票后 `receivedAmount > invoicedSum`——实现：先 scope 过滤取合同页，再 `invoiceRequest.groupBy({ by: ['contractId'], where: { contractId: { in: pageIds }, status: 'COMPLETED' }, _sum: { amount: true } })`，内存过滤后重组分页（页级过滤可致页内条数 < pageSize——测试断言口径正确性而非页满）；gapAmount = receivedAmount − invoicedSum（toFixed(2)）。
3. **first-sign-no-formal**：`{ contractType: 'FIRST_SIGN', status: { in: ['SIGNED', 'EFFECTIVE'] } }` 且 NOT EXISTS 同 customerId 的 `{ contractType: 'FORMAL', status: { not: 'VOID' }, deletedAt: null }`（用 `{ customer: { contracts: { none: { … } } } }` 关系过滤，deletedAt 过滤入 none 条件）。
4. **paid-no-case**：`{ contractType: 'FORMAL', receivedAmount: { gt: 0 } }` 且 `{ case: null }`（Contract.case 1:1 关系直接过滤）。

- [ ] **Step 1: anomaly-service.ts + 四口径测试**

每口径：命中件（逐字段断言含 gapAmount）、不命中对照件（已收合同/有 FORMAL 客户/已建案合同/VOID FORMAL 不豁免首签判定）、scope fail-closed（无范围授权全空）、分页参数非法 400。

- [ ] **Step 2: 闸门**

`test/finance/anomaly-service.test.ts` 全绿 + `test/finance/` 目录全绿 + tsc + eslint 0 错。

---

### Task 10: controllers + router + errorHandler + API 测试（22 路由）

**Files:**
- Create: `apps/server/app/application/finance/finance-factory.ts`
- Create: `apps/server/app/controller/invoice.ts`、`refund.ts`、`cost.ts`、`anomaly.ts`
- Modify: `apps/server/app/controller/payment.ts`（+void 方法）
- Modify: `apps/server/app/router.ts`（:192 后追加 22 路由）
- Modify: `apps/server/app/middleware/errorHandler.ts`（FinanceError 分支，:48 后仿 ContractError 分支）
- Create: `apps/server/test/app/invoice-api.test.ts`、`refund-api.test.ts`、`cost-api.test.ts`、`anomaly-api.test.ts`
- Modify: `apps/server/test/app/` 既有 payment API 测试文件（+void 路由用例）

**Interfaces:**
- Consumes: Task 5-9 全部服务。
- Produces: 22 条生产路由（Task 11 前端消费）。

**factory（逐字仿 contract-factory.ts 全件）：** `invoiceService(ctx)`/`refundService(ctx)`/`costService(ctx)`/`anomalyService(ctx)` 四组装函数。

**22 路由表（权限码逐字钉死——reject 挂 approve 码沿 router.ts:183 先例）：**

```ts
// 财务运营模块（SPEC-011 Task 10：全部经 requirePermission，仿 SPEC-010 T10 先例）。
router.post('/api/v1/invoices', requirePermission('invoice.create'), controller.invoice.create);
router.get('/api/v1/invoices', requirePermission('invoice.read'), controller.invoice.index);
router.get('/api/v1/invoices/:id', requirePermission('invoice.read'), controller.invoice.show);
router.post('/api/v1/invoices/:id/approve', requirePermission('invoice.approve'), controller.invoice.approve);
router.post('/api/v1/invoices/:id/reject', requirePermission('invoice.approve'), controller.invoice.reject);
router.post('/api/v1/invoices/:id/complete', requirePermission('invoice.complete'), controller.invoice.complete);
router.post('/api/v1/refunds', requirePermission('refund.create'), controller.refund.create);
router.get('/api/v1/refunds', requirePermission('refund.read'), controller.refund.index);
router.get('/api/v1/refunds/:id', requirePermission('refund.read'), controller.refund.show);
router.post('/api/v1/refunds/:id/approve', requirePermission('refund.approve'), controller.refund.approve);
router.post('/api/v1/refunds/:id/reject', requirePermission('refund.approve'), controller.refund.reject);
router.post('/api/v1/refunds/:id/execute', requirePermission('refund.execute'), controller.refund.execute);
router.post('/api/v1/payments/:id/void', requirePermission('payment.void'), controller.payment.void);
router.post('/api/v1/costs', requirePermission('cost.create'), controller.cost.create);
router.get('/api/v1/costs', requirePermission('cost.read'), controller.cost.index);
router.get('/api/v1/costs/:id', requirePermission('cost.read'), controller.cost.show);
router.patch('/api/v1/costs/:id', requirePermission('cost.update'), controller.cost.update);
router.delete('/api/v1/costs/:id', requirePermission('cost.delete'), controller.cost.destroy);
router.get('/api/v1/finance/anomalies/signed-unpaid', requirePermission('anomaly.read'), controller.anomaly.signedUnpaid);
router.get('/api/v1/finance/anomalies/received-uninvoiced', requirePermission('anomaly.read'), controller.anomaly.receivedUninvoiced);
router.get('/api/v1/finance/anomalies/first-sign-no-formal', requirePermission('anomaly.read'), controller.anomaly.firstSignNoFormal);
router.get('/api/v1/finance/anomalies/paid-no-case', requirePermission('anomaly.read'), controller.anomaly.paidNoCase);
```

**Controller 形态**（逐字仿 controller/payment.ts 全件）：CREATE_BODY_KEYS/ACTION_BODY_KEYS 白名单 + assertExactKeys、parseQueryInteger 纪律、respond 包络 { code:200, message:'success', data }；delete 方法名 destroy 沿 case controller 先例（router.ts:199）。各 body 白名单：
- invoice create：['contractId','amount','reason','idempotencyKey']；approve/reject：['comment','idempotencyKey']；complete：['invoiceNo','idempotencyKey']
- refund create：['type','contractId','paymentId','planId','amount','reason','idempotencyKey']；approve/reject/execute：['comment','idempotencyKey']（execute 无 comment 也走同白名单——comment 可选）
- payment void：['reason','idempotencyKey']
- cost create：['category','amount','occurredAt','note','channelId','caseId']；update：['amount','occurredAt','note','version']
- anomaly list query：['page','pageSize']

- [ ] **Step 1: factory + 4 controller + payment.void + errorHandler 分支 + 22 路由**

- [ ] **Step 2: API 测试（4 新件 + payment void 追加）**

形态沿既有 test/app/ contract-api.test.ts（认证夹具/权限授予助手照抄）。每文件覆盖：无 token 401、无权限 403、越权/不存在 404、body 未知键 400、分页参数非法 400、create→approve→（complete/execute）端到端绿路径一件、reject 绿路径一件；anomaly 四端点各一命中一空集；payment void 端到端（confirm→void→list 状态断言）+ 无 payment.void 权限 403。

- [ ] **Step 3: 闸门**

5 测试文件全绿 + `test/finance/` + `test/contract/` 目录全绿 + tsc + eslint 0 错。

---

### Task 11: 前端（4 新页 + 冲销动作 + 菜单/路由/权限码）

**Files:**
- Create: `apps/web/src/api/invoice.ts`、`refund.ts`、`cost.ts`、`anomaly.ts`
- Modify: `apps/web/src/api/payment.ts`（PAYMENT_STATUSES + 'VOIDED'；PaymentView + 三字段；paymentApi + void）
- Create: `apps/web/src/stores/invoice-store.ts`、`refund-store.ts`、`cost-store.ts`、`anomaly-store.ts`
- Create: `apps/web/src/pages/invoices/InvoiceListPage.tsx`、`refunds/RefundListPage.tsx`、`costs/CostListPage.tsx`、`anomalies/AnomalyListPage.tsx`
- Modify: `apps/web/src/pages/payments/PaymentListPage.tsx`（+冲销动作）
- Modify: `apps/web/src/App.tsx`（+4 路由）
- Modify: `apps/web/src/components/Layout/index.tsx`（+4 菜单项 + 面包屑名）
- Modify: `apps/web/src/features/authorization/types.ts`（Task 2 已加码，本任务零改动——若 Task 2 未含则由本任务补）
- Test: 4 页面测试文件（位置/形态沿 SPEC-010 既有页面测试先例——先找 `apps/web/src/pages/payments` 邻近测试件照抄骨架）

**页面规格（AntD 6 + payment-store 模式沿 payment-store.ts 全件）：**
- **InvoiceListPage**：列表（requestNo/合同号/客户/金额/状态/创建时间）+ 状态筛选 + 分页 + 新建弹窗（合同选择器沿 PaymentListPage 登记弹窗的合同选择件、金额、事由）+ 行操作按状态出按钮（PENDING→审核通过/拒绝，APPROVED→完成弹窗录发票号——按钮权限 invoice.approve/invoice.complete 控制，沿既有权限按钮形态）。
- **RefundListPage**：列表 + type 筛选 + 新建弹窗（类型 Radio 切换：REFUND→收款单选择器（仅 CONFIRMED，选定后金额只读回填）；WAIVER→先选合同再选计划（仅 PENDING/PARTIAL，金额上限=余额前端提示）+ reason 必填）+ 行操作（PENDING→审批通过/拒绝；APPROVED→执行——refund.approve 按钮带 Step-Up 语义沿既有 HIGH/CRITICAL 按钮形态，执行 refund.execute）。
- **CostListPage**：列表（类别/金额/发生日期/锚点展示）+ 类别筛选 + 新建/编辑弹窗（类别 Select 驱动锚点控件：CHANNEL→渠道下拉必填；EVIDENCE/CASE_HANDLING→案件下拉必填；LABOR/OFFICE→无锚点控件）+ 删除二次确认（cost.delete 权限）。
- **AnomalyListPage**：四 Tab（已签未收/已收未开票/首签未二签/收款未建案）各一列表（合同号/客户/金额/已收/签署日/缺口额）+ 行点击跳 `/contracts/:id`。
- **PaymentListPage 冲销**：CONFIRMED 行出"冲销"按钮（payment.void 权限）→ Modal reason 必填 → 成功后就地更新行（沿 confirmPayment :88-98 形态）。

- [ ] **Step 1: api 四件 + payment.ts 扩展**（逐字仿 api/payment.ts 全件形态；anomaly.ts 四端点函数）
- [ ] **Step 2: store 四件**（逐字仿 payment-store.ts：list/fetch/applyFilters/create/动作方法/reset）
- [ ] **Step 3: 四页面 + PaymentListPage 冲销 + App.tsx 路由 + Layout 菜单**
  - App.tsx 追加（沿 :121-126 形态）：
    ```tsx
    <Route path="/invoices" element={<AuthorizedPage permission="menu.invoice"><InvoiceListPage /></AuthorizedPage>} />
    <Route path="/refunds" element={<AuthorizedPage permission="menu.refund"><RefundListPage /></AuthorizedPage>} />
    <Route path="/costs" element={<AuthorizedPage permission="menu.cost"><CostListPage /></AuthorizedPage>} />
    <Route path="/anomalies" element={<AuthorizedPage permission="menu.anomaly"><AnomalyListPage /></AuthorizedPage>} />
    ```
  - Layout 菜单组（沿 :66-73 形态）：开票管理 '/invoices' menu.invoice、退款减免 '/refunds' menu.refund、成本管理 '/costs' menu.cost、异常数据 '/anomalies' menu.anomaly；面包屑名映射（:136 形态）同步 4 行。
- [ ] **Step 4: 页面测试 4 件**（渲染/筛选/弹窗提交/权限按钮隐现/冲销弹窗 reason 必填——沿既有页面测试骨架）
- [ ] **Step 5: 前端四闸门**

`npm --prefix apps/web run test` 全绿 + `npm --prefix apps/web run lint` 0 错 + `npm --prefix apps/web run typecheck` 0 错 + `npm --prefix apps/web run build` 成功。

---

### Task 12: 验收与收尾（全闸门 + runbook + closeout）

**Files:**
- Create: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-011-closeout.md`

- [ ] **Step 1: 后端全量串行**（EGG_TYPESCRIPT=true + 环境块；先探 pg_stat_activity）：全部 test/ 枚举文件，预期 SPEC-010 基线 1364 + 本 SPEC 新增全绿 0 fail（spec-008 保留 3 例 port-guard 照录）。
- [ ] **Step 2: 目录级复跑**：test/finance/ + test/contract/ + test/app/ 计数对账。
- [ ] **Step 3: 前端四闸门**（test/lint/typecheck/build）。
- [ ] **Step 4: 安全闸门**：`npm run security:test`（34 基线 + 不新增例外；SEC-2026-002 两高位照录）+ docs-leakage 扫描 exit 0。
- [ ] **Step 5: 迁移闸门**：reset → assert-empty → test/finance 全绿 → 重演幂等（migrate deploy 二次跑零迁移）。
- [ ] **Step 6: 供给实证**：permission=118 逐字段=目录（bootstrap 校验件）；invoice/refund/cost/anomaly scope 双键 parity 测试在列。
- [ ] **Step 7: check:baseline + check:bootstrap 双 PASS**（21/57 终态）。
- [ ] **Step 8: runbook 八节**（沿 negotiation-contract-payment.md 形态：状态机表/回补机制/错误码表/权限矩阵/编号规则/双纪律/闸门命令/已知边界）。
- [ ] **Step 9: closeout 十一节**（沿 spec-010-closeout.md 形态：计数链/裁决录/已知非阻断项/follow-up 路由——遗留 Approval 原型面、审批中心迁移、MOD-012 DASH 复用、terminate-计划联动、/finance/payment-plans 页）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §5 三模型→Task 1；§5.4 Payment 扩展→Task 1/7；§6.1 状态机→Task 3/5/6；§6.2 三机制→Task 6/7；§7 错误码→Task 3/10；§8 权限/范围/事件/审计/编号→Task 2/4/5-10；§9 性能→Task 9 索引依托；§10 测试策略→各任务测试矩阵+Task 12；§11 门禁→Task 12。零缺口。
- **占位符扫描**：无 TBD/TODO；全部代码块为可直接转写形态。
- **类型一致性**：服务签名（Task 5/6/8/9 Produces）与 Task 10 controller 调用、Task 11 api 客户端逐名一致；事件常量/载荷键集 Task 4 定义=Task 5-8 消费=registry 断言；权限码 Task 2 表=Task 10 路由表=Task 11 菜单/按钮。
