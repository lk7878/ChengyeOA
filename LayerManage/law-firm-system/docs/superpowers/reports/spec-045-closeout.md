# SPEC-045 绩效自动计分（Performance Auto-scoring）— 收尾报告

日期：2026-08-05 ｜ 需求来源：绩效业务指标（SPEC-044）已聚合案件办结数/回款额——补全**自动计分**（办结/回款驱动绩效分）；SPEC-044 closeout §9「绩效自动计分——另行」｜ 用户授权自主推进（「按你推荐继续下一步任务」确认）｜ 前置：SPEC-044（`getBusinessMetrics` 聚合）
设计权威：本文档 ｜ 计数基线：SPEC-044 终态（迁移 33/模型 61/权限 135/事件 15/路由 29）

## 1. 交付范围

绩效业务指标补全**自动计分**：`getBusinessMetrics` 按规则计算 `autoScore`（办结数×10 + 回款额÷10000，clamp 0-100），绩效详情业务指标卡展示，供主管评/确认参考。**零结构变更**（纯计算字段，迁移/模型/权限/事件/路由全不变）。

1. **Task 1（autoScore 计算）**：`performance-service.getBusinessMetrics` +`autoScore`（复用 SPEC-044 closedCases/confirmedRevenue → `clamp(round(closedCases×10 + confirmedRevenue÷10000), 0, 100)`）+ `performance-types.ts` `PerformanceBusinessMetrics` +`autoScore`；服务测试 +断言。
2. **Task 2（前端 + 本报告）**：前端业务指标卡 +「自动计分」展示 + 测试 + 闸门 + runbook §11 + 本 closeout。

**变更文件（共 1 后端 + 2 前端 + 3 测试 + 3 文档）**：Task 1 `performance-service.ts` + `performance-types.ts` + `performance-metrics-service.test.ts` + `performance-metrics-api.test.ts`；Task 2 `pages/Performance/index.tsx` + `types/index.ts` + `PerformancePage.test.tsx` + runbook §11 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| performance metrics 服务测试（`performance-metrics-service.test.ts`） | **3/3 pass**（聚合 2 结案/5000 回款 → autoScore 21；零活动 autoScore 0；404/403） |
| performance metrics API 测试（`performance-metrics-api.test.ts`） | **2/2 pass**（metrics 端点零活动 autoScore 0/权限 403/404） |
| 前端 Performance 页 Vitest（`PerformancePage.test.tsx`） | **6/6 pass**（指标卡含 autoScore 渲染） |
| 前端全量 Vitest | **48 files / 240 tests 全绿**（零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint | **0 err** |
| web tsc + eslint | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **57/57 pass** |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（33 迁移 / 61 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零结构变更**：迁移 **33** / 模型 **61** / 权限 **135** / 事件 **15** / 路由 **29** 全不变（autoScore 为纯计算字段，无落库）。`check:baseline`（33/61）+ `check:bootstrap` PASS。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 自动计分规则 | `autoScore = clamp(round(closedCases×10 + confirmedRevenue÷10000), 0, 100)`——每办结 1 案 +10 分；每回款 1 万 +1 分；clamp 0-100 |
| D2 | 计算位置 | `getBusinessMetrics`（SPEC-044 已有聚合）→ 复用 closedCases/confirmedRevenue → autoScore |
| D3 | 视图 | `PerformanceBusinessMetrics` +`autoScore: number` |
| D4 | 零结构变更 | 纯计算 + 视图字段 |
| D5 | 前端 | 业务指标卡 +「自动计分」展示 |

**实施期 ⚠️ 记录**：

- **Decimal 算术**：`revenue._sum.amount` 为 Prisma Decimal，直接参与算术报 TS2362——`Number(...)` 转换后计算。
- **计分语义**：autoScore 为**参考分**（不自动回写 score——手工分仍权威；回写归 follow-up 需裁决）。

## 6. 安全审计状态

- `security:test` **57/57**（本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **绩效分自动回写 score**（autoScore → score）——另行（需裁决是否覆盖手工分，设计 §6 OUT）。
2. **计分规则运营可配**（权重调整）——另行（设计 §6 OUT）。
3. **绩效审批联动/驾驶舱**——另行（设计 §6 OUT）。
4. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **零结构变更对账**：迁移 33/模型 61/权限 135/事件 15/路由 29 全不变——`check:baseline`（33/61）+ `check:bootstrap` PASS。
- **计分对账**：autoScore 复用 SPEC-044 聚合（closedCases/confirmedRevenue）→ 规则 `clamp(round(办结数×10 + 回款额÷10000), 0, 100)`；边界（0 活动 → 0；超上限 → 100）。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **绩效分自动回写**：autoScore → score（覆盖手工分需裁决）——另行。
- **计分规则运营可配**：权重/阈值配置化——另行。
- **绩效审批联动/驾驶舱**——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（autoScore 计算）**：getBusinessMetrics +autoScore（复用聚合 + 规则）→ 服务 3/3（含 autoScore 断言）+ tsc/eslint 0。
- **Task 2（前端 + 本报告）**：业务指标卡 +「自动计分」+ 前端 6/6 + 全量 vitest + `security:test` 57/57 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §11 + 本 closeout 收口。

## 11. 收官状态

**SPEC-045 绩效自动计分本地闭环（2026-08-05）**：2/2 任务完成（Task 1 getBusinessMetrics +autoScore 规则计算 + 视图字段；Task 2 前端业务指标卡「自动计分」展示 + 测试 + 闸门 + runbook §11 + closeout）。**零结构变更**：迁移 33/模型 61/权限 135/事件 15/路由 29 全不变。聚焦验证：metrics 服务 **3/3** + API **2/2** + 前端 Performance 页 **6/6** + 全量 vitest **48 files/240**+ `security:test` **57/57** + `security:audit:all` 双绿 + check:baseline（33/61）+ check:bootstrap + docs-leakage + web build 全 PASS。实施期 ⚠️ §5（Decimal 算术 / 计分参考语义），已知非阻断 §7，follow-up §9。**绩效详情覆盖自动计分——办结数/回款驱动参考分可见**。按项目约束零 git 操作，本地闭环。
