# SPEC-036 审计例外审批闭环（Audit Exception Approval Workflow）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 例外生命周期状态（pending_review → approved，仅 approved 生效）+ `security:exceptions` 治理报告命令（approved/pending_review/expired/invalid 分类 + 到期预警）。**零业务代码变更**。

**Architecture:** policy.mjs status 校验 + audit-gate.mjs 生效性（hasException 仅认 approved）+ cli.mjs audit-exceptions 报告命令。

**Tech Stack:** Node scripts（mjs）/ npm audit。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`（撞车期间禁跑）；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）。
- scripts 根=`LayerManage/law-firm-system/scripts/security`，config 根=`LayerManage/law-firm-system/security`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: status 生命周期 + 生效性

**Files:**
- Modify: `scripts/security/policy.mjs`（EXCEPTION_FIELDS +status 可选；validateExceptions status 枚举校验，缺省 approved）
- Modify: `scripts/security/audit-gate.mjs`（hasException 仅认 `approved` 或 legacy 无 status）
- Modify: `security/dependency-exceptions.json`（SEC-2026-001 显式补 `"status": "approved"`）
- Modify: `scripts/security/policy.test.mjs` / `scripts/security/audit-gate.test.mjs`（+status 用例）

**Interfaces:**
- Consumes: 现有 validateExceptions / hasException 结构。
- Produces: status 生命周期校验 + 生效性语义。

- [x] **Step 1: 失败测试先行**

policy.test 补：status=approved 接受 / status=pending_review 接受 / 非法 status 拒绝 / 缺省兼容（无 status 视为 approved）。audit-gate.test 补：pending_review 不豁免（development high 仍 block + baselineExcess 不豁免）/ approved（含 legacy）豁免 / 混合（同 package 一 pending 一 approved → approved 生效）。

- [x] **Step 2: 实现**

policy.mjs `validateExceptions`：EXCEPTION_FIELDS +`status`；status 存在须 ∈ {pending_review, approved}，否则 fail；缺省视为 approved（不 fail）。audit-gate.mjs `hasException`：匹配条件追加 `exception.status === undefined || exception.status === 'approved'`。dependency-exceptions.json：SEC-2026-001 补 `"status": "approved"`。

- [x] **Step 3: 跑绿**

`npm run security:test`（policy/audit-gate/contract/cli）全绿 + `security:audit:all`/`prod` 全绿（SEC-2026-001 显式 approved 后行为不变）。

---

### Task 2: 治理报告命令 + runbook/closeout

**Files:**
- Modify: `scripts/security/cli.mjs`（COMMANDS +audit-exceptions；executeSecurityCommand 在 loadSecurityConfiguration 前分支读 raw exceptions 报告）
- Modify: `scripts/security/cli.test.mjs`（+audit-exceptions 报告用例：approved/pending_review/expired/invalid 分类 + expiring_soon 预警 + 非法 JSON 容错）
- Modify: `LayerManage/law-firm-system/package.json`（+`security:exceptions` npm script）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§8 例外生命周期说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-036-closeout.md`

**Interfaces:**
- Consumes: Task 1 status 语义。
- Produces: 治理报告命令 + 计数链终态（零结构变更）。

- [x] **Step 1: 报告命令实现**

cli.mjs COMMANDS +`audit-exceptions`（无参数）；executeSecurityCommand 在 loadSecurityConfiguration **之前**分支：读 `{projectRoot}/security/dependency-exceptions.json` raw → 逐条分类 approved（含 legacy 无 status）/ pending_review / expired（expiresAt 已过）/ invalid（结构非法，记问题）→ stdout 分组输出 + expiring_soon（≤14 天）预警 → exit 0（信息命令不 gate）。

- [x] **Step 2: 测试**

cli.test.mjs 补：报告分类（fixture：approved/pending_review/expired/invalid 各一）+ expiring_soon 预警 + 非法 JSON 容错输出。`npm run security:test` 全绿。

- [x] **Step 3: runbook + closeout**

runbook §8 例外生命周期（pending_review→approved 语义、仅 approved 生效、`security:exceptions` 查看）；closeout `spec-036-closeout.md` 十一节（零结构变更、裁决 D1-D5、已知非阻断、Follow-up——自动审批流/生产 scope 例外）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1/3.2→Task 1；§3.3→Task 2；§4 测试→各任务；§5 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：status 枚举 Task 1 定义=policy 校验；hasException 生效性 Task 1=audit gate；audit-exceptions 命令 Task 2=cli 报告。
