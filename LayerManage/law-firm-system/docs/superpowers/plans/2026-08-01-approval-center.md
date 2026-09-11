# SPEC-013 审批中心（Approval Center）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核心审批流（ApprovalDefinition/Instance/Task/CallbackAction）落地 + 退休遗留原型 + refund.approve 真实 Step-Up。

**Architecture:** 独立 `app/domain/approval/` + `app/application/approval/` 模块（镜像 finance/contract 形态）；Apply 建 Instance+Tasks、Process 任一通过+CallbackAction 幂等、Withdraw 本人撤回；事件/审计/权限全链。领域审批（refund/invoice/合同）直连保持，仅 refund.approve 加 Step-Up 加固。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`，残留先 `pg_terminate_backend`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 结构迁移（drop Approval + 4 新表）+ 基线 57→60

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260801xxxxxx_approval_center_expand/migration.sql`
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`、`apps/server/test/ci/baseline-contract.test.ts`、`apps/server/test/db/spec-008-event-observability-migration-contract.test.ts`（57→60 迁移锚点）

**Interfaces:**
- Consumes: 既有 schema 模型。
- Produces: 4 新模型 + drop Approval（Task 2-9 全部依赖）。

- [ ] **Step 1: schema.prisma 4 新模型 + 删 Approval**

在 Approval 模型（:1174-1189）位置：删除 `model Approval` 块；追加：

```prisma
// ==================== 审批中心（SPEC-013） ====================

model ApprovalDefinition {
  id           String   @id @default(uuid())
  code         String   @unique
  name         String
  businessType String // EXPENSE|CONTRACT_CHANGE|SEAL|LEAVE|TRANSFER
  formSchema   Json     // 表单字段+校验规格
  approverRule Json     // {type:'USER',userIds:[...]} | {type:'ROLE',roleCodes:[...]}
  version      Int      @default(1)
  status       String   @default("ACTIVE") // ACTIVE|DISABLED
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model ApprovalInstance {
  id                String   @id @default(uuid())
  definitionId      String
  definitionVersion Int
  businessType      String // EXPENSE|CONTRACT_CHANGE|SEAL|LEAVE|TRANSFER
  title             String
  content           Json // 表单值快照
  applicantId       String
  status            String   @default("PENDING") // PENDING|APPROVED|REJECTED|WITHDRAWN
  decidedBy         String?
  decidedAt         DateTime?
  version           Int      @default(1)
  createdBy         String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  definition ApprovalDefinition @relation(fields: [definitionId], references: [id])
  tasks      ApprovalTask[]

  @@index([applicantId])
  @@index([businessType, status])
  @@map("approval_instance")
}

model ApprovalTask {
  id           String    @id @default(uuid())
  instanceId   String
  nodeName     String    @default("审批")
  assigneeId   String
  status       String    @default("PENDING") // PENDING|APPROVED|REJECTED|CANCELLED
  remark       String?
  processedBy  String?
  processedAt  DateTime?
  version      Int       @default(1)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  instance ApprovalInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@index([assigneeId, status])
  @@map("approval_task")
}

model CallbackAction {
  id           String   @id @default(uuid())
  instanceId   String
  action       String // APPROVE|REJECT
  callbackKey  String   @unique
  status       String   @default("RESPONDED")
  result       Json
  createdAt    DateTime @default(now())

  @@index([instanceId])
  @@map("callback_action")
}
```

- [ ] **Step 2: 迁移 SQL（drop approval + 4 表 + 索引 + FK）**

`20260801xxxxxx_approval_center_expand/migration.sql`：

```sql
DROP TABLE "approval";

CREATE TABLE "approval_definition" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "formSchema" JSONB NOT NULL,
  "approverRule" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_definition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "approval_definition_code_key" ON "approval_definition"("code");

CREATE TABLE "approval_instance" (
  "id" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "businessType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "applicantId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_instance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_instance_applicantId_idx" ON "approval_instance"("applicantId");
CREATE INDEX "approval_instance_businessType_status_idx" ON "approval_instance"("businessType", "status");
ALTER TABLE "approval_instance" ADD CONSTRAINT "approval_instance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "approval_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "approval_task" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "nodeName" TEXT NOT NULL DEFAULT '审批',
  "assigneeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "remark" TEXT,
  "processedBy" TEXT,
  "processedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_task_assigneeId_status_idx" ON "approval_task"("assigneeId", "status");
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "callback_action" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "callbackKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESPONDED',
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "callback_action_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "callback_action_callbackKey_key" ON "callback_action"("callbackKey");
CREATE INDEX "callback_action_instanceId_idx" ON "callback_action"("instanceId");
```

- [ ] **Step 3: 基线锚点 57→60 同步**

`check-baseline-contract.ts:10` `CANONICAL_PRISMA_MODEL_COUNT` 57→60；`baseline-contract.test.ts`（fixture 期望消息 + 生成器 parity）；`spec-008-event-observability-migration-contract.test.ts`（迁移计数 21→22）。运行 `npm run db:generate` 再生 Prisma Client。

- [ ] **Step 4: 闸门**

`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` 零 diff（迁移与 schema 一致）；`npx tsx --test --test-concurrency=1 --test-force-exit test/ci/baseline-contract.test.ts test/db/spec-008-event-observability-migration-contract.test.ts` 全绿；`npx tsc --noEmit` 0 错。

---

### Task 2: 权限 +3 + Definition 种子 provisioning + parity

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`、`permission-catalog.ts`
- Create: `apps/server/prisma/migrations/20260801xxxxxx_approval_provision/migration.sql`
- Modify: `apps/server/test/authorization/permission-catalog-finance.test.ts`（或新建 approval parity）
- Modify: `apps/web/src/features/authorization/types.ts`（+3 码）

**Interfaces:**
- Consumes: Task 1 模型。
- Produces: `approval.read/apply/process` 三码 + 5 Definition 种子（Task 5/6/8 消费）。

- [ ] **Step 1: catalog +3 码**

`permission-catalog.ts`（refund 族后追加）：

```ts
permission('approval.read', '查看审批中心', 'ACTION', 'approval', 'read', 'LOW'),
permission('approval.apply', '发起审批申请', 'ACTION', 'approval', 'apply', 'MEDIUM'),
permission('approval.process', '处理审批任务', 'ACTION', 'approval', 'process', 'HIGH'),
```

`authorization-types.ts`：RESOURCE_CODES +'approval'；PERMISSION_CODES +3。前端 `types.ts` +3。计数 118→121 同步（grep 计数断言）。

- [ ] **Step 2: provisioning 迁移（3 权限 + 5 Definition 种子）**

`20260801xxxxxx_approval_provision/migration.sql`（权限行 `ON CONFLICT DO NOTHING`；Definition 种子 `ON CONFLICT (code) DO NOTHING`）：

```sql
INSERT INTO "permission" ("id","code","name","type","resource","action","riskLevel","status","version")
VALUES
  (gen_random_uuid(), 'approval.read', '查看审批中心', 'ACTION', 'approval', 'read', 'LOW', 'ACTIVE', 1),
  (gen_random_uuid(), 'approval.apply', '发起审批申请', 'ACTION', 'approval', 'apply', 'MEDIUM', 'ACTIVE', 1),
  (gen_random_uuid(), 'approval.process', '处理审批任务', 'ACTION', 'approval', 'process', 'HIGH', 'ACTIVE', 1)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "approval_definition" ("id","code","name","businessType","formSchema","approverRule","version","status","createdBy")
VALUES
  (gen_random_uuid(), 'LEAVE', '请假申请', 'LEAVE',
   '{"fields":[{"key":"startDate","label":"开始日期","type":"date","required":true},{"key":"endDate","label":"结束日期","type":"date","required":true},{"key":"reason","label":"事由","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["HR"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), 'SEAL', '用印申请', 'SEAL',
   '{"fields":[{"key":"sealType","label":"用印类型","type":"text","required":true},{"key":"docCount","label":"份数","type":"number","required":true}]}',
   '{"type":"ROLE","roleCodes":["SEAL_ADMIN"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), 'EXPENSE', '费用报销', 'EXPENSE',
   '{"fields":[{"key":"amount","label":"金额","type":"number","required":true},{"key":"category","label":"类别","type":"text","required":true}]}',
   '{"type":"ROLE","roleCodes":["FINANCE"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), 'CONTRACT_CHANGE', '合同变更', 'CONTRACT_CHANGE',
   '{"fields":[{"key":"contractId","label":"合同","type":"text","required":true},{"key":"changeSummary","label":"变更摘要","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["PARTNER"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), 'TRANSFER', '转所申请', 'TRANSFER',
   '{"fields":[{"key":"targetTeam","label":"目标团队","type":"text","required":true},{"key":"reason","label":"事由","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["HR"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000')
ON CONFLICT ("code") DO NOTHING;
```

**impl 验证点**：`roleCodes`（HR/SEAL_ADMIN/FINANCE/PARTNER）须在运行时角色目录存在——核实 bootstrap role 目录，缺则调整种子（记于报告）。

- [ ] **Step 3: parity 测试**

权限 parity：approval.read/apply/process 三码 catalog↔迁移↔前端 四处一致断言（沿 SPEC-011 Task 2 S15 双键形态）；Definition 种子 5 行直查断言（reset 后 count=5、逐 code/name/businessType/approverRule）。

- [ ] **Step 4: 闸门**

parity 测试全绿 + tsc 0 + eslint 0 + `npm --prefix apps/web run typecheck` 0。

---

### Task 3: 事件注册（approval.instance.created/completed）

**Files:**
- Modify: `apps/server/app/domain/events/event-types.ts`、`event-registry.ts`
- Modify: `apps/server/test/contract/contract-events.test.ts`（或新建 approval-events 测试）

**Interfaces:**
- Consumes: —
- Produces: `APPROVAL_INSTANCE_CREATED`/`APPROVAL_INSTANCE_COMPLETED` 常量 + 接口 + registry（Task 5 服务消费）。

- [ ] **Step 1: 常量/接口（沿 SPEC-012 payment_plan.cancelled 形态）**

`event-types.ts`：

```ts
export const APPROVAL_INSTANCE_CREATED = 'approval.instance.created';
export const APPROVAL_INSTANCE_COMPLETED = 'approval.instance.completed';

export interface ApprovalInstanceCreatedV1 {
  instanceId: string;
  businessType: string;
  title: string;
  applicantId: string;
  status: 'PENDING';
}

export interface ApprovalInstanceCompletedV1 {
  instanceId: string;
  businessType: string;
  status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
}
```

- [ ] **Step 2: registry 定义 + 注册（沿 paymentPlanCancelledV1Definition 形态）**

`event-registry.ts`：`APPROVAL_INSTANCE_CREATED_STATUSES = new Set(['PENDING'])`、`APPROVAL_INSTANCE_COMPLETED_STATUSES = new Set(['APPROVED','REJECTED','WITHDRAWN'])`；两 definition（sourceModule 'APPROVAL'、objectType 'APPROVAL_INSTANCE'、created filterFields {businessType, title, applicantId, status}、completed filterFields {businessType, status}、extractObjectId=instanceId、assertExactKeys 恰 5/3 键）；Map 注册 2 项。

- [ ] **Step 3: 测试 + 闸门**

写读闭环（合法载荷解析/extractObjectId/缺键/错 status 拒绝/envelope sourceModule APPROVAL）+ 串行跑全绿 + tsc + eslint 0。

---

### Task 4: domain 层（approval-types/errors/policy）+ 单测

**Files:**
- Create: `apps/server/app/domain/approval/approval-types.ts`、`approval-errors.ts`、`approval-policy.ts`
- Create: `apps/server/test/approval/approval-policy.test.ts`

**Interfaces:**
- Consumes: Task 1/3 词汇与事件。
- Produces: 词汇/7 错误码/纯函数（Task 5 服务消费）。

- [ ] **Step 1: 逐字代码（沿 finance domain 形态，纯领域零 DB）**

`approval-types.ts`：

```ts
export const APPROVAL_BUSINESS_TYPES = ['EXPENSE', 'CONTRACT_CHANGE', 'SEAL', 'LEAVE', 'TRANSFER'] as const;
export type ApprovalBusinessType = typeof APPROVAL_BUSINESS_TYPES[number];
export const APPROVER_RULE_TYPES = ['USER', 'ROLE'] as const;
export type ApproverRule = { type: 'USER'; userIds: string[] } | { type: 'ROLE'; roleCodes: string[] };
export const INSTANCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApprovalInstanceStatus = typeof INSTANCE_STATUSES[number];
export const TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalTaskStatus = typeof TASK_STATUSES[number];
```

`approval-errors.ts`（7 码，FinanceError 形态）：`APPROVAL_DEFINITION_NOT_FOUND`404 / `APPROVAL_INSTANCE_NOT_FOUND`404 / `APPROVAL_TASK_NOT_FOUND`404 / `APPROVAL_STATE_INVALID`409 / `APPROVAL_SELF_REVIEW_FORBIDDEN`409 / `APPROVAL_ASSIGNEE_INVALID`400 / `CALLBACK_KEY_CONFLICT`409；`ApprovalError` 载体。

`approval-policy.ts` 纯函数（逐字）：

```ts
export function resolveApproverRule(
  rule: ApproverRule,
  roleMemberByCode: Record<string, string[]>,
): string[] {
  if (rule.type === 'USER') return [...rule.userIds];
  const ids = rule.roleCodes.flatMap((code) => roleMemberByCode[code] ?? []);
  return [...new Set(ids)];
}

export function canTransitionInstance(
  from: ApprovalInstanceStatus,
  to: 'APPROVED' | 'REJECTED' | 'WITHDRAWN',
): boolean {
  if (from !== 'PENDING') return false;
  return true;
}

export function assertNotSelfReview(applicantId: string, approverIds: string[]): void {
  if (approverIds.includes(applicantId)) {
    throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409, 'applicant cannot be approver');
  }
}
```

- [ ] **Step 2: 测试矩阵**

resolveApprovers USER/ROLE（含 ROLE 空成员→空集、去重）；canTransitionInstance 终态先行；assertNotSelfReview 命中 409。纯函数单测零 DB。

- [ ] **Step 3: 闸门**

`test/approval/approval-policy.test.ts` 全绿 + tsc + eslint 0。

---

### Task 5: definition-service + instance-service + 测试

**Files:**
- Create: `apps/server/app/application/approval/approval-types.ts`（DTO）、`approval-definition-service.ts`、`approval-instance-service.ts`
- Create: `apps/server/test/approval/approval-instance-service.test.ts`

**Interfaces:**
- Consumes: Task 3 事件、Task 4 领域层。
- Produces: `ApprovalInstanceService`：applyForApproval/listInstances/getInstance/processTask/withdrawInstance；`ApprovalDefinitionService`：getActiveDefinition/listDefinitions（Task 6 controller、Task 8 前端消费）。

- [ ] **Step 1: DTO**

`approval-types.ts`（应用层）：`ApplyApprovalInput { definitionCode, title, content, idempotencyKey? }`、`ProcessTaskInput { action: 'APPROVE'|'REJECT', remark?, idempotencyKey? }`、`WithdrawInput { reason? }`、`ListApprovalsQuery { page?, pageSize?, role: 'APPLIED'|'TODO'|'DONE' }`、`ApprovalInstanceView`（全字段投影）。

- [ ] **Step 2: definition-service**

`getActiveDefinition(code)`：findFirst {code, status:'ACTIVE'} → 404；`listDefinitions()`：ACTIVE 列表（前端表单渲染用）。

- [ ] **Step 3: instance-service 实现（TDD 先行）**

- **applyForApproval**（approval.apply）：definition 解析 → content 校验（formSchema 必填字段）→ resolveApproverRule（role 成员经 `roleMemberByCode` 解析——查询 `role.rolePermission.userPermission.employee` 映射，或直接查 user_role/role 成员表；**impl 按仓库角色-成员模型落地**）→ 空集 ASSIGNEE_INVALID 400 → assertNotSelfReview 409 → 单事务：Instance PENDING + N Task PENDING + `approval.instance.created` + APPROVAL_APPLY 审计。
- **processTask**（approval.process）：task 探查（instanceId + assigneeId=actor）→ CallbackAction 幂等（callbackKey=idempotencyKey；重复→重读首结果零副作用）→ task {id,version,status:PENDING}→action（version+1）；count=0→重读已处理→幂等返回/STATE_INVALID 409 → **任一通过**：task APPROVED → instance PENDING→APPROVED（decidedBy/At）+ 其余 PENDING task → CANCELLED；task REJECTED → instance→REJECTED + 其余 CANCELLED → `approval.instance.completed` + APPROVAL_PROCESS 审计。
- **withdrawInstance**（approval.apply）：instance {id, applicantId=actor, status:PENDING}→WITHDRAWN + 待办 task→CANCELLED → `completed(WITHDRAWN)` + APPROVAL_WITHDRAW 审计。
- **listInstances**（approval.read）：role=APPLIED→applicantId=actor；TODO→task.assigneeId=actor AND task.status=PENDING；DONE→task.assigneeId=actor AND task.status!=PENDING；分页。
- **getInstance**（approval.read）：applicantId=actor OR tasks.some(assigneeId=actor) → 404 否则。

- [ ] **Step 4: 测试矩阵**

apply（definition 404/内容缺必填 400/空审批人 400/自审 409/成功 N task+事件+审计）；process（非我 task 404/任一通过定稿+余 task CANCELLED/重复 callbackKey 幂等零事件/REJECTED 定稿）；withdraw（非本人 404/非 PENDING 409/成功+task 取消+completed(WITHDRAWN)）；list/get（三 role 过滤/404 fail-closed）。TDD RED→GREEN。

- [ ] **Step 5: 闸门**

`test/approval/approval-instance-service.test.ts` 全绿 + tsc + eslint 0。

---

### Task 6: controller/router/errorHandler/factory + 旧面退休 + API 测试

**Files:**
- Create: `apps/server/app/application/approval/approval-factory.ts`、`apps/server/app/controller/approval.ts`（重写——旧原型退休）
- Modify: `apps/server/app/router.ts`（:231-234 旧 4 路由替换为门禁 5 路由）、`apps/server/app/middleware/errorHandler.ts`（+ApprovalError 分支）
- Create: `apps/server/test/app/approval-api.test.ts`

**Interfaces:**
- Consumes: Task 5 服务。
- Produces: 5 门禁路由（Task 8 前端消费）。

- [ ] **Step 1: factory + controller 重写 + errorHandler + 路由**

`approval-factory.ts`：`approvalDefinitionService(ctx)`/`approvalInstanceService(ctx)`（3 参+可选 outbox，沿 finance-factory 形态）。
`controller/approval.ts`：重写为薄控制器（CREATE_BODY_KEYS/ACTION_BODY_KEYS/assertExactKeys/respond 包络）——index/show/create/withdraw/process 五方法。
`errorHandler.ts`：+ApprovalError 分支（仿 ContractError/FinanceError）。
`router.ts`：:231-234 旧 4 无权限路由 → 门禁 5 路由（设计 §4.3）。

- [ ] **Step 2: API 测试矩阵**

apply/process/withdraw/list/get E2E + 三权限门禁 403 + 越权/404 + body 未知键 400 + 端到端绿路径（apply→process 定稿→列表状态）。TDD 先行。

- [ ] **Step 3: 闸门**

`test/app/approval-api.test.ts` 全绿 + `test/approval/` 目录全绿 + `test/contract/`（router 改动回归）+ tsc + eslint 0。

---

### Task 7: Step-Up（REFUND_APPROVE 目的位 + refund approve 接线 + 前端 useStepUp）

**Files:**
- Modify: `apps/server/app/domain/security/step-up-target.ts`（+REFUND_APPROVE）
- Modify: `apps/server/app/application/finance/refund-service.ts`（approve 校验 step-up 证明）或 controller 层
- Modify: `apps/web/src/pages/refunds/RefundListPage.tsx`（审批按钮接 useStepUp）
- Test: 对应测试

**Interfaces:**
- Consumes: Task 1-6。
- Produces: refund.approve 真实 MFA 重验（SPEC-011 follow-up 落地）。

- [ ] **Step 1: 目的位**

`step-up-target.ts`：STEP_UP_PURPOSES +`'REFUND_APPROVE'`；normalizeTarget case：

```ts
case 'REFUND_APPROVE': {
  const value = exactRecord(raw, ['refundRequestId', 'expectedVersion']);
  return { refundRequestId: requiredString(value.refundRequestId), expectedVersion: positiveInteger(value.expectedVersion) };
}
```

- [ ] **Step 2: 后端接线**

refund approve 动作（controller 或 service 入口）沿 `governance-step-up.ts` 形态校验 Step-Up 证明（purpose=REFUND_APPROVE、target 绑定 refundRequestId+expectedVersion）→ 校验通过才翻转。测试：持证通过 / 无证 403 / 目标不匹配 400 / expectedVersion 不符 409。

- [ ] **Step 3: 前端 useStepUp**

RefundListPage 审批按钮 → `useStepUp().run({ purpose: 'REFUND_APPROVE', verify: () => authApi.stepUp(...), mutate: (token) => refundApi.approve(...) })`（沿 admin-governance 前端 useStepUp 用法）。测试：按钮触发挑战、持证调用、取消不调用。

- [ ] **Step 4: 闸门**

相关测试全绿 + tsc/eslint（前后端）+ 前端受影响件隔离。

---

### Task 8: 前端审批中心页 + 旧页退休

**Files:**
- Create: `apps/web/src/api/approval.ts`、`apps/web/src/stores/approval-store.ts`、`apps/web/src/pages/approvals/ApprovalCenterPage.tsx`
- Modify: `apps/web/src/App.tsx`（:151 旧 /approvals 路由→新页）、`apps/web/src/components/Layout/index.tsx`（菜单沿用）
- 退休：`apps/web/src/pages/Approval/index.tsx`（删）、`apps/web/src/api/organization.ts`（approval 段删）、`apps/web/src/types/index.ts`（Approval 接口删）
- Test: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`

**Interfaces:**
- Consumes: Task 5/6 契约。
- Produces: 审批中心页（我的申请/待办/已办三 Tab + 新建表单 + 处理动作）。

- [ ] **Step 1: api + store**

`api/approval.ts`：list(idempotencyKey 形态)/detail/apply/process/withdraw + ApprovalDefinitionView/ApprovalInstanceView。`approval-store.ts`：三 Tab 状态 + apply/process/withdraw 动作（沿 payment-store 形态）。

- [ ] **Step 2: 页面**

三 Tab（我的申请/我的待办/我的已办）+ 新建申请 Modal（按 Definition 五类选表单——LEAVE 起止日期/事由、SEAL 用印类型/份数、EXPENSE 金额/类别、CONTRACT_CHANGE 合同/变更摘要、TRANSFER 目标团队/事由，content 提交）+ 待办行审批/驳回动作（reason 可选）+ 详情弹窗。行操作按钮权限门控（approval.process）。

- [ ] **Step 3: 旧页退休**

删 `pages/Approval/`、`api/organization.ts` approval 段、`types/index.ts` Approval 接口；App.tsx/Layout 指向新页（菜单「审批管理」沿用）。

- [ ] **Step 4: 测试 + 四闸门**

页面测试（三 Tab 渲染/新建表单提交/处理动作/权限按钮隐现）非恒真；`npm --prefix apps/web run test`（受影响件隔离）+ typecheck + lint + build。

---

### Task 9: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（或新增 approval runbook 节）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-013-closeout.md`

**Interfaces:**
- Consumes: Task 1-8 全部。
- Produces: 计数链终态 + follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗纪律），预期既有 1652 + 本 SPEC 新增全绿 0 fail（spec-008 3 例 port-guard 照录）。

- [ ] **Step 2: 前端 + 安全 + 迁移 + baseline**

前端四闸门（新件全绿 + 基线 flake 照录）；`npm run security:test` 34/34 零新增；迁移实证（22 expand + 23 provisioning → **23 迁移**）+ 重演幂等；check:baseline（23/60）+ check:bootstrap PASS；docs-leakage exit 0（task 报告沿用占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook 增「审批中心」节（Definition 种子/流程/幂等/Step-Up/事件）；closeout 十一节（计数链——迁移 23/模型 60/权限 121/事件 15/路由 approval 4→5/前端页替换、裁决录 D1-D10、已知非阻断项、follow-up 路由——多级审批/会签/转交/超时/Definition 管理/全组织视图/审批人表达式等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 模型→Task 1；§4 事件/权限/路由→Task 2/3/6；§5 架构→Task 4/5/6；§6 行为→Task 5；§7 Step-Up→Task 7；§9 前端→Task 8；§10 测试→各任务+Task 9；§12 边界→全部任务守住。零缺口。
- **占位符扫描**：无 TBD/TODO；`roleMemberByCode` 解析（role→成员映射）标注"impl 按仓库角色-成员模型落地"为明示动作；`gen_random_uuid()` 沿用既有 provisioning 迁移形态。全代码可直接转写。
- **类型一致性**：`ApprovalInstanceService` 五方法签名 Task 5 定义=Task 6 controller 消费=Task 8 api 客户端；`ApprovalDefinitionService` getActiveDefinition/listDefinitions Task 5 定义=Task 8 表单渲染消费；事件常量/接口 Task 3 定义=Task 5 服务消费=registry 断言；权限码 Task 2 表=Task 6 路由表=Task 8 按钮门控；`REFUND_APPROVE` Task 7 定义=normalizeTarget=refund 接线。
