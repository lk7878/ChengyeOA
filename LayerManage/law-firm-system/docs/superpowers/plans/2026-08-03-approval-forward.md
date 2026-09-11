# SPEC-019 审批转交（Forward）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 转交——审批人将 PENDING 待办任务转交给其他审批人（assigneeId 变更），任务状态/节点/实例语义不变。**零结构变更**。

**Architecture:** approval-instance-service +`forwardTask` + controller/route `POST /approvals/:id/forward`（approval.process）+ 前端待办/详情「转交」操作。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 forwardTask + 控制器 + 路由

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（+forwardTask）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+ForwardTaskInput）
- Modify: `apps/server/app/controller/approval.ts`（+forward）
- Modify: `apps/server/app/router.ts`（+POST /approvals/:id/forward）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+转交用例）
- Modify: `apps/server/test/app/approval-api.test.ts`（+forward 路由门禁）

**Interfaces:**
- Consumes: Task 探查语义（assigneeId=actor）+ approval.process 权限 + ApprovalInstanceView。
- Produces: forwardTask 服务方法 + forward API（Task 2 前端消费）。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补转交用例：
1. 转交成功：assigneeId 变更为目标 + task version+1 + 实例 currentNode/status 不变 + 审计 APPROVAL_TASK_FORWARD（fromUserId/toUserId）+ 零 outbox 事件。
2. 非 PENDING task 转交 → 409。
3. 非我 task（assigneeId≠actor）转交 → 404。
4. 转交给自己（forwardToUserId=actor）→ 400。
5. 目标 userId 空 → 400。
6. 并发竞争（version 不符）→ 409。

`approval-api.test.ts` 补：
7. POST /forward 无 approval.process → 403。
8. POST /forward 有权限 → 转交成功 200 + 视图 assigneeId 变更。
9. 既有 18 例零回归。

- [ ] **Step 2: 实现**

`forwardTask`（见设计 §3）+ `ForwardTaskInput`；controller +`forward`（沿 process 形态）；router +`POST /:id/forward`（approval.process）。

- [ ] **Step 3: 跑绿**

approval-instance-service（55+6）+ approval-api（18+3）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: 前端转交操作

**Files:**
- Modify: `apps/web/src/api/approval.ts`（+forwardTask + ForwardTaskInput）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（待办行 + 详情任务表「转交」操作 + Modal）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+转交用例）

**Interfaces:**
- Consumes: Task 1 forward API。
- Produces: 转交端到端可见性。

- [ ] **Step 1: 失败测试先行**

前端测试：待办行 PENDING task 转交按钮门控（approval.process）/ Modal 提交 forwardTask 参数钉死（taskId + forwardToUserId）/ 成功刷新 / 既有 20 例零回归。

- [ ] **Step 2: 实现**

`api/approval.ts` +`forwardTask`（POST /v1/approvals/:id/forward）+ `ForwardTaskInput`；`ApprovalCenterPage.tsx` 待办操作区 + 详情任务表 PENDING 行「转交」按钮 → Modal（目标 userId Input）→ forwardTask → 成功刷新。

- [ ] **Step 3: 前端四闸门**

隔离测试 + typecheck 0 + lint 0 err（预存 warning 照录）+ build。

---

### Task 3: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补转交语义）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-019-closeout.md`

**Interfaces:**
- Consumes: Task 1/2 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1806 + 本 SPEC 净增全绿 0 fail。

- [ ] **Step 2: 前端 + 安全 + baseline**

前端四闸门；`npm run security:test` 34/34 零新增；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9.3 流程补转交（POST /forward、approval.process、assigneeId 变更语义）；closeout 十一节（零结构变更 26/60/122/15/路由 10、裁决 D1-D11、已知非阻断、Follow-up——加签/转交目标可见性/批量转交/超时升级等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器路由→Task 1；§5 前端→Task 2；§6 测试→各任务+Task 3；§7 计数→Task 3。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ForwardTaskInput Task 1 定义=Task 2 前端镜像；`APPROVAL_STATE_INVALID`/`APPROVAL_TASK_NOT_FOUND` 复用；路由 POST /forward Task 1=Task 2 API。
