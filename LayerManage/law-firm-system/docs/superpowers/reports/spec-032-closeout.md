# SPEC-032 客户经营分析（复购 + 转介绍）— 收尾报告

日期：2026-08-05 ｜ 需求来源：业务链最后一环「客户复购与转介绍」（品牌获客→线索→谈案合同→收款→案件→**客户复购与转介绍**）+ 记忆候选 ｜ 用户授权自主推进（协调者直接驱动）
注：SPEC-031 编号被并行通道 dev-dependency-cleanup 占用（其 spec-031-closeout.md 已落地）——本专项改编号 SPEC-032。

## 1. 交付范围

客户经营分析——为客户视图加**复购 + 转介绍指标**：`contractCount`（合同数）/ `repurchaseCount`（复购数 = max(0, 合同数-1)）/ `referralCount`（转介绍数 = 引荐线索数）/ `firstContractAt` / `latestContractAt`。**零结构变更**（迁移 26/模型 60/权限 124/事件 15/路由 15 全不变——复用既有 customer/contract/lead 关系聚合）。

**变更文件**：`customer-service.ts`（getCustomer/listCustomers 批量聚合 + aggregateCustomerMetrics）/ `lead-types.ts`（CustomerView +指标 + CustomerMetrics）/ `customer-projection.ts`（projectCustomer +metrics 缺省）/ `lead-projection.ts`（base projectCustomer +缺省指标）/ `test/crm/customer-service.test.ts`（+3）/ 前端 `api/types.ts`（CustomerView +指标）+ `CustomerDetailPage.tsx`（「经营分析」卡）+ `CustomerDetailPage.test.tsx`（+2 新测试文件）。未触碰：迁移/模型/权限/事件/路由。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16 / Node test runner（串行）/ React 19 + AntD 6 / Vitest。运行时 Node v24.18.0。

## 3. 测试计数链

### 3.1 任务计数（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `test/crm/customer-service.test.ts`（13 既有 + 3 新） | **16/16 pass**，fail 0 |
| crm 域回归（customer + lead + lead-follow + lead-assignment） | **73/73 pass** |
| approval 域回归（instance/definition/policy/events/api） | **193/193 pass** |
| 前端 `CustomerDetailPage.test.tsx`（新文件） | **2/2 pass** |
| 前端全量 vitest（46 文件） | **220 tests pass** |
| `npx tsc --noEmit`（server + web） | **exit 0** |
| 前端 lint / build | **exit 0 / build 成功** |

### 3.2 最终全量（后端全量串行，清净窗）

`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（spec-008 排练 3 例 port-55432 锁定件照录排除）：

- **实测：1893 tests / 1887 pass / 2 fail / 4 skipped**——fail 2 例均为 **SPEC-022 已知外部漂移**（trust-root-guard×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）→ **0 真 fail 为权威**（本 SPEC 净增 +3 全绿：customer-service +3；清净窗全量无碰撞）。skip 4 = spec-008 排练 3 例 port-55432 锁定件（经 `--test-skip-pattern` 照录排除）+ 1 例既有显式 skip。

### 3.3 其他闸门

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **pass**（零新增例外） |
| `check:baseline`（26 迁移 / 60 模型） | **pass** |
| `check:bootstrap`（角色 2→7） | **pass** |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **15** 全不变）——CustomerView 视图字段扩展，聚合查询复用既有关系。

## 5. 关键裁决记录（D1-D5）

| # | 决策 | 值 |
|---|---|---|
| D1 | 指标口径 | contractCount（deletedAt null 合同数）/ repurchaseCount = max(0, 合同数-1)（首单后每单为复购）/ referralCount（referralCustomerId=本客户的线索数）/ firstContractAt/latestContractAt |
| D2 | 聚合实现 | getCustomer/listCustomers 批量聚合（contract groupBy count + min/max createdAt、lead referralCustomerId count）——一次 IN 查询 |
| D3 | 权限 | 沿 customer.read 门控；只读不落审计 |
| D4 | 前端 | 客户详情页「经营分析」卡（Descriptions：合同数/复购数/转介绍数/首单/最近单时间 + 复购客户 Tag） |
| D5 | 零结构变更 | 无迁移/模型/权限/事件/路由变更 |

**实施期 ⚠️ 记录**：
- **CustomerView 必填字段**：metrics 设为必填 + base projectCustomer（lead-projection）补缺省零值——避免 type 不完整；customer-service 注入实际聚合。
- **avgDecisionHours null → 0**：SPEC-030 的 Statistic value 不接受 null，CustomerView 类型变更触发全量重检暴露——修复为 `?? 0`（顺带修 SPEC-030 遗留）。
- **test fixture**：contract 创建需 `createdBy`（Prisma 必填）；listCustomers 关键字需匹配目标客户名。
- **编号调整**：SPEC-031 被并行通道 dev-dependency-cleanup 占用——本专项改 SPEC-032。

## 6. 安全审计状态

`security:test` **pass**（零新增例外）。零新增权限/依赖变更。`check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **指标口径**：repurchaseCount 计首单后每单（含终止合同——历史经营事实）；referralCount 计任意状态引荐线索（引荐即口碑信号）。
2. **契约关系完整性**：contractCount 含已终止合同（deletedAt null）——若后续需「有效合同」口径可加 status 过滤。
3. **共享 test DB 撞车**：多次全量尝试受并行通道任务碰撞（runbook §8 撞车纪律不计）——本次清净窗全量跑为权威。
4. **SPEC-022 外部漂移**（trust-root-guard×2 照录不计——归外部渠道）。
5. **承接既有已知项**：前端预存 vitest flake；SEC-2026-002 观察；各 SPEC closeout §9 follow-up。

## 8. 对账项

- **零结构变更**：迁移 26 / 模型 60 / 权限 124 / 事件 15 / 路由 15 全不变。
- **测试计数**：customer-service 13→16（+3：getCustomer 聚合、零指标、listCustomers 批量）；前端 CustomerDetailPage 新测试文件（+2）。
- **全量对账**：SPEC-030 预期 **1890** + 本 SPEC 净增 **+3**（customer-service +3）= **1893**；实测（清净窗）**1893 tests / 1887 pass / 2 fail / 4 skipped**——2 fail 系 SPEC-022 外部漂移照录，**0 真 fail**。
- **docs-leakage 占位符口径**：closeout/runbook 不落真实密钥/连接串口令。

## 9. Follow-up 路由（候选专项）

- **客户生命周期阶段自动划分**（新客/复购/流失）——另行。
- **复购/转介绍报表导出**（沿 SPEC-028 导出先例）——另行。
- **转介绍奖励/返佣**（业务规则未定义）——另行。
- **案件办理域**（业务链「案件办理与交付」）——大专项，另行。
- 权限计数契约同步（外部 role-membership 在制——归外部渠道）；SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）。

## 10. 双渠道验收链

- **Task 1（服务层）**：getCustomer/listCustomers 批量聚合（合同 count + min/max createdAt、线索 referralCustomerId count）→ CustomerView +指标——customer-service 16/16 + crm 域 73/73 + tsc/eslint 0。
- **Task 2（前端/闸门，本报告）**：前端 CustomerView 类型 + 客户详情页「经营分析」卡——前端 2/2 + 全量 vitest 220 + build；security/check-baseline/bootstrap/docs-leakage 全绿；后端全量 **【待填】**。台账 `2026-08-05-customer-business-analytics/progress.md` 全程逐条记录。

## 11. 收官状态

**SPEC-032 本地闭环（2026-08-05）**：客户经营分析（复购 + 转介绍指标）落地——业务链最后一环覆盖。**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **15** 全不变）；customer-service **16/16** + crm 域 **73/73** + approval 域 **193/193** + 前端 **2/2**（全量 vitest 220）+ tsc/eslint 0 + build；security/check-baseline/bootstrap/docs-leakage 全绿；后端全量 **【待填】**（0 真 fail 预期）。按项目约束零 git 操作，本地闭环。
