# SPEC-041 审批表达式审批人 + 直属上级规则（SUPERVISOR Approver）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「根据你的推荐继续」——审批中心缺的高价值能力：按申请人报告线自动路由到直属上级）｜ 需求来源：审批中心已建（SPEC-013~025），approverRule 仅支持 USER/ROLE 两型；「表达式审批人/上级规则」多份 closeout §9 照录为另行 ｜ 前置：SPEC-003（员工报告线 `EmployeeReportingLine` 基础设施）、SPEC-013/016/017/018（approverRule + nodeSchema + 定义 CRUD）
设计权威：本文档 ｜ 计数基线：SPEC-039 终态（迁移 29/模型 60/权限 132/事件 15/路由 28）

## 1. 背景与目标

审批中心 `approverRule` 仅支持 `USER`（指定人）/ `ROLE`（角色成员）两型——**无法按申请人动态路由**（如「转到直属上级审批」「转部门主管」）。员工报告线基础设施已建（`EmployeeReportingLine`，SPEC-003：employeeId/managerEmployeeId + 活跃窗口）。**目标**：approverRule 扩展 `SUPERVISOR` 规则（按申请人报告线解析直属上级为审批人，支持 `levels` 多级上溯），审批定义与申请流转端到端可用。**零结构变更**（approverRule 为 JSON 配置扩展，无迁移/模型/权限/路由变更）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | ApproverRule +SUPERVISOR | `{ type: 'SUPERVISOR'; levels?: number }`（levels 缺省 1=直属上级，可 2=上级的上级） |
| D2 | 解析 | `resolveApproverIds(rule, applicantId, db)` +SUPERVISOR 分支：applicant userId → `User.employeeId` → 报告线步行 `levels` 级（`employee_reporting_line` where employeeId=当前 + endedAt null → managerEmployeeId）→ 上级 employee → 绑定用户 → approverIds；任一步缺失（无 employee/无报告线/无绑定账号）→ 400 `APPROVAL_ASSIGNEE_INVALID` |
| D3 | 定义校验 | `assertApproverRuleValid`（definition-service）+SUPERVISOR：levels 若存在必须整数 ≥1；畸形 → 400 |
| D4 | 传递 applicantId | `applyForApproval` 节点[0] 传 actor.actorUserId；节点推进（process）传 instance.applicantId |
| D5 | 前端最小 | 定义编辑器 approverRule JSON 已通用（后端接受 SUPERVISOR 即可用）；审批详情/待办显示规则名「直属上级」 |
| D6 | 零结构变更 | 迁移 29/模型 60/权限 132/事件 15/路由 28 全不变 |

## 3. 实现

### 3.1 后端

- `approval-types.ts`：`ApproverRule` 联合 +`{ type: 'SUPERVISOR'; levels?: number }`。
- `approval-instance-service.ts`：
  - `resolveApproverIds(rule, applicantId, db)` 签名加 `applicantId`；+SUPERVISOR 分支（DB 查询报告线 + 用户绑定，`db` 透传事务客户端）。
  - `applyForApproval`：`resolveApproverIds(chain[0].approverRule, this.actor.actorUserId)`。
  - 节点推进（processTask 下节点）：`resolveApproverIds(nextNode.approverRule, instance.applicantId, tx)`。
- `approval-definition-service.ts` `assertApproverRuleValid`：+SUPERVISOR 分支（levels 可选整数 ≥1）。

### 3.2 前端（最小）

- `ApprovalCenterPage.tsx` 定义编辑器：approverRule 类型选项 +「直属上级（SUPERVISOR）」（JSON 编辑器已通用，补充类型提示）。
- 审批详情/待办：approverRule 显示「直属上级」标签（ROLE/USER 既有显示）。

## 4. 计数影响

**零结构变更**：迁移 29 / 模型 60 / 权限 132 / 事件 15 / 路由 28 全不变（approverRule JSON 扩展）。后端测试 +N（~6），前端测试 +N（~1）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | SUPERVISOR 解析（报告线直接上级/levels 2 上溯/无报告线 400/无账号 400/无 employee 400）/ 空集 400 |
| API | 定义 CRUD SUPERVISOR 校验通过/畸形 400 / apply 走上级审批人（端到端） |
| 前端 | 定义编辑器 SUPERVISOR 类型 / 审批详情「直属上级」显示 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 部门主管/维度表达式（除直属上级外）——另行（表达式引擎）。
- 报告线离职/转岗历史追溯——沿用活跃线（endedAt null）。
- 前端定义编辑器结构化改造（JSON 文本 → 表单化）——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 用户授权自主推进（「根据你的推荐继续」） |
