# 律师智慧管理系统 V1.2.1

本仓库遵循 Spec 驱动开发，规格索引见 [docs/spec/TRACE.md](docs/spec/TRACE.md)。

- `LayerManage/law-firm-system/`：OA 主项目，原有业务、认证、权限与界面。
- `third_party/deepseek-harness/`：独立维护的 Harness/Wiki 上游源码快照，独立 pnpm 依赖与构建。
- `integrations/intelligence/`：OA 智能化适配、法律插件、独立知识库界面与浏览器办案工作区。

知识库在云端由管理员维护；律师仅通过 Web 使用。办案材料、会话和成果通过浏览器保存在律师电脑，无需安装客户端服务。管理员部署、模型/OCR 配置、备份及迁移说明见 [智能化适配说明](integrations/intelligence/README.md)。

当前已实施的智能化规格：[SPEC-AI-DECOUPLED-20260912](docs/superpowers/specs/2026-09-12-harness-decoupled.md)。历史 V1.1 外部连接器方案已被替代，历史代码与个人数据仍保留。

智慧办案从右上角（知识库旁）打开原生浮动工作台，可最小化、最大化并在 OA 页面间保持会话。界面规格见 [SPEC-AI-UI-20260912](docs/superpowers/specs/2026-09-12-smart-case-native-ui.md)。

下一版本 **V1.3.0** 正在实施，阶段一桌面基础已完成验证，见 [统一桌面客户端与本地 Harness 规格](docs/superpowers/specs/2026-09-13-unified-desktop-local-harness.md)：OA 业务云端校验保存、Harness 本地工作目录不自动同步、Wiki 云端管理员维护、个人材料通过在线视觉 API 识别，以及用户主动提交选定成果至案件档案。以上 V1.2.1 描述仅代表当前代码；后续开发遵循新规格。

统一桌面开发构建的启动方式见 [桌面说明](integrations/intelligence/desktop/README.md)，源码复用与实际验证见 [阶段一记录](docs/superpowers/plans/2026-09-13-unified-desktop-local-harness.md)。尚未交付独立安装器、助手云端 Wiki 查询及主动归档等后续能力。
