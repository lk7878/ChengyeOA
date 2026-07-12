# SPEC-001：工程基线与 PostgreSQL 迁移设计

> 状态：已批准  
> 日期：2026-07-12  
> 批准日期：2026-07-12  
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0  
> 关联专项设计：`docs/专项设计/PostgreSQL迁移方案.md`、`docs/专项设计/数据库核心表设计草案.md`、`docs/专项设计/测试验收用例清单.md`  
> 实施约束：必须先依据本 Spec 生成并审核实施 Plan，再按任务执行；不得跳过数据差异人工门禁。

## 1. 背景与问题

LayerManage 已被确认作为闭环管理系统的经营 OA 基座，但当前工程尚不具备可持续迭代所需的统一基线：

1. 工作空间根目录和 LayerManage 均未纳入统一 Git 版本管理，LawLink、LexNebulis 则各自是独立参考仓库。
2. 主工程存在根目录与 `apps/server` 两套 Prisma schema、migration、SQLite 数据库和依赖入口。
3. 两份 SQLite 文件大小和修改时间相同，但 SHA-256 不同，不能假定内容一致或直接删除其中一份。
4. 当前 `.env.example`、部署文档和 Prisma provider 均仍指向 SQLite。
5. 后端具备 lint/test 命令但未发现有效测试用例；前端没有测试命令，主工程没有统一验证入口和持续集成门禁。
6. 当前文档仍描述 Node 18、SQLite 和多种包管理器，实际前端 Vite 8 要求 Node `^20.19.0 || >=22.12.0`，工程环境存在漂移。

本 Spec 的目标是先建立“可版本化、可复现、可验证、可回滚”的工程底座，再开始新增 PRD 业务功能。

## 2. 目标

1. 建立统一的项目级版本管理、目录规范、环境模板和验证命令。
2. 将 PostgreSQL 16 作为开发、测试、预发布和生产的唯一关系数据库类型。
3. 将 `apps/server/prisma` 收敛为唯一 Prisma schema、migration 和 seed 来源。
4. 对现有两份 SQLite 数据进行只读盘点、冲突识别、幂等迁移和结果核验。
5. 保持现有 22 个模型、UUID、业务编号、密码 Hash、金额、关联和历史记录的业务语义不变。
6. 建立最小但真实有效的自动化质量门禁，确保后续 Spec 可以在稳定基线上按测试驱动方式实施。
7. 形成可执行的开发初始化、数据迁移、切换、回滚和恢复文档。

## 3. 非目标

本 Spec 不包含以下事项：

1. 不实现 PRD 中尚未存在的新业务域、页面、审批流、事件中心或 AI 能力。
2. 不在迁移中完成完整目标数据库模型扩建；新增核心表应由后续业务 Spec 驱动。
3. 不拆分微服务，不引入 Kubernetes、消息中间件或复杂 DevOps 平台。
4. 不进行 React、Egg.js、Prisma 等主要依赖的版本升级。
5. 不把现有字符串 JSON 字段批量改为 JSONB，不借迁移机会改变状态值或业务规则。
6. 不在本 Spec 中确定生产服务器拓扑、云厂商或对象存储供应商。
7. 不迁移 LawLink、LexNebulis 的代码；两者仅作为后续能力融合的源码参考。

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
| A. 新建空 PostgreSQL，丢弃 SQLite 数据 | 最简单 | 不满足历史数据保留要求 |
| B. 直接认定一份 SQLite 为真并一次性导入 | 实施较快 | 两库 Hash 不同，存在静默丢数风险 |
| C. 主源迁移 + 次源差异报告 + 人工门禁 | 以运行时数据库为主源，比较另一份数据库后再切换 | **采用**。风险可见、迁移可重复、结论可审计 |
| D. 双写一段时间 | 可降低停机切换风险 | 当前系统复杂度和使用规模不值得承担双写一致性成本 |

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
│     │  └─ prisma/                        # 唯一 schema/migrations/seed
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
| `npm run db:reset:test` | 仅重建测试库并应用 migration/seed | 必须拒绝非测试数据库 URL |
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
3. `apps/server/prisma/seed.ts` 是唯一 seed 入口，必须使用 upsert 或稳定唯一键实现幂等。
4. 主工程根目录现有 `prisma/` 在数据审计和备份完成后移入只读迁移归档，再从运行路径删除。
5. `apps/server/scripts/seed.ts` 的有效逻辑合并到 canonical seed 后删除，避免两个初始化口径。

### 7.2 Schema 转换规则

1. datasource provider 从 `sqlite` 改为 `postgresql`，连接只读取 `DATABASE_URL`。
2. 现有模型主键已经是 UUID 字符串，迁移时保留原 ID，不重新生成，也不建立无必要的 ID 映射。
3. 现有 `Decimal` 金额字段显式映射为 `Decimal @db.Decimal(18, 2)`，迁移前后逐表核对合计。
4. 现有 `DateTime` 写入 PostgreSQL 时统一按 UTC 解释和保存，前端按 `Asia/Shanghai` 展示；迁移报告必须说明 SQLite 原值的时区假设。
5. 现有 `tags`、`paymentTerms`、`teamIds`、`kpiData` 等字符串 JSON 在本次迁移中保持 String 语义，仅执行“是否为合法 JSON”的数据质量检查，不自动改为 JSONB。
6. 现有状态字符串、软删除语义和外键删除策略不在本次迁移中重构。
7. PostgreSQL baseline migration 从空库生成并审查，不继续复用 SQLite 方言 migration；SQLite migration 作为只读证据归档。
8. 所有后续物理表结构变化只能通过已提交的 Prisma migration 实施，系统配置页面不得直接执行 DDL。

### 7.3 PostgreSQL 实例

开发 Compose 至少提供：

1. 固定主版本 PostgreSQL 16，不使用 `latest` 标签。
2. 独立的应用库 `chengye_oa` 和测试库 `chengye_oa_test`。
3. 健康检查、持久化 volume、UTF-8 编码和 `Asia/Shanghai` 会话时区；业务时间仍以 UTC 写入。
4. 端口、数据库名、用户可由本地环境覆盖，默认值不得包含真实生产凭据。
5. `docker compose down` 默认保留 volume；删除数据必须使用单独的显式命令并带环境保护。

## 8. SQLite 数据迁移设计

### 8.1 数据源认定

当前存在：

| 路径 | 角色 | 当前证据 |
|---|---|---|
| `LayerManage/law-firm-system/apps/server/prisma/law_firm.db` | **候选主源** | 后端 Prisma 命令与 schema 的实际运行路径 |
| `LayerManage/law-firm-system/prisma/law_firm.db` | 次源与恢复证据 | 根目录重复 Prisma 入口，SHA-256 与候选主源不同 |

候选主源不是无条件最终真源。实施时必须先生成逐表差异报告；如次源存在主源没有的有效业务记录、金额差异或更新时间更晚的记录，迁移进入人工确认门禁，不得自动切换。

### 8.2 迁移产物

运行产物统一写入受 Git 忽略的 `LayerManage/law-firm-system/var/migration/<run-id>/`：

```text
source-manifest.json      # 路径、大小、Hash、只读副本信息
inventory.json            # 表结构、行数、主键、业务唯一键、时间范围
diff-report.json          # 两源新增、缺失、冲突和金额差异
export/                   # 规范化中间数据，仅本机保存
import-report.json         # 成功、跳过、失败与原因
validation-report.json    # 数量、关联、唯一性、金额、业务抽样结果
```

报告不得包含明文密码、完整身份证号、完整手机号或录音文件内容；敏感字段只保留掩码、Hash 或内部 ID。

### 8.3 迁移步骤

1. 停止对两份 SQLite 的写入，计算 Hash，并复制为只读备份；原文件不直接操作。
2. 对两份数据库执行相同的结构与数据盘点，记录每表行数、主键集合、业务唯一键、金额合计和最大更新时间。
3. 以候选主源生成规范化导出；次源只参与差异检测，不自动覆盖主源。
4. 对冲突按“相同主键不同内容、相同业务键不同主键、仅次源存在、金额不一致、孤立外键”分类。
5. 无冲突或冲突经人工确认后，在空 PostgreSQL 应用 baseline migration。
6. 按外键拓扑顺序导入；导入器以原 UUID 或稳定业务键 upsert，保证同一批次可重复执行。
7. 执行 seed，仅补齐系统必需且不存在的角色、权限和管理员初始化数据，不覆盖迁移数据。
8. 运行自动验证和核心业务抽样；生成不可修改的结果报告。
9. 通过所有切换门禁后修改应用连接，SQLite 保持只读归档，不立即删除。

### 8.4 验证规则

| 维度 | 必须通过的检查 |
|---|---|
| 数量 | 每表源记录数 = 导入成功 + 明确跳过 + 已登记异常；关键表不得存在未解释差异 |
| 主键 | 所有原 UUID 保持不变；无重复主键 |
| 关联 | 客户、合同、付款、案件、任务、用户角色等无新增孤立外键 |
| 唯一性 | 用户名、员工编号、合同编号、案件编号等唯一键无冲突 |
| 金额 | Channel、Contract、Payment、Case、Performance 等 Decimal 字段逐表总额一致，单条精度为两位小数 |
| 时间 | 抽样核对创建、签约、收款、结案时间；UTC 转换前后业务日期无偏移 |
| 认证 | 迁移后的密码 Hash 不重算，现有测试账号可正常登录 |
| CRUD | 现有组织、员工、线索、客户、合同、付款、案件的读写烟雾测试通过 |
| 幂等 | 同一导入批次重复执行不新增重复记录，不改变已确认结果 |

## 9. 测试与持续集成

### 9.1 最小测试基线

1. 后端保留 Egg 测试框架，新增 PostgreSQL 连接、migration、seed 幂等和核心 CRUD 集成测试。
2. 前端引入 Vitest、React Testing Library 和 jsdom，至少覆盖应用启动、登录页渲染、路由保护和 API 错误态。
3. 迁移工具必须覆盖：两库差异识别、Decimal 精度、时间转换、外键顺序、重复运行和错误中断。
4. 不以 SQLite 内存库替代 PostgreSQL 测试；数据库特性必须在真实 PostgreSQL 16 测试实例验证。
5. 测试库每次重建前校验数据库名或显式安全标记，任何生产样式 URL 均拒绝 reset。

### 9.2 CI 门禁

CI 在干净环境中执行：

1. 校验 Node/npm 版本和 lockfile 安装。
2. 启动 PostgreSQL 16 服务并等待健康检查。
3. 应用全部 migration，执行幂等 seed。
4. 执行 `npm run verify`。
5. 再次在空测试库执行 migration，防止依赖本地残留状态。
6. 检查 Git 工作区无未提交的生成文件或 schema 漂移。

## 10. 切换与回滚

### 10.1 切换门禁

以下条件全部满足才允许从 SQLite 切换到 PostgreSQL：

1. 两份 SQLite 的差异报告已生成，所有关键差异已有明确处理结论。
2. PostgreSQL baseline migration 可在空库重复创建完整结构。
3. 数据验证规则全部通过，关键表记录数、金额和关系无未解释差异。
4. `npm run verify` 和核心登录/CRUD 烟雾测试通过。
5. SQLite 只读备份和 PostgreSQL 切换前快照均可访问。
6. 开发环境切换成功并稳定运行后，才允许进入预发布迁移演练。

### 10.2 回滚策略

1. 开发阶段切换失败：停止 PostgreSQL 写入，恢复原 SQLite 连接，保留失败库和报告用于分析。
2. 预发布/生产演练必须在维护窗口冻结写入后完成；出现登录失败、核心 CRUD 失败、金额不一致或关联缺失立即回滚。
3. 若 PostgreSQL 已产生新写入，回滚前导出增量差异，不允许直接丢弃；由后续 runbook 定义补偿方式。
4. SQLite 归档至少保留到 PostgreSQL 正式验收和备份恢复演练完成，删除需单独审批。
5. Prisma migration 不承诺自动 down migration；回滚以数据库快照、应用版本和受控补偿脚本为主。

## 11. 安全与可运维性

1. 生产连接启用 TLS；数据库端口不直接暴露公网。
2. 生产开启慢查询和连接监控，应用日志不得输出完整连接串或敏感字段。
3. 开发备份用于迁移验证；生产备份延续 PRD 的 RPO 不超过 1 小时、RTO 不超过 4 小时目标，并在上线前完成恢复演练。
4. migration 执行者、时间、版本、结果和失败原因必须留痕。
5. `/health` 只返回服务和数据库可用状态，不泄露版本、连接地址、表名或错误堆栈。
6. 本 Spec 产生的迁移报告默认仅限开发和系统管理员查阅，不作为普通业务页面功能。

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
2. 新开发者仅依据 runbook 可在干净环境启动 PostgreSQL、安装依赖、迁移、seed 并运行系统。
3. 工程中只有一套运行时 Prisma schema、migration 和 seed 来源。
4. 应用运行时不再依赖 SQLite，开发和测试均连接 PostgreSQL 16。
5. 两份 SQLite 均有 Hash、盘点和差异报告；迁移结果通过数量、关联、唯一性、金额、时间和登录验证。
6. 重复执行迁移导入和 seed 不产生重复数据。
7. 前后端具备实际测试用例，统一 `verify` 命令和 CI 在干净环境通过。
8. 密钥、本地数据库、备份、迁移明细和构建产物均未进入 Git。
9. 开发迁移、切换和回滚演练完成并形成 runbook 记录。
10. 既有业务功能没有因数据库切换出现已知阻断性回归。

## 14. 风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 两份 SQLite 存在不同有效数据 | 静默丢数 | 双源盘点、差异报告、人工切换门禁 |
| SQLite 与 PostgreSQL 类型行为不同 | 金额、时间、唯一性错误 | 显式 Decimal、时区规则、真实 PostgreSQL 集成测试 |
| 重复 Prisma 入口继续被误用 | schema 漂移 | 单一目录、移除重复依赖、CI 漂移检查 |
| 本次迁移夹带业务模型重构 | 范围失控、难以定位回归 | 保持现有 22 模型语义，新增业务表另立 Spec |
| 测试 reset 误连非测试库 | 数据破坏 | 数据库名/环境标记双重校验，生产 URL 拒绝执行 |
| Node 与依赖环境漂移 | 无法复现构建 | Node 22 锁定、lockfile 安装、CI 版本检查 |
| 迁移文件包含敏感数据 | 客户信息泄露 | 运行目录 Git 忽略、报告脱敏、最小访问权限 |

## 15. 审核结论项

批准本 Spec 即表示确认以下设计决定：

1. 以工作空间根目录建立主 Git 仓库，主工程和项目文档同库管理，LawLink/LexNebulis 继续作为独立参考仓库。
2. 使用 Docker Compose 管理开发和测试 PostgreSQL 16，统一 Node 22 + npm。
3. `apps/server/prisma` 是唯一 Prisma 来源，根目录重复 Prisma 入口在完成审计归档后移除。
4. `apps/server/prisma/law_firm.db` 仅作为候选主源；两库差异未经报告和确认不得切换。
5. 本次迁移保持现有 22 个模型与字符串 JSON 语义，不同步扩建完整 PRD 数据模型。
6. Spec 批准后先生成逐任务实施 Plan，再按测试驱动与分支隔离方式执行，不直接开始批量生成业务代码。
