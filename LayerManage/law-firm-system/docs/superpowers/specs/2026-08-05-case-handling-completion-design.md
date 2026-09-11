# SPEC-035 案件办理域收尾（Case 乐观锁 + 前端任务/沟通交互）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（按 SPEC-033 closeout §9 follow-up 推荐续做）｜ 前置：SPEC-033（案件办理域核心——case 六权限码 + 服务层 + controller + 路由门禁 + 前端最小列表/详情）
设计权威：本文档 ｜ 计数基线：SPEC-033 终态（迁移 27/模型 60/权限 129/事件 15/路由 22）

## 1. 背景与目标

SPEC-033 案件办理域核心落地后有两项 design 范围 OUT 的 follow-up 待收尾：**① D2「version 乐观锁」**——因 Case 模型无 version 列收敛为 last-write-wins + 终态守卫；**② D8 前端深度交互**——任务/沟通增改 UI 归 follow-up。本 SPEC 补全两项，使案件域端到端可用（后端端点 SPEC-033 已建，前端仅展示未交互）。

**目标**：Case 模型 +version 列 → updateCase 乐观锁（并发编辑防护）+ 前端任务创建/状态翻转/沟通创建 UI。**结构性变更**（迁移 27→**28**，加列；模型 60/权限 129/事件 15/路由 22 不变）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | Case +version 列 | `version Int @default(1)`（迁移 27→28，`ALTER TABLE "case" ADD COLUMN`）；视图/入参透传 |
| D2 | updateCase 乐观锁 | updateCase 接受**必填 `version`** → `updateMany {id, version, status notIn 终态}` count=0 → 区分 404 CASE_NOT_FOUND / 409 VERSION_CONFLICT / 409 CASE_STATE_INVALID；成功 version+1 + 审计 |
| D3 | closeCase 不变 | close 保持终态守卫（设计 D2 仅要求 update 乐观锁；close 为终态动作，version 语义不引入） |
| D4 | 前端任务/沟通交互 | 详情抽屉内：新建任务 Modal（name/nodeType/dueDate/remark）+ 任务状态翻转（PENDING→「开始办理」→IN_PROGRESS→「完成」→COMPLETED）+ 新增沟通 Modal（type/content/isKey）——权限门控 case.task.manage / case.communication.create |
| D5 | 权限复用 | 沿用 SPEC-033 case 六码，零新权限码 |

## 3. 实现

### 3.1 Task 1：Case version 乐观锁（后端）

- `prisma/schema.prisma`：`model Case` +`version Int @default(1)`（放在 updatedAt 前）。
- 新迁移 `20260805110000_case_version_column/migration.sql`：`ALTER TABLE "case" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;`（幂等注释；仅加列零回填）。
- `case-types.ts`：`UpdateCaseInput` +`version: number`；`CaseView` +`version: number`（projectCase 透传）。
- `case-service.ts updateCase`：assertExactKeys +`'version'`；`version = normalizePositiveInt`；读 existing（含 version）；`updateMany {id, version, status notIn 终态}` data `{...fields, version: version+1}`；count=0 → existing 无 → 404，status 终态 → 409 CASE_STATE_INVALID，否则 → 409 VERSION_CONFLICT；审计 newValues 含 version。
- 服务测试 +2：乐观锁（stale version → VERSION_CONFLICT 409 / 成功 version+1）；API 测试 +1~2（乐观锁透传 409 / create 视图含 version）。

### 3.2 Task 2：前端任务/沟通交互

- `pages/Case/index.tsx` 详情抽屉：任务区——每任务状态翻转按钮（canTask && PENDING→IN_PROGRESS、IN_PROGRESS→COMPLETED）+「新建任务」按钮（Modal name/nodeType/dueDate/remark）；沟通区——「新增沟通」按钮（Modal type/content/isKey）；操作后 `openDetail(detail)` 重拉全量。
- 权限：`useAuthStore.hasPermission('case.task.manage')` / `('case.communication.create')` 门控。
- 前端测试 +3：任务创建、状态翻转、沟通创建。

## 4. 计数影响

**结构性变更**：迁移 **27→28**（+1 加列）；模型 60 不变（加列非新模型）；权限 129 不变；事件 15 不变；路由 22 不变。后端测试 +N（~3），前端测试 +N（~3）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | updateCase 乐观锁（stale version 409 / version+1 / 终态仍 409 CASE_STATE_INVALID） |
| API | 乐观锁 409 透传 / create 视图含 version / update 缺 version 400 |
| 前端 | 任务创建 / 状态翻转 / 沟通创建 |

## 6. 范围边界（明确 OUT）

- 案件深度工作流（多阶段自动推进/审批联动）——另行。
- 案件文件/证据管理——另行（模型未建）。
- 绩效联动——另行。
- 前端深度交互余项（任务拖拽/甘特/统计驾驶舱）——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进（按 SPEC-033 closeout §9 推荐） |
