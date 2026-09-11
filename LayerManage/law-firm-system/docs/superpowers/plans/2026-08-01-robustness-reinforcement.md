# SPEC-014 健壮性补强（Robustness Reinforcement）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三防御缺口闭合——callbackKey 跨实例 P2002 防御、createPayment FOR UPDATE 竞速补强、审批动作静默 catch UX。

**Architecture:** 后端两处服务修复（approval-instance-service processTask 幂等/并发、receivable-service createPayment 持锁重验）+ 前端 UX（approval-store + RefundListPage message.error）。零结构变更。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: callbackKey 跨实例 P2002 防御（approval-instance-service）

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`

**Interfaces:**
- Consumes: `CALLBACK_KEY_CONFLICT`（approval-errors，409）+ `isUniqueConflictOn`（receivable-service 同型本地镜像或 import——**沿既有惯例本地镜像**）。
- Produces: processTask 幂等语义收窄（异实例 → 409）。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补 2 例：
1. **顺序异实例 409**：实例 A 用 key K 处理 APPROVED → 实例 B 同 key K process → `CALLBACK_KEY_CONFLICT` 409（B 任务不被触碰、零事件零审计）。
2. **并发同 key 异实例 409 非 500**：两实例同 key 并发 process（Promise.all）→ 一胜一 `CALLBACK_KEY_CONFLICT` 409（非 500——断言 error 非 MasterDataError/Prisma 500）。

- [ ] **Step 2: 实现**

`processTask`（:197-202 段）幂等查找改：

```ts
      if (idempotencyKey) {
        const sameInstance = await tx.callbackAction.findFirst({
          where: { callbackKey: idempotencyKey, instanceId: task.instanceId },
        });
        if (sameInstance) {
          return this.loadInstanceView(tx, sameInstance.instanceId);
        }
        const crossInstance = await tx.callbackAction.findFirst({
          where: { callbackKey: idempotencyKey, instanceId: { not: task.instanceId } },
        });
        if (crossInstance) {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT,
            409,
            'idempotency key already used for another approval',
          );
        }
      }
```

并发 P2002：将 `$transaction` 调用外包 try/catch——`callbackAction.create` 的 P2002（`isUniqueConflictOn(error, 'callbackKey')`）中止事务后**外部重读**：

```ts
    try {
      return await this.prisma.$transaction(async tx => { /* 既有 processTask 主体 */ });
    } catch (error) {
      if (isUniqueConflictOn(error, 'callbackKey')) {
        const winner = await this.prisma.callbackAction.findUnique({ where: { callbackKey: idempotencyKey } });
        if (!winner) throw error;
        if (winner.instanceId === targetInstanceId) {
          return this.loadInstanceView(this.prisma, winner.instanceId);
        }
        throw new ApprovalError(APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT, 409, 'idempotency key already used for another approval');
      }
      throw error;
    }
```

（`targetInstanceId` 为 processTask 参数解析出的 task.instanceId；`loadInstanceView` 若要求 tx 则改传 prisma 直查——实现时按既有签名调整。）本地镜像 `isUniqueConflictOn`（沿 receivable-service :708 形态，零 import 循环）。

- [ ] **Step 3: 跑绿**

串行跑 `test/approval/approval-instance-service.test.ts` 全绿（含既有 27 + 新增 2）+ `test/approval/` 目录全绿 + tsc + eslint 0。

---

### Task 2: createPayment FOR UPDATE 竞速补强（receivable-service）

**Files:**
- Modify: `apps/server/app/application/contract/receivable-service.ts`
- Modify: `apps/server/test/contract/receivable-service.test.ts` 或 `terminate-plan-linkage.test.ts`（竞速补例）

**Interfaces:**
- Consumes: `CONTRACT_STATE_TRANSITION_INVALID`（contract-errors，409）。
- Produces: createPayment 持锁重验（terminate 先胜 → 409 零行）。

- [ ] **Step 1: 失败测试先行**

补 1 例：**terminate 先胜 → createPayment 409 零行**（持锁钉法沿 receivable-service.test.ts:1119-1134）——第三方持合同锁 1s → terminate 先提交 TERMINATED → createPayment 锁后重验 → `CONTRACT_STATE_TRANSITION_INVALID` 409、零 payment 行、零事件零审计。

- [ ] **Step 2: 实现**

`createPayment` 的 INSERT 事务（createWithPaymentNoRetry）内、INSERT 前加首把锁 + 重验（仿 confirmPayment :413-414）：

```ts
      // SPEC-014 Task 2：首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment），持锁后重验状态——
      // 关闭 createPayment 与 terminate 竞速（createPayment 读 EFFECTIVE 后 terminate 先胜 →
      // 锁后重验 TERMINATED → 409，杜绝 PENDING 固化到已终止合同）。
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${data.contractId} FOR UPDATE`;
      const freshContract = await tx.contract.findUniqueOrThrow({ where: { id: data.contractId } });
      if (freshContract.status !== 'SIGNED' && freshContract.status !== 'EFFECTIVE') {
        throw new ContractError(
          CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
          409,
          `cannot register payment for contract in status ${freshContract.status}`,
        );
      }
```

（`createWithPaymentNoRetry` 签名含 contractId——放入其 tx 体 INSERT 前；锁序 Contract→Payment 与 confirmPayment 同序。）

- [ ] **Step 3: 跑绿**

新增竞速测试 + `test/contract/receivable-service.test.ts`（既有 38 零回归）+ `test/contract/terminate-plan-linkage.test.ts` 全绿 + tsc + eslint 0。

---

### Task 3: 审批动作静默 catch UX（approval-store + RefundListPage）

**Files:**
- Modify: `apps/web/src/stores/approval-store.ts`
- Modify: `apps/web/src/pages/refunds/RefundListPage.tsx`
- Modify: 对应测试件

**Interfaces:**
- Consumes: 既有 store 契约（动作返回 false/null）。
- Produces: 动作失败用户可见错误。

- [ ] **Step 1: 失败测试先行**

补测：store `applyApproval` 失败（mock 拒绝）→ `message.error` 被调用 + 返回 false；`RefundListPage` approve 失败（409 陈旧 expectedVersion mock）→ 错误提示出现。

- [ ] **Step 2: 实现**

`approval-store.ts` 三动作（applyApproval/processApproval/withdrawApproval）catch 段加：

```ts
      catch (error) {
        // SPEC-014 Task 3：动作失败用户可见（沿 request 拦截器 message.error 惯例补内联反馈）。
        message.error(error?.response?.data?.message ?? '操作失败');
        return false;
      }
```

`RefundListPage.tsx` approve catch 段同加 `message.error(...)`（含 409/403 路径）——Modal 保持打开。

- [ ] **Step 3: 前端四闸门**

受影响件隔离测试 + typecheck 0 + lint 0 err（预存 warning 照录）+ build 成功。

---

### Task 4: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9.4 幂等补 callbackKey 跨实例 409 语义；§7/相关节补 createPayment 持锁）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-014-closeout.md`

**Interfaces:**
- Consumes: Task 1-3 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗），预期既有 1746 + 本 SPEC 新增（callbackKey 2 + createPayment 1 + 回归）全绿 0 fail（spec-008 3 例 port-guard 照录）。

- [ ] **Step 2: 前端 + 安全 + baseline**

前端四闸门（受影响件全绿 + 基线 flake 照录）；`npm run security:test` 34/34 零新增；check:baseline（23/60）+ check:bootstrap PASS；docs-leakage exit 0（报告沿用占位符口径）。

- [ ] **Step 3: runbook 更新 + closeout**

runbook §9.4 幂等补「跨实例 callbackKey → CALLBACK_KEY_CONFLICT 409」；收款纪律补「createPayment 持锁重验」；closeout 十一节（计数链——零结构变更 23/60/121/15、裁决录 D1-D5、已知非阻断项、follow-up 路由——审批中心深化/业务角色供给/漂移/flake/安全专项等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 callbackKey→Task 1；§4 createPayment→Task 2；§5 UX→Task 3；§6 测试→各任务+Task 4；§7 零结构→Task 4 计数链。零缺口。
- **占位符扫描**：无 TBD/TODO；`loadInstanceView` 传参调整标注"实现时按既有签名调整"为明示动作。
- **类型一致性**：`CALLBACK_KEY_CONFLICT` Task 1 使用=approval-errors 既有码；`CONTRACT_STATE_TRANSITION_INVALID` Task 2 使用=contract-errors 既有码；store 契约 Task 3 保持（返回 false/null）。
