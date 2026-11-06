---
id: MOD-009
title: 满意度、复购与转介绍边界
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-009 满意度、复购与转介绍边界

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 已有能力

案件百分制满意度入口 `/cases/:id/assessments` 为受控详情页；记录、历史更正、低分专项分析与质量指标属于已实现链路。旧星级记录不自动当作百分制分值转换。

CRM已有转介绍相关服务与回归覆盖，可保留来源关系；客户、谈案、合同关联能够承载后续签约，但不能把已有客户再次出现等同于已完成完整复购运营系统。

## 2. 权限和规则

百分制读取/记录分别使用 `quality.assessment.read/record` 并结合案件范围。专项分析及质量指标有独立权限；没有案件读权不能借统计入口读取该客户评价。历史修改保留更正记录，不能直接抹掉旧评价来改变质量指标。

低分处理以评估服务和事件处理器的实际策略为准，规格不自行发明新的阈值和自动关闭动作。专项关闭仍走受管可视化审批。

## 3. 尚非完整交付的历史目标

完整问卷设计、外部客户自主回填、全渠道满意度采集、复购营销任务、转介绍奖励结算及品牌素材自动发布，未凭当前证据确认为完整产品链，保留为历史目标。不能把普通多维表格配置能力当成这些专业功能的验收。

## 4. 验收要求

在权限范围内录入与查询百分制，检查历史更正及低分专项关系；无权案件不出现在统计/明细。转介绍关系保留来源且不跨权限暴露原客户。统计仅使用已确定口径，不混算星级与百分制。

## 实现与回归入口

- [apps/server/app/application/quality/assessment-handler.ts](../../../LayerManage/law-firm-system/apps/server/app/application/quality/assessment-handler.ts)
- [apps/server/app/application/quality/analysis-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/quality/analysis-service.ts)
- [apps/server/app/application/crm/lead-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/lead-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/quality/analysis-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/quality/analysis-service.test.ts)
- [apps/server/test/crm/referral-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/crm/referral-service.test.ts)

## 历史需求追溯

历史编号保留：`SAT-01`、`SAT-02`、`SAT-03`、`REF-01`、`REF-02`、`BRAND-01`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-009-satisfaction-repurchase-referral.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
