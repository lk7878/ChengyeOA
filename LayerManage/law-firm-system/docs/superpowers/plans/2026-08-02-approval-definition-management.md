# SPEC-017 审批定义管理（Approval Definition Management）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 审批定义管理 CRUD 端到端——`approval.manage` 权限码 + 定义服务增删改查 + 管理路由 + 前端定义管理页。零迁移/零模型变更。

**Architecture:** ApprovalDefinitionService 扩展 4 方法（create/update/setStatus/listAll）+ approval.manage 权限码（121→122）+ 3 管理路由（POST/GET manage/PATCH）+ ApprovalCenterPage 增「定义管理」Tab。复用既有 ApprovalDefinition 模型（code/name/businessType/formSchema/approverRule/nodeSchema/version/status）。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 权限码 + 服务层 CRUD

**Files:**
- Modify: `apps/server/scripts/ci/check-permission-catalog.ts`（权限目录 121→122 + approval.manage）
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（+create/update/setStatus/listAll + nodeSchema/formSchema/approverRule 校验）
- Modify: `apps/server/app/domain/approval/approval-errors.ts`（+APPROVAL_DEFINITION_CODE_CONFLICT）
- Modify: `apps/server/test/approval/`（+服务用例，新建 definition-service 测试或并入既有）

**Interfaces:**
- Consumes: `ApprovalDefinitionView` 投影 + `buildApprovalChain` 校验语义（SPEC-016）+ ApprovalError。
- Produces: 定义 CRUD 服务方法 + approval.manage 权限码（Task 2 路由/3 前端消费）。

- [ ] **Step 1: 失败测试先行**

定义服务测试（新建 `test/approval/approval-definition-service.test.ts` 或并入 `approval-instance-service.test.ts` 同目录新件）：
1. create 成功：视图全字段 + version=1 + status ACTIVE + createdBy=actor + 审计。
2. create code 冲突 400（`APPROVAL_DEFINITION_CODE_CONFLICT`）。
3. create nodeSchema 畸形 400（空数组/非数组对象——沿 SPEC-016 语义）。
4. create approverRule 畸形 400。
5. create formSchema 畸形 400。
6. update 白名单（name/formSchema/approverRule/nodeSchema）+ version+1 + code/businessType 不可变。
7. update 缺 404。
8. setStatus DISABLE → 既有 getActiveDefinition 404（apply 拒）。
9. setStatus ENABLE 恢复 → getActiveDefinition 可见。
10. listAll 含 DISABLED + 按 code 升序。
11. 管理方法 requireAction approval.manage（缺码 403）。

- [ ] **Step 2: 实现**

`ApprovalDefinitionService` 增 4 方法 + 校验助手。`approval-errors.ts` +`APPROVAL_DEFINITION_CODE_CONFLICT`（400）。`check-permission-catalog.ts` 权限目录 +approval.manage（121→122）。

- [ ] **Step 3: 跑绿**

定义服务测试全绿 + approval 域既有（instance 48 + policy/catalog 34）零回归 + tsc + eslint 0 + check:permission-catalog 122。

---

### Task 2: 控制器 + 路由

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（+createDefinition/updateDefinition/listDefinitionsManage）
- Modify: `apps/server/app/router.ts`（+3 管理路由，字面量 manage 优先）
- Modify: `apps/server/test/app/approval-api.test.ts`（+路由门禁用例）

**Interfaces:**
- Consumes: Task 1 服务方法 + approval.manage 权限码。
- Produces: 管理 API（Task 3 前端消费）。

- [ ] **Step 1: 失败测试先行**

API 测试：POST definitions（approval.manage 门禁——缺码 403）/ GET definitions/manage（approval.manage）/ PATCH :code（approval.manage + update 生效）/ 字面量 manage 优先于 :code 路由。

- [ ] **Step 2: 实现**

`approvalController` +3 方法；`router.ts` 3 条管理路由（`GET /definitions/manage` 字面量先于 `PATCH /definitions/:code`）。

- [ ] **Step 3: 跑绿**

API 测试全绿 + 既有 approval-api 零回归 + tsc + eslint 0。

---

### Task 3: 前端定义管理页 + 闸门收尾

**Files:**
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（+「定义管理」Tab——approval.manage 门控）
- Modify: `apps/web/src/api/approval.ts`（+createDefinition/updateDefinition/listDefinitionsManage）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+管理 Tab 用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补定义管理）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-017-closeout.md`

**Interfaces:**
- Consumes: Task 1/2 API。
- Produces: 定义管理端到端 + 计数链终态（权限 122）。

- [ ] **Step 1: 失败测试先行**

前端测试：管理 Tab 门控（无 approval.manage 隐藏）/ 列表渲染 / 新建提交（code 冲突提示）/ 禁用确认。非恒真。

- [ ] **Step 2: 实现**

`ApprovalCenterPage` +「定义管理」Tab（门控 + 列表 + 新建/编辑 Modal + 禁用 Popconfirm）。`api/approval.ts` +3 API 方法。

- [ ] **Step 3: 闸门 + 文档**

后端全量串行（预期既有 1775 + 本 SPEC 净增全绿）+ 前端四闸门 + `security:test` 34/34 + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:permission-catalog（**122**）+ docs-leakage exit 0。runbook §9 补定义管理段 + closeout 十一节（权限 121→122、裁决 D1-D11、已知非阻断、follow-up——会签/转交/超时/全组织视图等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 权限/路由→Task 2；§4 服务层→Task 1；§5 控制器→Task 2；§6 前端→Task 3；§7 测试→各任务+Task 3；§8 计数→Task 3。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：approval.manage Task 1 定义=Task 2 路由=Task 3 前端门控；`ApprovalDefinitionView` 复用；错误码 `APPROVAL_DEFINITION_CODE_CONFLICT` Task 1 定义=Task 1 测试消费。
