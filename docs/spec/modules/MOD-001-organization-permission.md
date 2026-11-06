---
id: MOD-001
title: 组织、账号、岗位与权限
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-001 组织、账号、岗位与权限

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 入口与对象

管理中心包含组织架构、岗位管理、员工与任职、专业团队、账号管理、角色权限、账号授权、管理员治理和身份安全。组织、员工、登录账号是不同对象；员工可有任职、汇报关系、团队成员关系，账号绑定员工不等于自动拥有业务权限。

## 2. 现行功能

| 范围 | 当前行为 | 约束 |
|---|---|---|
| 组织 | 树形维护、排序、负责人、复制组织结构及岗位 | 组织页面有超级管理员限制；根组织受初始化信任根保护 |
| 岗位 | 自定义编号、所属组织、级别、说明、启停与删除 | 删除要求 `position.delete` 及记录范围；版本校验后软删除，保留当前和历史任职关联 |
| 岗位汇总 | 可按所选组织包含下级查询 | 按组织路径、级别和编号排序；并非复制一份分所岗位至总所 |
| 专业团队 | 团队维护、成员加入/结束、负责人及删除 | 保留领域服务的引用检查和审计 |
| 账号 | 新建、绑定/解绑员工、角色授予、停用、重置密码、删除 | 账号生命周期与员工档案删除分开处理 |
| 角色 | 菜单、动作、特殊权限、数据范围、字段策略，启停与删除 | 系统信任根角色不可普通删除；角色名称不是授权依据 |
| 授权 | 用户角色任期、临时直接授权、权限来源查询 | 生效时间、失效时间、撤销和角色状态参与计算 |

删除岗位无需先移除历史任职，不是物理级联删除员工或任职记录。分所能看到和创建哪些岗位，取决于其动作权限与组织数据范围。

## 3. 账号删除和离职

1. 账号先禁用，再执行删除；不能删除当前登录账号。
2. 受保护的是 `SystemInitialization.superAdminUserId` 指定的初始化账号身份，不能仅凭用户名是否叫 `admin` 判断。其他管理员账号由超级管理员按生命周期规则处理。
3. 删除会设为 `DELETED`、解绑员工、撤销会话及有效授权，保留历史业务与审计。不是删掉所有该账号创建的数据。
4. 若指定资源接收账号，执行资源转交；该能力要求超级管理员，包含私人所有权资源，不能仅处理已共享资源。
5. 员工离职先查看未结案件、未完成线索、在任下属、部门负责人、团队负责人等阻塞清单，再移交、结束任职和办理删除。部门负责人可作为建议接收人，仍要验证有效账号。

## 4. 权限组合和验收要求

- 读取、新增、修改、删除各自授权；菜单可见不能作为 CRUD 已授权的证据。
- 新账号的员工ID与用户ID正确映射；本人范围的合同、谈案和客户创建后，详情、工作区列表及同源表结果一致。
- 普通用户只能看到获授范围；管理员与普通账号共享记录时显示同一业务ID，字段脱敏和写权限可不同。
- 撤权、停用、改密及删除后旧会话不可继续写入。
- 普通视图不得泄漏被隐藏字段；组织负责人设置本身不隐式赋予管理员身份。

## 实现与回归入口

- [apps/server/app/application/master-data/position-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/master-data/position-service.ts)
- [apps/server/app/application/master-data/employee-offboarding.ts](../../../LayerManage/law-firm-system/apps/server/app/application/master-data/employee-offboarding.ts)
- [apps/server/app/application/master-data/employee-resource-transfer.ts](../../../LayerManage/law-firm-system/apps/server/app/application/master-data/employee-resource-transfer.ts)
- [apps/server/app/application/system/retire-user.ts](../../../LayerManage/law-firm-system/apps/server/app/application/system/retire-user.ts)
- [apps/server/app/application/system/trust-root-guard.ts](../../../LayerManage/law-firm-system/apps/server/app/application/system/trust-root-guard.ts)
- [apps/server/app/application/authorization/role-authorization-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/authorization/role-authorization-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/master-data/oa-management-repair.test.ts](../../../LayerManage/law-firm-system/apps/server/test/master-data/oa-management-repair.test.ts)
- [apps/server/test/collaboration/new-account-business.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/new-account-business.test.ts)
- [apps/server/test/authorization/permission-trace-service.test.ts](../../../LayerManage/law-firm-system/apps/server/test/authorization/permission-trace-service.test.ts)

## 历史需求追溯

历史编号保留：`ORG-01`、`ORG-02`、`ORG-03`、`ORG-04`、`ORG-05`、`ORG-06`、`ORG-07`、`ORG-08`、`ORG-09`、`ORG-10`、`ORG-11`、`ORG-12`、`ORG-13`、`ORG-14`、`ORG-15`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-001-organization-permission.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
