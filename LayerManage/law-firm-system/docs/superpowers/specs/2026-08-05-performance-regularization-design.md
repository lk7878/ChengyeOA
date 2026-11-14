# SPEC-037 绩效模块正规化（Performance Regularization）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「需要」确认按推荐续做——SPEC-033/035 closeout §9「绩效联动——另行」中最明显半成品）｜ 需求来源：Performance 模型已建但 controller 为**遗留原型**（直连 ctx.prisma、无权限门禁/校验/审计/测试）——与 SPEC-033 前案件域同状态 ｜ 前置：SPEC-004（RBAC + provisioning 迁移纪律）、SPEC-033（案件域正规化模式先例）
设计权威：本文档 ｜ 计数基线：SPEC-035 终态（迁移 28/模型 60/权限 129/事件 15/路由 22）

## 1. 背景与目标

绩效模块（`Performance` 模型 + 遗留原型 controller `controller/performance.ts` + 前端原型页 `pages/Performance/index.tsx`）**未正规化**：controller 直连 `ctx.prisma`、四条路由（GET /performances、GET /:id、POST、POST /:id/confirm）**无 `requirePermission`**、无校验/审计/测试；前端 type/status 枚举与后端模型**漂移**（前端 `ANNUAL/PROJECT/DRAFT` vs 后端 `YEARLY` / `PENDING|CONFIRMED`）。**目标**：仿 SPEC-033 案件域模式构建正规绩效域——+performance 权限码 + 服务层（create/list/get/confirm）+ controller 薄重构 + 路由门禁 + 测试 + 前端最小。**结构性变更**（迁移 28→**29**，provisioning；权限 129→**132**；路由 22→**26**）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限码 | +3：`performance.read`（列表/详情）/ `performance.create`（录入）/ `performance.confirm`（确认）——catalog + provisioning 迁移（INSERT ON CONFLICT DO NOTHING） |
| D2 | 状态机 | create=PENDING；confirm=PENDING → CONFIRMED（终态，重复确认 409 `PERFORMANCE_STATE_INVALID`） |
| D3 | 校验 | employeeId 存在（Employee）探针；period 格式 `^\d{4}-\d{2}$`（如 "2026-04"）；type 枚举 `MONTHLY|QUARTERLY|YEARLY`（对齐后端模型，修正前端 `ANNUAL/PROJECT` 漂移）；kpiData 合法 JSON（≤2000）；score/bonus 非负 Decimal；remark ≤500 |
| D4 | 唯一约束 | `@@unique([employeeId, period, type])`——重复录入 → P2002 → 409 `PERFORMANCE_DUPLICATE`（存在性探针先查避免 FK 500） |
| D5 | 审计 | 写操作（create/confirm）同事务落 operation_log（`PERFORMANCE_CREATE`/`PERFORMANCE_CONFIRM`，targetType `PERFORMANCE`）；读不落 |
| D6 | 错误类 | `performance-errors.ts` `PerformanceError`（code/httpStatus/message）+ errorHandler 分支（仿 CaseError 先例）——404 `PERFORMANCE_NOT_FOUND` / 409 `PERFORMANCE_STATE_INVALID`（已确认）/ 409 `PERFORMANCE_DUPLICATE`；校验 400 `VALIDATION_FAILED`（MasterDataError） |
| D7 | controller 重构 | 遗留原型逐方法改调 service（薄控制器纪律，移除直连 prisma） |
| D8 | 前端 | 最小：列表（过滤+分页，`PagedResult`）+ 详情 + 新建（员工/周期/类型/KPI/分数/奖金）+ 确认（PENDING 行「确认」按钮，`performance.confirm` 门控）——type 枚举对齐后端 `MONTHLY/QUARTERLY/YEARLY`，status 对齐 `PENDING/CONFIRMED`（去 DRAFT） |

## 3. 服务层（application/performance/）

### 3.1 performance-service.ts

```ts
// createPerformance(input): performance.create → 校验（employeeId 存在/period 格式/type 枚举/
// kpiData JSON/score/bonus Decimal）→ 唯一探针（employeeId+period+type 已存在 → 409 DUPLICATE）
// → status PENDING + 审计 PERFORMANCE_CREATE
// listPerformances(query): performance.read → 过滤（employeeId/period/type）+ 分页 + createdAt DESC
// getPerformance(id): performance.read → 详情（含 employee 主职投影）
// confirmPerformance(id): performance.confirm → PENDING → CONFIRMED（已确认 → 409 STATE_INVALID）
// + 审计 PERFORMANCE_CONFIRM
```

### 3.2 视图

- `PerformanceView`：id/employeeId/period/type/kpiData/score/bonus/remark/status/createdAt/updatedAt + `employee`（主职投影）。
- 列表 `PagedResult<PerformanceView>`（沿 lead-types PagedResult 形态，非原型嵌套 pagination）。

## 4. 控制器 + 路由

- `controller/performance.ts` 重构：index/show/create/confirm 逐方法改调 service（薄控制器，仿 case.ts）。
- `router.ts`：+`requirePermission`（performance.read×2 / performance.create / performance.confirm）——路由 22→**26**（+4）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | create（校验/唯一 409/审计/employee 存在）/ list（过滤/分页）/ get（详情+投影）/ confirm（状态机/重复确认 409/审计） |
| API | 权限门禁 403 / 401 / 错误码透传（404/409/400）/ 审计透传 |
| 前端（最小） | 列表渲染 / 新建提交 / 确认调用 / 权限门控 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 计数影响

**结构性变更**：迁移 **28→29**（+1 provisioning +3 permission 行）；模型 60 不变；权限 **129→132**（+3）；事件 15 不变；路由 **22→26**（+4 requirePermission）。后端测试 +N（~8），前端测试 +N（~3）。

## 7. 范围边界（明确 OUT）

- 绩效评分自动计算 / 绩效考核流程（目标设定/自评/主管评）——另行（模型未建，当前仅 score/bonus 手工录入）。
- 绩效与案件/财务联动（结案案件数、回款额驱动绩效）——另行。
- 前端深度（绩效驾驶舱/趋势图/对比）——另行。

## 8. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D8 | 见 §2 | 用户授权自主推进（「需要」确认） |
