# SPEC-044 绩效与案件/财务联动（Performance Business Metrics）— 收尾报告

日期：2026-08-05 ｜ 需求来源：绩效考核（SPEC-043）缺**业务上下文**——该员工考核周期案件办结数/回款额；SPEC-037/043 closeout §9「绩效与案件/财务联动——另行」｜ 用户授权自主推进（「需要，继续任务」确认按推荐续做）｜ 前置：SPEC-033（Case lawyerId/closedAt）、SPEC-037/043（Performance 模型 + 服务层）、SPEC-010/011（Contract/Payment 模型）
设计权威：本文档 ｜ 计数基线：SPEC-043 终态（迁移 33/模型 61/权限 135/事件 15/路由 31）

## 1. 交付范围

绩效详情聚合**业务指标**（该员工考核周期案件办结数/回款额）——纯读聚合，前端绩效详情「业务指标」卡。**零结构变更**（迁移 33/模型 61/权限 135/事件 15 全不变；路由 28→**29** +1）。

1. **Task 1（metrics 服务 + 路由）**：`performance-service.getBusinessMetrics(performanceId)`（performance.read → 404 探针 → 周期解析 "YYYY-MM" → 月份边界 → 案件办结数 `case.count` + 回款额 `payment.aggregate`）+ `performance-types.ts` +`PerformanceBusinessMetrics` + `controller/performance.ts` +`metrics` + `router.ts` +1（GET /performances/:id/metrics）；服务测试 3 例。
2. **Task 2（本报告）**：API 测试 2 例 + 前端业务指标卡 + 闸门 + runbook §11 + 本 closeout。

**变更文件（共 3 后端 + 2 前端 + 2 测试 + 3 文档）**：Task 1 `performance-service.ts` + `performance-types.ts` + `controller/performance.ts` + `router.ts` + `test/performance/performance-metrics-service.test.ts`；Task 2 `test/app/performance-metrics-api.test.ts` + 前端 `pages/Performance/index.tsx` + `api/organization.ts` + `types/index.ts` + `PerformancePage.test.tsx` + runbook §11 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| performance metrics 服务测试（`performance-metrics-service.test.ts`） | **3/3 pass**（周期内聚合 2 结案/5000 回款/周期外不计；零活动 0/0；404/403） |
| performance metrics API 测试（`performance-metrics-api.test.ts`） | **2/2 pass**（metrics 端点零活动/权限 403/404） |
| 前端 Performance 页 Vitest（`PerformancePage.test.tsx`） | **6/6 pass**（原 5 例 + 业务指标卡渲染 1 例） |
| 前端全量 Vitest | **48 files / 240 tests 全绿**（Performance 页 +1 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（performance 域 + controller + router + 测试） | **0 err** |
| web tsc + eslint（Performance 页 + api + types + 测试） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **57/57 pass** |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（33 迁移 / 61 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零结构变更**：迁移 **33** / 模型 **61** / 权限 **135** / 事件 **15** 全不变；路由 **28→29**（+1 requirePermission GET /performances/:id/metrics）。`check:baseline`（33/61）+ `check:bootstrap` PASS。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 业务指标 | `getBusinessMetrics`：`closedCases`（CLOSED 案件数，closedAt ∈ 周期）/ `confirmedRevenue`（CONFIRMED 回款额，confirmedAt ∈ 周期） |
| D2 | 聚合链路 | 案件 `case.count({ lawyerId, status CLOSED, closedAt [period] })`；回款 `payment.aggregate({ contract: { case: { lawyerId } } })`（Payment → Contract → Case） |
| D3 | 周期解析 | `period` "YYYY-MM" → [start, end) 月份边界（UTC） |
| D4 | 权限/路由 | 复用 `performance.read`；路由 +1 |
| D5 | 前端 | 绩效详情「业务指标」卡 |

**实施期 ⚠️ 记录**：

- **Contract→Case 关系名**：`Contract.cases` 反向关系实为 `case`（单数，Case.contractId @unique 一对一）——回款聚合 filter 用 `contract: { case: { lawyerId } }`（首版 `cases` 报 TS 错，修正）。
- **聚合周期边界**：period "YYYY-MM" → UTC [当月 1 日, 次月 1 日)；周期外数据不计（测试实证）。
- **fixture 补全**：Contract/Payment 直建需 `createdBy`（required）——服务测试 fixture 补全。

## 6. 安全审计状态

- `security:test` **57/57**（本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **绩效与案件/财务自动计分**（办结数/回款驱动绩效分）——另行（需业务规则，设计 §6 OUT）。
2. **绩效审批联动**（主管评需审批实例）——另行（设计 §6 OUT）。
3. **绩效驾驶舱/趋势图**——另行（设计 §6 OUT）。
4. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **零结构变更对账**：迁移 33/模型 61/权限 135/事件 15 全不变；路由 **29**（+1）——`check:baseline`（33/61）+ `check:bootstrap` PASS。
- **聚合对账**：案件办结数（case.lawyerId = performance.employeeId + status CLOSED + closedAt ∈ 周期）；回款额（payment.status CONFIRMED + confirmedAt ∈ 周期 + contract.case.lawyerId = 员工）——Payment → Contract → Case 链路。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **绩效自动计分**：办结数/回款驱动绩效分（业务规则）——另行。
- **绩效审批联动**：主管评经审批实例——另行。
- **绩效驾驶舱**：趋势图/对比/排行——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（metrics 服务 + 路由）**：getBusinessMetrics（案件办结数 + 回款额聚合 + 周期解析）+ controller + 路由 → 服务 3/3 + tsc/eslint 0。
- **Task 2（本报告）**：API 2/2 + 前端 Performance 页 6/6 + 全量 vitest + `security:test` 57/57 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §11 + 本 closeout 收口。

## 11. 收官状态

**SPEC-044 绩效与案件/财务联动本地闭环（2026-08-05）**：2/2 任务完成（Task 1 getBusinessMetrics 只读聚合 + 路由 + 测试；Task 2 API 测试 + 前端业务指标卡 + 闸门 + runbook §11 + closeout）。**零结构变更**：迁移 33/模型 61/权限 135/事件 15 全不变；路由 **28→29**。聚焦验证：metrics 服务 **3/3** + API **2/2** + 前端 Performance 页 **6/6** + 全量 vitest **48 files/240**+ `security:test` **57/57** + `security:audit:all` 双绿 + check:baseline（33/61）+ check:bootstrap + docs-leakage + web build 全 PASS。实施期 ⚠️ §5（Contract→Case 关系名 / 周期边界 / fixture 补全），已知非阻断 §7，follow-up §9。**绩效详情端到端覆盖业务上下文——考核周期案件办结数/回款额可见**。按项目约束零 git 操作，本地闭环。
