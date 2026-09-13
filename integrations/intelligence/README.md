# OA 智能化适配项目

生产目标与验收入口：[2026-09-14 部署规格](../../docs/superpowers/specs/2026-09-14-production-deployment.md)、[部署计划](../../docs/superpowers/plans/2026-09-14-production-deployment.md)。目前只验证开发版桌面接入、在线 cloud_wiki 和相关回归，完整生产部署与独立安装包尚未完成。下文 V1.2.x 浏览器办案属于保留的历史实现；目标普通浏览器提供 OA/Wiki，完整本机办案使用 Windows客户端，旧入口退役与 OPFS保留须先验收。

现有浏览器版本 V1.2.1，界面增量见 [原生浮动工作台 Spec](../../docs/superpowers/specs/2026-09-12-smart-case-native-ui.md)，数据与运行边界依据 [替代 Spec](../../docs/superpowers/specs/2026-09-12-harness-decoupled.md)。本目录集中维护知识库独立视图、办案接口、无端口运行适配，以及源码/构建检查脚本。上游实现位于 ../../third_party/deepseek-harness，OA 业务代码位于 ../../LayerManage/law-firm-system。三者职责分开，随 OA 一起交付。

OA、Wiki、OCR 均在云端，系统管理员维护和编译 Wiki，律师只查询使用；办案材料和工作成果通过浏览器保存在律师电脑本地，不安装额外服务。V1.1 的连接器 HTTP 入口已停用，历史源码和原个人数据保留，正式产品不再要求本机连接器。此前浏览器 Wiki 验证保留在 probes 中，不进入产品构建。

源码来源：third_party/deepseek-harness.source.json。首次快照工具：scripts/import-harness-source.mjs（显式源目录参数，仅用于维护；产品运行无外部源目录参数）。升级禁止覆盖已有快照，先在临时目录导入、比较并记录 PATCHES.md。

## V1.3.0 桌面阶段一、二

最新部署目标以 [统一桌面 Spec](../../docs/superpowers/specs/2026-09-13-unified-desktop-local-harness.md) 为准。已增加本地原生 Harness 桌面开发构建，OA 右上角入口在桌面客户端中打开本机助手，实际选择本机目录并读写文件。操作与数据边界见 [桌面说明](desktop/README.md)。本页其余运行说明描述仍保留的 V1.2.1 浏览器方案，不能用于推断桌面工作区位置；本阶段不自动迁移旧 OPFS。

阶段二增加独立 `desktop-plugin/`：通过 OA 原有认证查询同一云端 Wiki，读取原文与管理员编译成果，按根会话绑定账号。个人图片识别沿用本机 Harness 的原生视觉模型配置与附件接口；文件不自动同步 OA。升级旧开发客户端须退出并重新 build/start；新版入口自动补齐缺失的桌面插件，首次部署或完整配置修复仍可运行 setup。安装器与成果归档尚未交付。

## 安装、构建和启动

与 OA 共用 Node **22.20 或更高的 22.x**，pnpm 按上游 packageManager 固定版本。先完成 OA 原有 npm setup / 数据库配置，再从仓库根目录运行：

```text
node integrations/intelligence/scripts/build.mjs --install
```

这会安装适配器独立 npm 锁文件与 Harness 独立 pnpm 锁文件，验证源快照，并构建原生引擎、Wiki Host、两个独立视图和本机存储 Worker。依赖安装禁用自动生命周期脚本，随后显式执行可信构建。之后 OA 根包的 `npm run build:web` 自动构建智能模块；仅改适配层可执行 `node integrations/intelligence/scripts/build.mjs --skip-vendor`。

运行 OA 的原有后端与前端即可。后端按需通过标准 dsh SDK Profile 启动 Wiki 或办案子进程，经 Node IPC 通信，不监听 Harness HTTP 端口。生产启动固定一个 OA Worker，同一 Wiki 数据目录具有进程锁。V1.2 云部署须保留完整仓库目录、独立依赖和构建产物；旧单文件 exe/旧安装包不包含这些子项目，不能用于本版本云部署。

## 管理员配置

在 OA 服务环境中设置以下变量，密钥不放前端或 Git，修改后重启 OA：

| 变量 | 作用 |
| --- | --- |
| `CHENGYE_INTELLIGENCE_DATA_DIR` | 云端 Wiki 数据及进程配置目录；默认 OA `var/intelligence`，建议使用独立持久卷 |
| `CHENGYE_MODEL_API_KEY` | 云端 DeepSeek 模型凭据，未设置时检索和本机文件存储仍可用，模型生成给出配置提示 |
| `CHENGYE_MODEL_BASE_URL` | 默认 `https://api.deepseek.com` |
| `CHENGYE_MODEL_ORIGINS` | 可选、逗号分隔的额外 HTTPS 模型源，由运维管理；不是律师可提交的参数 |
| `NODE_EXTRA_CA_CERTS` | 可选私有代理 CA；仍验证 TLS，不关闭证书验证 |
| `CHENGYE_OCR_PYTHON` | 安装 PaddleOCR 环境的 Python 解释器绝对路径 |
| `CHENGYE_OCR_MODEL_CACHE` | 云端预安装模型的缓存目录，避免每次下载 |
| `CHENGYE_OCR_DEVICE` | 默认 `cpu`，由服务器硬件决定 |

OCR 复用快照 `packages/product/product-knowledge/src/paddleocr-worker.ts` 所引用的 Python 算法；适配文件 `cloud/ocr_stdio.py` 只启用标准输入输出，不启动原 HTTP 服务。部署环境依照快照的 PaddleOCR 依赖文档安装并预热 PP-OCRv5 模型。OCR 最多同时两项请求，图片最多 15 MB，超时五分钟。本次开发机没有模型密钥及 PaddleOCR 环境，未验证真实推理效果或真实 OCR 精度。

云端反向代理需支持长请求（编译可达十分钟），请求体限制至少 32 MB；静态 `.js`/`.mjs` 用 JavaScript MIME，`.wasm` 用 `application/wasm`。启用 HTTPS，避免缓存 `/api/v1/intelligence/*`。代理不要记录请求正文。编译、问答凭据通过进程内请求快照传递，个人办案会话不写服务器日志或数据库。

## 权限与数据位置

- `menu.knowledge` 控制入口。系统管理员/超级管理员维护云端 Wiki；普通律师仅列出、查询、浏览已启用的资料。直接请求维护 API 也会被拒绝。
- `menu.smart_case` 控制智慧办案。每个 OA 用户、浏览器客户端分别隔离云端临时引擎；云端 Wiki 引用再次检查启用状态。
- 浏览器 OPFS 中的 SQLite 按 OA 来源和账号分区，资料再按办案会话隔离。原生持久化协调器在浏览器确认保存后才继续模型和工具。另一标签页不能同时占用同一工作区。
- 本机存储属于当前浏览器和站点，不能当作任意磁盘目录。律师可请求持久化存储、导出完整备份、恢复备份并下载原文件/成果。清除站点数据会删除本机资料；换电脑、换域名或换浏览器应先备份。
- TXT、Markdown、HTML、DOCX、XLSX、PDF 解析在本机完成。图片/扫描页 OCR 只有律师勾选允许时发送到云端；模型只按当前会话和工具请求取得材料。
- 云端 `wiki/home/knowledge.db` 及管理员知识库模型设置、编译状态需由管理员备份；运行数据从 Git 排除。

## 旧资料迁移

不自动移动或覆盖 C33/旧连接器个人数据库。由管理员在旧 Wiki 导出**完整备份 JSON**，在新云端知识库“恢复备份”导入。先核对资料数量、原文和编译结果，再保留旧备份；标识冲突时原生事务会拒绝覆盖。单次 OA 上传上限 32 MB，较大的库由管理员分库备份迁移。

## 法律插件维护

法律助手的 persona 与插件挂载在 `presets/chengye-legal/agent.cordis.yml`，现有工具实现是独立的原生插件 `cloud-plugin/tools.mjs`。维护者可在此插件内增加法律工具或引用受审查模块，保持 OA 路由层不变；更新构建后重启 OA 生效。普通律师不能安装插件、选择任意 Profile、运行服务器 Shell 或读写服务器任意路径。

## 验证

```text
npm --prefix integrations/intelligence test
node integrations/intelligence/tests/browser-ui.mjs
```

第一组运行实际原生 Wiki、OPFS、标准 Profile/IPC、会话恢复、脚本化本地 TLS 模型与工具审批回归；需要 Edge（测试脚本可换浏览器渠道）和 OpenSSL。第二组需要 OA Vite 开发服务，复用真实智能服务、隔离测试数据，只替换 OA 登录上下文；真实认证/权限 HTTP 回归在 OA 后端 `test/harness/intelligence-http.test.ts`。不把脚本化模型测试等同于真实法律答案质量验证。

## V1.2.1 原生浮动工作台

OA 右上角“智慧办案”紧邻“知识库”，只向具备 menu.smart_case 的用户显示；OA 左栏不再重复设置入口。旧 /smart-case 链接保留为唤起入口。浮动工作台支持移动、缩放、最小化、最大化，切换 OA 页面不重建会话；最小化后点击右上角入口恢复。明确关闭、退出账号或失去权限时结束连接，已保存材料仍留在 OPFS。

case-view 直接复用快照的 AppFrame、SidebarRoot、ConversationRoot、InputBar、UserMessageNodeView、AssistantMarkdown、ApprovalPanel、QuestionComposer 及其主题和中文词典。NativeComposer 只提供现有 OA 会话与本机草稿的数据接口，保留原生 Lexical 编辑器和中文输入法保护。portal.ts 将原生弹层定向到当前独立 ShadowRoot；构建时将主题 body/:root 选择器映射到 :host，不修改上游源码或向 OA 全局注入样式。

本机材料、知识库引用与备份仍由适配器维护。窄窗口将材料面板呈现为对话框，避免原生布局收起右栏后无法操作。插件运行上下文不显示为律师消息；原生事件记录和模型可见内容未变。界面运行与数据架构的版本独立，本次没有改变服务端 IPC 协议或数据库格式。
