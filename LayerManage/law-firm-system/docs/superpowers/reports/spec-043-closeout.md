# SPEC-043 绩效考核流程（Performance Review Workflow）— 收尾报告

日期：2026-08-05 ｜ 需求来源：绩效模块（SPEC-037）只有 create/list/get/confirm（PENDING→CONFIRMED），缺**目标设定/自评/主管评**实际考核流程（SPEC-037 closeout §9 另行）｜ 用户授权自主推进（「需要」确认按推荐续做）｜ 前置：SPEC-037（Performance 模型 + 服务层 + controller 基础设施）
设计权威：本文档 ｜ 计数基线：SPEC-042 终态（迁移 31/模型 61/权限 134/事件 15/路由 32）

## 1. 交付范围

绩效模块补全**实际考核流程**——目标设定/自评/主管评 + 状态机扩展 + 前端考核步骤。**结构性变更**（迁移 31→**33** +2：加列 + provisioning；模型 61 不变/权限 134→**135** +1 performance.update/事件 15 不变；路由 28→**31** +3）。

1. **Task 1（模型扩展 + 迁移）**：Performance +7 列（goal/selfScore/selfComment/managerScore/managerComment/reviewerId/reviewedAt）+ 迁移 `20260805140000_performance_review`（ALTER TABLE 加列）+ `performance-types.ts` 状态机扩展（PENDING/SELF_REVIEWED/MANAGER_REVIEWED/CONFIRMED）+ 入参（SetGoalInput/SelfReviewInput/ManagerReviewInput）+ 权限 +1 `performance.update`（目标/自评自助动作）+ provisioning 迁移 `20260805140010_performance_update_provision` + baseline 同步（迁移 33 + 计数断言 135）。
2. **Task 2（考核服务 + controller + 路由）**：`performance-service` +`setGoal`（PENDING 期设目标）/`selfReview`（PENDING→SELF_REVIEWED）/`managerReview`（SELF_REVIEWED→MANAGER_REVIEWED + reviewerId/reviewedAt）/`confirm` 扩展任意非终态 + `transitionPerformance` 状态守卫通用实现 + 审计 + `controller/performance.ts` +3 + `router.ts` +3（POST set-goal/self-review（performance.update）/manager-review（performance.confirm））；服务测试 4 例。
3. **Task 3（本报告）**：API 测试 3 例 + 前端考核步骤 + 闸门 + runbook §11 + 本 closeout。

**变更文件（共 6 后端 + 2 前端 + 2 测试 + 3 文档）**：Task 1 `schema.prisma` + `20260805140000_performance_review` + `performance-types.ts` + `authorization-types.ts` + `permission-catalog.ts` + `20260805140010_performance_update_provision` + `check-baseline-contract.ts`（33）+ 计数断言五处（135）；Task 2 `performance-service.ts` + `controller/performance.ts` + `router.ts` + `test/performance/performance-review-service.test.ts`；Task 3 `test/app/performance-review-api.test.ts` + 前端 `pages/Performance/index.tsx` + `api/organization.ts` + `types/index.ts` + `features/authorization/types.ts` + `PerformancePage.test.tsx` + runbook §11 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| performance 考核服务测试（`performance-review-service.test.ts`） | **4/4 pass**（setGoal PENDING/非 PENDING 409/403；selfReview PENDING→SELF_REVIEWED/非法评分 400/重复 409；managerReview SELF_REVIEWED→MANAGER_REVIEWED+reviewer/未自评 409；confirm 任意非终态/双确认 409） |
| performance API 测试（`performance-review-api.test.ts`） | **3/3 pass**（全流程 setGoal→self→manager→confirm/权限 403/状态守卫 409+400+404） |
| 前端 Performance 页 Vitest（`PerformancePage.test.tsx`） | **5/5 pass**（原 4 例 + 目标设定提交 1 例） |
| 前端全量 Vitest | **48 files / 239 tests 全绿**（Performance 页 +1 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（performance 域 + controller + router + 测试） | **0 err** |
| web tsc + eslint（Performance 页 + api + types + 测试） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **57/57 pass** |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（**33 迁移** / **61 模型**） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**结构性变更**：迁移 **31→33**（+2：`20260805140000_performance_review` 加列 + `20260805140010_performance_update_provision` provisioning）；模型 **61** 不变（加列非新模型）；权限 **134→135**（+1 `performance.update`，catalog + provisioning 双源一致）；事件 **15** 不变；路由 **28→31**（+3 requirePermission）。`check:baseline`（33/61）+ 计数断言 135 已同步。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 模型扩展 | Performance +goal/selfScore/selfComment/managerScore/managerComment/reviewerId/reviewedAt（迁移 31→33） |
| D2 | 状态机扩展 | PENDING→SELF_REVIEWED→MANAGER_REVIEWED→CONFIRMED；confirm 任意非终态 → CONFIRMED（兼容） |
| D3 | 服务方法 | setGoal（PENDING）/selfReview（PENDING→SELF_REVIEWED）/managerReview（SELF_REVIEWED→MANAGER_REVIEWED + reviewerId/reviewedAt）/confirm（任意非终态） |
| D4 | 权限 | setGoal/selfReview = performance.update（+1 码）；managerReview/confirm = performance.confirm |
| D5 | controller + 路由 | +3 方法 + 3 条路由 |
| D6 | 前端 | 考核流程步骤（目标/自评/主管评 + 确认，按状态机门控） |

**实施期 ⚠️ 记录**：

- **performance.update 码补建**：设计 D4 初定 setGoal/selfReview 复用 `performance.update`——但 SPEC-037 只建了 read/create/confirm 三码，无 update → **+1 码（134→135）** + provisioning 补迁移 `20260805140010_performance_update_provision`。
- **迁移计数 31→33（非 32）**：计划初估 +1，实际 +2（加列 + provisioning 两迁移）——check-baseline/design/plan 已修正。
- **confirm 兼容扩展**：原 `updateMany {id, status: {not:'CONFIRMED'}}` 已天然支持任意非终态 → CONFIRMED，零逻辑变更（新状态复用）。
- **状态守卫通用化**：`transitionPerformance(id, fromStatus, action, data)` 通用实现（updateMany {id, status: fromStatus} → count=0 → 404/409 + 审计）——三考核动作复用，确定性非时序。
- **前端 dialog 冲突**：详情抽屉 + 考核 Modal 均为 role=dialog——测试定位改直查 Modal 内唯一文本域（沿 Case 页纪律）。
- **状态标签对齐**：PENDING 文案「待确认」→「待考核」（状态机扩展后语义）；前端 STATUS_META +SELF_REVIEWED/MANAGER_REVIEWED。

## 6. 安全审计状态

- `security:test` **57/57**（本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **绩效与案件/财务联动**（案件办结数/回款驱动）——另行（设计 §6 OUT）。
2. **绩效审批联动**（主管评需审批实例）——另行（设计 §6 OUT）。
3. **绩效驾驶舱/趋势图**——另行（设计 §6 OUT）。
4. **考核评分上限**：selfScore/managerScore 整数 0-100（无加权/换算）。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **结构性变更对账**：迁移 **33**（+2）/模型 61/权限 **135**（+1）/事件 15/路由 **31**（+3）——`check:baseline`（33/61）+ `check:bootstrap` PASS。
- **状态机对账**：`PERFORMANCE_STATUSES` = PENDING/SELF_REVIEWED/MANAGER_REVIEWED/CONFIRMED；setGoal 仅 PENDING、selfReview PENDING→SELF_REVIEWED、managerReview SELF_REVIEWED→MANAGER_REVIEWED、confirm 任意非终态；非法翻转 409 `PERFORMANCE_STATE_INVALID`（`transitionPerformance` updateMany {id, status: fromStatus} count=0 → 404/409）。
- **审计对账**：PERFORMANCE_GOAL_SET/SELF_REVIEW/MANAGER_REVIEW/CONFIRM 落 operation_log（targetType PERFORMANCE），actor=请求用户；读不落。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **绩效与案件/财务联动**：案件办结数、回款额驱动绩效——另行。
- **绩效审批联动**：主管评经审批实例（case/approval 联动）——另行。
- **绩效驾驶舱**：趋势图/对比/排行——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（模型 + 迁移 + 权限）**：Performance +7 列 + 迁移 33 + performance.update 码 + provisioning + baseline 同步 → `check:baseline`（33/61）+ 计数断言 135 全绿。
- **Task 2（考核服务 + 路由）**：setGoal/selfReview/managerReview/confirm + `transitionPerformance` 状态守卫 → 服务 4/4 + tsc/eslint 0。
- **Task 3（本报告）**：API 3/3 + 前端 Performance 页 5/5 + 全量 vitest 48/239 + `security:test` 57/57 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §11 + 本 closeout 收口。

## 11. 收官状态

**SPEC-043 绩效考核流程本地闭环（2026-08-05）**：3/3 任务完成（Task 1 Performance +7 考核列 + 迁移 33 + performance.update 码 + provisioning + baseline 同步；Task 2 setGoal/selfReview/managerReview/confirm + 状态守卫 + controller + 路由；Task 3 API 测试 + 前端考核步骤 + 闸门 + runbook §11 + closeout）。**结构性变更**：迁移 **31→33** / 模型 61 / 权限 **134→135** / 事件 15 / 路由 **28→31**。聚焦验证：考核服务 **4/4** + API **3/3** + 前端 Performance 页 **5/5** + 全量 vitest **48 files/239** + `security:test` **57/57** + `security:audit:all` 双绿 + check:baseline（**33/61**）+ check:bootstrap + docs-leakage + web build 全 PASS。实施期 ⚠️ §5（performance.update 码补建 / 迁移计数 33 / confirm 兼容 / 状态守卫通用化 / 前端 dialog / 状态标签），已知非阻断 §7，follow-up §9。**绩效模块端到端覆盖考核流程——目标/自评/主管评/确认可用**。按项目约束零 git 操作，本地闭环。
