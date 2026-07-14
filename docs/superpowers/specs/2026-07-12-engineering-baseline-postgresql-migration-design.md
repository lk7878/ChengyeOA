# SPEC-001：工程基线与 PostgreSQL 空库基线设计

> 状态：已批准  
> 日期：2026-07-12  
> 批准日期：2026-07-12  
> 修订日期：2026-07-14（SQLite 数据不迁移，采用空 PostgreSQL 基线）
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0  
> 关联专项设计：`docs/专项设计/PostgreSQL迁移方案.md`、`docs/专项设计/数据库核心表设计草案.md`、`docs/专项设计/测试验收用例清单.md`  
> 实施约束：必须先依据本 Spec 生成并审核实施 Plan，再按任务执行；不得导入、合并或修改原 SQLite 数据。

## 1. 背景与问题

LayerManage 已被确认作为闭环管理系统的经营 OA 基座，但当前工程尚不具备可持续迭代所需的统一基线：

1. 工作空间根目录和 LayerManage 均未纳入统一 Git 版本管理，LawLink、LexNebulis 则各自是独立参考仓库。
2. 主工程存在根目录与 `apps/server` 两套 Prisma schema、migration、SQLite 数据库和依赖入口。
3. 两份 SQLite 文件大小和修改时间相同，但 SHA-256 不同，不能假定内容一致或直接删除其中一份。
4. 当前 `.env.example`、部署文档和 Prisma provider 均仍指向 SQLite。
5. 后端具备 lint/test 命令但未发现有效测试用例；前端没有测试命令，主工程没有统一验证入口和持续集成门禁。
6. 当前文档仍描述 Node 18、SQLite 和多种包管理器，实际前端 Vite 8 要求 Node `^20.19.0 || >=22.12.0`，工程环境存在漂移。
7. 2026-07-14 完成的双源审计确认两份 SQLite 均为历史演示或初始化数据，不包含需要保留的律所经营数据；项目负责人决定不迁移其中任何记录。

本 Spec 的目标是先建立“可版本化、可复现、可验证、可回滚”的工程底座，再开始新增 PRD 业务功能。

## 2. 目标

1. 建立统一的项目级版本管理、目录规范、环境模板和验证命令。
2. 将 PostgreSQL 16 作为开发、测试、预发布和生产的唯一关系数据库类型。
3. 将 `apps/server/prisma` 收敛为唯一 Prisma schema 和 migration 来源。
4. 保留两份 SQLite 的只读盘点与差异审计能力，但不提供活动的数据导入或迁移验证入口。
5. 在空 PostgreSQL 中保留现有 22 个模型的结构语义，不导入 UUID、业务编号、密码 Hash、金额、关联或历史记录。
6. 建立最小但真实有效的自动化质量门禁，确保后续 Spec 可以在稳定基线上按测试驱动方式实施。
7. 形成可执行的空库初始化、运行切换、回滚和恢复文档。

## 3. 非目标

本 Spec 不包含以下事项：

1. 不实现 PRD 中尚未存在的新业务域、页面、审批流、事件中心或 AI 能力。
2. 不在本基线中完成完整目标数据库模型扩建；新增核心表应由后续业务 Spec 驱动。
3. 不拆分微服务，不引入 Kubernetes、消息中间件或复杂 DevOps 平台。
4. 不进行 React、Egg.js、Prisma 等主要依赖的版本升级。
5. 不把现有字符串 JSON 字段批量改为 JSONB，不借迁移机会改变状态值或业务规则。
6. 不在本 Spec 中确定生产服务器拓扑、云厂商或对象存储供应商。
7. 不迁移 LawLink、LexNebulis 的代码；两者仅作为后续能力融合的源码参考。
8. 不预置组织、管理员、角色、权限、字典或任何经营数据；首次系统初始化由后续独立 Spec 定义。

## 4. 方案比较与结论

### 4.1 版本库边界

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 工作空间根目录作为主版本库 | 跟踪主工程、PRD 和 `docs/`；忽略两个独立参考仓库 | **采用**。文档与代码可在同一变更中审查，适合统一 Spec 驱动和 Git worktree |
| B. 仅 LayerManage 建库 | 代码边界清晰，但项目级 PRD、专项设计和 Spec 位于仓库外 | 文档与实现容易漂移 |
| C. 继续不使用 Git | 无需整理现状 | 无法可靠审查、回滚、并行开发或执行 Superpowers 计划 |

结论：后续实施在 `D:/2_test/16_ChengyeOA` 初始化主 Git 仓库，跟踪 `LayerManage/law-firm-system`、PRD 和 `docs/`；通过根 `.gitignore` 排除 `/LawLink/`、`/LexNebulis/`，不改变两个参考仓库自身历史。

### 4.2 PostgreSQL 运行方式

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 本机直接安装 PostgreSQL | 启动快，但开发机差异大，清理和多环境隔离困难 | 不采用 |
| B. Docker Compose 管理 PostgreSQL 16 | 版本固定、初始化可复现、测试库易重建 | **采用** |
| C. 直接连接远程共享库 | 无本地维护，但测试相互干扰且误操作风险高 | 不作为默认开发方式 |

开发与自动化测试使用 Docker Compose；预发布和生产只复用连接契约与 migration，不强制采用相同容器部署方式。

### 4.3 数据迁移方式

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 新建空 PostgreSQL，仅应用 schema migration | 最简单、边界最清晰 | **采用**。SQLite 已确认无有价值经营数据，应用表保持 0 行 |
| B. 直接认定一份 SQLite 为真并一次性导入 | 实施较快 | 两库 Hash 不同，存在静默丢数风险 |
| C. 主源迁移 + 次源差异报告 + 人工门禁 | 以运行时数据库为主源，比较另一份数据库后再切换 | 审计已完成，但无真实经营数据，继续导入只会引入演示数据和维护成本 |
| D. 双写一段时间 | 可降低停机切换风险 | 当前系统复杂度和使用规模不值得承担双写一致性成本 |

结论：PostgreSQL 只接收已提交的 Prisma schema migration，不接收 SQLite 数据，也不执行 system seed。两份 SQLite 及其审计结果仅作为只读历史证据保留。

## 5. 目标工程结构

```text
D:/2_test/16_ChengyeOA/
├─ .git/                                  # 实施阶段初始化
├─ .gitignore
├─ .nvmrc                                 # Node 22
├─ 律所闭环管理系统需求开发文档.md          # 唯一 PRD 基线
├─ docs/
│  ├─ 专项设计/                            # 业务与技术专项设计
│  └─ superpowers/
│     ├─ README.md
│     ├─ specs/                            # 已讨论的设计 Spec
│     ├─ plans/                            # 已批准 Spec 的实施 Plan
│     ├─ adr/                              # 长期架构决策
│     └─ runbooks/                         # 迁移、部署、回滚、恢复手册
├─ LayerManage/law-firm-system/            # 唯一主工程
│  ├─ package.json                         # 工程编排与统一验证入口
│  ├─ infra/postgres/                      # Compose 与非敏感初始化配置
│  └─ apps/
│     ├─ server/
│     │  └─ prisma/                        # 唯一 schema/migrations
│     └─ web/
├─ LawLink/                                # 独立只读参考仓库，主仓库忽略
└─ LexNebulis/                             # 独立只读参考仓库，主仓库忽略
```

根目录不再新增零散设计文件。现有根目录 PRD 和原始材料作为历史入口保留；后续新增 Spec、Plan、ADR、runbook 必须进入对应目录。

## 6. 工程基线设计

### 6.1 Git 与分支

1. 主仓库默认分支为 `main`，首次提交只包含现状基线、文档目录和忽略规则，不夹带功能开发。
2. 后续每份已批准 Spec 使用独立功能分支和 Git worktree 实施，分支建议为 `spec/<编号>-<主题>`。
3. `LawLink/`、`LexNebulis/`、`.env*`、`node_modules/`、构建产物、运行日志、本地数据库、迁移备份、迁移导出和 `.worktrees/` 必须忽略。
4. `.env.example`、Compose 示例、migration SQL 和无敏感信息的 runbook 必须纳入版本管理。
5. 禁止提交 API Key、数据库口令、JWT 密钥、真实客户数据和生产日志；提交前由自动化检查阻断常见密钥模式。

### 6.2 运行时与依赖

1. 统一使用 Node 22 LTS 和 npm，`.nvmrc`、`package.json#engines`、CI 三处保持一致。
2. 本 Spec 不转换 npm workspace；保留现有根编排包和两个应用包，降低数据库迁移之外的工程变动。
3. 移除主工程根包中重复的 Prisma 运行依赖；Prisma CLI 与 Client 只由 `apps/server` 管理。
4. 保留各应用当前 lockfile；本次仅为新增测试工具、环境校验和 Prisma 收敛产生必要变更。
5. 所有脚本必须可在 Windows PowerShell 和 CI 环境执行，避免依赖 Bash 专用语法。

### 6.3 环境配置

后端至少区分以下配置：

```env
NODE_ENV=development
DATABASE_URL=postgresql://chengye_app:change_me@localhost:5432/chengye_oa?schema=public
DATABASE_URL_TEST=postgresql://chengye_test:change_me@localhost:5432/chengye_oa_test?schema=public
JWT_SECRET=replace_with_at_least_32_random_characters
APP_KEYS=replace_with_multiple_random_keys
```

规则：

1. `.env.example` 只保留不可用的示例值；真实值写入被忽略的 `.env`。
2. 应用启动时校验必需变量；生产环境缺失或仍使用示例密钥时拒绝启动。
3. 开发、测试、预发布、生产使用不同数据库、用户和口令。
4. 应用数据库账号仅拥有目标 schema 所需权限；migration 账号与运行账号在预发布、生产分离。
5. FAL、DashScope 等 AI 密钥不纳入本 Spec，仅保留后续环境配置扩展能力。

### 6.4 统一命令

主工程 `LayerManage/law-firm-system/package.json` 应提供下列稳定入口，具体底层命令由实施 Plan 确定：

| 命令 | 作用 | 通过标准 |
|---|---|---|
| `npm run setup` | 安装各包依赖并生成 Prisma Client | 无错误，重复执行结果一致 |
| `npm run db:up` / `db:down` | 启停本地 PostgreSQL | 健康检查通过；停止不删除数据卷 |
| `npm run db:reset:test` | 仅重建测试库并应用 migration | 必须拒绝非测试数据库 URL；完成后应用表均为 0 行 |
| `npm run db:migrate` | 开发环境创建/应用 migration | 只使用后端 canonical schema |
| `npm run db:deploy` | 应用已提交 migration | 不生成新 migration，不重置数据 |
| `npm run lint` | 前后端静态检查 | 零错误 |
| `npm run typecheck` | 前后端类型检查 | 零错误 |
| `npm run test` | 前后端自动化测试 | 全部通过 |
| `npm run build` | 构建前后端 | 构建成功且无缺失环境依赖 |
| `npm run verify` | 顺序执行 lint、typecheck、test、build | 作为提交和 CI 的统一门禁 |

## 7. Prisma 与 PostgreSQL 设计

### 7.1 唯一来源

1. `apps/server/prisma/schema.prisma` 是唯一 Prisma schema。
2. `apps/server/prisma/migrations/` 是唯一 PostgreSQL migration 历史。
3. 本基线不执行 seed；现有 `apps/server/prisma/seed.ts`、`db:seed` 命令和 seed 专属测试从活动工程入口移除。
4. 主工程根目录现有 `prisma/` 在数据审计完成后从运行路径删除；其中 SQLite 文件继续以未跟踪、只读方式保留。
5. 后续如需创建首次组织、超级管理员、角色或权限，必须由独立初始化 Spec 定义接口、权限和审计要求，不得恢复隐式启动 seed。

### 7.2 Schema 转换规则

1. datasource provider 从 `sqlite` 改为 `postgresql`，连接只读取 `DATABASE_URL`。
2. 现有模型主键继续使用 UUID 字符串定义，但空库初始化不生成任何业务主键或记录。
3. 现有 `Decimal` 金额字段显式映射为 `Decimal @db.Decimal(18, 2)`。
4. 后续写入 PostgreSQL 的 `DateTime` 统一按 UTC 保存，前端按 `Asia/Shanghai` 展示。
5. 现有 `tags`、`paymentTerms`、`teamIds`、`kpiData` 等字符串 JSON 保持 String 语义，不自动改为 JSONB。
6. 现有状态字符串、软删除语义和外键删除策略不在本次迁移中重构。
7. PostgreSQL baseline migration 从空库生成并审查，不继续复用 SQLite 方言 migration；SQLite schema、migration 和数据库文件只作为只读证据归档。
8. 所有后续物理表结构变化只能通过已提交的 Prisma migration 实施，系统配置页面不得直接执行 DDL。

### 7.3 PostgreSQL 实例

开发 Compose 至少提供：

1. 固定主版本 PostgreSQL 16，不使用 `latest` 标签。
2. 独立的应用库 `chengye_oa` 和测试库 `chengye_oa_test`。
3. 健康检查、持久化 volume、UTF-8 编码和 `Asia/Shanghai` 会话时区；业务时间仍以 UTC 写入。
4. 端口、数据库名、用户可由本地环境覆盖，默认值不得包含真实生产凭据。
5. `docker compose down` 默认保留 volume；删除数据必须使用单独的显式命令并带环境保护。

## 8. SQLite 只读审计与空库初始化设计

### 8.1 审计结论

2026-07-14 完成双源只读审计，结论如下：

| 路径 | SHA-256 | 结论 |
|---|---|---|
| `LayerManage/law-firm-system/apps/server/prisma/law_firm.db` | `B61917FFA7823F15CA9F9A20EB95463B28F0A7AB161108338FFBE068CAD48E11` | 旧演示 seed 数据，不作为迁移源 |
| `LayerManage/law-firm-system/prisma/law_firm.db` | `9A8F3EED9B429190643CE1A55F11F61A2B3DD4329C28DA3E4F6182F93A8C629C` | 旧初始化 seed 数据，不作为迁移源 |

完整审计决策记录见 `docs/superpowers/runbooks/sqlite-to-postgresql-migration.md`。原 SQLite 文件不得删除、改写、checkpoint 或纳入 Git；它们不再承担主源、恢复源或运行时回退数据库职责。

### 8.2 保留与退出的工具边界

1. 保留只读 `migration:inventory` 和 `migration:diff`，仅用于历史文件审计或未来未知数据源的诊断。
2. 移除 `migration:import`、`migration:validate` 的命令入口、实现和专属测试，避免形成错误的数据导入预期。
3. 审计运行产物继续写入受 Git 忽略的 `LayerManage/law-firm-system/var/migration/<run-id>/`，不得包含未脱敏个人信息。
4. 已提交的非敏感审计摘要和 Hash 继续保留；完整导出和逐行报告不得提交。

### 8.3 PostgreSQL 空库初始化

1. 启动 PostgreSQL 16，并确认目标数据库是新建或已通过受保护命令清空的环境。
2. 仅执行已提交的 Prisma migration，创建现有 22 个应用模型对应的结构。
3. 不执行 `db:seed`，不导入 SQLite，不创建组织、人员、用户、角色、权限、渠道或其他记录。
4. 校验 Prisma migration 状态为最新，并逐表确认所有应用表均为 0 行。
5. Prisma 自身的 `_prisma_migrations` 元数据表允许存在 migration 记录，不计入“空数据库”的业务数据判定。
6. 重复重建测试数据库并应用 migration，结果必须一致，且不依赖本机残留文件或历史 volume 内容。

### 8.4 空库验收规则

| 维度 | 必须通过的检查 |
|---|---|
| 数据源隔离 | PostgreSQL 中不存在来自任一 SQLite 的记录，原 SQLite Hash 保持不变 |
| 结构 | canonical schema 的 22 个应用模型均可由已提交 migration 在空库创建 |
| 数据 | 除 `_prisma_migrations` 外，全部应用表行数为 0 |
| 初始化 | 安装、启动、migration 和 CI 不隐式调用 seed 或创建管理员 |
| 单一来源 | 运行时仅识别 `apps/server/prisma/schema.prisma` 及其 migrations |
| 可重复性 | 两次独立空库初始化得到相同 schema 和相同 0 行结果 |

## 9. 测试与持续集成

### 9.1 最小测试基线

1. 后端保留 Egg 测试框架，新增 PostgreSQL 连接、migration、空库断言和核心 schema 集成测试。
2. 前端引入 Vitest、React Testing Library 和 jsdom，至少覆盖应用启动、登录页渲染、路由保护和 API 错误态。
3. SQLite 审计工具必须覆盖：只读打开、源文件不变、两库差异识别、报告脱敏和错误中断；不测试或保留数据导入能力。
4. 不以 SQLite 内存库替代 PostgreSQL 测试；数据库特性必须在真实 PostgreSQL 16 测试实例验证。
5. 测试库每次重建前校验数据库名或显式安全标记，任何生产样式 URL 均拒绝 reset。

### 9.2 CI 门禁

CI 在干净环境中执行：

1. 校验 Node/npm 版本和 lockfile 安装。
2. 启动 PostgreSQL 16 服务并等待健康检查。
3. 应用全部 migration，不执行 seed，并断言全部应用表为 0 行。
4. 执行 `npm run verify`。
5. 再次在空测试库执行 migration，防止依赖本地残留状态。
6. 检查 Git 工作区无未提交的生成文件或 schema 漂移。

## 10. 启用与回滚

### 10.1 PostgreSQL 启用门禁

以下条件全部满足才允许将 PostgreSQL 作为唯一运行数据库：

1. 两份 SQLite 的审计结论已记录为“不迁移”，且导入命令已退出活动入口。
2. PostgreSQL baseline migration 可在空库重复创建完整结构。
3. 除 `_prisma_migrations` 外，全部应用表为 0 行，启动过程不会隐式写入数据。
4. `npm run verify`、数据库健康检查和 schema 烟雾测试通过。
5. 原 SQLite Hash 未变化，且应用配置、脚本和文档不再连接 SQLite。
6. 首次管理员尚未创建属于已知预期；需要登录的业务验收必须等待后续初始化 Spec。

### 10.2 回滚策略

1. 基线阶段不存在 SQLite 运行时回退；启用失败时停止应用，保留失败库和日志后重建空 PostgreSQL。
2. 空库尚无业务写入时，可通过受保护的数据库重建命令恢复到 baseline migration 状态。
3. 一旦后续 Spec 已产生真实业务写入，回滚必须使用 PostgreSQL 备份、应用版本和受控补偿脚本，不得切回 SQLite。
4. SQLite 历史文件继续只读保留，删除需单独审批，但不影响 PostgreSQL 的启用与恢复。
5. Prisma migration 不承诺自动 down migration；上线前仍须完成 PostgreSQL 备份与恢复演练。

## 11. 安全与可运维性

1. 生产连接启用 TLS；数据库端口不直接暴露公网。
2. 生产开启慢查询和连接监控，应用日志不得输出完整连接串或敏感字段。
3. 开发备份用于恢复验证；生产备份延续 PRD 的 RPO 不超过 1 小时、RTO 不超过 4 小时目标，并在上线前完成恢复演练。
4. schema migration 执行者、时间、版本、结果和失败原因必须留痕。
5. `/health` 只返回服务和数据库可用状态，不泄露版本、连接地址、表名或错误堆栈。
6. 本 Spec 产生的 SQLite 审计报告默认仅限开发和系统管理员查阅，不作为普通业务页面功能。

## 12. 文档交付物

实施完成时应更新或新增：

1. `docs/superpowers/plans/2026-07-12-engineering-baseline-postgresql-migration-implementation.md`。
2. `docs/superpowers/adr/0001-project-repository-boundary.md`。
3. `docs/superpowers/adr/0002-postgresql-and-canonical-prisma.md`。
4. `docs/superpowers/runbooks/local-development.md`。
5. `docs/superpowers/runbooks/sqlite-to-postgresql-migration.md`。
6. `docs/superpowers/runbooks/postgresql-backup-restore.md`。
7. 同步修订 `LayerManage/law-firm-system/docs/DEVELOPMENT.md` 和 `DEPLOY.md` 中过期的 SQLite、Node 18 和启动说明。

## 13. 验收标准

本 Spec 的实施只有在以下条件全部满足时才算完成：

1. 主仓库已建立，文档和主工程可版本化，两个参考仓库未被主仓库误纳入。
2. 新开发者仅依据 runbook 可在干净环境启动 PostgreSQL、安装依赖、应用 migration 并运行数据库健康检查。
3. 工程中只有一套运行时 Prisma schema 和 migration 来源，基线不包含活动 seed 入口。
4. 应用运行时不再依赖 SQLite，开发和测试均连接 PostgreSQL 16。
5. 两份 SQLite 均有 Hash、盘点和差异报告，审计结论明确为不迁移，原文件保持不变。
6. `migration:import`、`migration:validate` 和 `db:seed` 不再是活动命令；仅保留只读 inventory/diff 能力。
7. 前后端具备实际测试用例，统一 `verify` 命令和 CI 在干净环境通过。
8. 密钥、本地数据库、备份、迁移明细和构建产物均未进入 Git。
9. 两次独立空库初始化均可创建相同 schema，且除 `_prisma_migrations` 外全部应用表为 0 行。
10. PostgreSQL 备份、恢复和空库重建演练完成并形成 runbook 记录。

## 14. 风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 误将 SQLite 演示数据导入 | 污染正式基线 | 移除 import/validate 活动入口，保留审计 Hash 与只读工具 |
| 启动或 migration 隐式写入 seed | 空库不再为空 | CI 逐表 0 行断言，移除活动 seed 入口 |
| SQLite 与 PostgreSQL 类型行为不同 | 后续金额、时间、唯一性错误 | 显式 Decimal、时区规则、真实 PostgreSQL 集成测试 |
| 重复 Prisma 入口继续被误用 | schema 漂移 | 单一目录、移除重复依赖、CI 漂移检查 |
| 本次基线夹带业务模型重构 | 范围失控、难以定位回归 | 保持现有 22 模型语义，新增业务表另立 Spec |
| 测试 reset 误连非测试库 | 数据破坏 | 数据库名/环境标记双重校验，生产 URL 拒绝执行 |
| Node 与依赖环境漂移 | 无法复现构建 | Node 22 锁定、lockfile 安装、CI 版本检查 |
| 审计文件包含敏感数据 | 信息泄露 | 运行目录 Git 忽略、报告脱敏、最小访问权限 |

## 15. 审核结论项

批准本 Spec 即表示确认以下设计决定：

1. 以工作空间根目录建立主 Git 仓库，主工程和项目文档同库管理，LawLink/LexNebulis 继续作为独立参考仓库。
2. 使用 Docker Compose 管理开发和测试 PostgreSQL 16，统一 Node 22 + npm。
3. `apps/server/prisma` 是唯一 Prisma schema 和 migration 来源，根目录重复 Prisma 入口在完成审计归档后移除。
4. 两份 SQLite 均不是迁移源或回退库，仅保留只读 inventory/diff 审计能力。
5. 本次基线保持现有 22 个模型与字符串 JSON 语义，不同步扩建完整 PRD 数据模型。
6. PostgreSQL 仅应用 schema migration；不导入数据、不执行 seed，全部应用表保持 0 行。
7. 首次组织、管理员、角色和权限初始化由后续独立 Spec 处理，不属于本基线。
8. Spec 批准后先生成逐任务实施 Plan，再按测试驱动与分支隔离方式执行，不直接开始批量生成业务代码。
