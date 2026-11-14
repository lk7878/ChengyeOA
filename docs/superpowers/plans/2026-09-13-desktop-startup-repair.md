# 桌面智慧办案启动修复

依据 SPEC-AI-DESKTOP-20260913，先记录故障契约，再修改代码。

## 已确认原因

现用桌面仍为阶段一配置，product Profile 只有 Web/Product 依赖。阶段二 patch 已引用 `@chengyeoa/harness-desktop-tools`，启动日志出现 ERR_MODULE_NOT_FOUND。此前验证使用新建测试 Profile，未覆盖已有用户直接升级后点击入口的情况。

## 修复契约

1. 原生助手启动前，在正式 Profile 校验之后检查本项目桌面插件是否安装且指向本次交付目录；缺失或链接失效时使用原生 CLI 补齐固定本地插件，成功后再启动 Host。
2. 检查和修复不从网页接收路径或命令，不下载任意插件，不改 Harness 快照；保留原生设置、凭据、会话、工作目录和 Profile 自定义配置。多个入口点击复用既有启动互斥。
3. 补齐当前机器的旧 Profile，重启到带私有 IPC 的新版桌面进程，再点击 OA 右上角入口验证。普通浏览器行为保持原有契约。
4. 验证缺插件的升级场景、已安装时无重复安装、失败时不继续启动，并执行现有桌面相关测试。更新使用说明并本地 Git 提交。

## 结果

- `desktop/plugin-install.mjs` 增加固定插件检查与原生 CLI 修复，正式 Profile 校验通过后、Host 启动之前执行；存在有效链接时不重复安装。原生快照没有修改。
- 10 项桌面相关单元测试通过，覆盖旧 Profile 缺依赖、只安装本地固定包、设置保留、重复调用跳过和安装失败拒绝启动。
- Electron 完整回归先通过原生 CLI 移除测试 Profile 的桌面插件，再实际点击 OA 入口，验证自动恢复依赖、原生 UI 启动、Wiki 查询、视觉请求、文件读写、重启恢复与账号隔离。截图：`C:\Users\HW\AppData\Local\Temp\chengye-desktop-e2e-rZ5uWT`。
- 当前用户的旧 Electron 进程已确认没有本地 Harness 任务运行，再重启到新版。重启后 OA 需重新登录，因此当前机器用登录页同一受信任启动桥验证：实际用户 Profile 自动补齐插件，原生窗口显示首次内测声明；未代用户接受声明或发起模型任务。窗口保持打开。截图位于忽略目录 `integrations/intelligence/run/startup-repaired.png`。
- 桌面构建通过，9267 个导入源文件校验一致；更新使用说明并随本次修复提交本地 Git。
