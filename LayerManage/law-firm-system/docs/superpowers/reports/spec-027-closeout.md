# SPEC-027 其余域并发测试确定性化（Other-Domain Concurrent Test Determinism — Contract/Finance/Authorization/Auth/Acceptance）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-026 closeout §9「其余域并发用例确定性化推广——finance/contract/CRM 等域若存在 Promise.allSettled 时序竞争并发用例」+ SPEC-018/019/023/024 多次全量 flake 观察 ｜ 无人值守 subagent-driven（Task 1 评估；Task 2 评审裁决 + 闸门 + runbook/closeout 收尾）

## 1. 交付范围

将 SPEC-026 确立的并发测试确定性纪律推广到**其余域**（contract/finance/authorization/auth/admin-governance/acceptance）——逐一评估 **11 处** `Promise.allSettled` 并发用例，确认确定性、修补真 flake。**关键结论：11 处全部已确定性（FOR UPDATE 行锁钉法 / 服务内版本守卫 / 唯一+EXCLUDE 约束），零真 flake，零代码改动（零结构变更）**。唯一 E 类真 flake 仍为 SPEC-026 已修 :2128。

1. **Task 1（评估）**：contract-service :908/:1516、negotiation :661、receivable :1130、receivable-void :509/:585、governance-concurrency :50/:73、user-grant :50、step-up :221、spec-005-acceptance :177 逐一评估 → **11 处全部已确定性，零改动**（8 目标文件逐字未动）。清净窗多次运行零 flake（8 文件 **135/135 ×2**）；相关域零回归（contract **241/241** + 四域 **364/364**）；tsc/eslint 0。
2. **Task 2（本报告）**：评审裁决照录（Task 1 评估正确，**0C/0I/2M**）+ 后端全量闸门（清净窗串行，实测）+ security/check 闸门 + runbook §8 补其余域并发用例评估结论（11 处机制清单）+ 本 closeout 十一节。

**变更文件（共 0 件代码，零结构变更）**：无测试/生产文件改动（8 目标文件逐字未动）。runbook/closeout 为本任务文档收尾（非代码变更）。未触碰：生产代码/迁移/模型/权限/事件/路由。

## 2. 工具链

Node test runner（后端串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0（沿 SPEC-017-026 实证零影响）。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true。全程零 git 操作。测试 env 块按项目纪律（持久化文档占位符口径：`JWT_SECRET="<redacted>"`/URL 去口令）。

## 3. 测试计数链

### 3.1 用例评估（Task 1，11 处并发用例逐一评估）

| # | 文件:行 | 用例 | 确定性机制 | 真 flake? | 改造方式 | 裁决 |
|---|---|---|---|---|---|---|
| 1 | contract-service :908 | concurrent approveContract 一胜一 VERSION_CONFLICT | 第三方事务 FOR UPDATE 行锁 1s 钉法（两 findFirst 均读 v2 后 updateMany 被锁阻塞；锁释放后败者 READ COMMITTED 重评 where → count=0 → VERSION_CONFLICT） | 否 | 零改动 | 保留 |
| 2 | contract-service :1516 | concurrent effectContract 一胜一 VERSION_CONFLICT | 同上 FOR UPDATE 行锁钉法（先翻转后副作用 → 败者零计划/零委托/零事件） | 否 | 零改动 | 保留 |
| 3 | negotiation :661 | concurrent closeNegotiation 一胜一 VERSION_CONFLICT | 同上 FOR UPDATE 行锁钉法 | 否 | 零改动 | 保留 |
| 4 | receivable :1130 | concurrent confirmPayment 双成功恰一次应用 | 合同行 FOR UPDATE 钉法 → 败者 updateMany 重评（status 已 CONFIRMED）→ count=0 → 幂等重放成功 | 否 | 零改动 | 保留 |
| 5 | receivable-void :509 | void vs confirm 串行化总额不变式 | 合同行 FOR UPDATE 钉法 → 双调用均成功，序无关不变式断言 | 否 | 零改动 | 保留 |
| 6 | receivable-void :585 | void vs execute 一胜一 PAYMENT_STATE_INVALID 409 | 合同行 FOR UPDATE 钉法 → 败者 updateMany 状态守卫 → 409 全回滚；胜者分支序无关 | 否 | 零改动 | 保留 |
| 7 | governance-concurrency :50 | 双 reviewer 恰一 mutation，败者 OPERATION_ALREADY_PROCESSED | 服务内 lockOperation（admin_operation FOR UPDATE）+ version 守卫 → 败者锁后读 version=2≠1 → 409 钉死 | 否 | 零改动 | 保留 |
| 8 | governance-concurrency :73 | 双 resume 恰一 execution | resume→claim 首锁 FOR UPDATE + version 守卫 → 败者 version 失配 409（断言未查败者码，但确定性） | 否 | 零改动 | 保留 |
| 9 | user-grant :50 | 并发 grantRole 一胜一 AUTHORIZATION_IN_USE | user_role_no_overlapping_active_grants **EXCLUDE 约束**（P2004/P2002 → inUse 409）——沿 SPEC-026 §8「唯一约束一胜一败」先例 | 否 | 零改动 | 保留 |
| 10 | step-up :221 | 5 并发错误码恰 4×STEP_UP_INVALID + 1×MFA_RATE_LIMITED | 服务内 lockSession（auth_session FOR UPDATE）串行化 → 失败计数 1→5 确定，排序后断言宽容序 | 否 | 零改动 | 保留 |
| 11 | spec-005-acceptance :177 | 双 review 恰一 mutation | 服务内 lockOperation FOR UPDATE + version 守卫（同 #7） | 否 | 零改动 | 保留 |

**结论**：11 处全部为已确定性（机制=FOR UPDATE 行锁 6 处 / 服务内版本守卫 4 处 / 唯一+EXCLUDE 约束 1 处），零真 flake，**零改动**。无 version 前置可加处（无 client version 参数的竞速均已被 FOR UPDATE 钉法/服务内锁消除时序），无需要宽断言处（SPEC-026 :2128 类「loser 读落提交后」时序已被行锁钉法排除）。

### 3.2 Task 1 验证（Task 1 报告，清净窗）

| 检查 | 结果 |
|---|---|
| 8 目标文件合并 pass1 | **135/135** 零 fail（含全部 11 处并发用例） |
| 8 目标文件合并 pass2 | **135/135** 零 fail（×2 连跑零 flake） |
| contract 相关域回归 | **241/241** 零 fail |
| finance+authorization+auth+admin-governance 四域回归 | **364/364** 零 fail |
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint`（8 目标文件） | **exit 0** |

### 3.3 Task 2 验证（本报告，清净窗终态）

| 检查 | 结果 |
|---|---|
| 后端全量串行（清净窗终态） | **1880 tests / 1871 pass / 5 fail / 4 skipped**——5 fail 全为外部漂移或撞车（下详），**0 真 fail 为权威** |
| fail 分类 | **SPEC-028 外部漂移 ×2**（`/approvals/export` 新路由未实现，隔离复跑确认失败）+ **trust-root-guard 外部漂移 ×2**（`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，SPEC-022/026 在制漂移，隔离复跑确认失败）+ **login 撞车 ×1**（`PrismaClientUnknownRequestError` 外来 TRUNCATE 诱导，隔离复跑确认通过） |
| `npx tsc --noEmit`（Task 2 复验） | **exit 0** |

### 3.4 其他闸门（本报告实测）

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约 2→7） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变）——零测试/生产代码改动（评估非新增）。后端测试数不变（本 SPEC 零净增；全量 1880 较 SPEC-026 终态 1874 的 +6 系外部 SPEC-028 新增测试，非本 SPEC 引入）。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️）

| # | 决策 | 值 |
|---|---|---|
| D1 | 评估优先 | 逐一审读各用例：已确定性（唯一约束/version 守卫/宽容断言）→ 零改动；真 flake → 改造确定性/宽容断言（SPEC-026 :2128 先例） |
| D2 | 改造模式 | version 前置确定性（有 client version 参数）或宽容断言（无 version 参数）——沿 runbook §8 纪律 |
| D3 | 适用面 | 11 处逐一评估（contract-service :908/:1516、negotiation :661、receivable :1130、receivable-void :509/:585、governance-concurrency :50/:73、user-grant :50、step-up :221、acceptance :177） |
| D4 | 断言不变 | 改造仅改触发方式，预期结果不变（一胜一败/409/终态）——本 SPEC 无改造（不适用） |
| D5 | 不可确定性化保留 | 11 处全部按现状保留（D1/D3「已确定性 → 零改动」；改动会降低测试价值——如 EXCLUDE 约束一胜一败本就是确定性的并发防御实证） |
| D6 | 零结构变更 | 仅测试评估，零文件改动；无生产代码/迁移/模型/权限/事件/路由变更 |

**实施期 ⚠️ 记录**：
- **M×2（Task 1 评审照录，0C/0I/2M）**：①brief/设计列「10 处」实为 **11 处**（contract-service 两处 :908/:1516——task-1 报告按 11 处理，brief 陈旧非缺陷）；②回归计数文件集未注明（contract 241/241 + 四域 364/364 无逻辑矛盾，建议留档）。
- **撞车期间禁跑（Task 1 + Task 2 均实证）**：共享 test DB TRUNCATE 竞态活跃——Task 1 首轮合并运行 20 例失败全为撞车签名（permission.createMany Unique / 40P01 死锁 / NotFoundError），按 runbook §8 纪律不计 + 静默窗重跑全绿；Task 2 全量初跑（run1）与二次起跑（run2）均遭外来进程持续 TRUNCATE 撞车（fast-fail 签名），**杀闸门等静默窗（pg_stat_activity=0 持续 60s）重跑**——run3 清净窗终态 1880/1871/5/4，其中 login 1 例撞车（`PrismaClientUnknownRequestError`，隔离复跑 ✔ 通过佐证）。
- **外部漂移照录（非本 SPEC 回归，本 SPEC 零代码改动）**：①**SPEC-022/026 在制 drift**：trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`（本报告隔离复跑 2/2 确认失败——确定性码失配非撞车）；②**SPEC-028 在制 drift**：`GET /approvals/export` 全组织视图导出新路由未实现，新增 2 例测试失败（隔离复跑确认）——外部并行渠道在制，归外部渠道。

## 6. 安全审计状态

`security:test` **34/34**（本报告实测 exit 0，零新增例外）。零新增权限/路由/依赖变更（零代码改动）。`check:docs-leakage` exit 0（占位符口径：持久化文档不落真实密钥/连接串口令——本 closeout 与 runbook 均不含 env 块真实值）。安全审计收敛承接既有：`security:audit:prod` 现存 2 个 production_high（SEC-2026-002 记录在案——brace-expansion egg 工具链专项 + react-router GHSA-qwww-vcr4-c8h2 2026-08-29 到期 v8 迁移专项），本 SPEC 零新增例外。

## 7. 已知非阻断项（照录）

1. **11 处已确定性用例保持原状**（FOR UPDATE 行锁 6 处 / 服务内版本守卫 4 处 / 唯一+EXCLUDE 约束 1 处）——零真 flake，改动会降低测试价值（如 EXCLUDE 约束一胜一败本就是确定性的并发防御实证）。
2. **共享 test DB 撞车（撞车期间禁跑）**：多文件批跑/全量偶发撞车（`permission.createMany` unique id 冲突 / <10ms 快败 / 行被并发 TRUNCATE 清空致 NotFound/401/Prisma 级联）——runbook §8 纪律（清净窗前探 pg_stat_activity=0、遇外来进程**禁跑**静候清净窗、撞车失败**不计**、静默窗重跑、不改测试助手/配置）。**本任务实证**：Task 2 全量 run1/run2 均撞车（外来进程持续 TRUNCATE），run3 清净窗终态 1880/1871/5/4 全绿（0 真 fail）。
3. **M×2**：brief/设计「10 处」vs 实际 **11 处**（陈旧非缺陷，报告按 11 处理）；回归计数文件集未注明（241/364 无逻辑矛盾，建议留档）。
4. **SPEC-022/026 外部漂移（照录不计）**：trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`——外部并行渠道在制漂移（本报告隔离复跑确认），非本 SPEC 回归。
5. **SPEC-028 外部漂移（照录不计）**：`GET /approvals/export` 全组织视图导出新路由在制未实现——新增 2 例测试失败（隔离复跑确认），归外部渠道；全量计数 1874→1880（+6 系 SPEC-028 新增测试，非本 SPEC）。
6. **承接既有已知项**：前端预存 vitest flake（隔离复跑全 PASS）；SEC-2026-002 观察；各 SPEC closeout §9 follow-up（加签/转交/全组织视图增强等）。

## 8. 对账项

- **零结构变更 + 零代码改动**：迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变——仅测试评估，零测试/生产文件修改。
- **测试计数**：11 处评估零改动 → 后端测试数不变；8 目标文件 135/135 ×2 连跑零 flake。
- **全量对账**：SPEC-026 终态 **1874** + 外部 SPEC-028 **+6**（新增测试）= **1880**（本 SPEC 零净增）；实测（清净窗重跑）**1880 tests / 1871 pass / 5 fail / 4 skipped**——5 fail 全为外部漂移 ×4（SPEC-028 ×2 + trust-root-guard ×2，隔离复跑确认）+ 撞车 ×1（login，隔离复跑通过），**0 真 fail 为权威**——本 SPEC 零改动全绿。skip 4 = spec-008 排练 3 例 port-55432 锁定件（经 `--test-skip-pattern` 照录排除）+ 1 例既有显式 skip（沿 SPEC-024/025/026 终态口径）。
- **零 flake 实证**：8 目标文件 135/135 ×2 + contract 241/241 + 四域 364/364——11 处并发用例零 flake。
- **撞车佐证**：Task 1 首轮 20 例撞车失败 → 隔离复跑全绿；Task 2 run1/run2 全量撞车 → run3 清净窗终态；login 撞车失败 → 隔离复跑 `✔ initial login normalizes username` 通过。
- **docs-leakage 占位符口径**：closeout/report 不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **其余域并发用例已确认确定性**——如需可推进**生产层并发加固审计**（contract/negotiation/receivable 已由 FOR UPDATE + 乐观锁覆盖；生产并发正确性审计确认为候选专项）。
- Definition 导入导出增强（格式版本 / 增量导出 / 关联角色供给——SPEC-025 §9）。
- 权限计数契约同步（外部 role-membership / trust-root-guard 错误码漂移在制——归外部渠道）。
- 全组织视图导出（`/approvals/export`，SPEC-028 在制——归外部渠道）。
- 全组织视图增强（筛选/搜索/导出）；加签/转交 minor；SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）。
- 测试环境指纹（承 runbook §8）：共享 test DB 撞车禁跑纪律已补入 runbook——后续任何并发渠道全量跑前须清净窗前探。

## 10. 双渠道验收链

- **Task 1（评估其余域并发用例）**：11 处逐一评估全部已确定性零改动——评估表（机制：FOR UPDATE 行锁 6 处 / 服务内版本守卫 4 处 / 唯一+EXCLUDE 约束 1 处）+ 清净窗 ×2 连跑 135/135 零 flake + contract 241/241 + 四域 364/364 + tsc/eslint 0。评审 Approved（**0C/0I/2M**——M×1 brief 计数 10 vs 11 陈旧；M×2 回归计数文件集未注明）。
- **Task 2（评审 + 闸门 + 文档，本报告）**：评审裁决照录（Task 1 评估正确）；后端全量串行（清净窗终态）**1880 tests / 1871 pass / 5 fail / 4 skipped**（5 fail = 外部漂移 ×4 + 撞车 ×1，隔离复跑确认，**0 真 fail**）+ tsc 0；security:test **34/34** + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0；runbook §8 补其余域并发用例评估结论（11 处全已确定性——FOR UPDATE 行锁/服务内锁/EXCLUDE 约束机制清单）；本 closeout 收口。

## 11. 收官状态

**SPEC-027 本地闭环（2026-08-04）**：2/2 任务完成（Task 1 其余域并发用例评估：11 处全部已确定性零改动——FOR UPDATE 行锁 6 处 + 服务内版本守卫 4 处 + 唯一+EXCLUDE 约束 1 处，零真 flake；Task 2 评审裁决 + 后端全量闸门 + runbook/closeout 收尾）。**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **13** 全不变，零代码改动）；8 目标文件 **135/135 ×2 连跑零 flake** + contract **241/241** + 四域 **364/364** 零回归 + tsc/eslint 0；后端全量串行（清净窗终态）**1880 tests / 1871 pass / 5 fail / 4 skipped**（5 fail = SPEC-028 外部漂移 ×2 + trust-root-guard 外部漂移 ×2 + login 撞车 ×1，隔离复跑确认分类，**0 真 fail 为权威**）；security:test **34/34** 零新增 + check:baseline PASS（26 迁移/60 model）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）。runbook §8 并发测试确定性纪律 + 撞车期间禁跑 + 其余域并发用例评估结论已落地；已知非阻断项 §7 照录（已确定性用例、共享 DB 撞车、M×2、SPEC-022/028 外部漂移、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
