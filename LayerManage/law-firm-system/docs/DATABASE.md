# 当前数据库基线

2026-11-06 / dcf8447d。数据库使用PostgreSQL16，唯一权威定义为 [schema.prisma](../apps/server/prisma/schema.prisma) 和 [迁移目录](../apps/server/prisma/migrations)。当前125个Prisma模型、89个迁移目录；字段、关系、索引及顺序见 [完整模型清单](../../../docs/spec/reference/DATA-MODELS.md)。迁移目录存在不代表目标库已应用。

## 已有业务环境

- DATABASE_URL仅由本地忽略的环境文件或部署环境提供，禁止提交带凭据连接串。
- 升级前按变更风险备份，使用应用脚本db:deploy部署已提交迁移，并检查目标库迁移状态；不得用db:reset:test或空库初始化替代升级。
- 已有业务库不运行db:assert-empty作为启动门槛，也不重新system:bootstrap。
- 业务数据清理、所有权移交和字段结构迁移是不同操作，需对应任务授权。

## 新环境与测试环境

新环境按开发/初始化手册建立信任根；bootstrap仅用于尚未初始化的库。测试库必须独立、库名以_test结尾且满足ALLOW_TEST_DB_RESET保护，再使用测试重置脚本。不能对人工测试业务库执行测试重置。

## 数据语义

正式业务表来自领域真源，普通多维记录存字段ID键控JSON。软删除、归档、回收站和永久删除按各对象服务定义。审计和审批历史保留；数字、金额、日期及个人月份精度见 [FTN-001](../../../docs/spec/foundations/FTN-001-data-model.md)。

旧“22模型、所有业务表空库”说明只代表2026年7月工程初始基线，不能约束当前已录入数据的系统。本次文档更新不执行任何数据库命令。
