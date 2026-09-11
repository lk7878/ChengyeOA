# SPEC-032 客户经营分析（复购 + 转介绍）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进 ｜ 需求来源：业务链最后一环「客户复购与转介绍」（品牌获客→线索→谈案合同→收款→案件→**客户复购与转介绍**）+ 记忆候选
设计权威：本文档 ｜ 前置：SPEC-009（客户主数据 + 线索 CRM——Lead.referralCustomerId 转介绍已建）、SPEC-010（Contract.customerId 关联客户）

## 1. 背景与目标

业务链末端「客户复购与转介绍」尚无**经营分析**能力：客户详情/列表看不到复购（同客户多合同）与转介绍（客户引荐线索）的量化指标——无法评估客户生命周期价值与口碑获客效果。**目标**：为客户视图加**复购 + 转介绍指标**（后端聚合 + 前端展示）。**零结构变更**（复用既有 customer/contract/lead 关系，聚合查询）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 指标口径 | CustomerView 扩展：`contractCount`（客户合同数，含 deletedAt null）、`repurchaseCount`（= max(0, contractCount-1)——首单后每单为复购）、`referralCount`（referralCustomerId=本客户的线索数）、`firstContractAt`/`latestContractAt`（首单/最近单时间） |
| D2 | 聚合实现 | getCustomer/listCustomers 内聚合（合同按 customerId count + min/max createdAt；线索按 referralCustomerId count）——一次查询 + 计数 |
| D3 | 权限 | 沿既有 customer.read（list/get）门控；只读不落审计 |
| D4 | 前端 | 客户详情页（客户列表已有）加「经营分析」区块（AntD Descriptions/Statistic：合同数/复购数/转介绍数/首单时间/最近单时间） |
| D5 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（CustomerView 视图扩展） |

## 3. 服务层（customer-service）

### 3.1 CustomerView 扩展 + 聚合

```ts
// CustomerView + contractCount/repurchaseCount/referralCount/firstContractAt/latestContractAt
// getCustomer/customerList：对单客户/分页客户集批量聚合（IN 查询）——合同 count + min/max createdAt、
// 线索 referralCustomerId count。
```

**口径**：contractCount 计 `Contract.customerId = id AND deletedAt = null`（含终止合同——历史经营事实）；repurchaseCount = contractCount>0 ? contractCount-1 : 0；referralCount 计 `Lead.referralCustomerId = id`（任意状态——引荐即口碑信号）。

## 4. 前端

- `api/approval.ts` → 实为 `api/.../customer.ts`：CustomerView 类型 +指标字段。
- 客户详情页（CustomerDetail 或客户列表展开）加「经营分析」区块（AntD Statistic/Descriptions：合同数/复购数/转介绍数/首单时间/最近单时间）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 单客户聚合（0 合同/1 合同/多合同 → repurchaseCount）、referralCount（多线索引荐）、firstContractAt/latestContractAt 口径、deletedAt 排除、列表分页批量聚合、权限 |
| 前端 | 详情页经营分析区块渲染 + 指标字段 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 15 全不变。后端测试 +N（~6）。前端 +2。

## 7. 范围边界（明确 OUT）

- 客户生命周期阶段自动划分（新客/复购/流失）——另行。
- 复购/转介绍报表导出——另行。
- 转介绍奖励/返佣——另行（业务规则未定义）。
- 案件办理域（业务链「案件办理与交付」）——另行大专项。

## 8. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进 |
