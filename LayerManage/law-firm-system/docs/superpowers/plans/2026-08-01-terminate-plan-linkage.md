# SPEC-012 终止-计划联动（Terminate–Plan Linkage）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终止（EFFECTIVE→TERMINATED）时取消未清付款计划期望（终态 CANCELLED + 逐计划事件），并加在途互斥与竞速门禁。

**Architecture:** `cancelUnsettledPlans` 模块函数（仿 sweepBackReceived 先例，计划取消唯一实现）被 terminate 经 `transitionContract` 新增 before/after 挂钩调用；在途校验（RefundRequest/Payment PENDING）+ confirm TERMINATED 门禁 + sweep 保 CANCELLED 形成闭环。零新表/列/权限/路由；事件 12→13。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（后端串行）/ React 19 + AntD 6 + Vitest（前端）。

## Global Constraints

- 禁止任何 git 命令（零 add/commit/push/PR/merge）。
- 测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`（localhost 偶发 IPv6::1→wslrelay 假连）；DB 闸门前探 `pg_stat_activity=0`，残留先 `pg_terminate_backend` 清理。
- 测试库 `_test` 结尾且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；不修改 `.env`/生产库/密钥文件。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）。
- TDD：失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 事件注册 + 词位（payment_plan.cancelled + PAYMENT_PLAN objectType + CANCELLED 词位）

**Files:**
- Modify: `apps/server/app/domain/events/event-types.ts`
- Modify: `apps/server/app/domain/events/event-registry.ts`
- Modify: `apps/server/prisma/schema.prisma`（PaymentPlan.status 注释）
- Modify: `apps/server/test/contract/contract-events.test.ts`

**Interfaces:**
- Consumes: 既有 event registry 形态（contractStatusChangedV1Definition :428-446 为镜像母版）。
- Produces: `PAYMENT_PLAN_CANCELLED` 常量 + `PaymentPlanCancelledV1` 接口 + registry 定义（Task 4 `cancelUnsettledPlans` 消费）。

- [ ] **Step 1: 词位 + 事件常量/接口**

`event-types.ts`：在 `ContractStatusChangedV1`（:100-104）同区追加：

```ts
export interface PaymentPlanCancelledV1 {
  planId: string;
  contractId: string;
  status: 'CANCELLED';
}
```

在事件常量块追加：`export const PAYMENT_PLAN_CANCELLED = 'payment_plan.cancelled';`

`schema.prisma` PaymentPlan.status 行（:925）注释更新：

```prisma
  status         String    @default("PENDING") // PENDING|PARTIAL|RECEIVED|CANCELLED|OVERDUE
```

`receivable-service.ts` 的 `WritablePlanStatus`（:280 附近）联合扩展 `| 'CANCELLED'`（cancelUnsettledPlans 写入 CANCELLED 需要——见 Task 3）。

- [ ] **Step 2: registry 定义 + 注册**

`event-registry.ts`：在 `contractStatusChangedV1Definition` 后追加（逐形镜像，status 钉死单值集）：

```ts
const PAYMENT_PLAN_CANCELLED_STATUSES: ReadonlySet<string> = new Set(['CANCELLED']);

const paymentPlanCancelledV1Definition: EventDefinition<PaymentPlanCancelledV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'PAYMENT_PLAN',
  filterFields: new Set(['status', 'contractId']),
  parsePayload(payload: unknown): PaymentPlanCancelledV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, ['planId', 'contractId', 'status'], 'payment_plan.cancelled v1 payload');

    const planId = requireUuid(record.planId, 'planId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!PAYMENT_PLAN_CANCELLED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return { planId, contractId, status: status as 'CANCELLED' };
  },
  extractObjectId(payload: PaymentPlanCancelledV1): string {
    return payload.planId;
  },
};
```

注册表 Map（:912 `contract.status_changed` 行之后）：`[ eventKey('payment_plan.cancelled', 1), paymentPlanCancelledV1Definition ],`。若既有测试钉 12 事件计数（grep `12`），同步 12→13。

- [ ] **Step 3: contract-events.test.ts 补覆盖 + 迁移实证**

新增测试（沿 finance-events 写读闭环形态）：合法载荷 `{planId, contractId, status:'CANCELLED'}` 解析通过 + extractObjectId=planId；缺/多键 TypeError；错 status（'PENDING'/'RECEIVED'）TypeError；envelope sourceModule='CONTRACT'/objectType='PAYMENT_PLAN'。断言非恒真（真实 parse + 拒绝）。

迁移实证：`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`——若仅注释 diff（`status` 列注释），无结构迁移则零迁移；若产出 DDL（Prisma 版本跟踪注释），建注释级迁移 `prisma migrate dev --create-only` 命名 `20260801xxxxxx_plan_status_comment`。记录实测结果于报告。

- [ ] **Step 4: 闸门**

串行跑 `test/contract/contract-events.test.ts` 全绿 + `npx tsc --noEmit` 0 错 + `npx eslint app/domain test/contract` 0 错。

---

### Task 2: 错误码 + transitionContract 挂钩

**Files:**
- Modify: `apps/server/app/domain/contract/contract-errors.ts`
- Modify: `apps/server/app/application/contract/contract-service.ts`（transitionContract 挂钩 + terminateContract 接线）

**Interfaces:**
- Consumes: Task 1 `PAYMENT_PLAN_CANCELLED`（Task 4 用）。
- Produces: `CONTRACT_TERMINATE_CONFLICT`（409）+ `transitionContract` before/after 挂钩（Task 4 terminate 接线）。

- [ ] **Step 1: 错误码 4 点落位**

`contract-errors.ts`：在 `CONTRACT_APPROVAL_PENDING`（:10）后插入 `CONTRACT_TERMINATE_CONFLICT`（CONTRACT_ 族语义邻近，409）：

```ts
export const CONTRACT_TERMINATE_CONFLICT = 'CONTRACT_TERMINATE_CONFLICT';
```

四点：①个体常量 ②`ContractErrorCode` 联合成员（:17-27 中加）③`CONTRACT_ERROR_CODES` 聚合（:30-41 中加）④`CONTRACT_ERROR_HTTP_STATUS`（:44-55 中加 `[CONTRACT_TERMINATE_CONFLICT]: 409`）。

- [ ] **Step 2: transitionContract 挂钩（before/after）**

`contract-service.ts` transitionContract（:581-584）changes 类型扩展：

```ts
    changes: {
      data: Prisma.ContractUncheckedUpdateManyInput;
      auditExtras: () => Record<string, unknown>;
      before?: (tx: Prisma.TransactionClient, contract: Contract) => Promise<void>;
      after?: (tx: Prisma.TransactionClient, contract: Contract) => Promise<Record<string, unknown>>;
    },
```

方法体：状态机校验通过后（:604 后）、updateMany 翻转（:606）前加：

```ts
      if (changes.before) await changes.before(tx, contract);
```

翻转 + `contract.status_changed` 出账（:618）后、operationLog（:619）前加：

```ts
      const afterResult = changes.after ? await changes.after(tx, contract) : {};
```

operationLog newValues 合并（:630）：

```ts
            ...changes.auditExtras(),
            ...afterResult,
```

既有 6 个调用方（submit/approve/reject/sign/effect/void）零改动（before/after 可选）。

- [ ] **Step 3: 闸门**

串行跑 `test/contract/contract-service.test.ts` 全绿（既有流转零回归）+ tsc 0 + eslint 0。

---

### Task 3: cancelUnsettledPlans 模块函数 + 单测

**Files:**
- Modify: `apps/server/app/application/contract/receivable-service.ts`（尾部追加）
- Create: `apps/server/test/contract/plan-cancel.test.ts`

**Interfaces:**
- Consumes: Task 1 `PAYMENT_PLAN_CANCELLED` + `PaymentPlanCancelledV1`；envelope 形态 :753-772。
- Produces: `cancelUnsettledPlans(tx, contract, outbox, actorUserId): Promise<{ canceledCount }>`（Task 4 terminate after 挂钩消费）。

- [ ] **Step 1: 失败测试先行**

`test/contract/plan-cancel.test.ts`（夹具沿 receivable-service.test.ts：直建合同+计划行形态）测试矩阵：

1. 混合批量：三期（5k PENDING / 4k 收 1k PARTIAL / 2k RECEIVED）→ PENDING+PARTIAL 转 CANCELLED、RECEIVED 不动；version+1；canceledCount=2。
2. 逐事件：outbox 恰 2 条 `payment_plan.cancelled`，payload 逐键 {planId, contractId, status:'CANCELLED'}，sourceModule CONTRACT / objectType PAYMENT_PLAN。
3. vacuous：全 RECEIVED → canceledCount=0、零事件。
4. 金额保持：CANCELLED 计划 amount 保原值、receivedAmount 保实际已收（1k 不动）。

- [ ] **Step 2: 实现**

`receivable-service.ts` 尾部（sweepBackReceived 后）追加：

```ts
/**
 * 计划期望取消（SPEC-012 Task 3）：调用方须已持 Contract 行 FOR UPDATE 锁。
 * 未清计划（PENDING/PARTIAL）逐计划转 CANCELLED（amount 保原始期望额、receivedAmount
 * 保实际已收），同事务 outbox 逐计划发 payment_plan.cancelled；RECEIVED 不动；返回 count。
 */
export async function cancelUnsettledPlans(
  tx: Prisma.TransactionClient,
  contract: Pick<Contract, 'id' | 'branchId' | 'professionalTeamId'>,
  outbox: EventOutboxWriter,
  actorUserId: string,
): Promise<{ canceledCount: number }> {
  const plans = await tx.paymentPlan.findMany({
    where: { contractId: contract.id, status: { in: ['PENDING', 'PARTIAL'] } },
    orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
  });
  for (const plan of plans) {
    await tx.paymentPlan.update({
      where: { id: plan.id },
      // 注（Task 3 评审追认）：PaymentPlan 无 updatedBy 列（迁移 20260730120000 建表仅
      // createdBy/createdAt/updatedAt）——不写 updatedBy；取消操作者经事件信封 operatorUserId 追溯。
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    const payload: PaymentPlanCancelledV1 = { planId: plan.id, contractId: contract.id, status: 'CANCELLED' };
    await outbox.append(tx, {
      eventType: PAYMENT_PLAN_CANCELLED,
      eventVersion: 1,
      objectType: 'PAYMENT_PLAN',
      objectId: plan.id,
      operatorUserId: actorUserId,
      organizationId: null,
      branchId: contract.branchId ?? null,
      teamId: contract.professionalTeamId ?? null,
      payload,
      traceId: randomUUID(),
      occurredAt: new Date(),
    });
  }
  return { canceledCount: plans.length };
}
```

注：模块函数无 `this.actor.requestId`，traceId 用 randomUUID()（与 contract.status_changed 的请求追踪解耦，记录为已知边界）。

- [ ] **Step 3: 跑绿**

串行跑 `test/contract/plan-cancel.test.ts` 全绿 + tsc 0 + eslint 0。

---

### Task 4: terminateContract 扩展（在途校验 + 计划取消 + 审计 count）+ 集成测试

**Files:**
- Modify: `apps/server/app/application/contract/contract-service.ts`（terminateContract）
- Create: `apps/server/test/contract/terminate-plan-linkage.test.ts`

**Interfaces:**
- Consumes: Task 2 `CONTRACT_TERMINATE_CONFLICT` + before/after 挂钩；Task 3 `cancelUnsettledPlans`。
- Produces: 完整 terminate 行为（Task 6 前端消费 canceledPlanCount 语义）。

- [ ] **Step 1: 失败测试先行**

`test/contract/terminate-plan-linkage.test.ts`（夹具沿 receivable-service.test.ts）矩阵：

1. 在途退款阻止：EFFECTIVE 合同 + PENDING RefundRequest → terminate `CONTRACT_TERMINATE_CONFLICT` 409，合同仍 EFFECTIVE、计划未动、零事件。
2. 在途收款阻止：+ PENDING Payment → 同 409。
3. REJECTED/EXECUTED 在途不阻：历史已决申请 → terminate 成功。
4. 成功取消：三期（5k PENDING/4k 收 1k PARTIAL/2k RECEIVED）→ 合同 TERMINATED、PENDING+PARTIAL 转 CANCELLED、RECEIVED 不动、contract.receivedAmount 不变、恰 2 条 `payment_plan.cancelled` + 1 条 `contract.status_changed`、审计含 `canceledPlanCount: 2`。
5. 竞速（confirm vs terminate，持锁钉法沿 receivable-service.test.ts:1119-1134）：第三方事务持合同锁 1s 造确定性串行——confirm 先胜 → terminate 随后成功（PENDING 已被确认解决）；terminate 先胜 → confirm 随后 `PAYMENT_STATE_INVALID` 409（Task 5 门禁兜底，本用例可先跑后补断言）。

- [ ] **Step 2: 实现**

`contract-service.ts` terminateContract（:486-494）改：

```ts
  async terminateContract(id: string, input: TerminateContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.terminate');
    assertExactKeys(input, ['reason']);
    const reason = normalizeRequiredText(input.reason, 1, 500);
    return this.transitionContract(id, 'contract.terminate', 'terminate', 'CONTRACT_TERMINATE', {
      data: { terminatedAt: new Date(), terminateReason: reason },
      auditExtras: () => ({ hasReason: true }),
      before: async (tx, contract) => {
        const inFlightRefund = await tx.refundRequest.findFirst({
          where: { contractId: contract.id, status: { in: ['PENDING', 'APPROVED'] } },
        });
        if (inFlightRefund) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT,
            409,
            'cannot terminate: in-flight refund/waiver request exists',
          );
        }
        const inFlightPayment = await tx.payment.findFirst({
          where: { contractId: contract.id, status: 'PENDING', deletedAt: null },
        });
        if (inFlightPayment) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT,
            409,
            'cannot terminate: in-flight payment pending confirmation',
          );
        }
      },
      after: async (tx, contract) => {
        const { canceledCount } = await cancelUnsettledPlans(tx, contract, this.outbox, this.actor.actorUserId);
        return { canceledPlanCount: canceledCount };
      },
    });
  }
```

需 import `cancelUnsettledPlans`（contract-service 已 import receivable-service :104 行族）。

- [ ] **Step 3: 跑绿**

串行跑 `test/contract/terminate-plan-linkage.test.ts` + `test/contract/contract-service.test.ts`（既有 terminate 用例零回归）+ tsc + eslint 0。

---

### Task 5: confirm TERMINATED 门禁 + applyToPlan 排除 + sweepBackReceived 保 CANCELLED

**Files:**
- Modify: `apps/server/app/application/contract/receivable-service.ts`
- Modify: `apps/server/test/contract/receivable-void.test.ts` 或 `terminate-plan-linkage.test.ts`（补测试）

**Interfaces:**
- Consumes: Task 4 竞速用例补断言。
- Produces: 竞速闭环（terminate 先胜后 confirm 兜底）。

- [ ] **Step 1: 失败测试先行**

补测试（挂 terminate-plan-linkage.test.ts 竞速用例断言 + 独立用例）：
1. 独立门禁：TERMINATED 合同 + PENDING payment → confirm `PAYMENT_STATE_INVALID` 409，payment 仍 PENDING、零事件零审计。
2. applyToPlan 排除：CANCELLED 计划 + confirm 冲抵 → 该计划不被分摊（金额转后续未取消计划）。
3. sweep 保 CANCELLED：CANCELLED 计划（收 1k/5k）+ 终止后整单退款 1k → sweep 冲减 receivedAmount 至 0、**状态恒 CANCELLED**（不回 PENDING）。

- [ ] **Step 2: 实现**

`receivable-service.ts`：

a) confirmPayment 持锁重读合同后（:414 后）加门禁：

```ts
      // SPEC-012 Task 5：终止后不可再确认（竞速闭环——terminate 阻止 PENDING，但 confirm
      // 与 terminate 竞速时若 terminate 先胜，锁后确认到已终止合同由本门禁兜住）。
      if (contract.status === 'TERMINATED') {
        throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID, 409, 'cannot confirm payment for terminated contract');
      }
```

b) applyToPlan（:680-682）加 CANCELLED 跳过（defense-in-depth——有效 confirm 期间计划不可已 CANCELLED）：

```ts
    const plan = await tx.paymentPlan.findUniqueOrThrow({ where: { id: planId } });
    if (plan.status === 'CANCELLED') return amount; // SPEC-012 Task 5：CANCELLED 计划不再分摊
    const applied = Prisma.Decimal.min(amount, plan.amount.minus(plan.receivedAmount));
```

c) sweepBackReceived 状态重推导（:855）保 CANCELLED：

```ts
    const status = plan.status === 'CANCELLED'
      ? 'CANCELLED'
      : (received.isZero() ? 'PENDING' : (received.lessThan(plan.amount) ? 'PARTIAL' : 'RECEIVED'));
```

- [ ] **Step 3: 跑绿**

串行跑新增测试 + `test/contract/receivable-service.test.ts` + `test/contract/receivable-void.test.ts`（sweep 改动零回归）+ `test/contract/terminate-plan-linkage.test.ts` 全绿 + tsc + eslint 0。

---

### Task 6: 前端（终止弹窗计数 + 计划 CANCELLED 态）

**Files:**
- Modify: `apps/web/src/pages/contracts/`（终止确认弹窗 + 计划列表）——先 Grep 定位 `ContractDetailPage` 终止动作与计划列表件
- Test: 对应页面测试件

**Interfaces:**
- Consumes: Task 4 `canceledPlanCount`（terminate 响应/审计语义）。
- Produces: 前端可见 CANCELLED 计划态 + 终止前未清计划计数提示。

- [ ] **Step 1: 定位并读既有终止动作与计划列表件**

Grep `contract.terminate` / `terminate` in `apps/web/src/pages/contracts/`，读终止确认 Modal 与计划列表组件形态。

- [ ] **Step 2: 终止弹窗 + 计划态**

- 终止确认 Modal：弹窗打开时加载合同未清计划计数（PENDING/PARTIAL）并展示「将取消 N 个未清付款计划」提示；确认后刷新计划列表。
- 计划列表：status CANCELLED 渲染「已取消」词位 + 灰/禁用态样式（沿既有状态 tag 形态）；amount/receivedAmount 照常显示。

- [ ] **Step 3: 页面测试**

补：终止弹窗显示未清计划计数、确认后计划列表出现 CANCELLED 态；渲染/交互断言非恒真。

- [ ] **Step 4: 前端四闸门**

`npm --prefix apps/web run test`（受影响件隔离）+ `typecheck` 0 + `lint` 0 err（预存 warning 照录）+ `build` 成功。

---

### Task 7: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（或新增合同 runbook 节）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-012-closeout.md`

**Interfaces:**
- Consumes: Task 1-6 全部。
- Produces: 计数链终态 + follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（全部 test/ 枚举，127.0.0.1 + 清净窗纪律），预期既有 1632 + 本 SPEC 新增全绿 0 fail（spec-008 3 例 port-guard 照录）。

- [ ] **Step 2: 前端 + 安全 + 迁移 + baseline**

前端四闸门（新件全绿 + 基线 flake 照录）；`npm run security:test` 34/34 零新增；迁移实证（Task 1 结论——21 或 22 注释级）+ 重演幂等；check:baseline（21 或 22 / 57）+ check:bootstrap PASS。

- [ ] **Step 3: runbook 更新 + closeout**

runbook 增「终止-计划联动」节（处置政策/在途互斥/竞速门禁/CANCELLED 词位/事件）；closeout 十一节（计数链——事件 13/词位扩展/零迁移或 1 注释迁移/权限 118 不变/路由 22 不变、裁决录 D1-D9、已知非阻断项、follow-up 路由）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §2 Q1-5→Task 1/3/4/5；§3 词位+事件→Task 1；§4 cancelUnsettledPlans+挂钩→Task 2/3/4；§5 竞速闭环→Task 5；§6 错误→Task 2/4/5；§7 审计/事件→Task 4；§9 前端→Task 6；§10 测试→各任务+Task 7；§12 边界→全部任务守住。零缺口。
- **占位符扫描**：无 TBD/TODO；全部代码块可直接转写；`traceId: randomUUID()` 与「先 Grep 定位」为明示动作非占位。
- **类型一致性**：`cancelUnsettledPlans(tx, contract, outbox, actorUserId)` 签名 Task 3 定义=Task 4 after 消费；`CONTRACT_TERMINATE_CONFLICT` Task 2 定义=Task 4 before 使用；`PAYMENT_PLAN_CANCELLED`/`PaymentPlanCancelledV1` Task 1 定义=Task 3 消费=registry 断言；before/after 挂钩 Task 2 定义=Task 4 接线。
