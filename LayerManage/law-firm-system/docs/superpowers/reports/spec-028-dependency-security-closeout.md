# SPEC-028 依赖安全收口（Dependency Security Closeout）— 收尾报告

日期：2026-08-04 ｜ 需求来源：spec-progress-and-next 远期候选「brace-expansion moderate 链（egg-session/koa-session/uuid）」+ SEC-2026-002 到期（2026-08-29）前收口 + audit 实测现存 production 项 ｜ 无人值守 subagent-driven（Task 1 overrides 更新 + audit 验证；Task 2 M2 契约下限 + 全量闸门 + runbook/closeout 收尾）

> ⚠️ **SPEC 编号碰撞说明**：本项目并行渠道 `org-wide-view-enhancement` 亦自称 SPEC-028 且先完成其 closeout（`docs/superpowers/reports/spec-028-closeout.md`，runbook §9.15 已引用）。本收尾报告为避免覆盖该既有交付物，按**去歧义文件名 `spec-028-dependency-security-closeout.md`** 落盘；编号/文件名归属待协调者裁决（建议本渠道后续按 SPEC-029 或协调者指定编号重命名）。

## 1. 交付范围

将 `security:audit:prod` 现存 **production 项清零**——`apps/server/package.json` overrides 升级（brace-expansion 1.1.18 / uuid 11.1.1 / undici 6.28.0+7.29.0）+ `npm install` 重新解析锁文件 + 契约测试锁死修复版本下限 + 后端全量闸门 + runbook/closeout 收尾。**零业务代码变更**（纯 package.json overrides + lock 更新，零 .ts 变更）；**零结构变更**（迁移 26 / 模型 60 / 权限 124 / 事件 15 / 路由 13 全不变）。

1. **Task 1（overrides 更新 + audit 验证）**：`apps/server/package.json` overrides 更新（brace-expansion `<1.1.18→1.1.18`、uuid `<11.1.1→11.1.1`；**设计基线过期追加**：undici `urllib@3.27.3→6.28.0`、`urllib-next→6.28.0`、`urllib4→7.29.0`）+ `npm install` 重解析 lock + `security:audit:prod` server+web 双 passed=true（production high=0/moderate=0/findings=0）+ uuid 8→11 兼容回归（mochawesome/koa-session 双路径）+ `security:test` 34/34 + 工具链（mocha/egg-bin/c8/typecheck）正常。**Task 1 评审 Approved（0C/0I/3M）**——M×3 照录（§5）。
2. **Task 2（本报告）**：M2 契约下限修正（`dependency-contract.test.mjs` undici 6.27.0/7.28.0 → **6.28.0/7.29.0** 锁死修复版本，防未来回退静默放行）+ 后端全量闸门（清净窗串行，实测）+ security/audit/baseline/docs 闸门 + runbook §8 安全审计现状补 moderate 清零 + undici 契约下限说明 + 本 closeout 十一节。

**变更文件（共 3 件代码/文档 + 本 closeout）**：Task 1 `apps/server/package.json` + `apps/server/package-lock.json`（零业务代码）；Task 2 `scripts/security/dependency-contract.test.mjs`（M2 契约下限，位于项目根 `scripts/security/`——brief 所列 `apps/server/scripts/security/` 路径实为 `scripts/security/`，`security:test` 即引用此文件）；`docs/superpowers/runbooks/finance-operations.md`（§8 安全审计现状更新）；本 closeout。未触碰：生产代码/迁移/模型/权限/事件/路由。

## 2. 工具链

Node test runner（后端串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0（沿 SPEC-017-028 实证零影响）。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；连接串一律 127.0.0.1。全程零 git 操作。测试 env 块按项目纪律（持久化文档占位符口径：`JWT_SECRET="<redacted>"`/URL 去口令）。

## 3. 测试计数链

### 3.1 依赖锁版本（Task 1 实测，override 生效）

`npm ls brace-expansion uuid undici`（apps/server）：
- `brace-expansion@1.1.18 overridden`（multimatch/mz-modules 链 GHSA-rgw5-rvv9-x895）；`2.1.2`（mocha minimatch@5，不受 `<1.1.18` 约束保留）；`5.0.8 overridden`（eslint minimatch@10，dev）。
- `uuid@11.1.1 overridden`（mochawesome）+ `11.1.1 deduped`（koa-session）——uuid 8→11 CJS API 全兼容（`require('uuid').v4`、解构 `{v4}`、`v4({}, buf)` buffer 填充、裸回调 `genid = uuid.v4` 均实测可用），mochawesome/koa-session 双真实调用路径通过，**不回退**。
- `undici@6.28.0 overridden`（urllib@3.27.3 / urllib-next）+ `undici@7.29.0`（urllib4@npm:urllib@4.9.0，pkg-fetch `^7.28.0` 自然解析 hoist/dedup）。

### 3.2 Task 1 验证（Task 1 报告，audit 双绿）

| 检查 | 结果 |
|---|---|
| `npm run security:audit:prod`（root） | **server passed=true + web passed=true**，production high=0/moderate=0/critical=0/total=0/findings=0 |
| `npm run security:test`（root） | **34/34 pass，0 fail** |
| 工具链 | mocha 10.8.2 / egg-bin 5.19.0 / c8 7.14.0 正常；`npm run typecheck` exit 0；`security:policy:validate` OK；mochawesome-with-mocha 报告器以 uuid 11 生成 JSON/HTML 成功 |
| 设计基线对账 | 设计基线「2 moderate」过期——实测 **7 findings（2 high + 5 moderate）**（brace-expansion 实为 high + undici 新增 advisory + uuid）；同一 overrides 块追加 undici 6.28/7.29 达成 moderate=0（单文件零业务代码，评审判定追加必要合理） |

### 3.3 Task 2 验证（本报告，清净窗终态）

| 检查 | 结果 |
|---|---|
| M2 契约下限 | `scripts/security/dependency-contract.test.mjs` `assertUndiciVersionSafe` 6.27.0/7.28.0 → **6.28.0/7.29.0**；契约测试独立运行 **6/6 pass**（含 `security:test` 34/34 内复验） |
| 后端全量（清净窗，run3 + run4 分段） | **run3：1681 pass / 2 fail / 4 skip**（清净窗串行，运行至 `test/finance/refund-service.test.ts` 时被后台 60 分钟上限终止，非失败）；**run4：220 pass / 0 fail / 0 skip**（剩余文件 refund-service 余量/refund-step-up/master-data/security/system/test-runner-contract，**completed exit 0**）。**合计 ≈1901 pass / 2 fail / 4 skip** |
| fail 分类 | **2 fail 全为 SPEC-022 已知外部漂移**（trust-root-guard×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，`assertPrivilegeEscalationBlocked` 断言码失配——隔离/复跑口径照录，**0 真 fail**）；skip 4 = pkg 便携可执行烟测 env 门控（RUN_PKG_*_SMOKE 未设） |
| `npm run typecheck`（Task 2 复验） | **exit 0** |

### 3.4 其他闸门（本报告实测）

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `npm run security:audit:prod`（root） | **server + web 双 passed=true**，production moderate=0/high=0/total=0/findings=0（`var/security/audit/production-summary.json`，2026-08-04T11:31Z） |
| `npm run security:audit:all`（root，佐证 dev 遗留） | server+web production 均 0；dev 遗留照录（§6/§7，pre-existing） |
| `npm run security:policy:validate` | **exit 0** |
| `check:baseline`（26 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约 2→7） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径——含 runbook §8 更新后复扫） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变）——零 .ts 变更（Task 1 仅 package.json + lock；Task 2 仅 .mjs 契约 + 文档）。后端测试数不变（依赖锁版本变化零结构影响）。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ M×3）

| # | 决策 | 值 |
|---|---|---|
| D1 | brace-expansion | override `brace-expansion@<1.1.18: 1.1.18`（替换 `@<1.1.17: 1.1.17`）——覆盖 multimatch/mz-modules 链 GHSA-rgw5-rvv9-x895 |
| D2 | uuid | override `uuid@<11.1.1: 11.1.1`——覆盖 mochawesome-with-mocha/koa-session 链 GHSA-w5hq-g745-h8pq（仅 dev 依赖，生产 audit 排除 dev） |
| D3 | 验证 | `security:audit:prod` moderate=0；`security:test` 34/34 零回归；npm ls override 生效；构建/测试零回归 |
| D4 | 零业务代码 | 仅 package.json + lock 更新；无 .ts 变更 |
| D5 | 兼容 | uuid 8→11——mochawesome/koa-session 双路径实测兼容（CJS v4/解构/buffer/裸回调），**不回退** |

**实施期 ⚠️ 记录（Task 1 评审 M×3 + Task 2 落地）**：
- **M×1（评审照录）**：报告 advisory 归因——brace-expansion 5.0.8 dev 应为 **GHSA-mh99-v99m-4gvg**（审计实测同时报 rgw5-rvv9-x895；实质结论不受影响——dev 作用域遗留，生产已清零）。
- **M×2（评审，Task 2 已修复）**：`dependency-contract.test.mjs` undici 契约下限 **6.27.0/7.28.0 低于实际修复版本 6.28.0/7.29.0**——Task 2 升至 **6.28.0/7.29.0** 锁死，契约测试 6/6 复验通过（防未来回退静默放行）。
- **M×3（评审照录）**：无 mochawesome 报告产物留盘（Task 1 以 uuid 11 实测生成 JSON/HTML 报告成功 + CJS 双路径已足证兼容，留盘产物非必需）。
- **⚠️ 关注（评审）**：audit 门禁对 moderate 为 'report' 不 block（建议后续纳入 gate 硬门槛——§7/§9）；spec-008 rehearsal 需 55432 与 brief 禁触冲突（环境性非回归）；历史 audit 基线不可复核（建议固化 audit 基线快照——§9）。

## 6. 安全审计状态

- `security:test` **34/34**（本报告实测 exit 0，零新增例外）。
- `security:audit:prod` **server + web 双 passed=true**，production **high=0 / moderate=0 / critical=0 / total=0 / findings=0**（`var/security/audit/production-summary.json`，2026-08-04T11:31Z 生成）。
- **契约下限**：`dependency-contract.test.mjs` `assertUndiciVersionSafe` 钉死 undici 6.x ≥ **6.28.0** / 7.x ≥ **7.29.0**；react-router ≥8.3.0 / brace-expansion 5.0.7（web dev 工具链）契约不变。
- **dev 作用域遗留（pre-existing，生产审计排除 dev 不受影响）**：`security:audit:all` server dev = brace-expansion（GHSA-mh99-v99m-4gvg / rgw5-rvv9-x895，high，`brace-expansion@5.0.8` 既有 override `@^5.0.5` 固定，5.0.9 已发布）+ tar 7.5.20（GHSA-r292-9mhp-454m，moderate，node-tar 递归 DoS）；web dev = brace-expansion×2 high + postcss moderate + undici 7.28.0（GHSA-4cwx-7wf7-3272 high + 4 moderate，<7.29.0）——均非 SPEC-028 引入（web 锁文件未触碰）。
- `check:docs-leakage` exit 0（占位符口径：本 closeout 与 runbook §8 更新段均不落真实密钥/连接串口令）。

## 7. 已知非阻断项（照录）

1. **M×3（Task 1 评审照录）**：①advisory 归因（5.0.8 dev 为 GHSA-mh99-v99m-4gvg，实质结论不受影响）；②undici 契约下限（Task 2 已升至 6.28.0/7.29.0 锁死，闭环）；③mochawesome 报告产物未留盘（uuid 双路径实测已足证）。
2. **dev 作用域遗留（pre-existing，非本 SPEC 引入）**：server dev `brace-expansion@5.0.8`（GHSA-mh99-v99m-4gvg/rgw5-rvv9-x895 high，`@^5.0.5: 5.0.8` 既有 override 固定，5.0.9 已发布）+ `tar@7.5.20`（GHSA-r292-9mhp-454m moderate）；web dev `undici@7.28.0`（<7.29.0）+ brace-expansion/postcss——`security:audit:all` 因 dev high 无 exception 报 failed（预期），**生产审计（audit:prod）不受影响**。
3. **spec-008 rehearsal 环境性（照录非回归）**：rehearsal 测试硬性要求 `DATABASE_URL=localhost:55432` + `ALLOW_EVENT_OBSERVABILITY_REHEARSAL=true` + `EVENT_WORKER_ENABLED=false`，与 brief「55432 禁触」冲突——全量套件在标准 env（55433）下经 `--test-skip-pattern` 照录排除（3 例），非回归。
4. **环境/时序 flake（照录，非依赖回归）**：spec-004 负载阈值（scaled authorization，timing）、spec-006 TOTP 窗口时序 flake——Task 1 已隔离复跑判定与依赖变更无关（§3.2）。
5. **audit 门禁 moderate 建议**：`security/audit-gate` 对 moderate 为 'report' 不 block——建议后续将 moderate 纳入 gate 硬门槛（§9 Follow-up）。
6. **共享 test DB 撞车（撞车期间禁跑）**：runbook §8 纪律沿用——清净窗前探 pg_stat_activity=0，遇外来进程禁跑静候清净窗，撞车失败不计 + 静默窗重跑。本任务全量清净窗起跑，全程未探得外来进程。
7. **SPEC-028 编号碰撞（本报告独立发现）**：并行渠道 `org-wide-view-enhancement` 亦自称 SPEC-028（其 `spec-028-closeout.md` 已落盘、runbook §9.15 已引用）——本收尾以去歧义文件名落盘，编号归属待协调者裁决（§首注）。
8. **承接既有已知项**：SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）保留观察；前端预存 vitest flake（隔离复跑全 PASS）；各 SPEC closeout §9 follow-up（加签/转交/全组织视图增强等）。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** / 路由 **13** 全不变——Task 1 仅 package.json + lock，Task 2 仅 .mjs 契约 + 文档，零 .ts 变更。
- **audit:prod 对账**：设计基线「2 moderate」→ 实测 **7 findings（2 high + 5 moderate）→ 0**（server + web production findings=0）。
- **契约测试**：`dependency-contract.test.mjs` 独立 6/6 + `security:test` 34/34 内含复验。
- **全量对账**：清净窗分段全量——**run3 1681 pass / 2 fail / 4 skip**（运行至 `test/finance/refund-service.test.ts` 被后台 60 分钟上限终止）+ **run4 220 pass / 0 fail / 0 skip**（剩余文件 completed exit 0）= **≈1901 pass / 2 fail / 4 skip**。2 fail 全为 **SPEC-022 已知外部漂移**（trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）→ **0 真 fail 为权威**（本 SPEC 零业务代码，依赖锁版本变化零回归）。计数口径：基线 1880（SPEC-028 org-wide 终态）+ 外部 SPEC-029 新增（export/import 等，外部渠道在制）= 实测 ≈1900+；run1/run2 因外部渠道共享 test DB TRUNCATE 撞车中止（run1 240/315、run2 ~160/16，撞车失败按 runbook §8 不计）。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令），扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **dev 清理：brace-expansion 5.0.8 → 5.0.9**（既有 override `@^5.0.5: 5.0.8` 升 5.0.9，dev 工具链零生产影响）+ web dev undici 7.28.0 → 7.29.0（同一 GHSA 链）。
- **audit 基线快照固化**：历史基线不可复核（评审 ⚠️）——建议 CI 固化 `var/security/audit/*-summary.json` 基线快照，供后续依赖变更前后对账。
- **契约收紧**：`dependency-contract.test.mjs` 目前仅 server lock 断言 undici 6.28/7.29——可扩展 web lock 的 undici 下限或纳入 `security:test` 全链路断言。
- **audit 门禁 moderate 纳入 gate**：`audit-gate` 对 moderate 为 'report' 不 block——建议将 moderate 纳入硬门槛（与生产审计到期纪律对齐）。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）——production audit 已 0 findings，v8 迁移保留观察。
- **后续依赖审计**：承接定期 `npm audit` 全量（含 dev）滚动收口——tar/node-tar 递归 DoS（GHSA-r292-9mhp-454m）等 dev moderate 归后续依赖专项。
- **SPEC-028 编号收敛**：并行渠道编号碰撞（本 closeout 去歧义文件名）——协调者裁决归属后重命名/收敛（§首注/§7.7）。
- **测试环境指纹（承 runbook §8）**：共享 test DB 撞车禁跑纪律沿用——任何并发渠道全量跑前须清净窗前探。

## 10. 双渠道验收链

- **Task 1（overrides 更新 + audit 验证）**：`npm install` 应用 override → `npm ls brace-expansion uuid undici` 生效确认 → `security:audit:prod` server+web 双绿（production 0 findings）→ `security:test` 34/34 → 工具链（mocha/egg-bin/c8/typecheck）正常 → uuid 8→11 兼容双路径实测。评审 Approved（**0C/0I/3M**——M×1 advisory 归因、M×2 契约下限（Task 2 已修）、M×3 mochawesome 产物留盘；⚠️ audit 门禁 moderate 建议 / spec-008 冲突 / 基线快照固化）。
- **Task 2（M2 契约下限 + 全量闸门 + 文档，本报告）**：M2 契约下限升至 6.28.0/7.29.0（独立 6/6 + 34/34 内含）；后端全量（清净窗分段）**run3 1681 pass / 2 fail / 4 skip + run4 220 pass / 0 fail / 0 skip = ≈1901 pass / 2 fail / 4 skip（2 fail 全为 SPEC-022 外部漂移照录，0 真 fail）**；`security:test` **34/34** + `security:audit:prod` 双绿 + `security:policy:validate` 0 + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0（含 runbook 更新后复扫）；runbook §8 安全审计现状补 moderate 清零 + undici 契约下限说明；本 closeout 收口。

## 11. 收官状态

**SPEC-028 依赖安全收口本地闭环（2026-08-04）**：2/2 任务完成（Task 1 overrides 更新 + audit 验证：brace-expansion 1.1.18 / uuid 11.1.1 / undici 6.28.0+7.29.0，`security:audit:prod` server+web 双绿 production 0 findings，uuid 8→11 兼容不回退；Task 2 M2 契约下限锁死 + 后端全量闸门 + security/audit/baseline/docs 闸门 + runbook/closeout 收尾）。**零结构变更 + 零业务代码**（迁移 **26**/模型 **60**/权限 **124**/事件 **15**/路由 **13** 全不变，零 .ts 变更）；`security:test` **34/34** 零新增 + `security:audit:prod` server+web **production high=0/moderate=0/findings=0** + `security:policy:validate` 0 + check:baseline PASS（26/60）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）。后端全量 **≈1901 pass / 2 fail / 4 skip**（2 fail 全为 SPEC-022 外部漂移照录，**0 真 fail**）。runbook §8 安全审计现状 + 契约下限已落地；已知非阻断项 §7 照录（M×3、dev 遗留、spec-008 环境性、audit 门禁 moderate 建议、撞车纪律、SPEC-028 编号碰撞、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
