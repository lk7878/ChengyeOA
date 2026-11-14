# SPEC-027 其余域并发测试确定性化（Other-Domain Concurrent Test Determinism）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** contract/admin-governance/user-grant/step-up/acceptance 的 Promise.allSettled 并发用例逐一评估，仅真 flake 改确定性/宽容断言。**零结构变更**。

**Architecture:** 逐一评估 10 处（contract-service :908/:1516、negotiation :661、receivable :1130、receivable-void :509/:585、governance-concurrency :50/:73、user-grant :50、step-up :221、acceptance :177）→ 真 flake 改造（version 前置/宽容断言）。

**Tech Stack:** Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（**撞车期间禁跑**——共享 test DB TRUNCATE 竞态活跃，探得外来 ACTIVE 连接静候清净窗）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行（改造后确定性断言）。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 评估 + 改造其余域并发用例

**Files:**
- Modify: `apps/server/test/contract/contract-service.test.ts`（:908/:1516）
- Modify: `apps/server/test/contract/negotiation-service.test.ts`（:661）
- Modify: `apps/server/test/contract/receivable-service.test.ts`（:1130）
- Modify: `apps/server/test/contract/receivable-void.test.ts`（:509/:585）
- Modify: `apps/server/test/admin-governance/governance-concurrency.test.ts`（:50/:73）
- Modify: `apps/server/test/authorization/user-grant-service.test.ts`（:50）
- Modify: `apps/server/test/auth/step-up-service.test.ts`（:221）
- Modify: `apps/server/test/acceptance/spec-005-acceptance.test.ts`（:177）

**Interfaces:**
- Consumes: SPEC-026 runbook §8 纪律（version 前置/宽容断言）+ 确定性构造模式。
- Produces: 其余域并发用例确定性化（零 flake）。

- [ ] **Step 1: 评估**

逐一审读 10 处：已确定性（唯一约束/version 守卫/宽容断言）→ 零改动；真 flake → 改造。产出评估表。

- [ ] **Step 2: 改造 + 多次运行**

真 flake 改造（version 前置/宽容断言）+ 多次运行确认零 flake。

- [ ] **Step 3: 跑绿**

改造文件全绿（多次运行）+ 相关域零回归 + tsc + eslint 0。

---

### Task 2: 评审裁决 + 闸门收尾

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（如有并发纪律相关段）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-027-closeout.md`

**Interfaces:**
- Consumes: Task 1 改造。
- Produces: 其余域并发用例确定性化 + 计数链终态（零结构变更）。

- [ ] **Step 1: 评审裁决**

评审改造正确性 + 保留用例裁决。

- [ ] **Step 2: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1874 全绿 0 真 fail（外部漂移照录）。

- [ ] **Step 3: 闸门 + 文档**

`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0（报告占位符口径）。closeout 十一节（零结构变更 26/60/124/15/路由 13、裁决 D1-D6、已知非阻断、Follow-up）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 评估改造→Task 1；§5 边界→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：确定性构造模式 Task 1=SPEC-026 先例；改造仅测试文件无类型变更。
