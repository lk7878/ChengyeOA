# SPEC-031 dev 依赖清理（Dev Dependency Cleanup）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `security:audit:all`（含 dev）全绿——brace-expansion/tar/undici/postcss dev 遗留清零。**零业务代码变更**。

**Architecture:** server + web package.json overrides 更新 + npm install + audit:all 验证。

**Tech Stack:** npm / Egg.js 3 + TS / React 19 + Vitest / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（**撞车期间禁跑**——外部渠道持续活跃）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: overrides 更新 + audit:all 清零

**Files:**
- Modify: `apps/server/package.json`（overrides：brace-expansion `@^5.0.5→5.0.9`、tar `<7.5.21→7.5.21`）
- Modify: `apps/web/package.json`（overrides：brace-expansion `@^5.0.5→5.0.9`、undici `<7.29.0→7.29.0`、postcss `<8.5.23→8.5.23`）

**Interfaces:**
- Consumes: 既有 overrides（SPEC-030 server 块）。
- Produces: `security:audit:all` 全绿（server + web 含 dev）。

- [ ] **Step 1: 更新 overrides**

server：brace-expansion `@^5.0.5: 5.0.8`→`5.0.9`；+tar `<7.5.21: 7.5.21`。web：+overrides 块（brace-expansion `@^5.0.5: 5.0.9`、undici `<7.29.0: 7.29.0`、postcss `<8.5.23: 8.5.23`——版本按 audit 建议/实现时确认）。

- [ ] **Step 2: 应用 + 验证**

`npm install`（server + web）→ `security:audit:all`（root）server + web 全绿含 dev（high=0/moderate=0）。

- [ ] **Step 3: 兼容回归**

`npm run security:test`（root）34/34 + 工具链（eslint/tsc/build）零回归。若 minor 升级破坏 → 回退评估。

---

### Task 2: 全量闸门 + runbook/closeout

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（如有安全审计相关段）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-031-closeout.md`

**Interfaces:**
- Consumes: Task 1 override。
- Produces: audit:all 全绿 + 计数链终态（零结构变更）。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 ≈1901 全绿 0 真 fail（外部漂移照录）。

- [ ] **Step 2: 安全 + baseline**

`npm run security:test`（root）34/34；`security:audit:all`（root）server + web 全绿含 dev；`security:audit:prod` 保持 0；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook 如有安全审计段补 audit:all 全绿说明；closeout `spec-031-closeout.md` 十一节（零结构变更 26/60/124/15/路由 13、裁决 D1-D6、已知非阻断、Follow-up——SEC-2026-002 观察/后续依赖审计）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 实现→Task 1；§4 测试→各任务；§5 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：override 版本 Task 1=audit 验证；无业务代码变更。
