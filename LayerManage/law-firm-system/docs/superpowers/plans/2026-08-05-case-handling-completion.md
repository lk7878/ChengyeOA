# SPEC-035 案件办理域收尾（Case 乐观锁 + 前端任务/沟通交互）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 SPEC-033 D2/D8 范围 OUT——Case +version 乐观锁（并发编辑防护）+ 前端任务/沟通交互 UI。**结构性变更**（迁移 27→**28**，加列；模型 60/权限 129/事件 15/路由 22 不变）。

**Architecture:** Case +`version Int @default(1)` → updateCase `updateMany {id, version, status notIn 终态}` 乐观锁（409 VERSION_CONFLICT）+ 前端详情抽屉任务/沟通增改 UI。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: Case version 乐观锁（后端）

**Files:**
- Modify: `apps/server/prisma/schema.prisma`（Case +version）
- Create: `apps/server/prisma/migrations/20260805110000_case_version_column/migration.sql`（ALTER TABLE 加列）
- Modify: `apps/server/app/application/case/case-types.ts`（UpdateCaseInput +version；CaseView +version）
- Modify: `apps/server/app/application/case/case-service.ts`（updateCase 乐观锁）
- Modify: `apps/server/test/case/case-service.test.ts`（+乐观锁用例）
- Modify: `apps/server/test/app/case-api.test.ts`（+乐观锁透传/缺 version 400/create 视图 version）

**Interfaces:**
- Consumes: SPEC-033 case 服务层 + VERSION_CONFLICT 语义（cost 先例）。
- Produces: Case 乐观锁（Task 2 前端消费 version 语义）。

- [x] **Step 1**: 失败测试先行（updateCase stale version 409 / 成功 version+1）。
- [x] **Step 2**: schema + 迁移 + service 乐观锁 + 视图透传。
- [x] **Step 3**: 跑绿（case 域测试 + tsc/eslint 0）。

---

### Task 2: 前端任务/沟通交互

**Files:**
- Modify: `apps/web/src/pages/Case/index.tsx`（详情抽屉任务/沟通交互 UI + 权限门控）
- Create: `apps/web/src/pages/Case/__tests__/CasePage.test.tsx`（+任务创建/状态翻转/沟通创建用例）

**Interfaces:**
- Consumes: Task 1 乐观锁 + SPEC-033 caseApi（createTask/updateTask/createCommunication 已存在）。
- Produces: 案件域端到端可用。

- [x] **Step 1**: 失败测试先行（任务创建/状态翻转/沟通创建）。
- [x] **Step 2**: 详情抽屉交互 UI（任务新建 Modal + 状态翻转按钮 + 沟通新建 Modal）。
- [x] **Step 3**: 跑绿（Case 页测试 + tsc/eslint/build 0）。

---

### Task 3: 闸门 + runbook + closeout

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§10 补乐观锁 + 前端交互）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-035-closeout.md`

**Interfaces:**
- Consumes: Task 1/2。
- Produces: 案件域收尾 + 计数链终态（迁移 28/模型 60/权限 129/事件 15/路由 22）。

- [x] **Step 1**: 后端全量串行（清净窗，skip-pattern 排除 spec-008 排练 3 例）。
- [x] **Step 2**: 前端全量 vitest + security/check/docs-leakage。
- [x] **Step 3**: runbook §10 更新 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1 乐观锁→Task 1；§3.2 前端交互→Task 2；§4/§5 计数与测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：version 字段 Task 1 定义=Task 2 消费；乐观锁语义=成本域 VERSION_CONFLICT 先例。
