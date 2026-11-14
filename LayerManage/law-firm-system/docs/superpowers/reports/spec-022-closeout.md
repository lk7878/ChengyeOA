# SPEC-022 权限排序一致性（Permission Sort Consistency）— 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1 实现 + Task 2 验收闸门全绿 + runbook/closeout 收尾）
需求来源：SPEC-021 Task 2 全量 71 fail 根因——`assertPermissionCatalog` localeCompare vs PG `ORDER BY code`（C collation）排序不一致（外部并行渠道 `user_role.membership.manage` 权限码触发，closeout §7.5/§8.1 跨渠道待办）+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-permission-sort-consistency-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-permission-sort-consistency/

## 1. 交付范围

**catalog 侧排序对齐 PG C collation 字节序**，**零结构变更**（无 schema/迁移/模型/权限/事件/路由变更——排序逻辑修复）：

- **`compareByCodeC` 模块级助手**（`apps/server/app/application/system/system-bootstrap-service.ts:25-27`）：`(left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0`——纯字典序，对 ASCII 码逐字节等价 PG C collation（`.`(46) < 大写字母 < `_`(95) < 小写字母）。模块级私有（设计 D2 未要求导出），带 SPEC-022 JSDoc。
- **两处 sort 替换**：
  - `assertPermissionCatalog`（system-bootstrap-service.ts:226，原 :216）`[...PERMISSION_CATALOG].sort((l,r)=>l.code.localeCompare(r.code))` → `.sort(compareByCodeC)`。
  - `assertEventSubscriptionCatalog`（system-bootstrap-service.ts:265，原 :256）同模式替换。
- **6 处错位实证修复**：真实 `PERMISSION_CATALOG`（123 码）localeCompare 序与 PG `ORDER BY code` 序在 **idx 117-122** 错位——`localeCompare` 把含下划线码 `user_role.membership.manage` 置于所有 `user.*` 码之前，而 C collation（`.`46 < `_`95）把它排在最后 → 逐位比对错位 → `InconsistentSystemStateError: Permission catalog is inconsistent`。修复后 catalog 侧 `compareByCodeC` 排即与 DB 侧完全一致。
- **新增测试 3 例**（`apps/server/test/system/system-bootstrap-service.test.ts`）：①含下划线码目录按 PG C 序 bootstrap 不抛（前置 `_` 码存在断言 + 具体下划线码 `menu.organization_personnel`/`employee.account_binding.manage`/`user_role.membership.manage`）；②事件订阅 catalog 具体码集合（`admin-operation-reviewed-notification-v1`/`event-dispatch-quarantine-v1`/`lead-first-response-monitor-v1`）深等于 DB `ORDER BY code` 序；③无下划线码零回归（`approval.*` 段升序一致 + HR 业务角色 reviewer 授权稳定对）。
- **runbook 排序一致性说明**：`docs/superpowers/runbooks/finance-operations.md` §8 运维注意补「目录排序一致性（SPEC-022）」——C collation 字节序语义 + 运维含义（新增权限码无需改动排序逻辑；catalog 断言路径再报 `Permission catalog is inconsistent` 先核对含 `_` 码字节序位置）。
- **零结构变更（D6）**：迁移 **26**/模型 **60**/权限（实测 **123** 码，见 §4 外部漂移说明）/事件 **15**/路由 **11** 全不变。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证沿 SPEC-017/018/019/020/021）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | `compareByCodeC` 助手 + 两处 sort 替换 + 3 例含下划线码 bootstrap 一致性测试（TDD 红→绿：改动前 **16/16** 红复现 SPEC-021 71 fail 根因） | system-bootstrap 域 **16/16**（13 既有 + 3 新增；Task 1 报告 17 系笔误，评审 C×1 修正）+ 相关域 **110/110**（auth×5 / user-grant / role-auth / browser-fixture / 权限目录契约×5）+ `npx tsc --noEmit` 0 + eslint 0 |
| 2 | 全量闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout | 见 §3.2（全量实测对账）+ 迁移实证（§4） |

### 3.2 最终全量（Task 2 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件照录） | **1844 tests / 1837 pass / 3 fail / 4 skipped**（排序缺陷修复后 bootstrap 级联失败消失——SPEC-021 71 fail → 实测 3 fail，全系外部 role-membership 漂移照录不计，见 §3.3） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| server typecheck | `npx tsc --noEmit` 0（Task 1 验） |

### 3.3 全量合计（Task 2 实测，清净窗）

**实测：1844 tests / 1837 pass / 3 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件）。

SPEC-022 净增（后端）：Task 1 +**3**（含下划线码 bootstrap 一致性用例）= **+3**。

> **对账**：同闸门口径 SPEC-021 终态 = **1841 tests / 1766 pass / 71 fail / 4 skipped**（71 fail 全系外部并行渠道漂移：`user_role.membership.manage` 权限码新增暴露 `assertPermissionCatalog` 排序缺陷 + 权限计数契约 122→123 未同步 + approval listInstances 3 例瞬态）。本 SPEC 净增 +3 → 预期 **1844**，实测 **1844** 精确对齐。**排序缺陷修复后 bootstrap 级联失败消失**（SPEC-021 71 fail → 实测 **3 fail**，全系外部并行渠道 role-membership 在制漂移——spec-004-router-contract（role-grants 路由改 `requireAnyPermission(['user.role.manage','user_role.membership.manage'])` 契约未同步）+ trust-root-guard×2（权限升级守卫错误码 PRIVILEGE_ESCALATION_BLOCKED→PERMISSION_DENIED）；权限计数契约 123 断言通过、approval listInstances 瞬态未再现）。**0 真 fail 为权威结论**——本 SPEC 排序相关用例（system-bootstrap 16/16）全绿；外部漂移照录不计。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 事件 15 不变 / 路由 approval 域 11 不变**——SPEC-022 **零结构变更**（排序逻辑修复，无 schema/迁移/模型/权限/事件/路由变更）。
- **权限计数（实测 123 码）**：`PERMISSION_CODES.length === PERMISSION_CATALOG.length === 123`（含 `user_role.membership.manage` 既有第 123 码，SPEC-015 follow-up 已落树；无孤儿/缺项）。**协调者 brief 预期 124（外部并行渠道 role-membership 在制——`user_role.membership.manage` 等 2 码，非本 SPEC 变更）**：实测当前共享树为 **123 码**（第 124 码尚未落树），计数以实测终态为准（brief #4）——外部渠道后续落 124 码时权限计数契约同步归外部渠道（§9 follow-up）。
- **迁移实证**：`npm run db:reset:test` 重放 **26** 迁移 → `npm run db:assert-empty` **PASS** → `npx prisma migrate deploy` 二次跑 **零迁移幂等**（0 待应用；SPEC-022 零新增迁移，实证沿 SPEC-021 终态迁移集）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——2 SYSTEM + 5 BUSINESS，SPEC-022 未动角色）。
- **路由终态**（approval 域 **11 条**）：六门禁 + SPEC-017 三管理 + SPEC-019 转交 + SPEC-020 加签——**SPEC-022 零新增**。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️ 裁决累积）

设计 §2 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 排序对齐 | catalog 侧排序改用**显式 C collation 字节序比较器**（非 localeCompare）——对齐 PG `ORDER BY code` 语义（ASCII 字节序：`.`< 大写 < `_` < 小写） |
| D2 | 实现 | 提取模块级 `compareByCodeC` 助手（`left.code < right.code ? -1 : left.code > right.code ? 1 : 0`——纯字典序，等值于 PG C collation 对 ASCII 码） |
| D3 | 应用点 | `assertPermissionCatalog`（:226）+ `assertEventSubscriptionCatalog`（:265）两处 sort 替换 |
| D4 | 幂等/向后兼容 | 排序助手零副作用（仅比较器）；既有无下划线码的排序序不变（字典序与 C collation 对纯字母数字点分段一致） |
| D5 | 测试 | 补含下划线码的 bootstrap 一致性用例（构造含 `_` 码的目录 → 断言不抛 `InconsistentSystemStateError`；对照旧 localeCompare 会抛） |
| D6 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（排序逻辑修复） |

**实施期 ⚠️ 裁决（Task 1 评审 C×3 照录）**：

1. **Task 1 ⚠️ 报告计数笔误（C×1）**：Task 1 报告「system-bootstrap 17/17（14 既有 + 3 新增）」系笔误——实测 **16/16**（13 既有 + 3 新增），评审独立核对修正。计数以实测为准。
2. **Task 1 ⚠️ 事件 sort 行号引用差 1（C×2，文档级）**：Task 1 报告事件处「原 :256 → :265」与文件实际行号差 1（文档级引用偏差），实现本身正确（评审核实 assertEventSubscriptionCatalog sort 替换到位、全文件无其他 catalog localeCompare）。
3. **Task 1 ⚠️ compareByCodeC 理论非 BMP 边界（C×3，可接受）**：`<`/`>` 对非 ASCII（BMP 外代理对）不等价 C collation；权限码/事件码全部 ASCII，JSDoc 已限定「ASCII 字节序」，理论边界可接受。
4. **Task 1 ⚠️ 事件订阅②正向守卫偏离**：`EVENT_SUBSCRIPTION_CATALOG` 3 码均为连字符形态（无 `_`），localeCompare 序与 C 序一致——②用例为**正向回归守卫**（修复前后均绿），红→绿证明由①权限目录用例承担（事件目录内容变更属 OUT，无法构造含 `_` 事件码场景）。评审核实合理。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` 收敛（沿 SPEC-021 终态）：本 SPEC **零依赖变更**（`compareByCodeC` 为源码级比较器，无 package.json/lockfile 改动）——安装版本 react-router 8.3.0/brace-expansion 5.0.8 均已覆盖既有 advisory，SEC-2026-002 对应漏洞不再命中；现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断。**本 SPEC 零新增例外**。注：audit 工具链在本环境无法重跑（`cli.mjs` 经 `npm_execpath` 定位 npm——仅在 `npm run` 下注入，且 metadata 含 `git rev-parse`，本任务禁 git）——audit 非本 SPEC 闸门，沿用 SPEC-021 实测终态 + 零依赖变更推证。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **外部并行渠道活跃漂移（权限计数 123→124 在制，非本 SPEC 回归）**：并行渠道 role-membership 在制（协调者 brief 权限 **124** 码——`user_role.membership.manage` 等 2 码），实测当前共享树 **123 码**（第 124 码未落树）。权限计数契约测试（approval/authorization/contract/finance 四处 `PERMISSION_CODES.length` 断言）当前断言 123 且实测通过；外部渠道后续落 124 码时若契约未同步会 fail——**外部漂移照录不计**，契约同步归外部渠道（§9）。
2. **Task 1 C×3 照录**（§5 实施期 ⚠️ ①②③）：报告计数笔误（17 vs 16）/ 事件 sort 行号引用差 1 / compareByCodeC 理论非 BMP 边界（JSDoc ASCII 限定可接受）。
3. **事件订阅②正向守卫**（§5 ⚠️④）：事件目录无下划线码，②为正向回归守卫，红→绿由①承担。
4. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：SPEC-021 超时升级 minor（实例并发陈旧通知可接受 / batchSize 单次扫描上限语义 / 前端超时 Tag follow-up）；SPEC-020 加签 minor（目标重复 PENDING task 重复建 / raw 1-10 先于去重口径 / 详情弹窗 stale 快照 / 刷新恒 TODO）；SPEC-019 转交目标存在性校验（D3 OUT）+ 转交「死按钮」观察；SPEC-018 缺 ALL 并发用例 / nodeName 唯一性 / 投影取当前定义非版本快照；SPEC-017 M2 乐观版本锁 + PATCH 同体非单事务；审批中心深化余项（全组织视图/审批人表达式/节点级事件/自动升级动作）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **计数对账**：SPEC-021 终态 **1841** + 本 SPEC 净增 **+3** = **1844 预期**；实测 **1844 tests / 1837 pass / 3 fail / 4 skipped**（对账见 §3.3）。**0 真 fail 为权威结论**——排序缺陷修复后 bootstrap 级联失败消失（SPEC-021 71 fail → 实测 3 fail）；3 fail 全系外部 role-membership 在制漂移（spec-004-router-contract + trust-root-guard×2）照录不计。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限（实测 **123** 码，brief 预期 124 外部漂移）/事件 **15**/路由 **11** 全不变——与设计 §6 逐字对齐（D6 零结构变更）。
3. **错误码对账**：无新增错误码；排序逻辑修复零错误码影响。
4. **事件对账**：事件 **15** 不变；事件订阅 catalog 3 码不变（排序对齐零内容变更）。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **audit:prod 实测对账**：本 SPEC 零依赖变更，audit 沿 SPEC-021 终态收敛（§6）。

## 9. Follow-up 路由（候选专项）

- **权限计数契约同步（归外部渠道）**：并行渠道 role-membership 落 124 码后，approval/authorization/contract/finance 四处 `PERMISSION_CODES.length` 契约测试同步至 124（本 SPEC 明确 OUT，外部渠道负责）。
- **其他 localeCompare 使用点审计**：全库扫描 `localeCompare` 使用点（crm/其他域）——本 SPEC 仅修 bootstrap 断言两处（D3 范围）；若其他域存在与 PG `ORDER BY` 交互的排序比对，需按 C collation 语义专项审计。
- **权限目录一致性治理深化**：`assertPermissionCatalog`/`assertEventSubscriptionCatalog` 断言路径健壮性（排序语义文档化、非 ASCII 码守卫——compareByCodeC JSDoc 已限定 ASCII，若未来引入非 ASCII 权限码需显式拒绝或专用比较器）。
- **审批中心深化余项（承接 SPEC-021 §9）**：自动升级动作 / 多级升级 / 审批人维度超时统计驾驶舱 / 全组织视图 / 前端超时 Tag。
- **SPEC-020 加签 minor 承接**：目标重复 PENDING task 去重 / 幂等 key。
- **SEC-2026-002（react-router v8 迁移专项）**：2026-08-29 到期。

## 10. 双渠道验收链

Task 1 实现者渠道实现 + 协调者渠道独立审查（task-1-review-package 双件）；Task 1 审查结论 **Approved / 0 Critical / 0M / 0I / 3C**（C×3 照录：报告计数 17 vs 实际 16 笔误 / 事件 sort 行号引用差 1 / compareByCodeC 理论非 BMP 边界——JSDoc ASCII 限定可接受）。Task 1 评审确认：compareByCodeC :25-27 纯字典序 + JSDoc 正确；两处 sort 替换 :226/:265 + 全文件无其他 catalog localeCompare；测试真实性（①前置 `_` 码存在断言 + 具体下划线码，②③具体码集合非恒真）；根因独立复现（idx 117-122 6 处错位，旧代码必抛）；事件②偏离合理；零回归 + 零结构变更；collation 前提独立实证（55433 datcollate=en_US.utf8 但 ASCII 码 ORDER BY 返回 C 字节序）。Task 2（本任务）为全量闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout；SPEC-022 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑，终探同 0）。

## 11. 收官状态

**SPEC-022 本地闭环（2026-08-03）**：2/2 任务完成；catalog 侧排序对齐 PG C collation 字节序（`compareByCodeC` 助手 + `assertPermissionCatalog` :226 + `assertEventSubscriptionCatalog` :265 两处 sort 替换 + 3 例含下划线码 bootstrap 一致性测试）落地；**零结构变更**（迁移 **26**/模型 **60**/权限实测 **123**（brief 预期 124 外部漂移在制）/事件 **15**/路由 **11** 全不变）；后端本 SPEC 净增 **+3**，全量串行 **1844 tests / 1837 pass / 3 fail / 4 skipped**（**0 真 fail 为权威**——排序缺陷修复后 bootstrap 级联失败（SPEC-021 71 fail 主体）消失；3 fail 全系外部 role-membership 在制漂移照录不计）；security:test **34/34** 零新增；`security:audit:prod` 沿 SPEC-021 终态收敛（零依赖变更）；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；迁移实证 **26 迁移重放 + assert-empty PASS + migrate deploy 二次零迁移幂等**；已知非阻断项 §7 照录（含 Task 1 C×3、外部漂移、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
