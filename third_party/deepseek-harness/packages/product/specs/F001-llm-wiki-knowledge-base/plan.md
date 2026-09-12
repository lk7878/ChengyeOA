# F001 Implementation Plan

## 切片 1：契约与持久化闭环

- 定义知识库、文档、分段、检索证据和绑定契约。
- 以 `node:sqlite` 实现本地 Runtime，建立 schema、事务导入和全文检索。
- 将 Studio 的 Markdown 分段和来源证据思想适配到当前模型，不复制其 Fastify/Next.js 路由。

## 切片 2：Agent 消费闭环

- 建立 knowledge-context Consumer，通过稳定 alias 解析绑定。
- 注册 `knowledge_search`、`knowledge_read`、`knowledge_sources`。
- 验证 required 缺失、结果上限、来源定位与重启持久化。

## 切片 3：原生 Client 闭环

- 在 `ui-layout` 增加通用 `main.page` keyed Slot 与 `ctx.layout` 页面动作。
- 建立知识库 Client 插件，通过 Remote 获取状态并完成创建、导入与搜索。
- 复用当前主题、Slots、Locale 和 UI Primitive 规则，重写 Studio 页面壳。

## 切片 4：正式装配

- Product Bundle 配置 Runtime、Context 与 Client 插件。
- 通过官方 `dsh plugin --profile product add` 流程创建专用 Profile，并按 `base → web-app → product-bundle` 顺序组合；不手写用户 Profile manifest，也不把 `--patch` 作为正式启动方式。
- 提供专用 Profile 安装说明和隔离目录下的可重复组合验证；验证不得改写用户现有 `$DSH_HOME`。
- 建立 `product-presets/` 模板骨架，不加入 Studio 内置 Preset。

## 切片 5：Wiki 与图谱投影

- 从 SQLite 中的文档和分段确定性生成 Wiki 页面、章节和来源定位，不维护第二份正文。
- 从页面、章节与显式 Wiki 链接派生有界图谱，以产品原生 SVG 呈现并保留来源定位。

## 切片 6：检索问答与评估

- 复用现有 FTS 检索，以证据片段组织本地回答；无证据时不生成回答。
- 对调用方提供的问答用例计算回答率、引用率和预期词覆盖率，并返回逐例证据。

## 切片 7：生命周期与恢复

- 提供归档、重新启用、删除文档和 alias 二次确认删除知识库操作。
- 提供带 schema 和内容哈希的逻辑 JSON 备份；恢复先完整校验，再以单事务创建新知识库。

## 切片 8：完整管理 UI

- 将 Wiki、图谱、问答、评估和设置标签接入真实 Remote 操作。
- 对危险操作显示明确状态和确认字段；备份通过浏览器下载，恢复通过本地 JSON 文件导入。

## 切片 9：多格式资料处理

- 新增浏览器安全的文件导入契约，以 base64 承载不超过 20 MiB 的 PDF、DOCX、Markdown 和 TXT 原始字节。
- 在产品包内建立解析适配层；Markdown/TXT 使用本地文本规范化，PDF/DOCX 复用经过验证的解析库。
- 扩展 SQLite 文档记录，保存格式、原文件哈希、大小、状态、进度、错误、提取字符数和仅供本地重新处理的原始字节。
- 对同一知识库内相同原文件哈希执行幂等去重；解析失败不写 FTS，重新处理成功后原子替换正文、分段与索引。
- 在文档管理页增加文件上传、处理状态、失败诊断、详情和重新处理，保留粘贴 Markdown 路径。
- 备份格式升级时向后兼容 v1；逻辑备份不携带原始二进制。

## 切片 10：编译清单、加权检索与可选生成式 RAG

- 将 Wiki 返回值扩展为按当前 revision 即时编译的 manifest，补充编译时间、内容哈希、页面类型、主题、来源证据、显式链接和统计；不持久化第二份正文或缓存。
- 保留 SQLite FTS 作为 ASCII/数字词的有界候选召回；针对 `unicode61` 不切分连续汉字的限制，以参数化且有候选上限的 SQLite 子串查询召回中文短语/二元词。合并去重后，以标题、章节、正文、文件名和中文二元词执行确定性加权重排与文档多样性约束；所有权重与上限由产品 Runtime 配置校验。
- 将问答请求分为 `local` 与显式 `model` 两种模式。模型模式读取 Harness 当前默认模型，通过 `ctx.llm.stream()` 执行一次有界、无工具的一次性调用。
- 仅把有编号的检索证据置入模型上下文，并声明资料内容不可信；校验输出至少包含一个合法 `[n]` 引用且不存在越界引用。
- 模型不可用、超时、流结束异常、无文本或引用无效时返回本地降级答案；无证据时不调用模型。
- 生成配置必须能通过 Typert Remote 的可追踪控制器视图读取，不使用与代理调用不兼容的 JavaScript `#private` 字段；用代理方式调用控制器问答方法覆盖这一集成边界。
- UI 展示请求模式、实际模式、模型路由、耗时、token 用量和降级原因；评估继续固定走本地模式，保证跨运行可复现。
- 使用假 LLM 流覆盖成功、引用失败、适配器失败、超时和无证据不调用模型；再通过专用 Profile 验证本地模式与无凭据降级路径。

## 切片 11：Studio 增强能力迁移闭环

- 扩展图谱投影为页面、来源、主题、页面类型和章节五类节点，以及内链、来源、主题、类型、包含和顺序六类关系；节点标识、类型顺序、布局种子和边权重保持确定性。
- 在同一原生知识库页面提供聚类关系视图与结构视图。两种视图复用同一 Remote 数据，支持节点类型、关系类型、文本搜索、一跳聚焦、复位和来源详情；可视化层不持久化第二份图谱。
- 新增 `askStream` Typert stream Remote，以 `start`、`delta`、`complete` 三类帧承载检索摘要、文本增量和最终已验证答案。保留 unary `ask` 兼容 Agent/测试调用，并由相同生成管道收集终态。
- 将调用方取消、页面卸载、超时与模型端异常贯穿到 `ctx.llm.stream()`；只有调用方取消抛出中止，其他模型失败返回本地降级完成帧。
- 注册知识库专属 Settings section，持久化可选 provider/model、temperature、max output tokens、evidence budget 与 timeout。空路由读取 `agentDefaultModel.currentSelection()`；显式路由必须经过官方 LLM 目录解析。
- 在知识库设置页读取和更新该 section，并提供显式的最小模型连通测试。凭据、provider 编辑和模型增删继续由官方 Models 设置负责。
- 将评估用例扩展为状态、期望文档/页面、期望词和题型契约；在固定 revision 上依次运行无文档多样性 baseline 与当前 weighted/diversity optimized Profile。
- 以 `answer_completed`、`retrieval_hit`、`evidence_coverage`、`citation_valid`、`answer_faithful`、`no_answer_honest`、`input_robust` 七维评分聚合报告；`null` 跳过，逐例捕获错误，并输出 baseline/optimized 总分、维度差异和回归状态。
- 补充 Host、RAG 流、图谱适配、设置持久化、评估比较和 Client 中止竞态测试；更新双语 README、Agent Note、Feature Map 与产品版本映射，并在正式 Product Profile 完成真实桌面/浏览器闭环。

## 切片 12：Harness 原生知识工作区 UI

- 保留 Harness 全局侧栏、主题和 `main.page` 页面机制，在知识库内部建立知识库上下文条与横向二级导航，不复制 Studio 的独立应用外壳。
- 以 Studio 的信息架构为参考，将概览重组为真实指标、混合检索和最近资料工作台，将创建、恢复与切换集中到知识库管理对话框。
- 将文档中心组织为导入区、可筛选资料列表和处理详情主从布局；保留多格式导入、Markdown 快速路径、失败重试与提取预览。
- 将 Wiki 组织为可搜索、按页面类型筛选的编译目录和正文阅读区；将问答组织为问题编辑器、流式回答与常驻引用证据区。
- 所有颜色、边框、背景与交互态使用 `--dsw-alias-*` 主题变量；所有可见文本和可访问名称通过 `product.knowledge` 本地化字典提供。
- 以 Client 行为测试、Client 类型检查和正式 Product Desktop 构建验证管理对话框、导航、导入、Wiki 阅读、问答证据与窄窗口布局。

## 迁移原则

切片 13 对齐 Harness 的 14px 管理文字与内容字号变量；使用既有 Markdown 组件呈现消息流，将证据与诊断收进逐条回答。Wiki/图谱每次进入重新读取当前投影，覆盖先看空图再导入文件的回归路径；不新增语义实体抽取或持久多轮会话协议。

- 先复用当前官方能力，再适配 Studio 算法，最后才新增上游扩展缝。
- 每个切片分别验证 Runtime、工具和真实 UI 路径。
- 图谱保持产品原生投影和确定性布局；实现可迁移 Studio 交互语义，但不以特定可视化库作为协议或持久化依赖。
- Studio 当前检索器不是向量索引；本切片迁移其可验证的加权词法与引用约束思想，向量检索必须由后续独立 Spec 和召回评估驱动。
- 代码提交后回填 Feature Map 和产品版本映射中的实现 SHA。
