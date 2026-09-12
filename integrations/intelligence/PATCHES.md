# Harness 快照适配记录

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
