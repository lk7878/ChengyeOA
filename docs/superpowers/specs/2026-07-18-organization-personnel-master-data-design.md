# SPEC-003：组织架构与人员主数据设计

> 状态：待文档审核  
> 日期：2026-07-18  
> 设计基线确认：2026-07-18  
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0  
> 前置 Spec：SPEC-001、SPEC-002、SEC-SPEC-001 已完成本地实施和验收  
> 关联专项设计：`docs/专项设计/数据库核心表设计草案.md`、`docs/专项设计/角色权限与数据范围设计.md`、`docs/专项设计/页面与接口清单.md`  
> 实施约束：本 Spec 经书面审核后单独生成实施 Plan；全部开发、测试、提交和集成仅在本地完成，不执行 GitHub 推送。

## 1. 背景

SPEC-002 已通过一次性离线命令建立根律所、首位系统超级管理员和永久初始化状态，但当前组织与人员实现仍是早期原型：

1. `Organization` 只有名称、粗粒度类型和父节点，缺少稳定编码、层级路径、并发版本和完整层级约束。
2. `Employee` 直接保存单一组织和岗位，无法表达总所人员跨分所支持、员工兼任以及专业团队跨地区协作。
3. 专业团队没有独立主数据，医疗纠纷、执行、刑事辩护以及未来团队无法形成稳定的数据归属和统计维度。
4. 组织、岗位和员工规则直接写在 Controller 中，循环挂载、非法移动、岗位组织不一致和并发覆盖等风险缺少统一防护。
5. 当前认证中间件只确认用户身份，所有已登录用户都能调用组织和人员接口，在完整 RBAC 上线前存在安全空窗。
6. 现有删除接口执行物理删除，不符合企业级主数据的历史留存要求。

组织和人员是线索、客户、合同、案件、财务、人事、数据范围和驾驶舱的共同主数据。本 Spec 先建立稳定的组织人员底座，再由 SPEC-004 实现完整权限体系，由 SPEC-005 实现管理员治理和操作审核。

## 2. 目标

1. 建立“行政组织树 + 跨组织专业团队矩阵”的统一组织模型。
2. 支持总所、总所中心、部门、地区分所和小组的受约束树形维护。
3. 支持员工主职、兼任和代理任职，并完整保留任职历史。
4. 支持员工跨分所加入专业团队，以及团队负责人、专家、律师、助理、运营等职责。
5. 支持首位超级管理员账号与真实员工档案进行受控的一对一绑定，不更换用户主键或破坏信任根。
6. 将业务规则收敛到可独立测试的应用服务，Controller 只承担 HTTP 适配。
7. 所有变更具备事务、并发冲突检测和脱敏审计记录。
8. 在 SPEC-004 上线前，以数据库实时查询的超级管理员门禁保护本 Spec 的全部接口和页面。
9. 提供可直接使用的组织、岗位、员工任职和专业团队管理界面。

## 3. 非目标

本 Spec 不实现：

1. 菜单权限、操作权限、数据范围、字段权限、特殊权限、临时授权和权限追踪；这些属于 SPEC-004。
2. 第二位超级管理员、系统管理员授权、高风险操作审核、事后复核和数据干预；这些属于 SPEC-005。
3. MFA、SSO、设备信任、会话管理和自助密码找回。
4. 考勤、请假、培训、绩效、设备领用等人事业务流程。
5. 线索、客户、合同、案件、财务等业务对象的数据范围过滤。
6. 动态字段、业务字典管理、审批、事件中心和自动化规则。
7. 组织或员工批量导入导出。
8. 自动创建前瞻研究部、律师培训部、品牌宣传部、地区分所或三大专业团队。
9. LawLink、LexNebulis、外部人事项目或历史 SQLite 数据导入。

本 Spec 可以定义后续事件名称和权限资源编码，但不在事件中心或 RBAC 就绪前写入临时的第二套实现。

## 4. 方案决策

### 4.1 采用方案：行政树与专业团队矩阵分离

行政归属由 `Organization` 树表达，专业协作由 `ProfessionalTeam` 和成员关系表达。员工身份与任职关系分离，`EmployeeAssignment` 是组织和岗位归属的唯一事实来源。

采用该方案的原因：

1. 地区分所、总所部门和行政小组天然是单父节点树，适合层级查询和后续组织数据范围计算。
2. 专业团队可以跨分所组建，不应被强制挂在某一分所树下或复制多个团队节点。
3. 员工可以有一个主职和多个兼任/代理关系，调岗时保留历史，不覆盖旧归属。
4. 专业团队成员关系可以独立记录团队职责和有效期，不污染行政岗位。

### 4.2 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 所有实体都放入 Organization 树 | 跨分所团队需要多父节点或重复节点，统计和权限来源不清晰 |
| Employee 继续直接保存 orgId/positionId，再增加兼任表 | 主职与兼任形成两套事实来源，查询、调岗和一致性规则容易分叉 |
| 完全通用的组织关系图 | 灵活但复杂，树查询、移动、权限范围和界面维护成本过高 |
| 每个分所独立数据库或租户 | 破坏全所主数据、跨分所团队和统一经营统计，不符合已批准架构 |

### 4.3 应用架构

沿用现有 Egg.js + Prisma 模块化单体，采用“应用服务 + 薄 Controller”：

```text
HTTP Controller
  -> 输入解析与错误映射
  -> SystemSuperAdminGuard
  -> Organization / Personnel Application Service
  -> Prisma Transaction
  -> PostgreSQL constraints + sanitized OperationLog
```

不增加通用 Repository 抽象。应用服务直接依赖 Prisma Client 或 Transaction Client，保持事务边界清晰，并与现有 `SystemBootstrapService`、`SuperAdminRecoveryService` 风格一致。

## 5. 领域边界与唯一数据源

| 主数据 | 唯一数据源 | 本 Spec 负责 | 后续使用方式 |
| --- | --- | --- | --- |
| 行政组织 | Organization | 层级、编码、状态、移动 | 业务对象只引用组织 ID |
| 岗位 | Position | 组织内岗位、状态、职责 | 任职关系引用岗位 ID |
| 员工身份 | Employee | 基础档案、执业信息、在职状态 | 业务对象引用员工 ID |
| 员工任职 | EmployeeAssignment | 主职、兼任、代理及历史 | 权限和统计读取生效任职 |
| 专业团队 | ProfessionalTeam | 团队分类、归口组织、状态 | 案件和统计引用团队 ID |
| 团队成员 | ProfessionalTeamMember | 成员职责、负责人、有效期 | 团队权限和绩效读取成员关系 |
| 登录账号 | User | 绑定/解绑员工；离职时停用已绑定的普通账号 | 其他账号、角色和权限能力由后续 Spec 管理 |

组织名称、岗位名称、员工姓名和团队名称可以修改；稳定编码和主键一经创建不可修改。其他模块不得复制主数据名称作为关联依据，只能按 ID 关联，并可在历史快照中保留当时名称。

## 6. 数据模型

### 6.1 Organization

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| code | 全局唯一；`^[A-Z][A-Z0-9_]{1,31}$`；创建后不可修改 |
| name | 去除首尾空白后 2-100 个字符 |
| type | `FIRM`、`HQ_CENTER`、`DEPARTMENT`、`BRANCH`、`GROUP` |
| parentId | 根组织为空，其他组织必填 |
| path | 物化路径，格式为 `/<rootId>/<childId>`；服务端维护 |
| level | 根组织为 0，子节点为父级 level + 1 |
| sort | 同级显示顺序，默认 0 |
| status | `ENABLED`、`DISABLED` |
| version | 乐观锁版本，初始值 1 |
| createdAt / updatedAt | 创建和更新时间 |

层级规则：

| 组织类型 | 允许的父类型 |
| --- | --- |
| FIRM | 无；只能是 `SystemInitialization.PRIMARY.rootOrganizationId` |
| HQ_CENTER | FIRM |
| BRANCH | FIRM |
| DEPARTMENT | FIRM、HQ_CENTER、BRANCH |
| GROUP | DEPARTMENT、BRANCH |

补充规则：

1. 不允许通过在线 API 创建第二个 `FIRM` 或修改根组织类型。
2. 不允许组织成为自身或其后代的子节点。
3. 不允许地区分所嵌套地区分所。
4. 移动组织时必须在同一事务内更新本节点及全部后代的 `path`、`level` 和 `version`。
5. 停用组织前必须先停用全部子组织、岗位，并结束其生效任职；系统不做隐式级联停用。
6. 根组织不得停用或删除，只允许修改名称和排序。
7. 组织不提供物理删除；无引用且误建的组织也通过 `DISABLED` 留存。
8. 启用组织时，其全部祖先组织必须处于 `ENABLED` 状态。

### 6.2 Position

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| organizationId | 所属行政组织，必填 |
| code | 组织内唯一；格式同组织编码；创建后不可修改 |
| name | 2-100 个字符 |
| categoryCode | 稳定开放编码，例如 `MANAGEMENT`、`LAWYER`、`SUPPORT` |
| level | 非负整数，用于岗位层级展示，不代表权限 |
| responsibilities | 可选，最多 2000 个字符 |
| status | `ENABLED`、`DISABLED` |
| version | 乐观锁版本 |
| createdAt / updatedAt | 创建和更新时间 |

岗位所属组织不可直接迁移。需要调整时，应在目标组织创建岗位，并通过员工调岗结束旧任职、创建新任职。岗位存在生效任职时不得停用；所属组织未启用时不得创建或启用岗位。

### 6.3 Employee

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| employeeNo | 全局唯一、创建后不可修改，2-32 个大写字母/数字/下划线/短横线 |
| name | 2-100 个字符 |
| phone | 必填，保存规范化值 |
| email | 可选，保存小写规范化值 |
| idCard | 可选、唯一、L4 高敏字段 |
| licenseNo | 可选、唯一，律师执业证号 |
| employeeType | `PARTNER`、`LAWYER`、`ASSISTANT`、`SALES`、`ADMIN`、`HR`、`FINANCE`、`OPERATOR`、`TECHNICAL`、`OTHER` |
| professionalDirections | 可选字符串数组，保存稳定专业方向编码 |
| status | `PROBATION`、`FORMAL`、`LEAVED` |
| entryDate / formalDate / leaveDate | 入职、转正和离职日期 |
| version | 乐观锁版本 |
| createdAt / updatedAt | 创建和更新时间 |

`Employee` 不再直接保存组织和岗位。员工创建必须同时创建一条主职任职，不允许产生没有主职的在职员工。

员工档案不提供物理删除。误建档案在尚未关联账号、任职历史、团队历史或业务数据时可以标记为 `LEAVED`，但记录仍保留。

### 6.4 EmployeeAssignment

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| employeeId | 员工 ID |
| organizationId | 行政组织 ID |
| positionId | 岗位 ID，且岗位必须属于 organizationId |
| assignmentType | `PRIMARY`、`SECONDARY`、`ACTING` |
| startedAt | 生效时间 |
| endedAt | 结束时间；生效中为空 |
| version | 乐观锁版本 |
| createdAt / updatedAt | 创建和更新时间 |

约束规则：

1. 同一员工只能有一条 `endedAt IS NULL` 的 `PRIMARY` 任职，由 PostgreSQL 部分唯一索引兜底。
2. 同一员工、组织和岗位不得存在重复的生效任职。
3. 任职只能引用 `ENABLED` 的组织和岗位，岗位所属组织必须与任职组织一致。
4. 主职调动在一个事务内结束原主职并创建新主职，不允许先删除原记录。
5. `endedAt` 必须晚于 `startedAt`，结束后的任职不可重新启用。
6. 本 Spec 不支持预约未来主职；主职调动提交后立即生效。兼任和代理关系也以提交时间生效。

### 6.5 ProfessionalTeam

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| code | 全局唯一稳定编码；创建后不可修改 |
| name | 2-100 个字符 |
| categoryCode | 开放稳定编码；允许 `MEDICAL_DISPUTE`、`ENFORCEMENT`、`CRIMINAL_DEFENSE` 及后续其他分类 |
| homeOrganizationId | 团队归口行政组织 |
| description | 可选，最多 2000 个字符 |
| status | `ENABLED`、`DISABLED` |
| version | 乐观锁版本 |
| createdAt / updatedAt | 创建和更新时间 |

专业团队不作为 `Organization` 子节点，不限制成员的行政组织。团队存在生效成员时不得停用；归口组织未启用时不得创建或启用团队。

### 6.6 ProfessionalTeamMember

| 字段 | 约束 |
| --- | --- |
| id | UUID 主键 |
| professionalTeamId | 专业团队 ID |
| employeeId | 员工 ID |
| memberRole | `LEAD`、`EXPERT`、`LAWYER`、`ASSISTANT`、`OPERATIONS`、`OTHER` |
| startedAt | 加入时间 |
| endedAt | 退出时间；生效中为空 |
| version | 乐观锁版本 |
| createdAt / updatedAt | 创建和更新时间 |

同一员工在同一团队只能有一条生效成员关系；同一团队只能有一名生效中的 `LEAD`，均由 PostgreSQL 部分唯一索引兜底。负责人调整必须在一个事务内结束旧负责人关系并建立或更新新负责人关系。

### 6.7 User 与员工绑定

沿用 `User.employeeId` 一对一关系。新增受控绑定服务，规则如下：

1. 只能绑定已存在、未绑定员工的用户和未绑定账号的员工。
2. 可以将首位超级管理员绑定到真实员工档案，但不得更换用户 ID、角色、密码、凭据版本或初始化记录。
3. 通用用户更新接口仍不得修改首位超级管理员；信任根绑定只能经过本 Spec 的专用服务。
4. 解绑只清除 `employeeId`，不得停用账号、删除员工或修改角色。
5. 绑定和解绑必须写入脱敏审计，不记录密码、证件、电话或完整员工档案。

## 7. PostgreSQL 迁移设计

迁移必须兼容 SPEC-002 已初始化数据库，不要求清库或重新执行 bootstrap：

1. 为 `Organization` 增加 `code`、`path`、`level`、`version`，先允许空值再回填。
2. 初始化记录指向的根组织回填为 `code=ROOT`、`path=/<rootId>`、`level=0`。
3. 其他历史组织按父子关系使用递归 CTE 回填路径和层级；历史编码使用完整 UUID 派生的确定性 `LEGACY_...` 值，避免随机或名称冲突。
4. 为现有 `Position` 增加组织内稳定编码和版本；历史编码采用确定性派生值。
5. 创建 `EmployeeAssignment`，将现有员工的 `orgId + positionId` 转换为生效中的 `PRIMARY` 任职。
6. 验证每名在职员工恰好拥有一个主职后，删除 `Employee.orgId` 和 `Employee.positionId`。
7. 创建 `ProfessionalTeam`、`ProfessionalTeamMember` 及索引。
8. 增加组织层级、时间区间和部分唯一索引等数据库约束。
9. migration 不创建部门、分所、岗位、员工或专业团队等业务记录，不恢复 seed。
10. migration 提供验证查询和回滚说明；有历史脏数据时失败关闭，不静默丢弃或猜测归属。

测试数据库继续使用 `_test` 后缀和显式重置保护。生产迁移仅使用 `prisma migrate deploy`，不得使用 `db push`。

## 8. 应用服务

### 8.1 OrganizationService

负责组织创建、修改、移动、停用、启用、树查询和详情查询。层级规则、循环检测、路径更新、乐观锁和审计均在服务内完成。

### 8.2 PositionService

负责岗位创建、修改、启停和按组织查询。停用时检查生效任职，不允许通过修改接口迁移所属组织。

### 8.3 EmployeeService

负责员工建档、档案修改、转正和离职。创建员工与主职任职必须原子提交。离职必须校验不存在未交接的业务责任，并要求明确的交接确认；随后显式结束全部任职和团队成员关系，并停用已绑定的普通账号。首位超级管理员账号不得通过离职流程停用，必须先解除员工绑定或由后续管理员治理流程处理。

### 8.4 AssignmentService

负责主职调动、兼任、代理和结束任职。所有写操作按员工加行锁，防止并发产生多个主职或重复任职。

### 8.5 ProfessionalTeamService

负责专业团队创建、修改、启停、成员加入退出和负责人调整。团队成员可来自任意启用的行政组织。

### 8.6 EmployeeAccountBindingService

负责既有账号和员工的一对一绑定/解绑。服务只修改 `User.employeeId`，并保留 SPEC-002 信任根保护的其他全部约束。

### 8.7 SystemSuperAdminGuard

每次请求根据 `ctx.state.user.userId` 实时查询用户、角色关系和角色状态，必须命中生效的 `SYSTEM_SUPER_ADMIN` 才允许继续。不得只依赖登录响应、前端状态或 JWT 中缓存的角色。

SPEC-004 上线后，本门禁由正式权限资源替换；迁移前不得放宽为“任意已登录用户”。

## 9. API 设计

所有接口位于 `/api/v1`，当前阶段均要求访问令牌和 `SYSTEM_SUPER_ADMIN` 实时门禁。

### 9.1 组织

| 方法与路径 | 用途 |
| --- | --- |
| GET `/organizations/tree` | 返回完整行政组织树，可按 status 筛选 |
| GET `/organizations/:id` | 返回组织详情、父级、直接子级和统计摘要 |
| POST `/organizations` | 创建非根组织 |
| PATCH `/organizations/:id` | 修改名称、排序，要求 version |
| POST `/organizations/:id/move` | 移动组织，要求 parentId 和 version |
| POST `/organizations/:id/disable` | 停用组织，要求 version |
| POST `/organizations/:id/enable` | 启用组织，要求 version |

### 9.2 岗位

| 方法与路径 | 用途 |
| --- | --- |
| GET `/positions` | 按 organizationId、status、keyword 查询 |
| GET `/positions/:id` | 岗位详情和生效任职数量 |
| POST `/positions` | 创建岗位 |
| PATCH `/positions/:id` | 修改名称、职责、层级，要求 version |
| POST `/positions/:id/disable` | 停用岗位，要求 version |
| POST `/positions/:id/enable` | 启用岗位，要求 version |

### 9.3 员工与任职

| 方法与路径 | 用途 |
| --- | --- |
| GET `/employees` | 分页查询，支持 keyword、status、organizationId、teamId |
| GET `/employees/:id` | 员工档案、全部任职、团队关系和账号摘要 |
| POST `/employees` | 员工建档并创建主职 |
| PATCH `/employees/:id` | 修改档案，要求 version |
| POST `/employees/:id/formalize` | 转正，要求 formalDate 和 version |
| POST `/employees/:id/leave` | 离职，要求 leaveDate、交接确认和 version |
| POST `/employees/:id/assignments/transfer` | 主职调动 |
| POST `/employees/:id/assignments` | 新增兼任或代理 |
| POST `/employees/:id/assignments/:assignmentId/end` | 结束兼任或代理 |
| PUT `/employees/:id/account-binding` | 绑定既有 userId |
| DELETE `/employees/:id/account-binding` | 解除账号绑定 |

### 9.4 专业团队

| 方法与路径 | 用途 |
| --- | --- |
| GET `/professional-teams` | 分页查询团队 |
| GET `/professional-teams/:id` | 团队详情和生效/历史成员 |
| POST `/professional-teams` | 创建团队 |
| PATCH `/professional-teams/:id` | 修改团队资料，要求 version |
| POST `/professional-teams/:id/disable` | 停用空团队 |
| POST `/professional-teams/:id/enable` | 启用团队 |
| POST `/professional-teams/:id/members` | 加入成员 |
| POST `/professional-teams/:id/members/:memberId/end` | 成员退出 |
| POST `/professional-teams/:id/lead` | 原子调整负责人 |

现有物理删除型 `DELETE /organizations/:id`、`DELETE /positions/:id` 和 `DELETE /employees/:id` 路由必须移除，不得把“删除”静默解释成物理删除。

## 10. 输入、响应与错误

1. Controller 使用明确 DTO 解析函数，拒绝未知字段、空白编码、无效日期和非整数分页参数。
2. 列表响应统一为 `{ list, pagination }`，树响应只返回组树所需字段和计数，不返回员工敏感信息。
3. 详情接口不返回密码 Hash、凭据版本、锁定计数或完整角色内部关系。
4. 业务错误使用稳定英文错误码，前端映射中文文案。

| HTTP | 错误码 | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 参数格式或必填项错误 |
| 403 | `SYSTEM_SUPER_ADMIN_REQUIRED` | 未通过临时超级管理员门禁 |
| 404 | `ORGANIZATION_NOT_FOUND` 等 | 目标不存在 |
| 409 | `VERSION_CONFLICT` | 乐观锁版本不一致 |
| 409 | `ORGANIZATION_HIERARCHY_INVALID` | 父子类型不合法 |
| 409 | `ORGANIZATION_CYCLE` | 组织移动产生循环 |
| 409 | `MASTER_DATA_IN_USE` | 停用对象仍被生效关系引用 |
| 409 | `PRIMARY_ASSIGNMENT_CONFLICT` | 多个生效主职或并发调岗 |
| 409 | `ASSIGNMENT_ORGANIZATION_MISMATCH` | 岗位与任职组织不一致 |
| 409 | `TEAM_LEAD_CONFLICT` | 团队出现多个生效负责人 |
| 409 | `ACCOUNT_BINDING_CONFLICT` | 用户或员工已绑定其他对象 |
| 409 | `TRUST_ROOT_PROTECTED` | 离职等操作将破坏首位超级管理员 |

Prisma 唯一约束和部分唯一索引的并发冲突必须转换为上述稳定错误，不向客户端暴露表名、索引名、SQL 或原始 Prisma 错误。

## 11. 事务与并发

1. 员工建档、主职任职和操作日志在一个事务中完成。
2. 主职调动锁定员工，结束旧主职、创建新主职并写日志后一次提交。
3. 员工离职锁定员工，检查信任根和待交接状态，结束任职/团队关系、更新员工和普通账号后一次提交。
4. 组织移动锁定目标组织及其子树，校验新父节点后批量更新路径和层级。
5. 团队负责人调整锁定团队，结束旧负责人关系并创建或更新新负责人关系。
6. 更新、移动、启停和状态动作必须携带 version；版本不匹配时不产生任何写入。
7. 数据库唯一约束、检查约束和外键作为服务校验后的第二道防线。

## 12. 审计与敏感数据

本 Spec 复用现有 `OperationLog`，不提前实现 SPEC-005 的 `AdminOperationReview`：

1. 所有创建、修改、移动、启停、调岗、兼任、离职、团队成员变更和账号绑定均在业务事务内写日志。
2. 日志记录操作人、动作、目标类型、目标 ID、IP、时间和允许的变更摘要。
3. `oldValues`、`newValues` 只保存字段名、稳定编码、关联 ID、状态、版本和时间，不保存姓名、电话、邮箱、身份证、执业证号、职责全文或备注全文。
4. 密码、Hash、token、数据库连接串和本地环境值在任何日志中都禁止出现。
5. 审计写入失败时业务事务回滚，不允许业务成功但审计缺失。
6. OperationLog 不允许通过业务 API 修改或删除。

完整的管理员事前审核、事后复核、回滚关系和 L3/L4 访问目的记录继续由 SPEC-005 承接。

## 13. 页面设计

### 13.1 路由

| 路由 | 页面 |
| --- | --- |
| `/org/tree` | 行政组织树和所选组织详情 |
| `/org/positions` | 按组织筛选的岗位管理 |
| `/org/employees` | 员工列表、档案和任职管理 |
| `/org/professional-teams` | 专业团队和成员管理 |

旧 `/organizations`、`/employees` 路由保留客户端重定向到新路径，不保留两套页面实现。

### 13.2 组织与岗位

组织页采用左侧可搜索树、右侧详情和动作区。创建、移动、启停使用独立对话框，不能通过拖拽直接完成高影响移动。根组织不显示停用和移动动作。

岗位页以组织筛选和紧凑表格为主，展示编码、名称、类别、层级、状态和生效任职数。存在生效任职时，停用按钮不可提交，并展示服务端返回的明确原因。

### 13.3 员工

员工列表支持姓名/工号关键词、状态、主组织和专业团队筛选。详情使用基础档案、任职历史、专业团队、账号绑定四个页签。创建员工必须在同一表单中选择主组织和主岗位；岗位选项随组织联动。

手机号、身份证和执业证字段当前只对超级管理员页面展示。页面不得把敏感字段写入 URL、浏览器日志或错误提示。

### 13.4 专业团队

团队页面展示团队分类、归口组织、负责人、成员数和状态。成员选择器允许从不同分所选择员工，负责人调整使用明确动作，不通过普通成员编辑隐式完成。

### 13.5 页面状态

所有页面具备加载、空数据、无权限、失败重试和版本冲突状态。版本冲突时保留用户输入，提示刷新最新数据后重新提交。前端隐藏入口只改善体验，不能替代服务端门禁。

## 14. 安全边界

1. 本 Spec 全部 API 默认拒绝，只有实时持有 `SYSTEM_SUPER_ADMIN` 的用户可访问。
2. 账号被停用、锁定、凭据版本变化或必须改密时，沿用 SPEC-002 的认证阻断。
3. 前端根据登录响应中的角色隐藏组织管理导航，但服务端每次重新查询角色，不信任前端。
4. 不支持通过请求传入任意 path、level、createdAt、updatedAt 或审计操作人。
5. 列表排序字段采用允许列表，禁止拼接任意数据库字段。
6. 所有文本字段限制长度，编码字段统一规范化，日期必须是有效 ISO 日期或时间。
7. 生产环境仍受 SEC-SPEC-001 的依赖门禁、显式 CORS 和外部密钥配置约束。

## 15. 测试策略

### 15.1 Schema 与 migration

1. Schema contract 验证新增模型、关系、索引、字段类型和已移除的 Employee 直接组织字段。
2. migration 在空数据库、仅完成 SPEC-002 初始化的数据库和包含历史组织/员工夹具的数据库上验证。
3. 验证脏数据、多个主职、岗位组织不一致和组织循环会失败关闭。
4. 验证 migration 不创建任何预置部门、分所、员工或专业团队。

### 15.2 应用服务

1. 每个层级组合测试允许和拒绝路径。
2. 组织移动测试正常移动、移动到后代、无效父类型、子树路径更新和版本冲突。
3. 员工创建、调岗、兼任、代理、结束任职、转正和离职测试事务原子性。
4. 专业团队测试跨分所成员、重复成员、唯一负责人和停用限制。
5. 账号绑定测试普通用户、首位超级管理员、重复绑定和解绑。
6. 审计写入故障注入必须导致业务回滚。

### 15.3 API 与安全

1. 未登录返回 401；普通已登录用户返回 403；超级管理员按规则成功。
2. 删除型旧接口不得物理删除数据。
3. 参数、分页、排序、404、409 和数据库竞争映射为稳定响应。
4. 响应和日志扫描不得出现密码 Hash、token 或禁止的敏感快照字段。

### 15.4 前端

1. Vitest 覆盖路由门禁、组织树递归、岗位联动、员工创建、调岗、团队成员和冲突提示。
2. 浏览器验收覆盖桌面和移动视口，验证文本不溢出、控件不重叠、树和表格可操作。
3. 使用真实本地 API 完成“建分所 -> 建岗位 -> 建员工 -> 调岗 -> 加入跨分所团队”的端到端流程。

### 15.5 回归

使用 Node.js `22.14.0`、npm `10.9.2` 和 PostgreSQL 16 执行完整 `npm run verify`。验收结束后重置 `_test` 数据库并证明所有应用表为空。现有 React Hook 警告和前端大包警告不得新增；本 Spec 修改到的页面应消除对应 Hook 警告。

## 16. 非功能要求

1. 500 个组织节点的树接口在正常本地验收环境下 2 秒内返回。
2. 10,000 名员工规模下，带主组织或专业团队筛选的首屏分页查询在合理索引下 2 秒内返回。
3. 所有列表有确定性次级排序，翻页时不得因相同排序值产生重复或漏项。
4. 组织树和任职关系查询不得出现逐行 N+1 查询。
5. 组织移动和人员状态变更失败后不得留下部分路径、孤立任职或未结束成员关系。
6. 服务、DTO、层级策略和审计摘要分别放置，避免形成新的大型 Controller。

## 17. 验收标准

只有以下条件全部满足，SPEC-003 才可记录为本地实施完成：

1. 根组织保持唯一且受保护，可以修改名称但不能移动、停用或删除。
2. 可以建立前瞻研究部、律师培训部、品牌宣传部、两个地区分所及下级部门，并拒绝非法层级。
3. 组织移动正确更新整棵子树，循环移动和并发旧版本均被拒绝。
4. 岗位只能在所属组织使用，存在生效任职时不能停用。
5. 员工建档同时产生唯一主职，调岗完整保留旧主职历史。
6. 员工可以拥有多个兼任/代理关系，但只能有一个生效主职。
7. 三大专业团队及其他分类都可人工创建，成员可以跨分所，团队负责人保持唯一。
8. 首位超级管理员可以绑定真实员工且信任根 ID、角色和认证状态不变。
9. 普通已登录用户不能读取或修改本 Spec 主数据，超级管理员可以完成全部受控操作。
10. 任何组织、岗位、员工、任职和团队主数据都不会被业务 API 物理删除。
11. 乐观锁和数据库约束可阻断并发重复主职、重复团队成员和重复负责人。
12. 所有写操作具备同事务脱敏审计，审计失败时业务回滚。
13. 页面可完成组织、岗位、员工任职和专业团队的核心操作，并正确处理空状态、拒绝、失败和冲突。
14. migration、服务、API、前端和端到端测试通过，完整回归验证通过。
15. 测试数据库在验收后为空；未提交环境文件、数据库产物、日志、构建产物或敏感值。
16. 所有提交只保存在本地，GitHub push、PR 和远程 CI 未执行且不被记录为已通过。

## 18. 后续 Spec 接口

### 18.1 SPEC-004：RBAC、数据范围与敏感权限

SPEC-004 直接复用：

- Organization.path 计算 `ORG` 和下级组织范围。
- EmployeeAssignment 计算主组织、兼任组织、本人和下属关系。
- ProfessionalTeamMember 计算跨分所团队范围。
- User.employeeId 建立账号与人员身份关联。

SPEC-004 上线后，以 `organization.manage`、`position.manage`、`employee.manage`、`professional_team.manage` 等正式资源替换临时超级管理员门禁。

### 18.2 SPEC-005：系统管理员治理

SPEC-005 在本 Spec 的脱敏 OperationLog 基础上增加管理员授权、事前审核、事后复核、变更差异、影响分析和回滚关系。本 Spec 不把普通组织人员操作错误地包装为已经完成管理员治理。

### 18.3 业务模块

线索、合同、案件、财务、人事和驾驶舱只能引用本 Spec 的组织、员工和专业团队 ID。业务模块不得重新定义分所、团队或人员归属表。

## 19. 结论

SPEC-003 采用行政组织树与专业团队矩阵分离、员工身份与任职关系分离、应用服务承载规则、PostgreSQL 约束兜底的方案。它建立可供多分所经营和跨分所专业协作复用的主数据基础，同时严格控制范围：完整权限由 SPEC-004 承接，管理员治理由 SPEC-005 承接，不在本阶段制造临时的第二套权限、审批或事件系统。
