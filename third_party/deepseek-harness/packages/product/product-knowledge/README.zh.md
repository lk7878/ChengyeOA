---
description: "持久化产品知识库、带证据的检索，以及原生知识库中心。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-knowledge

[English](README.md) | 中文

## 概述

该 Host/Client 包把本地 PDF、DOCX、XLSX、HTML、Markdown 和 TXT 资料转化为可检索、基于源文件证据的知识工作区。Host 规范化源内容，仅对原生文字缺失或质量不足的 PDF 页面使用本地 PaddleOCR PP-OCRv5，并在 SQLite 中保存处理证据、确定性分块、修订号和 SHA-256 哈希。Harness 原生 Client 提供真实数据工作台、文档处理工作区、编译式 Wiki 阅读器、图谱、每条回答附带证据的流式对话和设置；Typert Remote 向 Client 提供有界操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在文档列表勾选已解析资料，确认外发授权后启动批量编译。页面逐篇调用普通编译，有效成果不调用模型直接复用，逐篇显示进度和失败原因，单篇失败后继续处理后续文件。取消或关闭页面会取消当前请求并跳过未开始文档；完成的成果与待处理队列持久化，可显式继续并复用已经校验的提取断点。新增视觉识别和强制重编译仍在单篇入口显式操作。详见[批量编译 Spec](../specs/F001-llm-wiki-knowledge-base/batch-compilation.md)。

默认 SQLite 数据库将原始上传字节保存在 `documents.raw_content`，解析文本保存在 `documents.content`，检索分块/索引保存在各自表中，编译成果、视觉文本和核验记录保存在 `document_compilations.payload`。这些是数据库记录，不是逐篇 Markdown 文件。Profile 配置不包含知识数据；使用同一 Harness home 的 Profile 共享默认数据库，除非显式修改 `databasePath`。逻辑 JSON 备份不包含原始二进制文件。完整压缩备份包含原始文件、视觉图像、对话、待处理任务、断点和主题，详见[可靠性契约](../specs/F001-llm-wiki-knowledge-base/reliability.md)。

原生 PDF 文本质量评分忽略独立装饰分隔线，但不改写提取证据；空页和乱码仍需 OCR。文档不存在时关闭旧详情并刷新列表。编译进度按校验完成的批次更新，模型调用期间可能数分钟不变；Client 重新打开运行中的编译时继续轮询，刷新失败会明确提示，避免把旧进度伪装为实时状态。详见[恢复 Spec](../specs/F003-local-paddleocr-document-ingestion/native-text-recovery.md)。

文档选择器支持多选，每个文件最多 20 MiB。Client 通过原有单文件接口先保存原始文件，再依次解析，逐项报告结果，单个失败不阻断后续文件，已成功导入的内容保留。停止后续导入只跳过未开始文件，当前 Host 解析仍可能完成。关闭页面停止派发；已上传原始文件及待处理记录保留，重新打开后可以继续。知识编译和在线视觉仍是独立的显式操作。详见[批量导入 Spec](../specs/F001-llm-wiki-knowledge-base/batch-import.md)。

通过 `@deepseek-ai/dsh-product-bundle` 挂载 Host 与 Client 行。数据默认保存在 `$DSH_HOME/product/knowledge/knowledge.db`。创建稳定别名后，可以上传不超过 20 MiB 的 PDF、DOCX、XLSX、HTML、Markdown 或 TXT 文件，也可以直接粘贴 Markdown。浏览器把有界 base64 字节发送给 Host；Host 在本地保留原始字节，记录处理进度和错误，并且只索引成功提取的文本。在同一知识库中重复上传完全相同的字节会解析到已有文档。Product Bundle 默认启用 CPU OCR，使用 `../.runtime/paddleocr/Scripts/python.exe` 和本地模型缓存 `../.runtime/paddleocr-models`，单页超时 300 秒、原生文本阈值 32 字符、渲染宽度 1200 像素和 200 页上限。XLSX 导入最多接受 64 个工作表、全工作簿 100,000 个非空行和单工作表 256 个已用列。Worker 只绑定 `127.0.0.1` 动态端口并使用每次启动的随机凭据；模型问答配置和 OCR 配置完全独立。

检索默认使用 `lexical`。实验性 `hybrid` 模式从 `$DSH_HOME/product/knowledge/embedding-models` 加载固定 revision、显式安装的 `intfloat/multilingual-e5-small` ONNX 模型，正常运行只读本地缓存。它按需建立绑定知识库 revision 的 SQLite 向量，精确扫描最多 50,000 个分块，以确定性排名融合词法和语义候选，并只返回原有持久化分块。模型缺失或故障、构建陈旧、超过扫描上限时会安全返回词法证据。搜索与问答界面会显示实际检索模式、向量索引 revision、语义候选数和降级原因；设置页显示索引状态、source/index revision、覆盖率及模型元数据，并提供重建、取消和清除派生向量操作。高级评测在相同知识库 revision 上比较 baseline、optimized 和 hybrid，报告 Recall@10、MRR@10、查询延迟、七维质量分数及退化状态。混合检索已供搜索、本地回答和流式模型问答使用，但只有代表性论文评测通过 F005 质量门槛后才会考虑从显式选择升级为推荐配置。

归档知识库会使内容只读，修改来源前需重新激活。版本 3 逻辑 JSON 备份包含提取后的 Markdown、来源元数据、编译知识、视觉候选/核验文本及来源记录，不包含原始二进制或凭据。恢复兼容逻辑版本 1–3 和压缩完整版本 4，在单个事务前验证来源哈希与编译事实定位，绝不覆盖已有别名。恢复后的文本仍可检索；重新解析及新增视觉识别需要保留原始字节。存在在途编译时，备份和破坏性 Remote 操作会拒绝执行，须先完成或取消编译。永久删除必须输入完全一致的别名。

在 Wiki 设置中通过 `product-knowledge-compiler` 配置独立编译路由，空配对依次继承 Wiki 问答和 Harness。视觉默认关闭，需显式启用并选择声明支持图片输入的型号，不会暗中继承文本模型。初始资源策略为每批原文 16,000 字符、每次输出 32,000 Token、单次 600 秒、每篇最多 200 次调用、页面渲染宽度 2,000px，总任务安全时限不超过一小时。这些是可配置的运行限制，不是费用审批门槛。输出耗尽错误明确包含推理 Token，可调整编译设置后重试。在文档或 Wiki 中选择资料，确认界面显示的外发范围后，可启动编译或选择 PDF 物理页进行视觉识别。打开页面不会触发推理。

<a id="understand-the-implementation"></a>

问答默认使用已配置 Harness 路由的 AI 回答。未检索到证据时，模型可提供明确标注的通用知识，但不代表已核实论文；无凭据的本地模式仍然可选。中文或空结果问题可触发一次英文辅助查询，并与原始结果融合。`queryExpansionEnabled` 默认 true；`queryExpansionMaxTokens` 默认 1,024，`queryExpansionTimeoutMs` 默认 30,000。改写失败保留原始检索；取消会停止操作。AI 模式下问候不使用检索证据。紧邻中文的来源标识或年份仍可检索，明确指定的来源会补入第一个实质正文段作为上下文。这是来源识别与查询改写，不代表已使用向量或语义图谱检索。

## 理解实现

编译完成与人工核验分别展示。编译面板提供逐项核验入口，支持已核实、保留疑问、不适用、必填备注和保存时间。核验随当前成果及逻辑备份在本地保存，不调用模型、不消耗 Token，也不改变原文证据或编译知识。成功生成新成果时重置核验结论；普通复用、失败和取消保留结论。版本已替换、过期或正在运行时拒绝核验写入。缺口保留编译时原文，包括历史视觉核验提醒；保存结论并不修正其涉及的学术论断。

`src/compiler.ts` 从每个连续原文批次提取带准确引文的事实，再综合成原文语言论文页。PDF 换行引起的纯空白差异会回定位到原文真实字符。覆盖偏移、来源及引文哈希、行号或物理页位置、模型、调用次数和 Token 用量保存在既有 SQLite 中。引用编号和数字检查拒绝无法支持的输出；基础中英文检查拒绝不必要的全量翻译，但这些检查不能证明语义蕴含。每次请求在剩余调用上限内最多重试一次传输失败，未计量的失败调用使总用量记为未知。编译事实帮助检索定位原文引文或明确标识的人工核验视觉文本，生成式导航上下文始终标为派生产物。

视觉识别通过既有解析器渲染所选 PDF 页，调用模型前先用官方附件服务持久化图片，并进入正式调用日志。界面保留识别候选、不确定项、页码与图像来源，以及修正表单。只有人工核验且没有未解决问题的候选进入编译。不可变视觉快照让旧知识在重新识别后仍能追溯。普通编译复用有效成果，不调用模型；纳入新增核验页或设置变更须显式强制重编译，界面提示 Token 消耗。缓存标识记录原始输入，不要求自动更新。来源变化或人工修正已被成果采用的视觉页时，旧成果不进入默认问答；历史过期状态只有通过来源定位校验才恢复。失败或取消保留上一版知识。跨论文主题预览比较所选原文片段并保留人工备注；语义正确性仍需独立复核。

Wiki 论文导读提供可识别的摘要、方法、结果、讨论/局限与结论标题下的原文摘录，保留来源行号和哈希。概览问题在已检索文档中使用这些范围，并补充普通段落。导读不消耗 LLM token、无需重新导入，未识别的章节会省略；它不是生成式语义摘要，也不提供完整表格理解。

AI 未指定数量时默认取八个候选。`evidenceSelectionEnabled` 默认 true，`evidenceSelectionMaxTokens` 默认 2,048，`evidenceSelectionTimeoutMs` 默认 30,000。在已有路由上额外执行一次请求，筛选证据预算内的摘录、重排有效来源编号，并单独报告 token 与耗时。全部候选被拒绝时启用有标识的通用知识；输出非法或供应商失败时保留原始证据并报告诊断。筛选检查相关性，不检查最终论断的蕴含关系。

`answerRepairEnabled` 默认 true，`answerRepairMaxTokens` 默认 2,048。引用缺失、越界、合并编号，或中文问题得到完全不含中文的回答时，最多在同一证据上执行一次结构化修复，沿用回答剩余时限。结构化证据不足结果只发布固定提示，不接纳无引用事实论断。失败发布 `model-failed`，不把原文摘录作为回答。证据单独折叠，重试按钮把问题填回输入框。校验检查引用编号、无来源数字及特定语言缺陷，不证明事实蕴含。

Client 使用 14px 界面文字和 16px 区域标题；Wiki 正文与聊天内容跟随 Harness 内容字号。Wiki 和图谱进入时重新读取。问答在底部输入框上方渲染 Markdown，将流式或停止时的文字标为未核验草稿。同一知识库内切换标签页时回答持续生成，其他标签提供返回及停止入口；问答活动与页面加载状态独立。显式停止、切换知识库或关闭知识库界面会取消生成，迟到输出被忽略。模型模式发送当前页面的对话记忆以解析追问，再重新检索原文证据。重新打开时加载持久化问题、终态回答和历史引用；临时摘要按需重建，来源版本变化提示重新复核。Enter 发送，Shift+Enter 换行，输入法组合期间不会发送。

对话记忆包含已完成回答；停止或失败轮次只保留问题。`historyMaxChars` 默认 24,000，`historySummaryChars` 默认 4,000，`historyRecentTurns` 默认四轮。超过有效阈值或达到 100 个未压缩轮次时摘要较早历史，优先保留近期原文；单个近期轮次过大时也可能需要摘要。成功完成后本地提交摘要，压缩失败不静默丢弃历史。已知模型上下文容量可能降低上述预算；UTF-8 字节检查保守地预留输入、输出与协议空间，不冒称精确分词。历史不是论文证据。答案详情展示追问解析、压缩数量、模型预算及额外用量。详见[多轮对话 Spec](../specs/F001-llm-wiki-knowledge-base/conversation-context.md)。

每次 Wiki 模型请求通过官方路由准备及独立 `wiki-` 会话，记录既有请求头、用户消息和流式输出事件。输入刷盘后才调用模型，输出刷盘后释放会话；缺失或失败的持久化会阻止调用。这些日志包含问题与发送的摘录，遵循 Harness 会话保留规则，不随知识库文档删除而清除，也不成为对话上下文或编译知识。

`src/document-import.ts` 负责有界源文件分类、常量栈 Base64 校验、XLSX/HTML 投影、PDF 逐页质量判断、问题页渲染、规范化和源文件哈希。`src/paddleocr-worker.ts` 监管本地 Worker、动态回环端口、随机凭据、请求超时和响应校验；`worker/paddleocr_worker.py` 是低资源 PP-OCRv5 CPU Provider。`src/semantic-retrieval.ts` 负责离线本地 Embedding、向量序列化、余弦评分与排名融合。`src/store.ts` 负责处理状态、SQLite 事务、按标题确定性分块、词法与混合检索、Wiki 清单编译、五类图谱节点与六类关系、本地抽取式回答、成对的确定性评测 Profile、生命周期规则、逻辑备份与证据哈希。

编译知识导航把完整编译章节和事实陈述发送给编译模型，再按至多四个证据需求核查原文。派生页面只指导补查，不作为引用。导航成功时替代查询改写和通用筛选；缺少编译、导航失败或超限时保留原有检索并显示诊断。本地模式和问候跳过导航。该流程最多增加两次有日志的请求，最终回答仍使用 Wiki 问答模型。`knowledgeNavigationEnabled` 默认 true，`knowledgeNavigationMaxInputChars` 默认 160,000，`knowledgeNavigationMaxTokens` 默认每次 8,192，`knowledgeNavigationTimeoutMs` 默认两次共用 120,000ms。完整知识输入超限时回退，不静默丢掉论文。完整原文引文必须符合现有回答证据上限。详情显示逐需求证据编号、缺口、模型、次数、Token 和补查次数；相关性判断不是真实性证明。验收边界见[导航 Spec](../specs/F001-llm-wiki-knowledge-base/knowledge-navigation.md)。

`KnowledgeController.retrieveEvidence` 向已绑定的 Preset 工具开放相同的证据准备，不生成最终答案。它与 AI 问答共享检索设置、编译导航、查询扩展、筛选、取消和证据格式。Preset 根据自身会话上下文提供独立问题，并使用 Agent 模型综合回答；辅助请求保留 Wiki 路由和官方日志。参见[Preset 检索约定](../product-knowledge-context/README.zh.md)。

<a id="further-exploration"></a>
## 进一步探索

评估仅用于开发维护，不再是日常 Wiki 页面。Client 不提供评估标签、表单或调用绑定；Host 的 `evaluate` 保留确定性评分；`evaluateModel` 通过真实 Wiki 回答流程运行独立标注的问题，返回完整答案、时间、召回和留空的人工复核字段。这些检查不衡量 LLM 学术理解或综合回答质量。详见[评估入口收敛 Spec](../specs/F001-llm-wiki-knowledge-base/evaluation-maintenance-only.md)。

- [知识上下文工具](../product-knowledge-context/README.zh.md)——按 Preset 约束的 Agent 访问。
- [产品 Bundle](../product-bundle/README.zh.md)——正式 Profile 组合。
- [产品包地图](../README.zh.md)——所有权与依赖规则。
- [迁移来源记录](PROVENANCE.md)——精确 Studio 参考及明确不迁移的历史实现。

<a id="model-experience"></a>
## 模型体验

### 知识提供方

#### 模型看到什么

本地模式不发送模型请求。AI 模式解析官方 Wiki Settings 路由，两个路由字段均为空时使用 Profile 默认模型。改写只返回查询，不产生证据。生成接收问题及有界来源标签、行号和正文。指令要求按问题语言综合回答，保留研究与版本边界，把证据视为不可信数据并禁用工具。证据回答必须含有效 `[n]` 引用；`model-general` 不含来源引用或证据置信度。修复复用同一证据，要求结构化回答或证据不足结果。取消传递到供应商，输出失败返回明确提示。Agent 工具检索仍独立运行。

#### Token 影响

本地模式与本地 Embedding 不消耗 LLM token。生成使用证据预算（默认 12,000 字符）。输出 Token 默认 `0`，继承模型路由的默认预算；至少 64 的正数手动覆盖，不再受 Wiki 固定 16,384 上限约束。缺少默认元数据时需要显式填写，供应商及上下文限制仍有效；已保存的覆盖值仍优先。有历史时增加一次追问解析，需要压缩时再增加一次摘要调用。改写、筛选与按需修复各最多增加一次有界请求。修复沿用回答时限，但有独立输出上限。辅助调用只在精确模型声明支持时使用 `off`，最终回答保留所选推理强度。详情分别报告适配器提供的各次请求 token 用量；生成耗时包含修复。

#### KV Cache 影响

本地模式没有影响。模型模式的 Wiki 问答采用独立流式请求，不会扩展 Agent Session 的可复用前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 采集接受单个不超过 20 MiB 的 PDF、DOCX、XLSX、UTF-8 HTML、Markdown 和 UTF-8 TXT 文件。XLSX 使用单元格显示文本，不重新计算公式、不执行宏，也不保留图表和数据透视表语义；HTML 解析不执行 JavaScript 或加载远程资源。扫描 PDF 已支持本地页级 OCR，但页级坐标持久化、OCR 缓存、重试 DPI、取消、详细诊断 UI 和无人值守后台处理仍在 F003 后续增量中。当前没有文件爬取、旧式 XLS、定时采集或 multipart 流式传输。
- 检索使用 FTS5 召回 ASCII/数字词，以参数化有界子串查询召回中文短语/二元词，再进行确定性加权词法重排。实验性混合模式增加本地多语言 Embedding、版本化 SQLite 向量索引、有界精确余弦扫描、确定性排名融合和词法降级；它不是 Wiki 编译或可用性的要求。当前 Product Bundle 仍选择 `lexical`；图形化模型安装/导入、BGE-M3 对比和代表性论文验收仍是 F005 后续增量。
- 生成式问答与编译需要已配置的官方路由、凭据和可用会话持久化。引用编号与数字字面值保留不能证明论断受到支持；语言检查覆盖特定中英文缺陷，不覆盖所有混合语言情况。视觉核验按页进行，不提供区域裁剪编辑器或精确曲线数字化；候选页规则可能漏掉复杂布局，因此页码可手动调整。独立的论文质量验收仍须按[学术质量 Spec](../specs/F001-llm-wiki-knowledge-base/academic-quality.md)执行。
- 增强原生 SVG 图谱派生页面、来源、主题、页面类型和章节节点，以及链接、来源、主题、类型、包含和顺序关系；它有意限制为最多 300 个节点和 600 条边，不是大型图分析或模型实体推断引擎。
- 评测对比 baseline、optimized 词法与可选 hybrid Profile 的 Recall@10、MRR@10、查询延迟，以及回答完成、检索命中、证据覆盖、引用有效、答案忠实、诚实无答案和输入稳健性七个维度；它是确定性评测，不是 LLM-as-judge 或语义质量基准。
- 逻辑备份不包含原始文件；完整压缩备份包含原始文件并执行对称的容量与哈希校验。两者均不是增量备份系统。

<a id="dev-note"></a>
### 开发备注

这是适配当前官方 Harness 基线的产品自有代码，不以 DeepSeek Harness Studio 为运行时依赖。
