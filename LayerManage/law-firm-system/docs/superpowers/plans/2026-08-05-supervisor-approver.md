# SPEC-041 审批表达式审批人 + 直属上级规则（SUPERVISOR Approver）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** approverRule 扩展 `SUPERVISOR` 规则（按申请人报告线自动路由直属上级/多级上溯），审批定义与申请流转端到端可用。**零结构变更**（迁移 29/模型 60/权限 132/事件 15/路由 28 全不变——approverRule JSON 配置扩展）。

**Architecture:** `ApproverRule` +`SUPERVISOR` → `resolveApproverIds(rule, applicantId, db)` +SUPERVISOR 分支（报告线步行 + 用户绑定）→ 定义校验 + 前端最小。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 后端 SUPERVISOR 规则

**Files:**
- Modify: `apps/server/app/domain/approval/approval-types.ts`（ApproverRule +SUPERVISOR）
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（resolveApproverIds +SUPERVISOR + applicantId 传递）
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（assertApproverRuleValid +SUPERVISOR）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+SUPERVISOR 用例）

**Interfaces:**
- Consumes: 报告线基础设施（EmployeeReportingLine）+ 定义 approverRule。
- Produces: SUPERVISOR 解析（Task 2 前端消费）。

- [x] **Step 1**: 失败测试先行（SUPERVISOR 解析/多级/400 分支）。
- [x] **Step 2**: ApproverRule + resolveApproverIds + 定义校验实现。
- [x] **Step 3**: 跑绿（approval 域测试 + tsc/eslint 0）。

---

### Task 2: 前端最小

**Files:**
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（定义编辑器 SUPERVISOR 类型 + 详情「直属上级」显示）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+SUPERVISOR 用例）

**Interfaces:**
- Consumes: Task 1 API。
- Produces: 定义编辑器/详情可用。

- [x] **Step 1**: 失败测试先行（SUPERVISOR 类型/详情显示）。
- [x] **Step 2**: 定义编辑器 + 详情显示实现。
- [x] **Step 3**: 跑绿（ApprovalCenterPage 测试 + tsc/eslint/build 0）。

---

### Task 3: API 测试 + 闸门 + runbook + closeout

**Files:**
- Create: `apps/server/test/app/approval-supervisor-api.test.ts`
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 审批中心补 SUPERVISOR 说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-041-closeout.md`

**Interfaces:**
- Consumes: Task 1/2。
- Produces: SUPERVISOR 规则 + 计数链终态（迁移 29/模型 60/权限 132/事件 15/路由 28 不变）。

- [x] **Step 1**: API 测试（定义 CRUD SUPERVISOR 校验/畸形 400/apply 走上级审批人端到端）。
- [x] **Step 2**: 闸门（后端全量 + security/check/docs-leakage + 前端 vitest/build）。
- [x] **Step 3**: runbook §9 补 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1 后端→Task 1；§3.2 前端→Task 2；§4/§5 计数与测试→各任务。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ApproverRule SUPERVISOR Task 1 定义=resolveApproverIds 消费；前端详情显示 Task 2 消费。
