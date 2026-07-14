# Superpowers 规格驱动开发文档索引

> 项目：承业律师事务所闭环管理系统  
> 文档根目录：`docs/superpowers/`  
> 用途：统一管理从需求基线到设计、实施、决策和运维的开发文档，避免在工作空间根目录散落文件。

## 1. 目录约定

| 目录 | 用途 | 命名规则 |
|---|---|---|
| `specs/` | 经讨论形成的专项设计 Spec | `YYYY-MM-DD-<topic>-design.md` |
| `plans/` | Spec 审核通过后的可执行实施计划 | `YYYY-MM-DD-<topic>-implementation.md` |
| `adr/` | 需要长期保留的架构决策记录 | `NNNN-<decision>.md` |
| `runbooks/` | 部署、迁移、回滚、恢复和故障处置手册 | `<topic>-runbook.md` |

空目录不预先创建；产生相应文档时按上述结构建立。业务 PRD 仍以工作空间根目录的 `律所闭环管理系统需求开发文档.md` 为唯一需求基线，既有专项设计继续保存在 `docs/专项设计/`。

## 2. 文档状态

| 状态 | 含义 | 是否允许进入代码实施 |
|---|---|---|
| 草案 | 正在讨论，关键边界尚未确认 | 否 |
| 待审核 | 设计已完整，等待业务或技术确认 | 否 |
| 已批准 | 用户明确确认，可据此生成实施 Plan | 是 |
| 已实施 | 代码与验收完成，文档已同步实际结果 | 不适用 |
| 已废弃 | 已被新版本替代，保留追溯关系 | 否 |

## 3. 当前 Spec

| 编号 | 文档 | 状态 | 后续动作 |
|---:|---|---|---|
| SPEC-001 | [工程基线与 PostgreSQL 空库基线](specs/2026-07-12-engineering-baseline-postgresql-migration-design.md) | 已批准 | 按空库基线实施 Plan 执行并逐任务验收 |

## 4. 维护规则

1. 每个实施 Plan 必须引用一个已批准 Spec，并将任务拆成可测试、可回滚的小步。
2. 设计发生实质变化时先更新 Spec 或新增 ADR，再修改代码。
3. Spec、Plan、代码和数据库 migration 必须使用同一业务术语和路径约定。
4. 不在根目录新增临时分析、计划、测试报告或迁移报告；这些文件分别进入本目录或受 Git 忽略的运行产物目录。
5. 密钥、真实环境变量、数据库备份、迁移导出文件和生产日志不得写入文档或提交版本库。

## 5. 当前实施 Plan

| 对应 Spec | 文档 | 状态 | 执行门禁 |
|---|---|---|---|
| SPEC-001 | [原工程基线与 PostgreSQL 迁移实施 Plan](plans/2026-07-12-engineering-baseline-postgresql-migration-implementation.md) | 已终止于 Task 9 | Tasks 10-14 已废弃，不得继续执行 |
| SPEC-001 | [PostgreSQL 空库基线实施 Plan](plans/2026-07-14-empty-postgresql-baseline-implementation.md) | 待执行 | 从新版 Task 10 开始；数据库命令仍需用户确认 Docker 可用 |
