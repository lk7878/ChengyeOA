# SPEC-021 审批超时升级（Timeout Escalation）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 超时升级——定时扫描 PENDING task 滞留超时（配置阈值），为目标审批人生成提醒通知（Notification type APPROVAL，dedup 幂等）+ 审计。**零结构变更**（复用 Notification/operation_log，不产 outbox 事件，复用 event-worker tick 旁挂 scanner）。

**Architecture:** 新建 `approval-timeout-scanner.ts`（仿 LeadRecycleScanner：scanOnce(now) 可测）+ event-services-factory 注入 tick 旁挂 listener + `APPROVAL_TIMEOUT_HOURS` 阈值配置。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 ApprovalTimeoutScanner + 节律接线 + 测试

**Files:**
- Create: `apps/server/app/application/approval/approval-timeout-scanner.ts`（+ApprovalTimeoutScanner + scanOnce）
- Modify: `apps/server/app/application/events/event-services-factory.ts`（注入 scanner tick 旁挂 listener——沿 LeadRecycleScanner 注入点）
- Modify: `apps/server/app/config/config.default.ts` 或等价（+APPROVAL_TIMEOUT_HOURS 读取）
- Modify: `apps/server/app/domain/approval/approval-errors.ts` 或复用（isUniqueConflictOn 本地镜像——沿既有惯例）
- Create: `apps/server/test/approval/approval-timeout-scanner.test.ts`（+scanOnce 用例）

**Interfaces:**
- Consumes: Notification 模型（type APPROVAL + deduplicationKey unique）+ operation_log + event-worker tick 旁挂模式（LeadRecycleScanner 先例）。
- Produces: 超时扫描 + 提醒通知 + 审计（前端经 Notification 可见）。

- [ ] **Step 1: 失败测试先行**

`test/approval/approval-timeout-scanner.test.ts` 补 scanOnce 用例：
1. 超时 task 生成通知（assigneeId/title/content 含实例标题与节点/dedup key 形态/relatedId/routeUrl）+ 审计 APPROVAL_TIMEOUT_NOTIFIED（timeoutHours）。
2. 未超时（createdAt 近于 cutoff）不生成。
3. 实例非 PENDING 不生成（实例 APPROVED 但 task 遗留）。
4. dedup 幂等：二次 scanOnce 同 task 不重复通知。
5. 按天去重：同日不重复；构造跨日 now 再提醒。
6. 并发 P2002 防重（isUniqueConflictOn deduplicationKey）。
7. 返回提醒数正确。

`event-services-factory` 节律：scanOnce 注入 tick 旁挂 listener（沿 LeadRecycleScanner 测试形态——可抽查 factory 是否调用）。

- [ ] **Step 2: 实现**

`ApprovalTimeoutScanner`（见设计 §3）+ `APPROVAL_TIMEOUT_HOURS` 配置读取 + factory 注入（`scanner.scanOnce` 注入 tick 旁挂 listener，try/catch 隔离）。

- [ ] **Step 3: 跑绿**

scanner 测试全绿 + approval 域既有零回归（instance 73 + definition 17 + api 23 + policy/catalog 34 + events 15）+ tsc + eslint 0。

---

### Task 2: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补超时升级语义）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-021-closeout.md`

**Interfaces:**
- Consumes: Task 1 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1830 + 本 SPEC 净增全绿 0 fail。

- [ ] **Step 2: 安全 + baseline**

`npm run security:test` 34/34 零新增；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9 补超时升级（ApprovalTimeoutScanner/scanOnce/APPROVAL_TIMEOUT_HOURS 阈值/dedup 幂等/Notification type APPROVAL/审计）；closeout 十一节（零结构变更 26/60/122/15/路由 11、裁决 D1-D10、已知非阻断、Follow-up——自动升级动作/多级升级/超时统计/全组织视图等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 配置→Task 1；§6 测试→各任务；§7 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ApprovalTimeoutScannerConfig Task 1 定义=Task 1 使用；`APPROVAL_TIMEOUT_HOURS` 读取=scanner 构造；Notification dedup key Task 1=测试断言。
