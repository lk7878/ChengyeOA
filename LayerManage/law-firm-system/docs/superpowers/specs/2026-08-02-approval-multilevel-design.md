# SPEC-016 审批中心多级审批（Approval Multi-Level）设计

日期：2026-08-02 ｜ 状态：用户批准（§1-4 全节 + 后续授权继续）｜ 需求来源：专项设计「审批实例任务与消息回调」§2-4（Definition nodeSchema/Instance 逐节点）+ PRD §4.12 复杂版多级审批 + SPEC-013 closeout follow-up「审批中心深化」
设计权威：本文档 ｜ 实施计划：待 writing-plans

## 1. 背景与目标

审批中心（SPEC-013 核心流 + SPEC-015 角色供给）已端到端可用，但为单级（Definition 顶层 approverRule → 一次 N Task → 任一通过定稿）。专项设计 §3-4 与 PRD §4.12 复杂版定义**多级审批**（多节点链，前一节点 APPROVED 才进入下一节点）。合同变更（主管初审→合伙人终审）、费用报销（大额复核）等真实场景需要多节点链。

**目标**：多级审批落地——Definition 增 `nodeSchema`（多节点链）、Instance 逐节点流转（currentNode）、Task 按节点生成；末节点 APPROVED 定稿。**会签/转交/超时/Definition CRUD/全组织视图 均 OUT**。

## 2. 核心决策（Q1-5）

| # | 决策 | 值 |
|---|---|---|
| Q1 | nodeSchema | `ApprovalDefinition.nodeSchema Json?`（可空）——**缺省 = 单节点链（顶层 approverRule 向后兼容，5 现有种子零改动）**；有 = 多节点链 `[{name, approverRule}]` |
| Q2 | currentNode | `ApprovalInstance.currentNode Int @default(0)`（当前活动节点下标） |
| Q3 | apply | 链 = nodeSchema ?? [顶层 approverRule]；建 Instance PENDING + 节点[0] 的 Task（N 审批人） |
| Q4 | process | 节点内任一通过；节点 APPROVE → 非末节点 → currentNode++ + 生成下节点 Task + 实例仍 PENDING；末节点 → APPROVED 定稿；REJECT 任一节点 → REJECTED + 取消当前/未来 PENDING task |
| Q5 | 种子升级 | **bootstrap +MANAGER 角色**（第 5 BUSINESS 角色，主管初审用）+ **CONTRACT_CHANGE 升为多节点链**（主管初审→PARTNER 终审）——provisioning，使能力真实落地 |

**零模型计数变更**（60 不变，+2 列）；迁移 23→**24**（expand：nodeSchema/currentNode）。

## 3. 数据模型

- `ApprovalDefinition` +`nodeSchema Json?`（nodeSchema 权威；缺省=顶层 approverRule 单节点——向后兼容）。
- `ApprovalInstance` +`currentNode Int @default(0)`。
- 迁移 `20260802100000_approval_multilevel_expand`：ALTER 两表 +2 列（nodeSchema Json?/currentNode Int not null default 0）；无新索引。
- **bootstrap +MANAGER**（主管，type='BUSINESS'/status='ENABLED'）+ approval.read/process 授权（沿 SPEC-015 模式）。
- **CONTRACT_CHANGE 种子升级**（provisioning）：approverRule → nodeSchema=[{name:'主管初审', approverRule:{type:'ROLE',roleCodes:['MANAGER']}}, {name:'合伙人终审', approverRule:{type:'ROLE',roleCodes:['PARTNER']}}]。

## 4. 行为细节

- **apply**：链构建（nodeSchema ?? [顶层 approverRule]）→ 自审校验（申请人不得为节点[0] 审批人）→ Instance PENDING + 节点[0] Task + created 事件 + APPLY 审计（含 currentNode:0）。
- **process**：任一通过（节点内）；节点 APPROVE → 非末节点：currentNode++ + create 下节点 Task（**禁止自审适用于全部节点**——下节点审批人含申请人 → SELF_REVIEW_FORBIDDEN 409）+ 实例仍 PENDING；末节点 → APPROVED + completed 事件 + PROCESS 审计；REJECT → REJECTED + 取消当前节点+未来 PENDING task + completed(REJECTED)。
- **withdraw**：实例 PENDING（任意节点阶段）→ WITHDRAWN + 当前/未来 PENDING task CANCELLED + completed(WITHDRAWN)。
- **事件**：created/completed 不变（节点推进不产事件——observability 经视图 currentNode+tasks）。
- **视图**：ApprovalInstanceView +currentNode + 节点进度（tasks 含 nodeName）。

## 5. 前端

- 审批中心页：详情弹窗显示当前节点/节点进度（tasks 分组 by nodeName + currentNode tag）；待办 Tab 显示节点名。
- 现有列表/表单/动作不变（多级对既有 UI 透明——仅详情/待办显示增强）。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 领域 | 链构建（nodeSchema 缺省单节点/多节点） |
| 服务 | 多节点 apply（节点[0] Task 生成/currentNode=0）；节点推进（approve 节点[0]→currentNode=1+下节点 Task）；末节点定稿；REJECT 任一节点→REJECTED+取消；下节点自审 409；单节点向后兼容零回归 |
| 事件 | created/completed 不变；多节点 completed 仅在末节点定稿 |
| API/前端 | 详情 currentNode 显示/待办节点名 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库且 `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

迁移 **23→24**（1 expand）；模型 60 不变（+2 列）；权限 121（+0——MANAGER 角色不增权限码，复用 approval.read/process）；事件 15 不变；路由不变；后端测试 +N（增量）。

## 8. 范围边界（明确 OUT）

会签（节点内多人）、转交/加签、超时升级、Definition CRUD（approval.manage）、全组织视图、审批人表达式、撤回（除本人 PENDING）、节点级事件。均独立 follow-up。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| Q1-Q5 | 见 §2 | 用户批准（§1-4 全节 + 后续授权继续） |
