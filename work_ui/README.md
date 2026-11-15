# 百佑智业 · 鉴定助手工作台（work_ui）

百佑智业团队鉴定人员工作台前端，集中处理**案件管理**与**账号管理**，并提供跳转 **AI 助手**与**知识库管理**的快捷入口。

视觉与 DeepSeek Harness / WeKnora 保持一致：复用 `--dsw-alias-*` 设计令牌（见 `src/styles/theme.css`），支持浅色 / 深色主题。

## 目录结构

```
work_ui/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  public/favicon.svg
  src/
    main.tsx              # 入口
    App.tsx               # 侧边栏 + 顶栏 + 视图路由
    types.ts              # 领域模型（角色、案件、账号）
    config/links.ts       # AI 助手 / 知识库管理地址 + 当前用户
    data/mock.ts          # mock 案件与账号
    styles/
      theme.css           # 设计令牌（与 harness ui-theme 对齐）
      app.css             # 全局样式
    components/           # Button / Tag / Modal / Sidebar / TopBar / icons / StatusTags
    views/
      Dashboard.tsx       # 概览：统计、阶段分布、角色分布、最近案件、跳转卡片
      CaseManagement.tsx  # 案件管理：搜索 / 阶段筛选 / 列表 / 详情 / 新建
      AccountManagement.tsx # 账号管理：搜索 / 状态筛选 / 表格 / 编辑 / 新建
```

## 启动

```powershell
cd E:\A\work_ui
pnpm install
pnpm dev      # http://127.0.0.1:5180  ← 工作台本身
pnpm build    # 产物 dist/
pnpm preview  # http://127.0.0.1:4173  ← 预览构建产物
```

> 注意：工作台本身跑在 **5180**（dev）或 **4173**（preview）。
> 跳转按钮指向的 AI 助手 / 知识库管理是**另外两个独立服务**，需要分别启动后才能访问。

## 跳转地址

`src/config/links.ts` 集中配置外部入口，按部署环境替换：

- **AI 助手**：DeepSeek Harness web 入口（`apps/web`，默认 `dsh web` 端口）。
- **知识库管理**：本地 WeKnora 控制台。

跳转使用 `window.open(href, '_blank', 'noopener,noreferrer')`，新标签打开。

## 与架构方案的关系

`reports/鉴定助手架构方案.md` 中的约定在本工作台体现为：

- 案件列表案号格式 `CASE-<内部案号>`，对应「一案一空间」。
- 案件详情展示派生材料目录结构（`originals/`、`derived/ocr/`、`derived/redacted/`、`derived/wiki/`、`reports/`、`audit/`）。
- 账号角色映射架构方案中的五类人员：平台维护者 / 公共库管理员 / 案件负责人 / 鉴定人员 / 复核人员，编辑账号时按「最小授权」勾选。

当前为前端 mock 演示版本，未写盘、未接后端。接入后端时，将 `data/mock.ts` 替换为真实接口返回的同形结构即可。
