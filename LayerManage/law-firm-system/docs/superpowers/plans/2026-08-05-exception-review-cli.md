# SPEC-040 例外审批 CLI（Audit Exception Review CLI）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `security:exceptions approve/reject` 受控审批子命令（替代人工编辑 JSON）+ 评审元数据（reviewedAt/reviewedBy）。**零业务代码变更**。

**Architecture:** cli.mjs 子命令解析 + approve/reject 处理（原子写回）+ policy.mjs 评审元数据可选校验。

**Tech Stack:** Node scripts（mjs）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；撞车期间禁跑；55432 禁触。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）。
- scripts 根=`LayerManage/law-firm-system/scripts/security`，config 根=`LayerManage/law-firm-system/security`。

---

### Task 1: approve/reject 子命令 + 评审元数据

**Files:**
- Modify: `scripts/security/cli.mjs`（parseCommandArguments 子命令解析 + approveException/rejectException + 原子写回）
- Modify: `scripts/security/policy.mjs`（例外可选字段 +reviewedAt/reviewedBy 校验）
- Modify: `scripts/security/cli.test.mjs` / `scripts/security/policy.test.mjs`（+审批用例）

**Interfaces:**
- Consumes: 现有 validateExceptions / runExceptionReportCommand。
- Produces: approve/reject 审批命令 + 评审元数据。

- [ ] **Step 1: 失败测试先行**

cli.test 补：approve pending→approved（文件落盘断言）/ already-approved 幂等 / not-found 错误 / owner==reviewer 拒 / reject 移除 / reject not-found / 非法参解析 fail。policy.test 补：reviewedAt 非法日期拒 / reviewedBy 空拒 / 二字段缺省兼容。

- [ ] **Step 2: 实现**

cli.mjs：parseCommandArguments 支持 `audit-exceptions approve <id> --reviewed-by <name>`（5 参）/ `reject <id>`（3 参）；approveException（读+validate→找 id→pending 检查→owner≠reviewedBy→设 approved/approvedBy/reviewedAt/reviewedBy→temp+rename 原子写回）；rejectException（读+validate→找 id→移除→原子写回）。policy.mjs：例外可选字段 +reviewedAt（ISO）/reviewedBy（非空）。

- [ ] **Step 3: 跑绿**

`npm run security:test` 全绿 + `security:exceptions` 报告/审批子命令端到端 + audit:all/prod 双绿。

---

### Task 2: runbook + closeout

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§8 审批命令说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-040-closeout.md`

**Interfaces:**
- Consumes: Task 1 审批命令。
- Produces: 运维说明 + 计数链终态（零结构变更）。

- [ ] **Step 1: runbook**

§8 例外审批：`npm run security:exceptions -- approve <id> --reviewed-by <name>`（pending→approved）/ `reject <id>`（移除）；`security:test` 49→N 基线。

- [ ] **Step 2: closeout**

`spec-040-closeout.md` 十一节（零结构变更、裁决 D1-D5、已知非阻断、Follow-up——Web 审批 UI/批量审批）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3.1-3.3→Task 1；§3.5/§4→各任务；§5 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：reviewedAt/reviewedBy 可选字段 Task 1 定义=policy 校验；approve/reject 子命令 Task 1=cli 解析。
