# F002 任务

- [x] 建立 `apps/product-desktop/` Electron 包及构建配置。
- [x] 实现带令牌回环 URL 的 Host supervisor 与有界关闭。
- [x] 实现单实例、主窗口、系统托盘和显式退出生命周期。
- [x] 实现同源导航、外部浏览器跳转和权限拒绝策略。
- [x] 完成中英文 Desktop 文档、来源记录和 Agent Note。
- [x] 通过聚焦自动化检查与 Windows 真实桌面验收。
- [x] 提交代码并回填实现 SHA、版本状态和验证结果。

## 实现结果

- 代码提交：`6ad652d5d129d22dc1dcdb07100c54158f229983`（`0.1.0-dev.1`）。
- Desktop 类型检查、构建、lint、导出 JSDoc 和 4 个测试文件共 16 项测试通过。
- Product Profile 隔离验证确认 Bundle 顺序为 `base → web-app → product-bundle`。
- Windows 真实启动显示 Product Profile 页面；关闭窗口后 Electron 与 Host 保持运行；第二次启动恢复原窗口且没有新增 Host；托盘 `Quit` 后 Electron、Host 和动态回环端口均释放，命令以退出码 0 结束。
- 锁文件冻结安装、包结构、应用入口、tsconfig 路径、Markdown 格式、Agent Note 格式和三组中英文配对检查通过。
