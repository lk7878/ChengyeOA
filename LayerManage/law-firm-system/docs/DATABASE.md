# 律所闭环管理系统 - 数据库设计文档

> 版本：v1.0
> 创建日期：2026-04-25
> 数据库：SQLite
> ORM：Prisma

---

## 目录

1. [设计原则](#一设计原则)
2. [实体关系图](#二实体关系图)
3. [表结构详细设计](#三表结构详细设计)
4. [索引设计](#四索引设计)
5. [数据字典](#五数据字典)
6. [Prisma Schema 文件位置](#六prisma-schema-文件位置)

---

## 一、设计原则

1. **单文件数据库**：使用 SQLite，整个数据库就是一个文件，便于备份和迁移
2. **UUID 主键**：所有表使用 UUID 作为主键，便于分布式扩展（未来如需迁移到 PostgreSQL）
3. **统一时间戳**：所有表包含 `createdAt` 和 `updatedAt`
4. **软删除**：使用状态字段（`status`）标记删除，不物理删除数据
5. **JSON 字段**：SQLite 不支持 JSON 类型，使用 String 存储 JSON 字符串
6. **关联清晰**：外键关系明确，支持级联操作

---

## 二、实体关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         组织架构层                                │
├─────────────────────────────────────────────────────────────────┤
│  Organization (组织)                                            │
│    ├── Position (岗位) [1:N]                                    │
│    └── Employee (员工) [1:N]                                     │
│           ├── User (用户) [1:1]                                  │
│           └── Performance (绩效) [1:N]                            │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         权限控制层                                │
├─────────────────────────────────────────────────────────────────┤
│  Role (角色) ←── UserRole ──→ User                               │
│    └── Permission (权限)                                         │
│         └── RolePermission                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         业务运营层                                │
├─────────────────────────────────────────────────────────────────┤
│  Channel (渠道)                                                  │
│    └── Lead (线索) [1:N]                                         │
│           ├── LeadFollow (跟进记录) [1:N]                         │
│           └── Customer (客户) [1:1]                              │
│                  ├── Contract (合同) [1:N]                        │
│                  │      ├── Payment (收款) [1:N]                  │
│                  │      └── Case (案件) [1:1]                   │
│                  ├── Case (案件) [1:N]                           │
│                  │      ├── CaseTask (任务) [1:N]               │
│                  │      └── Communication (沟通) [1:N]          │
│                  └── Payment (收款) [1:N]                        │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         系统支撑层                                │
├─────────────────────────────────────────────────────────────────┤
│  Approval (审批)                                                  │
│  Notification (通知)                                               │
│  OperationLog (操作日志)                                           │
│  LoginLog (登录日志)                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、表结构详细设计

### 3.1 组织架构模块

#### organization（组织架构表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | NOT NULL | 组织名称 |
| type | String | NOT NULL | 类型：FIRM(律所)/BRANCH(分所)/DEPARTMENT(部门) |
| parentId | String | FK | 上级组织ID |
| sort | Int | DEFAULT 0 | 排序 |
| status | String | DEFAULT 'ENABLED' | 状态：ENABLED/DISABLED |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 自关联：parentId → organization.id（树形结构）
- 一对多：organization → positions
- 一对多：organization → employees

#### position（岗位表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | NOT NULL | 岗位名称 |
| orgId | String | FK | 所属组织 |
| level | Int | DEFAULT 0 | 岗位级别 |
| responsibilities | String | NULL | 岗位职责 |
| status | String | DEFAULT 'ENABLED' | 状态 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：position → organization
- 一对多：position → employees

---

### 3.2 人事/员工模块

#### employee（员工表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| employeeNo | String | UNIQUE | 工号 |
| name | String | NOT NULL | 姓名 |
| idCard | String | UNIQUE, NULL | 身份证号 |
| phone | String | NOT NULL | 联系电话 |
| email | String | NULL | 邮箱 |
| type | String | NOT NULL | 员工类型 |
| status | String | DEFAULT 'PROBATION' | 状态：PROBATION(试用期)/FORMAL(正式)/LEAVED(离职) |
| entryDate | DateTime | NOT NULL | 入职日期 |
| leaveDate | DateTime | NULL | 离职日期 |
| orgId | String | FK | 所属组织 |
| positionId | String | FK | 岗位ID |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：employee → organization
- 多对一：employee → position
- 一对一：employee → user（可选）
- 一对多：employee → leads（作为负责人）
- 一对多：employee → cases（作为主办律师）
- 一对多：employee → performances

---

### 3.3 用户/权限模块

#### user（用户表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| username | String | UNIQUE | 用户名 |
| password | String | NOT NULL | 密码（bcrypt哈希） |
| status | String | DEFAULT 'ENABLED' | 状态：ENABLED/DISABLED |
| employeeId | String | FK, UNIQUE, NULL | 关联员工 |
| lastLoginAt | DateTime | NULL | 最后登录时间 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 一对一：user → employee（可选）
- 一对多：user → userRoles
- 一对多：user → loginLogs

#### role（角色表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | UNIQUE | 角色名称 |
| type | String | NOT NULL | 类型：SYSTEM(系统)/BUSINESS(业务) |
| description | String | NULL | 描述 |
| status | String | DEFAULT 'ENABLED' | 状态 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 一对多：role → userRoles
- 一对多：role → rolePermissions

#### permission（权限表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| code | String | UNIQUE | 权限编码（如 user:create） |
| name | String | NOT NULL | 权限名称 |
| parentId | String | FK, NULL | 父权限ID（树形结构） |
| type | String | NOT NULL | 类型：MENU(菜单)/BUTTON(按钮)/API(接口) |
| path | String | NULL | 路径/接口地址 |
| sort | Int | DEFAULT 0 | 排序 |
| status | String | DEFAULT 'ENABLED' | 状态 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |

**关系：**
- 自关联：parentId → permission.id
- 一对多：permission → rolePermissions

#### user_role（用户角色关联表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| userId | String | FK | 用户ID |
| roleId | String | FK | 角色ID |

**约束：** UNIQUE(userId, roleId)

#### role_permission（角色权限关联表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| roleId | String | FK | 角色ID |
| permissionId | String | FK | 权限ID |

**约束：** UNIQUE(roleId, permissionId)

#### login_log（登录日志表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| userId | String | FK | 用户ID |
| ip | String | NULL | IP地址 |
| userAgent | String | NULL | 用户代理 |
| createdAt | DateTime | DEFAULT now() | 登录时间 |

---

### 3.4 运营/渠道模块

#### channel（渠道表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | NOT NULL | 渠道名称 |
| type | String | NOT NULL | 渠道类型 |
| accountInfo | String | NULL | 账户信息 |
| cost | Decimal | DEFAULT 0 | 成本 |
| status | String | DEFAULT 'ENABLED' | 状态 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 一对多：channel → leads

---

### 3.5 线索/销转模块

#### lead（线索表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | NOT NULL | 客户姓名 |
| phone | String | NOT NULL | 联系电话 |
| wechat | String | NULL | 微信号 |
| channelId | String | FK, NULL | 来源渠道 |
| sourceDetail | String | NULL | 来源详情 |
| intentionLevel | Int | DEFAULT 3 | 意向等级 1-5 |
| status | String | DEFAULT 'NEW' | 线索状态 |
| assignedTo | String | FK, NULL | 负责人 |
| isValid | Boolean | DEFAULT true | 是否有效 |
| invalidReason | String | NULL | 无效原因 |
| tags | String | NULL | 标签（JSON字符串） |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：lead → channel（可选）
- 多对一：lead → employee（负责人，可选）
- 一对多：lead → leadFollows
- 一对一：lead → customer（转化后）

**索引：** status, assignedTo, channelId

#### lead_follow（线索跟进记录表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| leadId | String | FK | 线索ID |
| type | String | NOT NULL | 跟进类型：PHONE/WECHAT/VISIT/ONLINE/OTHER |
| content | String | NOT NULL | 跟进内容 |
| nextPlan | String | NULL | 下次计划 |
| nextTime | DateTime | NULL | 下次跟进时间 |
| createdBy | String | NOT NULL | 跟进人 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |

**关系：**
- 多对一：leadFollow → lead

**索引：** leadId

---

### 3.6 客户模块

#### customer（客户表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| name | String | NOT NULL | 客户姓名 |
| phone | String | NOT NULL | 联系电话 |
| wechat | String | NULL | 微信号 |
| idCard | String | UNIQUE, NULL | 身份证号 |
| email | String | NULL | 邮箱 |
| address | String | NULL | 地址 |
| status | String | DEFAULT 'POTENTIAL' | 客户状态 |
| leadId | String | FK, UNIQUE, NULL | 关联线索 |
| tags | String | NULL | 标签（JSON字符串） |
| remark | String | NULL | 备注 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 一对一：customer → lead（可选）
- 一对多：customer → contracts
- 一对多：customer → cases
- 一对多：customer → payments

**索引：** status

---

### 3.7 合同模块

#### contract（合同表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| contractNo | String | UNIQUE | 合同编号 |
| title | String | NOT NULL | 合同名称 |
| type | String | NOT NULL | 合同类型 |
| customerId | String | FK | 客户ID |
| amount | Decimal | DEFAULT 0 | 合同金额 |
| paidAmount | Decimal | DEFAULT 0 | 已付款金额 |
| status | String | DEFAULT 'DRAFT' | 合同状态 |
| signDate | DateTime | NULL | 签署日期 |
| startDate | DateTime | NULL | 开始日期 |
| endDate | DateTime | NULL | 结束日期 |
| paymentTerms | String | NULL | 付款条件（JSON字符串） |
| terms | String | NULL | 特殊条款 |
| createdBy | String | NOT NULL | 创建人 |
| approvedBy | String | NULL | 审批人 |
| approvedAt | DateTime | NULL | 审批时间 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：contract → customer
- 一对多：contract → payments
- 一对一：contract → case（可选）

**索引：** status, customerId

---

### 3.8 财务/收款模块

#### payment（收款表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| contractId | String | FK, NULL | 合同ID |
| customerId | String | FK | 客户ID |
| amount | Decimal | DEFAULT 0 | 应收金额 |
| receivedAmount | Decimal | DEFAULT 0 | 已收金额 |
| status | String | DEFAULT 'PENDING' | 收款状态 |
| dueDate | DateTime | NULL | 应收日期 |
| receivedDate | DateTime | NULL | 实收日期 |
| paymentMethod | String | NULL | 收款方式 |
| paymentAccount | String | NULL | 收款账户 |
| remark | String | NULL | 备注 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：payment → contract（可选）
- 多对一：payment → customer

**索引：** status, contractId

---

### 3.9 案件模块

#### case（案件表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| caseNo | String | UNIQUE | 案件编号 |
| title | String | NOT NULL | 案件名称 |
| customerId | String | FK | 客户ID |
| contractId | String | FK, UNIQUE, NULL | 关联合同 |
| lawyerId | String | FK | 主办律师 |
| teamIds | String | NULL | 协办团队（JSON字符串） |
| caseType | String | NOT NULL | 案由/案件类型 |
| status | String | DEFAULT 'PENDING' | 案件状态 |
| priority | String | DEFAULT 'NORMAL' | 优先级 |
| fee | Decimal | DEFAULT 0 | 律师费 |
| description | String | NULL | 案件描述 |
| result | String | NULL | 案件结果 |
| satisfaction | Int | NULL | 满意度 1-5 |
| isReferrable | Boolean | DEFAULT false | 是否可转介绍 |
| closedAt | DateTime | NULL | 结案时间 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：case → customer
- 一对一：case → contract（可选）
- 多对一：case → employee（主办律师）
- 一对多：case → caseTasks
- 一对多：case → communications

**索引：** status, lawyerId

#### case_task（案件任务表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| caseId | String | FK | 案件ID |
| name | String | NOT NULL | 任务名称 |
| nodeType | String | NOT NULL | 节点类型 |
| status | String | DEFAULT 'PENDING' | 任务状态 |
| dueDate | DateTime | NULL | 截止日期 |
| completedAt | DateTime | NULL | 完成时间 |
| remark | String | NULL | 备注 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：caseTask → case

**索引：** caseId

#### communication（沟通记录表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| caseId | String | FK | 案件ID |
| type | String | NOT NULL | 沟通类型 |
| content | String | NOT NULL | 沟通内容 |
| isKey | Boolean | DEFAULT false | 是否关键沟通 |
| createdBy | String | NOT NULL | 记录人 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |

**关系：**
- 多对一：communication → case

**索引：** caseId

---

### 3.10 绩效模块

#### performance（绩效表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| employeeId | String | FK | 员工ID |
| period | String | NOT NULL | 考核周期（如 2026-04） |
| type | String | NOT NULL | 考核类型：MONTHLY/QUARTERLY/YEARLY |
| kpiData | String | NULL | KPI数据（JSON字符串） |
| score | Decimal | NULL | 绩效分数 |
| bonus | Decimal | NULL | 奖金 |
| remark | String | NULL | 备注 |
| status | String | DEFAULT 'PENDING' | 状态：PENDING/CONFIRMED |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**关系：**
- 多对一：performance → employee

**约束：** UNIQUE(employeeId, period, type)

---

### 3.11 审批模块

#### approval（审批表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| type | String | NOT NULL | 审批类型 |
| title | String | NOT NULL | 审批标题 |
| applicantId | String | NOT NULL | 申请人 |
| content | String | NOT NULL | 申请内容（JSON字符串） |
| status | String | DEFAULT 'PENDING' | 审批状态 |
| approverId | String | NULL | 审批人 |
| approvedAt | DateTime | NULL | 审批时间 |
| remark | String | NULL | 备注 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |
| updatedAt | DateTime | AUTO UPDATE | 更新时间 |

**索引：** status

---

### 3.12 通知模块

#### notification（通知表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| userId | String | NOT NULL | 接收用户 |
| type | String | NOT NULL | 通知类型 |
| title | String | NOT NULL | 标题 |
| content | String | NOT NULL | 内容 |
| isRead | Boolean | DEFAULT false | 是否已读 |
| relatedId | String | NULL | 关联业务ID |
| relatedType | String | NULL | 关联业务类型 |
| createdAt | DateTime | DEFAULT now() | 创建时间 |

**索引：** userId + isRead

---

### 3.13 日志模块

#### operation_log（操作日志表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | UUID |
| userId | String | NULL | 操作人 |
| action | String | NOT NULL | 操作类型 |
| targetType | String | NOT NULL | 目标类型 |
| targetId | String | NOT NULL | 目标ID |
| oldValues | String | NULL | 修改前数据（JSON） |
| newValues | String | NULL | 修改后数据（JSON） |
| ip | String | NULL | IP地址 |
| createdAt | DateTime | DEFAULT now() | 操作时间 |

**索引：** targetType + targetId

---

## 四、索引设计

### 4.1 索引列表

| 表名 | 索引字段 | 索引类型 | 说明 |
|------|---------|---------|------|
| lead | status | 普通索引 | 按状态查询 |
| lead | assignedTo | 普通索引 | 按负责人查询 |
| lead | channelId | 普通索引 | 按渠道查询 |
| lead_follow | leadId | 普通索引 | 按线索查询 |
| customer | status | 普通索引 | 按状态查询 |
| contract | status | 普通索引 | 按状态查询 |
| contract | customerId | 普通索引 | 按客户查询 |
| payment | status | 普通索引 | 按状态查询 |
| payment | contractId | 普通索引 | 按合同查询 |
| case | status | 普通索引 | 按状态查询 |
| case | lawyerId | 普通索引 | 按律师查询 |
| case_task | caseId | 普通索引 | 按案件查询 |
| communication | caseId | 普通索引 | 按案件查询 |
| notification | userId + isRead | 复合索引 | 查询未读通知 |
| operation_log | targetType + targetId | 复合索引 | 查询操作记录 |
| performance | employeeId + period + type | 唯一索引 | 防止重复考核 |

---

## 五、数据字典

### 5.1 状态枚举值

#### 线索状态 (Lead.status)
| 值 | 说明 |
|----|------|
| NEW | 新线索 |
| CONTACTED | 已联系 |
| SCREENED | 已初筛 |
| INVITED | 已邀约 |
| VISITED | 已到访 |
| NEGOTIATING | 谈判中 |
| QUOTED | 已报价 |
| SIGNED | 已签约 |
| LOST | 已流失 |

#### 客户状态 (Customer.status)
| 值 | 说明 |
|----|------|
| POTENTIAL | 潜在客户 |
| INTENT | 有意向 |
| SIGNED | 已签约 |
| INACTIVE | 非活跃 |

#### 合同状态 (Contract.status)
| 值 | 说明 |
|----|------|
| DRAFT | 草稿 |
| PENDING | 待审批 |
| APPROVED | 已审批 |
| SIGNED | 已签署 |
| EXECUTING | 执行中 |
| COMPLETED | 已完成 |
| TERMINATED | 已终止 |
| CANCELLED | 已取消 |

#### 收款状态 (Payment.status)
| 值 | 说明 |
|----|------|
| PENDING | 待收款 |
| RECEIVED | 已收款 |
| OVERDUE | 已逾期 |
| REFUNDED | 已退款 |

#### 案件状态 (Case.status)
| 值 | 说明 |
|----|------|
| PENDING | 待受理 |
| ACCEPTED | 已受理 |
| PROCESSING | 办理中 |
| CLOSED | 已结案 |
| ARCHIVED | 已归档 |

#### 任务状态 (CaseTask.status)
| 值 | 说明 |
|----|------|
| PENDING | 待处理 |
| IN_PROGRESS | 进行中 |
| COMPLETED | 已完成 |
| OVERDUE | 已逾期 |

#### 员工状态 (Employee.status)
| 值 | 说明 |
|----|------|
| PROBATION | 试用期 |
| FORMAL | 正式员工 |
| LEAVED | 已离职 |

#### 审批状态 (Approval.status)
| 值 | 说明 |
|----|------|
| PENDING | 待审批 |
| APPROVED | 已通过 |
| REJECTED | 已驳回 |

### 5.2 类型枚举值

#### 员工类型 (Employee.type)
| 值 | 说明 |
|----|------|
| PARTNER | 合伙人 |
| SENIOR_LAWYER | 高级律师 |
| JUNIOR_LAWYER | 初级律师 |
| ASSISTANT | 助理 |
| SALES | 销售 |
| ADMIN | 行政 |
| HR | 人事 |
| FINANCE | 财务 |
| OPERATOR | 运营 |

#### 渠道类型 (Channel.type)
| 值 | 说明 |
|----|------|
| SEARCH | 搜索引擎 |
| SHORT_VIDEO | 短视频 |
| LIVE | 直播 |
| INFO_FLOW | 信息流 |
| WECHAT | 微信 |
| REFERRAL | 转介绍 |
| NATURAL | 自然咨询 |
| OFFLINE | 线下活动 |
| OTHER | 其他 |

#### 合同类型 (Contract.type)
| 值 | 说明 |
|----|------|
| CONSULTING | 咨询合同 |
| RETAINER | 常年顾问 |
| LITIGATION | 诉讼合同 |
| ARBITRATION | 仲裁合同 |
| MEDIATION | 调解合同 |
| OTHER | 其他 |

#### 审批类型 (Approval.type)
| 值 | 说明 |
|----|------|
| REFUND | 退款 |
| EXPENSE | 费用 |
| CONTRACT_CHANGE | 合同变更 |
| SEAL | 用章 |
| LEAVE | 请假 |
| TRANSFER | 调岗 |
| OTHER | 其他 |

---

## 六、Prisma Schema 文件位置

Prisma Schema 文件位于：
```
/home/lk/law-firm-system/prisma/schema.prisma
```

### 6.1 常用命令

```bash
# 进入后端目录
cd /home/lk/law-firm-system/apps/server

# 生成 Prisma Client
npx prisma generate

# 创建迁移
npx prisma migrate dev --name init

# 部署迁移（生产环境）
npx prisma migrate deploy

# 打开 Prisma Studio（可视化数据库管理）
npx prisma studio

# 重置数据库（开发环境慎用）
npx prisma migrate reset
```

### 6.2 环境变量配置

```env
# .env
DATABASE_URL="file:./law_firm.db"
```

---

*文档版本：v1.0*
*最后更新：2026-04-25*
