# SPEC-028 审批全组织视图增强（Org-Wide View Enhancement）设计

日期：2026-08-04 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-023 closeout §9「全组织视图增强——全量筛选/搜索/导出」+ 记忆候选
设计权威：本文档 ｜ 前置：SPEC-023（role='ALL' 全组织视图基座——listInstances 无 actor 过滤 + getInstance manage 放行）、SPEC-017（定义管理）、SPEC-025（导出 JSON 先例）

## 1. 背景与目标

SPEC-023 已提供全组织审批视图（`listInstances` role='ALL'，approval.manage 门控，createdAt DESC 分页全量）。但运维/合规纵览全组织实例时**无筛选/搜索/导出能力**——海量实例难定位。**目标**：为 role='ALL' 视图加**筛选**（businessType/status/applicantId）+ **关键词搜索**（title）+ **CSV 导出**。**零结构变更**（复用既有查询参数 + 列）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 筛选参数 | `listInstances` query 扩展（仅 role='ALL' 生效，其余 role 忽略或 400）——`businessType`（枚举白名单）/ `status`（PENDING/APPROVED/REJECTED/WITHDRAWN/CANCELLED）/ `applicantId`（UUID 校验） |
| D2 | 关键词搜索 | `keyword`（title 模糊匹配 `contains`，1-100 长度，POSTGRES ILIKE） |
| D3 | 组合语义 | 筛选 + 搜索 + 分页可叠加（AND 组合）；`createdAt DESC id ASC` 排序不变 |
| D4 | 校验 | 枚举/长度非法 → 400 `VALIDATION_FAILED`；UUID 非法 → 400 |
| D5 | 导出 | `GET /approvals/export`（approval.manage，role='ALL' 语义）：CSV（UTF-8 BOM 头 + 表头：instanceId/businessType/title/status/applicantId/currentNode/createdAt/updatedAt）；`maxRows` 上限（默认 5000，上限 10000）；复用筛选/搜索参数 |
| D6 | 前端 | 「全部审批」Tab 加筛选区（类型/状态/申请人下拉 + 关键词输入）+ 导出 CSV 按钮（Blob 下载）；`api/approval.ts` 类型扩展 |
| D7 | 权限 | 筛选/搜索/导出均 approval.manage 门控（role='ALL' 语义）；动作不扩大 |
| D8 | 零结构变更 | 无迁移/模型/权限/事件变更；路由 +1（`/approvals/export`）或复用（导出可挂 `/approvals?export=csv`）——**裁决：新增 `/approvals/export` 字面量路由**（先于 :id） |

## 3. 服务层（approval-instance-service）

### 3.1 listInstances query 扩展（role='ALL'）

```ts
// ListApprovalsQuery 扩展可选字段：businessType? / status? / applicantId? / keyword?
// role='ALL' 时解析筛选；其余 role 传入筛选参数 → 400 VALIDATION_FAILED（语义防混用）
const where = {
  ...(businessType && { businessType }),
  ...(status && { status }),
  ...(applicantId && { applicantId }),
  ...(keyword && { title: { contains: keyword } }),
};
```

### 3.2 exportInstances（新增）

```ts
// approval.manage 门控 → role='ALL' 语义（无 actor 过滤）→ 筛选/搜索参数同 listInstances
// → createdAt DESC id ASC → maxRows 截断（默认 5000/上限 10000 → 超限 400 或截断+提示）→ CSV 文本返回
async exportInstances(query: ExportInstancesQuery): Promise<string>  // CSV（UTF-8 BOM）
```

**导出列**：instanceId/businessType/title/status/applicantId/currentNode/createdAt/updatedAt。CSV 转义：字段含逗号/引号/换行 → 双引号包裹 + 内部引号翻倍（RFC 4180）。

## 4. 控制器 + 路由

```ts
// controller/approval.ts
async exportInstances() { this.respond(await approvalInstanceService(this.ctx).exportInstances(parseExportQuery(this.ctx.query))); }
// router：GET /api/v1/approvals/export（approval.manage，字面量先于 :id）
```

**响应**：`{ code:200, data: csvString }`——前端 Blob 下载。或直接 `ctx.body = csv` + `Content-Type: text/csv`（裁决：**包络 JSON 内嵌 CSV 字符串**，沿薄控制器 envelope 纪律，前端解析 Blob）。

## 5. 前端

- `api/approval.ts`：`listApprovals` query 类型 +`businessType?/status?/applicantId?/keyword?`；+`exportApprovalsCsv(query)` → 解析 envelope → Blob 下载。
- `ApprovalCenterPage`「全部审批」Tab：筛选区（Select businessType/status + Input applicantId + Input keyword + 查询按钮 + 重置）+ 导出 CSV 按钮（loading 态）；列表刷新带筛选参数。
- 类型：`ApprovalRoleFilter` 不变（四值）。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | role='ALL' 筛选各参数生效 / 组合 AND / keyword ILIKE / 非法枚举/UUID 400 / 其余 role 传筛选 400 / 导出 CSV 转义 + maxRows 截断 |
| 控制器 | `/approvals/export` 权限 403 / 筛选参数透传 / CSV envelope |
| 回归 | approval 域既有全绿 + 前端 typecheck/lint/build |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15 不变；**路由 13→14**（+`/approvals/export`）。后端测试 +N（筛选/搜索/导出 ~8）。

## 8. 范围边界（明确 OUT）

- 动作扩大（管理员代处理他人任务）——另行。
- 导出 Excel/PDF、报表/统计驾驶舱——另行。
- 前端虚拟滚动/无限加载——另行（分页保持）。
- 其余 role（APPLIED/TODO/DONE）筛选——OUT（仅 role='ALL'）。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D8 | 见 §2 | 用户授权自主推进 |
