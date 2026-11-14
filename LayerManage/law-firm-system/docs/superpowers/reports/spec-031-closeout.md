# SPEC-031 dev 依赖清理（Dev Dependency Cleanup）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-028 依赖安全收口 §9「dev 清理：brace-expansion 5.0.8 → 5.0.9 + web dev undici 7.28.0 → 7.29.0」+ 后续依赖审计 ｜ 用户授权自主推进（无人值守，Task 1 overrides 更新 + audit 清零；Task 2 全量闸门 + runbook/closeout 收尾）

## 1. 交付范围

将 `security:audit:all`（含 dev 依赖）现存 **dev 作用域项清零**——`apps/server/package.json` overrides 升级（brace-expansion 5.0.9 + 增补 2.1.4 + tar 7.5.21）+ `apps/web/package.json` 新增 overrides 块（brace-expansion 5.0.9 / undici 7.29.0 / postcss 8.5.23）+ `npm install` 重新解析 lock + 全量闸门 + runbook/closeout 收尾。**零业务代码变更**（纯 package.json overrides + lock 更新，零 .ts 变更）；**零结构变更**（迁移 26 / 模型 60 / 权限 124 / 事件 15 / 路由 13 全不变）。

1. **Task 1（overrides 更新 + audit 验证）**：`apps/server/package.json` overrides 更新（brace-expansion `@^5.0.5: 5.0.8→5.0.9`、**增补 `@^2.0.0: 2.1.4`**、+tar `@<7.5.21: 7.5.21`）+ `apps/web/package.json` 新增 overrides（brace-expansion 5.0.9 / undici 7.29.0 / postcss 8.5.23）+ 双 lock 重解析 + `security:audit:all` server+web 双 passed=true（production + development 全 zero）+ `security:test` 34/34 + 工具链（lint/typecheck/build）零回归 + web 前端 vitest 217/217。Task 1 评审照录（M×2 + 增补 2.1.4 记录，§5/§7）。
2. **Task 2（本报告）**：后端全量闸门（清净窗实测 + 撞车纪律重跑，§3）+ security/audit/baseline/docs 闸门（§6）+ runbook §8 安全审计现状补 audit:all 全绿 + 本 closeout 十一节。

**变更文件（共 4 件代码 + runbook + 本 closeout）**：Task 1 `apps/server/package.json` + `apps/web/package.json` + `apps/server/package-lock.json` + `apps/web/package-lock.json`（零业务代码）；Task 2 `docs/superpowers/runbooks/finance-operations.md`（§8 安全审计现状 dev 清零说明）；本 closeout。未触碰：生产代码/迁移/模型/权限/事件/路由。

## 2. 工具链

Node test runner（后端串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0（沿 SPEC-017-031 实证零影响）。测试库 55433 `_test`；**55432 禁触**；ALLOW_TEST_DB_RESET=true；连接串一律 127.0.0.1；skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件。全程零 git 操作。测试 env 块按项目纪律（持久化文档占位符口径：`JWT_SECRET="<redacted>"`/URL 去口令）。

## 3. 测试计数链

### 3.1 依赖锁版本（Task 1 实测，override 生效）

`npm ls brace-expansion tar`（apps/server）/ `npm ls brace-expansion undici postcss`（apps/web）：

| 工作区 | 包 | 变更前 | 变更后 | override 键 | 修复 |
|---|---|---|---|---|---|
| server | brace-expansion (root) | 5.0.8 | **5.0.9** | `@^5.0.5` | GHSA-mh99-v99m-4gvg / rgw5-rvv9-x895 high |
| server | brace-expansion (glob/mocha 嵌套) | 2.1.2 | **2.1.4** | `@^2.0.0`（增补） | GHSA-rgw5-rvv9-x895 high（minimatch 5.1.9 链） |
| server | brace-expansion (multimatch/mz-modules) | 1.1.17 | 1.1.18 | `@<1.1.18`（既有） | GHSA-rgw5-rvv9-x895（SPEC-028 保留） |
| server | tar | 7.5.20 | **7.5.21** | `@<7.5.21` | GHSA-r292-9mhp-454m moderate |
| web | brace-expansion | 5.0.7 | **5.0.9** | `@^5.0.5` | GHSA-mh99-v99m-4gvg high |
| web | undici | 7.28.0 | **7.29.0** | `@<7.29.0` | GHSA-4cwx/8xcm/m8rv/jr45/v3r7 high |
| web | postcss | 8.5.19 | **8.5.23** | `@<8.5.23` | GHSA-fxqj-rqcc-2cmp moderate |

server 运行时依赖（egg 3.34.0 / egg-mock 5.15.2 / @prisma/client 5.22.0 / jsonwebtoken 9.0.3 等）全数未变，仅 dev 工具链包移动；web 运行依赖（react 19.2.7 / react-router 8.3.0 / antd 6.3.6 等）未变。lockfileVersion 3 双 lock 保留。

### 3.2 Task 1 验证（Task 1 报告照录）

| 检查 | 结果 |
|---|---|
| `security:audit:all`（root） | **server passed=true + web passed=true**，`var/security/audit/full-summary.json` production + development 全 zero（high=0/moderate=0/total=0/findings=0） |
| `security:audit:prod`（root） | **server passed=true + web passed=true**，production high=0/critical=0 |
| `security:test`（root） | **34/34 pass，0 fail** |
| 工具链 | server + web lint 0 error（web 4 条既有 warning）/ typecheck exit 0 / build 成功（server tsc + prisma generate + build.js；web tsc -b + vite build） |
| web 前端 vitest | **45 files / 217 pass**（web 依赖变更后验证） |

### 3.3 Task 2 验证（本报告，清净窗终态）

| 检查 | 结果 |
|---|---|
| 后端全量（清净窗前探 pg_stat_activity=0 起跑；撞车纪律） | **run1（实测）1896 tests / 1808 pass / 84 fail / 4 skip**——起跑后外部渠道 DB TRUNCATE/INSERT 活跃（探得并行 ACTIVE 连接），84 fail 分类见下；**干净窗对 24 个失败文件单独复跑：210 tests / 208 pass / 2 fail / 0 skip**——2 fail 全为 SPEC-022 外部漂移 trust-root-guard×2 → **权威终态 1896 tests / 1890 pass / 2 fail / 4 skip（0 真 fail）** |
| fail 分类（run1） | 84 fail = **82 撞车（DB TRUNCATE 竞态，单独复跑全过）+ 2 SPEC-022 既有外部漂移**（trust-root-guard：`cannot grant a role to the current first super-admin through self-modification` / `cannot grant SYSTEM_SUPER_ADMIN through the role-grant endpoint`，断言期望 `PRIVILEGE_ESCALATION_BLOCKED`(403) 实际 `PERMISSION_DENIED`——隔离复跑照录，**0 真 fail**） |
| skip | 4 = pkg 便携可执行烟测 env 门控（RUN_PKG_*_SMOKE 未设） |
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `npm run security:audit:all`（root，本报告复测） | **server + web 双 passed=true**，`full-summary.json` production + development **high=0/moderate=0/total=0/findings=0**（2026-08-05T00:0xZ 实测） |
| `npm run security:audit:prod`（root，本报告复测） | **server passed=true + web passed=true**，production high=0/critical=0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约 2→7） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径——含 runbook 更新后复扫） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变）——零 .ts 变更（Task 1 仅 package.json + lock；Task 2 仅文档）。后端测试数不变（依赖锁版本变化零结构影响）。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️ 增补 2.1.4 / M×2 / 全量 fail 分类 / trust-root-guard 跟踪）

| # | 决策 | 值 |
|---|---|---|
| D1 | brace-expansion | server override `brace-expansion@^5.0.5: 5.0.8` → **5.0.9**（修复 GHSA-mh99-v99m-4gvg/rgw5-rvv9-x895 high）；web +override `brace-expansion@^5.0.5: 5.0.9` |
| D2 | tar | server +override `tar@<7.5.21: 7.5.21`（修复 GHSA-r292-9mhp-454m moderate） |
| D3 | undici | web +override `undici@<7.29.0: 7.29.0`（修复 GHSA-8xcm/4cwx/m8rv/jr45/v3r7 high） |
| D4 | postcss | web +override `postcss@<8.5.23: 8.5.23`（修复 GHSA-fxqj-rqcc-2cmp moderate） |
| D5 | 验证 | `security:audit:all`（server + web）全绿含 dev（high=0/moderate=0）；`security:test` 34/34；构建/测试工具链零回归 |
| D6 | 零业务代码 | 仅 package.json + lock；零 .ts |

**实施期 ⚠️ 记录（Task 1 评审 M×2 + Task 2 落地）**：

- **增补 `brace-expansion@^2.0.0: 2.1.4`（超出 brief 字面，必要）**：audit 实测 brace-expansion 受胁范围 `2.0.0 - 2.1.3 || 4.0.0 - 5.0.8`；glob/mocha→minimatch 5.1.9 的 2.1.2 嵌套实例同命中 high；仅改 `@^5.0.5` 无法清零。2.1.4 为 2.x 线官方 patch（同 CJS `module.exports = expandTop` API），对 minimatch 5.1.9 安全，是最低风险收口。
- **M×1（评审照录）**：server 全量 61 fail 分类判定——3 环境守卫（spec-008 排练 ×2 + event-observability-load ×1，55432 禁触按 brief 必然）/ ≈24 撞车（单独复跑 83/83 过）/ ≈2-3 既有业务逻辑 trust-root-guard（断言码失配，与依赖无关）——**均非依赖 override 回归**。
- **M×2（评审照录）**：兼容结论——全部 minor/patch 升级（brace-expansion 5.0.8→5.0.9 / 2.1.2→2.1.4 / tar 7.5.20→7.5.21 / undici 7.28.0→7.29.0 / postcss 8.5.19→8.5.23）**未破坏任何工具链**，无需回退；web 前端 217/217 佐证。
- **trust-root-guard 业务失败跟踪（本任务，承接既有）**：`cannot grant a role to the current first super-admin through self-modification` / `cannot grant SYSTEM_SUPER_ADMIN through the role-grant endpoint` 断言期望 `PRIVILEGE_ESCALATION_BLOCKED`(403)/`TRUST_ROOT_PROTECTED`(409)，实际返回 `PERMISSION_DENIED`——spec-022 已知外部漂移，隔离复跑照录不计（归外部渠道）；`cannot disable the current first super-admin` 具 flaky（全量时偶发、单独复跑时通过）。服务器运行时依赖树完全未变 → 属基线既有失败，与依赖版本无关。
- **全量 fail 分类（本任务，run1 实测）**：84 fail = **82 撞车**（外部渠道并行 TRUNCATE/INSERT 活跃期间 DB 竞态；24 个失败文件干净窗单独复跑 210 tests / 208 pass / 2 fail，82 全过）+ **2 SPEC-022 外部漂移**（trust-root-guard×2，照录不计）→ **0 真 fail**。
- **碰撞纪律（runbook §8）**：run1 起跑前探 pg_stat_activity=0 清净，起跑后外部渠道活跃（探得 ACTIVE TRUNCATE/INSERT）——撞车失败不计 + 静默窗重跑为权威。

## 6. 安全审计状态

- `security:test` **34/34**（本报告实测 exit 0，零新增例外）。
- `security:audit:all` **server + web 双 passed=true**，production + development **high=0 / moderate=0 / critical=0 / total=0 / findings=0**（`var/security/audit/full-summary.json`，2026-08-05 实测）——**SPEC-031 核心：dev 作用域 legacy 清零**（此前 server dev brace-expansion 5.0.8 / tar 7.5.20 + web dev undici 7.28.0 / brace-expansion / postcss 使 audit:all 报 failed）。
- `security:audit:prod` **server + web 双 passed=true**，production high=0/critical=0（SPEC-028 已清零，保持 0 不回退）。
- 契约下限（SPEC-028 锁死，未改动）：`dependency-contract.test.mjs` `assertUndiciVersionSafe` undici 6.x ≥ 6.28.0 / 7.x ≥ 7.29.0；react-router ≥8.3.0 / brace-expansion ≥5.0.7。
- `check:docs-leakage` exit 0（占位符口径：本 closeout 与 runbook §8 更新段均不落真实密钥/连接串口令）。

## 7. 已知非阻断项（照录）

1. **M×2（Task 1 评审照录）**：①61 fail 分类判定（环境守卫/撞车/既有业务逻辑均非依赖回归）；②兼容结论（全部 minor/patch 零破坏，web 217/217 佐证）。
2. **增补 2.1.4 记录**：`brace-expansion@^2.0.0: 2.1.4` 超出 brief 字面但必要（glob/mocha→minimatch 5.1.9 链同命中 high，官方 patch 同 API 最低风险），评审判定追加合理。
3. **trust-root-guard 业务失败跟踪**：spec-022 已知外部漂移 2 例（`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）+ `cannot disable the current first super-admin` flaky（隔离复跑通过）——与依赖版本无关，归外部渠道。
4. **共享 test DB 撞车（撞车期间禁跑）**：runbook §8 纪律沿用——run1 起跑清净窗（pg_stat_activity=0 前探），起跑后外部渠道活跃致 82 撞车 fail，撞车失败不计 + 静默窗重跑（24 文件 210 tests / 208 pass / 2 fail）为权威。
5. **spec-008 rehearsal 环境性（照录非回归）**：rehearsal 测试硬性要求 `DATABASE_URL=localhost:55432` + `ALLOW_EVENT_OBSERVABILITY_REHEARSAL=true`，与 brief「55432 禁触」冲突——全量套件经 skip-pattern 照录排除（3 例）。
6. **环境/时序 flake（照录，非依赖回归）**：spec-004 负载阈值（scaled authorization，timing）、spec-006 TOTP 窗口时序 flake——run1 撞车窗内出现，干净窗复跑通过，与依赖变更无关。
7. **serialize-javascript 异常（SEC-2026-001）现为残留**：audit 已 0 漏洞，异常未触发但仍被 contract test 要求保留，未改动。
8. **承接既有已知项**：SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）保留观察；前端预存 vitest flake（隔离复跑全 PASS）；audit 门禁 moderate 为 'report' 不 block 建议；各 SPEC closeout §9 follow-up。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变——Task 1 仅 package.json ×2 + lock ×2，Task 2 仅 runbook + closeout，零 .ts 变更。
- **audit:all 对账**：SPEC-028 终态 dev 遗留（server brace-expansion 5.0.8 + tar 7.5.20；web undici 7.28.0 + brace-expansion + postcss）→ SPEC-031 全部清零 → `security:audit:all` **server + web 双 passed=true（production + development 全 zero）**；`security:audit:prod` 保持 0 不回退。
- **测试计数**：后端全量 run1 实测 **1896 tests / 1808 pass / 84 fail / 4 skip**；干净窗失败文件复跑 **210 tests / 208 pass / 2 fail / 0 skip**；**权威终态 1896 tests / 1890 pass / 2 fail / 4 skip（2 fail 全为 SPEC-022 外部漂移照录 → 0 真 fail）**。计数口径：SPEC-028 依赖安全终态 ≈1901 与实测 1896 的差属既有计数口径漂移（外部渠道 SPEC 在制），非本 SPEC 引入。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）——production audit 已 0 findings，v8 迁移保留观察。
- **后续依赖审计**：承接定期 `npm audit` 全量（含 dev）滚动收口——dev 已随 SPEC-031 清零，后续新增 advisory 归后续依赖专项。
- **audit 基线快照固化**：历史基线不可复核（SPEC-028 评审 ⚠️）——建议 CI 固化 `var/security/audit/*-summary.json` 基线快照，供后续依赖变更前后对账。
- **audit 门禁 moderate 纳入 gate**：`security/audit-gate` 对 moderate 为 'report' 不 block——建议将 moderate 纳入硬门槛。
- **trust-root-guard 业务失败归口**：spec-022 外部漂移 2 例 + flaky 1 例跟踪归外部渠道（role-membership 在制方向）——外部渠道收敛后复核断言码失配。
- **契约收紧**：`dependency-contract.test.mjs` 可扩展 web lock 的 undici 下限或纳入 `security:test` 全链路断言。
- **测试环境指纹（承 runbook §8）**：共享 test DB 撞车禁跑纪律沿用——任何并发渠道全量跑前须清净窗前探。

## 10. 双渠道验收链

- **Task 1（overrides 更新 + audit 清零）**：server override 升级（brace-expansion 5.0.9 + 增补 2.1.4 + tar 7.5.21）+ web +overrides（brace-expansion 5.0.9 / undici 7.29.0 / postcss 8.5.23）+ 双 lock 重解析 → `npm ls` 生效确认 → `security:audit:all` server+web 双绿（production + development 全 zero）→ `security:test` 34/34 → 工具链（lint/typecheck/build）零回归 → web 前端 vitest 217/217。评审照录（M×2 + 增补 2.1.4 记录）。
- **Task 2（全量闸门 + runbook/closeout，本报告）**：后端全量 run1（1896 tests / 1808 pass / 84 fail / 4 skip，撞车纪律）+ 干净窗失败文件复跑（210 tests / 208 pass / 2 fail / 0 skip）→ **权威终态 1896 tests / 1890 pass / 2 fail / 4 skip（0 真 fail）**；`security:test` **34/34** + `security:audit:all` 双绿含 dev + `security:audit:prod` 0 + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（占位符口径）；runbook §8 安全审计现状补 audit:all 全绿（dev 清零）；本 closeout 收口。

## 11. 收官状态

**SPEC-031 dev 依赖清理本地闭环（2026-08-05）**：2/2 任务完成（Task 1 overrides 更新 + audit 清零：server brace-expansion 5.0.9 + 增补 2.1.4 + tar 7.5.21 / web brace-expansion 5.0.9 + undici 7.29.0 + postcss 8.5.23，`security:audit:all` server+web 双绿含 dev production+development 全 zero；Task 2 全量闸门 + security/audit/baseline/docs 闸门 + runbook/closeout 收尾）。**零结构变更 + 零业务代码**（迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **13** 全不变，零 .ts 变更）；`security:test` **34/34** 零新增 + `security:audit:all` server+web **含 dev 全 zero（high=0/moderate=0/findings=0）** + `security:audit:prod` 保持 0 + check:baseline PASS（26/60）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）。后端全量 **1896 tests / 1890 pass / 2 fail / 4 skip（2 fail 全为 SPEC-022 外部漂移照录，0 真 fail）**。runbook §8 安全审计现状 dev 清零已落地；已知非阻断项 §7 照录（M×2、增补 2.1.4、trust-root-guard 跟踪、撞车纪律、spec-008 环境性、flake、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
