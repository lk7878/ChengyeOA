# SPEC-044 绩效与案件/财务联动（Performance Business Metrics）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「需要，继续任务」确认按推荐续做——绩效考核需业务上下文）｜ 需求来源：SPEC-043 考核流程缺**业务指标**（该员工考核周期案件办结数/回款额）；SPEC-037/043 closeout §9「绩效与案件/财务联动——另行」｜ 前置：SPEC-033（Case 模型 lawyerId/closedAt）、SPEC-037/043（Performance 模型 + 服务层）、SPEC-010/011（Contract/Payment 模型）
设计权威：本文档 ｜ 计数基线：SPEC-043 终态（迁移 33/模型 61/权限 135/事件 15/路由 31）

## 1. 背景与目标

绩效考核（SPEC-043）目前只看员工自评/主管评分——**缺业务上下文**：该员工考核周期的案件办结数、回款额。**目标**：绩效详情聚合业务指标（只读），前端绩效详情展示「业务指标」卡。**零结构变更**（纯读聚合，迁移/模型/权限/事件/路由全不变）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 业务指标 | `performance-service.getBusinessMetrics(performanceId)`：`closedCases`（该员工 CLOSED 案件数，closedAt ∈ 考核周期）/ `confirmedRevenue`（该员工相关合同 CONFIRMED 收款额，confirmedAt ∈ 周期） |
| D2 | 聚合链路 | 案件：`case.count({ lawyerId: employeeId, status: 'CLOSED', closedAt: [period] })`；回款：`payment.aggregate(_sum amount, { status: 'CONFIRMED', confirmedAt: [period], contract: { cases: { some: { lawyerId: employeeId } } } })`（Payment → Contract → Case） |
| D3 | 周期解析 | `period` "YYYY-MM"（如 "2026-04"）→ [start, end)（2026-04-01 ~ 2026-05-01） |
| D4 | 权限/路由 | 复用 `performance.read`；路由 +1 `GET /performances/:id/metrics` → 28→**29**（纯读，零新权限码） |
| D5 | 前端 | 绩效详情「业务指标」卡（案件办结数/回款额） |

## 3. 实现

### 3.1 后端

- `performance-service.ts`：+`getBusinessMetrics(performanceId)`（performance.read → 404 探针 → 周期解析 → 两聚合 → 返回 `{ closedCases, confirmedRevenue }`）。
- `performance-types.ts`：+`PerformanceBusinessMetrics` 视图。
- `controller/performance.ts`：+`metrics`；`router.ts` +1（GET /performances/:id/metrics）。

### 3.2 前端

- `api/organization.ts` performanceApi +`metrics`；`types` +`PerformanceBusinessMetrics`。
- `pages/Performance/index.tsx` 详情抽屉 +「业务指标」卡（案件办结数/回款额）。

## 4. 计数影响

**零结构变更**：迁移 33/模型 61/权限 135/事件 15 全不变；路由 **28→31**（+1 metrics）。后端测试 +N（~3），前端测试 +N（~1）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | getBusinessMetrics（closedCases 计数/回款额聚合/404/权限 403/周期解析） |
| API | metrics 端点 + 权限 403 + 404 |
| 前端 | 业务指标卡渲染 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 绩效与案件/财务**自动计分**（办结数/回款驱动绩效分）——另行（需业务规则）。
- 绩效审批联动——另行。
- 绩效驾驶舱/趋势图——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进（「需要，继续任务」确认） |
