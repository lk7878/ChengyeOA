# SPEC-034 安全审计门禁加固（Security Audit Gate Hardening）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** audit 门禁 moderate 纳入 gate + 基线快照固化断言（防静默回归）。**零业务代码变更**。

**Architecture:** audit-gate/policy moderate gate + expected-baseline.json 断言 + security:test 覆盖。

**Tech Stack:** Node scripts（mjs）/ npm audit。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（**撞车期间禁跑**——外部渠道持续活跃）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）。
- scripts 根=`LayerManage/law-firm-system/scripts/security`，server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: moderate gate + 基线快照

**Files:**
- Modify: `scripts/security/audit-gate.mjs`（moderate 纳入 severe 解析/门禁）
- Modify: `scripts/security/policy.mjs`（production moderate gate 'report'→'block' + 基线断言校验）
- Modify: `scripts/security/policy.test.mjs` / `scripts/security/audit-gate.test.mjs`（+moderate gate + 基线用例）
- Create: `scripts/security/expected-baseline.json`（server + web production/development 全 0）

**Interfaces:**
- Consumes: 现有 audit-gate/policy 结构 + EXCEPTION 机制（advisories 字段）。
- Produces: moderate gate + 基线断言。

- [x] **Step 1: 失败测试先行**

policy/audit-gate 测试补：moderate >0 基线 0 → fail / moderate=0 基线 0 → pass / 超基线 advisory 需例外 / 基线字段完整性。（+4 用例 + 评审 M-3 malformed 注入 fail-closed 用例，security:test 41→42）

- [x] **Step 2: 实现**

audit-gate moderate 纳入；policy production moderate gate 'block' + 基线断言校验（validateGate 扩展：实测 ≥ 期望超基线 fail）；expected-baseline.json 固化（当前全 0）。评审 I-1（cli 显式传 baseline）已修。

- [x] **Step 3: 跑绿**

security:test（policy/audit-gate/contract）42/42 全绿 + `security:audit:all`/`prod` 全绿 + baseline 断言通过。

---

### Task 2: 全量闸门 + runbook/closeout

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（如有安全审计相关段）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-034-closeout.md`

**Interfaces:**
- Consumes: Task 1 moderate gate + 基线。
- Produces: 门禁加固 + 计数链终态（零结构变更）。

- [x] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。**run1 撞车废弃**（外部渠道编辑 permission 文件中窗，77 文件模块加载失败）；**run2 被杀**（10 分钟 cap）；**run3（detached 跑完，权威）1900 tests / 1870 pass / 26 fail / 4 skip**——26 fail = **13 撞车**（`permission.createMany` TRUNCATE 竞态，7 文件清净窗隔离复跑 **95/95 全过**）+ **12 外部漂移**（trust-root ×2 / baseline-contract ×7 迁移 26→27 / permission-catalog ×2 122→129 / spec-003-router ×1）→ **0 真 fail 归 SPEC-034**。

- [x] **Step 2: 安全 + baseline**

`npm run security:test`（root）42/42 全绿（含 policy/audit-gate 新用例）；`security:audit:all`/`prod`（root）全绿 + baseline 断言通过；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0（报告占位符口径，含 runbook+closeout 更新后复扫）。

- [x] **Step 3: runbook + closeout**

runbook 安全审计现状补 moderate gate + 基线说明（`security:test` 34→42 基线）；closeout `spec-034-closeout.md` 十一节（零结构变更 26/60/129/15/路由 15——权限 129 为外部渠道在制态、裁决 D1-D5、已知非阻断、Follow-up——例外审批流程/其他 severity 门禁）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 实现→Task 1；§4 测试→各任务；§5 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：expected-baseline.json 结构 Task 1 定义=policy 校验；moderate gate Task 1=audit:all/prod 验证。
