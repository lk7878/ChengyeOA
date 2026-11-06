---
id: MOD-008
title: 案件、售后、退费、归档与质检
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-008 案件、售后、退费、归档与质检

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 案件工作表

CASES 来源由正式案件投影，按 CASE_FIELD_ORDER 排列。字段覆盖签约、客户、代理程序、收费约定、到款退款、律师与谈案人员、发票、材料及审计信息。详细字段逐项见 [标准字段](../reference/STANDARD-FIELDS.md)，领域服务另有必填和类型校验。

- 案件显示“合同ID”为 `Case.contractDisplayId` 全库唯一自增整数，小于1000补三位，超过后正常显示；不是合同UUID，也不是各分所分别从001重新编号。数据库序列不承诺删除/回滚后无空号。
- 合同业务编号、案件编号及内部关联ID分别保留，不以显示编号覆盖数据库关系。
- 双击允许字段可保存/取消；title、caseType、priority、lawyerId、fee和允许的 intake 字段由服务白名单决定。公式字段不能直接写入。
- 客户电话原值需客户字段权限；同步列、金额投影和状态操作不能通过自由文本编辑绕过。
- 初始材料、案件附件分类和归档材料保留授权下载；删除案件不得破坏财务和交付引用。

## 2. 公式与财务字段

`formulaMoney/formulaRatio/formulaNumber` 保留字段及只读语义。律师提成、管理费、质保金等尚未提供完整业务规则的字段不能编造公式。已有到款、退费、发票等专门投影按实际服务计算，不因为其他公式待定而停用。

## 3. 售后及退费链

AFTER_SALES 关联案件，CASE_REFUNDS 关联售后及对应案件。上游合同编号、客户、签约、案件类型、承办律师等同步字段由关联来源读取；处理情况、当事人诉求、原因、面谈和材料是各表独立内容。

“是否解除合同”在售后及退费表当前均为只读空值占位，等待用户补充规则；不把早期建议中的“终止/作废自动是”当作已经实现的规则。正式退费申请由联动服务建立/更新，审批和执行另受财务权限控制。退费表中的申请金额与实际退费金额不得混为同一字段。

## 4. 案卷归档与质量

| 模板/业务 | 当前规则 |
|---|---|
| CASE_ARCHIVE_REVIEW | 审理时间、合同编号、当事人、类型、问题、盖章归档、质保金签字及凭证 |
| CASE_ARCHIVE_REGISTER | 归档时间、编号、类型、档号、案由、当事人、律师、合同编号、盒号、柜号、备注 |
| CASE_ARCHIVE_OFFLINE | 不上传法网的登记模板，同类字段；不代表已实现法网自动上传 |
| 档号唯一 | 同一表有效记录内唯一，删除后可复用，恢复重新校验；不会自动改变合同或案件状态 |
| 二级抽检/整改 | 策略、批次、检查、问题、负责人、时限、材料、整改及复核分开记录 |
| 专项分析 | 资料、原因及改进记录；关闭审核以 QUALITY_ANALYSIS 接入可视化引擎 |

专项关闭保留禁止自审、材料校验、人员权限及业务状态回写，不能用通用审批跳过。满意度及低分来源见MOD-009。

## 5. 验收要求

管理员和获授案件读写的普通账号能看同一业务记录、修改同一允许字段；保存后按各自可见字段同步。无权限字段/状态被拒绝；刷新不抢占编辑。售后与退款引用链、财务实际支付结果、档号重复/恢复冲突、SOP/质检材料权限分别验证。

## 实现与回归入口

- [apps/server/app/application/case/intake-contract.ts](../../../LayerManage/law-firm-system/apps/server/app/application/case/intake-contract.ts)
- [apps/server/app/application/collaboration/case-grid-fields.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/case-grid-fields.ts)
- [apps/server/app/application/collaboration/lifecycle-worksheet.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lifecycle-worksheet.ts)
- [apps/server/app/application/collaboration/case-archive-worksheets.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/case-archive-worksheets.ts)
- [apps/server/app/application/quality/analysis-review-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/quality/analysis-review-policy.ts)
- [apps/server/app/application/workflow/managed-reviews.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/managed-reviews.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/lifecycle-worksheet.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/lifecycle-worksheet.test.ts)
- [apps/server/test/collaboration/case-archive-worksheets.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/case-archive-worksheets.test.ts)
- [apps/server/test/quality/quality-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/quality/quality-service.test.ts)
- [apps/server/test/quality/analysis-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/quality/analysis-service.test.ts)

## 历史需求追溯

历史编号保留：`MAT-01`、`MAT-01B`、`MAT-02`、`MAT-03`、`MAT-04`、`MAT-04A`、`MAT-04B`、`MAT-05`、`MAT-06`、`MAT-07`、`MAT-08`、`MAT-09`、`MAT-10`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-008-case-delivery-qc.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
