# SPEC-022 权限排序一致性（Permission Sort Consistency）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `assertPermissionCatalog`/`assertEventSubscriptionCatalog` 排序缺陷（localeCompare vs PG ORDER BY C collation 不一致，含下划线码触发）。**零结构变更**。

**Architecture:** system-bootstrap-service 提取 `compareByCodeC` 字节序比较器 + 两处 sort 替换 + 含下划线码 bootstrap 一致性测试。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: compareByCodeC + 两处 sort 替换 + 测试

**Files:**
- Modify: `apps/server/app/application/system/system-bootstrap-service.ts`（+compareByCodeC + 两处 sort 替换）
- Modify: `apps/server/test/system/system-bootstrap-service.test.ts`（+含下划线码 bootstrap 一致性用例）

**Interfaces:**
- Consumes: PERMISSION_CATALOG + assertPermissionCatalog + assertEventSubscriptionCatalog。
- Produces: 排序一致性修复（含下划线码 bootstrap 校验正确）。

- [ ] **Step 1: 失败测试先行**

`test/system/system-bootstrap-service.test.ts` 补：
1. 含下划线码目录（`user_role.membership.manage` 形态，构造 catalog 含 `_` 码 + 对应 DB 行按 PG 序）→ assertPermissionCatalog 不抛（旧 localeCompare 会抛 InconsistentSystemStateError——红→绿）。
2. assertEventSubscriptionCatalog 同（构造含 `_` 事件码）。
3. 既有无下划线码目录零回归（既有断言保持）。

- [ ] **Step 2: 实现**

`compareByCodeC` 模块级助手 + `assertPermissionCatalog` :216 / `assertEventSubscriptionCatalog` :256 两处 `sort(compareByCodeC)` 替换。

- [ ] **Step 3: 跑绿**

system-bootstrap 测试全绿 + 相关域（auth/system-bootstrap/user/role/browser-fixture）+ 权限目录契约 + tsc + eslint 0。

---

### Task 2: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（如有权限相关段）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-022-closeout.md`

**Interfaces:**
- Consumes: Task 1 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。**注意外部漂移**：并行渠道 role-membership 在制（权限 124 码）——权限计数契约测试若未同步 124 仍会 fail（外部漂移照录不计，仅本 SPEC 排序相关用例全绿）；预期既有 1841（含外部 +2）+ 本 SPEC 净增全绿 0 真 fail。

- [ ] **Step 2: 安全 + baseline**

`npm run security:test` 34/34 零新增；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook 相关段补排序一致性说明；closeout 十一节（零结构变更 26/60/124/15/路由 11、裁决 D1-D6、已知非阻断——外部漂移照录、Follow-up——权限计数契约同步等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 实现→Task 1；§4 测试→Task 1；§6 边界→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：compareByCodeC Task 1 定义=两处使用；测试构造目录与实现语义一致。
