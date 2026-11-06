---
id: FTN-006
title: 可视化审批执行契约
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-006 可视化审批执行契约

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 引擎和权限

当前唯一用户审批入口使用Workflow系列对象，旧Approval路由返回410。`approval.read/apply/process/manage`分别覆盖读取、发起、处理当前任务和管理配置；manage不应被解释为任何业务记录可写。本人参与范围、管理范围和受管业务额外策略仍生效。

## 2. 定义和实例

流程草稿可修改，发布生成新版本；运行中实例固化schema快照。停用定义不抹除已有实例，草稿不能发起。提交范围ALL/SELECTED/NONE检查账号及有效角色；配置无效时错误定位到基础/表单/流程/设置板块。

表单字段上限80、节点80、连线160；单层明细最多200行；连续主管最多10层。节点START/APPROVAL/CC/BRANCH/END，流程不允许环，分支须唯一默认路径。条件组OR、组内AND，每路径最多20组、每组20项；顺序及priority决定优先。

人员来源支持指定成员、角色、部门负责人、主管、自选、表单联系人和本人。CC最多20个来源组、去重后最多100人；不凭截图假定用户组、表单部门等未实现来源存在。

## 3. 表单权限和决策

节点默认及角色覆盖中的HIDDEN优先于READ、READ优先于EDIT；计算字段始终只读。服务器验证必填、条件显示、类型、人员/关联和安全正则；任意代码公式不执行。

ALL/ANY/SEQUENTIAL分别会签、或签和依次；当前待办与任务状态决定是否可处理。驳回/退回必须原因；转办/加签/退回是否启用来自节点配置。修改或退回后不能复用旧的“同人跳过”结果。

超时默认不自动批准，仅显式配置才可提醒或同意；不能把缺少权限、材料或必填字段的申请自动放行。要求同意意见的节点不能配置超时自动同意。

## 4. 写回、失败重试和更正

binding由表ID、CREATE/UPDATE及字段映射组成。普通自建表可创建，正式业务表只能更新支持的已有记录；回写调用CollaborationService并重载发起人权限。货币、日期、人员/员工ID、选项及附件转换必须满足目标字段。

记录版本或结构版本变化、字段删除、权限撤销等可导致同步失败。实例保持通过及失败说明，允许的重试需核对当前版本；结构不兼容应重新申请。已通过内容不原地撤销覆盖，通过更正申请重新审批，关联原单与历史，回写同一目标记录；一条原单仅一个处理中或已通过后继更正。

SOP_REVIEW及QUALITY_ANALYSIS是受管审核：必须由原业务提交，禁止自审、材料完整、当前业务状态与资格仍校验；只开放其支持的读取/同意/拒绝/撤回。审批结束由专用syncManagedReview回写，不绕过领域服务。

## 5. 通知、打印与未开放能力

待办、抄送、流转及异常通知指向授权详情；打印仅包含当前可见且允许打印字段。附件下载再次鉴权。并行网关、独立办理节点、手写签名、代他人提交、批量审批、自定义打印模板及完整飞书API兼容未作为当前能力承诺。

## 6. 验收要求

发布快照、缺项定位、多来源CC去重、默认路径、会签/或签/依次、越权/自审拒绝、同步失败不丢审批、重试不重写新版本、更正不改原单、撤权附件不可下载均需覆盖。

## 实现与回归入口

- [apps/server/app/domain/workflow/schema.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/workflow/schema.ts)
- [apps/server/app/application/workflow/workflow-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/workflow-service.ts)
- [apps/server/app/application/workflow/managed-reviews.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/managed-reviews.ts)
- [apps/server/app/application/sop/review-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/sop/review-policy.ts)
- [apps/server/app/application/quality/analysis-review-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/quality/analysis-review-policy.ts)
- [apps/server/app/controller/approval.ts](../../../LayerManage/law-firm-system/apps/server/app/controller/approval.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)
- [apps/server/test/sop/submission-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/sop/submission-service.test.ts)
- [apps/server/test/quality/analysis-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/quality/analysis-service.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-006-approval-task-notification.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
