# F004 任务

## Spec 阶段

- [x] 确认 XLSX/HTML 属于资料解析主流程，Embedding/向量检索不是前置能力。
- [x] 定义 XLSX 行列投影、HTML 安全正文过滤和资源限制。
- [x] 登记 Feature Map 与产品 Spec 索引。

## 实现阶段

- [x] 扩展 `KnowledgeDocumentKind`、扩展名分类与备份类型校验。
- [x] 实现 XLSX 工作表到带行号 Markdown 表格的本地转换。
- [x] 实现 HTML 可见正文到 Markdown 文本的本地转换，并过滤脚本、样式、无脚本和导航内容。
- [x] 配置 XLSX 工作表、总非空行和单表列数限制。
- [x] 扩展 Client 文件选择器和中英文支持格式文案。
- [x] 增加 HTML、XLSX 成功路径和 XLSX 资源限制聚焦测试。
- [x] 完成 Host/Client 构建、全仓 lint、产品文档检查和隔离 Product Profile 组合启动验证。
- [ ] 完成 Product Profile 浏览器真实用户闭环；当前执行环境未提供可用浏览器控制面，Host 已成功输出认证回环地址。
- [ ] 更新产品版本映射、Feature Map 状态和实现提交 SHA。
