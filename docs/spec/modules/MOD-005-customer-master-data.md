---
id: MOD-005
title: 客户主数据
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-005 客户主数据

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 客户记录及入口

客户管理工作区展示正式客户记录；客户管理表以 `CUSTOMERS` 来源查询同一数据。客户可以由线索转入，也可以直接新建，不要求必须先有线索。客户与谈案、合同、案件通过稳定ID关联，不依赖用户可改名称。

## 2. 字段和CRUD

网格允许编辑的标准业务键为 name、phone、wechat、customerType、status、email、address、tags、remark。客户类型为个人/企业；状态选项潜在、意向、已签约、不活跃。具体列名、类型及来源键见字段附录，新增/删除仍执行客户服务的完整校验。

客户管理中的新建、表格内操作和详情不能各走一套保存规则。删除不允许破坏合同、案件等引用，需按服务返回处理原因；客户合并等敏感动作不等于一般编辑权限。

## 3. 范围与同步

- 本人和下属范围将员工ID解析为实际创建用户ID。
- 来源线索存在时使用其组织/团队关系；直接创建且没有线索的客户，组织范围通过创建人有效组织解析。
- 无任何有效范围时返回空范围，不退化为全所可见。
- 角色业务权限、字段脱敏和表ACL同时生效；共享一张表不会让所有角色看到管理员的全部客户。
- 客户姓名、电话在案件/售后等表中的引用由投影和业务服务处理，不通过前端复制掩盖源数据差异。

## 4. 验收要求

新账号直接创建客户后能回到详情和列表；管理员与同范围账号看到同一ID，更新可写字段后重查一致；无电话原值权限的账号既不能通过筛选反推原值，也不能把掩码保存为电话。删除关联客户应明确失败而非出现孤立合同/案件。

## 实现与回归入口

- [apps/server/app/application/contract/contract-scope.ts](../../../LayerManage/law-firm-system/apps/server/app/application/contract/contract-scope.ts)
- [apps/server/app/application/collaboration/business-grid-fields.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/business-grid-fields.ts)
- [apps/server/app/application/crm/workspace-domain-source.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-domain-source.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/new-account-business.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/new-account-business.test.ts)
- [apps/server/test/collaboration/module-sharing.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/module-sharing.test.ts)
- [apps/server/test/collaboration/workspace-domain-sources.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/workspace-domain-sources.test.ts)

## 历史需求追溯

历史编号保留：`CUS-01`、`CUS-02`、`CUS-03`、`CUS-04`、`CUS-05`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-005-customer-master-data.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
