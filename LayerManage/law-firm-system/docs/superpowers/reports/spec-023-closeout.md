# SPEC-023 审批全组织视图（Org-Wide View）— 收尾报告

日期：2026-08-03 ｜ 状态：**本地闭环**（Task 1 后端 role='ALL' + getInstance manage 放行 + Task 2 前端「全部审批」Tab + 闸门全绿 + runbook/closeout 收尾）
需求来源：SPEC-016/017/018/019/020/021 closeout §9「审批中心深化余项——全组织视图（approval.manage 仅定义管理，视图全量归另行）」+ 用户授权无人值守立项
设计：docs/superpowers/specs/2026-08-03-approval-org-wide-view-design.md ｜ 实施台账：.superpowers/sdd/2026-08-03-approval-org-wide-view/

## 1. 交付范围

**全组织审批视图**——`approval.manage` 权限用户纵览全组织审批实例（突破 applicantId/assigneeId actor 作用域），**零结构变更**（role 枚举扩展 + 动态门控，无 schema/迁移/权限/事件/路由变更——approval.manage 已存在）：

- **Task 1（后端）**：`approval-types.ts` `APPROVAL_ROLE_FILTERS` +`'ALL'`（四值 APPLIED/TODO/DONE/ALL）；`approval-instance-service.ts` `listInstances` **动态门控**（role='ALL' → `requireAction(approval.manage)`，余三 role → `requireAction(approval.read)`）+ role='ALL' **where 空**（无 actor 过滤，仅分页 createdAt DESC id ASC 全量）；`getInstance` **manage 放行任意实例**（按 id 探查 + isApplicant/isAssignee/hasManagePermission 三判定，三者全 false → 404 fail-closed 存在性不泄露）；**动作权限不扩大**（process/forward/addSigners/withdraw 门控与 task 探查零改动）。测试 +4。
- **Task 2（前端 + 收尾）**：`api/approval.ts` `ApprovalRoleFilter` +`'ALL'`（本地独立类型镜像后端四值）；`ApprovalCenterPage.tsx` 增「全部审批」Tab（key='ALL'，approval.manage 门控——无码用户不见；与既有三 Tab 复用列表/详情/操作；**M3 详情兜底**——详情弹窗以列表行 activeRecord 渲染，不额外 getInstance，manage-only 无 read 用户不受详情 403 影响）；`controller/approval.ts` **M4 注释更新**（三 role → 四 role）；runbook §9 补全组织视图段 + 本 closeout。前端测试 +2。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（沿 SPEC-017/018/019/020/021/022 实证零影响）。

## 3. 测试计数链

### 3.1 各任务计数

| Task | 交付 | 计数 |
|---|---|---|
| 1 | `APPROVAL_ROLE_FILTERS` +'ALL' + listInstances 动态门控/空 where + getInstance manage 放行 + 4 例（TDD 红→绿：403 门禁 / manage-only 全组织列表含非本人+分页 createdAt DESC / 详情放行 / 404 保持） | approval-instance-service **73/73**（69 既有 + 4 新；Task 1 报告「73 既有 + 4 新 = 77」系计数口径笔误——实测 69 既有 + 4 新 = 73，评审修正，见 §5 ⚠️①）+ approval 域回归 **89/89**（definition 17 + api 23 + policy/catalog 34 + events 15）+ server tsc/eslint 0 |
| 2 | 前端「全部审批」Tab（manage 门控）+ api 类型 +'ALL' + M3 详情兜底 + M4 注释 + 全量闸门 + runbook/closeout | 见 §3.2（全量实测对账） |

### 3.2 最终全量（Task 2 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 前端隔离测试 `ApprovalCenterPage.test.tsx` | **28/28 pass**（26 既有 + 2 新——Tab 门控隐藏 / manage 可见+列表渲染含非本人 title+role=ALL 透传+M3 详情兜底不 getInstance），fail 0 |
| 前端 typecheck | `npm --prefix apps/web run typecheck` **exit 0** |
| 前端 lint | **0 errors / 4 warnings**（预存 warning 照录：Case/Notification/Performance/User 四页 exhaustive-deps，非本 SPEC 引入） |
| 前端 build | `npm --prefix apps/web run build` **exit 0**（tsc -b + vite build 成功） |
| 后端全量串行（全 test/ 枚举，官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件照录；**静默窗重跑终态**） | **1850 tests / 1844 pass / 2 fail / 4 skipped**（对账见 §3.3——初跑 18 fail 含 **15 例共享 DB 跨进程撞车（TRUNCATE 竞态，runbook §8 不计失败）**，静默窗重跑后**仅余 2 例 SPEC-022 已知外部漂移**；**0 真 fail**） |
| security:test | **34/34** 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |

### 3.3 全量合计（Task 2 实测，静默窗重跑终态）

**实测：1850 tests / 1844 pass / 2 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件）。

SPEC-023 净增（后端）：Task 1 **+4**（approval-instance-service 四例 role ALL / getInstance manage——实测 4 例全绿，重跑 :553-556）。

> **对账**：同闸门口径 SPEC-022 终态 = **1844 tests / 1837 pass / 3 fail / 4 skipped**。本 SPEC 净增 +4 → 预期 **1848**；实测 **1850**（外部并行渠道同窗再 +2 测试，计数以实测为准，§8.1）。**fail 分类**（本 SPEC 相关用例 approval-instance-service 全绿 + 前端 28/28 全绿）：
> - **初跑 18 fail → 重跑 2 fail（撞车不计确认）**：初跑 18 fail 中 **15 例为共享 DB 跨进程撞车**（`permission.createMany Unique constraint failed on (id)` 于 `test-database.ts:23` `clearTestApplicationData` TRUNCATE 竞态——**runbook §8 撞车签名**，并行渠道同窗使用共享 55433 测试库）。受影响域：approval addSigners×1 / approval-timeout-scanner scanOnce×1 / auth-challenge×2 / mfa-management×1 / mfa×2 / session-service×4 / data-scope×1 / permission-trace×1 / role-authorization×1 / sensitive-access×1。**静默窗重跑后 15 例全绿（addSigners :591 / scanOnce :623 / auth-challenge / mfa / session / role-authorization 等）——确认非回归**。
> - **2 例 SPEC-022 已知外部漂移（照录不计）**：trust-root-guard×2（权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`）。**spec-004-router-contract 重跑转绿**（外部并行渠道同步其 role-grants 路由契约——在制漂移收敛）。
> **0 真 fail 为权威结论**——本 SPEC 净增全绿；外部漂移照录、撞车不计（重跑绿确认）。

### 3.4 撞车重跑（共享 DB 静默窗纪律，runbook §8）

初跑 18 fail 中 15 例为共享 DB 跨进程撞车（`permission.createMany Unique constraint failed on (id)` 签名）。按纪律等静默窗（`pg_stat_activity active=0` 探针）后**重跑全量**：**1850 tests / 1844 pass / 2 fail / 4 skipped**——15 例撞车失败全绿（addSigners / scanOnce / auth-challenge / mfa / session / data-scope / permission-trace / role-authorization / sensitive-access），仅余 2 例 SPEC-022 已知外部漂移（trust-root-guard）。**撞车失败不计，重跑绿即确认非回归**。

## 4. 迁移与模型

- **迁移总数 26 不变 / model 60 不变 / 事件 15 不变 / 路由 approval 域 11 不变**——SPEC-023 **零结构变更**（role 枚举扩展 + 动态门控，无 schema/迁移/模型/权限/事件/路由变更）。
- **权限计数**：设计/brief 口径 **124** 码——**实测当前共享树 123 码**（沿 SPEC-022 closeout §4 外部漂移：外部并行渠道 role-membership 第 124 码尚未落树；`user_role.membership.manage` 为第 123 码已存在）。本 SPEC 零新增权限码（复用 approval.manage），权限计数契约当前断言 123 且实测通过（§8.1）。
- **路由终态**（approval 域 **11 条**）：六门禁 + SPEC-017 三管理 + SPEC-019 转交 + SPEC-020 加签——**SPEC-023 零新增**（GET /approvals 与 GET /approvals/:id 既有，role='ALL' 经既有 role 参数流到 service；getInstance 权限扩展在 service 层，controller 零改动）。

## 5. 关键裁决记录（D1-D8 + Task 1 评审 M×4 照录）

设计 §2 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 权限 | 全组织视图挂 **`approval.manage`**（管理权限——定义管理已用，扩展至全量视图；不新增权限码） |
| D2 | 入口 | `listInstances` 增 role 值 **`'ALL'`**（四 role：APPLIED/TODO/DONE/ALL）——ALL = 无 actor 过滤（全组织），其余三 role 语义不变 |
| D3 | 门控 | role='ALL' 时 requireAction **`approval.manage`**（其余三 role 仍 approval.read）——**动态权限**：同一路由按 role 值区分门控 |
| D4 | 语义 | role='ALL' → where 无 actor 过滤（仅分页），按 createdAt desc 全量 |
| D5 | 前端 | ApprovalCenterPage 增「全部审批」Tab（approval.manage 门控——无码用户不见）；与既有三 Tab 复用列表/详情/操作（操作仍按 actor 语义——管理员可见全量但动作仍限自身 assignee） |
| D6 | 详情 | `getInstance` 权限语义：approval.manage 用户可查看任意实例详情（现有 404 对非申请人/非审批人——全组织视图需 manage 用户可读详情） |
| D7 | 审计 | 列表/详情为读操作不落审计（沿既有）；动作（process/forward/addSigners/withdraw）仍按既有 actor 语义（管理员仅可处理自身 task，不因 manage 扩大动作权限） |
| D8 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（role 枚举扩展 + 动态门控） |

**Task 1 评审 M×4 照录（0C/0I/4M，全部接受/落位）**：

1. **M1 getInstance 存在性时序侧信道轻微扩大（接受）**：原实现按 `id AND (applicant OR assignee)` 过滤，陌生人连行不查即 404；新实现按 id 探查后再应用层判定（陌生人也会读到行后 404）。**对外 404 语义完全一致**（存在性不泄露，`APPROVAL_INSTANCE_NOT_FOUND` 同码同 404），且设计 §3.2 明确此形态；需 read 低敏权限。如需收紧可后续优化为两段查询（先 actor 过滤、miss 再 manage 兜底）。
2. **M2 listInstances 校验先于权限（接受）**：`normalizeAllowedValue` 先于 `requireAction`（设计 §3.1 同序）。对"无权限 + 畸形 query"这一无既有测试覆盖的边界，错误由 403 变为 400（验证先于权限）。既有 403/400 用例全绿。
3. **M3 manage-only 详情不对称（Task 2 落位——详情兜底）**：getInstance 需 read+manage，manage-only（无 read）用户「全部审批」Tab 列表可看但 getInstance 会 403（后端需 read+manage）。**处理（Task 2 实现）**：前端详情弹窗以列表行 activeRecord 渲染（列表行已含 content/tasks 全数据），**不额外 getInstance**——manage-only 用户详情正常展示，测试断言 `detail` 未被调用。
4. **M4 注释过时（Task 2 顺手更新）**：`controller/approval.ts` index/show 注释由「三 role」更新为「四 role」（APPLIED/TODO/DONE/ALL）——索引注释含 ALL 全组织视图 approval.manage 门控；show 注释含 manage 放行任意实例。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` 收敛（沿 SPEC-021/022 终态）：本 SPEC **零依赖变更**（前端仅类型/组件改动，后端仅注释；无 package.json/lockfile 改动）——沿用 SPEC-022 实测终态（现存 server 1 个 production **moderate** `uuid` GHSA-w5hq-g745-h8pq，report 不阻断）。注：audit 工具链在本环境无法重跑（metadata 含 `git rev-parse`，本任务禁 git）——audit 非本 SPEC 闸门，沿用实测终态 + 零依赖变更推证。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **外部并行渠道活跃漂移（权限计数 123→124 在制，非本 SPEC 回归）**：并行渠道 role-membership 在制（设计/brief 预期权限 **124** 码），实测当前共享树 **123 码**（第 124 码未落树；`user_role.membership.manage` 为第 123 码已存在）。权限计数契约测试当前断言 123 且实测通过；外部渠道后续落 124 码时若契约未同步会 fail——**外部漂移照录不计**，契约同步归外部渠道（§9）。
2. **Task 1 报告计数口径笔误（评审修正）**：Task 1 报告「approval-instance-service 73 既有 + 4 新 = 77」——实测文件 **69 既有 + 4 新 = 73**（评审独立核对 `test(` 全量 73，含 SPEC-023 四例）。计数以实测为准。
3. **M1/M2 照录**（§5 ⚠️①②）：getInstance 探查形态变化（对外 404 语义一致）/ listInstances 校验先于权限（无权限+畸形 query 由 403 变 400）。
4. **共享 DB 跨进程撞车（Task 2 实测，runbook §8 不计失败）**：全量初跑 18 fail 中 **15 例**为并行渠道同窗使用共享 55433 测试库的 TRUNCATE 竞态（`permission.createMany Unique constraint failed on (id)`，`test-database.ts:23`）——非本 SPEC 回归、非代码缺陷；按纪律"杀闸门等静默窗重跑、不计失败、不改测试助手/配置"。**静默窗重跑全量 1850 tests / 1844 pass / 2 fail / 4 skipped**——15 例撞车失败全绿确认非回归（§3.4/§8.1）。
5. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：SPEC-021 超时升级 minor（实例并发陈旧通知可接受 / batchSize 单次扫描上限语义 / 前端超时 Tag follow-up）；SPEC-020 加签 minor（目标重复 PENDING task 重复建 / raw 1-10 先于去重口径 / 详情弹窗 stale 快照 / 刷新恒 TODO）；SPEC-019 转交目标存在性校验（D3 OUT）+ 转交「死按钮」观察；SPEC-018 缺 ALL 并发用例 / nodeName 唯一性 / 投影取当前定义非版本快照；SPEC-017 M2 乐观版本锁 + PATCH 同体非单事务；terminate 侧硬化（SPEC-014 MEDIUM 承接）；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **计数对账**：SPEC-022 终态 **1844** + 本 SPEC 净增 **+4** = **1848 预期**；实测（静默窗重跑终态）**1850**（外部并行渠道同窗再 +2 测试）。fail 分类：初跑 18 fail = **15 例共享 DB 撞车（不计，§3.3，重跑全绿）+ 2 例 SPEC-022 已知外部漂移（照录不计）+ spec-004-router-contract 初跑 1 例（重跑转绿，在制漂移收敛）**——**0 真 fail 为权威结论**（本 SPEC 净增全绿）。
2. **结构终态对账**：迁移 **26**/模型 **60**/权限（设计口径 **124**，实测 **123** 外部漂移）/事件 **15**/路由 **11** 全不变——与设计 §7 逐字对齐（D8 零结构变更）。
3. **错误码对账**：无新增错误码；role='ALL' 复用既有 `PERMISSION_DENIED` 403；getInstance 复用 `APPROVAL_INSTANCE_NOT_FOUND` 404。
4. **事件对账**：事件 **15** 不变；列表/详情读操作不落审计（D7）；本 SPEC 零事件影响。
5. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012 起先例），扫描 exit 0。
6. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例 port-55432 锁定件经 skip-pattern 照录排除）。
7. **闸门计数按实际运行数**：全量按实际运行计数（非静态估计），计数链终态以实测为准。
8. **前端 API 类型独立**：`api/approval.ts` `ApprovalRoleFilter` 为本地独立定义（非导入后端）——后端 +'ALL' 与前端 +'ALL' 各自落位，编译/类型互不破坏（前端 typecheck 0）。

## 9. Follow-up 路由（候选专项）

- **全量筛选/搜索**（按申请人/类型/状态）——明确 OUT（设计 §8：全组织视图的过滤/搜索另行）。
- **全组织动作（管理员代处理他人任务）**——明确 OUT（D7：动作权限不扩大；manage 不授予处理他人任务权）。
- **导出/报表/统计**——明确 OUT（设计 §8）。
- **审批人维度驾驶舱**（审批人维度超时统计）——明确 OUT（设计 §8 + SPEC-021 §9 承接）。
- **权限计数契约同步（归外部渠道）**：并行渠道 role-membership 落 124 码后，approval/authorization/contract/finance 四处 `PERMISSION_CODES.length` 契约测试同步至 124（本 SPEC 明确 OUT，外部渠道负责）。
- **M1 收紧（可选项）**：getInstance 两段查询优化（先 actor 过滤、miss 再 manage 兜底）——如需消除陌生人行探查侧信道。
- **审批中心深化余项（承接 SPEC-021 §9）**：自动升级动作 / 多级升级 / 审批人维度超时统计驾驶舱 / 前端超时 Tag。
- **SPEC-020 加签 minor 承接**：目标重复 PENDING task 去重 / 幂等 key。
- **SEC-2026-002（react-router v8 迁移专项）**：2026-08-29 到期。

## 10. 双渠道验收链

Task 1 实现者渠道实现 + 协调者渠道独立审查（task-1-review-package 双件）；Task 1 审查结论 **Approved / 0 Critical / 0M / 4M**（M×4 照录：M1 getInstance 存在性时序侧信道轻微扩大 / M2 listInstances 校验先于权限 / M3 manage-only 详情不对称——Task 2 详情兜底落位 / M4 controller 注释过时——Task 2 顺手更新）。Task 1 评审确认：listInstances 四值 + 动态门控 + role='ALL' 空 where；getInstance 三判定 + manage 放行 + 404 fail-closed；hasManagePermission try/catch（authorization-service 无 hasAction 实测）；动作权限不扩大（4 方法零 manage 掺入）；测试真实性 4 例非恒真；零回归 + tsc/eslint 0。Task 2（本任务）为前端「全部审批」Tab + M3 详情兜底 + M4 注释 + 全量闸门 + security/baseline/bootstrap/docs-leakage + runbook/closeout；SPEC-023 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑，终探同 0）。

## 11. 收官状态

**SPEC-023 本地闭环（2026-08-03）**：2/2 任务完成；全组织视图落地——**零结构变更**（迁移 **26**/模型 **60**/权限设计口径 **124**（实测 **123** 外部漂移在制）/事件 **15**/路由 **11** 全不变）；后端本 SPEC 净增 **+4**，全量串行（静默窗重跑终态）**1850 tests / 1844 pass / 2 fail / 4 skipped**（**0 真 fail 为权威**——初跑 15 例共享 DB 撞车重跑全绿不计 + 2 例 SPEC-022 已知外部漂移照录不计）；前端 **28/28**（26 既有 + 2 新）+ typecheck 0 + lint 0 err（预存 warning 照录）+ build 成功；security:test **34/34** 零新增；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；Task 1 评审 M×4 全部接受/落位（M3 详情兜底、M4 注释更新随 Task 2）；已知非阻断项 §7 照录（含 Task 1 报告计数口径笔误、外部漂移、共享 DB 撞车、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
