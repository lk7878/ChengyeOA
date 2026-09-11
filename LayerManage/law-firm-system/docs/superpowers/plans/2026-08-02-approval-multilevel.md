# SPEC-016 审批中心多级审批（Approval Multi-Level）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 审批中心多级审批——Definition nodeSchema 多节点链、Instance 逐节点流转（currentNode）、末节点定稿；CONTRACT_CHANGE 升级为真实多节点链。

**Architecture:** ApprovalDefinition +nodeSchema Json?（缺省=单节点向后兼容）+ ApprovalInstance +currentNode Int；apply 建节点[0] Task、process 节点推进（下节点自审校验）、withdraw 任意 PENDING 阶段；bootstrap +MANAGER + CONTRACT_CHANGE 种子升级。迁移 23→24。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 结构迁移（+nodeSchema/currentNode 2 列）+ 基线

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260802100000_approval_multilevel_expand/migration.sql`
- Modify: `apps/server/scripts/ci/check-baseline-contract.ts`、`apps/server/test/ci/baseline-contract.test.ts`、`apps/server/test/db/spec-008-event-observability-migration-contract.test.ts`（迁移 23→24）

**Interfaces:**
- Consumes: Task 1 模型。
- Produces: nodeSchema/currentNode 列（Task 2-4 消费）。

- [ ] **Step 1: schema + 迁移**

`ApprovalDefinition` +`nodeSchema Json?`（:1179 附近，注释「多级节点链；缺省=顶层 approverRule 单节点」）；`ApprovalInstance` +`currentNode Int @default(0)`（:1200 附近）。

迁移 SQL：`ALTER TABLE "approval_definition" ADD COLUMN "nodeSchema" JSONB;` + `ALTER TABLE "approval_instance" ADD COLUMN "currentNode" INTEGER NOT NULL DEFAULT 0;`。

- [ ] **Step 2: 基线锚点 23→24**

`check-baseline-contract.ts:11` `CANONICAL_PRISMA_MIGRATION_COUNT` 23→24；`baseline-contract.test.ts` 7 处 `expected 23`→`expected 24`；`spec-008-event-observability-migration-contract.test.ts` `migrationDirectories.length` 23→24。`npm run db:generate` 再生 Client。**模型计数 60 不变**（+2 列不加模型）。

- [ ] **Step 3: 闸门**

migrate diff 零新 diff（仅既有 4 漂移）+ baseline 件全绿 + tsc 0。

---

### Task 2: bootstrap +MANAGER + CONTRACT_CHANGE 种子升级

**Files:**
- Modify: `apps/server/app/application/system/system-bootstrap-service.ts`（+MANAGER）
- Modify: `apps/server/scripts/ci/check-bootstrap-contract.ts`（2→7）
- Create: `apps/server/prisma/migrations/20260802110000_approval_multilevel_provision/migration.sql`（CONTRACT_CHANGE nodeSchema 升级）
- Modify: 对应测试件

**Interfaces:**
- Consumes: Task 1 模型。
- Produces: MANAGER 角色 + CONTRACT_CHANGE 多节点链（Task 3-5 消费）。

- [ ] **Step 1: bootstrap +MANAGER**

`BUSINESS_ROLE_SEEDS` +`{ code:'MANAGER', name:'主管' }`（type BUSINESS/status ENABLED）+ rolePermission approval.read/process。**check-bootstrap-contract REQUIRED_ROLE_CODES 6→7**（+MANAGER）。

- [ ] **Step 2: CONTRACT_CHANGE 种子升级 provisioning**

`20260802110000_approval_multilevel_provision/migration.sql`：UPDATE `approval_definition` SET `nodeSchema`='[{"name":"主管初审","approverRule":{"type":"ROLE","roleCodes":["MANAGER"]}},{"name":"合伙人终审","approverRule":{"type":"ROLE","roleCodes":["PARTNER"]}}]' WHERE `code`='CONTRACT_CHANGE'（approverRule 保留不动——nodeSchema 权威；幂等无冲突）。

- [ ] **Step 3: 测试 + 闸门**

bootstrap 测试（角色 7/新 MANAGER 授权）+ contract 测试（check-bootstrap PASS 2→7）+ CONTRACT_CHANGE nodeSchema 直查 + tsc/eslint 0 + check:bootstrap PASS。

---

### Task 3: 服务层多级（apply 链构建/process 节点推进/withdraw/视图）+ 测试

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`
- Modify: `apps/server/app/application/approval/approval-types.ts`（DTO 视图 +currentNode）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+多级用例）

**Interfaces:**
- Consumes: Task 1/2。
- Produces: 多级 apply/process/withdraw + 视图 currentNode（Task 4 前端消费）。

- [ ] **Step 1: 失败测试先行**

多级用例：①多节点 apply（链=[2 节点]）→ 节点[0] Task/currentNode=0/实例 PENDING；②节点推进——节点[0] APPROVE → currentNode=1+节点[1] Task（MANAGER 成员生成）+ 实例仍 PENDING；③末节点 APPROVE → 实例 APPROVED+completed 事件恰 1；④REJECT 节点[1] → REJECTED+当前/未来 task CANCELLED；⑤下节点自审 409（节点[1] 审批人含申请人）；⑥单节点向后兼容（5 种子零改动→原流程）；⑦withdraw 节点[1] 阶段。

- [ ] **Step 2: 实现**

`applyForApproval`：链构建 `definition.nodeSchema ?? [{name:'审批', approverRule: definition.approverRule}]` → 节点[0] 审批人解析/自审 → Instance PENDING + 节点[0] Task（nodeName=节点名）。
`processTask`：翻转后——REJECT → REJECTED + 当前+未来 PENDING task CANCELLED + completed(REJECTED)；APPROVE → currentNode === 链长度-1 ? 定稿 APPROVED : currentNode++ + **下节点审批人解析（含申请人 → SELF_REVIEW_FORBIDDEN 409）** + create 下节点 Task + 实例仍 PENDING。回调/幂等（CallbackAction/任务状态）语义不变。
`withdrawInstance`：PENDING（任意 currentNode）→ WITHDRAWN + 当前+未来 PENDING task CANCELLED。
`loadInstanceView`/projection：+currentNode；completed 事件仅在定稿（末节点 APPROVE/任一 REJECT/WITHDRAW）。

- [ ] **Step 3: 跑绿**

多级用例全绿 + 既有单节点用例零回归 + test/approval 全绿 + tsc + eslint 0。

---

### Task 4: 前端（详情/待办节点显示）

**Files:**
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（详情弹窗节点进度 + 待办节点名）
- Modify: `apps/web/src/api/approval.ts`（ApprovalInstanceView +currentNode）
- Modify: 对应测试件

**Interfaces:**
- Consumes: Task 3 视图。
- Produces: 多级可见性。

- [ ] **Step 1: 失败测试先行**

页面测试：详情弹窗显示 currentNode/节点进度（tasks 分组 by nodeName + 当前节点 tag）；待办 Tab 显示节点名。

- [ ] **Step 2: 实现**

`api/approval.ts` view +currentNode；详情弹窗：tasks 按 nodeName 分组 + currentNode 标记当前节点（tag "审批中"）；待办行显示 nodeName。

- [ ] **Step 3: 前端四闸门**

受影响件隔离测试 + typecheck 0 + lint 0 err（预存 warning 照录）+ build 成功。

---

### Task 5: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9.2 状态机补多级 + §9.3 流程补节点推进）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-016-closeout.md`

**Interfaces:**
- Consumes: Task 1-4 全部。
- Produces: 计数链终态 + follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗），预期既有 1759 + 本 SPEC 新增全绿 0 fail（spec-008 3 例 port-guard 照录）。

- [ ] **Step 2: 前端 + 安全 + baseline**

前端四闸门（新件全绿 + 基线 flake 照录）；`npm run security:test` 34/34 零新增；check:baseline（24/60）+ check:bootstrap（**角色 2→7**）+ docs-leakage exit 0（报告沿用占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9.2 状态机补「多级节点推进（currentNode）」+ §9.3 流程补节点链/下节点自审；closeout 十一节（计数链——迁移 24/模型 60/权限 121/事件 15/路由不变、裁决录 Q1-5、已知非阻断项、follow-up 路由——会签/转交/超时/Definition CRUD/全组织视图/漂移/flake/安全专项等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 模型→Task 1；§3 种子/bootstrap→Task 2；§4 行为→Task 3；§5 前端→Task 4；§6 测试→各任务+Task 5；§8 边界→全部任务守住。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：nodeSchema/currentNode Task 1 定义=Task 2/3 消费=视图；MANAGER Task 2 定义=CONTRACT_CHANGE 节点[0] 消费；`ApprovalInstanceView +currentNode` Task 3 产出=Task 4 前端消费。
