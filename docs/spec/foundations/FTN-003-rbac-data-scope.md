---
id: FTN-003
title: 权限、数据范围与共享交集
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-003 权限、数据范围与共享交集

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 授权模型

权限目录199项，类型MENU/ACTION/SPECIAL；完整代码、资源、风险见 [权限清单](../reference/PERMISSIONS.md)。角色是权限集合，不以“合伙人/律师/财务”等显示名硬编码全权。账号拥有某角色还需角色启用、任期有效、未撤销；临时授权亦检查有效期。

数据范围类型 ALL、HQ_SCOPE、ORG、BRANCH、TEAM、SELF_AND_SUBORDINATES、SELF、CUSTOM。组织路径、员工任职、汇报线和团队成员影响范围解析。多个有效范围按领域解析组合；无有效范围不能回落到全库。

## 2. 表格授权交集

```text
有效登录与账号状态
  ∩ 业务动作权限 + 业务记录范围
  ∩ 工作区/文件夹/Base/Table访问及行限制
  ∩ 字段可读/可写策略
  ∩ 业务状态、版本和特殊安全校验
  = 本次请求允许的操作
```

普通自建表没有强行套用不存在的领域记录，但仍有资源、行、字段、模板和动作能力。工作表正式来源必须同时满足领域范围；共享给普通账号不能授予所有管理员数据。

## 3. 主体、行和字段

资源主体支持USER/ROLE/POSITION/ORG/TEAM；READER/EDITOR/MANAGER/OWNER资源等级与canCreate、canManageAccess、SELF/ALL行范围、hiddenFields、readonlyFields分别计算。父文件夹继承及资源显式授权不能绕过已删除/归档边界。显式DENY或restricted且无匹配grant时拒绝；一般子资源授权按父级能力收窄，OWNER有明确所有者路径，不从超管标志直接推导所有权。

字段读取级别NONE/MASKED/READ。字段隐藏应从投影移除，不能只在UI隐藏；脱敏字段不得参与未经允许的原值筛选/排序推断。编辑需要可读原值及写权，不能把掩码写回。HR敏感字段另有专门权限。

## 4. 普通账号读写一致性

创建人字段保存User ID；SELF/下属范围来源常为Employee ID，必须经有效绑定映射。客户可能无sourceLead，合同/谈案可能无branchId，按实际服务补充创建人组织分支，而不是把空组织视为全局共享。

列表、详情、工作表、关联候选、导出、统计、评论@、审批回写都重新校验。共享仪表盘只共享配置；每个访问者在自身权限内查询两侧关联表，禁止通过聚合越权。

## 5. 撤权与受保护对象

撤权/停用/删除/凭证变化使相应会话或授权失效；编辑暂停刷新不能推迟服务端鉴权。初始化超管和根组织按初始化记录身份保护；其他管理员账号不是永久不可删除。

审批决定权限不替代业务写权。回写按发起人当前权限重载；SOP/专项分析保留禁止自审；高风险操作按step-up规则执行。

## 6. 验收矩阵

至少覆盖管理员、同范围编辑者、只读者、无范围用户，以及账号禁用/撤权。同一业务ID在同范围用户间同步，字段输出可因敏感策略不同；无范围请求拒绝或隐藏为404，不泄露存在性。直接API请求需与UI按钮约束一致。

## 实现与回归入口

- [apps/server/app/domain/authorization/authorization-types.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/authorization/authorization-types.ts)
- [apps/server/app/application/authorization/data-scope-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/authorization/data-scope-service.ts)
- [apps/server/app/application/authorization/field-projection-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/authorization/field-projection-service.ts)
- [apps/server/app/application/contract/contract-scope.ts](../../../LayerManage/law-firm-system/apps/server/app/application/contract/contract-scope.ts)
- [apps/server/app/application/collaboration/resource-access.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/resource-access.ts)
- [apps/server/app/application/collaboration/analytics-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/analytics-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/authorization/authorization-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/authorization/authorization-service.test.ts)
- [apps/server/test/collaboration/module-sharing.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/module-sharing.test.ts)
- [apps/server/test/collaboration/new-account-business.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/new-account-business.test.ts)
- [apps/server/test/collaboration/analytics.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/analytics.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-003-rbac-data-scope.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
