# SPEC-019 审批转交（Forward）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-016/017/018 closeout §9「审批中心深化余项——转交」
设计权威：本文档 ｜ 前置：SPEC-013（Task 模型）+ SPEC-016（多级 currentNode）+ SPEC-017（Definition CRUD + approval.manage）+ SPEC-018（会签 mode）

## 1. 背景与目标

审批中心已有：多级节点推进（SPEC-016）、会签（SPEC-018）、定义管理（SPEC-017）。但**审批人无法把待办任务转交给他人**——审批人请假/出差/职责移交时，待办 PENDING task 只能滞留（无人可代审），或需 admin 绕过。

**目标**：转交——审批人（PENDING task 的 assigneeId=actor）可将自己的待办任务转交给其他审批人（assigneeId 改为目标人），任务状态/节点/实例语义不变。**零结构变更**（Task.assigneeId 既有字段可变，无 schema/迁移/权限/事件变更）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限 | 复用 **`approval.process`**（处理任务码）——转交是任务处置动作之一，不新增权限码（权限 122 不变） |
| D2 | 主体 | 仅 PENDING task 的 **assigneeId=actor** 可转交（沿 processTask 的 task 探查语义：非我 404） |
| D3 | 目标 | 转交给任意 userId（`forwardToUserId` 必填，normalizeRequiredText 1-100）——**校验目标 ≠ 自己**（转交给自己无意义 → 400）；目标是否须为实例可见审批人——**不强制**（转交是职责移交，目标人接任后按既有 assignee 语义处理；若需限制可见性列 follow-up） |
| D4 | 状态 | 转交不改变 task.status（仍 PENDING）、nodeName、instance.currentNode、实例 status——纯 assigneeId 变更 |
| D5 | 版本 | task version+1（转交系任务状态变更，沿既有 version 语义）；实例 version 不变（节点未推进） |
| D6 | 审计 | operation_log action `APPROVAL_TASK_FORWARD`（targetType APPROVAL_TASK，newValues 含 taskId/fromUserId/toUserId/hasReason） |
| D7 | 事件 | **不产 outbox 事件**（非定稿/推进，observability 经视图 assigneeId 变更承载——沿「节点推进不产 completed」语义） |
| D8 | 幂等 | 转交不建 callbackAction（非 process 决策）；task 已非 PENDING → 409 `APPROVAL_STATE_INVALID` |
| D9 | 前端 | 待办行/详情弹窗 PENDING task 增「转交」操作（approval.process 门控）——Modal 输入目标人 userId → 提交转交 |
| D10 | 路由 | `POST /api/v1/approvals/:id/forward`（approval.process，`:id`=taskId）——沿 process 路由形态 |
| D11 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（路由 approval 域 9→10 +1 条，非结构变更） |

## 3. 服务层（approval-instance-service forwardTask）

```ts
interface ForwardTaskInput {
  forwardToUserId: string;   // 必填目标审批人
  remark?: string;
}

async forwardTask(taskId: string, input: ForwardTaskInput): Promise<ApprovalInstanceView> {
  this.authorization.requireAction(this.authorizationContext, 'approval.process');
  const forwardToUserId = normalizeRequiredText(input.forwardToUserId, 1, 100);
  // task 探查（id + assigneeId=actor，非我 404）→ 沿 processTask :484 语义
  const task = await this.prisma.approvalTask.findFirst({ where: { id: taskId, assigneeId: actor.actorUserId } });
  if (!task) throw APPROVAL_TASK_NOT_FOUND 404;
  if (task.status !== 'PENDING') throw APPROVAL_STATE_INVALID 409;
  if (forwardToUserId === actor.actorUserId) throw 400（转交给自己无意义）;
  const flipped = await this.prisma.approvalTask.updateMany({
    where: { id: task.id, version: task.version, status: 'PENDING' },
    data: { assigneeId: forwardToUserId, version: { increment: 1 } },
  });
  if (flipped.count === 0) throw APPROVAL_STATE_INVALID 409（并发竞争）;
  // 审计
  await operationLog.create({ action:'APPROVAL_TASK_FORWARD', targetType:'APPROVAL_TASK', targetId: task.id, newValues: {...} });
  return this.loadInstanceView(this.prisma, task.instanceId);
}
```

- 需事务包装（task updateMany + 审计同事务）——沿既有 `$transaction` 形态。
- **不产事件**（D7）；**不建 callbackAction**（D8）；实例 currentNode/status/version 不变（D4/D5）。

## 4. 控制器 + 路由

- `controller/approval.ts` +`forward` 方法（:id=taskId，body {forwardToUserId, remark?}）——沿 `process` 方法形态。
- `router.ts` +`POST /api/v1/approvals/:id/forward`（approval.process）——approval 域路由 9→**10**。

## 5. 前端（ApprovalCenterPage）

- **待办 Tab 行**（approval.process 门控）：PENDING task 操作区增「转交」按钮 → Modal 输入目标人 userId → `forwardTask(taskId, {forwardToUserId})` → 成功 message.success + 刷新列表。
- **详情弹窗**：任务表 PENDING task 行增「转交」操作（同 Modal）。
- **api/approval.ts** +`forwardTask(taskId, data)`（POST /v1/approvals/:id/forward）+ `ForwardTaskInput` 类型。
- 既有 20 例零回归。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 转交成功（assigneeId 变更 + version+1 + 实例 currentNode/status 不变 + 审计 APPROVAL_TASK_FORWARD + 零事件）/ 非 PENDING 409 / 非我 404 / 转交给自己 400 / 目标 userId 空 400 / 并发竞争 409 |
| 权限 | 无 approval.process → 403 |
| 路由 | POST /forward 门禁 + 语义（:id=taskId） |
| 前端 | 转交按钮门控 / Modal 提交 API 参数钉死 / 成功刷新 / 既有零回归 |
| 回归 | approval 域既有（instance 55 + definition 17 + policy/catalog 34 + api 18）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 122/事件 15 全不变；路由 approval 域 9→**10**（+1 条 forward，非结构变更）；后端测试 +N（服务 ~5 + 权限 ~1 + 路由 ~2）、前端 +M。

## 8. 范围边界（明确 OUT）

- 加签（添加额外审批人，非替换）——另行立项。
- 转交目标可见性限制（目标须为实例审批人/组织成员）——列 follow-up。
- 批量转交/转交历史查询。
- 超时升级/全组织视图（审批中心深化余项——另行立项）。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D11 | 见 §2 | 无人值守自主立项（用户授权） |
