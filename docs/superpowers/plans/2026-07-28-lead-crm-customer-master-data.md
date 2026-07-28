# 线索销转与客户主数据（SPEC-009）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **需求来源（spec 层，CONVENTIONS §6 纪律）**：`docs/spec/modules/MOD-004-lead-crm.md`（CRM-01~06）+ `docs/spec/modules/MOD-005-customer-master-data.md`（CUS-01~02）。横切契约：`docs/spec/foundations/FTN-001-data-model.md`、`FTN-002-state-machine-dictionary.md`、`FTN-003-rbac-data-scope.md`、`FTN-005-event-driven-model.md`。设计文档：`docs/superpowers/specs/2026-07-28-lead-crm-customer-master-data-design.md`（已批准）。
>
> **执行状态（2026-07-28 盘点）**：Task 1-4 已落地（未提交）：schema 扩充+迁移+重演测试、权限目录扩充+契约测试、lead-policy+lead-errors+单测、事件类型注册+pilot 订阅（DISABLED）+注册表测试均已存在。Task 5-12 未开始。执行 Task 1-4 时按各 Task 验证步骤做**确认性验证**（跑既有测试/typecheck），通过即关闭，不重复建设。

**Goal:** 把线索销转前端（录入到到访，CRM-01~06）与客户主数据基础（CUS-01~02）建成生产级，产出业务事件接入 SPEC-007 事件中心，并提供桌面及响应式 Web 管理页。

**Architecture:** 扩充+重构现有 `Lead`/`LeadFollow`/`Customer`/`Channel` 原型，新增 `Campaign`(占位)/`LeadPoolRecord`/`Appointment`/`Contact`。应用服务沿用 SPEC-003 的 `service(prisma, auditActor, authorizationContext)` 分层模式，Controller 仅 HTTP 适配 + 授权中间件。状态流转走动作接口不经通用 update，关键写操作同事务写 EventLog（复用 SPEC-007 Outbox）。数据范围与字段权限接入 SPEC-004。前端沿用 SPEC-003~008 的 AntD6 + Zustand 模式。

**Tech Stack:** Egg.js 3 + TypeScript，Prisma 5.22 + PostgreSQL 16，React 19 + Ant Design 6 + Zustand + Vite，node:test（后端串行 `--test-concurrency=1`），Vitest + Playwright 1.55.1（前端）。

## Global Constraints

- 不执行任何 Git 提交或远程操作（CLAUDE.md 约束 1）。所有代码在本地完成。Plan 中的 `git add/commit` 步骤仅记录"在本任务边界处可提交"，实际由项目负责人统一处理；执行者**不运行 git 命令**。
- 数据库测试必须串行 `--test-concurrency=1`（CLAUDE.md 约束 2）。
- 测试数据库名必须以 `_test` 结尾，重置需 `ALLOW_TEST_DB_RESET=true`（约束 6）。
- 后端 HTTP 集成测试必须使用 `test/helpers/auth-session.ts` 的固定测试密钥：`JWT_SECRET=01234567890123456789012345678901`、`MFA_ENCRYPTION_KEY_V1` = base64(`0123456789abcdef0123456789abcdef`)。否则 token 签发(固定密钥)与验证(app 读 env)不匹配导致全片 401。
- 本机预生产诊断线（`.codex-safe/`、55432 容器、read-only classifier handoff）保持隔离不动。
- 本 Spec 在标准开发环境实施验收：55433 dev 容器、`chengye_oa_test` 库。SPEC-008 的 3 个 55432 端口锁定 rehearsal 测试与本 Spec 无关，其失败不阻断本 Spec 验收。
- Node `22.14.0`、npm `10.9.2`（CLAUDE.md 技术栈）。
- 错误响应统一 `{ code, message, data, requestId }`；`code` 为 HTTP 状态码（与现有 SPEC 一致）。
- L3 字段（phone/wechat）双字段：`phone`(规范值，展示用，按字段权限脱敏) + `phoneHash`(检索/去重)；明文不入索引。不收 idCard。
- 状态流转走动作接口（`/leads/{id}/assign` 等），前端禁止直提状态。

---

## File Structure

### 后端新建
- `app/domain/crm/lead-policy.ts` — 状态机合法流转表、poolStatus 规则、电话规范化与 Hash、去重匹配规则（纯函数，易测）。
- `app/domain/crm/lead-errors.ts` — 稳定错误码（`LEAD_NOT_FOUND` 等）与 `CrmError`。
- `app/application/crm/lead-types.ts` — Lead/Customer/Appointment/Contact 的 DTO、输入校验类型、投影视图类型。
- `app/application/crm/lead-service.ts` — 线索录入、去重提示、状态流转、转客户。
- `app/application/crm/lead-assignment-service.ts` — 公海/私海、分配/改派/领取/回收。
- `app/application/crm/lead-follow-service.ts` — 跟进记录、首响时长计量。
- `app/application/crm/appointment-service.ts` — 邀约创建/到访/爽约/改期。
- `app/application/crm/customer-service.ts` — 客户档案、联系人 CRUD。
- `app/application/crm/lead-projection.ts` / `customer-projection.ts` — 按字段权限的脱敏投影。
- `app/application/crm/crm-factory.ts` — `leadService(ctx)` 等 factory（仿 `master-data-factory.ts`）。
- `app/controller/lead.ts` / `appointment.ts` / `customer.ts` — HTTP 适配。
- `app/router.ts`（修改）— 注册新路由。
- `app/extend/context.ts`（修改，若需）— 暴露 `crmFactory` 或沿用现有 `ctx.prisma`。

### 后端事件
- `app/domain/events/event-types.ts`（修改）— 注册 `lead.created.v1` 等事件类型常量。
- `app/domain/events/event-subscription-catalog.ts`（修改）— 注册首响 pilot 订阅。
- `app/application/events/handlers/lead-first-response-handler.ts` — pilot 首响超时通知 handler。

### 后端权限
- `app/domain/authorization/authorization-types.ts`（修改）— `RESOURCE_CODES` 加 `lead`/`appointment`/`campaign`；`FIELD_CODES` 加 `lead.phone`/`customer.phone` 等；`PERMISSION_CODES` 加新权限码。
- `app/domain/authorization/permission-catalog.ts`（修改）— 注册新 `permission(...)` 条目。

### 数据库
- `app/prisma/schema.prisma`（修改）— 扩充 Lead/LeadFollow/Customer/Channel + 新增 Campaign/LeadPoolRecord/Appointment/Contact。
- `app/prisma/migrations/<timestamp>_lead_crm_customer_expand/migration.sql`（新建）。

### 后端测试
- `test/helpers/test-database.ts`（修改）— 把新表纳入 `clearTestApplicationData` 清库清单。
- `test/crm/lead-policy.test.ts` / `lead-service.test.ts` / `lead-assignment-service.test.ts` / `lead-follow-service.test.ts` / `appointment-service.test.ts` / `customer-service.test.ts` / `lead-projection.test.ts` — 服务层单测。
- `test/app/lead-api.test.ts` / `appointment-api.test.ts` / `customer-api.test.ts` — HTTP 集成测试（仿 `test/app/authorization-api.test.ts`）。
- `test/crm/lead-crm-events.test.ts` — 事件产出与 pilot 投递。
- `test/db/lead-crm-migration-rehearsal.test.ts` — migration 重演。
- `test/ci/check-baseline-contract` 相关（修改）— 更新 model 数与迁移数期望。

### 前端新建
- `apps/web/src/api/lead.ts` / `appointment.ts` / `customer.ts` — API 客户端。
- `apps/web/src/pages/leads/LeadListPage.tsx` / `LeadDetailPage.tsx` / `PublicPoolPage.tsx` / `VisitCalendarPage.tsx`。
- `apps/web/src/pages/customers/CustomerListPage.tsx` / `CustomerDetailPage.tsx`。
- `apps/web/src/stores/lead-store.ts` / `customer-store.ts`（Zustand，仿现有 store）。
- `apps/web/src/router`（修改）— 注册路由与菜单权限。
- 测试：`apps/web/src/pages/leads/__tests__/`、Playwright `e2e/lead-crm-flow.spec.ts`。

### 文档与验收
- `docs/superpowers/runbooks/lead-crm-customer-master-data.md` — 运维手册。
- `docs/superpowers/reports/spec-009-closeout.md` — 收尾报告（验收后）。

---

## 类型与契约约束（所有 task 隐含）

权限/事件扩充有**编译顺序硬约束**：
1. 在 `authorization-types.ts` 的 `RESOURCE_CODES`/`FIELD_CODES`/`PERMISSION_CODES` 数组加字面量**必须先于**在 `permission-catalog.ts` 调用 `permission('lead.read', ...)`，因为 `permission()` 第一参数类型是 `PermissionCode`（派生自 `PERMISSION_CODES`）。
2. 事件类型常量在 `event-types.ts` 注册**必须先于** `event-subscription-catalog.ts` 引用与 service 产出事件。

所有 Prisma model 改动后须 `npm --prefix apps/server run db:generate` 重新生成 client，否则类型不匹配。

---

### Task 1: Prisma schema 扩充与 migration（数据模型地基）

**Files:**
- Modify: `apps/server/app/prisma/schema.prisma`
- Create: `apps/server/app/prisma/migrations/<timestamp>_lead_crm_customer_expand/migration.sql`
- Test: `apps/server/test/db/lead-crm-migration-rehearsal.test.ts`

**Interfaces:**
- Consumes: 现有 `Lead`/`LeadFollow`/`Customer`/`Channel` 原型（SPEC-001 保留）。
- Produces: 扩充后的 Prisma models，供后续所有 task 通过 `@prisma/client` 引用。新 model 名：`Lead`(扩充)、`LeadFollow`(扩充)、`Customer`(扩充)、`Channel`(扩充)、`Campaign`(新)、`LeadPoolRecord`(新)、`Appointment`(新)、`Contact`(新)。新字段见下。

Lead 扩充字段（在现有字段基础上）：
- `leadNo String @unique`、`phoneHash String @index`、`wechatHash String?`
- `sourceType String @default("MANUAL")`、`campaignId String?`、`referralCustomerId String?`
- `branchId String?`、`professionalTeamId String?`
- `poolStatus String @default("PUBLIC")`、`firstResponseSeconds Int?`、`assignedAt DateTime?`（分配/领取时间，首响计算依赖，Task 7 使用）
- `createdBy String`、`updatedBy String?`、`version Int @default(1)`、`deletedAt DateTime?`
- `status` 默认仍 `NEW`，取值由 service 约束（不在 schema 层用 enum，沿用现有字符串模式）。
- 关系：`campaign Campaign? @relation(fields:[campaignId], references:[id])`、`poolRecords LeadPoolRecord[]`、`appointments Appointment[]`、`convertedCustomer Customer? @relation("ConvertedFromLead", fields:[referralCustomerId 反向不动])`——注意 `referralCustomerId` 引用 Customer，`sourceLeadId` 在 Customer 侧引用 Lead。两条关系需用命名 relation 区分：`referralCustomer Customer? @relation("LeadReferralCustomer", fields:[referralCustomerId], references:[id])` 与 Customer 的 `sourceLead Lead? @relation("CustomerSourceLead", fields:[sourceLeadId], references:[id])`。

Customer 扩充：`customerNo String @unique`、`phoneHash String @index`、`leadId` 改名 `sourceLeadId String? @unique`（关系名 `CustomerSourceLead`）、`customerType String @default("INDIVIDUAL")`、审计字段。删除 `idCard` 字段（L4 下推，本 SPEC 不收）。**migration 中若 `customer` 表已有 idCard 列需 `DROP COLUMN`，但须以安全方式（参考现有 migration 的 expand/contract 模式）。**

Channel 扩充：`code String @unique`。**由于现有 `channel` 表已有数据可能性低（测试库重置），直接 `ALTER TABLE` 加列；生产 migration 由后续部署 SPEC 处理，本 SPEC 只在 `_test` 库验证。**

新 model 完整定义（写入 schema）：

```prisma
model Campaign {
  id        String   @id @default(uuid())
  code      String   @unique
  name      String
  channelId String?
  status    String   @default("ENABLED")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  channel   Channel? @relation(fields: [channelId], references: [id])
  leads     Lead[]
  @@map("campaign")
}

model LeadPoolRecord {
  id              String   @id @default(uuid())
  leadId          String
  action          String // CLAIM | ASSIGN | REASSIGN | RECYCLE
  fromEmployeeId  String?
  toEmployeeId    String?
  reason          String?
  operatedBy      String
  createdAt       DateTime @default(now())
  lead            Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  @@index([leadId, createdAt])
  @@map("lead_pool_record")
}

model Appointment {
  id                    String    @id @default(uuid())
  appointmentNo         String    @unique
  leadId                String
  scheduledAt           DateTime
  channel               String // ONSITE | ONLINE
  negotiatorEmployeeId  String?
  status                String    @default("PENDING") // PENDING|CONFIRMED|VISITED|NOSHOW|CANCELLED|RESCHEDULED
  rescheduledFromId     String?
  remark                String?
  createdBy             String
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  lead                  Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)
  rescheduledFrom       Appointment? @relation("AppointmentReschedule", fields: [rescheduledFromId], references: [id])
  rescheduledTo         Appointment? @relation("AppointmentReschedule", fields: [id], references: [rescheduledFromId])
  @@index([leadId, scheduledAt])
  @@index([status, scheduledAt])
  @@map("appointment")
}

model Contact {
  id         String    @id @default(uuid())
  customerId String
  name       String
  phone      String
  phoneHash  String
  wechat     String?
  relation   String?
  isPrimary  Boolean   @default(false)
  createdBy  String
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?
  customer   Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  @@unique([customerId, phoneHash])
  @@index([customerId])
  @@map("contact")
}
```

- [ ] **Step 1: 写 migration 重演测试（RED）**

`test/db/lead-crm-migration-rehearsal.test.ts`：仿 SPEC-004 migration rehearsal。在固定临时库（名含 `_test`，`ALLOW_TEST_DB_RESET=true`）上从 SPEC-008 终态应用新 migration，断言：新表存在、`lead.leadNo`/`lead.phoneHash`/`lead.poolStatus` 列存在、`customer.sourceLeadId` 列存在且 `customer.idCard` 列已移除、`campaign`/`lead_pool_record`/`appointment`/`contact` 表存在、唯一约束与索引存在。重演后删除临时库。先写断言，此时 migration 未建必失败。

- [ ] **Step 2: 运行测试验证失败**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/db/lead-crm-migration-rehearsal.test.ts`
预期：FAIL（migration 不存在 / 列不存在）。

- [ ] **Step 3: 修改 schema.prisma**

按上述"扩充字段"与"新 model"定义修改 `schema.prisma`。`Lead`/`Customer` 的现有字段保留语义，仅新增/改名。`Customer.idCard` 删除。注意 relation 命名区分（`LeadReferralCustomer`/`CustomerSourceLead`/`AppointmentReschedule`）。`Lead.tags` 等现有 JSON 字段保留。

- [ ] **Step 4: 生成 migration**

`cd apps/server && npm run db:generate`
然后用 prisma 生成 migration SQL：
`cd apps/server && npx prisma migrate dev --name lead_crm_customer_expand --create-only`
**注意**：此命令会连 `DATABASE_URL`（非 test 库）。执行前必须设 `DATABASE_URL` 指向 55433 的 `chengye_oa_test`（或一个专用 dev 库），且 `ALLOW_TEST_DB_RESET=true`。生成的 SQL 检查后保留。若 `migrate dev` 因环境问题不便使用，手写 `migration.sql`（参考现有 migration 的 expand/contract 风格）：核心是 `ALTER TABLE "lead" ADD COLUMN ...`、`ALTER TABLE "customer" RENAME COLUMN "leadId" TO "sourceLeadId"` + `DROP COLUMN "idCard"`、`ALTER TABLE "channel" ADD COLUMN "code" ...`、`CREATE TABLE "campaign"/"lead_pool_record"/"appointment"/"contact" ...` + 索引与约束。

- [ ] **Step 5: 运行 migration 重演测试验证通过**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/db/lead-crm-migration-rehearsal.test.ts`
预期：PASS。

- [ ] **Step 6: 运行基线契约验证 model/迁移数**

`cd apps/server && npm run check:baseline`
预期：可能因 model 数变化失败（增加了 Campaign/LeadPoolRecord/Appointment/Contact）。记录新 model 数与迁移数，在 Task 12 验收时更新 `check-baseline-contract` 的期望值。本步仅记录数值，不在此修改期望（避免与 Task 12 冲突）。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

记录：schema + migration + 重演测试就绪。

---

### Task 2: 权限类型与目录扩充（编译顺序地基）

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`
- Modify: `apps/server/app/domain/authorization/permission-catalog.ts`

**Interfaces:**
- Consumes: 现有 `PermissionCode`/`ResourceCode`/`FieldCode` union（`as const` 数组派生）。
- Produces: `lead`/`appointment`/`campaign` 资源码、`lead.*`/`appointment.*`/`customer.read|create|update` 权限码、`lead.phone`/`customer.phone` 字段码，供后续 controller 授权中间件与 service 引用。

- [ ] **Step 1: 扩 RESOURCE_CODES**

在 `authorization-types.ts` 的 `RESOURCE_CODES` 数组（`as const`）加入 `'lead'`、`'appointment'`、`'campaign'`。`customer` 已存在。位置保持字母序附近即可。

- [ ] **Step 2: 扩 FIELD_CODES**

`FIELD_CODES` 加入 `'lead.phone'`、`'lead.wechat'`、`'customer.phone'`、`'customer.wechat'`。这些都是 L3 字段。

- [ ] **Step 3: 扩 PERMISSION_CODES**

`PERMISSION_CODES` 数组加入：`'menu.lead_crm'`、`'menu.customer'`、`'lead.read'`、`'lead.create'`、`'lead.update'`、`'lead.assign'`、`'lead.recycle'`、`'lead.convert'`、`'lead.pool.claim'`、`'appointment.read'`、`'appointment.create'`、`'appointment.visit'`、`'customer.read'`、`'customer.create'`、`'customer.update'`。`'customer.merge'` 已存在（占位不实现）。

- [ ] **Step 4: 在 permission-catalog 注册新条目**

在 `permission-catalog.ts` 的 `PERMISSION_CATALOG` 数组加入（用现有 `permission(...)` 工厂，签名 `permission(code, name, type, resource, action, riskLevel, route?)`）：

```typescript
permission('menu.lead_crm', '线索销转', 'MENU', 'menu', 'view', 'LOW', '/leads'),
permission('menu.customer', '客户管理', 'MENU', 'menu', 'view', 'LOW', '/customers'),
permission('lead.read', '查看线索', 'ACTION', 'lead', 'read', 'LOW'),
permission('lead.create', '创建线索', 'ACTION', 'lead', 'create', 'MEDIUM'),
permission('lead.update', '修改线索', 'ACTION', 'lead', 'update', 'MEDIUM'),
permission('lead.assign', '分配线索', 'ACTION', 'lead', 'assign', 'HIGH'),
permission('lead.recycle', '回收线索', 'ACTION', 'lead', 'recycle', 'MEDIUM'),
permission('lead.convert', '线索转客户', 'ACTION', 'lead', 'convert', 'HIGH'),
permission('lead.pool.claim', '公海领取', 'ACTION', 'lead', 'pool.claim', 'MEDIUM'),
permission('appointment.read', '查看邀约', 'ACTION', 'appointment', 'read', 'LOW'),
permission('appointment.create', '创建邀约', 'ACTION', 'appointment', 'create', 'MEDIUM'),
permission('appointment.visit', '确认到访', 'ACTION', 'appointment', 'visit', 'MEDIUM'),
permission('customer.read', '查看客户', 'ACTION', 'customer', 'read', 'MEDIUM'),
permission('customer.create', '创建客户', 'ACTION', 'customer', 'create', 'MEDIUM'),
permission('customer.update', '修改客户', 'ACTION', 'customer', 'update', 'MEDIUM'),
```

- [ ] **Step 5: typecheck 验证编译通过**

`cd apps/server && npm run typecheck`
预期：PASS（证明 union 扩充与 catalog 条目的 code 字面量匹配）。

- [ ] **Step 6: 写权限目录契约测试**

在 `test/ci/baseline-contract.test.ts` 或新建 `test/crm/permission-catalog-crm.test.ts` 中断言：新权限码与资源码已注册、`customer.merge` 仍存在占位、权限目录无重复 code。运行 `npx tsx --test --test-concurrency=1 --test-force-exit test/crm/permission-catalog-crm.test.ts`，预期 PASS。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 3: lead-policy 领域纯函数与错误码（TDD 地基）

**Files:**
- Create: `apps/server/app/domain/crm/lead-policy.ts`
- Create: `apps/server/app/domain/crm/lead-errors.ts`
- Test: `apps/server/test/crm/lead-policy.test.ts`

**Interfaces:**
- Produces: 供 service 层调用的纯函数——`canTransition(from, to): boolean`、`normalizePhone(raw): string`、`hashPhone(normalized): string`（用项目已有的稳定 hash，非密码 hash，仅检索用）、`hashWechat(raw?): string | null`、`findDuplicateSignals(...)` 去重匹配规则、`LEAD_STATUS`/`POOL_STATUS`/`APPOINTMENT_STATUS` 常量、稳定错误码。

- [ ] **Step 1: 写 lead-policy 测试（RED）**

`test/crm/lead-policy.test.ts` 覆盖：
- 状态机：`NEW→ASSIGNED` 合法、`NEW→VISITED` 非法（跳级）、`VISITED→CONVERTED` 合法、`CONVERTED→NEW` 非法（终态）、`LOST→NURTURE` 占位合法、`NURTURE→reactivate` 本 SPEC 标记为不允许（service 层拒绝）。
- `normalizePhone`：去空格/去横线/86 前缀归一化、非法格式抛错。
- `hashPhone`：相同规范值相同 hash、不同值不同 hash、确定性。
- 去重信号：给定候选线索集合与输入(姓名/规范电话/wechat)，返回命中线索 id 列表（电话命中/wechat 命中/姓名完全匹配），不返回明文。

- [ ] **Step 2: 运行验证失败**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-policy.test.ts`，预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现 lead-errors.ts**

```typescript
export const LEAD_NOT_FOUND = 'LEAD_NOT_FOUND';
export const LEAD_STATE_TRANSITION_INVALID = 'LEAD_STATE_TRANSITION_INVALID';
export const LEAD_NOT_IN_POOL = 'LEAD_NOT_IN_POOL';
export const APPOINTMENT_CONFLICT = 'APPOINTMENT_CONFLICT';
export const CUSTOMER_ALREADY_CONVERTED = 'CUSTOMER_ALREADY_CONVERTED';
export class CrmError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) { super(message); }
}
```

- [ ] **Step 4: 实现 lead-policy.ts**

实现 `LEAD_STATUS` 常量与 `TRANSITIONS` 合法流转表（Map）、`canTransition`、`normalizePhone`（正则去 `[\s-]`、处理 `+86`/`86` 前缀）、`hashPhone`/`hashWechat`（用 `node:crypto` 的 sha256 截断或项目既有检索 hash 工具；**确认是否项目已有 phone hash 工具，若有则复用**）。`findDuplicateSignals` 纯函数接收已查出的候选数组（service 负责查库），返回命中索引。

- [ ] **Step 5: 运行验证通过**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-policy.test.ts`，预期 PASS。

- [ ] **Step 6: lint**

`cd apps/server && npm run lint`，预期 0 error。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 4: 事件类型与首响 pilot 订阅注册

**Files:**
- Modify: `apps/server/app/domain/events/event-types.ts`
- Modify: `apps/server/app/domain/events/event-subscription-catalog.ts`

**Interfaces:**
- Consumes: SPEC-007 的 `EventLog`/Outbox 写入器（`event-outbox-writer`）、订阅目录结构。
- Produces: 事件类型常量 `LEAD_CREATED`/`LEAD_ASSIGNED`/`LEAD_STATUS_CHANGED`/`APPOINTMENT_CREATED`/`APPOINTMENT_VISITED`/`CUSTOMER_CREATED`（值如 `'lead.created'`，version 1）与一个 `LEAD_FIRST_RESPONSE_OVERDUE` pilot 订阅条目。后续 service 与 handler 引用这些常量。

- [ ] **Step 1: 确认现有 event-types 与 outbox writer 接口**

读 `event-types.ts` 现有事件常量命名风格、`event-outbox-writer.ts` 的 `writeEvent` 或等价方法签名，确认 service 如何同事务写事件（`prisma.$transaction` 内调用 writer）。

- [ ] **Step 2: 注册事件类型常量**

在 `event-types.ts` 加入（沿用现有命名规范）：
```typescript
export const LEAD_CREATED = 'lead.created';
export const LEAD_ASSIGNED = 'lead.assigned';
export const LEAD_STATUS_CHANGED = 'lead.status_changed';
export const APPOINTMENT_CREATED = 'appointment.created';
export const APPOINTMENT_VISITED = 'appointment.visited';
export const CUSTOMER_CREATED = 'customer.created';
```
若现有体系用 `eventVersion` 字段，确保常量配套 version=1。

- [ ] **Step 3: 注册首响 pilot 订阅（DISABLED）**

在 `event-subscription-catalog.ts` 加入一条订阅（订阅 `lead.assigned` v1，handlerCode `LEAD_FIRST_RESPONSE_MONITOR`）。**必须以 status `DISABLED` 注册**：SPEC-007 dispatcher 对 ENABLED 订阅若 handlerCode 未注册会产出 `EVENT_HANDLER_UNKNOWN` 失败投递（`event-dispatcher.ts:132` + `event-worker.ts:192`）。Handler 在 Task 9 实现并注册到 `event-services-factory.ts`，那时再翻为 `ENABLED`。若此处用 ENABLED，Task 5/6/7 产出的 `lead.assigned` 事件会全部投递失败，污染 EventDelivery 并破坏事件测试。

```typescript
Object.freeze({
  id: 'subscription:lead-first-response-monitor-v1',
  code: 'lead-first-response-monitor-v1',
  eventType: 'lead.assigned',
  eventVersion: 1,
  handlerCode: 'LEAD_FIRST_RESPONSE_MONITOR',
  status: 'DISABLED',
  filterJson: null,
} satisfies EventSubscriptionCatalogEntry),
```

- [ ] **Step 4: typecheck + 现有事件测试不回归**

`cd apps/server && npm run typecheck`
跑现有事件相关测试确认目录扩充不破坏 SPEC-007 契约：`npx tsx --test --test-concurrency=1 --test-force-exit test/events/governance-notification-flow.test.ts`（已知绿），预期 PASS。

- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 5: lead-service（录入、去重提示、状态流转、转客户）

**Files:**
- Create: `apps/server/app/application/crm/lead-types.ts`、`lead-service.ts`、`lead-projection.ts`
- Test: `apps/server/test/crm/lead-service.test.ts`

**Interfaces:**
- Consumes: `lead-policy`（Task3）、权限类型（Task2）、`event-outbox-writer`（Task4）、SPEC-004 `AuthorizationService`/`AuthorizationContext`、SPEC-003 `AuditActor`。
- Produces: `LeadService` 类，构造 `new LeadService(prisma, actor, authorizationContext)`。方法：
  - `createLead(input, idempotencyKey?): Promise<{ lead: LeadView; duplicates: DuplicateSignal[] }>` —— 同事务写 Lead + `lead.created` 事件；去重只读查询后返回提示；`idempotencyKey` 幂等。
  - `transitionStatus(leadId, target, reason): Promise<LeadView>` —— 校验 `canTransition` + 数据范围 + 动作权限，写 `lead.status_changed` 事件。
  - `convertToCustomer(leadId, customerInput, contactInput, idempotencyKey?): Promise<CustomerView>` —— Customer + Contact + Lead.status=CONVERTED + `customer.created` 同事务；已 CONVERTED 抛 `CUSTOMER_ALREADY_CONVERTED`。
  - `getLead(leadId): Promise<LeadView>` / `listLeads(query): Promise<PagedResult<LeadView>>` —— 数据范围过滤 + 字段脱敏投影。

`LeadView` 由 `lead-projection` 按 `authorizationContext` 的字段权限输出，phone 在无 `lead.phone` READ 权限时脱敏为 `138****1234`。

- [ ] **Step 1: 写 lead-service 测试（RED）**

`test/crm/lead-service.test.ts` 覆盖：
- 创建线索成功，生成 leadNo，写 `lead.created` 事件（断言 EventLog 有记录）。
- 创建线索命中已有线索电话，返回 `duplicates` 非空但不阻断（HTTP 层 success），不返回明文电话。
- idempotencyKey 重复创建返回首次 lead，不重复写事件。
- 状态流转：合法 `NEW→ASSIGNED`、非法 `NEW→VISITED` 抛 `LEAD_STATE_TRANSITION_INVALID`。
- 转客户：成功创建 Customer+Contact+CONVERTED 同事务；重复转抛 `CUSTOMER_ALREADY_CONVERTED`；转客户事务中途失败（用注入失败 trigger 模拟）回滚不留 Customer。
- 数据范围：本人范围下只看到自己的 lead；字段脱敏：无 phone 字段权限时 phone 脱敏。

- [ ] **Step 2: 运行验证失败**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-service.test.ts`，预期 FAIL。

- [ ] **Step 3: 实现 lead-types.ts**

定义 DTO 与视图类型：`CreateLeadInput`、`LeadView`、`DuplicateSignal`、`PagedResult<T>`、`LeadListQuery`。复用 SPEC-003 的输入校验风格（`normalizeRequiredText` 等，若可复用 `master-data-validation`）。

- [ ] **Step 4: 实现 lead-projection.ts**

`projectLead(lead, fieldPermissions): LeadView` —— phone/wechat 按 `FieldReadLevel`（MASKED/READ）输出；参考 SPEC-003 的 `safe-user-projection` 模式。

- [ ] **Step 5: 实现 lead-service.ts**

按接口实现。关键：`prisma.$transaction(async tx => { 写业务对象; await outboxWriter.writeEvent(tx, {...}); })`。去重在创建事务**前**只读查询（避免事务内长查询）。数据范围过滤用 SPEC-004 `DataScopeService.buildScopeWhere`（仿 `authorization-api.test.ts` 用法）。动作权限用 `AuthorizationService.assertAction(...)`。

- [ ] **Step 6: 运行验证通过**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-service.test.ts`，预期 PASS。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 6: lead-assignment-service（公海/私海/分配/回收）

**Files:**
- Create: `apps/server/app/application/crm/lead-assignment-service.ts`
- Test: `apps/server/test/crm/lead-assignment-service.test.ts`

**Interfaces:**
- Consumes: `lead-policy`、`lead-types`、SPEC-004 授权、SPEC-007 outbox。
- Produces: `LeadAssignmentService` 方法：
  - `claimFromPool(leadId): Promise<LeadView>` —— 公海领取，置 PRIVATE+owner=actor，写 LeadPoolRecord(CLAIM)+`lead.assigned` 事件。非公海抛 `LEAD_NOT_IN_POOL`。
  - `assign(leadId, toEmployeeId, reason?): Promise<LeadView>` —— 分配/改派，写 LeadPoolRecord(ASSIGN/REASSIGN)+事件。需 `lead.assign` 权限。
  - `recycle(leadId, reason?): Promise<LeadView>` —— 手动回收，置 RECYCLED，写 LeadPoolRecord(RECYCLE)+事件。需 `lead.recycle` 权限。
  - 超时回收由 Task 9 的 handler 调用本 service 的内部 `recycleOverdueLeads(noFollowHours)` 方法。

- [ ] **Step 1: 写测试（RED）**

覆盖：公海领取成功+写日志+事件；私海线索领取抛 `LEAD_NOT_IN_POOL`；分配改派记录 fromEmployee/toEmployee；回收置 RECYCLED；每次都写 LeadPoolRecord 且不删除旧记录；数据范围与权限校验。

- [ ] **Step 2: 运行验证失败**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-assignment-service.test.ts`，预期 FAIL。

- [ ] **Step 3: 实现**

`claimFromPool`/`assign`/`recycle` 每个动作同事务：更新 Lead.poolStatus+assignedTo + 写 LeadPoolRecord + outbox `lead.assigned` 事件。`recycleOverdueLeads` 查询 `poolStatus=PRIVATE AND status IN (NEW,ASSIGNED) AND updatedAt < now-hours` 批量回收（每条独立事务或批事务，参考 SPEC-007 批处理模式）。

- [ ] **Step 4: 运行验证通过**

预期 PASS。

- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 7: lead-follow-service（跟进+首响计量）

**Files:**
- Create: `apps/server/app/application/crm/lead-follow-service.ts`
- Test: `apps/server/test/crm/lead-follow-service.test.ts`

**Interfaces:**
- Produces: `recordFollow(leadId, input): Promise<LeadFollowView>` —— 写 LeadFollow；若为该线索首条跟进，内联计算 `firstResponseSeconds`（基于 lead.assigned 时间或 lead.createdAt 若无 assigned）写回 Lead。`listFollows(leadId)`。

- [ ] **Step 1: 写测试（RED）**

覆盖：首条跟进计算 firstResponseSeconds 正确（模拟 assigned 时间）；第二条跟进不重算；首响时长为非负；数据范围（只能跟进可见 lead）。

- [ ] **Step 2: 运行验证失败**，预期 FAIL。

- [ ] **Step 3: 实现**

`recordFollow` 事务：写 LeadFollow + 若 `lead.firstResponseSeconds IS NULL` 计算并 `UPDATE lead SET firstResponseSeconds=...`。

- [ ] **Step 4: 运行验证通过**，预期 PASS。

- [ ] **Step 5: 本任务边界可提交（执行者不运行 git）**

---

### Task 8: appointment-service + customer-service

**Files:**
- Create: `apps/server/app/application/crm/appointment-service.ts`、`customer-service.ts`、`customer-projection.ts`
- Test: `apps/server/test/crm/appointment-service.test.ts`、`test/crm/customer-service.test.ts`

**Interfaces:**
- Produces:
  - `AppointmentService.createAppointment(leadId, input, idempotencyKey?)` —— 校验同线索同时段无 ACTIVE 邀约（防 `APPOINTMENT_CONFLICT`），置 lead.status=INVITED，写 `appointment.created` 事件。`confirmVisit(appointmentId)` —— 置 VISITED + lead.status=VISITED + `appointment.visited` 事件。`markNoShow`/`cancel`/`reschedule(appointmentId, newScheduledAt)` —— reschedule 新建记录指向 rescheduledFromId，旧记录置 RESCHEDULED。
  - `CustomerService.createCustomer(input)`/`updateCustomer`/`getCustomer`/`listCustomers` + `ContactService.addContact`/`listContacts`/`updateContact`/`removeContact`（软删）。`customer.merge` **不实现**（service 无该方法，controller 不路由）。

- [ ] **Step 1: 写 appointment-service 测试（RED）**

覆盖：创建邀约置 lead=INVITED+事件；同线索同时段重复抛 `APPOINTMENT_CONFLICT`；确认到访置 VISITED+lead=VISITED+事件；reschedule 保留旧记录+新记录指向旧；爽约/取消状态流转。

- [ ] **Step 2: 写 customer-service 测试（RED）**

覆盖：创建客户+联系人；联系人重复电话(同客户)拒绝；联系人软删；字段脱敏投影；数据范围。

- [ ] **Step 3: 运行验证失败**，预期 FAIL。

- [ ] **Step 4: 实现 appointment-service + customer-service + customer-projection**

- [ ] **Step 5: 运行验证通过**，预期 PASS。

- [ ] **Step 6: 本任务边界可提交（执行者不运行 git）**

---

### Task 9: 首响 pilot handler + 超时回收

**Files:**
- Create: `apps/server/app/application/events/handlers/lead-first-response-handler.ts`
- Test: `apps/server/test/crm/lead-first-response-handler.test.ts`

**Interfaces:**
- Consumes: SPEC-007 `EventHandler` 接口（参考 `handlers/admin-operation-reviewed-notification.ts`）、`lead-assignment-service.recyceOverdueLeads`、配置 `lead.recycle.enabled`/`lead.recycle.noFollowHours`。
- Produces: `LEAD_FIRST_RESPONSE_MONITOR` handler —— 订阅 `lead.assigned`，记录分配时间（**直接使用 `Lead.assignedAt` 字段，已在 Task 1 schema 加入；不新建 `lead_first_response_watch` 表**）。超时检查由 `LeadRecycleScanner` 周期执行（见下），超时未首响 → 回收（**决策：pilot 只做回收即最强提醒，本 SPEC 不写 Notification；设计 §6.5**）。

**澄清锁定的调度方式**（spec §6.5 留待 Plan 锁定，§13 决策摘要已锁定为候选 A）：本 plan 选**候选 A：复用 SPEC-007/008 事件中心周期性 tick 通道，新增一个独立回收检查单元**。锁定依据：设计 §13 决策摘要明确「复用 SPEC-007 Worker handler，不引独立 cron」。隔离纪律（设计 §6.5）：回收检查**不是** `EventHandler`（事件投递职责），而是一个独立的周期扫描单元 `LeadRecycleScanner`，由 `EventWorker` 的 tick 节律驱动但与投递管线完全隔离——实现上在 `event-worker.ts` 的 tick 循环旁挂一个独立的 `onTick` 回调（或等价的 composition：在 `event-services-factory.ts` 创建 worker 时把 scanner 作为可选 `tickListener` 注入），scanner 失败不得影响事件投递（try/catch 隔离 + 独立错误日志），事件投递失败也不得影响 scanner。**禁止**把回收逻辑塞进任何一个 EventDelivery handler。

- [ ] **Step 1: 确认 assignedAt 已在 Task 1 加入**

`Lead.assignedAt` 已在 Task 1 schema 扩充中加入（首响计算依赖它）。本步仅确认 `lead-assignment-service`（Task 6）的 `claimFromPool`/`assign` 已写 `assignedAt=now()`，`lead-follow-service`（Task 7）首响计算已用 `assignedAt`（fallback `createdAt`）。若 Task 6/7 实现时遗漏，本步补齐。

- [ ] **Step 2: 写 handler 测试（RED）**

覆盖：handler 收到 `lead.assigned` 事件正常消费（投递成功、safeSummary 标量）；`LeadRecycleScanner.scanOnce` 按设计 §6.5 规则直接查 Lead（`poolStatus=PRIVATE AND status IN (NEW,ASSIGNED) AND updatedAt < now - noFollowHours`，无需 watch 表）→ 回收 + LeadPoolRecord + `lead.assigned`(RECYCLE) 事件（幂等，重复 scan 不重复回收）；已首响（firstResponseSeconds 非 null）或 `lead.recycle.enabled=false` 时不回收。

- [ ] **Step 3: 运行验证失败**，预期 FAIL。

- [ ] **Step 4: 实现 handler + 注册到 factory + 启用订阅 + 周期回收扫描单元**

a. 实现 `lead-first-response-handler.ts`，导出 handler 类与 `LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE` 常量。
b. 在 `app/application/events/event-services-factory.ts` 现有 `registry.register(...)`（ADMIN_OPERATION_REVIEWED_NOTIFICATION，约第 69 行）之后，新增一条 `registry.register({ handlerCode: 'LEAD_FIRST_RESPONSE_MONITOR', eventType: 'lead.assigned', eventVersion: 1, handler: new LeadFirstResponseHandler(...), safeSummary: ... })`。`registry.validate()` 会自动覆盖新注册项。
c. 在 `event-subscription-catalog.ts` 把 `lead-first-response-monitor-v1` 的 `status` 从 `DISABLED`（Task 4）改为 `ENABLED`。
d. 实现 `LeadRecycleScanner`（候选 A，独立单元）：新建 `app/application/crm/lead-recycle-scanner.ts`，导出 `class LeadRecycleScanner { constructor(prisma, config: { enabled: boolean; noFollowHours: number }, outboxWriter) ; async scanOnce(now: Date): Promise<number> }`，内部调用 `lead-assignment-service.recycleOverdueLeads(noFollowHours)` 的核心事务逻辑。在 `event-worker.ts` 增加一个可选的 `tickListener?: (now: Date) => Promise<void>` 构造参数：worker 每次 `tick()` 完成后以 try/catch 隔离调用 listener（listener 抛错仅记日志，绝不影响投递循环）；在 `event-services-factory.ts` 组装 worker 时把 `scanner.scanOnce` 注入为 tickListener。配置从 `loadEnvironment` 读取 `lead.recycle.enabled`/`lead.recycle.noFollowHours`（在 `config/env.ts` 加这两个解析，`parseDecimalInteger` 模式，`LEAD_RECYCLE_ENABLED` 默认 true、`LEAD_RECYCLE_NO_FOLLOW_HOURS` 默认 24、min 1、max 720）。

**pilot 与回收职责分离**：pilot handler 订阅 `lead.assigned`，仅做最小消费（验证订阅-投递管线连通，safeSummary 记录 leadId/action，不写业务表、不回收、不通知）；`LeadRecycleScanner` 随事件 Worker tick 周期按设计 §6.5 规则直接扫描 Lead 表并回收。回收即是最强提醒（线索离手），首响超时提醒主管的完整通知能力下推通知中心 SPEC（非目标 7）。

- [ ] **Step 5: 运行验证通过**，预期 PASS。

- [ ] **Step 6: 本任务边界可提交（执行者不运行 git）**

---

### Task 10: crm-factory + Controller + Router

**Files:**
- Create: `apps/server/app/application/crm/crm-factory.ts`
- Create: `apps/server/app/controller/lead.ts`、`appointment.ts`、`customer.ts`
- Modify: `apps/server/app/router.ts`
- Test: `apps/server/test/app/lead-api.test.ts`、`appointment-api.test.ts`、`customer-api.test.ts`

**Interfaces:**
- Consumes: Task 5-9 的 service。
- Produces: HTTP 路由（仿 `controller/organization.ts`/`permission.ts` 模式）：
  - `POST /api/v1/leads`（create，`lead.create`）、`GET /api/v1/leads`（list，`lead.read`）、`GET /api/v1/leads/:id`、`PATCH /api/v1/leads/:id`（update，`lead.update`）
  - `POST /api/v1/leads/:id/assign`（`lead.assign`）、`POST /api/v1/leads/:id/recycle`（`lead.recycle`）、`POST /api/v1/leads/:id/convert`（`lead.convert`）
  - `POST /api/v1/leads/:id/follows`（`lead.update`）、`GET /api/v1/leads/:id/follows`
  - `POST /api/v1/leads/pool/claim`（`lead.pool.claim`，body `leadId`）、`GET /api/v1/leads/pool`（公海列表，`lead.read`）
  - `POST /api/v1/appointments`、`POST /api/v1/appointments/:id/visit`、`POST /api/v1/appointments/:id/reschedule`、`GET /api/v1/appointments`（按日历查询）
  - `POST /api/v1/customers`、`GET /api/v1/customers`、`GET /api/v1/customers/:id`、`PATCH /api/v1/customers/:id`
  - `POST /api/v1/customers/:id/contacts`、`PATCH/DELETE /api/v1/customers/:id/contacts/:contactId`
  - 路由经 SPEC-004 授权中间件（仿现有 controller `ctx.state.authorization`）。

**测试密钥约束**：HTTP 集成测试必须设 `JWT_SECRET=01234567890123456789012345678901`、`MFA_ENCRYPTION_KEY_V1=base64(0123456789abcdef0123456789abcdef)`、`DATABASE_URL`与`DATABASE_URL_TEST`均指 55433 chengye_oa_test，固定 helper 密钥（Global Constraints）。

- [ ] **Step 1: 写 lead-api 测试（RED）**

仿 `test/app/authorization-api.test.ts` 结构：`mm.app()` + `beforeEach` clearTestApplicationData + 用 `createApiSession` 固定密钥。覆盖：未认证 401；普通用户无 `lead.create` 403；创建成功 200 + duplicates 提示；数据范围四类（本人/团队/分所/全所）各一组；field 脱敏；非法状态流转 409；idempotencyKey 幂等；审计写入（敏感字段查看写 AuditLog）。

- [ ] **Step 2: 写 appointment-api / customer-api 测试（RED）**，覆盖对应端到端与错误码。

- [ ] **Step 3: 运行验证失败**，预期 FAIL。

- [ ] **Step 4: 实现 crm-factory + controllers + router**

`crm-factory.ts` 仿 `master-data-factory.ts`：`leadService(ctx)`/`leadAssignmentService(ctx)`/`leadFollowService(ctx)`/`appointmentService(ctx)`/`customerService(ctx)`。controller 每方法调 service + 包络响应。router 注册路由并挂授权中间件。

- [ ] **Step 5: 运行验证通过**

`cd apps/server && npx tsx --test --test-concurrency=1 --test-force-exit test/app/lead-api.test.ts test/app/appointment-api.test.ts test/app/customer-api.test.ts`，预期 PASS。

- [ ] **Step 6: 确认 test-database 清库清单已含新表**

`test/helpers/test-database.ts` 的 `clearTestApplicationData` 的 `Prisma.dmmf.datamodel.models` 自动覆盖所有 model（含新表），但若该函数有显式 allowlist 需补 lead/contact/appointment/campaign/lead_pool_record。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 11: 前端线索/客户管理页

**Files:**
- Create: `apps/web/src/api/lead.ts`、`appointment.ts`、`customer.ts`
- Create: `apps/web/src/stores/lead-store.ts`、`customer-store.ts`
- Create: `apps/web/src/pages/leads/LeadListPage.tsx`、`LeadDetailPage.tsx`、`PublicPoolPage.tsx`、`VisitCalendarPage.tsx`
- Create: `apps/web/src/pages/customers/CustomerListPage.tsx`、`CustomerDetailPage.tsx`
- Modify: `apps/web/src/router`（路由+菜单权限）、`apps/web/src/api/types.ts`（若需）
- Test: `apps/web/src/pages/leads/__tests__/LeadListPage.test.tsx` 等 + `apps/web/e2e/lead-crm-flow.spec.ts`

**Interfaces:**
- Consumes: 后端 API（Task 10）、SPEC-004 权限码（菜单 `menu.lead_crm`/`menu.customer`）、现有 Web 鉴权/CSRF/Step-Up 拦截器（SPEC-006）。
- Produces: 线索列表（筛选/分页/数据范围由后端）、详情（跟进时间线）、公海看板（领取）、到访日历、客户列表/详情，桌面+响应式。

- [ ] **Step 1: 写 Vitest 组件测试（RED）**

LeadListPage 渲染、筛选交互、空状态、错误状态；脱敏展示（无字段权限时 phone 显示掩码）。

- [ ] **Step 2: 运行验证失败** `cd apps/web && npm run test`，预期 FAIL。

- [ ] **Step 3: 实现 api 客户端 + stores + pages**

沿用现有 Web 模式（参考 SPEC-003/005 的 pages 结构）。`lead-store.ts` 用 Zustand 管理列表/详情/公海状态。

- [ ] **Step 4: 写 Playwright E2E（RED）**

`e2e/lead-crm-flow.spec.ts`：登录→创建线索→领取→跟进→创建邀约→确认到访→转客户，桌面+移动视口，断言无未捕获异常、关键节点可见。

- [ ] **Step 5: 运行验证通过**

`cd apps/web && npm run test`（Vitest 绿）；`npx playwright test e2e/lead-crm-flow.spec.ts`（E2E 绿）。

- [ ] **Step 6: lint + typecheck + build**

`cd apps/web && npm run lint && npm run typecheck && npm run build`，预期 PASS。

- [ ] **Step 7: 本任务边界可提交（执行者不运行 git）**

---

### Task 12: 验收与收尾

**Files:**
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（更新 model 数=49、迁移数=13 期望）
- Create: `docs/superpowers/runbooks/lead-crm-customer-master-data.md`
- Create: `docs/superpowers/reports/spec-009-closeout.md`

**Interfaces:**
- Consumes: Task 1-11 全部产出。

- [ ] **Step 1: 更新基线契约期望值**

`check-baseline-contract` 的 model 数期望从 45 更新为 49（+Campaign/LeadPoolRecord/Appointment/Contact），迁移数从 12 更新为 13。`npm --prefix apps/server run check:baseline` 预期 PASS。

- [ ] **Step 2: 运行后端全量串行测试（排除 55432 rehearsal 锁定文件）**

设齐 test 环境变量（Global Constraints）。跑 `npm --prefix apps/server run test:unit` 或显式串行清单（排除 `spec-008-acceptance`/`event-observability-load` 两个 55432 锁定文件，因 55433 环境其 rehearsal guard 注定失败）。预期：本 Spec 新增测试全绿，现有测试不回归。

- [ ] **Step 3: 前端全量测试与构建**

`cd apps/web && npm run test && npm run build`，预期 PASS。

- [ ] **Step 4: 安全测试与审计**

`npm run security:test`、`npm run security:audit:prod`，预期 PASS（不放宽既有例外）。

- [ ] **Step 5: migration 重演 + 空库断言**

`npm run db:reset:test`（应用全部 13 迁移）后 `npm run db:assert-empty`，预期所有应用表空。

- [ ] **Step 6: 持久化文档泄漏扫描**

`npm --prefix apps/server run check:docs-leakage`，预期无密钥/连接串/电话明文泄漏。

- [ ] **Step 7: 写运维手册与收尾报告**

`runbooks/lead-crm-customer-master-data.md`（线索回收配置、状态机、转客户流程、事件清单、常见错误码）。`reports/spec-009-closeout.md` 记录工具链、测试计数、迁移/model 数、E2E、安全审计、已知非阻断项（9 个既有 Hook warning、主包大小）、远端门禁未做。

- [ ] **Step 8: 本任务边界可提交（执行者不运行 git）**

---

## Plan 自审

**1. Spec 覆盖**：
- 范围 CRM-01~06 + CUS-01~02 → Task 1(schema)+5(lead)+6(assignment)+7(follow)+8(appointment/customer)+10(api)+11(web)。✓
- 去重多规则+人工 → Task 3 policy + Task 5 service。✓
- 公海私海+可配置回收 → Task 6 + Task 9（调度锁定候选 A，对齐设计 §13）。✓
- 事件接入+pilot → Task 4 + Task 9。✓
- 转客户同事务 → Task 5。✓
- L3 脱敏+数据范围+审计 → Task 3/5 projection + Task 10 api。✓
- 状态机 → Task 3 policy + Task 5/8 service。✓
- 非目标（talk案/NURTURE实现/merge/转介绍表/渠道UI/通知中心/idCard）→ 均在 Task 边界排除。✓

**2. 占位符扫描**：无 TBD/TODO/模糊"添加错误处理"。每个代码步骤有具体内容或明确参考模式。

**3. 类型一致性**：
- `LeadService` 构造签名 `(prisma, actor, authorizationContext)` 在 Task 5/10 一致。
- 事件常量 `LEAD_CREATED` 等在 Task 4 定义、Task 5/6/8/9 引用一致。
- 权限码 `lead.assign`/`lead.convert` 等在 Task 2 定义、Task 10 router 引用一致。
- `assignedAt` 字段：Task 9 Step1 补 schema，须回更 Task 5/6/7 引用——**已在 Task 9 Step1 标注"更新 Task 5/6/7 已写代码引用 assignedAt"**。执行顺序上 Task 5/6/7 先于 Task 9，故执行 Task 5/6/7 时 assignedAt 可能尚未存在——**修正：把 assignedAt 字段并入 Task 1 schema**，避免回更。见下方修正。

**修正（自审发现）**：`Lead.assignedAt` 应在 Task 1 schema 就加入（首响计算依赖它，Task 7 要用），不应推迟到 Task 9。已更新 Task 1 的 Lead 扩充字段列表加入 `assignedAt DateTime?`，Task 9 Step1 改为"确认 assignedAt 已在 Task 1 加入，无需补"。

让我把这个修正落到 plan 文件里。
