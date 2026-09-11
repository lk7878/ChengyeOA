# SPEC-017 审批定义管理 — 收尾报告

日期：2026-08-02 ｜ 状态：**本地闭环**（Task 1-3 双渠道 Approved + Task 3 验收闸门全绿）
需求来源：SPEC-013 closeout follow-up「Definition 管理」+ SPEC-016 closeout §9「Definition CRUD（approval.manage 码未建）」
设计：docs/superpowers/specs/2026-08-02-approval-definition-management-design.md ｜ 实施台账：.superpowers/sdd/2026-08-02-approval-definition-management/progress.md

## 1. 交付范围

**审批定义管理 CRUD 端到端**（Definition 由只读种子 5 类升级为自服务运营管理），**零迁移/零模型变更**（复用 ApprovalDefinition 全部既有字段 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）：

- **权限码（Task 1）**：`approval.manage`（ACTION/LOW）——定义管理创建/更新/禁用/启用/全量列表。权限目录 **121→122**；不授 bootstrap 业务角色（管理权限归系统/管理员）。**部署提示**：码仅入静态目录未入迁移 INSERT（D11 零迁移）——已初始化系统需重跑 `npm run system:bootstrap` 方落 `permission` 表（见 §5/§7）。
- **服务层 CRUD（Task 1）**：`ApprovalDefinitionService` +4 方法 `createDefinition`（code 唯一 + 三校验 + version=1/ACTIVE + 审计）/`updateDefinition`（白名单 name/formSchema/approverRule/nodeSchema，version+1，code/businessType/status 不可改）/`setDefinitionStatus`（ACTIVE↔DISABLED，version+1）/`listAllDefinitions`（全量含 DISABLED，code 升序，无分页）——均 requireAction `approval.manage` 第一行；+3 校验助手（nodeSchema 本地镜像 SPEC-016 buildApprovalChain 语义 / formSchema / approverRule）；+新错误码 `APPROVAL_DEFINITION_CODE_CONFLICT`（400，7→8）。
- **控制器 + 路由（Task 2）**：`approvalController` +3 方法（createDefinition / updateDefinition PATCH 双职责 / listDefinitionsManage）；`router.ts` approval 域 **6→9**（+POST /definitions、+GET /definitions/manage、+PATCH /definitions/:code，全 `approval.manage`，manage 字面量先于 :code）；M1 code 校验收紧 `^[A-Z][A-Z0-9_]{0,99}$`。
- **前端定义管理页（Task 3）**：`ApprovalCenterPage` +第 4 Tab「定义管理」（`approval.manage` 门控——无码用户不见 Tab）+ 管理列表（code/name/businessType/status Tag **ACTIVE 蓝 / DISABLED 灰**/version/updatedAt/操作）+ 新建/编辑共用 Modal（code/businessType 仅新建可改；formSchema/nodeSchema 简化 JSON 文本；编辑展示 version）+ 禁用/启用 Popconfirm → PATCH status；`api/approval.ts` +createDefinition/listDefinitionsManage/updateDefinition 三方法 + `CreateDefinitionInput`/`UpdateDefinitionInput` 镜像后端；既有三 Tab + 详情弹窗零改动。
- **运维文档（Task 3，本报告）**：runbook §9 补「定义管理（approval.manage，SPEC-017）」段（§9.10）+ 本 closeout。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 权限码 + 服务 CRUD | definition-service **12/12**（create 成功/冲突 400/nodeSchema 空数组+非数组 400/approverRule 400/formSchema 400/update 白名单+version+1/404/setStatus 禁→apply 404+恢复/listAll/403）+ approval 域 **94/94**（instance 48 + policy/catalog/definition 46）+ 权限相关 **60/60** + tsc/eslint 0 |
| 2 | 控制器 + 路由 | definition-service **16/16**（12+M1 1+M3 3）+ approval-api **18/18**（既有 12+新 6）+ approval 域 **98/98** 零回归 + tsc/eslint 0 |
| 3 | 前端定义管理页 + 闸门/文档（本报告） | ApprovalCenterPage **17/17**（既有 12+新 5）+ typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning）；见 §3.2 |

### 3.2 最终全量（Task 3 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（串行） | Task 1 **94/94** + Task 2 **98/98**（含 approval-api 18 + definition-service 16）全绿 |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1798 tests / 1794 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（**26 迁移/60 model**）/ PASS（角色契约 **2→7**）/ exit 0（占位符口径） |
| 前端四闸门 | ApprovalCenterPage **17/17** + typecheck 0 + lint 0 err（预存 4 warning 照录）+ build 成功（仅预存 chunk-size warning） |
| server typecheck | `npx tsc --noEmit` 0（Task 1/2 已验，Task 3 零 server 改动复验通过） |

### 3.3 全量合计（Task 3 实测，清净窗）

**实测：1798 tests / 1794 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归）。

SPEC-017 净增（后端）：Task 1 definition-service **+12** + Task 2 definition-service **+4** + approval-api **+6** = **+22**（前端 Task 3 为前端件，不计后端计数）。

> **对账**：同闸门口径 pre-SPEC-017 基线 = 1798 − 22 = **1776**（含 SPEC-016 补强闭环 +4 后口径；与 SPEC-016 closeout §7-15「1771→1775 预期」的 +1 系 glob 枚举 vs 静态预期差，以实测 **1798/1794/0/4** 为权威）。**0 真 fail 为权威结论**，计数链终态以实测为准（§3.2）。

## 4. 迁移与模型

- **迁移总数 26 不变**（SPEC-017 **零新增迁移**——复用 ApprovalDefinition 全部既有字段，D11 零结构变更）；**model 60 不变**；**权限 121→122**（+`approval.manage`，ACTION/LOW）；**事件 15 不变**；**路由 approval 域 6→9**（+3 管理路由全 `approval.manage`）。
- **SPEC-017 无新增迁移**：`approval.manage` 权限码落静态目录（authorization-types `PERMISSION_CODES` + permission-catalog `PERMISSION_CATALOG`）而非迁移 INSERT——符合 D11 零迁移，但**既有已初始化部署需重跑 `npm run system:bootstrap`** 方落 `permission` 表（部署提示，见 §5/§7）。
- check:baseline PASS（CANONICAL **26 迁移/60 model**）；check:bootstrap PASS（角色契约 **2→7**——SPEC-017 未动角色）。
- **路由终态**（approval 域 9 条）：既有 6 条（GET /definitions approval.apply、GET /approvals、GET /approvals/:id、POST /approvals、POST /:id/withdraw、POST /:id/process）+ SPEC-017 3 条（POST /definitions、GET /definitions/manage、PATCH /definitions/:code，全 approval.manage）。

## 5. 关键裁决记录（D1-D11 + 实施期 ⚠️ 裁决累积）

设计 §2 D1-D11 全项照录：

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 权限码 | `approval.manage`（ACTION/LOW，目录 121→**122**；不授 bootstrap 业务角色） |
| D2 | 操作语义 | create（code 唯一）/ update（白名单，version+1）/ disable=setStatus(DISABLED) / enable=setStatus(ACTIVE) / listAll（含 DISABLED） |
| D3 | 版本语义 | update/status 切换 version+1；既有实例 definitionVersion 快照不变（实例按快照流转不追溯） |
| D4 | 禁用约束 | DISABLED 定义 apply → 既有 getActiveDefinition（status:'ACTIVE' 过滤）→ `APPROVAL_DEFINITION_NOT_FOUND` 404（零改动复用） |
| D5 | code 不可变 | create 后 code/businessType 不可改（update 白名单排除；业务类型变更应新建定义） |
| D6 | nodeSchema 校验 | null/undefined 合法（顶层 approverRule 单节点）；非空数组逐元素 {name, approverRule}；空数组/非数组对象 → `APPROVAL_ASSIGNEE_INVALID` 400 |
| D7 | formSchema 校验 | 非空对象含 fields 数组；每字段 {key/label string, type∈date|text|textarea|number, required?}；畸形 400 |
| D8 | approverRule 校验 | 非空对象 {type∈USER|ROLE, userIds?/roleCodes? 数组}；畸形 → `APPROVAL_ASSIGNEE_INVALID` 400 |
| D9 | 审计 | create/update/status 落 operation_log（targetType APPROVAL_DEFINITION，action 各自码） |
| D10 | 路由 | 3 管理路由挂 `approval.manage`；列表/详情仍挂 approval.read/apply 不变 |
| D11 | 零结构变更 | 无迁移/模型/事件/订阅变更 |

**实施期裁决（Task 1-3 评审追认，逐条照录）**：

1. **Task 1 ⚠️① → M1（Task 2 收紧）**：code normalize 未强制大写+下划线——Task 2 收紧 `^[A-Z][A-Z0-9_]{0,99}$`（先格式后唯一；getActiveDefinition/listDefinitions 不收紧零回归）。
2. **Task 1 ⚠️② → M2（接受）**：update/setStatus **无乐观版本锁**（updateMany 无 version 条件）——审计轻微失真不损坏数据，**列已知非阻断**（§7），不加固。
3. **Task 1 ⚠️③ → M3（Task 2 补测）**：create null nodeSchema 回落 / update null→DbNull / update 空对象 `{}` 仅 version+1——Task 2 补 3 例（写时即绿，Task 1 服务已满足）。
4. **Task 2 ⚠️① PATCH 同体非单事务**：update 与 status 各为独立事务（controller 两次 service 调用）——controller 层 status 枚举预检 + update 字段校验先于 status 落库，覆盖全部可预期失败路径；**极端进程中断仍可能半应用**（半应用=update 已落 status 未落），列已知非阻断（§7）；如需真原子性后续 service 层增组合方法。
5. **部署提示（协调者补充）**：approval.manage 仅入静态目录未入迁移 INSERT——符合 D11 零迁移，但**已初始化系统需重跑 `npm run system:bootstrap`** 才落 permission 表（否则角色授予/前端门控落空 404）。
6. **Files 清单偏离（Task 1/3 各自照录）**：Task 1 实际 11 文件（权限码落点 authorization-types/permission-catalog + 5 计数测试 + approval-policy 7→8 系必要机械后果）；Task 3 前端 +`features/authorization/types.ts`（`approval.manage` 入 `PERMISSION_CODES` 镜像——hasPermission('approval.manage') 类型门控 + 角色授予目录的必要落点，沿 Task 1 先例）。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011/012/013/014/015/016 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 3 占位符口径**：runbook/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令（测试连接串以 127.0.0.1:55433 `_test` 库指代，不落真实口令）。

## 7. 已知非阻断项（评审累积逐条照录）

1. **M2 无乐观版本锁**（minor）：update/setStatus 无 version 条件——并发覆盖时审计 version+1 仍单调，仅审计轻微失真不损坏数据；列 follow-up 可选加固（§9）。
2. **PATCH 同体非单事务**（minor）：update 与 status 各为独立事务——controller 预检覆盖可预期失败路径，极端进程中断半应用风险接受；如需真原子性后续 service 组合方法（§9）。
3. **code 命名惯例**（信息性）：`^[A-Z][A-Z0-9_]{0,99}$`——种子五类（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER）全部满足；运营新增须遵循。
4. **部署提示**（运维）：approval.manage 需重跑 bootstrap 落 permission 表（§5-5）；fresh 库 init 即含（bootstrap 供给）。
5. **Files 清单偏离**（信息性）：Task 1 11 文件 / Task 3 +types.ts——必要机械后果，全仓 grep 无越界（§5-6）。
6. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：审批中心深化余项（会签/转交/加签/超时升级/全组织视图/审批人表达式/节点级事件——设计 §9 明确 OUT）；terminate 侧硬化（SPEC-014 MEDIUM 承接）；SUPPLEMENT 父状态复查；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；预存漂移已由 `20260802120000_schema_drift_reconcile` 闭环；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）；业务角色成员指派归运行期（role-auth-service/user-grant）。

## 8. 对账项

1. **权限对账**：`approval.manage` 服务端 `PERMISSION_CODES` = `PERMISSION_CATALOG` = **122**；前端 `features/authorization/types.ts` `PERMISSION_CODES` +`approval.manage`（镜像同步）。
2. **错误码对账**：`APPROVAL_DEFINITION_CODE_CONFLICT`（400）注册 + policy 域错误码计数 7→8（Task 1 已同步）。
3. **结构终态对账**：迁移 **26 不变** / 模型 **60 不变** / 权限 **121→122** / 事件 **15 不变** / 路由 approval **6→9** / 角色 **7 不变**——与设计 §3/§8 逐字对齐（D11 零结构变更）。
4. **docs-leakage 占位符口径**：runbook/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012/013/014/015/016 先例），扫描 exit 0。
5. **`localhost` vs `127.0.0.1`**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）。
6. **闸门计数按实际运行数**：Task 3 全量按实际运行计数（非静态估计），计数链终态以实测为准。

## 9. Follow-up 路由（候选专项）

- **M2 乐观版本锁加固**（本 SPEC minor）：update/setStatus 增 version 条件（updateMany {id, version}），防并发覆盖审计失真。
- **PATCH 同体真原子性**（本 SPEC minor）：service 层增组合方法（update+status 单事务）替换 controller 两次调用。
- **Definition 导入导出/复制**（设计 §9 OUT）：运营批量建定义的支撑。
- **Definition 物理删**（设计 §9 OUT）：当前仅软禁（DISABLED）防实例追溯断裂。
- **成员指派运营指南**（SPEC-015 承接，紧邻）：5 个 BUSINESS 审批角色（HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER）成员归运行期指派，指派后五类审批方可产生实际审批人。
- **审批中心深化（承接既有）**：会签（节点内多人）/ 转交 / 加签 / 超时升级 / 全组织视图（approval.manage 仅定义管理，视图全量归另行）/ 审批人表达式 / 节点级事件。
- **terminate 侧硬化**（SPEC-014 MEDIUM 承接）：terminate 侧在途闸 Contract FOR UPDATE + 锁后重验。
- **SUPPLEMENT 父状态复查**：独立 follow-up。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。

## 10. 双渠道验收链

Task 1-3 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 **Approved / 0 Critical**（Task 1 ⚠️×3 / Task 2 ⚠️×1 全照录——§5/§7）。Task 3（本任务）为验收与收尾：前端定义管理页 + 全量闸门 + runbook/closeout 两文档落地；SPEC-017 全程共享 55433 测试库清净窗纪律（DB 前探 pg_stat_activity=0 起跑），无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-017 本地闭环（2026-08-02）**：3/3 任务完成；权限码 `approval.manage`（目录 **121→122**）/服务 CRUD 4 方法 + 新错误码（7→8）/控制器 + 路由（approval 域 **6→9**，全 manage）/前端「定义管理」Tab（门控 + 列表 + 新建/编辑 + 禁用 Popconfirm）；**零迁移/零模型/零事件变更**（迁移 **26**/模型 **60**/事件 **15**/角色 **7** 全不变）；后端本 SPEC 直接改动面 Task 1 **94/94** + Task 2 **98/98**，全量串行 **1798 tests / 1794 pass / 0 fail / 4 skipped**（**0 真 fail 为权威**）；security:test **34/34** 零新增；check:baseline PASS（**26 迁移/60 model**）+ check:bootstrap PASS（角色契约 **2→7**）+ check:docs-leakage exit 0（占位符口径）；前端四闸门 ApprovalCenterPage **17/17** + typecheck 0 + lint 0 err（预存 4 warning）+ build 成功；已知非阻断项 §7 共 7 条照录（含承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
