# Agent Note：增加最小根级主页面扩展 seam

状态：已实现

[English](2026-09-01-root-primary-page-extension.md) | 中文

## 问题

产品插件需要知识库中心这类全高、根级目的地。官方外壳此前只暴露侧栏、会话、详情和 overlay 席位。替换 Web 应用，或把产品路由写进上游包，都会把业务所有权混入基础层。

## 决策

`dsh-client-ui-layout` 声明一个通用的 root 作用域 keyed slot：`main.page`，owner prop 为 `{ pageId: string }`。插件贡献稳定 key，并通过 `ctx.layout.openPrimaryPage(key)` 与 `ctx.layout.closePrimaryPage()` 打开或关闭。选中后，AppFrame 保留外壳和侧栏，在中间区域渲染 keyed 页面，并隐藏会话与详情。

布局 service 和瞬时 store 拥有选择状态；贡献方拥有全部页面内容、Remote 调用与业务状态。该 seam 不包含知识库命名，也不依赖 Studio。此补丁在私有上游补丁台账中记录为 UP-001，并须在每次官方基线合并时重新验证。

## 考虑过的替代方案

**独立 Next 应用。** 不采用，因为它会重复启动、Client 插件、主题、本地化和 Profile 组合行为。

**把知识库中心放进会话详情。** 不采用，因为持久产品资源不归 Session 所有，需要一等导航目的地。

**在 ui-layout 中增加知识库专用路由。** 不采用，因为上游所有包只应提供可复用扩展契约。

## 后果

产品目的地可以保持为增量 Client 插件。key 属于共享命名空间，已占用 key 是替换点。选择状态跨进程重载不持久。外壳仍只负责导航几何；产品包继续在 `packages/product/` 下独立迁移。
