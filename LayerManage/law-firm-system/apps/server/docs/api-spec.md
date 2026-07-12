# 律所管理系统后端 API 规范

## 项目概述

- **项目名称**: law-firm-server
- **版本**: 1.0.0
- **技术栈**: Egg.js + TypeScript + Prisma + SQLite
- **运行端口**: 7001

---

## 数据库模型

### 1. 组织架构模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Organization** | 组织架构 | id, name, type(FIRM/BRANCH/DEPARTMENT), parentId(自引用) |
| **Position** | 岗位 | id, name, orgId, level, responsibilities |

### 2. 人事/员工模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Employee** | 员工 | id, employeeNo, name, type(PARTNER/SENIOR_LAWYER/JUNIOR_LAWYER/...), status(PROBATION/FORMAL/LEAVED), orgId, positionId |

### 3. 用户/权限模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **User** | 用户 | id, username, password(bcrypt), status(ENABLED/DISABLED), employeeId |
| **Role** | 角色 | id, name, type(SYSTEM/BUSINESS) |
| **Permission** | 权限 | id, code, name, type(MENU/BUTTON/API), parentId |
| **UserRole** | 用户角色关联 | userId, roleId |
| **RolePermission** | 角色权限关联 | roleId, permissionId |
| **LoginLog** | 登录日志 | userId, ip, userAgent |

### 4. 运营/渠道模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Channel** | 渠道 | id, name, type(SEARCH/SHORT_VIDEO/LIVE/...), cost |

### 5. 线索/销转模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Lead** | 线索 | id, name, phone, channelId, intentionLevel(1-5), status(NEW/CONTACTED/.../SIGNED/LOST), assignedTo |
| **LeadFollow** | 跟进记录 | id, leadId, type(PHONE/WECHAT/VISIT), content, nextPlan, nextTime |

### 6. 客户模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Customer** | 客户 | id, name, phone, status(POTENTIAL/INTENT/SIGNED/INACTIVE), leadId |

### 7. 合同模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Contract** | 合同 | id, contractNo, title, type(CONSULTING/RETAINER/LITIGATION/...), customerId, amount, status(DRAFT/PENDING/APPROVED/SIGNED/...) |

### 8. 财务/收款模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Payment** | 收款 | id, contractId, customerId, amount, receivedAmount, status(PENDING/RECEIVED/OVERDUE/REFUNDED) |

### 9. 案件模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Case** | 案件 | id, caseNo, title, customerId, contractId, lawyerId, status(PENDING/ACCEPTED/PROCESSING/CLOSED/ARCHIVED), priority(LOW/NORMAL/HIGH/URGENT) |
| **CaseTask** | 案件任务 | id, caseId, name, nodeType, status(PENDING/IN_PROGRESS/COMPLETED/OVERDUE) |
| **Communication** | 沟通记录 | id, caseId, type, content, isKey |

### 10. 绩效模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Performance** | 绩效 | id, employeeId, period(如2026-04), type(MONTHLY/QUARTERLY/YEARLY), score, bonus |

### 11. 审批/流程模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Approval** | 审批 | id, type(REFUND/EXPENSE/CONTRACT_CHANGE/...), title, applicantId, status(PENDING/APPROVED/REJECTED) |

### 12. 通知/提醒模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Notification** | 通知 | id, userId, type(SYSTEM/TASK/REMINDER/APPROVAL), title, content, isRead |

### 13. 操作日志模块

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **OperationLog** | 操作日志 | id, userId, action(CREATE/UPDATE/DELETE/...), targetType, targetId, oldValues, newValues |

---

## API 接口规范

### 认证模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | /api/v1/auth/login | 登录 | 公开 |
| POST | /api/v1/auth/refresh | 刷新 Token | 公开 |
| GET | /api/v1/auth/me | 获取当前用户 | JWT |
| POST | /api/v1/auth/logout | 退出登录 | JWT |

**登录请求体:**
```json
{
  "username": "admin",
  "password": "123456"
}
```

**登录成功响应:**
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "expiresIn": 604800,
    "user": {
      "id": "...",
      "username": "admin",
      "name": "张三",
      "roles": ["超级管理员"],
      "permissions": []
    }
  }
}
```

### 用户模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/users | 用户列表 | JWT |
| GET | /api/v1/users/:id | 用户详情 | JWT |
| POST | /api/v1/users | 创建用户 | JWT |
| PUT | /api/v1/users/:id | 更新用户 | JWT |
| DELETE | /api/v1/users/:id | 删除用户 | JWT |
| POST | /api/v1/users/:id/roles | 分配角色 | JWT |

### 角色模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/roles | 角色列表 | JWT |
| GET | /api/v1/roles/:id | 角色详情 | JWT |
| POST | /api/v1/roles | 创建角色 | JWT |
| PUT | /api/v1/roles/:id | 更新角色 | JWT |
| DELETE | /api/v1/roles/:id | 删除角色 | JWT |
| POST | /api/v1/roles/:id/permissions | 分配权限 | JWT |

### 权限模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/permissions | 权限列表 | JWT |
| GET | /api/v1/permissions/tree | 权限树 | JWT |

### 组织架构模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/organizations | 组织列表 | JWT |
| GET | /api/v1/organizations/tree | 组织树 | JWT |
| GET | /api/v1/organizations/:id | 组织详情 | JWT |
| POST | /api/v1/organizations | 创建组织 | JWT |
| PUT | /api/v1/organizations/:id | 更新组织 | JWT |
| DELETE | /api/v1/organizations/:id | 删除组织 | JWT |

### 岗位模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/positions | 岗位列表 | JWT |
| GET | /api/v1/positions/:id | 岗位详情 | JWT |
| POST | /api/v1/positions | 创建岗位 | JWT |
| PUT | /api/v1/positions/:id | 更新岗位 | JWT |
| DELETE | /api/v1/positions/:id | 删除岗位 | JWT |

### 员工模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/employees | 员工列表 | JWT |
| GET | /api/v1/employees/:id | 员工详情 | JWT |
| POST | /api/v1/employees | 创建员工 | JWT |
| PUT | /api/v1/employees/:id | 更新员工 | JWT |
| DELETE | /api/v1/employees/:id | 删除员工 | JWT |
| POST | /api/v1/employees/:id/formalize | 转正 | JWT |
| POST | /api/v1/employees/:id/leave | 离职 | JWT |

### 渠道模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/channels | 渠道列表 | JWT |
| GET | /api/v1/channels/:id | 渠道详情 | JWT |
| POST | /api/v1/channels | 创建渠道 | JWT |
| PUT | /api/v1/channels/:id | 更新渠道 | JWT |
| DELETE | /api/v1/channels/:id | 删除渠道 | JWT |
| GET | /api/v1/channels/:id/statistics | 渠道统计 | JWT |

### 线索模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/leads | 线索列表 | JWT |
| GET | /api/v1/leads/:id | 线索详情 | JWT |
| POST | /api/v1/leads | 创建线索 | JWT |
| PUT | /api/v1/leads/:id | 更新线索 | JWT |
| DELETE | /api/v1/leads/:id | 删除线索 | JWT |
| POST | /api/v1/leads/:id/assign | 分配负责人 | JWT |
| POST | /api/v1/leads/:id/follow | 跟进 | JWT |
| POST | /api/v1/leads/:id/convert | 转客户 | JWT |
| GET | /api/v1/leads/:id/follows | 跟进记录 | JWT |
| POST | /api/v1/leads/:id/recycle | 回收 | JWT |

### 客户模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/customers | 客户列表 | JWT |
| GET | /api/v1/customers/:id | 客户详情 | JWT |
| POST | /api/v1/customers | 创建客户 | JWT |
| PUT | /api/v1/customers/:id | 更新客户 | JWT |
| DELETE | /api/v1/customers/:id | 删除客户 | JWT |
| GET | /api/v1/customers/:id/contracts | 客户合同 | JWT |
| GET | /api/v1/customers/:id/cases | 客户案件 | JWT |
| GET | /api/v1/customers/:id/payments | 客户收款 | JWT |

### 合同模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/contracts | 合同列表 | JWT |
| GET | /api/v1/contracts/:id | 合同详情 | JWT |
| POST | /api/v1/contracts | 创建合同 | JWT |
| PUT | /api/v1/contracts/:id | 更新合同 | JWT |
| DELETE | /api/v1/contracts/:id | 删除合同 | JWT |
| POST | /api/v1/contracts/:id/submit | 提交审批 | JWT |
| POST | /api/v1/contracts/:id/approve | 审批通过 | JWT |
| POST | /api/v1/contracts/:id/sign | 签署 | JWT |
| POST | /api/v1/contracts/:id/terminate | 终止 | JWT |
| GET | /api/v1/contracts/ledger | 合同台账 | JWT |

### 收款模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/payments | 收款列表 | JWT |
| GET | /api/v1/payments/:id | 收款详情 | JWT |
| POST | /api/v1/payments | 创建收款 | JWT |
| PUT | /api/v1/payments/:id | 更新收款 | JWT |
| DELETE | /api/v1/payments/:id | 删除收款 | JWT |
| POST | /api/v1/payments/:id/confirm | 确认收款 | JWT |
| POST | /api/v1/payments/:id/refund | 退款 | JWT |

### 案件模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/cases | 案件列表 | JWT |
| GET | /api/v1/cases/:id | 案件详情 | JWT |
| POST | /api/v1/cases | 创建案件 | JWT |
| PUT | /api/v1/cases/:id | 更新案件 | JWT |
| DELETE | /api/v1/cases/:id | 删除案件 | JWT |
| POST | /api/v1/cases/:id/tasks | 创建任务 | JWT |
| PATCH | /api/v1/cases/:id/tasks/:taskId | 更新任务 | JWT |
| POST | /api/v1/cases/:id/communications | 添加沟通 | JWT |
| POST | /api/v1/cases/:id/close | 结案 | JWT |

### 审批模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/approvals | 审批列表 | JWT |
| GET | /api/v1/approvals/:id | 审批详情 | JWT |
| POST | /api/v1/approvals | 创建审批 | JWT |
| POST | /api/v1/approvals/:id/process | 处理审批 | JWT |

### 通知模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/notifications | 通知列表 | JWT |
| PATCH | /api/v1/notifications/:id/read | 标记已读 | JWT |
| POST | /api/v1/notifications/read-all | 全部已读 | JWT |
| GET | /api/v1/notifications/unread-count | 未读数量 | JWT |

### 绩效模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/performances | 绩效列表 | JWT |
| GET | /api/v1/performances/:id | 绩效详情 | JWT |
| POST | /api/v1/performances | 创建绩效 | JWT |
| POST | /api/v1/performances/:id/confirm | 确认绩效 | JWT |

### 仪表盘模块

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/v1/dashboard/metrics | 核心指标 | JWT |
| GET | /api/v1/dashboard/funnel | 转化漏斗 | JWT |
| GET | /api/v1/dashboard/team-metrics | 团队指标 | JWT |
| GET | /api/v1/dashboard/finance-metrics | 财务指标 | JWT |
| GET | /api/v1/dashboard/case-metrics | 案件指标 | JWT |
| GET | /api/v1/dashboard/alerts | 预警信息 | JWT |

---

## 认证机制

### JWT 配置
- **Secret**: `law-firm-secret-key` (可通过环境变量 `JWT_SECRET` 覆盖)
- **过期时间**: 7天 (可通过环境变量 `JWT_EXPIRES_IN` 覆盖)
- **刷新 Token 过期**: 30天

### 认证中间件
- 全局 `auth` 中间件自动处理认证
- 公开路径白名单：`/api/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`
- 其他路径需要 `Authorization: Bearer <token>` 请求头

---

## 响应格式

### 成功响应
```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

### 错误响应
```json
{
  "code": 401,
  "message": "认证令牌无效或已过期",
  "errors": null,
  "timestamp": 1777173171346
}
```

---

## 环境配置

### 环境变量
```env
NODE_ENV=development
PORT=7001
DATABASE_URL="file:./law_firm.db"
JWT_SECRET="law-firm-secret-key"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_EXPIRES_IN="30d"
LOG_LEVEL=info
LOG_DIR=./logs
```

### 数据库脚本
```bash
# 生成 Prisma Client
npm run db:generate

# 执行数据库迁移
npm run db:migrate

# 插入种子数据
npm run db:seed

# 打开 Prisma Studio
npm run db:studio
```

---

## 目录结构

```
apps/server/
├── app/
│   ├── controller/          # 控制器
│   │   ├── auth.ts          # 认证控制器
│   │   ├── user.ts          # 用户控制器
│   │   ├── role.ts          # 角色控制器
│   │   ├── ...              # 其他控制器
│   ├── middleware/           # 中间件
│   │   ├── auth.ts          # 认证中间件
│   │   └── errorHandler.ts  # 错误处理中间件
│   ├── extend/
│   │   └── context.ts       # Context 扩展 (PrismaClient)
│   └── router.ts            # 路由配置
├── config/
│   ├── config.default.ts    # 默认配置
│   ├── config.local.ts      # 本地配置
│   └── plugin.ts            # 插件配置
├── prisma/
│   ├── schema.prisma        # Prisma 模型定义
│   └── seed.ts              # 种子数据
├── database/
│   └── seedings/            # 数据迁移文件
├── docs/
│   └── api-spec.md          # 本规范文档
├── .env                     # 环境变量
├── .env.example            # 环境变量示例
└── package.json             # 项目配置
```

---

## 开发状态

### 已完成 ✅
- [x] Prisma 数据库模型定义
- [x] 数据库迁移 (SQLite)
- [x] 种子数据插入
- [x] 认证中间件 (JWT)
- [x] 路由配置
- [x] 控制器骨架
- [x] 健康检查接口
- [x] 登录接口 (MVP验证通过)

### 进行中 ⏳
- [ ] 具体业务逻辑实现
- [ ] RBAC 权限控制
- [ ] 数据校验 (Validation)
- [ ] 分页查询
- [ ] 文件上传
- [ ] 邮件通知

---

*文档生成时间: 2026-04-26*
*版本: v1.0.0*
