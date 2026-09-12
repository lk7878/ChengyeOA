---
description: "让 Agent 通过 Preset 绑定，以有界且带来源证据的方式访问产品知识库。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-knowledge-context

[English](README.md) | 中文

## 概述

该包把显式 Preset 绑定转换为三个 Agent 工具：`knowledge_search`、`knowledge_read` 和 `knowledge_sources`。它在执行时解析稳定知识库别名，明确拒绝缺失的必需绑定和修订不一致，并且绝不把整个知识库注入提示词。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Preset 的 `agent.cordis.yml` 中挂载，不在 Product Bundle 中全局挂载。每个 `binding` 声明 `role`、稳定 `ref`、可选修订号和 `required`。绑定缺失时工具故障关闭，而不是在没有知识依据的情况下静默回答。

<a id="understand-the-implementation"></a>
## 理解实现

每次调用先依据 `ctx.knowledgeBases` 解析配置绑定。检索复用 Wiki AI 问答的证据准备：配置的词法/混合检索、编译页导航、文档内原文补查、查询扩展和相关性筛选。初始候选数量默认为八；导航可在 Wiki 证据预算内保留互补引文。读取最多返回 200 行来源文本；来源列表只返回元数据，不返回文档正文。

检索拒绝取消、绑定或修订变化，以及完整渲染 JSON 超过 `maxResultChars`（默认 64000）的结果。来源哈希和行号定位原始片段；`excerptTruncated` 标明正文截断。多个 Preset 可以绑定同一库，无需复制来源、编译成果或索引。参见[检索对齐决策](../specs/F001-llm-wiki-knowledge-base/preset-retrieval-parity.md)。

<a id="model-experience"></a>
## 模型体验

### 知识检索工具与结果

#### 模型看到什么

模型获得 `knowledge_search`、`knowledge_read` 和 `knowledge_sources` schema。调用和富含证据的 JSON 结果保留在会话历史中；结果携带稳定别名、修订号、文档 id、有界行位置、检索降级和导航需求。派生导航上下文不属于原文证据。当前 Harness Agent 综合最终答案；工具不额外发起最终回答请求。

#### Token 影响

Preset 启用时，三个 schema 增加少量固定开销。调用和有界结果在压缩前增加依赖数据的后缀 token。导航、扩展和筛选可按 Wiki 设置及编译路由发起有界模型调用，并记录在官方诊断会话中。检索不会编译论文、运行 OCR 或发送图片。

#### KV Cache 影响

Preset 绑定与工具定义不变时前缀稳定；检索内容仅追加在可复用前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- F001 只实现 Preset 级绑定；会话临时覆盖和工作区默认值的优先级延期。
- 绑定属于配置而非权限边界；部署策略仍须控制谁可编辑 Preset。
- Agent 使用自身会话上下文提供独立问题。该检索工具不执行 Wiki 会话压缩及最终答案修复。

<a id="dev-note"></a>
### 开发备注

业务绑定放在 `agent.cordis.yml`；`preset.yml` 只保存展示元数据。
