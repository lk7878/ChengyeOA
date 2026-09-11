# SPEC-023 审批全组织视图（Org-Wide View）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全组织视图——`approval.manage` 权限用户查看全组织审批实例列表（突破 actor 作用域），前端「全部审批」Tab。**零结构变更**（复用 approval.manage + listInstances role 扩展）。

**Architecture:** listInstances role='ALL'（动态门控 approval.manage）+ getInstance manage 放行 + 前端 Tab。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 listInstances role='ALL' + getInstance manage 放行

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（listInstances role ALL + getInstance manage 放行）
- Modify: `apps/server/app/application/approval/approval-types.ts`（APPROVAL_ROLE_FILTERS +'ALL'）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+role ALL 用例）

**Interfaces:**
- Consumes: approval.manage 权限码 + listInstances/getInstance 既有 actor 作用域。
- Produces: 全组织视图 list/get（Task 2 前端消费）。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补：
1. role='ALL' 无 approval.manage → 403。
2. role='ALL' 有 manage → 全组织列表（含非本人实例 + 分页正确）。
3. getInstance manage 用户可见任意实例详情（非申请人非审批人）。
4. getInstance 非 manage 非申请人非审批人 → 404（既有语义保持）。
5. 三既有 role（APPLIED/TODO/DONE）零回归。

- [ ] **Step 2: 实现**

listInstances role 四值 + 动态门控（ALL→manage，余→read）；getInstance manage 放行（hasAction 探测或 try/catch requireAction——按既有 AuthorizationService API 形态）。`APPROVAL_ROLE_FILTERS` +'ALL'。

- [ ] **Step 3: 跑绿**

approval-instance-service（73+新）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: 前端 Tab + 闸门收尾

**Files:**
- Modify: `apps/web/src/api/approval.ts`（ApprovalRoleFilter +'ALL'）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（+「全部审批」Tab，approval.manage 门控）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+Tab 用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补全组织视图）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-023-closeout.md`

**Interfaces:**
- Consumes: Task 1 全组织视图 API。
- Produces: 全组织视图端到端 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**

前端测试：全部审批 Tab 门控（无 approval.manage 隐藏）/ 列表渲染 / 既有 26 例零回归。

- [ ] **Step 2: 实现**

`api/approval.ts` +'ALL'；`ApprovalCenterPage.tsx` 条件追加「全部审批」Tab（manage 门控）；列表/详情/操作复用（操作仍 actor 语义）。

- [ ] **Step 3: 闸门 + 文档**

前端四闸门（隔离测试 + typecheck 0 + lint 0 err + build）；后端全量串行（预期 1844 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。runbook §9 补全组织视图段 + closeout 十一节（零结构变更 26/60/124/15/路由 11、裁决 D1-D8、已知非阻断、Follow-up——全量筛选/搜索/导出/动作扩大 OUT 等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§5 前端→Task 2；§6 测试→各任务+Task 2；§7 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：APPROVAL_ROLE_FILTERS +'ALL' Task 1 定义=Task 2 前端；approval.manage 动态门控 Task 1=前端 Tab 门控；getInstance manage 放行 Task 1=前端详情。
