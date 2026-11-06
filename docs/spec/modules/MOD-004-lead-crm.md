---
id: MOD-004
title: 线索、跟进、公海与到访
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-004 线索、跟进、公海与到访

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 入口和数据

客户经营下包含线索列表、跟进工作表、公海池、到访日历。`LEADS`、`FOLLOWS` 直接读取正式线索及跟进记录，详情和多维表格没有各自独立副本。病例评估、签约转化和律师客资属于补充模板，应与正式来源区别。

## 2. 业务操作

- 线索新建、详情、查询、编辑、删除按 `lead.*` 动作处理；网格直接编辑姓名、电话、微信、意向等级白名单，状态/负责人采用业务动作。
- 跟进支持在表中新增、修改允许字段和删除；关联线索选项必须来自操作者可见线索，不使用无范围员工/客户全集。
- 跟进自动编号按服务产生，最后操作人/时间由系统维护；不能在网格伪造审计字段。
- 公海领取、分配、重新分配、回收有独立流转记录；池状态与业务状态分开存储。
- 到访日历中的业务邀约与工作台协同日历是两个对象，不能把成员邀请应答当成线索已到访。
- `MEDICAL_ASSESSMENT` 病例评估表和 `SIGNING_CONVERSION` 签约转化表按标准字段维护；自动操作人/时间只读。

## 3. 状态和敏感数据

线索状态代码为 NEW、ASSIGNED、CONTACTED、SCREENED、INVITED、VISITED、CONVERTED、LOST、NURTURE；池状态 PUBLIC、PRIVATE、RECYCLED。邀约状态 PENDING、CONFIRMED、VISITED、NOSHOW、CANCELLED、RESCHEDULED。合法转换由业务服务控制，不能推断所有状态可两两切换。

电话/微信使用字段投影和动作权限，脱敏值不允许写回覆盖原值。跟进读取、导出、关联选择与业务范围一致；普通账号不能通过工作表绕过正式线索权限。

## 4. 验收要求

有权限账号新建线索及跟进后，模块列表、表格、详情均可查询；双击修改允许字段能保存；取消不改变记录；删除受领域约束和审计保护。用户A无范围的线索不出现在用户B关联候选、搜索、导出和@接收对象中。已转换线索保留客户关联和来源追溯。

## 实现与回归入口

- [apps/server/app/application/crm/crm-worksheet-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/crm-worksheet-service.ts)
- [apps/server/app/application/crm/follow-worksheet-fields.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/follow-worksheet-fields.ts)
- [apps/server/app/domain/crm/lead-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/crm/lead-policy.ts)
- [apps/server/app/application/collaboration/follow-support-templates.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/follow-support-templates.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/crm/lead-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/crm/lead-service.test.ts)
- [apps/server/test/crm/appointment-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/crm/appointment-service.test.ts)
- [apps/server/test/collaboration/follow-support-tables.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/follow-support-tables.test.ts)

## 历史需求追溯

历史编号保留：`CRM-01`、`CRM-02`、`CRM-03`、`CRM-04`、`CRM-05`、`CRM-06`、`CRM-07`、`CRM-08`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-004-lead-crm.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
