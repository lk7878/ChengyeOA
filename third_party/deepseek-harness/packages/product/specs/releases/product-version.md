# 产品版本对应关系

| 产品版本 | Harness 基线 | Product Bundle 版本 | 桌面版本 | 发布提交 | 状态 |
|---|---|---|---|---|---|
| `0.1.0-dev.1` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `850ed73ba8f66ca7b35860c7bb469adac2e4662e` | F001 MVP 已实现；发布验收待完成 |
| `0.1.0-dev.2` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `da1699d23f1d2e4bfa5515449d9fd40dcedabb52` | F001 正式 Profile 已完成全量构建、启动和认证 HTTP 200 验证 |
| `0.1.0-dev.3` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `1ad20cd610ff0e8bacb66c2f9a8632b10a420931` | 知识库 Client Remote contribution 与 UI 注入作用域已修复；正式 Profile 真实页面验收通过 |
| `0.1.0-dev.4` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `cfe8c1deb3c4defccca76d0d82ea8f9e0681ed53` | F001 Wiki、图谱、问答评估、备份恢复与完整管理 UI 已完成；全仓 lint 通过，doc-sync 31/32 通过，唯一未执行成功项为 Windows 当前账户缺少符号链接权限 |
| `0.1.0-dev.5` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `57b4f1d454869b3508090f5bfa5c78fb97c3a995` | F001 PDF、DOCX、Markdown、TXT 资料处理、SHA-256 去重、失败诊断、重新处理、备份 v2 和文档详情已完成；全仓 lint、12 项产品测试和真实浏览器闭环通过，doc-sync 31/32 通过，唯一未执行成功项为 Windows 当前账户缺少符号链接权限 |
| `0.1.0-dev.6` | `0.1.2-alpha.2` / `0a53fb55` | `0.1.2-alpha.2`（manifest） | 不适用 | `8f89c5b1ba06ff5542c7d380d881f7cb7ad1450d` | F001 即时 Wiki manifest、中文与 ASCII 加权词法检索、可选生成式 RAG、完整证据预算和安全降级已完成；20 项产品测试、Host/Client 全量构建、15 项快速文档门禁、隔离 Product Profile 组合验证均通过，真实浏览器验证模型成功与无效路由降级，控制台无错误；完整 doc-sync 的唯一环境限制仍是 Windows 当前账户缺少符号链接权限 |
| `0.1.0-dev.7` | `0.1.2-alpha.2` / `6ad652d5` | `0.1.2-alpha.2`（manifest） | `0.1.0-dev.1` | `de7a38d80872e54a8ba9ea4093f2d8183a6401d8` | F001 Studio 增强图谱、可取消 Typert 流式问答、Settings 模型路由与连通测试、baseline/optimized 七维高级评估已完成；24 项产品测试、全仓 lint、Host/Client 全量构建、15 项快速文档门禁、隔离 Product Profile 组合验证和真实浏览器闭环均通过，控制台无错误；未进入 Plugin Center |
| `0.1.0-dev.8` | `0.1.2-alpha.2` / `6ad652d5` | `0.1.2-alpha.2`（manifest） | `0.1.0-dev.1` | 待回填 | F001 Harness 原生知识工作区 UI 已完成；真实指标工作台、文档主从视图、可筛选 Wiki 阅读器、流式问答证据区和知识库管理对话框通过 Client 行为测试、类型检查、包构建与 Product Desktop 构建；未进入 Plugin Center |

产品逻辑版本独立于 Harness 上游版本。当前产品包 manifest 继续跟随官方 Harness 包版本，产品开发版本则使用本表的 `0.x.y-dev.n`；每次产品提交记录 Harness 基线版本与 SHA，开发版本不作兼容承诺。

`0.1.0-dev.9`（待提交）：F001 对齐 Harness 字号、修复导入后的空图谱缓存、将问答重构为消息流和底部输入框；已通过 Client 六项行为测试、类型检查、包与 Desktop 构建，以及实际论文图谱和最小桌面尺寸的 Product Profile 浏览器验证。沿用上表 Harness、Bundle 与桌面版本，发布 SHA 待回填。
