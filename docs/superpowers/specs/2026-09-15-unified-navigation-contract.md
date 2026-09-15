# U0/U1：全站路由迁移矩阵与统一框架契约

日期：2026-09-15。执行依据：[全站统一规格](2026-09-15-feishu-unified-oa-refactor.md)。本契约先于 U2 代码修改。U2/U3 交付全站框架，U4–U7 继续逐项迁移业务视图和动作，不将框架套用计为业务深度整合。

## 布局与状态

```text
全局顶栏：产品 / 当前区域 / 当前页面    查找入口    知识库 智慧办案 通知 账号
全局导航（80px 图标栏，可展开到 168px）：工作台、云盘、业务应用、数据分析、管理中心
当前区域（仅一套宽目录）：
  工作台 / 业务应用 / 数据分析 / 管理中心：该区域已授权页面目录（可收起）
  云盘：现有文件夹目录；进入 Base 后替换为现有数据表目录
内容：工作台 / 资源卡片 / 正式业务页面 / 表格与记录详情
```

- 全部已登录业务路由共用持久 MainLayout，路由切换不重建全局 CaseWorkbench 或 DesktopKnowledgeBridge。知识库与智慧办案只保留相邻全局顶栏入口，复用 openCaseAssistant，不修改 Harness/Wiki 存储、索引、编译或会话协议。
- 全局五个入口对所有已登录账号相同；区域内容、入口搜索结果和上下文目录依据当前有效授权过滤，无可用应用显示空态。权限不是通过角色名称推断。
- 入口搜索只查本地已授权页面目录，不检索业务记录，不返回无权标题或伪造统计。云盘原资源搜索保持原契约。
- 菜单要求与该页读取权限取交集；组织架构另保留系统超级管理员限制，组织子项保留父级组织与人员菜单约束。直链使用同一声明式目录规则守卫，服务端原鉴权仍为权威。收紧旧页面中只有菜单/无读取权限的入口，不能扩大数据范围。
- 初次授权加载显示加载态，失败显示重试且不呈现受保护内容；后台每 15 秒及窗口重新获得焦点刷新授权，成功刷新不卸载当前表单，失败或撤权后关闭受保护内容。服务端撤权即时生效，云盘资源撤权仍沿用其 5 秒清理；全局菜单刷新门槛为 15 秒加网络耗时。
- 每次异步授权结果须核对发起用户及会话令牌，旧会话响应不得覆盖新账号授权。定时刷新互斥，组件卸载后不写回。
- 根路径 / 改为工作台：待办/通知/云盘/已授权常用入口；原经营仪表盘移至 /analytics/overview。新增 /apps、/analytics、/admin 为真实区域首页。顶栏本批显示产品和当前位置；组织与工作区范围仍由原工作区选择器和业务筛选管理，不新增虚假的组织切换能力。
- 其余业务 URL 保持原路径、查询参数及记录 ID。/organizations、/employees、/roles 保留兼容跳转并传递 search/hash；未知地址显示明确 404 和返回工作台入口，禁止静默误定位。
- 工作区路由仍为 /workspaces?workspace/folder/base/table/view/record/driveReturn。进入 Base 不叠加全局区域目录；保留“承业 · 云盘”返回与原 driveReturn。内层 OA 返回、知识库/通知按钮收敛到顶栏，分享、在线成员、应用权限与表权限继续位于编辑器工具区。独立组件测试入口可保留原独立页头，不代表正式全站运行。
- 1440/1024 使用窄全局栏和一套上下文目录；小于 768 使用全局导航抽屉，云盘/表格原目录继续使用其原抽屉，不能遮住全局操作。按钮可键盘聚焦，导航为真实链接，当前入口标记 aria-current；提供跳转主要内容、收展按钮与抽屉关闭/焦点返回。
- 本阶段无数据库迁移、无数据复制；回退本批前端提交即可恢复旧框架。原服务、对象 ID、通知/附件/审计引用不变，新增区域 URL 在回退版本不可用。源码版本回退不等于删除新数据。

## 全路由矩阵

表中“菜单+读取”表示两者均须满足；已有服务内行/列范围及受控动作不变。所有业务记录的 createdBy/负责人/归属组织语义在后续适配前保持原规格，SELF 协作表仍严格表示 createdBy。各行 U2 状态均为“框架纳入，业务实现保留”，除注明已交付的云盘外，业务深度统一另按 U4/U5/U6 验收。

| 原/现路由（含所有子路径） | 目标区域 | 权威数据与读取门槛 | 保留动作 / 后续阶段 | 对应规格 |
|---|---|---|---|---|
| / | 工作台 | 当前账号；授权过滤入口，无全站业务统计 | 待办、通知和常用入口；U2 | MOD-013 |
| /analytics/overview（原 / 的仪表盘） | 数据分析 | 原 dashboard 服务及其范围；已登录 | 经营指标、预警；指标深度统一 U6 | MOD-012 |
| /workspaces（所有 query 变体） | 云盘 | CollabWorkspace/Base/Table/Record、DriveNode；资源/行/列权限 | 原 G1/G2-A/G2-B；不重做 | MOD-002、FTN-001/003 |
| /leads | 业务应用 / 客户经营 | Lead；menu.lead_crm + lead.read | 录入/分配/转化/回收，U4 | MOD-004 |
| /leads/pool | 业务应用 / 客户经营 | 原公海查询；menu.lead_crm + lead.read | 领取及公海边界，U4 | MOD-004 |
| /leads/calendar | 业务应用 / 客户经营 | Appointment；menu.lead_crm + appointment.read | 邀约/到访确认，U4 | MOD-004 |
| /leads/:id | 业务应用 / 客户经营 | 同一 Lead ID；menu.lead_crm + lead.read | 详情/跟进/历史，U4 | MOD-004 |
| /customers | 业务应用 / 客户经营 | Customer；menu.customer + customer.read | 唯一性/创建/编辑/删除/合并，U5 | MOD-005 |
| /customers/:id | 业务应用 / 客户经营 | 同一 Customer ID；同上 | 客户详情与关联，U5 | MOD-005 |
| /channels | 业务应用 / 客户经营 | 原 Channel API、已登录及服务原规则；现无 channel.read 码 | 渠道维护/统计；细化权限 U6，不虚构授权码 | MOD-003 |
| /negotiations | 业务应用 / 签约交付 | Negotiation；menu.contract + negotiation.read | 谈案及后续签约，U5 | MOD-006 |
| /contracts | 业务应用 / 签约交付 | Contract；menu.contract + contract.read | 合同状态机，U5 | MOD-006 |
| /contracts/new | 业务应用 / 签约交付 | Contract；menu.contract + contract.create | 新建仍经正式服务，U5 | MOD-006 |
| /contracts/:id | 业务应用 / 签约交付 | 原 Contract ID；menu.contract + contract.read | 提交/审批/签署/生效/终止，U5 | MOD-006 |
| /cases | 业务应用 / 签约交付 | Case 与任务/沟通/文件；case.read | 建档/节点/材料/结案/归档，U5；非 Harness | MOD-008/010 |
| /payments | 业务应用 / 财务运营 | Payment；menu.payment + payment.read | 收款登记/确认/作废，U6 | MOD-006 |
| /invoices | 业务应用 / 财务运营 | Invoice；menu.invoice + invoice.read | 申请/审批/开具，U6 | MOD-006 |
| /refunds | 业务应用 / 财务运营 | Refund；menu.refund + refund.read | 申请/审批/执行与 MFA，U6 | MOD-006 |
| /costs | 业务应用 / 财务运营 | Cost；menu.cost + cost.read | 成本增改删及金额校验，U6 | MOD-006 |
| /finance | 业务应用 / 财务运营 | 上述收款/开票/退款中至少一个菜单+读取；原 caseNo query | 保留财务聚合与案件关联，不改金额，U6 | MOD-006 |
| /inventory/items | 业务应用 / 物品管理 | InventoryItem；menu.inventory + inventory.read | 物品档案、库存，U6 | MOD-011 |
| /inventory/customized-records | 业务应用 / 物品管理 | 原库存流水；同上 | 定制领用，U6 | MOD-011 |
| /inventory/office-records | 业务应用 / 物品管理 | 原库存流水；同上 | 办公用品领用，U6 | MOD-011 |
| /inventory/inbound | 业务应用 / 物品管理 | 原库存流水；同上 | 入库事务，U6 | MOD-011 |
| /inventory/outbound | 业务应用 / 物品管理 | 原库存流水；同上 | 出库事务，U6 | MOD-011 |
| /inventory/stocktakes | 业务应用 / 物品管理 | InventoryStocktake；同上 | 盘点原子调整，U6 | MOD-011 |
| /inventory/customized-statistics | 数据分析 / 库存分析 | 原库存聚合；menu.inventory + inventory.read | 指标/筛选/导出，U6 | MOD-011/012 |
| /inventory/office-statistics | 数据分析 / 库存分析 | 原库存聚合；同上 | 指标/筛选/导出，U6 | MOD-011/012 |
| /inventory/dashboard；/inventory | 数据分析 / 库存分析 | 原库存仪表盘；同上 | /inventory 保留原默认仪表盘，U6 | MOD-011/012 |
| /inventory/*（其余未知子路径） | 404 | 不调用库存数据 | 从原通配渲染收紧为有效路径 | MOD-011 |
| /performances | 数据分析 / 绩效 | Performance；performance.read | 目标/自评/主管评/确认/工资批次，U6 | MOD-011/012 |
| /anomalies | 数据分析 / 数据质量 | 原异常服务；menu.anomaly + anomaly.read | 按原授权追溯，U6 | MOD-012 |
| /approvals | 工作台 / 待办 | ApprovalInstance；approval.read | 申请/处理/定义管理各自鉴权，U6 | MOD-013 |
| /approval-ledger | 工作台 / 待办 | 同一审批记录；approval.read | 审批台账/历史，U6 | MOD-013 |
| /notifications | 工作台 / 通知 | 当前账号通知 API；已登录 | 查看/已读/跳转，U6 | MOD-013 |
| /org/tree | 管理中心 / 组织与人员 | Organization；组织父菜单+menu.organization+organization.read+超级管理员 | 原组织约束保留，U6 | MOD-001/011 |
| /org/positions | 管理中心 / 组织与人员 | Position；组织父菜单+menu.position+position.read | 岗位配置，U6 | MOD-001/011 |
| /org/employees | 管理中心 / 组织与人员 | Employee；组织父菜单+menu.employee+employee.read | 入转调离/账号映射，U6 | MOD-001/011 |
| /org/professional-teams | 管理中心 / 组织与人员 | ProfessionalTeam；组织父菜单+menu.professional_team+professional_team.read | 成员/负责人，U6 | MOD-001/007 |
| /users | 管理中心 / 身份授权 | User；user.read | 账号管理，U6 | MOD-001 |
| /security/roles | 管理中心 / 身份授权 | Role/Permission；menu.security_roles + role.read | 权限与业务角色成员指派，U6 | MOD-001 |
| /security/users | 管理中心 / 身份授权 | UserRole；menu.security_users + user.read | 授权/有效期，U6 | MOD-001 |
| /security/trace | 管理中心 / 身份授权 | 原追踪服务；menu.security_trace + permission.trace.any | 授权追溯，U6 | MOD-001 |
| /security/my-access | 工作台 / 个人设置 | 当前账号授权；menu.security_my_access + permission.trace.self | 个人权限追踪，U6 | MOD-001 |
| /security/account | 工作台 / 个人设置 | 原个人认证服务；已登录 | MFA/会话安全，核心架构保留 | FTN-003 |
| /security/admin-governance | 管理中心 / 系统治理 | 原治理服务；menu.admin_governance + governance.catalog.read | 双人审批/高风险校验，U6 | MOD-001/002 |
| /security/event-operations | 管理中心 / 系统治理 | EventDelivery；menu.event_operations + event.delivery.read | 查看/受控重试，U6 | FTN-005 |
| /knowledge | 全局顶栏 | 云端 Wiki；menu.knowledge | 管理/编译/只读权限保持，外层接入 U2 | MOD-010、桌面规格 |
| /smart-case | 全局顶栏 | 原本地 Harness / 浏览器兼容工作台；menu.smart_case | 唤起/恢复原会话，外层接入 U2 | MOD-010、桌面规格 |
| /organizations → /org/tree | 管理中心 | 目标路由完整鉴权；search/hash 保留 | 旧书签兼容 | MOD-001 |
| /employees → /org/employees | 管理中心 | 同上 | 旧书签兼容 | MOD-001 |
| /roles → /security/roles | 管理中心 | 同上 | 旧书签兼容 | MOD-001 |
| /login；/password-change | 独立认证流程 | 原认证/MFA/强制改密状态机 | 不套业务框架、不改协议 | FTN-003 |
| * | 明确 404 | 已登录框架；未登录仍登录 | 返回工作台，不静默映射原记录 | MOD-002 |
| /apps；/analytics；/admin（新增） | 业务应用/数据分析/管理中心 | 本地页面目录按上述授权过滤 | 页面入口、搜索与空态，U2 | MOD-002 |

## 无现存独立路由的规划能力

MOD-007 SOP、MOD-009 满意度/复购转介绍、MOD-003 内容获客、MOD-008 质检等尚无独立页面，保持对应模块规格与 U5/U6 待办，不生成假入口；已有案件、团队、渠道功能按上表进入。上传、模板及 G3 协作能力仍按原规格单列，优先级低于本次全站整合。

## U3 验证契约

1. 自动核对 App 实际路由与上述目录覆盖，含库存子路径、详情、新建及兼容跳转；最长路径匹配避免 /leads/pool 误当详情。
2. 三角色使用相同五入口；菜单+读取交集、超级管理员限制、未授权直链、初次授权失败/重试和后台撤权都有回归。
3. 真实浏览器打开正式 App 路由，验证工作台→业务应用→业务页、云盘→Base→返回、管理中心、入口搜索、桌面收展和移动抽屉；1440/1024/390 页面无整体横向溢出，表格可在自身容器滚动。
4. 全局知识库与智慧办案在云盘和业务页均可达；浏览器切换路由保留工作台根，桌面继续调用既有私有桥。复用原桌面桥单元测试，并明确是否运行真实 Electron 全流程。
5. 前端相关测试、lint/类型/构建和原 HTTP/浏览器协作回归；本批不修改服务端协作热路径，不重跑 900 秒负载。无新迁移，不重置数据库。


## U4 增量映射

/leads 已接入线索工作表选择与共同编辑器，新增 /leads/follows（同 menu.lead_crm + lead.read 权限）。两路由在带 base/table 参数时只呈现全局栏与表目录；/leads/:id 保留专属办理并提供有权工作表定位，/leads/pool 与 /leads/calendar 保留专属场景。详情见[U4 契约](2026-09-15-u4-lead-workspace.md)。
