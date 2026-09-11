# SPEC-013 审批中心（Approval Center）设计

日期：2026-08-01 ｜ 状态：用户批准（§1-4 全节 + 后续直接确认）｜ 需求来源：MOD-013 + PRD §4.12 + 专项设计 `docs/专项设计/审批实例任务与消息回调设计.md` + SPEC-011 closeout follow-up「审批中心迁移」「refund.approve 真实 Step-Up」
设计权威：本文档 ｜ 实施计划：待 writing-plans

## 1. 背景与目标

遗留 Approval 原型面（`controller/approval.ts` + `model Approval` + 前端 `/approvals` 页）为**零业务消费方**的通用原型：controller 裸查 `ctx.prisma.approval`、无应用服务层/领域层/**无权限门禁路由**（router :231-234 无 requirePermission）。专项设计（审批实例任务与消息回调）定义了完整审批模型（Definition/Instance/Task/Cc/Callback）；PRD §4.12 审批管理定义类型（退款/费用报销/合同变更/用印/请假/转所）与简化流程（申请人→主管→结果）。SPEC-011 closeout 路由两项 follow-up：审批中心迁移 + refund.approve 真实 Step-Up。

**目标**：核心审批流落地——Definition/Instance/Task/CallbackAction 四模型、权限门禁、事件/审计、退休遗留原型（Drop）、refund.approve 真实 Step-Up。领域审批（refund/invoice/合同）保持直连不回填。

## 2. 核心政策（用户裁决 Q1-6 + 方案 A）

| # | 决策 | 值 |
|---|---|---|
| Q1 | 深度 | **核心审批流**：Instance + Task + 基础 Definition（单级节点）+ CallbackAction（幂等提交）+ 权限门禁 + 事件/审计 + 退休遗留原型 + Step-Up |
| Q2 | 领域审批关系 | **直连保持 + Step-Up**：refund/invoice/合同审批继续走既有服务动作（SPEC-010/011 已验收不回填）；中心服务行政/HR 类 |
| Q3 | 初始类型 | **行政/HR 五类** Definition 种子：EXPENSE 费用报销 / CONTRACT_CHANGE 合同变更 / SEAL 用印 / LEAVE 请假 / TRANSFER 转所 |
| Q4 | 审批人规则 | **指定人员（userId 列表）+ 角色（roleCode→解析成员）**两型；**禁止自审**（申请人不得为最终审批人）；上级/组织负责人/表达式归后续 |
| Q5 | 遗留处置 | **Drop 迁移退休**：`DROP TABLE approval` + 移除无权限路由/旧控制器/旧前端页；模型 57→60（+4 −1） |
| Q6 | Step-Up | **仅 refund.approve**：`REFUND_APPROVE` 目的位（target=refundRequestId+expectedVersion）+ 前端真实 MFA 重验 + 后端校验 |
| 方案 | 模块形态 | **独立 approval 模块**：domain 纯领域层 + application 服务 + factory，镜像 finance/contract |

## 3. 数据模型（57→60，+4 −1）

### 3.1 新模型

**ApprovalDefinition**：id / code unique / name / businessType / formSchema Json（表单字段+校验规格）/ approverRule Json（{type:'USER',userIds:[…]} | {type:'ROLE',roleCodes:[…]}）/ version Int / status ACTIVE|DISABLED / createdBy / createdAt / updatedAt。**5 种子行**（EXPENSE/CONTRACT_CHANGE/SEAL/LEAVE/TRANSFER）provisioning 落；版本化（已产生实例的定义版本不改——专项设计 §2）。

**ApprovalInstance**：id / definitionId / definitionVersion / businessType / title / content Json（表单值快照）/ applicantId / status PENDING|APPROVED|REJECTED|WITHDRAWN / decidedBy / decidedAt / version 乐观锁 / createdBy / createdAt / updatedAt。

**ApprovalTask**：id / instanceId / nodeName 固定单级'审批' / assigneeId / status PENDING|APPROVED|REJECTED|CANCELLED / remark / processedBy / processedAt / version。

**CallbackAction**：id / instanceId / action APPROVE|REJECT / callbackKey unique / status RESPONDED / result Json（首结果快照）/ createdAt。**process 幂等**（专项设计 §6.4 callbackKey 唯一，重复返回首结果）。

### 3.2 Drop

`model Approval`（遗留原型表，零消费方）——同迁移 DROP。

## 4. 事件与权限

### 4.1 事件（13→15，sourceModule APPROVAL / objectType APPROVAL_INSTANCE）

| 事件 | 载荷 | 说明 |
|---|---|---|
| `approval.instance.created` | 恰 5 键 {instanceId, businessType, title, applicantId, status:'PENDING'} | apply 提交 |
| `approval.instance.completed` | 恰 3 键 {instanceId, businessType, status}：APPROVED\|REJECTED\|WITHDRAWN | 定稿/撤回 |

### 4.2 权限（118→121，3 ACTION）

`approval.read`（查看审批中心）/ `approval.apply`（发起申请/撤回本人）/ `approval.process`（处理任务）。Definition 管理归后续。

### 4.3 路由（旧 4 无权限 → 新 5 门禁）

```
GET    /api/v1/approvals             approval.read
GET    /api/v1/approvals/definitions approval.apply
GET    /api/v1/approvals/:id         approval.read
POST   /api/v1/approvals             approval.apply
POST   /api/v1/approvals/:id/withdraw approval.apply
POST   /api/v1/approvals/:id/process  approval.process
```

> 注（终审 F4 修正）：definitions 目录路由（前端表单渲染）为 design 修正补入——approval 域路由 **4→6**（原 5 条表缺 definitions）；definitions 挂 approval.apply（定义即"可申请的菜单"），字面量先于 /:id。

## 5. 架构（方案 A）

```
app/domain/approval/
  approval-types.ts    词汇：DEFINITION businessTypes 五类 / APPROVER_RULE_TYPES USER|ROLE
                        / INSTANCE_STATUSES PENDING|APPROVED|REJECTED|WITHDRAWN / TASK_STATUSES PENDING|APPROVED|REJECTED|CANCELLED
  approval-errors.ts    7 码（见 §8）
  approval-policy.ts    纯函数：resolveApprovers / canTransitionInstance|Task（终态先行）/ assertNotSelfReview
app/application/approval/
  approval-definition-service.ts   getActiveDefinition(code) / listDefinitions()
  approval-instance-service.ts     applyForApproval / listInstances / getInstance / processTask / withdrawInstance
  approval-factory.ts              组装（3 参 + 可选 outbox）
```

## 6. 行为细节

### 6.1 applyForApproval（approval.apply）

definition 按 code（404 若缺/禁）→ content 按 formSchema 校验（400）→ resolveApprovers（USER userIds / ROLE roleCodes→成员集；空集 → ASSIGNEE_INVALID 400）→ **assertNotSelfReview**（申请人 ∈ 审批人集 → SELF_REVIEW_FORBIDDEN 409）→ 单事务：建 Instance PENDING + 每审批人一 Task PENDING + `approval.instance.created` + APPROVAL_APPLY 审计。

### 6.2 processTask（approval.process）

任务探查（instanceId + assigneeId=actor + approval.process 权限——专项设计 §9 禁止无权限处理）→ **CallbackAction 幂等**（callbackKey unique，重复 P2002 → 重读返回首结果零事件零审计）→ Task PENDING 翻转 APPROVED/REJECTED（version 乐观锁）→ **任一通过**（首审批人决定定稿；会签归后续）→ Instance 定稿 APPROVED/REJECTED → `approval.instance.completed` + APPROVAL_PROCESS 审计。

### 6.3 withdrawInstance（approval.apply）

本人 Instance（applicantId=actor）PENDING → WITHDRAWN + 待办 Task → CANCELLED → `completed(WITHDRAWN)` + APPROVAL_WITHDRAW 审计。非本人/非 PENDING → 404/409。

### 6.4 list/get（approval.read）

**actor 作用域**：我的申请（applicantId）+ 我的任务（assigneeId）双过滤 + 分页（page 1/pageSize 20 上限 100/createdAt DESC id ASC）；get 非申请人/审批人 404 fail-closed。全组织视图（approval.manage）归后续。

### 6.5 事务与幂等

apply/process/withdraw 均单事务原子；process 幂等由 CallbackAction callbackKey unique 保证；Task/Instance version 乐观锁；禁止自审 apply 与 process 双侧校验。

### 6.6 Definition 种子审批人规则

LEAVE→人事/主管角色、SEAL→印章管理员、EXPENSE→财务、CONTRACT_CHANGE→合同/合伙人、TRANSFER→人事——**实现时核实角色目录存在性**，缺则调整种子（impl 验证点）。

## 7. Step-Up（Q6，仅 refund.approve）

- step-up-target.ts：+`REFUND_APPROVE` 目的位；normalizeTarget：exactRecord(['refundRequestId','expectedVersion']) → {refundRequestId, expectedVersion positiveInteger}。
- 前端：RefundListPage 审批按钮（SPEC-011 敏感 Modal）→ `useStepUp(REFUND_APPROVE, {refundRequestId, expectedVersion})` 真实 MFA 挑战（StepUpDialog 既有）→ 持证调用审批 API。
- 后端：refund approve 路由/控制器沿 admin-governance 模式校验 Step-Up 证明（服务层校验目标绑定——refundRequestId+expectedVersion 匹配）后翻转。

## 8. 错误处理（approval-errors 7 码）

| 场景 | 码 | HTTP |
|---|---|---|
| definition 缺/禁 | APPROVAL_DEFINITION_NOT_FOUND | 404 |
| instance 缺/不可见 | APPROVAL_INSTANCE_NOT_FOUND | 404 |
| task 缺/非我 | APPROVAL_TASK_NOT_FOUND | 404 |
| 状态非法（非 PENDING 处理/撤回） | APPROVAL_STATE_INVALID | 409 |
| 禁止自审 | APPROVAL_SELF_REVIEW_FORBIDDEN | 409 |
| 审批人空集/内容校验 | APPROVAL_ASSIGNEE_INVALID（+VALIDATION_FAILED 复用） | 400 |
| 重复回调（幂等重放不抛——callbackKey 冲突走重读） | CALLBACK_KEY_CONFLICT | 409（不触发，幂等优先） |

## 9. 前端

- 旧 `/approvals` 原型页退休（`pages/Approval/index.tsx` + `api/organization.ts` approval 段 + `types/index.ts` Approval 接口）→ 新审批中心页：
  - 我的申请（列表+状态）+ 新建申请（按 Definition 五类选表单，content 按 formSchema 渲染）。
  - 我的待办（assigneeId=我 的 PENDING 任务）— 审批/驳回动作。
  - 我的已办（assigneeId=我 且 task 非 PENDING——被他人决策自动 CANCELLED 的任务亦入此；终审 F2 修正，原措辞 processedBy 系笔误）。
  - 详情弹窗（Instance + Tasks + content）。
- 新 `api/approval.ts` + store + 页面；菜单「审批管理」沿用。
- **refund approve Step-Up 接线**：RefundListPage 审批按钮 → `useStepUp(REFUND_APPROVE, …)` 真实 MFA 挑战 → 持证调用。

## 10. 测试策略

| 层 | 用例 |
|---|---|
| domain policy | resolveApprovers USER/ROLE、状态机终态先行、assertNotSelfReview |
| instance-service | apply（definition 解析/内容校验/审批人解析/自审 409/事件审计）、process（assignee 非我 404/状态流转/任一通过定稿/幂等 callbackKey/事件）、withdraw（仅本人/仅 PENDING/任务取消/事件） |
| API | apply/process/withdraw/list/get E2E + 三权限门禁 403 |
| 事件注册 | 2 新事件写读闭环 + 错 status 拒绝 |
| Step-Up | REFUND_APPROVE normalizeTarget；refund approve 持证调用 |
| 前端 | 审批中心页（三 Tab/新建表单/处理动作）；refund 审批 Step-Up 接线 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、测试库 `_test` 且 `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 11. 计数影响

模型 **57→60**（+4 −1）；权限 **118→121**（+3）；事件 **13→15**（+2）；迁移 +2（expand：drop approval + 4 新表；provisioning：5 Definition 种子 + 3 权限行）；approval 域路由 **4→6**（含 definitions——终审 F4 修正，原 4→5 系漏计）；前端旧页→新中心页（1 替换）。

## 12. 范围边界（明确 OUT）

多级审批、会签、转交、加签、撤回（除本人 PENDING）、超时升级、表达式审批人、上级/组织负责人规则、Definition 管理（种子固定 5 类）、全组织审批视图（approval.manage）、业务执行回调（领域审批直连故无；CallbackAction 仅作 process 幂等）、客户合并/敏感导出等已有 SPECIAL 机制的预置类型。

## 13. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 深度 | 核心审批流（Q1） |
| D2 | 领域审批关系 | 直连保持 + Step-Up（Q2） |
| D3 | 初始类型 | 行政/HR 五类 Definition 种子（Q3） |
| D4 | 审批人规则 | 指定人员 + 角色 + 禁止自审（Q4） |
| D5 | 遗留处置 | Drop 迁移退休（Q5） |
| D6 | Step-Up | 仅 refund.approve（Q6） |
| D7 | 模块形态 | 独立 approval 模块（方案 A） |
| D8 | 决策语义 | 任一通过（会签归后续） |
| D9 | 权限 | approval.read/apply/process 三码（121） |
| D10 | 幂等 | CallbackAction callbackKey unique 重读返回首结果 |
