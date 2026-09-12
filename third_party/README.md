# 独立维护的 Harness 源码

本目录对应 [V1.2.0 Spec](../docs/superpowers/specs/2026-09-12-harness-decoupled.md)。

- deepseek-harness/：独立上游源码快照，保留 pnpm workspace、依赖锁、构建脚本、测试及许可证。没有嵌套 .git；由 OA 的本地 Git 统一记录。
- deepseek-harness.source.json：当前源工作区的版本、逐文件哈希、快照指纹和排除清单；包含 103 个当时未跟踪的功能/测试/Spec 文件，不退回旧 HEAD。
- ../integrations/intelligence/：OA 专用的视图、通信和部署适配边界，避免直接混入 OA 业务代码或改写原始上游代码。

维护 Wiki 时优先查看 deepseek-harness/packages/product/product-knowledge/（存储、编译、检索和独立视图）、product-knowledge-context/（办案检索桥接）和 product-presets/（助手模板）。维护 Harness 执行引擎查看 packages/core/agent-loop/、packages/core/tools/、packages/sdk/ 和各工具插件。生产用户资料、模型密钥及运行数据不属于本目录。

升级时导入新版本到临时目录并比较来源清单，显式复核 OA 适配；不要直接用旧上游 HEAD 覆盖工作区增量。源项目原有 Git 与用户资料不受本快照影响。OA 中需要修正上游快照时，在 ../integrations/intelligence/PATCHES.md 记录原因、对应文件与验证。
