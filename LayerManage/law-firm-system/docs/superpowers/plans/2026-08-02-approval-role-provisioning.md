# SPEC-015 审批中心业务角色供给（Approval Role Provisioning）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 个约定业务角色（HR/SEAL_ADMIN/FINANCE/PARTNER）bootstrap 种子供给 + 审批权限授予，使审批中心五类申请端到端可用。

**Architecture:** system-bootstrap-service 扩展（沿既有 SYSTEM 角色创建形态建 4 个 BUSINESS 角色 + role_permission 授予 approval.read/process）+ check-bootstrap-contract 契约更新（2→6）。零结构变更。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`。

---

### Task 1: bootstrap 4 BUSINESS 角色供给 + 权限授予 + 契约更新

**Files:**
- Modify: `apps/server/app/application/system/system-bootstrap-service.ts`
- Modify: `apps/server/scripts/ci/check-bootstrap-contract.ts` + `apps/server/test/ci/bootstrap-contract.test.ts`（若有）
- Modify: `apps/server/test/system/system-bootstrap-service.test.ts`（或对应测试件）

**Interfaces:**
- Consumes: 既有 bootstrap 角色创建形态（:65-91）+ Role/RolePermission 模型 + approval.read/process 权限（SPEC-013 已供）。
- Produces: 4 BUSINESS 角色 out-of-the-box（Task 2 端到端消费）。

- [ ] **Step 1: 失败测试先行**

`system-bootstrap-service.test.ts` 补：fresh init（reset+bootstrap）后——`role.findMany` 恰 6（2 SYSTEM + 4 BUSINESS：HR/SEAL_ADMIN/FINANCE/PARTNER 逐 code/type='BUSINESS'/status='ENABLED'）；HR 角色 role_permission 含 approval.read + approval.process（直查 code）；幂等（bootstrap 二次运行零新增）。

- [ ] **Step 2: 实现**

`system-bootstrap-service.ts`：沿既有角色创建形态（:65-91 事务内 `tx.role.create` + 幂等守卫）追加 4 BUSINESS 角色段（HR/SEAL_ADMIN/FINANCE/PARTNER，name 中文、type='BUSINESS'、status='ENABLED'）+ 每角色 role_permission 两行（approval.read/approval.process——permission 按 code 查 id）。幂等：沿既有 `if (exists) skip` 守卫。

`check-bootstrap-contract.ts`：角色计数 2→6 + code 清单更新。

- [ ] **Step 3: 跑绿**

bootstrap 测试全绿 + check-bootstrap-contract 实测 PASS + 既有 bootstrap 相关测试零回归 + tsc + eslint 0。

---

### Task 2: 审批中心端到端可用性验证（五类申请→审批）

**Files:**
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（或新建 role-provisioning 集成测试）

**Interfaces:**
- Consumes: Task 1 角色供给 + 既有审批中心服务。
- Produces: 五类申请端到端可用实证。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补：测试内指派成员（userRole 建 HR 角色成员）→ LEAVE 申请（HR 角色解析成员非空）→ HR 成员审批定稿——五类各一（LEAVE→HR/SEAL→SEAL_ADMIN/EXPENSE→FINANCE/CONTRACT_CHANGE→PARTNER/TRANSFER→HR），断言审批人解析非空 + 申请成功 + 审批定稿。

- [ ] **Step 2: 实现**

（无生产代码——验证型任务，仅测试。若测试暴露解析问题则修复。）

- [ ] **Step 3: 跑绿**

五类端到端测试全绿 + test/approval/ 目录全绿 + tsc + eslint 0。

---

### Task 3: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9.1 角色未建边界更新——已供给，成员指派归运行期）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-015-closeout.md`

**Interfaces:**
- Consumes: Task 1-2 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗），预期既有 1749 + 本 SPEC 新增全绿 0 fail（spec-008 3 例 port-guard 照录）。

- [ ] **Step 2: 安全 + baseline**

`npm run security:test` 34/34 零新增；check:baseline（23/60）+ check:bootstrap（**2→6 角色契约**）PASS；docs-leakage exit 0（报告沿用占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9.1 角色未建边界更新为「已 bootstrap 供给 4 业务角色 + 权限授予；成员指派归运行期（role-auth-service/user-grant）」；closeout 十一节（计数链——零结构变更 23/60/121/15、裁决录 Q1-5、已知非阻断项、follow-up 路由——审批中心深化/terminate 侧硬化/漂移/flake/安全专项等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 bootstrap 供给→Task 1；§4 端到端→Task 2；§5 计数→Task 3；§6 边界→全部任务守住。零缺口。
- **占位符扫描**：无 TBD/TODO；bootstrap 幂等守卫（既有形态）标注"沿既有守卫"。
- **类型一致性**：角色 code 清单 Task 1 定义=Task 2 端到端消费=check-bootstrap 契约；permission code（approval.read/process）引用 SPEC-013 既有码。
