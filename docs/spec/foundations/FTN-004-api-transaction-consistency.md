---
id: FTN-004
title: 接口、事务、版本与错误
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-004 接口、事务、版本与错误

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 接口基线

当前路由注册清单见 [HTTP API](../reference/HTTP-API.md)，来自app/router.ts共408项，包含退役兼容入口。路由存在不等于允许匿名调用，认证中间件及controller/service继续施加动作与数据范围。

API前缀 `/api/v1`；认证采用Bearer token及服务端会话验证。白名单公共路径见安全模块，不能凭是否显式requirePermission推断公开。当前错误返回形状按各控制器/统一errorHandler，不宣称所有历史接口完全同一响应结构。

## 2. 写入契约

- 输入按服务白名单、类型、长度、必填、关联与枚举校验；未知字段不能借通用JSON写入受保护属性。
- version保证记录并发，schemaVersion保证表结构一致；冲突不静默覆盖，保留用户输入。
- 具备幂等要求的命令校验key及请求内容，重复key不能代表不同请求；不是所有GET/写接口无差别要求同一header。
- 状态改变、关联更新、审计和应持久化事件在业务事务内执行；跨外部系统操作由持久化投递处理，不声称分布式原子提交。
- 表格正式来源写入委派领域服务；记录删除、恢复、批量粘贴和唯一字段均按各自锁/版本策略。
- 售后退款通过sourceRecordId唯一关联正式申请，防止重试造成重复业务单据。

## 3. 审批事务例外必须可观察

审批通过后的表格回写使用保存点。回写失败可以保留“审批已通过”，同时同步状态FAILED及错误原因；这不是审批事务回滚成功。重试重新鉴权并核对版本，不能直接强写。

分析单组件的多页读取及连接使用一致性快照；数据量超限明确报错，不以分页前200行算全部总额。

## 4. 错误与UI反馈

401为身份失效；403为无权；部分敏感资源采用404隐藏；409用于冲突/状态不满足；422用于字段/结构校验；旧审批入口410。具体code/message以源错误类为准，不把所有业务错误改写为“资源不存在”。

流程错误含basic/form/flow/settings位置及field/node/edge标识；用户可定位缺项。表格字段错误应关联字段ID；保存失败保持编辑内容，成功后重查同一ID。

## 5. 验收要求

重复保存、过期版本、被撤权限、已删除关联、未知字段、财务终态和审批同步失败均有回归场景。文档变更不触发数据库重置或业务数据导入。API附录只描述注册，不替代逐接口请求结构和服务规则。

## 实现与回归入口

- [apps/server/app/router.ts](../../../LayerManage/law-firm-system/apps/server/app/router.ts)
- [apps/server/app/middleware/auth.ts](../../../LayerManage/law-firm-system/apps/server/app/middleware/auth.ts)
- [apps/server/app/middleware/errorHandler.ts](../../../LayerManage/law-firm-system/apps/server/app/middleware/errorHandler.ts)
- [apps/server/app/application/collaboration/collaboration-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/collaboration-service.ts)
- [apps/server/app/application/workflow/workflow-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/workflow/workflow-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/collaboration-http.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/collaboration-http.test.ts)
- [apps/server/test/app/authorization-api.test.ts](../../../LayerManage/law-firm-system/apps/server/test/app/authorization-api.test.ts)
- [apps/server/test/app/analytics-api.test.ts](../../../LayerManage/law-firm-system/apps/server/test/app/analytics-api.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-004-api-transaction-consistency.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
