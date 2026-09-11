# SPEC-032 客户经营分析（复购 + 转介绍）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户视图加复购 + 转介绍经营指标（contractCount/repurchaseCount/referralCount/firstContractAt/latestContractAt）。**零结构变更**（迁移 26/模型 60/权限 124/事件 15/路由 15 全不变）。

**Architecture:** customer-service 聚合（合同 count + min/max createdAt、线索 referralCustomerId count）+ CustomerView 扩展 + 前端客户详情「经营分析」区块。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；撞车期间禁跑。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层聚合 + CustomerView 扩展

**Files:**
- Modify: `apps/server/app/application/crm/customer-service.ts`（getCustomer/listCustomers 聚合）
- Modify: `apps/server/app/application/crm/lead-types.ts`（CustomerView +指标字段）
- Modify: `apps/server/test/crm/customer-service.test.ts`（+聚合用例）

**Interfaces:**
- Consumes: Customer/Contract/Lead 既有关系。
- Produces: 经营指标视图（Task 2 前端消费）。

- [ ] **Step 1: 失败测试先行**
补用例：单客户聚合（0/1/多合同 repurchaseCount）、referralCount、firstContractAt/latestContractAt、deletedAt 排除、列表分页批量聚合、权限。
- [ ] **Step 2: 实现**
getCustomer/listCustomers 批量聚合（IN 查询）→ CustomerView +指标。
- [ ] **Step 3: 跑绿**
customer-service 全绿 + crm 域零回归 + tsc/eslint 0。

---

### Task 2: 前端经营分析区块 + 闸门收尾

**Files:**
- Modify: `apps/web/src/api/.../customer.ts`（CustomerView +指标字段）
- Modify: 客户详情页（+「经营分析」区块 Statistic/Descriptions）
- Modify: 客户详情页测试（+2 用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（或相关 runbook 补经营分析说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-031-closeout.md`

**Interfaces:**
- Consumes: Task 1 服务层。
- Produces: 客户经营分析 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**
前端客户详情页经营分析区块测试。
- [ ] **Step 2: 实现**
前端 CustomerView 类型 + 详情页经营分析区块。
- [ ] **Step 3: 闸门 + 文档**
后端全量串行（预期 1890 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。前端 typecheck/lint/build。runbook 补经营分析说明 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 前端→Task 2；§5 测试→各任务；§6 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：CustomerView +指标 Task 1=Task 2 前端。
