# SPEC-023 审批全组织视图（Org-Wide View）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-016/017/018/019/020/021 closeout §9「审批中心深化余项——全组织视图（approval.manage 仅定义管理，视图全量归另行）」
设计权威：本文档 ｜ 前置：SPEC-013（listInstances actor 作用域）+ SPEC-017（approval.manage 权限码）+ SPEC-022（权限排序一致性）

## 1. 背景与目标

审批中心已具备完整处置能力（多级/会签/定义管理/转交/加签/超时升级），但**列表视图始终受 actor 作用域限制**——`listInstances` 三 role（APPLIED/TODO/DONE）分别按 applicantId/assigneeId 过滤，管理员无法纵览全组织审批状况（无全量视图，运维/合规需逐人查询）。

**目标**：全组织视图——`approval.manage` 权限用户可查看**全组织审批实例列表**（突破 applicantId/assigneeId actor 作用域），前端「全部审批」Tab。**零结构变更**（复用 listInstances + role 扩展，无 schema/迁移/权限/事件/路由变更——approval.manage 已存在）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限 | 全组织视图挂 **`approval.manage`**（管理权限——定义管理已用，扩展至全量视图；不新增权限码，权限 124 不变） |
| D2 | 入口 | `listInstances` 增 role 值 **`'ALL'`**（四 role：APPLIED/TODO/DONE/ALL）——ALL = 无 actor 过滤（全组织），其余三 role 语义不变 |
| D3 | 门控 | role='ALL' 时 requireAction **`approval.manage`**（其余三 role 仍 approval.read）——**动态权限**：同一路由按 role 值区分门控 |
| D4 | 语义 | role='ALL' → where 无 actor 过滤（仅分页），按 createdAt desc 全量 |
| D5 | 前端 | ApprovalCenterPage 增「全部审批」Tab（approval.manage 门控——无码用户不见）；与既有三 Tab 复用列表/详情/操作（操作仍按 actor 语义——管理员可见全量但动作仍限自身 assignee） |
| D6 | 详情 | `getInstance` 权限语义：approval.manage 用户可查看任意实例详情（现有 404 对非申请人/非审批人——**全组织视图需 manage 用户可读详情**） |
| D7 | 审计 | 列表/详情为读操作不落审计（沿既有）；动作（process/forward/addSigners/withdraw）仍按既有 actor 语义（管理员仅可处理自身 task，不因 manage 扩大动作权限） |
| D8 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（role 枚举扩展 + 动态门控） |

## 3. 服务层（approval-instance-service listInstances/getInstance）

### 3.1 listInstances role='ALL'

```ts
const role = normalizeAllowedValue(query.role, [...APPROVAL_ROLE_FILTERS, 'ALL']);  // 四值
if (role === 'ALL') {
  this.authorization.requireAction(this.authorizationContext, 'approval.manage');
} else {
  this.authorization.requireAction(this.authorizationContext, 'approval.read');
}
const where: Prisma.ApprovalInstanceWhereInput = {};
if (role === 'APPLIED') {
  where.applicantId = this.actor.actorUserId;
} else if (role === 'TODO') {
  where.tasks = { some: { assigneeId: this.actor.actorUserId, status: 'PENDING' } };
} else if (role === 'DONE') {
  where.tasks = { some: { assigneeId: this.actor.actorUserId, status: { not: 'PENDING' } } };
} // role==='ALL' → where 空（全组织）
```

### 3.2 getInstance 权限扩展

现有：`getInstance` 申请人或任一 task 审批人可见，其余 404。扩展：**approval.manage 用户可见任意实例**（D6）——`requireAction(approval.read)` 后，若用户无 manage 且非申请人/非审批人 → 404；有 manage → 放行。

```ts
async getInstance(id: string): Promise<ApprovalInstanceView> {
  this.authorization.requireAction(this.authorizationContext, 'approval.read');
  // ...探查实例 + tasks...
  const isApplicant = instance.applicantId === this.actor.actorUserId;
  const isAssignee = instance.tasks.some(t => t.assigneeId === this.actor.actorUserId);
  const hasManage = this.authorization.hasAction(this.authorizationContext, 'approval.manage');  // 或 requireAction 变体
  if (!isApplicant && !isAssignee && !hasManage) {
    throw APPROVAL_INSTANCE_NOT_FOUND 404;
  }
  return view;
}
```

**授权探测**：`authorization.hasAction`（若服务有该方法）或 try/catch requireAction——实现时按既有 AuthorizationService API 形态（检查是否有 hasAction 或需 try/catch）。

### 3.3 动作权限不扩大

`processTask`/`forwardTask`/`addSigners`/`withdrawInstance` 的 task 探查（assigneeId=actor / applicantId=actor）与 approval.process/apply 门控**全部不变**——管理员 manage 权限不授予处理他人任务的动作权（D7）。

## 4. 控制器 + 路由

- `controller/approval.ts`：`index`（listInstances）已接收 role 透传（前端 role 参数）——**零改动**（role='ALL' 经既有 role 参数流到 service）。
- `getInstance` 权限扩展在 service 层——controller 零改动。
- **路由零变更**（GET /approvals 与 GET /approvals/:id 既有）。

## 5. 前端（ApprovalCenterPage）

- **「全部审批」Tab**（approval.manage 门控）：`tabItems` 条件追加 `{key:'ALL', label:'全部审批'}`——无 manage 用户不见 Tab。
- 列表/详情/操作复用：管理员看全量列表 + 详情（getInstance manage 放行）；操作按钮仍按 actor 语义（待办行 myPendingTask 判定——管理员对非自身 task 无操作按钮）。
- `api/approval.ts` `ApprovalRoleFilter` +`'ALL'`。
- 既有 26 例零回归。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务（listInstances） | role='ALL' 无 manage → 403 / role='ALL' 有 manage → 全组织列表（含非本人实例，分页正确）/ 三既有 role 零回归 |
| 服务（getInstance） | manage 用户可见任意实例详情 / 非 manage 非申请人非审批人仍 404 / 既有零回归 |
| 前端 | 全部审批 Tab 门控（无 manage 隐藏）/ 列表渲染 / 既有 26 例零回归 |
| 回归 | approval 域既有（instance 73 + definition 17 + api 23 + policy/catalog 34 + events 15）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 11 全不变；后端测试 +N（list ALL ~2 + getInstance manage ~2）、前端 +M（Tab）。

## 8. 范围边界（明确 OUT）

- 全组织视图的过滤/搜索（按申请人/类型/状态筛选）——另行。
- 全组织动作（管理员代处理他人任务）——明确 OUT（动作权限不扩大）。
- 导出/报表/统计——另行。
- 审批人维度驾驶舱——另行。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D8 | 见 §2 | 无人值守自主立项（用户授权） |
