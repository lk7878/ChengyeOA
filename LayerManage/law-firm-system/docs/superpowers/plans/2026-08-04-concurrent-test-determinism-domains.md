# SPEC-027 其余域并发测试确定性化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统化评估全部 ~24 处 `Promise.allSettled` 并发用例（其余域），按 A-F 分类，修补真 flake（E）。**零结构变更**（仅测试改造）。

**Architecture:** 按域逐文件评估分类（contract 5 / master-data 6 / events 3 / crm 2 / finance 2 / system 2 / admin-governance 1 / auth 1 / acceptance 2）；E 类修补（version 前置 / 宽容断言 / lockHolder）；A-F 评估表 + runbook §8 扩展 + closeout。

**Tech Stack:** Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；**撞车期间禁跑**（遇外来进程 TRUNCATE 静候清净窗）。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 系统化评估 + 修补 E 类（contract/finance/crm）

**Files:**
- Modify: `apps/server/test/contract/contract-service.test.ts`（:908/:1516 若 E 类）
- Modify: `apps/server/test/contract/negotiation-service.test.ts`（:661 若 E 类）
- Modify: `apps/server/test/contract/receivable-service.test.ts`（:1130 若 E 类）
- Modify: `apps/server/test/contract/receivable-void.test.ts`（:509/:585 若 E 类）
- Modify: `apps/server/test/finance/invoice-service.test.ts`（:567 若 E 类）
- Modify: `apps/server/test/finance/refund-service.test.ts`（:1070/:1578 若 E 类）
- Modify: `apps/server/test/crm/lead-assignment-service.test.ts`（:693 若 E 类）
- Modify: `apps/server/test/crm/lead-follow-service.test.ts`（:555/:588 若 E 类）

**Interfaces:**
- Consumes: SPEC-026 确定性构造模式（version 前置 / 宽容断言 / lockHolder）。
- Produces: contract/finance/crm 域并发用例评估表 + E 类修补。

- [ ] **Step 1: 评估分类**
逐文件按 A-F 分类，产出评估表（文件/行/分类/依据）。
- [ ] **Step 2: 修补 E 类**
按设计 §3 修补（version 前置 / 宽容断言 / lockHolder），断言不变。
- [ ] **Step 3: 多次运行**
改造文件 ≥2 次运行确认零 flake + 相关域零回归 + tsc/eslint 0。

---

### Task 2: 评估 + 修补（master-data/system/others）+ 闸门收尾

**Files:**
- Modify: `apps/server/test/master-data/*.test.ts`（employee/position/organization/assignment/reporting-line/professional-team 若 E 类）
- Modify: `apps/server/test/system/*.test.ts`（second-super-admin :120 / system-bootstrap :540 若 E 类）
- Modify: `apps/server/test/admin-governance/governance-concurrency.test.ts`（:50/:73 若 E 类）
- Modify: `apps/server/test/auth/step-up-service.test.ts`（:221 若 E 类）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§8 并发测试纪律扩展——A-F 分类）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-027-closeout.md`

**Interfaces:**
- Consumes: Task 1 评估 + 修补。
- Produces: 全项目并发用例确定性 + 计数链终态（零结构变更）。

- [ ] **Step 1: 评估 + 修补**
master-data/system/admin-governance/auth 逐文件 A-F 分类 + E 类修补。
- [ ] **Step 2: 后端全量**
后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1874 全绿 0 真 fail（外部漂移照录）。
- [ ] **Step 3: 闸门 + 文档**
`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。runbook §8 补 A-F 分类纪律 + closeout 十一节（零结构变更 26/60/124/15/路由 13、评估表、E 类修补、已知非阻断、Follow-up——新并发用例纪律）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §2 分类→Task 1/2；§4 测试→各任务；§6 边界→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：确定性构造模式沿 SPEC-026 先例；改造仅测试文件无类型变更。
