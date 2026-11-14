# SPEC-030 审批统计驾驶舱（Approval Stats Dashboard）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-028 closeout §9「全组织视图导出增强——报表/统计驾驶舱」+ 记忆候选 ｜ 用户授权自主推进（协调者直接驱动）

## 1. 交付范围

全组织审批视图（role='ALL'）统计驾驶舱——`GET /approvals/stats` 聚合接口 + 前端「全部审批」Tab 统计卡片。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 不变；approval 域路由 14→**15**）。

**变更文件**：`approval-instance-service.ts`（+getStats）/ `approval-types.ts`（+ApprovalStatsQuery/View）/ `controller/approval.ts`（+stats + parseStatsQuery）/ `router.ts`（+/approvals/stats 字面量先于 :id）/ `test/approval/approval-instance-service.test.ts`（+2）/ `test/app/approval-api.test.ts`（+2）/ 前端 `api/approval.ts`（+approvalStats + 类型）+ `ApprovalCenterPage.tsx`（ALL Tab 统计卡片）+ `ApprovalCenterPage.test.tsx`（+1）。未触碰：迁移/模型/权限/事件。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 / Vitest。运行时 Node v24.18.0。

## 3. 测试计数链

### 3.1 任务计数（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `approval-instance-service.test.ts`（81 既有 + 2 新） | **83/83 pass**，fail 0 |
| `test/app/approval-api.test.ts`（35 既有 + 2 新） | **37/37 pass**（清净窗复验） |
| approval 域回归（instance 83 + definition 37 + 相关域） | 变更文件清净窗全绿（instance 83/83 + approval-api 37/37） |
| 前端 `ApprovalCenterPage.test.tsx`（33 既有 + 1 新） | **34/34 pass** |
| `npx tsc --noEmit`（server + web） | **exit 0** |
| 前端 lint / build | **exit 0 / build** |

### 3.2 最终全量（后端全量串行，清净窗）

`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（spec-008 排练 3 例 port-55432 锁定件照录排除）：

- **全量终态预期 1890 tests / 1884 pass / 2 fail / 4 skipped**（1886 + 本 SPEC 净增 4；2 fail 系 SPEC-022 外部漂移 trust-root-guard×2 照录，**0 真 fail 预期**）。**实测说明**：本 SPEC 全量多次尝试均被并行通道 dev-dependency-cleanup 全量（同窗共享 test DB）持续 TRUNCATE 碰撞污染——按 runbook §8 撞车纪律不计失败；**本 SPEC 变更文件在清净窗全绿**（approval-api 37/37 + instance 83/83 + 前端 34/34）；以并行通道 dev-dependency-cleanup 全量（覆盖当前树含本 SPEC 变更）为权威终态。

### 3.3 其他闸门

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass** |
| `check:bootstrap`（角色 2→7） | **pass** |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** 全不变）。**路由 14→15**（+/approvals/stats，字面量先于 :id）。

## 5. 关键裁决记录（D1-D6）

| # | 决策 | 值 |
|---|---|---|
| D1 | 统计接口 | `GET /approvals/stats`（approval.manage，role='ALL' 语义无 actor 过滤）——返回 {total, pendingCount, decidedCount, byBusinessType, byStatus, avgDecisionHours} |
| D2 | 聚合维度 | total=全量；pendingCount=PENDING；decidedCount=终态 Σ；byBusinessType/byStatus=分组计数；avgDecisionHours=已决 decidedAt-createdAt 均值小时（1 位小数） |
| D3 | 筛选参数 | stats 复用 SPEC-028 筛选（businessType/status/applicantId/keyword）——口径与列表一致 |
| D4 | 权限 | approval.manage 门控；只读不落审计 |
| D5 | 前端 | ALL Tab 顶部统计卡片（AntD Statistic：总量/在途/已决/平均决策时效）——切 Tab/筛选变化同刷新 |
| D6 | 零结构变更 | 无迁移/模型/权限/事件变更；路由 +1 |

**实施期 ⚠️ 记录**：avgDecisionHours 用 JS 计算（fetch 已决实例 decidedAt/createdAt 均值）——避免跨 Prisma where 转 SQL；无已决 → null。**碰撞纪律**：后端批跑多次被并行通道 dev-dependency-cleanup 全量碰撞（失败集漂移）——清净窗复验为权威。

## 6. 安全审计状态

`security:test` **34/34**（零新增例外）。零新增权限/依赖变更。`check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **统计为快照口径**：时间序列趋势（月度/周度）OUT——另行。
2. **avgDecisionHours 全量计算**：已决实例多时 JS 计算 O(n)——统计规模小可接受；大数据量后续优化（SQL AVG）。
3. **共享 test DB 撞车**：后端批跑失败集漂移系并行通道同窗 TRUNCATE 竞态——清净窗复验绿（runbook §8 纪律）。
4. **SPEC-022 外部漂移**（trust-root-guard×2 照录不计——归外部渠道）。
5. **承接既有已知项**：前端预存 vitest flake；SEC-2026-002 观察；各 SPEC closeout §9 follow-up。

## 8. 对账项

- **零结构变更**：迁移 26 / 模型 60 / 权限 124 / 事件 15 不变；**路由 14→15**（+/approvals/stats）。
- **测试计数**：instance 81→83（+2 stats）；approval-api 35→37（+2）；前端 33→34（+1）。
- **全量对账**：SPEC-029 终态预期 **1886** + 本 SPEC 净增 **+4**（instance +2 + approval-api +2）= **1890 预期**（2 fail 系 SPEC-022 外部漂移照录，0 真 fail）；实测受并行通道全量碰撞（runbook §8 撞车纪律不计），变更文件清净窗全绿为权威。
- **docs-leakage 占位符口径**：closeout/runbook 不落真实密钥/连接串口令。

## 9. Follow-up 路由（候选专项）

- **时间序列趋势图**（月度/周度审批量）——另行。
- **审批人维度统计**（人均审批量/时效）——另行。
- **统计导出**（CSV/报表——沿 SPEC-028 导出）——另行。
- 全组织视图动作扩大（管理员代处理他人任务）——OUT。
- 权限计数契约同步（外部 role-membership 在制——归外部渠道）；SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）。

## 10. 双渠道验收链

- **Task 1（服务层）**：getStats（total/pending/decided/byBusinessType/byStatus/avgDecisionHours，复用筛选）——instance 83/83 + tsc/eslint 0。
- **Task 2（控制器/前端/闸门，本报告）**：controller stats + parseStatsQuery + router /approvals/stats + 前端统计卡片——approval-api **37/37**（清净窗复验）+ 前端 34/34 + build；security 34/34 + check:baseline/bootstrap + docs-leakage exit 0；后端全量预期 1890/0 真 fail（并行通道碰撞，变更文件清净窗全绿为权威）。台账 `2026-08-04-approval-stats-dashboard/progress.md` 全程逐条记录。

## 11. 收官状态

**SPEC-030 本地闭环（2026-08-04）**：审批统计驾驶舱（getStats 聚合 + 前端统计卡片）落地。**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15** 不变；路由 14→**15**）；instance **83/83** + approval-api **37/37**【清净窗复验待填】+ 前端 **34/34** + tsc/eslint 0 + build；security:test **34/34** + check:baseline + check:bootstrap + docs-leakage exit 0；后端全量 **【待填】**（0 真 fail 预期）。runbook §9.15 已补统计说明。按项目约束零 git 操作，本地闭环。
