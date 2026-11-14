# SPEC-003 组织与人员主数据实施 Handoff

## 0. 快照信息

| 项目 | 当前值 |
| --- | --- |
| 记录时间 | 2026-07-18，Asia/Shanghai |
| 主仓库 | `D:\2_test\16_ChengyeOA` |
| 当前 worktree | `D:\2_test\16_ChengyeOA\.worktrees\spec-003-organization-personnel` |
| 当前分支 | `codex/spec-003-organization-personnel` |
| 当前 HEAD | `6554a00 feat(server): add cross-office professional teams` |
| 工作树状态 | handoff 编写前为 clean |
| Git remote | 未配置；本轮没有 push、Pull Request 或远程 CI 操作 |
| 执行方式 | Inline Execution；未使用 subagent |
| Node 基线 | Node `22.14.0`、npm `10.9.2`，通过临时 `npx.cmd` 工具链调用 |
| PostgreSQL | Docker，`localhost:55432`；开发库 `chengye_oa`，测试库 `chengye_oa_test` |
| 停止位置 | Task 6 已完成并提交；Task 7 尚未开始 |

关机前没有遗留 Node、npm、tsx 测试或开发服务器进程。Docker Desktop 可随关机停止，下次开机后重新启动即可。

## 1. 目标定位

### 1.1 产品目标

承业 OA 的总体目标是建设覆盖律所经营全链路的企业级管理系统，将总所、地区分所、前瞻研究部、律师培训部、品牌宣传部及后续组织统一纳入管理，并打通：

1. 获客与网络流量运营；
2. 客服、邀约、谈案和签约；
3. 首签/证据收集合同与正式委托合同；
4. 律师办案交付；
5. 行政、财务、人事和绩效；
6. 复购、转介绍与经营分析。

项目继续以 LayerManage 作为经营 OA 基座，以 LawLink 作为案件交付与法律专业能力来源，以 LexNebulis 作为安全、审计、客户门户和企业级集成参考。数据库基线已经切换为 PostgreSQL。

### 1.2 本轮 SPEC-003 目标

本轮只实施“组织与人员主数据”，为后续 RBAC、经营统计、案件分配、绩效和跨分所专业团队提供唯一事实来源：

1. `Organization` 表达总所、总部中心、部门、分所和小组的行政树；
2. `Position` 表达组织内岗位；
3. `Employee` 只表达员工身份和档案；
4. `EmployeeAssignment` 表达主职、兼任、代理和历史；
5. `ProfessionalTeam` 与 `ProfessionalTeamMember` 表达跨地区专业团队；
6. `User.employeeId` 通过专用服务绑定员工，不放宽首位超级管理员保护；
7. 所有写操作采用稳定错误码、严格 DTO、乐观锁、同事务脱敏审计和 PostgreSQL 约束；
8. 当前临时授权只允许实时持有启用的 `SYSTEM_SUPER_ADMIN` 角色访问主数据 API。

权威设计和实施计划：

- `docs/superpowers/specs/2026-07-18-organization-personnel-master-data-design.md`
- `docs/superpowers/plans/2026-07-18-organization-personnel-master-data-implementation.md`

### 1.3 工程边界

1. 所有开发继续在当前 worktree 和分支完成，不在 `main` 上直接实现。
2. 允许创建本地 Git 提交作为恢复点。
3. 不配置 GitHub remote，不 push，不创建 PR；项目完成后由项目负责人手动推送。
4. 使用 TDD：先写失败测试并确认 RED，再实现 GREEN，最后 lint/typecheck/回归。
5. 不使用不必要的 subagent，避免长时间重复审查。
6. 不自动修改 `.env`、密钥、生产数据库或 Docker 全局配置。

## 2. 我们现在正在做什么

当前正在按 13 个 Task 的实施 Plan 顺序开发 SPEC-003。

本次关机暂停前刚完成 Task 6“跨分所专业团队”，尚未开始 Task 7“受保护的员工账号绑定”。因此，下次恢复时不要重做 Tasks 1-6，也不要直接跳到前端；应从 Task 7 Step 1 的失败测试开始。

当前架构状态：

1. Prisma 已处于 expand 阶段，共 26 个模型。
2. `Employee.orgId`、`Employee.positionId` 及旧关系暂时保留，用于 expand/contract 过渡。
3. 新增的员工调岗会同步更新 legacy `orgId/positionId`，避免 Task 9 contract migration 前出现双口径。
4. Organization 和 Position 已切换为领域服务 + 薄 Controller，物理删除路由已移除。
5. Employee、EmployeeAssignment、ProfessionalTeam 领域服务已实现，但其最终 HTTP Controller/路由统一留在 Task 8。
6. 旧 Employee Controller 仍存在，Task 8 前不要把当前 HTTP 表面误认为最终契约。
7. ProfessionalTeam 当前只有应用服务和测试，没有最终 HTTP 路由。
8. Task 9 尚未删除 Employee legacy 字段，也尚未执行 contract migration。

## 3. 当前进展与停止位置

### 3.1 Task 状态

| Task | 状态 | 本地提交 | 主要结果 |
| --- | --- | --- | --- |
| 1. Expand migration | 已完成 | `6984be9` | 26 模型、expand SQL、根组织显式 UUID/path、测试库迁移 |
| 2. 主数据基础 | 已完成 | `cd90868` | 稳定错误、严格校验、脱敏审计、临时超级管理员门禁 |
| 3. 组织树服务 | 已完成 | `63dc27a` | 创建/更新/移动/启停/树/详情、循环和根保护 |
| 4. 岗位服务 | 已完成 | `96eaebf` | 组织内编码、启停、任职占用检查、薄 Controller |
| 5. 员工与任职 | 已完成 | `370c66f` | 原子建档、主职调动、兼任/代理、转正、离职、共享投影 |
| 6. 专业团队 | 已完成 | `6554a00` | 跨分所成员、一个有效负责人、负责人替换、成员历史 |
| 7. 员工账号绑定 | 未开始 | 无 | **下次从这里开始** |
| 8. 最终 HTTP 适配 | 未开始 | 无 | Employee/Assignment/Team Controller 和路由 |
| 9. Contract migration | 未开始 | 无 | 删除 Employee legacy 组织岗位字段 |
| 10. 前端契约与守卫 | 未开始 | 无 | 类型、API、路由、菜单权限 |
| 11. 组织岗位 UI | 未开始 | 无 | 页面与响应式验证 |
| 12. 员工团队 UI | 未开始 | 无 | 页面、抽屉、跨分所团队操作 |
| 13. 最终验收 | 未开始 | 无 | 历史库演练、E2E、浏览器、全量验证、closeout |

设计和计划文档此前的本地提交：

- `0d13fc8 docs: add SPEC-003 organization and personnel design`
- `26314b2 docs: approve SPEC-003 implementation plan`

### 3.2 已实现的关键文件

数据库与基础：

- `LayerManage/law-firm-system/apps/server/prisma/schema.prisma`
- `LayerManage/law-firm-system/apps/server/prisma/migrations/20260718120000_organization_personnel_expand/migration.sql`
- `LayerManage/law-firm-system/apps/server/app/domain/master-data/master-data-errors.ts`
- `LayerManage/law-firm-system/apps/server/app/domain/master-data/master-data-validation.ts`
- `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-types.ts`
- `LayerManage/law-firm-system/apps/server/app/application/master-data/master-data-audit.ts`
- `LayerManage/law-firm-system/apps/server/app/middleware/masterDataAccess.ts`

领域服务：

- `organization-service.ts`
- `position-service.ts`
- `employee-projection.ts`
- `employee-assignment-service.ts`
- `employee-service.ts`
- `professional-team-service.ts`

以上服务均位于：

`LayerManage/law-firm-system/apps/server/app/application/master-data/`

### 3.3 已验证证据

| 阶段 | 验证结果 |
| --- | --- |
| Task 1 静态契约 | 113/113 |
| Task 1 后端全量单测 | 364/364，约 223 秒 |
| Task 2 focused | 12/12；server lint/typecheck 通过 |
| Task 3 focused | 41/41；server lint/typecheck 通过 |
| Task 4 focused | 12/12；server lint/typecheck 通过 |
| Task 5 focused | 9/9；server lint/typecheck 通过 |
| Task 6 focused | 5/5；server lint/typecheck 通过 |
| 测试库迁移 | baseline、SPEC-002、SPEC-003 expand 均成功应用 |

重要限制：Task 1 后跑过 364 个后端全量测试，但 Tasks 2-6 完成后尚未重新跑最新全量后端测试，更没有跑最终根目录 `npm run verify`。因此不能声称当前分支已完成全量回归。全量验证必须在 Task 9 和 Task 13 再执行。

### 3.4 停止时的 Git 和运行状态

handoff 编写前：

```text
branch: codex/spec-003-organization-personnel
HEAD:   6554a00 feat(server): add cross-office professional teams
remote: none
worktree: clean
running worktree-scoped node/npm/tsx processes: none
```

handoff 文档本身应形成一个新的本地 docs 提交；恢复时以实际 `git log -1` 为准。

## 4. 本轮踩坑与处理记录

| 问题 | 根因 | 已采取的处理 | 后续注意 |
| --- | --- | --- | --- |
| RED 输出过长并被截断 | 一次运行了大量 Node tests | 改为捕获输出并只显示失败摘要，完整回归使用 session 轮询 | 长测试不要把完整 TAP 一次性塞回上下文 |
| Expand 后 Organization Controller typecheck 失败 | 新增必填 `code/path/level`，旧 Controller 仍按原型创建 | 先增加 HTTP RED，再临时派生 path/level；Task 3 后由正式服务替换 | Schema 扩展后立即搜索全部旧写入点 |
| Position `orgId` 改名引发兼容问题 | Prisma 字段改为 `organizationId @map("orgId")` | 更新旧 Controller 与测试夹具，物理列不改名 | Task 9 前区分 Prisma 字段名和数据库列名 |
| Egg Controller 出现运行时 `TypeError` | 私有方法命名为 `service()`，与 Egg 基类已有 `service` 属性冲突 | 改名为 `organizationService()` / `positionService()` | 后续 Controller 不要定义名为 `service` 的方法或字段 |
| TypeScript 拒绝比较 `FIRM` | `CreateOrganizationInput` 静态类型已排除 `FIRM`，但服务仍需运行时防御 | 先提升为 `OrganizationType` 再做运行时检查 | 静态排除不能代替对不可信运行时输入的保护 |
| Prisma 外键字段不在普通 UpdateMany 类型中 | `homeOrganizationId` 是关系标量 | 使用显式 `ProfessionalTeamUncheckedUpdateManyInput`，写入前仍由服务验证组织 | 使用 Unchecked 类型时必须保留领域校验和测试 |
| 一次测试复跑错误地报 `DATABASE_URL is required` | 手工命令遗漏 `DATABASE_URL` | 判定为无效测试证据，补齐完整环境后重跑，得到正确 RED | 恢复后使用本文统一环境前缀 |
| Docker/数据库命令容易误触生产库 | 同时存在开发库和测试库 | 测试重置继续依赖 `_test` 后缀和 `ALLOW_TEST_DB_RESET=true` 双门禁 | 不要对 `chengye_oa` 执行 reset |
| npm audit 仍有已知告警 | 现有依赖基线包含审计项 | 本轮未执行 `npm audit fix`，避免无关依赖漂移 | 按 SEC-SPEC-001 门禁处理，不在 SPEC-003 顺手升级 |
| Git 显示 LF/CRLF 提示 | Windows 工作区行尾策略 | `git diff --check` 始终通过，未做全仓行尾改写 | 不要为消除提示制造无关 diff |
| 预期错误在测试日志中显示 `Unhandled request error` | 现有 errorHandler 会记录 4xx 领域错误名称 | 响应码和稳定错误均正确，未在本 Spec 扩展日志重构 | Task 13 code review 可评估是否降低预期 4xx 日志级别 |
| 部分新服务源码较为紧凑 | 为提升本轮执行效率，多个简单语句合并 | lint/typecheck 和 focused tests 均通过 | Task 13 review 可在不改行为前提下改善可读性，并保持测试全绿 |

## 5. 下次开机最短恢复步骤

### 5.1 人工准备

1. 启动 Docker Desktop，等待状态显示已运行。
2. 不需要重新执行系统 bootstrap，不需要清空开发数据库，不需要配置 GitHub。
3. 若临时 Node 22 环境没有保留，继续使用下面的 `npx.cmd` 固定工具链，不必卸载本机 Node 24。

### 5.2 恢复命令

在 PowerShell 中：

```powershell
cd D:\2_test\16_ChengyeOA\.worktrees\spec-003-organization-personnel
git status --short
git branch --show-current
git log -5 --oneline

cd LayerManage\law-firm-system
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run db:up
```

设置本地测试环境：

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='<redacted local development URL>'
$env:DATABASE_URL_TEST='<redacted local test URL>'
$env:JWT_SECRET='<generate a local value of at least 32 characters>'
$env:APP_KEYS='<generate two local application keys separated by a comma>'
$env:ALLOW_TEST_DB_RESET='true'
```

确认工具链和 Prisma：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 node --version
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run db:generate
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run typecheck
```

只有在 `node_modules` 丢失或依赖校验失败时才运行 `npm ci`；正常重启不需要重复安装三套依赖。

### 5.3 下一项准确任务

从实施 Plan 的 Task 7 Step 1 开始：

1. 创建 `employee-account-binding-service.test.ts`；
2. 先确认导入失败的 RED；
3. 实现 `employee-account-binding-service.ts`；
4. 锁定 Employee 与 User；
5. 校验用户和员工两侧的一对一绑定；
6. 只更新 `User.employeeId`，递增 Employee.version；
7. 写入 `BIND_ACCOUNT` / `UNBIND_ACCOUNT` 脱敏审计；
8. 允许通过专用服务绑定首位超级管理员，但绝对不要修改或放宽 `assertMutableUser()`；
9. 保留现有通用 `PUT /users/:id` 不能修改首位超级管理员的回归测试；
10. focused tests、lint、typecheck 通过后创建本地提交：

```text
feat(server): add protected employee account binding
```

Task 7 完成后按 Plan 继续 Tasks 8-13，不需要再次等待普通确认；只有生产性破坏操作、缺失密钥或重复三次无法解决的阻塞才暂停询问。

## 6. 恢复后的验证优先级

1. Task 7 先跑其 focused tests。
2. Task 8 完成 HTTP 适配后，补跑 master-data access、trust-root guard 和所有 master-data focused suites。
3. Task 9 contract migration 后必须 reset 测试库、generate Prisma Client、跑完整后端 tests。
4. Task 10-12 完成后跑前端测试、typecheck、lint，并按 Plan 用 Playwright 检查桌面和移动视口。
5. Task 13 才能运行最终根目录 `verify`、迁移演练、浏览器 E2E、代码审查和 closeout。

最终 closeout 前不得声称：

- 远程 CI 已通过；
- GitHub 已推送；
- contract migration 已完成；
- 全量回归已覆盖 Tasks 2-13；
- UI 或浏览器流程已验收。
