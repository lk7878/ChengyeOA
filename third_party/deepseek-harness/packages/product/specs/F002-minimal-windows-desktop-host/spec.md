# F002 最小 Windows Desktop Host

## 目标

为当前产品组合提供一个 Windows Electron 桌面入口。桌面应用监管通过 `dsh --profile product` 启动的回环 Web Host，在原生窗口中加载其一次性认证 URL，并在窗口关闭后通过系统托盘继续持有 Host 生命周期。

## 用户路径

1. 开发者按产品 Bundle 文档建立包含 Web Bundle 和 Product Bundle 的 `product` Profile。
2. 开发者运行产品桌面开发命令。
3. Desktop 启动专用 Profile，等待 Host 输出经过校验的回环就绪 URL，然后显示原生窗口。
4. 用户关闭窗口时应用缩入系统托盘；点击托盘或“显示”菜单恢复窗口。
5. 用户通过托盘“退出”或系统显式退出时，Desktop 等待 Host 停止后结束应用。

## 功能范围

- 仅支持 Windows 开发态启动和验收。
- Desktop 只启动正式 `product` Profile，不建立第二套 Cordis 组合，也不使用 `--patch` 装配产品功能。
- Host 使用 OS 分配的回环端口；Desktop 只接受 `127.0.0.1` 或 `localhost`、显式端口、根路径和单个合法启动令牌组成的 HTTP 就绪 URL。
- 同一时刻只持有一个 Desktop 实例、一个 Host generation 和一个主窗口。
- BrowserWindow 启用 renderer sandbox 与 context isolation，关闭 Node integration，不提供通用 IPC 或文件系统桥。
- 主窗口只能导航到当前 Host 来源。HTTP/HTTPS 外链交给系统浏览器；其他协议、弹窗和跨来源页面在 Desktop 内被拒绝。
- 启动超时、Host 提前退出和窗口加载失败产生有界诊断，并进入明确的退出路径。
- Windows 关闭窗口缩入托盘；显式退出以有界等待关闭 Host，超时后升级终止。

## 非目标

- Windows 安装器、运行时裁剪、代码签名、自动更新和发布基础设施。
- macOS、Linux 或跨平台外观适配。
- 插件中心、Preset 广场、应用中心、品牌主题和桌面更新卡片。
- Studio 的旧 Host/Client 桥、兼容迁移、产品标识、更新源和资源包。
- 在 Desktop 内实现知识库或其他产品业务。

## 验收标准

- `pnpm --filter @deepseek-ai/dsh-product-desktop typecheck` 与聚焦测试通过。
- Host supervisor 对拆分输出、非法 URL、冲突就绪信息、启动失败、超时和有界关闭有确定测试。
- 导航策略对同源页面、HTTP/HTTPS 外链、危险协议和弹窗有确定测试。
- 窗口生命周期对单实例、关闭到托盘、恢复窗口和显式退出等待 Host 有确定测试。
- 在 Windows 上通过开发命令启动真实 Electron；窗口显示 Product Profile 的知识库入口，关闭窗口后 Host 仍存活，从托盘恢复后页面可继续使用，显式退出后回环端口释放。
- 验收后代码仓库保持无未跟踪源码产物，`packages/product/specs/` 中的 Feature Spec 回填实现提交和验证结果。

## 基线与来源

- 官方 Harness 基线：`0a53fb55bea101816fa226bb964ae2bed71c343b`。
- 当前产品代码基线：`8f89c5b1ba06ff5542c7d380d881f7cb7ad1450d`。
- F001 Spec 基线：`4af09f058c88d9afe2ad6d1e47d91325c4f7c616`。
- Studio 参考：`c403d45d63866e65452fdaf680519fdeaee7d3ad` 下 `apps/desktop/` 的 Host 监管、窗口生命周期和导航边界。
- 实现必须针对当前 Harness 的带令牌就绪 URL、Profile 和 Bundle 机制重写，不复制 Studio 的插件中心、发布链或品牌资产。
