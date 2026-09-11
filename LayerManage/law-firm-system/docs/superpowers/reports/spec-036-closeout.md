# SPEC-036 审计例外审批闭环（Audit Exception Approval Workflow）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-034 closeout §9「例外审批流程——policy EXCEPTION 机制已接线（advisories 字段，development scope），但审批流程本身未实现（当前需人工编辑 `security/dependency-exceptions.json`）」 ｜ 用户授权自主推进（无人值守）
前置：SPEC-030（生产审计清零 + 契约下限锁死）、SPEC-031（dev 审计清零）、SPEC-034（moderate gate + 基线断言）

## 1. 交付范围

给 audit 门禁的例外（`security/dependency-exceptions.json`）加**生命周期状态**（`pending_review` → `approved`，**仅 approved 生效**——未审批不豁免，fail-closed）+ **治理报告命令** `security:exceptions`（approved/pending_review/expired/invalid 分类 + 到期预警）。**零业务代码变更**（仅 scripts/security 工具链 + exceptions 配置 + runbook/closeout）；**零结构变更**（迁移 28/模型 60/权限 129/事件 15/路由 22 全不变——迁移 28 为外部渠道在制态）。

**变更文件（共 6 件代码 + runbook + 本 closeout）**：`scripts/security/policy.mjs`（status 可选字段枚举校验）、`scripts/security/audit-gate.mjs`（hasException 仅认 approved/legacy）、`scripts/security/cli.mjs`（COMMANDS +audit-exceptions + runExceptionReportCommand）、`security/dependency-exceptions.json`（SEC-2026-001 显式补 `status: "approved"`）、`scripts/security/policy.test.mjs` + `audit-gate.test.mjs` + `cli.test.mjs` + `dependency-contract.test.mjs`（+status/报告/契约用例）、`package.json`（+`security:exceptions` script）；`docs/superpowers/runbooks/finance-operations.md`（§8 例外生命周期 + `security:test` 42→47 基线）。

## 2. 工具链

Node scripts（mjs）/ npm audit。Node test runner（串行 `--test-concurrency=1 --test-force-exit`）。运行时 Node v24.18.0。测试库 55433 `_test`；55432 禁触；连接串一律 127.0.0.1。全程零 git 操作。测试 env 块按项目纪律（占位符口径）。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `security:test`（root） | **49/49 pass，0 fail**（SPEC-034 基线 42 → +7：policy +1 / audit-gate +2 / cli +4——评审 M-1/M-2/M-3 修复后 +2） |
| `security:audit:all`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| `security:audit:prod`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| `npm run security:exceptions`（root，端到端） | **exit 0**——approved(1): SEC-2026-001 / pending_review(0) / expired(0) / invalid(0) + expiring_soon: SEC-2026-001 expires 2026-08-15 |

### 3.2 后端全量（参照）

SPEC-036 零业务代码变更（仅 scripts/security + exceptions 配置），不触碰后端 .ts 测试集——后端全量计数沿用 SPEC-034 终态 **1900/1870/26/4**（0 真 fail 归 SPEC-034，13 撞车隔离复跑 95/95 + 12 外部漂移照录）；SPEC-036 自身闸门以 `security:test` 47/47 + audit 双绿 + `security:exceptions` exit 0 为权威。

## 4. 迁移与模型

**零迁移、零模型、零权限、零事件、零路由变更**（迁移 **28**（外部在制）/ 模型 **60** / 权限 **129**（外部在制）/ 事件 **15** / 路由 **22** 全不变）——SPEC-036 仅 scripts/security 工具链（mjs）+ `security/dependency-exceptions.json` 配置 + 文档，零 .ts 业务变更。

## 5. 关键裁决记录（D1-D5）

| # | 决策 | 值 |
|---|---|---|
| D1 | status 生命周期 | 例外 +`status`：`pending_review` \| `approved`；**缺省 `approved`**（legacy 无 status 向后兼容，SEC-2026-001 显式补 approved 行为不变）。枚举白名单校验（非法 → fail） |
| D2 | 生效性 | audit-gate `hasException` **仅认 `approved`**（或 legacy 无 status）；`pending_review` 不豁免 → 该 advisory 仍 block（audit 门禁不静默放行，fail-closed） |
| D3 | 治理报告 | cli.mjs `audit-exceptions` 子命令（`npm run security:exceptions`）：读 raw JSON 分类 approved/pending_review/expired/invalid + 到期 ≤14 天 `expiring_soon` 预警；exit 0（信息命令不 gate）；缺失/非法 JSON 容错输出 |
| D4 | 验证 | `security:test` 47/47（status 枚举/缺省兼容/pending 不豁免/approved 豁免/混合/报告分类/容错）+ audit:all/prod 双绿 + `security:exceptions` 端到端 |
| D5 | 零业务代码 | 仅 scripts/security + exceptions 配置；零 .ts 业务变更；零结构变更 |

**实施期 ⚠️ 记录**：
- **dependency-contract 契约同步**：SEC-2026-001 显式补 `status: "approved"` 后，`dependency-contract.test.mjs` 的 deepStrictEqual 断言需同步补 status 字段（契约测试即真相）。
- **评审复核（独立，0C/0I/3M → Ready for closeout Yes）**：D1/D2/D3 核心语义正确、fail-closed 无绕过路径。**M-1（invalid 分类过窄）已修**——报告加必填字段（id/workspace/package/advisories/scope/expiresAt）+ expiresAt 可解析完整性检查，缺字段/非法日期入 invalid 并逐条列问题（治理报告保真）；**M-2（pending_review 过期未入 expired）已修**——过期 pending_review 并示 pending_review + expired 双桶；**M-3（测试覆盖）已补**——非数组 exceptions / 缺字段 / 非法日期 / 过期 pending 用例（security:test 47→**49**）。

## 6. 安全审计状态

- `security:test` **47/47**（+5 自 SPEC-034 基线 42，零新增例外）。
- `security:audit:all`/`prod` **server + web 双 passed=true**（moderate gate + 基线断言保持，SPEC-034）。
- `security:exceptions` **exit 0**——当前唯一例外 SEC-2026-001（approved，development scope，serialize-javascript 残留）**显式 approved 后行为不变**；expiring_soon 2026-08-15 到期预警（SEC-2026-001 需在到期前复审/续期）。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **例外文件仍人工维护**：`pending_review`→`approved` 的审批动作是编辑 JSON（无自动审批 UI/服务端状态机）——超出工具链范围（设计 §6 OUT）。
2. **expired 例外**：`validateExceptions` 对 expired 例外 fail-closed（gate 严格）；`security:exceptions` 报告单独展示 expired 分类（读 raw 容错）——治理可见性 vs gate 严格性分离。
3. **SEC-2026-001 到期**（2026-08-15）：serialize-javascript 例外需到期前复审（若非仍需豁免则续期，否则移除）——`security:exceptions` expiring_soon 预警。
4. **外部渠道在制**：迁移 28（case_version_column）等外部漂移使 check:baseline 报 28 vs 27（照录，归外部渠道）——与 SPEC-036 无关（SPEC-036 零结构变更）。
5. **承接既有已知项**：SEC-2026-002 观察；trust-root-guard 外部漂移（spec-022）；前端预存 vitest flake；各 SPEC closeout §9 follow-up。
6. **评审 M-3 残余**：`audit-gate.test` baselineExcess 路径仅测 legacy 豁免、未单独测 pending_review 不豁免该路径（共享 hasException 已覆盖，风险低）——照录。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 28（外部在制）/模型 60/权限 129（外部在制）/事件 15/路由 22 全不变——SPEC-036 仅 scripts/security 工具链 + exceptions 配置 + 文档，零 .ts 变更。
- **测试计数**：`security:test` SPEC-034 基线 **42** → SPEC-036 **47**（+5：policy status 校验、audit-gate pending 不豁免/approved+混合豁免、cli 报告分类/容错）——`dependency-contract.test.mjs` 契约同步（SEC-2026-001 status 字段）。
- **行为对账**：SEC-2026-001 显式 `status: "approved"` 后 audit:all/prod 双绿（豁免行为不变）；`security:exceptions` 实测 approved(1) + expiring_soon。
- **docs-leakage 占位符口径**：closeout/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。

## 9. Follow-up 路由（候选专项）

- **例外自动审批流**：Web 表单/服务端审批状态机（`pending_review`→`approved` 经接口审批）——设计 §6 OUT，可专项。
- **基线演进流程**：expected-baseline.json 变更评审/审计跟踪（SPEC-034 §9 另一 follow-up）——另行。
- **生产 scope 例外**：scope 仍限 development（生产 zero-advisory 策略不变，SPEC-034 M-2 基线硬阻断）——如需生产例外需先放宽 D2 语义。
- **SEC-2026-001 到期处置**（2026-08-15）：到期前复审续期或移除。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。
- **trust-root-guard 业务失败归口**：spec-022 外部漂移跟踪归外部渠道。

## 10. 双渠道验收链

- **Task 1（status 生命周期 + 生效性）**：policy.mjs status 可选枚举校验（缺省 approved）+ audit-gate.mjs hasException 仅认 approved/legacy + `security/dependency-exceptions.json` SEC-2026-001 显式 approved → `security:test` 47/47（+policy 1 + audit-gate 2）+ audit:all/prod 双绿（行为不变）。
- **Task 2（治理报告 + runbook/closeout，本报告）**：cli.mjs `audit-exceptions` 报告命令 + `security:exceptions` npm script + cli.test（报告分类/expiring_soon/缺失/非法 JSON）→ `security:test` 47/47 + `security:exceptions` 端到端 exit 0（approved(1)/pending(0)/expired(0)/invalid(0) + expiring_soon）+ runbook §8 例外生命周期 + 本 closeout。

## 11. 收官状态

**SPEC-036 审计例外审批闭环本地闭环（2026-08-05）**：2/2 任务完成（Task 1 status 生命周期 + 仅 approved 生效；Task 2 `security:exceptions` 治理报告 + runbook/closeout 收尾）。**零结构变更 + 零业务代码**（迁移 **28**（外部在制）/模型 **60**/权限 **129**（外部在制）/事件 **15**/路由 **22** 全不变，零 .ts 变更）；`security:test` **49/49**（+7 自 SPEC-034 基线 42）+ `security:audit:all`/`prod` 双绿 + `security:exceptions` exit 0（approved(1) + expiring_soon SEC-2026-001 2026-08-15）+ check:docs-leakage exit 0（占位符口径）。runbook §8 例外生命周期已落地（`security:test` 42→49 基线 + `security:exceptions` 命令）。评审独立复核 **PASS**（0C/0I，M-1/M-2/M-3 已闭，Ready for closeout Yes）；已知非阻断项 §7 照录（人工审批、expired 分离、SEC-2026-001 到期、外部在制漂移、M-3 残余、承接既有项），follow-up §9 归专项。按项目约束零 git 操作，本地闭环。
