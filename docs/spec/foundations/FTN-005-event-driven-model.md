---
id: FTN-005
title: 事件、协作更新与后台任务
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-005 事件、协作更新与后台任务

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 分清三类机制

| 机制 | 职责 | 失败处理 |
|---|---|---|
| 业务Outbox/Delivery | 业务事务追加事件，注册订阅处理、投递、幂等和运行状态 | 重试、租约、失败日志和人工处理；由事件开关配置 |
| 工作表协作更新 | 业务/表格保存后的通知、在线成员、变更拉取和权限失效 | 前端合并普通刷新；版本冲突保护输入；安全事件不延迟 |
| 独立计划任务 | 可视化审批超时/Webhook、协同日历到时提醒 | 各自任务扫描、持久化去重和失败处理，不等同于通用Outbox已开启 |

## 2. Outbox契约

事件类型、版本与handler由注册表约束；未注册事件/handler不自动执行任意业务脚本。事件写入与业务状态事务一致，处理端使用日志/幂等防重复。租约、退避和服务降级有运行状态，不能因为API仍可访问就认定事件全部投递完成。

事件payload安全摘要与完整业务数据分开；权限变化后的读取依然鉴权。历史PRD列出的全量事件名称不是当前已注册清单，实际以订阅目录、factory及handler registry为准。

## 3. 可视化自动化接口

只允许服务端WORKFLOW_WEBHOOKS配置的具名HTTPS目的地址，禁止含URL凭据；使用HMAC签名、投递ID、时间戳、受限body和超时，不跟随重定向。UI不暴露密钥。部署未配置目的地址时不宣称已对接外部系统。

## 4. 刷新与提醒

工作表普通变更采用合并调度，默认30秒并检查编辑暂停；与主动保存、手动刷新及授权失效分开。未读通知轮询是通知机制，不能触发全表反复加载导致草稿丢失。

日历后台约30秒扫描，持久化提醒节点及去重，向所有者及已接受成员通知；可视化审批任务约每分钟扫描。两者独立调度，不能把EVENT_WORKER_ENABLED误当总开关。测试环境按任务配置禁用自动扫描，避免污染测试。

## 5. 验收要求

业务事务回滚不留下成功事件；重复投递不重复处理；权限失效后不能订阅/拉取受限数据。进程重启可从持久状态恢复，提醒不会因重新进入页面重复创建。运行健康、投递积压与前端访问成功应分别记录。

## 实现与回归入口

- [apps/server/app/application/events/event-handler-registry.ts](../../../LayerManage/law-firm-system/apps/server/app/application/events/event-handler-registry.ts)
- [apps/server/app/application/events/event-services-factory.ts](../../../LayerManage/law-firm-system/apps/server/app/application/events/event-services-factory.ts)
- [apps/server/app/application/events/event-worker.ts](../../../LayerManage/law-firm-system/apps/server/app/application/events/event-worker.ts)
- [apps/server/app/application/workflow/workflow-worker.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/workflow-worker.ts)
- [apps/server/app/schedule/workflow.ts](../../../LayerManage/law-firm-system/apps/server/app/schedule/workflow.ts)
- [apps/server/app/schedule/calendar.ts](../../../LayerManage/law-firm-system/apps/server/app/schedule/calendar.ts)
- [apps/web/src/features/workspaces/refresh-scheduler.ts](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/refresh-scheduler.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/comments-calendar.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/comments-calendar.test.ts)
- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)
- [apps/web/src/features/workspaces/refresh-scheduler.test.ts](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/refresh-scheduler.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-005-event-driven-model.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
