---
id: MOD-003
title: 渠道与获客入口
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-003 渠道与获客入口

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 已有能力

渠道管理作为业务应用的客户经营入口，维护渠道编号、名称、类型、说明、成本、状态、所属组织及登记人；正式来源为 `CHANNELS`，工作表读取同一渠道业务数据。线索可关联渠道，成本域可登记渠道成本。

律师客资表使用 `LAWYER_PROSPECTS` 模板，24个标准字段，包含客资来源、联系方式、客户网名/姓名、地区、对话、跟进方式、标的范围、案件类型、价值等级、状态、预约、代理费、合同/材料附件等。代码提供两个命名模板，但名称不构成账号权限。

## 2. 写入与权限

- 渠道直接网格编辑白名单为名称、说明、成本、状态；编号、登记时间等不是任意文本修改项。
- 渠道读写按 `channel.*` 动作和数据范围处理；关联渠道不自动扩大对线索、客户、成本的读取权限。
- 客资表属于普通模板记录；“客户状态”标签不是正式线索或合同状态机，保存客资行不等于自动生成客户、谈案或合同。
- 客资联系方式默认脱敏展示，编辑能力和表共享范围决定原值访问；只读共享不能据此取得修改权。

## 3. 范围澄清

旧 PRD 提出的品牌内容生产、律师IP更新、直播运营、平台广告自动拉取、完整投放归因等，不因渠道表和客资模板存在就标记为完成。当前规范承诺已注册渠道业务及模板能力；外部平台自动接入需单独立项。

## 4. 验收要求

渠道列表与工作表引用同一ID，编辑可写字段后双方一致；停用状态和数据范围受后端约束。客资模板字段、默认脱敏、附件授权和只读时间字段正确，测试中不要求向初始表灌入真实客户资料。

## 实现与回归入口

- [apps/server/app/application/channel/channel-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/channel/channel-service.ts)
- [apps/server/app/application/collaboration/lawyer-prospect-template.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lawyer-prospect-template.ts)
- [apps/server/app/application/collaboration/business-grid-fields.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/business-grid-fields.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/lawyer-prospects.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/lawyer-prospects.test.ts)
- [apps/server/test/collaboration/workspace-domain-sources.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/workspace-domain-sources.test.ts)

## 历史需求追溯

历史编号保留：`MKT-01`、`MKT-02`、`MKT-03`、`MKT-04`、`MKT-05`、`MKT-06`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-003-brand-acquisition.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
