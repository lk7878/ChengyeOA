# Harness 快照适配记录

## V1.2.1 原生浮动工作台

依据 SPEC-AI-UI-20260912，未修改上游源码。case-view 直接组合原生布局、侧栏、对话、Lexical 输入、Markdown、审批与问题组件；浏览器构建将主题选择器映射到 ShadowRoot，portal.ts 将 body 弹层定位到该根。OA CaseWorkbench 只负责窗口与权限生命周期，个人数据通道继续由 useCaseWorkspace 维护。

初始快照依据 third_party/deepseek-harness.source.json，源项目保持只读。当前导入阶段没有修改快照内源码；OA 专用代码位于 integrations/intelligence。

后续任何上游快照内修订必须记录原文件、原因、Spec、验证与升级处理方式，不把构建产物或个人配置视为源码补丁。

## V1.2.0 适配边界

依据 SPEC-AI-DECOUPLED-20260912，本次没有修改快照内 9267 个源文件。

| 适配文件 | 复用对象与变更原因 |
| --- | --- |
| `scripts/build-knowledge-host.mjs` | 打包原生 product-knowledge Host；只将 OCR 提供器解析到 stdio 适配器 |
| `cloud/runtime.mjs` | 官方 CLI 安装 SDK Profile，叠加受控插件；关闭 JSON-RPC HTTP 监听和服务器文件/Shell 工具 |
| `cloud/preload.mjs` | Windows 先加载 sharp，规避 canvas/sharp 的 DLL 加载顺序冲突；无源补丁 |
| `cloud-plugin/browser-persistence.mjs` | 复用原生 PersistenceCoordinator；底层事务改为浏览器 OPFS SQLite 确认消息 |
| `browser/workspace-worker.ts` | 个人资料、原始 BLOB、可恢复原生事件与文书留在本机；备份恢复事务不覆盖冲突会话 |
| `browser/pdf*.ts` / `mammoth.ts` | 浏览器 PDF.js、上游 mammoth/exceljs 浏览器实现；与原生文件解析管道衔接 |
| `knowledge-view/` | 原生 KnowledgeBaseCenter 独立 React 18 根；律师只读界面复用原生 Markdown 渲染和查询接口 |
| `case-view/` / `cloud-plugin/tools.mjs` | 法律会话、受控 Wiki/本机资料工具、原生询问/逐次文书审批 |

独立 npm 锁文件新增浏览器 SQLite WASM、PDF.js、React 18 与打包依赖；保留上游 pnpm 锁文件。生成的浏览器产物是构建输出，不接受手工维护。升级时先对比来源清单，再执行原生构建及适配器/权限/浏览器回归。

## V1.3.0 阶段一桌面适配

依据 SPEC-AI-DESKTOP-20260913，导入快照无修改。新增 desktop/main.mjs 直接引用上游桌面 Host 管理、生命周期和 Profile 校验源码，显示原生完整 apps/web 构建。独立 product.patch.yml 只关闭本地 Wiki 管理插件，维持管理员云端维护边界。OA preload 仅暴露无参数的 openAssistant，主进程核验窗口和来源；不共享文件/通用 IPC。源码对齐、验证与暂未交付能力见 [阶段一记录](../../docs/superpowers/plans/2026-09-13-unified-desktop-local-harness.md)。

## V1.3.0 阶段二云端 Wiki 与视觉 API

导入快照继续无修改。`desktop-plugin/` 通过原生 `tools`、`storageDomain`、`sessions`、`sessionPersistence` 扩展点注册只读 Wiki 工具并持久化根会话身份绑定；通过 CLI 安装普通依赖，不增加或替代正式 Profile 层。`desktop/knowledge-broker.mjs` 使用上游 HostSupervisor 的 `spawnHost` 接口加私有 Node IPC，OA 页面既有认证客户端代发固定只读请求，云端独立路由重验身份和两个模块权限。`knowledge-contract.mjs` 统一操作、参数与结果上限。个人图像直接复用原生 `read_image`、附件和 DeepSeek 适配器，不改 UI、不引入个人 OCR。升级上游时应复核这些扩展点、session.header.parentSession、Profile 和原生图片调用契约，见[阶段二记录](../../docs/superpowers/plans/2026-09-13-desktop-cloud-wiki-vision.md)。
