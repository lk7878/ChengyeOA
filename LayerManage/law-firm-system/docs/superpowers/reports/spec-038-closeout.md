# SPEC-038 SEC-2026-001 例外退役（Residual Exception Retirement）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-031 closeout「serialize-javascript 异常（SEC-2026-001）现为残留」+ SPEC-036 §9「SEC-2026-001 到期处置（2026-08-15，到期前复审续期或移除）」+ `security:exceptions` 报告 expiring_soon 预警 ｜ 用户授权自主推进（无人值守）
前置：SPEC-036（例外生命周期 + 治理报告）、SPEC-034（moderate gate + 基线）、SEC-SPEC-001（供应链治理）

## 1. 交付范围

退役**残留例外 SEC-2026-001**（serialize-javascript / GHSA-5c6j-r48x-rmvq，development scope）——serialize-javascript 已升至 **7.0.7**（修复该 advisory），`npm audit` 实测 **0 漏洞**，例外不再豁免任何东西（纯残留）。**移除** `security/dependency-exceptions.json` 中该条目（→ 空数组）+ **契约下限锁死** serialize-javascript **≥7.0.7**（防无例外静默回退）+ 文档。**零业务代码 + 零结构变更**。

**变更文件（共 2 件代码 + runbook + 本 closeout）**：`security/dependency-exceptions.json`（移除 SEC-2026-001 → 空）、`scripts/security/dependency-contract.test.mjs`（例外断言 → 空 + serialize-javascript floor ≥7.0.7）；`docs/superpowers/runbooks/finance-operations.md`（§8 退役说明）；本 closeout。

## 2. 工具链

Node scripts（mjs）/ npm audit。Node test runner（串行）。运行时 Node v24.18.0。测试库 55433 `_test`；55432 禁触。全程零 git 操作。测试 env 块按项目纪律（占位符口径）。

## 3. 测试计数链

| 检查 | 结果 |
|---|---|
| `security:test`（root） | **49/49 pass，0 fail**（计数不变：例外断言改空 + floor 并入既有测试） |
| `npm run security:exceptions`（root） | **exit 0**——approved(0) / pending_review(0) / expired(0) / invalid(0) |
| `security:audit:all` / `prod`（root） | **server + web 双 passed=true**，production high=0/critical=0（0 漏洞，无例外豁免需求） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型、零权限、零事件、零路由变更**（迁移 **28** / 模型 **60** / 权限 **132**（外部在制，绩效 037）/ 事件 **15** / 路由 **26**（外部在制）全不变）——SPEC-038 仅 exceptions 配置 + 契约测试 + 文档。

## 5. 关键裁决记录

| # | 决策 | 值 |
|---|---|---|
| D1 | 例外退役 | SEC-2026-001（serialize-javascript / GHSA-5c6j-r48x-rmvq）audit 实测 **0 漏洞**、7.0.7 已修复 → 移除残留例外（`dependency-exceptions.json` → 空） |
| D2 | 契约下限 | `dependency-contract.test.mjs` 钉死 serialize-javascript **≥7.0.7**（当前已知安全版本）——移除例外后仍防静默回退（回退即 audit block + 契约 fail 双保险） |
| D3 | 验证 | `security:test` 49/49 + audit:all/prod 双绿（0 漏洞）+ `security:exceptions` approved(0) |
| D4 | 零业务代码 | 仅 exceptions 配置 + 契约测试 + 文档；零 .ts 业务变更；零结构变更 |

**实施期 ⚠️ 记录**：无（配置移除 + 契约断言更新，无实现偏差）。

## 6. 安全审计状态

- `security:test` **49/49**（零新增例外）。
- `security:audit:all`/`prod` **server + web 双 passed=true**（production + development 全 zero——0 漏洞，退役例外无影响）。
- `security:exceptions` **approved(0)**——例外清单为空，治理报告正确反映。
- `dependency-contract.test.mjs` 契约：例外空断言 + serialize-javascript ≥7.0.7 floor（SEC-2026-001 退役后防回退）。

## 7. 已知非阻断项（照录）

1. **SEC-2026-001 退役决策依据**：audit 0 漏洞 + 7.0.7 修复——若未来工具链升级引入新的 serialize-javascript advisory，需重新加例外（走 SPEC-036 生命周期：`pending_review` → `approved`）。
2. **契约下限为当前安全版本**（≥7.0.7）而非最小修复版本——保守但安全（任何降级即 fail）。
3. **承接既有已知项**：SEC-2026-002 观察；trust-root-guard 外部漂移（spec-022）；前端预存 vitest flake；外部渠道在制（绩效 037 / 迁移 28）致 check:baseline 计数漂移（照录归外部）。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 28 / 模型 60 / 权限 132（外部在制）/ 事件 15 / 路由 26（外部在制）全不变——SPEC-038 仅 exceptions 配置 + 契约测试 + 文档。
- **例外清单对账**：SEC-2026-001 移除 → `dependency-exceptions.json` 空数组 → `security:test` 例外断言改空 + `security:exceptions` approved(0) → audit 双绿（0 漏洞，无豁免需求）——闭环。
- **契约对账**：serialize-javascript ≥7.0.7 floor 并入「server runtime dependency tree」测试（audit 实测 7.0.7 一致）。
- **docs-leakage 占位符口径**：closeout/runbook 更新段不落真实密钥/连接串口令。

## 9. Follow-up 路由（候选专项）

- **例外自动审批流**：Web 表单/服务端审批状态机（SPEC-036 §9）——另行。
- **基线演进流程**：expected-baseline.json 变更评审/审计跟踪——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。
- **后续依赖审计**：`security:exceptions` 报告周期巡检（新增例外必须走 `pending_review`→`approved`）。

## 10. 验收链

- **Task 1（唯一任务）**：移除 SEC-2026-001（`dependency-exceptions.json` → 空）+ 契约断言改空 + serialize-javascript ≥7.0.7 floor → `security:test` 49/49 + `security:exceptions` approved(0) + audit:all/prod 双绿 + runbook §8 + 本 closeout。

## 11. 收官状态

**SPEC-038 SEC-2026-001 例外退役本地闭环（2026-08-05）**：残留例外移除（serialize-javascript / GHSA-5c6j-r48x-rmvq，audit 实测 0 漏洞、7.0.7 已修复）+ 契约下限锁死 ≥7.0.7 防回退 + runbook/closeout。**零结构变更 + 零业务代码**（迁移 28 / 模型 60 / 权限 132（外部在制）/ 事件 15 / 路由 26（外部在制）全不变）；`security:test` **49/49** + `security:audit:all`/`prod` 双绿（0 漏洞）+ `security:exceptions` **approved(0)** + check:docs-leakage exit 0（占位符口径）。runbook §8 退役说明已落地。按项目约束零 git 操作，本地闭环。
