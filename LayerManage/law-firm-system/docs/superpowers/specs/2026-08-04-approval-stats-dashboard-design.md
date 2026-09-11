# SPEC-030 审批统计驾驶舱（Approval Stats Dashboard）设计

日期：2026-08-04 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-028 closeout §9「全组织视图导出增强——报表/统计驾驶舱」+ 记忆候选
设计权威：本文档 ｜ 前置：SPEC-023（role='ALL' 全组织视图基座）、SPEC-028（筛选/搜索/导出）

## 1. 背景与目标

全组织审批视图（role='ALL'）已具筛选/搜索/导出。运维/合规纵览审批健康度时缺**聚合统计**——各类型/状态分布、在途量、平均决策时效。**目标**：为全组织视图加**统计接口**（`GET /approvals/stats`）+ 前端「全部审批」Tab 统计摘要（卡片 + 简易图表）。**零结构变更**（聚合查询复用既有列）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 统计接口 | `GET /approvals/stats`（approval.manage，role='ALL' 语义无 actor 过滤）——返回 `{ total, pendingCount, decidedCount, byBusinessType, byStatus, avgDecisionHours }` |
| D2 | 聚合维度 | total=全量实例数；pendingCount=status PENDING；decidedCount=终态（APPROVED/REJECTED/WITHDRAWN）Σ；byBusinessType=按类型计数（EXPENSE/CONTRACT_CHANGE/SEAL/LEAVE/TRANSFER）；byStatus=按状态计数；avgDecisionHours=已决实例 `decidedAt - createdAt` 均值（小时，保留 1 位小数） |
| D3 | 筛选参数 | stats 复用筛选（businessType/status/applicantId/keyword——沿 SPEC-028）——统计与列表口径一致 |
| D4 | 权限 | approval.manage 门控（role='ALL' 语义）；只读不落审计 |
| D5 | 前端 | 「全部审批」Tab 顶部统计摘要：卡片（总量/在途/已决/平均决策时效）+ 类型分布简易条（AntD Progress/Statistic）——筛选变化时刷新 |
| D6 | 零结构变更 | 无迁移/模型/权限/事件变更；**路由 14→15**（+/approvals/stats 字面量先于 :id） |

## 3. 服务层（approval-instance-service）

### 3.1 getStats(query: ApprovalStatsQuery): Promise<ApprovalStatsView>

```ts
// approval.manage → 筛选/搜索参数（同 role='ALL' 语义）→ 单事务聚合：
// - count({ where }) total
// - count({ where, status: 'PENDING' }) pendingCount
// - count({ where, status: { in: [APPROVED, REJECTED, WITHDRAWN] } }) decidedCount
// - groupBy businessType → byBusinessType
// - groupBy status → byStatus
// - avg decidedAt-createdAt（SQL AVG(EXTRACT(EPOCH FROM ...)) / 3600）→ avgDecisionHours
```

**口径**：avgDecisionHours 仅对已决实例（decidedAt 非空）计算；无已决 → null。byBusinessType/byStatus 仅含非零组合。

## 4. 控制器 + 路由

```ts
// controller/approval.ts
async stats() { this.respond(await approvalInstanceService(this.ctx).getStats(parseStatsQuery(this.ctx.query))); }
// router：GET /api/v1/approvals/stats（approval.manage，字面量先于 :id）——approval 域 14→15
```

## 5. 前端

- `api/approval.ts`：+`approvalStats(query)` → `ApiResponse<ApprovalStatsView>`。
- `ApprovalCenterPage`「全部审批」Tab：顶部统计区（AntD Row/Col + Statistic 卡片：总量/在途/已决/平均决策时效 + 类型分布条）——筛选变化/切 Tab 时刷新（与列表同筛选）。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | stats 总量/在途/已决/类型分布/状态分布/avgDecisionHours 口径 + 筛选生效 + 无码 403 + 无已决 → avg null |
| 控制器 | /approvals/stats 权限 403 + 筛选透传 + 字面量先于 :id |
| 前端 | 统计卡片渲染 + 筛选刷新 + 导出按钮共存 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15 不变；**路由 14→15**。后端测试 +N（~6）。前端 +2。

## 8. 范围边界（明确 OUT）

- 时间序列趋势图（月度/周度）——另行（当前快照统计）。
- 审批人维度统计/驾驶舱——另行。
- 动作扩大（管理员代处理他人任务）——OUT。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 用户授权自主推进 |
