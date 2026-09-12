---
description: "安装到 DeepSeek Harness 专用 Profile 的正式产品插件组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-product-bundle

[English](README.md) | 中文

## 概述

该静态 Bundle 是正式产品组合来源。其 `cordis.patch.yml` 把持久化知识库 Host 与配套 Client 安装到专用 Profile；依赖闭包包含知识上下文和 Preset 包，但 Agent 绑定由各 Preset 自己负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把 Bundle 安装到专用产品 Profile。命令行 `--patch` 只用于开发、测试和临时覆盖。不要在这里放业务逻辑或 Skill 内容。

在 Harness 仓库根目录通过官方插件管理器创建专用 Profile：

```powershell
pnpm run dsh -- plugin --profile product add ./packages/bundle/web-app
pnpm run dsh -- plugin --profile product add ./packages/product/product-bundle
pnpm run dsh -- --profile product --dump-default-config
pnpm run dsh -- --profile product
```

最终层顺序为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-product-bundle`。两次安装必须分开执行，确保产品层追加在 Web 层之后。Profile manifest 由命令创建并维护，不应手写。运行 `pnpm --filter @deepseek-ai/dsh-product-bundle verify:profile` 可在临时 `DSH_HOME` 中进行隔离组合与启动验证，不会改写用户已有 Profile。

<a id="understand-the-implementation"></a>
## 理解实现

`cordis.patch.yml` 插入一个稳定的 `product-knowledge` 行。该包拥有自己的 Host 服务、Remote 命名空间、Client 页面、持久化和测试；Bundle 只拥有有序组合。后续按 id 定位的 Profile patch 必须重述该行的完整配置，因为 patch 行会替换 `config`，而不是进行深度合并。

<a id="further-exploration"></a>
## 进一步探索

- [产品知识库](../product-knowledge/README.zh.md)——持久化知识及其原生管理界面。
- [知识上下文](../product-knowledge-context/README.zh.md)——面向模型的有界访问。
- [产品包地图](../README.zh.md)——所有权和依赖方向。

<a id="model-experience"></a>
## 模型体验

### 组合载体

#### 模型看到什么

没有直接内容。`cordis.patch.yml` 决定可用运行时能力；Preset 决定为 Agent 挂载哪些面向模型的工具。

#### Token 影响

Bundle 自身不增加 token；被组合包拥有各自的 schema、提示词和结果开销。

#### KV Cache 影响

Bundle 自身没有缓存影响；面向模型的组合包变化可能改变可复用前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 当前 Bundle 只组合 F001。
- 仓库内 Profile 路径已验证；Profile 成品打包和桌面交付外壳仍是独立发布事项。

<a id="dev-note"></a>
### 开发备注

产品逻辑版本与官方 Harness 包清单版本分开记录在本地私有产品 Spec 中。
