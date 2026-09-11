# SPEC-039 客户复购与转介绍业务流程（Referral Workflow）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业务链最后一步「客户复购与转介绍」的转介绍业务流程——客户详情登记转介绍（REFERRAL 线索）+ 客户转介绍线索列表 + 前端集成。**零结构变更**（迁移 29/模型 60/权限 132/事件 15 不变；路由 26→**28** +2）。

**Architecture:** lead-service `createReferralLead`（委托 createLead 强制 REFERRAL 语义）+ `listReferrals`（客户域过滤）+ controller + 路由 + 前端客户详情转介绍区。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 转介绍后端流程

**Files:**
- Modify: `apps/server/app/domain/crm/lead-errors.ts`（+CUSTOMER_NOT_FOUND）
- Modify: `apps/server/app/application/crm/lead-service.ts`（+createReferralLead / +listReferrals）
- Modify: `apps/server/app/application/crm/lead-types.ts`（+CreateReferralLeadInput）
- Modify: `apps/server/app/controller/customer.ts`（+createReferral / +listReferrals）
- Modify: `apps/server/app/router.ts`（+2 条 /customers/:id/referrals）
- Create: `apps/server/test/crm/referral-service.test.ts`

**Interfaces:**
- Consumes: lead-service createLead（REFERRAL 语义委托）+ customer 探针。
- Produces: 转介绍流程（Task 2 前端消费）。

- [x] **Step 1**: 失败测试先行（createReferralLead 客户不存在 404/强制 REFERRAL/去重；listReferrals 过滤分页）。
- [x] **Step 2**: lead-service + controller + 路由实现。
- [x] **Step 3**: 跑绿（referral 服务测试 + tsc/eslint 0）。

---

### Task 2: 前端客户转介绍

**Files:**
- Modify: `apps/web/src/api/customer.ts`（+createReferral / +listReferrals）
- Modify: `apps/web/src/pages/customers/CustomerDetailPage.tsx`（转介绍区：登记 Modal + 列表 + 经营分析完善）
- Modify: `apps/web/src/pages/customers/__tests__/CustomerDetailPage.test.tsx`（+登记提交/列表渲染用例）

**Interfaces:**
- Consumes: Task 1 API。
- Produces: 客户转介绍端到端可用。

- [x] **Step 1**: 失败测试先行（登记提交/列表渲染）。
- [x] **Step 2**: 客户详情转介绍区实现（登记 Modal + 列表 + 权限门控）。
- [x] **Step 3**: 跑绿（CustomerDetailPage 测试 + tsc/eslint/build 0）。

---

### Task 3: API 测试 + 闸门 + runbook + closeout

**Files:**
- Create: `apps/server/test/app/referral-api.test.ts`
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§12 客户复购与转介绍）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-039-closeout.md`

**Interfaces:**
- Consumes: Task 1/2。
- Produces: 转介绍流程 + 计数链终态（迁移 29/模型 60/权限 132/事件 15/路由 28）。

- [x] **Step 1**: API 测试（权限 403/401/错误码/端到端登记+列表）。
- [x] **Step 2**: 闸门（后端全量 + security/check/docs-leakage + 前端 vitest/build）。
- [x] **Step 3**: runbook §12 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1 后端→Task 1；§3.2 前端→Task 2；§4/§5 计数与测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：CreateReferralLeadInput Task 1 定义=controller 消费；LeadView Task 2 列表消费。
