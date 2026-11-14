---
id: MOD-006
title: 谈案、合同与财务
type: module
status: implemented-baseline
source_commit: dcf8447d
last_updated: 2026-11-06
---

# MOD-006 谈案、合同与财务

> 本文按当前代码对齐，定义现行实现。用户已确认功能人工测试完成；本轮为文档核对，不把已有测试文件视为本轮全部执行通过。适用范围及证据口径见 [总纲](../README.md)。

## 1. 正式来源与入口

谈案 NEGOTIATIONS、合同 CONTRACTS、收款 PAYMENTS、开票 INVOICES、退费 REFUNDS、成本 COSTS 均有正式来源适配。业务工作区直接显示授权正式记录，进入对应工作表仍读取同一记录；表名不同不代表需要手动复制。

## 2. 谈案与合同

| 功能 | 当前规则 |
|---|---|
| 谈案保存 | 修改谈案人、报价、客户顾虑、竞对和备注等允许字段；字段必填/有效人员由服务校验 |
| 谈案完结 | 更新原谈案结果及关联业务，不以在普通数据表新添一行为完结证据 |
| 合同创建 | 客户、合同类型、组织/团队及金额走正式创建服务，创建人身份按用户ID持久化 |
| 网格编辑 | 合同直接编辑 title、amount，仍受更新权限、记录范围和状态限制 |
| 合同删除 | 行删除调用领域规则；已流转及被引用记录不能被通用删行绕过 |
| 合同编号 | 业务编号服务生成类型/分所/团队/年度序列；与案件展示“合同ID”不同 |

合同类型 FIRST_SIGN、FORMAL、SUPPLEMENT、RISK_NOTICE。前三类要求审批并可产生应收，风险告知不产生应收、签署即事实终态。主状态 DRAFT → PENDING_APPROVAL → PENDING_SIGN → SIGNED → EFFECTIVE；驳回回草稿；终止/作废仅允许规定来源状态。合同领域审批动作与通用可视化申请不能混同。

## 3. 收款、开票、退费和成本

- 收款登记、确认及其金额投影是合同已收/待收和案件财务展示的来源；未经确认的金额不能计作确认回款。
- 开票申请 PENDING → APPROVED → COMPLETED，驳回进入 REJECTED。终态不能通过普通编辑重开。
- 退款申请 PENDING → APPROVED → EXECUTED，驳回进入 REJECTED；“审批通过”与“实际退费已执行”不同。实际金额、日期及凭证由执行业务维护。
- 售后/退费模板可关联正式 RefundRequest；按 sourceRecordId 定位，避免重复点击生成重复申请。回写到案件、售后、退费表时遵循来源关系和版本。
- 财务高风险操作保留动作授权及 step-up 身份校验；本地登录便利模式不代表全部退款确认免验证码。
- 成本按类别要求关联锚点：渠道成本需要渠道；取证/办案成本需要案件；人工/办公成本不接受案件/渠道锚点；报销类别有独立约束。
- 工资批次及审批与绩效另有服务，不能用普通表格编辑替代正式工资审批。

## 4. 权限与异常

合同/谈案组织为空的历史或直接创建记录，可通过创建人组织解析所属范围；SELF/下属范围须把员工映射到用户，不再把两种ID相互比较。发起人有创建权不自动意味着对其他分所全部记录有读权。关联客户、财务记录、表资源和字段权限仍分别校验。

金额采用数据库 Decimal 及领域金额转换，不能用界面浮点汇总替代财务真值。保存失败保留输入并展示具体原因；成功创建后详情404需检查范围解析，不通过放宽到全所解决。

## 5. 验收要求

同范围普通账号和超管创建/读取合同结果一致；表格修改名称/金额、取消编辑、行删除保护分别检查。完整客户→谈案→合同→案件→售后→退费链路保留关联ID；退费申请、审批、执行的金额及状态分别核对，重复请求不产生重复付款记录。

## 实现与回归入口

- [apps/server/app/application/contract/contract-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/contract/contract-service.ts)
- [apps/server/app/application/contract/negotiation-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/contract/negotiation-service.ts)
- [apps/server/app/application/contract/contract-scope.ts](../../../LayerManage/law-firm-system/apps/server/app/application/contract/contract-scope.ts)
- [apps/server/app/domain/contract/contract-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/contract/contract-policy.ts)
- [apps/server/app/domain/finance/finance-policy.ts](../../../LayerManage/law-firm-system/apps/server/app/domain/finance/finance-policy.ts)
- [apps/server/app/application/finance/worksheet-finance.ts](../../../LayerManage/law-firm-system/apps/server/app/application/finance/worksheet-finance.ts)
- [apps/server/app/application/finance/refund-service.ts](../../../LayerManage/law-firm-system/apps/server/app/application/finance/refund-service.ts)

以下为已有回归代码入口，执行状态见具体测试报告，而非本清单：

- [apps/server/test/collaboration/financial-workspace.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/financial-workspace.test.ts)
- [apps/server/test/collaboration/new-account-business.test.ts](../../../LayerManage/law-firm-system/apps/server/test/collaboration/new-account-business.test.ts)
- [apps/server/test/finance/refund-step-up.test.ts](../../../LayerManage/law-firm-system/apps/server/test/finance/refund-step-up.test.ts)

## 历史需求追溯

历史编号保留：`CON-01`、`CON-02`、`CON-03`、`CON-04`、`CON-05`、`CON-06`、`CON-07`、`FIN-01`、`FIN-02`、`FIN-03`、`FIN-04`、`FIN-05`。

[对齐前原文](../history/2026-11-06-before-alignment/modules/MOD-006-contract-finance.md)保留原需求、旧状态和历史工程链接。上述编号不是“全部已实现”的声明；当前边界以本文及 [差异清单](../CHANGES-2026-11-06.md) 为准。
