# SPEC-025 审批定义导入导出（Definition Transfer）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definition 导出（全量 JSON 快照）+ 导入（批量 upsert 单事务全或无）——配置迁移/批量初始化。**零结构变更**。

**Architecture:** approval-definition-service exportDefinitions/importDefinitions + controller/router +2 条 + 前端导出/导入按钮。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 + Vitest。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；既有文件零改动（除非任务明示）；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`，web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层 exportDefinitions + importDefinitions

**Files:**
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（+exportDefinitions + importDefinitions）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+ImportDefinitionsInput + ImportResult）
- Modify: `apps/server/test/approval/approval-definition-service.test.ts`（+export/import 用例）

**Interfaces:**
- Consumes: approval.manage + create/update 校验复用 + version 前置条件。
- Produces: export/import 服务方法（Task 2 路由/3 前端消费）。

- [ ] **Step 1: 失败测试先行**

`test/approval/approval-definition-service.test.ts` 补：
1. export 全量含 DISABLED + code 升序。
2. export 无 manage → 403。
3. import 批量 create（新建 N 条）。
4. import 批量 upsert（已存在更新 version+1）。
5. import 幂等（重复导入同 payload 不重复）。
6. import version 前置条件不符 → 409。
7. import 单条畸形 → 400 整事务回滚零写入。
8. import 上限 100 超限 → 400。
9. import 审计 APPROVAL_DEFINITION_IMPORT。
10. 既有 create/update/组合方法零回归。

- [ ] **Step 2: 实现**

按设计 §3.1-3.3 + D1-D10。

- [ ] **Step 3: 跑绿**

approval-definition-service（24+新）+ approval 域零回归 + tsc + eslint 0。

---

### Task 2: controller + 路由 + 测试

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（+exportDefinitions + importDefinitions）
- Modify: `apps/server/app/router.ts`（+GET /definitions/export + POST /definitions/import，字面量优先）
- Modify: `apps/server/test/app/approval-api.test.ts`（+export/import 路由门禁 + 用例）

**Interfaces:**
- Consumes: Task 1 服务方法。
- Produces: export/import API（Task 3 前端消费）。

- [ ] **Step 1: 失败测试先行**

`test/app/approval-api.test.ts` 补：GET /definitions/export 无 manage → 403 + 有 manage 导出 / POST /definitions/import 无 manage → 403 + 有 manage 导入成功 / 字面量优先 / 既有 26 例零回归。

- [ ] **Step 2: 实现**

controller +2 方法；router +2 条（`GET /definitions/export`/`POST /definitions/import` 字面量先于 `PATCH /definitions/:code`）。

- [ ] **Step 3: 跑绿**

approval-api 全绿 + approval 域零回归 + tsc + eslint 0。

---

### Task 3: 前端导出/导入 + 闸门收尾

**Files:**
- Modify: `apps/web/src/api/approval.ts`（+exportDefinitions + importDefinitions + ImportDefinitionsInput）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（定义管理 Tab +导出/导入按钮）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+导出/导入用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9 补导入导出）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-025-closeout.md`

**Interfaces:**
- Consumes: Task 1/2 API。
- Produces: 导入导出端到端 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**

前端测试：导出按钮 → exportDefinitions 调用 + 文件下载 / 导入按钮 → 文件选择 → importDefinitions 调用 / 既有 28 例零回归。

- [ ] **Step 2: 实现**

`api/approval.ts` +2 API；`ApprovalCenterPage.tsx` 定义管理 Tab 增导出/导入按钮（approval.manage 门控，导出 Blob 下载、导入文件解析）。

- [ ] **Step 3: 闸门 + 文档**

前端四闸门（隔离测试 + typecheck 0 + lint 0 err + build）；后端全量串行（预期 1860 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。runbook §9 补导入导出段 + closeout 十一节（零结构变更 26/60/124/15/路由 13、裁决 D1-D10、已知非阻断、Follow-up——格式版本/增量导出/关联角色等）。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器路由→Task 2；§5 前端→Task 3；§6 测试→各任务+Task 3；§7 计数→Task 3。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：ImportDefinitionsInput/ImportResult Task 1 定义=Task 2 控制器=Task 3 前端；路由 GET/POST /definitions/export|import Task 2=Task 3 API。
