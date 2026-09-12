# Product Spec

## 产品目标

在当前官方 DeepSeek Harness 基线上形成可持续升级的本地产品发行版。首个产品闭环是原生 LLM Wiki 知识库：用户可维护独立、持久、可复用的知识库，并让 Agent 以可追溯的检索工具使用其内容。

## 目标用户与核心场景

- 需要在本地管理垂域资料并通过 Agent 复用的个人或团队。
- 需要查看来源、版本和命中位置，而不是把整库内容无差别注入上下文的专业用户。

## 产品边界

- 官方 DeepSeek Harness 是唯一代码基线。
- Studio 是能力设计与实现参考，不是产品运行依赖。
- 自定义产品能力集中在 `packages/product/`，桌面交付代码集中在 `apps/product-desktop/`。
- 二开 Spec、治理规则、迁移记录和产品版本映射集中在 `packages/product/specs/`；Harness 原生规范保持上游位置和内容。
- 知识库独立于 Session 和 Workspace；Session 只解析并记录所使用的知识库与修订版本。
- Studio 的七套内置 Preset 不在当前迁移范围；产品只提供可扩展 Preset 骨架。

## 产品级验收标准

- 在专用 Profile 中可以打开原生“知识库中心”，不依赖独立 Next.js 应用。
- 可以创建知识库、导入 Markdown 文档、查看索引状态并检索内容。
- Agent 只能通过 `knowledge_search`、`knowledge_read`、`knowledge_sources` 按需读取，结果携带知识库、来源文档、位置和版本。
- 正式装配来自 Product Bundle；`--patch` 仅用于开发和临时验证。
