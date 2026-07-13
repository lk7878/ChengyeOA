# 律所闭环管理系统 - 部署文档

> 版本：v1.0
> 创建日期：2026-04-25
> 状态：开发中

---

## 目录

1. [环境要求](#一环境要求)
2. [开发环境搭建](#二开发环境搭建)
3. [生产环境部署](#三生产环境部署)
4. [数据库管理](#四数据库管理)
5. [常见问题](#五常见问题)

---

## 一、环境要求

### 1.1 系统要求

| 环境 | 要求 |
|------|------|
| 操作系统 | Linux / macOS / Windows (WSL2) |
| Node.js | >= 18.x LTS |
| 包管理器 | npm >= 8.x 或 yarn >= 1.22.x 或 pnpm >= 7.x |
| Git | >= 2.x |

### 1.2 推荐开发环境

- **IDE**: VS Code + 以下插件
  - ESLint
  - Prettier
  - TypeScript Importer
  - Prisma
  - Tailwind CSS IntelliSense

---

## 二、开发环境搭建

### 2.1 克隆项目

```bash
git clone <repository-url>
cd law-firm-system
```

### 2.2 安装依赖

```bash
# 使用 npm
npm install

# 或使用 yarn
yarn install

# 或使用 pnpm（推荐）
pnpm install
```

### 2.3 配置环境变量

#### 后端环境变量

```bash
cp apps/server/.env.example apps/server/.env
```

编辑 `apps/server/.env`：

```env
# 应用配置
NODE_ENV=development
PORT=7001

# 数据库配置（SQLite）
DATABASE_URL="file:./law_firm.db"

# JWT 配置
JWT_SECRET="your-secret-key-here-change-in-production"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_EXPIRES_IN="30d"

# 日志配置
LOG_LEVEL=info
LOG_DIR=./logs
```

#### 前端环境变量

```bash
cp apps/web/.env.example apps/web/.env
```

编辑 `apps/web/.env`：

```env
# API 基础地址
VITE_API_BASE_URL="http://localhost:7001/api/v1"

# 应用标题
VITE_APP_TITLE="律所管理系统"
```

### 2.4 初始化数据库

```bash
cd apps/server

# 生成 Prisma Client
npx prisma generate

# 创建数据库迁移
npx prisma migrate dev --name init

# 可选：查看数据库（Prisma Studio）
npx prisma studio
```

生产环境初始化系统数据时，必须由部署密钥管理为当前 PowerShell 进程提供 `SEED_ADMIN_PASSWORD`。不要将密码写入脚本、文档或命令历史：

```powershell
cd apps/server
if (-not $env:SEED_ADMIN_PASSWORD) { throw 'SEED_ADMIN_PASSWORD is required' }
npm run db:seed
```

### 2.5 启动开发服务器

#### 方式一：分别启动

```bash
# 终端 1：启动后端
cd apps/server
npm run dev

# 终端 2：启动前端
cd apps/web
npm run dev
```

#### 方式二：使用 concurrently 同时启动

```bash
# 在项目根目录
npm run dev
```

### 2.6 访问应用

- 前端页面：http://localhost:5173
- 后端 API：http://localhost:7001
- Prisma Studio：http://localhost:5555

---

## 三、生产环境部署

### 3.1 构建项目

```bash
# 在项目根目录
npm run build
```

### 3.2 生产环境配置

#### 后端 `.env.production`

```env
NODE_ENV=production
PORT=7001
DATABASE_URL="file:./law_firm.db"
JWT_SECRET="your-production-secret-key"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_EXPIRES_IN="30d"
LOG_LEVEL=warn
LOG_DIR=./logs
```

#### 前端 `.env.production`

```env
VITE_API_BASE_URL="/api/v1"
VITE_APP_TITLE="律所管理系统"
```

### 3.3 数据库迁移

```bash
cd apps/server

# 部署迁移（不删除数据）
npx prisma migrate deploy

# 生成 Prisma Client
npx prisma generate
```

### 3.4 使用 PM2 启动（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动后端
cd apps/server
pm2 start ecosystem.config.js

# 或使用命令行
pm2 start dist/main.js --name law-firm-server

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

### 3.5 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/law-firm-system/apps/web/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:7001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3.6 Docker 部署（可选）

#### Dockerfile

```dockerfile
# 后端 Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY apps/server/package*.json ./
RUN npm install --production

COPY apps/server/dist ./dist
COPY apps/server/prisma ./prisma
COPY apps/server/.env.production ./.env

RUN npx prisma generate

EXPOSE 7001

CMD ["node", "dist/main.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - "7001:7001"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:./data/law_firm.db
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "80:80"
    depends_on:
      - server
    restart: unless-stopped
```

---

## 四、数据库管理

### 4.1 备份数据库

```bash
# SQLite 备份就是复制文件
cp apps/server/law_firm.db apps/server/law_firm.db.backup.$(date +%Y%m%d)

# 或者使用脚本
./scripts/backup-db.sh
```

### 4.2 恢复数据库

```bash
# 停止应用
pm2 stop law-firm-server

# 恢复备份
cp apps/server/law_firm.db.backup.20260425 apps/server/law_firm.db

# 重启应用
pm2 start law-firm-server
```

### 4.3 数据库迁移

```bash
# 开发环境：创建新迁移
cd apps/server
npx prisma migrate dev --name add_new_field

# 生产环境：应用迁移
npx prisma migrate deploy
```

### 4.4 查看数据库

```bash
# Prisma Studio（可视化界面）
npx prisma studio

# 或者使用 SQLite CLI
sqlite3 apps/server/law_firm.db
```

---

## 五、常见问题

### Q1: 端口被占用

```bash
# 查找占用 7001 端口的进程
lsof -i :7001

# 或者使用 netstat
netstat -tlnp | grep 7001

# 杀死进程
kill -9 <PID>
```

### Q2: 数据库锁定

SQLite 不支持并发写入，如果出现锁定：

```bash
# 检查是否有其他进程在使用
lsof apps/server/law_firm.db

# 重启应用
pm2 restart law-firm-server
```

### Q3: Prisma Client 未生成

```bash
cd apps/server
npx prisma generate
```

### Q4: 前端无法连接后端

1. 检查后端是否启动：`curl http://localhost:7001/api/v1/health`
2. 检查前端 `.env` 中的 `VITE_API_BASE_URL`
3. 检查防火墙设置

### Q5: 生产环境 JWT 密钥

**重要**：生产环境必须修改 JWT 密钥！

```bash
# 生成随机密钥
openssl rand -base64 32

# 将生成的密钥写入 .env.production
JWT_SECRET="your-generated-key"
```

---

## 附录

### A. 项目脚本

```json
// package.json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:web\"",
    "dev:server": "cd apps/server && npm run dev",
    "dev:web": "cd apps/web && npm run dev",
    "build": "npm run build:server && npm run build:web",
    "build:server": "cd apps/server && npm run build",
    "build:web": "cd apps/web && npm run build",
    "start": "cd apps/server && npm start",
    "db:migrate": "cd apps/server && npx prisma migrate dev",
    "db:deploy": "cd apps/server && npx prisma migrate deploy",
    "db:studio": "cd apps/server && npx prisma studio",
    "db:seed": "cd apps/server && npm run db:seed",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\""
  }
}
```

### B. 目录结构

```
law-firm-system/
├── apps/
│   ├── server/           # Egg.js 后端
│   │   ├── app/
│   │   ├── config/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── database/     # SQLite 数据库文件
│   │   ├── logs/         # 日志文件
│   │   └── scripts/      # 脚本文件
│   └── web/              # React 前端
│       ├── src/
│       └── dist/         # 构建输出
├── docs/                 # 文档
├── scripts/              # 公共脚本
└── data/                 # 数据备份
```

---

*文档版本：v1.0*
*最后更新：2026-04-25*
