# SPEC-017 审批定义管理（Approval Definition Management）设计

日期：2026-08-02 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-013 closeout follow-up「Definition 管理」+ SPEC-016 closeout §9「Definition CRUD（approval.manage 码未建）」
设计权威：本文档 ｜ 前置：SPEC-013（Definition/Instance/Task 四模型）+ SPEC-016（nodeSchema 多级链 + MANAGER）

## 1. 背景与目标

审批定义（ApprovalDefinition）目前**只读**：种子固定 5 类（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER），服务层仅 `getActiveDefinition`/`listDefinitions` 两查询方法，无创建/更新/禁用能力，无 `approval.manage` 权限码（权限目录 121 码）。运营变更审批类型（新增报销类别、调整审批链节点、禁用过期定义）只能依赖手工迁移/种子，不可自服务。

**目标**：定义管理 CRUD 端到端——`approval.manage` 权限码 + 定义服务增删改查（create/update/disable/listAll）+ 管理路由 + 前端定义管理页。**零迁移/零模型变更**（复用 ApprovalDefinition 既有字段 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）；权限 121 → **122**（+1：approval.manage）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限码 | **`approval.manage`**（定义管理——创建/更新/禁用/全量列表）。LOW 敏感级别（沿 approval.read 同类配置型权限；权限目录 add 1 码）。**不授** bootstrap 业务角色（管理权限归系统/管理员，非审批角色） |
| D2 | 操作语义 | create=新建定义（code 唯一校验）；update=更新 name/formSchema/approverRule/nodeSchema（**version+1**，不动 status/code/businessType）；disable=ACTIVE→DISABLED（禁申请）；enable=DISABLED→ACTIVE（复用 update 的 status 字段或独立方法）；listAll=全量含 DISABLED（管理页用） |
| D3 | 版本语义 | 更新 `version+1`（沿既有 version Int @default(1)）；**既有实例 definitionVersion 快照不变**（实例继续按快照定义流转，不追溯）——与 SPEC-013 设计一致 |
| D4 | 禁用约束 | DISABLED 定义 apply → `APPROVAL_DEFINITION_NOT_FOUND` 404（既有 getActiveDefinition 已按 status:'ACTIVE' 过滤，禁用即拒，零改动复用） |
| D5 | code 不可变 | create 后 code 不可改（update 排除 code/businessType——业务类型变更应新建定义；code 是引用键） |
| D6 | nodeSchema 校验 | create/update 复用 SPEC-016 `buildApprovalChain` 语义校验：nodeSchema 为 null/undefined → 合法（顶层 approverRule 单节点）；非空数组 → 逐元素校验 {name: string, approverRule: Json}；空数组/非数组对象 → `APPROVAL_ASSIGNEE_INVALID` 400（沿 SPEC-016 minor 加固语义） |
| D7 | formSchema 校验 | 非空对象含 `fields` 数组；每字段 {key: string, label: string, type ∈ date|text|textarea|number, required?}；畸形 → 400 |
| D8 | approverRule 校验 | 非空对象 {type ∈ USER|ROLE, userIds?/roleCodes? 数组}；畸形 → `APPROVAL_ASSIGNEE_INVALID` 400 |
| D9 | 审计 | create/update/disable/enable 落 operation_log（targetType APPROVAL_DEFINITION，action 各自码） |
| D10 | 路由 | 定义管理路由挂 `approval.manage`；列表/详情仍挂 `approval.read`/`approval.apply` 不变 |
| D11 | 零结构变更 | 无迁移/模型/事件/路由表变更（复用 ApprovalDefinition 全部既有字段） |

## 3. 权限与路由

### 3.1 权限目录 +1

`approval.manage`（LOW）：定义管理——创建/更新/禁用/启用/全量列表。权限目录 121 → **122**。check-permission-catalog 需同步计数。

### 3.2 路由（approval 域 6 → 9，新增 3 管理路由）

```
POST   /api/v1/approvals/definitions           approval.manage   （create——字面量先于 /:id）
GET    /api/v1/approvals/definitions/manage    approval.manage   （listAll 含 DISABLED——管理页专用）
PATCH  /api/v1/approvals/definitions/:code     approval.manage   （update / enable）
DELETE /api/v1/approvals/definitions/:code     approval.manage   （disable——软禁，非物理删）
```

> 既有路由不变：`GET /definitions`（approval.apply，表单渲染）、`GET /approvals`（approval.read）、`GET /approvals/:id`、`POST /approvals`、`POST /:id/withdraw`、`POST /:id/process`。注意：`GET /definitions/manage` 必须**字面量先于** `GET /definitions`（无参数冲突——两个 GET 路径不同，但需置于 `GET /definitions` 之后仍可解析；实际 `GET /definitions` 与 `GET /definitions/manage` 为不同精确路径，Egg.js 精确匹配，顺序无碍——但 `PATCH /definitions/:code` 需在 `GET /definitions/manage` 之后注册避免 `manage` 被 `:code` 吞并）。

**路由注册顺序**（router.ts）：先 `GET /definitions`、`GET /definitions/manage`、再 `PATCH/DELETE /definitions/:code`——确保 `/definitions/manage` 字面量优先于 `/definitions/:code`。

## 4. 服务层（approval-definition-service 扩展）

`ApprovalDefinitionService` 增 4 公开方法（均 requireAction `approval.manage`）：

```ts
interface CreateDefinitionInput {
  code: string;            // 唯一，1-100，大写字母+下划线（沿种子命名 EXPENSE_xxx）
  name: string;            // 1-100
  businessType: ApprovalBusinessType;  // 五类之一
  formSchema: FormSchemaSpec;          // {fields: [...]}
  approverRule: RuleSpec;              // {type:'USER'|'ROLE', userIds|roleCodes}
  nodeSchema?: JsonValue | null;       // 可选；null=顶层 approverRule 单节点
}

interface UpdateDefinitionInput {
  name?: string;
  formSchema?: FormSchemaSpec;
  approverRule?: RuleSpec;
  nodeSchema?: JsonValue | null;      // 显式 null = 回落单节点
}
```

方法语义：
- `createDefinition(input)`：normalize 各字段 → code 唯一性（`findUnique` 命中 → 400 冲突）→ nodeSchema/formSchema/approverRule 校验（D6/D7/D8）→ create（version 默认 1、status ACTIVE、createdBy=actor）→ 视图 + 审计。
- `updateDefinition(code, input)`：normalize code → `findUnique` 缺 → 404 → 合并更新（仅白名单字段 name/formSchema/approverRule/nodeSchema；code/businessType/status 不可改）→ **version increment** → 视图 + 审计。
- `setDefinitionStatus(code, status)`：normalize code → 404 → status ∈ {ACTIVE, DISABLED} → update status + **version increment** → 视图 + 审计。（disable 与 enable 共用；前端 DELETE=disable、PATCH status=enable 归入此或 update。）
- `listAllDefinitions()`：全量含 DISABLED，按 code 升序 → 视图数组（管理页用）。无分页（定义规模小，种子 5 + 运营新增可控）。

**视图**：复用 `ApprovalDefinitionView`（已含 nodeSchema/version/status/createdAt/updatedAt）——create/update/setStatus/listAll 均返回该投影。

**错误码**：复用 `APPROVAL_DEFINITION_NOT_FOUND`（404）+ `APPROVAL_ASSIGNEE_INVALID`（400，nodeSchema/approverRule 畸形）+ 新增 `APPROVAL_DEFINITION_CODE_CONFLICT`（400，create code 唯一冲突）。

## 5. 控制器（controller/approval.ts 扩展）

`approvalController` 增 4 方法（actor 沿既有 `ctx.state.user` + authorizationContext）：
- `createDefinition` → service.createDefinition
- `updateDefinition`（:code）→ service.updateDefinition
- `disableDefinition`（:code，DELETE）→ service.setDefinitionStatus(DISABLED)
- `listDefinitionsManage` → service.listAllDefinitions
- （enable 归 update 输入或独立——实现时按前端契约取舍；建议 `PATCH :code` body 含 `{status:'ACTIVE'|'DISABLED'}` 同时承担 update+status，简化路由为 3 条）

**简化方案（最终采用）**：PATCH `:code` 承担 update（name/formSchema/approverRule/nodeSchema）+ status 切换（enable/disable）双职责；DELETE 省略（disable 即软禁，不物理删）。路由 3 条：
```
POST   /api/v1/approvals/definitions           approval.manage
GET    /api/v1/approvals/definitions/manage    approval.manage
PATCH  /api/v1/approvals/definitions/:code     approval.manage   （body: {name?, formSchema?, approverRule?, nodeSchema?, status?}）
```

## 6. 前端（审批中心管理页）

`ApprovalCenterPage` 增「定义管理」Tab（`approval.manage` 门控——无码用户不见 Tab）：
- **列表**：定义表（code/name/businessType/status/version/updatedAt/操作）。复用 Table + Tag。
- **新建**：Modal 表单（code/name/businessType Select/formSchema 简化编辑/approverRule Select+输入/nodeSchema 可选 JSON 文本）——沿既有新建申请 Modal 形态。
- **编辑**：同 Modal 回填 + version 展示；nodeSchema JSON 文本编辑（校验失败 400 提示）。
- **禁用/启用**：Popconfirm 确认 → PATCH status；DISABLED 行 Tag 标灰 + 禁用操作按钮。
- **测试**：管理 Tab 门控（无码隐藏）、列表渲染、新建提交（code 唯一冲突提示）、禁用确认。非恒真断言。

## 7. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | create 成功（视图+审计+version=1）/ create code 冲突 400 / create nodeSchema 畸形 400 / update 白名单+version+1 / update 404 / setStatus DISABLE→apply 404 / setStatus ENABLE 恢复 / listAll 含 DISABLED |
| 权限 | 管理方法 requireAction approval.manage（缺码 403） |
| 路由 | 3 管理路由门禁 / `GET /definitions/manage` 字面量优先于 `PATCH /definitions/:code` |
| 前端 | 管理 Tab 门控 / 列表 / 新建 / 禁用 / code 冲突提示 |
| 回归 | approval 域既有 48 + policy/catalog 全绿 + 定义种子 5 类零改动 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 8. 计数影响

**权限 121 → 122**（+1：approval.manage）；迁移 26/模型 60/事件 15/路由 6→9（approval 域 +3 管理路由）；后端测试 +N（service ~10 + 权限 ~2 + 路由 ~2）、前端 +M（管理 Tab）。零结构变更。

## 9. 范围边界（明确 OUT）

- 会签/转交/加签/超时升级/表达式审批人/上级规则（审批中心深化余项——另行立项）。
- Definition 删除（物理删）——仅软禁（DISABLED），防实例追溯断裂。
- Definition 导入导出/复制。
- 种子定义编辑（LEAVE/SEAL 等 5 类种子仍可由 manage 更新——允许，运营自服务；但不得删）。
- 全组织审批视图（approval.manage 仅定义管理，视图全量归另行）。

## 10. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D11 | 见 §2 | 无人值守自主立项（用户授权） |
