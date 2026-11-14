# SPEC-033 案件办理域核心（Case Handling Core）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业务链「案件办理与交付」核心——新增 case 权限码 + 正规服务层（Case/CaseTask/Communication）+ controller 重构（替代遗留原型）+ 路由门禁 + 测试。**结构性变更**（迁移 26→27、权限 124→130、路由 15→22）。

**Architecture:** case-service（Case 生命周期）/ case-task-service（CaseTask 状态机）/ case-communication-service + controller 薄封装 + requirePermission 路由。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；撞车期间禁跑。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 权限码 + provisioning 迁移 + baseline 同步

**Files:**
- Modify: `apps/server/app/domain/authorization/authorization-types.ts`（PERMISSION_CODES +6）
- Create: `apps/server/prisma/migrations/20260805100000_case_permission_provision/migration.sql`（+6 permission 行 INSERT ON CONFLICT DO NOTHING）
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`（权限计数 124→130）
- Modify: 相关 baseline 契约测试（权限计数同步）

**Interfaces:**
- Produces: case 权限码（Task 2/3 消费）。

- [x] **Step 1**: catalog +6 码 → provisioning 迁移 → baseline 同步。
- [x] **Step 2**: check-baseline/bootstrap 绿。

---

### Task 2: 服务层（case-service + case-task-service + case-communication-service）+ 测试

**Files:**
- Create: `apps/server/app/application/case/case-service.ts`
- Create: `apps/server/app/application/case/case-task-service.ts`
- Create: `apps/server/app/application/case/case-communication-service.ts`
- Create: `apps/server/app/application/case/case-types.ts`（入参/视图）
- Create: `apps/server/test/case/case-service.test.ts` + `case-task-service.test.ts` + `case-communication-service.test.ts`

**Interfaces:**
- Consumes: case 权限码 + 校验助手（normalize 系列）。
- Produces: 案件域服务（Task 3 controller 消费）。

- [x] **Step 1**: 失败测试先行（create/update/close/task/communication 用例）。
- [x] **Step 2**: 实现三个服务（状态机 + 校验 + 审计 + 状态守卫——Case 无 version 列，乐观锁收敛为终态守卫）。
- [x] **Step 3**: 跑绿（case 域测试 + 相关域零回归 + tsc/eslint 0）。

---

### Task 3: controller 重构 + 路由 + API 测试 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/case.ts`（重构为薄控制器调 service，移除 destroy）
- Modify: `apps/server/app/router.ts`（+requirePermission 门禁，路由 15→22）
- Create: `apps/server/test/app/case-api.test.ts`
- Modify: 前端（最小：案件列表 + 详情）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§补案件域说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-033-closeout.md`

**Interfaces:**
- Consumes: Task 2 服务层。
- Produces: 案件办理域 + 计数链终态（迁移 27/模型 60/权限 129/事件 15/路由 22——权限实际 123→129，非设计估算 124→130）。

- [x] **Step 1**: API 测试（权限 403/状态机/审计透传——`test/app/case-api.test.ts` 5 例全绿；errorHandler 补 CaseError 分支）。
- [x] **Step 2**: controller 重构 + 路由门禁 + 前端最小列表/详情。
- [x] **Step 3**: 闸门（后端全量 + security/check/docs-leakage）+ runbook + closeout。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 2；§4 控制器/路由→Task 3；§6 权限/迁移→Task 1；§5 测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：case 权限码 Task 1=Task 2/3；入参/视图 Task 2=Task 3 控制器。
