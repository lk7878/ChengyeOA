---
id: MOD-002
title: 多维表格、云盘与配置
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-002 多维表格、云盘与配置

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 产品层级与真源

云盘工作区 → 文件夹/资源 → 多维表格应用（Base）→ 数据表 → 视图 → 记录/字段。文件夹不是部门；快捷方式是资源引用，不复制表和记录。业务应用和云盘打开同一 Base/Table ID。

| 表类别 | 数据来源 | 写入规则 |
|---|---|---|
| 普通自建表 | `CollabRecord.values`，键为字段ID | 表资源权限、行范围、字段能力、版本与模板校验 |
| 正式业务工作表 | `source` 对应客户、谈案、合同、案件、财务、SOP等领域表 | 查询通过领域适配器；修改调用领域服务，不另存一套业务行 |
| 标准行政/人事表 | `inventoryKind` 对应标准模板 | 普通记录存储叠加模板校验、敏感权限或聚合投影 |
| 售后/退费表 | `lifecycleKind` 标识 | 关联案件/售后数据并调用退费联动，不能任意覆盖同步字段 |

## 2. 表、字段和视图

- 数据表支持创建、重命名、排序、复制结构、归档/恢复和删除；归档与删除是不同操作。业务工作表删除不等价于批量删除底层客户、案件或合同。
- 标准模板清单见 [字段附录](../reference/STANDARD-FIELDS.md)，共48组、730个字段定义。模板是代码默认值，不断言每个已有表字段完全一致。
- 基础类型含文本、长文本、数字、金额、布尔、日期/时间、单/多选、人员、组织、电话、URL、附件、关联及系统生成字段。
- 当前 `VIEW_TYPES` 仅开放 `GRID`。总表、个人和共享视图可保存筛选、分组、排序、字段布局；可视化仪表盘的看板/甘特/画册组件不是新增了多维表格原生视图类型。
- 自动编号、创建/修改人、创建/修改时间由系统产生。自定义关联和模板引用有服务端权限限制；存在 `FORMULA` 类型不代表任意脚本或飞书公式兼容。
- 核心业务字段白名单、来源只读字段及领域状态优先于表格编辑开关。个人外观设置不改共享表字段和共享视图。

## 3. 日常操作与并发

1. 双击可编辑单元格，显示编辑控件和保存/取消；详情抽屉提供完整记录与业务办理入口。
2. 行操作结合记录 capabilities 展示编辑、删除、详情或办理；新建入口按业务来源进入正式创建流程。
3. 批量粘贴有预览和原子校验，不允许部分脏数据悄悄落库；回收、恢复、撤销/重做按对应支持范围和版本检查执行。
4. `version` 与 `schemaVersion` 冲突必须显式报错。关联、唯一档号和模板必填也需在后端验证。
5. 协作事件合并刷新；普通表默认刷新调度间隔30秒，汇总模式使用1秒合并窗口；编辑或页面隐藏时继续排队。安全撤权事件不能被延迟策略绕过。调度是事件触发合并，不是承诺所有页面每30秒轮询。
6. 页面保留当前输入，通知轮询不能使编辑器重新挂载。手动刷新、保存后的更新与后台协作更新区别处理。

## 4. 共享、回收站及评论

- 工作区、文件夹、应用、表有继承和显式授权；主体支持账号、角色、岗位、组织、团队。行范围、隐藏字段、只读字段及分享管理能力分别计算。
- 正式表资源共享不能放大业务数据范围。给 lmj 或任意新账号授予表读写后，仍须有相应 `case.read/update` 等动作和记录范围。
- 文件夹移动、归档、回收、恢复影响访问；永久删除必须走相应生命周期操作，不通过隐藏菜单假装删除。
- 评论绑定 tableId+recordId，支持正式业务行；有权读记录才可读评论和选择@对象。仅作者修改/删除自己的评论，版本冲突受控；@对象必须仍有权读取该行。
- 评论提醒不会自动授予收件人表权限；打开深链接再次鉴权。

## 5. 验收要求与边界

同一记录从业务模块、云盘、个人视图、管理员/授权成员打开时ID一致；编辑授权字段后重新查询可见一致结果；只读账号不能通过直接接口写入。归档/删除表、删行和删除业务记录分别验证。保留公式未确定的只读字段，不以编造计算值满足展示。

通用配置中心的全量字典发布、任意自动化规则、任意类型迁移、完整文档协作及飞书生态兼容不因基础表格实现而视为全部交付。

## 实现与回归入口

- [apps/server/app/application/collaboration/collaboration-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/collaboration-service.ts)
- [apps/server/app/application/crm/workspace-business-table.ts](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)
- [apps/server/app/application/collaboration/collaboration-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/collaboration-policy.ts)
- [apps/server/app/application/collaboration/drive-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/drive-service.ts)
- [apps/server/app/application/collaboration/row-comments.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/row-comments.ts)
- [apps/web/src/features/workspaces/GridCell.tsx](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/GridCell.tsx)
- [apps/web/src/features/workspaces/refresh-scheduler.ts](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/refresh-scheduler.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/module-sharing.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/module-sharing.test.ts)
- [apps/server/test/collaboration/workspace-business-actions.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/workspace-business-actions.test.ts)
- [apps/server/test/collaboration/drive-lifecycle.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/drive-lifecycle.test.ts)
- [apps/server/test/collaboration/comments-calendar.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/comments-calendar.test.ts)
- [apps/web/src/features/workspaces/refresh-scheduler.test.ts](../../../LayerManage/law-firm-system/apps/web/src/features/workspaces/refresh-scheduler.test.ts)

## 历史需求追溯

历史编号保留：`CFG-01`、`CFG-02`、`CFG-03`、`CFG-04`、`CFG-05`、`CFG-06`、`CFG-07`、`CFG-08`、`CFG-09`、`CFG-10`、`CFG-11`、`CFG-12`、`CFG-13`、`CFG-14`、`CFG-15`、`CFG-16`、`CFG-17`、`CFG-18`、`CFG-19`、`CFG-20`、`CFG-21`、`CFG-22`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-002-system-config-center.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
