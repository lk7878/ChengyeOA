# SPEC-037 绩效模块正规化（Performance Regularization）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 绩效模块从遗留原型（直连 ctx.prisma、无权限/校验/审计/测试）正规化为服务层 + 权限门禁 + 测试 + 前端最小。**结构性变更**（迁移 28→**29**，provisioning；权限 129→**132**；路由 22→**26**）。

**Architecture:** performance-service（create/list/get/confirm + 校验/审计）+ PerformanceError（errorHandler 分支）+ controller 薄重构 + requirePermission 路由 + 前端最小列表/新建/确认。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 权限码 + provisioning + baseline 同步

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`（PERMISSION_CODES +3）
- Create: `apps/server/prisma/migrations/20260805120000_performance_provision/migration.sql`（+3 permission 行 INSERT ON CONFLICT DO NOTHING）
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（迁移计数 28→29）
- Modify: `apps/server/test/contract/permission-catalog-contract.test.ts`（129→132）
- Modify: `apps/server/test/finance/permission-catalog-finance.test.ts`（129→132）

**Interfaces:**
- Produces: performance 权限码（Task 2/3 消费）。

- [x] **Step 1**: catalog +3 码 → provisioning 迁移 → baseline/契约同步。
- [x] **Step 2**: check-baseline/bootstrap 绿。

---

### Task 2: 服务层 + 测试

**Files:**
- Create: `apps/server/app/application/performance/performance-service.ts`
- Create: `apps/server/app/application/performance/performance-types.ts`（入参/视图）
- Create: `apps/server/app/application/performance/performance-factory.ts`（ctx 装配）
- Create: `apps/server/app/domain/performance/performance-errors.ts`
- Create: `apps/server/test/performance/performance-service.test.ts`

**Interfaces:**
- Consumes: performance 权限码 + employee 投影（master-data）。
- Produces: 绩效域服务（Task 3 controller 消费）。

- [x] **Step 1**: 失败测试先行（create/confirm/唯一 409 用例）。
- [x] **Step 2**: 实现服务（校验 + 审计 + 状态机 + 唯一探针）。
- [x] **Step 3**: 跑绿（performance 测试 + tsc/eslint 0）。

---

### Task 3: controller 重构 + 路由 + API 测试 + 前端 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/performance.ts`（薄重构调 service）
- Modify: `apps/server/app/middleware/errorHandler.ts`（+PerformanceError 分支）
- Modify: `apps/server/app/router.ts`（+requirePermission，路由 22→26）
- Create: `apps/server/test/app/performance-api.test.ts`
- Modify: `apps/web/src/pages/Performance/index.tsx`（最小列表/新建/确认 + 枚举对齐）
- Modify: `apps/web/src/features/authorization/types.ts`（+3 码）
- Modify: `apps/web/src/types/index.ts`（Performance 类型对齐后端）
- Modify: `apps/web/src/api/organization.ts`（performanceApi 对齐 PagedResult）
- Modify: `docs/superpowers/runbooks/finance-operations.md`（§11 绩效域说明）
- Create: `docs/superpowers/reports/spec-037-closeout.md`

**Interfaces:**
- Consumes: Task 2 服务层。
- Produces: 绩效域 + 计数链终态（迁移 29/模型 60/权限 132/事件 15/路由 26）。

- [x] **Step 1**: API 测试（权限 403/状态机/错误码/审计透传）。
- [x] **Step 2**: controller 重构 + 路由门禁 + errorHandler 分支 + 前端最小。
- [x] **Step 3**: 闸门（后端全量 + security/check/docs-leakage + 前端 vitest/build）+ runbook + closeout。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 2；§4 控制器/路由→Task 3；§6 权限/迁移→Task 1；§5 测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：performance 权限码 Task 1=Task 2/3；入参/视图 Task 2=Task 3 控制器；枚举对齐（YEARLY 非 ANNUAL）Task 2/3 一致。
