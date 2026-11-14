# SPEC-034 安全审计门禁加固（Security Audit Gate Hardening）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-030/031 closeout §9「audit 门禁 moderate 纳入 gate + audit 基线快照固化（防静默回归）」+ SPEC-028 评审「历史基线不可复核」⚠️ ｜ 用户授权自主推进（无人值守，Task 1 moderate gate + 基线快照；Task 2 全量闸门 + runbook/closeout 收尾）
注：**编号沿革**——前会话以「SPEC-032」立项，核对台账发现 SPEC-032 已被并行通道 customer-business-analytics 占用（其 spec-032-closeout.md 已落地、memory 已记录）→ 暂改 **SPEC-033** → 与外部渠道案件办理专项（`2026-08-05-case-handling.md`）撞号 → **用户裁决案件办理 = SPEC-033、本专项 = SPEC-034**（plan/design/closeout 文件同步改号）。

## 1. 交付范围

把 npm audit 的 **moderate 纳入 production gate（>0 → block）** + **固化基线快照断言**（`expected-baseline.json` 声明各 severity 期望计数，audit 实测超基线 → fail）——堵住「未来依赖回退到 moderate 区间时 audit 门禁静默放行」的缺口，并使「改动前基线」可复核。**零业务代码变更**（仅 `scripts/security` 工具链 + baseline 文件，零 .ts 变更）；**零结构变更**（迁移 26 / 模型 60 / 权限 129 / 事件 15 / 路由 15 全不变——权限 129 为外部渠道在制态，本 SPEC 零权限变更）。

1. **Task 1（moderate gate + 基线快照）**：`audit-gate.mjs` moderate 纳入 severe 解析 + `loadBaseline`/`baselineExceeded` + `evaluateWorkspace` 加 baseline 参数；`policy.mjs` production moderate gate 'report'→'block' + `validateBaseline` + `loadSecurityConfiguration` 加载基线；新建 `expected-baseline.json`（server/web × production/development 各 severity 全 0）；`policy.test.mjs`/`audit-gate.test.mjs` +moderate gate + 基线用例（security:test 34→41→**42**）。Task 1 评审照录（I-1 已修 + M×4，§5/§7）。
2. **Task 2（本报告）**：后端全量闸门（清净窗实测 + 撞车纪律重跑，§3）+ security/audit/baseline/docs 闸门（§6）+ runbook §8 安全审计现状补 moderate gate + 基线说明 + 本 closeout 十一节。

**变更文件（共 6 件代码 + runbook + 本 closeout）**：Task 1 `scripts/security/audit-gate.mjs` + `policy.mjs` + `audit-gate.test.mjs` + `policy.test.mjs` + `cli.mjs`（+I-1 接线）+ 新建 `expected-baseline.json`（零业务代码）；Task 2 `docs/superpowers/runbooks/finance-operations.md`（§8 安全审计现状补 moderate gate + 基线说明，`security:test` 34→42 基线）；本 closeout。未触碰：生产代码/迁移/模型/权限/事件/路由。

## 2. 工具链

Node scripts（mjs）/ npm audit。Node test runner（串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0（沿 SPEC-017-032 实证零影响）。测试库 55433 `_test`；**55432 禁触**；ALLOW_TEST_DB_RESET=true；连接串一律 127.0.0.1；skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件。全程零 git 操作。测试 env 块按项目纪律（持久化文档占位符口径：`JWT_SECRET="<redacted>"`/URL 去口令）。

## 3. 测试计数链

### 3.1 Task 1 验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `security:test`（root） | **42/42 pass，0 fail**（SPEC-031 基线 34 → +8：policy +4 / audit-gate +4） |
| `security:audit:all`（root） | **server + web 双 passed=true**，production high=0/critical=0（moderate gate + 基线断言端到端生效） |
| `security:audit:prod`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| `security:policy:validate` | **pass**（exit 0） |

### 3.2 Task 2 验证（本报告，清净窗终态）

| 检查 | 结果 |
|---|---|
| 后端全量（清净窗前探 pg_stat_activity=0 起跑；撞车纪律） | **run1 撞车废弃**（外部渠道编辑 permission 文件中窗 → 77 文件模块加载失败 `Permission catalog does not match`）；**run2 被杀**（10 分钟 tool cap，期间 0 fail）；**run3（detached 跑完，权威）1900 tests / 1870 pass / 26 fail / 4 skip**——26 fail = **13 撞车**（`permission.createMany` TRUNCATE 竞态，7 个撞车文件清净窗隔离复跑 **95/95 全过**）+ **12 外部漂移**（trust-root ×2 / baseline-contract ×7 迁移 26→27 / permission-catalog ×2 122→129 / spec-003-router ×1）→ **0 真 fail 归 SPEC-034** |
| 隔离复跑（撞车文件清净窗） | 7 文件（spec-004/spec-005/administrator-account-adapter/master-data-adapter/event-worker/anomaly-service/invoice-service）**95 tests / 95 pass / 0 fail / 0 skip**（exit 0）——13 撞车全确认 |
| `npm run security:test`（cwd law-firm-system） | **42/42 pass**，exit 0 |
| `npm run security:audit:all`（root，复测） | **server + web 双 passed=true**，production high=0/critical=0 |
| `npm run security:audit:prod`（root，复测） | **server passed=true + web passed=true**，production high=0/critical=0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约 2→7） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径——含 runbook 更新后复扫） |

## 4. 迁移与模型

**零迁移、零模型变更（SPEC-034 自身）**——Task 1 仅 scripts/security 工具链（mjs）+ baseline 文件，零 .ts 变更；Task 2 仅文档。本会话 `check:baseline` 实测 **26 迁移 / 60 模型**（11:47 有效）；**会话期内外部渠道加迁移 #27 + 权限 124→129**（现树 27 迁移 / 129 权限）——本 SPEC 零结构变更，观测计数反映外部在制态（沿外部渠道收敛后核对）。事件 **15** / 路由 **15**（approval 域）不变。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ 编号重定 / I-1 / M×4 / 撞车分类）

| # | 决策 | 值 |
|---|---|---|
| D1 | moderate gate | audit-gate/policy：production **moderate 纳入 gate**（>0 → fail）——与 high/critical 同待遇（`security:audit:prod` 门禁 moderate=0） |
| D2 | 基线快照 | 固化基线 `scripts/security/expected-baseline.json` 声明各 severity 期望值（production + dev 全 0）；audit 实测任一 severity **超基线 → fail**（`evaluateWorkspace` baselineExcess） |
| D3 | 兼容 | 当前依赖已清零（production+dev 全 0）——基线 0 与现状一致，无例外；未来新增依赖须先加例外（policy EXCEPTION `advisories` 字段，development scope）或更新基线 |
| D4 | 验证 | `security:test`（含 policy/audit-gate 单测）+ `security:audit:all`/`prod` 全绿 + baseline 断言通过 |
| D5 | 零业务代码 | 仅 scripts/security + baseline 文件；零 .ts 业务变更 |

**实施期 ⚠️ 记录**：

- **编号沿革（SPEC-032→SPEC-033→SPEC-034）**：SPEC-032 被 customer-business-analytics 占用（已 closed）→ 暂改 SPEC-033 → 与案件办理撞号 → 用户裁决本专项 **SPEC-034**、案件办理保持 SPEC-033；plan/design/closeout 文件名同步。
- **I-1（评审已修）**：`config.baseline` 在 `loadSecurityConfiguration` 校验后未消费，CLI 经 audit-gate 的 `BASELINE_PATH` 二次重读同一文件（双路径解耦）。修：`runAuditCommand` 的 `evaluateWorkspace({...})` 显式传 `baseline: config.baseline`（2 行）——单一事实来源，路径解析不再解耦。
- **M-1（评审已修）**：`baselineExceeded` 在 expected>0 且 actual>expected 时把整个匹配数组推入 `baselineExcess` 而非超出额度尾部——修 `overBaseline.slice(expected)`（全 0 基线当前不可达，语义修正）。
- **M-3（评审已修/部分）**：补「malformed 注入基线 → fail-closed」测试（`evaluateWorkspace` baseline 非对象 → `expected audit baseline`）；missing-file/invalid-JSON 路径由既有全部未注入 baseline 的 `evaluateWorkspace` 用例隐式覆盖（其依赖 `loadBaseline()` 成功加载真实文件，文件缺失则全数失败）。
- **M-2（评审照录，文档归口）**：基线断言把 production **low 也硬阻断**（D2 全 severity 冻结 0 的推论；production low 无 gate block 亦无例外路径）——超出设计 §6「仅 moderate+ 收口」字面，但为 D2 预期行为，已在 runbook/closeout 明示，零当前影响。
- **M-4（评审照录，信息性）**：`cli.test.mjs`/`dependency-contract.test.mjs` diff 为既有漂移（日期/下限更新，SEC-2026-002 除名等），**不含** moderate/基线用例——计划字面「+moderate gate + 基线用例」对这些文件不成立（实际用例落在 policy/audit-gate 测试），套件仍全绿。
- **M-5（评审照录，信息性）**：基线文件位置 `scripts/security/expected-baseline.json`（非设计示例 `var/security/audit/`）——后者是 audit 运行时输出目录会被覆盖，前者（checked-in）才是正确选择。
- **全量 run 历史（本任务实测）**：**run1** 起跑前探 pg_stat_activity=0 清净，起跑后外部渠道编辑 permission-catalog.ts/authorization-types.ts（mtime 11:52-11:53）→ catalog/codes 短暂失配 → **77 文件模块加载失败**（`Permission catalog does not match the registered permission codes`）→ 废弃。**run2**（清净窗）被杀于 10 分钟 tool cap，期间 0 fail。**run3**（detached node 包装跑完，权威 1900/1870/26/4）——**26 fail 分类**：**13 撞车**全为 `permission.createMany`（`test/helpers/test-database.ts:23`，TRUNCATE 后 reseed 前外部进程插入权限行 → `Unique constraint failed on (id)`，即 runbook §8 撞车签名）——**7 个撞车文件清净窗隔离复跑 95 tests / 95 pass / 0 fail 全过**；**12 外部漂移**（trust-root ×2 系 SPEC-022 已知；baseline-contract ×7 系外部迁移 26→27；permission-catalog ×2 系外部权限 122→129；spec-003-router ×1）→ **0 真 fail 归 SPEC-034**。

## 6. 安全审计状态

- `security:test` **42/42**（本报告实测 exit 0，零新增例外）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0——**moderate gate + 基线断言端到端生效**（本次起 audit 实测若任一 severity 超基线即 fail）。
- `security:audit:prod` **server + web 双 passed=true**，production high=0/critical=0——production **moderate 现在也是硬门槛**（>0 → fail）。
- 基线文件 `scripts/security/expected-baseline.json`：server/web × production/development 各 severity 全 0，`loadSecurityConfiguration`/`evaluateWorkspace` 均校验（缺失/非法 JSON → fail-closed）。
- 契约下限（SPEC-028 锁死，未改动）：`dependency-contract.test.mjs` `assertUndiciVersionSafe` undici 6.x ≥ 6.28.0 / 7.x ≥ 7.29.0；react-router ≥8.3.0 / brace-expansion ≥5.0.7。
- `check:docs-leakage` exit 0（占位符口径：本 closeout 与 runbook §8 更新段均不落真实密钥/连接串口令）。

## 7. 已知非阻断项（照录）

1. **编号沿革**：SPEC-032 被 customer-business-analytics 占用（并行通道，已 closed）→ 暂改 SPEC-033 → 与案件办理撞号 → 用户裁决本专项 SPEC-034（案件办理保持 033）。
2. **I-1（已修）**：基线接线双路径解耦——已闭（cli.mjs 显式传 baseline）。
3. **M-1（已修）**：baselineExcess 超额尾部——已闭（slice(expected)）。
4. **M-2（文档归口）**：production low 被基线硬阻断（D2 全 severity 冻结 0 推论）——已 runbook/closeout 明示，零当前影响。
5. **M-3（部分）**：malformed 注入基线 fail-closed 测试已补；missing-file/invalid-JSON 路径由既有用例隐式覆盖。
6. **M-4（信息性）**：cli.test/dependency-contract.test diff 为既有漂移非 Task 1 内容——计划字面归属不精确，套件全绿。
7. **M-5（信息性）**：基线位置 `scripts/security/` 为正确选择（var/security/audit 是运行时输出目录）。
8. **共享工作树撞车（撞车期间禁跑）**：run1 撞车系外部渠道编辑 permission 文件中窗（catalog/codes 短暂失配），非 DB TRUNCATE 竞态——runbook §8 纪律沿用，撞车失败不计，**run2 静默窗重跑为权威**；外部渠道 permission 收敛后（129）catalog===codes 已一致。
9. **spec-008 rehearsal 环境性（照录非回归）**：rehearsal 测试硬性要求 `DATABASE_URL=localhost:55432` + `ALLOW_EVENT_OBSERVABILITY_REHEARSAL=true`，与 brief「55432 禁触」冲突——全量套件经 skip-pattern 照录排除（3 例）。
10. **承接既有已知项**：SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）保留观察；前端预存 vitest flake；trust-root-guard 外部漂移（spec-022，归外部渠道）；各 SPEC closeout §9 follow-up。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 **26** / 模型 **60** / 事件 **15** / 路由 **15** 全不变——Task 1 仅 scripts/security 工具链（mjs）+ baseline 文件，Task 2 仅 runbook + closeout，零 .ts 变更。权限 **129** 为外部渠道在制态（本 SPEC 零权限变更；前 closeout 124 → 129 差额归外部渠道）。
- **audit 门禁对账**：SPEC-030/031 已将 high/critical 清零并 dev 清零 → SPEC-034 将 **moderate 纳入 production gate** + **基线快照固化断言** → `security:audit:prod` moderate>0 现在会失败（此前 'report' 静默放行）；`security:audit:all`/`prod` 实测全绿（0 advisory）。
- **测试计数**：`security:test` SPEC-031 基线 **34** → SPEC-034 Task 1 **41** → 评审 M-3 增补 malformed-baseline 用例 **42**（+8，policy/audit-gate）；后端全量 run3 **1900 tests / 1870 pass / 26 fail / 4 skip**——13 撞车隔离复跑 **95/95 全过** + 12 外部漂移照录 → **0 真 fail 归 SPEC-034**（skip 4 = spec-008 排练 3 例 port-55432 锁定件 + 1 既有显式 skip）。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **例外审批流程**：policy EXCEPTION 机制已接线（advisories 字段，development scope），但**审批流程本身未实现**（当前需人工编辑 dependency-exceptions.json）——可专项做受控审批闭环。
- **其他 severity 门禁**：本次仅 moderate+ 收口（low/info 仍为 report/不做 gate）；基线已把 production low 硬阻断（D2 推论），若需按 severity 区分可再评估。
- **基线演进**：未来新增依赖须先加例外或更新 `expected-baseline.json`——可专项做基线变更评审/审计跟踪。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）——production audit 已 0 findings，v8 迁移保留观察。
- **trust-root-guard 业务失败归口**：spec-022 外部漂移 2 例跟踪归外部渠道（role-membership 在制方向）——外部渠道收敛后复核断言码失配。
- **测试环境指纹（承 runbook §8）**：共享 test DB 撞车禁跑纪律沿用——任何并发渠道全量跑前须清净窗前探；本专项另证**共享工作树代码编辑中窗**也会撞车（permission 文件短暂失配）——并行渠道编辑代码文件期间避免起跑依赖该模块的全量。

## 10. 双渠道验收链

- **Task 1（moderate gate + 基线快照）**：audit-gate/policy moderate 纳入 + 基线断言 + `expected-baseline.json` 固化 → `security:test` 42/42（含 moderate>0 基线 0 → fail / moderate=0 基线 0 → pass / 超基线需例外 / 基线字段完整性 / malformed 注入 fail-closed）→ `security:audit:all`/`prod` 双绿（moderate gate + 基线端到端生效）。评审照录（I-1 已修 + M×4，§5/§7）。
- **Task 2（全量闸门 + runbook/closeout，本报告）**：后端全量 run1 撞车废弃 + run2 被杀 + **run3 1900/1870/26/4**（13 撞车隔离复跑 **95/95 全过** + 12 外部漂移照录 → **0 真 fail 归 SPEC-034**）；`security:test` **42/42** + `security:audit:all`/`prod` 双绿 + check:baseline（26/60 当时有效）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（占位符口径）；runbook §8 安全审计现状补 moderate gate + 基线说明（`security:test` 34→42 基线）；本 closeout 收口。

## 11. 收官状态

**SPEC-034 安全审计门禁加固本地闭环（2026-08-05）**：2/2 任务完成（Task 1 moderate gate + 基线快照：audit-gate/policy moderate 纳入 production gate + `expected-baseline.json` 固化断言 + cli 基线接线；Task 2 全量闸门 + security/audit/baseline/docs 闸门 + runbook/closeout 收尾）。**零结构变更 + 零业务代码**（迁移 **26**/模型 **60**/事件 **15**/路由 **15** 全不变，权限 **129** 为外部渠道在制态；零 .ts 变更）；`security:test` **42/42**（+8 自 SPEC-031 基线 34）+ `security:audit:all`/`prod` 双绿（moderate gate + 基线断言生效）+ check:baseline PASS（26/60）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）。后端全量 **1900 tests / 1870 pass / 26 fail / 4 skip**（13 撞车隔离复跑 **95/95 全过**、12 外部漂移照录 → **0 真 fail 归 SPEC-034**；skip 4 = spec-008 排练 3 例 + 1 既有）。runbook §8 安全审计现状 moderate gate + 基线说明已落地；评审 I-1/M-1/M-3 已闭、M-2/M-4/M-5 照录；已知非阻断项 §7 照录（编号重定、撞车纪律、spec-008 环境性、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
