---
id: MOD-013
title: 可视化审批、通知、日历与审计
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-013 可视化审批、通知、日历与审计

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 审批模式统一

审批中心 `/approvals` 直接承载可视化审批；`/approvals/visual` 是兼容重定向，不再嵌套两套审批模式。旧 `/api/v1/approvals` 定义/实例操作及旧台账/同步规则入口返回410；当前流程接口使用 `/api/v1/workflows`。保留旧表或旧服务文件不等于旧模式仍开放。

## 2. 四步流程配置

1. 基础信息：名称（去空白后1–100字符）、分组、说明、提交范围。
2. 表单：文本、长文本、数字、日期、单/多选、附件、人员、业务关联、明细、金额大写和受控公式；拖入、复制、排序、删除、预览。
3. 流程：START、APPROVAL、CC、BRANCH、END；竖向节点插入及高级连线；会签ALL、或签ANY、依次SEQUENTIAL；节点字段和角色字段权限。
4. 更多设置：撤回、更正、摘要、打印、表格回写、允许的自动化接口。

草稿与发布区分，每次发布产生新版本，实例固化完整快照。保存失败返回具体板块及字段/节点/连线定位，保留输入；不能只用“内容为空或过长”笼统替代所有错误。

## 3. 人员、抄送与流转

审批人员来源 USER、ROLE、MANAGER、SUPERVISOR、SELECT、FIELD、SELF。角色按有效任期解析、员工及账号必须有效；缺少有效处理人不静默跳过。

CC支持多个 `ccRules` 来源组，合并去重；不是只能选一个抄送人。表单权限 EDIT/READ/HIDDEN，多角色限制按隐藏优先、只读其次，计算字段只读。

条件支持比较、包含、非空和明细求和，组内AND/组间OR。分支按优先级/连线顺序命中，唯一默认路径；不允许图中环。退回为受控动作。转办、加签、撤回、更正、同人跳过和超时均受发布配置及当前任务校验。

## 4. 回写和更正

审批通过和同步结果是两个状态。回写使用重新加载的发起人权限；校验表结构及目标记录版本，普通表可CREATE，正式表更新已有业务记录。附件、人员、日期和选项按目标类型转换。

冲突或权限失效时保留“已通过/同步失败”，不覆盖新数据；可按允许流程重试。已通过申请更正生成关联的新申请，原单及历史只读；重审通过才写同一目标记录。SOP_REVIEW、QUALITY_ANALYSIS使用受管业务适配，保留禁止自审、材料校验及业务回写，不开放通用动作绕过。

## 5. 评论提醒与协同日历

- 工作表评论支持@多个有权读取该行的用户，通知深链接到记录；收到提醒不自动获得访问权。
- `/calendar` 提供日/周/月事件、时间、可见范围、关联表记录和成员邀请。所有者编辑/取消，成员可接受/拒绝/暂定；时间变化要求重新应答。
- 默认提醒1天/1小时；可设至多10个提醒，范围0–28天。后台向所有者和已接受成员发送，持久化去重并支持错过扫描后的补发。
- 站内未读通知静默轮询，不刷新正在编辑的表格和审批表单。外部飞书/钉钉消息接入不是当前交付承诺。

## 6. 审计、自动化和验收

关键写入、授权、业务流转、评论、审批决定和同步结果记录审计。Outbox投递与可视化Webhook分开管理；仅运维配置的HTTPS目的地址可选，签名、超时、失败重试受服务控制。

验收覆盖草稿不发起、发布快照、抄送多组去重、必填定位、分支默认路径、并发决定、撤权、已通过更正、回写冲突、受管业务禁止自审、提醒去重和邀请隐私。完整边界见FTN-006；不宣称平行审批网关、手写签名或外部机器人全量兼容。

## 实现与回归入口

- [apps/server/app/domain/workflow/schema.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/workflow/schema.ts)
- [apps/server/app/application/workflow/workflow-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/workflow-service.ts)
- [apps/server/app/application/workflow/managed-reviews.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/managed-reviews.ts)
- [apps/server/app/controller/approval.ts](../../../LayerManage/law-firm-system/apps/server/app/controller/approval.ts)
- [apps/server/app/application/calendar/calendar-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/calendar/calendar-service.ts)
- [apps/server/app/application/collaboration/row-comments.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/row-comments.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)
- [apps/server/test/collaboration/comments-calendar.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/comments-calendar.test.ts)
- [apps/server/test/app/calendar-api.test.ts](../../../LayerManage/law-firm-system/apps/server/test/app/calendar-api.test.ts)

## 历史需求追溯

历史编号保留：`AUTO-01`、`AUTO-02`、`AUTO-03`、`AUTO-04`、`AUTO-05`、`AUTO-06`、`AUTO-07`、`AUTO-08`、`AUTO-09`、`AUTO-10`、`AUTO-11`、`AUTO-12`、`AUTO-13`、`AUTO-14`、`AUTO-15`、`AUTO-16`、`AUTO-17`、`AUTO-18`、`AUTO-19`、`COLLAB-01`、`APPR-01`、`APPR-02`、`APPR-03`、`APPR-04`、`NOTI-01`、`OUTBOX-01`、`AUDIT-01`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-013-automation-notification-approval-audit.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
