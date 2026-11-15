# 律师智慧管理系统

OA 业务工程位于 `LayerManage/law-firm-system`。业务、身份、权限及文件规格见 [Spec 总纲](docs/spec/README.md)。

2026-11-15 智能模块改为独立智慧办案子系统：OA 只保留“智慧办案”入口；旧浮动助手、旧知识库入口、旧 Harness 源码快照、专属 API 和运行数据已退出。OA 个人文件新增分片续传、不可变内容版本、明确发布授权及全员只读审计入口。

[集成接口与部署说明](docs/smart-case-integration.md) 说明两个项目的边界、运行入口、验收结果和外网切换状态。历史 `docs/superpowers` 智能化方案仅作历史记录，不能作为本次启动或部署指引。
