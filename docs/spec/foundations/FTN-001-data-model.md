---
id: FTN-001
title: 数据模型与业务真源
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-001 数据模型与业务真源

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 唯一数据库定义

当前为PostgreSQL16，唯一权威schema在 `apps/server/prisma/schema.prisma`。本基线125个Prisma模型、89个迁移目录；完整字段、关系、索引和迁移名见 [模型附录](../reference/DATA-MODELS.md)。旧“22模型空库基线”是早期验收事实，不能描述当前业务数据库。

## 2. 对象域

| 域 | 对象职责 |
|---|---|
| 身份与组织 | 用户、组织、岗位、员工、任职、汇报、团队、角色、授权、会话、MFA、初始化信任根 |
| CRM | 渠道、线索、跟进、公海记录、邀约、客户、转介绍关系 |
| 签约财务 | 谈案、合同、应收/收款、开票、退费、成本、绩效、工资 |
| 交付质检 | 案件及intakeData、SOP模板/实例/任务/成果、抽检/整改/评估/专项分析 |
| 协作资源 | Workspace、Base、Table、Field、View、Record、Attachment、成员/资源授权、DriveNode及快捷入口 |
| 可视化审批 | WorkflowDefinition/Version/Instance/Task/Log/File/Delivery等；旧Approval模型不作为当前入口 |
| 新协作能力 | CollabComment、CalendarEvent/Invitation/Reminder、AnalyticsDashboard、User.appearance |
| 基础设施 | Outbox、订阅、Delivery、HandlerLog、OperationLog、幂等和配置治理记录 |

## 3. 存储与引用契约

- 业务表记录保持领域主键，工作表读适配器不把客户、合同、案件复制进CollabRecord。
- 普通自建表使用字段ID作为JSON键；名称可更改，不能用名称作为稳定关联键。
- 标准模板使用业务source、inventoryKind、lifecycleKind等标识；同名表不自动具有相同业务行为。
- 评论的recordId可指向正式业务ID，不要求存在同ID的普通CollabRecord；每次访问重新检查业务行可见性。
- 关联、附件、所有权和授权是不同关系；转交所有权不等于公开全部资源。
- 版本号用于乐观锁；表结构版本与记录版本分开。历史审核实例固化发布快照。
- 业务删除通常为deletedAt/archived/status标记，具体见各模型和生命周期；不可统一假设所有表都是软删或所有回收都可恢复。
- 金额字段采用Decimal或受控金额字符串；时间存储UTC，业务日界按Asia/Shanghai。只有月份的人事日期保留精度，不补造日期。

## 4. 迁移纪律与验收

已有库使用迁移部署，不重新bootstrap、不用空库断言阻止合法业务存在；初始化、重置测试库、清理测试业务是不同操作。历史反馈中的“清空全部测试业务数据”不是日常启动或文档更新指令。

schema变更必须有迁移；核对迁移目录存在与数据库应用状态是两项检查。本轮不读取或修改业务数据、不执行迁移。验收重点是同源业务ID、关联完整性、并发版本、权限投影和回收恢复约束。

## 实现与回归入口

- [apps/server/prisma/schema.prisma](../../../LayerManage/law-firm-system/apps/server/prisma/schema.prisma)
- [apps/server/app/application/crm/workspace-business-table.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)
- [apps/server/app/application/collaboration/collaboration-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/collaboration-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/workspace-domain-sources.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/workspace-domain-sources.test.ts)
- [apps/server/test/collaboration/collaboration-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/collaboration-service.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-001-data-model.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
