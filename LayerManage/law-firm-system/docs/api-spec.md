# 律所管理系统 API 规范文档
> 版本: v1.0 | 生成日期: 2026-04-26
> 技术栈: Egg.js + TypeScript + Prisma + PostgreSQL 16 + JWT

---

## 目录

1. [通用规范](#1-通用规范)
2. [认证模块](#2-认证模块-auth)
3. [用户管理](#3-用户管理-user)
4. [角色权限](#4-角色权限-role--permission)
5. [组织架构](#5-组织架构-organization)
6. [岗位管理](#6-岗位管理-position)
7. [员工管理](#7-员工管理-employee)
8. [渠道管理](#8-渠道管理-channel)
9. [线索管理](#9-线索管理-lead)
10. [客户管理](#10-客户管理-customer)
11. [合同管理](#11-合同管理-contract)
12. [收款管理](#12-收款管理-payment)
13. [案件管理](#13-案件管理-case)
14. [审批管理](#14-审批管理-approval)
15. [通知管理](#15-通知管理-notification)
16. [绩效管理](#16-绩效管理-performance)
17. [仪表盘](#17-仪表盘-dashboard)
18. [数据模型](#18-数据模型)
19. [JWT 认证机制](#19-jwt-认证机制)

---

## 1. 通用规范

### 1.1 基础信息

| 项目 | 值 |
|------|-----|
| 基础 URL | `http://localhost:7001/api/v1` |
| 协议 | HTTP/1.1 (开发) / HTTPS (生产) |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |
| 时间格式 | ISO 8601 (`2026-04-26T10:30:00.000Z`) |

### 1.2 响应格式

```typescript
interface ApiResponse<T> {
  code: number;      // 状态码: 200 成功, 4xx 客户端错误, 5xx 服务端错误
  message: string;   // 提示信息
  data: T;           // 业务数据
}
```

### 1.3 分页格式

```typescript
interface Pagination {
  page: number;       // 当前页码
  pageSize: number;   // 每页条数
  total: number;      // 总条数
  totalPages: number; // 总页数
}

interface PaginatedResponse<T> {
  list: T[];
  pagination: Pagination;
}
```

### 1.4 通用查询参数

所有列表接口支持以下通用参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码，默认 1 |
| `pageSize` | number | 否 | 每页条数，默认 10 |
| `keyword` | string | 否 | 关键词搜索 |

### 1.5 HTTP 状态码

| 状态码 | 含义 | 场景 |
|--------|------|------|
| 200 | OK | 请求成功 |
| 400 | Bad Request | 参数错误/校验失败 |
| 401 | Unauthorized | 未认证/Token 无效 |
| 403 | Forbidden | 无权限/账号禁用 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突（如重复） |
| 500 | Internal Server Error | 服务端错误 |

### 1.6 认证方式

**Bearer Token**

```http
Authorization: Bearer <access_token>
```

Token 有效期：7 天  
Refresh Token 有效期：30 天

---

## 2. 认证模块 (Auth)

### 2.1 用户登录

```http
POST /api/v1/auth/login
Content-Type: application/json
```

**请求体：**

```json
{
  "username": "admin",
  "password": "123456"
}
```

**响应：**

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "<access-token>",
    "refreshToken": "<refresh-token>",
    "expiresIn": 604800,
    "user": {
      "id": "uuid",
      "username": "admin",
      "name": "admin",
      "roles": ["admin"],
      "permissions": ["user:create", "user:read", ...]
    }
  }
}
```

### 2.2 刷新 Token

```http
POST /api/v1/auth/refresh
Content-Type: application/json
```

**请求体：**

```json
{
  "refreshToken": "<refresh-token>"
}
```

### 2.3 获取当前用户信息

```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

### 2.4 用户登出

```http
POST /api/v1/auth/logout
Authorization: Bearer <token>
```

---

## 3. 用户管理 (User)

### 3.1 用户列表

```http
GET /api/v1/users?page=1&pageSize=10&keyword=&status=ENABLED
Authorization: Bearer <token>
```

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `keyword` | string | 搜索用户名/员工姓名 |
| `status` | string | ENABLED / DISABLED |

### 3.2 用户详情

```http
GET /api/v1/users/:id
Authorization: Bearer <token>
```

### 3.3 创建用户

```http
POST /api/v1/users
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "username": "zhangsan",
  "password": "123456",
  "status": "ENABLED",
  "employeeId": "uuid"  // 可选，关联员工
}
```

### 3.4 更新用户

```http
PUT /api/v1/users/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "status": "DISABLED",
  "employeeId": "uuid"
}
```

### 3.5 删除用户

```http
DELETE /api/v1/users/:id
Authorization: Bearer <token>
```

### 3.6 分配角色

```http
POST /api/v1/users/:id/roles
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "roleIds": ["role-uuid-1", "role-uuid-2"]
}
```

---

## 4. 角色权限 (Role & Permission)

### 4.1 角色列表

```http
GET /api/v1/roles
Authorization: Bearer <token>
```

### 4.2 角色详情

```http
GET /api/v1/roles/:id
Authorization: Bearer <token>
```

### 4.3 创建角色

```http
POST /api/v1/roles
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "销售经理",
  "type": "BUSINESS",
  "description": "负责销售团队管理"
}
```

### 4.4 更新角色

```http
PUT /api/v1/roles/:id
Authorization: Bearer <token>
```

### 4.5 删除角色

```http
DELETE /api/v1/roles/:id
Authorization: Bearer <token>
```

### 4.6 分配权限

```http
POST /api/v1/roles/:id/permissions
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "permissionIds": ["perm-uuid-1", "perm-uuid-2"]
}
```

### 4.7 权限列表

```http
GET /api/v1/permissions
Authorization: Bearer <token>
```

### 4.8 权限树

```http
GET /api/v1/permissions/tree
Authorization: Bearer <token>
```

---

## 5. 组织架构 (Organization)

### 5.1 组织列表

```http
GET /api/v1/organizations
Authorization: Bearer <token>
```

### 5.2 组织树

```http
GET /api/v1/organizations/tree
Authorization: Bearer <token>
```

### 5.3 组织详情

```http
GET /api/v1/organizations/:id
Authorization: Bearer <token>
```

### 5.4 创建组织

```http
POST /api/v1/organizations
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "刑事部",
  "type": "DEPARTMENT",
  "parentId": "parent-uuid",
  "sort": 1
}
```

**组织类型枚举：**

| 类型 | 说明 |
|------|------|
| `FIRM` | 律所总部 |
| `BRANCH` | 分所 |
| `DEPARTMENT` | 部门 |

### 5.5 更新组织

```http
PUT /api/v1/organizations/:id
Authorization: Bearer <token>
```

### 5.6 删除组织

```http
DELETE /api/v1/organizations/:id
Authorization: Bearer <token>
```

---

## 6. 岗位管理 (Position)

### 6.1 岗位列表

```http
GET /api/v1/positions
Authorization: Bearer <token>
```

### 6.2 岗位详情

```http
GET /api/v1/positions/:id
Authorization: Bearer <token>
```

### 6.3 创建岗位

```http
POST /api/v1/positions
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "高级律师",
  "orgId": "org-uuid",
  "level": 3,
  "responsibilities": "负责重大案件"
}
```

### 6.4 更新岗位

```http
PUT /api/v1/positions/:id
Authorization: Bearer <token>
```

### 6.5 删除岗位

```http
DELETE /api/v1/positions/:id
Authorization: Bearer <token>
```

---

## 7. 员工管理 (Employee)

### 7.1 员工列表

```http
GET /api/v1/employees?page=1&pageSize=10&keyword=
Authorization: Bearer <token>
```

### 7.2 员工详情

```http
GET /api/v1/employees/:id
Authorization: Bearer <token>
```

### 7.3 创建员工

```http
POST /api/v1/employees
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "employeeNo": "E2026001",
  "name": "张三",
  "phone": "13800138000",
  "email": "zhangsan@law.com",
  "type": "SENIOR_LAWYER",
  "entryDate": "2026-01-01",
  "orgId": "org-uuid",
  "positionId": "position-uuid"
}
```

**员工类型枚举：**

| 类型 | 说明 |
|------|------|
| `PARTNER` | 合伙人 |
| `SENIOR_LAWYER` | 资深律师 |
| `JUNIOR_LAWYER` | 初级律师 |
| `ASSISTANT` | 律师助理 |
| `SALES` | 销售 |
| `ADMIN` | 行政 |
| `HR` | 人事 |
| `FINANCE` | 财务 |
| `OPERATOR` | 运营 |

**员工状态枚举：**

| 状态 | 说明 |
|------|------|
| `PROBATION` | 试用期 |
| `FORMAL` | 正式 |
| `LEAVED` | 已离职 |

### 7.4 更新员工

```http
PUT /api/v1/employees/:id
Authorization: Bearer <token>
```

### 7.5 删除员工

```http
DELETE /api/v1/employees/:id
Authorization: Bearer <token>
```

### 7.6 转正

```http
POST /api/v1/employees/:id/formalize
Authorization: Bearer <token>
```

### 7.7 离职

```http
POST /api/v1/employees/:id/leave
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "leaveDate": "2026-04-26"
}
```

---

## 8. 渠道管理 (Channel)

### 8.1 渠道列表

```http
GET /api/v1/channels
Authorization: Bearer <token>
```

### 8.2 渠道详情

```http
GET /api/v1/channels/:id
Authorization: Bearer <token>
```

### 8.3 创建渠道

```http
POST /api/v1/channels
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "百度推广",
  "type": "SEARCH",
  "accountInfo": "账号: baidu001",
  "cost": 5000.00
}
```

**渠道类型枚举：**

| 类型 | 说明 |
|------|------|
| `SEARCH` | 搜索引擎 |
| `SHORT_VIDEO` | 短视频 |
| `LIVE` | 直播 |
| `INFO_FLOW` | 信息流 |
| `WECHAT` | 微信 |
| `REFERRAL` | 转介绍 |
| `NATURAL` | 自然流量 |
| `OFFLINE` | 线下 |
| `OTHER` | 其他 |

### 8.4 更新渠道

```http
PUT /api/v1/channels/:id
Authorization: Bearer <token>
```

### 8.5 删除渠道

```http
DELETE /api/v1/channels/:id
Authorization: Bearer <token>
```

### 8.6 渠道统计

```http
GET /api/v1/channels/:id/statistics
Authorization: Bearer <token>
```

---

## 9. 线索管理 (Lead)

### 9.1 线索列表

```http
GET /api/v1/leads?page=1&pageSize=10&keyword=&status=&channelId=&assignedTo=&intentionLevel=
Authorization: Bearer <token>
```

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string | NEW/CONTACTED/SCREENED/INVITED/VISITED/NEGOTIATING/QUOTED/SIGNED/LOST |
| `channelId` | string | 渠道ID |
| `assignedTo` | string | 负责人ID |
| `intentionLevel` | number | 意向等级 1-5 |

### 9.2 线索详情

```http
GET /api/v1/leads/:id
Authorization: Bearer <token>
```

### 9.3 创建线索

```http
POST /api/v1/leads
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "李四",
  "phone": "13900139000",
  "wechat": "lisi_wechat",
  "channelId": "channel-uuid",
  "sourceDetail": "百度推广-关键词:律师咨询",
  "intentionLevel": 4,
  "tags": "[\"高净值\",\"离婚\"]"
}
```

### 9.4 更新线索

```http
PUT /api/v1/leads/:id
Authorization: Bearer <token>
```

### 9.5 删除线索

```http
DELETE /api/v1/leads/:id
Authorization: Bearer <token>
```

> ⚠️ 已转客户的线索无法删除

### 9.6 分配负责人

```http
POST /api/v1/leads/:id/assign
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "employeeId": "employee-uuid"
}
```

### 9.7 跟进

```http
POST /api/v1/leads/:id/follow
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "type": "PHONE",
  "content": "客户咨询离婚财产分割，意向强烈",
  "nextPlan": "发送服务方案",
  "nextTime": "2026-04-27T10:00:00Z"
}
```

**跟进类型枚举：**

| 类型 | 说明 |
|------|------|
| `PHONE` | 电话 |
| `WECHAT` | 微信 |
| `VISIT` | 到访 |
| `ONLINE` | 线上 |
| `OTHER` | 其他 |

### 9.8 转客户

```http
POST /api/v1/leads/:id/convert
Authorization: Bearer <token>
```

> 自动创建客户记录，线索状态变为 SIGNED

### 9.9 跟进记录列表

```http
GET /api/v1/leads/:id/follows
Authorization: Bearer <token>
```

### 9.10 回收线索

```http
POST /api/v1/leads/:id/recycle
Authorization: Bearer <token>
```

> 清除负责人，状态重置为 NEW

---

## 10. 客户管理 (Customer)

### 10.1 客户列表

```http
GET /api/v1/customers?page=1&pageSize=10&keyword=&status=
Authorization: Bearer <token>
```

**客户状态枚举：**

| 状态 | 说明 |
|------|------|
| `POTENTIAL` | 潜在客户 |
| `INTENT` | 意向客户 |
| `SIGNED` | 已签约 |
| `INACTIVE` | 流失 |

### 10.2 客户详情

```http
GET /api/v1/customers/:id
Authorization: Bearer <token>
```

### 10.3 创建客户

```http
POST /api/v1/customers
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "王五",
  "phone": "13700137000",
  "wechat": "wangwu_wechat",
  "customerType": "INDIVIDUAL",
  "email": "wangwu@email.com",
  "address": "北京市朝阳区xxx",
  "status": "POTENTIAL",
  "tags": "[\"企业客户\",\"常法\"]",
  "remark": "重要客户"
}
```

### 10.4 更新客户

```http
PATCH /api/v1/customers/:id
Authorization: Bearer <token>
```

需要 `customer.update` 和客户数据范围。字段同新建客户，仅修改传入字段；普通可选字段传空字符串可清空，电话传入时必须有效且非空，未传入则保持。可附带正整数 `version`，不匹配返回 `VERSION_CONFLICT`（409）；客户管理界面始终提交读取时的版本，旧调用可省略。电话/微信脱敏值不能作为新值提交。

### 10.5 删除客户

```http
DELETE /api/v1/customers/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "version": 1 }
```

依据 SPEC-CUSTOMER-CRUD-20260914，需要 `customer.delete` 和客户数据范围。事务内校验版本、关联记录，软删客户及联系人，写入审计；成功返回 `{ "code": 200, "message": "success", "data": null }`。

有关联来源/转介绍线索、案件、合同、收款、谈案、案情分析、开票或退款申请返回 `CUSTOMER_IN_USE`（409）；版本过期返回 `VERSION_CONFLICT`（409）；不存在/已删除/范围外客户沿用 `LEAD_NOT_FOUND`（404）。删除后列表及详情查询不再返回客户，历史档案保留。

### 10.6 客户联系人与转介绍

```http
GET /api/v1/customers/:id/contacts
POST /api/v1/customers/:id/contacts
PATCH /api/v1/customers/:id/contacts/:contactId
DELETE /api/v1/customers/:id/contacts/:contactId
GET /api/v1/customers/:id/referrals
POST /api/v1/customers/:id/referrals
```

联系人读取使用 `customer.read`，写入使用 `customer.update`；转介绍列表/创建使用 `lead.read`/`lead.create`。历史原型 `/customers/:id/contracts`、`/cases`、`/payments` 子资源未开放，请使用对应业务模块查询。

---

## 11. 合同管理 (Contract)

### 11.1 合同列表

```http
GET /api/v1/contracts?page=1&pageSize=10&keyword=&status=&type=&customerId=
Authorization: Bearer <token>
```

**合同类型枚举：**

| 类型 | 说明 |
|------|------|
| `CONSULTING` | 咨询合同 |
| `RETAINER` | 常年法律顾问 |
| `LITIGATION` | 诉讼代理 |
| `ARBITRATION` | 仲裁代理 |
| `MEDIATION` | 调解 |
| `OTHER` | 其他 |

**合同状态枚举：**

| 状态 | 说明 |
|------|------|
| `DRAFT` | 草稿 |
| `PENDING` | 待审批 |
| `APPROVED` | 已审批 |
| `SIGNED` | 已签署 |
| `EXECUTING` | 执行中 |
| `COMPLETED` | 已完成 |
| `TERMINATED` | 已终止 |
| `CANCELLED` | 已取消 |

### 11.2 合同详情

```http
GET /api/v1/contracts/:id
Authorization: Bearer <token>
```

### 11.3 创建合同

```http
POST /api/v1/contracts
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "contractNo": "C2026001",
  "title": "离婚财产分割代理合同",
  "type": "LITIGATION",
  "customerId": "customer-uuid",
  "amount": 50000.00,
  "paymentTerms": "[{\"phase\":\"签约\",\"ratio\":0.3,\"amount\":15000},{\"phase\":\"立案\",\"ratio\":0.3,\"amount\":15000},{\"phase\":\"结案\",\"ratio\":0.4,\"amount\":20000}]",
  "terms": "特殊条款",
  "startDate": "2026-04-01",
  "endDate": "2026-10-01"
}
```

### 11.4 更新合同

```http
PUT /api/v1/contracts/:id
Authorization: Bearer <token>
```

### 11.5 删除合同

```http
DELETE /api/v1/contracts/:id
Authorization: Bearer <token>
```

### 11.6 提交审批

```http
POST /api/v1/contracts/:id/submit
Authorization: Bearer <token>
```

> 状态变为 PENDING

### 11.7 审批通过

```http
POST /api/v1/contracts/:id/approve
Authorization: Bearer <token>
```

> 状态变为 APPROVED

### 11.8 签署

```http
POST /api/v1/contracts/:id/sign
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "signDate": "2026-04-26"
}
```

### 11.9 终止合同

```http
POST /api/v1/contracts/:id/terminate
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "reason": "双方协商一致"
}
```

### 11.10 合同台账

```http
GET /api/v1/contracts/ledger
Authorization: Bearer <token>
```

---

## 12. 收款管理 (Payment)

### 12.1 收款列表

```http
GET /api/v1/payments?page=1&pageSize=10&keyword=&status=&contractId=
Authorization: Bearer <token>
```

**收款状态枚举：**

| 状态 | 说明 |
|------|------|
| `PENDING` | 待收款 |
| `RECEIVED` | 已收款 |
| `OVERDUE` | 逾期 |
| `REFUNDED` | 已退款 |

### 12.2 收款详情

```http
GET /api/v1/payments/:id
Authorization: Bearer <token>
```

### 12.3 创建收款

```http
POST /api/v1/payments
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "contractId": "contract-uuid",
  "customerId": "customer-uuid",
  "amount": 15000.00,
  "dueDate": "2026-05-01",
  "paymentMethod": "银行转账",
  "paymentAccount": "6222xxxxxxxx",
  "remark": "第一期款项"
}
```

### 12.4 更新收款

```http
PUT /api/v1/payments/:id
Authorization: Bearer <token>
```

### 12.5 删除收款

```http
DELETE /api/v1/payments/:id
Authorization: Bearer <token>
```

### 12.6 确认收款

```http
POST /api/v1/payments/:id/confirm
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "receivedAmount": 15000.00,
  "receivedDate": "2026-04-26",
  "paymentMethod": "银行转账"
}
```

### 12.7 退款

```http
POST /api/v1/payments/:id/refund
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "refundAmount": 5000.00,
  "reason": "服务变更"
}
```

---

## 13. 案件管理 (Case)

### 13.1 案件列表

```http
GET /api/v1/cases?page=1&pageSize=10&keyword=&status=&lawyerId=&priority=
Authorization: Bearer <token>
```

**案件状态枚举：**

| 状态 | 说明 |
|------|------|
| `PENDING` | 待受理 |
| `ACCEPTED` | 已受理 |
| `PROCESSING` | 办理中 |
| `CLOSED` | 已结案 |
| `ARCHIVED` | 已归档 |

**优先级枚举：**

| 优先级 | 说明 |
|--------|------|
| `LOW` | 低 |
| `NORMAL` | 普通 |
| `HIGH` | 高 |
| `URGENT` | 紧急 |

### 13.2 案件详情

```http
GET /api/v1/cases/:id
Authorization: Bearer <token>
```

### 13.3 创建案件

```http
POST /api/v1/cases
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "caseNo": "A2026001",
  "title": "张三诉李四离婚纠纷",
  "customerId": "customer-uuid",
  "contractId": "contract-uuid",
  "lawyerId": "lawyer-uuid",
  "teamIds": "[\"lawyer2-uuid\",\"assistant-uuid\"]",
  "caseType": "离婚纠纷",
  "priority": "HIGH",
  "fee": 50000.00,
  "description": "案件描述"
}
```

### 13.4 更新案件

2026-09-14更新（SPEC-CASE-CRUD-20260914）：需`case.update`权限，JSON请求必须带`version`。支持原字段以及`customerId`、`fee`（十进制字符串）、`intakeData`、`attachments`、`removeAttachmentIds`。未提供的字段保持原值；提供`intakeData`时整体替换，`{}`清空补充字段。附件结构与新建相同，变更需`case.file.manage`，取消编辑不落库；全部修改和附件记录同事务保存。已结案/归档拒绝修改，关联财务合同后客户须与合同一致，版本过期返回409。

```http
PUT /api/v1/cases/:id
Authorization: Bearer <token>
```

### 13.5 删除案件

需`case.delete`权限，请求体为`{"version": 当前案件版本}`，成功响应data为`{"id": 案件ID}`。只允许删除未结案且没有关联财务合同或成本记录的案件；有关联返回409 `CASE_IN_USE`，终态返回409 `CASE_STATE_INVALID`，版本过期返回409 `VERSION_CONFLICT`。删除包含本案任务、沟通及文件，保留删除审计。普通角色须由权限管理员显式授权。

```http
DELETE /api/v1/cases/:id
Authorization: Bearer <token>
```

### 13.6 创建任务

```http
POST /api/v1/cases/:id/tasks
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "准备起诉材料",
  "nodeType": "立案准备",
  "dueDate": "2026-05-01"
}
```

### 13.7 更新任务

```http
PATCH /api/v1/cases/:id/tasks/:taskId
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "status": "COMPLETED",
  "remark": "已完成"
}
```

### 13.8 添加沟通记录

```http
POST /api/v1/cases/:id/communications
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "type": "MEETING",
  "content": "与客户面谈，确认诉讼策略",
  "isKey": true
}
```

### 13.9 结案

```http
POST /api/v1/cases/:id/close
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "result": "胜诉",
  "satisfaction": 5,
  "isReferrable": true
}
```

---

## 14. 审批管理 (Approval)

### 14.1 审批列表

```http
GET /api/v1/approvals?page=1&pageSize=10&status=
Authorization: Bearer <token>
```

**审批类型枚举：**

| 类型 | 说明 |
|------|------|
| `REFUND` | 退款 |
| `EXPENSE` | 费用报销 |
| `CONTRACT_CHANGE` | 合同变更 |
| `SEAL` | 用印 |
| `LEAVE` | 请假 |
| `TRANSFER` | 转所 |
| `OTHER` | 其他 |

### 14.2 审批详情

```http
GET /api/v1/approvals/:id
Authorization: Bearer <token>
```

### 14.3 创建审批

```http
POST /api/v1/approvals
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "type": "REFUND",
  "title": "客户退款申请",
  "content": "{\"amount\":5000,\"reason\":\"服务变更\"}",
  "applicantId": "employee-uuid"
}
```

### 14.4 处理审批

```http
POST /api/v1/approvals/:id/process
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "status": "APPROVED",
  "remark": "同意退款"
}
```

---

## 15. 通知管理 (Notification)

### 15.1 通知列表

```http
GET /api/v1/notifications?page=1&pageSize=10
Authorization: Bearer <token>
```

### 15.2 标记已读

```http
PATCH /api/v1/notifications/:id/read
Authorization: Bearer <token>
```

### 15.3 全部已读

```http
POST /api/v1/notifications/read-all
Authorization: Bearer <token>
```

### 15.4 未读数量

```http
GET /api/v1/notifications/unread-count
Authorization: Bearer <token>
```

---

## 16. 绩效管理 (Performance)

### 16.1 绩效列表

```http
GET /api/v1/performances?page=1&pageSize=10&employeeId=&period=
Authorization: Bearer <token>
```

### 16.2 绩效详情

```http
GET /api/v1/performances/:id
Authorization: Bearer <token>
```

### 16.3 创建绩效

```http
POST /api/v1/performances
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "employeeId": "employee-uuid",
  "period": "2026-04",
  "type": "MONTHLY",
  "kpiData": "{\"casesHandled\":5,\"revenue\":100000,\"satisfaction\":4.5}",
  "score": 95.5,
  "bonus": 5000.00,
  "remark": "表现优秀"
}
```

### 16.4 确认绩效

```http
POST /api/v1/performances/:id/confirm
Authorization: Bearer <token>
```

---

## 17. 仪表盘 (Dashboard)

### 17.1 核心指标

```http
GET /api/v1/dashboard/metrics
Authorization: Bearer <token>
```

**响应：**

```json
{
  "code": 200,
  "data": {
    "overview": {
      "leadCount": 100,
      "customerCount": 50,
      "contractCount": 30,
      "caseCount": 20,
      "totalRevenue": 500000,
      "employeeCount": 15
    },
    "monthly": {
      "newLeads": 20,
      "newContracts": 5,
      "monthRevenue": 100000
    }
  }
}
```

### 17.2 转化漏斗

```http
GET /api/v1/dashboard/funnel
Authorization: Bearer <token>
```

### 17.3 团队指标

```http
GET /api/v1/dashboard/team-metrics
Authorization: Bearer <token>
```

### 17.4 财务指标

```http
GET /api/v1/dashboard/finance-metrics
Authorization: Bearer <token>
```

### 17.5 案件指标

```http
GET /api/v1/dashboard/case-metrics
Authorization: Bearer <token>
```

### 17.6 预警信息

```http
GET /api/v1/dashboard/alerts
Authorization: Bearer <token>
```

**响应：**

```json
{
  "code": 200,
  "data": {
    "overdueTasks": 5,
    "overduePayments": [...],
    "unassignedLeads": 10,
    "urgentCases": [...]
  }
}
```

---

## 18. 数据模型

### 18.1 核心实体关系

```
Organization (组织架构)
  ├── Position (岗位)
  ├── Employee (员工)
  │     └── User (系统用户)
  │           ├── Role (角色)
  │           └── Permission (权限)
  ├── Lead (线索)
  │     └── LeadFollow (跟进记录)
  │     └── Customer (客户)
  │           ├── Contract (合同)
  │           │     └── Payment (收款)
  │           │     └── Case (案件)
  │           │           ├── CaseTask (任务)
  │           │           └── Communication (沟通记录)
  │           └── Payment (收款)
  ├── Channel (渠道)
  ├── Approval (审批)
  ├── Performance (绩效)
  ├── Notification (通知)
  └── OperationLog (操作日志)
```

### 18.2 关键字段说明

详见 `prisma/schema.prisma` 文件，包含 18 个数据模型：

| 模型 | 说明 | 核心字段 |
|------|------|----------|
| `Organization` | 组织架构 | id, name, type, parentId |
| `Position` | 岗位 | id, name, orgId, level |
| `Employee` | 员工 | id, employeeNo, name, type, status |
| `User` | 系统用户 | id, username, password, status |
| `Role` | 角色 | id, name, type |
| `Permission` | 权限 | id, code, name, type |
| `Channel` | 渠道 | id, name, type, cost |
| `Lead` | 线索 | id, name, phone, status, intentionLevel |
| `LeadFollow` | 跟进记录 | id, leadId, type, content |
| `Customer` | 客户 | id, name, phone, status |
| `Contract` | 合同 | id, contractNo, title, amount, status |
| `Payment` | 收款 | id, amount, receivedAmount, status |
| `Case` | 案件 | id, caseNo, title, status, priority |
| `CaseTask` | 案件任务 | id, caseId, name, nodeType, status |
| `Communication` | 沟通记录 | id, caseId, type, content |
| `Performance` | 绩效 | id, employeeId, period, score |
| `Approval` | 审批 | id, type, title, status |
| `Notification` | 通知 | id, userId, type, isRead |
| `OperationLog` | 操作日志 | id, action, targetType, targetId |

---

## 19. JWT 认证机制

### 19.1 认证流程

```
┌─────────┐     login      ┌─────────┐     JWT Token     ┌─────────┐
│  Client │ ─────────────> │  Server │ ────────────────> │  Client │
└─────────┘                └─────────┘                   └─────────┘
     │                                                    │
     │              Request with Token                    │
     │ ────────────────────────────────────────────────>  │
     │                                                    │
     │              Response (if valid)                   │
     │ <────────────────────────────────────────────────  │
     │                                                    │
     │              Token Expired?                        │
     │ ────────────────────────────────────────────────>  │
     │                                                    │
     │              Refresh Token                         │
     │ ────────────────────────────────────────────────>  │
     │                                                    │
     │              New Token                             │
     │ <────────────────────────────────────────────────  │
```

### 19.2 Token 结构

**Access Token:**

```json
{
  "userId": "uuid",
  "username": "admin",
  "iat": 1714123456,
  "exp": 1714728256
}
```

**Refresh Token:**

```json
{
  "userId": "uuid",
  "type": "refresh",
  "iat": 1714123456,
  "exp": 1716715456
}
```

### 19.3 认证中间件

- 文件: `app/middleware/auth.ts`
- 白名单: `/api/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`
- 其他所有路由需携带有效 JWT Token

### 19.4 环境变量配置

```bash
# .env
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d
APP_KEYS=first-application-key,second-application-key
DATABASE_URL=postgresql://chengye_app:<password>@<host>:5432/chengye_oa?schema=public
```

> ⚠️ **重要**: 必须在 `config.default.ts` 顶部调用 `dotenv.config()` 以确保环境变量被正确加载。
>
> 运行时使用外部 PostgreSQL 16。数据库结构仅通过 `apps/server/prisma/migrations` 中的规范迁移管理，部署时运行 `npm --prefix apps/server run db:deploy`。SPEC-001 基线必须保持业务表为空，不执行种子、导入或备份恢复。

---

## 附录 A: 接口汇总表

| 模块 | 接口数 | 核心功能 |
|------|--------|----------|
| Auth | 4 | 登录/刷新/用户信息/登出 |
| User | 6 | 用户CRUD + 角色分配 |
| Role | 6 | 角色CRUD + 权限分配 |
| Permission | 2 | 权限列表/树形 |
| Organization | 6 | 组织CRUD + 树形 |
| Position | 5 | 岗位CRUD |
| Employee | 7 | 员工CRUD + 转正/离职 |
| Channel | 6 | 渠道CRUD + 统计 |
| Lead | 10 | 线索全生命周期管理 |
| Customer | 8 | 客户CRUD + 关联查询 |
| Contract | 10 | 合同CRUD + 审批流 |
| Payment | 7 | 收款CRUD + 确认/退款 |
| Case | 9 | 案件CRUD + 任务/沟通 |
| Approval | 4 | 审批CRUD + 处理 |
| Notification | 4 | 通知列表/已读 |
| Performance | 4 | 绩效CRUD + 确认 |
| Dashboard | 6 | 6类统计数据 |
| **合计** | **104** | |

---

## 附录 B: 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Egg.js | ^3.x |
| 语言 | TypeScript | ^5.x |
| ORM | Prisma | ^5.x |
| 数据库 | PostgreSQL | 16 |
| 认证 | jsonwebtoken | ^9.x |
| 密码加密 | bcryptjs | ^2.x |
| 环境变量 | dotenv | ^16.x |

---

*文档生成时间: 2026-04-26*  
*维护者: Doctor Li*  
*项目: 律所管理系统 (Law Firm ERP)*
