# 律所闭环管理系统 - 开发文档

> 项目名称：Law Firm Management System（律所闭环管理系统）
> 版本：v1.0
> 创建日期：2026-04-25
> 状态：开发中

---

## 目录

1. [项目概述](#一项目概述)
2. [技术架构](#二技术架构)
3. [数据库设计](#三数据库设计)
4. [API 设计规范](#四api-设计规范)
5. [模块开发计划](#五模块开发计划)
6. [开发规范](#六开发规范)
7. [部署指南](#七部署指南)
8. [附录](#八附录)

---

## 一、项目概述

### 1.1 项目定位

律所闭环管理系统是一款面向律师事务所的企业级经营管理系统，覆盖从流量获取到案件交付的全业务流程。

**核心目标：**
1. **数据化管理** — 所有关键动作留痕、统计、复盘
2. **提高人效** — 减少人工汇总、提醒、协调
3. **节约人力成本** — 自动分配、提醒、统计、审批
4. **形成经营闭环** — 管理层清楚看到每条线索、每笔回款、每个案件、每个岗位的产出

### 1.2 服务对象

| 角色 | 核心需求 |
|------|---------|
| 管理层 | 经营总盘、数据驾驶舱、异常预警 |
| 行政人员 | 流程化、审批化、留痕化 |
| 财务人员 | 收款/退款/开票/成本/提成/利润核算 |
| 人事人员 | 招聘/入转调离/考勤/绩效 |
| 运营人员 | 渠道/线索/投放ROI分析 |
| 销转团队 | 客服→邀约→谈案漏斗管理 |
| 律师团队 | 案件节点化、可监督、可复盘 |

### 1.3 业务闭环

```
流量获取 → 线索入系统 → 客服初筛 → 邀约到所 → 谈案签约 → 财务收款 → 案件建档 → 律师交付 → 结案归档 → 售后/复购/转介绍 → 数据回流管理层
```

---

## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (Browser)                      │
│              React 18 + Ant Design 5 + Vite                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API 网关 / 代理层                          │
│              Nginx / Egg.js 内置代理                          │
│                   /api → localhost:7001                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端服务 (Egg.js)                         │
│                   localhost:7001                             │
│  ┌─────────────┬──────────────┬─────────────┐              │
│  │ Controller  │  Middleware  │   Service   │              │
│  │   (路由)    │  (认证/权限)  │  (业务逻辑)  │              │
│  └─────────────┴──────────────┴─────────────┘              │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Prisma ORM                        │    │
│  │              (类型安全的数据库操作)                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   数据库 (SQLite)                            │
│              file:./law_firm.db                              │
│         (单文件，零配置，随项目迁移)                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **后端框架** | Egg.js | ^3.x | 企业级 Node.js 框架 |
| **编程语言** | TypeScript | ^5.x | 类型安全 |
| **数据库** | SQLite | 3.x | 单文件，零配置 |
| **ORM** | Prisma | ^5.x | 类型安全，自动迁移 |
| **前端框架** | React | ^18.x | UI 构建 |
| **构建工具** | Vite | ^5.x | 快速构建 |
| **UI 组件库** | Ant Design | ^5.x | 企业级组件 |
| **状态管理** | Zustand | ^4.x | 轻量状态管理 |
| **HTTP 客户端** | Axios | ^1.x | API 请求 |
| **认证** | JWT | ^9.x | Token 认证 |
| **密码加密** | bcryptjs | ^2.x | 密码哈希 |
| **数据验证** | Joi / class-validator | - | 请求参数校验 |

### 2.3 项目结构

```
law-firm-system/
├── 📁 apps/
│   ├── 📁 server/              # Egg.js 后端
│   │   ├── 📁 app/
│   │   │   ├── 📁 controller/   # 控制器层
│   │   │   ├── 📁 service/      # 服务层
│   │   │   ├── 📁 middleware/     # 中间件
│   │   │   ├── 📁 model/         # 数据模型
│   │   │   ├── 📁 extend/        # 扩展
│   │   │   └── router.ts         # 路由定义
│   │   ├── 📁 config/           # 配置文件
│   │   ├── 📁 prisma/            # Prisma Schema
│   │   ├── 📁 database/          # 数据库文件
│   │   └── ...
│   └── 📁 web/                 # React 前端
│       ├── 📁 src/
│       │   ├── 📁 api/           # API 封装
│       │   ├── 📁 components/    # 公共组件
│       │   ├── 📁 pages/         # 页面
│       │   ├── 📁 stores/        # 状态管理
│       │   ├── 📁 hooks/         # 自定义 Hooks
│       │   ├── 📁 utils/         # 工具函数
│       │   └── 📁 types/         # 类型定义
│       └── ...
├── 📁 docs/                    # 文档
├── 📁 scripts/                 # 脚本
└── package.json               # Workspace 配置
```

---

## 三、数据库设计

### 3.1 核心实体关系

```
Organization (组织)
    ├── Position (岗位) [1:N]
    └── Employee (员工) [1:N]
            └── User (用户) [1:1]
            └── Performance (绩效) [1:N]

Role (角色) ←── UserRole ──→ User
    └── Permission (权限)

Channel (渠道)
    └── Lead (线索) [1:N]
            └── LeadFollow (跟进记录) [1:N]
            └── Customer (客户) [1:1]
                    ├── Contract (合同) [1:N]
                    │       └── Payment (收款) [1:N]
                    │       └── Case (案件) [1:1]
                    ├── Case (案件) [1:N]
                    │       ├── CaseTask (任务) [1:N]
                    │       └── Communication (沟通记录) [1:N]
                    └── Payment (收款) [1:N]

Approval (审批)
Notification (通知)
OperationLog (操作日志)
```

### 3.2 数据表清单

| 表名 | 说明 | 模块 |
|------|------|------|
| `organization` | 组织架构表 | 行政 |
| `position` | 岗位表 | 行政 |
| `employee` | 员工表 | 人事 |
| `user` | 用户表 | 系统 |
| `role` | 角色表 | 权限 |
| `permission` | 权限表 | 权限 |
| `user_role` | 用户角色关联表 | 权限 |
| `role_permission` | 角色权限关联表 | 权限 |
| `login_log` | 登录日志表 | 系统 |
| `channel` | 渠道表 | 运营 |
| `lead` | 线索表 | 销转 |
| `lead_follow` | 线索跟进记录表 | 销转 |
| `customer` | 客户表 | 客户 |
| `contract` | 合同表 | 合同 |
| `payment` | 收款表 | 财务 |
| `case` | 案件表 | 办案 |
| `case_task` | 案件任务表 | 办案 |
| `communication` | 沟通记录表 | 办案 |
| `performance` | 绩效表 | 人事 |
| `approval` | 审批表 | 流程 |
| `notification` | 通知表 | 系统 |
| `operation_log` | 操作日志表 | 系统 |

### 3.3 关键状态字典

#### 线索状态 (Lead.status)
```
NEW → CONTACTED → SCREENED → INVITED → VISITED → NEGOTIATING → QUOTED → SIGNED
                                                                      ↓
                                                                    LOST
```

#### 客户状态 (Customer.status)
- `POTENTIAL` - 潜在客户
- `INTENT` - 有意向
- `SIGNED` - 已签约
- `INACTIVE` - 非活跃

#### 合同状态 (Contract.status)
```
DRAFT → PENDING → APPROVED → SIGNED → EXECUTING → COMPLETED
   ↓         ↓                    ↓           ↓
TERMINATED  CANCELLED         CANCELLED    CANCELLED
```

#### 收款状态 (Payment.status)
- `PENDING` - 待收款
- `RECEIVED` - 已收款
- `OVERDUE` - 已逾期
- `REFUNDED` - 已退款

#### 案件状态 (Case.status)
- `PENDING` - 待受理
- `ACCEPTED` - 已受理
- `PROCESSING` - 办理中
- `CLOSED` - 已结案
- `ARCHIVED` - 已归档

---

## 四、API 设计规范

### 4.1 接口规范

- **基础路径**：`/api`
- **版本控制**：URL 路径中包含版本，如 `/api/v1/users`
- **HTTP 方法**：
  - `GET` - 查询
  - `POST` - 创建
  - `PUT` - 全量更新
  - `PATCH` - 部分更新
  - `DELETE` - 删除

### 4.2 响应格式

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1714041600000
}
```

### 4.3 错误格式

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

### 4.4 分页格式

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

### 4.5 模块接口概览

| 模块 | 路径前缀 | 核心接口 |
|------|---------|---------|
| 认证 | `/api/auth` | 登录、登出、刷新Token、获取当前用户 |
| 用户 | `/api/users` | 增删改查、角色分配 |
| 角色 | `/api/roles` | 增删改查、权限分配 |
| 权限 | `/api/permissions` | 树形权限查询 |
| 员工 | `/api/employees` | 增删改查、入转调离 |
| 组织架构 | `/api/organizations` | 树形结构、部门管理 |
| 岗位 | `/api/positions` | 增删改查 |
| 渠道 | `/api/channels` | 增删改查、统计分析 |
| 线索 | `/api/leads` | 增删改查、分配、跟进、转化 |
| 客户 | `/api/customers` | 增删改查、来源追踪 |
| 合同 | `/api/contracts` | 增删改查、审批、台账 |
| 收款 | `/api/payments` | 增删改查、确认、退款 |
| 案件 | `/api/cases` | 增删改查、节点管理 |
| 审批 | `/api/approvals` | 申请、审批、流程 |
| 通知 | `/api/notifications` | 列表、标记已读 |
| 绩效 | `/api/performances` | 考核、评分、统计 |
| 报表 | `/api/dashboard` | 经营指标、团队指标、财务指标 |

---

## 五、模块开发计划

### 5.1 第一阶段：MVP 核心链路（4-6周）

**目标**：打通"获客→销转→签约→回款"主链路

| 优先级 | 模块 | 功能点 | 预估工期 |
|--------|------|--------|---------|
| P0 | 认证授权 | JWT登录、Token刷新、权限控制 | 3天 |
| P0 | 用户管理 | 用户CRUD、角色分配 | 2天 |
| P0 | 角色权限 | 角色CRUD、权限树、RBAC | 3天 |
| P0 | 组织架构 | 部门树、岗位管理 | 2天 |
| P0 | 员工管理 | 员工CRUD、入转调离 | 2天 |
| P1 | 渠道管理 | 渠道CRUD、统计分析 | 2天 |
| P1 | 线索管理 | 线索CRUD、分配、跟进、转化 | 5天 |
| P1 | 客户管理 | 客户CRUD、来源追踪 | 2天 |
| P1 | 合同管理 | 合同CRUD、审批流程 | 4天 |
| P1 | 收款管理 | 收款CRUD、确认、退款 | 3天 |
| P1 | 工作台 | 数据仪表盘、核心指标 | 3天 |
| P2 | 前端框架 | 项目搭建、路由、布局 | 3天 |
| P2 | 前端页面 | MVP模块页面实现 | 10天 |

**第一阶段交付物：**
- 可运行的 MVP 系统
- 线索→签约→回款主链路打通
- 基础权限控制
- 核心经营报表

### 5.2 第二阶段：交付链路（3-4周）

| 优先级 | 模块 | 功能点 |
|--------|------|--------|
| P1 | 案件管理 | 案件建档、流程节点、进度追踪 |
| P1 | 任务管理 | 节点任务、超期提醒 |
| P1 | 沟通记录 | 客户沟通、关键节点记录 |
| P2 | 结案管理 | 结案报告、满意度调查 |
| P2 | 回访管理 | 自动回访、转介绍池 |

### 5.3 第三阶段：后台支撑（3-4周）

| 优先级 | 模块 | 功能点 |
|--------|------|--------|
| P2 | 人事管理 | 招聘、考勤、培训 |
| P2 | 绩效管理 | KPI设置、自动评分 |
| P2 | 行政管理 | 资产、用章、采购 |
| P2 | 审批中心 | 通用审批流、自定义流程 |
| P2 | 自动化预警 | 规则引擎、消息推送 |
| P3 | BI驾驶舱 | 多维度报表、数据可视化 |
| P3 | 数据导出 | Excel/CSV导出 |

---

## 六、开发规范

### 6.1 代码规范

- **语言**：TypeScript（前后端统一）
- **命名**：
  - 文件：kebab-case（如 `user-controller.ts`）
  - 类：PascalCase（如 `UserController`）
  - 方法/变量：camelCase（如 `getUserList`）
  - 常量：UPPER_SNAKE_CASE
- **注释**：关键逻辑必须注释，API 接口必须文档化
- **错误处理**：统一错误码，禁止裸抛错误

### 6.2 Git 规范

- **分支模型**：Git Flow
  - `main` - 生产分支
  - `develop` - 开发分支
  - `feature/*` - 功能分支
  - `hotfix/*` - 紧急修复
- **提交规范**：
  ```
  feat: 新增功能
  fix: 修复bug
  docs: 文档更新
  style: 代码格式
  refactor: 重构
  test: 测试相关
  chore: 构建/工具
  ```

### 6.3 API 开发规范

1. **输入校验**：所有接口必须校验参数
2. **权限校验**：敏感操作必须校验权限
3. **操作日志**：关键操作记录日志
4. **数据脱敏**：返回数据脱敏处理（如手机号 `138****8000`）
5. **分页查询**：列表接口必须支持分页

### 6.4 数据库规范

1. **命名**：表名小写下划线，字段名 camelCase
2. **主键**：统一使用 UUID（`String @id @default(uuid())`）
3. **时间戳**：所有表必须包含 `createdAt` 和 `updatedAt`
4. **软删除**：重要数据使用状态字段标记删除，不物理删除
5. **索引**：查询频繁的字段必须加索引

---

## 七、部署指南

### 7.1 环境要求

| 环境 | 版本 |
|------|------|
| Node.js | >= 18.x |
| npm / yarn / pnpm | >= 8.x |
| Git | >= 2.x |

### 7.2 本地开发

```bash
# 1. 克隆项目
git clone <repository-url>
cd law-firm-system

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp apps/server/.env.example apps/server/.env
# 编辑 .env 文件

# 4. 初始化数据库
cd apps/server
npx prisma migrate dev --name init
npx prisma generate

# 5. 启动后端
npm run dev

# 6. 启动前端（新终端）
cd apps/web
npm run dev
```

### 7.3 生产部署

```bash
# 1. 构建
npm run build

# 2. 数据库迁移
cd apps/server
npx prisma migrate deploy

# 3. 启动服务
npm start
```

### 7.4 环境变量配置

```env
# 服务端 .env
NODE_ENV=development
PORT=7001
DATABASE_URL="file:./law_firm.db"
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# 前端 .env
VITE_API_BASE_URL="http://localhost:7001/api"
```

---

## 八、附录

### 8.1 术语表

| 术语 | 说明 |
|------|------|
| Lead | 线索，潜在客户 |
| Conversion | 转化，从线索到客户 |
| Funnel | 漏斗，线索转化过程 |
| ROI | 投资回报率 |
| KPI | 关键绩效指标 |
| RBAC | 基于角色的权限控制 |
| MVP | 最小可行产品 |

### 8.2 参考资料

- [Egg.js 官方文档](https://eggjs.org/)
- [Prisma 官方文档](https://www.prisma.io/docs)
- [React 官方文档](https://react.dev/)
- [Ant Design 5 文档](https://ant.design/)
- [Zustand 文档](https://docs.pmnd.rs/zustand)

### 8.3 开发团队

| 角色 | 职责 |
|------|------|
| 后端开发 | API 设计、业务逻辑、数据库 |
| 前端开发 | 页面实现、交互逻辑、UI组件 |
| 测试 | 功能测试、接口测试、回归测试 |
| 产品 | 需求确认、验收测试 |

---

*文档版本：v1.0*
*最后更新：2026-04-25*
