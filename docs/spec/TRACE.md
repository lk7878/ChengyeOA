---
id: TRACE
title: 模块级追溯矩阵
type: meta-spec
status: approved
created: 2026-07-28
last_updated: 2026-09-14
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
| MOD-001 | 组织权限 | 角色权限/系统管理员权限设计 | SPEC-002/003/004/005；[SPEC-003-A](../superpowers/specs/2026-09-11-organization-management-extension.md) | ✅原基线已验收；003-A 本地自动化通过，浏览器手工验收未执行 |
| MOD-002 | 系统配置中心 | 动态字段表格与模板配置 | — | ⬜待开发 |
| MOD-003 | 品牌获客 | 页面与接口清单(渠道部分) | — | ⚠️有代码无SPEC |
| MOD-004 | 线索销转 | 页面与接口清单 | SPEC-009(部分,已验收2026-07-30); SPEC-010(立项,CRM-07) | ⚠️部分落地 |
| MOD-005 | 客户主数据 | 页面与接口清单 | SPEC-009(部分,已验收2026-07-30) | ⚠️部分落地 |
| MOD-006 | 合同财务 | SPEC-010设计(已批准2026-07-30) | SPEC-010(立项,待实施;CON-01~07+FIN-01) | 📋有设计无SPEC |
| MOD-007 | 专业团队SOP | 三大团队SOP字段清单 | — | ⚠️有代码无SPEC |
| MOD-008 | 案件交付质控 | 三大团队SOP字段清单 | [SPEC-CASE-20260914](../superpowers/specs/2026-09-14-case-management-extension.md)；[SPEC-CASE-CRUD-20260914](../superpowers/specs/2026-09-14-case-management-crud.md)；[SPEC-AI-DESKTOP-20260913](../superpowers/specs/2026-09-13-unified-desktop-local-harness.md) | ✅案件建档、客户联动、完整字段展示、查询修改及受保护删除已验证；⬜MAT-04B 待开发 |
| MOD-009 | 满意度转介绍 | — | — | ⬜待开发 |
| MOD-010 | AI录音文件 | 文件录音AI任务设计 | SPEC-AI-DECOUPLED/AI-UI 历史已实施；[SPEC-AI-DESKTOP-20260913](../superpowers/specs/2026-09-13-unified-desktop-local-harness.md) 实施中 | 📋录音专项待开发；AI-08 桌面基础、AI-09 只读查询与 AI-10 视觉链路已验证；完整交付待验收 |
| MOD-011 | 组织人事 | 数据库核心表设计 | SPEC-003(部分) | ⚠️有代码无SPEC |
| MOD-012 | 驾驶舱 | — | — | ⚠️有代码无SPEC |
| MOD-013 | 自动化审批审计 | 审计自动化/审批消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC |

## 横切契约（FTN-001 ~ FTN-007）

| 编号 | 契约 | 专项设计 | 已落地SPEC | 现状 |
|---|---|---|---|---|
| FTN-001 | 数据模型 | 数据库核心表设计草案 | SPEC-001/003 | ✅已验收 |
| FTN-002 | 状态机字典 | 状态机与业务字典设计 | — | ⬜待开发(底座49model已建) |
| FTN-003 | RBAC数据范围 | 角色权限与数据范围设计 | SPEC-004 | ✅已验收 |
| FTN-004 | API事务一致性 | API规范错误码事务边界 | 各SPEC散落 | ✅已验收 |
| FTN-005 | 事件驱动模型 | 数据流转事件中心设计 | SPEC-007/008 | ✅已验收 |
| FTN-006 | 审批任务通知 | 审批实例任务消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC |
| FTN-007 | 非功能需求 | — | SEC-SPEC-001/006 | ⚠️有代码无SPEC |

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
