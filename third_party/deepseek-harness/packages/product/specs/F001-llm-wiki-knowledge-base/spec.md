# F001 LLM Wiki 原生知识库 Feature Spec

## 目标

把 Studio FF–LLM Wiki 的有效能力迁移到当前官方 Harness，形成原生、持久、可复用、可追溯的知识库能力；不复制 Studio 的 Next.js 页面结构、旧 Host/Client 桥接、品牌和 Demo 内容。

## 实现基线与增量契约

本页领域模型与版本段落保留已交付规则投影和历史阶段范围；它们不表示已完成 LLM 语义编译。2026-09-06 批准方向的[学术质量增量设计](academic-quality.md#语义编译与可信问答设计契约)规定在线视觉 API 兜底、原文语言的强模型编译、问答语言跟随用户及引用失败修正，当前仅规格完成。该增量实施时取代本页“不另存编译正文”“无引用即降级为原文”等相冲突的阶段限制，不修改 Harness 核心或更换知识库架构；实际进度见[任务清单](tasks.md)。

## 领域模型

- `KnowledgeBase` 是独立于 Session、Workspace 和 Preset 的持久资源，具有稳定 `id`、可读 `alias`、名称、状态和当前 `revision`。
- `KnowledgeDocument` 属于一个知识库，保留原始文件名、实际格式、原文件哈希、提取正文哈希、大小、处理状态、错误、导入时间和版本。
- `KnowledgeDocumentProcessing` 记录文件接收、解析、分段、索引和完成五个阶段的事实状态；处理失败保留可诊断记录和原始文件，可由用户重新处理。
- `KnowledgeChunk` 是可检索的最小单位，记录文档、标题、行号范围和正文。
- `KnowledgeWikiPage` 是从已导入 Markdown 确定性编译出的浏览投影，保留文档、章节、行号和内容哈希，不另存一份可漂移正文。
- `KnowledgeWikiManifest` 是按知识库 revision 即时生成的编译清单，记录编译时间、内容哈希、页面类型、主题、来源证据、显式关联和聚合统计；SQLite 文档与分段仍是唯一权威数据，不增加需要失效管理的第二份缓存。
- `KnowledgeGraph` 是从 Wiki 页面派生的页面、来源、主题、页面类型和章节节点，以及内链、来源、主题、类型、包含和顺序边；每个图元素都能回到文档或章节来源。图谱同时提供聚类关系视图与结构视图，筛选、搜索和节点详情只改变投影，不改变权威数据。
- `KnowledgeAnswer` 由有界检索结果组成，必须携带引用；默认使用确定性本地摘录回答，用户可显式请求 Harness 官方 LLM 基于同一证据生成回答。生成结果必须通过引用编号校验；模型不可用、超时、输出为空或引用无效时降级为本地回答，并暴露实际模式与降级原因。没有证据时明确返回 `no-evidence`，不得调用模型生成无依据回答。
- `KnowledgeEvaluation` 使用调用方给出的问答用例，在同一 revision 上串行运行 baseline 与 optimized 两个检索 Profile，并以七个稳定维度报告任务完成、检索命中、证据覆盖、引用有效、回答忠实、无答案诚实和输入稳健；不适用维度使用 `null`，不污染分母。每例隔离，报告保留 Profile 差异和回归判定。
- `KnowledgeBackup` 是带 schema 版本、来源元数据、文档正文与哈希的逻辑 JSON；恢复只创建不存在的 alias，不覆盖已有知识库。
- Session 只解析与记录知识绑定，不创建或复制知识库。

## 用户路径

1. 用户从侧栏进入原生“知识库中心”。
2. 创建知识库并获得稳定 alias。
3. 粘贴 UTF-8 Markdown，或上传 PDF、DOCX、Markdown、TXT 文件；Runtime 校验、去重、提取文本、分段并写入 SQLite。
4. 在 Wiki 中浏览由 Markdown 编译的页面与章节，在图谱中查看页面、章节和显式链接关系。
5. 在问答页选择本地回答或模型生成式 RAG；模型文本通过 Typert 流式 Remote 增量显示，取消或离开页面会终止当前生成。两种模式都展示来源，模型模式同时展示实际 provider、model、耗时、用量和降级状态。在知识库设置中选择当前 Harness 已配置的 provider/model、温度、输出上限、证据预算和超时，并可显式执行最小模型连通测试；任何凭据仍只由官方模型配置管理。
6. 在设置页归档或重新启用知识库、导出逻辑备份、恢复备份，并通过 alias 二次确认删除；文档页支持删除单篇文档。
7. Agent 通过 `knowledge_search`、`knowledge_read`、`knowledge_sources` 按需访问已绑定知识库，结果返回来源证据。

评估退出日常用户路径：导航仅保留概览、文档、Wiki、图谱、问答、设置。Host 评估接口与确定性回归测试作为开发维护能力保留，不代表 LLM 学术理解质量。详见[评估入口收敛](evaluation-maintenance-only.md)。

## 原生 UI 契约

- 在官方 `ui-layout` 增加通用单占位 `main.page`，作用域为 root。
- `ctx.layout.openPrimaryPage(pageId)` 打开页面，`closePrimaryPage()` 返回会话主界面；服务同时提供可订阅的当前页面快照供 AppFrame 渲染。
- `main.page` 使用 keyed 分发；产品知识库 Client 只注册自己的 `knowledge-base` 页面，不向官方布局写入业务逻辑。
- 这是产品分支维护的最小上游补丁，必须记录在 patch ledger；上游升级时单独重放和验证。

## Agent 绑定

正式目标配置位于 `agent.cordis.yml`：

```yaml
- id: product-knowledge-context
  name: '@deepseek-ai/dsh-product-knowledge-context'
  config:
    bindings:
      - role: primary
        ref: legal-enforcement
        revision: latest
        required: true
```

`ref` 是稳定 alias，不是数据库路径。绑定优先级为 Session 临时绑定 > Preset 默认 > Workspace 默认 > 未配置；required 绑定缺失时明确失败。首轮实现先交付插件配置绑定，Session/Workspace 覆盖和持久解析记录列为后续任务。

## 数据与安全

- 默认数据目录由 Product Bundle 传入 Runtime，代码和配置不保存用户文档。
- SQLite 使用事务写入；文档正文不写 Session 日志。
- 原始上传内容只保存在产品知识库 SQLite 中，不进入浏览器回读、Session 日志或备份；浏览器通过 Typert Remote 传输 base64，单文件上限 20 MiB，Host 以原始字节 SHA-256 在同一知识库内去重。
- PDF 与 DOCX 解析失败时明确标记 `failed`；重新处理复用本地原始字节，不要求用户重复上传。
- 删除知识库必须显式调用删除操作；归档与删除语义分离。
- 归档知识库保持可读和可备份，但拒绝导入与删除文档等内容写入；重新启用后才允许继续维护。
- 逻辑备份恢复在写入前校验 schema、alias、文档大小和 SHA-256；alias 冲突明确失败，不提供隐式覆盖。
- 工具返回有界文本，禁止整库注入；每条命中包含知识库、文档、位置、revision 和内容哈希。

## 范围

首轮必须闭环：

- SQLite schema、知识库创建/列举、Markdown 导入、分段、全文检索和来源读取。
- 三个 Agent 工具。
- 原生 Knowledge Base Center 入口、知识库/文档/检索 UI。
- Product Bundle 与专用 Profile 装配。
- Preset 扩展骨架，但不迁移 Studio 七套内置 Preset。

`0.1.0-dev.4` 增量：逻辑备份/恢复、归档/启用/删除、文档删除、Wiki 编译浏览、可追溯图谱、本地检索问答、确定性评估和完整管理 UI。

`0.1.0-dev.5` 增量：迁移 Studio 已真实实现的 PDF、DOCX、Markdown、TXT 文件导入能力；增加原文件哈希去重、处理事实状态、失败诊断、重新处理和文档详情。保留粘贴 Markdown 快速路径。文件解析直接进入当前权威 SQLite/FTS/Wiki 投影，不引入 Studio 的 Fastify、Next.js、独立端口或原文件目录拓扑。

`0.1.0-dev.6` 增量：完善编译式 Wiki 清单；以 Studio 的加权词法检索、中文二元词和引用验证为参考，在当前 SQLite 候选召回后确定性重排证据。ASCII/数字词继续由 FTS5 召回；由于 `unicode61` 不会对连续汉字按二元词切分，中文短语与二元词由参数化、有界的 SQLite 子串查询补足候选，不允许退化为无界全表扫描。增加显式可选的生成式 RAG，直接复用 Harness `ctx.llm` 与 `agentDefaultModel.currentSelection()`，不新增 API Key、HTTP 客户端或模型配置来源。默认本地模式和评估路径保持确定性；生成失败安全降级。Studio 当前未实现向量嵌入，本增量不把词法检索表述为向量语义检索，也不引入持久向量索引。

`0.1.0-dev.7` 增量：单独闭环经代码审计确认的四项 Studio 迁移差距。增强图谱扩展页面、来源、主题、页面类型和章节实体及六类关系，提供确定性聚类视图、结构视图、类型与关系筛选、搜索、一跳聚焦和来源详情；不把可视化依赖提升为数据权威。问答新增 Typert 流式 Remote 帧协议，逐段输出模型文本，完成帧统一携带经引用校验的最终答案；取消、超时、模型错误和非法引用继续遵守本地安全降级契约。模型设置通过官方 Settings section 持久化 provider/model 与生成参数，空路由继续跟随 Harness 当前默认模型；模型目录和凭据仍由官方 LLM 设置所有，知识库不得保存或回显 API Key。高级评估在同一知识库 revision 上串行比较 baseline 与 optimized 检索 Profile，以七维指标、逐例隔离、不适用项跳过和回归判定替代简单的三率报告。

`0.1.0-dev.8` 增量：把知识库中心重构为 Harness 原生知识工作区。全局 Harness 侧栏和 `main.page` 外壳保持唯一，知识库内部使用知识库上下文条和横向二级导航。工作台展示真实文档、分段、修订与处理队列数据；文档中心把导入、筛选、处理详情和提取预览组织为主从布局；Wiki 使用可搜索、按类型筛选的编译目录与源证据正文阅读区；问答把流式回答和引用证据并排呈现。知识库创建、恢复和切换集中在管理对话框。界面只使用 Harness 主题变量和本包本地化字典，不复制 Studio 的独立 App Shell、Tailwind 样式、路由或演示数据。

本增量不进入 Plugin Center，不复制 Studio Fastify/Next.js 运行时、Demo 语料、硬编码 Flash/Pro 型号、浏览器 localStorage 配置或独立 API Key；不增加向量嵌入、OCR、XLSX/HTML、模型实体抽取或 LLM-as-judge。加权词法检索是 Wiki 默认权威检索路径；Embedding 与向量索引不是知识编译或 Wiki 可用性的前置条件，只有真实垂域召回评估证明存在稳定收益时才允许建立独立的可选增强 Feature。Session/Workspace 绑定覆盖仍属后续独立任务。

## 验收标准

- `0.1.0-dev.9`：管理文字 14px、区域标题 16px，Wiki 与问答正文复用 Harness 内容字号；问答使用消息列表、底部输入框和逐条可展开的证据，保留流式取消及错误状态。会话记录仅保留在当前知识库界面，每个问题仍独立检索，不声明多轮上下文记忆。
- 文档导入、重新处理或删除后，再次进入 Wiki 或图谱必须读取当前修订；导入前曾打开空图谱不得导致导入后持续显示修订 0。空数据和筛选无结果均提供明确提示，图谱提供刷新入口，并说明现阶段为结构关系图而非模型实体/因果关系抽取。
- 从专用 Profile 启动后可打开知识库中心并完成“创建 → 导入 Markdown → 检索 → 查看来源”闭环。
- `knowledge_search` 对相同数据返回稳定、有限、带证据的结果；`knowledge_read` 只能读取指定来源；`knowledge_sources` 可列举当前绑定的来源。
- Runtime 重启后知识库仍存在。
- Wiki 页面与图谱对相同 revision 返回稳定结果，页面章节和图元素均可定位到来源文档。
- 本地问答只组织检索证据；AI 问答优先使用证据，未命中时可提供无引用且明确标注的模型通用回答。模型兜底不计为检索成功。相同确定性评估用例与 revision 返回相同指标。
- 备份可恢复为内容哈希一致的新知识库；损坏备份、alias 冲突和哈希不一致不得产生部分写入。
- 归档知识库拒绝内容写入；删除知识库必须提交完全匹配的 alias，删除文档后其 FTS 记录同步清除。
- 专用 Profile 中所有知识库标签均有真实功能，不再显示延期占位页。
- 未配置或 required alias 不存在时，Agent 工具返回明确错误，不静默退化。
- 产品代码全部位于 `packages/product/`；官方代码只包含已登记的 `main.page` 最小补丁。
- PDF、DOCX、Markdown、TXT 上传均产生可检索正文；相同原始文件在同一知识库中幂等去重，损坏文件留下 `failed` 状态且不污染 FTS。
- 文档详情展示格式、大小、原文件哈希、提取字符数、处理状态和错误；失败文档可重新处理，成功后修订号只增加一次。
- 备份继续只包含规范化正文和元数据，不复制原始二进制；恢复结果可检索且内容哈希一致。
- Wiki 清单对相同 revision 返回稳定的页面类型、主题、来源证据、显式链接和内容哈希；清单不成为第二权威数据源。
- 加权检索对 ASCII 词和中文二元词返回稳定排序；中文补充候选必须使用参数化查询和候选上限，命中证据仍可回到原文行号和哈希；不得把该能力标记为向量检索。
- 界面默认 AI 回答，沿用 Wiki Settings 或 Harness 默认模型；本地模式保留为无凭据路径。AI 模式支持中文辅助英文查询和显式通用兜底；细则及稳定版验收见[学术质量增量](academic-quality.md)。
- 发送给模型的完整证据数组（包含编号、来源、行号和正文，经 JSON 序列化后）不得超过 `maxEvidenceChars`；引用校验只能接受实际随本次请求发送的证据编号。
- 证据模型回答只能引用本次实际发送的 `[n]` 编号。缺失或非法引用按[学术质量契约](academic-quality.md)最多修复一次；无证据的 `model-general` 不得携带编号引用或证据置信度。模型错误或超时返回 `model-failed` 与明确失败提示，证据单独保留，不以抽取段落充当 AI 回答；显式本地模式不受影响。
- 问答界面明确展示请求模式、实际模式、provider、model、耗时、token 用量和降级原因；不得回显凭据或底层敏感错误。
- 图谱返回的页面、来源、主题、页面类型和章节计数必须由当前 revision 的真实 Wiki 投影计算；两种视图共享同一数据，类型/关系筛选、搜索、一跳聚焦和来源详情不制造额外节点或边。
- AI 模式的证据回答和无证据通用回答都产生模型增量；每次流以一个终态帧结束，终态必须通过对应引用规则。同库切换标签页继续生成；显式取消、切换知识库或知识库页面卸载必须中止旧请求，旧流不得覆盖新结果；运行时拒绝重复提交。详见[跨标签页问答生命周期](qa-tab-lifecycle.md)。
- 当前增量取代早期独立单轮边界：支持页面内多轮追问与长历史摘要，历史不作为论文证据；输出预算默认继承模型路由，移除 Wiki 固定上限但保留真实模型容量和输入检查。详见[多轮追问与模型预算](conversation-context.md)。
- 知识库模型设置必须通过官方 Settings 服务持久化，并仅引用已配置的 Harness provider/model。空 provider/model 使用当前默认模型；参数在 Host 端校验，显式连通测试使用最小、无工具调用且不泄露底层凭据。
- 高级评估必须在同一 revision、相同用例和串行顺序下运行 baseline/optimized；七个指标的 `null` 项不进入分母，单例失败不得终止整批，报告必须指出总分变化、各维变化和是否存在回归。
- 知识库页面不得嵌套第二套全局侧栏；工作台、文档、Wiki 和问答布局在 Harness 明暗主题及窄窗口下保持可用，所有可见文本和可访问名称来自本包本地化字典。
- 知识库管理对话框可以创建、恢复和切换知识库；关闭对话框不改变当前知识库。工作台与文档统计只能来自 Remote 返回的真实数据，不得填充 Studio 演示指标。

## 版本

- 产品开发版本：`0.1.0-dev.9`
- Harness 基线：`0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`
- Studio 参考：`c403d45d63866e65452fdaf680519fdeaee7d3ad`
