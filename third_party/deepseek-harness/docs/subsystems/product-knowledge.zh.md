# 产品知识库

[English](product-knowledge.md) | 中文

产品知识库子系统是 F001 的原生知识库纵向切片。知识库独立于 Session 持久存在，提取有界的 PDF、DOCX、Markdown 和 TXT 源文件，在 SQLite 中保存规范化 Markdown 和来源证据，通过 Host Remote 服务原生 Client 页面，并由独立 Consumer 包向 Agent 提供按 Preset 约束的工具。该能力由 `packages/product/` 所有；Studio 只作为来源与设计参考，不是运行时依赖。

源码：[`product-knowledge`](../../packages/product/product-knowledge) · [`product-knowledge-context`](../../packages/product/product-knowledge-context) · [`product-bundle`](../../packages/product/product-bundle) · [`product-presets`](../../packages/product/product-presets)

## 所有权与数据流

`@deepseek-ai/dsh-product-knowledge` 拥有契约、权威 SQLite 存储、Typert Remote 方法和原生知识库中心。其 Host 与 Client 两侧共享浏览器安全类型，同时避免 Node 持久化代码和解析器进入 Client 构建。每个知识库具有稳定 alias 和 revision。每次文件上传都会先记录格式、大小、源文件 SHA-256、状态、进度和提取错误，然后把规范化 Markdown 按标题确定性分段并写入 SQLite FTS5 索引。同一知识库中的相同源文件字节具有幂等性，提取失败不会留下可检索分块。FTS5 召回有界 ASCII/数字词候选，参数化有界子串查询补足中文短语/二元词候选；确定性词法排序器随后综合精确短语、文档名、标题、正文和单文档多样性信号。检索结果与读取结果保留文档、行号、哈希和版本证据。

`@deepseek-ai/dsh-product-knowledge-context` 是面向模型的 Consumer。它解析一个已配置的知识库 alias，并注册 `knowledge_search`、`knowledge_read`、`knowledge_sources`。结果都有上限；required 绑定缺失、alias 未找到或 revision 不匹配都会明确失败。该包不会把整个知识库注入提示词。

## 原生 Client 界面

知识库中心通过 root-scoped keyed `main.page` Slot 注册，并经 `ctx.layout.openPrimaryPage` 打开。它独立于当前 Session，同时保留 Harness 侧边栏和主题。管理工作台覆盖概览、有界文件上传或粘贴 Markdown、处理详情与本地重新处理、文档删除、证据检索与来源查看、编译后的 Wiki 清单、支持聚类/结构视图和实体聚焦的增强图谱、本地或显式选择模型的流式引用问答、由 Settings 支撑的 Wiki 模型路由与连通性测试、成对确定性评测、归档/恢复启用、逻辑 JSON 备份/恢复，以及要求精确输入 alias 的知识库删除。

Wiki 页面与图谱节点都是持久化 Markdown 的确定性投影，不构成第二份权威数据。Wiki 清单公开 revision、稳定内容哈希、汇总计数、推断的页面类型与主题、来源范围和已解析显式链接。图谱派生页面、来源、主题、页面类型和章节节点，以及 links-to、has-source、has-topic、has-type、contains 和 next 关系。问答默认使用确定性本地抽取。操作者显式选择模型模式时，Host 解析 `product-knowledge` Settings 路由或回退到 Profile 默认路由，发送有界检索证据，并在传递取消信号的同时流式发出 start/delta/complete 帧。只有引用编号全部有效的 `[n]` 回答才是权威完成结果；超时、适配器错误、空输出或引用无效会以本地答案完成。评测对调用方给出的直接事实、跨来源、概念链接、引用跳转、无证据或对抗用例运行基线与优化词法 Profile，报告七个确定性维度、差值和回归状态，不会把词法行为包装成语义模型质量。

## 组合与绑定

正式运行路径是把 Product Bundle 安装到专用 `product` Profile，并置于官方 base 与 Web Bundle 之后。`--patch` 只用于开发和临时覆盖。Agent 绑定写在垂域 Preset 的 `agent.cordis.yml`，不写入 `preset.yml` 或 Product Bundle。F001 先实现 Preset 级绑定；Session 临时与 Workspace 默认优先级后续完成。

仓库内验证器会在临时 `DSH_HOME` 中实际运行官方插件管理路径，核对 `base → web-app → product-bundle` 的层顺序，并确认组合配置包含知识库运行时。参见 [Product Bundle 使用说明](../../packages/product/product-bundle/README.zh.md)。

## 持久化边界

当前存储是启用 WAL 与 strict table 的本地单进程 SQLite 数据库。导入完成、破坏性文档更新和恢复均使用事务；在平台支持时，数据库文件以受限权限创建；上传限制为 20 MiB；检索和图谱投影数量受限；读取最多返回 200 行。版本 2 逻辑备份包含带版本的知识库元数据、提取后的 Markdown 和源文件处理元数据，但排除原始字节。恢复兼容版本 1 和版本 2，校验提取内容的哈希并以原子方式提交。恢复后的文档仍可检索，但缺少原始字节时不能重新处理。基于磁盘的测试覆盖运行时重开以及备份/恢复往返。

多进程写入、文件爬取、multipart 上传流式传输、XLSX/HTML 解析、OCR、后台处理、未来不兼容备份格式之间的 schema 迁移、远程对象存储、逐用户访问控制、embedding/向量检索、模型生成 Wiki、LLM-as-judge 评估和模型推断图谱实体仍不属于本次 F001 增量。浏览器不会获得数据库路径，也不能绕过 Host Remote 边界。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledgebases--knowledgecontroller"></a>

### `ctx.knowledgeBases` — `KnowledgeController`

Host service backing the generated `ctx.remote.knowledge` namespace.

```ts cordis-catalog
/**
 * List persisted knowledge bases for the management workspace.
 * @returns all knowledge-base summaries in update order.
 */
@Remote('list') list(): KnowledgeListValue

/**
 * Create or idempotently resolve one stable knowledge-base alias.
 * @param request - Alias and display name.
 * @returns the knowledge base and whether this call created it.
 */
@Remote('create') create(request: KnowledgeCreateRequest): KnowledgeCreateValue

/**
 * List source documents and evidence metadata.
 * @param request - Knowledge-base identity.
 * @returns bounded document summaries.
 */
@Remote('documents') documents(request: KnowledgeDocumentsRequest): KnowledgeDocumentsValue

/**
 * Import one Markdown source and replace the index atomically.
 * @param request - Knowledge-base identity, document name, and Markdown.
 * @returns the updated knowledge base and imported document.
 */
@Remote('importMarkdown') importMarkdown(request: KnowledgeImportRequest): KnowledgeImportValue

/**
 * Import and process one supported browser-selected source file.
 * @param request - Knowledge-base identity, original file name, and base64 bytes.
 * @returns final document state and duplicate signal.
 */
@Remote('importFile') async importFile(request: KnowledgeImportFileRequest): Promise<KnowledgeImportFileValue>

/**
 * Read persisted processing evidence and extracted preview.
 * @param request - Knowledge-base and document identities.
 * @returns document detail suitable for the management workspace.
 */
@Remote('documentDetail') documentDetail(request: KnowledgeDocumentDetailRequest): KnowledgeDocumentDetailValue

/**
 * Rerun extraction and indexing from locally retained source bytes.
 * @param request - Knowledge-base and document identities.
 * @returns final document and updated knowledge-base state.
 */
@Remote('reprocess') async reprocess(request: KnowledgeReprocessRequest): Promise<KnowledgeReprocessValue>

/**
 * Retrieve bounded source passages through the local index.
 * @param request - Knowledge-base identity, query, and optional limit.
 * @returns ranked evidence passages.
 */
@Remote('search') search(request: KnowledgeSearchRequest): KnowledgeSearchValue

/**
 * Read a bounded source range from one document.
 * @param request - Document identity and optional line range.
 * @returns source text with revision and hash evidence.
 */
@Remote('read') read(request: KnowledgeReadRequest): KnowledgeReadValue

/**
 * Compile the deterministic Wiki manifest or one complete page from Markdown.
 * @param request - Knowledge-base identity and optional document identity.
 * @returns revision, content hash, statistics, page metadata, sources, links, and optional sections.
 */
@Remote('wiki') wiki(request: KnowledgeWikiRequest): KnowledgeWikiValue

/**
 * Derive a bounded document and section relationship graph.
 * @param request - Knowledge-base identity.
 * @returns graph nodes, edges, totals, and truncation state.
 */
@Remote('graph') graph(request: KnowledgeGraphRequest): KnowledgeGraphValue

/**
 * Produce a cited local answer or explicitly request model-generated RAG.
 * @param request - Knowledge-base identity, question, evidence limit, and answer mode.
 * @param signal - caller cancellation propagated to optional model generation.
 * @returns the actual answer mode, evidence, citations, and generation metadata.
 */
@Remote('ask') async ask(request: KnowledgeAskRequest, signal: AbortSignal): Promise<KnowledgeAskValue>

/**
 * Stream a local answer or incremental model output with one authoritative completion frame.
 * @param request - knowledge-base identity, question, evidence limit, and answer mode.
 * @param signal - caller cancellation propagated to model generation.
 * @returns start, optional text deltas, and exactly one completion frame.
 */
@Remote({ mode: 'stream' }) async * askStream(request: KnowledgeAskRequest, signal: AbortSignal): AsyncIterable<KnowledgeAskFrame>

/**
 * Read current Settings-backed Wiki generation configuration and model catalog.
 * @returns persisted settings, resolved route, available models, and write capability.
 */
@Remote('modelSettings') async modelSettings(): Promise<KnowledgeModelSettingsValue>

/**
 * Persist the complete Wiki generation settings through the official Settings provider.
 * @param request - complete validated settings section.
 * @returns the freshly resolved settings and model catalog.
 */
@Remote('saveModelSettings') async saveModelSettings(request: KnowledgeSaveModelSettingsRequest): Promise<KnowledgeModelSettingsValue>

/**
 * Execute an explicit, bounded, tool-free model connectivity probe.
 * @param _request - explicit probe request reserved for future per-call overrides.
 * @param signal - caller cancellation propagated to the model stream.
 * @returns safe route, latency, and bounded output evidence.
 */
@Remote('testModel') async testModel(_request: KnowledgeTestModelRequest, signal: AbortSignal): Promise<KnowledgeModelTestValue>

/**
 * Run deterministic retrieval and expected-term evaluation cases.
 * @param request - Knowledge-base identity and evaluation cases.
 * @returns aggregate metrics and per-case results.
 */
@Remote('evaluate') evaluate(request: KnowledgeEvaluateRequest): KnowledgeEvaluateValue

/**
 * Change one knowledge base between active and archived states.
 * @param request - Knowledge-base identity and target state.
 * @returns the updated knowledge-base summary.
 */
@Remote('setStatus') setStatus(request: KnowledgeSetStatusRequest): KnowledgeSetStatusValue

/**
 * Delete one source document and its index rows.
 * @param request - Knowledge-base and document identities.
 * @returns the updated knowledge-base summary.
 */
@Remote('deleteDocument') deleteDocument(request: KnowledgeDeleteDocumentRequest): KnowledgeDeleteDocumentValue

/**
 * Permanently delete a knowledge base after exact-alias confirmation.
 * @param request - Knowledge-base identity and confirmation alias.
 * @returns the deleted alias.
 */
@Remote('delete') delete(request: KnowledgeDeleteRequest): KnowledgeDeleteValue

/**
 * Export a portable logical backup with a content hash.
 * @param request - Knowledge-base identity.
 * @returns serialized backup metadata and JSON.
 * @throws When a source is still processing and cannot be represented consistently.
 */
@Remote('backup') backup(request: KnowledgeBackupRequest): KnowledgeBackupValue

/**
 * Validate and transactionally restore a non-conflicting logical backup.
 * @param request - Serialized backup JSON.
 * @returns the restored knowledge-base summary.
 */
@Remote('restore') restore(request: KnowledgeRestoreRequest): KnowledgeRestoreValue
```

Source: [`packages/product/product-knowledge/src/index.ts`](../../packages/product/product-knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
