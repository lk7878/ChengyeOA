---
id: MOD-011
title: 综合行政、人力资源与库存
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-011 综合行政、人力资源与库存

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 当前菜单与内部标识

业务应用分组为“综合行政管理”，包含低值易耗品、人力资源、行政事务。内部 `INVENTORY_ITEMS/STOCKTAKES/MOVEMENTS` 等代码及旧路由仍用于兼容，不能根据旧英文或旧“物品管理”工作区名称把页面改回历史布局。低值易耗品中的既有多维表格保持独立。

## 2. 人力资源八张标准表

| 类型 | 表名 | 特殊规则 |
|---|---|---|
| HR_ROSTER | 律所员工名册 | 部门、姓名、职务、电话、入职时间必填；含敏感资料及附件 |
| HR_INTERNS | 实习律师名单 | 姓名、指导律师等模板要求；实习/执业资料 |
| HR_CONTACTS | 员工名单及通讯录 | 部门、姓名、职务、电话 |
| HR_HQ_LAWYERS | 总所在册律师名单 | 执业证号和非负整数执业年限；年龄按身份证出生年份投影 |
| HR_BRANCH_LAWYERS | 派驻分所律师明细 | 同类律师标准字段，授权范围独立 |
| HR_LEAVERS | 离职人员名单 | 入职、离职时间等登记字段 |
| HR_NEW_HIRES | 新入职人员名单 | 应聘者、经历、家庭、附件及条件必填 |
| HR_RECRUITMENT | 招聘面试 | 岗位、候选人、面试状态、招聘负责人等 |

各表只定义结构，不自动灌入初始员工数据。登记人事表不自动创建账号、岗位任职或办理正式离职。人事权限 `hr.worksheet.read/manage/sensitive` 与表ACL同时校验。敏感标记的非附件字段采用带表/字段绑定的AES-GCM加密，派生密钥与MFA用途隔离；无敏感权的读取脱敏，密钥轮换须保留旧版本可读性。入职时间可保留 YYYY-MM，不补造某日；年龄、编号和审计字段只读。完整字段及选项见字段附录。

## 3. 行政事务

- 行政费用支出表；用印登记；发文登记；收文登记；会议登记。
- 用印“审核意见”使用审核结果＋原因控件，需用印审核权限及表编辑权，不能仅依靠前端禁用。
- 会议编号在同表有效记录唯一；人数、份数是非负整数；附件、日期精度、必填和默认选项按模板。
- 当前代码有意保留反馈材料的命名映射：`ADMIN_SENT/发文登记` 使用“收文日期、来文单位”等字段；`ADMIN_RECEIVED/收文登记` 使用“发文日期、主送单位”等字段。本轮以现有成果为准记录该映射，不擅自互换业务字段。

## 4. 低值易耗品与统计

定制物品领用登记及统计、办公用品领用明细及统计、入库、出库、库存、定期盘存模板并存。定制物品数量项10类、办公用品35类。领用统计依据模板类型标识和正数量字段展开，而非表名或历史 InventoryMovement 假定。

库存表有入库量、出库量和库存量投影；盘存的期初/盘存数量是独立登记字段，不能自动当成库存调整业务。既有正式库存对象和新表格投影的来源区别必须保留。

数据分析提供按物品/领用人/组织的登记统计、日期过滤和导出；导出额外要求 `inventory.export` 与其范围。未授权、归档、删除、隐藏数量字段不进入聚合；详细口径见MOD-012。

## 5. 验收要求

8张人事表只建字段、保留月份精度、敏感字段不可越权；行政审核字段权限、会议编号唯一与恢复检查正确；领用数量修改后统计联动，撤权后不能通过汇总/导出读取。员工账号生命周期另按MOD-001处理。

## 实现与回归入口

- [apps/server/app/application/collaboration/hr-worksheets.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/hr-worksheets.ts)
- [apps/server/app/application/collaboration/hr-privacy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/hr-privacy.ts)
- [apps/server/app/application/collaboration/administrative-registers.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/administrative-registers.ts)
- [apps/server/app/application/collaboration/inventory-worksheets.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)
- [apps/server/app/application/inventory/worksheet-statistics.ts](../../../LayerManage/law-firm-system/apps/server/app/application/inventory/worksheet-statistics.ts)
- [apps/web/src/features/navigation/catalog.ts](../../../LayerManage/law-firm-system/apps/web/src/features/navigation/catalog.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/hr-worksheets.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/hr-worksheets.test.ts)
- [apps/server/test/collaboration/office-inventory.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/office-inventory.test.ts)
- [apps/server/test/collaboration/module-inventory.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/module-inventory.test.ts)

## 历史需求追溯

历史编号保留：`HR-01`、`HR-02`、`HR-03`、`HR-04`、`HR-05`、`HR-06`、`HR-07`、`HR-08`、`HR-09`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-011-organization-hr.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
