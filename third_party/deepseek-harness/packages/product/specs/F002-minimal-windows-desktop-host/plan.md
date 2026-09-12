# F002 实施计划

## 1. Desktop 包骨架

- 在 `apps/product-desktop/` 建立私有 Electron 应用包、独立 TypeScript 配置与 Host/Client 构建入口。
- 使用当前工作区的 Electron、TypeScript、Vitest 和打包工具，不引入 Studio 运行时依赖。
- 更新根工作区锁文件和必要的构建引用，使全仓脚本能发现该应用。

## 2. Host 监管

- 封装 `dsh --profile product --no-open --host 127.0.0.1 --port 0` 子进程。
- 增量解析并严格校验带一次性令牌的就绪 URL。
- 合并重复启动，记录单个 generation，并为启动、提前退出、显式关闭和强制终止建立有界状态转换。

## 3. Electron 生命周期

- 主进程申请单实例锁并在第二实例请求时恢复主窗口。
- 创建启用 sandbox、context isolation 且无 Node integration 的 BrowserWindow。
- 创建 Windows 托盘菜单；窗口关闭转为隐藏，显式退出等待 Host 关闭。
- 只把经 supervisor 校验的启动 URL交给窗口。

## 4. 导航与权限

- 允许当前 Host 同源导航。
- HTTP/HTTPS 跨来源目标交给系统浏览器，并拒绝在 Desktop 中打开新窗口。
- 拒绝非 Web 协议、权限请求和不属于当前 renderer 的行为。

## 5. 文档与验证

- 更新中英文 Desktop README、产品包入口说明及配对记录。
- 添加 Host、导航和生命周期单元测试。
- 运行 Desktop typecheck、聚焦测试、工作区依赖门禁、相关文档门禁和 Windows 真实启动验收。
- 代码提交后回填 Feature Map、完成态任务和实现 SHA。

## 迁移原则

- 迁移用户能力和安全约束，不复制 Studio 的历史拓扑。
- Desktop 只拥有交付壳；产品业务继续来自 Product Bundle。
- 当前 Feature 不提前建立插件中心、更新器或发布链抽象。
