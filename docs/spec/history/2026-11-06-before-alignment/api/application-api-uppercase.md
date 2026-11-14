> 历史API文档，来自Git dcf8447d:LayerManage/law-firm-system/docs/API_SPEC.md。当前接口见 [HTTP API](../../../reference/HTTP-API.md)。

# 律所闭环管理系统 - API 接口文档

> 版本：v1.0
> 创建日期：2026-04-25
> 状态：开发中

---

## 目录

1. [接口规范](#一接口规范)
2. [认证模块](#二认证模块)
3. [用户模块](#三用户模块)
4. [角色权限模块](#四角色权限模块)
5. [组织架构模块](#五组织架构模块)
6. [员工模块](#六员工模块)
7. [渠道模块](#七渠道模块)
8. [线索模块](#八线索模块)
9. [客户模块](#九客户模块)
10. [合同模块](#十合同模块)
11. [收款模块](#十一收款模块)
12. [案件模块](#十二案件模块)
13. [审批模块](#十三审批模块)
14. [通知模块](#十四通知模块)
15. [绩效模块](#十五绩效模块)
16. [仪表盘模块](#十六仪表盘模块)

---

## 一、接口规范

### 1.1 基础信息

- **基础URL**：`http://localhost:7001/api`
- **版本**：`v1`
- **完整路径**：`/api/v1/{module}`

### 1.2 请求头

```http
Content-Type: application/json
Authorization: Bearer {token}
```

### 1.3 响应格式

**成功响应：**
```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1714041600000
}
```

**错误响应：**
```json
{
  "code": 400,
  "message": "参数错误",
  "errors": [
    { "field": "phone", "message": "手机号格式不正确" }
  ],
  "timestamp": 1714041600000
}
```

**分页响应：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### 1.4 HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未授权（Token无效） |
| 403 | 禁止访问（权限不足） |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 1.5 通用查询参数

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| page | number | 页码 | 1 |
| pageSize | number | 每页数量 | 20 |
| keyword | string | 关键词搜索 | 张三 |
| status | string | 状态筛选 | ACTIVE |
| startDate | string | 开始日期 | 2026-01-01 |
| endDate | string | 结束日期 | 2026-12-31 |
| sortField | string | 排序字段 | createdAt |
| sortOrder | string | 排序方向 | desc / asc |

---

## 二、认证模块

### 2.1 用户登录

**POST** `/api/v1/auth/login`

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123"
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
      "name": "管理员",
      "roles": ["ADMIN"],
      "permissions": ["user:create", "user:read"]
    }
  }
}
```

### 2.2 刷新 Token

**POST** `/api/v1/auth/refresh`

**请求体：**
```json
{
  "refreshToken": "<refresh-token>"
}
```

### 2.3 获取当前用户

**GET** `/api/v1/auth/me`

### 2.4 用户登出

**POST** `/api/v1/auth/logout`

---

## 三、用户模块

### 3.1 获取用户列表

**GET** `/api/v1/users?page=1&pageSize=20&keyword=张三`

### 3.2 获取用户详情

**GET** `/api/v1/users/{id}`

### 3.3 创建用户

**POST** `/api/v1/users`

**请求体：**
```json
{
  "username": "zhangsan",
  "password": "123456",
  "status": "ENABLED",
  "employeeId": "uuid",
  "roleIds": ["uuid1", "uuid2"]
}
```

### 3.4 更新用户

**PUT** `/api/v1/users/{id}`

### 3.5 删除用户

**DELETE** `/api/v1/users/{id}`

### 3.6 分配角色

**POST** `/api/v1/users/{id}/roles`

**请求体：**
```json
{
  "roleIds": ["uuid1", "uuid2"]
}
```

---

## 四、角色权限模块

### 4.1 获取角色列表

**GET** `/api/v1/roles`

### 4.2 获取角色详情

**GET** `/api/v1/roles/{id}`

### 4.3 创建角色

**POST** `/api/v1/roles`

**请求体：**
```json
{
  "name": "销售经理",
  "type": "BUSINESS",
  "description": "负责销售团队管理",
  "permissionIds": ["uuid1", "uuid2"]
}
```

### 4.4 更新角色

**PUT** `/api/v1/roles/{id}`

### 4.5 删除角色

**DELETE** `/api/v1/roles/{id}`

### 4.6 获取权限树

**GET** `/api/v1/permissions/tree`

**响应：**
```json
{
  "code": 200,
  "data": [
    {
      "id": "uuid",
      "code": "system",
      "name": "系统管理",
      "type": "MENU",
      "children": [
        {
          "id": "uuid",
          "code": "user:manage",
          "name": "用户管理",
          "type": "MENU",
          "children": [
            { "id": "uuid", "code": "user:create", "name": "新增用户", "type": "BUTTON" },
            { "id": "uuid", "code": "user:read", "name": "查看用户", "type": "BUTTON" }
          ]
        }
      ]
    }
  ]
}
```

---

## 五、组织架构模块

### 5.1 获取组织树

**GET** `/api/v1/organizations/tree`

### 5.2 获取部门详情

**GET** `/api/v1/organizations/{id}`

### 5.3 创建部门

**POST** `/api/v1/organizations`

**请求体：**
```json
{
  "name": "刑事部",
  "type": "DEPARTMENT",
  "parentId": "uuid",
  "sort": 1
}
```

### 5.4 更新部门

**PUT** `/api/v1/organizations/{id}`

### 5.5 删除部门

**DELETE** `/api/v1/organizations/{id}`

### 5.6 获取岗位列表

**GET** `/api/v1/positions?orgId=uuid`

### 5.7 创建岗位

**POST** `/api/v1/positions`

**请求体：**
```json
{
  "name": "资深律师",
  "orgId": "uuid",
  "level": 3,
  "responsibilities": "负责重大案件办理"
}
```

---

## 六、员工模块

### 6.1 获取员工列表

**GET** `/api/v1/employees?page=1&pageSize=20&type=SALES&status=FORMAL`

### 6.2 获取员工详情

**GET** `/api/v1/employees/{id}`

### 6.3 创建员工

**POST** `/api/v1/employees`

**请求体：**
```json
{
  "employeeNo": "EMP001",
  "name": "张三",
  "phone": "13800138000",
  "email": "zhangsan@law.com",
  "type": "SALES",
  "status": "PROBATION",
  "entryDate": "2026-04-01",
  "orgId": "uuid",
  "positionId": "uuid"
}
```

### 6.4 更新员工

**PUT** `/api/v1/employees/{id}`

### 6.5 删除员工

**DELETE** `/api/v1/employees/{id}`

### 6.6 员工转正

**POST** `/api/v1/employees/{id}/formalize`

### 6.7 员工离职

**POST** `/api/v1/employees/{id}/leave`

**请求体：**
```json
{
  "leaveDate": "2026-04-25",
  "reason": "个人发展"
}
```

---

## 七、渠道模块

### 7.1 获取渠道列表

**GET** `/api/v1/channels`

### 7.2 获取渠道详情

**GET** `/api/v1/channels/{id}`

### 7.3 创建渠道

**POST** `/api/v1/channels`

**请求体：**
```json
{
  "name": "百度推广",
  "type": "SEARCH",
  "accountInfo": "账号：baidu001",
  "cost": 5000
}
```

### 7.4 更新渠道

**PUT** `/api/v1/channels/{id}`

### 7.5 删除渠道

**DELETE** `/api/v1/channels/{id}`

### 7.6 渠道统计

**GET** `/api/v1/channels/{id}/statistics?startDate=2026-01-01&endDate=2026-04-30`

**响应：**
```json
{
  "code": 200,
  "data": {
    "leadCount": 100,
    "validLeadCount": 80,
    "visitCount": 40,
    "signCount": 20,
    "revenue": 200000,
    "cost": 50000,
    "roi": 4.0
  }
}
```

---

## 八、线索模块

### 8.1 获取线索列表

**GET** `/api/v1/leads?page=1&pageSize=20&status=NEW&assignedTo=uuid`

### 8.2 获取线索详情

**GET** `/api/v1/leads/{id}`

### 8.3 创建线索

**POST** `/api/v1/leads`

**请求体：**
```json
{
  "name": "李四",
  "phone": "13900139000",
  "wechat": "lisi123",
  "channelId": "uuid",
  "sourceDetail": "百度推广-离婚咨询",
  "intentionLevel": 4,
  "tags": ["离婚", "财产分割"]
}
```

### 8.4 更新线索

**PUT** `/api/v1/leads/{id}`

### 8.5 删除线索

**DELETE** `/api/v1/leads/{id}`

### 8.6 分配线索

**POST** `/api/v1/leads/{id}/assign`

**请求体：**
```json
{
  "assignedTo": "employee-uuid"
}
```

### 8.7 线索跟进

**POST** `/api/v1/leads/{id}/follow`

**请求体：**
```json
{
  "type": "PHONE",
  "content": "客户咨询离婚财产分割，意向较强",
  "nextPlan": "邀约到所面谈",
  "nextTime": "2026-04-26T10:00:00Z"
}
```

### 8.8 线索转化

**POST** `/api/v1/leads/{id}/convert`

**响应：**
```json
{
  "code": 200,
  "data": {
    "customerId": "uuid",
    "message": "线索已成功转化为客户"
  }
}
```

### 8.9 获取跟进记录

**GET** `/api/v1/leads/{id}/follows`

### 8.10 线索回收

**POST** `/api/v1/leads/{id}/recycle`

---

## 九、客户模块

### 9.1 获取客户列表

**GET** `/api/v1/customers?page=1&pageSize=20&status=SIGNED`

### 9.2 获取客户详情

**GET** `/api/v1/customers/{id}`

### 9.3 创建客户

**POST** `/api/v1/customers`

**请求体：**
```json
{
  "name": "李四",
  "phone": "13900139000",
  "wechat": "lisi123",
  "idCard": "110101199001011234",
  "email": "lisi@example.com",
  "address": "北京市朝阳区",
  "status": "POTENTIAL",
  "leadId": "uuid",
  "tags": ["离婚", "财产分割"],
  "remark": "高价值客户"
}
```

### 9.4 更新客户

**PUT** `/api/v1/customers/{id}`

### 9.5 删除客户

**DELETE** `/api/v1/customers/{id}`

### 9.6 获取客户关联数据

**GET** `/api/v1/customers/{id}/contracts`

**GET** `/api/v1/customers/{id}/cases`

**GET** `/api/v1/customers/{id}/payments`

---

## 十、合同模块

### 10.1 获取合同列表

**GET** `/api/v1/contracts?page=1&pageSize=20&status=SIGNED`

### 10.2 获取合同详情

**GET** `/api/v1/contracts/{id}`

### 10.3 创建合同

**POST** `/api/v1/contracts`

**请求体：**
```json
{
  "contractNo": "HT2026001",
  "title": "离婚财产分割咨询合同",
  "type": "CONSULTING",
  "customerId": "uuid",
  "amount": 50000,
  "paymentTerms": [
    { "phase": 1, "amount": 25000, "dueDate": "2026-04-30" },
    { "phase": 2, "amount": 25000, "dueDate": "2026-05-30" }
  ],
  "terms": "特殊条款内容",
  "startDate": "2026-04-25",
  "endDate": "2026-10-25"
}
```

### 10.4 更新合同

**PUT** `/api/v1/contracts/{id}`

### 10.5 删除合同

**DELETE** `/api/v1/contracts/{id}`

### 10.6 提交审批

**POST** `/api/v1/contracts/{id}/submit`

### 10.7 审批合同

**POST** `/api/v1/contracts/{id}/approve`

**请求体：**
```json
{
  "approved": true,
  "remark": "合同条款符合标准"
}
```

### 10.8 签署合同

**POST** `/api/v1/contracts/{id}/sign`

### 10.9 终止合同

**POST** `/api/v1/contracts/{id}/terminate`

### 10.10 合同台账

**GET** `/api/v1/contracts/ledger?startDate=2026-01-01&endDate=2026-12-31`

---

## 十一、收款模块

### 11.1 获取收款列表

**GET** `/api/v1/payments?page=1&pageSize=20&status=PENDING`

### 11.2 获取收款详情

**GET** `/api/v1/payments/{id}`

### 11.3 创建收款

**POST** `/api/v1/payments`

**请求体：**
```json
{
  "contractId": "uuid",
  "customerId": "uuid",
  "amount": 25000,
  "dueDate": "2026-04-30",
  "paymentMethod": "银行转账",
  "paymentAccount": "对公账户",
  "remark": "第一期款项"
}
```

### 11.4 更新收款

**PUT** `/api/v1/payments/{id}`

### 11.5 确认收款

**POST** `/api/v1/payments/{id}/confirm`

**请求体：**
```json
{
  "receivedAmount": 25000,
  "receivedDate": "2026-04-25",
  "paymentMethod": "银行转账"
}
```

### 11.6 退款

**POST** `/api/v1/payments/{id}/refund`

**请求体：**
```json
{
  "refundAmount": 10000,
  "reason": "服务未开始，客户要求退款"
}
```

---

## 十二、案件模块

### 12.1 获取案件列表

**GET** `/api/v1/cases?page=1&pageSize=20&status=PROCESSING&lawyerId=uuid`

### 12.2 获取案件详情

**GET** `/api/v1/cases/{id}`

### 12.3 创建案件

**POST** `/api/v1/cases`

**请求体：**
```json
{
  "caseNo": "AJ2026001",
  "title": "张三诉李四离婚财产分割案",
  "customerId": "uuid",
  "contractId": "uuid",
  "lawyerId": "uuid",
  "teamIds": ["uuid1", "uuid2"],
  "caseType": "离婚纠纷",
  "priority": "HIGH",
  "fee": 50000,
  "description": "案件描述"
}
```

### 12.4 更新案件

**PUT** `/api/v1/cases/{id}`

### 12.5 删除案件

**DELETE** `/api/v1/cases/{id}`

### 12.6 创建案件任务

**POST** `/api/v1/cases/{id}/tasks`

**请求体：**
```json
{
  "name": "收集财产证据",
  "nodeType": "材料收集",
  "dueDate": "2026-05-10"
}
```

### 12.7 更新任务状态

**PATCH** `/api/v1/cases/{id}/tasks/{taskId}`

**请求体：**
```json
{
  "status": "COMPLETED",
  "remark": "已完成证据收集"
}
```

### 12.8 添加沟通记录

**POST** `/api/v1/cases/{id}/communications`

**请求体：**
```json
{
  "type": "PHONE",
  "content": "与客户沟通案件进展",
  "isKey": true
}
```

### 12.9 结案

**POST** `/api/v1/cases/{id}/close`

**请求体：**
```json
{
  "result": "调解成功，财产分割方案已执行",
  "satisfaction": 5,
  "isReferrable": true
}
```

---

## 十三、审批模块

### 13.1 获取审批列表

**GET** `/api/v1/approvals?page=1&pageSize=20&status=PENDING&type=REFUND`

### 13.2 获取审批详情

**GET** `/api/v1/approvals/{id}`

### 13.3 提交审批

**POST** `/api/v1/approvals`

**请求体：**
```json
{
  "type": "REFUND",
  "title": "客户退款申请",
  "content": {
    "contractId": "uuid",
    "refundAmount": 10000,
    "reason": "服务未开始"
  }
}
```

### 13.4 审批操作

**POST** `/api/v1/approvals/{id}/process`

**请求体：**
```json
{
  "approved": true,
  "remark": "同意退款"
}
```

---

## 十四、通知模块

### 14.1 获取通知列表

**GET** `/api/v1/notifications?page=1&pageSize=20&isRead=false`

### 14.2 标记已读

**PATCH** `/api/v1/notifications/{id}/read`

### 14.3 全部标记已读

**POST** `/api/v1/notifications/read-all`

### 14.4 获取未读数量

**GET** `/api/v1/notifications/unread-count`

---

## 十五、绩效模块

### 15.1 获取绩效列表

**GET** `/api/v1/performances?page=1&pageSize=20&period=2026-04`

### 15.2 获取绩效详情

**GET** `/api/v1/performances/{id}`

### 15.3 创建绩效

**POST** `/api/v1/performances`

**请求体：**
```json
{
  "employeeId": "uuid",
  "period": "2026-04",
  "type": "MONTHLY",
  "kpiData": {
    "leadCount": 50,
    "validRate": 0.8,
    "visitRate": 0.6,
    "signRate": 0.3
  },
  "score": 85,
  "bonus": 5000
}
```

### 15.4 确认绩效

**POST** `/api/v1/performances/{id}/confirm`

---

## 十六、仪表盘模块

### 16.1 获取经营指标

**GET** `/api/v1/dashboard/metrics`

**响应：**
```json
{
  "code": 200,
  "data": {
    "today": {
      "newLeads": 10,
      "visited": 5,
      "signed": 2,
      "revenue": 100000
    },
    "thisMonth": {
      "totalLeads": 200,
      "validLeads": 150,
      "visited": 80,
      "signed": 30,
      "revenue": 1500000,
      "target": 2000000,
      "completionRate": 0.75
    },
    "comparison": {
      "leadGrowth": 0.15,
      "revenueGrowth": 0.20,
      "signRateChange": 0.05
    }
  }
}
```

### 16.2 获取漏斗数据

**GET** `/api/v1/dashboard/funnel?startDate=2026-01-01&endDate=2026-04-30`

**响应：**
```json
{
  "code": 200,
  "data": {
    "stages": [
      { "name": "新线索", "count": 1000, "conversionRate": 1.0 },
      { "name": "已联系", "count": 800, "conversionRate": 0.8 },
      { "name": "已初筛", "count": 600, "conversionRate": 0.6 },
      { "name": "已邀约", "count": 400, "conversionRate": 0.4 },
      { "name": "已到访", "count": 200, "conversionRate": 0.2 },
      { "name": "已谈案", "count": 100, "conversionRate": 0.1 },
      { "name": "已报价", "count": 80, "conversionRate": 0.08 },
      { "name": "已签约", "count": 50, "conversionRate": 0.05 }
    ]
  }
}
```

### 16.3 获取团队指标

**GET** `/api/v1/dashboard/team-metrics?departmentId=uuid`

### 16.4 获取财务指标

**GET** `/api/v1/dashboard/finance-metrics?startDate=2026-01-01&endDate=2026-04-30`

### 16.5 获取办案指标

**GET** `/api/v1/dashboard/case-metrics`

### 16.6 获取异常预警

**GET** `/api/v1/dashboard/alerts`

**响应：**
```json
{
  "code": 200,
  "data": [
    {
      "type": "OVERDUE_PAYMENT",
      "level": "HIGH",
      "title": "逾期收款预警",
      "content": "有3笔收款已逾期超过7天",
      "relatedId": "uuid",
      "createdAt": "2026-04-25T10:00:00Z"
    },
    {
      "type": "LOW_CONVERSION",
      "level": "MEDIUM",
      "title": "转化率下降预警",
      "content": "本月谈案签约率较上月下降10%",
      "createdAt": "2026-04-25T10:00:00Z"
    }
  ]
}
```

---

## 附录

### A. 枚举值定义

#### 员工类型 (Employee.type)
- `PARTNER` - 合伙人
- `SENIOR_LAWYER` - 高级律师
- `JUNIOR_LAWYER` - 初级律师
- `ASSISTANT` - 助理
- `SALES` - 销售
- `ADMIN` - 行政
- `HR` - 人事
- `FINANCE` - 财务
- `OPERATOR` - 运营

#### 渠道类型 (Channel.type)
- `SEARCH` - 搜索引擎
- `SHORT_VIDEO` - 短视频
- `LIVE` - 直播
- `INFO_FLOW` - 信息流
- `WECHAT` - 微信
- `REFERRAL` - 转介绍
- `NATURAL` - 自然咨询
- `OFFLINE` - 线下活动
- `OTHER` - 其他

#### 合同类型 (Contract.type)
- `CONSULTING` - 咨询合同
- `RETAINER` - 常年顾问
- `LITIGATION` - 诉讼合同
- `ARBITRATION` - 仲裁合同
- `MEDIATION` - 调解合同
- `OTHER` - 其他

#### 审批类型 (Approval.type)
- `REFUND` - 退款
- `EXPENSE` - 费用
- `CONTRACT_CHANGE` - 合同变更
- `SEAL` - 用章
- `LEAVE` - 请假
- `TRANSFER` - 调岗
- `OTHER` - 其他

### B. 错误码定义

| 错误码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 422 | 业务逻辑错误 |
| 500 | 服务器内部错误 |

### C. 数据权限规则

1. **超级管理员**：查看所有数据
2. **部门主管**：查看本部门及下属部门数据
3. **普通员工**：仅查看自己负责的数据
4. **特殊权限**：通过角色配置自定义数据范围

---

*文档版本：v1.0*
*最后更新：2026-04-25*
