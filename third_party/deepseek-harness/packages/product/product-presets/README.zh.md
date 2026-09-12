---
description: "可复用的产品自有垂域 Preset 模板，不包含 Studio 内置 Preset。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-presets

[English](README.md) | 中文

## 概述

本包拥有产品自定义 Agent Preset。Studio 的七套内置 Preset 被明确排除。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[学术 Wiki 模板](templates/academic-wiki/agent.cordis.yml) 包含 Harness 标准工具、学术检索提示词和安装时替换的知识库绑定占位符。[版本清单](templates/academic-wiki/template.json) 记录 Harness 基线。较小的 `templates/domain-preset/` 保留为仅含绑定的骨架。业务绑定放在 `agent.cordis.yml`；`preset.yml` 只保存展示元数据。

### 生成本地实例

先安装兼容的 Harness 和 Product 包，在 Product profile 加载知识库服务，并创建或恢复目标知识库。从 Harness 仓库根目录执行，在已经注册的 Preset 根目录中生成新实例：

```powershell
node packages/product/product-presets/scripts/generate-academic-preset.mjs --preset-root "../.dsh-home/profiles/product/presets" --knowledge-ref "your-library-alias" --id "wiki-academic"
```

按接收机器替换根目录及知识库别名或 ID。示例目录需要 Product profile 的 `agent-presets.config.roots` 注册；新环境可使用官方默认发现的 `<DSH_HOME>/.agent-presets`，除非已禁用用户根目录。脚本不注册根目录、不安装依赖、不检查凭据、不创建知识数据。`--name` 修改显示名称；`--dry-run` 仅预览目标，不写入文件。参见[安装决策](../specs/F001-llm-wiki-knowledge-base/academic-preset-template.md)。

生成目录包含 `agent.cordis.yml`、`preset.yml` 和记录模板版本及初始文件哈希的 `template-origin.json`。已有目录永远不会被覆盖。升级时使用不同 `--id` 生成，再比较文件、手工保留个人提示词及绑定后决定是否切换。I/O 失败可能保留供检查的不完整新目录；重试时使用新 ID。在 Harness 新会话中选择生成的 Preset，并要求调用 `knowledge_sources` 验证绑定。

<a id="model-experience"></a>
## 模型体验

### 源码模板

#### 模型看到什么

运行时不会从本包直接看到内容。维护者复制并安装 `agent.cordis.yml` 后，具体垂域 Preset 拥有自己的指令、工具与知识绑定。

#### Token 影响

源码模板自身无影响；已安装的具体 Preset 拥有全部 token 开销。

#### KV Cache 影响

源码模板自身无影响；修改已安装的具体 Preset 可能改变可复用前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本包交付学术模板和绑定骨架，不包含 Studio 的七套 Preset；其他 Harness 基线需要检查依赖和组合兼容性。
- 复制模板不会自动创建其中引用的知识库。
- 模板更新不会同步已安装实例。生成脚本不会更改已有 Preset 或默认选择。

<a id="dev-note"></a>
### 开发备注

只在真实垂域需求获批后新增 Preset。
