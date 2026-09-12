# Studio 能力迁移清单

盘点基于 Studio `c403d45d63866e65452fdaf680519fdeaee7d3ad` 与官方基线 `0a53fb55bea101816fa226bb964ae2bed71c343b`，记录日期为 2026-09-01。

迁移对象是可验证的产品能力，不是 Studio 的目录、旧包名或提交差异。Studio 从旧版 Harness 合并而来的能力优先直接使用当前官方实现；Studio 自有能力经过契约重定、依赖替换和验收后进入 `packages/product/` 或唯一例外 `apps/product-desktop/`。

## 迁移结论

采用“平台能力尽量完整迁移、内容资产逐项选择、历史兼容代码不迁移”的策略：

- 完整保留 Studio 在桌面交付、插件可信生命周期、Preset 分发和应用入口方面的产品设计目标。
- 不复制已经由当前官方 Harness 提供的 Workspace、Session、Agent、工具、模型、视觉、Files、权限、Skill 和 Preset 基础能力。
- 不把 Studio 旧版 Host、Client、Demo、Fixture 和兼容迁移代码当成产品能力。
- 七套内置 Preset 和主题素材是后续可选内容，不与平台能力绑定迁移；FF–LLM Wiki 已由 F001 明确为首个产品能力，按当前 Harness 契约重构迁移。
- 迁移代码不得继续依赖 Studio 专属服务地址、品牌、产品标识或发布基础设施。

## 产品平台能力

| ID | 能力 | Studio 主要来源 | 与当前官方基线关系 | 建议 | 目标所有权 |
|---|---|---|---|---|---|
| S01 | Electron 桌面壳、Host 监管、托盘和窗口生命周期 | `apps/desktop/` | 官方无 Desktop 应用 | 适配迁移，作为首批基础能力 | `apps/product-desktop/` |
| S02 | 原生导航、受限 preload、系统浏览器跳转和桌面目录选择 | `apps/desktop/src/`、旧 Host/Client 桥接 | 官方已有目录选择能力，但无 Electron 权限桥 | 只迁移 Desktop 桥接和权限边界，复用当前官方目录选择接口 | `apps/product-desktop/`、必要的 `product-contracts/` |
| S03 | macOS/Windows 打包、运行时裁剪、安装器、自动更新和发布校验 | `apps/desktop/scripts/`、`package.json` | 官方无 Desktop 发布链 | 分阶段适配迁移；替换产品名、签名、更新源和目标平台配置 | `apps/product-desktop/` |
| S04 | 产品主题、背景图片、本地裁切、桌面品牌入口和更新卡片 | `packages/client/ui-desktop-customization/` | 官方有 Theme 基础能力，无 Studio 产品皮肤 | 迁移机制，素材和品牌重新选择；不复制赋范归属和更新源 | `packages/product/product-client/`、`apps/product-desktop/` |
| S05 | 长会话目录、跨分页定位和消息高亮 | Studio 对 `ui-conversation` 的扩展 | 当前官方基线未发现等价目录 | 建议迁移；优先实现为产品 Client 插件，缺少 Slot 时再申请最小上游扩展点 | `packages/product/product-client/` |
| S06 | 本地模型向导和视觉增强快捷配置 | Studio 对模型设置及桌面定制 UI 的扩展 | 当前官方已支持自定义 pi-ai 路由、模型发现、图像路由与 DeepSeek Files API | 只迁移产品化快捷入口和验证体验，不迁移底层模型、视觉或 Files 实现 | `packages/product/product-client/` |
| S07 | 插件中心严格 JSON 契约、兼容性和风险模型 | `packages/plugin-center/contracts/` | 官方有 Bundle/Profile/插件清单基础，无完整市场契约 | 适配迁移，先对齐当前 Bundle、Profile 和包格式 | `packages/product/product-contracts/` |
| S08 | npm/GitHub 插件发现、分类、详情、缓存与 Agent 推荐 | `apps/desktop/src/plugin-center/`、`ui-plugin-center/`、`find-plugins` Skill | 官方仅提供 `dsh-plugin` 发现约定 | 建议迁移；GitHub 只做 npm 映射，不直接安装源码 | `apps/product-desktop/`、`product-client/`、`product-skills/` |
| S09 | 插件制品下载、完整性校验、Profile 安装和运行证据 | `apps/desktop/src/plugin-center/` | 官方提供安装基础，但无 Studio 的桌面可信事务 | 适配迁移，属于高价值核心能力 | `apps/product-desktop/`、`product-contracts/` |
| S10 | 插件启用、停用、确定更新、卸载和自有数据清理 | 同上 | 官方基础能力需要重新核对，Studio 流程不可直接套用旧格式 | 适配迁移；保留独立数据删除确认 | `apps/product-desktop/`、`product-client/` |
| S11 | 插件事务日志、快照回滚、启动恢复和受限安全模式 | `operation-journal`、`startup-recovery`、`recovery-controller` 等 | 官方无 Desktop 事务恢复层 | 建议迁移设计并按当前 Profile 格式重写，是可信安装闭环的一部分 | `apps/product-desktop/` |
| S12 | Preset 广场的目录、详情、归档校验、安装、删除和用于新会话 | `preset-square/`、`ui-plugin-center/` | 官方已有 Agent Preset 和本地导入基础，无公开广场 | 建议迁移平台能力；目录服务和来源策略必须改为产品自有配置 | `product-contracts/`、`product-client/`、`apps/product-desktop/` |
| S13 | 七套内置 Preset 与九个 Skills | `apps/desktop/resources/preset-square/presets/` | 属于 Studio 内容资产，不是 Harness 平台能力 | 逐套评估，不绑定迁移；通过 `product-presets/` 与 `product-skills/` 管理 | `packages/product/product-presets/`、`product-skills/` |
| S14 | 应用中心、内置应用启动和侧栏快捷入口 | `ApplicationCenterPage`、`built-in-applications.ts` | 官方无完整应用中心 | 迁移平台抽象；应用本身必须独立评估 | `product-contracts/`、`product-runtime/`、`product-client/`、`apps/product-desktop/` |
| S15 | FF–LLM Wiki 完整应用与 DSH 启动插件 | `packages/examples/ff-llm-wiki-plugin/` | 独立 Next.js/Fastify 应用，不能直接进入当前 Harness | 作为 F001 迁移；保留文档解析、SQLite、Wiki/图谱/检索思想，重构为原生 Client Plugin、Host Runtime 与 Agent 工具 | `packages/product/product-knowledge-*` |

## 七套 Preset 内容建议

| Preset | 主要组成 | 建议 |
|---|---|---|
| AI WebApp | `grill-me`、`to-spec`、`tdd` Skills | 可作为较早候选，但须改造成我们的 Spec 方法并复核第三方许可证，不原样复制 |
| AI 报表 | Excel 分析与离线交互报告 Skill | 可选择迁移，耦合较低；在明确数据分析产品需求后立项 |
| PPT Office | 动效演示 Skill 与自定义运行适配器 | 延后评估；它交付 HTML 动效演示而非 PPTX，需先确认产品预期 |
| 视频生成 | HyperFrames、FFmpeg/ffprobe 和较大脚本集合 | 不建议首轮迁移；外部引擎、版本锁定、媒体工具与许可证维护成本高 |
| 内容工厂 | 图文 Skill、图像生成 Plugin、已登录 Codex CLI/ImageGen 依赖 | 不建议原样迁移；需要替换为产品自有图像 Provider 后才能成为稳定能力 |
| 飞书数字员工 | 飞书 Skill、飞书 MCP、时间解析 MCP | 不作为默认能力；只有明确需要飞书集成、凭据治理和数据边界后再迁移 |
| LLM Wiki Producer | 面向 FF–LLM Wiki 开发的 Preset 与 `find-plugins` Skill | 当前不迁移；F001 不依赖 Studio Preset，后续按垂域需求在产品 Preset 骨架中另行定义 |

## 直接复用当前官方基线的能力

以下能力虽然出现在 Studio README 中，但主要来自 Harness 上游，不应从 Studio 移植：

- Workspace 与 Session 管理、重命名、归档、Fork 和历史接续。
- Plan、Goal、Todo、Jobs、Workflow、SubAgent 和多 Agent 基础能力。
- 项目规则、`@file` / `@session` 引用、附件和交付文件展示。
- 权限预设、沙箱、工具审批、结构化用户提问和凭据管理。
- 多模型目录、自定义 OpenAI-compatible 路由、模型发现、图像附件、DeepSeek 视觉模型和 Files API。
- Skill 注册表、文件系统 Provider、目录、加载工具和 Agent Preset 基础设施。
- 官方 Web Client、Host、SDK、CLI、示例和测试基础设施。

这些能力以当前官方实现为准，只在产品需要新的用户体验时增加 `packages/product/` 扩展。

## 不迁移的实现和历史包袱

- Studio 的旧 `client-runtime`、`host-apiproxy`、ACP/JSON-RPC Demo、Fixture 包和旧示例目录；它们已经被当前官方架构替代或仅用于测试。
- 插件中心 Fixture、模拟目录和浏览器开发桥的样例数据；测试思路可以复用，Fixture 应按新契约重新建立。
- `legacy-dshmarket-migration`、旧插件锁文件兼容、Studio Preview 安装残留修复等只服务于既有 Studio 用户数据的迁移逻辑；新产品没有这些历史状态。
- Studio 的 Beyondata/赋范品牌入口、OSS 更新地址、`ai.deepseek.harness.desktop` 产品标识、预览版本规则和专属主题素材，除非产品品牌决策明确采用并取得授权。
- 历史提交中已从当前 Studio 产品入口移除的 TUI、Inspector、Graph/Trace 等实验实现；不得仅凭 Git 历史重新引入。

## 外部依赖与缺失资产

- Preset 广场硬编码依赖 `https://www.dshdesktop.com/preset/`，该服务端不在当前仓库中；迁移时必须替换为产品自有目录服务、可配置来源或仅内置目录。
- 插件发现依赖 npm Registry 和 GitHub API，应保留超时、限流、缓存和不直接安装 GitHub 源码的安全边界。
- Desktop 更新发布依赖 Studio 的 OSS Feed、签名和发布账户，必须由产品自己的发布基础设施替换。
- 第三方 Skill、HyperFrames、MCP 和应用源码必须逐项保留来源、固定版本和许可证，并重新验证与当前 Harness 工具契约的兼容性。
- FF–LLM Wiki、内容工厂和媒体 Preset 各自携带额外运行时与数据治理责任，不能作为插件中心或 Preset 广场平台迁移的隐式组成部分。

## 推荐迁移顺序

1. Desktop 壳、专用 Profile、Product Bundle 和固定安全桥。
2. 插件中心契约、发现只读链路和已安装投影。
3. 插件安装/管理事务、恢复与安全模式闭环。
4. Preset 广场平台与产品 Skill/Preset 分发链路。
5. 长会话目录、本地模型快捷体验和主题等独立 Client 能力。
6. 应用中心平台。
7. 按 F001 迁移 FF–LLM Wiki；七套 Studio Preset 仍逐项审批、默认不迁移。
