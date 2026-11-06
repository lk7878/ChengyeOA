---
id: MOD-012
title: 经营分析、可视化仪表盘与领用统计
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-012 经营分析、可视化仪表盘与领用统计

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 三种分析入口

经营概览 `/analytics/overview` 使用领域统计服务；自助可视化仪表盘 `/analytics/dashboards` 使用授权工作表查询；物品领用/定制/办公用品统计使用库存及登记表服务。不能把三种接口混用为同一份无限权限数据仓库。

## 2. 自助仪表盘

| 项目 | 当前约束 |
|---|---|
| 组件 | metric、bar、line、horizontal、area、pie、ring、combo、radar、scatter、funnel、wordcloud、sankey、table、kanban、calendar、gantt、gallery，共18种 |
| 布局 | 拖入/排序、12列网格宽度3–12、组件高度220–900、颜色/图例/小数位等 |
| 数据 | 从当前账号有权访问的表选择，不允许提交任意SQL |
| 聚合 | count、sum、avg、min、max；金额/数字采用Decimal计算 |
| 筛选 | 字段类型校验、AND/OR条件，按组件filter查询并保留领域/行/列范围；不自动继承用户个人视图筛选 |
| 关联 | 最多一个额外表，等值键或关系值匹配，LEFT/INNER；支持记录ID作为关联键 |
| 多对多风险 | 一对多会展开行，计数/合计可能放大；按连接结果聚合，不宣称自动去重业务金额 |
| 上限 | 每来源及展开结果最多10,000行；超过明确报 ANALYTICS_DATA_LIMIT，不返回截断伪总计 |
| 保存 | 最多30组件；所有者维护/删除，version并发保护；共享保存配置不共享数据权限 |
| 刷新 | 默认关闭；服务端允许30–3600秒，UI提供关闭/30秒/1分钟/5分钟；编辑、明细展开、标签隐藏时暂停 |

点击组件可查看明细并打开来源记录；同表组件联动按当前过滤条件重新查询。附件画册仍使用授权附件预览。各组件数据在一次一致性快照中分页读取及关联，不能把截断前页当全量。

## 3. 经营概览口径

领域服务按用户权限分别计算线索、客户、合同、案件、员工数量及确认回款等指标。无相应读权限不是“真实业务为0”，服务可返回不可访问值。确认回款使用已确认收款；月/年边界按Asia/Shanghai，不按服务器任意时区。

旧DASH-01至45是历史目标列表，不代表所有ROI、净利润、品牌贡献、首响时效等均已有专业指标。自助图表也不能无依据生成缺失的业务定义。

## 4. 领用登记统计

当前页面请求 `view=worksheet-statistics`，按 INVENTORY_REGISTER 或 OFFICE_REGISTER 取数。旧 `statistics` 保留传统库存流水口径，不替代新登记统计。

- 按10/35个物品数量字段展开，只有大于0的数量参与；sum为数量总计，count为该物品非零登记行数。
- 分组选择物品、领用人或组织时保留物品/类型信息，不能混算不同物品的单位。
- 文本搜索覆盖物品、人员、部门，日期按中国业务日包含边界。
- 使用表访问及SELF创建人约束；归档表/记录、已删除资源和隐藏字段不参与。
- 导出另求 `inventory.export` 范围交集，最多10,000组并做CSV公式注入防护。

## 5. 验收要求

同一共享仪表盘，管理员与普通账号可因源数据权限得到不同结果，这是正确行为；授权交集相同时记录及聚合一致。保存配置不改变业务数据。大于上限时报错；隐藏字段不能拿来筛选或关联推断；一对多数量解释明确。修改领用原始行后刷新可复算统计。

## 实现与回归入口

- [apps/server/app/application/collaboration/analytics-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/analytics-service.ts)
- [apps/server/app/application/dashboard/dashboard-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/dashboard/dashboard-service.ts)
- [apps/server/app/application/inventory/worksheet-statistics.ts](../../../LayerManage/law-firm-system/apps/server/app/application/inventory/worksheet-statistics.ts)
- [apps/web/src/pages/AnalyticsDesigner/index.tsx](../../../LayerManage/law-firm-system/apps/web/src/pages/AnalyticsDesigner/index.tsx)
- [apps/web/src/pages/AnalyticsDesigner/WidgetView.tsx](../../../LayerManage/law-firm-system/apps/web/src/pages/AnalyticsDesigner/WidgetView.tsx)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/analytics.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/analytics.test.ts)
- [apps/server/test/app/analytics-api.test.ts](../../../LayerManage/law-firm-system/apps/server/test/app/analytics-api.test.ts)
- [apps/web/src/pages/AnalyticsDesigner/AnalyticsDesigner.test.tsx](../../../LayerManage/law-firm-system/apps/web/src/pages/AnalyticsDesigner/AnalyticsDesigner.test.tsx)

## 历史需求追溯

历史编号保留：`DASH-01`、`DASH-02`、`DASH-03`、`DASH-04`、`DASH-05`、`DASH-06`、`DASH-07`、`DASH-08`、`DASH-09`、`DASH-10`、`DASH-11`、`DASH-12`、`DASH-13`、`DASH-14`、`DASH-15`、`DASH-16`、`DASH-17`、`DASH-18`、`DASH-19`、`DASH-20`、`DASH-21`、`DASH-22`、`DASH-23`、`DASH-24`、`DASH-25`、`DASH-26`、`DASH-27`、`DASH-28`、`DASH-29`、`DASH-30`、`DASH-31`、`DASH-32`、`DASH-33`、`DASH-34`、`DASH-35`、`DASH-36`、`DASH-37`、`DASH-38`、`DASH-39`、`DASH-40`、`DASH-41`、`DASH-42`、`DASH-43`、`DASH-44`、`DASH-45`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-012-management-dashboard.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
