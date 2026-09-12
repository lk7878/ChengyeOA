# 产品治理与规范

本目录是 DeepSeek Harness 二次开发 Spec、治理决策和产品版本记录的唯一维护入口。官方 Harness 是唯一代码基线；Studio 只作为设计和能力迁移参考。Harness 原生文档、测试 Spec 和其他上游规范保持原位置，不属于本目录。

## 入口

- [Product Spec](product-spec.md)：产品目标和产品级边界。
- [Feature Map](feature-map.md)：稳定 Feature ID、状态和实现提交索引。
- [二次开发治理](governance/secondary-development.md)、[架构所有权](governance/architecture-ownership.md)和[交付验证](governance/delivery-validation.md)。
- [官方基线](baseline/upstream.yml)、[集成记录](baseline/integration-history.md)和[产品版本映射](releases/product-version.md)。
- [Studio 能力清单](migration/studio-capability-map.md)和[上游修改台账](migration/upstream-patch-ledger.md)。

## Feature

| ID | 能力 | Spec | 计划 | 任务 |
|---|---|---|---|---|
| F001 | LLM Wiki 原生知识库 | [Spec](F001-llm-wiki-knowledge-base/spec.md) | [计划](F001-llm-wiki-knowledge-base/plan.md) | [任务](F001-llm-wiki-knowledge-base/tasks.md) |
| F002 | 最小 Windows Desktop Host | [Spec](F002-minimal-windows-desktop-host/spec.md) | [计划](F002-minimal-windows-desktop-host/plan.md) | [任务](F002-minimal-windows-desktop-host/tasks.md) |
| F003 | PaddleOCR 本地文档解析 | [Spec](F003-local-paddleocr-document-ingestion/spec.md) | [计划](F003-local-paddleocr-document-ingestion/plan.md) | [任务](F003-local-paddleocr-document-ingestion/tasks.md) |
| F004 | XLSX/HTML 本地资料导入 | [Spec](F004-xlsx-html-document-ingestion/spec.md) | [计划](F004-xlsx-html-document-ingestion/plan.md) | [任务](F004-xlsx-html-document-ingestion/tasks.md) |
| F005 | 本地混合检索 | [Spec](F005-local-hybrid-retrieval/spec.md) | [计划](F005-local-hybrid-retrieval/plan.md) | [任务](F005-local-hybrid-retrieval/tasks.md) |

Feature 文档使用稳定的 Feature ID，并在实现记录中关联代码提交 SHA。所有新增二开 Spec 必须直接写入本目录；不得在 Harness 原生 `docs/`、上游包或独立 Spec 仓库建立第二份可修改副本。未经评估的 Studio 代码不得直接复制到产品代码中。
