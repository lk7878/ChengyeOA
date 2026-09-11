# SPEC-045 绩效自动计分（Performance Auto-scoring）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「按你推荐继续下一步任务」确认）｜ 需求来源：绩效业务指标（SPEC-044）已聚合案件办结数/回款额——补全**自动计分**（办结/回款驱动绩效分）；SPEC-044 closeout §9「绩效自动计分——另行」｜ 前置：SPEC-044（`getBusinessMetrics` 聚合）
设计权威：本文档 ｜ 计数基线：SPEC-044 终态（迁移 33/模型 61/权限 135/事件 15/路由 29）

## 1. 背景与目标

绩效考核（SPEC-043）目前 score 为**手工录入**（create/confirm 时填）。业务指标（SPEC-044）已聚合考核周期案件办结数/回款额——补全**自动计分**：`getBusinessMetrics` 按规则计算 `autoScore`（办结数/回款驱动），绩效详情业务指标卡展示，供主管评/确认参考。**零结构变更**（纯计算字段，迁移/模型/权限/事件/路由全不变）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 自动计分规则 | `autoScore = clamp(round(closedCases × 10 + confirmedRevenue ÷ 10000), 0, 100)`——每办结 1 案 +10 分；每回款 1 万 +1 分；clamp 0-100 |
| D2 | 计算位置 | `performance-service.getBusinessMetrics`（SPEC-044 已有聚合）→ 复用 closedCases/confirmedRevenue → 计算 autoScore 追加返回 |
| D3 | 视图 | `PerformanceBusinessMetrics` +`autoScore: number` |
| D4 | 零结构变更 | 无迁移/模型/权限/路由变更（纯计算 + 视图字段） |
| D5 | 前端 | 绩效详情「业务指标」卡 +「自动计分」展示（供主管评参考） |

## 3. 实现

### 3.1 后端

- `performance-service.ts` `getBusinessMetrics`：复用 closedCases/confirmedRevenue → `autoScore = clamp(round(closedCases * 10 + confirmedRevenue / 10000), 0, 100)` → 返回含 autoScore。
- `performance-types.ts`：`PerformanceBusinessMetrics` +`autoScore: number`。

### 3.2 前端

- `types` +autoScore；`pages/Performance/index.tsx` 业务指标卡 +「自动计分」展示。

## 4. 计数影响

**零结构变更**：迁移 33/模型 61/权限 135/事件 15/路由 29 全不变（纯计算 + 视图字段）。后端测试 +N（~2），前端测试 +N（~1）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | autoScore 计算（办结/回款 → 分数/clamp 0-100/边界） |
| 前端 | 指标卡 autoScore 渲染 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 绩效分**自动回写** score（autoScore → score）——另行（需裁决是否覆盖手工分）。
- 计分规则运营可配（权重调整）——另行。
- 绩效审批联动/驾驶舱——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进（「按你推荐继续下一步任务」确认） |
