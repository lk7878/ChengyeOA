# 律师智慧管理系统 V1.2.0

本仓库遵循 Spec 驱动开发，规格索引见 [docs/spec/TRACE.md](docs/spec/TRACE.md)。

- `LayerManage/law-firm-system/`：OA 主项目，原有业务、认证、权限与界面。
- `third_party/deepseek-harness/`：独立维护的 Harness/Wiki 上游源码快照，独立 pnpm 依赖与构建。
- `integrations/intelligence/`：OA 智能化适配、法律插件、独立知识库界面与浏览器办案工作区。

知识库在云端由管理员维护；律师仅通过 Web 使用。办案材料、会话和成果通过浏览器保存在律师电脑，无需安装客户端服务。管理员部署、模型/OCR 配置、备份及迁移说明见 [智能化适配说明](integrations/intelligence/README.md)。

当前智能化规格：[SPEC-AI-DECOUPLED-20260912](docs/superpowers/specs/2026-09-12-harness-decoupled.md)。历史 V1.1 外部连接器方案已被替代，历史代码与个人数据仍保留。
