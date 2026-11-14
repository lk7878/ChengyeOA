# SPEC-043 绩效考核流程（Performance Review Workflow）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 绩效模块补全实际考核流程——目标设定/自评/主管评 + 状态机扩展 + 前端考核步骤。**结构性变更**（迁移 31→**33** +2：加列 + provisioning；模型 61/权限 **134→135**/事件 15 不变；路由 28→**31** +3）。

**Architecture:** Performance +7 列 + 状态机 PENDING→SELF_REVIEWED→MANAGER_REVIEWED→CONFIRMED + setGoal/selfReview/managerReview 服务方法 + controller + 路由 + 前端。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 模型扩展 + 迁移

**Files:**
- Modify: `apps/server/prisma/schema.prisma`（Performance +7 列）
- Create: `apps/server/prisma/migrations/20260805140000_performance_review/migration.sql`（ALTER TABLE 加列）
- Modify: `apps/server/app/application/performance/performance-types.ts`（状态机扩展 + 视图 + 入参）
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（迁移 31→32）

**Interfaces:**
- Produces: Performance 考核字段（Task 2/3 消费）。

- [x] **Step 1**: schema + 迁移 + types。
- [x] **Step 2**: check-baseline 绿。

---

### Task 2: 服务方法 + controller + 路由

**Files:**
- Modify: `apps/server/app/application/performance/performance-service.ts`（+setGoal/selfReview/managerReview + confirm 扩展）
- Modify: `apps/server/app/controller/performance.ts`（+3 方法）
- Modify: `apps/server/app/router.ts`（+3 条）
- Modify: `apps/server/app/domain/performance/performance-errors.ts`（如需新码——优先复用）
- Modify: `apps/server/test/performance/performance-service.test.ts`（+考核流程用例）

**Interfaces:**
- Consumes: Task 1 字段。
- Produces: 考核流程（Task 3 前端消费）。

- [x] **Step 1**: 失败测试先行（setGoal/selfReview/managerReview/confirm 状态守卫）。
- [x] **Step 2**: service + controller + 路由实现。
- [x] **Step 3**: 跑绿（performance 测试 + tsc/eslint 0）。

---

### Task 3: 前端 + API 测试 + 闸门 + runbook + closeout

**Files:**
- Create: `apps/server/test/app/performance-review-api.test.ts`
- Modify: `apps/web/src/pages/Performance/index.tsx`（考核步骤：目标/自评/主管评 + 确认）
- Modify: `apps/web/src/pages/Performance/__tests__/PerformancePage.test.tsx`（+考核用例）
- Modify: `docs/superpowers/runbooks/finance-operations.md`（§11 补考核流程）
- Create: `docs/superpowers/reports/spec-043-closeout.md`

**Interfaces:**
- Consumes: Task 1/2。
- Produces: 考核流程 + 计数链终态（迁移 33/模型 61/权限 135/事件 15/路由 31）。

- [x] **Step 1**: API 测试（三动作 + 状态守卫 409 + 权限 403）。
- [x] **Step 2**: 前端考核步骤。
- [x] **Step 3**: 闸门（后端全量 + security/check/docs-leakage + 前端 vitest/build）+ runbook + closeout。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1 模型/迁移→Task 1；§3.2 服务/控制器→Task 2；§3.3 前端/闸门→Task 3；§4/§5 计数与测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：Performance 考核字段 Task 1=Task 2 服务=Task 3 前端；状态机 Task 2=Task 3 门控。
