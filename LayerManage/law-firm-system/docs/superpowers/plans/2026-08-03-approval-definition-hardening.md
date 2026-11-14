# SPEC-024 Definition 加固（乐观锁 + 原子性）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `approval-definition-service` 并发正确性——update/setStatus 乐观版本锁 + PATCH 同体真原子性（组合方法单事务）。**零结构变更**。

**Architecture:** updateDefinition/setDefinitionStatus 改 updateMany version 守卫（沿 SPEC-019 forward）+ 新增 updateDefinitionWithStatus 组合方法 + controller PATCH 三分支重构。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层乐观锁 + 组合方法

**Files:**
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（updateDefinition/setDefinitionStatus 乐观锁 + updateDefinitionWithStatus 组合方法）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+UpdateDefinitionWithStatusInput）
- Modify: `apps/server/test/approval/approval-definition-service.test.ts`（+乐观锁 + 组合方法用例）

**Interfaces:**
- Consumes: ApprovalError/APPROVAL_STATE_INVALID + updateMany version 守卫先例（SPEC-019 forward）。
- Produces: 乐观锁 update/setStatus + 组合方法（Task 2 controller 消费）。

- [ ] **Step 1: 失败测试先行**

`test/approval/approval-definition-service.test.ts` 补：
1. update 并发竞争 409（version 不符 count=0）。
2. setStatus 并发竞争 409。
3. update 成功审计 fromVersion 正确（锁前读）。
4. 组合方法 update+status 单事务成功（视图 + version +2 + 审计两段 fromStatus/toStatus + fromVersion/toVersion）。
5. 组合方法仅 update / 仅 status。
6. 组合方法并发竞争 409（任一段 version 不符）。
7. 既有 update/setStatus 零回归。

- [ ] **Step 2: 实现**

按设计 §3.1-3.3 + D1-D7。

- [ ] **Step 3: 跑绿**

approval-definition-service（17+新）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: controller PATCH 三分支重构 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（PATCH 三分支：同体→组合方法）
- Modify: `apps/server/test/app/approval-api.test.ts`（+PATCH 同体用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补加固说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-024-closeout.md`

**Interfaces:**
- Consumes: Task 1 组合方法。
- Produces: PATCH 同体真原子 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**

`test/app/approval-api.test.ts` 补：PATCH 同体（update+status）调组合方法（单事务语义）/ 仅 update / 仅 status / 404/400/409 透传 / 既有零回归。

- [ ] **Step 2: 实现**

controller updateDefinition 三分支重构（同体→updateDefinitionWithStatus；仅 update→updateDefinition；仅 status→setDefinitionStatus）。

- [ ] **Step 3: 闸门 + 文档**

approval-api 测试全绿 + approval 域零回归；后端全量串行（预期 1850 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。runbook §9 补加固说明 + closeout 十一节（零结构变更 26/60/124/15/路由 11、裁决 D1-D7、已知非阻断、Follow-up——导入导出等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器→Task 2；§5 测试→各任务+Task 2；§6 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：UpdateDefinitionWithStatusInput Task 1 定义=Task 2 控制器；`APPROVAL_STATE_INVALID` 复用；组合方法 Task 1 产出=Task 2 消费。
