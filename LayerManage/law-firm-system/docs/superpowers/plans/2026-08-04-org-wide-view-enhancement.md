# SPEC-028 审批全组织视图增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全组织审批视图（role='ALL'）加筛选/搜索/CSV 导出。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 不变；路由 13→14）。

**Architecture:** listInstances query 扩展（businessType/status/applicantId/keyword）+ exportInstances CSV + controller/router `/approvals/export` + 前端筛选区 + 导出按钮。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；撞车期间禁跑。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 listInstances 筛选/搜索 + exportInstances CSV

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（listInstances query 扩展 + exportInstances）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+ListApprovalsQuery 可选字段 + ExportInstancesQuery）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+筛选/搜索/导出用例）

**Interfaces:**
- Consumes: ListApprovalsQuery / parseQueryInteger（既有）。
- Produces: 筛选/搜索/CSV 导出（Task 2 控制器消费）。

- [ ] **Step 1: 失败测试先行**
补用例：role='ALL' businessType/status/applicantId/keyword 各生效 + 组合 AND + 非法枚举/UUID 400 + 其余 role 传筛选 400 + 导出 CSV 转义 + maxRows 截断/上限 400 + 权限。
- [ ] **Step 2: 实现**
listInstances where 扩展（仅 role='ALL'）+ exportInstances（CSV RFC 4180 转义 + UTF-8 BOM + maxRows）。
- [ ] **Step 3: 跑绿**
approval-instance-service 全绿 + approval 域零回归 + tsc/eslint 0。

---

### Task 2: 控制器/路由 + 前端 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（+exportInstances）
- Modify: `apps/server/app/router.ts`（+/approvals/export 字面量先于 :id，approval 域 13→14）
- Modify: `apps/server/test/app/approval-api.test.ts`（+导出端点用例）
- Modify: `apps/web/src/api/approval.ts`（类型 + 导出函数）
- Modify: `apps/web/src/pages/approval/ApprovalCenterPage.tsx`（筛选区 + 导出按钮）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补全组织视图筛选/导出）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-028-closeout.md`

**Interfaces:**
- Consumes: Task 1 服务层。
- Produces: 全组织视图筛选/导出 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**
approval-api 补 `/approvals/export`：无码 403 / 筛选透传 / CSV envelope / 字面量先于 :id。
- [ ] **Step 2: 实现**
controller exportInstances + router + 前端筛选区/导出按钮。
- [ ] **Step 3: 闸门 + 文档**
后端全量串行（预期 1874 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。前端 typecheck/lint/build。runbook §9 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器/路由→Task 2；§5 前端→Task 2；§6 测试→各任务；§7 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ListApprovalsQuery 扩展 Task 1=Task 2 控制器；ExportInstancesQuery 一致；前端类型镜像。
