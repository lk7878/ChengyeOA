# 岗位/员工删除与工号复用实施记录

依据：[SPEC-MD-DELETE-20260911](../specs/2026-09-11-master-data-delete-number-reuse.md)。

- [x] 调查关联及唯一性，先建立规格。
- [x] 迁移、删除服务/API、权限与交接保护、工号复用。
- [x] 界面删除确认、中文反馈和新增提示。
- [x] 独立测试库、前后端回归/类型/lint、开发库迁移和运行验证。

验证产物：`C:/Users/HW/AppData/Local/Temp/md-delete-server-tests-final.log` 与 `md-delete-server-recheck.log`（52 项复测全通过，合计 93 项不同检查）、`md-delete-web-tests.json`（22/22）、`md-delete-web-build.log`。

本地数据备份：`C:/Users/HW/AppData/Local/Temp/chengye-before-md-delete.sql`（包含业务数据，不提交代码库）；迁移前计数 `md-delete-dev-before.json`。后端重新启动于 7001，日志 `md-delete-dev-server.out.log` / `md-delete-dev-server.err.log`，前端保持 3000 可用。

当前功能说明：仅超级管理员显示删除入口；岗位有关联时保留并提示原因；员工档案逻辑删除并保留历史，离职即释放工号。新旧员工使用不同 ID，身份证/执业证独立唯一约束不变。
