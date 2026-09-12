# 二次开发治理规范

## 基线

当前官方 `deepseek-harness` 是唯一二次开发代码基线。上游升级通过官方 remote、发布标签、独立集成分支和保留合并历史的 merge commit 完成，验收通过后再进入产品稳定分支。

Studio 不是代码基线。它只提供产品设计、能力拆分和实现方式的参考；任何能力均须经过评估、裁剪和适配后进入产品代码。

## 开发模式

产品采用“三层所有权架构 + 垂直能力切片 + 双闭环验证”：

1. 上游基础层由官方 Harness 代码构成，默认不修改。
2. 产品能力层集中在 `packages/product/`。
3. 桌面交付层集中在 `apps/product-desktop/`。

单项能力从 `packages/product/specs/` 中的 Feature Spec 和验收标准开始，按需要经过契约、运行时插件、客户端扩展、Preset、Product Bundle、Profile 和桌面验证。功能闭环验证真实用户路径，上游升级闭环验证产品组合在新基线上的兼容性。

## 变更纪律

- Studio 能力迁移和上游版本合并必须使用独立分支与独立提交，不得混在同一次变更中。
- 产品能力优先使用 Harness 的插件、事件和 Service Definition / Provider / Consumer 扩展机制。
- 只有现有扩展点无法满足明确需求时，才能修改上游基础层；原因、影响、替代方案和回归验证记录在 `migration/upstream-patch-ledger.md`。
- 产品默认组合由 Product Bundle 持有；`--patch` 只用于开发、测试和临时覆盖。
- 二开规范与产品代码共同存放在 `packages/product/`，通过 Feature ID 和代码 SHA 建立关联；Harness 原生规范保持上游位置和内容。
