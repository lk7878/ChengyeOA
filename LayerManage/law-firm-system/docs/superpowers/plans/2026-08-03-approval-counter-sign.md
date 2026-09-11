# SPEC-018 审批会签（节点内全部通过）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会签——nodeSchema 节点扩展 `mode`（ANY 缺省/ALL 全签），processTask ALL 模式首个 APPROVE 停留当前节点（等节点内全部 APPROVED 才推进/定稿），前端节点会签标注。**零结构变更**。

**Architecture:** approval-instance-service processTask 增 ALL 分支 + buildApprovalChain 节点 mode 扩展 + ApprovalInstanceView +nodeSchema（前端会签 Tag 数据源）+ approval-definition-service 校验 mode。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层会签（processTask ALL 分支 + buildApprovalChain mode + 校验）

**Files:**
- Modify: `apps/server/app/application/approval/approval-instance-service.ts`（node mode + processTask ALL 分支 + buildApprovalChain mode 校验）
- Modify: `apps/server/app/application/approval/approval-types.ts`（ApprovalInstanceView +nodeSchema）
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（assertNodeSchemaValid +mode 校验）
- Modify: `apps/server/test/approval/approval-instance-service.test.ts`（+会签用例）
- Modify: `apps/server/test/approval/approval-definition-service.test.ts`（+mode 非法 400）

**Interfaces:**
- Consumes: SPEC-016 nodeSchema/currentNode + 既有 processTask 推进/定稿分支。
- Produces: 会签 processTask + nodeSchema mode + 视图 nodeSchema（Task 2/3 消费）。

- [ ] **Step 1: 失败测试先行**

`approval-instance-service.test.ts` 补会签用例：
1. ALL 首 APPROVE 停留：node.mode='ALL' 节点[0] 双审批人——第一个 APPROVE → currentNode 不变（0）/实例 PENDING/余 PENDING task 保留/零 completed/审计 mode ALL/回调 result status PENDING currentNode 0。
2. ALL 全部 APPROVE 后推进：第二个（最后）APPROVE → currentNode++（1）+ 下节点 Task + 实例仍 PENDING + 零 completed。
3. ALL 末节点全签定稿：末节点 mode ALL 双审批人全 APPROVE → APPROVED + completed 恰 1。
4. ALL 中 REJECT 一票否决：ALL 节点中任一 REJECT → REJECTED + 当前/未来 PENDING CANCELLED。
5. ANY 缺省向后兼容：mode 缺省节点 → 既有任一通过语义（首 APPROVE 即推进）。
6. buildApprovalChain mode 非法（'OTHER'）→ ASSIGNEE_INVALID 400。
7. ALL 下节点自审 409 回滚（节点[1] 审批人含申请人）。

`approval-definition-service.test.ts` 补：
8. create/update nodeSchema 节点 mode 非法 → ASSIGNEE_INVALID 400。

- [ ] **Step 2: 实现**

`ApprovalChainNode` +mode；`buildApprovalChain` 逐节点 mode 校验（∉ {'ANY','ALL'} → 400）。processTask :297 推进段前插 ALL 判定（remainingPending 计数 → 停留当前节点零推进零 completed + PROCESS 审计 mode ALL + 回调 result）；ALL 最后 APPROVE 走既有推进/定稿。`approval-types.ts` ApprovalInstanceView +nodeSchema（投影透传）。`assertNodeSchemaValid` +mode 校验。

- [ ] **Step 3: 跑绿**

approval-instance-service（48+7）+ approval-definition-service（16+1）+ approval 域全量 + tsc + eslint 0。

---

### Task 2: 视图 nodeSchema + 前端会签标注

**Files:**
- Modify: `apps/web/src/api/approval.ts`（ApprovalInstanceView +nodeSchema + 类型）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（详情弹窗节点「会签」Tag）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+会签 Tag 用例）

**Interfaces:**
- Consumes: Task 1 视图 nodeSchema。
- Produces: 前端会签可见性。

- [ ] **Step 1: 失败测试先行**

前端测试：详情弹窗 ALL 模式节点显示「会签」Tag（fixture nodeSchema 节点 mode:'ALL'）；ANY 节点无 Tag；既有 12 例零回归。

- [ ] **Step 2: 实现**

`api/approval.ts` ApprovalInstanceView +nodeSchema；`ApprovalCenterPage.tsx` renderTaskGroups 节点 tag：node.mode==='ALL' 补 `Tag('会签','purple')`。

- [ ] **Step 3: 前端四闸门**

隔离测试 + typecheck 0 + lint 0 err（预存 warning 照录）+ build。

---

### Task 3: 闸门 + runbook/closeout 更新

**Files:**
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补会签语义）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-018-closeout.md`

**Interfaces:**
- Consumes: Task 1/2 全部。
- Produces: 计数链终态（零结构变更）+ follow-up 路由。

- [ ] **Step 1: 后端全量**

后端全量串行（127.0.0.1 + 清净窗，skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录）。预期既有 1798 + 本 SPEC 净增全绿 0 fail。

- [ ] **Step 2: 前端 + 安全 + baseline**

前端四闸门；`npm run security:test` 34/34 零新增；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（报告占位符口径）。

- [ ] **Step 3: runbook + closeout**

runbook §9.2 状态机补「会签（节点内 ALL 全签）」+ §9.3 process 推进分支补 ALL 停留语义；closeout 十一节（零结构变更 26/60/122/15/路由 9、裁决 D1-D11、已知非阻断——M2 乐观锁/同体原子性承接、Follow-up——转交/加签/超时/全组织视图等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务层→Task 1；§4 校验→Task 1；§5 前端→Task 2；§6 测试→各任务+Task 3；§7 零结构→Task 3。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：mode Task 1 定义=Task 1 校验=Task 2 前端消费；nodeSchema 视图 Task 1 产出=Task 2 消费；`APPROVAL_ASSIGNEE_INVALID` 复用。
