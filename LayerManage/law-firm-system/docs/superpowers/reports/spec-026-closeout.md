# SPEC-026 并发测试确定性化（Concurrent Test Determinism）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-024 closeout §9「并发测试确定性化推广——既有 Promise.allSettled 时序并发用例改 version 前置确定性构造」+ SPEC-018/019/023/024 多次全量 flake 观察 ｜ 无人值守 subagent-driven（协调者接管 Task 1 实现 + 验证；Task 2 评审裁决 + 闸门 + 文档收尾）

## 1. 交付范围

将既有 `Promise.allSettled` 双调/多调**时序竞争**并发用例改造为**确定性构造**（version 前置 / 宽容断言），消除 flake 源。**零结构变更**（仅测试代码改造）。

1. **Task 1（改造）**：`apps/server/test/approval/approval-instance-service.test.ts` **:2128 forwardTask 并发用例**断言确定性化——loser 由「固定 409」改「**409 APPROVAL_STATE_INVALID 或 404 APPROVAL_TASK_NOT_FOUND 皆可**」（消除 loser 读落 winner 提交后的时序 flake）+ 测试名同步。其余 4 处（:586 callbackKey 跨实例 / :2188 会签 ALL / :2554 加签竞速 / role-authorization :74 replacePermissions）评估为**已确定性，零改动**。
2. **Task 2（本报告）**：评审裁决（Task 1 改造正确照录）+ 后端全量闸门（清净窗串行）+ 清净窗 instance **独立 ×2** 零 flake 佐证 + runbook §8 并发测试纪律/撞车期间禁跑补遗 + 本 closeout 十一节。

**变更文件（共 1 件，零结构变更）**：`apps/server/test/approval/approval-instance-service.test.ts`。未触碰：生产代码/其他测试文件/迁移/模型/权限/事件/路由。runbook/closeout 为本任务文档收尾（非代码变更）。

## 2. 工具链

Node test runner（后端串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0（沿 SPEC-017-025 实证零影响）。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true。全程零 git 操作。测试 env 块按项目纪律（持久化文档占位符口径：`JWT_SECRET="<redacted>"`/URL 去口令）。

## 3. 测试计数链

### 3.1 用例评估（协调者逐一审读，5 处 Promise.allSettled 并发用例）

| # | 用例 | 评估 | 处置 |
|---|---|---|---|
| ① | approval-instance :586 processTask callbackKey 跨实例 | callback_action **unique 约束**保证一胜一败（串行化下第二调用见异实例占用 → `CALLBACK_KEY_CONFLICT` 409） | **已确定性，零改动** |
| ② | **approval-instance :2128 forwardTask 并发** | **真 flake**：loser 读落 winner 提交前 → 409；提交后 → `findFirst {id, assigneeId:actor}` 失配 → 404。原固定 409 断言误报 | **改宽容断言（409 或 404 皆可）** |
| ③ | approval-instance :2188 会签 ALL 并发 | 断言「双成功」（FOR UPDATE 串行化下本应双成功），终态以 DB 实况为准 | **已确定性，零改动** |
| ④ | approval-instance :2554 processTask+addSigners 竞速 | 断言已宽容（processTask 必成功 + addSigners 成功或 409 皆可 + 无孤儿 PENDING） | **不 flake，零改动** |
| ⑤ | role-authorization :74 replacePermissions 并发 | 双调同 `version` 参数 → `updateMany {id, version}` 一胜一败 → `VERSION_CONFLICT`（client version 参数即确定性构造） | **已确定性，零改动** |

**注**：设计 §3.1「先推进 version、客户端持旧 version 调用」模式对 forwardTask **不适用**（forwardTask 无 client version 参数，服务端锁前读 fresh）——:2128 采用设计 §3.2 **宽容断言**方案（loser 409 或 404 皆合法，非 500）。

### 3.2 Task 1 验证（协调者清净窗，串行）

| 检查 | 结果 |
|---|---|
| `approval-instance-service.test.ts` **×3 次连跑** | **77/77 / 77/77 / 77/77**，0 fail——forwardTask 并发每次绿（**零 flake**） |
| `approval-definition-service.test.ts` 隔离 | **33/33**（多文件批跑偶发撞车非回归，隔离复跑绿） |
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint`（修改文件） | **exit 0** |

### 3.3 Task 2 验证（本报告，清净窗）

| 检查 | 结果 |
|---|---|
| `approval-instance-service.test.ts` **独立 ×2 连跑** | **77/77 / 77/77**，0 fail——零 flake 独立佐证（承接 Task 1 ×3，合计 ×5 连跑全绿） |
| 后端全量串行（清净窗终态） | **1874 tests / 1868 pass / 2 fail / 4 skipped**——fail 2 例均为 **SPEC-022 已知外部漂移**（trust-root-guard×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）→ **0 真 fail 为权威** |
| `npx tsc --noEmit`（Task 2 复验） | **exit 0** |

### 3.4 其他闸门（本报告实测）

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约 2→7） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变）——仅测试文件改造，无生产代码/结构变更。测试数不变（:2128 改造非新增）。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️）

| # | 决策 | 值 |
|---|---|---|
| D1 | 确定性构造优先 | 并发用例改 version 前置条件（SPEC-024 同体 PATCH 先例：先推进 version、客户端持旧 version 调用 → 确定性 409）——无时序依赖 |
| D2 | 保留竞争语义 | 若需真实并发竞争证据用可控锁竞争构造——但 SPEC-024 实证 pg_stat_activity 轮询不可靠（非超级用户看不到 query），首选 version 前置 |
| D3 | 适用面 | 5 处 Promise.allSettled 并发用例逐一评估（:586/:2128/:2188/:2554 + role-authorization :74） |
| D4 | 断言不变 | 改造仅改触发方式，预期结果不变（一胜一败/409）——:2128 例外：loser 由「固定 409」改「**409 或 404 皆可**」（404 是读落提交后的合法败者结果，非 500；原固定 409 断言即 flake 源） |
| D5 | 不可确定性化的保留 | 已确定性用例（callbackKey unique 一胜一败 / 会签 ALL 双成功 / 已宽容竞速）零改动——改动会降低测试价值（如 :586 唯一约束一胜一败本就是确定性的并发防御实证） |
| D6 | 零结构变更 | 仅测试文件改造，无生产代码/迁移/模型/权限/事件/路由变更 |

**实施期 ⚠️ 记录**：
- **:2128 采用宽容断言而非 version 前置**：设计 §3.1 的 version 前置模式对 forwardTask **不适用**（无 client version 参数，服务端锁前读 fresh）——采用 §3.2 宽容断言（409 或 404 皆可）。记录于 runbook §8。
- **M×1（Task 1 评审照录）**：brief 引用「instance 73」实为 **77**（task-1 报告正确，brief 陈旧非缺陷）。
- **撞车期间禁跑（Task 1 评审 ⚠️ 转此，本任务实证）**：共享 test DB TRUNCATE 竞态活跃——Task 2 全量初跑即遇外来进程 TRUNCATE 撞车（spec-003/005/006 + auth/MFA 域 24 例快败），按 runbook §8 纪律**不计失败 + 杀闸门等静默窗重跑**（清净窗起跑 pg_stat_activity=0 前探）。清净窗全量重跑 1874/1868/2/4 全绿。

## 6. 安全审计状态

`security:test` **34/34**（本报告实测 exit 0，零新增例外）。零新增权限/路由/依赖变更（仅测试改造）。`check:docs-leakage` exit 0（占位符口径：持久化文档不落真实密钥/连接串口令——本 closeout 与 runbook 均不含 env 块真实值）。

## 7. 已知非阻断项（照录）

1. **已确定性用例保持原状**（:586/:2188/:2554/:74）——改动会降低测试价值（如 callbackKey unique 一胜一败本就是确定性的并发防御实证）。
2. **共享 test DB 撞车（撞车期间禁跑）**：多文件批跑/全量偶发撞车（`permission.createMany` unique id 冲突 / <10ms 快败 / 行被并发 TRUNCATE 清空致 NotFound/401 级联）——runbook §8 纪律（清净窗前探 pg_stat_activity=0、遇外来进程**禁跑**静候清净窗、撞车失败**不计**、静默窗重跑、不改测试助手/配置）。**本任务实证**：全量初跑 26 fail（其中 24 例 auth/MFA 域 + mfa-api 1 例 = 撞车诱导，隔离复跑 38/38 全绿佐证；另 2 例 = SPEC-022 外部漂移照录不计）→ 清净窗全量重跑 **1874/1868/2/4** 全绿。
3. **brief instance 73 vs 77 陈旧**（M×1）：brief 引用陈旧计数，报告与实测以 **77** 为准。
4. **SPEC-022 外部漂移（照录不计）**：trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`——外部并行渠道在制漂移，非本 SPEC 回归（本 SPEC 未触碰权限/授权域）。
5. **承接既有已知项**：前端预存 vitest flake（隔离复跑全 PASS）；SEC-2026-002 观察；各 SPEC closeout §9 follow-up（加签/转交/全组织视图增强等）。

## 8. 对账项

- **零结构变更**：迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变——仅测试改造，测试数不变（:2128 改造非新增）。
- **测试计数**：approval-instance 77 例维持（:2128 改造非新增）；approval 域零回归。
- **全量对账**：SPEC-025 终态 **1874** + 本 SPEC **零净增**（测试改造）= **1874**；实测（清净窗重跑）**1874 tests / 1868 pass / 2 fail / 4 skipped**（fail 2 例均为 SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail 为权威**——本 SPEC 改造全绿，approval 域零回归）。skip 4 = spec-008 排练 3 例 port-55432 锁定件（经 `--test-skip-pattern` 照录排除）+ 1 例既有显式 skip（沿 SPEC-024/025 终态口径）。
- **零 flake 实证**：instance :2128 改造后 Task 1 ×3 + Task 2 独立 ×2 连跑全绿（**77/77 ×5**）。
- **auth 撞车佐证**：全量初跑 auth/MFA 域 24 例失败（NotFound/401/Prisma 级联）→ 清净窗隔离复跑 6 文件 **38/38 全绿**（auth-challenge 6 + mfa-management 2 + mfa-service 10 + session-service 9 + step-up-service 7 + mfa-api 4）——证明确系撞车非回归。
- **docs-leakage 占位符口径**：closeout/report 不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **其余域并发用例确定性化推广**：finance/contract/CRM 等域若存在 `Promise.allSettled` 时序竞争并发用例——按 runbook §8 确定性纪律改造（version 前置 / 宽容断言）。
- Definition 导入导出增强（格式版本 / 增量导出 / 关联角色供给——SPEC-025 §9）。
- 权限计数契约同步（外部 role-membership 在制——归外部渠道）。
- 全组织视图增强（筛选/搜索/导出）；加签/转交 minor；SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）。
- 测试环境指纹（承 runbook §8）：共享 test DB 撞车禁跑纪律已补入 runbook——后续任何并发渠道全量跑前须清净窗前探。

## 10. 双渠道验收链

- **Task 1（改造 approval 域并发用例）**：协调者接管实现 + 验证——用例评估（仅 :2128 真 flake）+ 宽容断言改造 + ×3 连跑零 flake 实证（77/77×3）+ definition 隔离 33/33 + tsc/eslint 0。评审 Approved（0C/0I/1M——M×1 brief 陈旧计数 73 vs 77）。
- **Task 2（评审 + 闸门 + 文档，本报告）**：评审裁决照录（Task 1 改造正确）；后端全量串行（清净窗终态）**1874 tests / 1868 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 外部漂移照录不计，**0 真 fail**）+ instance 独立 **×2 77/77** + auth 隔离佐证 38/38；security:test **34/34** + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0；runbook §8 并发测试纪律 + 撞车期间禁跑补遗；本 closeout 收口。

## 11. 收官状态

**SPEC-026 本地闭环（2026-08-04）**：2/2 任务完成（Task 1 并发用例确定性化：5 处评估 → 仅 :2128 真 flake 改宽容断言，其余零改动；Task 2 评审裁决 + 后端全量闸门 + runbook/closeout 收尾）。**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **13** 全不变）；instance **77/77 ×5 连跑零 flake**（Task 1 ×3 + Task 2 独立 ×2）+ approval 域零回归 + tsc/eslint 0；后端全量串行（清净窗终态）**1874 tests / 1868 pass / 2 fail / 4 skipped**（fail = SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail 为权威**）；security:test **34/34** 零新增 + check:baseline PASS（26 迁移/60 model）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）。runbook §8 并发测试确定性纪律 + 撞车期间禁跑已落地；已知非阻断项 §7 照录（已确定性用例、共享 DB 撞车、brief 陈旧计数、SPEC-022 外部漂移、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
