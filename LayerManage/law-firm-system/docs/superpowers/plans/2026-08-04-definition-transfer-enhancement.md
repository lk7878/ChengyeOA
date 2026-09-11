# SPEC-029 Definition 导入导出增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definition 导入导出增强——增量导出（codes/businessType 筛选）+ 格式版本（schemaVersion）+ 关联角色供给校验。**零结构变更**。

**Architecture:** exportDefinitions query 增强 + payload 包络 {schemaVersion, definitions}；importDefinitions schemaVersion 校验 + roleCodes 存在性校验；前端 round-trip 适配。

**Tech Stack:** Egg.js 3 + TS / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）。

## Global Constraints

- 禁止任何 git 命令；测试串行 `--test-concurrency=1 --test-force-exit`；连接串一律 `127.0.0.1:55433`；DB 闸门前探 `pg_stat_activity=0`；测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`；55432 禁触；撞车期间禁跑。
- 测试 env 块：NODE_ENV=test；DATABASE_URL=DATABASE_URL_TEST=postgresql://chengye_test:chengye_test_local_only@127.0.0.1:55433/chengye_oa_test?schema=public；JWT_SECRET=01234567890123456789012345678901；APP_KEYS=0123456789abcdef0123456789abcdef,fedcba9876543210fedcba9876543210；MFA_ENCRYPTION_KEY_V1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=；CORS_ALLOWED_ORIGINS=http://localhost:3000。
- 只新建/修改任务 Files 清单内文件；TDD 失败测试先行。
- server 根=`LayerManage/law-firm-system/apps/server`；web 根=`LayerManage/law-firm-system/apps/web`（均在 `D:\2_test\16_ChengyeOA\` 下）。

---

### Task 1: 服务层增量导出 + 格式版本 + 关联角色校验

**Files:**
- Modify: `apps/server/app/application/approval/approval-definition-service.ts`（exportDefinitions query + importDefinitions schemaVersion/roleCodes 校验）
- Modify: `apps/server/app/application/approval/approval-types.ts`（+ExportDefinitionsQuery + DefinitionExportPayload + ImportDefinitionsInput +schemaVersion）
- Modify: `apps/server/test/approval/approval-definition-service.test.ts`（+增量导出/格式版本/角色校验用例）

**Interfaces:**
- Consumes: APPROVAL_BUSINESS_TYPES / role 存在性查询。
- Produces: 增强的 export/import（Task 2 控制器/前端消费）。

- [ ] **Step 1: 失败测试先行**
补用例：增量导出 codes/businessType 筛选 / 缺省全量 + schemaVersion=1 / import 无 schemaVersion 兼容 / schemaVersion=2 → 400 / 关联角色缺失 → 400（含角色码）/ 角色存在通过 / 单事务回滚。
- [ ] **Step 2: 实现**
exportDefinitions → {schemaVersion, definitions} + query 筛选；importDefinitions schemaVersion 校验 + roleCodes 存在性校验（缺失 → 400 明确报错）。
- [ ] **Step 3: 跑绿**
approval-definition-service 全绿 + approval 域零回归 + tsc/eslint 0。

---

### Task 2: 控制器/前端适配 + 闸门收尾

**Files:**
- Modify: `apps/server/app/controller/approval.ts`（exportDefinitions query 解析 + importDefinitions 透传）
- Modify: `apps/server/test/app/approval-api.test.ts`（+增量导出/导入校验 API 用例）
- Modify: `apps/web/src/api/approval.ts`（exportDefinitions 类型/参数 + importDefinitions schemaVersion + 包络解析）
- Modify: `apps/web/src/pages/approvals/ApprovalCenterPage.tsx`（导出下载解析包络 / 导入保留 schemaVersion）
- Modify: `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx`（+2 用例）
- Modify: `LayerManage/law-firm-system/docs/superpowers/runbooks/finance-operations.md`（§9.14 补增强说明）
- Create: `LayerManage/law-firm-system/docs/superpowers/reports/spec-029-closeout.md`

**Interfaces:**
- Consumes: Task 1 服务层。
- Produces: Definition 迁移增强 + 计数链终态（零结构变更）。

- [ ] **Step 1: 失败测试先行**
approval-api 补增量导出/导入 schemaVersion/角色校验 API 用例。
- [ ] **Step 2: 实现**
controller 增强 + 前端 round-trip 适配。
- [ ] **Step 3: 闸门 + 文档**
后端全量串行（预期 1880 + 本 SPEC 净增全绿 0 真 fail——外部漂移照录）；`security:test` 34/34；check:baseline（26/60）+ check:bootstrap（角色 2→7）+ docs-leakage exit 0。前端 typecheck/lint/build。runbook §9.14 + closeout 十一节。

---

## Self-Review 记录（计划落盘前已核）

- **Spec 覆盖**：设计 §3 服务→Task 1；§4 控制器/前端→Task 2；§5 测试→各任务；§6 计数→Task 2。零缺口。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：DefinitionExportPayload/ExportDefinitionsQuery Task 1=Task 2；ImportDefinitionsInput +schemaVersion 一致；前端包络解析镜像。
