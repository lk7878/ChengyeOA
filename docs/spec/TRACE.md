# 当前实现追溯矩阵

基线：2026-11-06 / dcf8447d。各规格末尾列出源文件与已有回归入口；“有测试文件”不等同本轮执行通过。用户人工验收已确认，生产发布证据单列。

| 现行规格 | 追溯内容 |
|---|---|
| [MOD-001 组织、账号、岗位与权限](modules/MOD-001-organization-permission.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-002 多维表格、云盘与配置](modules/MOD-002-system-config-center.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-003 渠道与获客入口](modules/MOD-003-brand-acquisition.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-004 线索、跟进、公海与到访](modules/MOD-004-lead-crm.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-005 客户主数据](modules/MOD-005-customer-master-data.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-006 谈案、合同与财务](modules/MOD-006-contract-finance.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-007 专业团队SOP及成果审核](modules/MOD-007-professional-team-sop.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-008 案件、售后、退费、归档与质检](modules/MOD-008-case-delivery-qc.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-009 满意度、复购与转介绍边界](modules/MOD-009-satisfaction-repurchase-referral.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-010 文件、知识库与智慧办案](modules/MOD-010-ai-recording-file.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-011 综合行政、人力资源与库存](modules/MOD-011-organization-hr.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-012 经营分析、可视化仪表盘与领用统计](modules/MOD-012-management-dashboard.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [MOD-013 可视化审批、通知、日历与审计](modules/MOD-013-automation-notification-approval-audit.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-001 数据模型与业务真源](foundations/FTN-001-data-model.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-002 状态、字典与只读投影](foundations/FTN-002-state-machine-dictionary.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-003 权限、数据范围与共享交集](foundations/FTN-003-rbac-data-scope.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-004 接口、事务、版本与错误](foundations/FTN-004-api-transaction-consistency.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-005 事件、协作更新与后台任务](foundations/FTN-005-event-driven-model.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-006 可视化审批执行契约](foundations/FTN-006-approval-task-notification.md) | 已实现范围、约束、验收要求及代码/回归入口 |
| [FTN-007 运行、安全、交互与验证边界](foundations/FTN-007-non-functional-requirements.md) | 已实现范围、约束、验收要求及代码/回归入口 |

## 技术参考覆盖

| 参考 | 生成输入 | 静态规模 |
|---|---|---|
| [导航](reference/NAVIGATION.md) | navigation/catalog.ts，另核对App.tsx | 94项含详情/隐藏项 |
| [HTTP API](reference/HTTP-API.md) | server/app/router.ts | 408项含退役410 |
| [权限](reference/PERMISSIONS.md) | permission-catalog.ts | 199项 |
| [字段](reference/STANDARD-FIELDS.md) | 正式表、行政/人事、售后退费、辅助/客资模板函数 | 48组730定义 |
| [模型](reference/DATA-MODELS.md) | schema.prisma及migrations目录 | 125模型89迁移目录 |

## 历史对应

[旧TRACE](history/2026-11-06-before-alignment/TRACE.md)保留SPEC-001等历史工程编号、阶段和报告链接。[差异清单](CHANGES-2026-11-06.md)记录替代口径；不回写旧报告为2026-11-06通过。

## 继续开发时

业务改动更新对应MOD；跨模块授权、状态、回写、事件或数据结构同步FTN；重新生成reference并核对差异；补充有行为意义的回归；记录测试命令、环境和实际结果。未经新授权不重放历史清库或角色创建操作。
