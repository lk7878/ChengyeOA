# 承业智慧办案 · OA 独立子系统

OA 统一身份、案件和个人文件；本项目提供概览、四项专项能力、知识库及默认通用法律助手。私人任务采用独立 Harness 进程和材料目录，知识经固定快照审核后发布，成果先保存个人空间再由律师确认归档。

- [部署、配置、备份和外网切换](docs/integration/DEPLOYMENT.md)
- [执行基线与权限矩阵](docs/integration/progress.md)
- [验收记录](docs/integration/VALIDATION.md)

Linux 入口是 `case-service/src/index.js` 与 `deploy/integration`。原 Windows 启动脚本及 `legacy-index.js` 仅作为提供时源码参考，不是当前部署入口。旧账号密码、共享 Harness cookie 与同组全案可见接口不再挂载。

真实配置、数据库、案件材料、源知识资料、构建产物和依赖不进 Git。第三方法律技能的固定来源和许可证见 `third_party/legal-skills`。
