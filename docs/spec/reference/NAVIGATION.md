# 页面导航与菜单权限

> 2026-11-06 实现基线：dcf8447d。由 [export-current.ts](../tools/export-current.ts) 从源码生成；不是生产数据库数据或本轮测试报告。

来源：[源码](../../../LayerManage/law-firm-system/apps/web/src/features/navigation/catalog.ts)。下列为目录注册（含隐藏详情入口），最终路由挂载见 [源码](../../../LayerManage/law-firm-system/apps/web/src/App.tsx)；隐藏不等于无权限可直接访问。共享配置不替代服务端数据权限。

| 区域 | 分组 | 名称 | 路由 | 要求 | 特殊标记 |
|---|---|---|---|---|---|
| analytics | 自助分析 | 可视化仪表盘 | /analytics/dashboards | {"required":[],"anyOf":[]} | — |
| apps | 质量管理 | 百分制满意度 | /cases/:id/assessments | {"required":["quality.assessment.read","case.read"],"anyOf":[]} | 隐藏 |
| apps | 质量管理 | 专项分析 | /quality/special-analyses | {"required":["menu.quality","quality.analysis.read","case.read"],"anyOf":[]} | — |
| apps | 质量管理 | 专项分析办理 | /quality/special-analyses/:id | {"required":["quality.analysis.read","case.read"],"anyOf":[]} | 隐藏 |
| analytics | 业务指标 | 交付质量 | /analytics/quality | {"required":["quality.metric.read","case.read"],"anyOf":[]} | — |
| admin | 流程与质检配置 | 抽检策略 | /admin/quality-rules | {"required":["menu.quality","quality.sample.read"],"anyOf":[]} | — |
| apps | 质量管理 | 抽检批次 | /quality/runs | {"required":["menu.quality","quality.sample.read"],"anyOf":[]} | — |
| apps | 质量管理 | 抽检批次详情 | /quality/runs/:id | {"required":["quality.sample.read"],"anyOf":[]} | 隐藏 |
| apps | 质量管理 | 二级抽检 | /quality/reviews | {"required":["menu.quality","quality.inspection.read","case.read"],"anyOf":[]} | — |
| apps | 质量管理 | 二级检查办理 | /quality/reviews/:id | {"required":["quality.inspection.read","case.read"],"anyOf":[]} | 隐藏 |
| apps | 质量管理 | 质检整改 | /quality/issues | {"required":["menu.quality","quality.issue.read","case.read"],"anyOf":[]} | — |
| apps | 质量管理 | 整改办理 | /quality/issues/:id | {"required":["quality.issue.read","case.read"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | SOP成果修订 | /sop/submissions/:id | {"required":["sop.task.read","sop.report.read"],"anyOf":[]} | 隐藏 |
| apps | 案件交付 | SOP任务 | /sop/tasks | {"required":["menu.sop_tasks","sop.task.read"],"anyOf":[]} | — |
| apps | 案件交付 | SOP任务办理 | /sop/tasks/:id | {"required":["sop.task.read"],"anyOf":[]} | 隐藏 |
| apps | 案件交付 | 启动SOP | /sop/instances/new | {"required":["sop.instance.start"],"anyOf":[]} | 隐藏 |
| apps | 案件交付 | SOP流程 | /sop/instances/:id | {"required":["sop.instance.read"],"anyOf":[]} | 隐藏 |
| admin | 流程与质检配置 | SOP模板 | /admin/sop-templates | {"required":["menu.sop_templates","sop.template.read"],"anyOf":[]} | — |
| home | 常用 | 工作台 | / | {"required":[],"anyOf":[]} | — |
| drive | 资源 | 云盘 | /workspaces | {"required":[],"anyOf":[]} | — |
| apps | 全部应用 | 业务应用 | /apps | {"required":[],"anyOf":[]} | — |
| analytics | 全部分析 | 数据分析 | /analytics | {"required":[],"anyOf":[]} | — |
| admin | 全部管理 | 管理中心 | /admin | {"required":[],"anyOf":[]} | — |
| home | 待办与通知 | 审批中心 | /approvals | {"required":["approval.read"],"anyOf":[]} | — |
| home | 待办与通知 | 可视化审批 | /approvals/visual | {"required":["approval.read"],"anyOf":[]} | 隐藏 |
| home | 待办与通知 | 审批运行监控 | /approval-ledger | {"required":["approval.read"],"anyOf":[]} | 隐藏 |
| home | 待办与通知 | 通知中心 | /notifications | {"required":[],"anyOf":[]} | — |
| home | 待办与通知 | 协同日历 | /calendar | {"required":[],"anyOf":[]} | — |
| home | 个人设置 | 我的权限 | /security/my-access | {"required":["menu.security_my_access","permission.trace.self"],"anyOf":[]} | — |
| home | 个人设置 | 账号安全 | /security/account | {"required":[],"anyOf":[]} | — |
| apps | 客户经营 | 线索列表 | /leads | {"required":["menu.lead_crm","lead.read"],"anyOf":[]} | — |
| apps | 客户经营 | 跟进工作表 | /leads/follows | {"required":["menu.lead_crm","lead.read"],"anyOf":[]} | — |
| apps | 客户经营 | 公海池 | /leads/pool | {"required":["menu.lead_crm","lead.read"],"anyOf":[]} | — |
| apps | 客户经营 | 到访日历 | /leads/calendar | {"required":["menu.lead_crm","appointment.read"],"anyOf":[]} | — |
| apps | 客户经营 | 线索详情 | /leads/:id | {"required":["menu.lead_crm","lead.read"],"anyOf":[]} | 隐藏 |
| apps | 客户经营 | 新建客户 | /customers/new | {"required":["menu.customer","customer.create"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 新建谈案 | /negotiations/new | {"required":["menu.contract","negotiation.create"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 谈案详情 | /negotiations/:id | {"required":["menu.contract","negotiation.read"],"anyOf":[]} | 隐藏 |
| apps | 客户经营 | 客户管理 | /customers | {"required":["menu.customer","customer.read"],"anyOf":[]} | — |
| apps | 客户经营 | 客户详情 | /customers/:id | {"required":["menu.customer","customer.read"],"anyOf":[]} | 隐藏 |
| apps | 客户经营 | 渠道管理 | /channels | {"required":["menu.channel","channel.read"],"anyOf":[]} | — |
| apps | 客户经营 | 登记渠道 | /channels/new | {"required":["menu.channel","channel.create"],"anyOf":[]} | 隐藏 |
| apps | 客户经营 | 渠道详情 | /channels/:id | {"required":["menu.channel","channel.read"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 谈案管理 | /negotiations | {"required":["menu.contract","negotiation.read"],"anyOf":[]} | — |
| apps | 签约交付 | 合同管理 | /contracts | {"required":["menu.contract","contract.read"],"anyOf":[]} | — |
| apps | 签约交付 | 新建合同 | /contracts/new | {"required":["menu.contract","contract.create"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 合同详情 | /contracts/:id | {"required":["menu.contract","contract.read"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 案件管理 | /cases | {"required":["case.read"],"anyOf":[]} | — |
| apps | 财务运营 | 收款管理 | /payments | {"required":["menu.payment","payment.read"],"anyOf":[]} | — |
| apps | 财务运营 | 开票管理 | /invoices | {"required":["menu.invoice","invoice.read"],"anyOf":[]} | — |
| apps | 财务运营 | 退款减免 | /refunds | {"required":["menu.refund","refund.read"],"anyOf":[]} | — |
| apps | 财务运营 | 成本管理 | /costs | {"required":["menu.cost","cost.read"],"anyOf":[]} | — |
| apps | 财务运营 | 新建收款 | /payments/new | {"required":["payment.read","payment.create"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 收款详情与办理 | /payments/:id | {"required":["payment.read"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 新建发票 | /invoices/new | {"required":["invoice.read","invoice.create"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 发票详情与办理 | /invoices/:id | {"required":["invoice.read"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 新建退款减免 | /refunds/new | {"required":["refund.read","refund.create"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 退款减免详情与办理 | /refunds/:id | {"required":["refund.read"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 新建成本 | /costs/new | {"required":["cost.read","cost.create"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 成本详情与办理 | /costs/:id | {"required":["cost.read"],"anyOf":[]} | 隐藏 |
| apps | 财务运营 | 财务工作区 | /finance | {"required":[],"anyOf":[["menu.payment","payment.read"],["menu.invoice","invoice.read"],["menu.refund","refund.read"],["menu.cost","cost.read"]]} | 隐藏 |
| apps | 综合行政管理 | 低值易耗品 | /inventory/items | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | — |
| apps | 综合行政管理 | 人力资源 | /inventory/stocktakes | {"required":["hr.worksheet.read"],"anyOf":[]} | — |
| analytics | 库存分析 | 定制物品领用统计 | /inventory/customized-statistics | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | — |
| analytics | 库存分析 | 办公用品领用统计 | /inventory/office-statistics | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | — |
| analytics | 库存分析 | 物品领用仪表盘 | /inventory/dashboard | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | — |
| analytics | 库存分析 | 物品领用仪表盘 | /inventory | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 新建案件 | /cases/new | {"required":["case.read","case.create","customer.read"],"anyOf":[]} | 隐藏 |
| apps | 签约交付 | 案件详情与交付 | /cases/:id | {"required":["case.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 行政事务 | /inventory/movements | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | — |
| apps | 综合行政管理 | 登记物品业务 | /inventory/items/new | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 物品业务详情 | /inventory/items/:id | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 登记物品业务 | /inventory/movements/new | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 物品业务详情 | /inventory/movements/:id | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 登记物品业务 | /inventory/stocktakes/new | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| apps | 综合行政管理 | 物品业务详情 | /inventory/stocktakes/:id | {"required":["menu.inventory","inventory.read"],"anyOf":[]} | 隐藏 |
| analytics | 绩效分析 | 登记绩效 | /performances/new | {"required":["performance.create","employee.read"],"anyOf":[]} | 隐藏 |
| analytics | 绩效分析 | 绩效详情 | /performances/:id | {"required":["performance.read"],"anyOf":[]} | 隐藏 |
| analytics | 绩效分析 | 工资表与审批 | /payroll | {"required":["performance.read"],"anyOf":[]} | — |
| analytics | 经营分析 | 经营概览 | /analytics/overview | {"required":[],"anyOf":[]} | — |
| analytics | 绩效分析 | 绩效管理 | /performances | {"required":["performance.read"],"anyOf":[]} | — |
| analytics | 数据质量 | 异常数据 | /anomalies | {"required":["menu.anomaly","anomaly.read"],"anyOf":[]} | — |
| admin | 组织与人员 | 组织架构 | /org/tree | {"required":["menu.organization_personnel","menu.organization","organization.read"],"anyOf":[]} | 仅超管 |
| admin | 组织与人员 | 岗位管理 | /org/positions | {"required":["menu.organization_personnel","menu.position","position.read"],"anyOf":[]} | — |
| admin | 组织与人员 | 员工管理 | /org/employees | {"required":["menu.organization_personnel","menu.employee","employee.read"],"anyOf":[]} | — |
| admin | 组织与人员 | 专业团队 | /org/professional-teams | {"required":["menu.organization_personnel","menu.professional_team","professional_team.read"],"anyOf":[]} | — |
| admin | 身份授权 | 账号管理 | /users | {"required":["user.read"],"anyOf":[]} | — |
| admin | 身份授权 | 角色权限 | /security/roles | {"required":["menu.security_roles","role.read"],"anyOf":[]} | — |
| admin | 身份授权 | 用户授权 | /security/users | {"required":["menu.security_users","user.read"],"anyOf":[]} | — |
| admin | 身份授权 | 权限追踪 | /security/trace | {"required":["menu.security_trace","permission.trace.any"],"anyOf":[]} | — |
| admin | 系统治理 | 管理员治理 | /security/admin-governance | {"required":["menu.admin_governance","governance.catalog.read"],"anyOf":[]} | — |
| admin | 系统治理 | 事件运维 | /security/event-operations | {"required":["menu.event_operations","event.delivery.read"],"anyOf":[]} | — |
| home | 全局工具 | 知识库 | /knowledge | {"required":["menu.knowledge"],"anyOf":[]} | 全局 |
| home | 全局工具 | 智慧办案 | /smart-case | {"required":["menu.smart_case"],"anyOf":[]} | 全局 |

## 旧路径重定向

| 旧路径 | 现入口 |
|---|---|
| /inventory/customized-records | /inventory/items |
| /inventory/office-records | /inventory/items |
| /inventory/inbound | /inventory/items |
| /inventory/outbound | /inventory/items |
| /organizations | /org/tree |
| /employees | /org/employees |
| /roles | /security/roles |
