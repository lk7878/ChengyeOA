# 统一桌面客户端：阶段一开发验证

依据 [V1.3.0 Spec](../../../docs/superpowers/specs/2026-09-13-unified-desktop-local-harness.md)。本目录实现可运行的桌面基础；不是完整 V1.3.0 发布版或独立安装包。

## 本阶段已接入

统一 Electron 客户端显示 OA 页面，右上角“智慧办案”通过受限桥接打开同一个原生 Harness 窗口。原生界面、Windows 文件夹选择器、Product Profile、工作区、模型配置、文件工具、会话日志和恢复均复用 `third_party/deepseek-harness`。OA 浏览器访问仍沿用 V1.2.1 浮动工作台，保留原 OPFS 数据；桌面客户端使用真实本机目录，两者没有隐式迁移或同步。

桌面主进程直接复用原生 `host-supervisor.ts`、`window-lifecycle.ts`、`product-profile.ts`，通过独立 esbuild 构建，不改导入快照。正式 Product Bundle 继续装载，仅通过 `product.patch.yml` 关闭其本地 Wiki 管理插件，防止出现第二套个人维护知识库；OA 原有云端“知识库”入口保留。新的本地助手查询云端 Wiki 接口在下一阶段接入。

## 开发准备与启动

环境：Windows、Node 22.20+ 的 22.x、已安装并构建的导入 Harness、适配器依赖和 OA。全仓初次准备沿用[适配项目说明](../README.md)。开发验证使用上游锁定的 Electron 43.4.0；由于常规依赖安装禁用生命周期脚本，需显式安装该二进制一次。以下命令从 OA 仓库根目录执行：

```powershell
node third_party/deepseek-harness/apps/product-desktop/node_modules/electron/install.js
node integrations/intelligence/scripts/desktop.mjs build
node integrations/intelligence/scripts/desktop.mjs setup --oa-url http://localhost:3000/
node integrations/intelligence/scripts/desktop.mjs start
```

也可使用 `npm --prefix integrations/intelligence run desktop:build`、`desktop:setup`、`desktop:start`。OA 开发服务需先启动；生产 OA 地址必须使用 HTTPS，开发回环地址允许 HTTP。地址不允许含账号密码、查询参数或片段。

默认开发配置位于 `%LOCALAPPDATA%\ChengyeOA\desktop\desktop.json`，包含 OA 地址、本机 Node 路径和本仓库 Harness 路径。可通过绝对路径环境变量 `CHENGYE_DESKTOP_HOME` 指定另一套独立数据目录；不通过网页传入目录、命令或配置。`setup` 通过正式 `dsh plugin --profile product add` 准备 Base → Web → Product 三层并重新链接本仓库路径，保留原生用户配置和数据。源码目录搬迁后重新运行 setup；异常的非正式 Profile 不自动覆盖。

开发构建输出在 `integrations/intelligence/dist/desktop/`，目前依赖本机 Node、完整导入源码的构建产物及依赖。后续需打包运行时与安装器并在干净 Windows 环境验收，不能将本开发目录冒充独立安装包。

## 使用和数据位置

1. 登录 OA，在右上角点击“智慧办案”。也可通过系统托盘“打开智慧办案”启动本地助手，OA 暂时离线不影响打开本地材料。
2. 第一次进入显示原生内测声明；点击继续后，在原生界面选择工作区，Windows 文件夹选择器直接选中本机目录。
3. 通过 Harness 原生设置配置个人模型服务和凭据。本文不提供或写入任何真实模型密钥；测试模型配置仅存在独立的测试临时目录中。
4. 关闭办案窗口将其隐藏，再次点击入口恢复同一窗口与会话；OA 主窗口关闭后保留托盘。托盘“退出客户端”停止本机 Host 后退出。
5. 重启客户端后从原生侧栏点击历史会话继续使用。文件保留在选定工作区，会话与工作区记录在 `<桌面数据目录>\harness\`，原生客户端状态位于 `client\`。新窗口不保证自动选中上一次会话。

本阶段保持原生标准模式，不新建法律专用工具集合。原生 `workspace-write` 权限允许工作目录及平台临时目录写入，其他路径的写入按原生权限拒绝或审批；这不等同于禁止读取所有工作目录外文件。OA 页面没有 Node、文件、Shell 或通用 IPC 能力；其唯一桥接操作是打开助手，并由主进程校验窗口、主框架和精确来源。模型凭据不由云端环境继承到个人引擎，个人会话遥测上传已关闭。

## 验证与范围

```powershell
node --test integrations/intelligence/desktop/tests/policy.test.mjs
node integrations/intelligence/desktop/tests/smoke.mjs
```

真实桌面烟测需 OA Vite 开发服务位于 `localhost:3000`、PowerShell 7、原生构建和 Electron。使用已有 OA E2E 身份夹具与临时本机 HTTP 脚本模型，不依赖真实账号或外部模型密钥；启动隔离正式 Product Profile。自动化操作由测试实例拥有的 Windows 原生目录对话框，再通过原生 UI 发起读写，验证目录外非临时路径写入被拒绝、关闭窗口恢复、退出后 Host 端口关闭、重启后历史会话与文件仍在。原生目录测试只使用临时测试材料，不扫描用户卷宗。

结果与截图位置见[阶段一实施记录](../../../docs/superpowers/plans/2026-09-13-unified-desktop-local-harness.md)。未完成的后续能力包括：本地助手云端 Wiki 查询、个人视觉 API 专项适配、主动归档、OA 离线草稿同步、旧 OPFS 迁移以及独立安装器。这些仍以完整 Spec 为准。
