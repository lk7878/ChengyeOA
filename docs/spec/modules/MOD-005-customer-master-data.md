---
id: MOD-005
title: 客户主数据模块
source: PRD §8.5
status: draft
implements: SPEC-009（已验收 2026-07-30；覆盖 CUS-01~02，CUS-03~05 下推）
design_refs: [docs/专项设计/页面与接口清单.md]
last_updated: 2026-09-14
---

# MOD-005 客户主数据模块

案件新建往返客户管理、预填姓名及创建后自动选中客户，遵循 [SPEC-CASE-20260914](../../superpowers/specs/2026-09-14-case-management-extension.md)。

新建客户电话必填标识与校验已按 [SPEC-CASE-CRUD-20260914](../../superpowers/specs/2026-09-14-case-management-crud.md) 完成。

客户列表查询、修改与受业务关联保护的软删除，遵循 [SPEC-CUSTOMER-CRUD-20260914](../../superpowers/specs/2026-09-14-customer-management-crud.md)，[实施验证](../../superpowers/plans/2026-09-14-customer-management-crud.md)。

## 1. 需求概述

客户主数据模块负责律所全部客户的唯一客户主档维护，覆盖客户档案、联系人、转介绍关系、重复客户去重合并与客户全景视图，为线索、合同、收款、案件、满意度等下游业务模块提供统一的客户数据源。

## 2. 功能清单
| 编号 | 功能 | 需求 | 现状 |
|---|---|---|---|
| CUS-01 | 客户档案 | 支持客户基础信息、客户来源、标签、风险提示 | ✅（SPEC-009 验收） |
| CUS-02 | 联系人 | 支持一客户多联系人、关系、联系电话、微信 | ✅（SPEC-009 验收 + C1 增量 GET 列表端点） |
| CUS-03 | 转介绍关系 | 记录转介绍人、被介绍客户、转介绍成交情况 | 待补SPEC（下推） |
| CUS-04 | 去重合并 | 支持重复客户提示和合并审批 | 待补SPEC（权限码 customer.merge 已注册占位） |
| CUS-05 | 客户全景 | 展示线索、跟进、合同、收款、案件、满意度、复盘、转介绍 | 待补SPEC（依赖合同/案件对象） |

### 多维工作区接入（2026-09-14，待实施）

客户主数据通过 [SPEC-COLLAB-20260914](../../superpowers/specs/2026-09-14-feishu-aligned-collaborative-workspace.md) 的业务表适配器接入统一表格工作区；既有 ID、数据范围、去重/关联、状态流转、审计和事务不变。总表、个人与共享视图读取同源记录，通用表格操作不得绕过领域命令。新建业务表能力同时支持空白自建数据源，不能只做本模块固定页面换肤。接入验证以新规格 AC-03/05/06/07/12 为准，历史业务验收不表示适配器已实现。

## 3. 业务规则

1. 客户合并必须审批或二次确认。
2. 合并后线索、合同、案件、联系人、满意度等关联迁移必须保持一致。
3. 客户删除默认软删除。

## 4. 数据对象

核心数据对象：`Customer`。

SPEC-009 计划 +Contact，见 FTN-001。

## 5. 状态机

客户合并涉及合并审批状态（申请/审核/通过/驳回/已合并），具体状态机定义见 FTN-002。

## 6. 验收要求

- 唯一客户主档：任一客户均具备唯一客户主档，重复客户可识别、合并并保留原始关联映射。（源自 §3.3.2）
- 主数据验收：客户必须验证唯一数据源，消费模块不得绕过主模块直接修改。（源自 §14.1.11）
- 事务验收：客户合并必须验证客户、联系人、线索、合同、案件关联迁移同事务并审计后的一致性。（源自 §12.2、§14.1.5）
- 接口验收：参数校验、权限校验、数据范围、分页、错误码、审计记录。（源自 §14.1.2）

## 7. 追溯
- 专项设计: docs/专项设计/页面与接口清单.md；docs/superpowers/specs/2026-07-28-lead-crm-customer-master-data-design.md（SPEC-009 设计，已批准）
- 落地 SPEC: SPEC-009（CUS-01~02，2026-07-30 本地验收，终审 READY；CUS-03~05 下推至后续 SPEC）
- 主要代码: apps/server/app/application/crm/customer-service.ts、apps/server/app/controller/customer.ts、model Customer/Contact
- 测试: apps/server/test/crm/customer-service.test.ts、apps/server/test/app/customer-api.test.ts

<!-- 现状列取值：已实现(✅)/待开发(⬜)/待补SPEC(⚠️)/有设计无SPEC(📋)，与 TRACE.md 图例一一对应 -->


### 全站统一迁移（U0/U1，2026-09-15）

客户列表和详情进入业务应用的客户经营，旧 Customer ID、唯一性和关联保持；统一视图与正式业务动作在 U5 细化。完整路由、权限和阶段边界见[统一框架契约](../../superpowers/specs/2026-09-15-unified-navigation-contract.md)。本批框架纳入不代表本模块业务深度整合已经完成。


### U5-A 客户共同工作表（2026-09-15）

/customers 使用 CUSTOMERS 正式来源与共同 WorkspaceEditor：总表/个人视图、配置字段和查询、扩展字段、记录抽屉及原客户详情/联系人/转介绍动作沿用同一 Customer ID。新建客户独立入口保留从案件返回并继续草稿的语义。电话/微信复用客户字段投影与审计；读取取原领域范围、工作区组织和资源创建人范围的交集。无来源客户的组织匹配及权限边界详见[U5–U7 契约](../../superpowers/specs/2026-09-15-u5-u7-business-unification.md)。本次不把历史客户合并能力计为已实现；阶段验证记录见全站计划第 8 节。
