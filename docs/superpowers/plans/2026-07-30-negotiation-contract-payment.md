# 谈案与合同收款（SPEC-010）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **需求来源（spec 层，CONVENTIONS §6 纪律）**：`docs/spec/modules/MOD-006-contract-finance.md`（CON-01~07 + FIN-01）+ `docs/spec/modules/MOD-004-lead-crm.md`（CRM-07 谈案管理）。横切契约：`docs/spec/foundations/FTN-001-data-model.md`、`FTN-002-state-machine-dictionary.md`、`FTN-003-rbac-data-scope.md`、`FTN-004-api-transaction-consistency.md`、`FTN-005-event-driven-model.md`。设计文档：`docs/superpowers/specs/2026-07-30-negotiation-contract-payment-design.md`（2026-07-30 用户批准）。
>
> **用户裁决（2026-07-30，设计 §13）**：范围=谈案+合同四类型全生命周期+应收计划+收款确认（FIN-02~05 下推 SPEC-011）；审批=内嵌单步（完整审批中心下推 MOD-013）；跨模块事务=生效事务内最小建档（Case+AnalysisEngagement）。
>
> **执行状态**：全部 Task 未开始。SPEC-001~009 已验收成果不回填不重测（最小影响纪律）。

**Goal:** 把谈案（CRM-07）、四类合同全生命周期（CON-01~06）、应收计划（CON-07）与收款确认（FIN-01）建成生产级，产出业务事件接入 SPEC-007 事件中心，并提供桌面及响应式 Web 管理页；首签/正式委托生效事务分别完成分析委托/案件最小建档。

**Architecture:** 新建 `Negotiation`/`ContractTemplate`/`ContractNumberSequence`/`PaymentPlan`/`AnalysisEngagement` 五模型，重建 `Contract`/`Payment` 原型（语义字段迁移保留），`Case.lawyerId` 改可空。应用服务沿用 SPEC-009 验证的 `Service(prisma, auditActor, authorizationContext)` 分层 + factory 装配，Controller 仅 HTTP 适配 + 授权中间件。状态流转走动作接口，关键写操作同事务写 EventLog（EventOutboxWriter.append）。数据范围接入 SPEC-004。权限码与目录同变更落 provisioning 迁移（SPEC-009 T12/F-1 纪律）。原型 17 条无守卫路由根除+404 锁（T10 先例）。

**Tech Stack:** Egg.js 3 + TypeScript，Prisma 5.22 + PostgreSQL 16，React 19 + Ant Design 6 + Zustand + Vite，node:test（后端串行 `--test-concurrency=1`），Vitest + Playwright 1.55.1（前端）。

## Global Constraints

- 不执行任何 Git 提交或远程操作（CLAUDE.md 约束 1）。所有代码在本地完成。Plan 中的"本任务边界可提交"步骤仅记录边界，执行者**不运行 git 命令**。
- 数据库测试必须串行 `--test-concurrency=1`（CLAUDE.md 约束 2）。
- 测试数据库名必须以 `_test` 结尾，重置需 `ALLOW_TEST_DB_RESET=true`（约束 6）。
- 后端 HTTP 集成测试必须使用 `test/helpers/auth-session.ts` 的固定测试密钥：`JWT_SECRET=01234567890123456789012345678901`、`MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=`（base64 of `0123456789abcdef0123456789abcdef`）、`DATABASE_URL`与`DATABASE_URL_TEST`均指 55433 `chengye_oa_test`、`APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210`、`NODE_ENV=test`、`ALLOW_TEST_DB_RESET=true`、`CORS_ALLOWED_ORIGINS=http://localhost:3000`。
- 本机预生产诊断线（`.codex-safe/`、55432 容器）保持隔离不动。SPEC-008 的 55432 端口锁定 rehearsal 测试与本 Spec 无关，其失败不阻断验收。
- 错误响应统一 `{ code, message, data, requestId }`；`code` 为 HTTP 状态码。领域错误沿用 CrmError 模式：错误类实例携带 `httpStatus`，errorHandler 按实例 status 透传，不按 code 字符串硬映射。
- 状态流转走动作接口（`/contracts/:id/submit` 等），前端禁止直提状态。
- **provisioning 双纪律**（SPEC-009 教训硬化）：新增权限码必须同变更落 provisioning 迁移 SQL（`ON CONFLICT ("code") DO NOTHING` 先例）；新增事件订阅（本 Spec 无）必须同变更落订阅 provisioning。
- **冻结边界**：`app/application/crm/` 下 SPEC-009 服务（lead/assignment/follow/appointment/customer/projection/scope/audit/business-no/recycle-scanner）与 SPEC-001~008 全部成果零改动；唯一例外：`Case.lawyerId` schema 可空化（最小建档前置）。
- Node `22.14.0`、npm `10.9.2`。

---

## File Structure

### 后端新建
- `app/domain/contract/contract-policy.ts` — 合同状态机合法流转表、类型驱动配置（审批开关/应收生成/生效门禁/终态规则）、编号类型码（纯函数，易测）。
- `app/domain/contract/contract-errors.ts` — 稳定错误码与 `ContractError`（仿 `domain/crm/lead-errors.ts` 的 CrmError 模式）。
- `app/application/contract/contract-types.ts` — DTO、输入校验类型、投影视图类型。
- `app/application/contract/contract-number-service.ts` — 编号取号（ContractNumberSequence 同事务自增）。
- `app/application/contract/negotiation-service.ts` — 谈案创建/更新/完结。
- `app/application/contract/contract-service.ts` — 合同创建（四来源）/提交/审批/驳回/签署/生效/终止/作废。
- `app/application/contract/receivable-service.ts` — 应收计划生成（生效触发）、收款登记、财务确认三方联动。
- `app/application/contract/contract-projection.ts` / `payment-projection.ts` — 输出投影。
- `app/application/contract/contract-scope.ts` — 数据范围 where 构造（仿 `crm/lead-scope.ts`）。
- `app/application/contract/contract-factory.ts` — `negotiationService(ctx)` 等（仿 `crm/crm-factory.ts`）。
- `app/controller/negotiation.ts`（新建）、`app/controller/contract.ts` / `payment.ts`（整体重建原型）。

### 后端事件
- `app/domain/events/event-types.ts`（修改）— 注册 7 个事件常量。
- `app/domain/events/event-registry.ts`（修改）— 注册 7 条载荷定义（assertExactKeys 键集）。

### 后端权限
- `app/domain/authorization/authorization-types.ts`（修改）— `RESOURCE_CODES` 加 `contract`/`payment`/`negotiation`；`PERMISSION_CODES` 加 16 码。
- `app/domain/authorization/permission-catalog.ts`（修改）— 注册 16 条目。
- `prisma/migrations/<ts>_contract_permission_provision/migration.sql` — 16 权限行 provisioning（Task 2 同变更落地）。

### 数据库
- `prisma/schema.prisma`（修改）— 新建 5 模型 + 重建 Contract/Payment + Case.lawyerId 可空。
- `prisma/migrations/<ts>_negotiation_contract_payment_expand/migration.sql`（新建，Task 1）。

### 后端测试
- `test/contract/contract-policy.test.ts` / `contract-number-service.test.ts` / `negotiation-service.test.ts` / `contract-service.test.ts` / `receivable-service.test.ts` — 服务层单测。
- `test/app/negotiation-api.test.ts` / `contract-api.test.ts` / `payment-api.test.ts` — HTTP 集成测试。
- `test/db/contract-migration-rehearsal.test.ts` — migration 重演。
- `test/helpers/test-database.ts` — 确认 dmmf 自动覆盖新表。

### 前端新建
- `apps/web/src/api/negotiation.ts` / `contract.ts` / `payment.ts`、`apps/web/src/stores/contract-store.ts` / `payment-store.ts`。
- `apps/web/src/pages/contracts/ContractListPage.tsx` / `ContractDetailPage.tsx` / `ContractCreatePage.tsx`；`apps/web/src/pages/payments/PaymentListPage.tsx`；`apps/web/src/pages/negotiations/NegotiationListPage.tsx`（谈案列表/完结，客户详情内嵌入口可后续）。
- `apps/web/e2e/contract-payment-flow.spec.ts`（排练式）。

### 文档与验收
- `docs/superpowers/runbooks/negotiation-contract-payment.md`、`docs/superpowers/reports/spec-010-closeout.md`。

---

## 类型与契约约束（所有 task 隐含）

1. 权限/事件编译顺序硬约束：`authorization-types.ts` 字面量先于 `permission-catalog.ts` 引用；`event-types.ts` 常量先于 `event-registry.ts` 载荷注册与 service 引用。
2. 所有 Prisma model 改动后须 `npm --prefix apps/server run db:generate`。
3. 金额字段 Prisma 类型 `Decimal @db.Decimal(18,2)`；service 层金额运算用 `Prisma.Decimal`（禁浮点），比较用 `.comparedTo()`/`.equals()`。
4. 事件写入复用 `EventOutboxWriter.append(tx, envelope)`（`app/application/crm/lead-service.ts:192` 模式：`eventVersion: 1`、`objectType`、`objectId`、`operatorUserId`、`branchId/teamId` 取自业务对象、`payload` 键集经 event-registry `assertExactKeys`、`traceId`/`occurredAt`）。
5. HTTP 控制器薄纪律：`assertExactKeys(body, KEYS)` + query 数字解析（非法 400，仿 `controller/customer.ts:99-105` parseQueryInteger）→ 调 service → `{code:200,message:'success',data}` 包络。
6. 服务层统一三参数构造：`new XxxService(ctx.prisma, auditActor(ctx), ctx.state.authorization)`（`crm-factory.ts` 模式）；`requireAction` 首行；数据范围 `buildXxxScopeWhere(action)`；不可见统一 404 不泄露存在性。
7. tsx on Windows 跑测试用 glob 形态（`test/contract/*.test.ts`），目录参数会报 ERR_MODULE_NOT_FOUND。

---

### Task 1: Prisma schema 重建/新增 + migration（数据模型地基）

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_negotiation_contract_payment_expand/migration.sql`
- Test: `apps/server/test/db/contract-migration-rehearsal.test.ts`

**Interfaces:**
- Consumes: 现有 `Contract`(:789)/`Payment`(:820)/`Case`(:845) 原型、`Customer`（FK 目标）、`Employee`（FK 目标）、SPEC-009 终态 schema。
- Produces: 新模型 `Negotiation`/`ContractTemplate`/`ContractNumberSequence`/`PaymentPlan`/`AnalysisEngagement`；重建 `Contract`/`Payment`；`Case.lawyerId` 可空。供全部后续 task 经 `@prisma/client` 引用。

新模型完整定义（写入 schema）：

```prisma
model Negotiation {
  id                   String    @id @default(uuid())
  negotiationNo        String    @unique
  customerId           String
  leadId               String?
  appointmentId        String?
  negotiatorEmployeeId String
  quotedAmount         Decimal?  @db.Decimal(18, 2)
  customerConcerns     String?
  competitorInfo       String?
  status               String    @default("NEGOTIATING") // NEGOTIATING|SIGNED|UNSIGNED
  unsignedReason       String?
  signedAt             DateTime?
  remark               String?
  branchId             String?
  professionalTeamId   String?
  createdBy            String
  updatedBy            String?
  version              Int       @default(1)
  deletedAt            DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  customer   Customer  @relation(fields: [customerId], references: [id])
  negotiator Employee  @relation(fields: [negotiatorEmployeeId], references: [id])
  contracts  Contract[]
  @@index([customerId])
  @@index([status])
  @@index([negotiatorEmployeeId])
  @@index([branchId, createdAt])
  @@map("negotiation")
}

model ContractTemplate {
  id           String   @id @default(uuid())
  code         String   @unique
  contractType String // FIRST_SIGN|FORMAL|SUPPLEMENT|RISK_NOTICE
  name         String
  content      String
  version      Int      @default(1)
  enabled      Boolean  @default(true)
  createdBy    String
  updatedBy    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@map("contract_template")
}

model ContractNumberSequence {
  id         String @id @default(uuid())
  scopeKey   String @unique // {contractType}|{branchCode}|{teamCode}|{yyyy}
  lastSerial Int    @default(0)
  @@map("contract_number_sequence")
}

model PaymentPlan {
  id             String    @id @default(uuid())
  planNo         String    @unique
  contractId     String
  period         Int
  dueDate        DateTime
  amount         Decimal   @db.Decimal(18, 2)
  receivedAmount Decimal   @default(0) @db.Decimal(18, 2)
  status         String    @default("PENDING") // PENDING|PARTIAL|RECEIVED|OVERDUE
  version        Int       @default(1)
  createdBy      String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  contract Contract @relation(fields: [contractId], references: [id])
  payments Payment[]
  @@index([contractId, period])
  @@index([status, dueDate])
  @@map("payment_plan")
}

model AnalysisEngagement {
  id            String   @id @default(uuid())
  engagementNo  String   @unique
  customerId    String
  contractId    String   @unique
  status        String   @default("PENDING") // PENDING|IN_PROGRESS|COMPLETED
  createdBy     String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  customer Customer @relation(fields: [customerId], references: [id])
  contract Contract @relation(fields: [contractId], references: [id])
  @@index([customerId])
  @@map("analysis_engagement")
}
```

Contract 整体重建（原型语义字段 signDate/startDate/endDate/paymentTerms/terms 保留）：

```prisma
model Contract {
  id                 String    @id @default(uuid())
  contractNo         String    @unique
  contractType       String // FIRST_SIGN|FORMAL|SUPPLEMENT|RISK_NOTICE
  title              String
  customerId         String
  sourceType         String    @default("CUSTOMER") // CUSTOMER|NEGOTIATION|ANALYSIS|CASE
  sourceId           String?
  negotiationId      String?
  parentContractId   String?
  templateCode       String?
  templateVersion    Int?
  branchId           String?
  professionalTeamId String?
  amount             Decimal   @default(0) @db.Decimal(18, 2)
  receivedAmount     Decimal   @default(0) @db.Decimal(18, 2)
  status             String    @default("DRAFT") // DRAFT|PENDING_APPROVAL|PENDING_SIGN|SIGNED|EFFECTIVE|TERMINATED|VOID
  submittedBy        String?
  submittedAt        DateTime?
  approvedBy         String?
  approvedAt         DateTime?
  approvalComment    String?
  signDate           DateTime?
  esignLinkId        String?
  esignSerialNo      String?
  esignStatus        String?
  esignCallbackPayload Json?
  effectiveDate      DateTime?
  terminatedAt       DateTime?
  terminateReason    String?
  voidedAt           DateTime?
  voidReason         String?
  startDate          DateTime?
  endDate            DateTime?
  paymentTerms       String?
  terms              String?
  createdBy          String
  updatedBy          String?
  version            Int       @default(1)
  deletedAt          DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  customer   Customer    @relation(fields: [customerId], references: [id])
  negotiation Negotiation? @relation(fields: [negotiationId], references: [id])
  parentContract Contract? @relation("ContractSupplement", fields: [parentContractId], references: [id])
  supplements  Contract[]  @relation("ContractSupplement")
  paymentPlans PaymentPlan[]
  payments     Payment[]
  case         Case?
  analysisEngagement AnalysisEngagement?
  @@index([status])
  @@index([customerId])
  @@index([contractType, status])
  @@index([branchId, createdAt])
  @@index([professionalTeamId])
  @@map("contract")
}

model Payment {
  id            String    @id @default(uuid())
  paymentNo     String    @unique
  contractId    String
  paymentPlanId String?
  customerId    String
  amount        Decimal   @db.Decimal(18, 2)
  method        String?
  account       String?
  paidAt        DateTime?
  status        String    @default("PENDING") // PENDING|CONFIRMED|REFUNDED
  confirmedBy   String?
  confirmedAt   DateTime?
  remark        String?
  createdBy     String
  updatedBy     String?
  version       Int       @default(1)
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  contract Contract     @relation(fields: [contractId], references: [id])
  paymentPlan PaymentPlan? @relation(fields: [paymentPlanId], references: [id])
  customer  Customer    @relation(fields: [customerId], references: [id])
  @@index([contractId])
  @@index([paymentPlanId])
  @@index([status])
  @@index([customerId])
  @@map("payment")
}
```

Case 最小改动：`lawyerId String?`（必填→可空）；`Employee` 侧关系名 `CaseLawyer` 保留。

- [ ] **Step 1: 写 migration 重演测试（RED）**

`test/db/contract-migration-rehearsal.test.ts`：仿 `test/db/lead-crm-migration-rehearsal.test.ts`（SPEC-009 Task 1）。固定临时库（`_test` 后缀 + `ALLOW_TEST_DB_RESET=true`）从 SPEC-009 终态（16 迁移）应用新迁移，断言：5 张新表存在；`contract` 表含 `contractType`/`sourceType`/`branchId`/`version`/`deletedAt`/`esignLinkId` 列且不再有旧 `type` 列语义冲突（重建为整列替换）；`payment` 表含 `paymentNo`/`paymentPlanId`/`confirmedBy` 列；`case.lawyerId` 可空（information_schema is_nullable='YES'）；索引与唯一约束存在（`contract_number_sequence.scopeKey` unique、`payment_plan [contractId,period]`、`analysis_engagement.contractId` unique）。重演后删除临时库。先写断言（migration 未建必失败）。

- [ ] **Step 2: 运行验证失败**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/db/contract-migration-rehearsal.test.ts`，预期 FAIL。

- [ ] **Step 3: 修改 schema.prisma**

按上述定义重建/新增。注意：Customer 需加反向关系行（`negotiations Negotiation[]`、`payments Payment[]` 已存在于原型则保留、`analysisEngagements AnalysisEngagement[]`）；Employee 加 `negotiations Negotiation[]`；关系命名 `ContractSupplement` 自引用。`db:generate` 重新生成 client。

- [ ] **Step 4: 生成 migration**

`cd apps/server && npx prisma migrate dev --name negotiation_contract_payment_expand --create-only`（`DATABASE_URL` 指 55433 `_test` 库，`ALLOW_TEST_DB_RESET=true`），检查生成 SQL 后保留；环境不便时手写（参考既有 expand 模式：新表 CREATE TABLE + `contract`/`payment` 整列改造 + `case.lawyerId DROP NOT NULL`）。**原型 contract/payment 仅测试库数据，允许破坏性列改造（不保全旧数据），生产数据迁移由后续部署 SPEC 处理。**

- [ ] **Step 5: 重演测试验证通过**（同 Step 2 命令，预期 PASS）

- [ ] **Step 6: 记录 model/迁移新计数**

`npm run check:baseline` 预期 FAIL（49→54、16→17）。**仅记录数值，不改期望**（Task 12 统一三处同步）。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 2: 权限类型与目录扩充 + provisioning 迁移（编译顺序地基 + T12 纪律）

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`
- Modify: `apps/server/app/domain/authorization/permission-catalog.ts`
- Create: `apps/server/prisma/migrations/<timestamp>_contract_permission_provision/migration.sql`
- Test: `apps/server/test/contract/permission-catalog-contract.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `PermissionCode`/`ResourceCode` union 与 `permission(...)` catalog 模式（SPEC-009 Task 2 先例：`lead.read` 等 15 码 + 2 菜单码）。
- Produces: 16 个新权限码（Task 10 router 引用）：`negotiation.read`/`negotiation.create`/`negotiation.update`、`contract.read`/`contract.create`/`contract.submit`/`contract.approve`/`contract.sign`/`contract.effect`/`contract.terminate`/`contract.void`、`payment.read`/`payment.create`/`payment.confirm`、`menu.contract`、`menu.payment`。

- [ ] **Step 1: 写目录测试（RED）**

仿 `test/crm/permission-catalog-crm.test.ts`：断言 16 码全部在 catalog、resource/action/风险级正确（read=READ；create/submit/sign/update=MEDIUM；approve/effect/terminate/void/confirm=HIGH；menu.*=MENU），`PERMISSION_CODES` 总数 87+14=101（**算术修正**：`contract.void`/`payment.confirm` 自 SPEC-001 `20260718210000_authorization_expand` 即为 SPECIAL/CRITICAL 占位码，87 基线已含；本任务就地升级 ACTION/HIGH 不计新增，唯一自洽值 101）。

- [ ] **Step 2: authorization-types 加字面量**

`RESOURCE_CODES` 加 `'contract'|'payment'|'negotiation'`；`PERMISSION_CODES` 加 16 字面量。typecheck 先于 catalog 通过。

- [ ] **Step 3: permission-catalog 注册条目**（仿 lead.* 条目形态；menu 条目与 menu.lead_crm 同形）

- [ ] **Step 4: 同变更落 provisioning 迁移（T12 纪律，强制）**

仿 `prisma/migrations/20260730090000_crm_permission_provision/migration.sql`：16 行 `INSERT INTO "permission" (...) VALUES (...) ON CONFLICT ("code") DO NOTHING;`——列集与该行逐字同形（id/code/name/type/resource/action/riskLevel 等以其为准）。时间戳晚于 Task 1 迁移。

- [ ] **Step 5: 迁移-only 实证（强制，T12 同款）**

`npm run db:reset:test` 后零种子直查（Prisma 脚本）：`permission` 总数=101 且 16 码（14 新增+2 占位升级）逐字段=catalog。记录输出。**跳过此步=重蹈 SPEC-009 T12 生产阻断。**

- [ ] **Step 6: 目录测试 + 契约测试通过**

`npx tsx --test --test-concurrency=1 --test-force-exit test/contract/permission-catalog-contract.test.ts test/authorization/*.test.ts` 预期 PASS（authorization sentinel 87→101 若存在计数断言需同步——grep 确认 `test/authorization/permission-catalog.test.ts` 是否有 87 计数断言，有则同步为 101 并在报告申报；FUTURE_SPECIAL_CODES 需移除 2 个转正码）。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 3: contract-policy 领域纯函数 + contract-errors（TDD 地基）

**Files:**
- Create: `apps/server/app/domain/contract/contract-policy.ts`
- Create: `apps/server/app/domain/contract/contract-errors.ts`
- Test: `apps/server/test/contract/contract-policy.test.ts`

**Interfaces:**
- Consumes: 设计 §6.1 状态机与类型驱动差异。
- Produces（后续 task 引用）：
  - `CONTRACT_TYPES = ['FIRST_SIGN','FORMAL','SUPPLEMENT','RISK_NOTICE'] as const`、`CONTRACT_STATUSES = ['DRAFT','PENDING_APPROVAL','PENDING_SIGN','SIGNED','EFFECTIVE','TERMINATED','VOID'] as const`，类型 `ContractType`/`ContractStatus`。
  - `CONTRACT_TYPE_CODES: Record<ContractType, string>` = `{ FIRST_SIGN:'FS', FORMAL:'WT', SUPPLEMENT:'SA', RISK_NOTICE:'RN' }`。
  - `CONTRACT_TYPE_POLICY: Record<ContractType, { requiresApproval: boolean; generatesReceivable: boolean; terminalAtSigned: boolean }>` = FIRST_SIGN/FORMAL/SUPPLEMENT=`{true,true,false}`，RISK_NOTICE=`{false,false,true}`。
  - `canTransitionContract(type: ContractType, from: ContractStatus, action: ContractAction): ContractStatus | null`（action: `submit|approve|reject|sign|effect|terminate|void`）。
  - 错误：`ContractError extends Error { constructor(code: string, httpStatus: number, message?: string) }`（仿 `domain/crm/lead-errors.ts` CrmError）；稳定码：`CONTRACT_NOT_FOUND`(404)、`NEGOTIATION_NOT_FOUND`(404)、`PAYMENT_NOT_FOUND`(404)、`CONTRACT_STATE_TRANSITION_INVALID`(409)、`CONTRACT_APPROVAL_PENDING`(409)、`RISK_NOTICE_MISSING`(409)、`PAYMENT_ALREADY_CONFIRMED`(409)、`PAYMENT_AMOUNT_EXCEEDED`(409)、`RECEIVABLE_PLAN_MISMATCH`(400)、`VALIDATION_FAILED` 复用 MasterDataError。

状态机表（设计 §6.1，政策门禁先于流转判定）：
```
submit:    DRAFT → requiresApproval ? PENDING_APPROVAL : PENDING_SIGN
approve:   PENDING_APPROVAL → PENDING_SIGN
reject:    PENDING_APPROVAL → DRAFT
sign:      PENDING_SIGN → SIGNED
effect:    SIGNED → EFFECTIVE（仅 generatesReceivable 类型；RISK_NOTICE 无 effect）
terminate: EFFECTIVE → TERMINATED
void:      DRAFT|PENDING_APPROVAL|PENDING_SIGN → VOID
```

- [ ] **Step 1: 写 policy 测试（RED）**：全类型×全 action 合法箭头断言；非法（TERMINATED/VOID 再流转、EFFECTIVE→VOID、SIGNED→submit、RISK_NOTICE effect）返 null；类型政策表逐字段断言。

- [ ] **Step 2: 运行验证失败** → **Step 3: 实现** → **Step 4: 全绿**（`npx tsx --test --test-concurrency=1 --test-force-exit test/contract/contract-policy.test.ts`）。

- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 4: 事件类型与载荷注册

**Files:**
- Modify: `apps/server/app/domain/events/event-types.ts`
- Modify: `apps/server/app/domain/events/event-registry.ts`
- Test: `apps/server/test/contract/contract-events.test.ts`

**Interfaces:**
- Produces（Task 6-9 service 引用）：常量 `NEGOTIATION_CREATED='negotiation.created'`、`NEGOTIATION_CLOSED='negotiation.closed'`、`CONTRACT_CREATED='contract.created'`、`CONTRACT_STATUS_CHANGED='contract.status_changed'`、`CONTRACT_EFFECTIVE='contract.effective'`、`PAYMENT_CREATED='payment.created'`、`PAYMENT_CONFIRMED='payment.confirmed'`（v1，sourceModule `'CONTRACT'`）。
- 载荷键集（event-registry assertExactKeys）：
  - `negotiation.created`：`{negotiationId, customerId, negotiatorEmployeeId, status}`
  - `negotiation.closed`：`{negotiationId, status, unsignedReason?}`（可选键不入键集则分两定义——**裁决：键集固定 `{negotiationId, status}`，unsignedReason 不入载荷**，审计查库）
  - `contract.created`：`{contractId, contractNo, contractType, customerId, sourceType}`
  - `contract.status_changed`：`{contractId, fromStatus, toStatus}`
  - `contract.effective`：`{contractId, contractType, customerId, planCount, caseId?, engagementId?}`（**裁决：可选键允许 null 值占位，键集固定 7 键**——与 registry 既有可选键先例对齐，实现者查 event-registry 其他含 null 载荷先例遵循之）
  - `payment.created`：`{paymentId, paymentNo, contractId, customerId, status}`
  - `payment.confirmed`：`{paymentId, contractId, status}`

- [ ] **Step 1: 注册测试（RED）**：7 类型在 registry、载荷键集精确、错误键抛错。
- [ ] **Step 2-4**: 实现（仿 SPEC-009 Task 4.5 六条 CRM 载荷注册形态）→ 全绿。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 5: contract-number-service（编号序列）

**Files:**
- Create: `apps/server/app/application/contract/contract-number-service.ts`
- Test: `apps/server/test/contract/contract-number-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ContractNumberSequence`、Task 3 的 `CONTRACT_TYPE_CODES`。
- Produces: `nextContractNo(tx: Prisma.TransactionClient, input: { contractType: ContractType; branchCode?: string | null; teamCode?: string | null; now?: Date }): Promise<string>`。
  - scopeKey=`${TYPE_CODE}|${branchCode ?? 'HQ'}|${teamCode ?? 'ALL'}|${yyyy}`（yyyy=UTC 年）。
  - 取号：事务内 `INSERT ... ON CONFLICT (scopeKey) DO UPDATE SET lastSerial = contract_number_sequence.lastSerial + 1 RETURNING lastSerial`（Prisma `$queryRaw` 原子 upsert；跳号可接受）。
  - 编号：`${TYPE_CODE}-${branchCode}-${teamCode}-${yyyy}-${String(serial).padStart(4,'0')}`。
  - 同类函数 `nextPlanNo/nextPaymentNo/nextNegotiationNo/nextEngagementNo/nextCaseNo`：复用 SPEC-009 `makeBusinessNo(prefix)`（`app/application/crm/business-no.ts`，前缀 `PP/PY/NE/AE/CA`）——非序列号，P2002 重试纪律同 lead-service（上限 2）。

- [ ] **Step 1: 测试（RED）**：同 scope 连续取号 0001/0002 递增；不同 type/branch/year 独立序列；`now` 注入跨年切序列；并发 10 取号无重号（Promise.all 同 scope）。
- [ ] **Step 2-4**: 实现 → 全绿。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 6: negotiation-service（谈案，CRM-07）

**Files:**
- Create: `apps/server/app/application/contract/negotiation-service.ts`
- Create: `apps/server/app/application/contract/contract-scope.ts`（数据范围 where 构造，本 task 先服务 Negotiation；Task 7/9 扩展）
- Create: `apps/server/app/application/contract/contract-types.ts`（DTO/输入类型）
- Test: `apps/server/test/contract/negotiation-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema、Task 2 权限码、Task 3 errors、Task 4 事件、Task 5 编号。
- Produces:
  - `createNegotiation(input: { customerId, leadId?, appointmentId?, negotiatorEmployeeId, quotedAmount?, customerConcerns?, competitorInfo?, remark? }): Promise<NegotiationView>` — `negotiation.create`；客户存在性+范围校验（customer.read 语义内嵌于范围 where）；员工存在性校验（4a 模式：findFirst select id，缺失 `VALIDATION_FAILED` 400）；branchId/professionalTeamId 从客户档案解析（customer.branchId/professionalTeamId 若存在，否则 null——实现者查 Customer schema 实际列名，以客户主数据真实锚为准）；同事务 `negotiation.created` 事件。
  - `listNegotiations(query: { page?, pageSize?, status?, customerId? }): Promise<PagedResult<NegotiationView>>` — `negotiation.read` + 范围。
  - `getNegotiation(id): Promise<NegotiationView>` — 404 不泄露。
  - `updateNegotiation(id, input: 部分字段): Promise<NegotiationView>` — `negotiation.update`；仅 NEGOTIATING 可改（否则 `CONTRACT_STATE_TRANSITION_INVALID` 409 复用）；version 乐观锁。
  - `closeNegotiation(id, input: { outcome: 'SIGNED'|'UNSIGNED', unsignedReason? }): Promise<NegotiationView>` — `negotiation.update`；UNSIGNED 必填原因（400）；SIGNED 置 signedAt；同事务 `negotiation.closed` 事件；终态再完结 409。
- 范围锚（contract-scope.ts `buildNegotiationScopeWhere(action)`）：SELF→`{ negotiatorEmployeeId: actor.employeeId }` OR `{ createdBy: actor.actorUserId }`；TEAM→`professionalTeamId`；BRANCH/ORG→`branchId` 组织子树（复用 SPEC-009 lead-scope 的组织子树展开模式）；零谓词 fail-closed。
- `NegotiationView`：全字段投影（金额不脱敏——设计 §8 决策）。

- [ ] **Step 1: 测试（RED）**：创建/列表分页/详情 404/更新门禁/完结两结局+原因必填/终态再完结 409/范围四类/事件同事务（tx 内 EventLog 可查）/员工伪造 400。
- [ ] **Step 2-4**: 实现 → 全绿。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 7: contract-service A（创建/提交/审批/驳回/签署）

**Files:**
- Create: `apps/server/app/application/contract/contract-service.ts`
- Create: `apps/server/app/application/contract/contract-projection.ts`
- Test: `apps/server/test/contract/contract-service.test.ts`（本 task 写创建/流转段；Task 8 追加生效段）

**Interfaces:**
- Consumes: Task 1/2/3/4/5/6 全部。
- Produces:
  - `createContract(input: { contractType, title, customerId, sourceType?, sourceId?, negotiationId?, parentContractId?, templateCode?, amount?, paymentTerms?, startDate?, endDate?, terms?, branchId?, professionalTeamId? }): Promise<ContractView>` — `contract.create`。
    - 校验：类型∈CONTRACT_TYPES；customer 存在+范围可见（`contract.create` 范围）；`sourceType=NEGOTIATION` 时 negotiationId 必填且存在（4a 存在性校验模式：伪造 → `VALIDATION_FAILED` 400，EventLog 真 FK 纪律）；`parentContractId`（SUPPLEMENT 必填，他类型禁填）存在且非 VOID/TERMINATED；`templateCode` 存在且 enabled → 快照 templateCode+templateVersion；branchId/professionalTeamId 提供时做存在性校验（Organization/ProfessionalTeam findFirst）；金额≥0。
    - 编号：同事务 `nextContractNo(tx, ...)`（branch/team code 从 Organization/ProfessionalTeam.code 解析，缺省 HQ/ALL）。
    - 初始 DRAFT + `contract.created` 事件，同事务。
  - `submitContract(id)` — `contract.submit`；DRAFT→（类型政策）PENDING_APPROVAL/PENDING_SIGN；置 submittedBy/At；`contract.status_changed`。
  - `approveContract(id, { comment? })` — `contract.approve`；PENDING_APPROVAL→PENDING_SIGN；approvedBy/At+comment；`contract.status_changed`。
  - `rejectContract(id, { comment })` — `contract.approve`；PENDING_APPROVAL→DRAFT；comment 必填（400）；`contract.status_changed`。
  - `signContract(id, { signDate?, esignLinkId?, esignSerialNo?, esignStatus? })` — `contract.sign`；PENDING_SIGN→SIGNED；esign 字段写入（CON-05 预留）；`contract.status_changed`。
  - `listContracts(query: { page?, pageSize?, status?, contractType?, customerId?, keyword? })` / `getContract(id)` — `contract.read`；范围；不可见 404。
  - 全部动作：`requireAction` 首行 → 范围校验（动作级）→ 状态机判定（非法 `CONTRACT_STATE_TRANSITION_INVALID` 409）→ version 乐观锁 → 同事务事件。
  - 范围锚（contract-scope 扩展 `buildContractScopeWhere(action)`）：SELF→`{ createdBy: actorId }`；TEAM→`professionalTeamId`；BRANCH/ORG→`branchId` 子树。

- [ ] **Step 1: 测试（RED）**：四类型创建（含 SUPPLEMENT 依附校验/模板快照/编号格式正则 `^(FS|WT|SA|RN)-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$`）/伪造 negotiationId|branchId 400/submit 类型差异（RISK_NOTICE 免审批直进 PENDING_SIGN）/approve/reject/reject 无 comment 400/sign/非法流转 409/范围四类/事件键集。
- [ ] **Step 2-4**: 实现 → 全绿。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 8: contract-service B（生效事务矩阵 + 终止/作废）+ receivable 计划生成

**Files:**
- Modify: `apps/server/app/application/contract/contract-service.ts`（追加 effectContract/terminateContract/voidContract）
- Create: `apps/server/app/application/contract/receivable-service.ts`（本 task 先实现计划生成段；Task 9 追加收款段）
- Modify: `apps/server/test/contract/contract-service.test.ts`（追加生效段）
- Test: `apps/server/test/contract/receivable-service.test.ts`

**Interfaces:**
- Produces:
  - `generatePlansForEffect(tx, contract): Promise<PaymentPlan[]>`（receivable-service，仅内部与 Task 9 复用）：读 `contract.paymentTerms`（JSON：`{ "plans": [{ "period": 1, "dueDate": "2026-09-01", "amount": "5000.00" }, ...] }`；空/null → 默认一期 `{ period:1, dueDate: effectiveDate+30d, amount: contract.amount }`）；校验期次连续（1..N）、合计=合同金额（不等抛 `RECEIVABLE_PLAN_MISMATCH` 400 整事务回滚）；同事务批量创建（planNo=makeBusinessNo('PP')）。
  - `effectContract(id, { effectiveDate?, idempotencyKey? }): Promise<ContractView>` — `contract.effect`；SIGNED→EFFECTIVE；**事务矩阵（设计 §6.2，严格）**：
    - 通用：状态+EFFECTIVE+effectiveDate → generatePlansForEffect → `contract.effective` 事件（载荷含 planCount/caseId/engagementId，无则 null）。
    - FIRST_SIGN：+ AnalysisEngagement 建档（engagementNo=makeBusinessNo('AE')、customerId/contractId、PENDING；contractId @unique 重复生效→P2002 即幂等挡板）。
    - FORMAL：+ **风险告知门禁**（同 customerId 存在 `contractType=RISK_NOTICE AND status=SIGNED AND deletedAt IS NULL`，缺失抛 `RISK_NOTICE_MISSING` 409 整事务回滚）+ **Case 最小建档**（caseNo=makeBusinessNo('CA')、title=`${customer.name}-${contract.title}`、customerId、contractId、lawyerId=null、caseType='GENERAL'、status='PENDING'、fee=contract.amount；contractId @unique 幂等挡板）。
    - SUPPLEMENT：仅自身计划（不碰父合同）。
    - 幂等：已 EFFECTIVE 重放（同 idempotencyKey 或无键）→ 返回现状不重复生成（状态机首查+unique 挡板双保险）。
  - `terminateContract(id, { reason }): Promise<ContractView>` — `contract.terminate`；EFFECTIVE→TERMINATED；reason 必填；terminatedAt；`contract.status_changed`；OperationLog 审计（高风险动作：前后状态+原因，复用 SPEC-009 lead-audit 的 OperationLog 写入模式）。
  - `voidContract(id, { reason }): Promise<ContractView>` — `contract.void`；生效前状态→VOID；reason 必填；voidedAt；`contract.status_changed` + 审计。

- [ ] **Step 1: 测试（RED）**：默认一期计划生成/多期 paymentTerms 解析/合计不等 400 回滚（零残留）/FIRST_SIGN 生效→engagement 行存在/FORMAL 生效→无 RISK_NOTICE 409 回滚+有则 case 行存在且 lawyerId null/重复生效幂等（计划行数不变）/terminate 非 EFFECTIVE 409/void 已生效 409/审计行断言/事件载荷 planCount 正确。
- [ ] **Step 2-4**: 实现 → 全绿（含 Task 7 段不回归）。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 9: receivable-service 收款段（登记/确认三方联动，FIN-01）

**Files:**
- Modify: `apps/server/app/application/contract/receivable-service.ts`（追加 createPayment/confirmPayment/listPayments/listPlans）
- Create: `apps/server/app/application/contract/payment-projection.ts`
- Test: `apps/server/test/contract/receivable-service.test.ts`（追加收款段）

**Interfaces:**
- Produces:
  - `createPayment(input: { contractId, paymentPlanId?, amount, method?, account?, paidAt?, remark?, idempotencyKey? }): Promise<PaymentView>` — `payment.create`；合同存在+范围（`payment.create` 动作级范围经 `{ contract: buildContractScopeWhere }` 包裹）且 status∈{SIGNED,EFFECTIVE}（草稿合同禁收款 409）；paymentPlanId 提供时校验属该合同（4a 模式）；amount>0；paymentNo=makeBusinessNo('PY')；PENDING + `payment.created` 同事务。
  - `confirmPayment(id, { idempotencyKey? }): Promise<PaymentView>` — `payment.confirm`（HIGH，财务）；**三方同事务（固定取锁序 Contract→PaymentPlan→Payment）**：
    1. Payment PENDING→CONFIRMED（已 CONFIRMED 幂等重放返回现状；version 锁）+ confirmedBy/At。
    2. 冲抵：指定 paymentPlanId → 该期 `receivedAmount += amount`；未指定 → 按 dueDate 升序对 PENDING/PARTIAL 期次依次冲抵。期状态联动：received=0→PENDING，0<received<amount→PARTIAL，received≥amount→RECEIVED（超期溢出：`PAYMENT_AMOUNT_EXCEEDED` 409——单期冲抵后累计不得超期次 amount；总确认额不得超合同 amount）。
    3. `Contract.receivedAmount += amount`。
    4. `payment.confirmed` 事件同事务。
  - `listPayments(query: { page?, pageSize?, status?, contractId?, customerId? })` / `listPlans(contractId)` — `payment.read`；范围（Payment 经 contract 包裹+customerId 冗余双锚）。
  - 无业务删除端点（FTN-001 §3.6）。

- [ ] **Step 1: 测试（RED）**：登记（合同状态门禁/伪造 planId 400）/确认三方断言（指定期次 PARTIAL→RECEIVED 边界、顺序冲跨期、合同累计）/超额 409/重复确认幂等（receivedAmount 不翻倍）/范围四类/事件/无删除方法。
- [ ] **Step 2-4**: 实现 → 全绿（含 Task 8 段不回归）。
- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 10: contract-factory + Controller + Router（原型根除，T10 先例）

**Files:**
- Create: `apps/server/app/application/contract/contract-factory.ts`
- Create: `apps/server/app/controller/negotiation.ts`；重建：`apps/server/app/controller/contract.ts`、`payment.ts`
- Modify: `apps/server/app/router.ts`
- Test: `apps/server/test/app/negotiation-api.test.ts`、`contract-api.test.ts`、`payment-api.test.ts`

**Interfaces:**
- Consumes: Task 6-9 service。
- Produces 路由表（全部 `requirePermission`，仿 SPEC-009 T10）：
  - `POST /api/v1/negotiations`（`negotiation.create`）、`GET /api/v1/negotiations`（`negotiation.read`）、`GET /api/v1/negotiations/:id`、`PATCH /api/v1/negotiations/:id`（`negotiation.update`）、`POST /api/v1/negotiations/:id/close`（`negotiation.update`）
  - `POST /api/v1/contracts`（`contract.create`）、`GET /api/v1/contracts`（`contract.read`）、`GET /api/v1/contracts/:id`
  - `POST /api/v1/contracts/:id/submit`（`contract.submit`）、`POST /api/v1/contracts/:id/approve`（`contract.approve`）、`POST /api/v1/contracts/:id/reject`（`contract.approve`）、`POST /api/v1/contracts/:id/sign`（`contract.sign`）、`POST /api/v1/contracts/:id/effect`（`contract.effect`）、`POST /api/v1/contracts/:id/terminate`（`contract.terminate`）、`POST /api/v1/contracts/:id/void`（`contract.void`）
  - `GET /api/v1/contracts/:id/plans`（`payment.read`）
  - `POST /api/v1/payments`（`payment.create`）、`GET /api/v1/payments`（`payment.read`）、`GET /api/v1/payments/:id`、`POST /api/v1/payments/:id/confirm`（`payment.confirm`）
  - **原型根除（T10 先例）**：移除 router.ts:169-187 全部 17 条原型路由（含 `PUT/DELETE /contracts/:id`、`PUT/DELETE /payments/:id`、`/contracts/ledger`、`/contracts/:id/submit|approve|sign|terminate` 旧形态、`/payments/:id/refund`）；404 锁定测试覆盖双侧物理删除与 ledger/refund 旧路径（原型 submit/approve/sign/terminate 路径与新路由同形——404 锁仅针对 PUT/DELETE/ledger/refund，避免锁死新路由）。
  - errorHandler：`ContractError` 分支（仿 CrmError 分支，按实例 httpStatus 透传）。

- [ ] **Step 1: 写三份 API 测试（RED）**：仿 `test/app/customer-api.test.ts` 夹具（createCrmSession 改造支持新码——其 permissions 数组直接接受新码即可，RolePermission connect by code）。覆盖：401/403、四来源创建、提交-审批-签署-生效全链（FORMAL 含 RISK_NOTICE 前置）、收款登记-确认、范围四类、错误码、审计、幂等、原型 404 锁。
- [ ] **Step 2: 运行验证失败** → **Step 3: 实现 factory+controllers+router** → **Step 4: 三文件全绿**。
- [ ] **Step 5: 全量 test/app 不回归**（`test/app/*.test.ts`；prototype 路由消费者经 T10 同款核查=零定型消费者——grep `api/v1/contracts|api/v1/payments` test/ 确认仅有新测试引用）。
- [ ] **Step 6: 确认 test-database 清库覆盖新表**（dmmf 自动覆盖核查）。
- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 11: 前端谈案/合同/收款管理页

**Files:**
- Create: `apps/web/src/api/negotiation.ts`、`contract.ts`、`payment.ts`；`apps/web/src/stores/contract-store.ts`、`payment-store.ts`
- Create: `apps/web/src/pages/contracts/ContractListPage.tsx`、`ContractDetailPage.tsx`、`ContractCreatePage.tsx`；`apps/web/src/pages/payments/PaymentListPage.tsx`；`apps/web/src/pages/negotiations/NegotiationListPage.tsx`
- Modify: `apps/web/src/App.tsx`（路由+菜单权限）、`apps/web/src/components/Layout/index.tsx`（菜单）、`apps/web/src/features/authorization/types.ts`（+16 码）、`apps/web/src/api/business.ts`（**手术精度**：contractApi/paymentApi 段切除或委托新客户端；其他段逐字不动）
- Delete/Replace: `apps/web/src/pages/Contract/index.tsx`、`apps/web/src/pages/Payment/index.tsx`（原型页，消费已删除原型路由）
- Test: `apps/web/src/pages/contracts/__tests__/ContractListPage.test.tsx` 等 + `apps/web/e2e/contract-payment-flow.spec.ts`

**Interfaces:**
- Consumes: Task 10 路由表（逐条对齐）、SPEC-004 权限码（菜单 `menu.contract`/`menu.payment`）、既有 request 封装（SPEC-006 拦截器，零裸 fetch）。
- Produces: 合同列表（类型/状态筛选/分页）、详情（状态机时间线+应收计划表+收款记录）、创建向导（类型→客户→模板→金额分期）、操作按钮按状态机可用性渲染（提交/审批/驳回/签署/生效/终止/作废，无权限码隐藏）、生效二次确认（高风险原因必填 Modal）、收款列表（状态筛选）、登记/确认操作（确认=HIGH 权限按钮+确认弹窗）、谈案列表（状态筛选）、创建/完结（未签原因必填）；桌面+响应式；空态/错误态。
- **business.ts 依赖审计（强制步骤）**：grep `contractApi|paymentApi` 全 src（Dashboard/Case 等页若消费，逐一适配到新端点或申报裁决）；typecheck+build 为零破损证据。
- 掩码纪律（SPEC-009 I-1 教训）：任何脱敏/掩码值不回填编辑表单；金额/文本正常回填。
- E2E spec（排练式，env 驱动同 SPEC-009 先例）：登录→创建谈案→完结已签→创建 FORMAL 合同→提交→审批→签署→（前置 RISK_NOTICE 创建签署）→生效→收款登记→财务确认→断言计划/合同状态联动。

- [ ] **Step 1: Vitest（RED）**：ContractListPage 渲染/筛选/空态/错误态/状态机按钮可用性矩阵；PaymentListPage 确认按钮权限隐藏。
- [ ] **Step 2-4**: 实现 → `npm run test` 全绿 → E2E spec 静态交付（实跑需栈，标注排练式）。
- [ ] **Step 5: lint + typecheck + build PASS**。
- [ ] **Step 6: 本任务边界可提交（执行者不运行 git）**

---

### Task 12: 验收与收尾

**Files:**
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（model 49→54、迁移 16→18）
- Modify: `apps/server/test/ci/baseline-contract.test.ts`（7 fixture 数组迁移计数行）、`apps/server/test/db/spec-008-event-observability-migration-contract.test.ts`（迁移计数 16→18——**先读该文件确认计数锚点形式**）
- Create: `docs/superpowers/runbooks/negotiation-contract-payment.md`、`docs/superpowers/reports/spec-010-closeout.md`

- [ ] **Step 1: 基线契约三处同步**（SPEC-009 教训：checker+fixture 数组+spec-008 contract 三联）→ `check:baseline`/`check:bootstrap` PASS。
- [ ] **Step 2: 后端全量串行**（排除 2 个 55432 锁定排练件；静默窗口；DB-race 纪律：基建型错误探 pg_stat_activity 静默后重试一次再判）预期 0 fail；计数入账。
- [ ] **Step 3: 前端全量** `npm run test && npm run lint && npm run typecheck && npm run build`。
- [ ] **Step 4: 安全** `npm run security:test`（34/34 基线不回归）；`security:audit:prod` 现存 2 高位为 SPEC-009 用户裁决记录在案残留（SEC-2026-002，2026-08-29 到期），本 Spec 不新增例外。
- [ ] **Step 5: migration 重演 + 空库断言 + 空库重播种**（`db:reset:test` → `db:assert-empty` → 重跑 test/contract 全绿）。
- [ ] **Step 6: provisioning 迁移-only 实证（强制）**：reset 后零种子直查 permission=101（14 新码+2 占位升级）逐字段=catalog。
- [ ] **Step 7: 持久化文档泄漏扫描** `check:docs-leakage` exit 0。
- [ ] **Step 8: 运维手册 + 收尾报告**：runbook（状态机/编号规则/审批配置/生效事务矩阵/错误码表/运维纪律——含 provisioning 双纪律复述）；closeout（工具链/测试计数/迁移 model 数/裁决录/安全状态/已知非阻断项/follow-up 路由）。
- [ ] **Step 9: 本任务边界可提交（执行者不运行 git）**

---

## Plan 自审

**1. Spec 覆盖**：
- CRM-07 谈案 → Task 6 + Task 10/11。✓
- CON-01 模板 → Task 1（ContractTemplate）+ Task 7（快照引用）；初始模板供给=Task 12 迁移附入申报点（实施时并入 Task 2 provisioning 迁移或 Task 1，执行者报告须申报位置）。✓
- CON-02 编号 → Task 5。✓ ｜ CON-03 四来源 → Task 7。✓ ｜ CON-04 内嵌审批 → Task 3（政策）+Task 7（动作）。✓ ｜ CON-05 电子签预留 → Task 1（字段）+Task 7（签署写入）。✓ ｜ CON-06 状态机 → Task 3+7+8。✓
- CON-07 应收计划 → Task 8。✓ ｜ FIN-01 收款确认 → Task 9。✓
- 生效事务矩阵（首签→分析委托/正式→案件+风险告知）→ Task 8。✓
- 事件 → Task 4+6-9。✓ ｜ 权限+provisioning → Task 2。✓ ｜ 原型根除 → Task 10。✓
- 非目标（FIN-02~05/审批中心/电子签对接/案件完整生命周期/编辑器/分账）→ 各 Task 边界排除。✓

**2. 占位符扫描**：无 TBD；编号格式、状态机表、载荷键集、事务矩阵、路由表均全文给出。Task 4 载荷两处裁决已写明固定键集（不留 implementer 自由发挥）。

**3. 类型一致性**：
- `ContractError(code, httpStatus, message?)` Task 3 定义 = Task 6-10 引用。✓
- 权限码 16 个 Task 2 定义 = Task 10 路由 = Task 11 types.ts。✓
- `nextContractNo(tx, input)` Task 5 签名 = Task 7 调用。✓
- `generatePlansForEffect(tx, contract)` Task 8 定义，Task 9 不重复实现（冲抵逻辑独立）。✓
- 事件常量 Task 4 = Task 6-9 envelope 引用。✓
- `makeBusinessNo` 前缀分配：NE（谈案）/PP（计划）/PY（收款）/AE（分析委托）/CA（案件）——与 SPEC-009 既有 L/AP/CU 无冲突。✓
- Case 建档字段（caseType='GENERAL'/status='PENDING'）与原型 Case 枚举一致（PENDING|ACCEPTED|PROCESSING|CLOSED|ARCHIVED）。✓
