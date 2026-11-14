---
id: MOD-010
title: 文件、知识库与智慧办案
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-07
---

# MOD-010 文件、知识库与智慧办案

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 文件与业务材料

云盘资源生命周期、工作表附件、案件材料、SOP成果、审批附件分别有存储/授权入口；共享链接、图片预览和下载都不能绕过业务记录权限。文件的归档、回收、恢复和永久删除与业务表行删除不是同一操作。

审批附件有独立校验：PDF、PNG、JPEG、WebP、DOCX、XLSX，单文件不超过10MB；这不是所有模块统一的上传类型/大小，其他附件按各服务规则。审批回写附件生成目标表的受控附件引用，失败回滚并清理本次生成的临时文件。

## 2. 知识库及智慧办案架构边界

顶栏提供知识库和智慧办案授权入口。智慧办案现行方案为每账号私有服务器工作区：会话、材料和成果持久化在独立intelligence目录；模型由系统管理员统一配置并可测试连通性，凭据加密保存，普通获授权用户无需配置。旧浏览器测试资料按用户明确要求定向清理，导出入口已移除；桌面宿主统一打开网页版办案。具体权限、上传、模型与法律技能边界见 [服务器工作区规格](../reference/SMART-CASE-SERVER.md)。不改变OA正式业务数据或云盘共享规则。

当前规格不宣称所有外部模型、OCR、第三方服务均已配置可用；运行能力取决于本地/服务端配置及供应端。用户确认OA人工测试完成不等同于独立Windows安装包、自动更新、离线草稿同步和生产灾备验收。

## 3. 与历史规划的差异

- 录音上传和材料附件不等于实现全自动转写、事实抽取及合规归档流水线。
- 智慧办案已有工程入口不意味着任意AI输出可直接写正式案件字段或状态。
- 知识库入口不自动授予内容维护/删除权；外部Wiki部署与OA表权限分开管理。
- 飞书式界面借鉴不构成飞书API、机器人、文档协作或公式生态兼容声明。

## 4. 验收要求

可见附件与所属记录权限一致；私有所有权资源在授权离职交接中可转交；越权下载被拒绝。文件回收恢复、审批附件写回冲突、服务器智慧办案私有会话/材料隔离及旧资料不自动迁移分别验证。真实外部模型和OCR效果需独立环境验收记录。

## 实现与回归入口

- [apps/server/app/application/collaboration/drive-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/drive-service.ts)
- [apps/server/app/application/harness/harness-ticket-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/harness/harness-ticket-service.ts)
- [apps/server/app/application/workflow/workflow-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/workflow-service.ts)
- [apps/server/app/application/master-data/employee-resource-transfer.ts](../../../LayerManage/law-firm-system/apps/server/app/application/master-data/employee-resource-transfer.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/drive-lifecycle.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/drive-lifecycle.test.ts)
- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)

## 历史需求追溯

历史编号保留：`AI-01`、`AI-02`、`AI-03`、`AI-04`、`AI-05`、`AI-06`、`AI-07`、`AI-08`、`AI-09`、`AI-10`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-010-ai-recording-file.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
