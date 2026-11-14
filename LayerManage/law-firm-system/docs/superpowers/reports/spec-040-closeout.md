# SPEC-040 例外审批 CLI（Audit Exception Review CLI）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-036 closeout §9「例外自动审批流——Web 表单/服务端审批状态机（pending_review→approved 经接口审批）——设计 §6 OUT，可专项」 ｜ 用户授权自主推进（无人值守）
前置：SPEC-036（例外生命周期 status + 治理报告）、SPEC-038（SEC-2026-001 退役）

## 1. 交付范围

把例外审批从「人工编辑 `security/dependency-exceptions.json` 改 status」升级为**受控 CLI 命令**：`security:exceptions approve <id> --reviewed-by <name>`（pending_review→approved + 评审元数据落盘）/ `reject <id>`（移除条目）。审批是独立、可校验、可审计的动作，附 reviewedAt/reviewedBy，替代裸文件编辑。**零业务代码变更**（仅 scripts/security 工具链 + exceptions 配置）；**零结构变更**（迁移 29/模型 60/权限 132/事件 15/路由 26 全不变——迁移 29 为外部在制态）。

**变更文件（共 3 件代码 + runbook + 本 closeout）**：`scripts/security/cli.mjs`（parseCommandArguments 子命令 + approveException/rejectException + 原子写回）、`scripts/security/policy.mjs`（例外可选字段 +reviewedAt/reviewedBy 校验）、`scripts/security/cli.test.mjs` + `policy.test.mjs`（+审批/元数据用例）；`docs/superpowers/runbooks/finance-operations.md`（§8 审批命令说明）；本 closeout。

## 2. 工具链

Node scripts（mjs）。Node test runner（串行）。运行时 Node v24.18.0。测试库 55433 `_test`；55432 禁触。全程零 git 操作。安全脚本测试不需 DB。测试 env 块按项目纪律（占位符口径）。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `security:test`（root） | **57/57 pass，0 fail**（SPEC-038 基线 49 → +8：cli +7 / policy +1——评审 I-1/I-2 修复后 +2 回归用例） |
| `security:audit:all` / `prod`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| E2E approve（临时 fixture） | `approved SEC-DEMO by reviewer-name on 2026-08-05`，文件落盘 status=approved/approvedBy/reviewedAt/reviewedBy |
| E2E reject（临时 fixture） | `rejected SEC-DEMO (removed)`，文件落盘 exceptions 0 |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

### 3.2 后端全量（参照）

SPEC-040 零业务代码变更（仅 scripts/security），不触碰后端 .ts 测试集——后端全量计数沿用 SPEC-034 终态（0 真 fail，撞车 + 外部漂移照录）；SPEC-040 自身闸门以 `security:test` 55/55 + audit 双绿 + E2E 为权威。

## 4. 迁移与模型

**零迁移、零模型、零权限、零事件、零路由变更**（迁移 **29**（外部在制）/ 模型 **60** / 权限 **132**（外部在制）/ 事件 **15** / 路由 **26**（外部在制）全不变）——SPEC-040 仅 scripts/security 工具链（mjs）+ exceptions 配置 + 文档，零 .ts 业务变更。

## 5. 关键裁决记录（D1-D5）

| # | 决策 | 值 |
|---|---|---|
| D1 | approve 子命令 | `security:exceptions approve <id> --reviewed-by <name>`：status `pending_review`→`approved`；设 `approvedBy=reviewedBy`、`reviewedAt=today`、`reviewedBy=name`；`name===owner` 拒（独立审批）；已 approved → 幂等信息；找不到 → 错误 |
| D2 | reject 子命令 | `security:exceptions reject <id>`：移除条目（rejected 不入库）；找不到 → 错误 |
| D3 | 评审元数据 | policy.mjs 例外可选字段 `reviewedAt`（ISO 日期）/ `reviewedBy`（非空字符串）校验；legacy 无此二字段兼容 |
| D4 | 原子写回 | approve/reject 修改后 temp 文件 + rename 覆盖，失败不损坏原文件 |
| D5 | 验证 | `security:test` 55/55 + audit 双绿 + E2E（approve/reject 文件落盘断言） |

**实施期 ⚠️ 记录**：
- **测试 fixture 生命周期**：approve 走 `loadSecurityConfiguration` 严格校验（`maxDevelopmentExceptionDays=30`）——测试 fixture 例外 expiresAt 需 ≤createdAt+30 天（初版 08-20/07-16=35 天被拒，修为 08-15）。
- **fixture 需全配置**：approve 加载 policy + baseline + exceptions 三件——fixture 补齐 policy/baseline 文件（报告命令只读 exceptions，无需）。
- **评审复核（独立，0C/2I/2M → 修复后 Ready for closeout）**：**I-1（--reviewed-by 未 trim 会写坏门禁）已修**——parse 取 `args[4].trim()`，落盘 reviewedBy/approvedBy 保证通过 `nonEmptyString`（加回归测试）；**I-2（reject 无法移除过期条目）已修**——reject 改宽松读（raw JSON + 最小形状检查，不跑严格 validateExceptions），过期/非法条目可被清理（加回归测试）。M-1（两缺陷缺回归用例）已补；M-2（`security:test` 未带 `--test-concurrency=1`，实测纯 JS 无 DB 并行无害）照录。

## 6. 安全审计状态

- `security:test` **55/55**（+6 自 SPEC-038 基线 49，零新增例外）。
- `security:audit:all`/`prod` **server + web 双 passed=true**（0 漏洞，SPEC-036 生命周期 + SPEC-038 退役保持）。
- `security:exceptions` 报告命令（无参）不变（approved(0)）；`approve`/`reject` 为子命令（`npm run security:exceptions -- approve <id> ...`）。
- 审批命令 fail-closed：找不到/自审/非法参均错误退出，不写坏文件（原子写回）。

## 7. 已知非阻断项（照录）

1. **Web 审批 UI 未实现**：审批仍 CLI（repo 配置治理）——设计 §6 OUT，浏览器审批流可专项。
2. **批量审批未实现**：逐个 `approve <id>`——例外数量小，可接受。
3. **审批通知未实现**：无邮件/IM 集成——人工巡检 `security:exceptions`（approved/pending_review/expired 分组）。
4. **外部渠道在制**：迁移 29（外部在制）致 check:baseline 计数漂移（照录归外部）——SPEC-040 零结构变更。
5. **评审 M-2 照录**：`security:test` 未带 `--test-concurrency=1`（计划字面要求串行）——安全脚本纯 JS 无 DB、fixture 独立 temp 目录，实测并行无害（57/57），非缺陷。
6. **承接既有已知项**：SEC-2026-002 观察；trust-root-guard 外部漂移（spec-022）；前端预存 vitest flake。

## 8. 对账项

- **零结构变更 + 零业务代码**：迁移 29（外部在制）/模型 60/权限 132（外部在制）/事件 15/路由 26（外部在制）全不变——SPEC-040 仅 scripts/security 工具链 + exceptions 配置 + 文档，零 .ts 变更。
- **测试计数**：`security:test` SPEC-038 基线 **49** → SPEC-040 **55**（+6：cli approve/reject/幂等/自审/移除/缺失 + policy 元数据）。
- **行为对账**：E2E approve（pending→approved + 元数据落盘）/ reject（移除）文件断言通过；`security:exceptions` 报告（无参）不变。
- **docs-leakage 占位符口径**：closeout/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。

## 9. Follow-up 路由（候选专项）

- **Web 审批 UI**：浏览器审批流（pending_review 列表 + approve/reject 按钮）——设计 §6 OUT，可专项。
- **批量审批**：`approve <id1> <id2>...` 或 `reject --all-pending`——例外数量增长时。
- **基线演进流程**：expected-baseline.json 变更评审/审计跟踪（SPEC-034 §9）——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。
- **trust-root-guard 业务失败归口**：spec-022 外部漂移跟踪归外部渠道。

## 10. 双渠道验收链

- **Task 1（审批命令 + 元数据）**：cli.mjs 子命令解析（approve/reject）+ approveException/rejectException（原子写回）+ policy.mjs reviewedAt/reviewedBy 可选校验 → `security:test` 55/55（cli +5 / policy +1）+ E2E（approve 落盘 / reject 移除）+ audit 双绿。
- **Task 2（runbook/closeout，本报告）**：runbook §8 审批命令说明（`approve`/`reject` 替代人工编辑 JSON）+ 本 closeout。

## 11. 收官状态

**SPEC-040 例外审批 CLI 本地闭环（2026-08-05）**：2/2 任务完成（Task 1 approve/reject 子命令 + 评审元数据 + 原子写回；Task 2 runbook/closeout 收尾）。**零结构变更 + 零业务代码**（迁移 **29**（外部在制）/模型 **60**/权限 **132**（外部在制）/事件 **15**/路由 **26**（外部在制）全不变，零 .ts 变更）；`security:test` **57/57**（+8 自 SPEC-038 基线 49）+ `security:audit:all`/`prod` 双绿 + E2E approve/reject 落盘断言通过 + check:docs-leakage exit 0（占位符口径）。runbook §8 审批命令已落地（`security:test` 49→57 基线）。评审独立复核 **PASS**（0C/2I/2M——I-1 trim、I-2 reject 宽松读、M-1 回归用例 已闭；M-2 照录）；已知非阻断项 §7 照录（Web UI/批量/通知未做、M-2、外部在制漂移、承接既有项），follow-up §9 归专项。按项目约束零 git 操作，本地闭环。
