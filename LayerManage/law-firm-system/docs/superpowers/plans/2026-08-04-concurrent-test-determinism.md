# SPEC-026 并发测试确定性化（Concurrent Test Determinism）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既有 Promise.allSettled 时序并发用例改确定性构造（version 前置优先），消除 flake 源。**零结构变更**（仅测试改造）。

**Architecture:** approval-instance-service.test.ts 4 处 + role-authorization-service.test.ts 1 处 Promise.allSettled 并发用例逐一评估改造（version 前置确定性 / 保留容错）。

**Tech Stack:** Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行（改造后确定性断言）。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 改造 approval 域并发用例

**Files:**
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（:586 processTask callbackKey 并发 / :2128 forwardTask 并发 / :2188/:2554 其他——逐一评估改造）
- Modify: `apps/server/test/authorization/role-authorization-service.test.ts`（:74 若适用）

**Interfaces:**
- Consumes: version 前置确定性构造模式（SPEC-024 同体 PATCH 先例）。
- Produces: 确定性并发测试（零 flake）。

- [ ] **Step 1: 识别 + 评估**

逐一评估 5 处 Promise.allSettled 并发用例：
- forwardTask 并发（:2128）→ **version 前置确定性**（先推进 version、客户端持旧 version 调用 → 409——有 version 守卫）。
- updateDefinition/setStatus/组合方法并发（:2188/:2554 若为 definition 域）→ version 前置确定性。
- processTask callbackKey 跨实例并发（:586）→ 真实并发 P2002 兜底语义——评估可否确定性化（若需真实竞争则保留 + 宽断言或 retry，评审裁决）。
- role-authorization :74 → 评估。

- [ ] **Step 2: 改造 + 多次运行**

改造后多次运行（≥3 次）确认零 flake（确定性）。

- [ ] **Step 3: 跑绿**

改造文件全绿（多次运行）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: 评审裁决 + 闸门收尾

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§8 或相关段补并发测试纪律）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-026-closeout.md`

**Interfaces:**
- Consumes: Task 1 改造。
- Produces: 并发测试确定性化 + 计数链终态（零结构变更）。

- [ ] **Step 1: 评审裁决**

评审改造正确性 + 不可确定性化用例裁决（保留/容错/注记）。

- [ ] **Step 2: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1874 全绿 0 真 fail（外部漂移照录）。

- [ ] **Step 3: 闸门 + 文档**

`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0（报告占位符口径）。runbook 补并发测试纪律 + closeout 十一节（零结构变更 26/60/124/15/路由 13、裁决 D1-D6、已知非阻断、Follow-up——其余域并发用例改造等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 改造模式→Task 1；§4 测试→各任务；§6 边界→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：version 前置构造 Task 1=SPEC-024 先例；改造仅测试文件无类型变更。
