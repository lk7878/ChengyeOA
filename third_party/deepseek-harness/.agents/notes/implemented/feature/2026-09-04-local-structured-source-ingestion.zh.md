# Agent Note: 保持结构化资料导入与语义检索相互独立

Status: implemented

[English](2026-09-04-local-structured-source-ingestion.md) | 中文

## Problem

产品 Wiki 需要编译本地提供的电子表格和 HTML 文档。如果把这些输入格式归入 Embedding 项目，基础导入就会依赖另一个模型、索引生命周期、存储格式和评测体系，而现有词法路径已经能够编译并引用规范化 Markdown。

## Decision

产品知识包把 XLSX 和 UTF-8 HTML 分类为本地文档类型，在现有持久化、分段、词法检索、Wiki 编译、引用与备份操作之前转换为有界 Markdown。该行为由 [F004](../../../../packages/product/specs/F004-xlsx-html-document-ingestion/spec.md) 负责。

XLSX 工作表转换为二级标题和保留来源行号、单元格显示文本的 Markdown 表格。产品配置限制工作表数量、非空行总数和单工作表已用列数。解析器不重新计算公式，也不执行宏。

HTML 转换保留可见文档文本，并跳过脚本、样式、无脚本回退和导航区域。它不创建浏览器、不执行 JavaScript，也不加载远程资源。

加权词法检索继续作为权威默认路径。Embedding 与向量索引属于可选增强，必须由独立 Feature 和特定语料召回证据驱动；它们不是资料导入、Wiki 编译或产品可用性的前置条件。

## Alternatives considered

**要求新格式使用向量检索**——不采用，因为源文件解析器与检索索引解决的是相互独立的问题；在没有证明编译或引用收益的情况下，该依赖会增加模型和索引运维。

**自行实现 XLSX ZIP/XML 和 HTML 解析**——不采用，因为维护中的本地依赖减少了产品需要自行维护的格式解析代码与测试。

**在无头浏览器中执行 HTML**——不采用，因为本地文件不需要活动页面行为，而执行脚本或加载远程资源会扩大安全与隐私风险。

## Consequences

用户可以通过同一个本地知识流程导入电子表格和保存的 HTML 页面，不产生模型 Token 或远程解析流量。XLSX 图表、数据透视表、宏和公式计算语义不在范围内；JavaScript 渲染的页面内容必须保存为静态 HTML，或改用其他支持格式提供。以后仍可加入语义检索，而无需改变导入契约。

## Verification

产品知识测试覆盖可检索的 XLSX 工作表内容、来源行投影、工作表限制、可检索的 HTML 正文，以及脚本和导航文字排除。Host 类型检查和 Product Profile 组合验证配置限制与包依赖关系。
