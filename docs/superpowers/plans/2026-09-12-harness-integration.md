# 知识库与智慧办案集成实施记录

依据：[集成规格](../specs/2026-09-12-harness-integration.md)。产品名称：律师智慧管理系统 V1.1.0。

- [x] 先记录用户目标与代码隔离、只读源项目边界。
- [x] 只读扫描 Harness 并形成接口与存储结论。
- [x] 补齐 Spec 架构和验收契约，再实现集成。
- [x] 实现独立本机连接器、桥接插件、法律 Preset、OA 两个入口和短期票据。
- [x] 完成针对性验证、使用说明和开发环境迁移/启动。
- [x] 在 OA 本地 Git 提交本次 Spec 与实现，不推送、不修改 C33 Git。

## 调研结论与代码隔离

源根 D:/2_test/C33_deepseek-harness/deepseek-harness，MIT，官方 dsh Profile 启动，实际构建版本 0.1.2-alpha.2-de7a38d-dirty。只读检查 CLI、web-app/product-bundle、product-knowledge、agent-presets 和浏览器认证扩展面，未构建或编辑源项目。

OA 后端只发出独立 audience/type 的 60 秒票据，包含用户稳定 ID、认证会话、用途和本机单次挑战；验票重新读取账号、会话和权限。OA 前端提供授权入口；integrations/harness 作为无额外依赖的外置包管理本机实例。Native Plugin 的 root slot 在 React 挂载后定位知识库，使用 URL fragment 保留认证重定向后的目标页面。

原始字节、提取文本、确定性 Wiki/来源和 LLM 编译使用原生个人 DSH_HOME 的 SQLite；未复制源项目的个人数据、密钥或缓存。每账户独立目录和实例，原生模型首次配置由律师完成。未来法律能力维护点是个人 Preset/插件，不在 OA 中复制智能体实现。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 后端登录、Token、权限目录、Harness 票据回归 | 首轮 30/30；补充账号停用验票后 Harness 专项 5/5，总计 31 项不同用例通过 |
| 前端导航、连接 API、失败提示、新窗口及远程 OA 路径 | 共 14 项通过（导航 8、API 3、页面 3） |
| 连接器协议/来源/Host/单次挑战/拒绝任意身份和地址/目录及环境隔离 | 5/5 |
| 真实原生 Profile 验收 | 两用户不同目录和端口；同用户并发请求复用同实例；虚构 Markdown 导入成功，原文与确定性 Wiki 可浏览；停止重启后原文仍在；法律 Preset 可见 |
| OA 真实 Edge 界面验收 | 真实连接器和原生 iframe，模拟 OA 票据签发/验票（后端 HTTP 另测）；名称版本、左栏、顶部知识库、连接/切换/停止通过，无页面 JS 错误 |
| 类型检查与生产构建 | server tsc、web tsc、server/web build 通过 |
| Lint | 无错误；Notification/User 各 1 项既有 Hook 依赖警告 |
| 暂存文件密钥扫描 | Gitleaks v8.30.1 使用项目规则，45 个本次变更文件扫描，0 项发现；本机配置、备份和个人资料未暂存 |
| C33 源工作区指纹 | 前后 Git status（含未跟踪列表）及 git diff --binary HEAD 的 SHA-256 均一致 |

真实测试使用 Temp 下新个人目录，不写正式用户档案或知识库；未调用收费模型。原生确定性 Wiki 有原文引用及行号，LLM 编译界面保留显式发送确认。本次不声称已验证具体法律推理质量、模型生成内容或扫描 PDF OCR。

可重复脚本：integrations/harness/test/connector.test.mjs、native-smoke.mjs、oa-browser-smoke.mjs；后二者从 OA 根运行，传入 integrations/harness/config.local.json。OA 浏览器脚本需本地 Vite 3000，测试页仅开发服务使用，生产构建不包含 e2e 页。使用说明见 [集成 README](../../../LayerManage/law-firm-system/integrations/harness/README.md)。

本机原生截图：Temp/chengye-harness-native-f39LPk/{wiki.png,legal-assistant.png}；OA 截图：Temp/chengye-oa-browser-j7drpt/{oa-smart-case.png,oa-knowledge.png}。截图已经人工检查，未把临时个人目录、原生启动 URL 或配置文件纳入 Git。

## 数据库与启动

权限迁移 20260912010000_harness_permissions 先在 chengye_org_feature_test 应用并回归。开发库 pg_dump 备份：LayerManage/law-firm-system/var/backup/before-harness-permissions-2026-09-11T17-11-25-040Z.dump；随后开发库成功应用，总计 41 份迁移。只新增 2 个菜单权限，未更改既有业务记录。

OA Node 22 后端 7001、Vite 前端 3000；本机 Node 24 连接器 43123。config.local.json 被 Git 忽略。用户刷新 OA 后可连接，助手按登录用户首次建立正式个人目录，不复制验收数据。

## 交付边界

- 未运行任何真实模型请求。律师需配置模型，并选择/添加个人案件工作目录。
- 跨站 OA 使用原生新窗口；本地网络许可受用户浏览器或企业策略控制。
- 本次不引入自动案件同步；律师自行在本机明确导入资料。
- C33 源代码与现有未提交修改保留，升级后应重新运行集成验收。
