# Agent Note: 让 Wiki 工作区原生融入 Harness 应用外壳

Status: implemented

[English](2026-09-05-harness-native-wiki-workspace-ui.md) | 中文

## Problem

产品 Wiki 需要 Studio 展示的任务型导航和高密度知识视图，但不能在 Harness 内嵌第二套应用外壳。复制 Studio 的侧栏、路由、硬编码主题或演示指标会与 Harness 导航竞争，并对参考应用形成视觉和运行时依赖。

## Decision

产品知识库 Client 保留 Harness 全局侧栏和 keyed `main.page` 作为唯一应用外壳。Wiki 页面使用知识库上下文条和横向导航连接工作台、文档、Wiki、图谱、问答和设置。

Studio 只提供信息架构参考。工作台使用 Remote 返回的文档、分段、修订和处理事实；文档中心组合源文件导入、筛选与处理详情；Wiki 组合可搜索的分类目录和基于源文件证据的阅读区；问答采用消息列表、底部输入框和逐条可展开的引用证据。知识库创建、恢复和切换集中在一个管理对话框中，不占用永久嵌套侧栏。

Client 使用 `--dsw-alias-*` 主题变量、14px 界面文字、16px 区域标题、Harness 内容字号变量及 Markdown 组件，以及类型化 `product.knowledge` 本地化字典。Wiki 和图谱每次进入标签都重新加载，避免修订 0 的空结果遮蔽后续导入。Studio 的 Tailwind 样式、路由、独立应用外壳、渐变、玻璃效果和演示数值不作为运行时输入。

## Alternatives considered

**复制 Studio AppShell 和侧栏** — 不采用，因为 Harness 已负责全局导航、响应式行为和页面生命周期。嵌套应用框架会重复这些职责并缩小可用空间。

**保留永久知识库管理栏** — 不采用，因为创建和恢复属于低频操作，阅读、检索和证据检查更需要完整页面宽度。

**原样移植 Studio 视觉样式** — 不采用，因为硬编码深色配色和效果不能跟随 Harness 明暗主题，还会增加不必要的归属说明和维护工作。

## Consequences

用户获得遵循 Harness 主题和导航行为的知识专用布局，同时保留 Studio 有价值的视图组织。工作区不依赖 Studio 包或虚构工作台数据。知识库打开后，管理操作需要额外进入一次对话框。聊天消息切页保留，并按[持久证据决策](2026-09-10-wiki-durable-evidence.zh.md)在重新打开时读取终态快照；每次请求独立检索证据。图谱节点表达来源结构，不表达推断出的实体或因果关系。

## Verification

Client 行为测试覆盖工作区选择、管理对话框、资料导入、带证据检索、全部导航目标、流式回答取消、提问与失败记录保留、PDF 导入后图谱刷新和生命周期操作。只读取得用户论文已解析正文后，内存数据库生成了 29 个图谱节点和 52 条边。Client 类型检查、Product Profile 浏览器检查与 Product Desktop 构建验证集成。
