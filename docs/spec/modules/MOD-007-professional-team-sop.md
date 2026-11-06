---
id: MOD-007
title: 专业团队SOP及成果审核
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-007 专业团队SOP及成果审核

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 现行能力

SOP模板、模板节点与材料要求、案件SOP实例、节点任务、成果提交、专家/一级审核及质检来源保持同一业务链。医疗、执行、刑事专业模板由受控内容定义，不能由审批画布任意替代领域必填材料。

模板维护与案件执行分离；模板变更不应静默改写已经执行的实例。任务工作表 `SOP_TASKS` 显示正式节点任务，案件详情与任务办理引用同一ID。

## 2. 可视化审批接续

- SOP成果审核以 `SOP_REVIEW` 业务类型接入 WorkflowInstance/WorkflowTask。
- 由原业务提交服务发起受管审批，保留材料、当前任务、审查资格、禁止自审及版本校验。
- 受管审批仅允许其业务支持的 READ/APPROVE/REJECT/WITHDRAW；不能通过通用转办、加签、退回或修改原申请绕过业务规则。
- 通过、拒绝和撤回后由专用适配器同步原SOP审核及任务状态；通用自建表回写不是该结果的唯一来源。
- 审批页面迁移到可视化，不代表可删除原业务检查和历史材料。

## 3. 权限和可追溯性

SOP模板管理、执行、成果提交、审核分别授权；任务范围还依赖案件访问与人员任职。附件、成果、审核意见和事件保留操作者及时间；只显示有权查看的材料。专业团队的成员变动不自动重写旧审批快照。

## 4. 验收要求与边界

缺少必需材料不可提交；申请人不能审批自己的受管成果；无当前处理任务的用户不能决定审批。审批成功后案件节点与工作表同步，重复请求不重复完成任务。专用文书模板库、模拟法庭等历史规划不因通用SOP已有实现而宣告全部交付。

## 实现与回归入口

- [apps/server/app/application/sop/template-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/sop/template-service.ts)
- [apps/server/app/application/sop/review-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/sop/review-policy.ts)
- [apps/server/app/application/workflow/managed-reviews.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/managed-reviews.ts)
- [apps/server/app/domain/sop/template-content.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/sop/template-content.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/sop/template-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/sop/template-service.test.ts)
- [apps/server/test/sop/submission-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/sop/submission-service.test.ts)
- [apps/server/test/sop/execution-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/sop/execution-service.test.ts)
- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-007-professional-team-sop.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
