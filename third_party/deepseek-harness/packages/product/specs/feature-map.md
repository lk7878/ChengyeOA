# Feature Map

Feature ID 使用 `F001`、`F002` 等稳定编号。每项能力建立独立目录 `Fxxx-feature-name/`，包含 `spec.md`、`plan.md` 和 `tasks.md`；文档深度按能力复杂度调整，不为简单变更制造形式负担。

| Feature ID | 能力 | 状态 | Studio 参考 | 代码提交 | 备注 |
|---|---|---|---|---|---|
| F001 | LLM Wiki 原生知识库 | `dev.9` 字号对齐、图谱刷新与聊天布局已实现 | Studio `ff-llm-wiki-plugin` | `5c77cdb`、`a49b555`、`1cc600d`、`850ed73`、`da1699d`、`1ad20cd`、`cfe8c1d`、`57b4f1d`、`8f89c5b`、`de7a38d`、待回填 | 保留 Harness 全局外壳和排版体系；图谱/Wiki 每次进入读取当前修订，流式问答使用底部输入框与逐条引用。真实论文 29 节点/52 边已验证；语义实体抽取与持久多轮记忆不在本增量，未进入 Plugin Center |
| F002 | 最小 Windows Desktop Host | `0.1.0-dev.1` 已完成 | Studio `apps/desktop/` 的 Host、窗口、托盘和导航设计 | `6ad652d` | Windows 开发态桌面壳、正式 Product Profile、单实例、托盘与安全导航已完成真实桌面闭环；安装器、更新、插件中心、Preset 广场和品牌皮肤不在本 Feature |
| F003 | PaddleOCR 本地文档解析 | dev.2 真实论文回归已通过，桌面人工复测待完成 | PaddleOCR PP-OCRv5 / PP-StructureV3 | 待提交 | 修复多 MB Base64 调用栈溢出；原生文本优先，仅问题页使用 1200 像素 PP-OCRv5 server 文字 OCR；代表性 24 页论文底层链路通过；完整结构语义、缓存、取消与诊断 UI 待后续增量 |
| F004 | XLSX/HTML 本地资料导入 | dev.1 自动化验证已完成，浏览器验收待完成 | Studio LLM Wiki 文件导入目标与当前产品解析链路 | 待提交 | XLSX 工作表与 HTML 正文转换为可追溯 Markdown 后进入现有分段、词法检索和 Wiki 编译；不引入 Embedding 或向量索引 |
| F005 | 本地混合检索 | `dev.2` 工程闭环已实现，真实语料人工验收待完成 | Studio 仅有“向量化与索引”阶段文案，实际未接入 Embedding | 待提交 | Windows CPU 已验证固定 revision 的轻量 E5；搜索/问答诊断、版本化索引管理和 baseline/optimized/hybrid 成对评测已接通；评测达标前正式 Bundle 默认关闭 |
