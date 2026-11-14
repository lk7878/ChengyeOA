---
id: FTN-002
title: 状态、字典与只读投影
type: foundation
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# FTN-002 状态、字典与只读投影

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 状态不是显示文本

数据库代码、中文标签、动作权限和合法转换分别定义。只有服务允许的动作能改变业务状态，不能通过表格把状态字段改成任意中文值。字符串状态字段不代表无枚举约束，Prisma也不是唯一状态规则来源。

## 2. 当前关键状态

| 对象 | 状态/流转口径 |
|---|---|
| 账号 | ENABLED、DISABLED、DELETED；删除前需禁用并保护初始化信任根 |
| 线索 | NEW/ASSIGNED/CONTACTED/SCREENED/INVITED/VISITED/CONVERTED/LOST/NURTURE |
| 线索池 | PUBLIC/PRIVATE/RECYCLED，与线索业务状态正交 |
| 邀约 | PENDING/CONFIRMED/VISITED/NOSHOW/CANCELLED/RESCHEDULED |
| 合同 | DRAFT→PENDING_APPROVAL→PENDING_SIGN→SIGNED→EFFECTIVE；驳回回DRAFT，指定状态可VOID或TERMINATED；类型决定审批/应收差异 |
| 开票 | PENDING→APPROVED→COMPLETED，PENDING可REJECTED |
| 退费 | PENDING→APPROVED→EXECUTED，PENDING可REJECTED；通过不等于已打款 |
| 可视化申请 | PENDING、APPROVED、REJECTED、WITHDRAWN；同步状态独立记录 |
| 审批任务 | PENDING/WAITING/APPROVED/AUTO_APPROVED/REJECTED/RETURNED/FORWARDED/SKIPPED/CANCELLED及CC等执行标记，不能当成实例状态 |
| 普通记录/表 | archived等生命周期标记与正式业务状态分离 |

## 3. 字段与业务操作边界

合同状态、已收金额、库存、评分/奖金、审批关联、创建/修改人时间等由来源服务维护。表格显示一个字段不保证可直接编辑；接口capabilities和业务可写白名单共同决定。

案件合同显示号为全库序列，正式合同编号为合同编号服务结果；两者不能互换。售后/退费“是否解除合同”当前为只读空值占位，等待规则，不按合同VOID/TERMINATED自动推导。未确定提成公式同样不得填假结果。

## 4. 字典边界

标准字段选项存在模板代码中，生成附录保留选项ID/名称和日期精度。普通表配置、审批表单选项、案件intake字典各有独立校验，不构成统一全局字典热发布系统。行政收发文的现有字段映射在MOD-011明确保留。

## 5. 验收要求

非法跨状态操作拒绝、终态保护、并发重复提交、审批通过但同步失败、退款实际执行与申请状态分别验证。自定义视图隐藏状态列不改变业务状态；改标签不改变数据库代码。只读投影不允许经API写回。

## 实现与回归入口

- [apps/server/app/domain/contract/contract-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/contract/contract-policy.ts)
- [apps/server/app/domain/finance/finance-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/finance/finance-policy.ts)
- [apps/server/app/domain/crm/lead-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/crm/lead-policy.ts)
- [apps/server/app/domain/workflow/schema.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/workflow/schema.ts)
- [apps/server/app/application/collaboration/lifecycle-worksheet.ts](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lifecycle-worksheet.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/crm/lead-policy.test.ts](../../../LayerManage/law-firm-system/apps/server/test/crm/lead-policy.test.ts)
- [apps/server/test/collaboration/lifecycle-worksheet.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/lifecycle-worksheet.test.ts)
- [apps/server/test/approval/visual-workflow.test.ts](../../../LayerManage/law-firm-system/apps/server/test/approval/visual-workflow.test.ts)

## 历史需求追溯

[对齐前原文](../history/2026-11-06-before-alignment/foundations/FTN-002-state-machine-dictionary.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
