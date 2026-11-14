---
description: "产品自有的 DeepSeek Harness 扩展、组合方式与依赖规则。"
kind: "package-group"
---

# 产品包

[English](README.md) | 中文

## 概述

`packages/product/` 统一拥有全部自定义产品契约、运行时插件、客户端扩展、Preset 和产品 Bundle。官方 Harness 包保持为上游基础；产品包通过已记录的插件、事件和 Service Definition 机制扩展，不复制 Studio 的包目录拓扑。

产品设计 Spec、治理规则、迁移记录和版本映射与实现共同存放在[产品规范索引](specs/INDEX.md)。Harness 原生规范保持上游位置。

F001 现已提供第一个真实纵向切片：持久化知识库 Host/Client 包、按 Preset 约束的 Agent 工具消费方、正式 Product Bundle，以及可复用的垂域 Preset 模板。

子系统参考：[产品知识库](../../docs/subsystems/product-knowledge.zh.md)。

## 目标拓扑

```text
packages/product/
├─ specs/
├─ product-knowledge/
├─ product-knowledge-context/
├─ product-presets/
└─ product-bundle/
   └─ cordis.patch.yml
```

- `specs/` 是产品 Feature Spec 和治理记录的唯一维护位置。
- `product-knowledge/` 拥有 F001 契约、SQLite 状态、Remote 方法和原生 Client 页面。
- `product-knowledge-context/` 拥有三个有界 Agent 工具与 Preset 绑定策略。
- `product-presets/` 拥有功能所需的产品会话组合与垂域模板。
- `product-bundle/` 拥有安装到专用 Profile 的正式产品组合。

这些名称描述预期职责，并不强制提前建立全部包。只有角色的生命周期或消费者需要独立演进时，才继续拆包。

## 依赖关系

契约不得依赖运行时、客户端、Preset 或 Bundle 包。运行时和客户端包依赖产品契约以及官方 Service Definition，不依赖具体 Provider。Preset 和 Bundle 只负责组合，不承载业务实现。

Studio 包是参考实现，不是产品依赖。采用的能力必须先评估、适配当前 Harness 基线，再放入本组，并保留适用的来源和许可证记录。

## 组合与验证

产品 Bundle 的 `cordis.patch.yml` 是正式组合来源，并安装到专用 Profile。命令行 `--patch` 只用于开发、测试和临时覆盖。

面向产品用户的能力只有在适用的契约、运行时、客户端、Preset 和 Bundle 工作均通过专用 Profile 验证后才算完成。桌面可见行为还必须通过 `apps/product-desktop/` 的交付验证。

F002 在不改变该组合边界的前提下提供 Windows 开发入口。Profile 准备、启动方式、生命周期和当前交付限制参见[产品桌面应用说明](../../apps/product-desktop/README.zh.md)。

所有权决策和替代方案记录在[产品扩展 Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-isolate-product-extensions.zh.md)中。
