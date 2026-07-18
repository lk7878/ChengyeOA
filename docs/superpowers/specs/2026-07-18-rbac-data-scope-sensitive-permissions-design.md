# SPEC-004：RBAC、数据范围与敏感权限设计

> 状态：待用户审核，本轮不编码
> 日期：2026-07-18
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0
> 前置 Spec：SPEC-001、SPEC-002、SPEC-003、SEC-SPEC-001 已完成本地实施和验收
> 关联专项设计：`docs/专项设计/角色权限与数据范围设计.md`、`docs/专项设计/页面与接口清单.md`、`docs/专项设计/数据库核心表设计草案.md`
> 实施约束：全部开发、测试、提交和集成只在本地完成；不执行 GitHub push、PR 或远程 CI

## 1. 背景

SPEC-003 已建立行政组织树、岗位、员工任职、专业团队和账号绑定，并以实时数据库查询的 `SYSTEM_SUPER_ADMIN` 临时门禁保护组织人员接口。当前原型权限模块仍不能作为企业级授权底座：

1. `RolePermission` 只表达角色和权限的简单多对多关系，不能表达组织、分所、团队、本人或自定义数据范围。
2. 权限只在登录响应中聚合，部分前端逻辑仍使用角色名称或 `admin` 字符串判断，权限撤销不能作为服务端实时阻断依据。
3. 角色、用户角色和权限分配逻辑直接位于 Controller，缺少事务、乐观锁、有效期、授权原因和脱敏审计。
4. 现有角色可以物理删除，用户角色可以整体覆盖，无法可靠保留授权历史或解释权限来源。
5. 员工电话、身份证、合同金额、录音和案件材料等敏感数据缺少统一字段裁剪、脱敏、原文查看、下载和导出规则。
6. 组织人员接口目前只有“超级管理员可访问”与“其他人全部拒绝”两种状态，不能支持分所负责人、人事、专业团队负责人和普通员工的最小权限访问。
7. `SELF_AND_SUBORDINATES` 没有稳定的上下级关系来源，不能靠岗位名称、角色名称或前端传参推断。

权限是线索、客户、合同、财务、案件、人事、驾驶舱和文件服务的共同底座。本 Spec 必须先形成可解释、默认拒绝、可测试的授权内核，再由后续业务 Spec 接入其资源所有权解析器。

## 2. 目标

1. 建立统一的 `RBAC + DataScope + FieldPermission + SpecialPermission + Audit` 授权模型。
2. 使用正式权限资源替换 SPEC-003 的临时超级管理员门禁，同时保持首位超级管理员信任根不被削弱。
3. 支持全所、总所中台、指定组织及下级、指定分所、跨分所专业团队、本人及下属、本人和自定义范围。
4. 支持一名用户同时拥有多个业务角色，并能解释每项有效权限、数据范围、字段能力和有效期来自哪里。
5. 支持永久角色、限时角色和限时特殊权限；到期后无需人工任务即可实时失效。
6. 对 L3/L4 字段执行不返回、脱敏、原文读取、修改和导出的独立控制。
7. 对角色、权限、范围、敏感字段、临时授权和权限追踪操作进行脱敏审计。
8. 为后续业务模块提供稳定的授权上下文、范围谓词、记录校验、字段投影和权限追踪接口。
9. 在不引入外部策略引擎和不提前实现管理员审核流的前提下，保持模块化单体内的清晰边界。

## 3. 非目标

本 Spec 不实现：

1. 系统管理员高风险操作事前审核、低风险操作事后复核、自审禁止流程和回滚关系；这些属于 SPEC-005。
2. 动态逻辑表格、动态字段配置、状态机、SOP、自动化规则和数据干预。
3. 线索、客户、合同、收款、案件、文件和 AI 模块的完整业务权限接入；本 Spec 只注册经过确认的公共权限编码，并完整接入现有组织人员与权限中心。
4. L3/L4 批量导出任务、文件水印、短时下载链接和审批实例；本 Spec 定义权限契约，实际流程由对应业务 Spec 实现。
5. 可配置显式 `DENY` 策略、ABAC 表达式、脚本策略、Casbin、OPA 或外部 Policy Decision Point。
6. 权限缓存。SPEC-004 每次请求读取当前数据库状态，确保停用账号、禁用角色、撤销授权和授权到期立即生效。
7. 自动创建分所负责人、人事、财务、客服、律师等业务角色。系统只发布不可变权限目录，业务角色由超级管理员按实际组织配置。
8. 创建或授权 `SYSTEM_ADMIN`。该角色及其治理流程由 SPEC-005 引入；本 Spec 的权限中心写操作只允许 `SYSTEM_SUPER_ADMIN`。
9. MFA、SSO、SCIM、设备信任和会话控制。

## 4. 方案决策

### 4.1 采用方案：领域授权服务 + 薄适配层

授权逻辑放入独立应用服务，HTTP 中间件只声明路由权限并构建授权上下文，业务 Service 负责把范围谓词注入查询并在写入前校验目标记录。Controller 不拼接数据范围，不自行裁剪敏感字段。

```text
JWT Authentication
  -> AuthorizationContextLoader
  -> Route Action Guard
  -> Domain Service + ResourceScopeResolver
  -> Prisma WHERE / record authorization
  -> FieldProjectionService
  -> Sanitized access or mutation audit
```

选择原因：

1. 详情、列表、聚合和导出可以复用同一判定内核，不依赖前端和 Controller 约定。
2. 每个业务资源只实现一个所有权解析器，权限模型与业务查询保持隔离。
3. 与现有 Egg.js + Prisma 应用服务模式一致，不增加策略语言和独立部署组件。
4. 授权上下文、数据范围、字段投影和权限追踪可以独立测试。

### 4.2 不采用方案

| 方案 | 不采用原因 |
| --- | --- |
| 仅使用路由中间件 | 只能判断动作，无法可靠限制列表、详情、嵌套关系和字段原文 |
| 每个 Controller 手写权限 | 重复、难审计，容易出现列表受限但详情或导出越权 |
| Casbin/OPA | 当前规模不需要额外策略语言、运行时和部署面；调试与维护成本高于收益 |
| 把全部权限写入 JWT | 角色撤销、授权到期和数据范围变化不能立即生效 |
| 超级管理员直接绕过全部服务 | 会绕过 L4 用途记录、访问审计和信任根保护 |

## 5. 授权语义

### 5.1 总判定公式

```text
允许请求 = 账号有效
        AND 凭据有效
        AND 至少一条有效授权授予动作
        AND 目标数据命中该动作的有效范围
        AND 字段读取/写入规则允许
        AND 所需特殊权限存在
        AND L4 原文访问已提供用途并完成审计
```

任一硬门失败即拒绝。前端菜单、按钮和 `allowedActions` 只用于改善体验，不能替代服务端判定。

### 5.2 多角色与多授权组合

为消除“权限并集、范围交集”的歧义，本 Spec 使用授权元组：

```text
授权元组 = 动作权限 AND 该权限绑定的数据范围 AND 有效期
有效访问集合 = 所有有效授权元组结果的并集
```

规则如下：

1. 角色和限时专项授权可以产生多个授权元组。
2. 每条授权元组内部必须同时命中动作、范围和有效期。
3. 多条有效授权之间取可访问记录并集；新增角色不会意外缩小已有访问范围。
4. 账号状态、角色状态、字段 `NONE`、资源分类上限、特殊权限和 L4 用途要求是全局硬门，不因其他角色允许而绕过。
5. 未配置显式 `DENY`。没有有效允许授权即默认拒绝。
6. 权限追踪必须返回实际命中的授权元组，而不是只返回扁平权限编码。

### 5.3 超级管理员

`SYSTEM_SUPER_ADMIN` 是 SPEC-002 信任根的一部分：

1. 实时持有启用的 `SYSTEM_SUPER_ADMIN` 角色即拥有全部已注册动作权限和 `ALL` 数据范围，不要求为该角色逐条写 `RolePermission`。
2. 该隐式授权只存在于统一授权服务，不允许 Controller、前端或业务 Service 自行实现第二套绕过逻辑。
3. 信任根用户、角色、初始化记录和恢复机制继续受 SPEC-002 保护。
4. 超级管理员查看 L3 原文必须产生访问审计；查看 L4 原文必须使用专用接口提交访问目的并产生访问审计。
5. 超级管理员不能关闭审计、返回密码 Hash/token、物理删除权限历史或绕过乐观锁。
6. 涉及超级管理员自身授权审核的职责分离由 SPEC-005 实现，本 Spec 不伪造已完成的审核状态。

## 6. 权限目录

### 6.1 权限编码

权限编码采用稳定小写点号格式：

```text
<resource>.<action>
```

编码一经发布不可修改；显示名称可以修改。目录由代码清单和数据库记录共同约束，不能通过 UI 任意创造 API 权限。

权限类型：

| 类型 | 用途 |
| --- | --- |
| `MENU` | 导航与页面入口 |
| `ACTION` | 读取、创建、修改、状态动作 |
| `SPECIAL` | 高风险、敏感查看、下载、导出或干预动作 |

### 6.2 SPEC-004 首批正式权限

| 资源 | 权限编码 |
| --- | --- |
| 菜单 | `menu.organization_personnel`、`menu.organization`、`menu.position`、`menu.employee`、`menu.professional_team`、`menu.security_my_access`、`menu.security_roles`、`menu.security_users`、`menu.security_trace` |
| 组织 | `organization.read`、`organization.create`、`organization.update`、`organization.move`、`organization.status.manage` |
| 岗位 | `position.read`、`position.create`、`position.update`、`position.status.manage` |
| 员工 | `employee.read`、`employee.create`、`employee.update`、`employee.formalize`、`employee.leave` |
| 任职 | `employee.assignment.read`、`employee.assignment.manage` |
| 汇报关系 | `employee.reporting_line.read`、`employee.reporting_line.manage` |
| 账号绑定 | `employee.account_binding.read`、`employee.account_binding.manage` |
| 专业团队 | `professional_team.read`、`professional_team.create`、`professional_team.update`、`professional_team.status.manage`、`professional_team.member.manage`、`professional_team.lead.manage` |
| 用户 | `user.read`、`user.create`、`user.update`、`user.status.manage` |
| 角色 | `role.read`、`role.create`、`role.update`、`role.status.manage`、`role.permission.manage`、`user.role.manage` |
| 权限中心 | `permission.catalog.read`、`permission.trace.self`、`permission.trace.any`、`temporary_grant.manage` |
| 敏感字段 | `employee.sensitive.read`、`employee.high_sensitive.read`、`employee.sensitive.export` |

下列特殊权限编码进入公共目录，但在对应业务模块实现前没有可调用业务接口：

`customer.merge`、`contract.void`、`payment.confirm`、`refund.approve`、`matter.intervene`、`file.sensitive.download`、`data.bulk_export`、`config.publish`、`config.high_risk.change`。

### 6.3 资源动作映射

每条受保护路由必须在一个集中注册表中声明权限编码，启动时验证：

1. 权限编码存在于代码目录。
2. 同一路由和方法只有一条动作声明。
3. 写路由不能只声明 `.read`。
4. 删除型权限中心路由不存在；角色和授权使用停用、撤销或到期。
5. 未声明的 `/api/v1` 业务路由保持认证保护，但不在 SPEC-004 中被错误记录为已经完成数据范围接入。

## 7. 数据范围

### 7.1 范围类型

| 编码 | 精确定义 |
| --- | --- |
| `ALL` | 根律所下全部行政组织、员工和专业团队 |
| `HQ_SCOPE` | 根律所下 `HQ_CENTER` 节点及其后代，不含任何 `BRANCH` 子树 |
| `ORG` | 指定组织；`includeDescendants=true` 时包含其物化路径后代 |
| `BRANCH` | 指定 `BRANCH` 节点及其全部后代 |
| `TEAM` | 指定专业团队及其生效成员；团队成员可跨分所 |
| `SELF_AND_SUBORDINATES` | 当前账号绑定员工本人及当前生效汇报关系的全部递归下属 |
| `SELF` | 当前账号绑定员工本人负责或参与的数据 |
| `CUSTOM` | 明确列出的组织、团队和员工目标的并集 |

`SELF` 或 `SELF_AND_SUBORDINATES` 遇到未绑定员工的账号时返回空范围，不回退到全所或角色默认范围。

### 7.2 汇报关系

新增 `EmployeeReportingLine` 作为 `SELF_AND_SUBORDINATES` 的唯一事实来源：

1. 记录 `employeeId`、`managerEmployeeId`、`startedAt`、`endedAt` 和 `version`。
2. 同一员工任一时刻最多一条生效直属汇报关系。
3. 禁止本人管理本人和产生直接或间接循环。
4. 汇报关系不替代行政任职、岗位或专业团队关系。
5. 关系创建、调整和结束保留历史并写同事务脱敏审计。
6. 员工离职时结束其作为下属的生效关系；其生效下属必须先完成汇报关系交接。

### 7.3 当前资源所有权

| 资源 | 组织维度 | 团队维度 | SELF 维度 |
| --- | --- | --- | --- |
| Organization | 自身 `path` | 不适用 | 不适用 |
| Position | `organization.path` | 不适用 | 当前员工生效任职岗位 |
| Employee | 生效任职组织 | 生效团队成员关系 | `User.employeeId = Employee.id` |
| EmployeeAssignment | `organization.path` | 不适用 | `employeeId` |
| EmployeeReportingLine | 下属员工的生效任职组织 | 不适用 | 下属或管理者为当前员工 |
| ProfessionalTeam | `homeOrganization.path` | 团队自身 | 当前员工为生效成员 |
| ProfessionalTeamMember | 成员员工的生效任职组织 | 所属团队 | `employeeId` |
| User | 绑定员工的生效任职组织 | 绑定员工的生效团队 | 账号自身 |

角色、权限目录、角色权限和权限追踪属于治理资源，不使用普通组织范围。SPEC-004 中只有超级管理员可以修改角色和授权；拥有 `permission.trace.self` 的用户只能查看自己的解释结果。

### 7.4 查询和记录校验

1. 列表接口从授权上下文生成 Prisma `where`，不能接收前端传入的任意组织 ID 作为授权依据。
2. 详情、修改和状态动作使用与列表相同的所有权解析器；不能先按 ID 读取完整记录再在 Controller 中隐藏。
3. 复杂聚合先取得授权主对象，再读取允许的子资源。
4. `ORG` 和 `BRANCH` 使用物化路径前缀与边界匹配，不能使用名称或简单字符串包含。
5. `TEAM` 只认当前生效成员关系；历史成员不产生当前访问权。
6. 自定义范围目标被停用或关系结束后立即失效。
7. 任何资源找不到和资源存在但越权，对普通调用者使用同一 `RESOURCE_NOT_FOUND_OR_FORBIDDEN` 响应，避免枚举对象。

## 8. 字段权限与数据分级

### 8.1 数据级别

| 级别 | 默认处理 |
| --- | --- |
| `L1` 公开 | 通过资源权限后可读 |
| `L2` 内部 | 仅认证且通过资源权限的内部用户可读 |
| `L3` 敏感 | 默认脱敏；原文读取、修改和导出分别授权并记录请求级审计 |
| `L4` 高敏 | 默认不返回；原文读取必须使用专用接口提交用途并记录审计；默认禁止批量导出 |

未登记的数据字段中，只要属于客户、案件、合同、录音、AI 事实或员工身份信息，默认按 L3 处理。密码、Hash、token、凭据版本、登录失败计数和内部安全字段永不进入字段权限目录，始终禁止返回。

### 8.2 字段能力拆分

不使用单一递增枚举同时表示读取、写入和导出。`FieldPermission` 独立保存：

```text
readLevel = NONE | MASKED | READ
canWrite = true | false
canExport = true | false
```

规则：

1. `WRITE` 不自动获得导出，`EXPORT` 不自动获得修改。
2. 角色未配置字段规则时，L1/L2 继承资源动作，L3 默认 `MASKED`，L4 默认 `NONE`。
3. 多条允许规则可提升能力，但任一适用角色对同一字段配置显式 `NONE` 时，`NONE` 作为硬门优先。
4. 修改字段同时要求资源更新权限、字段 `canWrite=true` 和数据范围命中。
5. 导出同时要求资源读取权限、字段 `canExport=true`、数据范围和相应特殊权限。
6. L3 原文响应写一条请求级访问审计，记录字段编码、返回数量和用途类型，不记录字段值。
7. L4 原文只能通过专用 POST 查看接口提交 `fieldCodes` 和 10-200 字访问目的；普通 GET 始终不返回 L4 原文。

### 8.3 当前字段目录

| 资源字段 | 分级 | 默认响应 |
| --- | --- | --- |
| Organization code/name/type/status/path | L2 | READ |
| Position code/name/category/status | L2 | READ |
| Employee id/employeeNo/name/type/status/dates | L2 | READ |
| Employee phone/email/licenseNo/professionalDirections | L3 | MASKED |
| Employee idCard | L4 | NONE |
| User username/status/employeeId | L2 | READ |
| User password/credentialVersion/lock internals | 禁止 | 永不返回 |
| ProfessionalTeam code/name/category/status | L2 | READ |

后续业务 Spec 必须在接入授权内核时扩展字段目录，不允许在 Controller 内临时硬编码新的脱敏规则。

## 9. 临时授权

### 9.1 限时角色

`UserRole` 支持永久或限时授权：

1. `validFrom` 默认当前时间；`validUntil` 为空表示永久授权。
2. 限时授权必须填写 10-500 字原因和授权人。
3. `validUntil` 必须晚于 `validFrom`，最长 90 天。
4. 到期通过查询条件实时失效，不依赖后台定时任务。
5. 撤销只设置 `revokedAt`、`revokedByUserId` 和原因，不物理删除。
6. 普通业务角色不能包含或继承 `SYSTEM_SUPER_ADMIN`、未来 `SYSTEM_ADMIN` 或权限中心治理权限。

### 9.2 限时专项权限

`UserPermissionGrant` 只允许直接授予 `SPECIAL` 类型权限：

1. 必须绑定一项已注册的特殊权限、一个数据范围、开始/结束时间、原因和授权人。
2. 最长有效期 30 天；到期实时失效。
3. 不能直接授予角色管理、用户角色管理、权限目录管理或超级管理员能力。
4. 撤销保留历史，权限追踪显示授权人、原因、有效期和当前状态。
5. SPEC-004 中只有超级管理员可以创建或撤销；SPEC-005 再增加审核流程。

## 10. 数据模型

### 10.1 现有模型调整

`Role`：增加 `version`；保留稳定 `code`；角色不再物理删除，使用 `status` 停用。`SYSTEM_SUPER_ADMIN` 继续由信任根保护。

`Permission`：增加 `resource`、`action`、`riskLevel`、`version`；`code`、`type`、`resource`、`action` 由代码目录控制，不允许通过 UI 修改。

`UserRole`：增加 `source`、`validFrom`、`validUntil`、`grantReason`、`grantedByUserId`、`revokedAt`、`revokedByUserId`、`revokeReason` 和 `version`；唯一约束改为“同一用户和角色最多一条生效授权”，允许保留历史。

`RolePermission`：保留角色和动作权限映射；变更必须在一个事务中完成并写脱敏审计。

### 10.2 新增模型

| 模型 | 责任 |
| --- | --- |
| `DataScope` | 可复用范围定义，保存类型、名称、是否包含下级、状态和版本 |
| `DataScopeTarget` | `CUSTOM` 范围的组织、团队或员工目标；使用真实外键而非自由文本 |
| `RoleDataScope` | 将角色、资源编码和数据范围绑定 |
| `FieldPermission` | 保存角色在资源字段上的读取、写入和导出能力 |
| `UserPermissionGrant` | 限时特殊权限及其数据范围、原因、授权/撤销信息 |
| `EmployeeReportingLine` | 员工直属汇报关系历史，供下属范围递归计算 |

### 10.3 约束

1. `DataScope` 类型为 `ALL/HQ_SCOPE/ORG/BRANCH/TEAM/SELF_AND_SUBORDINATES/SELF/CUSTOM`。
2. `ORG` 必须绑定组织目标；`BRANCH` 目标必须是 `BRANCH`；`TEAM` 必须绑定专业团队；`CUSTOM` 至少一个目标；其他类型不得有固定目标。
3. `DataScopeTarget` 的组织、团队、员工外键必须且只能填写一个。
4. `RoleDataScope` 在同一角色、资源和范围上唯一。
5. `FieldPermission` 在同一角色、资源和字段编码上唯一。
6. `UserPermissionGrant` 只能引用 `SPECIAL` 权限，并且结束时间非空。
7. `UserRole` 使用 PostgreSQL `tstzrange` 排斥约束阻止同一用户和角色存在时间重叠且未撤销的授权；`UserPermissionGrant` 对同一用户、权限和范围使用同类约束。
8. `EmployeeReportingLine` 使用 `endedAt IS NULL` 的部分唯一索引保证同一员工最多一条当前直属汇报关系。
9. 所有范围、字段和授权写操作使用乐观锁；失败不产生部分关系或审计。
10. 外键删除均使用 `Restrict` 或历史结束，不使用级联删除授权历史。

## 11. 应用服务接口

### 11.1 AuthorizationContextLoader

```ts
interface AuthorizationContext {
  userId: string;
  employeeId: string | null;
  isSystemSuperAdmin: boolean;
  grants: EffectiveGrant[];
  evaluatedAt: Date;
}

load(userId: string, evaluatedAt?: Date): Promise<AuthorizationContext>
```

只加载启用账号、启用角色、生效用户角色、生效角色权限、生效数据范围和生效专项授权。每个请求只构建一次并放入 `ctx.state.authorization`。

### 11.2 AuthorizationService

```ts
requireAction(context: AuthorizationContext, permissionCode: PermissionCode): void
buildScopeWhere(context: AuthorizationContext, resource: ResourceCode): PrismaWhere
requireRecord(context: AuthorizationContext, resource: ResourceCode, recordId: string): Promise<void>
allowedActions(context: AuthorizationContext, resource: ResourceCode, recordId?: string): Promise<PermissionCode[]>
```

`buildScopeWhere` 返回结构化 Prisma 条件，不返回 SQL 字符串。每个资源通过注册的 `ResourceScopeResolver` 生成范围条件。

### 11.3 FieldProjectionService

```ts
project<T extends Record<string, unknown>>(
  context: AuthorizationContext,
  resource: ResourceCode,
  value: T,
): Projected<T>

requireWritableFields(
  context: AuthorizationContext,
  resource: ResourceCode,
  fieldCodes: string[],
): void
```

脱敏函数集中注册，必须返回确定性占位，不能把原值写入日志或错误消息。

### 11.4 PermissionTraceService

返回：

1. 当前账号和员工绑定摘要。
2. 生效与已到期角色。
3. 每项权限的角色或专项授权来源。
4. 资源数据范围及目标摘要。
5. 字段能力和显式 `NONE` 来源。
6. 计算时间和授权有效期。
7. 指定权限或资源被拒绝的稳定原因码。

追踪结果不返回其他用户的敏感字段、授权原因全文以外的业务数据或内部 SQL/Prisma 条件。

### 11.5 RoleAuthorizationService

负责角色创建、修改、停用、权限替换、数据范围替换和字段权限替换。每个替换动作要求角色 `version`，校验权限目录、资源编码、字段目录、范围状态和防提权规则，并在同一事务中写脱敏审计。

### 11.6 UserGrantService

负责永久/限时角色授予、撤销和限时专项权限。禁止修改本人授权、禁止授予保留系统角色、禁止无原因限时授权。SPEC-004 中调用者必须是当前首位超级管理员或实时持有 `SYSTEM_SUPER_ADMIN` 的用户。

### 11.7 EmployeeReportingLineService

负责创建、调整、结束和递归查询汇报关系。写操作锁定下属员工，检查循环、在职状态、版本和交接要求，并写同事务脱敏审计。

## 12. API

所有接口位于 `/api/v1`，要求有效访问令牌。权限中心写接口在 SPEC-004 中还要求实时 `SYSTEM_SUPER_ADMIN`。

### 12.1 当前用户授权

| 方法与路径 | 用途 |
| --- | --- |
| GET `/authorization/me` | 返回当前权限编码、菜单、字段摘要和有效期 |
| GET `/authorization/me/trace` | 解释本人权限来源和范围 |
| POST `/authorization/sensitive-view` | 按资源 ID、字段编码和用途读取允许的 L4 原文 |

### 12.2 权限目录与角色

| 方法与路径 | 用途 |
| --- | --- |
| GET `/permissions/catalog` | 查询不可变权限树和风险级别 |
| GET `/roles` | 分页查询角色和授权摘要 |
| GET `/roles/:id` | 查询角色、权限、范围、字段能力和版本 |
| POST `/roles` | 创建业务角色 |
| PATCH `/roles/:id` | 修改名称、说明，要求 version |
| POST `/roles/:id/disable` | 停用无受保护关系的角色 |
| POST `/roles/:id/enable` | 启用角色 |
| PUT `/roles/:id/permissions` | 原子替换动作权限，要求 version |
| PUT `/roles/:id/data-scopes` | 原子替换资源范围，要求 version |
| PUT `/roles/:id/field-permissions` | 原子替换字段能力，要求 version |

旧 `DELETE /roles/:id` 和未经版本控制的 `POST /roles/:id/permissions` 被移除，不再物理删除或静默覆盖。

### 12.3 用户授权与追踪

| 方法与路径 | 用途 |
| --- | --- |
| GET `/users/:id/authorization` | 查询用户角色和专项授权摘要 |
| POST `/users/:id/role-grants` | 授予永久或限时业务角色 |
| POST `/users/:id/role-grants/:grantId/revoke` | 撤销一条角色授权 |
| POST `/users/:id/special-grants` | 授予限时特殊权限 |
| POST `/users/:id/special-grants/:grantId/revoke` | 撤销专项权限 |
| GET `/authorization/trace/users/:id` | 超级管理员追踪任意用户权限 |

旧 `POST /users/:id/roles` 整体覆盖接口被移除，防止丢失授权历史和并发覆盖。

### 12.4 汇报关系

| 方法与路径 | 用途 |
| --- | --- |
| GET `/employees/:id/reporting-lines` | 查询当前和历史汇报关系 |
| POST `/employees/:id/reporting-lines` | 创建或调整直属上级 |
| POST `/employees/:id/reporting-lines/:lineId/end` | 结束当前汇报关系 |

### 12.5 组织人员接口权限替换

SPEC-003 现有接口按第 6.2 节权限编码保护；列表和详情接入第 7 节数据范围；员工敏感字段接入第 8 节字段投影。临时 `masterDataAccess` 只在全部 SPEC-003 路由完成正式接入后删除，迁移过程中不得出现“任意登录用户可访问”的窗口。

## 13. 错误与响应

| HTTP | 错误码 | 场景 |
| --- | --- | --- |
| 400 | `AUTHORIZATION_INPUT_INVALID` | 权限、范围、字段或有效期参数不合法 |
| 400 | `ACCESS_PURPOSE_REQUIRED` | L4 原文访问缺少合规用途 |
| 401 | `AUTHENTICATION_REQUIRED` | 无有效身份 |
| 403 | `PERMISSION_DENIED` | 没有动作权限 |
| 403 | `DATA_SCOPE_DENIED` | 动作存在但目标不在范围内；只用于不可枚举的内部判定 |
| 403 | `FIELD_PERMISSION_DENIED` | 字段读取、修改或导出不允许 |
| 403 | `SPECIAL_PERMISSION_REQUIRED` | 缺少专项权限 |
| 403 | `PRIVILEGE_ESCALATION_BLOCKED` | 修改本人权限或授予保留角色/能力 |
| 404 | `RESOURCE_NOT_FOUND_OR_FORBIDDEN` | 对外隐藏目标存在性 |
| 404 | `AUTHORIZATION_OBJECT_NOT_FOUND` | 超级管理员管理界面的授权对象不存在 |
| 409 | `VERSION_CONFLICT` | 角色、范围、字段或授权版本过期 |
| 409 | `AUTHORIZATION_IN_USE` | 停用对象仍被生效授权引用 |
| 409 | `REPORTING_LINE_CYCLE` | 汇报关系产生循环 |
| 409 | `TRUST_ROOT_PROTECTED` | 操作将削弱首位超级管理员信任根 |

错误消息不得返回角色内部关系、数据范围目标全集、字段原值、SQL、索引名或 Prisma 错误。

## 14. 审计

本 Spec 继续使用 `OperationLog`，不提前创建 SPEC-005 的审核结论：

1. 角色创建/修改/启停、权限替换、范围替换、字段能力替换、角色授予/撤销、专项授权/撤销、汇报关系变化必须与业务写入同事务审计。
2. 审计只记录稳定 ID、编码、状态、版本、有效期和目标数量，不记录姓名、电话、身份证、授权原因之外的自由文本或范围内业务数据。
3. L3 原文读取记录请求级访问审计；L4 原文读取记录字段编码、资源 ID、访问目的、操作人、时间和结果，不记录原文。
4. 被拒绝的 L4、权限追踪和越权访问记录安全事件摘要，但不得形成对象枚举渠道。
5. 审计失败时写操作回滚；敏感读取审计失败时不返回原文。
6. OperationLog 仍无业务修改和删除 API。

## 15. 前端

### 15.1 页面

| 路由 | 页面 |
| --- | --- |
| `/security/roles` | 角色列表、基本信息、动作权限、数据范围、字段能力 |
| `/security/users` | 用户角色、有效期、专项授权和撤销记录 |
| `/security/trace` | 按用户和权限查询来源、范围、字段能力及拒绝原因 |
| `/security/my-access` | 当前用户查看自己的权限摘要和到期时间 |

旧 `/roles` 重定向到 `/security/roles`；用户基础账号管理继续使用现有页面，但角色分配入口迁移到授权页面。

### 15.2 交互规则

1. 菜单由 `MENU` 权限生成，不再依赖角色名称或 `admin` 字符串。
2. 动作按钮读取当前权限摘要和服务端 `allowedActions`；服务端拒绝后必须显示稳定中文错误。
3. 数据范围使用类型选择器和组织/团队/员工选择器，不允许自由输入目标 ID。
4. 字段权限使用“读取级别 + 可修改 + 可导出”三列控件，并显示字段数据级别。
5. 永久授权和限时授权使用分段控件；限时授权必须输入有效期和原因。
6. L4 原文默认隐藏，用户通过明确动作提交用途后才展示；关闭详情即从组件状态清除原文。
7. 页面具备加载、空数据、无权限、失败重试、版本冲突和授权已过期状态。
8. 桌面端使用紧凑表格和分栏详情；移动端使用抽屉和纵向表单，字段名和权限编码不得溢出。

## 16. 迁移与兼容

1. 使用一组 expand/contract migration 增加权限字段、新模型、检查约束和部分唯一索引。
2. 权限目录由 migration 按固定编码和稳定 ID 幂等写入；这是系统元数据，不是业务角色或演示数据。
3. 现有 `SYSTEM_SUPER_ADMIN` 不需要逐条权限行，迁移后仍通过统一授权服务获得全部注册权限。
4. 现有业务角色和角色权限不自动提升。无法映射到正式目录的原型权限被停用并记录迁移摘要，不物理删除。
5. 现有生效 `UserRole` 转换为 `source=PERMANENT`、`validFrom=createdAt` 的授权历史。
6. 旧角色删除、整体覆盖用户角色和整体覆盖角色权限接口在 contract 阶段移除。
7. 按资源逐步接入组织、岗位、员工、任职和专业团队；每个资源完成动作、范围、字段和回归测试后再移除对应临时门禁。
8. 迁移脚本不创建业务角色、员工、组织、范围模板或测试授权。
9. 生产只执行 `prisma migrate deploy`；测试数据库继续使用 `_test` 后缀和显式重置保护。

## 17. 并发与即时失效

1. 角色、数据范围、字段权限和授权变更要求 `version`。
2. 角色权限、范围和字段能力使用原子替换事务；审计与版本递增同时提交。
3. 授权撤销、角色停用、账号停用和有效期到期在下一请求立即生效。
4. 本 Spec 不使用权限缓存，不需要缓存失效事件。
5. 汇报关系调整锁定下属员工，防止并发生成多个直属上级。
6. 数据库时间区间排斥约束兜底角色/专项授权的有效期重叠，部分唯一索引兜底当前直属汇报关系。

## 18. 性能要求

1. 单请求授权上下文构建在本地验收环境下不超过 100 ms，查询数量不随角色权限条目逐行增长。
2. 一个用户最多 20 个生效角色、50 个生效专项授权和 1,000 个聚合权限编码时，权限判定不出现 N+1。
3. 500 个组织节点和 10,000 名员工规模下，SPEC-003 已通过的树和分页性能不得退化超过 20%。
4. `SELF_AND_SUBORDINATES` 在 1,000 人汇报树上使用递归 CTE 或一次性关系加载，不逐级发起查询。
5. 列表范围条件使用可索引的组织路径、外键和生效关系字段，不把全表数据加载到 Node.js 后过滤。
6. 权限追踪单用户结果在本地验收环境下 2 秒内返回。

## 19. 测试策略

### 19.1 Schema 与 migration

1. 验证新增模型、字段、外键、检查约束、时间区间排斥约束、部分唯一索引和最终模型数量。
2. 验证权限目录稳定编码、稳定 ID、幂等插入和无业务角色预置。
3. 验证历史 UserRole 转换、未知原型权限停用和信任根保持。
4. 验证脏的有效期、重复生效授权、无效范围目标和汇报循环会失败关闭。
5. 在仅完成 SPEC-003 的数据库和包含历史业务角色夹具的数据库上演练。

### 19.2 授权内核

1. 账号停用、角色停用、授权未开始、已到期和已撤销均拒绝。
2. 超级管理员获得全部注册动作和 ALL 范围，但 L4 仍要求用途和审计。
3. 多角色授权元组范围取并集；每条元组内部动作、范围和有效期取交集。
4. ORG/BRANCH/HQ_SCOPE/TEAM/SELF/SELF_AND_SUBORDINATES/CUSTOM 分别验证允许、拒绝和边界。
5. 同一对象通过组织和团队两条路径命中时不重复返回。
6. 列表、详情、修改、状态动作和聚合接口使用同一范围语义。

### 19.3 字段与敏感权限

1. L3 默认脱敏，L4 默认不返回。
2. `READ`、`canWrite`、`canExport` 相互独立。
3. 显式 `NONE` 优先于其他角色允许。
4. L4 缺少用途、用途过短、字段不在目录、审计失败均不返回原文。
5. 响应、日志、错误和权限追踪不得出现禁止字段值。

### 19.4 防提权与信任根

1. 普通角色不能获得权限中心治理权限、系统管理员或超级管理员能力。
2. 用户不能修改本人角色或专项授权。
3. 旧整体覆盖接口和角色物理删除接口不可调用。
4. 首位超级管理员用户、角色、凭据和初始化记录保持受保护。
5. 普通业务角色不能通过角色组合绕过特殊权限、字段 `NONE` 或 L4 用途要求。

### 19.5 API 与前端

1. 每条 SPEC-003 路由验证无动作权限、范围外、字段脱敏和允许路径。
2. 角色页覆盖动作权限、范围、字段能力、乐观锁和停用。
3. 用户授权页覆盖永久角色、限时角色、专项授权、撤销和到期展示。
4. 权限追踪页能解释角色来源、范围目标、字段能力和拒绝原因。
5. 桌面和移动浏览器验收验证无溢出、重叠、空白和隐藏按钮绕过。

### 19.6 回归与安全

1. 使用 Node.js `22.14.0`、npm `10.9.2`、PostgreSQL 16 运行完整 `npm run verify`。
2. 运行生产与全依赖审计、CycloneDX SBOM 和权限敏感值扫描。
3. 组织树、员工分页、登录、强制改密、恢复和信任根测试保持通过。
4. 验收后重置 `_test` 数据库并证明全部应用表为空。
5. GitHub push、PR 和远程 CI 不执行，也不记录为已通过。

## 20. 验收场景

1. 超级管理员创建“重庆分所负责人”业务角色，授予组织人员读取/管理权限和重庆分所 `BRANCH` 范围。
2. 将该角色授予已绑定员工的用户后，用户只能读取和修改重庆分所及下级组织内的允许数据，不能枚举北京分所对象。
3. 再授予一个跨分所医疗团队角色后，用户可读取医疗团队生效成员，两个授权范围按授权元组结果并集生效。
4. 人事角色可读取授权组织员工，电话默认脱敏，身份证不返回；获得员工敏感读取能力后电话可读原文并产生审计。
5. 获得 L4 原文权限的用户仍必须提交访问目的，才能通过专用接口查看身份证；普通详情接口始终不返回 L4 原文。
6. 用户的限时角色和专项权限到期后，下一请求立即失效，无需重登和定时任务。
7. 用户不能给本人授权、不能授予保留系统角色、不能通过旧接口整体覆盖角色。
8. 汇报关系支持“本人及全部递归下属”范围，循环关系和离职未交接下属被拒绝。
9. 权限追踪能说明某项权限来自哪个角色或专项授权、命中哪个范围、何时到期，并解释拒绝原因。
10. 角色停用、账号停用、授权撤销、范围目标失效和团队成员退出均在下一请求生效。
11. 超级管理员、业务角色和无权限用户分别完成允许、拒绝、跨分所、跨团队、字段脱敏和 L4 用途审计用例。
12. 完整回归、安全门、迁移演练和真实浏览器验收通过，测试数据库为空，工作区无敏感产物。

## 21. 实施完成标准

只有以下条件全部满足，SPEC-004 才可记录为本地实施完成：

1. 权限目录、角色、有效授权、数据范围、字段能力、专项授权和汇报关系具备正式数据库模型和约束。
2. 统一授权服务成为唯一服务端权限判定入口，不存在角色名、`admin` 字符串或 Controller 自行绕过。
3. SPEC-003 全部组织人员接口接入动作权限、数据范围和字段投影，临时超级管理员门禁被安全移除。
4. 超级管理员信任根、恢复、强制改密和实时状态保护保持有效。
5. 数据范围八种类型具备确定语义和允许/拒绝测试。
6. 多角色按授权元组并集工作，硬门和字段 `NONE` 拒绝优先。
7. L3/L4 字段按规则脱敏、原文查看、修改、导出授权和审计。
8. 永久/限时角色、限时专项权限、撤销和实时到期全部可解释。
9. 权限中心页面和本人权限页面可在桌面和移动端完成核心操作。
10. 所有授权写操作具备事务、乐观锁和脱敏审计，无物理删除授权历史。
11. 性能、迁移、服务、API、前端、E2E、安全和完整回归测试通过。
12. 测试数据库为空；未提交环境文件、token、数据库产物、审计导出、日志或构建产物。
13. 全部提交只保存在本地；GitHub push、PR 和远程 CI 未执行且不记录为通过。

## 22. 后续 Spec 接口

### 22.1 SPEC-005：系统管理员治理

SPEC-005 复用本 Spec 的权限目录、角色授权、专项授权、版本和 OperationLog，增加：

- `SYSTEM_ADMIN` 创建与授权；
- 权限变更和高风险操作事前审核；
- 低风险操作事后复核；
- 管理员不得自审、不得给本人提权；
- 影响分析、执行结果、回滚关系和双超级管理员治理。

### 22.2 后续业务模块

每个业务 Spec 必须提供：

1. 资源权限编码和动作映射。
2. 组织、团队、负责人和参与人所有权解析器。
3. 字段目录、数据级别、脱敏函数和特殊权限。
4. 列表、详情、写操作、聚合、导出和回调的授权测试。
5. 与本 Spec 授权上下文和范围谓词的接口，不创建第二套角色或范围表。

## 23. 结论

SPEC-004 采用领域授权服务、授权元组、结构化数据范围和集中字段投影。它把“能否执行动作、能看哪些记录、能看哪些字段、能否修改或导出、权限为何生效”拆成可独立验证又可组合的能力，并以实时数据库状态保证撤销立即生效。系统超级管理员继续承担信任根和最高治理身份，但不绕过 L3/L4 访问审计。管理员审核和数据干预继续由 SPEC-005 承接，避免在权限底座中提前混入未完成的治理流程。
