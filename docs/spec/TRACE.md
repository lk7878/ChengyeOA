---
id: TRACE
title: 模块级追溯矩阵
type: meta-spec
status: approved
created: 2026-07-28
last_updated: 2026-09-15
---

# 模块级追溯矩阵（TRACE）

> 粒度：模块级。功能点级追溯见各 MOD 文档内现状表。
> 权威需求源已迁移至本目录（`docs/spec/`），见 `CONVENTIONS.md §5` 与 `README.md`。

## 图例

| 现状标记 | 含义 |
|---|---|
| ✅ | 已验收 |
| ⚠️ | 有代码无SPEC（待补） |
| ⬜ | 待开发 |
| 📋 | 有专项设计无SPEC |

## 业务模块（MOD-001 ~ MOD-013）

| 编号 | 模块 | 专项设计 | 已落地SPEC | 现状 |
|---|---|---|---|---|
| MOD-001 | 组织权限 | 角色权限/系统管理员权限设计 | SPEC-002/003/004/005；[SPEC-003-A](../superpowers/specs/2026-09-11-organization-management-extension.md)；SPEC-COLLAB-20260914 | ✅原基线已验收；003-A 本地自动化通过，浏览器手工验收未执行；工作区/应用/表及岗位主体、行字段范围和撤权已验证；云盘文件夹继承已验证，G2-A 移动/回收状态已实现，验收见云盘计划 |
| MOD-002 | 多维协作工作区与配置中心 | 动态字段表格与模板配置（已扩展） | [SPEC-COLLAB-20260914](../superpowers/specs/2026-09-14-feishu-aligned-collaborative-workspace.md)（前七批部分落地） | 自建表、视图、网格、SSE、防覆盖、资源/岗位授权、CRM 读取/办理及扩展字段、目录排序、断网恢复和原子批量粘贴已验证；第七批 AC-15 本地 100 会话/900 秒负载通过，3600 次保存成功；真实多设备、完整故障矩阵及 P2/P3 待验收或实施 |
| MOD-003 | 品牌获客 | 页面与接口清单(渠道部分) | — | ⚠️有代码无SPEC |
| MOD-004 | 线索销转 | 页面与接口清单 | SPEC-009(部分,已验收2026-07-30); SPEC-010(立项,CRM-07) | ⚠️部分落地；⬜多维工作区适配待实施 |
| MOD-005 | 客户主数据 | 页面与接口清单 | SPEC-009(部分,已验收2026-07-30) | ⚠️部分落地；⬜多维工作区适配待实施 |
| MOD-006 | 合同财务 | SPEC-010设计(已批准2026-07-30) | SPEC-010(立项,待实施;CON-01~07+FIN-01) | 📋有设计无SPEC |
| MOD-007 | 专业团队SOP | 三大团队SOP字段清单 | [SPEC-SOP-QC-20260916](../superpowers/specs/2026-09-16-sop-quality-control.md)（规划） | 团队主数据已存在；SOP模板/执行/审核⬜待开发，见SQ计划 |
| MOD-008 | 案件交付质控 | 三大团队SOP字段清单 | [SPEC-CASE-20260914](../superpowers/specs/2026-09-14-case-management-extension.md)；[SPEC-CASE-CRUD-20260914](../superpowers/specs/2026-09-14-case-management-crud.md)；[SPEC-AI-DESKTOP-20260913](../superpowers/specs/2026-09-13-unified-desktop-local-harness.md) | ✅案件建档、客户联动、完整字段展示、查询修改及受保护删除已验证；⬜MAT-04B 待开发 |
| MOD-009 | 满意度转介绍 | — | — | ⬜待开发 |
| MOD-010 | AI录音文件 | 文件录音AI任务设计 | SPEC-AI-DECOUPLED/AI-UI 历史已实施；[SPEC-AI-DESKTOP-20260913](../superpowers/specs/2026-09-13-unified-desktop-local-harness.md) 实施中 | 📋录音专项待开发；AI-08 桌面基础、AI-09 只读查询与 AI-10 视觉链路已验证；完整交付待验收 |
| MOD-011 | 组织人事 | 数据库核心表设计 | SPEC-003(部分) | ⚠️有代码无SPEC |
| MOD-012 | 驾驶舱 | — | — | ⚠️有代码无SPEC |
| MOD-013 | 自动化审批审计 | 审计自动化/审批消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC；⬜表格自动化/记录讨论待开发 |

## 横切契约（FTN-001 ~ FTN-007）

| 编号 | 契约 | 专项设计 | 已落地SPEC | 现状 |
|---|---|---|---|---|
| FTN-001 | 数据模型 | 数据库核心表设计草案 | SPEC-001/003 | ✅已验收；⬜多维协作新增契约待实现/验收 |
| FTN-002 | 状态机字典 | 状态机与业务字典设计 | — | ⬜待开发(底座49model已建) |
| FTN-003 | RBAC数据范围 | 角色权限与数据范围设计 | SPEC-004 | ✅已验收；⬜多维协作新增契约待实现/验收 |
| FTN-004 | API事务一致性 | API规范错误码事务边界 | 各SPEC散落 | ✅已验收；⬜多维协作新增契约待实现/验收 |
| FTN-005 | 事件驱动模型 | 数据流转事件中心设计 | SPEC-007/008 | ✅已验收；⬜多维协作新增契约待实现/验收 |
| FTN-006 | 审批任务通知 | 审批实例任务消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC |
| FTN-007 | 非功能需求 | — | SEC-SPEC-001/006 | ⚠️有代码无SPEC；⬜多维协作新增契约待实现/验收 |

## 多维协作方向变更（2026-09-14）

[SPEC-COLLAB-20260914](../superpowers/specs/2026-09-14-feishu-aligned-collaborative-workspace.md) 已建立，需求入口为 MOD-002，协同 MOD-001/004/005/013 与 FTN-001/003/004/005/007。它规定飞书式布局、空白建表、类型字段、总表/个人/共享视图、多人同步、防覆盖及 P1～P3 验收。

新工作区首批协作底座已经落地，记录了数据库、真实 HTTP、双账号浏览器及三种屏宽的验证。完整 P1 尚未验收，原基线验收不能覆盖新增范围；实际能力及未完成项见[实施记录](../superpowers/plans/2026-09-14-feishu-aligned-collaborative-workspace.md)。

## 维护说明

- 2026-09-11：MOD-001 ORG-13 完成 [SPEC-003-B](../superpowers/specs/2026-09-11-organization-tree-ordering.md)，组织树折叠与全局唯一排序号已实现；自动化及迁移验证见[验收记录](../superpowers/plans/2026-09-11-organization-tree-ordering.md)。

- 本矩阵为项目全局追溯入口，每次 SPEC 立项/验收、每次新模块进入实现时，更新对应行的「已落地SPEC」与「现状」两列。
- 与各文档 frontmatter `implements` 字段配合：`grep "implements: SPEC-" docs/spec/**/*.md` 可快速统计哪些需求已由哪个 SPEC 落地。
- 详情下沉到各 spec 文档；本表保持模块级粗粒度，不新增功能点级行。

- 2026-09-11：MOD-013 APPR-02/03/04 完成 [SPEC-APPR-20260911](../superpowers/specs/2026-09-11-approval-materials.md)，个人审批类型、凭证上传、Office 基本编辑与导出打印已实现；验收与格式边界见[实施记录](../superpowers/plans/2026-09-11-approval-materials.md)。

## SPEC-EMP-UI-20260911：员工类型与完整组织路径

- 规格：[员工类型中文与完整组织路径](../superpowers/specs/2026-09-11-employee-display.md)。
- 实现与验证：[实施记录](../superpowers/plans/2026-09-11-employee-display.md)。

## SPEC-UI-20260911：全局列宽与中文显示

- 规格：[全局业务表格列宽与中文显示](../superpowers/specs/2026-09-11-table-resize-chinese.md)。
- 实现：共用 ResizableTable、ChineseConfig、business-labels、岗位管理及业务表格接入。
- 验证：组件/岗位回归、中文显示和真实浏览器拖动检查；结果见实施记录。

### SPEC-MD-DELETE-20260911：主数据删除与离职工号复用

参见 [增量规格](../superpowers/specs/2026-09-11-master-data-delete-number-reuse.md)。本规格将工号唯一范围更新为在职员工；历史档案保留原工号，通过员工 ID 区分历任人员。岗位受任职关联保护，员工档案逻辑删除，删除仅超级管理员可执行。

## SPEC-FIN-APPR-PAYROLL-20260911

[规格](../superpowers/specs/2026-09-11-finance-approval-payroll.md)与[实施记录](../superpowers/plans/2026-09-11-finance-approval-payroll.md)：团队中文分类、财务与案件关联、审批通过同步、工资表编辑及审批。

## SPEC-INVENTORY-20260911

[物品管理规格](../superpowers/specs/2026-09-11-inventory-management.md)与[实施记录](../superpowers/plans/2026-09-11-inventory-management.md)：定制物品/办公用品、库存、领用、盘点、统计和仪表盘。

## SPEC-AI-INTEGRATION-20260912

[知识库与智慧办案规格](../superpowers/specs/2026-09-12-harness-integration.md)及[实施验收](../superpowers/plans/2026-09-12-harness-integration.md)：律师智慧管理系统 V1.1.0，右上知识库、左栏智慧办案、独立本机连接器、个人 Wiki 与法律 Preset。

## SPEC-AI-DECOUPLED-20260912（替代架构，已实施）

[内置源码与独立模块规格](../superpowers/specs/2026-09-12-harness-decoupled.md)替代 V1.1.0 外部连接器方案；版本 V1.2.0，云端管理员 Wiki、浏览器个人办案工作区、独立 Harness 源码和无新增 HTTP 端口运行。[验收记录](../../integrations/intelligence/VERIFICATION.md)，原历史验收保留。

## SPEC-AI-UI-20260912（V1.2.1）

[智慧办案原生 UI 规格](../superpowers/specs/2026-09-12-smart-case-native-ui.md)：右上角单一入口、Harness 原生组件、全局浮动工作台及跨路由会话保留。[实施验收](../superpowers/plans/2026-09-12-smart-case-native-ui.md)。

## SPEC-AI-DESKTOP-20260913（V1.3.0 目标，实施中）

部署追溯：[SPEC-DEPLOY-20260914](../superpowers/specs/2026-09-14-production-deployment.md)与[部署实施计划](../superpowers/plans/2026-09-14-production-deployment.md)。本次仅完善规格；云测试环境 C-01～C-08、干净 Windows W-01～W-07、试用/上线 T-01～T-04 均待执行，不能记作生产部署或安装交付已完成。

补充：[百佑办案助手与 lawyer preset](../superpowers/specs/2026-09-13-baiyou-lawyer-preset.md)；[实施验收](../superpowers/plans/2026-09-13-baiyou-lawyer-preset.md)。品牌与独立预设已完成，本地 Wiki 快照同步等待权限方案确认。

[统一桌面客户端与本地 Harness](../superpowers/specs/2026-09-13-unified-desktop-local-harness.md)：云端 OA/Wiki、本机原生 Harness、OA 草稿提交与云端校验、个人办案数据不自动同步、Wiki OCR 与个人在线视觉 API 分工、主动提交成果至案件档案。对应 MOD-010 AI-08～10、MOD-008 MAT-04B。替代上述 V1.2.0/V1.2.1 中冲突的浏览器办案与云端办案引擎契约，保留历史验收。[阶段一](../superpowers/plans/2026-09-13-unified-desktop-local-harness.md)已验证本机目录与历史恢复；[阶段二](../superpowers/plans/2026-09-13-desktop-cloud-wiki-vision.md)已接入本地助手云端 Wiki 只读查询、账号绑定和原生个人视觉接口。正式运行版本不变；真实模型效果、云端 OCR 部署、归档、草稿同步和安装交付仍待后续验收，完整 Spec 尚未验收。

## SPEC-LAWYER-SKILLS-20260914

[四类法律能力规格](../superpowers/specs/2026-09-14-lawyer-skills.md)与[实施记录](../superpowers/plans/2026-09-14-lawyer-skills.md)：唯一 lawyer 中的合同审查、应诉分析、管辖分析和共享法律检索，原生技能目录和工具复用，正式资源随 preset 分发；不接入诉讼费用，不同步个人卷宗。

## SPEC-CUSTOMER-CRUD-20260914

[客户管理规格](../superpowers/specs/2026-09-14-customer-management-crud.md)与[实施记录](../superpowers/plans/2026-09-14-customer-management-crud.md)：列表查询/修改/删除入口、编辑版本保护和可选字段清空、独立删除权限、业务关联保护及事务软删除，对应 MOD-005。

## SPEC-DRIVE-20260915（G1 云盘最小闭环）

[云盘资源中心规格](../superpowers/specs/2026-09-15-feishu-cloud-drive-resource-center.md)、[G1 资源与权限技术契约](../superpowers/specs/2026-09-15-cloud-drive-g1-contract.md)及[任务计划](../superpowers/plans/2026-09-15-feishu-cloud-drive-resource-center.md)承接统一界面要求，对应 MOD-002 CFG-22、MOD-001 ORG-14 及 FTN-001/003/004/005。目录与 Base/表/视图分层、文件夹共享、旧资源稳定接入和祖先鉴权均已实现。前置提交为 172f126d（B7 性能）及 faa2586（G0 契约）。G1 在 8 层目录下重新通过 100 会话/900 秒持续负载，3,600 次保存全部成功；服务 41/41、相关前端 21 项及真实浏览器流程的证据见实施计划。移动、快捷方式、回收站、上传与文档协作不在 G1 完成范围。


| G1 验收 | 代码与验证定位 |
|---|---|
| DRIVE-AC-01/02/04/08 | `CloudDrivePage.tsx`、`WorkspaceMembers.tsx` 与原 Workspaces 编辑器；三角色和同资源返回浏览器流程 |
| DRIVE-AC-03 | `DriveNode`、`20260915120000_cloud_drive_catalog`；旧 Base 接入和重入测试 |
| DRIVE-AC-05/06 | `resource-access.ts` / `folder-access.ts`、原内容入口；SELF、祖先撤权、附件/关联、HTTP/SSE 验证 |
| DRIVE-AC-09/10 | `collaboration-load.test.ts`（8 层目录、100 会话、900 秒）及原协作/业务回归；详细环境和限制见实施计划 |


## SPEC-DRIVE G2-A（移动与回收生命周期）

[生命周期规格](../superpowers/specs/2026-09-15-cloud-drive-g2-lifecycle.md)对应 MOD-002 CFG-22、MOD-001 ORG-14 及 FTN-001/003/004/005；实现和实际检查记录见[计划第 7 节](../superpowers/plans/2026-09-15-feishu-cloud-drive-resource-center.md#7-g2-a-执行计划)。DRIVE-AC-07 的移动/回收部分已实现，快捷方式部分仍待开发，不能标记 AC-07 整项完成。

| 范围 | 实现与验收定位 |
|---|---|
| 移动预览、规则变化冲突、幂等及整树原子事务 | DriveService.lifecyclePlan/previewLifecycle/applyLifecycle；drive-lifecycle.test.ts |
| 回收/恢复、旧入口阻断、名称复用、当前权限过滤 | 20260915130000_drive_lifecycle；folder-access.ts、collaboration-service.ts；生命周期服务回归 |
| 统一界面、跨会话、失效清空、失败重试与恢复 | CloudDrivePage.tsx、DriveLifecycle.tsx；collaboration-http.test.ts 的生命周期真实浏览器流程 |
| 多人原有行为与性能门槛 | 原协作/G1 回归及 collaboration-load.test.ts；沿用 100 会话 / 900 秒 / 8 层目录，结果记录于计划 |

G2-A 最终验收：服务 51/51、完整 HTTP/SSE/Edge 5/5、目标撤权追加 Edge 1/1、前端相关 21 项通过；100 会话 / 900 秒负载保存 3600/3600，查询/保存/可见 P95 1177/1446/1352ms，重连 P95 4298ms。第 54 条迁移已应用到两个隔离测试库及开发库；具体限制与原始日志位置见计划。


## SPEC-DRIVE G2-B（快捷方式与最近访问）

[导航契约](../superpowers/specs/2026-09-15-cloud-drive-g2b-shortcuts-recents.md)对应 MOD-002 CFG-22、MOD-001 ORG-14 与 FTN-001/003/004/005。G2-A 的历史范围保持不变，G2-B 扩展 DRIVE-AC-04/06/07/08/10：原资源身份、引用不授权、个人状态隔离、失效隐藏与目录回归。结果见[任务计划第 8 节](../superpowers/plans/2026-09-15-feishu-cloud-drive-resource-center.md#8-g2-b-执行计划)。

| 范围 | 实现与验证 |
|---|---|
| 个人/共享快捷方式、目标改名/移动/回收、只移除引用 | DriveNavigationService；DriveShortcut；drive-navigation.test.ts |
| 个人最近访问、100 项上限、幂等清空与直链登记 | DriveVisit；CloudDrivePage / Workspaces 进入逻辑；导航服务与浏览器回归 |
| 双路径鉴权、无权统计和预览清理 | shortcutValue / shortcut / catalog；ShortcutDialog；HTTP/Edge 跨角色流程 |
| 迁移、基线及目录性能 | 20260915140000_drive_shortcuts_visits；90 模型/55 迁移；500 资源 + 200 链接 + 100 访问目录验证 |

G2-B 最终验收：完整服务 59/59、严格输入追加服务 8/8、完整 HTTP/SSE/Edge 6/6、前端相关 21 项通过；混合目录 P95 29ms。两个隔离测试库及开发库增量迁移至 55 条（90 模型），两端构建与契约检查通过，开发服务恢复。没有重跑 900 秒持续负载，既有 G2-A 结果仅为历史证据。


## SPEC-UNIFIED-OA U0–U3

[路由矩阵与导航契约](../superpowers/specs/2026-09-15-unified-navigation-contract.md)覆盖全站 MOD-001–013。U0/U1 已明确全部实际路由、权威数据、授权、受控动作、旧链接及 Wiki/Harness 保护边界；U2/U3 已完成本批框架实现与验收。导航目录 catalog.ts、持久 MainLayout、区域首页 AreaPage、App 嵌套路由与受保护内容守卫共同承接 UNIFY-AC-01/02/03/07/08/09/10。本批不宣告 U4–U7 或 UNIFY-AC-04/05/06 全站业务整合完成。

U0–U3 验收：前端相关 11 文件 51/51；完整 HTTP/SSE/Edge 7/7（290.525 秒）；两端 lint/类型、前端构建及 baseline/bootstrap/文档检查通过。真实 App 三角色、持久框架、键盘、三宽度、直链/撤权/重试、资源返回均覆盖。桌面桥使用测试替身，未复验真实 Electron 全办案链路；完整业务整合与 UNIFY-AC-07 剩余项仍待后续阶段，详见[实施计划](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)。


## SPEC-UNIFIED-OA U4

[U4 契约](../superpowers/specs/2026-09-15-u4-lead-workspace.md)对应 MOD-004 与 FTN-001/003/004/005：BusinessWorkspacePage / WorkspaceEditor 提供同源入口；CollaborationService.businessTables/createBusinessRecord/businessAction 提供权限过滤目录、幂等创建及受控池动作；WorkspaceBusinessTable 提供授权内关联标签。新业务浏览器流程、权限/回滚服务测试和创建重试单测已通过。U4 最终验收：相关服务 80/80、补充断言后业务/扩展复验 17/17；前端 35 项与浏览器 8 项均有通过记录（初次失败与目标复验经过见全站计划第 7 节）；两端 lint/类型/构建、契约/文档检查通过。100 会话 / 900 秒保存 3600/3600，查询/保存/可见 P95 1196/1336/1356ms，重连 P95 4562ms，撤权 949ms 后读写均 403；原始证据 u4-load-report.json。无新迁移或开发库重置，U5–U7 仍待实施。


## SPEC-UNIFIED-OA U5-A

[U5–U7 契约](../superpowers/specs/2026-09-15-u5-u7-business-unification.md)对应 MOD-005/006、FTN-001/003/004/005：WorkspaceDomainSource 白名单查询正式客户/谈案/合同；BusinessWorkspacePage 与 WorkspaceEditor 提供同源视图和有权详情往返，原领域事务保持。新增 6 项来源/边界测试、原业务 94 项及协作 30 项通过；前端 45 个不同用例、浏览器 9 个不同用例均有通过记录（首次波动与目标复验经过见[计划第 8 节](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)）。构建与契约检查通过；100 会话/900 秒（实际 901.906 秒）负载通过，3,600 次保存全部成功且可见，查询/保存/可见 P95 1188/1339/1369ms，重连 P95 4452ms，撤权 271ms 后读写 403；u5-load-report.json。U5-A 本批阶段提交，U5-B/U6/U7 未完成。

2026-09-15 U5-B：案件同源工作表、身份增量、交付动作和子对象权限对应 MOD-008/010、FTN-001/003/004/005；实现与验证追溯见 [U5–U7 契约](../superpowers/specs/2026-09-15-u5-u7-business-unification.md)和[阶段计划](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)。完整质控/SOP、MAT-04B 主动归档与 U6/U7 不因本批自动完成。

U5-B 最终证据：案件三角色 App 冒烟通过；事件批量写入后案件主链路及原双会话目标复验通过。100 会话/900 秒、3600/3600 保存成功且可见，查询/保存/可见 P95 1116/1182/1202ms；限定测试进程 affinity=0xffff，默认调度失败仍保留。事务回滚、构建与检查及全部中间结果见阶段计划第 9 节。


2026-09-16 U6-A（阶段验收完成）：PAYMENTS/INVOICES/REFUNDS/COSTS 同源适配、FinanceCreatePage/FinanceRecordPage、DomainMutation 持久化创建重试、独立单据/成本 scope 与精确 CURRENCY 分组，对应 MOD-006、FTN-001/003/004/005。领域数据与事务/授权回归见 financial-workspace.test.ts，真实 App 与 MFA 流程见 collaboration-http.test.ts U6-A 场景；当前结果与失败修复记录见[阶段计划第 10 节](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)，U6-A 阶段完成，U6-B/C 与 U7 仍待实施；完整 U6 不因该财务子阶段自动完成。


2026-09-16 U6-B（阶段验收完成）：INVENTORY_ITEMS/MOVEMENTS/STOCKTAKES/PERFORMANCES 四类同源工作表、原接口动作与数据范围、库存三位精确小数、绩效事实身份和并发版本、独立详情办理与工资专用入口，对应 MOD-011/012、FTN-001/003/004/005。实现和回归见 inventory-performance-workspace.test.ts、performance-identity-migration.test.ts、collaboration-http.test.ts U6-B场景及新前端详情/数量/导航测试。原21项服务、原10项HTTP、新10项来源范围、原业务/工资7项、迁移1项、前端34个不同用例均有通过记录；完整HTTP/SSE/Edge12/12及最后目标冒烟1/1通过。类型/lint/构建与契约检查通过，开发库保留数据增量至91模型/58迁移。100会话/901.492秒、3600次保存全部成功可见，查询/保存/可见P95 1109/1171/1201ms，CPU affinity=0xffff；默认调度问题尚未解决。全部中间失败、修复、限制见[阶段计划第11节](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)。U6-C/U7仍待完成，真实Electron当前仅进程及服务连通验收。


### U6-C 实施追踪（验收进度见统一改造计划§12）
CHANNELS → channel-service/channel-scope、channel_dashboard_workspaces与Channel独立办理；Dashboard → dashboard-service 六类获权聚合；通知/审批/治理 → notification-target、App记录定位和原控制器。147个服务/范围/迁移/原业务用例、47个原HTTP用例及通知5项通过记录分别见u6c-services-full-1/recheck、u6c-api-1/recheck、u6c-notification-api。完整浏览器原13项均有通过记录，管理跳转新增1项通过u6c-management-smoke-3。前端101个不同用例均有通过记录（u6c-management-front、u6c-event-front-recheck）。此时负载/开发库/最终提交尚待完成，不将过程记录作为全阶段验收。

U6-C最终补充：第60项权限目录增量与SQL重入通过；开发库60迁移、原业务数量保持。100会话/900秒完整负载通过，条件与指标见阶段计划§12/u6c-load-report.json；最终构建/静态检查通过。服务/迁移不同用例共148项均有通过证据，未将重复复验相加。


2026-09-16 U7（本轮实现与验收完成）：全来源单一表目录、记录权限失效卸载、案件归属候选范围、requireAnyPermission单次下游语义、原审批/成本链接与旧列表清理，对应MOD-001/002/004/005/006/008、FTN-003/004。[统一导航契约](../superpowers/specs/2026-09-15-unified-navigation-contract.md)补清理与回归映射；[阶段计划第13节](../superpowers/plans/2026-09-15-feishu-unified-oa-refactor.md)逐项核对UNIFY-AC-01–10及未实现边界。权限9/9、完整前端303/303、最后布局相关40/40，14个不同真实App场景均有通过记录；完整桌面和浏览器Wiki/Harness流程通过（OA认证、模型及外部响应为夹具），桌面12单元、2集成脚本及9267源文件完整性核对通过。构建/契约检查通过，U7沿用U6-C有条件通用协作负载。各轮失败及限制不因最终通过而删除。U5–U7已有业务整合完成，不代表独立SOP/质检/获客/满意度与G3全部规划能力完成。


2026-09-16：SOP与质检转入独立规划SPEC-SOP-QC-20260916及[SQ1–SQ7计划](../superpowers/plans/2026-09-16-sop-quality-control.md)，覆盖MOD-007/008并关联FTN-001/002/003/005/006。新增规格已明确模板版本、同源UI、对象协作授权、一级审核、抽检整改、满意度量表差异、前期衔接及每阶段冒烟要求。本次仅文档，所有SQ开发阶段待执行，U5–U7已完成状态不变。

2026-09-17 SQ1：MOD-007模板配置部分落地；SQ-AC-01的模板生命周期/双人审核/版本冻结、SQ-AC-03配置范围、SQ-AC-11配置页三宽度、SQ-AC-12本阶段迁移及案件删除保护已验证。物理SopTemplate/SopTemplateVersion/SopInstance骨架、sop服务/控制器、SopTemplateAdapter、SopTemplates页面及治理版本直链对应57个不同后端测试、303前端测试及真实App完整发布停用回滚冒烟；61迁移94模型。详细失败修复及限制见[SQ阶段计划](../superpowers/plans/2026-09-16-sop-quality-control.md)。实例执行/完整SQ-AC及SQ2–SQ7未验收。

2026-09-17 SQ2：MOD-007节点执行工作台增加CaseTask增量与SopTaskAccess、SopExecutionService及SOP_TASKS原生来源，前端SopExecution与原Workspaces/CaseRecordPage衔接。对应SQ-AC-02启动幂等/旧接口保护、SQ-AC-03任务/案件/附件独立授权及共同表、SQ-AC-04依赖/生命周期/逾期/并发、SQ-AC-11三宽度及SQ-AC-12增量迁移。具体结果见SQ阶段计划；SQ3–SQ7仍待后续验收。


2026-09-17 SQ3已验收：SopSubmission/SubmissionAttachment、ExpertGuidance和QualityReview落地；SopSubmissionService与原ApprovalInstance/Sync服务完成冻结版本、一级检查、退回修订及同步失败重试，SopExecution/SubmissionPage提供真实办理入口。对应SQ-AC-05及SQ-AC-03/04/11/12本阶段范围；64迁移99模型。实际测试与失败修复见SQ阶段计划，二级抽检、专项分析及前期衔接仍属SQ4–SQ7，不将一级审核视为完整质检交付。
