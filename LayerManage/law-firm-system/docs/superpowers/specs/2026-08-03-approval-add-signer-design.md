# SPEC-020 审批加签（Add Signer）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-016/017/018/019 closeout §9「审批中心深化余项——加签（添加额外审批人，非替换 assigneeId）」
设计权威：本文档 ｜ 前置：SPEC-013（Task 模型）+ SPEC-016（多级 currentNode）+ SPEC-018（会签 mode）+ SPEC-019（转交 assigneeId 变更）

## 1. 背景与目标

审批中心已有：多级推进（SPEC-016）、会签（SPEC-018）、定义管理（SPEC-017）、转交（SPEC-019）。但审批人**无法主动邀请额外审批人参与**——审批人认为任务需他人共同决策/知情时，只能转交（替换）或等待，无「追加协办」能力。

**目标**：加签——当前节点的 PENDING task 审批人可向**同一节点**追加额外审批人（创建新 PENDING task，同 nodeName），协同审批（任一通过或会签按节点 mode 语义）。**零结构变更**（复用 ApprovalTask 既有字段，无 schema/迁移/权限/事件变更；仅 approval 域路由 10→**11** +1 条非结构变更）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限 | 复用 **`approval.process`**（处理任务码）——加签是任务处置动作，不新增权限码（权限 122 不变） |
| D2 | 主体 | 仅当前节点 **PENDING task 的 assigneeId=actor** 可加签（沿 processTask task 探查语义：非我 404）——**任一当前节点审批人都可加签**（非仅申请人） |
| D3 | 目标 | `addSignerUserIds` 必填非空数组（1-10 人），每人 normalizeRequiredText 1-100——**校验目标 ≠ 自己**（加签给自己无意义 → 400）；**目标 ≠ 申请人**（禁止自审不变量 → 409 `APPROVAL_SELF_REVIEW_FORBIDDEN`）；目标去重 |
| D4 | 语义 | 加签创建**同节点新 PENDING task**（nodeName=当前节点名，assigneeId=目标），实例 currentNode/status/version 不变；不产 completed 事件；不建 callbackAction；审计 `APPROVAL_TASK_ADD_SIGNER` |
| D5 | 节点推进 | 加签后该节点 PENDING task 数增加——**任一通过（ANY）**：任一审批人 APPROVE 即推进（新 task 并入节点，首个 APPROVE 取消该节点余 PENDING）；**会签（ALL）**：全部（含新增）APPROVED 才推进（remainingPending 判定天然含新 task）——**与既有 processTask 语义自动兼容** |
| D6 | 幂等 | 加签不建 callbackAction；重复 POST 会重复创建（**不做去重**——前端防连点 + 幂等 key 可选；低风险接受，列 follow-up 可加 callbackKey） |
| D7 | 审计 | operation_log action `APPROVAL_TASK_ADD_SIGNER`（targetType APPROVAL_TASK，newValues 含 taskId/addedUserIds/hasReason） |
| D8 | 事件 | **不产 outbox 事件**（非定稿/推进，observability 经视图 tasks 增加承载——沿「节点推进不产 completed」语义） |
| D9 | 前端 | 待办行/详情弹窗 PENDING task 增「加签」操作（approval.process 门控）——Modal 输入目标 userIds（可多个，逗号分隔）→ 提交加签 |
| D10 | 路由 | `POST /api/v1/approvals/:id/add-signers`（approval.process，`:id`=taskId）——沿 process 路由形态 |
| D11 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（路由 approval 域 10→11 +1 条，非结构变更） |

## 3. 服务层（approval-instance-service addSigners）

```ts
interface AddSignersInput {
  addSignerUserIds: string[];   // 必填非空数组（1-10）
  remark?: string;
}

async addSigners(taskId: string, input: AddSignersInput): Promise<ApprovalInstanceView> {
  this.authorization.requireAction(this.authorizationContext, 'approval.process');
  const userIds = normalize array（必填 1-10，每项 1-100，去重）;
  // task 探查（id + assigneeId=actor，非我 404）→ 沿 processTask :484 语义
  const task = await this.prisma.approvalTask.findFirst({ where: { id: taskId, assigneeId: actor } });
  if (!task) throw APPROVAL_TASK_NOT_FOUND 404;
  if (task.status !== 'PENDING') throw APPROVAL_STATE_INVALID 409;
  const instance = await this.prisma.approvalInstance.findUniqueOrThrow({ where: { id: task.instanceId } });
  if (instance.status !== 'PENDING') throw APPROVAL_STATE_INVALID 409;
  // 校验：目标 ≠ 自己（400）、目标 ≠ 申请人（409 自审）、目标去重
  for (const uid of userIds) {
    if (uid === actor.actorUserId) throw 400 APPROVAL_ASSIGNEE_INVALID（加签给自己无意义）;
    if (uid === instance.applicantId) throw 409 APPROVAL_SELF_REVIEW_FORBIDDEN（禁止自审不变量）;
  }
  // 事务：创建 N 个同节点 PENDING task + 审计
  await this.prisma.$transaction(async tx => {
    for (const uid of userIds) {
      await tx.approvalTask.create({ data: { instanceId, nodeName: task.nodeName, assigneeId: uid, status: 'PENDING' } });
    }
    await tx.operationLog.create({ action:'APPROVAL_TASK_ADD_SIGNER', targetType:'APPROVAL_TASK', targetId: task.id, newValues: { taskId, addedUserIds: userIds, hasReason: remark !== null } });
  });
  return this.loadInstanceView(this.prisma, task.instanceId);
}
```

- **并发安全**：加签前 task 探查 + 实例 status 校验（非 PENDING → 409）；创建新 task 无版本竞争（新行）；与 processTask 并发时——若加签与推进竞速，加签创建的 task 可能在推进后成孤儿 PENDING（currentNode 已推进）——**需分析**：processTask 推进会 CANCELLED 当前节点余 PENDING，但加签若在推进后创建新 task 则该 task 落在已推进节点下、currentNode 已+1 → 孤儿。**缓解**：加签也取实例行 FOR UPDATE（沿 processTask 锁点），与推进互斥——加签先锁则推进等待，推进先锁则加签看到 currentNode 已变 → 加签应在锁后重验 `task.nodeName === chain[currentNode].name`（仍当前节点）否则 409 或幂等重放。**设计 D4.1**：加签在事务内首把锁 = 实例行 FOR UPDATE + 锁后重验 task 仍 PENDING 且 nodeName===chain[currentNode].name。
- **节点推进兼容**：ANY 节点加签后首个 APPROVE 取消该节点全部 PENDING（含新增）；ALL 节点加签后 remainingPending 计数含新增——均自动兼容，无逻辑改动。

## 4. 控制器 + 路由

- `controller/approval.ts` +`addSigners` 方法（:id=taskId，body {addSignerUserIds, remark?}）——沿 `process` 方法形态。
- `router.ts` +`POST /api/v1/approvals/:id/add-signers`（approval.process）——approval 域路由 10→**11**。

## 5. 前端（ApprovalCenterPage）

- **待办行/详情弹窗**（approval.process 门控）：PENDING task 操作区增「加签」按钮 → Modal（目标 userIds 逗号分隔 Input，required+校验）→ `addSigners(taskId, {addSignerUserIds})` → 成功 message.success + 刷新。
- **api/approval.ts** +`addSigners(taskId, data)`（POST /v1/approvals/:id/add-signers）+ `AddSignersInput` 类型。
- 既有 23 例零回归；防连点（confirmLoading）。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 加签成功（N 新 PENDING task 同 nodeName + 实例 currentNode/status 不变 + 审计 ADD_SIGNER + 零事件）/ 非我 404 / 非 PENDING 409 / 目标含自己 400 / 目标含申请人 409 / 目标空 400 / 目标去重（重复 userId 仅建 1 task）/ 加签后 ANY 任一通过推进 / 加签后 ALL 会签全签推进 / 加签与推进并发（FOR UPDATE 互斥） |
| 权限 | 无 approval.process → 403 |
| 路由 | POST /add-signers 门禁 + 语义（:id=taskId） |
| 前端 | 加签按钮门控 / Modal 提交参数钉死 / 成功刷新 / 既有零回归 |
| 回归 | approval 域既有（instance 62 + definition 17 + policy/catalog 34 + api 21）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 122/事件 15 全不变；路由 approval 域 10→**11**（+1 条 add-signers，非结构变更）；后端测试 +N（服务 ~10 + 权限 ~1 + 路由 ~2）、前端 +M。

## 8. 范围边界（明确 OUT）

- 加签目标可见性限制（目标须为实例可见审批人/组织成员）——列 follow-up。
- 加签幂等 key（callbackKey）——列 follow-up。
- 加签通知（消息/提醒目标人）——列 follow-up（outbox 新事件类型）。
- 批量转交/转交历史查询/超时升级/全组织视图——另行立项。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D11 + D4.1 | 见 §2/§3 | 无人值守自主立项（用户授权） |
