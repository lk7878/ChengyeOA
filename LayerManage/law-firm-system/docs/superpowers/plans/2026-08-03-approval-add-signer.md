# SPEC-020 审批加签（Add Signer）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加签——审批人向当前节点追加额外审批人（新 PENDING task 同 nodeName），协同审批（ANY 任一通过/ALL 会签按节点 mode 自动兼容）。**零结构变更**。

**Architecture:** approval-instance-service +`addSigners`（含实例行 FOR UPDATE 并发锁点）+ controller/route `POST /approvals/:id/add-signers`（approval.process）+ 前端待办/详情「加签」操作。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 addSigners + 控制器 + 路由

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（+addSigners + FOR UPDATE 锁点）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+AddSignersInput）
- Modify: `apps/server/app/controller/approval.ts`（+addSigners）
- Modify: `apps/server/app/router.ts`（+POST /approvals/:id/add-signers）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+加签用例）
- Modify: `apps/server/test/app/approval-api.test.ts`（+add-signers 路由门禁）

**Interfaces:**
- Consumes: Task 探查语义（assigneeId=actor）+ approval.process + 实例行 FOR UPDATE 锁点（沿 processTask :243）。
- Produces: addSigners 服务方法 + API（Task 2 前端消费）。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补加签用例：
1. 加签成功：N 新 PENDING task（同 nodeName）+ 实例 currentNode/status/version 不变 + 审计 ADD_SIGNER（addedUserIds）+ 零 outbox 事件。
2. 非 PENDING task → 409。
3. 非我 task → 404。
4. 目标含自己 → 400。
5. 目标含申请人 → 409（自审守卫）。
6. 目标空数组 → 400。
7. 目标去重（重复 userId 仅建 1 task）。
8. 加签后 ANY 任一通过推进（新 task 并入节点，首个 APPROVE 取消该节点余 PENDING）。
9. 加签后 ALL 会签全签推进（remainingPending 含新增）。
10. 加签与推进并发（实例行 FOR UPDATE 互斥，无孤儿 task）。

`approval-api.test.ts` 补：
11. POST /add-signers 无 approval.process → 403。
12. 有权限加签成功 200 + 视图 tasks 增加。
13. 既有 21 例零回归。

- [ ] **Step 2: 实现**

`addSigners`（见设计 §3 + D4.1：事务内首把锁 = 实例行 FOR UPDATE + 锁后重验 task 仍 PENDING 且 nodeName===chain[currentNode].name）+ `AddSignersInput`；controller +`addSigners`；router +`POST /:id/add-signers`。

- [ ] **Step 3: 跑绿**

approval-instance-service（62+10）+ approval-api（21+3）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: 前端加签操作

**Files:**
- Modify: `apps/web/src/api/approval.ts`（+addSigners + AddSignersInput）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（待办行 + 详情任务表「加签」操作 + Modal）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+加签用例）

**Interfaces:**
- Consumes: Task 1 addSigners API。
- Produces: 加签端到端可见性。

- [ ] **Step 1: 失败测试先行**

前端测试：加签按钮门控（approval.process）/ Modal 提交 addSigners 参数钉死（taskId + addSignerUserIds）/ 成功刷新 / 既有 23 例零回归。

- [ ] **Step 2: 实现**

`api/approval.ts` +`addSigners` + `AddSignersInput`；`ApprovalCenterPage.tsx` 待办操作区 + 详情任务表 PENDING 行「加签」按钮 → Modal（目标 userIds 逗号分隔）→ addSigners → 成功刷新。防连点（confirmLoading）。

- [ ] **Step 3: 前端四闸门**

隔离测试 + typecheck 0 + lint 0 err（预存 warning 照录）+ build。

---

### Task 3: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补加签语义）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-020-closeout.md`

**Interfaces:**
- Consumes: Task 1/2 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1816 + 本 SPEC 净增全绿 0 fail。

- [ ] **Step 2: 前端 + 安全 + baseline**

前端四闸门；`npm run security:test` 34/34 零新增；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9.3 流程补加签（POST /add-signers、approval.process、同节点新 PENDING task、FOR UPDATE 锁点）；closeout 十一节（零结构变更 26/60/122/15/路由 11、裁决 D1-D11+D4.1、已知非阻断、Follow-up——加签目标可见性/幂等 key/通知/超时升级等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器路由→Task 1；§5 前端→Task 2；§6 测试→各任务+Task 3；§7 计数→Task 3。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：AddSignersInput Task 1 定义=Task 2 前端镜像；`APPROVAL_STATE_INVALID`/`APPROVAL_TASK_NOT_FOUND`/`APPROVAL_ASSIGNEE_INVALID`/`APPROVAL_SELF_REVIEW_FORBIDDEN` 复用；路由 POST /add-signers Task 1=Task 2 API。
