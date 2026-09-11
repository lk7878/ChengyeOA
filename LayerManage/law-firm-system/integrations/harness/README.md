# 律师智慧管理系统 V1.1.0 · 本机知识库与智慧办案

规格：[SPEC-AI-INTEGRATION-20260912](../../../../docs/superpowers/specs/2026-09-12-harness-integration.md)。OA 产品名称与版本由 apps/web/src/product.ts 提供，变更版本先更新 Spec。

## 结构与维护边界

OA 只负责两个入口、登录与权限票据；本目录负责连接器、桥接插件和法律 Preset；独立安装的 DeepSeek Harness 负责 Wiki、模型、会话、编辑器和工具。OA 的构建和依赖不导入 Harness 源码。删除或升级本目录不会修改 Harness 源项目。

本次只读验证安装：D:/2_test/C33_deepseek-harness/deepseek-harness，版本 0.1.2-alpha.2，本机构建标识 0.1.2-alpha.2-de7a38d-dirty。源项目原有未提交修改保留；兼容性以本次实际构建为准，升级后应重新运行验收脚本。

## 每台律师电脑首次配置

1. 准备独立安装且已完成构建的 Harness；需要 Node.js 22.19+（22 系列）或 24+、pnpm 11.7。本连接器没有额外 npm 依赖。OA 服务端继续使用项目规定的 Node 22。
2. 在本目录将 config.example.json 复制为 config.local.json。填写 harnessRoot（包含 apps/cli/lib/bin.js 的实际根目录）、oaApiOrigin（OA 后端固定 Origin）、allowedOrigins（浏览器访问 OA 的完整 Origin，不含路径）。开发机示例已填写 localhost:7001 / localhost:3000。
3. 运行 node connector.mjs config.local.json，保持进程运行。仅监听 127.0.0.1:43123，可在配置和 OA 页面中同步更改端口。Ctrl+C 会停止其启动的全部助手进程。
4. 登录 OA 后，从右上角“知识库”或左侧“智慧办案”进入，点击“连接本机助手”。首次初始化为当前 OA 账户创建个人 Profile，可能需要数十秒。
5. 在原生助手设置中配置个人模型提供商/API Key，首次引导可选择“稍后配置”。未配模型仍可导入受支持的文本资料和查看确定性 Wiki；LLM 编译、问答、阅卷推理、文书生成需用户配置并发起。
6. 智慧办案选择“智慧办案法律助手”，首次在“选择工作区”中添加连接状态所示账户目录下的 workspace，或律师自己选择的案件工作目录。后续按原生工作区和会话管理。

个人电脑访问远程 OA 时，oaApiOrigin/allowedOrigins 应设置实际 HTTPS 地址，连接器仍在个人电脑运行。浏览器需要允许 OA 访问本地网络；同站 HTTP 开发环境内嵌显示，远程 OA 用“在新窗口打开”，保留原生 SameSite=Strict 认证策略。不同浏览器/企业策略可能禁止本地网络，应由本机浏览器设置允许可信 OA 地址，不开放连接器到公网。

## 数据位置与备份

默认根目录为 %LOCALAPPDATA%/ChengyeOA/Harness（无该环境变量时使用用户 home 下同名目录）。每个账户路径为 accounts/<SHA256(OA API Origin + 换行 + OA userId)>：

- home：独立 DSH_HOME，包含 Profile、模型配置、会话等。
- home/product/knowledge/knowledge.db：原生 SQLite 权威知识库，保存 raw 原始字节、提取文本、检索分段、确定性 Wiki、LLM 编译与引用等。没有在 OA 服务器另建一套 raw/wiki 副本。
- home/.agent-presets/chengye-legal：本账户法律助手配置。
- workspace：默认案件工作目录。
- runtime.lock 与诊断日志：启动管理和错误定位，日志遮蔽启动令牌。

默认个人知识库别名 chengye-personal。请使用原生知识库的完整备份导出；复制整个账户目录应先停止助手，避免复制到未完成写入的 SQLite。知识库逻辑备份不等同于模型配置和会话的完整备份。

首次个人 Profile 默认使用文本解析、词法检索，关闭原项目指定的 OCR Python/cache 配置，避免写入源项目。扫描 PDF 若需 OCR，请在个人 Profile 的 product-knowledge 配置中指定本人的 OCR 环境和缓存路径；也可使用原生视觉识别并由用户确认模型调用。不会复用 C33 原有个人密钥、资料或 .dsh-home。

改变 OA API Origin 或重新建立一个不同 ID 的 OA 账户会获得新目录；原目录保留，可通过原生备份恢复迁移。OA 登出不会关闭已打开的个人本机应用，请使用“停止本机助手”或退出连接器。共同使用同一台电脑的人应使用独立 Windows 账户；这里的目录划分不是对本机操作系统用户的文件访问沙箱。

## 权限与连接协议

menu.knowledge / menu.smart_case 控制 OA 入口和启动票据；超级管理员自动拥有，其他用户在权限中心显式授权。两者是同一个原生个人应用的入口权限，不替代 Harness 内部工具审批或知识库权限。

浏览器先取本机 60 秒单次挑战，再向 OA 申请对应功能的短期票据。本机只向配置的 OA 地址验票，重新检查会话和权限后按服务端返回 userId 启动进程。OA 登录/刷新 Token、密码、模型 Key 不发给连接器，也不写在原生应用 URL 中；原生应用仅使用它自己生成的本机启动凭据。OA 案件数据不会自动导入或发送给模型。

## 法律能力与版本升级

bridge-plugin 仅负责创建个人知识库和定位原生页面；legal-preset 复用原生文件、技能、知识工具并设定来源核对、事实与推测区分、律师复核的办案流程。它不复制 Harness 实现，也不提供一套未经核验的法律数据库。

首次安装会把 legal-preset 复制到个人 home/.agent-presets/chengye-legal，此后不覆盖律师自己的修改。需要新增法律技能/插件时，使用 Harness 的正式 dsh plugin --profile chengye-oa add 命令，并将 DSH_HOME 设置为目标账户 home、工作目录设置为目标 workspace。不要在 C33 源项目中放置 OA 专用插件。第三方插件必须先自行审查权限和来源。

升级连接器/桥接插件后停止并重启助手；修改 legal-preset 模板只影响新账户，已有账户应备份后显式迁移个人 Preset。升级 Harness 安装路径时，先备份账户数据，再在其个人 Profile 用官方 dsh plugin link 命令重新链接新安装的 web-app、product-bundle 和本桥接包，运行验收；不要把旧用户数据库删除重建作为升级步骤。

## 验证与排障

- node --test test/*.test.mjs：连接器协议、来源校验、挑战重放、个人目录及环境隔离。
- 在安装 OA 前端开发依赖和 Microsoft Edge 的开发机上，node test/native-smoke.mjs config.local.json：以临时目录启动两个真实 Profile，验证导入、Wiki、重启持久化、个人隔离和法律 Preset；不调用模型。临时验收数据不进入正式个人目录。
- node test/oa-browser-smoke.mjs config.local.json：真实连接器与原生 iframe 的 OA 开发页面验收，仅 OA 票据签发/验票使用隔离替身，后端真实 HTTP 已单独回归；需要 Vite 3000。
- 连接失败：先检查 Node/pnpm、安装路径、配置端口和 OA Origin；不要在浏览器直接打开 /health 判断可用性，该接口要求可信 Origin。
- 初始化/启动错误：检查当前账户目录的 setup-diagnostic.log 或 runtime-diagnostic.log。日志不作为共享附件自动上传。
- 旧进程未退出：先停止原连接器；若程序被强制结束，确认 runtime.lock 内的 ownerPid/childPid 均已退出后再重试。连接器会清理过期锁，不应在进程仍运行时手工删锁。
