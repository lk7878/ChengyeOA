# SPEC-030 审批统计驾驶舱实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全组织审批视图统计驾驶舱——`GET /approvals/stats` 聚合接口 + 前端统计摘要卡片。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 不变；路由 14→15）。

**Architecture:** getStats（total/pending/decided/byBusinessType/byStatus/avgDecisionHours，复用 SPEC-028 筛选）+ controller/router + 前端「全部审批」Tab 统计区。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；撞车期间禁跑。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 getStats + 类型

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（+getStats）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+ApprovalStatsQuery + ApprovalStatsView）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+stats 用例）

**Interfaces:**
- Consumes: 筛选构建（buildAllViewWhere 复用）。
- Produces: 统计视图（Task 2 控制器/前端消费）。

- [ ] **Step 1: 失败测试先行**
补用例：stats 总量/在途/已决/类型分布/状态分布/avgDecisionHours 口径 + 筛选生效 + 无码 403 + 无已决 → avg null。
- [ ] **Step 2: 实现**
getStats（count + groupBy + avg，复用 buildAllViewWhere）。
- [ ] **Step 3: 跑绿**
approval-instance-service 全绿 + approval 域零回归 + tsc/eslint 0。

---

### Task 2: 控制器/路由/前端 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（+stats + parseStatsQuery）
- Modify: `apps/server/app/router.ts`（+/approvals/stats 字面量先于 :id，approval 域 14→15）
- Modify: `apps/server/test/app/approval-api.test.ts`（+stats API 用例）
- Modify: `apps/web/src/api/approval.ts`（+approvalStats + 类型）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（ALL Tab 统计区）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+2 用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9.15 补统计说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-030-closeout.md`

**Interfaces:**
- Consumes: Task 1 服务层。
- Produces: 审批统计驾驶舱 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**
approval-api 补 /approvals/stats 权限 403 + 筛选透传 + 字面量先于 :id。
- [ ] **Step 2: 实现**
controller stats + router + 前端统计区（Statistic 卡片 + 类型分布条 + 筛选刷新）。
- [ ] **Step 3: 闸门 + 文档**
后端全量串行（预期 1886 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。前端 typecheck/lint/build。runbook §9.15 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器/路由→Task 2；§5 前端→Task 2；§6 测试→各任务；§7 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ApprovalStatsQuery/View Task 1=Task 2；前端类型镜像。
