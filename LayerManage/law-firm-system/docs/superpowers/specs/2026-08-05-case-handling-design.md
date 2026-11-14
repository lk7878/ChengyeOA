# SPEC-033 案件办理域核心（Case Handling Core）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进 ｜ 需求来源：业务链「案件办理与交付」——Schema 已建（Case/CaseTask/Communication 模型 + 遗留原型 controller），缺正规服务层/权限/测试
设计权威：本文档 ｜ 前置：SPEC-009（客户主数据）、SPEC-010（合同）、Spec-004（RBAC 权限框架 + provisioning 迁移纪律）

## 1. 背景与目标

业务链「案件办理与交付」已有数据模型（Case/CaseTask/Communication）与**遗留原型 controller**（`controller/case.ts`，直连 ctx.prisma、无权限门禁、无校验/审计/测试）。**目标**：构建正规**案件办理域**——新增 case 权限码 + 服务层（Case 生命周期 + CaseTask 状态机 + Communication）+ controller 重构（替代原型）+ 路由门禁 + 测试。**结构性变更**（新增权限码 + provisioning 迁移——权限 124→**130**、迁移 26→**27**、模型 60/事件 15/路由 15→**22**）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限码 | +6：`case.read`（列表/详情）/ `case.create` / `case.update`（编辑/分配律师/优先级）/ `case.close`（结案）/ `case.task.manage`（任务增改）/ `case.communication.create`（沟通记录）——catalog + provisioning 迁移（INSERT ON CONFLICT DO NOTHING） |
| D2 | Case 生命周期 | 状态机 PENDING（待受理）→ ACCEPTED（已受理）→ PROCESSING（办理中）→ CLOSED（已结案）→ ARCHIVED（归档）——create=PENDING；close=PENDING/ACCEPTED/PROCESSING → CLOSED（closedAt+result+satisfaction 可填）；终态 CLOSED/ARCHIVED 动作拒 |
| D3 | CaseTask 状态机 | PENDING → IN_PROGRESS → COMPLETED（OVERDUE 查询时推导：dueDate<P 且非完成——不落库）；更新含状态翻转 + dueDate/completedAt 语义 |
| D4 | 审计 | 写操作（create/update/close/task/communication）落 operation_log（仿 master-data 审计形态）；读不落 |
| D5 | 校验 | caseNo=makeBusinessNo('CA') 随机码；title/caseType 必填 1-100；customerId 存在校验；lawyerId 存在（Employee）校验；status/priority/nodeType 枚举 |
| D6 | 权限 | 各方法 requireAction 对应码；list/get=case.read；create=case.create；update=case.update；close=case.close；task=case.task.manage；communication=case.communication.create |
| D7 | controller 重构 | 遗留原型 controller 逐方法改调 service（薄控制器纪律）——替代直连 prisma |
| D8 | 前端 | 案件列表 + 详情页（基础：案件信息 + 任务 + 沟通）——**范围 OUT：本 SPEC 前端最小**（列表/详情只读 + 新建/结案），深度交互归 follow-up |

## 3. 服务层（application/case/）

### 3.1 case-service.ts

```ts
// createCase(input): case.create → 校验（title/caseType/customerId 存在/lawyerId 存在）→ caseNo=CA 随机码
// → status PENDING + 审计 CASE_CREATE
// updateCase(id, input): case.update → 白名单（title/caseType/lawyerId/teamIds/priority/description/result/satisfaction/isReferrable）
// → version 乐观锁（updateMany {id, version} count=0 → VERSION_CONFLICT 409）+ 审计 CASE_UPDATE
// listCases(query): case.read → 过滤（keyword/status/lawyerId/priority/customerId）+ 分页 + 排序
// getCase(id): case.read → 详情（含 tasks + communications + customer + lawyer）
// closeCase(id, input): case.close → 状态非终态 → CLOSED + closedAt + result/satisfaction + 审计 CASE_CLOSE
```

### 3.2 case-task-service.ts

```ts
// createTask(caseId, input): case.task.manage → 案件存在 → 状态机 PENDING → 审计 CASE_TASK_CREATE
// updateTask(caseId, taskId, input): case.task.manage → 状态翻转（PENDING→IN_PROGRESS→COMPLETED）
// → dueDate/completedAt 语义 + 审计 CASE_TASK_UPDATE
```

### 3.3 case-communication-service.ts

```ts
// createCommunication(caseId, input): case.communication.create → 案件存在 → type 枚举 + content 必填 + isKey → 审计
```

## 4. 控制器 + 路由

- `controller/case.ts` 重构：逐方法改调 service（index/show/create/update/destroy/close/createTask/updateTask/createCommunication）——**destroy 移除**（案件业务不可删，归档替代）。
- `router.ts`：+requirePermission 门禁（case.read 等）——案件域路由 +7（cases + cases/:id + cases POST + cases/:id PUT + cases/:id/close + cases/:id/tasks POST + cases/:id/tasks/:taskId PATCH + cases/:id/communications POST = 8 条，路由 15→22）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | create（校验/审计/customer 存在/lawyer 存在）/ update（白名单/乐观锁 409）/ list（过滤/分页）/ close（状态机/终态拒/审计）/ task（状态机/非法翻转）/ communication（type 枚举） |
| 控制器 | 权限门禁 403/字面量路由/参数透传 |
| 前端（最小） | 案件列表渲染 + 详情展示 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 计数影响

**结构性变更**：迁移 **26→27**（+1 provisioning）；模型 60 不变；权限 **124→130**（+6）；事件 15 不变；路由 **15→22**（+7 案件域）。后端测试 +N（~20）。

## 7. 范围边界（明确 OUT）

- 案件深度工作流（多阶段自动推进/审批联动）——另行。
- 案件文件/证据管理——另行（模型未建）。
- 绩效模块（Performance 模型——另行）。
- 前端深度交互（任务拖拽/甘特/统计驾驶舱）——另行。

## 8. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D8 | 见 §2 | 用户授权自主推进 |
