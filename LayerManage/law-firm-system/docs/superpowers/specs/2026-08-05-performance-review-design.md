# SPEC-043 绩效考核流程（Performance Review Workflow）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「需要」确认按推荐续做——绩效域 SPEC-037 正规化后缺实际考核流程）｜ 需求来源：SPEC-037 绩效模块只有 create/list/get/confirm（PENDING→CONFIRMED），缺**目标设定/自评/主管评**实际考核流程（SPEC-037 closeout §9 另行）｜ 前置：SPEC-037（Performance 模型 + 服务层 + controller 基础设施）
设计权威：本文档 ｜ 计数基线：SPEC-042 终态（迁移 31/模型 61/权限 134/事件 15/路由 32）

## 1. 背景与目标

绩效模块（SPEC-037）只支持 create（PENDING）+ confirm（CONFIRMED）——**缺目标设定、员工自评、主管评**的完整考核流程。**目标**：绩效模型扩展目标/自评/主管评字段 + 状态机扩展（PENDING → SELF_REVIEWED → MANAGER_REVIEWED → CONFIRMED）+ 服务方法（setGoal/selfReview/managerReview，confirm 兼容任意非终态）+ 前端考核步骤。**结构性变更**（迁移 31→**33** +2：加列 + provisioning；模型 61 不变/权限 **134→135** +1 performance.update/事件 15 不变；路由 28→**31** +3）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 模型扩展 | Performance +`goal String?` +`selfScore Int?` +`selfComment String?` +`managerScore Int?` +`managerComment String?` +`reviewerId String?` +`reviewedAt DateTime?`（迁移 31→32 加列） |
| D2 | 状态机扩展 | PENDING（待考核）→ SELF_REVIEWED（已自评）→ MANAGER_REVIEWED（已主管评）→ CONFIRMED（已确认，终态）；confirm 兼容任意非终态 → CONFIRMED（向后兼容） |
| D3 | 服务方法 | `setGoal(id, { goal })`（PENDING 期设目标，1-2000）/ `selfReview(id, { selfScore, selfComment })`（PENDING → SELF_REVIEWED，selfScore 1-100）/ `managerReview(id, { managerScore, managerComment })`（SELF_REVIEWED → MANAGER_REVIEWED + reviewerId/reviewedAt）/ `confirm(id)`（现有，任意非终态 → CONFIRMED） |
| D4 | 权限 | setGoal/selfReview = `performance.update`；managerReview/confirm = `performance.confirm`——零新权限码 |
| D5 | controller + 路由 | `controller/performance.ts` +`setGoal`/`selfReview`/`managerReview`；路由 +3（POST `/performances/:id/set-goal`、`/self-review`（performance.update）、`/manager-review`（performance.confirm））→ 28→**31** |
| D6 | 前端 | 绩效详情/编辑：目标设定（PENDING）+ 自评（PENDING）+ 主管评（SELF_REVIEWED）+ 确认；按状态机门控 |

## 3. 实现

### 3.1 Task 1：模型扩展 + 迁移

- `schema.prisma`：Performance +7 列（D1）。
- 新迁移 `20260805140000_performance_review/migration.sql`：`ALTER TABLE "performance" ADD COLUMN ...`（NOT NULL 无——全可空）。
- `performance-types.ts`：`PERFORMANCE_STATUSES` +`SELF_REVIEWED`/`MANAGER_REVIEWED`；视图 +7 字段；入参 `SetGoalInput`/`SelfReviewInput`/`ManagerReviewInput`。

### 3.2 Task 2：服务方法 + controller + 路由

- `performance-service.ts`：+`setGoal`/`selfReview`/`managerReview`（状态守卫 + 校验 + 审计）+ `confirm` 扩展任意非终态。
- `controller/performance.ts`：+3 方法；`router.ts` +3 条。
- 审计：`PERFORMANCE_GOAL_SET`/`PERFORMANCE_SELF_REVIEW`/`PERFORMANCE_MANAGER_REVIEW`。

### 3.3 Task 3：前端 + 测试 + 闸门 + runbook + closeout

- `pages/Performance/index.tsx`：详情/编辑考核步骤（目标/自评/主管评 + 确认）。
- API 测试（setGoal/selfReview/managerReview + 状态守卫 409 + 权限 403）+ 服务测试 + 前端测试。

## 4. 计数影响

**结构性变更**：迁移 **31→33**（+2：加列 + provisioning）；模型 61 / 权限 **134→135**（+1 performance.update）/ 事件 15 不变；路由 **28→31**（+3）。后端测试 +N（~6），前端测试 +N（~2）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | setGoal（PENDING 设/非 PENDING 409/校验）/ selfReview（PENDING→SELF_REVIEWED/非法状态 409）/ managerReview（SELF_REVIEWED→MANAGER_REVIEWED/非法 409）/ confirm（任意非终态）/ 权限 403 |
| API | 三动作路由 + 状态守卫 409 + 权限 403 |
| 前端 | 考核步骤门控 / 自评提交 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 绩效与案件/财务联动（案件办结数/回款驱动）——另行。
- 绩效审批联动（主管评需审批实例）——另行。
- 绩效驾驶舱/趋势图——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 用户授权自主推进（「需要」确认） |
