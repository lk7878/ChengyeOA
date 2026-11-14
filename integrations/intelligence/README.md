# OA 智慧办案与法律知识库

现行版本：2026-11-07 服务器工作区。此前本机目录、浏览器 OPFS 和桌面独立助手属于历史路径，不能据此判断新材料的保存位置。本轮遵循用户确定的新方案；详细规格和验收见 [服务器工作区说明](../../docs/spec/reference/SMART-CASE-SERVER.md)。

## 产品边界

- OA 顶栏“智慧办案”打开同一个浮动工作台；桌面宿主也使用该入口，不再启动独立本机助手。
- 每个 OA 账号一个私有服务器工作区；会话之间分别组织材料、生成草稿、消息与交互。普通用户和超级管理员均不能通过接口读取其他用户的私有会话。
- 侧栏支持搜索、重命名、归档/取消归档、删除/恢复。删除是可恢复的隐藏，不立即物理销毁材料。
- 浏览器不再是新会话/新材料的唯一存储。关闭页面不停止后台任务；服务重启后保留已确认的记录，正在执行的任务标记中断，用户重新发送后继续。
- 系统管理员/超级管理员在左下角“AI模型配置”统一设置 API Key、HTTPS Base URL 和模型名称；普通用户无需配置，只需获得OA的“智慧办案”菜单权限。更换地址必须重新输入密钥，空密钥保留同地址的已有组织配置。旧个人配置不再参与调用，不能自动提升为共享配置。
- “测试连通性”向填写的地址发送固定无业务数据的Chat Completions流式测试，20秒超时、响应上限64KB，并校验有效内容；测试不保存配置。保存后的组织配置在用户下次发送时生效，当前任务继续使用启动快照。
- 原件和解析文本在服务器，任务会按需将对话、提取文本、知识库引用发送到配置的模型服务；不是纯本地推理。AI不能直接写OA案件、合同、审批和财务数据。

## 构建与启动

与 OA 共用 Node **22.20 或更高的22.x**；保持快照规定的 pnpm 版本。首次安装：

```text
node integrations/intelligence/scripts/build.mjs --install
```

已有依赖、仅改适配层：

```text
node integrations/intelligence/scripts/build.mjs --skip-vendor
```

OA 原有前后端启动方式不变。完整仓库、Harness构建产物、适配器依赖和持久数据卷必须一起部署；旧单文件exe不能替代这些依赖。固定一个OA Worker，按用户启动受管IPC子进程，不额外开放Harness端口。升级后重启后端、刷新浏览器，静态智能资源避免长期缓存。

用户已确认旧浏览器资料均为无用测试数据，旧导出入口及本地worker不再发布。进入智慧办案时，只清理当前登录账号对应的旧OPFS智慧办案目录，沿用原账号锁；被旧页面占用时提示关闭后重试。不会清除OA站点存储、其他账号目录、知识库、服务器会话或本机普通文件。其他浏览器中的旧资料需在该浏览器登录对应账号并打开智慧办案后清理。

## 管理员部署配置

| 变量 | 含义 |
| --- | --- |
| `CHENGYE_INTELLIGENCE_DATA_DIR` | 独立持久目录，默认 `LayerManage/law-firm-system/var/intelligence` |
| `CHENGYE_MODEL_API_KEY` | 可选部署默认凭据；管理员界面保存的组织配置优先；知识库编译仍使用原部署配置 |
| `CHENGYE_MODEL_BASE_URL` | 默认模型基础地址，默认 `https://api.deepseek.com` |
| `CHENGYE_MODEL_NAME` | 默认智慧办案模型名，默认 `deepseek-chat` |
| `CHENGYE_MODEL_ORIGINS` | 由部署管理员控制的额外可信HTTPS源；内部模型网关须显式加入此列表，普通用户不能修改 |
| `NODE_EXTRA_CA_CERTS` | 可选私有CA，保留TLS校验 |
| `CHENGYE_OCR_PYTHON` | PaddleOCR解释器绝对路径 |
| `CHENGYE_OCR_MODEL_CACHE` | 预安装OCR模型目录 |
| `CHENGYE_OCR_DEVICE` | 默认cpu |

模型URL解析和实际连接均检查地址；拒绝未授权内网、回环、链路本地地址，固定校验后的DNS结果并拒绝重定向。连通性成功确认认证、请求和流式输出，不代替完整法律任务/工具执行验收，不保证所有供应商私有API均兼容。

组织模型Key以AES-256-GCM加密保存在 `case-server/model-settings.sqlite`，同时记录最后配置管理员和时间；`case-server/credentials.key`为服务端主密钥，限制服务账号文件权限，不得进入Git、日志或前端。备份/恢复必须同时保留此密钥、组织配置和用户目录；丢失主密钥后须由管理员重新配置Key。组织共享仅指模型连接，不共享私有会话或材料。此OA部署未实现多租户模型配置隔离。

新数据：`case-server/<账号SHA256>/workspace.sqlite`（会话/状态/分片；历史个人设置不再使用），同目录UUID命名的 `.bin`（原件/成果），`engine/`（受管Harness运行目录）。知识库仍在 `wiki/`，不改变其存储及管理权限。备份建议停止服务后复制整个持久目录，以保持SQLite WAL与文件一致。

单文件200MB，4MB分片，个人总容量2GB（含可恢复删除的文件），上传分片24小时过期；不要把OA其它模块的10MB附件限制全局放宽。解析最多2个子进程、每个512MB堆、180秒、PDF最多500页；提取文本最多400万字符。解析失败保留原件、显示失败并允许重试。OCR依赖仍需运维配置，图片受OCR自身上限约束。

每账号最多4个运行任务；最多16个办案运行进程；闲置10分钟回收引擎，记录留存。单次任务15分钟上限，用户可以停止；同会话重复请求去重，版本冲突拒绝覆盖。反向代理保留 `/api/v1/intelligence/*` 不缓存、不记录正文；现有32MB请求上限足够承载4MB二进制分片的Base64编码，无需提高全局上传阈值。

## 法律助手Preset

`presets/chengye-legal/agent.cordis.yml`组合persona、受限工具和原生问询。`cloud-plugin/tools.mjs`提供只读管理员知识库检索、当前会话文件分段读取、经用户逐次确认的另存草稿、法律技能加载。技能在 `presets/chengye-legal/skills`，包括合同审查、应诉、管辖分析及中国法检索；版本2026-11-07，加载结果附内容哈希。

普通用户不能自行安装服务器插件、运行Shell或读取任意路径。知识库的 `menu.knowledge` 权限及启用状态每次检索重新校验；用户素材不会写进公共知识库。引用标注文件和行号，资料中夹带的指令不改变权限；法律结论和文书均需律师复核。

## 验证

```text
npm --prefix integrations/intelligence test
```

运行原生知识库回归及服务器工作区验收。`tests/server-case.mjs`使用隔离临时目录和本地TLS模拟模型，覆盖21MB上传、恢复、账号隔离、密钥保护、专业技能及确认后保存。`test:legacy-cleanup`验证旧资料清理的账号边界、锁及幂等性，并已纳入默认测试；旧OPFS运行脚本不再作为当前测试入口。OA真实认证权限测试在 `apps/server/test/harness/intelligence-http.test.ts`，必须使用独立 `_test` 数据库。

源码快照仍由 `third_party/deepseek-harness.source.json`记录，本轮未覆盖上游源码；保留AppFrame/SidebarRoot/ConversationRoot/InputBar与ShadowRoot主题隔离。官方仓库处于developer preview，升级需独立比较和验收，不能直接整体覆盖。
