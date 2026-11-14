---
id: FTN-007
title: 运行、安全、交互与验证边界
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-007 运行、安全、交互与验证边界

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 技术与运行基线

应用根为LayerManage/law-firm-system；Node要求>=22.14且<23，后端Egg/TypeScript、Prisma5/PostgreSQL16，前端React/TypeScript/Vite/Ant Design，具体依赖版本以各package及lockfile为准。不要把显示版本、package版本和Git提交号混为发布标识。

本地前端惯用3000、后端7001；PostgreSQL端口由compose/环境配置决定，不写死开发者口令。已有环境仅启动依赖及服务，不重新bootstrap或清空数据。测试数据库必须与业务库隔离，重置要求_test目标和显式guard。

## 2. 安全与一致性

认证会话、凭证版本、失效/撤销、MFA及step-up维持服务端约束。LOCAL_PASSWORD_LOGIN只允许受约束本地开发，不等于生产免MFA。任何文档不记录真实口令、连接串凭据、签名密钥、验证码或恢复材料。

字段脱敏、资源隐藏、范围过滤、附件鉴权和审计适用于API、表格、导出、图表、评论和审批回写。前端隐藏菜单不能代替后端授权。

## 3. 编辑体验与个人偏好

表格双击编辑有保存/取消，刷新不覆盖活动输入。共享弹窗基础能力、错误定位、加载/失败状态按当前组件实现，不承诺外部浏览器所有对话框均可拖动。

外观设置按账号保存：字号标准14/大16/特大18，背景默认/米色/绿色，行高紧凑32/标准40/舒适64并结合字号调整。先预览/暂存，保存才持久化；取消不改变已保存偏好，恢复默认仍需保存。切换外观不能重挂业务表单导致输入丢失，也不修改共享视图布局。

## 4. 资源上限与性能证据

分析最多30组件、每来源/关联展开最多10,000行；普通查询分页与批量粘贴另有上限。超限返回明确错误，不静默截断统计。历史局部负载报告只适用于当时场景，不据此宣称本版本全站承载或生产SLA。

## 5. 验证与发布

用户已确认当前功能人工测试完成。本次变更只对齐文档，验证链接、源码清单、差异及机密泄漏；不伪造全量自动化重跑结果。代码变更时按影响范围执行lint/typecheck/单测/构建和项目verify要求。

生产云端部署、跨机器数据恢复、独立Windows安装和自动更新、第三方AI/消息服务仍需各自环境证据。本地网页可启动、单测通过或用户人工验收不能替代这些发布门禁。

## 实现与回归入口

- [package.json](../../../LayerManage/law-firm-system/package.json)
- [apps/server/config/config.default.ts](../../../LayerManage/law-firm-system/apps/server/config/config.default.ts)
- [apps/server/config/env.ts](../../../LayerManage/law-firm-system/apps/server/config/env.ts)
- [apps/web/src/features/appearance/AppearanceProvider.tsx](../../../LayerManage/law-firm-system/apps/web/src/features/appearance/AppearanceProvider.tsx)
- [apps/server/app/application/collaboration/analytics-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/analytics-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/auth/session-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/auth/session-service.test.ts)
- [apps/web/src/features/workspaces/GridCell.test.tsx](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/GridCell.test.tsx)
- [apps/web/src/pages/AnalyticsDesigner/AnalyticsDesigner.test.tsx](../../../LayerManage/law-firm-system/apps/web/src/pages/AnalyticsDesigner/AnalyticsDesigner.test.tsx)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-007-non-functional-requirements.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
