# SPEC-004 权限体系实施 Handoff

## 0. 快照信息

| 项目 | 当前值 |
| --- | --- |
| 记录时间 | 2026-07-19，Asia/Shanghai |
| 主工作区 | `D:\2_test\16_ChengyeOA` |
| 当前 worktree | `D:\2_test\16_ChengyeOA\.worktrees\spec-004-rbac-data-scope` |
| 项目目录 | `LayerManage/law-firm-system` |
| 后端目录 | `LayerManage/law-firm-system/apps/server` |
| 当前实施依据 | `docs/superpowers/specs/2026-07-18-rbac-data-scope-sensitive-permissions-design.md` |
| 当前实施 Plan | `docs/superpowers/plans/2026-07-18-rbac-data-scope-sensitive-permissions-implementation.md` |
| 执行方式 | 本地 inline execution，减少不必要 subagent，不执行 GitHub 操作 |
| 数据库 | PostgreSQL 16，Docker，`localhost:55432` |
| 当前进度 | Tasks 1-8 已完成；Task 9 正在实施 |
| 精确停点 | Task 9 薄 API 已初步实现，最新 API/lint/typecheck 复验因关机要求主动中止 |
| 关机状态 | worktree 范围内 Node/npm/tsx 进程已确认清零；Docker Desktop 可正常关闭 |
| 剩余时间估算 | 约 5-8 小时有效执行时间，受最终构建和浏览器验收速度影响 |

重要：最后启动的 `authorization-api.test.ts`、lint 和 typecheck 会话被主动终止，没有产生可采信的最终结果。下次恢复必须先重跑，不能把 Task 9 标记为完成。

## 1. 目标定位

### 1.1 产品目标

承业 OA 以 LayerManage 为经营管理基座，目标是覆盖总所、地区分所、前瞻研究部、律师培训部、品牌宣传部及后续组织单元，并逐步贯通：

1. 网络获客、渠道运营与流量数据；
2. 客服、邀约、谈案和签约；
3. 首签/证据收集合同与正式委托合同；
4. 律师办案交付、节点协作和文档管理；
5. 行政、财务、人事、绩效和经营分析；
6. 复购、转介绍和客户全生命周期闭环。

工程基线已经收敛到 PostgreSQL 单数据库。SQLite 没有需要保留的经营数据，旧 SQLite 运行时和迁移代码已在本轮按严格范围删除。

### 1.2 SPEC-004 目标

本轮建立企业级统一授权内核：

1. `RBAC + DataScope + FieldPermission + SpecialPermission + Audit`；
2. 八类数据范围：`ALL`、`HQ_SCOPE`、`ORG`、`BRANCH`、`TEAM`、`SELF`、`SELF_AND_SUBORDINATES`、`CUSTOM`；
3. 多角色授权并集、永久/限时角色和最长 30 天专项权限；
4. L1-L4 字段分级、脱敏、原文访问、写入和导出独立控制；
5. 权限来源、范围、字段能力、有效期和拒绝原因追踪；
6. 首位超级管理员信任根、防自授权、防保留角色提权和脱敏审计；
7. 将 SPEC-003 组织人员接口由临时超级管理员门禁迁移到正式权限和数据范围。

## 2. 已完成进展

### 2.1 Task 状态

| Task | 状态 | 主要结果 |
| --- | --- | --- |
| 1. 锁定契约与基线 | 已完成 | SPEC-004 静态契约、模型和权限目录基线 |
| 2. PostgreSQL 授权模型 | 已完成 | 授权模型、迁移、约束、索引和目录元数据 |
| PostgreSQL 单库收敛 | 已完成 | 删除 SQLite 运行时、迁移脚本、测试和依赖 |
| 3. 授权上下文与动作内核 | 已完成 | 实时上下文、动作权限、中间件和工厂 |
| 4. 数据范围与解析器 | 已完成 | 八类范围、列表/详情一致性、递归下属范围 |
| 5. 汇报关系 | 已完成 | 历史关系、循环校验、离职约束和审计 |
| 6. 字段和敏感访问 | 已完成 | L1-L4 投影、L3 审计、L4 用途绑定访问 |
| 7. 业务角色策略 | 已完成 | 版本化角色、权限/范围/字段原子替换 |
| 8. 用户授权与追踪 | 已完成 | 角色授权、专项授权、撤销历史、权限追踪 |
| 9. 薄 API 与旧接口收敛 | 进行中 | 路由契约已通过；Controller/API 复验待恢复 |
| 10-16 | 未开始 | 正式接入业务 API、前端权限中心、最终验收 |

### 2.2 已验证证据

| 范围 | 最近结果 |
| --- | --- |
| Task 8 全部 authorization 测试 | `41/41` 通过，退出码 0，约 118 秒 |
| Task 8 后端 lint | 通过 |
| Task 8 后端 typecheck | 通过 |
| Task 9 路由契约 | `2/2` 通过，退出码 0 |
| Task 9 API RED | 已确认因新接口缺失、旧接口仍存在、旧 DTO 过宽而失败 |
| Task 9 最新 GREEN 复验 | 被关机请求主动中止，结果未知，必须重跑 |

数据库测试必须使用 `--test-concurrency=1`。多个数据库测试文件并行运行会共同清理 `chengye_oa_test`，产生假失败、外键错误或死锁。

## 3. Task 9 当前精确停点

### 3.1 已新增或修改

新增测试：

- `apps/server/test/ci/spec-004-router-contract.test.ts`
- `apps/server/test/app/authorization-api.test.ts`

新增 Controller：

- `apps/server/app/controller/authorization.ts`
- `apps/server/app/controller/employeeReportingLine.ts`

重写或修改：

- `apps/server/app/controller/role.ts`
- `apps/server/app/controller/permission.ts`
- `apps/server/app/controller/user.ts`
- `apps/server/app/router.ts`
- `apps/server/app/application/authorization/role-authorization-service.ts`
- `apps/server/app/application/authorization/user-grant-service.ts`
- `apps/server/app/application/master-data/master-data-factory.ts`
- Egg 生成类型位于 `apps/server/typings/`

### 3.2 已接入的路由

已经在 Router 中注册并绑定 `requirePermission()`：

1. `/api/v1/authorization/me`
2. `/api/v1/authorization/me/trace`
3. `/api/v1/authorization/sensitive-view`
4. `/api/v1/authorization/trace/users/:id`
5. `/api/v1/permissions/catalog`
6. 角色查询、创建、修改、启停、权限/范围/字段替换接口
7. 用户授权摘要、角色授权/撤销、专项授权/撤销接口
8. 员工汇报关系查询、创建/调整和结束接口

Router 已移除：

- `DELETE /api/v1/roles/:id`
- `POST /api/v1/users/:id/roles`
- `POST /api/v1/roles/:id/permissions`

对应路由契约测试已经 `2/2` 通过。

### 3.3 最后一轮修正

在被中止的最后一轮验证前，刚修正：

1. `RoleController` 的私有 `service()` 与 Egg 基类 `service` 属性冲突，已改名为 `roleAuthorizationService()`；
2. 路由契约测试中的无意义双引号转义已移除；
3. 未认证响应测试不再把稳定错误码 `TOKEN_INVALID` 中的单词 `token` 误判为敏感值泄漏。

这三项修改尚未完成复验。

## 4. 已遇到的坑与处理

| 问题 | 根因 | 已采取处理 | 后续注意 |
| --- | --- | --- | --- |
| 数据库测试并行出现随机失败 | 测试文件共享并清空同一个 PostgreSQL 测试库 | 所有 DB 测试强制 `--test-concurrency=1` | 不要并行运行两个 DB 测试命令 |
| 单组测试打印通过后外层超时 | Node/Prisma 进程退出较慢，180 秒外层超时过紧 | 全授权回归使用 600 秒并正常退出 | 长 DB 回归使用 5-10 分钟 timeout |
| 测试报 `DATABASE_URL is required` | 手工命令只设置了 `DATABASE_URL_TEST` | 补齐开发库和测试库 URL 后重跑 RED | Egg app 测试始终设置两个 URL |
| Egg Controller 编译冲突 | 私有方法名 `service()` 与 Egg 基类属性重名 | 改为业务明确的方法名 | 后续 Controller 不要定义 `service` |
| 权限追踪跨用户拒绝码错误 | `permission.trace.any` 是 SPECIAL，通用服务返回专项错误 | 追踪入口统一映射为 `PERMISSION_DENIED` | 保持防对象枚举，不改全局 SPECIAL 规则 |
| lint 报测试正则无意义转义 | `['\"]` 中双引号无需转义 | 改成 `['"]` 的源码等价形式 | 恢复后先重跑 lint 确认 |
| API RED 首次敏感词断言误报 | `TOKEN_INVALID` 本身包含 token | 改为检查 Prisma、SQL、密码、哈希和 Bearer | 稳定安全错误码不属于凭据泄漏 |
| 旧信任根 API 测试可能回归失败 | 旧测试仍调用已删除的整体覆盖和物理删除接口 | 尚未处理 | Task 9 必须更新为新授权/撤销语义 |
| SQLite 遗留增加维护面 | 旧 SQLite 无有价值数据且已切 PostgreSQL | 删除旧脚本、fixture、依赖和命令 | 不恢复 `better-sqlite3` 或旧 migration 命令 |
| 本机 Node 24 与工程基线不同 | 本机全局 Node 为 24，工程要求 Node 22.14 | 迭代测试暂用本地 tsx 提速 | 最终验证必须回到 Node 22.14/npm 10.9.2 |

## 5. 恢复后首先检查的风险点

1. `UserGrantService.summary()` 新增的 Prisma `permissionGrants` include 和返回类型是否通过 typecheck。
2. `RoleAuthorizationService.list()` 的分页和 `ROLE_INCLUDE` 映射是否通过 typecheck。
3. `authorization-api.test.ts` 的角色授权后，权限追踪 `sourceId` 是否等于授权记录 ID。
4. 永久授权的 `validFrom` 与追踪请求的 `evaluatedAt` 是否存在毫秒边界问题。
5. `UserController.assignRoles()` 方法目前可能仍保留在源码中，但路由已经移除。Task 9 完成前应删除不可达的旧危险方法及其不再需要的 import。
6. 旧 `trust-root-guard.test.ts` 仍可能期待旧删除/覆盖接口返回 200 或受保护错误，需要改写到新 API，不能恢复旧路由迁就测试。
7. `errorHandler` 会对预期 4xx 记录 error 日志，这是旧行为；本 Task 只需保证响应不暴露原始异常，日志级别优化可留到最终 review。
8. 最新 Egg typings 已用本地 `node_modules/.bin/ets.cmd` 生成，但 Controller 再变化后要重新生成。

## 6. 下次开机最短恢复步骤

### 6.1 人工准备

1. 启动 Docker Desktop，等待 PostgreSQL 容器健康。
2. 不需要重新 bootstrap。
3. 不需要清空开发数据库。
4. 不需要执行 Git、GitHub、push、PR 或 remote 操作。
5. `node_modules` 若仍存在，不要重复 `npm install` 或 `npm ci`。

### 6.2 进入目录并设置测试环境

```powershell
cd D:\2_test\16_ChengyeOA\.worktrees\spec-004-rbac-data-scope\LayerManage\law-firm-system\apps\server

$env:NODE_ENV='test'
$env:DATABASE_URL='<redacted local development URL>'
$env:DATABASE_URL_TEST='<redacted local test URL>'
$env:JWT_SECRET='<generate a local value of at least 32 characters>'
$env:APP_KEYS='<generate two local application keys separated by a comma>'
$env:ALLOW_TEST_DB_RESET='true'
```

### 6.3 第一组必须重跑的命令

可并行运行 lint 和 typecheck；API 数据库测试单独串行：

```powershell
npm.cmd run typecheck
npm.cmd run lint

.\node_modules\.bin\tsx.cmd --test --test-force-exit --test-concurrency=1 `
  test/ci/spec-004-router-contract.test.ts `
  test/app/authorization-api.test.ts
```

建议 API 测试 timeout 至少 300 秒。若失败，按完整错误逐项定位，不要一次叠加多个猜测修复。

### 6.4 Task 9 完成顺序

1. 修复上述重跑产生的真实错误；
2. 删除 `UserController.assignRoles()` 旧实现和失效 import；
3. 更新旧 trust-root/角色 API 测试到版本化授权接口；
4. 重新运行 `ets.cmd` 生成 Egg 类型；
5. 重跑 Task 9 API 和路由契约；
6. 串行运行全部 `test/authorization/*.test.ts`；
7. 运行相关 app 信任根、认证和主数据门禁回归；
8. lint/typecheck 全绿后，才把 Task 9 标记为完成；
9. 随即进入 Plan 的 Task 10，不需要再次等待普通确认。

## 7. 后续剩余任务

| Task | 内容 | 粗略时间 |
| --- | --- | --- |
| 9 | 完成薄 API、旧接口测试迁移和回归 | 约 1-2 小时 |
| 10 | 组织、岗位正式动作权限和数据范围 | 约 0.5-1 小时 |
| 11 | 员工、任职、汇报、账号绑定授权 | 约 0.5-1 小时 |
| 12 | 专业团队授权 | 约 0.5 小时 |
| 13 | 后端全部路由迁移、防提权回归 | 约 0.5-1 小时 |
| 14 | 前端权限状态、菜单和路由 | 约 0.5-1 小时 |
| 15 | 角色、用户授权、追踪和我的权限页面 | 约 1-2 小时 |
| 16 | 迁移演练、性能、E2E、安全和本地收尾 | 约 1-2 小时 |

以上是有效执行时间估算，不含 Docker 异常、依赖重新下载或浏览器环境故障。

## 8. 执行纪律

1. 用户要求所有代码先在本地完成，不执行 GitHub 推送、PR 或远程 CI。
2. 用户要求提高效率，避免不必要 subagent 和重复全量验证。
3. 每个 Task 先跑聚焦测试，跨 Task 全量验证集中在明确边界和 Task 16。
4. 数据库测试串行；lint、typecheck、静态契约可并行。
5. 任何测试失败先确认根因；不要恢复旧危险接口来迁就历史测试。
6. 最终官方验收使用 Node `22.14.0`、npm `10.9.2`、PostgreSQL 16。
7. 不修改 `.env`、生产数据库、密钥或 Docker 全局设置；如需人工配置，给出最短步骤并明确告知用户。
8. 不宣称 Task 9、SPEC-004 或全项目完成，直到 Plan 规定的本地验收全部通过。

## 9. 关机确认

Handoff 写入前已检查并停止命令行指向当前 worktree 的 Node 进程。最终检查结果：

```text
worktree-scoped node/npm/tsx processes: 0
active test sessions required by this task: 0
GitHub operations performed: 0
```

可以安全关闭 Docker Desktop 和电脑。
## 2026-07-19 Continued Execution Update

- Task 10 complete: organization and position action/scope enforcement, hidden 404, ORG/BRANCH/HQ_SCOPE/ALL behavior.
- Verification: service tests 21/21; API/router/SPEC-003 tests 9/9 on Node 22.14.0 with `--test-force-exit`; 500-node tree remains one query.
- Task 11 in progress: employee lifecycle authorization is implemented and tests pass 7/7.
- Employee assignment authorization is implemented and tests pass 5/5.
- Added employee-target scope resolution for account binding and reporting lines.
- Fixed snake_case resource to Prisma camelCase delegate lookup for assignment, reporting-line, team, and team-member records.
- PostgreSQL remains on host port 54329; port 55432 is excluded by Windows.
- Next: account-binding and reporting-line RED/GREEN, employee field projection/write checks, exact employee routes. Task 12 has not started.
