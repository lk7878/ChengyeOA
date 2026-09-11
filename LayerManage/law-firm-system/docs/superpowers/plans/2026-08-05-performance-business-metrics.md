# SPEC-044 绩效与案件/财务联动（Performance Business Metrics）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 绩效详情聚合业务指标（该员工考核周期案件办结数/回款额）——纯读聚合，零结构变更（迁移 33/模型 61/权限 135/事件 15 不变；路由 +1 → **29**）。

**Architecture:** performance-service `getBusinessMetrics`（case.count CLOSED + payment.aggregate CONFIRMED，按周期解析）+ 路由 + 前端业务指标卡。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 后端 metrics 服务 + 路由

**Files:**
- Modify: `apps/server/app/application/performance/performance-service.ts`（+getBusinessMetrics）
- Modify: `apps/server/app/application/performance/performance-types.ts`（+PerformanceBusinessMetrics）
- Modify: `apps/server/app/controller/performance.ts`（+metrics）
- Modify: `apps/server/app/router.ts`（+1 条）
- Create: `apps/server/test/performance/performance-metrics-service.test.ts`

**Interfaces:**
- Consumes: Performance 周期 + Case/Payment 聚合。
- Produces: 业务指标（Task 2 前端消费）。

- [x] **Step 1**: 失败测试先行（closedCases 计数/回款聚合/404/403/周期解析）。
- [x] **Step 2**: service + controller + 路由实现。
- [x] **Step 3**: 跑绿（metrics 测试 + tsc/eslint 0）。

---

### Task 2: 前端 + API 测试 + 闸门 + runbook + closeout

**Files:**
- Create: `apps/server/test/app/performance-metrics-api.test.ts`
- Modify: `apps/web/src/api/organization.ts`（+metrics）
- Modify: `apps/web/src/types/index.ts`（+PerformanceBusinessMetrics）
- Modify: `apps/web/src/pages/Performance/index.tsx`（详情业务指标卡）
- Modify: `apps/web/src/pages/Performance/__tests__/PerformancePage.test.tsx`（+指标卡用例）
- Modify: `docs/superpowers/runbooks/finance-operations.md`（§11 补业务指标）
- Create: `docs/superpowers/reports/spec-044-closeout.md`

**Interfaces:**
- Consumes: Task 1 API。
- Produces: 绩效业务指标 + 计数链终态（迁移 33/模型 61/权限 135/事件 15/路由 29）。

- [x] **Step 1**: API 测试（metrics + 权限 403 + 404）。
- [x] **Step 2**: 前端业务指标卡。
- [x] **Step 3**: 闸门（后端全量 + security/check/docs-leakage + 前端 vitest/build）+ runbook + closeout。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1 后端→Task 1；§3.2 前端→Task 2；§4/§5 计数与测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：PerformanceBusinessMetrics Task 1=Task 2 前端；周期解析 Task 1=前端展示。
