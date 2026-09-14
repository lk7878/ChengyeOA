# 统一桌面客户端：阶段一、二开发验证

部署与安装交付要求见[生产部署 Spec](../../../docs/superpowers/specs/2026-09-14-production-deployment.md)和[阶段计划](../../../docs/superpowers/plans/2026-09-14-production-deployment.md)。本文命令属于依赖源码的开发运行方式；自动更新、版本兼容协商和无开发环境安装验收仍待实施，不应把现有 build/setup/start 当作生产安装器。

依据 [V1.3.0 Spec](../../../docs/superpowers/specs/2026-09-13-unified-desktop-local-harness.md)。本目录实现可运行的桌面基础；不是完整 V1.3.0 发布版或独立安装包。

## 本阶段已接入

统一 Electron 客户端显示 OA 页面，右上角“智慧办案”通过受限桥接打开同一个原生 Harness 窗口。原生界面、Windows 文件夹选择器、Product Profile、工作区、模型配置、文件工具、会话日志和恢复均复用 `third_party/deepseek-harness`。OA 浏览器访问仍沿用 V1.2.1 浮动工作台，保留原 OPFS 数据；桌面客户端使用真实本机目录，两者没有隐式迁移或同步。

桌面主进程直接复用原生 `host-supervisor.ts`、`window-lifecycle.ts`、`product-profile.ts`，通过独立 esbuild 构建，不改导入快照。正式 Product Bundle 继续装载，通过 `product.patch.yml` 关闭本地 Wiki 管理插件，并装载独立 `desktop-plugin/` 云端 Wiki 只读工具；OA 原有云端“知识库”入口保留。

## 开发准备与启动

环境：Windows、Node 22.20+ 的 22.x、已安装并构建的导入 Harness、适配器依赖和 OA。全仓初次准备沿用[适配项目说明](../README.md)。开发验证使用上游锁定的 Electron 43.4.0；由于常规依赖安装禁用生命周期脚本，需显式安装该二进制一次。以下命令从 OA 仓库根目录执行：

```powershell
node third_party/deepseek-harness/apps/product-desktop/node_modules/electron/install.js
node integrations/intelligence/scripts/desktop.mjs build
node integrations/intelligence/scripts/desktop.mjs setup --oa-url http://localhost:3000/
node integrations/intelligence/scripts/desktop.mjs start
```

也可使用 `npm --prefix integrations/intelligence run desktop:build`、`desktop:setup`、`desktop:start`。OA 开发服务需先启动；生产 OA 地址必须使用 HTTPS，开发回环地址允许 HTTP。地址不允许含账号密码、查询参数或片段。

默认开发配置位于 `%LOCALAPPDATA%\ChengyeOA\desktop\desktop.json`，包含 OA 地址、本机 Node 路径和本仓库 Harness 路径。可通过绝对路径环境变量 `CHENGYE_DESKTOP_HOME` 指定另一套独立数据目录；不通过网页传入目录、命令或配置。`setup` 通过正式 `dsh plugin --profile product add` 准备 Base → Web → Product 三层并重新链接本仓库路径，保留原生用户配置和数据。源码目录搬迁后重新运行 setup；异常的非正式 Profile 不自动覆盖。

开发构建输出在 `integrations/intelligence/dist/desktop/`，目前依赖本机 Node、完整导入源码的构建产物及依赖。后续需打包运行时与安装器并在干净 Windows 环境验收，不能将本开发目录冒充独立安装包。

从阶段一升级：先从托盘退出客户端，执行 build 和 start；新版在点击“智慧办案”时会检查并自动补齐缺失或失效的本地 Wiki 插件链接。首次部署仍需 setup；也可手动运行 setup 修复完整开发配置。自动补齐使用本项目随附插件与原生 CLI，保留个人配置和工作区。后端需要包含新的 `/api/v1/intelligence/desktop-knowledge` 路由，前端需包含相应查询桥。已经运行的旧客户端必须重启，才能加载新的主进程和私有 IPC。

## 使用和数据位置

1. 登录 OA，在右上角点击“智慧办案”。也可通过系统托盘“打开智慧办案”启动本地助手，OA 暂时离线不影响打开本地材料。
2. 第一次进入显示原生内测声明；点击继续后，在原生界面选择工作区，Windows 文件夹选择器直接选中本机目录。
3. 通过 Harness 原生设置配置个人模型服务和凭据。本文不提供或写入任何真实模型密钥；测试模型配置仅存在独立的测试临时目录中。
4. 关闭办案窗口将其隐藏，再次点击入口恢复同一窗口与会话；OA 主窗口关闭后保留托盘。托盘“退出客户端”停止本机 Host 后退出。
5. 重启客户端后从原生侧栏点击历史会话继续使用。文件保留在选定工作区，会话与工作区记录在 `<桌面数据目录>\harness\`，原生客户端状态位于 `client\`。新窗口不保证自动选中上一次会话。

保持原生标准模式和界面，增加 `cloud_wiki` 工具。原生 `workspace-write` 权限允许工作目录及平台临时目录写入，其他路径的写入按原生权限拒绝或审批；这不等同于禁止读取所有工作目录外文件。OA 页面没有 Node、文件、Shell 或通用 IPC 能力；桥接仅打开助手、报告当前账号和传递固定 Wiki 查询结果，由主进程校验窗口、主框架和精确来源。OA 令牌与 CSRF 凭据只由 OA 页面认证客户端使用，不传入 Harness、模型、子进程环境或配置文件。个人模型凭据由原生凭据服务管理，个人会话遥测上传已关闭。

## 云端知识库使用

### 品牌和律师 preset

本地助手名称为“百佑办案助手”，欢迎语为“让法律服务更智能”。Logo 原图、客户端品牌插件和独立 `lawyer` preset 均在 `integrations/intelligence/desktop-plugin/` 维护。部署只提供“律师办案助手”，固定为默认，不提供其他模式或创建新预设的入口。历史 standard/ptc/minimal/cordis 会话继续保留原标识，恢复后由 lawyer 组合承接；个人材料不删除。

`desktop:build` 先构建插件客户端，再使用原生构建配置生成会话和布局模块：对欢迎语作精确匹配转换，并使用原生 `DSH_CLIENT_TITLE` 配置窗口标题。源快照不修改，生成的 `lib/client.js` 不入 Git。重建完整 Harness 后需再执行 `desktop:build`，移动仓库目录后也应先 build 再 setup，以刷新部署 preset 根路径；运行中的客户端需退出并重新启动以应用更新。

律师模式目前使用下述在线只读插件。管理员发布只读快照、自动同步和离线使用仍是待确认方案，未启用后台下载。

### 四类法律能力

依据[法律技能 Spec](../../../docs/superpowers/specs/2026-09-14-lawyer-skills.md)，唯一 lawyer 内置合同审查、应诉分析、管辖分析和法律法规/案例检索。直接描述任务即可按需加载，也可显式输入 `/contract-review`、`/litigation-response`、`/litigation-jurisdiction`、`/china-legal-query`。报告保存为工作目录中的 Markdown 草稿，包含来源、适用条件与待核验事项，供律师复核。

正式技能源码位于 desktop-plugin/presets/lawyer/skills，desktop:build 将完整 preset 和引用资源复制到 dist/desktop/presets；不依赖项目根的参考 skills 目录。技能升级后重新 build 并退出重启客户端。打包搬迁仍需要按开发部署说明刷新仓库路径；本次验证 preset 与资源的相对定位，未交付无源码安装器。

公开检索共用原生 web_search/web_fetch，Product 默认 deepseek-official 搜索提供器，未新增 Tavily Python 或密钥依赖。若聊天正常而搜索失败，请在原生设置 → 插件 → 插件配置 → 网页搜索中检查独立的搜索 Endpoint 与服务权限；聊天 Endpoint 不自动等同于搜索 Endpoint。工具可见不保证当前账号的实际服务可用。

原始卷宗不自动上传 OA/Wiki；必要上下文进入个人模型 API，检索仅发送必要查询词。资料不足时输出条件性分析，不用内置过时管辖金额表或虚构法条补齐结论。

在 OA 登录具有“知识库”和“智慧办案”权限的账号。管理员从右上角“知识库”维护并编译资料；本地助手同样只读，即使当前登录者是管理员。可以直接对助手说：“先列出云端知识库，再检索证据核验要求，引用原文与行号。”

`cloud_wiki` 支持 `list`、`documents`、`search`、`read`、`wiki` 和 `compiled`。原文最多一次读取 200 行；列表每页 20 项；管理员编译成果每次读取 5 节，可根据 `nextOffset` 继续。返回来源标识、版本/摘要和可用的行号。`wiki` 是原生确定性投影，`compiled` 是管理员持久化的模型编译成果，未编译返回 `publication: null`；`stale` 表示来源已变化，应让管理员更新，不能冒充最新原文。查询不执行编译、OCR 或写入公共问答记录。

第一次成功查询把办案根会话绑定 OA 账号和服务器；历史会话、分支和子任务继承绑定。退出登录、账号切换、权限失效、页面离开会取消在途查询；云端在返回前再次检查登录及权限。换账号请新建不继承历史的会话；重新登录原账号可继续。网络失败、超时、越权和查询过大有明确反馈。身份绑定保护云端查询，并非本机多用户文件加密；本机文件仍由 Windows 用户权限管理。

## 个人图片与视觉模型

在 Harness 原生“设置”中配置个人模型服务、API 凭据与模型目录，再在输入框下方的原生模型选择器选择支持图像输入的模型。导入版本已有视觉模型条目 `deepseek-v4-flash-vision-exp`；实际可用性取决于个人服务端和账号权限，也可按原生供应商配置维护模型条目，必须声明图像输入能力。

选择工作目录后，可说：“使用当前视觉模型读取凭证.png，提取日期和金额，保存为凭证核对.md，无法辨认处请标明。”原生 `read_image` 读取 PNG/JPEG/WebP/GIF 并通过附件服务交给当前模型；也可使用原生图像附件入口。原生适配器支持 Files API，服务不支持时按原有行为退回内联图片请求。文件及会话留本机，所选图片和相关上下文会发送到配置的模型 API；不是 OA/Wiki 同步。

不安装个人 OCR、不调用 Wiki 的管理员云端 OCR。非视觉模型、缺失密钥、错误图片及接口失败由原生界面报告。本阶段没有实现整本扫描 PDF 的批量识别；需要先提供页面图片。识别和文书内容由律师复核。

## 验证与范围

```powershell
node --test integrations/intelligence/desktop/tests/*.test.mjs
node integrations/intelligence/desktop/tests/smoke.mjs
```

真实桌面烟测需 OA Vite 开发服务位于 `localhost:3000`、PowerShell 7、原生构建和 Electron。使用临时 OA E2E 身份与脚本模型、隔离 Wiki SQLite 和正式 Product Profile；OA HTTP 测试路由转交真实 `IntelligenceService`，认证/授权中间件另由后端真实 HTTP 与独立 PostgreSQL 测试覆盖。自动化通过实例拥有的 Windows 原生目录对话框选取测试目录，验证 Wiki 查询引用、原生图像请求、目录写入、边界拒绝、重启恢复、同账号续用与跨账号拒绝。不扫描用户卷宗，也不将脚本识别文本当作真实模型准确率验收。

结果与截图位置见[阶段一](../../../docs/superpowers/plans/2026-09-13-unified-desktop-local-harness.md)和[阶段二实施记录](../../../docs/superpowers/plans/2026-09-13-desktop-cloud-wiki-vision.md)。主动归档、OA 离线草稿同步、旧 OPFS 迁移以及独立安装器待后续开发；真实个人模型识别效果和云端 OCR 部署验收仍需实际服务配置。完整产品版本继续按 Spec 保持待验收状态。
