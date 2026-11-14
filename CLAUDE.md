# 承业OA（律所闭环管理系统）

## 项目定位

覆盖律所经营全链路的综合管理系统，以 LayerManage 为经营 OA 基座。

```
品牌与流量获客 -> 线索与客服邀约 -> 谈案与两类合同
  -> 收款与经营统计 -> 案件办理与交付 -> 客户复购与转介绍
```

覆盖：总所、地区分所、前瞻研究部、律师培训部、品牌宣传部及后续预留团队。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Egg.js 3 + TypeScript |
| 前端 | React 19 + Ant Design 6 + Zustand |
| ORM | Prisma 5.22 |
| 数据库 | PostgreSQL 16 (Docker, 端口 55432) |
| 运行时 | Node.js 22.14.0（目标版本；开发机实测 v24.18.0，SPEC-010 全量测试零影响——2026-07-31 用户裁决加注）, npm 10.9.2 |
| 测试 | Node test runner (后端), Vitest + Playwright 1.55.1 (前端) |

## 项目结构

```
LayerManage/law-firm-system/
├── apps/server/         # Egg.js 后端
│   ├── app/controller/  # 路由控制器
│   ├── app/middleware/   # 中间件 (auth, errorHandler)
│   ├── app/application/ # 应用服务层
│   ├── app/domain/       # 领域层
│   ├── prisma/           # 数据库 schema 和迁移
│   ├── test/             # 测试
│   └── typings/          # Egg 生成类型
├── apps/web/             # React 前端
├── infra/postgres/       # Docker Compose
├── scripts/security/     # 安全脚本
└── docs/                 # 项目文档
```

## 关键约束（必须遵守）

1. **禁止 Git/GitHub 操作** — 不 commit、push、PR、merge。所有代码在本地完成。
2. **数据库测试必须串行** — 使用 `--test-concurrency=1`，多文件并行会因共享 test DB 产生假失败。
3. **不要恢复 SQLite** — 项目已收敛到 PostgreSQL 单数据库，旧 SQLite 迁移已删除。
4. **不要执行 `git reset --hard` / `git clean`** — 大量未提交修改是正常状态。
5. **长 `git status` 是正常的** — 当前工作包含 SPEC-004 及之后的未提交成果。
6. **测试数据库名必须以 `_test` 结尾**，重置需要 `ALLOW_TEST_DB_RESET=true`。
7. **Egg 测试需要同时设置 `DATABASE_URL` 和 `DATABASE_URL_TEST`**。
8. **不要修改 `.env`、生产数据库或密钥文件**。

## 环境变量（本地开发）

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa?schema=public'
$env:DATABASE_URL_TEST='postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public'
$env:JWT_SECRET='<至少32字符随机值>'
$env:APP_KEYS='<key1>,<key2>'
$env:ALLOW_TEST_DB_RESET='true'
```

参照 `LayerManage/law-firm-system/apps/server/.env.example`。

## 常用命令

```bash
# 启动 PostgreSQL
npm run db:up

# 安装依赖
npm run setup

# 生成 Prisma Client
npm --prefix apps/server run db:generate

# 重置测试数据库
npm run db:reset:test

# 验证（lint + typecheck + test + build + security）
npm run verify

# 单独运行后端测试
cd apps/server && npx tsx --test --test-force-exit --test-concurrency=1 test/...

# 前端测试
npm --prefix apps/web run test
```

## 工程文档

- 权威文档索引: `docs/superpowers/README.md`
- Spec 设计: `docs/superpowers/specs/`
- 实施 Plan: `docs/superpowers/plans/`
- 运维 Runbook: `docs/superpowers/runbooks/`
- 交接收官: `docs/superpowers/reports/`
- Handoff: `docs/superpowers/handoffs/`
- Superpowers SDD: `.superpowers/sdd/progress.md`
